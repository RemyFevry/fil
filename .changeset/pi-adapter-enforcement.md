---
"@fil/pi-adapter": minor
---

Add the **Pi Adapter** package (`@fil/pi-adapter`), closing #14:

- Pure `enforcePiEnforcement` derives the `PiEnforcement` surface (allowedTools, system prompt, skill paths, context paths) directly from the contract's `RunProjection` — the only file allowed to import the Pi runtime is the rendered extension source, mirroring the engine-isolation pattern (ADR-0003).
- `installPiAdapter` writes the generated extension into Pi's native extension directory (`.pi/extensions/fil.ts` for project scope, `~/.pi/agent/extensions/fil.ts` for user scope), idempotent on source match.
- `detectPi()` walks `~/.pi` and `$PATH` (using `path.delimiter` for cross-platform).
- `fil init [--scope project|user|both]` now installs the Pi adapter when detected; default scope is `project`; unknown scopes fail fast with exit 2.
- Path-containment check on Phase `context.files` rejects `..` traversals and absolute paths that escape the project root.
- The rendered extension's `tool_call` hook is fail-closed when `allowedTools` is empty (mirrors `setActiveTools([])` in `session_start`).
