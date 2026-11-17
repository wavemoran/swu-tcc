import type { MatchResult, Tournament } from './contract.ts';

/**
 * Index-based, typed-array view of a tournament used by standings, pairing and
 * the simulator. Players are addressed by index into `ids`.
 *
 * Conventions (validated against Melee in test/tiebreakers.test.ts):
 *  - a bye is a match win with game record 2-0-0 (counts in the player's own
 *    match and game percentages) but is NOT an opponent for anyone's OMW/OGW;
 *  - a forfeit without an opponent is a match loss with no games;
 *  - only matches with a result count.
 */
export interface Ledger {
  n: number;
  ids: string[];
  /** Match points, matches played, game points, games played. */
  mp: Int32Array;
  mc: Int32Array;
  gp: Int32Array;
  gc: Int32Array;
  mw: Int32Array;
  ml: Int32Array;
  md: Int32Array;
  gw: Int32Array;
  gl: Int32Array;
  gd: Int32Array;
}

/** The four counters the tiebreakers and the simulator need. */
export type Lite = Pick<Ledger, 'mp' | 'mc' | 'gp' | 'gc'>;

export function newLite(n: number): Lite {
  return { mp: new Int32Array(n), mc: new Int32Array(n), gp: new Int32Array(n), gc: new Int32Array(n) };
}

export function copyLite(dst: Lite, src: Lite): void {
  dst.mp.set(src.mp);
  dst.mc.set(src.mc);
  dst.gp.set(src.gp);
  dst.gc.set(src.gc);
}

export interface Model {
  t: Tournament;
  n: number;
  ids: string[];
  names: string[];
  index: Map<string, number>;
  dropped: Uint8Array;
  /** Rank of each player's numeric team id (ascending), for the final tiebreak. */
  idRank: Int32Array;
  win: number;
  draw: number;
  loss: number;
  floor: number;
  /** Opponents for OMW/OGW (resolved real matches, byes excluded). */
  opps: number[][];
  /** Everyone each player has been paired with (any result), for rematch avoidance. */
  paired: Set<number>[];
  hadBye: Uint8Array;
  base: Ledger;
}

export function newLedger(n: number, ids: string[]): Ledger {
  return {
    n,
    ids,
    mp: new Int32Array(n),
    mc: new Int32Array(n),
    gp: new Int32Array(n),
    gc: new Int32Array(n),
    mw: new Int32Array(n),
    ml: new Int32Array(n),
    md: new Int32Array(n),
    gw: new Int32Array(n),
    gl: new Int32Array(n),
    gd: new Int32Array(n),
  };
}

export function copyLedger(dst: Ledger, src: Ledger): void {
  dst.mp.set(src.mp);
  dst.mc.set(src.mc);
  dst.gp.set(src.gp);
  dst.gc.set(src.gc);
  dst.mw.set(src.mw);
  dst.ml.set(src.ml);
  dst.md.set(src.md);
  dst.gw.set(src.gw);
  dst.gl.set(src.gl);
  dst.gd.set(src.gd);
}

export function cloneLedger(src: Ledger): Ledger {
  const l = newLedger(src.n, src.ids);
  copyLedger(l, src);
  return l;
}

/** Apply a two-player game result (a vs b) with the tournament's scoring. */
export function applyGames(m: Model, l: Ledger, a: number, b: number, aw: number, bw: number, dr: number): void {
  const { win, draw } = m;
  const games = aw + bw + dr;
  l.mc[a]! += 1;
  l.mc[b]! += 1;
  l.gc[a]! += games;
  l.gc[b]! += games;
  l.gw[a]! += aw;
  l.gl[a]! += bw;
  l.gd[a]! += dr;
  l.gw[b]! += bw;
  l.gl[b]! += aw;
  l.gd[b]! += dr;
  l.gp[a]! += aw * win + dr * draw;
  l.gp[b]! += bw * win + dr * draw;
  if (aw > bw) {
    l.mp[a]! += win;
    l.mw[a]! += 1;
    l.ml[b]! += 1;
  } else if (bw > aw) {
    l.mp[b]! += win;
    l.mw[b]! += 1;
    l.ml[a]! += 1;
  } else {
    l.mp[a]! += draw;
    l.mp[b]! += draw;
    l.md[a]! += 1;
    l.md[b]! += 1;
  }
}

