# Going public checklist

For the owner, when publishing the tree as a new public repository (one fresh
commit; the private history stays private). Nothing here is automated.

## Before the first push

- [ ] Run a secret scan on the tree: `gitleaks dir .` (or `gitleaks detect --no-git`). It must report nothing.
- [ ] Confirm the fixtures are pseudonymized: `node --experimental-strip-types tools/pseudonymize-fixtures.ts --check` exits 0.
- [ ] `npm run check`, `npm run build` and `npm run e2e` pass.
- [ ] Update the repo URL in `SECURITY.md`, `SUPPORT.md` and `apps/web/src/pages/Privacy.tsx` if the new repo is not `wavemoran/swu-tcc`.

## Repository settings

- [ ] Description and homepage: `https://swu-tcc.win`.
- [ ] Security: enable secret scanning and push protection.
- [ ] Security: enable private vulnerability reporting (`SECURITY.md` points there).
- [ ] Security: enable the dependency graph, Dependabot alerts and Dependabot security updates.
- [ ] Actions > General: allow "Allow GitHub Actions to create and approve pull requests" (release-please needs it).
- [ ] Actions > General: require approval for workflow runs from first-time contributors.
- [ ] General > Pull requests: allow squash merging only, default to the PR title, and automatically delete head branches.
- [ ] Branch protection (or a ruleset) on `main`, requiring these checks to pass:
  - `Typecheck, test, build`
  - `End-to-end (Playwright)`
  - `Conventional Commit title`
  - `Workflow security audit`
  - Do not require `npm audit` while GHSA-fc5q-39xc-vjpf has no fix; it would block every PR.
