import { describe, expect, it } from 'vitest';
import { analyze, computeStandings, PASTED_ID_SAFE_THRESHOLD, scenarioStatus } from '../src/index.ts';
import type { Match, Tournament } from '../src/index.ts';
import { fixtureTournament, truncated } from './helpers.ts';
import { synthetic } from './synthetic.ts';

const FOCUS = '5003';

describe('the reference case, Player 003 (fixture 484511, round 6 intentional draw)', () => {
  const full = fixtureTournament();

  it('Player 003 was 6th at 12 points after round 5', () => {
    const rows = computeStandings(full, 5);
    const me = rows.find((r) => r.playerId === FOCUS)!;
    expect(me.rank).toBe(6);
    expect(me.points).toBe(12);
  });

  it('predicted pairings: the ID is safe, the win is certain, the loss is a long shot', () => {
    const a = analyze(truncated(full, 5), { playerId: FOCUS });
    const by = (o: string) => a.scenarios.find((s) => s.outcomes.join() === o)!;
    console.log('Player 003 (predicted R6):', a.scenarios.map((s) => `${s.outcomes} ${s.probability.toFixed(4)} ${s.certainty} ranks ${s.bestRank}-${s.worstRank}`));
    console.log('verdict:', a.verdict);
    expect(a.roundsRemaining).toBe(1);
    expect(a.nextOpponent?.predicted).toBe(true);
    expect(by('draw').probability).toBeGreaterThanOrEqual(0.8);
    expect(by('draw').finalPoints).toBe(13);
    expect(by('win').probability).toBeGreaterThanOrEqual(0.99);
    expect(by('loss').probability).toBeLessThan(0.5);
    expect(a.verdict.status).toBe('id-safe');
    expect(a.verdict.basis).toBe('draw');
    expect(a.scenarios.map((x) => x.status)).toEqual(a.scenarios.map((x) => scenarioStatus(x)));
    expect(a.verdict.summary).toContain('intentional draw (ID)');
    expect(a.method.kind).toBe('exhaustive');
    expect(a.assumptions.join(' ')).toMatch(/predicted from standings/);
  });

  it('posted pairings with no results: same verdict, and the opponent is Player 018', () => {
    const a = analyze(truncated(full, 5, { postedNext: true }), { playerId: FOCUS });
    const by = (o: string) => a.scenarios.find((s) => s.outcomes.join() === o)!;
    console.log('Player 003 (posted R6):', a.scenarios.map((s) => `${s.outcomes} ${s.probability.toFixed(4)} ${s.certainty} ranks ${s.bestRank}-${s.worstRank}`));
    expect(a.nextOpponent).toEqual({ playerId: '5018', name: 'Player 018', predicted: false });
    expect(by('draw').probability).toBeGreaterThanOrEqual(0.8);
    expect(by('win').probability).toBeGreaterThanOrEqual(0.99);
    expect(a.verdict.status).toBe('id-safe');
    expect(a.assumptions.join(' ')).toMatch(/as posted/);
  });

  it('never reports an estimate as exactly 0 or 1', () => {
    const a = analyze(truncated(full, 5), { playerId: FOCUS });
    for (const s of a.scenarios) {
      if (s.certainty === 'estimated') {
        expect(s.probability).toBeGreaterThan(0);
        expect(s.probability).toBeLessThan(1);
      }
    }
  });

  it('is reproducible and respects overrides', () => {
    const t = truncated(full, 5);
    expect(analyze(t, { playerId: FOCUS, seed: 3 })).toEqual(analyze(t, { playerId: FOCUS, seed: 3 }));
    const tight = analyze(t, { playerId: FOCUS, topCut: 4 });
    expect(tight.topCut).toBe(4);
    expect(tight.scenarios.find((s) => s.outcomes[0] === 'draw')!.probability).toBeLessThan(0.5);
    const noId = analyze(t, { playerId: FOCUS, rivalIdRate: 0, otherTableWinRate: 0.7 });
    expect(noId.assumptions.join(' ')).toMatch(/never end in an intentional draw/);
    expect(noId.assumptions.join(' ')).toMatch(/70%/);
  });

  it('with the real round 6 result already in, only the known outcome is enumerated', () => {
    const t = truncated(full, 5, { postedNext: true });
    const r6 = full.rounds[5]!;
    const known = r6.matches.find((m) => m.a === FOCUS || m.b === FOCUS)!;
    const round6 = t.rounds[5]!;
    t.rounds[5] = {
      ...round6,
      matches: round6.matches.map((m) => (m.a === known.a && m.b === known.b ? known : m)),
    };
    const a = analyze(t, { playerId: FOCUS });
    expect(a.scenarios).toHaveLength(1);
    expect(a.scenarios[0]!.outcomes).toEqual(['draw']);
    expect(a.scenarios[0]!.probability).toBeGreaterThanOrEqual(0.8);
  });

  it('after round 6 is over, the final standings decide', () => {
    const a = analyze(full, { playerId: FOCUS });
    expect(a.roundsRemaining).toBe(0);
    expect(a.verdict.status).toBe('locked');
    expect(a.verdict.probability).toBe(1);
    expect(a.verdict.certainty).toBe('certain');
    expect(a.current.rank).toBe(7);
    const out = analyze(full, { playerId: computeStandings(full)[20]!.playerId });
    expect(out.verdict.status).toBe('out');
    expect(out.verdict.certainty).toBe('impossible');
  });
});

