/**
 * A local fake Melee.gg that replays fixtures/melee/<id>/raw/. Used only by the
 * e2e tests; the worker is pointed at it with `MELEE_ORIGIN=http://127.0.0.1:<port>`.
 * Nothing here (or anywhere in e2e/) talks to the real melee.gg.
 *
 * Scenarios are selected by TOURNAMENT ID, so tests never share state and the
 * worker's edge cache can never serve one scenario's data for another:
 *
 *   484511            the finished event, exactly as captured
 *   900001            LIVE event "after round 5": round 6 and the playoffs report
 *                     started/completed False and return empty data tables
 *   900403            upstream answers 403 with an HTML page
 *   900302            302 redirect to an HTML error page
 *   900500            slow: every response is delayed (FAKE_MELEE_SLOW_MS, default 1500)
 *   910000..919999    finished event under its own id, for upstream-request counting
 *   anything else     404
 *
 * Round ids on a scenario tournament are the fixture ids plus SCENARIO_STEP * k, so
 * a round request can be traced back to its scenario without a tournament id.
 *
 * Control: GET /__stats (request counts by "METHOD path"), POST /__reset.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE_ID = 484511;
const RAW = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/melee', String(FIXTURE_ID), 'raw');
const PORT = Number(process.env.FAKE_MELEE_PORT ?? 4010);
const SLOW_MS = Number(process.env.FAKE_MELEE_SLOW_MS ?? 1500);

const SCENARIO_STEP = 100_000_000;

type Kind = 'finished' | 'live' | 'blocked' | 'redirect' | 'slow' | 'clone';

/** Scenario number k: round ids carry k * SCENARIO_STEP. */
const K: Record<Kind, number> = { finished: 0, live: 1, clone: 2, slow: 3, blocked: 4, redirect: 5 };
const KIND_BY_K = Object.fromEntries(Object.entries(K).map(([kind, k]) => [k, kind])) as Record<number, Kind>;

function kindOf(id: number): Kind | null {
  if (id === FIXTURE_ID) return 'finished';
  if (id === 900001) return 'live';
  if (id === 900403) return 'blocked';
  if (id === 900302) return 'redirect';
  if (id === 900500) return 'slow';
  if (id >= 910000 && id <= 919999) return 'clone';
  return null;
}

const raw = (name: string) => readFileSync(resolve(RAW, name), 'utf8');
const EMPTY_TABLE = JSON.stringify({ draw: 1, recordsTotal: 0, recordsFiltered: 0, data: [] });
const FORBIDDEN_403 =
  '<html>\r\n<head><title>403 Forbidden</title></head>\r\n<body>\r\n<center><h1>403 Forbidden</h1></center>\r\n</body>\r\n</html>\r\n';
const NOT_FOUND = '<html><body>Not found</body></html>';

/** Rounds that have not happened yet in the live scenario: round 6 and the playoffs. */
const LIVE_UNPLAYED = new Set([1749836, 1725216, 1725217, 1725218]);

function tournamentPage(kind: Kind): string {
  let html = raw('tournament.html');
  if (kind === 'live') {
    html = html.replace(/<button[^>]*round-selector[^>]*>/g, (tag) => {
      const id = Number(/data-id="(\d+)"/.exec(tag)?.[1]);
      return LIVE_UNPLAYED.has(id) ? tag.replace(/data-is-(completed|started)="True"/, 'data-is-$1="False"') : tag;
    });
    html = html.replace(/Ended\s*\|/, 'Started |');
  }
  const k = K[kind];
  return k === 0
    ? html
    : html.replace(/data-id="(\d+)"/g, (_m, id: string) => `data-id="${Number(id) + k * SCENARIO_STEP}"`);
}

const stats = new Map<string, number>();

function send(res: ServerResponse, status: number, type: string, body: string, extra: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': type, ...extra });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const JSON_T = 'application/json; charset=utf-8';
const HTML_T = 'text/html; charset=utf-8';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function handle(req: IncomingMessage, res: ServerResponse) {
  const path = new URL(req.url ?? '/', 'http://fake').pathname;
  const method = req.method ?? 'GET';

  if (path === '/__stats') return send(res, 200, JSON_T, JSON.stringify(Object.fromEntries(stats)));
  if (path === '/__reset' && method === 'POST') {
    stats.clear();
    return send(res, 200, JSON_T, '{}');
  }
  const count = (key: string) => stats.set(key, (stats.get(key) ?? 0) + 1);
  if (path !== '/Standing/GetRoundStandings') count(`${method} ${path}`);

  const page = /^\/Tournament\/View\/(\d+)$/.exec(path);
  const config = /^\/Standing\/GetStandingsConfig\/(\d+)$/.exec(path);
  const tidText = page?.[1] ?? config?.[1];
  if (tidText) {
    const kind = kindOf(Number(tidText));
    if (!kind) return send(res, 404, HTML_T, NOT_FOUND);
    if (kind === 'blocked') return send(res, 403, HTML_T, FORBIDDEN_403);
    if (kind === 'redirect') return send(res, 302, HTML_T, '', { location: '/Error/Index' });
    if (kind === 'slow') await sleep(SLOW_MS);
    return page ? send(res, 200, HTML_T, tournamentPage(kind)) : send(res, 200, JSON_T, raw('standings-config.json'));
  }

  // Round data. The roundId (form body for standings, path for matches) carries the scenario.
  let roundId = 0;
  let what: 'standings' | 'matches' | null = null;
  const matches = /^\/Match\/GetRoundMatches\/(\d+)$/.exec(path);
  if (method === 'POST' && path === '/Standing/GetRoundStandings') {
    roundId = Number(new URLSearchParams(await readBody(req)).get('roundId'));
    what = 'standings';
    count(`${method} ${path}?roundId=${roundId}`);
  } else if (method === 'POST' && matches) {
    await readBody(req);
    roundId = Number(matches[1]);
    what = 'matches';
  }
  if (what && Number.isSafeInteger(roundId) && roundId > 0) {
    const kind = KIND_BY_K[Math.floor(roundId / SCENARIO_STEP)];
    const original = roundId % SCENARIO_STEP;
    if (!kind) return send(res, 404, HTML_T, NOT_FOUND);
    if (kind === 'slow') await sleep(SLOW_MS);
    if (kind === 'live' && LIVE_UNPLAYED.has(original)) return send(res, 200, JSON_T, EMPTY_TABLE);
    const file = `${what}-${original}.json`;
    return existsSync(resolve(RAW, file)) ? send(res, 200, JSON_T, raw(file)) : send(res, 404, HTML_T, NOT_FOUND);
  }

  return send(res, 404, HTML_T, NOT_FOUND);
}

createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error(e);
    if (!res.headersSent) send(res, 500, 'text/plain', 'fake melee error');
  });
}).listen(PORT, '127.0.0.1', () => console.log(`fake melee listening on http://127.0.0.1:${PORT}`));
