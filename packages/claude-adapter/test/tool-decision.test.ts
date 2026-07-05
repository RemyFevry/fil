import { describe, expect, it } from "vitest";
import { decideToolUse } from "../src/enforcement.js";
import type { RunProjection } from "@color-sunset/fil-contract";

function projection(allowedTools: string[], phase = "Code"): RunProjection {
  return {
    runId: "run-1",
    change: "add-login",
    flowName: "default",
    status: "active",
    phase,
    phases: [phase],
    actorMode: "agent",
    phaseConfig: {
      instructions: "Write code.",
      allowedTools,
      skills: [],
      context: { files: [], priorResults: [] },
      actorMode: "agent",
      gates: [{ name: "noop", type: "shell", script: "true" }],
    },
  };
}

describe("decideToolUse — the PreToolUse decision (fail-closed)", () => {
  it("allows every tool when there is no Run (Fil is dormant)", () => {
    const d = decideToolUse(null, "Bash");
    expect(d.allow).toBe(true);
    expect(d.reason).toBeUndefined();
  });

  it("allows every tool when the Run is done", () => {
    const d = decideToolUse({ ...projection(["Read"]), status: "done" }, "Bash");
    expect(d.allow).toBe(true);
  });

  it("allows every tool when the Run is cancelled", () => {
    const d = decideToolUse({ ...projection(["Read"]), status: "cancelled" }, "Bash");
    expect(d.allow).toBe(true);
  });

  it("allows a tool that is in allowedTools", () => {
    const d = decideToolUse(projection(["Read", "Write"]), "Write");
    expect(d.allow).toBe(true);
    expect(d.reason).toBeUndefined();
  });

  it("denies a tool that is not in allowedTools, naming the Phase + allowed set", () => {
    const d = decideToolUse(projection(["Read", "Write"], "Design"), "Bash");
    expect(d.allow).toBe(false);
    expect(d.reason).toContain("Fil Phase 'Design'");
    expect(d.reason).toContain("'Bash'");
    expect(d.reason).toContain("Read, Write");
  });

  it("is fail-closed: an empty allowedTools denies every tool", () => {
    const d = decideToolUse(projection([], "Review"), "Read");
    expect(d.allow).toBe(false);
    expect(d.reason).toContain("permits no tools");
    expect(d.reason).toContain("Review");
  });

  it("matches the tool name exactly (no substring matching)", () => {
    // "Read" must not match "ReadOnly" or vice-versa.
    expect(decideToolUse(projection(["Read"]), "ReadOnly").allow).toBe(false);
    expect(decideToolUse(projection(["ReadOnly"]), "Read").allow).toBe(false);
  });
});
