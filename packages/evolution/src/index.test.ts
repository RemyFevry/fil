import { describe, expect, it } from "vitest";
import { builtInFlow, defaultFlowEngine } from "@fil/engine";
import {
  applyProposal,
  applyUnifiedDiff,
  createUnifiedPatch,
} from "./index.js";

const flow = builtInFlow("default")!;
const deps = { engine: defaultFlowEngine, flowName: "default" };

/** Pretty-print a flow definition as the durable flow-file text. */
function code(obj: unknown): string {
  return JSON.stringify(obj, null, 2) + "\n";
}

const baseCode = code(flow.definition);

describe("evolution.applyProposal", () => {
  it("accepts a valid patch and returns loadable newCode", () => {
    const next = structuredClone(flow.definition) as Record<string, unknown>;
    const states = next.states as Record<
      string,
      { meta: { phase: { instructions: string } } }
    >;
    const codeState = states.code;
    if (codeState) codeState.meta.phase.instructions = "Implement the change, with tests.";

    const patch = createUnifiedPatch(baseCode, code(next));
    const result = applyProposal(baseCode, patch, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const reloaded = defaultFlowEngine.load("default", JSON.parse(result.newCode));
      expect(reloaded.ok).toBe(true);
    }
  });

  it("fails with 'load' on a syntactically broken patch", () => {
    const broken = baseCode.replace(
      '"instructions": "Gather',
      '"instructions": GATHER BROKEN',
    );
    const patch = createUnifiedPatch(baseCode, broken);
    const result = applyProposal(baseCode, patch, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("load");
  });

  it("fails with 'load' when the patch produces a non-machine config", () => {
    // Strip the states map entirely.
    const stripped = code({ id: "default", initial: "requirements", states: {} });
    const patch = createUnifiedPatch(baseCode, stripped);
    const result = applyProposal(baseCode, patch, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("load");
  });

  it("fails with 'reachability' when a new Phase is unreachable", () => {
    const next = structuredClone(flow.definition) as Record<string, unknown>;
    const states = next.states as Record<string, unknown>;
    states.orphan = {
      meta: { phase: { instructions: "x", gate: { type: "shell", script: "true" } } },
    };
    const patch = createUnifiedPatch(baseCode, code(next));
    const result = applyProposal(baseCode, patch, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("reachability");
  });

  it("fails with 'reachability' when a Phase deadlocks (cannot reach a terminal)", () => {
    const next = structuredClone(flow.definition) as Record<string, unknown>;
    const states = next.states as Record<
      string,
      { meta: { phase: { instructions: string; gate: { type: string } } }; on?: Record<string, string> }
    >;
    // Remove the review -> done transition, stranding review.
    const review = states.review;
    if (review) delete review.on;
    const patch = createUnifiedPatch(baseCode, code(next));
    const result = applyProposal(baseCode, patch, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("reachability");
  });

  it("is pure — no I/O", () => {
    const next = structuredClone(flow.definition);
    const patch = createUnifiedPatch(baseCode, code(next));
    expect(() => applyProposal(baseCode, patch, deps)).not.toThrow();
  });
});

describe("evolution diff round-trip", () => {
  it("applyUnifiedDiff(createUnifiedPatch(a, b)) === b", () => {
    const next = structuredClone(flow.definition) as Record<string, unknown>;
    const states = next.states as Record<
      string,
      { meta: { phase: { instructions: string } } }
    >;
    const codeState = states.code;
    if (codeState) codeState.meta.phase.instructions = "Changed.";
    const b = code(next);
    const patch = createUnifiedPatch(baseCode, b);
    expect(applyUnifiedDiff(baseCode, patch)).toBe(b);
  });

  it("an empty patch string means no change", () => {
    expect(createUnifiedPatch(baseCode, baseCode)).toBe("");
  });
});
