import { describe, expect, it } from "vitest";
import { enforceClaudeEnforcement } from "../src/enforcement.js";
import type { RunProjection } from "@color-sunset/fil-contract";

function fixture(): RunProjection {
  return {
    runId: "run-1",
    change: "add-login",
    flowName: "default",
    status: "active",
    phase: "Code",
    phases: ["Code"],
    actorMode: "agent",
    phaseConfig: {
      instructions: "Write the code in src/auth.",
      allowedTools: ["Read", "Write", "Edit", "Bash"],
      skills: ["tdd", "bad name"],
      context: {
        files: ["src/auth/login.ts"],
        notes: "Follow the team's auth conventions.",
        priorResults: [".fil/runs/run-0/receipts/receipt-1.json"],
      },
      actorMode: "agent",
      gates: [{ name: "tests", type: "testsPass", command: "pnpm test" }],
    },
  };
}

describe("enforceClaudeEnforcement — lean surface (what the PreToolUse hook needs)", () => {
  it("is dormant when the Run is not active", () => {
    const result = enforceClaudeEnforcement({ projection: { ...fixture(), status: "done" } });
    expect(result.hasActiveRun).toBe(false);
    expect(result.allowedTools).toEqual([]);
  });

  it("returns the contract's allowedTools verbatim", () => {
    const r = enforceClaudeEnforcement({ projection: fixture() });
    expect(r.hasActiveRun).toBe(true);
    expect(r.allowedTools).toEqual(["Read", "Write", "Edit", "Bash"]);
    expect(r.phase).toBe("Code");
  });

  it("labels the active Phase(s), parallel included", () => {
    const r = enforceClaudeEnforcement({
      projection: { ...fixture(), phases: ["Design", "Tests"], phase: "Design" },
    });
    expect(r.phase).toBe("Design");
    expect(r.phases).toEqual(["Design", "Tests"]);
  });
});
