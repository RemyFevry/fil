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
// Escape hatches (both fed to the canonical script, never reimplemented here):
//   FIL_ALLOW_MAIN_WORKTREE=1 — human escape hatch. Inherited via process.env
//                               (set manually for trunk maintenance, or by the
//                               canonical `pnpm master` launcher).
//   FIL_MASTER_SESSION=1      — auto-detected master hatch. Injected by THIS
//                               plugin into the guard subprocess env when the
//                               active agent is the Fil master, so a master
//                               OpenCode session works with zero manual setup
//                               even if the launcher wasn't used. See issue
//                               #101. Never written to the agent's own bash
//                               env, so it can't leak into subagent sessions.
import { join } from "node:path";

// The canonical name of the Fil master agent (`.opencode/agent/master.md`).
// The master is the ONLY primary-mode agent whose edit & write are denied, and
// it is the only agent that is supposed to run in the primary checkout, so
// matching its name is the reliable signal that "this is a master session".
const MASTER_AGENT = "master";

export const WorktreeGuard = async ({ $ }) => {
  // Resolve the gate script relative to this plugin file so it works regardless
  // of the process cwd. Plugin lives at .opencode/plugins/worktree-guard.ts.
  const script = join(import.meta.dir, "..", "..", "scripts", "require-worktree.sh");

  // sessionID → active agent name. Populated from the `chat.message` hook
  // (which carries the agent the message was routed to) and consumed in
  // `tool.execute.before`. tool execution always happens *during* an agent
  // turn, which is preceded by a chat.message in the same turn, so by the time
  // a tool fires the active agent for that session is known. A session whose
  // agent we haven't seen yet is treated as non-master (safe default: block),
  // which is correct for subagents.
  const sessionAgent = new Map<string, string>();

  // Check whether the session currently driving a tool call is the master.
  // Returns false when unknown (cold start) — the canonical `pnpm master`
  // launcher (which sets FIL_ALLOW_MAIN_WORKTREE in process.env) covers that
  // case, so the master always has at least one working path to the hatch.
  function isMasterSession(sessionID) {
    if (typeof sessionID !== "string" || !sessionID) return false;
    return sessionAgent.get(sessionID) === MASTER_AGENT;
  }

  return {
    "chat.message": async (input) => {
      // Track the agent each session is currently routed to. `agent` is
      // optional on the wire; ignore messages that don't carry it.
      const agent = input?.agent;
      const sid = input?.sessionID;
      if (typeof sid === "string" && typeof agent === "string" && agent) {
        sessionAgent.set(sid, agent);
      }
    },

    "tool.execute.before": async (input, output) => {
      const tool = input?.tool;
      if (tool !== "edit" && tool !== "write" && tool !== "bash") return;
      // Only bash carries a command we can whitelist. edit/write pass "".
      const command =
        tool === "bash" && output?.args && typeof output.args === "object" && "command" in output.args
          ? String(output.args.command ?? "")
          : "";
      // Build the env for the guard subprocess. We always inherit process.env
      // (so FIL_ALLOW_MAIN_WORKTREE keeps working), and additionally inject
      // FIL_MASTER_SESSION=1 ONLY when this tool call belongs to a master
      // session. Injecting into the guard call (not into output.args / the
      // agent's bash env) keeps the hatch scoped to the guard decision — it
      // never reaches the command the master actually runs, and never reaches
      // a subagent session (different sessionID → not master).
      const env = isMasterSession(input?.sessionID)
        ? { ...process.env, FIL_MASTER_SESSION: "1" }
        : { ...process.env };
      // Don't throw on non-zero — inspect the exit code so we only report the
      // known "primary worktree" block (exit 2) and surface anything else
      // (script missing, git error, …) instead of masking it or failing open.
      const result = await $`bash ${script} ${command}`.env(env).nothrow().quiet();
      if (result.exitCode === 0) return; // linked worktree (or whitelisted cmd) → allowed
      if (result.exitCode === 2) {
        throw new Error(
          "fil: blocked — mutating tools are not allowed in the primary worktree. " +
            (command ? `You ran: \`${command}\`. ` : "") +
            "Work inside a Worktrunk worktree: `wt switch -c <branch>` and launch opencode there " +
            "(e.g. `wt switch -x opencode -c <branch>`). " +
            "Master session? launch via `pnpm master`. " +
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
