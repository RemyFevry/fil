import { describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { builtInFlow, defaultFlowEngine, serializeFlowCode } from "@color-sunset/fil-engine";
import {
  applyProposal,
  applyUnifiedDiff,
  createUnifiedPatch,
  loadFlowCode,
  pickTempRoot,
} from "../src/index.js";

const flow = builtInFlow("default")!;
const deps = { engine: defaultFlowEngine, flowName: "default", loadCode: loadFlowCode };

/** Render a definition as engine-native code (the durable flow-file form). */
function code(obj: unknown): string {
  const config = (obj as { config?: unknown }).config ?? obj;
  return serializeFlowCode(config as Parameters<typeof serializeFlowCode>[0]);
}

const baseCode = code(flow.rawConfig);

describe("evolution.applyProposal", () => {
  it("accepts a valid patch and returns loadable newCode", async () => {
    const next = structuredClone(flow.rawConfig) as Record<string, unknown>;
    const states = next.states as Record<string, { meta: { phase: { instructions: string } } }>;
    const codeState = states.code;
    if (codeState) codeState.meta.phase.instructions = "Implement the change, with tests.";

    const patch = createUnifiedPatch(baseCode, code(next));
    const result = await applyProposal(baseCode, patch, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const loaded = await loadFlowCode(result.newCode);
      expect(loaded.ok).toBe(true);
      if (loaded.ok) {
        expect(defaultFlowEngine.load("default", loaded.definition).ok).toBe(true);
      }
    }
  });

  it("fails with 'load' on syntactically broken code", async () => {
    const broken = "export default { broken";
    const patch = createUnifiedPatch(baseCode, broken);
    const result = await applyProposal(baseCode, patch, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("load");
  });

  it("fails with 'load' when the patch produces a non-machine config", async () => {
    const stripped = code({ id: "default", initial: "requirements", states: {} });
    const patch = createUnifiedPatch(baseCode, stripped);
    const result = await applyProposal(baseCode, patch, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("load");
  });

  it("fails with 'reachability' when a new Phase is unreachable", async () => {
    const next = structuredClone(flow.rawConfig) as Record<string, unknown>;
    const states = next.states as Record<string, unknown>;
    states.orphan = {
      meta: { phase: { instructions: "x", gates: [{ name: "noop", type: "shell", script: "true" }] } },
    };
    const patch = createUnifiedPatch(baseCode, code(next));
    const result = await applyProposal(baseCode, patch, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("reachability");
  });

  it("fails with 'reachability' when a Phase deadlocks (cannot reach a terminal)", async () => {
    const next = structuredClone(flow.rawConfig) as Record<string, unknown>;
    const states = next.states as Record<
      string,
      { meta: { phase: { instructions: string; gates: { name: string; type: string }[] } }; on?: Record<string, string> }
    >;
    const review = states.review;
    if (review) delete review.on;
    const patch = createUnifiedPatch(baseCode, code(next));
    const result = await applyProposal(baseCode, patch, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("reachability");
  });

  it("does not touch disk (delegates code execution to the injected loader)", async () => {
    const next = structuredClone(flow.rawConfig);
    const patch = createUnifiedPatch(baseCode, code(next));
    await expect(applyProposal(baseCode, patch, deps)).resolves.toBeDefined();
  });
});

describe("evolution diff round-trip", () => {
  it("applyUnifiedDiff(createUnifiedPatch(a, b)) === b", () => {
    const next = structuredClone(flow.rawConfig) as Record<string, unknown>;
    const codeState = (next.states as Record<string, { meta: { phase: { instructions: string } } }>).code;
    if (codeState) codeState.meta.phase.instructions = "Changed.";
    const b = code(next);
    const patch = createUnifiedPatch(baseCode, b);
    expect(applyUnifiedDiff(baseCode, patch)).toBe(b);
  });

  it("an empty patch string means no change", () => {
    expect(createUnifiedPatch(baseCode, baseCode)).toBe("");
  });
});

describe("pickTempRoot", () => {
  it("returns the cwd candidate when it is writable", async () => {
    const root = await pickTempRoot();
    expect(root).toBe(process.cwd());
  });

  it("falls back to the next candidate when the first is unwritable", async () => {
    // A path under a non-existent directory root cannot be created; `mkdtemp`
    // throws, the loop falls through to the next candidate, and the test
    // confirms `os.tmpdir()` is reachable from there.
    const root = await pickTempRoot(["/__nonexistent_root__", tmpdir()]);
    expect(root).toBe(tmpdir());
  });

  it("throws when no candidate is writable", async () => {
    await expect(
      pickTempRoot(["/__nonexistent_a__", "__/nonexistent_b__"]),
    ).rejects.toThrow(/writable temp directory/);
  });
});
