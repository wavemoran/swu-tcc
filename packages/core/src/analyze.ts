import type { Analysis, AnalysisOptions, Outcome, Scenario, Status, StandingRow, Tournament, Match } from './contract.ts';
import { buildModel, copyLite, newLite, type Lite, type Model } from './ledger.ts';
import { pairByStandings, pairRandom, type PairCtx } from './pairing.ts';
import { mulberry32 } from './rng.ts';
import { A_WIN, B_WIN, ID, IdSafety, liteBye, liteOutcome, liteResult, liteUndo, rankOf } from './sim.ts';
import { rowsFromModel, sortedOrder } from './standings.ts';
import { isSingleDayEvent, MAX_SINGLE_DAY_PLAYERS } from './structure.ts';

/** Status thresholds (documented in the verdict summary). */
export const ID_SAFE_THRESHOLD = 0.9;
/**
 * Paste mode approximates tiebreakers, so an ESTIMATED draw needs 95% to count
 * as ID SAFE (90-95% shows as BUBBLE). Every wrong ID SAFE in the paste-mode
 * backtest was between 92% and 94%; all 45 at 95% or more were right
 * (docs/research/backtest-pasted.md). Proven results are unaffected.
 */
export const PASTED_ID_SAFE_THRESHOLD = 0.95;
export const WIN_AND_IN_THRESHOLD = 0.9;
export const OUT_THRESHOLD = 0.1;

/**
 * The one place the status threshold rule lives. Status of a single scenario:
 * proven in is LOCKED, proven out is OUT, otherwise by probability (a scenario
 * that includes a draw and clears the bar is ID SAFE, any other is WIN & IN).
 */
export function scenarioStatus(
  s: Pick<Scenario, 'outcomes' | 'probability' | 'certainty'>,
  idSafeThreshold: number = ID_SAFE_THRESHOLD,
): Status {
  if (s.certainty === 'certain') return 'locked';
  if (s.certainty === 'impossible') return 'out';
  if (s.outcomes.includes('draw')) {
    if (s.probability >= idSafeThreshold) return 'id-safe';
  } else if (s.probability >= WIN_AND_IN_THRESHOLD) {
    return 'win-and-in';
  }
  if (s.probability >= OUT_THRESHOLD) return 'bubble';
  return 'out';
}

/** Exhaustive enumeration limits for the final round. */
const MAX_ENUM_TABLES = 10;
const MAX_LEAVES = 59049; // 3^10
const RESAMPLE_EVERY = 256;
const MIN_EVALS = 64;
/** Never report an unproven probability as exactly 0 or 1. */
const EDGE = 0.001;

interface PathResult {
  outcomes: Outcome[];
  prob: number;
  certainty: Scenario['certainty'];
  best: number;
  worst: number;
  evals: number;
}

function clampEstimate(p: number): number {
  return Math.min(1 - EDGE, Math.max(EDGE, p));
}

function outcomeOf(r: Match['result'], focusIsA: boolean): Outcome | null {
  if (r === null) return null;
  if (r.kind === 'bye') return 'win';
  if (r.kind === 'forfeit') return 'loss';
  const mine = focusIsA ? r.aWins : r.bWins;
  const theirs = focusIsA ? r.bWins : r.aWins;
  return mine > theirs ? 'win' : mine < theirs ? 'loss' : 'draw';
}

export function pointsOf(o: Outcome, m: Model): number {
  return o === 'win' ? m.win : o === 'draw' ? m.draw : m.loss;
}

export function pctText(p: number, certain: boolean): string {
  const v = Math.round(p * 100);
  if (certain) return p >= 1 ? '100%' : '0%';
  if (v >= 100) return 'over 99%';
  if (v <= 0) return 'under 1%';
  return `${v}%`;
}

function* paths(options: Array<Outcome[]>): Generator<Outcome[]> {
  const idx = options.map(() => 0);
  for (;;) {
    yield idx.map((i, k) => options[k]![i]!);
    let k = options.length - 1;
    while (k >= 0) {
      idx[k]!++;
      if (idx[k]! < options[k]!.length) break;
      idx[k] = 0;
      k--;
    }
    if (k < 0) return;
  }
}

const ALL: Outcome[] = ['win', 'draw', 'loss'];

