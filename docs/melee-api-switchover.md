# Switching to the official Melee API

The official API (HTTP Basic, client id and secret) is the intended production
data source. The code is ready; what is missing is the credentials and the real
response shapes. This is the checklist for the day they arrive. Do not send any
request to `melee.gg/api` before then (endpoints are listed in
`docs/research/melee-api.md`, section 1).

## What is already built

- `MELEE_SOURCE` worker var: `site` (default, current behavior) or `api`.
- In `api` mode the worker uses the secrets `MELEE_CLIENT_ID` and
  `MELEE_CLIENT_SECRET` and keeps the same public routes and `ProxyTournament`
  contract. `ProxyTournament.source` and the `x-tcc-source` response header say
  which upstream answered.
- `apps/worker/src/api.ts`: Basic auth, paging (`variables.page`,
  `variables.pageSize=250`), the 40-request cap, status mapping.
- `apps/worker/src/apiAdapter.ts`: the single place that guesses the shape of
  `GET /api/tournament/{id}` and derives rounds. **This is the file you will
  most likely edit.**
- `tools/capture-melee-api.ts`: fetches, saves raw responses, and reports.
- Core accepts bare arrays, `ApiResult` (`content`) wrappers and camelCase keys.

## Day one

1. **Keep the credentials in 1Password.** Create an item (for example "Melee API
   - SWU TCC") holding client id and secret. They never go in the repo, in
   `wrangler.jsonc`, in a committed `.dev.vars`, in an issue or in chat.
   `.dev.vars` is git-ignored; keep it that way.

2. **Find a tournament the account can read.** The credentials only cover
   tournaments where the account is at least Coverage Staff
   (`docs/research/melee-api.md`, section 2). Ask Melee (or the TO) to add the
   account as staff on tournament **484511**, or use one we organize.

3. **Run the capture script locally.** Export the secrets in your shell only
   (for example `export MELEE_CLIENT_ID=$(op read "op://Private/Melee API/client id")`
   and the same for the secret, with your own item path), then:

   ```sh
   node --experimental-strip-types tools/capture-melee-api.ts 484511
   ```

   It waits at least 1 s between requests (about 2 requests per round plus
   one for the details; about 20 for 484511), writes every raw body to
   `fixtures/melee-api/484511/raw/`, then prints: the details outline (keys
   only), the rounds the adapter derived, which fields of standings and match
   rows were recognized, core parser errors, and a per-round comparison of
   `computeStandings` against the API's own rank, points, record, OMW%, TGW%
   and OGW%. It refuses to run without both env vars and never prints them.
   Exit code 0 means all clear.

4. **Fix what it reports.** Read `tournament-<id>.json`, then edit
   `adaptTournamentDetails()` in `apps/worker/src/apiAdapter.ts` (assumptions
   A1 to A6 are listed at the top of that file). If row field names or value
   formats differ (for example percentages as 0 to 100 rather than fractions),
   adjust `packages/core/src/melee/raw.ts` / `fromMelee.ts`, not the worker,
   which only passes rows through. Re-run **without network or credentials**:

   ```sh
   node --experimental-strip-types tools/capture-melee-api.ts 484511 --replay
   ```

   Repeat until it says "All clear". Then turn the saved raw files into unit
   test fixtures (core and worker tests). They hold real player data, so
   pseudonymize them first (`fixtures/README.md`; `tools/pseudonymize-fixtures.ts`
   currently handles only the site capture format and needs extending for the
   API shape).

5. **Store the secrets in Cloudflare** (Workers secrets are free):

   ```sh
   cd apps/worker
   npx wrangler secret put MELEE_CLIENT_ID
   npx wrangler secret put MELEE_CLIENT_SECRET
   ```

   Paste each value from 1Password at the prompt. For local `wrangler dev`, put
   them in `apps/worker/.dev.vars` (git-ignored; see `.dev.vars.example`).

6. **Flip the switch.** In `apps/worker/wrangler.jsonc` set
   `"MELEE_SOURCE": "api"` and deploy. To roll back, set it to `"site"`. Check
   `curl -sI https://<host>/api/tournaments/484511 | grep x-tcc-source` shows
   `api`. (Cache keys include the source, so no stale `site` bodies are served.)

7. **Watch the first requests.** Workers & Pages, `swu-tcc`, Metrics: requests
   and CPU time. A 503 `disabled` in api mode means a missing secret; a 502
   `API response shape not recognized: <field>` means the adapter needs the
   change from step 4.

## Tournaments the account cannot read

A 401 or 403 from the API (or an `ApiResult.statusCode` of Unauthorized or
Forbidden) becomes the worker error `not_authorized` (HTTP 403, never cached).
The web app shows "This tournament isn't available to SWU TCC yet" with the
manual-entry link. Because the credentials only see tournaments where the
account has staff access, expect this for most public events unless the TO adds
us. The web copy lives in `describeError` (`apps/web/src/pages/TournamentRoute.tsx`).

## Not known until day one

Everything in `apiAdapter.ts` (assumptions A1 to A6), whether API rows use the
site's field names (`Rank`, `OpponentMatchWinPercentage`, `Competitors`, ...),
their casing, whether `ApiResult.content` is a bare array, whether standings
config (tiebreaker order, the 1/3 floor) is available (api mode sends
`standingsConfig: null`, so core uses the CEG defaults), and whether
`hasMore` is reliable. Each is isolated and covered by a test that will tell
you which field is missing.
