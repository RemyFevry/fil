#!/usr/bin/env bash
# scripts/install-herdr.sh — idempotent host installer for herdr on macOS.
#
# - Installs herdr via Homebrew (skipped if already present).
# - Installs the three Fil-supported integrations (Claude Code, OpenCode, Pi).
# - Installs the herdr agent skill globally for every supported runtime.
# - Symlinks ~/.config/herdr/config.toml to docs/agents/herdr-config.toml
#   in the repo (first run only — never overwrites an existing config).
#
# Re-running this script is safe: every step is idempotent.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# 1. Binary
if ! command -v herdr >/dev/null 2>&1; then
  echo "→ installing herdr via Homebrew"
  brew install herdr
else
  echo "✓ herdr already installed: $(herdr --version)"
fi

# 2. Integrations — lifecycle authority + session identity for the three Fil agents.
#    herdr integration install is idempotent; re-running it is safe.
echo "→ installing integrations: claude, opencode, pi"
for agent in claude opencode pi; do
  herdr integration install "$agent" >/dev/null
done

# 3. The herdr agent skill for every supported runtime.
#    Auto-loads inside any herdr pane (gated by HERDR_ENV=1).
if ! command -v npx >/dev/null 2>&1; then
  echo "✗ npx not found — install Node 20+ before re-running" >&2
  exit 1
fi
echo "→ installing the herdr agent skill globally"
npx --yes skills add ogulcancelik/herdr --skill herdr -g

# 4. First-run config: symlink the Fil-tuned template, never overwrite.
mkdir -p ~/.config/herdr
# Check both absence AND lack of any symlink (incl. dangling). A regular
# `[ ! -e ... ]` is true for a dangling symlink, which would lead us to
# `ln -s` on top of an existing path and fail with "File exists".
if [ ! -e ~/.config/herdr/config.toml ] && [ ! -L ~/.config/herdr/config.toml ]; then
  ln -s "$REPO_ROOT/docs/agents/herdr-config.toml" ~/.config/herdr/config.toml
  echo "✓ linked ~/.config/herdr/config.toml → repo template"
else
  echo "✓ ~/.config/herdr/config.toml already present (not overwriting)"
fi

# 5. Report versions so the dev can compare against docs/agents/herdr.md.
echo
echo "Integration versions (minimums: Claude ≥6, OpenCode ≥5, Pi ≥2):"
herdr integration status || true

cat <<'EOF'

✓ herdr installed and configured for Fil.

  Start a session from the repo root:     herdr
  Spawn a parallel Workspace per Change:  pnpm feat <n>
  Subagent spawn inside a Workspace:      herdr agent start <name> --cwd "$(pwd)" -- <runtime>
  Close a Workspace when a Change lands:   pnpm ship
  Canonical reference:                    docs/agents/herdr.md
EOF