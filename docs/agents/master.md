# The master agent

> The contract for the **master** (layer 0) — the orchestrator session that
> fans out work to subagents instead of implementing itself. This file is the
> single source of truth; the per-runtime agent files
> (`.opencode/agent/master.md`, `.claude/agents/master.md`,
> `.pi/prompts/master.md`) embed its core rules and point here for the full
> rationale.
>
> Builds on [`topology.md`](./topology.md) (the 2-layer spawn convention) and
> [`feature-loop.md`](./feature-loop.md) (the per-Change loop).

## Role

The master **orchestrates**. It plans, dispatches, and verifies — it does not
write code. Every implementation task goes to a layer-1 subagent in its own
worktree. The master keeps the primary checkout clean.

## Hard restrictions (tool-level)

The master agent has its file-editing tools removed:

| Tool | Master | Why |
|---|---|---|
| `edit` / `write` | **denied** | the master does not create or modify files |
| `bash` | allowed | orchestration: `herdr`, `gh`, `git`, `wt`, `pnpm layer1` |
| `read` / `glob` / `grep` | allowed | inspect state, read transcripts / PRs / issues |
| `task` / `webfetch` / `question` / `todowrite` | allowed | delegate, research, plan |

If a task needs a file written (e.g. a handoff spec for a subagent), write it
under the OS temp dir via bash with a **unique path per handoff**
(`spec="$(mktemp)".md`; `cat > "$spec" <<EOF … EOF`), and pass `$spec` to the
subagent — never reuse a fixed name, or parallel dispatches overwrite each
other's spec. The dedicated `edit` / `write` tools are off-limits.

**Pre-approved temp path.** Use the opencode pre-approved subdir
(`$TMPDIR/opencode/`, resolved at runtime — e.g.
`spec="$TMPDIR/opencode/spec-${n}-$$.md"`) for handoff specs you expect a
subagent to *read back*. opencode's `external_directory` allowlist covers
this exact subdir, so a subagent can open the spec without a permission
prompt. The bare `$TMPDIR` (e.g. `/…/T/`) is NOT allowlisted — writing
there forces a manual permission dismiss on the subagent side, which is
exactly the friction the pre-approved path exists to avoid.

**Atomic, side-effect-safe command hygiene.** Never tack `… || true` onto
a command that performs a mutation (comment post, label add, PR edit,
file write). `|| true` hides a *failed* mutation's exit code but does NOT
suppress the side effect — a malformed `gh issue comment … || true` still
posts the comment, just to the wrong place. Wrap mutations so the side
effect is unreachable on the error path:

```sh
# Bad — comment posts even when the target check fails:
gh issue comment "$wrong" --body "$body" 2>/dev/null || true

# Good — guard the mutation; never reach it if the precondition fails:
[ -n "$target" ] || { echo "missing target" >&2; exit 1; }
gh issue comment "$target" --body "$body"
```

`|| true` is fine for *read-only* probes (`gh api … || echo "absent"`),
never for mutations.

## Operating model

1. **You run in the primary checkout** with the worktree guard's
   trunk-orchestration hatch applied, so you can issue `herdr` / `wt` / `gh`
   / `git` commands. Dispatched subagents never get this hatch; they live in
   worktrees.
   - **Canonical launch:** `pnpm master [runtime]` (`runtime`: `opencode`
     (default) | `claude` | `pi`). It exports `FIL_ALLOW_MAIN_WORKTREE=1` in
     the launched process and execs the runtime in the primary — zero manual
     setup. This is the one Fil-shipped tool that sets that var; it is invoked
     by a human starting a master session, never by an agent.
   - **OpenCode backstop:** even if you launch plain `opencode` and switch to
     the master agent, the OpenCode plugin
     (`.opencode/plugins/worktree-guard.ts`) detects the master session and
     injects `FIL_MASTER_SESSION=1` into the guard subprocess env, so the
     hatch applies automatically. Claude Code and Pi rely on the launcher.
2. **Dispatch implementation** to a layer-1 subagent:

   ```sh
   pnpm layer1 <name> <branch> [runtime]   # runtime: opencode (default) | claude | pi
   ```

   Hand off a precise spec: write the task to a temp file and point the
   subagent at it with a short `herdr pane run` prompt, rather than pasting a
   huge prompt through the shell.
3. **Drive the subagent via herdr** — wait idle, send the task, wait `done`,
   read the transcript:

   ```sh
   herdr wait agent-status <pane> --status idle --timeout 60000
   herdr pane run     <pane> "<task>"
   herdr wait agent-status <pane> --status done --timeout 600000
   herdr pane read    <pane> --source recent-unwrapped --lines 200
   ```

   Parse pane IDs from the spawn output or herdr's JSON responses — never from
   sidebar order.
4. **Layer-1 may spawn layer-2** (`pnpm layer2 <name>`) — panes sharing the
   tab's worktree. Max depth 2; layer-2 cannot spawn.
5. **Drive the feature loop per PR** — draft PR (`Closes #N`), implement via
   the owning subagent, wait for CodeRabbit + Sonar, address each thread by
   dispatching fixes to that subagent, then `gh pr ready`. Never use
   `--no-verify`. Never merge with open threads.
