import type { ProxyError, ProxyTournament } from '@swu-tcc/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, MAX_SUBREQUESTS, basicAuthHeader, credentialsFrom, rawLabel } from '../src/api';
import { adaptTournamentDetails } from '../src/apiAdapter';
import { createApp, selectSource, type Env } from '../src/app';
import { UpstreamError } from '../src/melee';

const FAKE_ID = 'fake-client-id';
const FAKE_SECRET = 'fake-secret-do-not-leak';
const API_ENV: Partial<Env> = { MELEE_SOURCE: 'api', MELEE_CLIENT_ID: FAKE_ID, MELEE_CLIENT_SECRET: FAKE_SECRET };
const JSON_HDR = { 'content-type': 'application/json; charset=utf-8' };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HDR });

let fetchMock: ReturnType<typeof vi.fn>;
function mockUpstream(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(handler(String(input), init)));
  vi.stubGlobal('fetch', fetchMock);
}

function call(app: ReturnType<typeof createApp>, path: string, env: Partial<Env> = {}) {
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {} } as unknown as ExecutionContext;
  return (async () => {
    const res = await app.request(path, {}, { TCC_DISABLED: '0', ...env } as Env, ctx);
    await Promise.all(pending);
    return res;
  })();
}

const DETAILS = {
  id: 900001,
  name: 'Synthetic Qualifier',
  startDate: '2026-11-14T18:00:00Z',
  status: 'Ended',
  phases: [
    {
      name: 'Swiss',
      rounds: [
        { id: 11, name: 'Round 1', isStarted: true, isCompleted: true },
        { id: 12, name: 'Round 2', isStarted: true, isCompleted: false },
      ],
    },
    { name: 'Playoffs', rounds: [{ id: 13, name: 'Finals', isStarted: false, isCompleted: false }] },
  ],
};

const apiResult = (content: unknown[], extra: Record<string, unknown> = {}) => ({
  statusCode: 'OK',
  page: 1,
  pageSize: 250,
  recordsTotal: content.length,
  recordsFiltered: content.length,
  content,
  hasMore: false,
  ...extra,
});

beforeEach(() => mockUpstream(() => new Response('unexpected', { status: 500 })));
afterEach(() => vi.unstubAllGlobals());

