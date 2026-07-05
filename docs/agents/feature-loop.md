# The Canonical Feature Loop

> Every Change (feature, fix, refactor) — human or AFK agent — goes
> through this loop.  This doc is the **end-to-end** view; it composes
> the issue lifecycle ([`issue-workflow.md`](./issue-workflow.md)), the
> onboarding contract ([`onboarding.md`](./onboarding.md)), and the
> local gate expectations ([`CONTRIBUTING.md`](../../CONTRIBUTING.md)).
> Read this once, then return to the per-area docs only when you need
> specifics.

## Why this doc exists

The Fil repo gets contributions from two kinds of contributors —
**humans** in interactive sessions and **AFK agents** dispatched onto
issues. They share one trunk and one GitHub Project board, so they
share one workflow. Without an explicit loop, agents improvise: open a
PR after the work is done, merge before Sonar / Coderabbit reply, post
Status updates from memory. The hand-improvised loop loses state
between the agent and the reviewer and breaks `grab any ready-for-agent
issue and go`.

This doc pins the loop down. Six steps, one diagram, every transition
mapped to a board / PR / commit / comment event. Both humans and agents
follow it verbatim.

## The loop

```text
                ┌───────────────────┐
                │ 1. PLAN           │  issue comment + board: Todo→In Progress
                │ (read issue, ADR) │
                └────────┬──────────┘
                         ▼
                ┌───────────────────┐
                │ 2. PR (draft)     │  gh pr create --draft
                │ Closes #N in body │  board: In Progress (draft)
                └────────┬──────────┘
                         ▼
                ┌───────────────────┐
                │ 3. IMPLEMENT      │  small commits, push to PR
                │ pnpm ci locally   │  Status comments per milestone
                └────────┬──────────┘
                         ▼
                ┌───────────────────┐
                │ 4. WAIT           │  CodeRabbit + Sonar run on push
                │ (their tempo)     │  don't merge yet
                └────────┬──────────┘
                         ▼
                ┌───────────────────┐
                │ 5. ADDRESS        │  reply on each thread; commit + push
                │ feedback          │  out-of-scope → new issue, link it
                └────────┬──────────┘
                         │
                  ┌──────┴──────┐
                  │  still has  │
                  │  findings?  │
                  └──────┬──────┘
                    yes ─┴─ no
                    │       │
                    ▼       ▼
                 loop    ┌─────────────────┐
                  back   │ 6. READY + MERGE│ gh pr ready → review → merge
                         │ board: Done     │ Issue auto-closes
                         └─────────────────┘
```

## Step-by-step

> **Conventions.** PR templates live at `.github/pull_request_template.md`
> (see R10). Board IDs and Status option IDs are at the bottom of
> [`issue-workflow.md`](./issue-workflow.md). Worktree workflow lives
> at [`CONTRIBUTING.md`](../../CONTRIBUTING.md) and at the bottom of
> this file.

### 1. PLAN

- Read the issue body and the **acceptance criteria** the reporter
  posted (they should be checkboxes you can tick through).
- Read every ADR that touches the surface you're about to change
  ([`docs/adr/`](../adr/)). If your plan contradicts an ADR,
  surface it on the issue **before** opening the PR — see
  [`domain.md`](./domain.md)'s "Flag ADR conflicts" rule.
- Work in a Worktrunk worktree, never the primary checkout
  ([scripts/require-worktree.sh](../../scripts/require-worktree.sh)
  is wired into every runtime — the WT-whitelist PR fixed the only
  bootstrap escape path that used to be blocked).
- Post a **start comment** on the issue:

  ```text
  Starting: <one-sentence plan>.
  Acceptance criteria tracked in the issue description; will tick as I go.
  ```
- Move board Status → **In Progress** (`47fc9ee4`).

### 2. PR (draft)

