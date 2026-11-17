import { describe, expect, it } from 'vitest';
import { computeStandings } from '../src/index.ts';
import { buildModel } from '../src/ledger.ts';
import { finalRoundPairing, hasPlayed, pairByStandings, pairRandom, type PairCtx } from '../src/pairing.ts';
import { mulberry32 } from '../src/rng.ts';
import { fixtureTournament, truncated } from './helpers.ts';
import type { Match, Tournament } from '../src/index.ts';
import { synthetic } from './synthetic.ts';

describe('final round pairing', () => {
  const full = fixtureTournament();

  it('uses the posted pairings when they exist', () => {
    const p = finalRoundPairing(full)!;
    expect(p.predicted).toBe(false);
    expect(p.matches).toBe(full.rounds[5]!.matches);
  });

  it('predicts 1v2, 3v4, ... from standings, skipping rematches', () => {
    const t5 = truncated(full, 5);
    const p = finalRoundPairing(t5)!;
    expect(p.predicted).toBe(true);
    const standings = computeStandings(t5, 5).filter((r) => !r.dropped);
    const m = buildModel(t5, 5);
    const active = standings.map((r) => r.playerId);
    const paired = new Set<string>();
    for (const mt of p.matches) {
      paired.add(mt.a);
      if (mt.b) {
        paired.add(mt.b);
        expect(hasPlayed({ m, l: m.base, extra: [], hadBye: m.hadBye }, m.index.get(mt.a)!, m.index.get(mt.b)!)).toBe(false);
      }
    }
    expect([...paired].sort()).toEqual([...active].sort());
    // The top two active players meet unless they already played.
    const top = p.matches[0]!;
    expect(top.a).toBe(active[0]);
    const alreadyMet = m.paired[m.index.get(active[0]!)!]!.has(m.index.get(active[1]!)!);
    expect(top.b).toBe(alreadyMet ? active[2] : active[1]);
  });

  it('gives an odd field its bye to the lowest-ranked player without one', () => {
    const t = synthetic(15, 3, { swissRounds: 4, topCut: 4, seed: 11 });
    const p = finalRoundPairing(t, 4)!;
    const bye = p.matches.find((x) => x.b === null)!;
    const m = buildModel(t, 3);
    const order = computeStandings(t, 3).map((r) => r.playerId);
    const hadBye = (id: string) => m.hadBye[m.index.get(id)!] === 1;
    const lowest = [...order].reverse().find((id) => !hadBye(id))!;
    expect(bye.a).toBe(lowest);
    expect(p.matches).toHaveLength(8);
  });

  it('falls back to the last player when everyone has had a bye', () => {
    const t = synthetic(5, 1, { swissRounds: 2, topCut: 4, seed: 2 });
    const m = buildModel(t, 1);
    m.hadBye.fill(1);
    const ctx: PairCtx = { m, l: m.base, extra: [], hadBye: m.hadBye };
    const out = new Int32Array(m.n);
    const bye = pairByStandings(ctx, [0, 1, 2, 3, 4], out);
    expect(bye).toBeGreaterThanOrEqual(0);
    expect(out[bye]).toBe(-1);
  });
});

