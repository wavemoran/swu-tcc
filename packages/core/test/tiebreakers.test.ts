import { describe, expect, it } from 'vitest';
import { computeStandings } from '../src/index.ts';
import { FULL_FIXTURES, fixtureTournament, readJson, swissRoundIds } from './helpers.ts';

describe.each(FULL_FIXTURES)('tiebreakers reproduce Melee on fixture %s', (id) => {
  const t = fixtureTournament(id);

  swissRoundIds(id).forEach((roundId, i) => {
    const round = i + 1;
    it(`through round ${round}`, () => {
      const melee = readJson(`standings-${roundId}.json`, id).data as any[];
      const mine = computeStandings(t, round);
      expect(mine.length).toBeGreaterThanOrEqual(melee.length);
      const byId = new Map(mine.map((r) => [r.playerId, r]));
      for (const row of melee) {
        const me = byId.get(String(row.Team.ID))!;
        const label = `${row.Team.Players[0].DisplayName} r${round}`;
        expect(me, label).toBeDefined();
        expect(me.rank, `${label} rank`).toBe(row.Rank);
        expect(me.points, `${label} points`).toBe(row.Points);
        expect(`${me.record.wins}-${me.record.losses}-${me.record.draws}`, `${label} match`).toBe(row.MatchRecord);
        expect(`${me.games.wins}-${me.games.losses}-${me.games.draws}`, `${label} games`).toBe(row.GameRecord);
        expect(me.omw, `${label} omw`).toBeCloseTo(row.OpponentMatchWinPercentage, 4);
        expect(me.gw, `${label} gw`).toBeCloseTo(row.TeamGameWinPercentage, 4);
        expect(me.ogw, `${label} ogw`).toBeCloseTo(row.OpponentGameWinPercentage, 4);
      }
    });
  });
});
