/**
 * The contract between the three parts of SWU TCC. Change it deliberately:
 *
 *   apps/worker   fetches Melee.gg and returns the `Proxy*` shapes below
 *   packages/core turns those into a `Tournament`, then computes `Analysis`
 *   apps/web      calls the worker, then calls core, then renders `Analysis`
 *
 * Core is pure TypeScript with no network or DOM access, so the analysis runs
 * in the visitor's browser. That keeps the worker's CPU time (and therefore our
 * Cloudflare bill) close to zero.
 */

// ---------------------------------------------------------------------------
// Worker API (apps/worker). All responses are JSON. Errors are `ProxyError`.
// ---------------------------------------------------------------------------

/** GET /api/tournaments/:tournamentId */
export interface ProxyTournament {
  id: number;
  name: string;
  /** ISO date-time, from the page's start-date `data-value`, if present. */
  startDate: string | null;
  /** Raw headline text such as "Ended | 52 of 88 Enrolled Players". */
  statusText: string | null;
  /** Every round on the page, in page order (Swiss rounds, then playoffs). */
  rounds: ProxyRound[];
  /** Body of Melee's /Standing/GetStandingsConfig/:id, passed through as-is. */
  standingsConfig: unknown;
  /** When the worker fetched this from Melee (ISO). Used for the sync pill. */
  fetchedAt: string;
  /**
   * Which upstream produced this: Melee's website endpoints ('site') or the
   * official credentialed API ('api'). Also sent as the `x-tcc-source` header.
   */
  source: 'site' | 'api';
}

export interface ProxyRound {
  id: number;
  name: string; // "Round 1" ... "Quarterfinals", "Semifinals", "Finals"
  started: boolean;
  completed: boolean;
  /**
   * Set by the worker from the round name: `Round N` is 'swiss'; Quarterfinals,
   * Semifinals, Finals, Top N and Round of N are 'playoff'. Clients (and core's
   * fromMelee, as one signal after Melee's own matching-method label) use it
   * instead of re-parsing names.
   */
  kind: 'swiss' | 'playoff';
}

/**
 * GET /api/rounds/:roundId/standings  -> Melee's GetRoundStandings body, verbatim
 * GET /api/rounds/:roundId/matches    -> Melee's GetRoundMatches body, verbatim
 *
 * The worker streams these through without parsing (CPU budget). Their shape is
 * `MeleeDataTable<MeleeStandingRow>` / `MeleeDataTable<MeleeMatch>`, typed in
 * packages/core/src/melee/raw.ts from the fixtures in fixtures/melee/.
 * Every proxy response also carries the header `x-tcc-fetched-at` (ISO).
 */

export interface ProxyError {
  /**
   * `not_authorized`: the official Melee API refused our credentials for this
   * tournament (401/403): usually it is a tournament our account has no staff
   * access to. `disabled` is also used (503) when api mode has no credentials.
   * `misconfigured`: the worker's MELEE_ORIGIN var is not an allowed origin (500).
   */
  error: 'not_found' | 'bad_request' | 'upstream_error' | 'rate_limited' | 'disabled' | 'not_authorized' | 'misconfigured';
  message: string;
}

// ---------------------------------------------------------------------------
// Normalized model (packages/core). Source-agnostic: Melee today, manual entry
// or other sites later.
// ---------------------------------------------------------------------------

export type PlayerId = string;

export interface Tournament {
  id: string;
  source: 'melee' | 'manual';
  name: string;
  startDate: string | null;
  /** Players who played round 1 (byes count). Drives the CEG rounds/cut table. */
  playerCount: number;
  /** Planned number of Swiss rounds (from the page, else CEG App. D; user can override). */
  swissRounds: number;
  /** Top cut size: 4, 8, 16 or 32 (from playoff round names, else CEG App. D; user can override). */
  topCut: number;
  players: Player[];
  /** Swiss rounds only, ascending by number. Playoff rounds are dropped. */
  rounds: Round[];
  scoring: Scoring;
  fetchedAt: string | null;
}

export interface Player {
  id: PlayerId;
  name: string;
  /** True if the player dropped or was disqualified; never paired again, never makes the cut. */
  dropped: boolean;
}

export interface Scoring {
  win: number; // 3
  draw: number; // 1
  loss: number; // 0
  /** Minimum value for every percentage tiebreaker. Melee: 1/3. */
  percentageFloor: number;
}

export interface Round {
  number: number; // 1-based
  status: 'not-started' | 'in-progress' | 'completed';
  /** Empty when pairings are not posted yet. */
  matches: Match[];
}

export interface Match {
  table: number | null;
  a: PlayerId;
  /** null for a bye or a single-player forfeit. */
  b: PlayerId | null;
  /** null while the match is still being played. */
  result: MatchResult | null;
}

export type MatchResult =
  /** Games won by a and b, and drawn games. An ID is { aWins: 0, bWins: 0, draws: 3 }. */
  | { kind: 'games'; aWins: number; bWins: number; draws: number }
  /** Player a received a bye (a match win). */
  | { kind: 'bye' }
  /** Player a forfeited or was a no-show with no opponent recorded (a match loss). */
  | { kind: 'forfeit' };

// ---------------------------------------------------------------------------
// Standings and analysis (packages/core)
// ---------------------------------------------------------------------------

export interface StandingRow {
  rank: number;
  playerId: PlayerId;
  name: string;
  points: number;
  record: { wins: number; losses: number; draws: number };
  games: { wins: number; losses: number; draws: number };
  /** Fractions 0..1, floored per `Scoring.percentageFloor`. */
  omw: number;
  gw: number;
  ogw: number;
  dropped: boolean;
}

