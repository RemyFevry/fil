# Smarter CI: precommit hooks (lefthook) + single-Node split workflows

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
     `test-cross-os` (matrix `macos-latest`) skipped on draft PRs. Node 26
     throughout. Two jobs in steady state; one on draft PRs.
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
   The cross-OS leg is gated by `if: ... draft == false`, so a draft PR
   only needs `lint-build / verify` + `test / test-linux` to be non-blocked.
   Once the PR is marked `ready_for_review`, the macOS leg joins the required
   set.

### Windows coverage — **deferred**

`windows-latest` was originally included in this matrix (cross-OS step was
`macos-latest, windows-latest`). It is deferred — see the follow-up issue.
The shell default `bash` and the `build` step in the test job are kept in
place so re-adding `windows-latest` is a one-line matrix entry once the
underlying test fix lands. Until then the team's cross-OS confidence comes
from `linux` + `macos-latest`.

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
  `if [[ ... ]]; then` or `set -euo pipefail` without OS thinking. Kept
  after the Windows deferral so re-adding `windows-latest` is a no-op.
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
- **macOS test skipped on drafts** saves CI minutes on iteration; PRs get
  the macOS leg on `ready_for_review` and on every push to a non-draft PR.

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

- **Windows deferred (see follow-up issue).** Adding `windows-latest`
  surfaced pre-existing cross-platform bugs in three test files plus a
  production-side ESM URL resolver quirk in the proposal loader. Those
  are real bugs that deserve their own ADR, not a CI-side workaround.
  Linux + macOS gives us the cross-OS signal we need in the meantime;
  re-adding `windows-latest` is one matrix line once the tests are fixed.
- **Two workflow files means two `checkout + setup-node + pnpm install`
  blocks.** YAML duplication is ~30 lines per file; cached pnpm store
  makes the install step cheap (~10–15 s). Could DRY via a reusable
  workflow, but the saved lines aren't worth the indirection at this
  scale.
- **No `paths:` filters.** A pure-docs PR still spins up lint-build +
  test-linux. Worth it for the dropped maintenance risk and PR-Page
  noise; if/when docs-only PRs dominate, add a `docs:**` filter to
  both workflows.
- **Drafts skip macOS but not Linux test.** Linux is the cheapest signal
  and is required even on drafts (so an author can't accidentally
  green-check a draft by ignoring it). Tradeoff: a Linux-only green
  draft can be opened as a PR, marked ready, and immediately macOS
  falls onto the maintainer.
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
- `CONTRIBUTING.md`, `docs/agents/onboarding.md`, and `docs/agents/developer-experience.md`
  (R14) are updated to mention `brew install lefthook` / `scoop install
  lefthook` and the new workflow split.
- Branch-protection "Required status checks" on `main` should be reviewed
  to point at the three new job names (`lint-build / verify`,
  `test / test-linux`, `test / test-cross-os (macos-latest)`). Anyone who
  lands this PR with admin access can rename the entries; non-admins will
  see the failed check by stable workflow+job name.
- A follow-up issue tracks re-adding `windows-latest` once the
  cross-platform test bugs land.
