---
"@color-sunset/fil": patch
---

Add Windows to the CI test matrix (closes #76).

- `.github/workflows/test.yml` re-adds `windows-latest` to the cross-OS matrix alongside `macos-latest`. Both legs run on push-to-main and on non-draft PRs; Linux still runs on every PR event. Three jobs in steady state; one on draft PRs.
- **Production fix:** `packages/evolution/src/index.ts` (`loadFlowCode`) and `packages/cli/src/commands/common.ts` (`importFlowFile`) now call `fs.realpathSync` on the temp file path before `pathToFileURL`/`import()`. Without it, the GitHub-hosted Windows runner's 8.3 short-name home dir (`C:\Users\RUNNER~1\…`) breaks the URL→path round-trip and Node reports "Failed to load url … Does the file exist?" for a real, on-disk file. The fix is 2 lines per site, no-op on POSIX. See ADR-0005's "Windows URL normalization" subsection.
- **Test fix:** `packages/claude-adapter/test/installer.test.ts` — 5 path-literal POSIX assumptions replaced with `path.sep`-aware assertions + `join(...)` for memFs keys. Same pattern as the already-landed `pi-adapter/test/{installer,enforcement,enforcement-contract}.test.ts` fixes.
- Docs (`docs/adr/0005-…`, `docs/agents/onboarding.md`, `docs/agents/developer-experience.md`, `CONTRIBUTING.md`) updated to reflect the now-green Windows leg.

Branch-protection required checks grow to four: `lint-build / verify`, `test / test-linux`, `test / test-cross-os (macos-latest)`, `test / test-cross-os (windows-latest)`. Maintainers with admin access should update the entries; non-admins see the new job names automatically.