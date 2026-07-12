# Fil

An open-source harness for agentic software-development lifecycles. See [`CONTEXT.md`](./CONTEXT.md) for the glossary and [`docs/OVERVIEW.md`](./docs/OVERVIEW.md) for the design synthesis.

## Agent skills

### Onboarding

New here? Read [`docs/agents/onboarding.md`](./docs/agents/onboarding.md) first — the 60-second orientation, the workflow contract, and the gotchas that waste context if you don't know them up front.

### Developer & agent experience

State-of-the-art review of the human and agent setup, plus the prioritized recommendations (P0/P1/P2): [`docs/agents/developer-experience.md`](./docs/agents/developer-experience.md).

### The canonical feature loop

Every Change — feature, fix, refactor — follows one loop: plan on the issue, open a draft PR with `Closes #N`, implement, wait for CodeRabbit + Sonar, address each thread, then merge. Codified as a single doc so agents and humans share one workflow: [`docs/agents/feature-loop.md`](./docs/agents/feature-loop.md).

### Issue tracker

Issues and PRDs live as GitHub issues on `RemyFevry/fil`, tracked on the **Fil MVP** GitHub Project board (PRD epic: #21). Use the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles map 1:1 to GitHub labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Issue workflow

Execution status lives on the **Fil MVP** board's `Status` field (`Todo → In Progress → In Review → Done`; `Blocked` when stuck) — **not** labels. Triage labels track *readiness*; board Status tracks *execution*. **Any agent or human working an issue must keep its Status and comments current**, at every transition. See `docs/agents/issue-workflow.md`.

### Domain docs

Single-context: read `CONTEXT.md` at the repo root and `docs/adr/` before working in an area. See `docs/agents/domain.md`.

## Worktree workflow

Agent work happens in **Worktrunk** worktrees, never in the primary checkout. A
guard blocks mutating tools (edit/write/bash) in the primary worktree across
Claude Code, Pi, and OpenCode, so parallel agents can't step on the trunk.

```sh
wt switch -c <branch>                   # create + enter a linked worktree
                                        # (this exact command is whitelisted
                                        # by the guard as a bootstrap hatch)
wt switch -x claude   -c <branch>       # launch Claude Code in it
wt switch -x opencode -c <branch>       # launch OpenCode in it
wt switch -x pi       -c <branch>       # launch Pi in it
```

When done: `wt merge main` (squash + rebase + run the `pre-merge` gates) or open
a PR and `wt remove` after it merges.

- One-time per machine: `brew install worktrunk && wt config shell install`.
- Trunk maintenance (not bootstrap): `FIL_ALLOW_MAIN_WORKTREE=1` — agents
  must not set this on their own.
- Enforcement source of truth: `scripts/require-worktree.sh`, wired into
  `.claude/settings.json` → `.claude/hooks/worktree-guard.mjs`,
  `.opencode/plugins/worktree-guard.ts`, and
  `.pi/extensions/worktree-guard.ts`.

## Multi-agent orchestration with herdr

Fil has two layers for safe parallel agent work:

- **Worktrunk** (this section) — filesystem isolation per Change. One
  checkout per branch. `scripts/require-worktree.sh` enforces it.
- **[Herdr](https://herdr.dev/docs/agents/)** — terminal-process
  orchestration + state rollup. One Workspace per Change; tabs inside a
  Workspace are subagents. The sidebar's per-Workspace rollup tells you
  which Change needs attention.

Both layers compose: each herdr pane's `cwd` is a `wt switch`-managed
worktree. Herdr is **non-mandatory**: every Fil command works without it,
and the canonical workflow degrades to Worktrunk-only when herdr is not
on `PATH`.

The Fil-specific reference lives at [`docs/agents/herdr.md`](./docs/agents/herdr.md).
The spawn/close pair is `pnpm feat <n>` / `pnpm ship` — both herdr-conditional
symmetric wrappers around `wt switch` and `wt merge main`. Setup is one
command: `pnpm install-herdr`.
