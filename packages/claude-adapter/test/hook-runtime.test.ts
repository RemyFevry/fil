import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { renderPreToolUseHookSource } from "../src/hook-source.js";
import { serializeRunProjection, type RunProjection } from "@color-sunset/fil-contract";

/**
 * End-to-end runtime test — writes the *rendered* hook script to disk, drops a
 * contract-validated `.fil/run.json`, then actually executes it with `node`
 * the way Claude Code would (stdin JSON + `CLAUDE_PROJECT_DIR`). Proves the
 * installed artefact blocks/allows tools exactly as the Phase's contract says.
 */

let workdir: string;
let hookFile: string;

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), "fil-claude-hook-runtime-"));
  hookFile = join(workdir, "hook.js");
});
afterAll(async () => {
  await rm(workdir, { recursive: true, force: true });
});
beforeEach(async () => {
  await rm(join(workdir, "proj"), { recursive: true, force: true });
  await mkdir(join(workdir, "proj", ".fil"), { recursive: true });
  await writeFile(hookFile, renderPreToolUseHookSource(), "utf8");
});

function projection(allowedTools: string[]): RunProjection {
  return {
    runId: "run-7",
    change: "add-login",
    flowName: "default",
    status: "active",
    phase: "Code",
    phases: ["Code"],
    actorMode: "agent",
    phaseConfig: {
      instructions: "Implement the login flow.",
      allowedTools,
      skills: [],
      context: { files: [], priorResults: [] },
      actorMode: "agent",
      gates: [{ name: "tests", type: "testsPass", command: "pnpm test" }],
    },
  };
}

async function writeRun(p: RunProjection): Promise<string> {
  const projDir = join(workdir, "proj");
  const serialized = serializeRunProjection(p);
  expect(serialized.ok).toBe(true);
  if (!serialized.ok) throw new Error("fixture failed to serialize");
  await writeFile(join(projDir, ".fil", "run.json"), serialized.value, "utf8");
  return projDir;
}

function runHook(projDir: string, toolName: string): { stdout: string; status: number | null } {
  const res = spawnSync(process.execPath, [hookFile], {
    input: JSON.stringify({ tool_name: toolName, tool_input: {}, cwd: projDir }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: projDir },
    encoding: "utf8",
  });
  return { stdout: res.stdout ?? "", status: res.status };
}

describe("PreToolUse hook — runtime (executed via node)", () => {
  it("blocks a tool that is not in the Phase's allowedTools", async () => {
    const projDir = await writeRun(projection(["Read", "Write"]));
    const { stdout, status } = runHook(projDir, "Bash");
    expect(status).toBe(0);
    const doc = JSON.parse(stdout);
    expect(doc.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(doc.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(doc.hookSpecificOutput.permissionDecisionReason).toContain("'Bash'");
    expect(doc.hookSpecificOutput.permissionDecisionReason).toContain("Read, Write");
  });

  it("allows (stays silent) for a tool that is in allowedTools", async () => {
    const projDir = await writeRun(projection(["Read", "Write"]));
    const { stdout, status } = runHook(projDir, "Read");
    expect(status).toBe(0);
    expect(stdout.trim()).toBe("");
  });

  it("is fail-closed: empty allowedTools blocks every tool", async () => {
    const projDir = await writeRun(projection([]));
    const { stdout } = runHook(projDir, "Read");
    const doc = JSON.parse(stdout);
    expect(doc.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(doc.hookSpecificOutput.permissionDecisionReason).toContain("permits no tools");
  });

  it("stays silent (allows all) when there is no active Run", async () => {
    // No run.json written under projDir.
    const projDir = join(workdir, "proj");
    const { stdout, status } = runHook(projDir, "Bash");
    expect(status).toBe(0);
    expect(stdout.trim()).toBe("");
  });

  it("stays silent (allows all) when the Run is done", async () => {
    const projDir = await writeRun({ ...projection(["Read"]), status: "done" });
    const { stdout } = runHook(projDir, "Bash");
    expect(stdout.trim()).toBe("");
  });
});
