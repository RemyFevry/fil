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
# Exit 0  → work may proceed.
# Exit 2  → blocked (primary worktree). stderr is shown to the agent.
#
# Escape hatch (trunk maintenance / bootstrapping): FIL_ALLOW_MAIN_WORKTREE=1
set -u

if [[ "${FIL_ALLOW_MAIN_WORKTREE:-0}" == "1" ]]; then
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

Do agent work inside a Worktrunk worktree instead:

    wt switch -c <branch>                   # create + enter a linked worktree
    wt switch -x claude   -c <branch>       # ...and launch Claude Code there
    wt switch -x opencode -c <branch>       # ...and launch OpenCode there
    wt switch -x pi       -c <branch>       # ...and launch Pi there

Trunk maintenance? override with FIL_ALLOW_MAIN_WORKTREE=1.
EOF
exit 2
