import type {
  Analysis,
  Outcome,
  PastedAnalysisOptions,
  PastedStandings,
  PastedVariant,
  Scenario,
  StandingRow,
} from './contract.ts';
import { buildVerdict, PASTED_ID_SAFE_THRESHOLD, scenarioStatus } from './analyze.ts';
import { mulberry32 } from './rng.ts';

/**
 * Paste mode: analysis from what a player can copy off Melee's standings page
 * (one table, no opponent history), optionally plus the posted final-round
 * pairings. The OMW/GW/OGW the table shows cannot be recomputed without the
 * opponents' records, so the final round is simulated on match POINTS and the
 * tiebreakers are approximated. Variants (measured in test/backtest-pasted.test.ts,
 * results in docs/research/backtest-pasted.md):
 *
 *  A  OMW and OGW frozen at the pasted values. GW is updated exactly from the
 *     simulated games when the table has a game record, else frozen. Players
 *     tied on points are ordered by (OMW, GW, OGW, current rank).
 *  B  Like A, but the final round's effect on OMW and OGW is estimated. Every
 *     one of the k old opponents of a player who has played n rounds will play
 *     one more round; in a final round paired by standings that match is close
 *     to a coin flip, so an opponent's win percentage x moves to
 *     (x*n + 0.5)/(n+1). The new opponent (known from the pairing) contributes
 *     their exact final percentage:
 *       OMW' = (k * (OMW*n + 0.5)/(n+1) + pct(q)) / (k+1)
 *     with k = n = rounds played, pct(q) = q's final points / (3*(n+1)), floored
 *     at 1/3. OGW' is the same with game-win percentages (q's exact one if the
 *     table has game records, else frozen).
 *  C  Players tied on points after the round are not ordered deterministically:
 *     a rival at current rank r beats the player at current rank s with
 *     probability 1/(1 + exp(-(s - r)/2)) (a coin flip for neighbours, near
 *     certain for ranks far apart). The chance of finishing inside the cut is
 *     computed exactly (Poisson-binomial over the tied rivals). This keeps the
 *     current tiebreaker order but adds the uncertainty that the frozen
 *     approximations hide, which makes verdicts at the bubble more conservative.
 *
 * "certain" and "impossible" are proven from points alone (never from the
 * approximate tiebreakers), and never rely on the posted or predicted pairings.
 */

const WIN = 3;
const DRAW = 1;
const FLOOR = 1 / 3;
const COIN_SCALE = 2;
const MAX_ENUM_TABLES = 10;
const MAX_LEAVES = 59049;
const RESAMPLE_EVERY = 256;
const MIN_EVALS = 64;
const EDGE = 0.001;
const EPS = 1e-9;

const ALL_VARIANTS: PastedVariant[] = ['A', 'B', 'C'];
export const DEFAULT_PASTED_VARIANT: PastedVariant = 'C';

const OUTCOMES: Outcome[] = ['win', 'draw', 'loss'];

const pct = (points: number, count: number): number => (count <= 0 ? FLOOR : Math.max(FLOOR, points / (WIN * count)));
const floorTo = (v: number): number => (v < FLOOR ? FLOOR : v);

interface Field {
  n: number;
  names: string[];
  pts: Int32Array;
  dropped: Uint8Array;
  omw: Float64Array;
  gw: Float64Array;
  ogw: Float64Array;
  /** Game points and games played, null when the table has no game record. */
  gp: Float64Array | null;
  gc: Float64Array | null;
  rows: PastedStandings['rows'];
}

interface Table {
  a: number;
  b: number; // -1 for a bye
}

function buildField(input: PastedStandings): Field {
  const rows = [...input.rows].sort((x, y) => x.rank - y.rank);
  const n = rows.length;
  const hasGames = rows.every((r) => r.games !== undefined);
  const f: Field = {
    n,
    names: rows.map((r) => r.name),
    pts: Int32Array.from(rows.map((r) => r.points)),
    dropped: Uint8Array.from(rows.map((r) => (r.dropped ? 1 : 0))),
    omw: Float64Array.from(rows.map((r) => floorTo(r.omw))),
    gw: Float64Array.from(rows.map((r) => floorTo(r.gw))),
    ogw: Float64Array.from(rows.map((r) => floorTo(r.ogw))),
    gp: hasGames ? Float64Array.from(rows.map((r) => r.games!.wins * WIN + r.games!.draws * DRAW)) : null,
    gc: hasGames ? Float64Array.from(rows.map((r) => r.games!.wins + r.games!.losses + r.games!.draws)) : null,
    rows,
  };
  return f;
}

