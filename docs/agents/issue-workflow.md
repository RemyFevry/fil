# Issue Workflow

How any agent (Claude Code, Pi, other) or human keeps issues current while working them. The rule: **every transition in execution state is reflected on the board's `Status` field and in a comment — at the moment it happens.**

## Two axes, don't confuse them

| Axis | Where | What it tracks | Values |
| --- | --- | --- | --- |
| **Triage state** | GitHub **labels** | *Readiness* — is this grabbable? | `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix` |
| **Execution state** | Board **`Status`** field | *Execution* — what's happening right now? | `Todo`, `In Progress`, `In Review`, `Blocked`, `Done` |

An issue waits in the triage queue with a triage label (e.g. `ready-for-agent`). The instant someone starts it, **execution state takes over**: move it to `In Progress`. From then on the board `Status` is the source of truth for where the work stands. Do **not** invent status labels — the board is the single source of truth.

## The lifecycle

```
Todo ──start──▶ In Progress ──PR opened/ready──▶ In Review ──merge──▶ Done
  ▲                  │                                       │
  │                  └──▶ Blocked ──unblock──▶ In Progress   │
  └──────────────── reopen ─────────────────────────────────┘
```

- **Todo** — not started (default when added to the board).
- **In Progress** — actively being worked on right now.
- **In Review** — a pull request is open, awaiting review/merge.
- **Blocked** — stalled, waiting on something (a decision, an answer, another issue).
- **Done** — completed (the issue is closed).

## Checklists (do these at every transition)

### When you start an issue
1. Assign it to yourself: `gh issue edit <n> --add-assignee @me`
2. Set `Status = In Progress` (command below).
3. Post a **start comment**: the plan in 1–3 lines, and paste the issue's acceptance-criteria as a checklist so you can tick them as you go.

### As you make progress
- Tick acceptance-criteria boxes as each is met (`- [x]`).
- Post a short progress comment at meaningful milestones (a sub-task done, a decision made). Don't spam — one comment per real milestone.

### When you're blocked
- Set `Status = Blocked`.
- Comment **what** you need and **who/what** it's waiting on (an answer, a review, another issue to land). Link the blocker if there is one.

### When you unblock
- Set `Status = In Progress` and continue.

### When you open / update a pull request
- Put `Closes #<n>` (or `Fixes`/`Resolves`) in the PR body for every issue the PR completes. The status-sync Action moves those issues to **In Review**, and to **Done** on merge (which also closes them).
- Keep `Status` honest: draft WIP PR = `In Progress`; PR ready for review = `In Review`.

### When the work is done
- The PR merges → the issue auto-closes → the Action sets `Status = Done`.
- If there's no PR (e.g. a docs-only change), close the issue manually and set `Status = Done`.

## Exact commands

The board is the **Fil MVP** user project. Bake these IDs into your commands:

- Owner: `RemyFevry`
- Project number: `1` · Project ID: `PVT_kwHOAb5v1M4BcK-O`
- `Status` field ID: `PVTSSF_lAHOAb5v1M4BcK-OzhW1tTg`
- Status option IDs: `Todo=f75ad846` · `In Progress=47fc9ee4` · `In Review=819b9dfd` · `Blocked=b50e3062` · `Done=98236657`

> `gh project item-edit` requires the option's **hex ID** as `--single-select-option-id` — the human-readable name (e.g. `In Progress`) is rejected. Use the IDs above.

**Resolve an issue's board item ID** (the project item, not the issue number):

```bash
ITEM_ID=$(gh project item-list 1 --owner RemyFevry --format json \
  -q '.items[] | select(.content.number==<n>) | .id')
```

**Set Status** (example: In Progress → `47fc9ee4`):

```bash
gh project item-edit \
  --id "$ITEM_ID" \
  --field-id PVTSSF_lAHOAb5v1M4BcK-OzhW1tTg \
  --project-id PVT_kwHOAb5v1M4BcK-O \
  --single-select-option-id 47fc9ee4
```

**Assign + comment on start:**

```bash
gh issue edit <n> --add-assignee @me
gh issue comment <n> --body "Starting: <plan>; acceptance criteria tracked in the description."
```

## The status-sync Action (backstop)

`.github/workflows/issue-status-sync.yml` keeps Status from drifting even when an agent forgets:

- PR `opened` (references `Closes/Fixes/Resolves #n`) → issue(s) **In Progress**
- PR `ready_for_review` → **In Review**
- PR `closed` + merged → **Done** (the issue is auto-closed by GitHub)
- PR `closed` + not merged → **In Progress**
- Issue `closed` → **Done**; issue `reopened` → **Todo**

It authenticates with the **`PROJECT_TOKEN`** secret (a fine-grained PAT with project read/write on `Fil MVP` and repo read on `fil`). Until that secret exists the Action is a no-op — but the convention above works regardless, so agents should follow it by hand in the meantime.

## Why this matters

Issues that lie (Status says "In Progress" but nobody's touched them in a week) break coordination between humans and AFK agents. Keeping Status and comments current is the contract that makes "grab any `ready-for-agent` issue and go" safe.

## How this fits the per-Change loop

The board transitions above are only the **status** axis of the per-Change workflow. The end-to-end loop — picking the issue, planning, opening the PR, implementing, waiting for CodeRabbit + Sonar, addressing feedback, merging — is documented in [`feature-loop.md`](./feature-loop.md). Skim that doc once; this one is the reference for board-state mechanics only.
