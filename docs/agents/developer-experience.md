# Developer & Agent Experience — Recommendations

> State-of-the-art review of the current setup, what's working, what's missing,
> and concrete recommendations for both human contributors and the AI agents
> that work on Fil alongside them. **Optimize for the human + AI pair, not for
> either alone** — that's where vibe-coding leverage lives.

**Status:** Recommendations, not a spec. Each item is sized (P0/P1/P2) and has
a one-paragraph "what / why / how". Implementation PRs should follow.

---

## TL;DR

The repo is in great shape for a young project: the [worktree guard](#state-of-the-art-agentic-setup-applied-to-fil) and the [sidecar governance model](OVERVIEW.md) are
the right foundations for agentic work. The biggest leverage points right now
are around **bootstrap speed** (escape hatches and one-time setup), **agent
onboarding** (a discoverable skill manifest), and **CI as the agent's
ground-truth for "is the change good?"** (run the same gates the human
trusts, locally, before pushing). The rest is polish.

Five things to do first (in this order):

1. **Bootstrap escape hatch** — `wt switch` and `wt list` should work in the
   primary worktree (P0). *Implemented in this PR; see also
   [`onboarding.md`](onboarding.md).*
2. **Agent onboarding doc** — a single file an agent can read in 60 seconds
   and know exactly what skills, gates, and gotchas apply (P0).
3. **Per-session skill manifest** — let `fil status` (or a dedicated
   `fil doctor`) emit the runtime's loaded skills + their version, so an
   AFK agent doesn't guess (P1).
4. **`pre-merge` runs the same gates as `ci`** — already true via Worktrunk
   `[pre-merge]`; tighten the doc so both humans and agents know it (P1).
5. **First-touch bootstrap script** — `scripts/bootstrap.sh` that installs
   `gh auth`-as-`remyf-agent`, configures `wt shell install`, and runs
   `pnpm install`. Idempotent. (P1.)

---

## What's working well

Preserve these. They are the foundation.

### The worktree-first model (P0 keep)

`scripts/require-worktree.sh` is wired into Claude Code's `PreToolUse`,
OpenCode's `tool.execute.before`, and Pi's `tool_call`. One bash script is
the single source of truth. The git-file/git-directory detection is
elegant — no default-branch lookup, identical across all three runtimes.
**Keep this**; it is what makes parallel AFK agents safe.

### Per-Phase harness config

The runtime knows its current Phase (via `.fil/run.json`), and the
Adapter translates that into per-runtime constraints (allowed tools,
instructions, skills, context). This is the *only* thing that needs to be
replicated for every new Agent Runtime, and the existing Pi/Claude
Adapters prove the pattern works.

### Issues-as-PRDs

The PRD lives as GitHub issue #21, with the MVP broken into #1–#20. The
status-sync Action (`issue-status-sync.yml`) provides a backstop for
Status drift. The triage-label vocabulary is small and canonical
(`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`,
`wontfix`). **Keep this**; the issue tracker is the single coordination
surface for humans *and* agents.

### Conventional Commits + Changesets

PR titles follow Conventional Commits; the contributor template
(`wt.toml`) appends the right footer for LLM-generated commits. Changesets
make per-package semver automatic.

### CI is the agent's ground truth

`pnpm ci` = `lint && lint:md && build && typecheck && test` on the same
matrix humans use (Ubuntu + macOS, Node 20 + 22). Workflow durations are
visible on every PR. **Keep this** — agents should run the same gates
locally (via `[pre-merge]` in Worktrunk) before pushing.

---

## State-of-the-art agentic setup, applied to Fil

### The shape of an effective agent harness (2025-2026)

The most effective AI coding tools in 2025-2026 converge on a small set of
patterns. We should adopt them deliberately:

| Pattern | What it means | Fil today | Gap |
|---|---|---|---|
| **Single AGENTS.md** | One root-of-truth file the agent reads on startup | ✅ `AGENTS.md` exists | Keep; expand with structured sections |
| **Tool manifest** | A discoverable list of available skills + commands | ⚠️ Skills live in `~/.claude/skills/`, undocumented | Add skill manifest (see `onboarding.md`) |
| **Hook-enforced workflow** | Mutating ops gated by an explicit test | ✅ `scripts/require-worktree.sh` | Bootstrap escape hatch (this PR) |
| **Sub-agents** | Spawn `explore` / `general` sub-agents for research & multi-step work | ⚠️ Sub-agents spawnable but undocumented in repo | Document in `onboarding.md` |
| **Tests as ground truth** | Same gates locally + in CI | ✅ `pnpm ci` + `[pre-merge]` in `wt.toml` | Document explicitly for agents |
| **Issue/PR as primary UI** | Status, comments, board field keep humans and agents coordinated | ✅ Project board + `issue-status-sync` | Provide `PROJECT_TOKEN` so the Action works |
| **Identity hygiene** | Git/Hub identity tracked per agent type | ✅ CLAUDE.md pins `remyf-agent` | Operationalize (see onboarding) |
| **Durable memory** | Decisions, ADRs, gotchas survive across sessions | ✅ `CONTEXT.md`, `docs/adr/` | Surface on `fil status` |
| **Compiled docs as graph** | Docs are cross-linked; the agent can navigate | ⚠️ Mostly bullet lists | Add an "agent-readable index" |
| **Vibe loop** | Edit → review → render in <10s | ⚠️ No live UI for Fil itself today | Future: `fil inspect --watch` |

### What should the *agent* see on first read?

A fresh AFK agent has ~10 minutes of context to figure out the repo. What
that agent needs, in order:

1. **Vocabulary.** *Phase, Run, Change, Gate, Receipt, Flow, Adapter,
   Agent Runtime, Harness, FlowEngine* — from `CONTEXT.md`.
2. **Surface area.** Where things live in this monorepo (the package
   table in `README.md`).
3. **Workflow.** The worktree rule, the issue lifecycle, the changeset
   rule.
4. **Available skills.** The diagnostics/triage/prototype/to-prd/to-issues
   skills they can invoke by name.
5. **Local gates.** `pnpm ci` and how to run them.
6. **Gotchas.** Bootstrap, the `PROJECT_TOKEN` no-op, the `wt switch`
   blocking we just fixed, etc.

Today, items 1-3 are covered. Items 4-6 are scattered. **Bring them into
one `docs/agents/onboarding.md`** (this PR).

---

## Recommendations

Sorted by priority. P0 = "fix the friction right now"; P1 = "do this
month"; P2 = "track and tackle when capacity allows."

### P0 — Bootstrap & escape hatches

#### R01. `wt switch` permitted from primary worktree  *(this PR)*

**What:** The worktree guard currently blocks `bash` in the primary
worktree, including the very `wt switch …` command the agent should use to
escape. Add a strict-whitelist escape hatch: `wt switch`, `wt list`,
`wt path`, `wt which`, `wt config`, `wt diff`, `wt log`, `wt step` — each
matched against a safe-alphabet regex that denies shell metacharacters.

**Why:** Without this, an agent running in the primary gets stuck and
needs the `FIL_ALLOW_MAIN_WORKTREE=1` escape hatch — which is a
trunk-maintenance hatch, not a bootstrap one. This is also what an LLM
session is most likely to do unprompted ("create a worktree first, then
work in it"), so we want it Just Work.

**How:** Edits to `scripts/require-worktree.sh` (whitelist regex),
`.opencode/plugins/worktree-guard.ts` (pass `output.args.command`),
`.pi/extensions/worktree-guard.ts` (pass `event.input.command` /
`event.input.args`), and `.claude/settings.json` + a new
`.claude/hooks/worktree-guard.mjs` wrapper that reads the stdin hook
event. The wrapper is Node so the existing repo (TS/Node) doesn't need a
new toolchain dep.

#### R02. `docs/agents/onboarding.md` *(this PR)*

**What:** One-file onboarding for any new agent or human contributor.
Branches into:
- 60-second TL;DR with the 5 commands that matter
- The vocabulary contract (Term → Meaning) excerpted from `CONTEXT.md`
- The local gates + how to run them
- The available skills (cross-referenced to home paths, since `~/.claude/skills/`
  is not committed)
- The known gotchas with their workarounds
- Identity hygiene (the `remyf-agent` expectation from CLAUDE.md)

**Why:** Today this is scattered across `AGENTS.md`, `CONTRIBUTING.md`,
`docs/agents/`, and `~/.claude/skills/`. A new agent (or human) spends too
many context tokens figuring out what's what.

**How:** Curate, don't repeat — `onboarding.md` is an *index* with the
minimum the reader must know upfront.

#### R03. Surface the worktree-state on `fil status`

**What:** When a Run is active, `fil status` already prints the Phase and
Gate. Add a one-line summary of the runtimes + their version + the loaded
skills, so the agent doesn't have to enumerate them itself.

**Why:** An AFK agent that wants to use the `prototype` skill shouldn't
have to `ls ~/.claude/skills/` and parse SKILL.md files to know the
skill exists. It should be on the diagnostic surface.

**How:** A new read-only command, `fil doctor`, that introspects the
environment: Node version, pnpm version, `wt` version, current worktree
state (`primary` vs `linked`), the active Run's `Phase`, the loaded
skills and their source path, and the guard scripts' permissions. Keep
it strict-no-side-effects so it's safe in any phase.

---

### P1 — Discoverability & efficiency

#### R04. Skill manifest per session

**What:** Emit, on `fil status` / `fil doctor`, a JSON table of skills
the *current Agent Runtime* has loaded, with version (mtime) and source
path. Keep an authoritative list at `docs/agents/skills.md` (or in
`AGENTS.md`) so humans know what's *available*, not just what's
*currently loaded*.

**Why:** A new agent invokes skills by name; if it doesn't know what
exists, it wastes tokens on reinventing the diagnostics.

**How:** `docs/agents/skills.md` enumerates the canonical skills
(diagnostics, triage, prototype, to-issues, to-prd, write-a-skill, …) with
a one-line description and a `path:` hint. `fil doctor` reads its runtime
config (Claude Code: `~/.claude/skills/`, Pi: `~/.pi/skills/`, OpenCode:
`.opencode/skills/` — plus project-local `.fil/skills/` once that exists)
and emits the table.

#### R05. `scripts/bootstrap.sh` for first-touch setup

**What:** A single idempotent script that:
- Confirms Node 20+ and pnpm 10
- Confirms `wt` (Worktrunk) is installed; if not, prints the
  `brew install worktrunk && wt config shell install` instructions
- Confirms `gh auth status` shows `remyf-agent`; if not, prints the
  `gh auth switch --user remyf-agent` instructions
- Runs `pnpm install --frozen-lockfile`
- Runs `pnpm build` once so downstream commands are instant
- Sets `git config --local include.path ../.gitconfig` if the project
  ships a repo-level gitconfig (future)

**Why:** Today the workflow is documented across `CONTRIBUTING.md` and
`AGENTS.md` but requires the reader to assemble five different
command-lines from memory. A bootstrap script encodes the recipe.

**How:** Plain bash with `set -u` and explicit failure messages. Wire
into `package.json` as `pnpm bootstrap` so pnpm-native users find it.

#### R06. Local `pre-merge` runs `pnpm ci` end-to-end

**What:** Today `[pre-merge]` in `.config/wt.toml` runs `typecheck`,
`lint`, `test` — missing `lint:md`, `build`. Either add the missing
steps, or restructure to run `pnpm ci` (which is the canonical sequence
in `package.json`). Also: add a separate `pnpm ci:fast` that runs
`typecheck && test` only, for the inner-loop when a full Markdown lint
adds minutes.

**Why:** AI agents will reach for `[pre-merge]` to "make sure I'm green"
— that's their ground truth before `gh pr create`. The current
`[pre-merge]` ≠ `pnpm ci` mismatch is a footgun.

**How:** `pnpm ci` is already wired (`lint:md` → `lint` → `build` →
`typecheck` → `test`). Make `[pre-merge]` invoke `pnpm ci` (or
`pnpm ci:fast` for a lean version) so there's one source of truth.

#### R07. Surface Coderabbit + Sonar findings to agents

**What:** Two pieces of automated feedback are already in the loop —
Coderabbit (every PR) and SonarCloud (push to main + PRs). Wire them into
the agent's feedback channels:

- Add a `docs/agents/feedback.md` explaining how to read a Coderabbit
  review summary (diff-aware walkthrough) and how to interpret common
  Sonar findings (cognitive complexity, `no-unused-vars`,
  `no-explicit-any`, `prefer-nullish-coalescing`).
- Wire a tiny `fil doctor` section that lists open review comments on
  the current branch.

**Why:** Recent PRs (#37, #46, #50, #52) all went through 1-2 rounds of
CodeRabbit nitpick before merge. Documenting the *patterns* makes the
agent write code that survives the first review.

#### R08. `PROJECT_TOKEN` provisioning runbook

**What:** A runbook for provisioning the `PROJECT_TOKEN` fine-grained PAT
that activates the `issue-status-sync` Action. Today the workflow
deliberately no-ops without it — leaving the manual Status updates from
`docs/agents/issue-workflow.md` as the only path. That works at one-agent
scale; it does not scale.

**Why:** The transition from "one human + one AFK agent" to "one human +
many AFK agents" hinges on the board's Status staying accurate without
hand-curation.

**How:** A short runbook in `docs/agents/ISSUE_TOKEN.md` with the exact
PAT scopes (`project: read+write` on "Fil MVP", `repo: read` on `fil`)
and the step to set it as a repo secret. Idempotent — if the secret
exists, the Action picks it up; the runbook only needs to be run once.

---

### P1 — Workflow ergonomics

#### R09. `fil status --watch` (long-running snapshot)

**What:** A short-poll `fil status` that re-renders every N seconds
(useful in vibe-coding loops where the human + agent want to see
Phase/Gate state change live). Optional: an OSC-8 / terminal
hyperlink-based command palette.

**Why:** The whole reason Fil is a sidecar is to give the human *and*
agent a shared, machine-enforced surface. A watching `status` turns it
from snapshot to live.

**How:** Reuse `fil status` rendering; add a `--watch[=N]` flag (default
2s) that re-runs until Ctrl-C. Bound to a key in the opencode command
palette.

#### R10. PR-template embedded in the agent workflow

**What:** Today PRs use the standard GitHub template (markdown checklist).
Replace it with a small **structured** template that an agent can fill
deterministically. Sections:

- **Change** (one line)
- **Issue** (`Closes #N`)
- **Test plan** (paste from `pnpm test` output)
- **Schema / contract** (if `.fil/run.json` changed, paste a before/after
  diff)
- **Risks** (a single sentence, "no risk" if so)
- **Agent trailer** (`Generated-by: <runtime>`)

**Why:** A structured template survives agent variability; a free-form
markdown body doesn't. Reviewers and the status-sync Action benefit too.

**How:** Add `.github/pull_request_template.md` with the sections + a
script-generated checklist.

#### R11. CI failure cookbook

**What:** A `docs/ci/CI.md` (or fold into `CONTRIBUTING.md`) covering the
common failure patterns and how to reproduce them locally:
- SonarCloud cognitive complexity hotspot — usually a nested loop or
  a `switch (type)`; refactor
- Lint `no-explicit-any` — add a Zod schema or a precise type
- Typecheck failure across packages — usually a `composite: true`
  staleness; `pnpm build:clean`
- Blacksmith cache miss wall-clock — first run of a new dep; expected
- macOS matrix hang — Node 20 + ESM interop edge case; check
  `tsconfig.base.json`
- Changeset missing — `pnpm changeset`

**Why:** The first 30 minutes of "why is CI red?" are the most wasted
in any agent workflow. Encode the cookbook once.

#### R12. ADR template + machine-readable index

**What:** `docs/adr/README.md` already exists implicitly; promote it to
a loader-friendly `docs/adr/INDEX.md` with the ADR filename → one-line
topic, so the agent can `select` the relevant ADR without reading every
file. Add a `template.md` so new ADRs are uniform.

**Why:** Today ADRs #1, #2, #3 are read frequently by name; the
`docs/agents/domain.md` policy says "read ADRs that touch the area." An
agent shouldn't read all ADRs to find which ones to read.

**How:** A short index file with a `| # | File | Topic |` table,
generated or hand-maintained.

---

### P1 — Agent identity & permissions

#### R13. Document and gate `FIL_ALLOW_MAIN_WORKTREE`

**What:** The hatch is intentional but currently invisible (the script
checks `FIL_ALLOW_MAIN_WORKTREE=1`, but `AGENTS.md` only mentions it in
passing). Add a `docs/agents/PERMISSIONS.md` listing the hatches:
- `FIL_ALLOW_MAIN_WORKTREE=1` — **always** require an explicit human
  pre-approval (a one-line `AGENTS.md` policy: "agents must not set this
  on their own")
- The `wt` whitelist — bootstrap only

**Why:** The single biggest security-relevant piece of agent setup.

#### R14. Git identity belt-and-braces

**What:** Today, CLAUDE.md tells the agent to switch identity before any
git op. Belt-and-braces: add a `scripts/precommit.sh` (or a Worktrunk
`[pre-commit]` hook) that refuses the commit if the author identity
isn't `remyf-agent`. Print the instructions if it is wrong.

**Why:** A long session that forgets to switch identity will commit as
`larky971` (or whoever), then a human reviewer has to re-author the
history.

---

### P2 — Polish and forward-looking

#### R15. DevContainer

**What:** A `.devcontainer/devcontainer.json` + `Dockerfile` that
provisions Node 20+22, pnpm 10, worktrunk, gh, and a non-root user
matching the host's UID. Includes `postCreateCommand: scripts/bootstrap.sh`.

**Why:** Today, "works on my machine" is real (macOS vs Linux Node
diverges around `fs.cpSync` recursive on macOS 13.x). DevContainer pins
the agent + human environment.

#### R16. Containerized per-Phase execution

**What:** ADR-0001 already lists "Tier 2 sandbox/container" as a future
restriction strategy. Track as `enhancement` and prioritize behind the
control-surface (PR #41) + the harness-config stabilization.

**Why:** Right now Tier-0 (advisory) + Tier-1 (hooks) is the strongest
guarantee. Tier-2 unlocks running Phases on agent-rented CPUs in a
trusted sandbox — that's the "agents farm out work to sub-agents
asynchronously" primitive.

#### R17. Telemetry for agent ops

**What:** An opt-in instrumentation that records, per Run:
- Phase durations (Gate pass/fail times)
- Which Adapter each Phase ran in
- Number of tool calls per Phase
- Compaction events

**Why:** Today observability is the Receipt trail. Once multiple Phases
per Run become common, "is Phase X slow because of the model or the
adapter?" needs data.

#### R18. Skill authoring docs

**What:** A `docs/agents/skills.md` companion: how to author a Skill
(this repo uses Claude's SKILL.md convention via `~/.claude/skills/`,
e.g. the bundled `diagnose` skill).

**Why:** Today the bundled skills are great but undocumented inside
this repo. Future Fil skills (e.g. `fil-flow-author`,
`fil-ci-diagnose`) will need a known authoring recipe.

---

## Open questions

These need a small design pass before implementation, and are explicitly
out of scope for this PR.

- **Should `FIL_ALLOW_MAIN_WORKTREE` itself be auto-revoked per-session?**
  Today it's process-global. An agent could set it itself. A short-lived
  scoped version (`FIL_ALLOW_TRUNK_FOR=300` expires in 5 minutes) would
  close the gap.
- **Should the worktree guard whitelist include `git` for stash / commit?**
  Some agents `git stash` before `wt switch`. Today stash is blocked
  from primary. The threat model is small (stash doesn't mutate other
  branches), but the policy needs an explicit answer.
- **Per-runtime differences.** Claude Code's `PreToolUse` hook reads
  stdin JSON; OpenCode's `tool.execute.before` reads `output.args`;
  Pi's `tool_call` reads `event.input`. All three go to the same script —
  but the *shape* of the command extraction differs. Document which
  shape is canonical (it should be the bash command as a single string,
  shell-evaluated form) and refactor any divergence.
- **CI as the only "real" test surface.** Right now, vitest unit tests
  drive the Fil code. As Flows ship, do we want a `fil run-e2e`
  command that runs a synthetic Flow + asserts Receipts? Bigger
  question; ADR-0002 / ADR-0004 are nearby.

---

## How to use this document

- **Humans** — read the relevant P0/P1 before opening a PR that touches
  the harness, the guard, or the worktree workflow.
- **Agents** — read the [onboarding doc](onboarding.md) first, then
  return here when you need context on *why* a recommendation was made.
- **Reviewers** — when a PR claims to implement a recommendation, the
  PR description should link the relevant `R##` so traceability is
  automatic.
