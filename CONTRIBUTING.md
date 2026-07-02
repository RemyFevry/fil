# Contributing to Fil

Thanks for your interest in Fil — contributions of any size are welcome. This document explains how to set up
the repo, follow the issue/PR workflow, and ship a clean PR.

## Code of conduct

Everyone who contributes is expected to follow [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).

## Reporting a vulnerability

Please **do not** open a public issue for security bugs. Follow [`SECURITY.md`](./SECURITY.md) instead.

## Where to start

Fil is young and the surface area is small. Three reads before you write code:

1. [`CONTEXT.md`](./CONTEXT.md) — the glossary. **Use these terms**, not synonyms (Gate ≠ check, Phase ≠ state,
   Receipt ≠ log, Flow ≠ workflow).
2. [`docs/OVERVIEW.md`](./docs/OVERVIEW.md) — the design synthesis and the "what Fil owns vs delegates" table.
3. The relevant [`docs/adr/`](./docs/adr/) ADR(s). There are three today; each captures one irreversible decision.

If you're picking up an issue, also read:

- [`docs/agents/issue-tracker.md`](./docs/agents/issue-tracker.md) — how the GitHub Issues + Project board is wired.
- [`docs/agents/issue-workflow.md`](./docs/agents/issue-workflow.md) — the lifecycle: Todo → In Progress → In Review → Done.
- [`docs/agents/triage-labels.md`](./docs/agents/triage-labels.md) — the canonical triage vocabulary.

## Pick an issue

Work is tracked on the [Fil MVP project board](https://github.com/users/RemyFevry/projects/1). Every issue
carries a triage label (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) and
has a board `Status` field. Look for `ready-for-agent` and grab one with `Status = Todo`.

If you're working an issue, **keep its `Status` and comments current at every transition** — that's the
contract that makes "grab any `ready-for-agent` issue and go" safe.

## Local setup

You need **Node 20+** and **pnpm 10**. The exact pnpm version is pinned via the `packageManager` field in
`package.json`.

```sh
# Clone
git clone https://github.com/RemyFevry/fil.git
cd fil

# Install deps (frozen lockfile — required by CI)
pnpm install --frozen-lockfile
```

## Development workflow

Fil uses [Worktrunk](https://worktrunk.dev) for parallel agent work. Agent work happens in linked worktrees,
never in the primary checkout; the guard at `scripts/require-worktree.sh` enforces this for Claude Code, Pi,
and OpenCode.

```sh
# Create a worktree for your branch (and launch your agent inside it)
wt switch -x opencode -c feat/<short-name>

# ... do the work ...

# Merge to main (runs the pre-merge gates: types → lint → test)
wt merge main
```

If you don't use Worktrunk, a plain git worktree is fine — just make sure you're not committing to `main`.

## Commits and PRs

- **Conventional Commits** — `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`. The PR title and any
  squash-merge message should follow the convention.
- **One logical change per PR.** A PR that fixes a bug *and* reformats a file is hard to review.
- **Reference the issue**: `Closes #<n>` (or `Fixes` / `Resolves`) in the PR body. The status-sync Action
  uses this to keep the board honest.
- **Add a changeset** for any user-facing change: `pnpm changeset`. Pick the affected packages, the bump type
  (`patch` / `minor` / `major`), and write a one-line summary. Commit the resulting `.changeset/*.md` file.
- **Pre-merge gates** (CI): `pnpm lint && pnpm lint:md && pnpm build && pnpm typecheck && pnpm test`, on
  Ubuntu and macOS, Node 20 and 22.

## Quick checks

| Check | Command | Scope |
|---|---|---|
| Lint (ESLint) | `pnpm lint` | All packages |
| Markdown lint | `pnpm lint:md` | `README.md` |
| Build | `pnpm build` | All packages (`tsc -b`) |
| Typecheck | `pnpm typecheck` | All packages (whole-graph) |
| Tests | `pnpm test` | All packages (vitest) |
| Coverage | `pnpm test:coverage` | All packages |
| Combined CI | `pnpm ci` | lint → lint:md → build → typecheck → test |

## Package layout

The repo is a pnpm workspace monorepo. Each package is independently publishable (and versioned by Changesets).

| Package | Role |
|---|---|
| `@fil/contract` | The `.fil/run.json` schema + serializers/validators. |
| `@fil/engine` | The `FlowEngine` seam + the default XState implementation. |
| `@fil/flow-loader` | Resolves Flow files across project/user precedence. |
| `@fil/gate-runner` | Executes Gates → Receipts. |
| `@fil/evolution` | Pure validation of proposed Flow patches. |
| `@fil/store` | Repository over `.fil/`. |
| `@fil/orchestrator` | `startRun / advance / back / cancel`. |
| `@fil/inspect-view` | View-only Flow visualizer. |
| `@fil/cli` | The `fil` command — thin wiring over the modules above. |
| `fil-cli` | The meta-package that depends on `@fil/cli` and provides the `fil` bin. (The unscoped `fil` name is taken on npm — see the README.) |

## Filing issues

Use `gh issue create` (or the web UI) with a descriptive title and a short body. New issues land in
`needs-triage`; a maintainer will move them to `ready-for-agent` once they're well-scoped.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).