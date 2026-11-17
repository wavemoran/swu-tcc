import type { MatchResult } from './contract.ts';
import { tiebreaks, type Lite, type Model, type Tiebreaks } from './ledger.ts';

/** Lite (counter-only) result application, used in the hot simulation loops. */

export function liteGames(m: Model, l: Lite, a: number, b: number, aw: number, bw: number, dr: number): void {
  const games = aw + bw + dr;
  l.mc[a]! += 1;
  l.mc[b]! += 1;
  l.gc[a]! += games;
  l.gc[b]! += games;
  l.gp[a]! += aw * m.win + dr * m.draw;
  l.gp[b]! += bw * m.win + dr * m.draw;
  if (aw > bw) l.mp[a]! += m.win;
  else if (bw > aw) l.mp[b]! += m.win;
  else {
    l.mp[a]! += m.draw;
    l.mp[b]! += m.draw;
  }
}

export function liteBye(m: Model, l: Lite, a: number): void {
  l.mc[a]! += 1;
  l.mp[a]! += m.win;
  l.gc[a]! += 2;
  l.gp[a]! += 2 * m.win;
}

export function liteResult(m: Model, l: Lite, a: number, b: number, r: MatchResult): void {
  if (r.kind === 'games') {
    if (b >= 0) liteGames(m, l, a, b, r.aWins, r.bWins, r.draws);
  } else if (r.kind === 'bye') liteBye(m, l, a);
  else l.mc[a]! += 1;
}

/** Simulated table outcomes. */
export const A_WIN = 0;
export const B_WIN = 1;
export const ID = 2;

/** Apply a simulated outcome. Wins are 2-0 or 2-1 (decided by `shortWin`), an ID is 0-0-3. */
export function liteOutcome(m: Model, l: Lite, a: number, b: number, o: number, shortWin: boolean): void {
  if (o === ID) liteGames(m, l, a, b, 0, 0, 3);
  else if (o === A_WIN) liteGames(m, l, a, b, 2, shortWin ? 0 : 1, 0);
  else liteGames(m, l, a, b, shortWin ? 0 : 1, 2, 0);
}

/** Reverse of liteOutcome with the same arguments. */
export function liteUndo(m: Model, l: Lite, a: number, b: number, o: number, shortWin: boolean): void {
  let aw = 0;
  let bw = 0;
  let dr = 0;
  if (o === ID) dr = 3;
  else if (o === A_WIN) {
    aw = 2;
    bw = shortWin ? 0 : 1;
  } else {
    bw = 2;
    aw = shortWin ? 0 : 1;
  }
  const games = aw + bw + dr;
  l.mc[a]! -= 1;
  l.mc[b]! -= 1;
  l.gc[a]! -= games;
  l.gc[b]! -= games;
  l.gp[a]! -= aw * m.win + dr * m.draw;
  l.gp[b]! -= bw * m.win + dr * m.draw;
  if (o === A_WIN) l.mp[a]! -= m.win;
  else if (o === B_WIN) l.mp[b]! -= m.win;
  else {
    l.mp[a]! -= m.draw;
    l.mp[b]! -= m.draw;
  }
}

const tbF: Tiebreaks = { omw: 0, gw: 0, ogw: 0 };
const tbP: Tiebreaks = { omw: 0, gw: 0, ogw: 0 };
const EPS = 1e-9;

/**
 * Final rank of `focus` among non-dropped players, scanning only `cands`
 * (every player that could be at or above the focus's points). Players are
 * compared as in Melee: points, OMW, GW, OGW, team id.
 */
export function rankOf(
  m: Model,
  l: Lite,
  extra: ReadonlyArray<Int32Array>,
  focus: number,
  cands: ArrayLike<number>,
  topCut: number,
): number {
  const F = l.mp[focus]!;
  let ahead = 0;
  let ties = 0;
  for (let i = 0; i < cands.length; i++) {
    const p = cands[i]!;
    if (p === focus) continue;
    const pts = l.mp[p]!;
    if (pts > F) ahead++;
    else if (pts === F) ties++;
  }
  if (ties === 0) return ahead + 1;
  // Already outside the cut: an upper-bound rank is enough.
  if (ahead >= topCut) return ahead + ties + 1;
  tiebreaks(m, l, focus, extra, tbF);
  for (let i = 0; i < cands.length; i++) {
    const p = cands[i]!;
    if (p === focus || l.mp[p] !== F) continue;
    tiebreaks(m, l, p, extra, tbP);
    let e = tbP.omw - tbF.omw;
    if (Math.abs(e) <= EPS) {
      e = tbP.gw - tbF.gw;
      if (Math.abs(e) <= EPS) {
        e = tbP.ogw - tbF.ogw;
        if (Math.abs(e) <= EPS) e = m.idRank[focus]! - m.idRank[p]!;
      }
    }
    if (e > 0) ahead++;
  }
  return ahead + 1;
}

/**
 * "Could both players of this table ID and still be inside the cut by points?"
 * Counts how many other players could finish strictly above the IDers' points
 * (best case over each other table's win/loss/draw outcomes). A pair is safe
 * when that count plus the two IDers fits within the cut.
 */
export class IdSafety {
  private memo = new Map<number, number>();
  private m: Model;
  private l: Lite;
  /** Opponent of each player in a still-unplayed table, else -1. */
  private partner: Int32Array;
  private topCut: number;
  constructor(m: Model, l: Lite, partner: Int32Array, topCut: number) {
    this.m = m;
    this.l = l;
    this.partner = partner;
    this.topCut = topCut;
  }

  private tableMax(T: number, a: number, b: number): number {
    const { m, l } = this;
    const da = m.dropped[a] === 1 ? 0 : 1;
    const db = m.dropped[b] === 1 ? 0 : 1;
    const pa = l.mp[a]!;
    const pb = l.mp[b]!;
    const x = da * (pa + m.win > T ? 1 : 0) + db * (pb > T ? 1 : 0);
    const y = da * (pa > T ? 1 : 0) + db * (pb + m.win > T ? 1 : 0);
    const z = da * (pa + m.draw > T ? 1 : 0) + db * (pb + m.draw > T ? 1 : 0);
    return Math.max(x, y, z);
  }

  private total(T: number): number {
    const hit = this.memo.get(T);
    if (hit !== undefined) return hit;
    const { m, l, partner } = this;
    let c = 0;
    for (let p = 0; p < m.n; p++) {
      const q = partner[p]!;
      if (q < 0) {
        if (m.dropped[p] === 0 && l.mp[p]! > T) c++;
      } else if (p < q) c += this.tableMax(T, p, q);
    }
    this.memo.set(T, c);
    return c;
  }

  safe(a: number, b: number): boolean {
    const T = Math.min(this.l.mp[a]!, this.l.mp[b]!) + this.m.draw;
    return this.total(T) - this.tableMax(T, a, b) + 2 <= this.topCut;
  }
}
