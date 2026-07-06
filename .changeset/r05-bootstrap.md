---
"@color-sunset/fil": patch
---

Add `scripts/bootstrap.sh` and `pnpm bootstrap` (R05). New contributors (human or AFK agent) run one command to verify their toolchain (Node ≥ 20, pnpm ≥ 10, `wt`, `gh`), switch the `gh` identity to `remyf-agent` when configured, and warm `node_modules/` + the per-package `dist/` cache. Idempotent: the second invocation finishes in <2s by mtime-checking the cache. The vitest in `scripts/test/bootstrap.test.ts` proves no file mtimes advance on a re-run. Closes #59.

Vitest config now also picks up `scripts/test/**/*.test.ts` so future script-level guarantees land in the same test surface.