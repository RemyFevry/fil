# Smarter CI: precommit hooks (lefthook) + single-Node split workflows + cross-OS test matrix

## Context

The single `.github/workflows/ci.yml` ran one giant `verify` matrix leg
(`ubuntu-latest, macos-latest × node 20, 22` = 4 runners) that each re-executed
the entire pipeline — `lint && lint:md && build && typecheck && test`. Pure-TS
analysis (ESLint + tsc) is platform-agnostic, so the cross-OS legs duplicated
work that turned up no real signal; the Node-matrix did the same on top. macOS
was the slowest runner, holding PRs behind it.

Concurrently, the local inner loop had no precommit gate — only Worktrunk's
`[pre-merge]` ran `typecheck + lint + test`, which fires at merge time, not at
commit. The DevEx review (`docs/agents/developer-experience.md` R14) flagged
the missing precommit-and-prepush story.

## Decision

**Three orthogonal changes, landed together because they share an invariant
("fast local gate, cheap CI, costly CI gated by draft status"):**

1. **CI split into two workflows, single Node version.**
   - `.github/workflows/lint-build.yml` — ubuntu-latest + Node 26, single
     runner, runs `lint + lint:md + typecheck + build`. Pure-TS, no cross-OS
     variability, no matrix.
   - `.github/workflows/test.yml` — two jobs: `test-linux` always, and
     `test-cross-os` (matrix `macos-latest, windows-latest`) skipped on
     draft PRs. Node 26 throughout. Three jobs in steady state; one on
     draft PRs.
   - Both files: `defaults: run: { shell: bash }`; `cancel-in-progress:
     ${{ github.event_name == 'pull_request' }}` (preserve main-push
     integrity); no `paths:` filter (today's broad triggering is fine for a
     small repo; revisit if scale justifies it).
   - `.github/workflows/ci.yml` is **removed**, not deprecated — the new files
     replace it.

