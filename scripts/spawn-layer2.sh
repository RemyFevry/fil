#!/usr/bin/env bash
# scripts/spawn-layer2.sh — a layer-1 subagent spawns a layer-2 subagent as a
# pane split INSIDE its own tab, sharing its parent's Worktrunk worktree.
# Counterpart to scripts/spawn-layer1.sh. See docs/agents/topology.md.
#
# Topology invariant: a pane split shares the parent tab's worktree — so a
# layer-2 spawn creates NO new worktree and NO new tab. This is the bottom of
# the tree (max depth 2); layer-2 agents must not spawn further.
#
# Usage:
#   pnpm layer2 <name> [runtime]
#   pnpm layer2 tests-runner                 # runtime defaults to opencode
#   pnpm layer2 docs-writer pi
#
# Inherits FIL_AGENT_BRANCH / FIL_AGENT_WORKTREE from the parent layer-1 pane
# and tags the new pane FIL_AGENT_LAYER=2.
#
# Requires: running inside herdr (HERDR_PANE_ID set) as a layer-1 agent
# (FIL_AGENT_LAYER=1). Refuses from layer 0 (use `pnpm layer1`) or layer 2
# (max depth).
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage: pnpm layer2 <name> [runtime]

  name      label for the new pane (e.g. tests-runner)
  runtime   agent executable: opencode (default) | claude | pi

Spawns a layer-2 subagent: a pane split in the current tab, sharing the
current worktree (no new tab, no new worktree). Only layer-1 agents should
call this. Layer-2 agents must not spawn further (max depth 2). See
docs/agents/topology.md.
EOF
}

[ "$#" -ge 1 ] || { usage; exit 64; }
name="$1"
runtime="${2:-opencode}"

case "$runtime" in
  opencode|claude|pi) ;;
  *) echo "spawn-layer2: unknown runtime '$runtime' (use opencode|claude|pi)" >&2; exit 64 ;;
esac

if [ -z "${HERDR_PANE_ID:-}" ]; then
  echo "spawn-layer2: not inside herdr (HERDR_PANE_ID unset)." >&2
  exit 1
fi

# Depth guard: only layer 1 spawns layer 2. Refuse at layer 2 (would create a
# forbidden layer 3) and refuse from the master (layer 0 — use `pnpm layer1`).
case "${FIL_AGENT_LAYER:-0}" in
  1) ;;
  0) echo "spawn-layer2: you are the master (FIL_AGENT_LAYER=0)." >&2
     echo "  The master spawns layer-1 tabs via 'pnpm layer1', not layer-2 panes." >&2
     exit 64 ;;
  *) echo "spawn-layer2: FIL_AGENT_LAYER=${FIL_AGENT_LAYER:-<unset>} — max depth is 2." >&2
     echo "  Layer-2 agents cannot spawn further. See docs/agents/topology.md." >&2
     exit 64 ;;
esac

# Pick split direction from the focused pane's geometry (best-effort → right):
# a wide pane splits right, a tall/narrow pane splits down.
direction="right"
if geom="$(herdr pane layout --current 2>/dev/null)"; then
  direction="$(printf '%s' "$geom" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
    panes = d.get("result", {}).get("layout", {}).get("panes", [])
    p = next((x for x in panes if x.get("focused")), None) or (panes[0] if panes else None)
    r = p.get("rect", {}) if p else {}
    w, h = int(r.get("width", 0)), int(r.get("height", 0))
    print("right" if (w == 0 or w >= h) else "down")
except Exception:
    print("right")
')"
fi

# Layer-2 shares the parent layer-1's worktree. Anchor on FIL_AGENT_WORKTREE
# (set by spawn-layer1.sh), not the mutable $PWD — a layer-1 that has `cd`'d
# elsewhere must still anchor its child pane to the tagged worktree.
if [ -z "${FIL_AGENT_WORKTREE:-}" ] || [ ! -d "${FIL_AGENT_WORKTREE:-}" ]; then
  echo "spawn-layer2: FIL_AGENT_WORKTREE is missing or invalid." >&2
  echo "  Layer-2 panes must be spawned by a layer-1 agent (pnpm layer1)." >&2
  exit 1
fi

split_json="$(herdr pane split --current --direction "$direction" --no-focus \
  --cwd "$FIL_AGENT_WORKTREE" \
  --env "FIL_AGENT_LAYER=2" \
  --env "FIL_AGENT_BRANCH=${FIL_AGENT_BRANCH:-}" \
  --env "FIL_AGENT_WORKTREE=$FIL_AGENT_WORKTREE")"
pane_id="$(printf '%s' "$split_json" |
  python3 -c 'import sys,json; print(json.load(sys.stdin)["result"]["pane"]["pane_id"])')"
if [ -z "$pane_id" ]; then
  echo "spawn-layer2: herdr pane split returned no pane id" >&2
  exit 1
fi

herdr pane rename "$pane_id" "$name"
herdr pane run "$pane_id" "$runtime"

cat <<EOF
✓ layer-2 subagent '$name' spawned (shares worktree $PWD, split $direction).
  pane     : $pane_id  (label '$name')
  runtime  : $runtime  (launching)

Wait for idle, then send the task:
  herdr wait agent-status $pane_id --status idle --timeout 60000
  herdr pane run $pane_id "<your task>"
EOF
