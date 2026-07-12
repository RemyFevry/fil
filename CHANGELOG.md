# @color-sunset/fil

## 0.3.0

### Minor Changes

- 0e2a0c2: A Phase now has multiple named gates (ADR-0004), AND-aggregated.

  - **Breaking:** `PhaseConfig.gate: GateSpec` → `PhaseConfig.gates: NamedGate[]` (names required + unique per Phase). `Receipt` gains `gateName`. `gate-runner.runGate` now takes a `NamedGate` so it can stamp the name onto the Receipt.
  - `fil next` runs every gate of every active Phase; all must pass (AND) to advance, and every failure is reported (no short-circuit — mirroring parallel-Phase semantics). Each gate produces its own Receipt, giving per-check audit granularity (e.g. lint, typecheck, tests, build as separate gates instead of one opaque shell script).
  - Built-in `default`/`hotfix` flows, the CLI / inspect-view / pi-adapter renderers, and all tests migrate to `gates[]`.
  - **Migration:** a Flow still using the old singular `gate:{...}` fails to load with a hint to re-run `fil init` or rename `gate:{...}` → `gates:[{name, type, ...}]`. No backward-compat shim (early project).

### Patch Changes

- d21fdd9: Smarter CI: precommit/push hooks via lefthook, split GitHub workflows (ADR-0005).

  - **New contributor prereq:** [lefthook](https://lefthook.dev) — install with `brew install lefthook` (macOS) or `scoop install lefthook` (Windows). Wires up automatically on `pnpm install` via the `prepare` script.
  - **Git hooks:** pre-commit runs `eslint --fix` (with `stage_fixed: true`) on staged `*.{ts,tsx}` + `pnpm lint:md`. Pre-push runs `pnpm lint` + `pnpm typecheck` (whole-project, parallel). Pre-commit + pre-push are belt-and-braces — `pnpm ci` is unchanged and still mirrors the CI gates locally.
  - **CI split:** `.github/workflows/ci.yml` is removed. `.github/workflows/lint-build.yml` runs lint + lint:md + typecheck + build once on Ubuntu + Node 26 (the pure-TS checks are platform-agnostic, so cross-OS legs were wasteful). `.github/workflows/test.yml` runs the test matrix — Linux always; macOS on non-draft PRs; Node 26 throughout. Two jobs in steady state.
  - **Windows is deferred** to a follow-up issue — cross-platform test bugs (path-literal POSIX assumptions + an ESM URL resolver quirk in the proposal loader) surfaced on the first run on `windows-latest` and need their own fix + ADR. Re-adding `windows-latest` is a one-line matrix change once those land. The shell default `bash` is kept so the re-add is no-op.
  - **Cross-OS shell:** both new workflows set `defaults: run: { shell: bash }` so future `run:` steps work uniformly on macOS and (when re-added) Windows.
  - **Concurrency:** `cancel-in-progress: ${{ github.event_name == 'pull_request' }}` — cancel in-flight on PR iteration, preserve main-push integrity.

  Branch-protection required checks are the three new job names (`lint-build / verify`, `test / test-linux`, `test / test-cross-os (macos-latest)`). Maintainers with admin access can update the entries; non-admins see the same checks by workflow + job name so merge-gate semantics are preserved.

- 824ac0b: Worktree guard: allow `wt switch` (and other read-only `wt` subcommands) as a bootstrap escape hatch from the primary worktree.

  Previously, an agent running in the primary worktree got a hard block on every mutating tool, including the very `wt switch …` command needed to escape into a worktree. The only path was `FIL_ALLOW_MAIN_WORKTREE=1`, which is meant for trunk maintenance — not bootstrap.

  The canonical guard (`scripts/require-worktree.sh`) now accepts the bash command as `$1` and whitelists a strict subset of `wt` subcommands (`switch`, `list`, `path`, `which`, `config`, `diff`, `log`, `step`). The match is anchored and uses a safe-alphabet regex — shell metacharacters like `;`, `&&`, `|`, `$()`, backticks are denied, so a compound command like `wt switch foo; rm -rf /` is not smuggled through. The block message now also shows what was attempted, so the failed agent can see _why_ it was blocked.

  The three call-sites were updated to forward the bash command:

  - `.opencode/plugins/worktree-guard.ts` — passes `output.args.command`
  - `.pi/extensions/worktree-guard.ts` — passes the best-effort `event.input.{command,args}` extraction (with stringification fallback)
  - `.claude/settings.json` — now points `PreToolUse` at a new Node wrapper (`.claude/hooks/worktree-guard.mjs`) that reads the hook event JSON from stdin and forwards `tool_input.command` to the script

  No behavior change inside a Worktrunk-linked worktree. `wt merge` and `wt remove` are intentionally not whitelisted — running them from the primary would mutate `main` directly.

- Updated dependencies [9c4b161]
- Updated dependencies [0e2a0c2]
  - @color-sunset/fil-cli@0.4.0
  - @color-sunset/fil-contract@0.3.0
  - @color-sunset/fil-gate-runner@0.3.0
  - @color-sunset/fil-engine@0.3.0
  - @color-sunset/fil-orchestrator@0.2.1
  - @color-sunset/fil-inspect-view@0.2.1
  - @color-sunset/fil-flow-loader@0.2.1
  - @color-sunset/fil-store@0.2.1
  - @color-sunset/fil-evolution@0.2.1

## 0.2.1

### Patch Changes

- Updated dependencies [3399dbc]
- Updated dependencies [d28ea6f]
  - @color-sunset/fil-cli@0.3.0

## 0.2.0

### Minor Changes

- 68e4a2a: Rescope every package under the `color-sunset` npm org.

  - The meta-package is now `@color-sunset/fil` (was `fil-cli`).
  - The 10 sub-packages are now `@color-sunset/fil-{cli,contract,engine,evolution,flow-loader,gate-runner,inspect-view,orchestrator,pi-adapter,store}` (were `@fil/*`).
  - The `fil` _command_ (the bin) is unchanged — users still run `fil init`, `fil start`, `fil next`, etc.

  **Why:** the unscoped `fil` name on npm is already taken by an unrelated static-site generator (`ubenzer/fil`), and the `@fil` scope is unowned. The `color-sunset` org (owned by the Fil maintainer) gives every package a stable, owned home.

  **Install migration:** `npm install -g fil-cli` → `npm install -g @color-sunset/fil`. Internal `import` statements also change; downstream consumers of `@fil/*` must update their imports.

  **Provenance strategy change:** `provenance=true` was removed from `.npmrc` (it broke local `pnpm publish` with `EUSAGE Automatic provenance generation not supported for provider: null`) and moved to the release workflow's `NPM_CONFIG_PROVENANCE` env. CI still attaches provenance; local manual publishes work without it.

### Patch Changes

- Updated dependencies [68e4a2a]
  - @color-sunset/fil-cli@0.2.0
  - @color-sunset/fil-contract@0.2.0
  - @color-sunset/fil-engine@0.2.0
  - @color-sunset/fil-evolution@0.2.0
  - @color-sunset/fil-flow-loader@0.2.0
  - @color-sunset/fil-gate-runner@0.2.0
  - @color-sunset/fil-inspect-view@0.2.0
  - @color-sunset/fil-orchestrator@0.2.0
  - @color-sunset/fil-store@0.2.0
