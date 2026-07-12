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
//
// Master hatch: the canonical `pnpm master pi` launcher sets
// FIL_ALLOW_MAIN_WORKTREE=1 in the runtime's env before exec'ing Pi, so a
// master Pi session works with zero manual export (see issue #101). Pi has no
// per-prompt tool allow-list signal available at tool_call time, so this
// extension relies on the launcher / human escape hatch (inherited via the
// subprocess env below) rather than agent-aware detection.
//
// For `bash` tool calls we extract the command (best-effort: from
// `event.input`/`event.args`/stringifying the event) and pass it to the
// script as $1, so `wt switch …` and other bootstrap subcommands can be
// whitelisted as an escape hatch from the primary worktree.
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const MUTATING = new Set(["edit", "write", "bash"]);

/** Best-effort extraction of the bash command from a Pi tool_call event. */
function bashCommandFrom(event: unknown): string {
  if (!event || typeof event !== "object") return "";
  const e = event as Record<string, unknown>;
  // Pi's tool_call event shape: { toolName, input: { command: "..." } } (most
  // versions), with some variants exposing `args` or `input` directly. We try
  // each in order and fall back to a stringify-and-truncate for diagnostics.
  const candidates: unknown[] = [
    (e.input as Record<string, unknown> | undefined)?.command,
    (e.input as Record<string, unknown> | undefined)?.args,
    (e.args as Record<string, unknown> | undefined)?.command,
    (e as Record<string, unknown>).command,
  ];
  for (const c of candidates) {
    if (typeof c === "string") return c;
    if (c && typeof c === "object") {
      const cmd = (c as Record<string, unknown>).command;
      if (typeof cmd === "string") return cmd;
    }
  }
  return "";
}

/** Run the canonical gate; returns its exit code (0 = allow, 2 = block). */
function gateExitCode(command: string): number {
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
    execFileSync("bash", [join(top, "scripts", "require-worktree.sh"), command], {
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
    const command = name === "bash" ? bashCommandFrom(event) : "";
    const code = gateExitCode(command);
    if (code === 0) return undefined; // allowed (worktree or whitelisted cmd)
    if (code === 2) {
      return {
        block: true,
        reason:
          "fil: blocked — mutating tools are not allowed in the primary worktree. " +
          (command ? `You ran: \`${command}\`. ` : "") +
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
