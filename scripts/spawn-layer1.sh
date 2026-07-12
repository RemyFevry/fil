#!/usr/bin/env bash
# scripts/spawn-layer1.sh — master (layer 0) spawns a layer-1 subagent in its
# OWN tab + OWN Worktrunk worktree. One of the two topology helpers; the
# layer-2 counterpart is scripts/spawn-layer2.sh.
# See docs/agents/topology.md for the full convention.
#
# Topology invariant: a new tab ⟺ a new worktree. So a layer-1 spawn always
# creates both. Layer-2 spawns (pane splits) share their parent tab's worktree
# and use scripts/spawn-layer2.sh instead.
#
# Usage:
#   pnpm layer1 <name> <branch> [runtime]
#   pnpm layer1 pr-99-review pr-99-review           # runtime defaults to opencode
#   pnpm layer1 feat-101 feat/101 claude
#
# The spawned pane receives env vars the agent reads to self-identify:
#   FIL_AGENT_LAYER=1   FIL_AGENT_BRANCH=<branch>   FIL_AGENT_WORKTREE=<path>
#
# Requires: running inside herdr (HERDR_WORKSPACE_ID set). The master runs
# with FIL_ALLOW_MAIN_WORKTREE=1 so it may orchestrate from the primary
# checkout; dispatched agents never set that flag. See docs/agents/topology.md.
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage: pnpm layer1 <name> <branch> [runtime]

  name      label for the new tab + pane (e.g. pr-99-review)
  branch    git branch / Worktrunk worktree to create (e.g. feat/101)
  runtime   agent executable: opencode (default) | claude | pi

Spawns a layer-1 subagent: a new tab + a new Worktrunk worktree in the
current herdr workspace. Only the master (layer 0) should call this —
layer-1 agents spawn layer-2 panes via `pnpm layer2`. See
docs/agents/topology.md.
EOF
}

[ "$#" -ge 2 ] || { usage; exit 64; }
name="$1"
branch="$2"
runtime="${3:-opencode}"

case "$runtime" in
  opencode|claude|pi) ;;
  *) echo "spawn-layer1: unknown runtime '$runtime' (use opencode|claude|pi)" >&2; exit 64 ;;
esac

if [ -z "${HERDR_WORKSPACE_ID:-}" ]; then
  echo "spawn-layer1: not inside herdr (HERDR_WORKSPACE_ID unset)." >&2
  echo "  These helpers compose herdr tabs/panes with Worktrunk worktrees." >&2
  exit 1
fi

# Soft layer check (see docs/agents/topology.md): only layer 0 spawns tabs.
case "${FIL_AGENT_LAYER:-0}" in
  0) ;;
  *) echo "spawn-layer1: warning — FIL_AGENT_LAYER=${FIL_AGENT_LAYER}." >&2
     echo "  Per docs/agents/topology.md, layer-1 agents spawn layer-2 panes" >&2
     echo "  (pnpm layer2), not more tabs. Continuing anyway." >&2 ;;
esac

# 1. Create the Worktrunk worktree (the guard whitelists `wt switch`).
wt switch -c "$branch"

# 2. Resolve its absolute path (`wt` has no path subcommand; ask git).
worktree_path="$(git worktree list --porcelain |
  awk -v b="refs/heads/$branch" '/^worktree / { wt=$2 } /^branch / { if ($2==b) { print wt; exit } }')"
if [ -z "$worktree_path" ]; then
  echo "spawn-layer1: could not resolve worktree path for branch '$branch'" >&2
  exit 1
fi

# 3. New tab in the current workspace. cwd + FIL_AGENT_* env land on its root pane.
tab_json="$(herdr tab create \
  --workspace "$HERDR_WORKSPACE_ID" \
  --label "$name" \
  --cwd "$worktree_path" \
  --env "FIL_AGENT_LAYER=1" \
  --env "FIL_AGENT_BRANCH=$branch" \
  --env "FIL_AGENT_WORKTREE=$worktree_path" \
  --no-focus)"
pane_id="$(printf '%s' "$tab_json" |
  python3 -c 'import sys,json; print(json.load(sys.stdin)["result"]["root_pane"]["pane_id"])')"
tab_id="$(printf '%s' "$tab_json" |
  python3 -c 'import sys,json; print(json.load(sys.stdin)["result"]["tab"]["tab_id"])')"
if [ -z "$pane_id" ]; then
  echo "spawn-layer1: herdr tab create returned no root_pane id" >&2
  exit 1
fi

# 4. Launch the runtime in the new pane. This helper SPAWNS only — the caller
#    waits for idle and sends the task (per the herdr skill: do not pass the
#    task as an argv prompt).
herdr pane rename "$pane_id" "$name"
herdr pane run "$pane_id" "$runtime"

cat <<EOF
✓ layer-1 subagent '$name' spawned.
  tab      : $tab_id
  pane     : $pane_id  (label '$name')
  worktree : $worktree_path
  branch   : $branch
  runtime  : $runtime  (launching)

Wait for idle, then send the task:
  herdr wait agent-status $pane_id --status idle --timeout 60000
  herdr pane run $pane_id "<your task>"
EOF
