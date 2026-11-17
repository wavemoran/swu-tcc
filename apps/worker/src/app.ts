import type { ProxyError, ProxyTournament } from '@swu-tcc/core';
import { Hono } from 'hono';
import {
  ConfigError,
  UpstreamError,
  fetchRoundMatches,
  fetchRoundStandings,
  fetchStandingsConfig,
  fetchTournamentPage,
  parseId,
  parseTournamentPage,
  resolveOrigin,
  type SiteUpstream,
} from './melee';
import { userAgentFor } from './shared';
import { ApiClient, credentialsFrom, roundBody } from './api';
import { adaptTournamentDetails } from './apiAdapter';
import { createLimiter, memoryBinding, type Limiter, type RateLimitBinding } from './ratelimit';

export interface Env {
  TCC_DISABLED?: string;
  /** Upstream origin; `https://melee.gg` unless an e2e run points it at a local fake. */
  MELEE_ORIGIN?: string;
  /** `site` (default): Melee's website endpoints. `api`: the official credentialed API. */
  MELEE_SOURCE?: string;
  /** `honest` (default) or `curl`: the User-Agent for site mode (see shared.ts). */
  MELEE_USER_AGENT?: string;
  /** Wrangler secrets (`wrangler secret put`), only read in `api` mode. Never logged or returned. */
  MELEE_CLIENT_ID?: string;
  MELEE_CLIENT_SECRET?: string;
  /** Staging only (set with `--var TCC_STAGING:1` on a staging deploy, never in wrangler.jsonc): enables `x-tcc-nocache`. */
  TCC_STAGING?: string;
  /** Workers Rate Limiting bindings (wrangler.jsonc `ratelimits`). Optional: absent in tests/e2e, where in-memory limiters stand in. */
  MELEE_LOCATION_LIMIT?: RateLimitBinding;
  MELEE_CLIENT_LIMIT?: RateLimitBinding;
  /** E2E only (`--var TCC_NO_UPSTREAM_LIMITS:1`, never in wrangler.jsonc): skip the upstream limits, since all e2e traffic shares one IP. */
  TCC_NO_UPSTREAM_LIMITS?: string;
  ASSETS: Fetcher;
}

/** Limiters for upstream (cache-miss) fetches. Injectable so tests are deterministic. */
export interface UpstreamLimits {
  location: RateLimitBinding;
  client: RateLimitBinding;
}

export const LOCATION_LIMIT = { limit: 30, windowMs: 10_000, retryAfter: 10 };
export const CLIENT_LIMIT = { limit: 20, windowMs: 60_000, retryAfter: 60 };
export const IP_BACKSTOP = { limit: 600, windowMs: 60_000 };
/** How long a Melee not-found answer is cached. */
export const TTL_NOT_FOUND = 600;

/** Thrown inside the upstream path when a limiter refuses; turned into a 429 by onError. Never cached. */
class UpstreamRefused extends Error {
  retryAfter: number;
  constructor(message: string, retryAfter: number) {
    super(message);
    this.retryAfter = retryAfter;
  }
}

interface Buffered {
  headers: [string, string][];
  body: ArrayBuffer;
}

/** In-flight upstream fetches in this isolate, keyed by cache key URL. */
const inflight = new Map<string, Promise<Buffered>>();

export const TTL_TOURNAMENT = 60;
export const TTL_ROUND_LIVE = 30;
export const TTL_ROUND_DONE = 24 * 60 * 60;

/** Seconds to cache a round response. `completed` comes from the client's ProxyTournament. */
export function roundTtl(completed: boolean): number {
  return completed ? TTL_ROUND_DONE : TTL_ROUND_LIVE;
}

const STATUS = {
  not_found: 404,
  bad_request: 400,
  upstream_error: 502,
  rate_limited: 429,
  disabled: 503,
  misconfigured: 500,
  not_authorized: 403,
} as const;

export type Source = 'site' | 'api';

