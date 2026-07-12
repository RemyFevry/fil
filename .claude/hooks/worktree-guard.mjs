#!/usr/bin/env node
// Claude Code PreToolUse wrapper for the Fil worktree guard.
//
// Claude Code pipes a JSON hook event to the hook command via stdin with
// shape `{ tool_name, tool_input, … }`. We extract the bash command when
// the tool is `Bash` and pass it through to the canonical gate script so
// it can whitelist bootstrap commands (notably `wt switch …`).
//
// Edit/Write/MultiEdit (and anything else) have no command — we pass an
// empty string, and the gate script falls through to its worktree check.
//
// The canonical gate is `scripts/require-worktree.sh` — the *only* place
// the worktree decision lives (see AGENTS.md). It honors two env hatches:
//   FIL_ALLOW_MAIN_WORKTREE=1 — human escape hatch; also what the canonical
//                               `pnpm master` launcher sets before exec'ing
//                               the runtime. Claude Code's master session is
//                               launched via `pnpm master claude`, so the
//                               hatch arrives via process.env (forwarded
//                               below) with no manual export. See issue #101.
//   FIL_MASTER_SESSION=1      — auto-detected master hatch (set by the
//                               OpenCode plugin). Claude Code has no reliable
//                               in-process signal for "the active agent is the
//                               master" at PreToolUse time (the master is a
//                               Task subagent here), so this hook relies on the
//                               launcher / human escape hatch instead.
//
// Exit code mirrors the canonical gate:
//   0 — allow
//   2 — block (primary worktree). Surface the gate's stderr so Claude Code
//       shows the worktree-guard error to the agent.
//   any other — pass through (unblock on a real script error).

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

function readStdin() {
  // Read all of stdin synchronously. Claude Code pipes the full JSON;
  // it's small (well under a kilobyte).
  return readFileSync(0, "utf8");
}

function gateScriptPath() {
  // .claude/hooks/worktree-guard.mjs → repo root → scripts/require-worktree.sh
  return join(here, "..", "..", "scripts", "require-worktree.sh");
}

/** Walk an unknown value, treat objects as dictionaries, else return "". */
function asObject(value) {
  return value !== null && typeof value === "object" ? value : null;
}

function extractCommand(event) {
  const obj = asObject(event);
  if (!obj) return "";
  if (obj.tool_name !== "Bash") return "";
  const input = asObject(obj.tool_input);
  const cmd = input ? input.command : null;
  return typeof cmd === "string" ? cmd : "";
}

const raw = readStdin();
let event = null;
try {
  event = JSON.parse(raw);
} catch {
  // Malformed event JSON — let the gate run with an empty command; it
  // will simply skip the bootstrap whitelist and do the worktree check.
}

const command = extractCommand(event);
const script = gateScriptPath();

if (!existsSync(script)) {
  // If the canonical script is missing for any reason, fail *closed* for
  // mutating tools — better to false-positive than silently lose the guard.
  process.stderr.write(
    `fil worktree guard: missing canonical gate (${script}); refusing to proceed.\n`,
  );
  process.exit(2);
}

const result = spawnSync("bash", [script, command], {
  stdio: ["ignore", "inherit", "inherit"],
  // Forward the same env Claude Code gave the hook so FIL_ALLOW_MAIN_WORKTREE
  // and friends continue to work.
  env: process.env,
});

// Anything but a clean child exit means the guard didn't actually answer.
// Claude Code treats exit code 1 as a *non-blocking* error, so the only safe
// fallback here is exit 2 (block) — same policy as the missing-script branch
// above and the OpenCode/Pi integrations. Surface the underlying cause on
// stderr so the next reviewer can debug.
if (typeof result.status === "number") {
  process.exit(result.status);
}
const detail =
  result.signal != null
    ? `signal ${result.signal}`
    : result.error
      ? result.error.message
      : `exit code unavailable (status=${String(result.status)})`;
process.stderr.write(`fil worktree guard: could not invoke gate (${detail}); refusing to proceed.\n`);
process.exit(2);
