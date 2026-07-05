# Agent Onboarding

> 60-second onboarding for any new AFK agent (or human contributor)
> joining Fil. Read this first; you should not need to read the other
> `docs/agents/*.md` files to start, although you'll return to them.

## 1. What Fil is

A **harness** for agentic software lifecycles. Fil owns the orchestration
spine (a state machine called a **Flow** of **Phases** connected by
**Gates**) and steers external **Agent Runtimes** (Claude Code, Pi,
OpenCode) to do the actual coding. Fil does not run models; it governs.

> **Read** [`CONTEXT.md`](../../CONTEXT.md) before doing anything else.
> This document is a quickstart, not a substitute. Naming matters: this
> repo says **Phase** (not "state"), **Run** (not "session"),
> **Change** (not "ticket"), **Flow** (not "workflow"), **Gate**
> (not "check"), **Adapter** (not "plugin").

## 2. The shape of this repo

```text
/
├── AGENTS.md                 ← this onboarding + key conventions
├── CLAUDE.md                 ← @AGENTS.md + the GitHub identity rules
├── CONTRIBUTING.md           ← human contributor guide (issues, PRs,
│                                worktree workflow, changesets)
├── CONTEXT.md                ← the glossary — read first
├── README.md                 ← the public face
├── docs/
│   ├── OVERVIEW.md           ← the design synthesis
│   ├── adr/                  ← ADR-0001, -0002, -0003 (read the relevant ones)
│   └── agents/
│       ├── domain.md         ← how domain docs should be consumed
│       ├── issue-tracker.md  ← `gh` CLI conventions
│       ├── issue-workflow.md ← Status board lifecycle
│       ├── triage-labels.md  ← the 5 canonical triage labels
│       ├── developer-experience.md ← state-of-the-art review (read later)
│       ├── onboarding.md     ← this file
│       └── feedback.md       ← how to interpret Coderabbit + Sonar (WIP)
├── packages/                 ← TS/Node pnpm monorepo (10 packages)
│   ├── cli/                  ← the `fil` bin
│   ├── contract/ engine/ evolution/ flow-loader/ gate-runner/
│   ├── store/ orchestrator/ inspect-view/ pi-adapter/
├── scripts/
│   ├── require-worktree.sh   ← THE worktree guard — never bypass
│   └── bootstrap.sh          ← (planned) first-touch setup
├── .claude/  .opencode/  .pi/  ← per-runtime config + adapter hooks
├── .config/wt.toml           ← Worktrunk config ([pre-merge], etc.)
└── .github/workflows/        ← CI, release, sonar, issue-status-sync
```

## 3. The 5 commands that matter

```sh
# 1. Bootstrap (humans, once per machine):
brew install worktrunk && wt config shell install

# 2. Identify yourself on GitHub:
gh auth switch --user remyf-agent

# 3. Create a worktree + launch your runtime in it:
wt switch -c feat/<short-name> -x opencode    # or -x claude / -x pi

# 4. Run the local gates (the same gates CI will run):
pnpm ci                                       # lint + lint:md + build + typecheck + test

# 5. Submit a PR (sister-step: keep the issue Status current):
gh pr create --title "feat: …" --body "Closes #N\n\n…" --base main
```

## 4. Workflow contract (the non-negotiables)

These are the contract every contributor — human or agent — follows.

| Rule | Why | Where enforced |
|---|---|---|
| Mutating ops happen in a Worktrunk worktree | Parallel agents can't step on trunk | `scripts/require-worktree.sh` (Claude Code `PreToolUse`, OpenCode `tool.execute.before`, Pi `tool_call`) |
| Triage: `needs-triage → ready-for-{agent,human}` | Tiny, canonical label vocabulary | `docs/agents/triage-labels.md` |
| Execution Status on the **Fil MVP** board | "In Progress / In Review / Done", not labels | `docs/agents/issue-workflow.md` (manual) + `.github/workflows/issue-status-sync.yml` (backstop, needs `PROJECT_TOKEN`) |
| Conventional Commits + agent trailer | Drives changesets / release / Sonar | `.config/wt.toml` `[commit.generation].template-append` |
| One changeset per user-facing PR | Per-package semver, no skew | `pnpm changeset` |
| `Closes #N` in the PR body | status-sync needs it | `.github/workflows/issue-status-sync.yml` |
| GitHub identity is `remyf-agent` | Repo-wide convention | `CLAUDE.md` |
| Use the glossary's vocabulary | Phase ≠ state, Run ≠ session, etc. | `CONTEXT.md` + `docs/agents/domain.md` |
| Read the relevant ADR before touching its surface | ADRs are binding | `docs/adr/000{1,2,3}-*.md` |

## 5. Local gates

`pnpm ci` is the canonical local gate. It mirrors CI exactly:

```text
lint       = pnpm lint          # ESLint
lint:md    = pnpm lint:md       # markdownlint-cli2 (README only)
build      = pnpm build         # tsc -b (whole graph)
typecheck  = pnpm typecheck     # tsc --noEmit, project-wide
test       = pnpm test          # vitest
```

`[pre-merge]` in `.config/wt.toml` runs `typecheck`, `lint`, `test` —
that is the subset Worktrunk will block a merge on. **Always run
`pnpm ci` locally before pushing** so you don't discover build/lint:md
failures in CI.

For the inner loop while iterating:

```sh
pnpm test --watch packages/orchestrator         # single package, watch
pnpm typecheck                                  # fast feedback
```

## 6. Available skills

