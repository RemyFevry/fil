---
"@color-sunset/fil-pi-adapter": minor
"@color-sunset/fil-cli": patch
---

Add the Pi Adapter **control surface** — Fil's control verbs as native Pi tools, closing #15.

- `control-surface.ts` is the unit-testable source of truth: `FIL_VERB_TOOLS` declares the five verbs (`fil_start`/`fil_next`/`fil_status`/`fil_propose`/`fil_approve`) mapped 1:1 to the `fil` CLI; `toArgv` maps tool args to CLI argv; `runFilVerb` is a thin caller over an injectable runner; `defaultRunner` shells out to `fil` (`FIL_BIN` override → `node <entry>`, else `fil` on PATH).
- The rendered Pi extension (`renderPiExtensionSource`) now registers the verbs via `pi.registerTool` at load time. Each tool's `execute` runs the matching `fil <verb>` from the session `cwd` and returns a Pi `AgentToolResult`. The verbs are thin callers, so behaviour is identical to the CLI. `typebox`/`@sinclair/typebox` resolve through Pi's jiti aliases (verified against Pi's extension loader); enforcement is untouched.
- `fix(cli)`: the `fil` bin's `isMain` guard now compares against the module's own URL (`import.meta.url`) instead of a cwd-relative path, so the bin runs when spawned from any directory/install layout — required for the control surface (and any consumer) to shell out to `fil`.
- Tests: pure verb/argv mapping; rendered-source structure; an integration test driving the real `fil` via `runFilVerb` (fil_next advances, status/propose/approve behave as the CLI); and a "through Pi's tool surface" test that loads the exact registration code with a stub `pi` and invokes registered tools' `execute` against a real Run.
