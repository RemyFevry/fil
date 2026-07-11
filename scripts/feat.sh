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
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: pnpm feat <n> [-- <wt-args>]" >&2
  echo "  example: pnpm feat 46" >&2
  echo "           pnpm feat fix/state-sync -x claude" >&2
  exit 64
fi

branch="feat/${1#feat/}"   # accept "46" or "fix/foo" or "feat/foo"
shift

# Always: open the Worktrunk worktree. This is the canonical Fil primitive
# (see scripts/require-worktree.sh and .config/wt.toml).
wt switch -c "$branch" "$@"

# Conditional: anchor a herdr Workspace to this worktree. Fil does not own
# herdr; the dev who uses herdr gets a sidebar-friendly slot per Change.
if command -v herdr >/dev/null 2>&1; then
  herdr workspace create --cwd "$(pwd)" --label "$branch" --no-focus
fi