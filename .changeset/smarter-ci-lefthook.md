---
"@color-sunset/fil": patch
---

Smarter CI: precommit/push hooks via lefthook, split GitHub workflows (ADR-0005).

- **New contributor prereq:** [lefthook](https://lefthook.dev) — install with `brew install lefthook` (macOS) or `scoop install lefthook` (Windows). Wires up automatically on `pnpm install` via the `prepare` script.
- **Git hooks:** pre-commit runs `eslint --fix` (with `stage_fixed: true`) on staged `*.{ts,tsx}` + `pnpm lint:md`. Pre-push runs `pnpm lint` + `pnpm typecheck` (whole-project, parallel). Pre-commit + pre-push are belt-and-braces — `pnpm ci` is unchanged and still mirrors the CI gates locally.
- **CI split:** `.github/workflows/ci.yml` is removed. `.github/workflows/lint-build.yml` runs lint + lint:md + typecheck + build once on Ubuntu + Node 26 (the pure-TS checks are platform-agnostic, so cross-OS legs were wasteful). `.github/workflows/test.yml` runs the test matrix — Linux always; macOS on non-draft PRs; Node 26 throughout. Two jobs in steady state.
- **Windows is deferred** to a follow-up issue — cross-platform test bugs (path-literal POSIX assumptions + an ESM URL resolver quirk in the proposal loader) surfaced on the first run on `windows-latest` and need their own fix + ADR. Re-adding `windows-latest` is a one-line matrix change once those land. The shell default `bash` is kept so the re-add is no-op.
- **Cross-OS shell:** both new workflows set `defaults: run: { shell: bash }` so future `run:` steps work uniformly on macOS and (when re-added) Windows.
- **Concurrency:** `cancel-in-progress: ${{ github.event_name == 'pull_request' }}` — cancel in-flight on PR iteration, preserve main-push integrity.

Branch-protection required checks are the three new job names (`lint-build / verify`, `test / test-linux`, `test / test-cross-os (macos-latest)`). Maintainers with admin access can update the entries; non-admins see the same checks by workflow + job name so merge-gate semantics are preserved.
