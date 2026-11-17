# @swu-tcc/worker

Cloudflare Worker (Hono) that serves the built web app as static assets and a thin caching proxy for Melee.gg under `/api/*`. Free plan only; read `docs/free-tier.md` first.

## Routes (GET, JSON, same-origin, no CORS headers)

| Route | Returns |
|---|---|
| `/api/tournaments/:id` | `ProxyTournament`: rounds, name, start date, status text and Melee's standings config |
| `/api/rounds/:roundId/standings[?completed=1]` | Melee `GetRoundStandings` body, streamed through verbatim |
| `/api/rounds/:roundId/matches[?completed=1]` | Melee `GetRoundMatches` body, streamed through verbatim |

IDs must be positive integers of at most 10 digits (else 400). Errors are `ProxyError`: 400 `bad_request`, 404 `not_found`, 429 `rate_limited`, 403 `not_authorized` (official API refused the credentials for this tournament), 502 `upstream_error`, 503 `disabled` (kill switch, bad `MELEE_SOURCE`, or api mode without credentials). Every success has `x-tcc-fetched-at`, `x-tcc-source` (`site` or `api`) and a `cache-control`.

## Upstream modes

`MELEE_SOURCE` (var in `wrangler.jsonc`): `site` (default) scrapes Melee's website endpoints; `api` uses the official credentialed API with the secrets `MELEE_CLIENT_ID` and `MELEE_CLIENT_SECRET` (`wrangler secret put`; locally `.dev.vars`, see `.dev.vars.example`). In `api` mode round bodies are merged pages returned as `{draw, recordsTotal, recordsFiltered, data}`, and `ProxyTournament.source` is `api`. Code: `src/api.ts` (client), `src/apiAdapter.ts` (the guessed tournament-details shape). Switch-over steps: `docs/melee-api-switchover.md`. Day-one capture tool: `tools/capture-melee-api.ts`.

## Caching

Responses are cached at the edge (`caches.default`), keyed on our own URL. Tournament: 60 s. Round data: 30 s, or 24 h when the client adds `?completed=1`. The worker cannot cheaply know whether a round is completed, so the client reads `completed` from `ProxyTournament.rounds` and passes it. `completed` and the source are part of the cache key; other query params are ignored. Errors are never cached.

## Upstream etiquette

Only `https://melee.gg` by default. The `MELEE_ORIGIN` var may point at `http://localhost:<port>` or `http://127.0.0.1:<port>` (for the e2e fake Melee in `e2e/`); any other value makes every `/api` route answer 500 `misconfigured`.  numeric IDs only, `User-Agent` set by `MELEE_USER_AGENT` (`honest` = `SWU-TCC/0.1 (+https://swu-tcc.win)`, the default in code; `curl` = curl's default `curl/8.7.1`; the deployed value is in `wrangler.jsonc` and is an owner decision), always with `X-Client: SWU-TCC/0.1 (+…)`; redirects never followed. Any non-2xx or non-JSON answer is `upstream_error`; a 403 is reported plainly as such.

## Guardrails

- `TCC_DISABLED=1` (var in `wrangler.jsonc`) makes every `/api` route return 503 `disabled`.
- 60 requests/minute per `cf-connecting-ip`, via a best-effort in-memory limiter (per isolate, not shared across locations). See `docs/free-tier.md` for why the Rate Limiting binding is not used.

## Logs

Workers Logs is on (`observability` in `wrangler.jsonc`). Each `/api` request logs one JSON line with route kind, status, outcome, cache hit/miss, upstream status and elapsed ms; no IPs, headers or secrets. Cloudflare still retains request metadata including the client IP for the retention window (3 days, 7 days from 2026-12-01). Limits and details: `docs/free-tier.md`.

## Run locally

```sh
npm install
npm run dev -w @swu-tcc/worker        # wrangler dev, no Cloudflare login needed
npm test -w @swu-tcc/worker           # vitest in the workerd runtime, fixtures only, no network
npm run typecheck -w @swu-tcc/worker
npm run build -w @swu-tcc/worker      # wrangler deploy --dry-run; deploys nothing
```

`wrangler dev` serves `../web/dist` for non-API paths, so build the web app first to see the UI. Do not run `wrangler deploy` or `wrangler login` from here; deployment is a separate decision.
