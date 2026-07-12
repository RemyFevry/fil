---
"@color-sunset/fil-flow-loader": minor
"@color-sunset/fil-cli": patch
"@color-sunset/fil-evolution": patch
---

Lift the dynamic-import Flow loader dance into `@fil/flow-loader`; migrate CLI + evolution (closes #89).

- **`@color-sunset/fil-flow-loader`** now owns the default `importFlowFile(path)` and `importFlowCode(code)` — the consolidated dance: rewrite the bare `@color-sunset/fil-engine` specifier to the engine's absolute entry URL, write to a temp file under a Windows-safe root (`pickTempRoot`, also now exported from here), canonicalize with `fs.realpathSync`, `pathToFileURL` + `import()`, then clean up. The `FlowLoaderDeps.importFlowFile` seam finally has a production default; test fakes still work as before.
- **`@color-sunset/fil-cli`** (`packages/cli/src/commands/common.ts`) — `realFlowLoaderDeps.importFlowFile` now passes the flow-loader default; the inline engine-specifier rewrite, temp-file write, and `pickTempRoot` are deleted.
- **`@color-sunset/fil-evolution`** (`packages/evolution/src/index.ts`) — `loadFlowCode` is now a thin wrapper over `importFlowCode`; its inline dance and `pickTempRoot` are deleted. Adds `@color-sunset/fil-flow-loader` as a dependency.

No behaviour change. The Windows 8.3 short-name fix (`fs.realpathSync` before `pathToFileURL`, ADR-0005 §Windows URL normalization) now lives in exactly one place instead of being re-implemented per call site. The `pickTempRoot` tests move to `packages/flow-loader/test/index.test.ts`; the CLI/evolution copies are dropped.
