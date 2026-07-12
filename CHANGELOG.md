# @color-sunset/fil

## 0.3.1

### Patch Changes

- 5b1754f: Fix the worktree guard so the master orchestrator isn't blocked on launch (closes #101).

  The master (layer 0) runs in the primary checkout, but `FIL_ALLOW_MAIN_WORKTREE=1`
  was never injected by any launcher, so every master bash was blocked until a human
  hand-exported the var — violating the documented contract. The guard now grants the
  hatch automatically with zero manual setup, while subagents in worktrees stay fully
  blocked.

  - `scripts/require-worktree.sh` (single source of truth) adds a second canonical
    signal `FIL_MASTER_SESSION=1` (auto-detected master hatch) alongside the existing
    `FIL_ALLOW_MAIN_WORKTREE=1` (human escape hatch). Both → allow in primary.
  - New canonical launcher `scripts/master.sh` + `pnpm master [opencode|claude|pi]`
    exports `FIL_ALLOW_MAIN_WORKTREE=1` and execs the runtime in the primary. Works
    for all three runtimes uniformly; the var lives only in the launched process.
  - The OpenCode plugin (`.opencode/plugins/worktree-guard.ts`) now detects the master
    agent via the `chat.message` hook and injects `FIL_MASTER_SESSION=1` into the guard
    subprocess env, so a master OpenCode session works even when launched via plain
    `opencode` + switch-to-master. Claude Code and Pi rely on the launcher.
  - `docs/agents/master.md`, `.opencode/agent/master.md`, and `AGENTS.md` replace the
    "inherited from the master session" hand-wave with the real mechanism.
  - New test `scripts/test/worktree-guard.test.ts` covers both hatches, the whitelist,
    the linked-worktree fast path, the not-a-repo fallback, and the launcher's env.

