#!/usr/bin/env bash
# scripts/bootstrap.sh — Fil first-touch bootstrap.
#
# Wires the one-time setup a new Fil contributor (human or AFK agent) needs:
#   - Verifies Node ≥ 20, pnpm ≥ 10, `wt`, `gh` are present; prints install
#     instructions when any are missing (does NOT auto-install — first touch
#     is human-only per docs/agents/developer-experience.md).
#   - Switches `gh` to the `remyf-agent` identity (graceful no-op when
#     already on it).
#   - Runs `pnpm install --frozen-lockfile` + `pnpm build` on first
#     invocation; skips both when `node_modules/` + every `packages/*/dist/`
#     is present and newer than the repo root mtime (i.e. cache hit).
#
# Idempotent. Safe to re-run. Exit code is 0 in both first-touch and
# cached-no-op paths — the only way to fail is a hard prerequisite
# violation (Node < 20, missing tool with no install command, etc.).
#
# End-to-end verification: vitest in scripts/test/bootstrap.test.sh runs
# the script against a tmpdir twice and asserts (a) exit 0 both times
# and (b) no file mtimes advance on the second run.
#
# Env override:
#   FIL_BOOTSTRAP_SKIP_INSTALL=1  — pretend `node_modules` + `packages/*/dist`
#                                    are fresh without touching them. Used by
#                                    the vitest to prove the no-op branch
#                                    independently of any real install.
set -euo pipefail

# Resolve repo root regardless of where the script is invoked from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

log() { printf '\033[1;34m[bootstrap]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[bootstrap]\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31m[bootstrap]\033[0m %s\n' "$*" >&2; exit 1; }

# ─── 1. Prerequisite check ───────────────────────────────────────────────────

# Required versions mirror package.json `engines.node` + the actual
# `packageManager` pin. Pnpm's pinned version is read from package.json so
# we don't drift when it bumps.
MIN_NODE_MAJOR=20
MIN_PNPM_MAJOR=10
REQUIRED_NODE_VERSION=">=${MIN_NODE_MAJOR}"
REQUIRED_PNPM_VERSION="$(node -e 'const p=require("./package.json");const m=p.packageManager||"";const n=m.match(/^pnpm@(\d+)/);process.stdout.write(n?`>=${n[1]}`:`>=${MIN_PNPM_MAJOR}`)' 2>/dev/null || echo ">=${MIN_PNPM_MAJOR}")"

# Augment PATH so tools installed via non-system locations (Homebrew
# `wt`, pipx, `~/.local/bin` on Linux) are visible to `command -v`.
# Users with a pristine shell will already have these on PATH; this
# only widens the search when they don't.
export PATH="${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:${PATH}"

need_tool() {
  local tool="$1" install_hint="$2"
  if ! command -v "$tool" >/dev/null 2>&1; then
    fail "missing required tool: ${tool}
    Install with: ${install_hint}"
  fi
}

version_gte() {
  # $1 = actual (e.g. "20.11.1"), $2 = constraint (e.g. ">=20" or ">=10")
  local actual="$1" constraint="$2"
  local op_min="" required_major=""
  if [[ "$constraint" =~ ^\>=\ *([0-9]+) ]]; then
    required_major="${BASH_REMATCH[1]}"
    actual_major="${actual%%.*}"
    [[ -z "$actual_major" || ! "$actual_major" =~ ^[0-9]+$ ]] && return 1
    [[ "$actual_major" -ge "$required_major" ]]
  else
    return 1
  fi
}

# Node
need_tool node "https://nodejs.org/  (LTS ${MIN_NODE_MAJOR}+)"
NODE_VERSION="$(node --version | sed 's/^v//')"
version_gte "$NODE_VERSION" "$REQUIRED_NODE_VERSION" \
  || fail "Node ${NODE_VERSION} found; need ${REQUIRED_NODE_VERSION}.
    Update with: nvm install ${MIN_NODE_MAJOR} && nvm use ${MIN_NODE_MAJOR}"

