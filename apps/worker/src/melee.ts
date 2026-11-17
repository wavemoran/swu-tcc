import type { ProxyRound } from '@swu-tcc/core';
import { CLIENT_HEADER, MELEE_ORIGIN, USER_AGENT, UpstreamError, roundKind } from './shared.ts';

/** Where and how the site endpoints are fetched. */
export interface SiteUpstream {
  origin: string;
  userAgent: string;
}

export { MELEE_ORIGIN, USER_AGENT, UpstreamError, roundKind };
export type { UpstreamErrorKind } from './shared.ts';

export class ConfigError extends Error {}

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):\d{1,5}$/;

/**
 * The upstream origin comes from the `MELEE_ORIGIN` var so end-to-end tests can point
 * the worker at a local fake. Safety guard: only Melee itself or a loopback address
 * is accepted, so a bad config can never aim this proxy at another host.
 */
export function resolveOrigin(raw: string | undefined): string {
  const value = (raw ?? '').trim().replace(/\/$/, '');
  if (value === '') return MELEE_ORIGIN;
  if (value === MELEE_ORIGIN || LOCAL_ORIGIN.test(value)) return value;
  throw new ConfigError(
    `MELEE_ORIGIN must be ${MELEE_ORIGIN} or http://localhost:<port> / http://127.0.0.1:<port>; got "${raw}".`,
  );
}


/** Positive integer, at most 10 digits. */
export function parseId(raw: string): number | null {
  return /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : null;
}

const FORM = 'application/x-www-form-urlencoded; charset=UTF-8';

function baseHeaders(site: SiteUpstream, accept: string): Record<string, string> {
  return { 'user-agent': site.userAgent, 'x-client': CLIENT_HEADER, accept };
}

/** GET a Melee JSON/HTML resource. Redirects are never followed (Melee 302s to an HTML error page). */
async function upstream(site: SiteUpstream, path: string, init: RequestInit, wantJson: boolean, rawEncoding = false): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${site.origin}${path}`, {
      ...init,
      redirect: 'manual',
      // Round JSON is passed through untouched: keep Melee's compressed bytes instead of decoding and re-encoding them.
      ...(rawEncoding ? { encodeResponseBody: 'manual' as const } : {}),
    });
  } catch {
    throw new UpstreamError('upstream_error', 'Could not reach Melee.gg.');
  }
  if (res.status === 404) {
    await res.body?.cancel();
    throw new UpstreamError('not_found', 'Melee.gg has no such resource.', 404);
  }
  if (res.status === 403) {
    await res.body?.cancel();
    throw new UpstreamError(
      'upstream_error',
      'Melee.gg refused the request (403). It may be blocking this tool; try again later or enter results manually.',
      403,
    );
  }
  if (res.status < 200 || res.status >= 300) {
    await res.body?.cancel();
    throw new UpstreamError('upstream_error', `Melee.gg answered ${res.status}.`, res.status);
  }
  const type = res.headers.get('content-type') ?? '';
  if (wantJson ? !/json/i.test(type) : !/html/i.test(type)) {
    await res.body?.cancel();
    throw new UpstreamError('upstream_error', 'Melee.gg returned an unexpected response type.', res.status);
  }
  return res;
}

export function fetchTournamentPage(site: SiteUpstream, id: number): Promise<Response> {
  return upstream(site, `/Tournament/View/${id}`, { headers: baseHeaders(site, 'text/html') }, false);
}

export function fetchStandingsConfig(site: SiteUpstream, id: number): Promise<Response> {
  return upstream(
    site,
    `/Standing/GetStandingsConfig/${id}`,
    { headers: baseHeaders(site, 'application/json') },
    true,
  );
}

export function fetchRoundStandings(site: SiteUpstream, roundId: number): Promise<Response> {
  return upstream(
    site,
    '/Standing/GetRoundStandings',
    {
      method: 'POST',
      headers: { ...baseHeaders(site, 'application/json'), 'content-type': FORM },
      body: `draw=1&start=0&length=-1&roundId=${roundId}`,
    },
    true,
    true,
  );
}

export function fetchRoundMatches(site: SiteUpstream, roundId: number): Promise<Response> {
  return upstream(
    site,
    `/Match/GetRoundMatches/${roundId}`,
    {
      method: 'POST',
      headers: { ...baseHeaders(site, 'application/json'), 'content-type': FORM },
      body: 'draw=1&start=0&length=-1',
    },
    true,
    true,
  );
}

export interface ParsedTournamentPage {
  name: string;
  startDate: string | null;
  statusText: string | null;
  rounds: ProxyRound[];
}

/** Keep the last two `|` segments ("Ended | 52 of 88 Enrolled Players") when the text ends with the enrolled count. */
export function trimStatus(raw: string): string | null {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const parts = text.split('|').map((p) => p.trim());
  if (parts.length >= 2 && /enrolled/i.test(parts[parts.length - 1] ?? '')) {
    return parts.slice(-2).join(' | ');
  }
  return text;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Decodes the few HTML entities Melee emits: named (amp lt gt quot apos nbsp), `&#NNN;` and `&#xHH;`. */
