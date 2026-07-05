// OpenCode worktree guard plugin.
//
// Blocks mutating tools (edit / write / bash) when the cwd is the *primary*
// worktree, so agents only mutate code inside a Worktrunk-linked worktree.
// Auto-loaded from .opencode/plugins/. The canonical logic lives in
// scripts/require-worktree.sh — this plugin shells out to it so there is one
// source of truth.
//
// The script also accepts the bash command as $1 so it can whitelist
// bootstrap commands (notably `wt switch …`) that don't mutate the primary
// worktree. We extract it from `output.args.command` and pass it through;
// for edit/write we pass an empty command (the script just skips the
// bootstrap check and falls through to the worktree check).
//
// Escape hatch: FIL_ALLOW_MAIN_WORKTREE=1 (trunk maintenance).
import { join } from "node:path";

export const WorktreeGuard = async ({ $ }) => {
  // Resolve the gate script relative to this plugin file so it works regardless
  // of the process cwd. Plugin lives at .opencode/plugins/worktree-guard.ts.
  const script = join(import.meta.dir, "..", "..", "scripts", "require-worktree.sh");

  return {
    "tool.execute.before": async (input, output) => {
      const tool = input?.tool;
      if (tool !== "edit" && tool !== "write" && tool !== "bash") return;
      // Only bash carries a command we can whitelist. edit/write pass "".
      const command =
        tool === "bash" && output?.args && typeof output.args === "object" && "command" in output.args
          ? String(output.args.command ?? "")
          : "";
      // Don't throw on non-zero — inspect the exit code so we only report the
      // known "primary worktree" block (exit 2) and surface anything else
      // (script missing, git error, …) instead of masking it or failing open.
      const result = await $`bash ${script} ${command}`.nothrow().quiet();
      if (result.exitCode === 0) return; // linked worktree (or whitelisted cmd) → allowed
      if (result.exitCode === 2) {
        throw new Error(
          "fil: blocked — mutating tools are not allowed in the primary worktree. " +
            (command ? `You ran: \`${command}\`. ` : "") +
            "Work inside a Worktrunk worktree: `wt switch -c <branch>` and launch opencode there " +
            "(e.g. `wt switch -x opencode -c <branch>`). " +
            "Trunk maintenance? set FIL_ALLOW_MAIN_WORKTREE=1.",
        );
      }
      const detail = result.stderr?.toString?.()?.trim() ?? `exit ${result.exitCode}`;
      throw new Error(
        `fil worktree guard: unexpected failure (exit ${result.exitCode}): ${detail}`,
      );
    },
  };
};
