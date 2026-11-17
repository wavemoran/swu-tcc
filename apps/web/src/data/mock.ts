/**
 * Fixture-like mock data, modeled on the real case: tournament 484511
 * (Homeworlds Planetary Qualifier, 52 players, Swiss 6, top 8), where player
 * "Player 003" sits at 4-1-0 (12 pts, rank 6) before the final round and an ID
 * takes them to 13 pts.
 *
 * Used only when VITE_MOCK=1.
 * Statuses by rank (scaled by cut size): 1-3 LOCKED, 4-6 ID SAFE (Player 003),
 * 7-8 BUBBLE, 9-12 WIN & IN, 13+ OUT.
 */
import type {
  Analysis,
  AnalysisOptions,
  Outcome,
  Player,
  Scenario,
  StandingRow,
  Status,
  Tournament,
} from '@swu-tcc/core';
import { scenarioStatus } from '@swu-tcc/core';

export const MOCK_TOURNAMENT_ID = '484511';
export const MOCK_PLAYER_ID = 'p6';
const COMPLETED_ROUNDS = 5;

const NAMES = [
  'Ahsoka_T', 'kyloforce', 'DroidEngineer', 'mandoMike', 'zeb_orrelios', 'Player 003', 'padawan_pete',
  'chopper', 'sabine_w', 'GreedoShotFirst', 'wedge_a', 'cassian_k', 'bodhi_r', 'Jyn.Erso', 'Hera_S',
  'ezra_b', 'Thrawn', 'mon_mothma', 'lando_c', 'qira', 'cad_bane', 'bo_katan', 'hondo', 'maz_k',
  'Rex_501', 'cody', 'echo_b', 'hunter', 'tech_t', 'wrecker', 'omega', 'fennec_s', 'din_d', 'cara_d',
  'greef', 'migs_m', 'ig11', 'kuiil', 'peli', 'boba_f', 'krennic', 'tarkin', 'piett', 'veers',
  'ozzel', 'needa', 'jerjerrod', 'yularen', 'dodonna', 'ackbar', 'rieekan', 'madine',
];

const POINTS = [15, 15, 13, 13, 13, 12, 12, 12, 10, 10, 10, 10, 9, 9, 9, 9, 7, 7, 7, 7, 6, 6, 6, 6, 4, 4, 4, 4, 4, 3, 3, 3, 3, 3, 3, 3, 3, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0];

export function mockTournament(now = Date.now()): Tournament {
  const players: Player[] = NAMES.map((name, i) => ({ id: `p${i + 1}`, name, dropped: i >= 44 }));
  return {
    id: MOCK_TOURNAMENT_ID,
    source: 'melee',
    name: 'Homeworlds Planetary Qualifier',
    startDate: '2025-10-04T16:00:00Z',
    playerCount: 52,
    swissRounds: 6,
    topCut: 8,
    players,
    rounds: Array.from({ length: 6 }, (_, i) => ({
      number: i + 1,
      status: i < COMPLETED_ROUNDS ? ('completed' as const) : ('in-progress' as const),
      matches: [],
    })),
    scoring: { win: 3, draw: 1, loss: 0, percentageFloor: 1 / 3 },
    fetchedAt: new Date(now - 3 * 60_000).toISOString(),
  };
}

export function mockStandings(t: Tournament): StandingRow[] {
  return t.players.map((p, i) => {
    const points = POINTS[i] ?? 0;
    const wins = Math.floor(points / 3);
    const draws = points % 3;
    const losses = Math.max(0, COMPLETED_ROUNDS - wins - draws);
    const frac = (base: number) => Math.max(1 / 3, Math.min(0.75, base - i * 0.005));
    return {
      rank: i + 1,
      playerId: p.id,
      name: p.name,
      points,
      record: { wins, losses, draws },
      games: { wins: wins * 2 + draws, losses: losses * 2 + draws, draws: 0 },
      omw: frac(0.62),
      gw: frac(0.7 - i * 0.004),
      ogw: frac(0.6),
      dropped: p.dropped,
    };
  });
}

function statusForRank(rank: number, topCut: number): Status {
  const eff = (rank * 8) / topCut;
  if (eff <= 3) return 'locked';
  if (eff <= 6) return 'id-safe';
  if (eff <= 8) return 'bubble';
  if (eff <= 12) return 'win-and-in';
  return 'out';
}

type Base = Record<Outcome, { p: number; certainty: Scenario['certainty'] }>;
const est = (p: number) => ({ p, certainty: 'estimated' as const });
const BASE: Record<Status, Base> = {
  locked: {
    win: { p: 1, certainty: 'certain' },
    draw: { p: 1, certainty: 'certain' },
    loss: { p: 1, certainty: 'certain' },
  },
  'id-safe': { win: est(0.999), draw: est(0.94), loss: est(0.31) },
  bubble: { win: est(0.86), draw: est(0.41), loss: est(0.004) },
  'win-and-in': { win: est(0.83), draw: est(0.22), loss: est(0.002) },
  out: {
    win: { p: 0, certainty: 'impossible' },
    draw: { p: 0, certainty: 'impossible' },
    loss: { p: 0, certainty: 'impossible' },
  },
};

const PTS: Record<Outcome, number> = { win: 3, draw: 1, loss: 0 };