/** Which upstream to use. Unset/blank means `site`; anything but `site`/`api` is a configuration error. */
export function selectSource(env: Pick<Env, 'MELEE_SOURCE'>): Source | null {
  const v = env.MELEE_SOURCE?.trim().toLowerCase();
  if (!v || v === 'site') return 'site';
  return v === 'api' ? 'api' : null;
}

type Upstream = { source: 'site' } | { source: 'api'; client: ApiClient } | { error: Response };

/** Resolve mode and credentials before touching the cache or the network. */
function upstreamFor(env: Env): Upstream {
  const source = selectSource(env);
  if (source === null) return { error: fail('disabled', 'MELEE_SOURCE must be "site" or "api".') };
  if (source === 'site') return { source };
  const credentials = credentialsFrom(env);
  if (!credentials) {
    return {
      error: fail(
        'disabled',
        'The official Melee API is selected but its credentials are not configured (MELEE_CLIENT_ID / MELEE_CLIENT_SECRET).',
      ),
    };
  }
  return { source, client: new ApiClient({ credentials }) };
}

function fail(error: ProxyError['error'], message: string, extra?: Record<string, string>): Response {
  const body: ProxyError = { error, message };
  return new Response(JSON.stringify(body), {
    status: STATUS[error],
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-tcc-fetched-at': new Date().toISOString(),
      ...extra,
    },
  });
}

/** Cache key: our own GET URL; only `completed=1` is significant on round routes. */
function cacheKey(url: URL, withCompleted: boolean, source: Source): Request {
  const key = new URL(url.origin + url.pathname);
  key.searchParams.set('src', source); // flipping MELEE_SOURCE must not serve the other source's cached bodies
  if (withCompleted && url.searchParams.get('completed') === '1') key.searchParams.set('completed', '1');
  return new Request(key.toString(), { method: 'GET' });
}

/** Per-request facts for the structured log. Never holds IPs, headers or secrets. */
export interface LogMeta {
  cache: 'hit' | 'miss' | 'coalesced' | 'none';
  upstream: number | null;
}

function routeKind(path: string): 'tournament' | 'standings' | 'matches' | 'other' {
  if (/^\/api\/tournaments\/[^/]+$/.test(path)) return 'tournament';
  if (/^\/api\/rounds\/[^/]+\/standings$/.test(path)) return 'standings';
  if (/^\/api\/rounds\/[^/]+\/matches$/.test(path)) return 'matches';
  return 'other';
}

const OUTCOME_BY_STATUS = new Map<number, string>(
  Object.entries(STATUS).map(([name, status]) => [status, name] as [number, string]),
);

async function cached(
  meta: LogMeta,
  ctx: { waitUntil(p: Promise<unknown>): void },
  key: Request,
  ttl: number,
  source: Source,
  /** Runs right before the upstream fetch; throws UpstreamRefused to refuse. */
  admit: () => Promise<void>,
  build: () => Promise<Response>,
  bypass = false,
): Promise<Response> {
  const cache = caches.default;
  const hit = bypass ? undefined : await cache.match(key);
  if (hit) {
    meta.cache = 'hit';
    return hit;
  }

  const make = (b: Buffered): Response => {
    const headers = new Headers(b.headers);
    return new Response(b.body.slice(0), { status: 200, headers, encodeBody: headers.has('content-encoding') ? 'manual' : 'automatic' });
  };

  const waiting = bypass ? undefined : inflight.get(key.url);
  if (waiting) {
    meta.cache = 'coalesced';
    return make(await waiting);
  }
  meta.cache = 'miss';

  const run = async (): Promise<Buffered> => {
    await admit();
    let upstream: Response;
    try {
      upstream = await build();
    } catch (e) {
      if (e instanceof UpstreamError && e.kind === 'not_found' && !bypass) {
        // Remember "no such id" so a repeated lookup does not reach Melee again for a while.
        const nf = fail('not_found', e.message, { 'cache-control': `public, max-age=${TTL_NOT_FOUND}` });
        ctx.waitUntil(cache.put(key, nf));
      }
      throw e;
    }
    meta.upstream = 200;
    const headers = new Headers(upstream.headers);
    headers.set('cache-control', `public, max-age=${ttl}`);
    headers.set('x-tcc-source', source);
    if (!headers.has('x-tcc-fetched-at')) headers.set('x-tcc-fetched-at', new Date().toISOString());
    const buffered: Buffered = { headers: [...headers], body: await upstream.arrayBuffer() };
    if (!bypass) {
      // A fresh Response with encodeBody: 'manual' for compressed bytes, or they get stored double-encoded.
      ctx.waitUntil(cache.put(key, make(buffered)));
    }
    return buffered;
  };

  if (bypass) return make(await run());
  const promise = run();
  inflight.set(key.url, promise);
  const clear = () => {
    if (inflight.get(key.url) === promise) inflight.delete(key.url);
  };
  promise.then(clear, clear);
  return make(await promise);
}