export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]{2,6}));/g, (whole, dec?: string, hex?: string, name?: string) => {
    if (name !== undefined) return NAMED_ENTITIES[name] ?? whole;
    const code = dec !== undefined ? Number(dec) : parseInt(hex ?? '', 16);
    if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return whole;
    return String.fromCodePoint(code);
  });
}

/** Streams the Melee tournament page through HTMLRewriter and extracts what we need. */
export async function parseTournamentPage(res: Response): Promise<ParsedTournamentPage> {
  const rounds = new Map<number, ProxyRound>();
  let heading = '';
  let ogTitle = '';
  let startDate: string | null = null;
  let status = '';

  const roundHandler = (kind: 'standings' | 'pairings') => ({
    element(el: Element) {
      const id = Number(el.getAttribute('data-id'));
      if (!Number.isSafeInteger(id) || id <= 0) return;
      let round = rounds.get(id);
      if (!round) {
        round = { id, name: decodeEntities(el.getAttribute('data-name') ?? ''), started: false, completed: false, kind: 'swiss' };
        rounds.set(id, round);
      }
      if (!round.name) round.name = decodeEntities(el.getAttribute('data-name') ?? '');
      if (kind === 'standings') {
        round.completed = el.getAttribute('data-is-completed')?.toLowerCase() === 'true';
      } else {
        round.started = el.getAttribute('data-is-started')?.toLowerCase() === 'true';
      }
    },
  });

  const transformed = new HTMLRewriter()
    .on('#standings-round-selector-container .round-selector[data-id]', roundHandler('standings'))
    .on('#pairings-round-selector-container .round-selector[data-id]', roundHandler('pairings'))
    .on('#tournament-headline-details-card h3', {
      text(t) {
        heading += t.text;
      },
    })
    .on('meta[property="og:title"]', {
      element(el) {
        ogTitle ||= decodeEntities(el.getAttribute('content') ?? '');
      },
    })
    .on('#tournament-headline-start-date-field span[data-value]', {
      element(el) {
        startDate ??= el.getAttribute('data-value');
      },
    })
    .on('#tournament-headline-registration', {
      text(t) {
        status += t.text;
      },
    })
    .transform(res);

  // Drain the stream so the handlers run.
  await transformed.arrayBuffer();

  // HTMLRewriter hands back raw text and attribute values, entities included.
  const decode = (s: string) => decodeEntities(s).replace(/\s+/g, ' ').trim();
  return {
    name: decode(heading) || ogTitle.replace(/\s+/g, ' ').trim(),
    startDate,
    statusText: trimStatus(decodeEntities(status)),
    rounds: [...rounds.values()].map((r) => ({ ...r, kind: roundKind(r.name) })),
  };
}
