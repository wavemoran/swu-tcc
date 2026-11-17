import type { ProxyError, ProxyTournament } from '@swu-tcc/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import html from '../../../fixtures/melee/484511/raw/tournament.html?raw';
import config from '../../../fixtures/melee/484511/raw/standings-config.json?raw';
import standings from '../../../fixtures/melee/484511/raw/standings-1749836.json?raw';
import matches from '../../../fixtures/melee/484511/raw/matches-1749836.json?raw';
import wranglerConfig from '../wrangler.jsonc?raw';
import { decodeEntities, parseTournamentPage, resolveOrigin, roundKind } from '../src/melee';
import golden from './tournament-page.golden.json';
import { createApp, roundTtl, type Env } from '../src/app';
import { USER_AGENT, parseId } from '../src/melee';
import { createLimiter } from '../src/ratelimit';

const JSON_HDR = { 'content-type': 'application/json; charset=utf-8' };
const HTML_HDR = { 'content-type': 'text/html; charset=utf-8' };

let fetchMock: ReturnType<typeof vi.fn>;

function mockUpstream(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init)),
  );
  vi.stubGlobal('fetch', fetchMock);
}

const happy = (url: string) => {
  if (url.includes('/Tournament/View/')) return new Response(html, { headers: HTML_HDR });
  if (url.includes('GetStandingsConfig')) return new Response(config, { headers: JSON_HDR });
  if (url.includes('GetRoundStandings')) return new Response(standings, { headers: JSON_HDR });
  if (url.includes('GetRoundMatches')) return new Response(matches, { headers: JSON_HDR });
  return new Response('nope', { status: 500 });
};

function call(
  app: ReturnType<typeof createApp>,
  path: string,
  env: Partial<Env> = {},
  headers: Record<string, string> = {},
) {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => void pending.push(p),
    passThroughOnException() {},
  } as unknown as ExecutionContext;
  return (async () => {
    const res = await app.request(path, { headers }, { TCC_DISABLED: '0', ...env } as Env, ctx);
    await Promise.all(pending);
    return res;
  })();
}

beforeEach(() => mockUpstream(happy));
afterEach(() => vi.unstubAllGlobals());

