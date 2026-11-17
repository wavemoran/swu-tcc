import type { ProxyError, ProxyTournament } from '@swu-tcc/core';

export type ApiErrorKind = ProxyError['error'] | 'network' | 'unknown';

export class ApiError extends Error {
  kind: ApiErrorKind;
  status: number;
  constructor(kind: ApiErrorKind, message: string, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
  }
}

/** Base delay before the single retry; jitter of up to RETRY_JITTER_MS is added. */
export const RETRY_DELAY_MS = 400;
export const RETRY_JITTER_MS = 200;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      done();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      done();
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort);
  });
}

/**
 * One attempt. Returns the response, or throws the network ApiError. A 5xx (including
 * Cloudflare's HTML error pages such as 1102) or a network failure is worth one retry;
 * 4xx and our own ProxyError bodies (not_found, rate_limited, ...) are not.
 */
async function attempt(path: string, signal?: AbortSignal): Promise<Response> {
  try {
    return await fetch(path, { signal, headers: { accept: 'application/json' } });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError('network', 'Could not reach the server. Check your connection.');
  }
}

/**
 * Only platform failures are retried: a 5xx that is NOT one of our ProxyError bodies
 * (Cloudflare's HTML error pages such as 1102 "exceeded resources"). Any ProxyError is a
 * deliberate answer from our worker; in particular upstream_error is usually Melee refusing
 * or failing, and retrying it would only send Melee a second request.
 */
async function retryable(res: Response): Promise<boolean> {
  if (res.status < 500) return false;
  try {
    const err = (await res.clone().json()) as Partial<ProxyError>;
    return typeof err.error !== 'string';
  } catch {
    return true; // HTML error pages (Cloudflare 1102 etc.)
  }
}

async function fetchWithRetry(path: string, signal?: AbortSignal): Promise<Response> {
  let first: Response | ApiError;
  try {
    first = await attempt(path, signal);
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    first = e;
  }
  if (first instanceof Response && !(await retryable(first))) return first;
  await sleep(RETRY_DELAY_MS + Math.random() * RETRY_JITTER_MS, signal);
  let second: Response | undefined;
  try {
    second = await attempt(path, signal);
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
  }
  // Still failing: give up and report the original failure through the normal mapping.
  if (!second || second.status >= 500) {
    if (first instanceof ApiError) throw first;
    return first;
  }
  return second;
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<{ body: T; fetchedAt: string | null }> {
  const res = await fetchWithRetry(path, signal);
  if (!res.ok) {
    let kind: ApiErrorKind = res.status === 404 ? 'not_found' : 'unknown';
    let message = `Request failed (${res.status}).`;
    try {
      const err = (await res.json()) as Partial<ProxyError>;
      if (err.error) kind = err.error;
      if (err.message) message = err.message;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(kind, message, res.status);
  }
  const body = (await res.json()) as T;
  return { body, fetchedAt: res.headers.get('x-tcc-fetched-at') };
}

export async function fetchTournament(id: string, signal?: AbortSignal): Promise<ProxyTournament> {
  const { body } = await getJson<ProxyTournament>(`/api/tournaments/${encodeURIComponent(id)}`, signal);
  return body;
}

export async function fetchRoundStandings(roundId: number, completed: boolean, signal?: AbortSignal): Promise<unknown> {
  return (await getJson<unknown>(`/api/rounds/${roundId}/standings?completed=${completed ? 1 : 0}`, signal)).body;
}

export async function fetchRoundMatches(roundId: number, completed: boolean, signal?: AbortSignal): Promise<unknown> {
  return (await getJson<unknown>(`/api/rounds/${roundId}/matches?completed=${completed ? 1 : 0}`, signal)).body;
}

/** Run async tasks with at most `limit` in flight; results keep input order. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
