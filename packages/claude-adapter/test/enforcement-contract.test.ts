import { describe, expect, it } from "vitest";
import {
  parseRunProjection,
  serializeRunProjection,
  type RunProjection,
} from "@color-sunset/fil-contract";
import { enforceClaudeEnforcement, decideToolUse } from "../src/enforcement.js";

/**
 * The contract round-trip — proves the Claude enforcement surface agrees with
 * the `.fil/run.json` the orchestrator writes, and that the PreToolUse decision
 * is derivable from the projection alone.
 */

function contractFixture(): RunProjection {
  return {
    runId: "run-42",
    change: "add-login",
    flowName: "default",
    status: "active",
    phase: "Code",
    phases: ["Code"],
    actorMode: "agent",
    phaseConfig: {
      instructions: "Implement the login flow in src/auth.",
      allowedTools: ["Read", "Write", "Edit", "Bash"],
      skills: ["tdd", "review"],
      context: {
        files: ["src/auth/login.ts", "docs/auth.md"],
        notes: "Follow the team's auth conventions.",
        priorResults: [".fil/runs/run-0/receipts/receipt-1.json"],
      },
      actorMode: "agent",
      gate: { type: "testsPass", command: "pnpm test" },
    },
  };
}

describe("Claude enforcement ↔ contract (round-trip)", () => {
  it("the projection validates against the contract schema", () => {
    const projection = contractFixture();
    const serialized = serializeRunProjection(projection);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;
    const parsed = parseRunProjection(serialized.value);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual(projection);
  });

  it("allowedTools come straight from the contract's phaseConfig", () => {
    const r = enforceClaudeEnforcement({ projection: contractFixture() });
    expect(r.hasActiveRun).toBe(true);
    expect(r.allowedTools).toEqual(["Read", "Write", "Edit", "Bash"]);
  });

  it("is dormant when the contract status is not active", () => {
    for (const status of ["done", "cancelled"] as const) {
      const r = enforceClaudeEnforcement({ projection: { ...contractFixture(), status } });
      expect(r.hasActiveRun).toBe(false);
      expect(r.allowedTools).toEqual([]);
    }
  });

  it("parallel Phases in the contract surface in the phases list", () => {
    const r = enforceClaudeEnforcement({
      projection: { ...contractFixture(), phases: ["Design", "Tests"], phase: "Design" },
    });
    expect(r.phases).toEqual(["Design", "Tests"]);
  });

  it("decideToolUse derives the block/allow from the contract alone", () => {
    const p = contractFixture();
    expect(decideToolUse(p, "Read").allow).toBe(true);
    expect(decideToolUse(p, "Bash").allow).toBe(true);
    const denied = decideToolUse(p, "WebSearch");
    expect(denied.allow).toBe(false);
    expect(denied.reason).toContain("Code");
    expect(denied.reason).toContain("WebSearch");
  });
});
