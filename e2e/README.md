# @swu-tcc/e2e

Playwright (Chromium only) tests against the real stack: the built web app served by `wrangler dev`, the worker proxy, and the core engine in the browser. Upstream is a local fake Melee (`fake-melee/server.ts`) replaying `fixtures/melee/484511`. Nothing here contacts melee.gg.

```sh
npx playwright install chromium   # one-time
npm run e2e                       # from the repo root: builds, then runs the tests
```

Not part of `npm test`. Screenshots land in `e2e/screenshots/` (gitignored); set up as artifacts, not assertions.

Scenarios are chosen by tournament id (see the header of `fake-melee/server.ts`): `484511` finished, `900001` live after round 5, `900403` 403, `900302` 302, `900500` slow, `910000-919999` finished clones for request counting. The worker's kill switch is covered by the worker unit tests.