export function applyBye(m: Model, l: Ledger, a: number): void {
  l.mc[a]! += 1;
  l.mp[a]! += m.win;
  l.mw[a]! += 1;
  l.gc[a]! += 2;
  l.gw[a]! += 2;
  l.gp[a]! += 2 * m.win;
}

export function applyForfeit(l: Ledger, a: number): void {
  l.mc[a]! += 1;
  l.ml[a]! += 1;
}

export function applyResult(m: Model, l: Ledger, a: number, b: number, r: MatchResult): void {
  if (r.kind === 'games') {
    if (b >= 0) applyGames(m, l, a, b, r.aWins, r.bWins, r.draws);
  } else if (r.kind === 'bye') applyBye(m, l, a);
  else applyForfeit(l, a);
}

function compareIds(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Build the model counting rounds 1..throughRound (resolved matches only). */
export function buildModel(t: Tournament, throughRound: number): Model {
  const n = t.players.length;
  const ids = t.players.map((p) => p.id);
  const index = new Map<string, number>();
  ids.forEach((id, i) => index.set(id, i));
  const order = ids.map((_, i) => i).sort((x, y) => compareIds(ids[x]!, ids[y]!));
  const idRank = new Int32Array(n);
  order.forEach((p, r) => (idRank[p] = r));
  const dropped = new Uint8Array(n);
  t.players.forEach((p, i) => (dropped[i] = p.dropped ? 1 : 0));
  const m: Model = {
    t,
    n,
    ids,
    names: t.players.map((p) => p.name),
    index,
    dropped,
    idRank,
    win: t.scoring.win,
    draw: t.scoring.draw,
    loss: t.scoring.loss,
    floor: t.scoring.percentageFloor,
    opps: Array.from({ length: n }, () => [] as number[]),
    paired: Array.from({ length: n }, () => new Set<number>()),
    hadBye: new Uint8Array(n),
    base: newLedger(n, ids),
  };
  for (const round of t.rounds) {
    if (round.number > throughRound) break;
    for (const match of round.matches) {
      const a = index.get(match.a);
      if (a === undefined) continue;
      const b = match.b === null ? -1 : (index.get(match.b) ?? -1);
      if (b >= 0) {
        m.paired[a]!.add(b);
        m.paired[b]!.add(a);
      }
      if (match.result?.kind === 'bye') m.hadBye[a] = 1;
      if (match.result === null) continue;
      applyResult(m, m.base, a, b, match.result);
      if (b >= 0 && match.result.kind === 'games') {
        m.opps[a]!.push(b);
        m.opps[b]!.push(a);
      }
    }
  }
  return m;
}

/** max(floor, points / (win * count)); the floor also covers count === 0. */
export function pct(points: number, count: number, win: number, floor: number): number {
  if (count === 0) return floor;
  const v = points / (win * count);
  return v < floor ? floor : v;
}

export interface Tiebreaks {
  omw: number;
  gw: number;
  ogw: number;
}

/**
 * Tiebreakers for player p. `extra` lists opponents added on top of the model's
 * base opponent lists (simulated rounds), as flat [p0Opp, p1Opp, ...] arrays.
 */
export function tiebreaks(m: Model, l: Lite, p: number, extra?: ReadonlyArray<Int32Array>, out?: Tiebreaks): Tiebreaks {
  const { win, floor } = m;
  let so = 0;
  let sg = 0;
  let k = 0;
  const list = m.opps[p]!;
  for (let i = 0; i < list.length; i++) {
    const o = list[i]!;
    so += pct(l.mp[o]!, l.mc[o]!, win, floor);
    sg += pct(l.gp[o]!, l.gc[o]!, win, floor);
    k++;
  }
  if (extra) {
    for (let r = 0; r < extra.length; r++) {
      const o = extra[r]![p]!;
      if (o < 0) continue;
      so += pct(l.mp[o]!, l.mc[o]!, win, floor);
      sg += pct(l.gp[o]!, l.gc[o]!, win, floor);
      k++;
    }
  }
  const res = out ?? { omw: 0, gw: 0, ogw: 0 };
  // Melee quirk (verified in round 1 of fixture 484511): a player with no
  // opponents (only a bye) gets the truncated fallback 0.3333, which sorts just
  // below a genuine 1/3.
  const noOpp = Math.floor(floor * 10000) / 10000;
  res.omw = k === 0 ? noOpp : so / k;
  res.ogw = k === 0 ? noOpp : sg / k;
  res.gw = pct(l.gp[p]!, l.gc[p]!, win, floor);
  return res;
}