function findIndex(f: Field, name: string): number {
  let i = f.names.indexOf(name);
  if (i >= 0) return i;
  const k = name.trim().toLowerCase();
  i = f.names.findIndex((x) => x.trim().toLowerCase() === k);
  return i;
}

/** Mirrors core's IdSafety, on plain arrays. */
class IdSafety {
  private memo = new Map<number, number>();
  private f: Field;
  private wp: Int32Array;
  private partner: Int32Array;
  private topCut: number;
  constructor(f: Field, wp: Int32Array, partner: Int32Array, topCut: number) {
    this.f = f;
    this.wp = wp;
    this.partner = partner;
    this.topCut = topCut;
  }
  private tableMax(T: number, a: number, b: number): number {
    const { f, wp } = this;
    const da = f.dropped[a] === 1 ? 0 : 1;
    const db = f.dropped[b] === 1 ? 0 : 1;
    const pa = wp[a]!;
    const pb = wp[b]!;
    const x = da * (pa + WIN > T ? 1 : 0) + db * (pb > T ? 1 : 0);
    const y = da * (pa > T ? 1 : 0) + db * (pb + WIN > T ? 1 : 0);
    const z = da * (pa + DRAW > T ? 1 : 0) + db * (pb + DRAW > T ? 1 : 0);
    return Math.max(x, y, z);
  }
  private total(T: number): number {
    const hit = this.memo.get(T);
    if (hit !== undefined) return hit;
    let c = 0;
    for (let p = 0; p < this.f.n; p++) {
      const q = this.partner[p]!;
      if (q < 0) {
        if (this.f.dropped[p] === 0 && this.wp[p]! > T) c++;
      } else if (p < q) c += this.tableMax(T, p, q);
    }
    this.memo.set(T, c);
    return c;
  }
  safe(a: number, b: number): boolean {
    const T = Math.min(this.wp[a]!, this.wp[b]!) + DRAW;
    return this.total(T) - this.tableMax(T, a, b) + 2 <= this.topCut;
  }
}

interface PathOut {
  outcome: Outcome;
  probs: Record<PastedVariant, number>;
  certainty: Scenario['certainty'];
  best: number;
  worst: number;
}

class FinalRound {
  readonly predicted: boolean;
  private tables: Table[];
  private tableOf: Int32Array; // table index per player, -1 if none
  focusOpp = -1;
  focusBye = false;
  unplaced: number;

  private f: Field;
  private focus: number;
  private topCut: number;
  private roundsPlayed: number;
  private pw: number;
  private idRate: number;
  private rng: () => number;

  constructor(
    f: Field,
    focus: number,
    topCut: number,
    roundsPlayed: number,
    pw: number,
    idRate: number,
    rng: () => number,
    tables: Table[],
    predicted: boolean,
  ) {
    this.f = f;
    this.focus = focus;
    this.topCut = topCut;
    this.roundsPlayed = roundsPlayed;
    this.pw = pw;
    this.idRate = idRate;
    this.rng = rng;
    this.tables = tables;
    this.predicted = predicted;
    this.tableOf = new Int32Array(f.n).fill(-1);
    tables.forEach((t, i) => {
      this.tableOf[t.a] = i;
      if (t.b >= 0) this.tableOf[t.b] = i;
      if (t.a === focus) {
        this.focusOpp = t.b;
        this.focusBye = t.b < 0;
      } else if (t.b === focus) this.focusOpp = t.a;
    });
    let un = 0;
    for (let p = 0; p < f.n; p++) if (f.dropped[p] === 0 && this.tableOf[p]! < 0) un++;
    this.unplaced = un;
  }

