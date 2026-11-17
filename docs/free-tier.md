# Staying on the Cloudflare free tier

SWU TCC must run on Cloudflare's **Workers Free** plan. On that plan,
going over a limit makes requests fail; it never creates a bill. A bill is
only possible if the account is upgraded to Workers Paid, so **keep the
account on Workers Free** and treat any change that needs a paid feature as a
design change to discuss first.

## How the design keeps usage low

| Limit (Workers Free) | How we stay under it |
|---|---|
| 100,000 Worker requests/day | Static files (HTML, JS, CSS, icons) are served by Workers static assets, which are free and do not count. Only `/api/*` runs the Worker (`run_worker_first: ["/api/*"]`). Note: once the daily limit is hit, `run_worker_first` requests get a 429 while asset requests keep working. |
| 10 ms CPU per request | The Worker never parses Melee's JSON; it streams it through. Standings and tiebreaker math run in the visitor's browser (`packages/core`). Only the tournament page is parsed, with HTMLRewriter (native, so cheaper than any JS string scan); round JSON stays compressed end to end (`encodeResponseBody: 'manual'`). |
| 50 subrequests per request | Each API route makes at most 2 upstream fetches in `site` mode. In `api` mode a tournament is 1 fetch and a round is 1 fetch per page of 250 rows (usually 1); `ApiClient` stops at 40 requests per Worker request and returns `upstream_error` instead of partial data. The browser fetches round by round. |
| Cache API | Free. Responses are cached at the edge: in-progress rounds briefly, completed rounds for a day. That also keeps load on Melee.gg low. |

## What we do not use (for now)

KV, D1, R2, Durable Objects, Queues, Cron Triggers, Workers AI, Analytics
Engine and Pages Functions. Some have free allowances, but none is needed, and
each is one more limit to track.

## Guardrails in code

- `TCC_DISABLED=1` (a Worker variable) turns every `/api/*` route into a 503 `disabled` response: a kill switch that needs no code change.
- A loose per-IP backstop on `/api/*` (600 requests/minute, in memory) plus upstream limits on cache misses; see "Protecting Melee and our quota" below.
- Upstream requests are only ever sent to `https://melee.gg`, with numeric IDs only (or, for local tests only, a loopback origin set with `MELEE_ORIGIN`): the four allowlisted site paths, or in `api` mode `/api/tournament/{id}`, `/api/standing/list/round/{id}` and `/api/match/list/round/{id}`.
- `MELEE_SOURCE` (`site` default, or `api`) picks the upstream. In `api` mode the secrets `MELEE_CLIENT_ID` and `MELEE_CLIENT_SECRET` (Wrangler secrets, free; no extra plan or binding) are sent only as the Basic auth header to melee.gg and are never logged, cached or returned. See `docs/melee-api-switchover.md`.
- API mode parses each page of JSON in the Worker to merge pages (site mode streams verbatim). That is small CPU work for a normal event (a few hundred rows); check CPU time in Metrics after switching. If it ever nears 10 ms, return the first page's bytes untouched when `hasMore` is false.

## Workers Logs (observability)

`wrangler.jsonc` enables Workers Logs (`observability.enabled`, `head_sampling_rate: 1`). It is free:
on the Free plan it stops ingesting when the daily cap is reached and never bills.

- Until 2026-12-01 (legacy Workers Logs limits): 200,000 log events/day, 3-day retention.
- From 2026-12-01 (Cloudflare Observability pricing): Free plan gets 0.5 GB/day ingest and 7-day retention; ingestion stops at the cap and nothing is billed.
- The Worker writes one `console.log` JSON line per `/api` request: `{evt, route, status, outcome, cache, upstream, ms}`. It never logs IPs, headers, query strings or secrets.
- Cloudflare itself records request metadata, including the client IP, alongside each invocation log, and retains it for the retention window above. We do not control that. The site's `/privacy` page says so (`apps/web/src/pages/Privacy.tsx`); keep it in sync with these retention figures.
- Read logs with `npx wrangler tail swu-tcc --format json` or the dashboard (Workers & Pages -> `swu-tcc` -> Logs). `wrangler tail` also shows `cpuTime`/`wallTime` per request, which is how to check the 10 ms CPU limit.

## Measuring CPU on a staging Worker

Deploy a copy under another name, never the production Worker, with the staging var that enables the `x-tcc-nocache` request header (skips the edge cache so a request exercises the cold path):

```sh
npm run build -w @swu-tcc/web
cd apps/worker && npx wrangler deploy --name swu-tcc-staging --var TCC_STAGING:1
npx wrangler tail swu-tcc-staging --format json   # read cpuTime / wallTime per request
npx wrangler delete --name swu-tcc-staging        # when finished
```

`TCC_STAGING` is not in `wrangler.jsonc` (a test enforces that), so production ignores the header. Keep the load on Melee small (spaced requests, a handful of samples).

