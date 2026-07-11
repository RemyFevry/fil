---
"@color-sunset/fil": patch
---

Adopt **herdr** (https://herdr.dev/docs/agents/) as a non-mandatory dev
tool for multi-agent orchestration. Closes #95.

- New `pnpm install-herdr` (`scripts/install-herdr.sh`) — idempotent host
  installer: `brew install herdr`, the three Fil-supported integrations
  (`claude / opencode / pi`), the official herdr agent skill globally,
  and a symlink to `docs/agents/herdr-config.toml`.
- New `pnpm feat <n>` (`scripts/feat.sh`) — opens a Fil Change as a
  Worktrunk worktree; if herdr is on `PATH`, additionally creates a herdr
  Workspace anchored to that worktree.
- New `pnpm ship` (`scripts/ship.sh`) — `wt merge main`; if herdr is on
  `PATH`, additionally closes the matching herdr Workspace by label.
- New `docs/agents/herdr.md` — the canonical Fil+herdr reference
  (install, recipes, gotchas, scope fence: no herdr plugin, no Fil CLI
  flag).
- New `docs/agents/herdr-config.toml` — Fil-tuned config template
  (sidebar `priority` sort, in-app toast delivery, mouse capture, etc.);
  the installer symlinks it to `~/.config/herdr/config.toml` on first run.
- New `opencode.json` at the repo root — `external_directory` allowance
  for `~/fil.*/**` so `wt switch` to a new worktree does not prompt
  for write approval every time.

Edits to onboarding, feature-loop, developer-experience, AGENTS, and
CONTRIBUTING. Herdr remains non-mandatory: every Fil command works
without it, and the Worktrunk half of `pnpm feat` / `pnpm ship` is
always the canonical action.