  runPath(outcome: Outcome, variants: PastedVariant[]): PathOut {
    const { f, focus, topCut, rng } = this;
    const n = f.n;
    const S = Int32Array.from(f.pts);
    const Sgp = f.gp ? Float64Array.from(f.gp) : null;
    const Sgc = f.gc ? Float64Array.from(f.gc) : null;
    const baseP = Int32Array.from(f.pts); // before this round, for proofs
    const partner = new Int32Array(n).fill(-1);
    const oppF = new Int32Array(n).fill(-1);

    const applyGames = (P: Int32Array, GP: Float64Array | null, GC: Float64Array | null, a: number, b: number, aw: number, bw: number, dr: number) => {
      P[a] = S[a]! + (aw > bw ? WIN : aw === bw ? DRAW : 0);
      P[b] = S[b]! + (bw > aw ? WIN : aw === bw ? DRAW : 0);
      if (GP && GC && Sgp && Sgc) {
        const g = aw + bw + dr;
        GP[a] = Sgp[a]! + aw * WIN + dr * DRAW;
        GP[b] = Sgp[b]! + bw * WIN + dr * DRAW;
        GC[a] = Sgc[a]! + g;
        GC[b] = Sgc[b]! + g;
      }
    };

    // Byes.
    for (const t of this.tables) {
      if (t.b >= 0) continue;
      S[t.a] = S[t.a]! + WIN;
      if (Sgp && Sgc) {
        Sgp[t.a] = Sgp[t.a]! + 2 * WIN;
        Sgc[t.a] = Sgc[t.a]! + 2;
      }
    }
    // Focus's table.
    const pathOutcome: Outcome = this.focusBye ? 'win' : outcome;
    if (this.focusOpp >= 0) {
      const o = this.focus;
      const q = this.focusOpp;
      const aw = pathOutcome === 'win' ? 2 : 0;
      const bw = pathOutcome === 'loss' ? 2 : 0;
      const dr = pathOutcome === 'draw' ? 3 : 0;
      const g = aw + bw + dr;
      if (Sgp && Sgc) {
        Sgp[o] = Sgp[o]! + aw * WIN + dr * DRAW;
        Sgp[q] = Sgp[q]! + bw * WIN + dr * DRAW;
        Sgc[o] = Sgc[o]! + g;
        Sgc[q] = Sgc[q]! + g;
      }
      S[o] = S[o]! + (aw > bw ? WIN : aw === bw ? DRAW : 0);
      S[q] = S[q]! + (bw > aw ? WIN : aw === bw ? DRAW : 0);
      oppF[o] = q;
      oppF[q] = o;
    }
    // Other tables: opponents and partners.
    const pending: Table[] = [];
    for (const t of this.tables) {
      if (t.b < 0 || t.a === focus || t.b === focus) continue;
      pending.push(t);
      partner[t.a] = t.b;
      partner[t.b] = t.a;
      oppF[t.a] = t.b;
      oppF[t.b] = t.a;
    }
    const F = S[focus]!;
    const safety = new IdSafety(f, S, partner, topCut);

    // Which pending tables matter, and how to enumerate them.
    const rel: number[] = [];
    pending.forEach((t, i) => {
      if (f.dropped[t.a] === 1 && f.dropped[t.b] === 1) return;
      if (S[t.a]! + WIN >= F || S[t.b]! + WIN >= F) rel.push(i);
    });
    rel.sort((x, y) => Math.max(S[pending[y]!.a]!, S[pending[y]!.b]!) - Math.max(S[pending[x]!.a]!, S[pending[x]!.b]!));
    const idOk = pending.map((t) => this.idRate > 0 && safety.safe(t.a, t.b));
    const enumIdx: number[] = [];
    const sampled: number[] = [];
    let leaves = 1;
    for (const i of rel) {
      const k = idOk[i] ? 3 : 2;
      if (enumIdx.length >= MAX_ENUM_TABLES || leaves * k > MAX_LEAVES) {
        sampled.push(i);
        continue;
      }
      enumIdx.push(i);
      leaves *= k;
    }
    const nE = enumIdx.length;
    const eA = enumIdx.map((i) => pending[i]!.a);
    const eB = enumIdx.map((i) => pending[i]!.b);
    const eK = enumIdx.map((i) => (idOk[i] ? 3 : 2));
    const eP = enumIdx.map((i) =>
      idOk[i] ? [(1 - this.idRate) * this.pw, (1 - this.idRate) * (1 - this.pw), this.idRate] : [this.pw, 1 - this.pw],
    );

    // Proof by points alone (independent of tiebreakers, sampling and pairing accuracy).
    let possible = 0;
    let above = 0;
    const placedPosted = new Uint8Array(n);
    if (!this.predicted) {
      for (const t of pending) {
        placedPosted[t.a] = placedPosted[t.b] = 1;
        const da = f.dropped[t.a] === 1 ? 0 : 1;
        const db = f.dropped[t.b] === 1 ? 0 : 1;
        const pa = S[t.a]!;
        const pb = S[t.b]!;
        const outs: Array<[number, number]> = [
          [pa + WIN, pb],
          [pa, pb + WIN],
          [pa + DRAW, pb + DRAW],
        ];
        possible += Math.max(...outs.map(([x, y]) => da * (x >= F ? 1 : 0) + db * (y >= F ? 1 : 0)));
        above += Math.min(...outs.map(([x, y]) => da * (x > F ? 1 : 0) + db * (y > F ? 1 : 0)));
      }
      // The focus's own opponent and bye players are fixed by the posted pairings.
      for (let p = 0; p < n; p++) {
        if (placedPosted[p] || p === focus || f.dropped[p] === 1) continue;
        const known = this.tableOf[p]! >= 0;
        if (known) {
          if (S[p]! >= F) possible++;
          if (S[p]! > F) above++;
        } else {
          if (baseP[p]! + WIN >= F) possible++;
          if (baseP[p]! > F) above++;
        }
      }
    } else {
      for (let p = 0; p < n; p++) {
        if (p === focus || f.dropped[p] === 1) continue;
        if (baseP[p]! + WIN >= F) possible++;
        if (baseP[p]! > F) above++;
      }
    }
    const proofIn = possible < topCut;
    const proofOut = above >= topCut;

    // Working arrays.
    const W = Int32Array.from(S);
    const Wgp = Sgp ? Float64Array.from(Sgp) : null;
    const Wgc = Sgc ? Float64Array.from(Sgc) : null;
    const inEnum = new Uint8Array(n);
    for (let k = 0; k < nE; k++) inEnum[eA[k]!] = inEnum[eB[k]!] = 1;
    let cands: number[] = [];
    const sampleRest = () => {
      W.set(S);
      if (Wgp && Wgc && Sgp && Sgc) {
        Wgp.set(Sgp);
        Wgc.set(Sgc);
      }
      for (const i of sampled) {
        const t = pending[i]!;
        const r = rng();
        let aw = 0;
        let bw = 0;
        let dr = 0;
        if (idOk[i] && r < this.idRate) dr = 3;
        else if (rng() < this.pw) {
          aw = 2;
          bw = rng() < 0.5 ? 0 : 1;
        } else {
          bw = 2;
          aw = rng() < 0.5 ? 0 : 1;
        }
        applyGames(W, Wgp, Wgc, t.a, t.b, aw, bw, dr);
      }
      cands = [];
      for (let p = 0; p < n; p++) {
        if (p === focus || f.dropped[p] === 1) continue;
        if (W[p]! + (inEnum[p] ? WIN : 0) >= F) cands.push(p);
      }
    };

    const rounds = this.roundsPlayed;
    const gwOf = (p: number): number => (Wgp && Wgc ? pct(Wgp[p]!, Wgc[p]!) : f.gw[p]!);
    // Tiebreak keys for tied players.
    const key = (p: number, useB: boolean, out: Float64Array): void => {
      out[1] = gwOf(p);
      if (!useB || rounds === 0) {
        out[0] = f.omw[p]!;
        out[2] = f.ogw[p]!;
        return;
      }
      const nn = rounds;
      const q = oppF[p]!;
      const omwOld = (f.omw[p]! * nn + 0.5) / (nn + 1);
      const ogwOld = (f.ogw[p]! * nn + 0.5) / (nn + 1);
      if (q < 0) {
        out[0] = omwOld;
        out[2] = ogwOld;
      } else {
        out[0] = (nn * omwOld + pct(W[q]!, nn + 1)) / (nn + 1);
        out[2] = (nn * ogwOld + gwOf(q)) / (nn + 1);
      }
    };
    const kf = new Float64Array(3);
    const kp = new Float64Array(3);
    /** True if rival p finishes ahead of the focus among players tied on points. */
    const rivalAhead = (p: number, useB: boolean): boolean => {
      key(focus, useB, kf);
      key(p, useB, kp);
      for (let i = 0; i < 3; i++) {
        const e = kp[i]! - kf[i]!;
        if (Math.abs(e) > EPS) return e > 0;
      }
      return p < focus; // current rank order
    };

    const wantA = variants.includes('A');
    const wantB = variants.includes('B');
    const wantC = variants.includes('C');
    const pIn: Record<PastedVariant, number> = { A: 0, B: 0, C: 0 };
    const digit = new Int32Array(nE);
    const shortWin = new Uint8Array(nE);
    const ties: number[] = [];
    const passes = Math.max(1, Math.ceil(MIN_EVALS / leaves));
    let best = Number.POSITIVE_INFINITY;
    let worst = 0;
    let evals = 0;
    for (let pass = 0; pass < passes; pass++) {
      digit.fill(0);
      let since = RESAMPLE_EVERY;
      for (let leaf = 0; leaf < leaves; leaf++) {
        if (since >= RESAMPLE_EVERY || (leaf === 0 && pass > 0)) {
          sampleRest();
          since = 0;
        }
        since++;
        let w = 1;
        for (let k = 0; k < nE; k++) {
          const d = digit[k]!;
          w *= eP[k]![d]!;
          const a = eA[k]!;
          const b = eB[k]!;
          const sw = rng() < 0.5 ? 0 : 1;
          shortWin[k] = sw;
          // d: 0 a wins, 1 b wins (2 is an ID when allowed, else same index 2 never occurs)
          const isId = eK[k] === 3 && d === 2;
          if (isId) applyGames(W, Wgp, Wgc, a, b, 0, 0, 3);
          else if (d === 0) applyGames(W, Wgp, Wgc, a, b, 2, sw, 0);
          else applyGames(W, Wgp, Wgc, a, b, sw, 2, 0);
        }
        let strict = 0;
        ties.length = 0;
        for (let i = 0; i < cands.length; i++) {
          const p = cands[i]!;
          const v = W[p]!;
          if (v > F) strict++;
          else if (v === F) ties.push(p);
        }
        // Rank under variant A for best/worst bookkeeping.
        let rankRef = strict + ties.length + 1;
        if (strict < topCut) {
          let aheadA = 0;
          for (const p of ties) if (rivalAhead(p, false)) aheadA++;
          rankRef = strict + aheadA + 1;
          if (wantA && rankRef <= topCut) pIn.A += w;
          if (wantB) {
            let aheadB = 0;
            for (const p of ties) if (rivalAhead(p, true)) aheadB++;
            if (strict + aheadB + 1 <= topCut) pIn.B += w;
          }
          if (wantC) {
            const cap = topCut - 1 - strict;
            // dist[j] = P(exactly j tied rivals ahead), truncated beyond cap.
            let dist = new Float64Array(cap + 2);
            dist[0] = 1;
            for (const p of ties) {
              const pa = 1 / (1 + Math.exp(-(focus - p) / COIN_SCALE));
              const next = new Float64Array(cap + 2);
              for (let j = 0; j <= cap + 1; j++) {
                const v = dist[j]!;
                if (v === 0) continue;
                next[Math.min(j + 1, cap + 1)]! += v * pa;
                next[j]! += v * (1 - pa);
              }
              dist = next;
            }
            let s = 0;
            for (let j = 0; j <= cap; j++) s += dist[j]!;
            pIn.C += w * s;
          }
        }
        if (rankRef < best) best = rankRef;
        if (rankRef > worst) worst = rankRef;
        evals++;
        let k = 0;
        while (k < nE) {
          digit[k]!++;
          if (digit[k]! < eK[k]!) break;
          digit[k] = 0;
          k++;
        }
        if (k === nE) break;
      }
    }
    const probs = {} as Record<PastedVariant, number>;
    for (const v of ALL_VARIANTS) {
      const pr = pIn[v] / passes;
      probs[v] = proofIn ? 1 : proofOut ? 0 : Math.min(1 - EDGE, Math.max(EDGE, pr));
    }
    return {
      outcome,
      probs,
      certainty: proofIn ? 'certain' : proofOut ? 'impossible' : 'estimated',
      best: Number.isFinite(best) ? best : 1,
      worst,
    };
  }
}

