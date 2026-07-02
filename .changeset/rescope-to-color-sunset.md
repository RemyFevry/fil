---
"@color-sunset/fil": minor
"@color-sunset/fil-cli": minor
"@color-sunset/fil-contract": minor
"@color-sunset/fil-engine": minor
"@color-sunset/fil-evolution": minor
"@color-sunset/fil-flow-loader": minor
"@color-sunset/fil-gate-runner": minor
"@color-sunset/fil-inspect-view": minor
"@color-sunset/fil-orchestrator": minor
"@color-sunset/fil-pi-adapter": minor
"@color-sunset/fil-store": minor
---

Rescope every package under the `color-sunset` npm org.

- The meta-package is now `@color-sunset/fil` (was `fil-cli`).
- The 10 sub-packages are now `@color-sunset/fil-{cli,contract,engine,evolution,flow-loader,gate-runner,inspect-view,orchestrator,pi-adapter,store}` (were `@fil/*`).
- The `fil` *command* (the bin) is unchanged — users still run `fil init`, `fil start`, `fil next`, etc.

**Why:** the unscoped `fil` name on npm is already taken by an unrelated static-site generator (`ubenzer/fil`), and the `@fil` scope is unowned. The `color-sunset` org (owned by the Fil maintainer) gives every package a stable, owned home.

**Install migration:** `npm install -g fil-cli` → `npm install -g @color-sunset/fil`. Internal `import` statements also change; downstream consumers of `@fil/*` must update their imports.

**Provenance strategy change:** `provenance=true` was removed from `.npmrc` (it broke local `pnpm publish` with `EUSAGE Automatic provenance generation not supported for provider: null`) and moved to the release workflow's `NPM_CONFIG_PROVENANCE` env. CI still attaches provenance; local manual publishes work without it.