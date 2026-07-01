// Pi worktree guard extension.
//
// Blocks mutating tools (edit / write / bash) when Pi runs in the *primary*
// worktree, forcing agent work into a Worktrunk-linked worktree. Auto-loaded
// from .pi/extensions/. Kept separate from the `fil init`-generated fil.ts so
// regenerating the Fil adapter never overwrites this guard.
//
// The veto mirrors the Fil adapter's tool_call block (see
// packages/pi-adapter/src/extension-source.ts). The decision is delegated to
// the canonical scripts/require-worktree.sh — single source of truth — which
// also owns the FIL_ALLOW_MAIN_WORKTREE escape hatch and the "not a repo →
// allow" fallback, so this file never reimplements the gate.
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const MUTATING = new Set(["edit", "write", "bash"]);

/** Run the canonical gate; returns its exit code (0 = allow, 2 = block). */
function gateExitCode(): number {
  // Resolve the repo root from the cwd so the shared script is found no matter
  // how Pi located this extension file.
  let top: string;
  try {
    top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return 0; // not a git repo → allow (mirrors the script's own behavior)
  }
  try {
    execFileSync("bash", [join(top, "scripts", "require-worktree.sh")], {
      stdio: "ignore",
    });
    return 0;
  } catch (e) {
    // execFileSync throws on non-zero exit; the code is on error.status.
    const err = e as { status?: number };
    return typeof err.status === "number" ? err.status : 1;
  }
}

export default function worktreeGuard(pi) {
  pi.on("tool_call", async (event) => {
    const name = event?.toolName;
    if (!MUTATING.has(name)) return undefined;
    const code = gateExitCode();
    if (code === 0) return undefined; // allowed
    if (code === 2) {
      return {
        block: true,
        reason:
          "fil: blocked — mutating tools are not allowed in the primary worktree. " +
          "Work inside a Worktrunk worktree: `wt switch -c <branch>` and launch Pi there " +
          "(e.g. `wt switch -x pi -c <branch>`). " +
          "Trunk maintenance? set FIL_ALLOW_MAIN_WORKTREE=1.",
      };
    }
    // Unexpected gate failure — fail closed, but report the real code.
    return {
      block: true,
      reason: `fil worktree guard: unexpected gate failure (exit ${code})`,
    };
  });
}
