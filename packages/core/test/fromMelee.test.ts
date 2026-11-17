import { describe, expect, it } from 'vitest';
import { analyze, computeStandings, defaultStructure, fromMelee } from '../src/index.ts';
import { MeleeShapeError, parseMatches, parseStandings } from '../src/melee/raw.ts';
import { playoffSizeFromName } from '../src/melee/fromMelee.ts';
import { fixtureInput, fixtureTournament, proxyRounds } from './helpers.ts';
import { synthetic } from './synthetic.ts';

describe('fromMelee on fixture 484511', () => {
  const t = fixtureTournament();

  it('builds the tournament header', () => {
    expect(t.id).toBe('484511');
    expect(t.source).toBe('melee');
    expect(t.playerCount).toBe(52);
    expect(t.swissRounds).toBe(6);
    expect(t.topCut).toBe(8);
    expect(t.players).toHaveLength(52);
    expect(t.scoring).toEqual({ win: 3, draw: 1, loss: 0, percentageFloor: 1 / 3 });
  });

  it('keeps Swiss rounds only, in order', () => {
    expect(t.rounds.map((r) => r.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(t.rounds.every((r) => r.status === 'completed')).toBe(true);
    expect(t.rounds[5]!.matches).toHaveLength(21);
  });

  it('uses TeamId as the player id and DisplayName as the name', () => {
    const focus = t.players.find((p) => p.id === '5003')!;
    expect(focus.name).toBe('Player 003');
    expect(focus.dropped).toBe(false);
  });

  it('flags dropped players', () => {
    expect(t.players.find((p) => p.name === 'Player 014')!.dropped).toBe(true);
    expect(t.players.find((p) => p.name === 'Player 001')!.dropped).toBe(false);
  });

  it('records byes and forfeits', () => {
    const r1 = t.rounds[0]!.matches.filter((m) => m.b === null);
    expect(r1.map((m) => m.result?.kind).sort()).toEqual(['bye', 'forfeit']);
    expect(r1.find((m) => m.result?.kind === 'forfeit')!.a).toBe('5052');
  });

  it('records an ID as 0-0-3', () => {
    const m = t.rounds[5]!.matches.find((x) => x.a === '5003' || x.b === '5003')!;
    expect(m.result).toEqual({ kind: 'games', aWins: 0, bWins: 0, draws: 3 });
  });

  it('maps unreported matches to a null result and round status from the proxy', () => {
    const input = fixtureInput();
    const last = input.tournament.rounds.find((r) => r.id === 1749836)!;
    last.completed = false;
    const body = structuredClone(input.matches[1749836]) as any;
    body.data[0].HasResult = false;
    input.matches[1749836] = body;
    const t2 = fromMelee(input);
    expect(t2.rounds[5]!.status).toBe('in-progress');
    expect(t2.rounds[5]!.matches[0]!.result).toBeNull();
    last.started = false;
    expect(fromMelee(input).rounds[5]!.status).toBe('not-started');
  });

  it('reads the top cut from the first playoff round name', () => {
    const input = fixtureInput();
    const qf = input.tournament.rounds.find((r) => r.name === 'Quarterfinals')!;
    qf.name = 'Round of 16';
    // Without standings the classifier falls back to the name.
    delete input.standings[qf.id];
    expect(fromMelee(input).topCut).toBe(16);
    qf.name = 'Semifinals';
    expect(fromMelee(input).topCut).toBe(4);
  });

  it('falls back to the CEG structure when there are no playoff rounds', () => {
    const input = fixtureInput();
    input.tournament.rounds = input.tournament.rounds.filter((r) => /^Round \d$/.test(r.name));
    const t2 = fromMelee(input);
    expect(t2.topCut).toBe(8);
    expect(t2.swissRounds).toBe(6);
  });

  it('uses at least the CEG round count and tolerates missing data', () => {
    const input = fixtureInput();
    input.tournament.rounds = input.tournament.rounds.filter((r) => ['Round 1', 'Round 2'].includes(r.name));
    input.standings = {};
    input.matches = { [1725211]: input.matches[1725211]! };
    input.tournament.standingsConfig = null;
    const t2 = fromMelee(input);
    expect(t2.swissRounds).toBe(6);
    expect(t2.rounds).toHaveLength(2);
    expect(t2.rounds[1]!.matches).toEqual([]);
    expect(t2.scoring.percentageFloor).toBeCloseTo(1 / 3);
  });

  it('counts round-1 players from standings when pairings are missing', () => {
    const input = fixtureInput();
    input.matches = {};
    expect(fromMelee(input).playerCount).toBe(52);
  });
});

describe('fromMelee shape checks', () => {
  it('throws a clear error on a bad body', () => {
    const input = fixtureInput();
    input.standings[1725211] = { nope: true };
    expect(() => fromMelee(input)).toThrow(/standings for round 1725211/);
    input.standings[1725211] = 'nope';
    expect(() => fromMelee(input)).toThrow(MeleeShapeError);
  });

  it('validates rows and matches', () => {
    expect(() => parseStandings({ data: [1] })).toThrow(/row should be an object/);
    expect(() => parseStandings({ data: [{ Team: { ID: 1 } }] })).toThrow(/StatusDescription/);
    expect(() => parseStandings({ data: [{ Team: { ID: 1, StatusDescription: 'x' } }] })).toThrow(/Players/);
    expect(() => parseStandings({ data: [{ Team: { ID: 1, StatusDescription: 'x', Players: [] } }] })).toThrow(/Rank/);
    expect(() => parseStandings({ data: [{ Team: 5 }] })).toThrow(/Team should be an object/);
    expect(() => parseMatches({ data: [{ Competitors: [] }] })).toThrow(/Competitors/);
    expect(() => parseMatches({ data: [{ Competitors: [5] }] })).toThrow(/competitor/);
    const team = { ID: 1, StatusDescription: 'Active', Players: [] };
    expect(() => parseMatches({ data: [{ Competitors: [{ Team: team }] }] })).toThrow(/HasResult/);
    expect(parseMatches({ data: [{ Competitors: [{ Team: team }], HasResult: true }] }).recordsTotal).toBe(1);
  });
});

describe('structure helpers', () => {
  it('follows CEG Appendix D', () => {
    expect(defaultStructure(5)).toEqual({ swissRounds: 3, topCut: 4 });
    expect(defaultStructure(9)).toEqual({ swissRounds: 4, topCut: 4 });
    expect(defaultStructure(16)).toEqual({ swissRounds: 4, topCut: 4 });
    expect(defaultStructure(17)).toEqual({ swissRounds: 5, topCut: 8 });
    expect(defaultStructure(32)).toEqual({ swissRounds: 5, topCut: 8 });
    expect(defaultStructure(52)).toEqual({ swissRounds: 6, topCut: 8 });
    expect(defaultStructure(65)).toEqual({ swissRounds: 7, topCut: 8 });
    expect(defaultStructure(128)).toEqual({ swissRounds: 7, topCut: 8 });
    expect(defaultStructure(300)).toEqual({ swissRounds: 8, topCut: 8 });
  });

  it('parses playoff round names', () => {
    expect(playoffSizeFromName('Quarterfinals')).toBe(8);
    expect(playoffSizeFromName('Semifinals')).toBe(4);
    expect(playoffSizeFromName('Finals')).toBe(2);
    expect(playoffSizeFromName('Top 16')).toBe(16);
    expect(playoffSizeFromName('Round of 32')).toBe(32);
    expect(playoffSizeFromName('Round 3')).toBeNull();
  });
});

describe('ProxyRound.kind', () => {
  it('is used as a signal when Melee gives no matching-method label', () => {
    const input = fixtureInput();
    const stripped = { ...input, standings: {}, matches: {} };
    // A playoff-kind round with a Swiss-looking name is still treated as playoff.
    const rounds = input.tournament.rounds.map((r) => (r.name === 'Round 6' ? { ...r, kind: 'playoff' as const } : r));
    const t = fromMelee({ ...stripped, tournament: { ...input.tournament, rounds } });
    expect(t.rounds).toHaveLength(5);
  });
});

describe('fromMelee structure across fixtures', () => {
  // id -> [playerCount, swissRounds, topCut, dropped?]. 493469 played a top 8 with only
  // 4 Swiss rounds (CompetitiveHub lists it as top 4); the cut must come from Melee's
  // Quarterfinals round, not from CEG Appendix D (which says top 4 for 9-16 players).
  const expected: Record<string, [number, number, number]> = {
    '484511': [52, 6, 8],
    '493469': [12, 4, 8],
    '464438': [26, 5, 8],
    '484355': [33, 6, 8],
    '465966': [63, 6, 8],
    '505142': [64, 6, 8], // Limited format
    '504384': [69, 7, 8],
    '504989': [70, 7, 8],
  };

  it.each(Object.entries(expected))('fixture %s', (id, [players, swiss, cut]) => {
    const t = fromMelee(fixtureInputFor(id));
    expect(t.playerCount).toBe(players);
    expect(t.swissRounds).toBe(swiss);
    expect(t.topCut).toBe(cut);
    expect(t.rounds).toHaveLength(swiss);
    expect(t.rounds.every((r) => r.status === 'completed')).toBe(true);
    // Every Swiss round pairs every player who played it exactly once.
    for (const r of t.rounds) {
      const ids = r.matches.flatMap((m) => (m.b ? [m.a, m.b] : [m.a]));
      expect(new Set(ids).size).toBe(ids.length);
    }
    expect(computeStandings(t)).toHaveLength(t.players.length);
  });

  it('León (493469): a 12-player event with a top 8 is not a CEG top 4', () => {
    expect(defaultStructure(12).topCut).toBe(4);
    expect(fromMelee(fixtureInputFor('493469')).topCut).toBe(8);
  });

  it('Baltimore (498211, 484 players, Day 2): page only', () => {
    const rounds = proxyRounds('498211');
    expect(rounds.filter((r) => r.kind === 'swiss')).toHaveLength(12);
    expect(rounds.filter((r) => r.kind === 'playoff').map((r) => r.name)).toEqual(['Quarterfinals', 'Semifinals', 'Finals']);
    const base = fixtureInputFor('498211', true);
    const t = fromMelee({ ...base, standings: {}, matches: {} });
    expect(t.swissRounds).toBe(12);
    expect(t.topCut).toBe(8);
    expect(t.rounds).toHaveLength(12);
    expect(t.players).toHaveLength(0);
    // Analysis needs players, so build a synthetic event and give it Baltimore's size.
    const syn = { ...synthetic(40, 11, { swissRounds: 12, topCut: 8, seed: 5 }), playerCount: 484 };
    const a = analyze(syn, { playerId: computeStandings(syn)[0]!.playerId, simulations: 300 });
    expect(a.assumptions[0]).toMatch(/^Not modeled: events over 128 players/);
  });
});

function fixtureInputFor(id: string, pageOnly = false) {
  if (!pageOnly) return fixtureInput(id);
  const tournament = { ...fixtureInput('484511').tournament, id: Number(id), rounds: proxyRounds(id) };
  return { tournament, standings: {}, matches: {} };
}
