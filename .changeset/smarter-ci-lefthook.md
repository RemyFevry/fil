---
"@color-sunset/fil": patch
---

Smarter CI: precommit/push hooks via lefthook, split GitHub workflows, add Windows runner (ADR-0005).

- **New contributor prereq:** [lefthook](https://lefthook.dev) — install with `brew install lefthook` (macOS) or `scoop install lefthook` (Windows). Wires up automatically on `pnpm install` via the `prepare` script.
- **Git hooks:** pre-commit runs `eslint --fix` on staged `*.{ts,tsx}` + `pnpm lint:md`. Pre-push runs `pnpm lint` + `pnpm typecheck` (whole-project, parallel). Pre-commit + pre-push are belt-and-braces — `pnpm ci` is unchanged and still mirrors the CI gates locally.
- **CI split:** `.github/workflows/ci.yml` is removed. `.github/workflows/lint-build.yml` runs lint + lint:md + typecheck + build once on Ubuntu + Node 26 (the pure-TS checks are platform-agnostic, so cross-OS legs were wasteful). `.github/workflows/test.yml` runs the test matrix — Linux always; macOS + Windows on non-draft PRs (deferred to save CI minutes on iteration); Node 26 throughout. Three jobs in steady state, two on draft PRs.
- **Cross-OS shell:** both new workflows set `defaults: run: { shell: bash }` so `windows-latest`'s default PowerShell doesn't catch the first future `run:` step that uses bash idioms.
- **Concurrency:** `cancel-in-progress: ${{ github.event_name == 'pull_request' }}` — cancel in-flight on PR iteration, preserve main-push integrity.

Branch-protection required checks are the four new job names (`lint-build / verify`, `test / test-linux`, `test / test-cross-os (macos-latest)`, `test / test-cross-os (windows-latest)`). Maintainers with admin access can update the entry; non-admins see the same checks by workflow + job name and so merge-gate semantics are preserved.