- **Open the PR before implementing.** A draft PR with the plan in the
  body, marked `draft`, with `Closes #N` in the body, is the canonical
  state. The board Status → **In Review** transition happens when the
  PR is marked ready, but the moment the PR exists, the work is
  visible to humans and other agents; that is what you want.
- Body template (see R10 for the full structured version):

  ```markdown
  ## What
  <one paragraph>

  ## Why
  <one paragraph>

  ## How
  <one paragraph>

  ## Test plan
  <paste from `pnpm test` + `pnpm ci`>

  Closes #N
  ```
- Push commits as small, named, logical units. Conventional Commits
  enforced by `.config/wt.toml`. **One logical change per PR** — if a
  PR fixes a bug and reformats a file, split it.

### 3. IMPLEMENT

- For each commit: run `pnpm typecheck` (fastest), then before push
  `pnpm ci` (whole-graph). Worktrunk's `[pre-merge]` in `.config/wt.toml`
  mirrors the gate subset that must be green at merge time; treat it
  as the floor, not the ceiling.
- Post **progress comments** on the issue at meaningful milestones.
  Not on every commit — once per sub-task done or decision made. Mirror
  them in the PR conversation only when the decision is PR-specific.
- Tick acceptance-criteria boxes in the issue description as each one
  is met (`- [x]`).
- **Add a changeset** for any user-facing change: `pnpm changeset`.
  This is non-negotiable for user-visible releases.

### 4. WAIT

After every `git push`, two automated reviewers run:

| Reviewer | Where it posts | What it flags |
|---|---|---|
| **CodeRabbit** | GitHub PR conversation (walkthrough + per-line threads) | Walkthrough summary, pre-merge checks, inline nitpicks, suggested fixes |
| **SonarCloud** | GitHub PR conversation | Quality Gate status, cognitive complexity, security hotspots, coverage on new code |

**Do not merge until both have replied and you have addressed the
findings.** The status-sync Action triggers off `ready_for_review`
(→ In Review) and `closed + merged` (→ Done) — both events should
fire only after both automated reviewers are clean.

The two reviewers run on their own cadence (1–3 minutes after each
push). Polling for them and merging before they reply is the
single most common "agent slapped a PR through" failure mode.

### 5. ADDRESS feedback

For every CodeRabbit thread and Sonar finding:

1. **Verify against current code.** The reviewer may be out-of-date;
   re-read the file at HEAD before fixing.
2. If still valid: **fix and push**. Commit message format:
   `fix(scope): address CodeRabbit review on #N`. Reply on the thread
   with the SHA + a one-line summary.
3. If out-of-scope (e.g. Sonar flags something from PR #N-3, not
   from your code): **reply with rationale** explaining why you're
   not fixing it *and* open a follow-up issue to track it. Don't
   silently close the thread.
4. If the reviewer is wrong (false positive): **reply with the reason**
   + diff evidence; don't fix.

After pushing your fix, both reviewers re-run. Loop until both are
clean.

### 6. READY + MERGE

- `gh pr ready` to flip the draft to "ready for review".
- Board Status moves to **In Review** automatically (the Action, or
  manually with option ID `819b9dfd`).
- Wait for human approval — or, if you're an agent and the project
  permits it, the `auto-merge` flag is enabled, and the maintainer's
  approval is your merge stamp.
- Squash merge with a Conventional Commits title. The status-sync
  Action moves board Status → **Done** on a merged PR that references
  `Closes #N`. The issue auto-closes.
- If you sent a WIP `wt merge main` to land through Worktrunk instead,
  the merge happens through `wt merge`, which runs the pre-merge
  gates as well.

## Anti-patterns