The project uses [Anthropic's SKILL.md convention](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview)
at `~/.claude/skills/`. The skills most useful in this repo:

| Skill | When |
|---|---|
| `diagnose` | "This is broken" / "performance regression" / hard bugs |
| `triage` | Triaging an incoming issue or PR |
| `tdd` | Building a feature test-first |
| `prototype` | Throwaway spike before designing |
| `to-issues` | Splitting a plan into vertical-slice issues |
| `to-prd` | Turning the current context into a PRD |
| `write-a-skill` | Authoring a new skill |
| `grill-me` / `grill-with-docs` | Stress-test a design against the docs |
| `handoff` | Compacting context for a follow-up agent |
| `zoom-out` | "Where does this code fit in the bigger picture?" |
| `find-skills` | Discovering more skills |

The `fil`-native skills (`fil-flow-author`, `fil-doctor`,
`fil-ci-diagnose`) don't exist yet — see `developer-experience.md`
R04 / R18 for the proposal.

## 7. Gotchas — read these before you waste context

### A. You are in the *primary worktree* until you run `wt switch`

**Symptom:** *"fil: blocked — mutating tools are not allowed in the
primary worktree."*

**Fix:** just run

```sh
wt switch -c feat/<name> -x opencode
```

The guard whitelists `wt switch …` from the primary, so this is a
one-step bootstrap. (Patched in this PR.)

### B. GitHub identity

**Symptom:** your commit shows up as `larky971` and the PR can't be
opened as `RemyFevry/fil`. (Or the bot reviewer `coderabbitai` sees you
as the wrong identity.)

**Fix:**

```sh
gh auth switch --user remyf-agent
git config --global user.name  "remyf-agent"
git config --global user.email "298726913+remyf-agent@users.noreply.github.com"
```

### C. `issue-status-sync.yml` is a no-op until `PROJECT_TOKEN` exists

That Action tracks project-board Status from PR events. Until the
secret is set, *manually* keep Status current:

```bash
ITEM_ID=$(gh project item-list 1 --owner RemyFevry --format json \
  -q ".items[] | select(.content.number==<n>) | .id")
gh project item-edit --id "$ITEM_ID" \
  --field-id PVTSSF_lAHOAb5v1M4BcK-OzhW1tTg \
  --project-id PVT_kwHOAb5v1M4BcK-O \
  --single-select-option-id 47fc9ee4    # In Progress
```

Hex IDs by phase:

```text
Todo        f75ad846
In Progress 47fc9ee4
In Review   819b9dfd
Blocked     b50e3062
Done        98236657
```

(`gh project item-edit` rejects the human-readable name; use the hex.)

### D. `pnpm test:coverage` produces the Sonar lcov

SonarCloud reads `coverage/lcov.info` from `pnpm test:coverage`. If
Sonar complains "no coverage", you forgot this step locally — but
CI runs it on push-to-main via the `sonarcloud` workflow.

### E. Conventional Commits + the agent trailer

PR titles and squash messages must be Conventional Commits (`feat:`,
`fix:`, `docs:`, `refactor:`, `test:`, `chore:`, …). LLM-generated
commits append a trailer automatically via `wt.toml`:

```text
Generated-by: opencode (M3) (@remyf-agent)
```

Keep that footer.

### F. `wt` is the only supported parallel-workflow

A plain git worktree works, but Worktrunk is the contract: it sets up
the linked deps, copies the gitignored caches, and runs `[pre-merge]`
gates. Don't bypass it.

### G. Don't edit `.fil/run.json` directly

The Run projection is owned by `pnpm fil` / the orchestrator. To start
a Run, run `fil start "<change>"`. To advance, run `fil next`. The
JSON is the *output* of state, not the *input*.

### H. Phase vocabulary vs XState vocabulary

A Fil **Phase** is an XState state node carrying per-Phase harness
config (`allowedTools`, `instructions`, `skills`, `gate`). If you find
yourself writing XState `actions` or `services` in a Flow file — stop.
Those belong in `enforcement.ts` or `gate-runner.ts`, not in Flow
config. (See ADR-0002.)

## 8. The first thing to do, by role

| You're an… | Do this first |
|---|---|
| AFK agent dispatched onto an issue | Follow [`feature-loop.md`](./feature-loop.md): 1. Plan on the issue (move Status → In Progress, post the plan). 2. Open a **draft PR** with `Closes #N` BEFORE implementing. 3. Implement + `pnpm ci`. 4. Wait for CodeRabbit + Sonar replies. 5. Address every thread. 6. `gh pr ready` and merge. |
| Human reading code | 1. Skim `CONTEXT.md`. 2. Read the ADR for your area. 3. `pnpm ci` works as a baseline — if it doesn't, the env is broken. |
| Reviewer | 1. PR description has `Closes #N`. 2. `[pre-merge]` was green. 3. Coderabbit + Sonar threads are addressed, not just resolved. |

The full loop (anti-patterns, time budgets, "what if my PR isn't
like this?" variations) lives in [`feature-loop.md`](./feature-loop.md).
Read it once before your first dispatch — it's the operationally
critical doc on this repo.

## 9. When in doubt

- **Re-read the glossary.** Fil's vocabulary is precise.
- **Re-read the ADR.** ADRs are binding; flag conflicts explicitly.
- **Use `diagnose`** for "this is broken."
- **Use `zoom-out`** for "where does this code fit?"
- **Ask in the issue comments.** Fil's contribution model is
  issue-first; silence wastes everyone's time.