describe('Monte Carlo (two rounds left)', () => {
  const full = fixtureTournament();

  it('enumerates nine paths with estimated probabilities', () => {
    const t = truncated(full, 4, { postedNext: true });
    const a = analyze(t, { playerId: FOCUS, simulations: 1800 });
    expect(a.roundsRemaining).toBe(2);
    expect(a.method.kind).toBe('monte-carlo');
    expect(a.scenarios).toHaveLength(9);
    expect(a.scenarios[0]!.outcomes).toEqual(['win', 'win']);
    const ww = a.scenarios[0]!;
    const ll = a.scenarios[8]!;
    expect(ww.probability).toBeGreaterThan(ll.probability);
    expect(a.nextOpponent?.predicted).toBe(false);
    for (const s of a.scenarios) {
      if (s.certainty === 'estimated') {
        expect(s.probability).toBeGreaterThanOrEqual(0.001);
        expect(s.probability).toBeLessThanOrEqual(0.999);
      }
    }
    expect(a.assumptions.join(' ')).toMatch(/simulations in total/);
    expect(analyze(t, { playerId: FOCUS, simulations: 1800 })).toEqual(a);
  });

  it('predicts the final round and uses random pairings before it', () => {
    const t = truncated(full, 4);
    const a = analyze(t, { playerId: FOCUS, simulations: 900, otherTableWinRate: 0.6, rivalIdRate: 0 });
    expect(a.scenarios).toHaveLength(9);
    expect(a.nextOpponent).toBeNull();
    expect(a.assumptions.join(' ')).toMatch(/random within point groups/);
  });

  it('with three rounds left only the last two are enumerated', () => {
    const t = truncated(full, 3);
    const a = analyze(t, { playerId: FOCUS, simulations: 900 });
    expect(a.roundsRemaining).toBe(3);
    expect(a.scenarios).toHaveLength(9);
    expect(a.assumptions.join(' ')).toMatch(/last two/);
  });

  it('proves certain outcomes without sampling noise', () => {
    // A 6-round-of-7 leader far ahead of a small cut: whatever happens they stay in.
    const t = synthetic(40, 5, { swissRounds: 7, topCut: 32, seed: 4 });
    const top = computeStandings(t)[0]!.playerId;
    const a = analyze(t, { playerId: top, simulations: 600 });
    const loss = a.scenarios.find((s) => s.outcomes.join() === 'loss,loss')!;
    expect(loss.certainty).toBe('certain');
    expect(loss.probability).toBe(1);
    expect(a.verdict.status).toBe('locked');
    const bottom = computeStandings(t).at(-1)!.playerId;
    const b = analyze(t, { playerId: bottom, simulations: 600, topCut: 4 });
    const win = b.scenarios[0]!;
    expect(win.probability).toBeLessThan(0.5);
  });
});

