---
"@color-sunset/fil": patch
---

Fix the worktree guard so the master orchestrator isn't blocked on launch (closes #101).

The master (layer 0) runs in the primary checkout, but `FIL_ALLOW_MAIN_WORKTREE=1`
was never injected by any launcher, so every master bash was blocked until a human
hand-exported the var — violating the documented contract. The guard now grants the
hatch automatically with zero manual setup, while subagents in worktrees stay fully
blocked.

- `scripts/require-worktree.sh` (single source of truth) adds a second canonical
  signal `FIL_MASTER_SESSION=1` (auto-detected master hatch) alongside the existing
  `FIL_ALLOW_MAIN_WORKTREE=1` (human escape hatch). Both → allow in primary.
- New canonical launcher `scripts/master.sh` + `pnpm master [opencode|claude|pi]`
  exports `FIL_ALLOW_MAIN_WORKTREE=1` and execs the runtime in the primary. Works
  for all three runtimes uniformly; the var lives only in the launched process.
- The OpenCode plugin (`.opencode/plugins/worktree-guard.ts`) now detects the master
  agent via the `chat.message` hook and injects `FIL_MASTER_SESSION=1` into the guard
  subprocess env, so a master OpenCode session works even when launched via plain
  `opencode` + switch-to-master. Claude Code and Pi rely on the launcher.
- `docs/agents/master.md`, `.opencode/agent/master.md`, and `AGENTS.md` replace the
  "inherited from the master session" hand-wave with the real mechanism.
- New test `scripts/test/worktree-guard.test.ts` covers both hatches, the whitelist,
  the linked-worktree fast path, the not-a-repo fallback, and the launcher's env.
