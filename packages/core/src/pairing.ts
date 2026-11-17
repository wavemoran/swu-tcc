import type { Match, Tournament } from './contract.ts';
import { buildModel, type Lite, type Model } from './ledger.ts';
import { sortedOrder } from './standings.ts';

/** What the pairing functions need to know about the event so far. */
export interface PairCtx {
  m: Model;
  l: Lite;
  /** Simulated rounds already paired on top of the model: opponent per player, -1 for none. */
  extra: Int32Array[];
  /** Players who have had a bye, including simulated ones. */
  hadBye: Uint8Array;
}

export function hasPlayed(ctx: PairCtx, a: number, b: number): boolean {
  if (ctx.m.paired[a]!.has(b)) return true;
  for (let i = 0; i < ctx.extra.length; i++) if (ctx.extra[i]![a] === b) return true;
  return false;
}

function activePlayers(m: Model): number[] {
  const out: number[] = [];
  for (let i = 0; i < m.n; i++) if (m.dropped[i] === 0) out.push(i);
  return out;
}

/**
 * Greedy top-down pairing of `list` (already in pairing order): the first
 * player takes the next player down the list they have not played, which is
 * CEG 10.4's "skip rematches, take the next highest eligible player". If a
 * rematch cannot be avoided the next player down is used.
 */
function pairInOrder(ctx: PairCtx, list: number[], out: Int32Array): void {
  const rest = list.slice();
  while (rest.length >= 2) {
    const a = rest.shift()!;
    let k = rest.findIndex((b) => !hasPlayed(ctx, a, b));
    if (k < 0) k = 0;
    const b = rest.splice(k, 1)[0]!;
    out[a] = b;
    out[b] = a;
  }
}

/** Backtracking budget (recursive calls) before falling back to the greedy pairing. */
const BACKTRACK_BUDGET = 20000;

/**
 * Like `pairInOrder`, but when the greedy choice would strand a rematch at the
 * bottom of the list it backtracks: the top player takes the highest-ranked
 * opponent for whom everyone below can still be paired without a rematch.
 * This is what Melee does (found by backtesting fixtures 464438 and 465966,
 * where greedy paired two players who had already met). Falls back to the
 * greedy result if no rematch-free pairing exists or the budget runs out.
 */
function pairInOrderNoRematch(ctx: PairCtx, list: number[], out: Int32Array): void {
  const n = list.length;
  const used = new Uint8Array(n);
  const partner = new Int32Array(n).fill(-1);
  let budget = BACKTRACK_BUDGET;
  const solve = (from: number): boolean => {
    while (from < n && used[from]) from++;
    if (from >= n) return true;
    if (--budget < 0) return false;
    used[from] = 1;
    for (let j = from + 1; j < n; j++) {
      if (used[j] || hasPlayed(ctx, list[from]!, list[j]!)) continue;
      used[j] = 1;
      partner[from] = j;
      if (solve(from + 1)) return true;
      used[j] = 0;
      if (budget < 0) break;
    }
    used[from] = 0;
    return false;
  };
  if (!solve(0)) {
    pairInOrder(ctx, list, out);
    return;
  }
  for (let i = 0; i < n; i++) {
    const j = partner[i]!;
    if (j >= 0) {
      out[list[i]!] = list[j]!;
      out[list[j]!] = list[i]!;
    }
  }
}

/**
 * Final Swiss round (CEG 10.4): active players sorted by standings and paired
 * 1v2, 3v4, ... skipping rematches. With an odd number of players the
 * lowest-ranked player without a bye gets the bye. `out[p]` becomes p's
 * opponent or -1; returns the bye player or -1.
 */
export function pairByStandings(ctx: PairCtx, active: number[], out: Int32Array): number {
  out.fill(-1);
  const order = sortedOrder(ctx.m, ctx.l, ctx.extra, active);
  let bye = -1;
  if (order.length % 2 === 1) {
    for (let i = order.length - 1; i >= 0; i--) {
      if (ctx.hadBye[order[i]!] === 0) {
        bye = order[i]!;
        break;
      }
    }
    if (bye < 0) bye = order[order.length - 1]!;
    order.splice(order.indexOf(bye), 1);
  }
  pairInOrderNoRematch(ctx, order, out);
  return bye;
}

function shuffle(a: number[], rng: () => number): void {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
}

/**
 * Random Swiss pairing for non-final rounds: random within point groups; an
 * odd player floats down to a random eligible player in the next group;
 * rematches avoided; an odd field gives the bye to a random player from the
 * lowest point group that has someone without a bye.
 */