/** Points-only Monte Carlo for two or more rounds left (documented as rough). */
function earlyRounds(
  f: Field,
  focus: number,
  topCut: number,
  remaining: number,
  per: number,
  rng: () => number,
  path: Outcome[],
): { prob: number; certainty: Scenario['certainty']; best: number; worst: number } {
  const enumFrom = remaining - path.length;
  const idx = Array.from({ length: f.n }, (_, i) => i).filter((p) => f.dropped[p] === 0);
  let F0 = f.pts[focus]!;
  for (const o of path) F0 += o === 'win' ? WIN : o === 'draw' ? DRAW : 0;
  let proofIn = false;
  let proofOut = false;
  if (enumFrom === 0) {
    let possible = 0;
    let above = 0;
    for (const p of idx) {
      if (p === focus) continue;
      if (f.pts[p]! + WIN * remaining >= F0) possible++;
      if (f.pts[p]! > F0) above++;
    }
    proofIn = possible < topCut;
    proofOut = above >= topCut;
  }
  let hit = 0;
  let best = Number.POSITIVE_INFINITY;
  let worst = 0;
  for (let s = 0; s < per; s++) {
    const pts = Int32Array.from(f.pts);
    for (let j = 0; j < remaining; j++) {
      const final = j === remaining - 1;
      const order = idx.slice();
      if (final) order.sort((x, y) => pts[y]! - pts[x]! || x - y);
      else {
        const noise = new Map(order.map((p) => [p, rng()]));
        order.sort((x, y) => pts[y]! - pts[x]! || noise.get(x)! - noise.get(y)!);
      }
      for (let i = 0; i + 1 < order.length; i += 2) {
        const a = order[i]!;
        const b = order[i + 1]!;
        let o: number; // 0 a wins, 1 b wins
        if (a === focus || b === focus) {
          const mine: Outcome = j >= enumFrom ? path[j - enumFrom]! : rng() < 0.5 ? 'win' : 'loss';
          if (mine === 'draw') {
            pts[a]! += DRAW;
            pts[b]! += DRAW;
            continue;
          }
          o = (mine === 'win') === (a === focus) ? 0 : 1;
        } else o = rng() < 0.5 ? 0 : 1;
        pts[o === 0 ? a : b]! += WIN;
      }
      if (order.length % 2 === 1) pts[order[order.length - 1]!]! += WIN;
    }
    const F = pts[focus]!;
    let rank = 1;
    for (const p of idx) {
      if (p === focus) continue;
      if (pts[p]! > F || (pts[p]! === F && rankBefore(f, p, focus))) rank++;
    }
    if (rank <= topCut) hit++;
    best = Math.min(best, rank);
    worst = Math.max(worst, rank);
  }
  const p = hit / per;
  return {
    prob: proofIn ? 1 : proofOut ? 0 : Math.min(1 - EDGE, Math.max(EDGE, p)),
    certainty: proofIn ? 'certain' : proofOut ? 'impossible' : 'estimated',
    best,
    worst,
  };
}

