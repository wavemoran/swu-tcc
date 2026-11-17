import { describe, expect, it } from 'vitest';
import { analyzePasted } from '../src/index.ts';
import type { PastedRow, PastedStandings } from '../src/index.ts';

function row(rank: number, name: string, points: number, extra: Partial<PastedRow> = {}): PastedRow {
  return {
    rank,
    name,
    points,
    record: { wins: points / 3, losses: 0, draws: 0 },
    omw: 0.5,
    gw: 0.6,
    ogw: 0.5,
    ...extra,
  };
}

function field(points: number[], extra: Partial<PastedStandings> = {}): PastedStandings {
  return {
    topCut: 2,
    swissRounds: 4,
    roundsPlayed: 3,
    rows: points.map((p, i) => row(i + 1, `P${i + 1}`, p)),
    ...extra,
  };
}

describe('analyzePasted', () => {
  it('marks the analysis as pasted and proves a lock from points alone', () => {
    const a = analyzePasted(field([9, 3, 3, 3, 0, 0]), { playerName: 'P1' });
    expect(a.dataMode).toBe('pasted');
    expect(a.verdict.status).toBe('locked');
    expect(a.scenarios.every((s) => s.certainty === 'certain')).toBe(true);
    expect(a.assumptions.join(' ')).toMatch(/rematch/i);
  });

  it('proves a player out when enough players are already ahead', () => {
    const a = analyzePasted(field([9, 9, 6, 0, 0, 0]), { playerName: 'P6' });
    expect(a.scenarios.every((s) => s.certainty === 'impossible')).toBe(true);
  });

  it('uses posted pairings and reports the opponent as not predicted', () => {
    const input = field([6, 6, 6, 6, 3, 3], { nextRound: [{ a: 'P1', b: 'P4' }, { a: 'P2', b: 'P3' }, { a: 'P5', b: 'P6' }] });
    const a = analyzePasted(input, { playerName: 'P1' });
    expect(a.nextOpponent).toEqual({ playerId: 'P4', name: 'P4', predicted: false });
    const b = analyzePasted({ ...input, nextRound: undefined }, { playerName: 'P1' });
    expect(b.nextOpponent?.name).toBe('P2');
    expect(b.nextOpponent?.predicted).toBe(true);
  });

  it('never claims certainty for a draw that depends on tiebreakers', () => {
    // Four players on 6 points, top 2: a draw gives 7 and others can still reach 9.
    const a = analyzePasted(field([6, 6, 6, 6, 0, 0]), { playerName: 'P2' });
    const draw = a.scenarios.find((s) => s.outcomes[0] === 'draw')!;
    expect(draw.certainty).toBe('estimated');
    expect(draw.probability).toBeLessThan(1);
  });

  it('gives a rough points-only answer when more than one round remains', () => {
    const a = analyzePasted(field([6, 6, 3, 3, 0, 0], { roundsPlayed: 2 }), { playerName: 'P3' });
    expect(a.roundsRemaining).toBe(2);
    expect(a.method.kind).toBe('monte-carlo');
    expect(a.assumptions.join(' ')).toMatch(/full match data/);
    expect(a.scenarios).toHaveLength(9);
  });

  it('treats a dropped player as out', () => {
    const input = field([6, 6, 6, 3]);
    input.rows[2]!.dropped = true;
    const a = analyzePasted(input, { playerName: 'P3' });
    expect(a.verdict.status).toBe('out');
  });
});