export function pairRandom(ctx: PairCtx, active: number[], rng: () => number, out: Int32Array): number {
  out.fill(-1);
  const mp = ctx.l.mp;
  const groups = new Map<number, number[]>();
  for (const p of active) {
    const g = groups.get(mp[p]!);
    if (g) g.push(p);
    else groups.set(mp[p]!, [p]);
  }
  const points = [...groups.keys()].sort((x, y) => y - x);
  let bye = -1;
  if (active.length % 2 === 1) {
    for (let i = points.length - 1; i >= 0 && bye < 0; i--) {
      const cands = groups.get(points[i]!)!.filter((p) => ctx.hadBye[p] === 0);
      if (cands.length > 0) bye = cands[Math.floor(rng() * cands.length)]!;
    }
    if (bye < 0) bye = active[Math.floor(rng() * active.length)]!;
    const g = groups.get(mp[bye]!)!;
    g.splice(g.indexOf(bye), 1);
  }
  let carry = -1;
  for (const pts of points) {
    const g = groups.get(pts)!;
    shuffle(g, rng);
    if (carry >= 0) {
      let k = g.findIndex((b) => !hasPlayed(ctx, carry, b));
      if (k < 0) k = 0;
      if (g.length > 0) {
        const b = g.splice(k, 1)[0]!;
        out[carry] = b;
        out[b] = carry;
        carry = -1;
      }
    }
    pairInOrder(ctx, g, out);
    // pairInOrder leaves at most one player unpaired.
    const left = g.find((p) => out[p] === -1);
    if (left !== undefined) carry = left;
  }
  if (carry >= 0 && bye < 0) bye = carry;
  repairRematches(ctx, active, out, bye);
  return bye;
}

/**
 * Greedy group-local pairing can strand a rematch. Fix each one by swapping
 * partners with the nearest-in-points pair that makes both new pairs fresh.
 */
function repairRematches(ctx: PairCtx, active: number[], out: Int32Array, bye: number): void {
  const mp = ctx.l.mp;
  for (const a of active) {
    const b = out[a]!;
    if (b < 0 || a > b || !hasPlayed(ctx, a, b)) continue;
    let bestC = -1;
    let bestD = -1;
    let bestCost = Number.POSITIVE_INFINITY;
    for (const c of active) {
      const d = out[c]!;
      if (c === a || c === b || d < 0 || c > d || c === bye) continue;
      for (const [x, y] of [
        [c, d],
        [d, c],
      ] as const) {
        // New pairs: (a, x) and (b, y).
        if (hasPlayed(ctx, a, x) || hasPlayed(ctx, b, y)) continue;
        const cost = Math.abs(mp[a]! - mp[x]!) + Math.abs(mp[b]! - mp[y]!);
        if (cost < bestCost) {
          bestCost = cost;
          bestC = x;
          bestD = y;
        }
      }
    }
    if (bestC >= 0) {
      out[a] = bestC;
      out[bestC] = a;
      out[b] = bestD;
      out[bestD] = b;
    }
  }
}

export interface FinalPairing {
  matches: Match[];
  /** True when predicted from standings (CEG 10.4) rather than posted. */
  predicted: boolean;
}

/**
 * Pairings for the final Swiss round: the posted ones if present, else a
 * prediction from standings through the previous round. Returns null if
 * earlier rounds are still unfinished (nothing sensible to predict).
 */
export function finalRoundPairing(t: Tournament, swissRounds = t.swissRounds): FinalPairing | null {
  const posted = t.rounds.find((r) => r.number === swissRounds);
  if (posted && posted.matches.length > 0) return { matches: posted.matches, predicted: false };
  const m = buildModel(t, swissRounds - 1);
  const ctx: PairCtx = { m, l: m.base, extra: [], hadBye: m.hadBye };
  const out = new Int32Array(m.n);
  const bye = pairByStandings(ctx, activePlayers(m), out);
  const matches: Match[] = [];
  const done = new Uint8Array(m.n);
  const standings = sortedOrder(m, m.base, undefined, activePlayers(m));
  let table = 1;
  for (const p of standings) {
    if (done[p] || p === bye) continue;
    const b = out[p]!;
    done[p] = 1;
    done[b] = 1;
    matches.push({ table: table++, a: m.ids[p]!, b: m.ids[b]!, result: null });
  }
  if (bye >= 0) matches.push({ table: null, a: m.ids[bye]!, b: null, result: null });
  return { matches, predicted: true };
}
