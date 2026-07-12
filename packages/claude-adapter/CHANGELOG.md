# @color-sunset/fil-claude-adapter

## 0.1.1

### Patch Changes

- 0e2a0c2: A Phase now has multiple named gates (ADR-0004), AND-aggregated.

  - **Breaking:** `PhaseConfig.gate: GateSpec` → `PhaseConfig.gates: NamedGate[]` (names required + unique per Phase). `Receipt` gains `gateName`. `gate-runner.runGate` now takes a `NamedGate` so it can stamp the name onto the Receipt.
  - `fil next` runs every gate of every active Phase; all must pass (AND) to advance, and every failure is reported (no short-circuit — mirroring parallel-Phase semantics). Each gate produces its own Receipt, giving per-check audit granularity (e.g. lint, typecheck, tests, build as separate gates instead of one opaque shell script).
  - Built-in `default`/`hotfix` flows, the CLI / inspect-view / pi-adapter renderers, and all tests migrate to `gates[]`.
  - **Migration:** a Flow still using the old singular `gate:{...}` fails to load with a hint to re-run `fil init` or rename `gate:{...}` → `gates:[{name, type, ...}]`. No backward-compat shim (early project).

- Updated dependencies [0e2a0c2]
  - @color-sunset/fil-contract@0.3.0

## 0.1.0

### Minor Changes

- 3399dbc: Add the **Claude Code Adapter** package (`@color-sunset/fil-claude-adapter`), closing #16.

  - Pure `enforceClaudeEnforcement` derives the `ClaudeEnforcement` surface (allowedTools, system prompt, skill paths, context paths) directly from the contract's `RunProjection`; `decideToolUse(projection, toolName)` is the fail-closed PreToolUse decision — empty `allowedTools` denies every tool, mirroring the Pi Adapter.
  - The hard enforcement layer is a self-contained `PreToolUse` hook (`renderPreToolUseHookSource`) that Claude Code spawns via `node`: it reads `.fil/run.json` (from `CLAUDE_PROJECT_DIR`), and emits Claude's `{ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", … } }` JSON to block a tool outside the active Phase's `allowedTools`, or stays silent to allow. Dormant (allows all) when there is no active Run.
  - `installClaudeAdapter` installs through Claude Code's native channel: writes the hook script (`.claude/fil/pretooluse-hook.js`, project scope, or `~/.claude/fil/` for user scope) and merges a `PreToolUse` handler into `.claude/settings.json` — preserving existing hooks and deduplicating by command+args, so re-runs are idempotent. `detectClaude()` walks `~/.claude`, `~/.claude.json`, and `$PATH`.
  - `fil init [--scope project|user|both]` now installs the Claude adapter alongside the Pi adapter when detected; the single `--scope` flag applies to both.
  - Integration test executes the rendered hook via `node` against a contract-written `.fil/run.json`, proving it blocks/allows tools exactly as the active Phase's contract specifies.
