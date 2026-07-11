# Herdr — multi-agent orchestration for Fil

> Herdr (https://herdr.dev/docs/agents/) is a non-mandatory dev tool that lets
> you run multiple coding agents in parallel without losing state. Each agent
> stays in a real terminal pane; the sidebar rolls up `idle / working /
> blocked / done` so you can see at a glance which project needs you.
>
> This doc is the Fil-specific reference. Read once, return when you need a
> recipe.

## Why herdr in Fil

Fil's workflow already protects the trunk from parallel agents via Worktrunk
([`AGENTS.md`](../../AGENTS.md)). Herdr is the *outer* layer:

- **Worktrunk** = filesystem isolation per Change (one checkout per branch).
- **Herdr** = terminal-process orchestration + state rollup (one pane per
  agent, sidebar per workspace).

The two compose: each herdr pane's `cwd` is a `wt switch`-managed worktree.

## The Fil convention

- One herdr **Workspace** per Fil **Change** (= per Worktrunk worktree).
- Tabs **inside** the Workspace are **subagents** spawned by the main agent.
- The sidebar's per-Workspace state rollup answers "which Change needs
  attention?" without polling every terminal.

This is deliberately one-Workspace-per-Change, not one-Workspace-per-repo:

- Each Workspace's label names the Change.
- The dev sees: *Tab 1 — Claude (main agent, writing feat/46). Tab 2 — Pi
  (test runner). Tab 3 — OpenCode (drafting docs for #46).*
- Multitask = multiple Workspaces open simultaneously.

## Install

Run once per host:

```sh
pnpm install-herdr
```

This calls `scripts/install-herdr.sh`, which is idempotent and does all of:

1. `brew install herdr` (skipped if already present).
2. `herdr integration install claude opencode pi` — lifecycle authority +
   session identity for the three Fil-supported runtimes.
3. `npx skills add ogulcancelik/herdr --skill herdr -g` — installs the
   official herdr **agent skill** globally. Every agent that loads inside a
   herdr pane gets it automatically (gated by `HERDR_ENV=1`).
4. Symlinks `~/.config/herdr/config.toml` to
   [`docs/agents/herdr-config.toml`](./herdr-config.toml) in this repo
   (first run only; never overwrites).

Re-running `pnpm install-herdr` is safe — every step is idempotent.

## Spawn / close a Change

These are the canonical Fil-side wrappers (symmetric pair):

```sh
pnpm feat <n>            # create worktree feat/<n>, anchor a Workspace
pnpm ship                # wt merge main, close the matching Workspace
```

Both are herdr-conditional: if herdr is not on PATH, the Worktrunk half still
runs. Fil owns the git/Worktrunk side; the herdr half is a graceful
augmentation. The dev with herdr gets a sidebar-friendly slot per Change;
the dev without herdr keeps the standard Worktrunk workflow.

### Spawn a subagent inside a Workspace

The subagent shows up as a tab in the current Workspace:

```sh
herdr agent start tests --cwd "$(pwd)" -- pi
```

A single command. Herdr tags the pane as an agent (sidebar shows
`pi · working`), inherits cwd, and creates a new tab in the same Workspace.
Fil ships no wrapper here — the herdr CLI *is* the interface, and the
auto-loaded herdr skill teaches every agent how to invoke it.

### Other everyday herdr commands

```sh
herdr                          # start (or reattach to) the default session
herdr agent list               # every running agent + status, all workspaces
herdr wait agent-status <pane> --status done --timeout 60000
herdr server stop              # end the session (closes every pane)
```

## How Fil and herdr compose — and don't

| Concern | Fil / Worktrunk | herdr |
|---|---|---|
| Filesystem isolation per Change | `wt switch -c <branch>` | n/a (each pane's cwd is a worktree) |
| `[pre-merge]` gates on merge | `wt merge main` runs typecheck/lint/test | n/a |
| Conventional-Commits + agent trailer | `.config/wt.toml` template | n/a |
| Draft-PR lifecycle (`Closes #N`) | Fil feature-loop | n/a |
| Sidebar state rollup | n/a | herdr sidebar |
| Native agent session restore | n/a | default-on; uses our integrations |
| Per-pane terminal | n/a | herdr panes |
| Subagent spawn | n/a | `herdr agent start …` |

### Why we don't use herdr's `worktree create`

Herdr has its own worktree subsystem (`herdr worktree create` /
`[worktrees] directory`). We deliberately **don't use it** — it would
bypass:

- The `wt merge main` `[pre-merge]` gate sequence.
- `.config/wt.toml`'s Conventional-Commits + agent trailer.
- The `scripts/require-worktree.sh` hook ecosystem.

The deletion test fails for using herdr's worktree: delete it from the
recipe and the dev gets a *better* workflow — Worktrunk-managed isolation
with full Fil PR machinery.

## Gotchas

- **`HERDR_AGENT=<agent>` for VMs/sandboxes.** If a wrapper hides the real
  agent process from host `/proc`, set `HERDR_AGENT=claude` (or `opencode`
  / `pi`) on the wrapped command so herdr picks the right detection
  manifest. (See herdr docs.)
- **`tmux` inside herdr hides the agent.** If a shell framework auto-enters
  tmux inside a herdr pane, herdr sees `tmux` as the foreground process
  instead of the agent. Don't run tmux inside herdr.
- **Pane screen history is off by default — leave it off.** Pane output
  can include secrets. Native agent session restore (default-on, uses our
  integrations) is the right restore path.
- **`herdr server stop` ends ALL panes in the default session.** Use
  `herdr session stop <name>` for named sessions, or close individual
  workspaces with `herdr workspace close <id>`.
- **Detach with `ctrl+b q`, not by closing the terminal.** Closing the
  terminal keeps the server running but the visual state is lost; `ctrl+b
  q` is the canonical detach.
- **Herdr is non-mandatory.** All Fil-side commands work without herdr.
  `pnpm feat` / `pnpm ship` degrade to pure Worktrunk when herdr is absent.

## Out of scope (deferred)

- **Phase-on-pane bridge** (`fil doctor --report-to-herdr` → herdr's
  `pane.report-metadata`). Would require a Fil CLI change; filed as a
  follow-up. The herdr sidebar's existing per-Workspace rollup is the
  default "which Change needs attention?" board.
- **A herdr plugin** (e.g., `fil-herdr-dispatch`). Fil stays herdr-agnostic
  at the package level; integration lives at the shell+docs layer only.

## Cross-references

- [`onboarding.md`](./onboarding.md) — 60-second orientation, herdr in slot 3
  of "5 commands that matter."
- [`feature-loop.md`](./feature-loop.md) — the canonical Change loop;
  `pnpm feat` / `pnpm ship` bookend each loop.
- [`developer-experience.md`](./developer-experience.md) — R20–R23
  recommendations that produced this doc.
- Herdr upstream: https://herdr.dev/docs/agents/