describe('a synthetic eight-player event with provable outcomes', () => {
  // After two rounds: P1 and P5 are 2-0 (6), P2, P3, P6, P7 are 1-1 (3), P4 and P8 are 0-2 (0).
  function build(): Tournament {
    const g = (a: string, b: string, aw: number, bw: number): Match => ({
      table: null,
      a,
      b,
      result: { kind: 'games', aWins: aw, bWins: bw, draws: 0 },
    });
    const players = ['1', '2', '3', '4', '5', '6', '7', '8'].map((id) => ({ id, name: `P${id}`, dropped: false }));
    return {
      id: 'tiny',
      source: 'manual',
      name: 'Tiny',
      startDate: null,
      playerCount: 8,
      swissRounds: 3,
      topCut: 4,
      players,
      rounds: [
        { number: 1, status: 'completed', matches: [g('1', '2', 2, 0), g('3', '4', 2, 0), g('5', '6', 2, 0), g('7', '8', 2, 0)] },
        { number: 2, status: 'completed', matches: [g('1', '3', 2, 0), g('5', '7', 2, 0), g('2', '4', 2, 0), g('6', '8', 2, 0)] },
        {
          number: 3,
          status: 'in-progress',
          matches: [
            { table: 1, a: '1', b: '5', result: null },
            { table: 2, a: '2', b: '3', result: null },
            { table: 3, a: '6', b: '7', result: null },
            { table: 4, a: '4', b: '8', result: null },
          ],
        },
      ],
      scoring: { win: 3, draw: 1, loss: 0, percentageFloor: 1 / 3 },
      fetchedAt: null,
    };
  }

  it('a leader whose worst case still makes the cut is LOCKED, with probability exactly 1', () => {
    const a = analyze(build(), { playerId: '1' });
    expect(a.method.kind).toBe('exhaustive');
    for (const s of a.scenarios) {
      expect(s.certainty).toBe('certain');
      expect(s.probability).toBe(1);
    }
    expect(a.verdict.status).toBe('locked');
    expect(a.verdict.basis).toBe('loss');
    expect(a.verdict.certainty).toBe('certain');
    expect(a.verdict.probability).toBe(1);
  });

  it('proves a loss out and a win in by points alone, and only estimates the draw', () => {
    const a = analyze(build(), { playerId: '2' });
    const by = (o: string) => a.scenarios.find((s) => s.outcomes[0] === o)!;
    expect(by('loss')).toMatchObject({ certainty: 'impossible', probability: 0 });
    expect(by('win')).toMatchObject({ certainty: 'certain', probability: 1 });
    expect(by('draw').certainty).toBe('estimated');
    expect(by('draw').probability).toBeGreaterThan(0);
    expect(by('draw').probability).toBeLessThan(1);
  });

  it('a player who is mathematically eliminated even with a win is OUT', () => {
    const a = analyze(build(), { playerId: '4' });
    expect(a.scenarios.every((s) => s.certainty === 'impossible')).toBe(true);
    expect(a.verdict.status).toBe('out');
    expect(a.verdict.summary).toMatch(/OUT/);
  });

  it('a dropped player cannot make the cut', () => {
    const t = build();
    t.players[3]!.dropped = true;
    const a = analyze(t, { playerId: '4' });
    expect(a.verdict.status).toBe('out');
    expect(a.scenarios.every((s) => s.probability === 0 && s.certainty === 'impossible')).toBe(true);
  });

  it('dropped opponents leave the field and are not paired', () => {
    const t = build();
    t.players[1]!.dropped = true;
    t.rounds[2]!.matches = t.rounds[2]!.matches.filter((m) => m.a !== '2');
    t.rounds[2]!.matches.push({ table: null, a: '3', b: null, result: null });
    const a = analyze(t, { playerId: '3' });
    expect(a.scenarios.length).toBeGreaterThan(0);
  });

  it('rejects unknown players', () => {
    expect(() => analyze(build(), { playerId: 'nope' })).toThrow(/not in this tournament/);
  });

  it('honours a bye and a known forfeit for the focus player', () => {
    const t = build();
    t.rounds[2]!.matches = [
      { table: 1, a: '1', b: '5', result: null },
      { table: 2, a: '2', b: '3', result: null },
      { table: 3, a: '6', b: '7', result: null },
      { table: null, a: '4', b: null, result: { kind: 'bye' } },
    ];
    t.players.find((p) => p.id === '8')!.dropped = true;
    const withBye = analyze(t, { playerId: '4' });
    expect(withBye.scenarios).toHaveLength(1);
    expect(withBye.scenarios[0]!.outcomes).toEqual(['win']);
    t.rounds[2]!.matches[3] = { table: null, a: '4', b: null, result: { kind: 'forfeit' } };
    const forfeit = analyze(t, { playerId: '4' });
    expect(forfeit.scenarios[0]!.outcomes).toEqual(['loss']);
    t.rounds[2]!.matches[3] = { table: null, a: '4', b: null, result: null };
    expect(analyze(t, { playerId: '4' }).scenarios[0]!.outcomes).toEqual(['win']);
  });
});