export function analyze(t: Tournament, options: AnalysisOptions): Analysis {
  const topCut = options.topCut ?? t.topCut;
  const swissRounds = options.swissRounds ?? t.swissRounds;
  const sims = Math.max(1, Math.floor(options.simulations ?? 5000));
  const seed = options.seed ?? 20260101;
  const rng = mulberry32(seed);
  const pw = options.otherTableWinRate ?? 0.5;
  const idRate = options.rivalIdRate ?? 0.5;

  // --- where are we? -------------------------------------------------------
  let done = 0;
  for (const r of [...t.rounds].sort((x, y) => x.number - y.number)) {
    if (r.number !== done + 1) break;
    if (r.matches.length === 0 || r.matches.some((x) => x.result === null)) break;
    done = r.number;
  }
  done = Math.min(done, swissRounds);
  const remaining = Math.max(0, swissRounds - done);
  const m = buildModel(t, done);
  const focus = m.index.get(options.playerId);
  if (focus === undefined) throw new Error(`Player ${options.playerId} is not in this tournament`);
  const base = m.base;
  const currentStandings = rowsFromModel(m, base);
  const current = currentStandings.find((r) => r.playerId === options.playerId)!;
  const posted = remaining > 0 ? t.rounds.find((r) => r.number === done + 1 && r.matches.length > 0) : undefined;

  // --- the focus player's known result in the posted round ------------------
  let focusForced: Outcome | null = null;
  let focusOpp = -1;
  if (posted) {
    for (const mt of posted.matches) {
      const a = m.index.get(mt.a);
      if (a === undefined) continue;
      const b = mt.b === null ? -1 : (m.index.get(mt.b) ?? -1);
      if (a === focus) {
        focusOpp = b;
        focusForced = mt.b === null ? (mt.result === null ? 'win' : outcomeOf(mt.result, true)) : outcomeOf(mt.result, true);
      } else if (b === focus) {
        focusOpp = a;
        focusForced = outcomeOf(mt.result, false);
      }
    }
  }

  const assumptions: string[] = [];
  const enumRounds = Math.min(remaining, 2);
  const roundOptions: Array<Outcome[]> = [];
  for (let k = 0; k < enumRounds; k++) {
    const roundIdx = remaining - enumRounds + k; // 0-based within remaining rounds
    roundOptions.push(roundIdx === 0 && focusForced ? [focusForced] : ALL);
  }

  // --- trivial cases ----------------------------------------------------------
  const results: PathResult[] = [];
  let nextOpponent: Analysis['nextOpponent'] = null;
  let methodKind: Analysis['method']['kind'] = 'exhaustive';
  let samples = 0;

  if (remaining === 0) {
    const order = sortedOrder(m, base, undefined, activeOf(m));
    const rank = m.dropped[focus] === 1 ? Number.POSITIVE_INFINITY : order.indexOf(focus) + 1;
    const inCut = rank <= topCut;
    results.push({
      outcomes: [],
      prob: inCut ? 1 : 0,
      certainty: inCut ? 'certain' : 'impossible',
      best: rank,
      worst: rank,
      evals: 1,
    });
    assumptions.push('All Swiss rounds are finished; these are the final standings.');
  } else if (m.dropped[focus] === 1) {
    for (const o of paths(roundOptions)) {
      results.push({ outcomes: o, prob: 0, certainty: 'impossible', best: current.rank, worst: current.rank, evals: 1 });
    }
    assumptions.push('This player has dropped, so they cannot make the cut.');
  } else if (remaining === 1) {
    const fin = new FinalRound(m, focus, topCut, pw, idRate, rng, posted?.matches ?? null, focusForced);
    for (const o of paths(roundOptions)) results.push(fin.runPath(o[0]!));
    samples = results.reduce((s, r) => s + r.evals, 0);
    nextOpponent = fin.opponentInfo();
    assumptions.push(...fin.assumptions());
  } else {
    methodKind = 'monte-carlo';
    const per = Math.max(300, Math.floor(sims / Math.pow(3, enumRounds)));
    const mc = new MonteCarlo(m, topCut, pw, idRate, rng, posted?.matches ?? null, remaining, focus, focusForced);
    for (const o of paths(roundOptions)) results.push(mc.runPath(o, per));
    samples = per * results.length;
    if (posted && focusOpp >= 0) nextOpponent = { playerId: m.ids[focusOpp]!, name: m.names[focusOpp]!, predicted: false };
    assumptions.push(...mc.assumptions(per));
  }

  // --- scenarios ----------------------------------------------------------------
  const focusRow = current;
  const scenarios: Scenario[] = results.map((r) => {
    const rec = { ...focusRow.record };
    let pts = focusRow.points;
    for (const o of r.outcomes) {
      if (o === 'win') rec.wins++;
      else if (o === 'draw') rec.draws++;
      else rec.losses++;
      pts += pointsOf(o, m);
    }
    return {
      outcomes: r.outcomes,
      finalRecord: rec,
      finalPoints: pts,
      probability: r.prob,
      certainty: r.certainty,
      status: scenarioStatus({ outcomes: r.outcomes, probability: r.prob, certainty: r.certainty }),
      bestRank: r.best,
      worstRank: r.worst,
    };
  });

  const verdict = buildVerdict(scenarios, remaining, topCut, current, methodKind, samples, m.dropped[focus] === 1);

  if (m.dropped[focus] !== 1 && remaining > 0) {
    assumptions.push(
      remaining > 2
        ? `${remaining} rounds remain; scenarios cover only the last two, earlier results are simulated as 50/50 wins and losses.`
        : 'Your own match results are modeled as 2-0 wins, 0-2 losses and 0-0-3 intentional draws.',
    );
  }
  if (!isSingleDayEvent(t.playerCount)) {
    assumptions.unshift(
      `Not modeled: events over ${MAX_SINGLE_DAY_PLAYERS} players run a Day 2, which usually qualifies by points (for example, 6 match wins), not by a top-${topCut} cut. Treat these numbers as a rough guide only.`,
    );
  }
  if (current.dropped === false && t.rounds.length > 0) assumptions.push('Dropped players are never paired again and cannot make the cut.');

  return {
    dataMode: 'full',
    tournamentId: t.id,
    playerId: options.playerId,
    current,
    currentStandings,
    topCut,
    swissRounds,
    roundsRemaining: remaining,
    nextOpponent,
    scenarios,
    verdict,
    assumptions,
    method: { kind: methodKind, samples, seed },
  };
}