function rankBefore(f: Field, p: number, q: number): boolean {
  const e = f.omw[p]! - f.omw[q]!;
  if (Math.abs(e) > EPS) return e > 0;
  const g = f.gw[p]! - f.gw[q]!;
  if (Math.abs(g) > EPS) return g > 0;
  const o = f.ogw[p]! - f.ogw[q]!;
  if (Math.abs(o) > EPS) return o > 0;
  return p < q;
}

function pairFinal(f: Field, input: PastedStandings): { tables: Table[]; predicted: boolean; unmatched: number } {
  if (input.nextRound && input.nextRound.length > 0) {
    const tables: Table[] = [];
    let unmatched = 0;
    const seen = new Set<number>();
    for (const t of input.nextRound) {
      const a = findIndex(f, t.a);
      const b = t.b === null ? -1 : findIndex(f, t.b);
      if (a < 0 || (t.b !== null && b < 0) || seen.has(a) || (b >= 0 && seen.has(b))) {
        unmatched++;
        continue;
      }
      seen.add(a);
      if (b >= 0) seen.add(b);
      tables.push({ a: Math.min(a, b < 0 ? a : b), b: b < 0 ? -1 : Math.max(a, b) });
    }
    return { tables, predicted: false, unmatched };
  }
  const active: number[] = [];
  for (let p = 0; p < f.n; p++) if (f.dropped[p] === 0) active.push(p);
  const tables: Table[] = [];
  for (let i = 0; i + 1 < active.length; i += 2) tables.push({ a: active[i]!, b: active[i + 1]! });
  if (active.length % 2 === 1) tables.push({ a: active[active.length - 1]!, b: -1 });
  return { tables, predicted: true, unmatched: 0 };
}

