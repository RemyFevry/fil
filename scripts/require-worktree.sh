#!/usr/bin/env bash
# Fil worktree guard — the single source of truth for worktree enforcement.
#
# Mutating agent work must happen inside a *linked* git worktree (the kind
# `wt switch -c <branch>` creates), never in the primary "trunk" checkout, so
# parallel agents never step on the main tree. Read-only tools are never gated;
# only mutating tools (edit/write/bash) invoke this script.
#
# Detection: a linked worktree has a `.git` *file* at its root (a pointer into
# the common dir); the primary worktree has a `.git` *directory*. That single
# distinction is the gate — it needs no default-branch lookup and is identical
# across Claude Code, Pi, and OpenCode.
#
# Optional first argument: the bash command the caller is about to run.
# Bootstrap "wt switch …" and other read-only `wt` subcommands don't mutate
# the primary worktree (they create/inspect linked worktrees), so they are
# allowed even from the primary checkout. `wt merge` and `wt remove` are NOT
# whitelisted: from the primary they'd hit `main` directly.
#
# Exit 0  → work may proceed.
# Exit 2  → blocked (primary worktree). stderr is shown to the agent.
#
# Escape hatches:
#   FIL_ALLOW_MAIN_WORKTREE=1  — trunk maintenance / bootstrapping
#   command in $1 starts with `wt switch` / `wt list` / `wt config` /
#     `wt step` / `wt diff` / `wt log` / `wt path` / `wt which` — bootstrap
set -u

if [[ "${FIL_ALLOW_MAIN_WORKTREE:-0}" == "1" ]]; then
  exit 0
fi

# Bootstrap escape hatch: whitelist `wt` subcommands that never mutate the
# primary worktree. The match is **strict** — the command must consist of
# `wt <verb>` followed by arguments drawn from a safe alphabet (letters,
# digits, dash, underscore, dot, slash, equals, plus, at, colon). Anything
# containing shell metacharacters (`;`, `&&`, `|`, backticks, `$()`, `>`, `<`,
# …) is denied, so a compound command like `wt switch foo; rm -rf /` is not
# smuggled through the whitelist.
cmd="${1:-}"
if [[ "$cmd" =~ ^wt\ (switch|list|path|which|config|diff|log|step)(\ [a-zA-Z0-9._=/@:+\-]+){0,16}$ ]]; then
  exit 0
fi

# Not a git repo → nothing for Fil to protect; allow.
top_level="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0

# Linked worktree → `.git` is a file → allowed.
if [[ -f "$top_level/.git" ]]; then
  exit 0
fi

# Primary worktree → `.git` is a directory → blocked.
cat >&2 <<EOF
fil: blocked — you are in the primary worktree ($top_level).

You ran:
    ${cmd:-<no command supplied to the guard>}

Work inside a Worktrunk worktree instead:

    wt switch -c <branch>                 # bootstrap out (the guard allows this)

…then re-launch your Agent Runtime there, e.g.:

    wt switch -x claude   -c <branch>
    wt switch -x opencode -c <branch>
    wt switch -x pi       -c <branch>

Trunk maintenance? override with FIL_ALLOW_MAIN_WORKTREE=1.
EOF
exit 2