describe('exhaustive result agrees with brute-force simulation', () => {
  it('matches independent full re-ranking on a 16-player event', () => {
    const t = synthetic(16, 3, { swissRounds: 4, topCut: 4, seed: 21 });
    // Post the final round using the engine's own prediction logic via analyze's nextOpponent is
    // not needed here: post simple pairings from the standings.
    const order = computeStandings(t).map((r) => r.playerId);
    const matches: Match[] = [];
    const left = [...order];
    while (left.length > 1) {
      const a = left.shift()!;
      matches.push({ table: matches.length + 1, a, b: left.shift()!, result: null });
    }
    t.rounds.push({ number: 4, status: 'in-progress', matches });
    const focus = order[3]!;
    const a = analyze(t, { playerId: focus, rivalIdRate: 0 });

    // Brute force: random results, recomputing standings from scratch.
    let seed = 99;
    const rnd = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const N = 3000;
    const hits = { win: 0, draw: 0, loss: 0 };
    for (const o of ['win', 'draw', 'loss'] as const) {
      for (let i = 0; i < N; i++) {
        const rounds = t.rounds.map((r) => ({ ...r }));
        rounds[3] = {
          ...rounds[3]!,
          matches: matches.map((m) => {
            const mine = m.a === focus || m.b === focus;
            let outcome: 'a' | 'b' | 'd';
            if (mine) outcome = o === 'draw' ? 'd' : (o === 'win') === (m.a === focus) ? 'a' : 'b';
            else outcome = rnd() < 0.5 ? 'a' : 'b';
            const short = rnd() < 0.5 ? 0 : 1;
            return {
              ...m,
              result:
                outcome === 'd'
                  ? { kind: 'games' as const, aWins: 0, bWins: 0, draws: 3 }
                  : outcome === 'a'
                    ? { kind: 'games' as const, aWins: 2, bWins: short, draws: 0 }
                    : { kind: 'games' as const, aWins: short, bWins: 2, draws: 0 },
            };
          }),
        };
        const rank = computeStandings({ ...t, rounds }).find((r) => r.playerId === focus)!.rank;
        if (rank <= 4) hits[o]++;
      }
    }
    for (const o of ['win', 'draw', 'loss'] as const) {
      const mine = a.scenarios.find((s) => s.outcomes[0] === o)!;
      const brute = hits[o] / N;
      expect(Math.abs(mine.probability - brute), `${o}: engine ${mine.probability} vs brute ${brute}`).toBeLessThan(0.05);
    }
  });
});

describe('scenarioStatus', () => {
  const sc = (probability: number, certainty: 'certain' | 'impossible' | 'estimated', outcomes: ('win' | 'draw' | 'loss')[]) => ({ probability, certainty, outcomes });
  it('applies the threshold rule in one place', () => {
    expect(scenarioStatus(sc(1, 'certain', ['loss']))).toBe('locked');
    expect(scenarioStatus(sc(0, 'impossible', ['win']))).toBe('out');
    expect(scenarioStatus(sc(0.95, 'estimated', ['draw']))).toBe('id-safe');
    expect(scenarioStatus(sc(0.95, 'estimated', ['win']))).toBe('win-and-in');
    expect(scenarioStatus(sc(0.5, 'estimated', ['draw']))).toBe('bubble');
    expect(scenarioStatus(sc(0.05, 'estimated', ['win']))).toBe('out');
  });

  it('paste mode needs 95% for an estimated ID SAFE; proven results and wins are unaffected', () => {
    expect(scenarioStatus(sc(0.92, 'estimated', ['draw']))).toBe('id-safe');
    expect(scenarioStatus(sc(0.92, 'estimated', ['draw']), PASTED_ID_SAFE_THRESHOLD)).toBe('bubble');
    expect(scenarioStatus(sc(0.95, 'estimated', ['draw']), PASTED_ID_SAFE_THRESHOLD)).toBe('id-safe');
    expect(scenarioStatus(sc(1, 'certain', ['draw']), PASTED_ID_SAFE_THRESHOLD)).toBe('locked');
    expect(scenarioStatus(sc(0.92, 'estimated', ['win']), PASTED_ID_SAFE_THRESHOLD)).toBe('win-and-in');
  });
});

describe('Day 2 events (over 128 players)', () => {
  it('are flagged as not modeled in the assumptions', () => {
    const t = truncated(fixtureTournament(), 5);
    const big = { ...t, playerCount: 200 };
    const a = analyze(big, { playerId: FOCUS });
    expect(a.assumptions[0]).toMatch(/^Not modeled: events over 128 players run a Day 2/);
  });

  it('single-day events carry no such warning', () => {
    const a = analyze(truncated(fixtureTournament(), 5), { playerId: FOCUS });
    expect(a.assumptions.some((s) => s.startsWith('Not modeled'))).toBe(false);
  });
});