export type Outcome = 'win' | 'draw' | 'loss';

/** Matches DESIGN.md: LOCKED / ID SAFE / BUBBLE / WIN & IN / OUT. */
export type Status = 'locked' | 'id-safe' | 'bubble' | 'win-and-in' | 'out';

export interface AnalysisOptions {
  playerId: PlayerId;
  /** Override Tournament.topCut / swissRounds (what-if). */
  topCut?: number;
  swissRounds?: number;
  /** Monte Carlo samples where exhaustive enumeration is too large. Default 5000. */
  simulations?: number;
  /** RNG seed so results are reproducible (tests, shared links). */
  seed?: number;
  /**
   * Chance that another final-round match between two players who could both
   * ID into the cut ends in an ID. Default 0.5 for "safe" pairs, otherwise 0.
   */
  rivalIdRate?: number;
  /** Win probability assumed for other tables. Default 0.5 (stated in assumptions). */
  otherTableWinRate?: number;
}

/** One line per possible result path for the player's remaining rounds. */
export interface Scenario {
  /** One entry per remaining Swiss round, e.g. ['draw'] or ['win', 'draw']. */
  outcomes: Outcome[];
  finalRecord: { wins: number; losses: number; draws: number };
  finalPoints: number;
  /** Probability 0..1 of finishing inside the cut given these outcomes. */
  probability: number;
  /** 'certain' only when proven by enumeration (never round an estimate to 100%). */
  certainty: 'certain' | 'impossible' | 'estimated';
  /**
   * Computed in core by `scenarioStatus`: LOCKED if proven in, OUT if proven
   * out, else by probability (>= 0.9 is ID SAFE if the path includes a draw,
   * otherwise WIN & IN; >= 0.1 is BUBBLE; below is OUT). UIs show it, not re-derive it.
   */
  status: Status;
  /** Best and worst final rank seen across enumerated/simulated outcomes. */
  bestRank: number;
  worstRank: number;
}

export interface Analysis {
  /**
   * 'full' when computed from the whole event history (`analyze`); 'pasted'
   * when computed from a copied standings table only (`analyzePasted`), which
   * freezes or approximates the tiebreakers (see the assumptions list).
   */
  dataMode: 'full' | 'pasted';
  tournamentId: string;
  playerId: PlayerId;
  current: StandingRow;
  currentStandings: StandingRow[];
  topCut: number;
  swissRounds: number;
  roundsRemaining: number;
  /** The final-round pairing the player is in (posted or predicted), if known. */
  nextOpponent: { playerId: PlayerId; name: string; predicted: boolean } | null;
  scenarios: Scenario[];
  verdict: {
    status: Status;
    /** Probability for the headline; see `basis` for which scenario it comes from. */
    probability: number;
    certainty: Scenario['certainty'];
    /**
     * Which scenario the headline probability comes from: 'loss' when locked
     * (even losing makes it), 'draw' when ID safe, otherwise 'win'.
     */
    basis: 'loss' | 'draw' | 'win';
    /** Plain-English line for the verdict panel. */
    summary: string;
  };
  /** Shown under "assumptions" (DESIGN.md rule 4: honest odds). */
  assumptions: string[];
  method: { kind: 'exhaustive' | 'monte-carlo'; samples: number; seed: number };
}

// ---------------------------------------------------------------------------
// Paste mode: what a player can copy from Melee's standings page
// ---------------------------------------------------------------------------

export interface PastedRow {
  rank: number;
  name: string;
  points: number;
  record: { wins: number; losses: number; draws: number };
  /** Only when the copied table shows a game record. */
  games?: { wins: number; losses: number; draws: number };
  /** Fractions 0..1 as displayed (OMW%, GW%, OGW%). Floored at 1/3 by the engine. */
  omw: number;
  gw: number;
  ogw: number;
  dropped?: boolean;
}

export interface PastedStandings {
  /** Top cut size; defaults to the AnalysisOptions value, else 8 (stated in assumptions). */
  topCut?: number;
  /** Planned Swiss rounds; defaults to roundsPlayed + 1 (the final round is next). */
  swissRounds?: number;
  roundsPlayed: number;
  /** The whole table, every player (not just the top of it). */
  rows: PastedRow[];
  /** Posted pairings for the next round by player name (b null = bye), if known. */
  nextRound?: { a: string; b: string | null }[];
}

/** Which tiebreaker approximation `analyzePasted` uses (see src/pasted.ts). */
export type PastedVariant = 'A' | 'B' | 'C';

export type PastedAnalysisOptions = Omit<AnalysisOptions, 'playerId'> & {
  playerName: string;
  /** Default 'C'. */
  variant?: PastedVariant;
};

/**
 * Public API of @swu-tcc/core (implemented in src/index.ts):
 *
 *   fromMelee(input: {
 *     tournament: ProxyTournament;
 *     standings: Record<number, unknown>;   // roundId -> GetRoundStandings body
 *     matches: Record<number, unknown>;     // roundId -> GetRoundMatches body
 *   }): Tournament
 *
 *   computeStandings(t: Tournament, throughRound?: number): StandingRow[]
 *   analyze(t: Tournament, options: AnalysisOptions): Analysis
 *   analyzePasted(input: PastedStandings, options: PastedAnalysisOptions): Analysis
 *   scenarioStatus(s: Scenario): Status   // the single threshold rule
 *   defaultStructure(playerCount: number): { swissRounds: number; topCut: number }
 */
