#!/usr/bin/env bash
# scripts/ship.sh — close a Fil Change: merge the Worktrunk worktree via
# `wt merge main`, optionally close the matching herdr Workspace.
#
# Usage:
#   pnpm ship
#
# This is the close-side counterpart to scripts/feat.sh.
#
# Herdr is non-mandatory. The Workspace close step runs only if herdr is on
# PATH AND a matching Workspace (label == current branch) is found.
set -euo pipefail

# Always: merge the Worktrunk worktree through wt's [pre-merge] gates.
# `wt merge main` runs the typecheck/lint/test sequence defined in .config/wt.toml.
wt merge main

# Conditional: close the herdr Workspace whose label matches the just-merged
# branch. Fil owns the git/Worktrunk side; the herdr side is graceful.
if command -v herdr >/dev/null 2>&1; then
  branch="$(git branch --show-current)"
  # Skip in the unlikely case we ran `wt merge` from main itself.
  if [ "$branch" != "main" ]; then
    ws_id="$(herdr workspace list --json 2>/dev/null \
      | python3 -c 'import sys,json,os
data=json.load(sys.stdin)
target=os.environ.get("HERDR_BRANCH","")
for w in data.get("result",{}).get("workspaces",[]):
    if w.get("label")==target:
        print(w.get("workspace_id",""))
        break' HERDR_BRANCH="$branch" 2>/dev/null || true)"
    if [ -n "$ws_id" ]; then
      herdr workspace close "$ws_id"
    fi
  fi
fi