/** Every variant's Analysis from one enumeration pass (used by the backtest). */
export function analyzePastedAll(
  input: PastedStandings,
  options: Omit<PastedAnalysisOptions, 'variant'>,
  variants: PastedVariant[] = ALL_VARIANTS,
): Record<PastedVariant, Analysis> {
  const f = buildField(input);
  const focus = findIndex(f, options.playerName);
  if (focus < 0) throw new Error(`Player ${options.playerName} is not in the pasted standings`);
  const topCut = input.topCut ?? options.topCut ?? 8;
  const swissRounds = input.swissRounds ?? options.swissRounds ?? input.roundsPlayed + 1;
  const remaining = Math.max(0, swissRounds - input.roundsPlayed);
  const seed = options.seed ?? 20260101;
  const rng = mulberry32(seed);
  const pw = options.otherTableWinRate ?? 0.5;
  const idRate = options.rivalIdRate ?? 0.5;
  const sims = Math.max(1, Math.floor(options.simulations ?? 5000));

  const rows: StandingRow[] = f.rows.map((r) => ({
    rank: r.rank,
    playerId: r.name,
    name: r.name,
    points: r.points,
    record: r.record,
    games: r.games ?? { wins: 0, losses: 0, draws: 0 },
    omw: floorTo(r.omw),
    gw: floorTo(r.gw),
    ogw: floorTo(r.ogw),
    dropped: r.dropped === true,
  }));
  const current = rows[focus]!;

  const assumptions: string[] = [
    'Pasted standings mode: only the copied table is known, not who played whom, so OMW and OGW cannot be recomputed and are approximated.',
  ];
  if (input.topCut === undefined && options.topCut === undefined) assumptions.push('Top cut size not given; assuming a top 8.');
  if (input.swissRounds === undefined && options.swissRounds === undefined) assumptions.push(`Swiss round count not given; assuming ${swissRounds}, so the next round is the last.`);
  if (!f.gp) assumptions.push('The table has no game record, so your game-win % (and everyone else\'s) is frozen at its pasted value.');

  const out = {} as Record<PastedVariant, Analysis>;
  let nextOpponent: Analysis['nextOpponent'] = null;
  let methodKind: Analysis['method']['kind'] = 'exhaustive';
  let samples = 0;
  const perVariant: Record<PastedVariant, Array<{ outcomes: Outcome[]; prob: number; certainty: Scenario['certainty']; best: number; worst: number }>> = { A: [], B: [], C: [] };

  if (remaining === 0) {
    const inCut = !current.dropped && current.rank <= topCut;
    for (const v of ALL_VARIANTS)
      perVariant[v].push({ outcomes: [], prob: inCut ? 1 : 0, certainty: inCut ? 'certain' : 'impossible', best: current.rank, worst: current.rank });
    assumptions.push('All Swiss rounds are finished; these are the final standings.');
  } else if (f.dropped[focus] === 1) {
    const enumRounds = Math.min(remaining, 2);
    const paths = enumPaths(enumRounds);
    for (const v of ALL_VARIANTS)
      for (const o of paths) perVariant[v].push({ outcomes: o, prob: 0, certainty: 'impossible', best: current.rank, worst: current.rank });
    assumptions.push('This player has dropped, so they cannot make the cut.');
  } else if (remaining === 1) {
    const { tables, predicted, unmatched } = pairFinal(f, input);
    const fin = new FinalRound(f, focus, topCut, input.roundsPlayed, pw, idRate, rng, tables, predicted);
    for (const o of OUTCOMES) {
      const r = fin.runPath(o, variants);
      for (const v of ALL_VARIANTS) perVariant[v].push({ outcomes: [o], prob: r.probs[v], certainty: r.certainty, best: r.best, worst: r.worst });
    }
    samples = 3 * 64;
    if (fin.focusOpp >= 0) nextOpponent = { playerId: f.names[fin.focusOpp]!, name: f.names[fin.focusOpp]!, predicted };
    assumptions.push(
      predicted
        ? 'Final-round pairings predicted from the standings (CEG 10.4): 1 v 2, 3 v 4, and so on. Rematch avoidance is impossible without match history, so a real pairing may differ.'
        : 'Final-round pairings as posted.',
    );
    if (unmatched > 0) assumptions.push(`${unmatched} posted table(s) could not be matched to names in the standings and were ignored.`);
    if (fin.unplaced > 0 && !predicted) assumptions.push(`${fin.unplaced} active player(s) are not in the posted pairings; their results are unknown and treated as unchanged.`);
    assumptions.push(
      pw === 0.5 ? 'Other tables: 50/50 win/loss, wins 2-0 or 2-1 equally often.' : `Other tables: the higher-ranked player wins ${Math.round(pw * 100)}% of the time.`,
      idRate > 0 ? `Tables where both players could ID inside the cut: ${Math.round(idRate * 100)}% chance of an ID (0-0-3).` : 'Other tables never end in an intentional draw (ID).',
      `Tables that can change the cut are enumerated exhaustively (up to ${MAX_ENUM_TABLES}); the rest are sampled.`,
      'Your own result is modeled as a 2-0 win, a 0-2 loss or a 0-0-3 intentional draw.',
      'Players level on points after the round are ordered with approximate tiebreakers (OMW, OGW as copied; they cannot be recomputed). Exactly where you finish among players on your points is therefore uncertain, and Safe/Locked claims can only be proven from points.',
      'Because tiebreakers are approximate, an estimated intentional draw (ID) needs 95% (not 90%) to count as ID SAFE; 90-95% shows as BUBBLE.',
    );
  } else {
    methodKind = 'monte-carlo';
    const enumRounds = Math.min(remaining, 2);
    const per = Math.max(300, Math.floor(sims / Math.pow(3, enumRounds)));
    for (const o of enumPaths(enumRounds)) {
      const r = earlyRounds(f, focus, topCut, remaining, per, rng, o);
      for (const v of ALL_VARIANTS) perVariant[v].push({ outcomes: o, prob: r.prob, certainty: r.certainty, best: r.best, worst: r.worst });
      samples += per;
    }
    assumptions.push(
      `${remaining} rounds remain, which needs full match data (opponents played, who can still be paired). These odds are a rough points-only estimate: ${per.toLocaleString('en-US')} simulations per path, random pairings within points, 50/50 results, tiebreakers frozen as copied, no rematch avoidance and no intentional draws. Paste the standings again before the final round.`,
    );
  }

  for (const v of ALL_VARIANTS) {
    const scenarios: Scenario[] = perVariant[v].map((r) => {
      const rec = { ...current.record };
      let pts = current.points;
      for (const o of r.outcomes) {
        if (o === 'win') rec.wins++;
        else if (o === 'draw') rec.draws++;
        else rec.losses++;
        pts += o === 'win' ? WIN : o === 'draw' ? DRAW : 0;
      }
      return {
        outcomes: r.outcomes,
        finalRecord: rec,
        finalPoints: pts,
        probability: r.prob,
        certainty: r.certainty,
        status: scenarioStatus({ outcomes: r.outcomes, probability: r.prob, certainty: r.certainty }, PASTED_ID_SAFE_THRESHOLD),
        bestRank: r.best,
        worstRank: r.worst,
      };
    });
    const verdict = buildVerdict(scenarios, remaining, topCut, current, methodKind, samples, f.dropped[focus] === 1, PASTED_ID_SAFE_THRESHOLD);
    out[v] = {
      dataMode: 'pasted',
      tournamentId: 'pasted',
      playerId: f.names[focus]!,
      current,
      currentStandings: rows,
      topCut,
      swissRounds,
      roundsRemaining: remaining,
      nextOpponent,
      scenarios,
      verdict,
      assumptions: [...assumptions, variantNote(v)],
      method: { kind: methodKind, samples, seed },
    };
  }
  return out;
}

function variantNote(v: PastedVariant): string {
  if (v === 'A') return 'Tiebreak model A: OMW/OGW frozen as copied; game-win % updated from simulated games when the table has a game record.';
  if (v === 'B') return 'Tiebreak model B: like A, plus an estimate of how the final round moves OMW/OGW.';
  return 'Tiebreak model C: players level on points are ordered by current standing with a coin-flip margin, so verdicts that depend on a tiebreaker are less confident.';
}

function enumPaths(rounds: number): Outcome[][] {
  let acc: Outcome[][] = [[]];
  for (let i = 0; i < rounds; i++) acc = acc.flatMap((p) => OUTCOMES.map((o) => [...p, o]));
  return acc;
}

export function analyzePasted(input: PastedStandings, options: PastedAnalysisOptions): Analysis {
  const v = options.variant ?? DEFAULT_PASTED_VARIANT;
  return analyzePastedAll(input, options, [v])[v];
}