describe('id validation', () => {
  it('parseId accepts positive integers up to 10 digits', () => {
    expect(parseId('1')).toBe(1);
    expect(parseId('1749836')).toBe(1749836);
    expect(parseId('1234567890')).toBe(1234567890);
    for (const bad of ['0', '-1', '01', '1.5', 'abc', '12345678901', '1e3', '', ' 1']) {
      expect(parseId(bad), bad).toBeNull();
    }
  });

  it('returns 400 bad_request without touching upstream', async () => {
    const app = createApp();
    for (const path of [
      '/api/tournaments/abc',
      '/api/tournaments/0',
      '/api/tournaments/12345678901',
      '/api/rounds/x/standings',
      '/api/rounds/-5/matches',
    ]) {
      const res = await call(app, path);
      expect(res.status, path).toBe(400);
      expect(((await res.json()) as ProxyError).error).toBe('bad_request');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/tournaments/:id', () => {
  it('parses rounds, name, date and status from the fixture', async () => {
    const res = await call(createApp(), '/api/tournaments/484511');
    expect(res.status).toBe(200);
    expect(res.headers.get('x-tcc-fetched-at')).toBeTruthy();
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    const t = (await res.json()) as ProxyTournament;
    expect(t.id).toBe(484511);
    expect(t.name).toBe('Star Wars: Unlimited — Homeworlds Planetary Qualifier');
    expect(t.startDate).toBe('2026-11-14T18:00:00.0000000Z');
    expect(t.statusText).toBe('Ended | 52 of 88 Enrolled Players');
    expect(t.rounds.map((r) => r.id)).toEqual([
      1725211, 1725212, 1725213, 1725214, 1725215, 1749836, 1725216, 1725217, 1725218,
    ]);
    expect(t.rounds.map((r) => r.name)).toEqual([
      'Round 1', 'Round 2', 'Round 3', 'Round 4', 'Round 5', 'Round 6',
      'Quarterfinals', 'Semifinals', 'Finals',
    ]);
    expect(t.rounds.every((r) => r.completed && r.started)).toBe(true);
    expect(t.standingsConfig).toEqual(JSON.parse(config));
  });

  it('sends the honest User-Agent, only to melee.gg, and does not follow redirects', async () => {
    await call(createApp(), '/api/tournaments/484512');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetchMock.mock.calls as [string, RequestInit][]) {
      expect(url.startsWith('https://melee.gg/')).toBe(true);
      expect((init.headers as Record<string, string>)['user-agent']).toBe(USER_AGENT);
      expect(init.redirect).toBe('manual');
    }
  });

  it('merges started/completed flags by id', async () => {
    const page = `<div id="standings-round-selector-container">
      <button class="round-selector" data-id="5" data-name="Round 1" data-is-completed="True"></button>
      <button class="round-selector" data-id="6" data-name="Round 2" data-is-completed="False"></button></div>
      <div id="pairings-round-selector-container">
      <button class="round-selector" data-id="5" data-name="Round 1" data-is-started="True"></button>
      <button class="round-selector" data-id="6" data-name="Round 2" data-is-started="True"></button></div>`;
    mockUpstream((url) =>
      url.includes('/Tournament/View/')
        ? new Response(page, { headers: HTML_HDR })
        : new Response('{}', { headers: JSON_HDR }),
    );
    const t = (await (await call(createApp(), '/api/tournaments/77')).json()) as ProxyTournament;
    expect(t.rounds).toEqual([
      { id: 5, name: 'Round 1', started: true, completed: true, kind: 'swiss' },
      { id: 6, name: 'Round 2', started: true, completed: false, kind: 'swiss' },
    ]);
  });

  it('classifies round kinds from the name', () => {
    for (const n of ['Round 1', 'Round 12', 'round 3']) expect(roundKind(n)).toBe('swiss');
    for (const n of ['Quarterfinals', 'Semifinals', 'Finals', 'Top 8', 'Top 16', 'Round of 16', 'Round of 32'])
      expect(roundKind(n)).toBe('playoff');
  });

  it('sets kind on the fixture rounds', async () => {
    const t = (await (await call(createApp(), '/api/tournaments/484511')).json()) as ProxyTournament;
    expect(t.rounds.map((r) => r.kind)).toEqual([
      'swiss', 'swiss', 'swiss', 'swiss', 'swiss', 'swiss', 'playoff', 'playoff', 'playoff',
    ]);
  });

  it('maps a Melee 404 to not_found', async () => {
    mockUpstream(() => new Response('missing', { status: 404 }));
    const res = await call(createApp(), '/api/tournaments/999');
    expect(res.status).toBe(404);
    expect(((await res.json()) as ProxyError).error).toBe('not_found');
  });

  it('maps a 403 to a clear upstream_error', async () => {
    mockUpstream(() => new Response('<h1>403 Forbidden</h1>', { status: 403, headers: HTML_HDR }));
    const res = await call(createApp(), '/api/tournaments/998');
    expect(res.status).toBe(502);
    const body = (await res.json()) as ProxyError;
    expect(body.error).toBe('upstream_error');
    expect(body.message).toMatch(/403/);
  });
});

describe('round routes', () => {
  it('streams standings and matches through verbatim', async () => {
    const app = createApp();
    const s = await call(app, '/api/rounds/1749836/standings');
    expect(s.status).toBe(200);
    expect(await s.text()).toBe(standings);
    expect(s.headers.get('x-tcc-fetched-at')).toBeTruthy();
    const m = await call(app, '/api/rounds/1749836/matches');
    expect(await m.text()).toBe(matches);

    const [sUrl, sInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sUrl).toBe('https://melee.gg/Standing/GetRoundStandings');
    expect(sInit.method).toBe('POST');
    expect(sInit.body).toBe('draw=1&start=0&length=-1&roundId=1749836');
    const [mUrl, mInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(mUrl).toBe('https://melee.gg/Match/GetRoundMatches/1749836');
    expect(mInit.body).toBe('draw=1&start=0&length=-1');
  });

  it('treats a non-JSON upstream response as upstream_error 502', async () => {
    mockUpstream(() => new Response('<html>error</html>', { headers: HTML_HDR }));
    const res = await call(createApp(), '/api/rounds/31/standings');
    expect(res.status).toBe(502);
    expect(((await res.json()) as ProxyError).error).toBe('upstream_error');
  });

  it('treats a 302 to the error page as upstream_error 502', async () => {
    mockUpstream(() => new Response(null, { status: 302, headers: { location: '/Error' } }));
    const res = await call(createApp(), '/api/rounds/32/matches');
    expect(res.status).toBe(502);
  });
});

describe('caching', () => {
  it('chooses TTL by completion', async () => {
    expect(roundTtl(false)).toBe(30);
    expect(roundTtl(true)).toBe(86400);
    const app = createApp();
    const live = await call(app, '/api/rounds/41/standings');
    expect(live.headers.get('cache-control')).toBe('public, max-age=30');
    const done = await call(app, '/api/rounds/42/standings?completed=1');
    expect(done.headers.get('cache-control')).toBe('public, max-age=86400');
  });

  it('serves the second request from the edge cache and keys on completed', async () => {
    const app = createApp();
    const first = await call(app, '/api/rounds/51/matches');
    const fetchedAt = first.headers.get('x-tcc-fetched-at');
    await first.text();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = await call(app, '/api/rounds/51/matches?junk=1');
    expect(second.headers.get('x-tcc-fetched-at')).toBe(fetchedAt);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Different cache entry when the client says the round is completed.
    const third = await call(app, '/api/rounds/51/matches?completed=1');
    expect(third.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not cache errors', async () => {
    mockUpstream(() => new Response('x', { status: 500 }));
    const app = createApp();
    expect((await call(app, '/api/rounds/61/standings')).status).toBe(502);
    expect((await call(app, '/api/rounds/61/standings')).status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('guardrails', () => {
  it('kill switch returns 503 disabled on every api route', async () => {
    const app = createApp();
    for (const path of ['/api/tournaments/1', '/api/rounds/1/standings', '/api/rounds/1/matches', '/api/nope']) {
      const res = await call(app, path, { TCC_DISABLED: '1' });
      expect(res.status, path).toBe(503);
      expect(((await res.json()) as ProxyError).error).toBe('disabled');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rate limits per client ip with 429', async () => {
    const app = createApp(createLimiter(3, 60_000));
    const ip = { 'cf-connecting-ip': '203.0.113.7' };
    for (let i = 0; i < 3; i++) {
      expect((await call(app, '/api/tournaments/abc', {}, ip)).status).toBe(400);
    }
    const limited = await call(app, '/api/tournaments/abc', {}, ip);
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as ProxyError).error).toBe('rate_limited');
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    // Another client is unaffected.
    expect((await call(app, '/api/tournaments/abc', {}, { 'cf-connecting-ip': '203.0.113.8' })).status).toBe(400);
  });

  it('limiter window resets', () => {
    const l = createLimiter(1, 1000);
    expect(l.hit('a', 0)).toBe(0);
    expect(l.hit('a', 10)).toBeGreaterThan(0);
    expect(l.hit('a', 1000)).toBe(0);
  });

  it('unknown api routes return not_found json', async () => {
    const res = await call(createApp(), '/api/nope');
    expect(res.status).toBe(404);
    expect(((await res.json()) as ProxyError).error).toBe('not_found');
  });
});

describe('MELEE_ORIGIN guard', () => {
  it('defaults to melee.gg and accepts only melee.gg or loopback origins', () => {
    expect(resolveOrigin(undefined)).toBe('https://melee.gg');
    expect(resolveOrigin('')).toBe('https://melee.gg');
    expect(resolveOrigin('https://melee.gg/')).toBe('https://melee.gg');
    expect(resolveOrigin('http://127.0.0.1:8899')).toBe('http://127.0.0.1:8899');
    expect(resolveOrigin('http://localhost:3000')).toBe('http://localhost:3000');
    for (const bad of [
      'http://melee.gg',
      'https://evil.example',
      'https://melee.gg.evil.example',
      'https://melee.gg@evil.example',
      'http://localhost',
      'http://localhost:80/x',
      'http://localhost.evil.example:80',
      'https://localhost:8080',
      'http://127.0.0.1.evil.example:80',
      'ftp://melee.gg',
    ]) {
      expect(() => resolveOrigin(bad), bad).toThrow(/MELEE_ORIGIN/);
    }
  });

  it('answers 500 misconfigured, without any upstream request, for a bad origin', async () => {
    const res = await call(createApp(), '/api/tournaments/484511', { MELEE_ORIGIN: 'https://evil.example' });
    expect(res.status).toBe(500);
    const body = (await res.json()) as ProxyError;
    expect(body.error).toBe('misconfigured');
    expect(body.message).toContain('MELEE_ORIGIN');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('defaults to the honest User-Agent and always identifies itself in X-Client', async () => {
    await call(createApp(), '/api/tournaments/484601');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls as [string, RequestInit][]) {
      const h = init.headers as Record<string, string>;
      expect(h['user-agent']).toBe(USER_AGENT);
      expect(h['x-client']).toBe(USER_AGENT);
    }
  });

  it('MELEE_USER_AGENT=curl sends curl/8.7.1 and still identifies itself in X-Client', async () => {
    await call(createApp(), '/api/tournaments/484602', { MELEE_USER_AGENT: 'curl' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls as [string, RequestInit][]) {
      const h = init.headers as Record<string, string>;
      expect(h['user-agent']).toBe('curl/8.7.1');
      expect(h['x-client']).toBe(USER_AGENT);
    }
  });

  it('ignores any other MELEE_USER_AGENT value (no free-form or browser strings)', async () => {
    await call(createApp(), '/api/tournaments/484603', { MELEE_USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0)' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls as [string, RequestInit][]) {
      expect((init.headers as Record<string, string>)['user-agent']).toBe(USER_AGENT);
    }
  });

  it('sends requests to a configured loopback origin with the honest User-Agent', async () => {
    await call(createApp(), '/api/tournaments/484512', { MELEE_ORIGIN: 'http://127.0.0.1:4010' });
    for (const [url, init] of fetchMock.mock.calls as [string, RequestInit][]) {
      expect(url.startsWith('http://127.0.0.1:4010/')).toBe(true);
      expect((init.headers as Record<string, string>)['user-agent']).toBe(USER_AGENT);
    }
  });
});

describe('structured request log', () => {
  it('logs one JSON line per /api request with no client data', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const app = createApp();
      const hdrs = { 'cf-connecting-ip': '203.0.113.7', authorization: 'secret-token' };
      await call(app, '/api/rounds/777001/standings', {}, hdrs);
      await call(app, '/api/rounds/777001/standings', {}, hdrs);
      await call(app, '/api/tournaments/abc', {}, hdrs);
      const lines = log.mock.calls.map((c) => String(c[0]));
      expect(lines).toHaveLength(3);
      const [miss, hit, bad] = lines.map((l) => JSON.parse(l));
      expect(miss).toMatchObject({ evt: 'api', route: 'standings', status: 200, outcome: 'ok', cache: 'miss', upstream: 200 });
      expect(hit).toMatchObject({ route: 'standings', cache: 'hit', upstream: null });
      expect(bad).toMatchObject({ route: 'tournament', status: 400, outcome: 'bad_request' });
      expect(typeof miss.ms).toBe('number');
      for (const l of lines) {
        expect(l).not.toContain('203.0.113.7');
        expect(l).not.toContain('secret-token');
      }
    } finally {
      log.mockRestore();
    }
  });
});

describe('x-tcc-nocache staging bypass', () => {
  const nocache = { 'x-tcc-nocache': '1' };
  it('is ignored unless TCC_STAGING=1 (production config never sets it)', async () => {
    const app = createApp();
    await call(app, '/api/rounds/777002/matches', {}, nocache);
    await call(app, '/api/rounds/777002/matches', {}, nocache);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await call(app, '/api/rounds/777002/matches', { TCC_STAGING: '0' }, nocache);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('skips the cache when TCC_STAGING=1 and the header is present', async () => {
    const app = createApp();
    await call(app, '/api/rounds/777003/matches', { TCC_STAGING: '1' }, nocache);
    await call(app, '/api/rounds/777003/matches', { TCC_STAGING: '1' }, nocache);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await call(app, '/api/rounds/777003/matches', { TCC_STAGING: '1' }); // no header: normal, and nothing was cached
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it('wrangler.jsonc does not define TCC_STAGING', async () => {
    expect(wranglerConfig).not.toContain('TCC_STAGING');
  });
});

// Golden output of the former HTMLRewriter parser for every fixture. The only intended
// difference is entity decoding of the name (HTMLRewriter text chunks keep entities).
const fixturePages = import.meta.glob('../../../fixtures/melee/*/raw/tournament.html', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const DECODED_NAMES: Record<string, string> = { '464438': "Van's Homeworlds Planetary Qualifier" };

describe('parseTournamentPage', () => {
  it('has a golden for every fixture', () => {
    const ids = Object.keys(fixturePages).map((p) => /melee\/(\d+)\//.exec(p)?.[1]);
    expect(ids.sort()).toEqual(Object.keys(golden).sort());
    expect(ids).toHaveLength(9);
  });

  for (const [path, page] of Object.entries(fixturePages)) {
    const id = /melee\/(\d+)\//.exec(path)?.[1] ?? '';
    it(`matches the HTMLRewriter golden for ${id}`, async () => {
      const expected = structuredClone((golden as Record<string, unknown>)[id]) as { name: string };
      if (DECODED_NAMES[id]) expected.name = DECODED_NAMES[id];
      const parsed = await parseTournamentPage(new Response(page, { headers: HTML_HDR }));
      expect(parsed).toEqual(expected);
    });
  }

  it('handles a null body and a body that ends early', async () => {
    expect(await parseTournamentPage(new Response(null))).toEqual({ name: '', startDate: null, statusText: null, rounds: [] });
    const parsed = await parseTournamentPage(new Response(html.slice(0, html.indexOf('id="pairings-round-selector-container"') + 50)));
    expect(parsed.rounds.length).toBeGreaterThan(0);
  });

  it('decodes entities in heading, status, og:title and round names', async () => {
    const page = `<meta content="A &amp; B" property="og:title"></meta><div id="standings-round-selector-container"><button class="round-selector" data-id="1" data-name="R &lt; 1"></button></div>`;
    const parsed = await parseTournamentPage(new Response(page, { headers: HTML_HDR }));
    expect(parsed.name).toBe('A & B');
    expect(parsed.rounds[0]?.name).toBe('R < 1');
    const h3 = `<div id="tournament-headline-details-card"><h3>Tom &amp; <b>Jerry</b>&nbsp;Cup</h3></div><p id="tournament-headline-registration">Ended | 3 of 4 Enrolled&nbsp;Players</p>`;
    const p2 = await parseTournamentPage(new Response(h3, { headers: HTML_HDR }));
    expect(p2.name).toBe('Tom & Jerry Cup');
    expect(p2.statusText).toBe('Ended | 3 of 4 Enrolled Players');
  });

  it('decodes HTML entities', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; &apos;f&apos; g&nbsp;h')).toBe('a & b <c> "d" \'e\' \'f\' g h');
    expect(decodeEntities('&#233; &#xE9; &#x1F600;')).toBe('\u00e9 \u00e9 \u{1F600}');
    expect(decodeEntities('&bogus; &#0; &#xD800; & plain')).toBe('&bogus; &#0; &#xD800; & plain');
  });
});

describe('compressed round passthrough', () => {
  async function gzip(text: string): Promise<Uint8Array> {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function gunzip(bytes: ArrayBuffer): Promise<string> {
    return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  }

  it('keeps content-encoding and the compressed bytes, and only round fetches ask for manual encoding', async () => {
    const packed = await gzip(standings);
    mockUpstream((url) =>
      url.includes('GetRoundStandings')
        ? new Response(packed, { headers: { ...JSON_HDR, 'content-encoding': 'gzip' } })
        : happy(url),
    );
    const app = createApp();
    const res = await call(app, '/api/rounds/1749901/standings');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-encoding')).toBe('gzip');
    expect(await gunzip(await res.arrayBuffer())).toBe(standings);
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].encodeResponseBody).toBe('manual');

    await call(app, '/api/rounds/1749901/matches');
    expect((fetchMock.mock.calls[1] as [string, RequestInit])[1].encodeResponseBody).toBe('manual');

    await call(app, '/api/tournaments/484599');
    const rest = fetchMock.mock.calls.slice(2) as [string, RequestInit][];
    expect(rest.length).toBe(2);
    for (const [, init] of rest) expect(init.encodeResponseBody).toBeUndefined();
  });

  it('serves the cached compressed response with its encoding intact', async () => {
    const packed = await gzip(matches);
    mockUpstream((url) => new Response(packed, { headers: { ...JSON_HDR, 'content-encoding': 'gzip' } }));
    const app = createApp();
    await call(app, '/api/rounds/1749837/matches');
    const again = await call(app, '/api/rounds/1749837/matches');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const raw = await again.arrayBuffer();
    expect([again.headers.get('content-encoding'), raw.byteLength, packed.byteLength]).toEqual(['gzip', packed.byteLength, packed.byteLength]);
    expect(await gunzip(raw)).toBe(matches);
  });
});