function activeOf(m: Model): number[] {
  const out: number[] = [];
  for (let i = 0; i < m.n; i++) if (m.dropped[i] === 0) out.push(i);
  return out;
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

function findPath(sc: Scenario[], pred: (o: Outcome[]) => boolean): Scenario | undefined {
  return sc.find((s) => pred(s.outcomes));
}

export function buildVerdict(
  sc: Scenario[],
  remaining: number,
  topCut: number,
  current: StandingRow,
  method: Analysis['method']['kind'],
  samples: number,
  dropped: boolean,
  idSafeThreshold: number = ID_SAFE_THRESHOLD,
): Analysis['verdict'] {
  const cut = `top ${topCut}`;
  if (dropped) {
    return {
      status: 'out',
      probability: 0,
      certainty: 'impossible',
      basis: 'loss',
      summary: `You've dropped, so you can't make ${cut}.`,
    };
  }
  if (remaining === 0) {
    const s = sc[0]!;
    const inCut = s.probability === 1;
    return {
      status: inCut ? 'locked' : 'out',
      probability: s.probability,
      certainty: s.certainty,
      basis: 'win',
      summary: inCut
        ? `Swiss is over and you finished ${ordinal(current.rank)}, inside ${cut}.`
        : `Swiss is over and you finished ${ordinal(current.rank)}, outside ${cut}.`,
    };
  }
  const last = (o: Outcome[]) => o[o.length - 1];
  const win = findPath(sc, (o) => o.every((x) => x === 'win')) ?? sc[0]!;
  const worst = findPath(sc, (o) => o.every((x) => x === 'loss')) ?? sc[sc.length - 1]!;
  const idPath = findPath(sc, (o) => last(o) === 'draw' && o.slice(0, -1).every((x) => x === 'win'));
  const how = method === 'exhaustive' ? 'modeled outcomes' : `${samples.toLocaleString('en-US')} simulated finishes`;
  const finalRoundPhrase = remaining === 1 ? 'your last round' : 'your last two rounds';

  let status: Status;
  let head: Scenario;
  let basis: Analysis['verdict']['basis'];
  if (worst.certainty === 'certain') {
    status = 'locked';
    head = worst;
    basis = 'loss';
  } else if (idPath && idPath.probability >= idSafeThreshold) {
    status = 'id-safe';
    head = idPath;
    basis = 'draw';
  } else if (win.probability >= WIN_AND_IN_THRESHOLD) {
    status = 'win-and-in';
    head = win;
    basis = 'win';
  } else if (win.probability >= OUT_THRESHOLD) {
    status = 'bubble';
    head = win;
    basis = 'win';
  } else {
    status = 'out';
    head = win;
    basis = 'win';
  }
  const isCertain = head.certainty !== 'estimated';
  const p = pctText(head.probability, isCertain);
  let summary: string;
  switch (status) {
    case 'locked':
      summary = `You're LOCKED: even losing ${finalRoundPhrase} leaves you inside ${cut}, whatever the other tables do.`;
      break;
    case 'id-safe':
      summary = `You're ID SAFE: an intentional draw (ID) puts you at ${idPath!.finalPoints} match points, which made ${cut} in ${p} of ${how}.`;
      break;
    case 'win-and-in':
      summary = `WIN & IN: winning ${finalRoundPhrase} puts you at ${win.finalPoints} match points and made ${cut} in ${p} of ${how}. An intentional draw (ID) is not safe: it made ${cut} in ${pctText(idPath?.probability ?? 0, idPath?.certainty !== 'estimated')}.`;
      break;
    case 'bubble':
      summary = `You're on the BUBBLE: winning ${finalRoundPhrase} puts you at ${win.finalPoints} match points and made ${cut} in ${p} of ${how}. An intentional draw (ID) is a gamble${idPath ? ` at ${pctText(idPath.probability, idPath.certainty !== 'estimated')}` : ''}.`;
      break;
    default:
      summary = `You're OUT unless something unusual happens: even a win makes ${cut} in only ${p} of ${how}.`;
  }
  return { status, probability: head.probability, certainty: head.certainty, basis, summary };
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}

// ---------------------------------------------------------------------------
// Final round: exhaustive over relevant tables
// ---------------------------------------------------------------------------

interface Table {
  a: number; // higher ranked
  b: number;
}

class FinalRound {
  private L1: Lite;
  private oppFinal: Int32Array;
  private pending: Table[] = [];
  private focusOpp = -1;
  private focusBye = false;
  private predicted: boolean;
  private rankPos: Int32Array;
  private m: Model;
  private focus: number;
  private topCut: number;
  private pw: number;
  private idRate: number;
  private rng: () => number;
  private focusForced: Outcome | null;

  constructor(
    m: Model,
    focus: number,
    topCut: number,
    pw: number,
    idRate: number,
    rng: () => number,
    postedMatches: Match[] | null,
    focusForced: Outcome | null,
  ) {
    this.m = m;
    this.focus = focus;
    this.topCut = topCut;
    this.pw = pw;
    this.idRate = idRate;
    this.rng = rng;
    this.focusForced = focusForced;
    const n = m.n;
    this.oppFinal = new Int32Array(n).fill(-1);
    this.L1 = newLite(n);
    copyLite(this.L1, m.base);
    const order = sortedOrder(m, m.base);
    this.rankPos = new Int32Array(n);
    order.forEach((p, i) => (this.rankPos[p] = i));
    this.predicted = postedMatches === null;
    const fixedTable = (a: number, b: number, mt: Match | null) => {
      void mt;
      if (a === this.focus) this.focusOpp = b;
      else if (b === this.focus) this.focusOpp = a;
    };
    if (postedMatches) {
      for (const mt of postedMatches) {
        const a = m.index.get(mt.a);
        if (a === undefined) continue;
        const b = mt.b === null ? -1 : (m.index.get(mt.b) ?? -1);
        fixedTable(a, b, mt);
        if (b < 0) {
          if (a === this.focus) this.focusBye = mt.result !== null && mt.result.kind !== 'forfeit' ? true : mt.result === null;
          if (mt.result === null) liteBye(m, this.L1, a);
          else liteResult(m, this.L1, a, -1, mt.result);
        } else if (mt.result !== null) {
          liteResult(m, this.L1, a, b, mt.result);
          if (mt.result.kind === 'games') {
            this.oppFinal[a] = b;
            this.oppFinal[b] = a;
          }
        } else {
          this.oppFinal[a] = b;
          this.oppFinal[b] = a;
          if (a !== this.focus && b !== this.focus) {
            const hi = this.rankPos[a]! < this.rankPos[b]! ? [a, b] : [b, a];
            this.pending.push({ a: hi[0]!, b: hi[1]! });
          }
        }
      }
    } else {
      const ctx: PairCtx = { m, l: m.base, extra: [], hadBye: m.hadBye };
      const out = new Int32Array(n);
      const bye = pairByStandings(ctx, activeOf(m), out);
      const seen = new Uint8Array(n);
      for (const p of order) {
        if (m.dropped[p] === 1 || seen[p] || p === bye) continue;
        const q = out[p]!;
        seen[p] = seen[q] = 1;
        this.oppFinal[p] = q;
        this.oppFinal[q] = p;
        fixedTable(p, q, null);
        if (p !== this.focus && q !== this.focus) this.pending.push({ a: p, b: q });
      }
      if (bye >= 0) {
        liteBye(m, this.L1, bye);
        if (bye === this.focus) this.focusBye = true;
      }
    }
  }

  opponentInfo(): Analysis['nextOpponent'] {
    if (this.focusOpp < 0) return null;
    return { playerId: this.m.ids[this.focusOpp]!, name: this.m.names[this.focusOpp]!, predicted: this.predicted };
  }

  assumptions(): string[] {
    const out: string[] = [];
    out.push(
      this.predicted
        ? 'Final-round pairings predicted from standings (CEG 10.4): 1 v 2, 3 v 4, and so on, skipping rematches.'
        : 'Final-round pairings as posted.',
    );
    out.push(
      this.pw === 0.5
        ? 'Other tables: 50/50 win/loss, wins 2-0 or 2-1 equally often.'
        : `Other tables: the higher-ranked player wins ${Math.round(this.pw * 100)}% of the time.`,
    );
    out.push(
      this.idRate > 0
        ? `Tables where both players could ID inside the cut: ${Math.round(this.idRate * 100)}% chance of an ID (0-0-3).`
        : 'Other tables never end in an intentional draw (ID).',
    );
    out.push(`Tables that can change the cut are enumerated exhaustively (up to ${MAX_ENUM_TABLES}); the rest are sampled.`);
    return out;
  }

  runPath(outcome: Outcome): PathResult {
    const { m, focus, topCut } = this;
    const W = newLite(m.n);
    copyLite(W, this.L1);
    let pathOutcome: Outcome = outcome;
    if (this.focusForced) pathOutcome = this.focusForced;
    if (this.focusBye) pathOutcome = 'win';
    const hasFocusTable = this.focusOpp >= 0 && !this.focusBye && !this.focusForced;
    if (hasFocusTable) {
      const o = pathOutcome === 'win' ? A_WIN : pathOutcome === 'loss' ? B_WIN : ID;
      liteOutcome(m, W, focus, this.focusOpp, o, true);
    }
    const F = W.mp[focus]!;

    // Tables, partners, and ID safety.
    const partner = new Int32Array(m.n).fill(-1);
    for (const tb of this.pending) {
      partner[tb.a] = tb.b;
      partner[tb.b] = tb.a;
    }
    const safety = new IdSafety(m, W, partner, topCut);

    // Relevance: could either player end at or above the focus's points?
    const rel: number[] = [];
    const rest: number[] = [];
    this.pending.forEach((tb, i) => {
      if (m.dropped[tb.a] === 1 && m.dropped[tb.b] === 1) rest.push(i);
      else if (W.mp[tb.a]! + m.win >= F || W.mp[tb.b]! + m.win >= F) rel.push(i);
      else rest.push(i);
    });
    rel.sort((x, y) => {
      const tx = this.pending[x]!;
      const ty = this.pending[y]!;
      return Math.max(W.mp[ty.a]!, W.mp[ty.b]!) - Math.max(W.mp[tx.a]!, W.mp[tx.b]!);
    });
    const idOk = this.pending.map((tb) => this.idRate > 0 && safety.safe(tb.a, tb.b));
    const enumIdx: number[] = [];
    let leaves = 1;
    for (const i of rel) {
      const k = idOk[i] ? 3 : 2;
      if (enumIdx.length >= MAX_ENUM_TABLES || leaves * k > MAX_LEAVES) {
        rest.push(i);
        continue;
      }
      enumIdx.push(i);
      leaves *= k;
    }
    const nE = enumIdx.length;
    const eA = enumIdx.map((i) => this.pending[i]!.a);
    const eB = enumIdx.map((i) => this.pending[i]!.b);
    const eK = enumIdx.map((i) => (idOk[i] ? 3 : 2));
    const eP = enumIdx.map((i) => {
      const p = this.pending[i]!;
      void p;
      return idOk[i]
        ? [(1 - this.idRate) * this.pw, (1 - this.idRate) * (1 - this.pw), this.idRate]
        : [this.pw, 1 - this.pw];
    });

    // Certainty by points alone (sound; independent of tiebreakers and sampling).
    const { possible, above } = this.bounds(W, F);
    const proofIn = possible < topCut;
    const proofOut = above >= topCut;

    const snapshot = newLite(m.n);
    copyLite(snapshot, W);
    const extra = [this.oppFinal];
    const passes = Math.max(1, Math.ceil(MIN_EVALS / leaves));
    const digit = new Int32Array(nE);
    const shortWin = new Uint8Array(nE);
    const applied = new Int32Array(nE).fill(-1);
    let cands: number[] = [];
    let pIn = 0;
    let best = Number.POSITIVE_INFINITY;
    let worst = 0;
    let evals = 0;

    const sampleRest = () => {
      copyLite(W, snapshot);
      for (const i of rest) {
        const tb = this.pending[i]!;
        const r = this.rng();
        let o: number;
        if (idOk[i] && r < this.idRate) o = ID;
        else o = this.rng() < this.pw ? A_WIN : B_WIN;
        liteOutcome(m, W, tb.a, tb.b, o, this.rng() < 0.5);
      }
      // Players who could still be at or above F.
      cands = [];
      const inEnum = new Uint8Array(m.n);
      for (let k = 0; k < nE; k++) inEnum[eA[k]!] = inEnum[eB[k]!] = 1;
      for (let p = 0; p < m.n; p++) {
        if (p === focus || m.dropped[p] === 1) continue;
        if (W.mp[p]! + (inEnum[p] ? m.win : 0) >= F) cands.push(p);
      }
    };

    for (let pass = 0; pass < passes; pass++) {
      let sinceSample = RESAMPLE_EVERY;
      digit.fill(0);
      applied.fill(-1);
      for (let leaf = 0; leaf < leaves; leaf++) {
        if (sinceSample >= RESAMPLE_EVERY || (leaf === 0 && pass > 0)) {
          // Undo enumerated tables before touching the base copy.
          for (let k = 0; k < nE; k++) applied[k] = -1;
          sampleRest();
          sinceSample = 0;
        }
        sinceSample++;
        let w = 1;
        for (let k = 0; k < nE; k++) {
          const d = digit[k]!;
          w *= eP[k]![d]!;
          if (applied[k] !== d) {
            if (applied[k]! >= 0) liteUndo(m, W, eA[k]!, eB[k]!, applied[k]!, shortWin[k] === 1);
            shortWin[k] = this.rng() < 0.5 ? 1 : 0;
            liteOutcome(m, W, eA[k]!, eB[k]!, d, shortWin[k] === 1);
            applied[k] = d;
          }
        }
        const rank = rankOf(m, W, extra, focus, cands, topCut);
        if (rank <= topCut) pIn += w;
        if (rank < best) best = rank;
        if (rank > worst) worst = rank;
        evals++;
        // Advance the odometer.
        let k = 0;
        while (k < nE) {
          digit[k]!++;
          if (digit[k]! < eK[k]!) break;
          digit[k] = 0;
          k++;
        }
        // On wrap-around of the whole counter, resample at the next pass.
        if (k === nE) break;
      }
      // Leave W clean for the next pass.
      for (let k = 0; k < nE; k++) {
        if (applied[k]! >= 0) liteUndo(m, W, eA[k]!, eB[k]!, applied[k]!, shortWin[k] === 1);
        applied[k] = -1;
      }
    }
    const prob = pIn / passes;
    const outcomes: Outcome[] = [outcome];
    if (proofIn) return { outcomes, prob: 1, certainty: 'certain', best, worst, evals };
    if (proofOut) return { outcomes, prob: 0, certainty: 'impossible', best, worst, evals };
    return { outcomes, prob: clampEstimate(prob), certainty: 'estimated', best, worst, evals };
  }

  /**
   * Bounds on the final field from points alone. `possible` counts other
   * players who could finish at or above F; `above` counts those certain to
   * finish strictly above. With posted pairings each table is considered as a
   * unit; with predicted ones every unplayed player is independent.
   */
  private bounds(W: Lite, F: number): { possible: number; above: number } {
    const { m, pending, predicted } = this;
    const inPending = new Uint8Array(m.n);
    let possible = 0;
    let above = 0;
    if (!predicted) {
      for (const tb of pending) {
        inPending[tb.a] = inPending[tb.b] = 1;
        const da = m.dropped[tb.a] === 1 ? 0 : 1;
        const db = m.dropped[tb.b] === 1 ? 0 : 1;
        const pa = W.mp[tb.a]!;
        const pb = W.mp[tb.b]!;
        const ge = (x: number) => (x >= F ? 1 : 0);
        const gt = (x: number) => (x > F ? 1 : 0);
        const outs: Array<[number, number]> = [
          [pa + m.win, pb + m.loss],
          [pa + m.loss, pb + m.win],
          [pa + m.draw, pb + m.draw],
        ];
        possible += Math.max(...outs.map(([x, y]) => da * ge(x) + db * ge(y)));
        above += Math.min(...outs.map(([x, y]) => da * gt(x) + db * gt(y)));
      }
    } else {
      for (const tb of pending) inPending[tb.a] = inPending[tb.b] = 1;
      for (let p = 0; p < m.n; p++) {
        if (!inPending[p] || p === this.focus || m.dropped[p] === 1) continue;
        if (W.mp[p]! + m.win >= F) possible++;
        if (W.mp[p]! + m.loss > F) above++;
      }
    }
    for (let p = 0; p < m.n; p++) {
      if (inPending[p] || p === this.focus || m.dropped[p] === 1) continue;
      if (W.mp[p]! >= F) possible++;
      if (W.mp[p]! > F) above++;
    }
    return { possible, above };
  }
}

// ---------------------------------------------------------------------------
// Two or more rounds left: Monte Carlo
// ---------------------------------------------------------------------------

class MonteCarlo {
  private base: Lite;
  private W: Lite;
  private extra: Int32Array[];
  private hadBye: Uint8Array;
  private active: number[];
  private all: number[];
  private pairsBuf: Array<[number, number]> = [];
  private m: Model;
  private topCut: number;
  private pw: number;
  private idRate: number;
  private rng: () => number;
  private posted: Match[] | null;
  private remaining: number;
  private focus: number;
  private focusForced: Outcome | null;

  constructor(
    m: Model,
    topCut: number,
    pw: number,
    idRate: number,
    rng: () => number,
    posted: Match[] | null,
    remaining: number,
    focus: number,
    focusForced: Outcome | null,
  ) {
    this.m = m;
    this.topCut = topCut;
    this.pw = pw;
    this.idRate = idRate;
    this.rng = rng;
    this.posted = posted;
    this.remaining = remaining;
    this.focus = focus;
    this.focusForced = focusForced;
    this.base = m.base;
    this.W = newLite(m.n);
    this.extra = Array.from({ length: remaining }, () => new Int32Array(m.n));
    this.hadBye = new Uint8Array(m.n);
    this.active = activeOf(m);
    this.all = Array.from({ length: m.n }, (_, i) => i);
  }

  assumptions(per: number): string[] {
    return [
      `${(per * 3 ** Math.min(this.remaining, 2)).toLocaleString('en-US')} simulations in total (${per.toLocaleString('en-US')} per path).`,
      this.posted
        ? 'This round uses the posted pairings; later rounds are random within point groups.'
        : 'Pairings are random within point groups until the final round, which is predicted from standings (CEG 10.4).',
      this.pw === 0.5
        ? 'Other tables: 50/50 win/loss, wins 2-0 or 2-1 equally often.'
        : `Other tables: the higher-ranked player wins ${Math.round(this.pw * 100)}% of the time.`,
      'Intentional draws (IDs) are only simulated in the final round, between players who could both ID inside the cut.',
    ];
  }

  runPath(path: Outcome[], n: number): PathResult {
    const { m, remaining, topCut, focus } = this;
    const base = this.base;
    const enumFrom = remaining - path.length;
    // Points the focus has after the enumerated rounds, when the earlier ones are known.
    let proofIn = false;
    let proofOut = false;
    if (enumFrom === 0) {
      let F = base.mp[focus]!;
      for (const o of path) F += pointsOf(o, m);
      let possible = 0;
      let above = 0;
      for (let p = 0; p < m.n; p++) {
        if (p === focus || m.dropped[p] === 1) continue;
        if (base.mp[p]! + m.win * remaining >= F) possible++;
        if (base.mp[p]! > F) above++;
      }
      proofIn = possible < topCut;
      proofOut = above >= topCut;
    }
    let inCut = 0;
    let best = Number.POSITIVE_INFINITY;
    let worst = 0;
    for (let s = 0; s < n; s++) {
      const rank = this.simulate(path, enumFrom);
      if (rank <= topCut) inCut++;
      if (rank < best) best = rank;
      if (rank > worst) worst = rank;
    }
    const prob = inCut / n;
    if (proofIn) return { outcomes: path, prob: 1, certainty: 'certain', best, worst, evals: n };
    if (proofOut) return { outcomes: path, prob: 0, certainty: 'impossible', best, worst, evals: n };
    return { outcomes: path, prob: clampEstimate(prob), certainty: 'estimated', best, worst, evals: n };
  }

  private simulate(path: Outcome[], enumFrom: number): number {
    const { m, W, rng, remaining, focus } = this;
    copyLite(W, this.base);
    this.hadBye.set(m.hadBye);
    for (let j = 0; j < remaining; j++) {
      const opp = this.extra[j]!;
      opp.fill(-1);
      const final = j === remaining - 1;
      const forced: Outcome | null = j >= enumFrom ? path[j - enumFrom]! : null;
      const pairs = this.pairsBuf;
      pairs.length = 0;
      let bye = -1;
      const fixed: Array<{ a: number; b: number; r: Match['result'] }> = [];
      if (j === 0 && this.posted) {
        for (const mt of this.posted) {
          const a = m.index.get(mt.a);
          if (a === undefined) continue;
          const b = mt.b === null ? -1 : (m.index.get(mt.b) ?? -1);
          if (b < 0) {
            bye = a;
            this.hadBye[a] = 1;
            if (mt.result === null || mt.result.kind === 'bye') liteBye(m, W, a);
            else liteResult(m, W, a, -1, mt.result);
          } else if (mt.result !== null) {
            fixed.push({ a, b, r: mt.result });
            opp[a] = b;
            opp[b] = a;
          } else {
            pairs.push([a, b]);
            opp[a] = b;
            opp[b] = a;
          }
        }
        for (const f of fixed) liteResult(m, W, f.a, f.b, f.r!);
      } else {
        const ctx: PairCtx = { m, l: W, extra: this.extra.slice(0, j), hadBye: this.hadBye };
        const tmp = new Int32Array(m.n);
        bye = final ? pairByStandings(ctx, this.active, tmp) : pairRandom(ctx, this.active, rng, tmp);
        for (let p = 0; p < m.n; p++) {
          const q = tmp[p]!;
          if (q > p) pairs.push([p, q]);
          if (q >= 0) opp[p] = q;
        }
        if (bye >= 0) {
          this.hadBye[bye] = 1;
          liteBye(m, W, bye);
        }
      }
      // Results.
      let safety: IdSafety | null = null;
      if (final && this.idRate > 0) {
        const partner = new Int32Array(m.n).fill(-1);
        for (const [a, b] of pairs) {
          partner[a] = b;
          partner[b] = a;
        }
        safety = new IdSafety(m, W, partner, this.topCut);
      }
      // Decide every table first (IDSafety reads pre-round points), then apply.
      const decided: number[] = [];
      for (const [a, b] of pairs) {
        let o: number;
        if (a === focus || b === focus) {
          const mine: Outcome =
            j === 0 && this.focusForced ? this.focusForced : (forced ?? (rng() < 0.5 ? 'win' : 'loss'));
          const want = mine === 'win' ? A_WIN : mine === 'loss' ? B_WIN : ID;
          o = a === focus ? want : want === A_WIN ? B_WIN : want === B_WIN ? A_WIN : ID;
        } else if (safety && safety.safe(a, b) && rng() < this.idRate) o = ID;
        else {
          const hi = rng() < this.pw;
          o = hi ? A_WIN : B_WIN;
        }
        decided.push(o);
      }
      for (let i = 0; i < pairs.length; i++) {
        const [a, b] = pairs[i]!;
        liteOutcome(m, W, a, b, decided[i]!, rng() < 0.5);
      }
    }
    return rankOf(m, W, this.extra, focus, this.all.filter((p) => m.dropped[p] === 0), this.topCut);
  }
}
