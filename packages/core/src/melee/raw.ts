/**
 * Types and defensive parsers for Melee.gg's DataTables bodies, derived from
 * fixtures/melee/484511/raw. Only the fields core reads are validated; extra
 * fields are ignored.
 */

export interface MeleeDataTable<T> {
  draw: number;
  recordsTotal: number;
  recordsFiltered: number;
  data: T[];
}

export interface MeleePlayer {
  TeamId?: number;
  ID?: number;
  DisplayName?: string | null;
  Username?: string | null;
}

export interface MeleeTeam {
  ID: number;
  StatusDescription: string;
  IsActive?: boolean;
  Players: MeleePlayer[];
}

export interface MeleeStandingRow {
  Team: MeleeTeam;
  Rank: number;
  Points: number;
  MatchRecord: string;
  GameRecord: string;
  MatchWins: number;
  MatchLosses: number;
  MatchDraws: number;
  GameWins: number;
  GameLosses: number;
  GameDraws: number;
  OpponentMatchWinPercentage: number;
  TeamGameWinPercentage: number;
  OpponentGameWinPercentage: number;
  RoundId?: number;
  PhaseId?: number;
  MatchingMethodDescription?: string | null;
  Round?: string | null;
}

export interface MeleeCompetitor {
  Team: MeleeTeam;
  TeamId?: number;
  GameWins: number | null;
  GameByes: number | null;
}

export interface MeleeMatch {
  Competitors: MeleeCompetitor[];
  HasResult: boolean;
  GameDraws: number | null;
  TableNumber: number | null;
  ResultString: string | null;
  ByeReasonDescription: string | null;
  RoundId?: number;
  PhaseId?: number;
  RoundNumber?: number;
  RoundDescription?: string | null;
  TypeDescription?: string | null;
}

export class MeleeShapeError extends Error {
  constructor(where: string, message: string) {
    super(`Unexpected Melee response (${where}): ${message}`);
    this.name = 'MeleeShapeError';
  }
}

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function need(where: string, o: Rec, key: string, type: 'number' | 'string' | 'boolean'): void {
  if (typeof o[key] !== type) throw new MeleeShapeError(where, `"${key}" should be a ${type}`);
}

function parseTeam(where: string, v: unknown): MeleeTeam {
  if (!isRec(v)) throw new MeleeShapeError(where, 'Team should be an object');
  need(where, v, 'ID', 'number');
  need(where, v, 'StatusDescription', 'string');
  if (!Array.isArray(v.Players)) throw new MeleeShapeError(where, 'Team.Players should be an array');
  return v as unknown as MeleeTeam;
}

/**
 * The official API's `ApiResult` wrapper (spec: MtgMelee.Models.Api.ApiResult).
 * Only `content` is read by core; the paging fields are used by the worker.
 * The spec types `content` as a bare "object"; ASSUMPTION: it is the page's array.
 */
export interface MeleeApiResult {
  statusCode?: string | number;
  page?: number;
  pageSize?: number;
  recordsFiltered?: number;
  recordsTotal?: number;
  content: unknown;
  hasMore?: boolean;
}

/**
 * ASSUMPTION (API field casing): the website's DataTables rows are PascalCase.
 * The official API wraps with camelCase (`statusCode`, `recordsTotal`), so its
 * rows may be camelCase too. Upper-case the first letter of every key so one
 * parser serves both; `id` becomes `ID` as on the site. Already-Pascal keys are
 * unchanged.
 */
export function pascalizeKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(pascalizeKeys);
  if (!isRec(v)) return v;
  const out: Rec = {};
  for (const [k, val] of Object.entries(v)) {
    let key = k.length > 0 ? k[0]!.toUpperCase() + k.slice(1) : k;
    if (key === 'Id') key = 'ID';
    out[key] = pascalizeKeys(val);
  }
  return out;
}

/**
 * Accepts the site's DataTables body `{data: [...]}`, an API `ApiResult`
 * `{content: [...]}` (also `{content: {data: [...]}}`), or a bare array.
 */
function unwrapRows(where: string, input: unknown): { rows: unknown[]; table: Rec } {
  if (Array.isArray(input)) return { rows: input, table: {} };
  if (!isRec(input)) throw new MeleeShapeError(where, 'body should be an array or an object');
  if (Array.isArray(input.data)) return { rows: input.data, table: input };
  if (Array.isArray(input.content)) return { rows: input.content, table: input };
  if (isRec(input.content) && Array.isArray(input.content.data)) return { rows: input.content.data, table: input };
  throw new MeleeShapeError(where, 'expected a bare array, or an object with a "data" or "content" array');
}

function parseTable<T>(where: string, input: unknown, row: (r: unknown, w: string) => T): MeleeDataTable<T> {
  const { rows, table } = unwrapRows(where, input);
  const data = rows.map((r, i) => row(pascalizeKeys(r), `${where} row ${i}`));
  return {
    draw: typeof table.draw === 'number' ? table.draw : 0,
    recordsTotal: typeof table.recordsTotal === 'number' ? table.recordsTotal : data.length,
    recordsFiltered: typeof table.recordsFiltered === 'number' ? table.recordsFiltered : data.length,
    data,
  };
}

export function parseStandings(input: unknown, where = 'standings'): MeleeDataTable<MeleeStandingRow> {
  return parseTable(where, input, (r, w) => {
    if (!isRec(r)) throw new MeleeShapeError(w, 'row should be an object');
    parseTeam(w, r.Team);
    for (const k of ['Rank', 'Points', 'MatchWins', 'MatchLosses', 'MatchDraws', 'GameWins', 'GameLosses', 'GameDraws'])
      need(w, r, k, 'number');
    return r as unknown as MeleeStandingRow;
  });
}

export function parseMatches(input: unknown, where = 'matches'): MeleeDataTable<MeleeMatch> {
  return parseTable(where, input, (r, w) => {
    if (!isRec(r)) throw new MeleeShapeError(w, 'row should be an object');
    if (!Array.isArray(r.Competitors) || r.Competitors.length < 1 || r.Competitors.length > 2)
      throw new MeleeShapeError(w, '"Competitors" should hold one or two entries');
    for (const c of r.Competitors) {
      if (!isRec(c)) throw new MeleeShapeError(w, 'competitor should be an object');
      parseTeam(w, c.Team);
    }
    need(w, r, 'HasResult', 'boolean');
    return r as unknown as MeleeMatch;
  });
}
