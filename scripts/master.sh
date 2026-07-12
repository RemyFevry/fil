#!/usr/bin/env bash
# scripts/master.sh — canonical launcher for the Fil master (layer 0) session.
#
# The master orchestrator runs in the PRIMARY checkout so it can drive
# `herdr` / `wt` / `gh` / `git`. The worktree guard
# (scripts/require-worktree.sh) blocks every mutating bash in the primary
# unless FIL_ALLOW_MAIN_WORKTREE=1 is set. Historically NOTHING injected that
# var, so the master was dead on arrival until a human hand-exported it (see
# issue #101). This launcher is the one canonical place that sets it.
#
# Subagents are NEVER launched this way — they live in Worktrunk worktrees
# (`pnpm layer1` / `pnpm layer2`) and so never inherit the hatch. The env var
# is set in THIS process only; it is not written into the repo or the agent's
# own shell config.
#
# Usage:
#   pnpm master                 # launches opencode (default) in the primary
#   pnpm master opencode        #   … explicit
#   pnpm master claude          # launches claude code
#   pnpm master pi              # launches pi
#   pnpm master /path/to/rt     # launches an explicit command
#
# Dry run (used by scripts/test/worktree-guard.test.ts and for inspection —
# prints the resolved runtime and the hatch without launching anything):
#   FIL_MASTER_DRY_RUN=1 pnpm master
set -euo pipefail

RUNTIME="${1:-opencode}"

# The hatch. The ONE place a Fil-shipped tool sets FIL_ALLOW_MAIN_WORKTREE.
# A human invokes this launcher explicitly to start a master session; an agent
# never does (agents live in worktrees). The guard honors it as the escape
# hatch and lets the master's bash through.
export FIL_ALLOW_MAIN_WORKTREE=1

# Detect whether the current cwd is a linked worktree (.git is a file) vs the
# primary (.git is a directory). The master belongs in the primary; warn
# loudly (but still proceed) if launched from a worktree.
top_level="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -n "$top_level" && -f "$top_level/.git" ]]; then
  printf '\033[1;33m[master]\033[0m warning: you are inside a linked worktree (%s).\n' "$top_level" >&2
  printf '\033[1;33m[master]\033[0m The master orchestrator normally runs in the PRIMARY checkout.\n' >&2
  printf '\033[1;33m[master]\033[0m Proceeding anyway (FIL_ALLOW_MAIN_WORKTREE is harmless in a worktree).\n' >&2
fi

if [[ "${FIL_MASTER_DRY_RUN:-0}" == "1" ]]; then
  printf 'fil master launcher (dry run)\n'
  printf '  runtime:              %s\n' "$RUNTIME"
  printf '  cwd:                  %s\n' "${top_level:-<not a git repo>}"
  printf '  FIL_ALLOW_MAIN_WORKTREE: %s\n' "${FIL_ALLOW_MAIN_WORKTREE}"
  printf '  (would exec the runtime with the hatch above)\n'
  exit 0
fi

# Map friendly runtime names to their commands; anything else is treated as a
# literal command/path so `pnpm master /usr/local/bin/foo` works.
case "$RUNTIME" in
  opencode) cmd=(opencode);;
  claude)   cmd=(claude);;
  pi)       cmd=(pi);;
  --)       cmd=(opencode);;
  *)        cmd=("$RUNTIME");;
esac

printf '\033[1;34m[master]\033[0m launching %s in the primary with the worktree hatch set\n' "${cmd[*]}"
exec "${cmd[@]}"
