import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  enforcePiEnforcement,
  PROJECT_SKILLS_DIR,
  type PiEnforcementDeps,
} from "../src/enforcement.js";
import type { RunProjection } from "@fil/contract";

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
      allowedTools: ["read", "write", "edit", "bash"],
      skills: ["tdd", "bad name"],
      context: {
        files: ["src/auth/login.ts"],
        notes: "Follow the team's auth conventions.",
        priorResults: [".fil/runs/run-0/receipts/receipt-1.json"],
      },
      actorMode: "agent",
      gate: { type: "testsPass", command: "pnpm test" },
    },
  };
}

const ABSENT: PiEnforcementDeps["fileExists"] = () => false;
const PRESENT = (path: string): boolean => {
  if (path.endsWith("/SKILL.md")) return true;
  return false;
};

describe("enforcePiEnforcement — pure logic", () => {
  it("is dormant when the Run is not active", () => {
    const result = enforcePiEnforcement(
      { projection: { ...fixture(), status: "done" } },
      { projectRoot: "/x", userFilDir: "/x/.fil", fileExists: ABSENT },
    );
    expect(result.hasActiveRun).toBe(false);
    expect(result.allowedTools).toEqual([]);
    expect(result.systemPrompt).toBe("");
  });

  it("returns the contract's allowedTools verbatim", () => {
    const r = enforcePiEnforcement(
      { projection: fixture() },
      { projectRoot: "/x", userFilDir: "/x/.fil", fileExists: ABSENT },
    );
    expect(r.allowedTools).toEqual(["read", "write", "edit", "bash"]);
  });

  it("composes the system prompt from instructions + context + Fil footer", () => {
    const r = enforcePiEnforcement(
      { projection: fixture() },
      { projectRoot: "/x", userFilDir: "/x/.fil", fileExists: ABSENT },
    );
    expect(r.systemPrompt).toContain("Write the code in src/auth.");
    expect(r.systemPrompt).toContain("Files in scope:");
    expect(r.systemPrompt).toContain("- src/auth/login.ts");
    expect(r.systemPrompt).toContain("Notes:");
    expect(r.systemPrompt).toContain("Receipts from prior Phases:");
    expect(r.systemPrompt).toContain("Run run-1");
    expect(r.systemPrompt).toContain("change \"add-login\"");
    expect(r.systemPrompt).toContain("Phase Code");
    expect(r.systemPrompt).toContain("Gate (to advance): test suite");
  });

  it("resolves skills through project precedence first, then user", () => {
    const exists: PiEnforcementDeps["fileExists"] = (p) => {
      // The project's `tdd` skill exists; the user's does not.
      if (p === join("/x", PROJECT_SKILLS_DIR, "tdd", "SKILL.md")) return true;
      if (p === join("/x/.fil", "skills", "review", "SKILL.md")) return true;
      return false;
    };
    const projection: RunProjection = {
      ...fixture(),
      phaseConfig: {
        ...fixture().phaseConfig,
        skills: ["tdd", "review"],
      },
    };
    const r = enforcePiEnforcement(
      { projection },
      { projectRoot: "/x", userFilDir: "/x/.fil", fileExists: exists },
    );
    expect(r.skillPaths).toEqual([
      join("/x", PROJECT_SKILLS_DIR, "tdd", "SKILL.md"),
      join("/x/.fil", "skills", "review", "SKILL.md"),
    ]);
  });

  it("skips a skill that fails the safe-name check (no path traversal)", () => {
    // Only "bad name" — even if it "exists" on disk, the safe-name filter
    // rejects names with a space (or any non-`[a-z0-9-]` character), so the
    // resolved path list is empty. This proves the filter, not the disk check,
    // is what drops the entry.
    const proj: RunProjection = {
      ...fixture(),
      phaseConfig: { ...fixture().phaseConfig, skills: ["bad name"] },
    };
    const r = enforcePiEnforcement(
      { projection: proj },
      { projectRoot: "/x", userFilDir: "/x/.fil", fileExists: PRESENT },
    );
    expect(r.skillPaths).toEqual([]);
  });

  it("drops context files that don't exist on disk (fail-closed rendering)", () => {
    const r = enforcePiEnforcement(
      { projection: fixture() },
      { projectRoot: "/x", userFilDir: "/x/.fil", fileExists: () => false },
    );
    expect(r.contextPaths).toEqual([]);
  });

  it("keeps context files that exist (project-relative → joined with projectRoot)", () => {
    const target = join("/x", "src/auth/login.ts");
    const exists: PiEnforcementDeps["fileExists"] = (p) => p === target;
    const r = enforcePiEnforcement(
      { projection: fixture() },
      {
        projectRoot: "/x",
        userFilDir: "/x/.fil",
        fileExists: exists,
        realpath: (p) => p, // synthetic FS — no symlinks
      },
    );
    expect(r.contextPaths).toEqual([target]);
  });

  it("labels the active Phase(s) in the contract, parallel included", () => {
    const r = enforcePiEnforcement(
      {
        projection: {
          ...fixture(),
          phases: ["Design", "Tests"],
          phase: "Design",
        },
      },
      { projectRoot: "/x", userFilDir: "/x/.fil", fileExists: ABSENT },
    );
    expect(r.phase).toBe("Design");
    expect(r.phases).toEqual(["Design", "Tests"]);
  });
});
