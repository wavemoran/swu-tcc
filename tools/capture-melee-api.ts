/**
 * Day-one script for the official Melee API.
 *
 *   MELEE_CLIENT_ID=... MELEE_CLIENT_SECRET=... \
 *     node --experimental-strip-types tools/capture-melee-api.ts <tournamentId>
 *
 *   node --experimental-strip-types tools/capture-melee-api.ts <tournamentId> --replay
 *       re-runs the report on fixtures/melee-api/<id>/raw without any network
 *       and without credentials (use it after fixing the adapter).
 *
 * Fetch mode refuses to run without both env vars, waits >= 1 s between
 * requests, saves every raw response body to fixtures/melee-api/<id>/raw/, then
 * runs the worker's API adapter and core's fromMelee/computeStandings and
 * prints a report. Secrets are read from the environment only and are never
 * printed or written. Do not add them to a file in this repo.
 *
 * Exit code: 0 all clear, 1 shape errors or standings mismatches, 2 usage/credentials.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ProxyRound, ProxyTournament } from '../packages/core/src/index.ts';
import { computeStandings, fromMelee } from '../packages/core/src/index.ts';
import { MeleeShapeError, parseMatches, parseStandings, pascalizeKeys } from '../packages/core/src/melee/raw.ts';
import { ApiClient, rawLabel, roundBody, type PagedRows } from '../apps/worker/src/api.ts';
import { adaptTournamentDetails } from '../apps/worker/src/apiAdapter.ts';
import { UpstreamError } from '../apps/worker/src/shared.ts';

const DELAY_MS = 1000;
const MAX_REQUESTS = 400; // one tournament; generous, but not unbounded

const out = (s = '') => process.stdout.write(s + '\n');

function usage(msg: string): never {
  process.stderr.write(`${msg}\n\nUsage: node --experimental-strip-types tools/capture-melee-api.ts <tournamentId> [--replay] [--dir <rawDir>]\n`);
  process.exit(2);
}

// --- args and credentials ---------------------------------------------------

const args = process.argv.slice(2);
const replay = args.includes('--replay');
const idArg = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--dir');
if (!idArg || !/^[1-9]\d{0,9}$/.test(idArg)) usage('Give a numeric tournament id.');
const tournamentId = Number(idArg);

const dirFlag = args.indexOf('--dir');
const rawDir =
  dirFlag >= 0 && args[dirFlag + 1]
    ? args[dirFlag + 1]!.replace(/\/?$/, '/')
    : fileURLToPath(new URL(`../fixtures/melee-api/${tournamentId}/raw/`, import.meta.url));

const clientId = process.env.MELEE_CLIENT_ID?.trim();
const clientSecret = process.env.MELEE_CLIENT_SECRET?.trim();
if (!replay && (!clientId || !clientSecret)) {
  usage('MELEE_CLIENT_ID and MELEE_CLIENT_SECRET must both be set in the environment. Refusing to run without credentials.');
}

// --- client (live or replayed from disk) -------------------------------------

const replayFetch = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  const label = rawLabel(url.pathname + url.search);
  try {
    return new Response(readFileSync(`${rawDir}${label}.json`, 'utf8'), { headers: { 'content-type': 'application/json' } });
  } catch {
    return new Response('{}', { status: 404 });
  }
}) as unknown as typeof fetch;

const saved: string[] = [];
const client = new ApiClient({
  credentials: replay ? { clientId: 'replay', clientSecret: 'replay' } : { clientId: clientId!, clientSecret: clientSecret! },
  ...(replay ? { fetch: replayFetch } : { delayMs: DELAY_MS }),
  maxRequests: MAX_REQUESTS,
  onRaw: replay
    ? undefined
    : (label, body) => {
        mkdirSync(rawDir, { recursive: true });
        writeFileSync(`${rawDir}${label}.json`, JSON.stringify(body, null, 2) + '\n');
        saved.push(label);
      },
});

// --- helpers ------------------------------------------------------------------

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Keys and types only, never values (values can be personal data). */
function outline(v: unknown, depth = 3): string {
  if (Array.isArray(v)) return v.length === 0 ? '[]' : `[${depth > 0 ? outline(v[0], depth - 1) : '...'}] x${v.length}`;
  if (!isRec(v)) return v === null ? 'null' : typeof v;
  if (depth === 0) return '{...}';
  return `{ ${Object.entries(v).map(([k, x]) => `${k}: ${outline(x, depth - 1)}`).join(', ')} }`;
}

let problems = 0;
const problem = (msg: string) => {
  problems++;
  out(`  FAIL  ${msg}`);
};