- e369434: Adopt **herdr** (https://herdr.dev/docs/agents/) as a non-mandatory dev
  tool for multi-agent orchestration. Closes #95.

  - New `pnpm install-herdr` (`scripts/install-herdr.sh`) — idempotent host
    installer: `brew install herdr`, the three Fil-supported integrations
    (`claude / opencode / pi`), the official herdr agent skill globally,
    and a symlink to `docs/agents/herdr-config.toml`.
  - New `pnpm feat <n>` (`scripts/feat.sh`) — opens a Fil Change as a
    Worktrunk worktree; if herdr is on `PATH`, additionally creates a herdr
    Workspace anchored to that worktree.
  - New `pnpm ship` (`scripts/ship.sh`) — `wt merge main`; if herdr is on
    `PATH`, additionally closes the matching herdr Workspace by label.
  - New `docs/agents/herdr.md` — the canonical Fil+herdr reference
    (install, recipes, gotchas, scope fence: no herdr plugin, no Fil CLI
    flag).
  - New `docs/agents/herdr-config.toml` — Fil-tuned config template
    (sidebar `priority` sort, in-app toast delivery, mouse capture, etc.);
    the installer symlinks it to `~/.config/herdr/config.toml` on first run.
  - New `opencode.json` at the repo root — `external_directory` allowance
    for `~/fil.*/**` so `wt switch` to a new worktree does not prompt
    for write approval every time.

  Edits to onboarding, feature-loop, developer-experience, AGENTS, and
  CONTRIBUTING. Herdr remains non-mandatory: every Fil command works
  without it, and the Worktrunk half of `pnpm feat` / `pnpm ship` is
  always the canonical action.

- 4a3f189: Widen `pnpm lint:md` from `README.md`-only to **all repo markdown**, and fix
  the violations the wider scope surfaces. Closes #97. Closes #98.

  - `.markdownlint-cli2.jsonc`: globs `["README.md"]` → `["**/*.md"]`.
  - Excludes generated/transient markdown so the gate doesn't fight tooling:
    `**/CHANGELOG.md` (changeset-generated) and `.changeset/**/*.md` (throwaway
    entries).
  - Excludes `CODE_OF_CONDUCT.md` to keep the upstream Contributor Covenant
    **verbatim** — chosen over in-place edits so future Covenant updates merge
    cleanly. Flagged per the #98 acceptance criterion.
  - `lefthook.yml:5`: stale comment "markdownlint-cli2 on README.md" →
    "markdownlint-cli2 on all repo markdown (project-wide globs)".
  - Fixes all 58 surfaced violations (re-measured live; #98's baseline was 57 —
    the 3 `master.md` files under `.claude/`, `.opencode/`, `.pi/` were added in
    the `master-agent definition` commit after the baseline). Rules fixed:
    MD049 emphasis style (asterisk), MD034 bare URLs (`<…>`), MD047 trailing
    newline, MD022/MD032/MD031 blanks around headings/lists/fences, MD004
    list-marker (`-`), MD040 fenced-code-language. No `markdownlint-disable*`
    directives were added.

- fa56b4f: Add `scripts/bootstrap.sh` and `pnpm bootstrap` (R05). New contributors (human or AFK agent) run one command to verify their toolchain (Node ≥ 20, pnpm ≥ 10, `wt`, `gh`), switch the `gh` identity to `remyf-agent` when configured, and warm `node_modules/` + the per-package `dist/` cache. Idempotent: the second invocation finishes in <2s by mtime-checking the cache. The vitest in `scripts/test/bootstrap.test.ts` proves no file mtimes advance on a re-run. Closes #59.

  Vitest config now also picks up `scripts/test/**/*.test.ts` so future script-level guarantees land in the same test surface.

- bc69f2f: Add a canonical PR review-status helper + an enforceable anti-overclaim rule
  for the master agent, so the "declared clear from a partial check" failure
  mode observed on the first orchestration run cannot repeat. Closes #106.

  - `scripts/pr-review-status.mjs` (runnable via `node`) — for a given PR,
    queries **all three** CodeRabbit finding locations plus Sonar + CI and
    emits a single `CLEAR` / `BLOCKED (<n> open: …)` line the master quotes
    instead of re-deriving ad-hoc checks. The three locations:
    1. inline review threads (any author) — GraphQL `reviewThreads.isResolved`
       (REST `/pulls/N/comments` is NOT enough — resolution is a
       review-thread property only).
    2. issue-style summary comment — latest `coderabbitai[bot]` comment by
       `updated_at` (CodeRabbit _edits it in place_, so `created_at` is
       stale), classified into `no-actionable` / `has-findings` /
       `walkthrough` / `pre-merge-passed`.
    3. folded sections inside PR review bodies — REST `/pulls/N/reviews`,
       parsed for `🧹 Nitpick comments (N)` + `Actionable comments posted: N`.
       **This is the location the master missed.**
       Plus Sonar Quality Gate state + CI non-SUCCESS count. Anti-overclaim is
       enforced by construction: any source that could not be queried degrades
       to `{ queried: false }` and `summarize()` turns every not-queried source
       into a blocker — `CLEAR` is only reachable when every source was queried
       AND clean.
  - `pnpm review-status <pr>` — thin wrapper in `package.json`.
  - `scripts/test/pr-review-status.test.ts` — vitest covering
    `parseReviewBody`, `classifySummaryVerdict`, `foldedOnlyCount`, and
    `summarize` with real-shape fixtures (including the folded-nitpick case
    the master overlooked on #102 / #105). Pure-logic only — the network
    layer (`gh api`) is exercised by `pnpm review-status <pr>` against any
    open PR, so CI needs no gh credentials to prove the parser contract.
  - `docs/agents/master.md` + `.opencode/agent/master.md` — new
    "Verification hygiene (review sweep + anti-overclaim)" section: the
    master MUST run `pnpm review-status <pr>` and **quote its counts**
    before declaring any PR clear/mergeable/resolved; the anti-overclaim
    clause ("never report clear from a partial check; if a location wasn't
    queried, say so"); the CodeRabbit-is-incremental note; plus a
    pre-approved-temp-path rule (`$TMPDIR/opencode/` — the opencode
    `external_directory` allowlisted subdir) and an atomic-side-effect-safe
    command hygiene rule (no `… || true` on mutations; the redirect hides
    the exit code but not the side effect).
  - `docs/agents/feature-loop.md` Step 4 (WAIT) table — correct the
    CodeRabbit row to list all THREE finding locations (it previously said
    only "walkthrough + per-line threads", which is what steered the master
    wrong) + the incremental-review note.

- 1c85652: Add Windows to the CI test matrix (closes #76).

  - `.github/workflows/test.yml` re-adds `windows-latest` to the cross-OS matrix alongside `macos-latest`. Both legs run on push-to-main and on non-draft PRs; Linux still runs on every PR event. Three jobs in steady state; one on draft PRs.
  - **Production fix:** `packages/evolution/src/index.ts` (`loadFlowCode`) and `packages/cli/src/commands/common.ts` (`importFlowFile`) now call `fs.realpathSync` on the temp file path before `pathToFileURL`/`import()`. Without it, the GitHub-hosted Windows runner's 8.3 short-name home dir (`C:\Users\RUNNER~1\…`) breaks the URL→path round-trip and Node reports "Failed to load url … Does the file exist?" for a real, on-disk file. The fix is 2 lines per site, no-op on POSIX. See ADR-0005's "Windows URL normalization" subsection.
  - **Test fix:** `packages/claude-adapter/test/installer.test.ts` — 5 path-literal POSIX assumptions replaced with `path.sep`-aware assertions + `join(...)` for memFs keys. Same pattern as the already-landed `pi-adapter/test/{installer,enforcement,enforcement-contract}.test.ts` fixes.
  - Docs (`docs/adr/0005-…`, `docs/agents/onboarding.md`, `docs/agents/developer-experience.md`, `CONTRIBUTING.md`) updated to reflect the now-green Windows leg.

  Branch-protection required checks grow to four: `lint-build / verify`, `test / test-linux`, `test / test-cross-os (macos-latest)`, `test / test-cross-os (windows-latest)`. Maintainers with admin access should update the entries; non-admins see the new job names automatically.

- Updated dependencies [aacb6eb]
  - @color-sunset/fil-cli@0.4.1

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
