# Multi-agent topology — 2-layer master / subagent

> The convention for fanning out work from one master session to parallel
> subagents using herdr tabs/panes + Worktrunk worktrees. Read once; the two
> `pnpm layer1` / `pnpm layer2` helpers encode it.
>
> This composes [`herdr.md`](./herdr.md) (terminal orchestration) with the
> Worktrunk guard ([`scripts/require-worktree.sh`](../../scripts/require-worktree.sh)).
> Herdr is non-mandatory; this topology is a specialization for when you want
> a master + parallel subagents in one session.

## The shape

```text
Workspace  (one herdr Workspace — the whole session)
│
├─ Tab 1 — MASTER (layer 0)            orchestrator; issues layer-1 spawns
│                                        (runs with FIL_ALLOW_MAIN_WORKTREE=1)
│
├─ Tab 2 — layer-1 agent A             ← own Worktrunk worktree (branch a)
│    ├─ pane A.0  (the layer-1 agent)
│    ├─ pane A.1  (layer-2 subagent)   ← shares worktree a
│    └─ pane A.2  (layer-2 subagent)   ← shares worktree a
│
└─ Tab 3 — layer-1 agent B             ← own Worktrunk worktree (branch b)
     ├─ pane B.0  (the layer-1 agent)
     └─ pane B.1  (layer-2 subagent)   ← shares worktree b
```

## The two invariants (under this topology)

This is one, stricter way to use herdr tabs/panes than the generic recipes in
[`herdr.md`](./herdr.md) (where `herdr tab create` / `herdr agent start` may
target any cwd). Under this topology:

1. **A `pnpm layer1` spawn is tab + worktree.** A layer-1 spawn always opens
   a new herdr tab on a new Worktrunk worktree
   (`herdr tab create` + `wt switch -c`).
2. **Pane split = shared worktree.** A pane split inside a tab inherits that
   tab's cwd. So a layer-2 spawn = `herdr pane split` — never a new worktree.

## Layer rules

| Layer | Spawned by | Spawn primitive | Worktree | May spawn |
|---|---|---|---|---|
| 0 — master | (human) | — | primary checkout (orchestrator; no code edits) | tabs → layer 1 |
| 1 — subagent | master | new tab + new worktree | its own | panes → layer 2 |
| 2 — subagent | a layer-1 | pane split (shared cwd) | parent tab's | nothing (max depth) |

Max depth is **2 subagent layers**. Layer-2 agents do not spawn.

## How an agent knows its layer: `FIL_AGENT_LAYER`

Each spawn injects three env vars into the new pane so the agent can
self-identify without inspecting herdr state:

| Var | Set to |
|---|---|
| `FIL_AGENT_LAYER` | `0` (master, implicit / unset) · `1` · `2` |
| `FIL_AGENT_BRANCH` | the Worktrunk branch the worktree is on |
| `FIL_AGENT_WORKTREE` | absolute path to the worktree |

An agent that is considering spawning reads `FIL_AGENT_LAYER` to know which
helper it may call. The helpers themselves enforce the depth rule.

## The two spawn helpers

### `pnpm layer1 <name> <branch> [runtime]` — master → layer 1

Creates a Worktrunk worktree for `<branch>`, opens a new tab in the current
Workspace labeled `<name>`, cwd set to that worktree, and launches the
runtime (`opencode` by default; also `claude`, `pi`). The new tab's root pane
is tagged `FIL_AGENT_LAYER=1`.

```sh
pnpm layer1 pr-99-review pr-99-review           # opencode (default)
pnpm layer1 feat-101 feat/101 claude
```

> The master runs with `FIL_ALLOW_MAIN_WORKTREE=1` — the
> trunk-orchestration hatch — so it can issue `herdr` + `wt` commands from
> the primary checkout. Dispatched layer-1/2 agents run inside worktrees and
> never set this flag. (See [`AGENTS.md`](../../AGENTS.md) §Worktree workflow.)

### `pnpm layer2 <name> [runtime]` — layer-1 → layer 2

Splits a pane in the current tab (shared worktree — no new tab, no new
worktree), tagged `FIL_AGENT_LAYER=2`. Picks `right` vs `down` from the
current pane's geometry. Refuses to run unless `FIL_AGENT_LAYER=1`.

```sh
pnpm layer2 tests-runner                         # opencode (default)
pnpm layer2 docs-writer pi
```

Both helpers **spawn only**: they launch the runtime and return the pane id.
The caller waits for idle and sends the task — do not pass the task as an
argv prompt (per the herdr skill).

## Driving a subagent from its parent

```sh
herdr wait agent-status <pane_id> --status idle --timeout 60000   # launched → ready
herdr pane run <pane_id> "<the task>"                             # send the task
herdr wait agent-status <pane_id> --status done --timeout 600000  # block until finished
herdr pane read <pane_id> --source recent-unwrapped --lines 200   # read the transcript
herdr pane run <pane_id> "<follow-up>"                            # iterate
```

The spawn helper prints a human-readable summary that includes the `pane` id
(e.g. `pane : w6:p6`); use that id in the commands above. For raw `herdr`
commands, IDs always come from their JSON responses — never construct them
from sidebar order.

## Relationship to `pnpm feat` / `pnpm ship`

| Helper | Granularity | Use when |
|---|---|---|
| `pnpm feat` / `pnpm ship` | one **Workspace** per Change | the one-Workspace-per-Change model (see [`herdr.md`](./herdr.md)) |
| `pnpm layer1` / `pnpm layer2` | **tabs / panes** within one Workspace | one master fanning out parallel subagents on related tasks |

`feat` creates a whole new Workspace (heavyweight, one per Change). `layer1`
creates a tab inside the *current* Workspace (lightweight, many per session).
They compose: each `layer1` tab is itself a full Worktrunk worktree that
could later be merged via `wt merge main`.

## Gotchas

- **The master is the only pane that runs in the primary checkout.** Every
  subagent lives in a linked worktree where the guard allows mutation.
- **Layer-2 cannot spawn.** `pnpm layer2` checks `FIL_AGENT_LAYER=1` and
  refuses otherwise; the topology's max depth is 2.
- **Shared worktree = shared working tree.** Layer-2 panes in the same tab
  edit the same files. Use them for non-conflicting work (tests, docs,
  review) or coordinate via the parent layer-1 agent.
- **Don't run `wt switch` from a layer-2 pane.** It would move the shared
  worktree's HEAD under sibling panes. Layer-2 inherits its worktree; it does
  not switch.

## Cross-references

- [`herdr.md`](./herdr.md) — the herdr layer this builds on (non-mandatory).
- [`feature-loop.md`](./feature-loop.md) — the canonical per-Change loop;
  each `layer1` tab runs it independently.
- [`onboarding.md`](./onboarding.md) §G — Worktrunk is the only supported
  parallel-workflow; this topology is herdr + Worktrunk composed.