function fieldReport(title: string, rows: unknown[], expected: Record<string, 'req' | 'opt'>, nested: Record<string, string[]> = {}) {
  out(`\n${title}  (${rows.length} rows)`);
  if (rows.length === 0) return out('  no rows to inspect');
  const sample = pascalizeKeys(rows[0]) as Rec;
  for (const [k, need] of Object.entries(expected)) {
    const ok = sample[k] !== undefined && sample[k] !== null;
    out(`  ${ok ? 'ok  ' : need === 'req' ? 'FAIL' : 'miss'}  ${k}${need === 'opt' ? ' (optional)' : ''}`);
    if (!ok && need === 'req') problems++;
  }
  for (const [parent, keys] of Object.entries(nested)) {
    const p = sample[parent];
    const o = Array.isArray(p) ? (p[0] as unknown) : p;
    const rec = isRec(o) ? o : {};
    for (const k of keys) {
      const ok = rec[k] !== undefined && rec[k] !== null;
      out(`  ${ok ? 'ok  ' : 'FAIL'}  ${parent}.${k}`);
      if (!ok) problems++;
    }
  }
  const unread = Object.keys(sample).filter((k) => !(k in expected) && !(k in nested));
  out(`  other keys (not read by us): ${unread.join(', ') || '(none)'}`);
}

// --- run ---------------------------------------------------------------------

