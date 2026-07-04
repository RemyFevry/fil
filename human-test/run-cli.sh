#!/usr/bin/env bash
# Manual visual test for the REAL `fil inspect` CLI (not the standalone demo).
#
# Run:  sh human-test/run-cli.sh
#
# Creates a throwaway Fil project in a temp dir, runs `fil init`, then
# `fil inspect` — which opens the Stately inspector in the browser for the
# default Flow. Press Enter to advance; Ctrl-C to exit. The temp dir is removed
# on exit. Requires internet (the inspector UI is hosted at stately.ai).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

echo "Building the CLI…"
(cd "$REPO_ROOT" && pnpm build >/dev/null)

FIL="$REPO_ROOT/packages/cli/dist/index.js"

echo "Scaffolding a throwaway Fil project in: $WORKDIR"
(cd "$WORKDIR" && node "$FIL" init)

echo
echo "Launching 'fil inspect' — the Stately inspector opens in your browser."
echo "Press Enter in this terminal to advance the Flow. Ctrl-C to exit."
echo
(cd "$WORKDIR" && node "$FIL" inspect)
