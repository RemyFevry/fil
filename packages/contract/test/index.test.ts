import { describe, expect, it } from "vitest";
import {
  parseRunProjection,
  serializeRunProjection,
  validate,
  RunProjectionSchema,
  type RunProjection,
} from "../src/index.js";

const valid: RunProjection = {
  runId: "run-1",
  change: "add-login",
  flowName: "default",
  status: "active",
  phase: "Code",
  phases: ["Code"],
  actorMode: "agent",
  phaseConfig: {
    instructions: "Write the code.",
    allowedTools: ["read", "write", "edit", "bash"],
    skills: ["tdd"],
    context: { files: ["src/"], notes: "prior phase notes", priorResults: [] },
    actorMode: "agent",
    gate: { type: "testsPass" },
  },
};

describe("contract validation", () => {
  it("round-trips a valid run.json document", () => {
    const serialized = serializeRunProjection(valid);
    expect(serialized.ok).toBe(true);

    const parsed = parseRunProjection(serialized.ok ? serialized.value : "");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.runId).toBe("run-1");
      expect(parsed.value.phaseConfig.gate.type).toBe("testsPass");
    }
  });

  it("round-trips preserves the canonical shape", () => {
    const result = validate(RunProjectionSchema, valid);
    expect(result.ok).toBe(true);
    const reValidated = validate(RunProjectionSchema, result.ok ? result.value : null);
    expect(reValidated.ok).toBe(true);
  });

  it("rejects a malformed document with a clear error", () => {
    const bad = parseRunProjection('{"runId":"x"}');
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error).toContain("change");
      expect(bad.error).toContain("phaseConfig");
    }
  });

  it("rejects non-JSON with a clear error", () => {
    const bad = parseRunProjection("{not json");
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toContain("not valid JSON");
  });

  it("rejects an unknown gate type", () => {
    const invalid = {
      ...valid,
      phaseConfig: { ...valid.phaseConfig, gate: { type: "magic" } },
    };
    const result = validate(RunProjectionSchema, invalid);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("gate");
  });

  it("accepts a human-confirmation gate", () => {
    const humanGate = {
      ...valid,
      phaseConfig: { ...valid.phaseConfig, gate: { type: "human" } },
    };
    expect(validate(RunProjectionSchema, humanGate).ok).toBe(true);
  });

  it("accepts parallel active phases", () => {
    const parallel = {
      ...valid,
      phase: "Design",
      phases: ["Design", "Tests"],
    };
    expect(validate(RunProjectionSchema, parallel).ok).toBe(true);
  });
});