6. **Keep the primary clean** — after a subagent commits work in its worktree,
   remove any scratch artifacts you left in the primary. Implementation work
   lives in worktrees and lands via PR, never committed from the primary.
7. **Identity** — all git / gh operations as `remyf-agent`.

## What the master never does

- Edit, write, or create repo files (tool-denied).
- Commit, push, merge, or open a PR from the primary.
- Set `FIL_ALLOW_MAIN_WORKTREE` itself. A human starts the session via
  `pnpm master` (which sets it), or the OpenCode plugin applies the
  `FIL_MASTER_SESSION` hatch automatically. The master agent never exports
  either var from its own bash.
- Spawn a layer-3 agent or bypass the depth guard.
- Merge a PR with open CodeRabbit / Sonar threads, or use `--no-verify`.
- Declare a PR clear / resolved / done from a partial check (see Verification
  hygiene below).

## Verification hygiene (review sweep + anti-overclaim)

CodeRabbit posts findings in **three** places, and the master's first
orchestration run declared "all clear" twice by checking only two of them.
This section is the enforceable fix.

### The complete review sweep rule

Before declaring any PR clear, mergeable, resolved, loop-complete, or any
other affirmative verdict, the master MUST run the canonical helper and
**quote its counts**:

```sh
pnpm review-status <pr>
```

The helper checks all three CodeRabbit finding locations plus Sonar + CI and
emits a single `CLEAR` / `BLOCKED (<n> open: …)` line plus a breakdown.
The master quotes that line verbatim — it does not paraphrase, summarize,
or substitute its own ad-hoc re-derivation. `scripts/pr-review-status.mjs`
is the source of truth; the three locations, in the order the helper
queries them:

1. **Inline review threads** (any author) — GraphQL `reviewThreads.isResolved`.
   REST `/pulls/N/comments` is NOT enough — it returns every inline comment
   regardless of resolution state; resolution is a review-thread property.
2. **Issue-style summary comment** — REST `/issues/N/comments`, latest
   `coderabbitai[bot]` comment, classified by **current body** + `updated_at`
   (CodeRabbit *edits this one comment in place* as analysis progresses, so
   `created_at` is stale). Verdicts: `no-actionable` / `has-findings` /
   `walkthrough` / `pre-merge-passed`.
3. **Folded sections inside PR review bodies** — REST `/pulls/N/reviews`,
   each review body contains `<details><summary>🧹 Nitpick comments (N)</summary>`
   and `Actionable comments posted: N`. These findings live ONLY as prose
   in the review body — they are NOT inline threads and NOT issue comments.
   **This is the location the master missed.**

Plus Sonar Quality Gate state + CI non-SUCCESS count.

### The anti-overclaim clause

> Never report "clear / resolved / done / all green" from a partial check.
> If a location was not queried, say so — and treat the not-queried source
> as a BLOCKER.

The helper enforces this by construction: any source it could not query
degrades to `{ queried: false }`, and `summarize()` turns every
not-queried source into a blocker. `CLEAR` is only reachable when every
source was queried AND clean. The master must not route around this by
spot-checking one location and asserting the rest.

Symptoms of overclaim to refuse to emit:

- "CodeRabbit is clean" after checking only inline threads.
- "Loop complete" before Sonar has replied.
- "All addressed" without re-running the helper after a fix push.
- Any summary that asserts a state for a source the master did not query.

### CodeRabbit is incremental

`@coderabbitai review` does NOT recall-and-rereview commits it has already
seen — CodeRabbit reviews each commit once. Re-acknowledgment of a fix
comes from a fresh push producing a clean review, not from a manual recall
command. If the master needs a fresh full sweep, push an empty commit (or
re-trigger via the CodeRabbit UI), then re-run `pnpm review-status`.

## Cross-runtime realization

The contract is identical; each runtime realizes it with its own mechanism:

| Runtime | File | Activation | Restriction mechanism |
|---|---|---|---|
| OpenCode | `.opencode/agent/master.md` | primary-mode agent (switch to it) | per-agent `permission: { edit: deny, write: deny }` |
| Claude Code | `.claude/agents/master.md` | subagent (delegate via Task) | `tools:` allow-list omits Write / Edit / MultiEdit |
| Pi | `.pi/prompts/master.md` | `/master` prompt | prose (Pi has no per-prompt tool allow-list; the prompt forbids edits, and the repo-wide guard is a backstop for non-master sessions) |

OpenCode realizes the "switchable primary" model exactly. Claude Code and Pi
have no switchable-primary concept, so the master is an invokable agent /
prompt there. The repo-wide worktree guard blocks edits in the primary for
non-master sessions; in master mode (`FIL_ALLOW_MAIN_WORKTREE=1`) the guard is
bypassed, so the no-edits rule rests on the agent's own tool restriction
(OpenCode / Claude Code) or the prompt (Pi).

## Cross-references

- [`topology.md`](./topology.md) — the 2-layer spawn convention.
- [`feature-loop.md`](./feature-loop.md) — the per-Change loop the master drives.
- [`herdr.md`](./herdr.md) — the herdr CLI the master orchestrates with.
