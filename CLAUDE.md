# SWU TCC

Star Wars Unlimited Top Cut Calculator. A mobile-first site a player opens
between rounds to answer: *can I make top cut, and can I safely intentionally
draw (ID)?*

## Layout

- `packages/core`: pure TypeScript engine (normalize Melee data, standings, tiebreakers, final-round pairing, scenario analysis). No network, no DOM. **`src/contract.ts` is the shared contract; change it deliberately.**
- `apps/worker`: Cloudflare Worker (Hono). Serves the built web app as static assets and a thin caching proxy for Melee.gg under `/api/*`.
- `apps/web`: Vite + React + TypeScript UI. Calls the worker, runs core in the browser.
- `fixtures/melee/<id>/raw/`: real Melee responses used as test data.
- `docs/brand/`: design language, tokens, logos, icons. `DESIGN.md` is the source of truth for UI.
- `docs/research/`: Melee API findings and SWU rules (Comprehensive Event Guide v1.5) with citations.

## Rules of the domain

- Points: win 3, draw 1, loss 0, bye 3 (a win). An ID is recorded 0-0-3.
- Tiebreakers, in order: points, OMW%, TGW% (own game-win %), OGW%, then Melee team id ascending. Every percentage is floored at 1/3.
- The **last** Swiss round of an event with a top cut is paired by standings: 1 v 2, 3 v 4, ..., avoiding rematches (CEG 10.4). Earlier rounds are random within point groups.
- Dropped players are never paired again and cannot make the cut, but still count in their opponents' tiebreakers.
- See `docs/research/swu-rules.md` for sources and open questions.

## Constraints

- **Cloudflare free tier only.** Read `docs/free-tier.md` before touching the worker. No KV/D1/R2/Durable Objects/Cron. Keep the worker's CPU work near zero.
- **Be a good guest on Melee.gg.** Only the allowlisted endpoints, numeric IDs only, edge-cached, never crawl. `MELEE_USER_AGENT` is an owner decision: do not change it. Every request sends `X-Client` identifying us. Never use a browser User-Agent. If Melee asks us to stop, set `TCC_DISABLED=1`.
- **Honest odds** (DESIGN.md rule 4): never show 100% unless proven by enumeration; always list assumptions.

## Commands

```sh
npm ci             # or npm install
npm run check      # typecheck + tests in every workspace
npm run build

# Official Melee API day-one capture/report (needs credentials; --replay needs none):
node --experimental-strip-types tools/capture-melee-api.ts <tournamentId>
```

See `docs/melee-api-switchover.md` for the credentials switch-over.
Deploys: `docs/deploy.md` (Workers Builds on every push to `main`; manual fallback).

npm 11 gates dependency install scripts. The `allowScripts` map in the root
`package.json` approves exactly `esbuild` and `workerd` (their postinstalls
fetch/verify native binaries). After bumping either, run
`npm install-scripts approve <pkg>` to refresh the pinned version. `fsevents`
(optional, macOS watcher) is explicitly denied (`"fsevents": false`), so installs stay quiet.

**7-day cooldown on every package update.** The project `.npmrc` sets
`min-release-age=7`, so `npm install`/`npm update` only pick versions
published at least 7 days ago, and Dependabot uses `cooldown: default-days: 7`
for npm and GitHub Actions. `npm ci` installs exactly what the lockfile says,
so the cooldown applies when versions are chosen, not when they are installed.
Keep `package.json` ranges at versions that are already 7 days old, or
`npm install` fails with ERESOLVE. For an urgent security fix, override once
on the command line (`npm install <pkg>@<version> --min-release-age=0`) and
say so in the PR.

Shared devDependencies (vitest, @vitest/coverage-v8, typescript) live in the
root `package.json` so every workspace uses one copy. TypeScript 7 (native) works with
`tsc -p`, Vite 8 and Vitest 5; if a tool breaks on it, pin the newest 5.x/6.x.

## Conventions

- Conventional Commits; PRs are squash-merged and release-please reads the titles.
- Tests with Vitest. Engine changes need a test, ideally against a fixture.
- Node 26 (Active LTS); `.nvmrc` pins the major and CI reads it.
