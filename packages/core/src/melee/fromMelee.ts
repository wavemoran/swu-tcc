import type { Match, MatchResult, Player, ProxyRound, ProxyTournament, Round, Scoring, Tournament } from '../contract.ts';
import { defaultStructure } from '../structure.ts';
import {
  type MeleeDataTable,
  type MeleeMatch,
  type MeleeStandingRow,
  type MeleeTeam,
  MeleeShapeError,
  parseMatches,
  parseStandings,
} from './raw.ts';

export interface MeleeInput {
  tournament: ProxyTournament;
  standings: Record<number, unknown>;
  matches: Record<number, unknown>;
}

/** Playoff round names -> size of the bracket that round starts with. */
export function playoffSizeFromName(name: string): number | null {
  const n = name.trim().toLowerCase();
  if (n.startsWith('quarter')) return 8;
  if (n.startsWith('semi')) return 4;
  if (n === 'finals' || n === 'final') return 2;
  let m = /^top\s*(\d+)$/.exec(n);
  if (m) return Number(m[1]);
  m = /^round of (\d+)$/.exec(n);
  if (m) return Number(m[1]);
  return null;
}

function isPlayoffName(name: string): boolean {
  return playoffSizeFromName(name) !== null;
}

function isSwissName(name: string): boolean {
  return /^round\s*\d+$/i.test(name.trim());
}

/** Swiss vs playoff, from Melee's own labels first, then the round name. */
function classify(round: ProxyRound, st: MeleeDataTable<MeleeStandingRow> | undefined, mt: MeleeDataTable<MeleeMatch> | undefined) {
  const method = st?.data[0]?.MatchingMethodDescription;
  if (method) {
    if (/swiss/i.test(method)) return 'swiss' as const;
    if (/playoff|top cut|single|elimination/i.test(method)) return 'playoff' as const;
  }
  void mt;
  if (round.kind) return round.kind;
  if (isPlayoffName(round.name)) return 'playoff' as const;
  if (isSwissName(round.name)) return 'swiss' as const;
  // Unknown label: treat as Swiss only if it is not obviously a bracket round.
  return 'swiss' as const;
}

function playerName(team: MeleeTeam): string {
  const p = team.Players[0];
  const name = p?.DisplayName?.trim() || p?.Username?.trim();
  return name || `Team ${team.ID}`;
}

function isDroppedStatus(status: string): boolean {
  return /dropped|disqualified|no show/i.test(status);
}

function parseFraction(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string') return null;
  const m = /^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/.exec(v);
  if (m) {
    const d = Number(m[2]);
    return d === 0 ? null : Number(m[1]) / d;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function scoringFrom(config: unknown): Scoring {
  const s: Scoring = { win: 3, draw: 1, loss: 0, percentageFloor: 1 / 3 };
  if (typeof config === 'object' && config !== null) {
    const f = parseFraction((config as Record<string, unknown>).Tiebreaker1FallbackPercentage);
    if (f !== null && f > 0 && f < 1) s.percentageFloor = f;
  }
  return s;
}

function convertMatch(m: MeleeMatch): Match {
  const table = typeof m.TableNumber === 'number' ? m.TableNumber : null;
  const [ca, cb] = m.Competitors;
  const a = String(ca!.Team.ID);
  if (cb) {
    const result: MatchResult | null = m.HasResult
      ? { kind: 'games', aWins: ca!.GameWins ?? 0, bWins: cb.GameWins ?? 0, draws: m.GameDraws ?? 0 }
      : null;
    return { table, a, b: String(cb.Team.ID), result };
  }
  let result: MatchResult | null = null;
  if (m.HasResult) {
    const isBye = !!m.ByeReasonDescription || /\bbye\b/i.test(m.ResultString ?? '');
    result = isBye ? { kind: 'bye' } : { kind: 'forfeit' };
  }
  return { table, a, b: null, result };
}

export function fromMelee(input: MeleeInput): Tournament {
  const pt = input.tournament;
  const where = (kind: string, id: number) => `${kind} for round ${id}`;
  const standings = new Map<number, MeleeDataTable<MeleeStandingRow>>();
  const matches = new Map<number, MeleeDataTable<MeleeMatch>>();
  for (const r of pt.rounds) {
    const s = input.standings[r.id];
    if (s !== undefined && s !== null) standings.set(r.id, parseStandings(s, where('standings', r.id)));
    const m = input.matches[r.id];
    if (m !== undefined && m !== null) matches.set(r.id, parseMatches(m, where('matches', r.id)));
  }
  if (!Array.isArray(pt.rounds)) throw new MeleeShapeError('tournament', '"rounds" should be an array');

  const swiss: ProxyRound[] = [];
  const playoff: ProxyRound[] = [];
  for (const r of pt.rounds) {
    (classify(r, standings.get(r.id), matches.get(r.id)) === 'swiss' ? swiss : playoff).push(r);
  }

  // Players: union of every standings row and match competitor.
  const players = new Map<string, Player>();
  const seen = (team: MeleeTeam) => {
    const id = String(team.ID);
    const dropped = isDroppedStatus(team.StatusDescription);
    const p = players.get(id);
    if (p) {
      if (dropped) p.dropped = true;
    } else players.set(id, { id, name: playerName(team), dropped });
  };
  for (const r of pt.rounds) {
    for (const row of standings.get(r.id)?.data ?? []) seen(row.Team);
    for (const m of matches.get(r.id)?.data ?? []) for (const c of m.Competitors) seen(c.Team);
  }

  const rounds: Round[] = swiss.map((r, i) => ({
    number: i + 1,
    status: r.completed ? 'completed' : r.started ? 'in-progress' : 'not-started',
    matches: (matches.get(r.id)?.data ?? []).map(convertMatch),
  }));

  // Players who played round 1 (byes count).
  const first = rounds[0];
  let playerCount = players.size;
  if (first && first.matches.length > 0) {
    const ids = new Set<string>();
    for (const m of first.matches) {
      ids.add(m.a);
      if (m.b) ids.add(m.b);
    }
    playerCount = ids.size;
  } else if (swiss[0] && standings.get(swiss[0].id)) {
    playerCount = standings.get(swiss[0].id)!.data.length;
  }

  const def = defaultStructure(playerCount);
  let topCut = def.topCut;
  const firstPlayoff = playoff[0] ? playoffSizeFromName(playoff[0].name) : null;
  if (firstPlayoff !== null && firstPlayoff >= 4) topCut = firstPlayoff;

  return {
    id: String(pt.id),
    source: 'melee',
    name: pt.name,
    startDate: pt.startDate,
    playerCount,
    swissRounds: Math.max(swiss.length, def.swissRounds),
    topCut,
    players: [...players.values()],
    rounds,
    scoring: scoringFrom(pt.standingsConfig),
    fetchedAt: pt.fetchedAt,
  };
}