/** Measurement aid: honoured only when the staging var is on, so production config can never enable it. */
export function wantsBypass(env: Pick<Env, 'TCC_STAGING'>, req: Request): boolean {
  return env.TCC_STAGING === '1' && req.headers.has('x-tcc-nocache');
}

function passthrough(upstream: Response): Response {
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'x-tcc-fetched-at': new Date().toISOString(),
  };
  // Round fetches use encodeResponseBody: 'manual', so the body may still be compressed; say so.
  const encoding = upstream.headers.get('content-encoding');
  if (encoding) headers['content-encoding'] = encoding;
  return new Response(upstream.body, { status: 200, headers, encodeBody: encoding ? 'manual' : 'automatic' });
}

export function createApp(
  limiter: Limiter = createLimiter(IP_BACKSTOP.limit, IP_BACKSTOP.windowMs),
  injected?: Partial<UpstreamLimits>,
) {
  // Fallbacks when the Rate Limiting bindings are not configured (unit tests, e2e, odd dev setups).
  const fallback: UpstreamLimits = {
    location: injected?.location ?? memoryBinding(LOCATION_LIMIT.limit, LOCATION_LIMIT.windowMs),
    client: injected?.client ?? memoryBinding(CLIENT_LIMIT.limit, CLIENT_LIMIT.windowMs),
  };

  /** Charge `cost` Melee requests against the client, then the location. Throws UpstreamRefused. */
  const admitFor = (env: Env, req: Request, cost: number) => async () => {
    if (env.TCC_NO_UPSTREAM_LIMITS === '1') return;
    const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
    const client = injected?.client ?? env.MELEE_CLIENT_LIMIT ?? fallback.client;
    const location = injected?.location ?? env.MELEE_LOCATION_LIMIT ?? fallback.location;
    if (!(await client.limit({ key: ip, delta: cost })).success) {
      throw new UpstreamRefused("You've loaded a lot of new data in the last minute; wait a moment.", CLIENT_LIMIT.retryAfter);
    }
    if (!(await location.limit({ key: 'melee', delta: cost })).success) {
      throw new UpstreamRefused('Lots of people are loading new data right now; try again in a few seconds.', LOCATION_LIMIT.retryAfter);
    }
  };

  const app = new Hono<{ Bindings: Env; Variables: { site: SiteUpstream; log: LogMeta } }>();

  // Structured request log (Workers Logs). Route kind, outcome, cache and timing only.
  app.use('/api/*', async (c, next) => {
    const started = Date.now();
    const meta: LogMeta = { cache: 'none', upstream: null };
    c.set('log', meta);
    try {
      await next();
    } finally {
      const status = c.res.status;
      console.log(
        JSON.stringify({
          evt: 'api',
          route: routeKind(c.req.path),
          status,
          outcome: status < 400 ? 'ok' : (OUTCOME_BY_STATUS.get(status) ?? 'error'),
          cache: meta.cache,
          upstream: meta.upstream,
          ms: Date.now() - started,
        }),
      );
    }
  });

  app.use('/api/*', async (c, next) => {
    if (c.env.TCC_DISABLED === '1') {
      return fail('disabled', 'The Melee proxy is switched off right now.');
    }
    try {
      c.set('site', { origin: resolveOrigin(c.env.MELEE_ORIGIN), userAgent: userAgentFor(c.env.MELEE_USER_AGENT) });
    } catch (e) {
      if (e instanceof ConfigError) return fail('misconfigured', e.message);
      throw e;
    }
    const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
    const wait = limiter.hit(ip);
    if (wait > 0) {
      return fail('rate_limited', 'Too many requests. Slow down.', { 'retry-after': String(wait) });
    }
    await next();
  });

  app.onError((e, c) => {
    if (e instanceof UpstreamRefused) {
      return fail('rate_limited', e.message, { 'retry-after': String(e.retryAfter) });
    }
    if (e instanceof UpstreamError) {
      const meta = c.get('log');
      if (meta) meta.upstream = e.upstreamStatus;
      return fail(e.kind, e.message);
    }
    return fail('upstream_error', 'Unexpected error talking to Melee.gg.');
  });

  app.get('/api/tournaments/:id', async (c) => {
    const id = parseId(c.req.param('id'));
    if (id === null) return fail('bad_request', 'Tournament id must be a positive integer.');
    const up = upstreamFor(c.env);
    if ('error' in up) return up.error;
    const key = cacheKey(new URL(c.req.url), false, up.source);
    return cached(c.get('log'), c.executionCtx, key, TTL_TOURNAMENT, up.source, admitFor(c.env, c.req.raw, 2), async () => {
      let parts: Pick<ProxyTournament, 'name' | 'startDate' | 'statusText' | 'rounds' | 'standingsConfig'>;
      if (up.source === 'api') {
        // standingsConfig: the API has no equivalent; null makes core use CEG defaults (1/3 floor).
        parts = { ...adaptTournamentDetails(await up.client.tournament(id)), standingsConfig: null };
      } else {
        const site = c.get('site');
        const [page, config] = await Promise.all([fetchTournamentPage(site, id), fetchStandingsConfig(site, id)]);
        const parsed = await parseTournamentPage(page);
        parts = { ...parsed, standingsConfig: await config.json() };
      }
      const body: ProxyTournament = { id, ...parts, fetchedAt: new Date().toISOString(), source: up.source };
      return new Response(JSON.stringify(body), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'x-tcc-fetched-at': body.fetchedAt,
        },
      });
    }, wantsBypass(c.env, c.req.raw));
  });

  const roundRoute = (kind: 'standings' | 'matches') =>
    app.get(`/api/rounds/:roundId/${kind}`, async (c) => {
      const roundId = parseId(c.req.param('roundId'));
      if (roundId === null) return fail('bad_request', 'Round id must be a positive integer.');
      const url = new URL(c.req.url);
      const completed = url.searchParams.get('completed') === '1';
      const up = upstreamFor(c.env);
      if ('error' in up) return up.error;
      const key = cacheKey(url, true, up.source);
      return cached(c.get('log'), c.executionCtx, key, roundTtl(completed), up.source, admitFor(c.env, c.req.raw, 1), async () => {
        if (up.source === 'api') {
          const paged = await (kind === 'standings' ? up.client.roundStandings(roundId) : up.client.roundMatches(roundId));
          return new Response(JSON.stringify(roundBody(paged)), {
            headers: { 'content-type': 'application/json; charset=utf-8', 'x-tcc-fetched-at': new Date().toISOString() },
          });
        }
        const site = c.get('site');
        return passthrough(await (kind === 'standings' ? fetchRoundStandings(site, roundId) : fetchRoundMatches(site, roundId)));
      }, wantsBypass(c.env, c.req.raw));
    });
  roundRoute('standings');
  roundRoute('matches');

  app.all('/api/*', () => fail('not_found', 'No such API route.'));

  // Outside /api the platform serves assets itself; this only helps `wrangler dev` edge cases.
  app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

  return app;
}


