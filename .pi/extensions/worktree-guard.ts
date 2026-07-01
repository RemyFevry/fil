// Pi worktree guard extension.
//
// Blocks mutating tools (edit / write / bash) when Pi runs in the *primary*
// worktree, forcing agent work into a Worktrunk-linked worktree. Auto-loaded
// from .pi/extensions/. Kept separate from the `fil init`-generated fil.ts so
// regenerating the Fil adapter never overwrites this guard.
//
// The veto mirrors the Fil adapter's tool_call block (see
// packages/pi-adapter/src/extension-source.ts). The detection mirrors
// scripts/require-worktree.sh (`.git` file = linked worktree, `.git` dir =
// primary). Escape hatch: FIL_ALLOW_MAIN_WORKTREE=1.
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";

const MUTATING = new Set(["edit", "write", "bash"]);

/** True when cwd is the primary worktree (not a linked worktree). */
function inPrimaryWorktree(): boolean {
  if (process.env.FIL_ALLOW_MAIN_WORKTREE === "1") return false;
  let top: string;
  try {
    top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return false; // not a git repo → allow
  }
  try {
    // Linked worktree: `.git` is a file. Primary: `.git` is a directory.
    return statSync(`${top}/.git`).isDirectory();
  } catch {
    return false;
  }
}

export default function worktreeGuard(pi) {
  pi.on("tool_call", async (event) => {
    const name = event?.toolName;
    if (!MUTATING.has(name)) return undefined;
    if (!inPrimaryWorktree()) return undefined;
    return {
      block: true,
      reason:
        "fil: blocked — mutating tools are not allowed in the primary worktree. " +
        "Work inside a Worktrunk worktree: `wt switch -c <branch>` and launch Pi there " +
        "(e.g. `wt switch -x pi -c <branch>`). " +
        "Trunk maintenance? set FIL_ALLOW_MAIN_WORKTREE=1.",
    };
  });
}
