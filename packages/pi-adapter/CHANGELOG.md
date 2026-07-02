# @fil/pi-adapter

## 0.1.0

### Minor Changes

- 723d8a6: Initial public release.

  - All `@fil/*` packages and the `fil-cli` meta-package are now publishable to npm under the MIT license.
  - `fil-cli` ships a `bin: fil` entry, so `npm install -g fil-cli` and `npx fil-cli` work post-install. (The `fil` name itself was already taken on npm by an unrelated static-site generator, so the meta-package is `fil-cli` while the `fil` command is unchanged.)
  - A release workflow (`.github/workflows/release.yml`) drives versioning via Changesets and publishes to npm with provenance on tag.
  - OSS governance docs added: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`.
  - The Pi Adapter (`@fil/pi-adapter`) constrains the Pi Agent Runtime to the active Fil Phase (allowedTools / instructions / context / skills) and installs through Pi's native extension channel; `fil init` installs it on detected machines (#14).

- ef08e34: Add the **Pi Adapter** package (`@fil/pi-adapter`), closing #14:

  - Pure `enforcePiEnforcement` derives the `PiEnforcement` surface (allowedTools, system prompt, skill paths, context paths) directly from the contract's `RunProjection` — the only file allowed to import the Pi runtime is the rendered extension source, mirroring the engine-isolation pattern (ADR-0003).
  - `installPiAdapter` writes the generated extension into Pi's native extension directory (`.pi/extensions/fil.ts` for project scope, `~/.pi/agent/extensions/fil.ts` for user scope), idempotent on source match.
  - `detectPi()` walks `~/.pi` and `$PATH` (using `path.delimiter` for cross-platform).
  - `fil init [--scope project|user|both]` now installs the Pi adapter when detected; default scope is `project`; unknown scopes fail fast with exit 2.
  - Path-containment check on Phase `context.files` rejects `..` traversals and absolute paths that escape the project root.
  - The rendered extension's `tool_call` hook is fail-closed when `allowedTools` is empty (mirrors `setActiveTools([])` in `session_start`).

### Patch Changes

- Updated dependencies [723d8a6]
  - @fil/contract@0.1.0