function combos(depth: number): Outcome[][] {
  const order: Outcome[] = ['win', 'draw', 'loss'];
  if (depth <= 0) return [[]];
  const out: Outcome[][] = [];
  for (const a of order) {
    if (depth === 1) out.push([a]);
    else for (const b of order) out.push([a, b]);
  }
  return out;
}

function summaryFor(status: Status, current: StandingRow, topCut: number, pctText: string, idPoints: number): string {
  switch (status) {
    case 'locked':
      return `You're in. Even a loss leaves you inside the top ${topCut}.`;
    case 'id-safe':
      return `You're ID SAFE: an intentional draw (ID) puts you at ${idPoints} match points, which made top ${topCut} in ${pctText} of simulated finishes.`;
    case 'bubble':
      return `On the bubble: ${current.points} match points sits near the cut, so tiebreakers and other tables decide. A win gives the best odds.`;
    case 'win-and-in':
      return `Win and you're likely in. A draw probably isn't enough to make top ${topCut}.`;
    case 'out':
      return `You can't reach the top ${topCut} from here, even with a win.`;
  }
}

/** Mock replacement for core's `analyze`, shaped like the real Analysis. */
export function mockAnalyze(t: Tournament, options: AnalysisOptions): Analysis {
  const topCut = options.topCut ?? t.topCut;
  const swissRounds = options.swissRounds ?? t.swissRounds;
  const standings = mockStandings(t);
  const current = standings.find((r) => r.playerId === options.playerId) ?? standings[0]!;
  const roundsRemaining = Math.max(0, swissRounds - COMPLETED_ROUNDS);
  const status = statusForRank(current.rank, topCut);
  const base = BASE[status];

  const scenarios: Scenario[] = combos(Math.min(roundsRemaining, 2)).map((outcomes) => {
    const pts = outcomes.reduce((n, o) => n + PTS[o], 0);
    const record = { ...current.record };
    for (const o of outcomes) {
      if (o === 'win') record.wins++;
      else if (o === 'draw') record.draws++;
      else record.losses++;
    }
    let probability: number;
    let certainty: Scenario['certainty'];
    if (outcomes.length === 0) {
      ({ p: probability, certainty } = base.win);
    } else if (status === 'locked' || status === 'out') {
      ({ p: probability, certainty } = base[outcomes[0]!]);
    } else {
      probability = Math.min(0.995, outcomes.reduce((s, o) => s + base[o].p, 0) / outcomes.length);
      certainty = 'estimated';
    }
    return {
      outcomes,
      finalRecord: record,
      finalPoints: current.points + pts,
      probability,
      certainty,
      status: scenarioStatus({ outcomes, probability, certainty }),
      bestRank: Math.max(1, current.rank - 3 - pts),
      worstRank: current.rank + 8 - pts,
    };
  });

  const idScenario =
    scenarios.find((s) => s.outcomes.length === 1 && s.outcomes[0] === 'draw') ?? scenarios[0]!;
  const winScenario = scenarios[0]!;
  const headline = roundsRemaining === 1 ? idScenario : winScenario;
  const pctText = `${Math.round(headline.probability * 100)}%`;

  const partnerRank = current.rank % 2 === 1 ? current.rank + 1 : current.rank - 1;
  const partner = standings[partnerRank - 1];

  return {
    dataMode: 'full',
    tournamentId: t.id,
    playerId: current.playerId,
    current,
    currentStandings: standings,
    topCut,
    swissRounds,
    roundsRemaining,
    nextOpponent:
      roundsRemaining > 0 && partner
        ? { playerId: partner.playerId, name: partner.name, predicted: current.playerId !== MOCK_PLAYER_ID }
        : null,
    scenarios,
    verdict: {
      status,
      probability: headline.probability,
      certainty: headline.certainty,
      basis: status === 'locked' ? 'loss' : headline === idScenario && roundsRemaining === 1 ? 'draw' : 'win',
      summary: summaryFor(status, current, topCut, pctText, idScenario.finalPoints),
    },
    assumptions: [
      'Mock data: these numbers are illustrative, not computed.',
      'Other tables are 50/50 (a draw counts as half).',
      'Final-round pairings follow standings: 1 v 2, 3 v 4, and so on, avoiding rematches.',
      'Pairs that can both ID into the cut do so half the time.',
      'Dropped players cannot make the cut but still count in tiebreakers.',
    ],
    method:
      status === 'locked' || status === 'out'
        ? { kind: 'exhaustive', samples: 729, seed: 1 }
        : { kind: 'monte-carlo', samples: options.simulations ?? 5000, seed: options.seed ?? 1 },
  };
}

/** One representative player per status, for the mock-mode state picker. */
export const MOCK_STATE_PLAYERS: { status: Status; playerId: string; label: string }[] = [
  { status: 'locked', playerId: 'p1', label: 'Ahsoka_T (rank 1)' },
  { status: 'id-safe', playerId: MOCK_PLAYER_ID, label: 'Player 003 (rank 6)' },
  { status: 'bubble', playerId: 'p8', label: 'chopper (rank 8)' },
  { status: 'win-and-in', playerId: 'p10', label: 'GreedoShotFirst (rank 10)' },
  { status: 'out', playerId: 'p29', label: 'tech_t (rank 29)' },
];
