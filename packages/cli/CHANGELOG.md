# @color-sunset/fil-cli

## 0.4.1

### Patch Changes

- aacb6eb: Add the Pi Adapter **control surface** — Fil's control verbs as native Pi tools, closing #15.

  - `control-surface.ts` is the unit-testable source of truth: `FIL_VERB_TOOLS` declares the five verbs (`fil_start`/`fil_next`/`fil_status`/`fil_propose`/`fil_approve`) mapped 1:1 to the `fil` CLI; `toArgv` maps tool args to CLI argv; `runFilVerb` is a thin caller over an injectable runner; `defaultRunner` shells out to `fil` (`FIL_BIN` override → `node <entry>`, else `fil` on PATH).
  - The rendered Pi extension (`renderPiExtensionSource`) now registers the verbs via `pi.registerTool` at load time. Each tool's `execute` runs the matching `fil <verb>` from the session `cwd` and returns a Pi `AgentToolResult`. The verbs are thin callers, so behaviour is identical to the CLI. `typebox`/`@sinclair/typebox` resolve through Pi's jiti aliases (verified against Pi's extension loader); enforcement is untouched.
  - `fix(cli)`: the `fil` bin's `isMain` guard now compares against the module's own URL (`import.meta.url`) instead of a cwd-relative path, so the bin runs when spawned from any directory/install layout — required for the control surface (and any consumer) to shell out to `fil`.
  - Tests: pure verb/argv mapping; rendered-source structure; an integration test driving the real `fil` via `runFilVerb` (fil_next advances, status/propose/approve behave as the CLI); and a "through Pi's tool surface" test that loads the exact registration code with a stub `pi` and invokes registered tools' `execute` against a real Run.

- Updated dependencies [aacb6eb]
  - @color-sunset/fil-pi-adapter@0.4.0

## 0.4.0

### Minor Changes

- 0e2a0c2: A Phase now has multiple named gates (ADR-0004), AND-aggregated.

  - **Breaking:** `PhaseConfig.gate: GateSpec` → `PhaseConfig.gates: NamedGate[]` (names required + unique per Phase). `Receipt` gains `gateName`. `gate-runner.runGate` now takes a `NamedGate` so it can stamp the name onto the Receipt.
  - `fil next` runs every gate of every active Phase; all must pass (AND) to advance, and every failure is reported (no short-circuit — mirroring parallel-Phase semantics). Each gate produces its own Receipt, giving per-check audit granularity (e.g. lint, typecheck, tests, build as separate gates instead of one opaque shell script).
  - Built-in `default`/`hotfix` flows, the CLI / inspect-view / pi-adapter renderers, and all tests migrate to `gates[]`.
  - **Migration:** a Flow still using the old singular `gate:{...}` fails to load with a hint to re-run `fil init` or rename `gate:{...}` → `gates:[{name, type, ...}]`. No backward-compat shim (early project).

### Patch Changes

- 9c4b161: `fil init` now resolves `--scope` once, up front, and exits `2` on an unknown
  value regardless of whether any adapter install callback is enabled. Previously
  an invalid `--scope` was silently accepted (exit `0`) when both adapter install
  callbacks were opted out.
- Updated dependencies [0e2a0c2]
  - @color-sunset/fil-contract@0.3.0
  - @color-sunset/fil-gate-runner@0.3.0
  - @color-sunset/fil-engine@0.3.0
  - @color-sunset/fil-orchestrator@0.2.1
  - @color-sunset/fil-inspect-view@0.2.1
  - @color-sunset/fil-claude-adapter@0.1.1
  - @color-sunset/fil-pi-adapter@0.3.1
  - @color-sunset/fil-flow-loader@0.2.1
  - @color-sunset/fil-store@0.2.1
  - @color-sunset/fil-evolution@0.2.1

## 0.3.0

### Minor Changes

- 3399dbc: Add the **Claude Code Adapter** package (`@color-sunset/fil-claude-adapter`), closing #16.

  - Pure `enforceClaudeEnforcement` derives the `ClaudeEnforcement` surface (allowedTools, system prompt, skill paths, context paths) directly from the contract's `RunProjection`; `decideToolUse(projection, toolName)` is the fail-closed PreToolUse decision — empty `allowedTools` denies every tool, mirroring the Pi Adapter.
  - The hard enforcement layer is a self-contained `PreToolUse` hook (`renderPreToolUseHookSource`) that Claude Code spawns via `node`: it reads `.fil/run.json` (from `CLAUDE_PROJECT_DIR`), and emits Claude's `{ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", … } }` JSON to block a tool outside the active Phase's `allowedTools`, or stays silent to allow. Dormant (allows all) when there is no active Run.
  - `installClaudeAdapter` installs through Claude Code's native channel: writes the hook script (`.claude/fil/pretooluse-hook.js`, project scope, or `~/.claude/fil/` for user scope) and merges a `PreToolUse` handler into `.claude/settings.json` — preserving existing hooks and deduplicating by command+args, so re-runs are idempotent. `detectClaude()` walks `~/.claude`, `~/.claude.json`, and `$PATH`.
  - `fil init [--scope project|user|both]` now installs the Claude adapter alongside the Pi adapter when detected; the single `--scope` flag applies to both.
  - Integration test executes the rendered hook via `node` against a contract-written `.fil/run.json`, proving it blocks/allows tools exactly as the active Phase's contract specifies.

### Patch Changes

- d28ea6f: Add the Pi Adapter **control surface** — Fil's control verbs as native Pi tools, closing #15.

  - `control-surface.ts` is the unit-testable source of truth: `FIL_VERB_TOOLS` declares the five verbs (`fil_start`/`fil_next`/`fil_status`/`fil_propose`/`fil_approve`) mapped 1:1 to the `fil` CLI; `toArgv` maps tool args to CLI argv; `runFilVerb` is a thin caller over an injectable runner; `defaultRunner` shells out to `fil` (`FIL_BIN` override → `node <entry>`, else `fil` on PATH).
  - The rendered Pi extension (`renderPiExtensionSource`) now registers the verbs via `pi.registerTool` at load time. Each tool's `execute` runs the matching `fil <verb>` from the session `cwd` and returns a Pi `AgentToolResult`. The verbs are thin callers, so behaviour is identical to the CLI. `typebox`/`@sinclair/typebox` resolve through Pi's jiti aliases (verified against Pi's extension loader); enforcement is untouched.
  - `fix(cli)`: the `fil` bin's `isMain` guard now compares against the module's own URL (`import.meta.url`) instead of a cwd-relative path, so the bin runs when spawned from any directory/install layout — required for the control surface (and any consumer) to shell out to `fil`.
  - Tests: pure verb/argv mapping; rendered-source structure; an integration test driving the real `fil` via `runFilVerb` (fil_next advances, status/propose/approve behave as the CLI); and a "through Pi's tool surface" test that loads the exact registration code with a stub `pi` and invokes registered tools' `execute` against a real Run.

- Updated dependencies [3399dbc]
- Updated dependencies [d28ea6f]
  - @color-sunset/fil-claude-adapter@0.1.0
  - @color-sunset/fil-pi-adapter@0.3.0

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
  - @color-sunset/fil-contract@0.2.0
  - @color-sunset/fil-engine@0.2.0
  - @color-sunset/fil-evolution@0.2.0
  - @color-sunset/fil-flow-loader@0.2.0
  - @color-sunset/fil-gate-runner@0.2.0
  - @color-sunset/fil-inspect-view@0.2.0
  - @color-sunset/fil-orchestrator@0.2.0
  - @color-sunset/fil-pi-adapter@0.2.0
  - @color-sunset/fil-store@0.2.0
