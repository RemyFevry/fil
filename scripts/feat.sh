#!/usr/bin/env bash
# scripts/feat.sh — open a Fil Change as a Worktrunk worktree, optionally
# anchor a herdr Workspace to it.
#
# Usage:
#   pnpm feat <n>                 # → branch feat/<n>, default runtime opencode
#   pnpm feat fix/<short> <args>  # → explicit branch, forwarded args to wt
#
# This is the spawn-side of the canonical Fil Change loop:
#   pnpm feat <n>      → opens the Change in a Worktrunk worktree
#   pnpm ship          → closes it (see scripts/ship.sh)
#
# Herdr is non-mandatory. The Workspace creation step runs only if
# `herdr` is on PATH; otherwise wt switch is the complete workflow.
# Herdr failures are logged and ignored — the canonical Worktrunk
# operation must not fail because of an optional herdr step.
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: pnpm feat <n> [-- <wt-args>]" >&2
  echo "  example: pnpm feat 46" >&2
  echo "           pnpm feat fix/state-sync -x claude" >&2
  exit 64
fi

branch="feat/${1#feat/}"   # accept "46" or "fix/foo" or "feat/foo"
shift

# Capture the path BEFORE delegating to wt, since the subsequent
# subprocess may or may not be inside the new worktree depending on
# whether `wt config shell install` integration is active.
worktree_path="$(pwd)"
herdr_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"

# Always: open the Worktrunk worktree. This is the canonical Fil primitive
# (see scripts/require-worktree.sh and .config/wt.toml).
wt switch -c "$branch" "$@"

# Conditional: anchor a herdr Workspace to this worktree. Fil does not own
# herdr; the dev who uses herdr gets a sidebar-friendly slot per Change.
# Non-fatal: a herdr failure must not break the Worktrunk side.
if command -v herdr >/dev/null 2>&1; then
  target="$herdr_root"
  [ -z "$target" ] && target="$worktree_path"
  if ! herdr workspace create --cwd "$target" --label "$branch" --no-focus; then
    echo "warning: herdr workspace create failed; the Worktrunk worktree is created, but the herdr Workspace is not." >&2
    echo "         Re-run \`herdr workspace create --cwd '$target' --label '$branch'\` later." >&2
  fi
fi