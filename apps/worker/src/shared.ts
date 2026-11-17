/**
 * Pieces shared by the site scraper (melee.ts) and the official-API client
 * (api.ts). Kept free of Workers-only globals so tools/capture-melee-api.ts can
 * import api.ts under plain Node.
 */
import type { ProxyRound } from '@swu-tcc/core';

/** The only upstream host. Never built from user input. */
export const MELEE_ORIGIN = 'https://melee.gg';

export const USER_AGENT = 'SWU-TCC/0.1 (+https://swu-tcc.win)';

/**
 * Site-mode User-Agent. `MELEE_USER_AGENT` selects between two fixed values:
 * `honest` sends `SWU-TCC/0.1 (+https://swu-tcc.win)` and `curl` sends curl's
 * default User-Agent. Any other value means `honest`; free-form or browser
 * strings are never used. Every request also carries X-Client with our real
 * identity, and Cloudflare adds CF-Worker with our domain, so Melee can always
 * tell who we are and block us if they want to.
 */
export const CURL_USER_AGENT = 'curl/8.7.1';
export const CLIENT_HEADER = USER_AGENT;
export type UserAgentMode = 'honest' | 'curl';

export function userAgentFor(mode: string | undefined): string {
  return mode === 'curl' ? CURL_USER_AGENT : USER_AGENT;
}

export type UpstreamErrorKind = 'not_found' | 'upstream_error' | 'not_authorized';

// No parameter properties: tools/capture-melee-api.ts imports this file under Node's type stripping.
export class UpstreamError extends Error {
  kind: UpstreamErrorKind;
  /** HTTP status Melee answered with, when it answered at all (for the request log). */
  upstreamStatus: number | null;
  constructor(kind: UpstreamErrorKind, message: string, upstreamStatus: number | null = null) {
    super(message);
    this.kind = kind;
    this.upstreamStatus = upstreamStatus;
  }
}

const PLAYOFF_NAME = /^(quarter-?finals?|semi-?finals?|finals?|top\s*\d+|round\s+of\s+\d+)$/i;

/** 'Round N' is Swiss; bracket names (Quarterfinals ... Round of N) are playoff; unknown labels stay Swiss. */
export function roundKind(name: string): ProxyRound['kind'] {
  return PLAYOFF_NAME.test(name.trim()) ? 'playoff' : 'swiss';
}