describe('random Swiss pairing', () => {
  const t = synthetic(41, 3, { swissRounds: 6, topCut: 8, seed: 5 });
  const m = buildModel(t, 3);
  const ctx: PairCtx = { m, l: m.base, extra: [], hadBye: m.hadBye };
  const active = Array.from({ length: m.n }, (_, i) => i);

  it('pairs everyone once, avoids rematches and gives one bye', () => {
    const out = new Int32Array(m.n);
    const bye = pairRandom(ctx, active, mulberry32(1), out);
    expect(bye).toBeGreaterThanOrEqual(0);
    expect(out[bye]).toBe(-1);
    let rematches = 0;
    for (const p of active) {
      if (p === bye) continue;
      const q = out[p]!;
      expect(q).toBeGreaterThanOrEqual(0);
      expect(out[q]).toBe(p);
      if (hasPlayed(ctx, p, q)) rematches++;
    }
    expect(rematches).toBe(0);
  });

  it('keeps pairings within point groups except for the pair-down', () => {
    const out = new Int32Array(m.n);
    pairRandom(ctx, active, mulberry32(9), out);
    const mp = m.base.mp;
    const diffs = active.filter((p) => out[p]! > p && mp[p] !== mp[out[p]!]);
    // At most one float per point group boundary.
    expect(diffs.length).toBeLessThanOrEqual(new Set(Array.from(mp)).size);
  });

  it('is reproducible for a seed and varies between seeds', () => {
    const a = new Int32Array(m.n);
    const b = new Int32Array(m.n);
    const c = new Int32Array(m.n);
    pairRandom(ctx, active, mulberry32(4), a);
    pairRandom(ctx, active, mulberry32(4), b);
    pairRandom(ctx, active, mulberry32(5), c);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
  });

  it('copes when every player already has a bye or only rematches remain', () => {
    const small = synthetic(4, 3, { swissRounds: 4, topCut: 4, seed: 1 });
    const sm = buildModel(small, 3);
    const sctx: PairCtx = { m: sm, l: sm.base, extra: [], hadBye: sm.hadBye };
    const out = new Int32Array(sm.n);
    const bye = pairRandom(sctx, [0, 1, 2, 3], mulberry32(1), out);
    expect(bye).toBe(-1);
    expect(out.every((x) => x >= 0)).toBe(true);
    sm.hadBye.fill(1);
    const bye2 = pairRandom(sctx, [0, 1, 2], mulberry32(1), out);
    expect(bye2).toBeGreaterThanOrEqual(0);
  });
});

describe('rematch backtracking (CEG 10.4)', () => {
  // Greedy top-down pairing stranded a rematch at the bottom of the list in
  // fixtures 464438 and 465966; Melee avoided it by re-pairing higher up.
  it.each(['464438', '465966'])('predicts the whole final round of fixture %s with no rematch', (id) => {
    const full = fixtureTournament(id);
    const last = full.rounds.length;
    const played = new Set(full.rounds[last - 1]!.matches.flatMap((m) => [m.a, ...(m.b ? [m.b] : [])]));
    const snap: Tournament = {
      ...full,
      players: full.players.map((p) => ({ ...p, dropped: p.dropped && !played.has(p.id) })),
      rounds: full.rounds.slice(0, last - 1),
    };
    const key = (ms: Match[]) => ms.map((m) => (m.b ? [m.a, m.b].sort().join('-') : `bye-${m.a}`)).sort();
    expect(key(finalRoundPairing(snap)!.matches)).toEqual(key(full.rounds[last - 1]!.matches));
  });

  it('pairs a stranded last pair by re-pairing above it', () => {
    // 4 players, ranks A B C D. A-B played, C-D played: greedy gives A-C, B-D? Use a case
    // where the natural order A-B, C-D has C-D already played, so A-C, B-D (or A-D, B-C) is needed.
    const t: Tournament = {
      id: 'x', source: 'manual', name: 'x', startDate: null, playerCount: 4, swissRounds: 2, topCut: 2,
      players: ['A', 'B', 'C', 'D'].map((id) => ({ id, name: id, dropped: false })),
      rounds: [{ number: 1, status: 'completed', matches: [
        { table: 1, a: 'A', b: 'B', result: { kind: 'games', aWins: 2, bWins: 0, draws: 0 } },
        { table: 2, a: 'C', b: 'D', result: { kind: 'games', aWins: 2, bWins: 0, draws: 0 } },
      ] }],
      scoring: { win: 3, draw: 1, loss: 0, percentageFloor: 1 / 3 }, fetchedAt: null,
    };
    const ms = finalRoundPairing(t)!.matches;
    for (const m of ms) expect(new Set([m.a, m.b]).size).toBe(2);
    expect(ms.map((m) => [m.a, m.b].sort().join('')).sort()).toEqual(['AC', 'BD']);
  });
});