# pnpm — invoked via corepack's shim, so check `pnpm` not `corepack`.
need_tool pnpm "corepack enable && corepack prepare pnpm@latest --activate"
PNPM_VERSION="$(pnpm --version)"
version_gte "$PNPM_VERSION" "$REQUIRED_PNPM_VERSION" \
  || fail "pnpm ${PNPM_VERSION} found; need ${REQUIRED_PNPM_VERSION}.
    Update with: corepack prepare pnpm@latest --activate"

# gh + wt — both required for the contributor workflow but not for install.
need_tool gh "https://cli.github.com/  (or: apt-get install gh)"
need_tool wt "https://worktrunk.dev/install/  (or: brew install worktrunk)"

log "prerequisites ok: node ${NODE_VERSION}, pnpm ${PNPM_VERSION}, gh $(gh --version | awk 'NR==1{print $3}'), wt $(wt --version | awk '{print $2}')"

# ─── 2. gh identity switch ──────────────────────────────────────────────────

# CLAUDE.md pins the remyf-agent identity convention; switching is the
# contributor's first duty. This block is a graceful no-op when the
# active account is already the target — so it's safe in CI too.
# A missing target account is a SOFT warning, not a hard failure: the
# bootstrap is the first touch a contributor makes, before they've
# necessarily added the remyf-agent account to `gh auth`. We log and
# continue so `pnpm install` still runs; the contributor is expected
# to add the account via `gh auth login --user remyf-agent` afterwards.
TARGET_GH_USER="${FIL_BOOTSTRAP_GH_USER:-remyf-agent}"
ACTIVE_GH_USER="$(gh api user --jq .login 2>/dev/null || echo "")"
if [[ -z "$ACTIVE_GH_USER" ]]; then
  warn "gh not authenticated — skipping 'gh auth switch ${TARGET_GH_USER}'.
    Run: gh auth login    then re-run scripts/bootstrap.sh"
elif [[ "$ACTIVE_GH_USER" == "$TARGET_GH_USER" ]]; then
  log "gh already on ${TARGET_GH_USER}; no switch needed"
else
  # Check the target is in gh's known accounts before attempting the switch,
  # so we don't fail the whole bootstrap on a missing-account error.
  if gh auth status --user "$TARGET_GH_USER" >/dev/null 2>&1; then
    log "switching gh identity: ${ACTIVE_GH_USER} → ${TARGET_GH_USER}"
    gh auth switch --user "$TARGET_GH_USER"
  else
    warn "gh account '${TARGET_GH_USER}' is not configured yet; current account is '${ACTIVE_GH_USER}'.
    The worktree guard + remyf-agent convention will not apply until you:
        gh auth login --user ${TARGET_GH_USER}
    Re-run scripts/bootstrap.sh after adding the account."
  fi
fi

# ─── 3. Cache detection: skip pnpm install + build when fresh ───────────────

# Cache is "fresh" when:
#   - FIL_BOOTSTRAP_SKIP_INSTALL=1 (test override), OR
#   - node_modules/ exists AND every packages/*/dist/ exists AND every
#     dist/ is newer (mtime) than the repo root.
# We compare against REPO_ROOT's mtime — a one-shot `git checkout` /
# worktree creation updates that mtime, which invalidates the cache.
cache_fresh() {
  [[ "${FIL_BOOTSTRAP_SKIP_INSTALL:-0}" == "1" ]] && return 0
  [[ -d node_modules ]] || return 1
  local pkg_dist
  for pkg_dist in packages/*/dist; do
    [[ -d "$pkg_dist" ]] || return 1
  done
  local root_mtime
  root_mtime="$(stat -c %Y "${REPO_ROOT}" 2>/dev/null || stat -f %m "${REPO_ROOT}")"
  local pkg_mtime
  for pkg_dist in packages/*/dist; do
    pkg_mtime="$(stat -c %Y "$pkg_dist" 2>/dev/null || stat -f %m "$pkg_dist")"
    [[ "$pkg_mtime" -ge "$root_mtime" ]] || return 1
  done
  return 0
}

if cache_fresh; then
  log "cache fresh — skipping pnpm install + build"
  log "done."
  exit 0
fi

# ─── 4. Cold path: install + build ──────────────────────────────────────────

log "running pnpm install --frozen-lockfile"
pnpm install --frozen-lockfile

log "running pnpm build"
pnpm build

log "done."