Single samples swing a lot (cold isolates, machine variance), so compare old and new code side by side: deploy both under two staging names and alternate requests between them. Measured 2026-11-17 (uncached, 5-6 samples each, 69- and 484-player events):

| Route | Median | Worst |
|---|---|---|
| `/api/tournaments/:id` | 3-7 ms | 12-14 ms |
| `/api/rounds/:id/standings`, `/matches` (compressed passthrough) | 1-3 ms | 8 ms |
| any cached hit | 1-2 ms | 2 ms |

Tried and rejected: a JavaScript string scan instead of HTMLRewriter (doubled tournament CPU) and stopping HTMLRewriter early after the round selectors (no measurable gain). Cache misses on the tournament route are at most one per tournament per minute, and the web app retries a 1102 once.

## Checking usage

Cloudflare dashboard → Workers & Pages → `swu-tcc` → Metrics shows requests
and CPU time. Workers & Pages → Plans shows the plan (should say Free).

## Verified against Cloudflare docs (2026-11-16)

- **Workers Free limits** (https://developers.cloudflare.com/workers/platform/limits/): 100,000 requests/day (resets midnight UTC), 10 ms CPU per HTTP request, 50 subrequests per invocation (each redirect hop counts), Cache API 50 `put/match/delete` calls per request (shared with the subrequest quota), 512 MB Cache API object size, 64 MiB Worker size, 20,000 static asset files, 25 MiB per asset.
- **Static assets are free and unlimited** (https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/): "Requests to static assets are free and unlimited." Exception: requests matching `run_worker_first` patterns always invoke the Worker and count as Worker requests. Free plan summary: https://developers.cloudflare.com/workers/platform/pricing/.
- **Assets config** (https://developers.cloudflare.com/workers/static-assets/binding/): `assets.directory`, `binding`, `not_found_handling: "single-page-application"`, and `run_worker_first` as an array of patterns (supports `*` and `!` negation, max 100). Our `wrangler.jsonc` uses exactly these and `wrangler deploy --dry-run` accepts it.
- **Rate Limiting binding** (https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/): configured as `ratelimits: [{ name, namespace_id, simple: { limit, period } }]` with `period` of 10 or 60 seconds, Wrangler 4.36+ (`delta` needs 4.157+), counters are per Cloudflare location and eventually consistent (approximate). **Confirmed to work on the Free plan on 2026-11-17 by a probe deploy.** The docs pages are silent on the plan, so that probe is the evidence.

## Protecting Melee and our quota: the layers

The goal is to limit **upstream fetches** (cache misses), not visitors. Players at one venue share an IP, and cached hits cost Melee nothing, so limiting cached traffic per IP only causes false positives. From outermost to innermost:

1. **Cloudflare WAF rate limiting rule** (dashboard, see `docs/deploy.md`): blocks a flood of `/api/*` before the Worker runs, so it does not use the 100k/day quota.
2. **Per-IP backstop** in the Worker: 600 requests/minute per IP per isolate, in memory. A pathology guard only, deliberately loose.
3. **Edge cache**: tournament 60 s, live round 30 s, completed round 24 h. Cached hits are never limited.
4. **Coalescing**: concurrent misses for the same key in one isolate share one upstream fetch and one limiter charge.
5. **Upstream limits** (bindings `MELEE_CLIENT_LIMIT`: 20 Melee requests/60 s per client IP; `MELEE_LOCATION_LIMIT`: 30 Melee requests/10 s per location for everyone). Charged only on a cache miss, right before calling Melee; a tournament miss costs 2, a round miss 1. Refusals are 429 `rate_limited` with `retry-after` 60 (client) or 10 (location), never cached, and the web app does not retry them. When a binding is absent (unit tests, e2e) the Worker uses in-memory fixed-window limiters with the same numbers.
6. **Not-found caching**: a Melee 404 is cached 10 minutes (only 404, never other errors), so a nonexistent id reaches Melee once per 10 minutes per location.
7. **100k requests/day cap**: fails closed on Free, never bills.
8. **Kill switch**: `TCC_DISABLED=1`.

## Load we put on Melee

- Requests only happen when a visitor opens a tournament; there is no crawling, polling or prefetching.
- A tournament with N rounds costs 2 + 2N upstream requests on a cold cache (about 20 for a 6-round event with a top 8), fetched four at a time.
- Edge cache: tournament page 60 s, a live round 30 s, a completed round 24 h. Many players at one event share the cached copies (per Cloudflare location).
- Upstream limits: 20 Melee requests per minute per client IP and 30 per 10 s per location (cache misses only).
- Every request sends `X-Client: SWU-TCC/0.1 (+https://swu-tcc.win)`, and Cloudflare adds `CF-Worker: <our domain>` to Worker subrequests, so Melee can see who we are.
- `TCC_DISABLED=1` stops all upstream traffic. Set it if Melee asks us to stop.