2. **Precommit / prepush hooks via [lefthook](https://lefthook.dev).**
   - `lefthook.yml` at repo root; `lefthook` added as a devDep; `"prepare":
     "lefthook install"` in `package.json` so `pnpm install` sets up hooks.
   - `pre-commit`: `eslint --fix` (with `stage_fixed: true`) on staged
     `*.{ts,tsx}` + `pnpm lint:md` (parallel).
   - `pre-push`: `pnpm lint` + `pnpm typecheck` (parallel, whole-project).
   - `pnpm ci` is unchanged — it still runs `lint + lint:md + build +
     typecheck + test`, useful as a "did I break GH-side lints?" check.

3. **Branch protection unchanged in shape, narrowed in scope**: the same
   pull-request checks block merge (exact GitHub status names — copy these
   into Branch protection → Required status checks after merge):
   - `lint-build / verify`
   - `test / test-linux`
   - `test / test-cross-os (macos-latest)`
   - `test / test-cross-os (windows-latest)`
   The cross-OS legs are gated by `if: ... draft == false`, so a draft PR
   only needs `lint-build / verify` + `test / test-linux` to be non-blocked.
   Once the PR is marked `ready_for_review`, the macOS + Windows legs
   join the required set.

### Follow-up: Windows URL normalization

Re-adding `windows-latest` to the matrix surfaced a real production-side
quirk: `importFlowFile` (in `packages/cli/src/commands/common.ts`) and
`loadFlowCode` (in `packages/evolution/src/index.ts`) both write a temp
`.mjs` to disk under `os.tmpdir()`, then call
`await import(pathToFileURL(file).href)`. On the GitHub-hosted Windows
runner, `$USERPROFILE` resolves to the 8.3 short form
`C:\Users\RUNNER~1\…`; `pathToFileURL` URL-encodes the `~` as `%7E`,
but Node's ESM loader's URL→path round-trip then can't find the file we
just wrote and reports "Failed to load url … Does the file exist?" for
a real, on-disk file. **Fix:** canonicalize the path with
`fs.realpathSync` before `pathToFileURL` — resolves the short name +
any symlinks so the URL round-trips cleanly. No-op on POSIX. The
canonicalize-before-import pattern lives in two places (cli + evolution)
and is referenced from each file's inline comment. The other Windows
failures (5 in `claude-adapter/test/installer.test.ts`) were path-literal
test fixes mirroring the already-landed `pi-adapter/test/{installer,enforcement,enforcement-contract}.test.ts`
pattern. Captured as #76 in the issue tracker; closes with this PR.

## Why

- **Split workflows** mean each file owns one concern: *guard*
  (lint-build, "is the code correct?") vs *check* (test, "does it work?").
  Different concurrency groups, different future trigger rules, no shared
  in-flight cancellation between them.
- **Single Node 26** across all jobs drops the 4× Node matrix duplication
  (Node 20 was EOL April 2026; Node 22 is a year+ behind; Node 26 is the
  current release — it becomes Active LTS in October 2026, so within a few
  months of this ADR it'll be the LTS pick, but it's the current release
  either way at the time of writing). Pure-TS lint/typecheck/build is
  Node-version-independent; vitest is too, modulo Node-version-specific
  stdlib quirks we've never hit. If Node 26 turns out to need a downgrade,
  it's one line.
- **`defaults: run: { shell: bash }`** is the smallest possible diff that
  guarantees cross-OS `run:` semantics; future contributors can write
  `if [[ ... ]]; then` or `set -euo pipefail` without OS thinking.
- **`cancel-in-progress: ${{ github.event_name == 'pull_request' }}`** preserves
  release-push integrity. Today both `ci.yml` and `sonarcloud.yml` cancel
  on main pushes; once split, only PR pushes cancel.
- **lefthook** (vs husky / simple-git-hooks / pre-commit.com): see the
  comparative section below.
- **Pre-commit = fast staged-files; pre-push = full-project** matches the
  user's words ("lint and typecheck as precommit hooks") without making
  every commit pause for whole-repo tsc (~5–30s). Lint staged fixes the
  common case (~1s); typecheck on push catches graph-wide errors just
  before they leave the box.
- **macOS + Windows test skipped on drafts** saves CI minutes on iteration;
  PRs get the full matrix on `ready_for_review` and on every push to a
  non-draft PR. Linux stays as the always-on smoke test.

## Compared: lefthook vs the alternatives

- **husky + lint-staged** — broader recognition, but two devDeps, Node
  bootstrap. `lint-staged` enforces the staged-files mental model that's
  the wrong shape for whole-project `pnpm typecheck`.
- **simple-git-hooks** — same shape as husky, smaller dep, but still
  requires `lint-staged` for staged-file globs. Same friction, smaller
  community.
- **pre-commit.com** (Python framework, `.pre-commit-config.yaml`) —
  staging-by-glob is the *only* model; `pnpm typecheck` cannot be
  staged-only. Forces a Python prerequisite on a Node-only repo, slower
  cold install per hook repo, no upside over lefthook for Fil.
- **lefthook** — single Go binary, parallel by default, no Node bootstrap,
  handles pre-commit/pre-push cleanly, handles staged-file globs natively
  via `{staged_files}`. `stage_fixed: true` re-stages `--fix`-rewritten
  files for us. We pin `^2.0.0` (the v1 line is no longer maintained).
  Trade-off: every contributor must install lefthook once per machine
  (macOS: `brew install lefthook`; Windows: `scoop install lefthook`;
  Debian/Ubuntu/Fedora: see [`CONTRIBUTING.md`](../../CONTRIBUTING.md) —
  the bare `apt install lefthook` only works after adding the Lefthook
  apt repository, so we point at the full setup flow there instead of
  repeating it inline).

## Trade-offs accepted

- **Windows URL normalization.** The `realpathSync`-before-`pathToFileURL`
  patch is a 2-line, ~30-character fix per site. It costs nothing on POSIX
  and unblocks the entire Windows test leg — the alternative was either
  refusing to run on Windows or rewriting the loader to use `data:` URLs or
  an in-process VM (significantly more invasive). Captured as a follow-up
  subsection above so the rationale is captured in one place; revisit only
  if Node's loader ever stops misbehaving on Windows 8.3 short names.
- **Two workflow files means two `checkout + setup-node + pnpm install`
  blocks.** YAML duplication is ~30 lines per file; cached pnpm store
  makes the install step cheap (~10–15 s). Could DRY via a reusable
  workflow, but the saved lines aren't worth the indirection at this
  scale.
- **No `paths:` filters.** A pure-docs PR still spins up lint-build +
  test-linux. Worth it for the dropped maintenance risk and PR-Page
  noise; if/when docs-only PRs dominate, add a `docs:**` filter to
  both workflows.
- **Drafts skip macOS + Windows but not Linux test.** Linux is the cheapest
  signal and is required even on drafts (so an author can't accidentally
  green-check a draft by ignoring it). Tradeoff: a Linux-only green draft
  can be opened as a PR, marked ready, and immediately macOS + Windows
  fall onto the maintainer.
- **`pnpm ci` retained unchanged** despite only mirroring `lint-build.yml`
  now. Reason: docs (`CONTRIBUTING.md`, `docs/agents/onboarding.md`) treat
  it as the canonical "mirror CI exactly" command. Keeping it as
  lint+lint:md+build+typecheck+test is the safer disruption; we can trim
  it later if consensus forms.

## Consequence

- `.github/workflows/ci.yml` is removed.
- `.github/workflows/lint-build.yml` and `.github/workflows/test.yml` are
  the two merge-gate workflows. `sonarcloud.yml`, `release.yml`,
  `issue-status-sync.yml` are unchanged.
- `lefthook.yml`, `package.json` (`"lefthook": "^2.0.0"` devDep +
  `"prepare": "lefthook install"` script) are added.
- `packages/evolution/src/index.ts` and `packages/cli/src/commands/common.ts`
  call `fs.realpathSync` before `pathToFileURL` so dynamic `import()` of
  on-disk temp files round-trips on Windows 8.3 short-name paths.
- `CONTRIBUTING.md`, `docs/agents/onboarding.md`, and `docs/agents/developer-experience.md`
  (R14) are updated to mention `brew install lefthook` / `scoop install
  lefthook` and the new workflow split.
- Branch-protection "Required status checks" on `main` should be reviewed
  to point at the four new job names (`lint-build / verify`,
  `test / test-linux`, `test / test-cross-os (macos-latest)`,
  `test / test-cross-os (windows-latest)`). Anyone who lands this PR
  with admin access can rename the entries; non-admins will see the
  failed check by stable workflow+job name.
