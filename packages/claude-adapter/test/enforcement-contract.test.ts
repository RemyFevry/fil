import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  parseRunProjection,
  serializeRunProjection,
  type RunProjection,
} from "@fil/contract";
import {
  enforceClaudeEnforcement,
  PROJECT_SKILLS_DIR,
  type ClaudeEnforcementDeps,
} from "../src/enforcement.js";

/**
 * The contract round-trip — proves the Claude enforcement surface agrees with
 * the `.fil/run.json` the orchestrator writes. Every field on
 * `ClaudeEnforcement` is asserted to be derivable from the projection alone.
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

function existsAt(skillPath: string, contextPaths: readonly string[]) {
  return (p: string): boolean => p === skillPath || contextPaths.includes(p);
}

function identityRealpath(allowed: readonly string[] = []) {
  return (p: string): string | undefined => (allowed.includes(p) ? p : undefined);
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
    const r = enforceClaudeEnforcement(
      { projection: contractFixture() },
      { projectRoot: "/proj", userFilDir: "/home/pilot/.fil", fileExists: () => false },
    );
    expect(r.hasActiveRun).toBe(true);
    expect(r.allowedTools).toEqual(["Read", "Write", "Edit", "Bash"]);
  });

  it("skillPaths resolve through project/user precedence from the contract", () => {
    const projectSkill = join("/proj", PROJECT_SKILLS_DIR, "tdd", "SKILL.md");
    const userSkill = join("/home/pilot/.fil", "skills", "review", "SKILL.md");
    const exists: ClaudeEnforcementDeps["fileExists"] = existsAt(projectSkill, []);
    const r = enforceClaudeEnforcement(
      { projection: contractFixture() },
      { projectRoot: "/proj", userFilDir: "/home/pilot/.fil", fileExists: exists },
    );
    expect(r.skillPaths).toEqual([projectSkill]);

    const existsUser: ClaudeEnforcementDeps["fileExists"] = existsAt(userSkill, []);
    const r2 = enforceClaudeEnforcement(
      { projection: contractFixture() },
      { projectRoot: "/proj", userFilDir: "/home/pilot/.fil", fileExists: existsUser },
    );
    expect(r2.skillPaths).toEqual([userSkill]);
  });

  it("contextPaths are the contract's context.files, resolved and filtered", () => {
    const r = enforceClaudeEnforcement(
      { projection: contractFixture() },
      {
        projectRoot: "/proj",
        userFilDir: "/home/pilot/.fil",
        fileExists: existsAt("", ["/proj/src/auth/login.ts", "/proj/docs/auth.md"]),
        realpath: identityRealpath(["/proj", "/proj/src/auth/login.ts", "/proj/docs/auth.md"]),
      },
    );
    expect(r.contextPaths).toEqual(["/proj/src/auth/login.ts", "/proj/docs/auth.md"]);
  });

  it("systemPrompt echoes every contract field the agent should see", () => {
    const r = enforceClaudeEnforcement(
      { projection: contractFixture() },
      { projectRoot: "/proj", userFilDir: "/home/pilot/.fil", fileExists: () => false },
    );
    const prompt = r.systemPrompt;
    expect(prompt).toContain("Implement the login flow in src/auth.");
    expect(prompt).toContain("Files in scope:");
    expect(prompt).toContain("- src/auth/login.ts");
    expect(prompt).toContain("- docs/auth.md");
    expect(prompt).toContain("Notes:");
    expect(prompt).toContain("Follow the team's auth conventions.");
    expect(prompt).toContain("Receipts from prior Phases:");
    expect(prompt).toContain(".fil/runs/run-0/receipts/receipt-1.json");
    expect(prompt).toContain("Run run-42");
    expect(prompt).toContain('change "add-login"');
    expect(prompt).toContain('flow "default"');
    expect(prompt).toContain("Phase Code");
    expect(prompt).toContain("Gate (to advance): test suite");
  });

  it("is dormant when the contract status is not active", () => {
    for (const status of ["done", "cancelled"] as const) {
      const r = enforceClaudeEnforcement(
        { projection: { ...contractFixture(), status } },
        { projectRoot: "/proj", userFilDir: "/home/pilot/.fil", fileExists: () => true },
      );
      expect(r.hasActiveRun).toBe(false);
      expect(r.allowedTools).toEqual([]);
      expect(r.systemPrompt).toBe("");
      expect(r.skillPaths).toEqual([]);
      expect(r.contextPaths).toEqual([]);
    }
  });

  it("parallel Phases in the contract surface in the prompt and the phases list", () => {
    const projection: RunProjection = {
      ...contractFixture(),
      phases: ["Design", "Tests"],
      phase: "Design",
    };
    const r = enforceClaudeEnforcement(
      { projection },
      { projectRoot: "/proj", userFilDir: "/home/pilot/.fil", fileExists: () => false },
    );
    expect(r.phases).toEqual(["Design", "Tests"]);
    expect(r.systemPrompt).toContain("Design, Tests (parallel)");
  });

  it("drops context files that escape the project root (no traversal surfacing)", () => {
    const projection: RunProjection = {
      ...contractFixture(),
      phaseConfig: {
        ...contractFixture().phaseConfig,
        context: {
          files: ["../../../etc/passwd", "/etc/hostname", "src/auth/login.ts"],
          priorResults: [],
        },
      },
    };
    const exists: ClaudeEnforcementDeps["fileExists"] = (p) =>
      p === "/proj/src/auth/login.ts" || p === "/etc/passwd" || p === "/etc/hostname";
    const r = enforceClaudeEnforcement(
      { projection },
      {
        projectRoot: "/proj",
        userFilDir: "/home/pilot/.fil",
        fileExists: exists,
        realpath: identityRealpath(["/proj", "/etc/passwd", "/etc/hostname", "/proj/src/auth/login.ts"]),
      },
    );
    expect(r.contextPaths).toEqual(["/proj/src/auth/login.ts"]);
  });
});
