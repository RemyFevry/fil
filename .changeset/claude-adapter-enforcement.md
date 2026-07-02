---
"@fil/claude-adapter": minor
"@fil/cli": minor
---

Add the **Claude Code Adapter** package (`@fil/claude-adapter`), closing #16.

- Pure `enforceClaudeEnforcement` derives the `ClaudeEnforcement` surface (allowedTools, system prompt, skill paths, context paths) directly from the contract's `RunProjection`; `decideToolUse(projection, toolName)` is the fail-closed PreToolUse decision — empty `allowedTools` denies every tool, mirroring the Pi Adapter.
- The hard enforcement layer is a self-contained `PreToolUse` hook (`renderPreToolUseHookSource`) that Claude Code spawns via `node`: it reads `.fil/run.json` (from `CLAUDE_PROJECT_DIR`), and emits Claude's `{ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", … } }` JSON to block a tool outside the active Phase's `allowedTools`, or stays silent to allow. Dormant (allows all) when there is no active Run.
- `installClaudeAdapter` installs through Claude Code's native channel: writes the hook script (`.claude/fil/pretooluse-hook.js`, project scope, or `~/.claude/fil/` for user scope) and merges a `PreToolUse` handler into `.claude/settings.json` — preserving existing hooks and deduplicating by command+args, so re-runs are idempotent. `detectClaude()` walks `~/.claude`, `~/.claude.json`, and `$PATH`.
- `fil init [--scope project|user|both]` now installs the Claude adapter alongside the Pi adapter when detected; the single `--scope` flag applies to both.
- Integration test executes the rendered hook via `node` against a contract-written `.fil/run.json`, proving it blocks/allows tools exactly as the active Phase's contract specifies.