| Don't | Why | Do instead |
|---|---|---|
| Open the PR *after* implementing | Board stays at "In Progress" past actual work; reviewers can't see direction early | Open a draft PR with the plan first |
| Merge a PR with open CodeRabbit threads | Threads ignored = review broken | Reply to each, address or rationale |
| Merge before Sonar replies | Sonar findings on silent code often get lost | Wait for Sonar's quality-gate comment |
| Skip `pnpm ci` because `[pre-merge]` is "good enough" | `[pre-merge]` omits `lint:md` and `build`; surprises only at merge | Run `pnpm ci` before every push |
| Set board Status by editing the field, with no issue comment | Reviewers see the jump but not why | Comment the milestone alongside every Status change |
| Submit 800-line PRs | Reviewer fatigue → focus on noise | Stack PRs via Worktrunk or split by concern |
| Run a process globally (`FIL_ALLOW_MAIN_WORKTREE=1`) without asking | Trunk-maintenance hatch; agents must not set this on their own | Stay in a linked worktree; ask if you genuinely need it |
| "I'll fix it in CI" | Local gates *are* the CI gates; pushing broken local gates is a self-own | Run `pnpm ci` locally first |

## Time budget expectations

Empirically the loop takes:

| Step | Human | AFK agent |
|---|---|---|
| Plan | 5–30 min | 1–3 min |
| PR (draft) | 2–5 min | ≤ 1 min |
| Implement | 1 h – days | 5–60 min |
| Wait (CodeRabbit + Sonar) | 1–3 min/reviewer | 1–3 min/reviewer |
| Address feedback | 5–60 min | 2–10 min per round |
| Merge | 1–2 min | 1–2 min |

The agent's edge is **speed** in the middle (implement + address), but
the **wait** and **merge** times are the same — that's why status
honesty matters; an agent can burn through three issues in an hour but
if the board's Status is lagging the human can't tell which issue has
a fix landing.

## Quick-start checklist (paste in your agent's starting context)

```text
LOOP for issue #N:
1. wt switch -c fix/<n> -x opencode          # worktree
2. gh issue edit <n> --add-assignee @me
3. gh project item-edit ... 47fc9ee4          # Todo → In Progress
4. gh issue comment <n> --body "Starting: <plan>"
5. <implement + pnpm ci + push to a branch>
6. gh pr create --draft --base main --head fix/<n> \
     --title "fix(...): ..." --body "...\n\nCloses #N"
7. <push commits; wait for CodeRabbit + Sonar>
8. <address each thread; push; re-wait>
9. gh pr ready; wait for human approval
10. <merge or wait for it>                    # Status → Done
```

## When a step doesn't fit

The loop is canonical, not straitjacket. Acknowledged variations:

- **Pure docs change (no code):** skip the draft-PR stage and open
  the PR directly — board still moves to In Review. Issues auto-close
  on merge as usual.
- **Hotfix / break-glass:** there is no separate hotfix loop yet, but
  the project ships a `hotfix` Flow (per
  [`README.md`](../../README.md) and the build-in Flow library) for
  when Fil itself is the harness. For a fix in *this repo*, the
  standard loop is still what you use; just push faster.
- **Already-discussed plan (e.g. a maintainer commented):** skip the
  start comment, just post a one-line "Implementing per @reviewer's
  comment above". The board Status update is still required.
- **Multi-week design work:** split into multiple PRs against the
  same issue, keep Status = In Progress, and the final PR `Closes
  #N` on merge.

## Cross-references

- [`onboarding.md`](./onboarding.md) — the 60-second orientation
- [`issue-workflow.md`](./issue-workflow.md) — the board Status lifecycle
- [`issue-tracker.md`](./issue-tracker.md) — `gh` conventions
- [`triage-labels.md`](./triage-labels.md) — the triage vocabulary
- [`domain.md`](./domain.md) — how to consume ADRs and the glossary
- [`developer-experience.md`](./developer-experience.md) — the
  state-of-the-art review that produced this loop (R07 in particular)
- [`CONTRIBUTING.md`](../../CONTRIBUTING.md) — local setup, worktree
  workflow, changesets, Conventional Commits

🤖 Generated-by: opencode (MiniMax-M3) (larky971)