async function main() {
  out(`Tournament ${tournamentId}  mode: ${replay ? 'replay from disk (no network)' : 'LIVE (official API)'}`);
  out(`Raw files: ${rawDir}`);

  // 1. Details + adapter
  let details: unknown;
  try {
    details = await client.tournament(tournamentId);
  } catch (e) {
    return fatal('GET /api/tournament/{id}', e);
  }
  out(`\nGET /api/tournament/${tournamentId}  response outline (keys only):\n  ${outline(details, 4)}`);
  let adapted;
  try {
    adapted = adaptTournamentDetails(details);
  } catch (e) {
    problem(`adapter: ${(e as Error).message}`);
    out('  -> fix adaptTournamentDetails() in apps/worker/src/apiAdapter.ts, then re-run with --replay');
    return finish();
  }
  out(`\nAdapter OK: "${adapted.name}", start ${adapted.startDate ?? '(none)'}, status ${adapted.statusText ?? '(none)'}`);
  for (const r of adapted.rounds) {
    out(`  round ${r.id}  ${r.name.padEnd(16)} ${r.kind.padEnd(8)} started=${r.started} completed=${r.completed}`);
  }
  if (adapted.rounds.length === 0) {
    out('  (no rounds listed: nothing more to fetch)');
    return finish();
  }

  // 2. Every started round's standings and matches
  const standings: Record<number, unknown> = {};
  const matches: Record<number, unknown> = {};
  const paged: { standings: Record<number, PagedRows>; matches: Record<number, PagedRows> } = { standings: {}, matches: {} };
  for (const r of adapted.rounds) {
    if (!r.started && !r.completed) {
      out(`\nround ${r.id} (${r.name}) not started: skipped`);
      continue;
    }
    for (const kind of ['standings', 'matches'] as const) {
      try {
        const p = await (kind === 'standings' ? client.roundStandings(r.id) : client.roundMatches(r.id));
        paged[kind][r.id] = p;
        (kind === 'standings' ? standings : matches)[r.id] = roundBody(p);
        out(`round ${r.id} ${kind}: ${p.rows.length} rows in ${p.pages} page(s)`);
      } catch (e) {
        problem(`round ${r.id} ${kind}: ${(e as Error).message}`);
        if (e instanceof UpstreamError && e.kind === 'not_authorized') return finish();
      }
    }
  }
  out(`\nRequests made: ${client.requests}${replay ? '' : `, raw files saved: ${saved.length}`}`);

  // 3. Which fields were recognized
  const firstStand = Object.values(paged.standings).find((p) => p.rows.length > 0);
  const firstMatch = Object.values(paged.matches).find((p) => p.rows.length > 0);
  if (firstStand) {
    fieldReport(
      'Standings row fields',
      firstStand.rows,
      {
        Rank: 'req', Points: 'req', MatchWins: 'req', MatchLosses: 'req', MatchDraws: 'req',
        GameWins: 'req', GameLosses: 'req', GameDraws: 'req',
        OpponentMatchWinPercentage: 'req', TeamGameWinPercentage: 'req', OpponentGameWinPercentage: 'req',
        MatchRecord: 'opt', GameRecord: 'opt', MatchingMethodDescription: 'opt', RoundId: 'opt', PhaseId: 'opt',
      },
      { Team: ['ID', 'StatusDescription', 'Players'] },
    );
  }
  if (firstMatch) {
    fieldReport(
      'Match fields',
      firstMatch.rows,
      { Competitors: 'req', HasResult: 'req', GameDraws: 'opt', TableNumber: 'opt', ResultString: 'opt', ByeReasonDescription: 'opt', RoundId: 'opt' },
      { Competitors: ['Team', 'GameWins'] },
    );
  }

  // 4. Core parsers, then fromMelee
  out('\nCore parsers');
  for (const [id, body] of Object.entries(standings)) {
    try { parseStandings(body, `standings for round ${id}`); } catch (e) { problem((e as Error).message); }
  }
  for (const [id, body] of Object.entries(matches)) {
    try { parseMatches(body, `matches for round ${id}`); } catch (e) { problem((e as Error).message); }
  }
  const proxy: ProxyTournament = {
    id: tournamentId,
    name: adapted.name,
    startDate: adapted.startDate,
    statusText: adapted.statusText,
    rounds: adapted.rounds,
    standingsConfig: null,
    fetchedAt: new Date().toISOString(),
    source: 'api',
  };
  let t;
  try {
    t = fromMelee({ tournament: proxy, standings, matches });
  } catch (e) {
    problem(e instanceof MeleeShapeError ? e.message : `fromMelee: ${(e as Error).message}`);
    return finish();
  }
  out(`  fromMelee OK: ${t.players.length} players, ${t.rounds.length} Swiss rounds, topCut ${t.topCut}, playerCount ${t.playerCount}`);

  // 5. computeStandings vs the API's own standings, per Swiss round
  out('\nComputed standings vs the API (rank, points, record, OMW%, TGW%, OGW%)');
  const swiss: ProxyRound[] = adapted.rounds.filter((r) => r.kind === 'swiss');
  swiss.forEach((r, i) => {
    const body = standings[r.id];
    if (!body || !r.completed) return;
    const api = parseStandings(body).data;
    const mine = new Map(computeStandings(t, i + 1).map((row) => [row.playerId, row]));
    const bad: string[] = [];
    for (const row of api) {
      const me = mine.get(String(row.Team.ID));
      const who = row.Team.Players[0]?.DisplayName ?? row.Team.Players[0]?.Username ?? `team ${row.Team.ID}`;
      if (!me) { bad.push(`${who}: missing from computed standings`); continue; }
      const diffs: string[] = [];
      if (me.rank !== row.Rank) diffs.push(`rank ${me.rank} vs ${row.Rank}`);
      if (me.points !== row.Points) diffs.push(`points ${me.points} vs ${row.Points}`);
      if (me.record.wins !== row.MatchWins || me.record.losses !== row.MatchLosses || me.record.draws !== row.MatchDraws) diffs.push('match record');
      const near = (a: number, b: number) => Math.abs(a - b) < 1e-4;
      if (!near(me.omw, row.OpponentMatchWinPercentage)) diffs.push(`OMW ${me.omw.toFixed(4)} vs ${row.OpponentMatchWinPercentage}`);
      if (!near(me.gw, row.TeamGameWinPercentage)) diffs.push(`TGW ${me.gw.toFixed(4)} vs ${row.TeamGameWinPercentage}`);
      if (!near(me.ogw, row.OpponentGameWinPercentage)) diffs.push(`OGW ${me.ogw.toFixed(4)} vs ${row.OpponentGameWinPercentage}`);
      if (diffs.length) bad.push(`${who}: ${diffs.join('; ')}`);
    }
    out(`  ${r.name}: ${api.length - bad.length}/${api.length} rows match`);
    if (bad.length) {
      problems++;
      for (const b of bad.slice(0, 5)) out(`    ${b}`);
      if (bad.length > 5) out(`    ... and ${bad.length - 5} more`);
    }
  });
  return finish();
}

function fatal(where: string, e: unknown): void {
  const kind = e instanceof UpstreamError ? e.kind : 'error';
  out(`\nFAIL  ${where}: [${kind}] ${(e as Error).message}`);
  if (kind === 'not_authorized') out('  The credentials work only for tournaments where the account has at least Coverage Staff access.');
  process.exitCode = 1;
}

function finish(): void {
  out(problems === 0 ? '\nAll clear. Next: review the raw files, then flip MELEE_SOURCE=api (docs/melee-api-switchover.md).' : `\n${problems} problem(s). See FAIL lines above.`);
  process.exitCode = problems === 0 ? 0 : 1;
}

main().catch((e) => fatal('unexpected', e));
