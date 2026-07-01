// OpenCode worktree guard plugin.
//
// Blocks mutating tools (edit / write / bash) when the cwd is the *primary*
// worktree, so agents only mutate code inside a Worktrunk-linked worktree.
// Auto-loaded from .opencode/plugins/. The canonical logic lives in
// scripts/require-worktree.sh — this plugin shells out to it so there is one
// source of truth. Escape hatch: FIL_ALLOW_MAIN_WORKTREE=1 (trunk maintenance).
import { join } from "node:path";

export const WorktreeGuard = async ({ $ }) => {
  // Resolve the gate script relative to this plugin file so it works regardless
  // of the process cwd. Plugin lives at .opencode/plugins/worktree-guard.ts.
  const script = join(import.meta.dir, "..", "..", "scripts", "require-worktree.sh");

  return {
    "tool.execute.before": async (input) => {
      const tool = input?.tool;
      if (tool !== "edit" && tool !== "write" && tool !== "bash") return;
      try {
        await $`bash ${script}`.quiet();
      } catch {
        throw new Error(
          "fil: blocked — mutating tools are not allowed in the primary worktree. " +
            "Work inside a Worktrunk worktree: `wt switch -c <branch>` and launch opencode there " +
            "(e.g. `wt switch -x opencode -c <branch>`). " +
            "Trunk maintenance? set FIL_ALLOW_MAIN_WORKTREE=1.",
        );
      }
    },
  };
};
