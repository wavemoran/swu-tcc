import type { StandingRow, Tournament } from './contract.ts';
import { buildModel, tiebreaks, type Ledger, type Lite, type Model, type Tiebreaks } from './ledger.ts';

/**
 * Sort players: points, OMW, GW, OGW (all descending), then team id ascending.
 * Tiebreakers are computed lazily, only for players that tie on points.
 */
export function sortedOrder(m: Model, l: Lite, extra?: ReadonlyArray<Int32Array>, subset?: ArrayLike<number>): number[] {
  const idx: number[] = subset ? Array.from(subset) : Array.from({ length: m.n }, (_, i) => i);
  const omw = new Float64Array(m.n).fill(-1);
  const gw = new Float64Array(m.n);
  const ogw = new Float64Array(m.n);
  const tmp: Tiebreaks = { omw: 0, gw: 0, ogw: 0 };
  const fill = (p: number) => {
    if (omw[p]! >= 0) return;
    tiebreaks(m, l, p, extra, tmp);
    omw[p] = tmp.omw;
    gw[p] = tmp.gw;
    ogw[p] = tmp.ogw;
  };
  idx.sort((a, b) => {
    const d = l.mp[b]! - l.mp[a]!;
    if (d !== 0) return d;
    fill(a);
    fill(b);
    let e = omw[b]! - omw[a]!;
    if (Math.abs(e) > 1e-9) return e;
    e = gw[b]! - gw[a]!;
    if (Math.abs(e) > 1e-9) return e;
    e = ogw[b]! - ogw[a]!;
    if (Math.abs(e) > 1e-9) return e;
    return m.idRank[a]! - m.idRank[b]!;
  });
  return idx;
}

export function rowsFromModel(m: Model, l: Ledger): StandingRow[] {
  const order = sortedOrder(m, l);
  return order.map((p, i) => {
    const tb = tiebreaks(m, l, p);
    return {
      rank: i + 1,
      playerId: m.ids[p]!,
      name: m.names[p]!,
      points: l.mp[p]!,
      record: { wins: l.mw[p]!, losses: l.ml[p]!, draws: l.md[p]! },
      games: { wins: l.gw[p]!, losses: l.gl[p]!, draws: l.gd[p]! },
      omw: tb.omw,
      gw: tb.gw,
      ogw: tb.ogw,
      dropped: m.dropped[p] === 1,
    };
  });
}

/** Standings through `throughRound` (default: every Swiss round with results). */
export function computeStandings(t: Tournament, throughRound?: number): StandingRow[] {
  const m = buildModel(t, throughRound ?? Number.POSITIVE_INFINITY);
  return rowsFromModel(m, m.base);
}
