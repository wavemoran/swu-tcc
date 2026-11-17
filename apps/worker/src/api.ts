/**
 * Client for Melee's official, credentialed API (endpoints: docs/research/melee-api.md).
 *
 * Runs in the Worker and, unchanged, in Node (tools/capture-melee-api.ts), so it
 * uses only `fetch`, `btoa` and `TextEncoder`, and no parameter properties.
 *
 * Secrets: the Authorization header is built here and sent only to MELEE_ORIGIN.
 * Nothing in this file puts credentials in a message, a log or a response body.
 */
import { MELEE_ORIGIN, UpstreamError, USER_AGENT } from './shared.ts';

/** `variables.pageSize` is clamped to 5..250 (default 25). */
export const API_PAGE_SIZE = 250;

/**
 * The Workers Free plan allows 50 subrequests per request. Stay under it, with
 * room for Cache API calls. Exceeding it is an error, never a silent truncation.
 */
export const MAX_SUBREQUESTS = 40;

export interface ApiCredentials {
  clientId: string;
  clientSecret: string;
}

/** Both secrets present and non-blank, else null. Whitespace around a pasted secret is trimmed. */
export function credentialsFrom(env: { MELEE_CLIENT_ID?: string; MELEE_CLIENT_SECRET?: string }): ApiCredentials | null {
  const clientId = env.MELEE_CLIENT_ID?.trim();
  const clientSecret = env.MELEE_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** HTTP Basic: `Basic base64(clientId:clientSecret)` (spec securityDefinitions.basic). */
export function basicAuthHeader(c: ApiCredentials): string {
  const bytes = new TextEncoder().encode(`${c.clientId}:${c.clientSecret}`);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `Basic ${btoa(bin)}`;
}

export interface ApiClientOptions {
  credentials: ApiCredentials;
  fetch?: typeof fetch;
  /** Hard cap on upstream requests made by this client. */
  maxRequests?: number;
  /** Pause between requests (the capture tool uses 1000). */
  delayMs?: number;
  /** Called with every raw JSON body, labelled by request (see `rawLabel`). */
  onRaw?: (label: string, body: unknown) => void;
}

export interface PagedRows {
  rows: unknown[];
  pages: number;
  /** `recordsTotal` from the last ApiResult, if present. */
  total: number | null;
}

/** File-name-safe label of a request, e.g. `/api/standing/list/round/5?variables.page=2` -> `standing-list-round-5-p2`. */
export function rawLabel(path: string): string {
  const [p = '', q = ''] = path.split('?');
  const page = /variables\.page=(\d+)/.exec(q)?.[1];
  const base = p.replace(/^\/api\//, '').replace(/\//g, '-');
  return page ? `${base}-p${page}` : base;
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function shapeError(field: string): UpstreamError {
  return new UpstreamError('upstream_error', `API response shape not recognized: ${field}`);
}

/**
 * ApiResult.statusCode is an enum name ("OK", "Unauthorized", ...). The spec's
 * `tournament/list` returns HTTP 400 with an ApiResult, so a body can carry a
 * failure even when the transport succeeded.
 */
function checkBodyStatus(body: unknown): void {
  if (!isRec(body) || body.statusCode === undefined) return;
  const s = String(body.statusCode).toLowerCase();
  if (s === 'ok' || s === '200') return;
  if (s === 'unauthorized' || s === 'forbidden' || s === '401' || s === '403') {
    throw new UpstreamError('not_authorized', 'The Melee API refused our credentials for this tournament.');
  }
  if (s === 'notfound' || s === '404') throw new UpstreamError('not_found', 'Melee.gg has no such resource.');
  throw new UpstreamError('upstream_error', `The Melee API reported status ${String(body.statusCode)}.`);
}

export class ApiClient {
  requests = 0;
  readonly #auth: string;
  readonly #fetch: typeof fetch;
  readonly #max: number;
  readonly #delayMs: number;
  readonly #onRaw: ((label: string, body: unknown) => void) | undefined;

  constructor(opts: ApiClientOptions) {
    this.#auth = basicAuthHeader(opts.credentials);
    this.#fetch = opts.fetch ?? ((input, init) => fetch(input, init));
    this.#max = opts.maxRequests ?? MAX_SUBREQUESTS;
    this.#delayMs = opts.delayMs ?? 0;
    this.#onRaw = opts.onRaw;
  }

  async #get(path: string): Promise<unknown> {
    if (this.requests >= this.#max) {
      throw new UpstreamError(
        'upstream_error',
        `This response needs more than ${this.#max} requests to the Melee API; giving up instead of returning partial data.`,
      );
    }
    if (this.requests > 0 && this.#delayMs > 0) await new Promise((r) => setTimeout(r, this.#delayMs));
    this.requests++;
    let res: Response;
    try {
      res = await this.#fetch(`${MELEE_ORIGIN}${path}`, {
        method: 'GET',
        headers: { authorization: this.#auth, accept: 'application/json', 'user-agent': USER_AGENT },
        redirect: 'manual',
      });
    } catch {
      throw new UpstreamError('upstream_error', 'Could not reach the Melee API.');
    }
    if (res.status === 401 || res.status === 403) {
      await res.body?.cancel();
      throw new UpstreamError('not_authorized', 'The Melee API refused our credentials for this tournament.');
    }
    if (res.status === 404) {
      await res.body?.cancel();
      throw new UpstreamError('not_found', 'Melee.gg has no such resource.');
    }
    if (res.status < 200 || res.status >= 300) {
      await res.body?.cancel();
      throw new UpstreamError('upstream_error', `The Melee API answered ${res.status}.`);
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new UpstreamError('upstream_error', 'The Melee API returned a body that is not JSON.');
    }
    this.#onRaw?.(rawLabel(path), body);
    checkBodyStatus(body);
    return body;
  }

  /** GET /api/tournament/{id}: details. Body is returned as the API sent it. */
  tournament(id: number): Promise<unknown> {
    return this.#get(`/api/tournament/${id}`);
  }

  /**
   * Fetch every page of a paged endpoint (`variables.page`, `variables.pageSize`).
   * ASSUMPTION: each page is an ApiResult whose `content` is an array of rows (or
   * a bare array). Continues while `hasMore` is true; if `hasMore` is absent,
   * while a full page came back and `recordsTotal` is not yet reached.
   */
  async paged(path: string): Promise<PagedRows> {
    const rows: unknown[] = [];
    let total: number | null = null;
    for (let page = 1; ; page++) {
      const body = await this.#get(`${path}?variables.page=${page}&variables.pageSize=${API_PAGE_SIZE}`);
      const content = Array.isArray(body) ? body : isRec(body) ? body.content : undefined;
      if (!Array.isArray(content)) throw shapeError('content (expected an array of rows)');
      rows.push(...content);
      if (isRec(body) && typeof body.recordsTotal === 'number') total = body.recordsTotal;
      const hasMore = isRec(body) ? body.hasMore : undefined;
      const more =
        typeof hasMore === 'boolean'
          ? hasMore
          : content.length >= API_PAGE_SIZE && (total === null || rows.length < total);
      if (!more || content.length === 0) return { rows, pages: page, total };
    }
  }

  /** GET /api/standing/list/round/{roundId} */
  roundStandings(roundId: number): Promise<PagedRows> {
    return this.paged(`/api/standing/list/round/${roundId}`);
  }

  /** GET /api/match/list/round/{roundId} */
  roundMatches(roundId: number): Promise<PagedRows> {
    return this.paged(`/api/match/list/round/${roundId}`);
  }
}

/**
 * Body we hand to the browser for a round: a DataTables-style wrapper so the
 * web app and core need no changes. Core also accepts the raw ApiResult shape.
 */
export function roundBody(p: PagedRows): { draw: number; recordsTotal: number; recordsFiltered: number; data: unknown[] } {
  return { draw: 0, recordsTotal: p.total ?? p.rows.length, recordsFiltered: p.total ?? p.rows.length, data: p.rows };
}