describe('mode selection', () => {
  it('defaults to site and accepts api, case and whitespace insensitive', () => {
    expect(selectSource({})).toBe('site');
    expect(selectSource({ MELEE_SOURCE: '' })).toBe('site');
    expect(selectSource({ MELEE_SOURCE: 'site' })).toBe('site');
    expect(selectSource({ MELEE_SOURCE: ' API ' })).toBe('api');
    expect(selectSource({ MELEE_SOURCE: 'bogus' })).toBeNull();
  });

  it('an unknown MELEE_SOURCE is a 503 and nothing is fetched', async () => {
    const res = await call(createApp(), '/api/tournaments/900010', { MELEE_SOURCE: 'bogus' });
    expect(res.status).toBe(503);
    expect(((await res.json()) as ProxyError).message).toMatch(/MELEE_SOURCE/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('site mode (the default) never sends credentials and reports its source', async () => {
    mockUpstream((url) =>
      url.includes('/Tournament/View/')
        ? new Response('<html></html>', { headers: { 'content-type': 'text/html' } })
        : json({}),
    );
    const res = await call(createApp(), '/api/tournaments/900011', {
      MELEE_CLIENT_ID: FAKE_ID,
      MELEE_CLIENT_SECRET: FAKE_SECRET,
    });
    expect(res.headers.get('x-tcc-source')).toBe('site');
    expect(((await res.json()) as ProxyTournament).source).toBe('site');
    for (const [, init] of fetchMock.mock.calls) {
      expect(JSON.stringify((init as RequestInit | undefined)?.headers ?? {})).not.toMatch(/authorization/i);
    }
  });
});

describe('missing credentials', () => {
  it.each([
    ['both missing', {}],
    ['secret missing', { MELEE_CLIENT_ID: FAKE_ID }],
    ['id blank', { MELEE_CLIENT_ID: '  ', MELEE_CLIENT_SECRET: FAKE_SECRET }],
  ])('api mode with %s answers 503 disabled without calling upstream', async (_n, creds) => {
    const app = createApp();
    for (const path of ['/api/tournaments/900012', '/api/rounds/11/standings', '/api/rounds/11/matches']) {
      const res = await call(app, path, { MELEE_SOURCE: 'api', ...creds });
      expect(res.status, path).toBe(503);
      const body = (await res.json()) as ProxyError;
      expect(body.error).toBe('disabled');
      expect(body.message).toMatch(/credentials are not configured/);
      expect(JSON.stringify(body)).not.toContain(FAKE_SECRET);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('credentialsFrom trims and requires both', () => {
    expect(credentialsFrom({ MELEE_CLIENT_ID: ' a ', MELEE_CLIENT_SECRET: ' b\n' })).toEqual({ clientId: 'a', clientSecret: 'b' });
    expect(credentialsFrom({ MELEE_CLIENT_ID: 'a' })).toBeNull();
  });
});

describe('Basic auth header', () => {
  it('is Basic base64(id:secret)', () => {
    expect(basicAuthHeader({ clientId: FAKE_ID, clientSecret: FAKE_SECRET })).toBe(`Basic ${btoa(`${FAKE_ID}:${FAKE_SECRET}`)}`);
    // Known vector: "user:pass" -> dXNlcjpwYXNz
    expect(basicAuthHeader({ clientId: 'user', clientSecret: 'pass' })).toBe('Basic dXNlcjpwYXNz');
  });

  it('encodes non-ASCII as UTF-8', () => {
    expect(basicAuthHeader({ clientId: 'é', clientSecret: 'x' })).toBe('Basic w6k6eA==');
  });

  it('is sent only to melee.gg, on the exact API paths', async () => {
    mockUpstream((url) => (url.includes('/api/tournament/') ? json(DETAILS) : json(apiResult([{ a: 1 }]))));
    const app = createApp();
    await call(app, '/api/tournaments/900013', API_ENV);
    await call(app, '/api/rounds/11/standings', API_ENV);
    await call(app, '/api/rounds/11/matches', API_ENV);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual([
      'https://melee.gg/api/tournament/900013',
      'https://melee.gg/api/standing/list/round/11?variables.page=1&variables.pageSize=250',
      'https://melee.gg/api/match/list/round/11?variables.page=1&variables.pageSize=250',
    ]);
    for (const [, init] of fetchMock.mock.calls) {
      const h = (init as RequestInit).headers as Record<string, string>;
      expect(h.authorization).toBe(`Basic ${btoa(`${FAKE_ID}:${FAKE_SECRET}`)}`);
      expect((init as RequestInit).redirect).toBe('manual');
    }
  });
});

describe('api mode routes', () => {
  it('returns a ProxyTournament with source api and the x-tcc-source header, and leaks no secret', async () => {
    mockUpstream(() => json(DETAILS));
    const res = await call(createApp(), '/api/tournaments/900014', API_ENV);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-tcc-source')).toBe('api');
    const text = await res.text();
    expect(text).not.toContain(FAKE_SECRET);
    expect(text).not.toContain(btoa(`${FAKE_ID}:${FAKE_SECRET}`));
    expect([...res.headers.values()].join('\n')).not.toContain(FAKE_SECRET);
    const body = JSON.parse(text) as ProxyTournament;
    expect(body).toMatchObject({ id: 900014, name: 'Synthetic Qualifier', source: 'api', standingsConfig: null });
    expect(body.rounds).toEqual([
      { id: 11, name: 'Round 1', started: true, completed: true, kind: 'swiss' },
      { id: 12, name: 'Round 2', started: true, completed: false, kind: 'swiss' },
      { id: 13, name: 'Finals', started: false, completed: false, kind: 'playoff' },
    ]);
  });

  it('fetches every page and returns one DataTables-style body', async () => {
    mockUpstream((url) => {
      const page = Number(/variables\.page=(\d+)/.exec(url)![1]);
      return json(apiResult([{ n: page * 10 }, { n: page * 10 + 1 }], { page, hasMore: page < 3, recordsTotal: 6 }));
    });
    const res = await call(createApp(), '/api/rounds/900015/standings', API_ENV);
    expect(res.headers.get('x-tcc-source')).toBe('api');
    expect(await res.json()).toEqual({
      draw: 0,
      recordsTotal: 6,
      recordsFiltered: 6,
      data: [{ n: 10 }, { n: 11 }, { n: 20 }, { n: 21 }, { n: 30 }, { n: 31 }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not serve the other source from cache after MELEE_SOURCE flips', async () => {
    mockUpstream((url) =>
      url.includes('/api/standing/')
        ? json(apiResult([{ from: 'api' }]))
        : new Response(JSON.stringify({ data: [{ from: 'site' }] }), { headers: JSON_HDR }),
    );
    const app = createApp();
    const a = (await (await call(app, '/api/rounds/900016/standings')).json()) as { data: { from: string }[] };
    const b = (await (await call(app, '/api/rounds/900016/standings', API_ENV)).json()) as { data: { from: string }[] };
    expect([a.data[0]!.from, b.data[0]!.from]).toEqual(['site', 'api']);
  });
});

describe('401/403 map to not_authorized', () => {
  it.each([401, 403])('HTTP %i from the API answers 403 not_authorized', async (status) => {
    mockUpstream(() => json({ Error: true, Code: status, Message: 'nope' }, status));
    const app = createApp();
    for (const path of [`/api/tournaments/${900020 + status}`, `/api/rounds/${status}/standings`, `/api/rounds/${status}/matches`]) {
      const res = await call(app, path, API_ENV);
      expect(res.status, path).toBe(403);
      const body = (await res.json()) as ProxyError;
      expect(body.error).toBe('not_authorized');
      expect(JSON.stringify(body)).not.toContain(FAKE_SECRET);
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('ApiResult.statusCode Unauthorized in a 200 body is also not_authorized', async () => {
    mockUpstream(() => json({ statusCode: 'Unauthorized', content: null }));
    const res = await call(createApp(), '/api/rounds/900030/matches', API_ENV);
    expect(((await res.json()) as ProxyError).error).toBe('not_authorized');
  });

  it('404 stays not_found and 500 is upstream_error', async () => {
    mockUpstream(() => json({}, 404));
    expect(((await (await call(createApp(), '/api/tournaments/900031', API_ENV)).json()) as ProxyError).error).toBe('not_found');
    mockUpstream(() => json({}, 500));
    expect(((await (await call(createApp(), '/api/tournaments/900032', API_ENV)).json()) as ProxyError).error).toBe('upstream_error');
  });
});

describe('pagination cap', () => {
  const endless = (url: string) => json(apiResult([{ x: 1 }], { page: Number(/variables\.page=(\d+)/.exec(url)![1]), hasMore: true }));

  it('the route stops at MAX_SUBREQUESTS requests and returns upstream_error, not partial data', async () => {
    mockUpstream(endless);
    const res = await call(createApp(), '/api/rounds/900040/standings', API_ENV);
    expect(res.status).toBe(502);
    const body = (await res.json()) as ProxyError;
    expect(body.error).toBe('upstream_error');
    expect(body.message).toMatch(new RegExp(`more than ${MAX_SUBREQUESTS} requests`));
    expect(fetchMock).toHaveBeenCalledTimes(MAX_SUBREQUESTS);
    expect(MAX_SUBREQUESTS).toBeLessThan(50);
  });

  it('the client honours a custom cap', async () => {
    const client = new ApiClient({
      credentials: { clientId: FAKE_ID, clientSecret: FAKE_SECRET },
      maxRequests: 2,
      fetch: (async (u: RequestInfo | URL) => endless(String(u))) as typeof fetch,
    });
    await expect(client.roundMatches(1)).rejects.toThrow(/more than 2 requests/);
    expect(client.requests).toBe(2);
  });

  it('without hasMore it continues only while full pages come back', async () => {
    const full = Array.from({ length: 250 }, (_, i) => ({ i }));
    const client = new ApiClient({
      credentials: { clientId: FAKE_ID, clientSecret: FAKE_SECRET },
      fetch: (async (u: RequestInfo | URL) =>
        /variables\.page=1&/.test(String(u)) ? json(full) : json([{ last: true }])) as typeof fetch,
    });
    const r = await client.roundStandings(1);
    expect(r.rows).toHaveLength(251);
    expect(r.pages).toBe(2);
  });

  it('reports a missing content array by field name', async () => {
    mockUpstream(() => json({ statusCode: 'OK', items: [] }));
    const res = await call(createApp(), '/api/rounds/900041/matches', API_ENV);
    expect(((await res.json()) as ProxyError).message).toMatch(/API response shape not recognized: content/);
  });

  it('rawLabel names saved files by endpoint and page', () => {
    expect(rawLabel('/api/standing/list/round/5?variables.page=2&variables.pageSize=250')).toBe('standing-list-round-5-p2');
    expect(rawLabel('/api/tournament/484511')).toBe('tournament-484511');
  });
});

describe('adapter shape errors', () => {
  const shapeMsg = (body: unknown) => {
    try {
      adaptTournamentDetails(body);
    } catch (e) {
      expect(e).toBeInstanceOf(UpstreamError);
      expect((e as UpstreamError).kind).toBe('upstream_error');
      return (e as UpstreamError).message;
    }
    throw new Error('expected a shape error');
  };

  it('accepts camelCase, PascalCase and an ApiResult wrapper', () => {
    const pascal = { Name: 'T', Rounds: [{ ID: 1, Name: 'Round 1', IsStarted: true, IsCompleted: false }] };
    expect(adaptTournamentDetails(pascal).rounds).toEqual([{ id: 1, name: 'Round 1', started: true, completed: false, kind: 'swiss' }]);
    expect(adaptTournamentDetails({ statusCode: 'OK', content: DETAILS }).name).toBe('Synthetic Qualifier');
  });

  it('reads a status string instead of booleans, and Round N from a number', () => {
    const t = adaptTournamentDetails({ name: 'T', rounds: [{ id: '7', roundNumber: 3, status: 'In Progress' }] });
    expect(t.rounds).toEqual([{ id: 7, name: 'Round 3', started: true, completed: false, kind: 'swiss' }]);
  });

  it('allows a tournament with no rounds yet', () => {
    expect(adaptTournamentDetails({ name: 'T', phases: [{ name: 'Swiss', rounds: [] }] }).rounds).toEqual([]);
  });

  it('names the field that is missing', () => {
    expect(shapeMsg('x')).toBe('API response shape not recognized: tournament (expected an object)');
    expect(shapeMsg({})).toBe('API response shape not recognized: name');
    expect(shapeMsg({ name: 'T' })).toBe('API response shape not recognized: phases (or rounds)');
    expect(shapeMsg({ name: 'T', phases: [{}] })).toBe('API response shape not recognized: phases[0].rounds');
    expect(shapeMsg({ name: 'T', phases: [5] })).toMatch(/phases\[0\]/);
    expect(shapeMsg({ name: 'T', rounds: [{ name: 'Round 1' }] })).toBe('API response shape not recognized: rounds[0].id');
    expect(shapeMsg({ name: 'T', rounds: [{ id: 1 }] })).toBe('API response shape not recognized: rounds[0].name');
    expect(shapeMsg({ name: 'T', rounds: [{ id: 1, name: 'Round 1' }] })).toBe('API response shape not recognized: rounds[0].isCompleted');
    expect(shapeMsg({ name: 'T', rounds: [{ id: 1, name: 'Round 1', isCompleted: false }] })).toBe(
      'API response shape not recognized: rounds[0].isStarted',
    );
    expect(shapeMsg({ name: 'T', phases: [{ rounds: [{ id: -1, name: 'x' }] }] })).toBe(
      'API response shape not recognized: phases[0].rounds[0].id',
    );
  });

  it('surfaces through the route as 502 upstream_error with the field', async () => {
    mockUpstream(() => json({ name: 'T', something: 'else' }));
    const res = await call(createApp(), '/api/tournaments/900050', API_ENV);
    expect(res.status).toBe(502);
    expect(((await res.json()) as ProxyError).message).toBe('API response shape not recognized: phases (or rounds)');
  });
});
