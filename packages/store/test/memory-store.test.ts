import { describe, expect, it } from "vitest";
import type { RunProjection } from "@color-sunset/fil-contract";
import { MemoryStore } from "../src/memory-store.js";
import type { RunState } from "../src/types.js";

const sampleProjection: RunProjection = {
  runId: "run-1",
  change: "add-login",
  flowName: "default",
  status: "active",
  phase: "requirements",
  phases: ["requirements"],
  actorMode: "collaborative",
  phaseConfig: {
    instructions: "x",
    allowedTools: [],
    skills: [],
    context: { files: [], priorResults: [] },
    actorMode: "collaborative",
    gates: [{ name: "noop", type: "shell", script: "true" }],
  },
};

const sampleRun: RunState = {
  runId: "run-1",
  change: "add-login",
  flowName: "default",
  status: "active",
  createdAt: "2026-07-01T00:00:00.000Z",
  history: [{ at: "2026-07-01T00:00:00.000Z", action: "start", phases: ["requirements"] }],
  positions: [{ phases: ["requirements"], snapshot: { value: "requirements", status: "active" } }],
  receipts: [],
};

describe("MemoryStore parity", () => {
  it("ensureLayout is a no-op (no directory required)", () => {
    const store = new MemoryStore();
    expect(() => store.ensureLayout()).not.toThrow();
    expect(store.readConfig()).toBeNull();
  });

  it("round-trips config", () => {
    const store = new MemoryStore().withDefaultConfig();
    expect(store.readConfig()?.defaultFlow).toBe("default");
  });

  it("round-trips Flow text and listFlows", () => {
    const store = new MemoryStore();
    store.writeFlowText("default", "export default {};\n");
    expect(store.flowExists("default")).toBe(true);
    expect(store.readFlowText("default")).toContain("export default");
    expect(store.listFlows()).toContain("default");
  });

  it("round-trips run state and flow snapshot", () => {
    const store = new MemoryStore();
    store.writeRunState(sampleRun);
    expect(store.readRunState("run-1")?.change).toBe("add-login");
    expect(store.listRuns()).toContain("run-1");

    store.writeFlowSnapshot("run-1", { id: "default", states: {} });
    expect(store.readFlowSnapshot("run-1")?.["id"]).toBe("default");
  });

  it("round-trips projections and clearProjection", () => {
    const store = new MemoryStore();
    store.writeProjection(sampleProjection);
    expect(store.readProjection()?.phase).toBe("requirements");
    store.clearProjection();
    expect(store.readProjection()).toBeNull();
  });

  it("round-trips proposals and removeProposal", () => {
    const store = new MemoryStore();
    store.writeProposal("001", "--- a\n+++ b\n@@ -1 +1 @@\n");
    expect(store.listProposals()).toContain("001");
    expect(store.readProposal("001")?.startsWith("---")).toBe(true);
    store.removeProposal("001");
    expect(store.readProposal("001")).toBeNull();
  });

  it("returns defensive clones on read (mutations don't leak back)", () => {
    const store = new MemoryStore();
    store.writeRunState(sampleRun);
    store.writeProjection(sampleProjection);
    store.writeFlowSnapshot("run-1", { id: "x" });
    store.writeConfig({ defaultFlow: "default", agentRuntimes: [] });

    const runA = store.readRunState("run-1");
    if (!runA) throw new Error("expected run state");
    runA.change = "mutated";
    expect(store.readRunState("run-1")?.change).toBe("add-login");

    const proj = store.readProjection();
    if (!proj) throw new Error("expected projection");
    proj.phase = "mutated";
    expect(store.readProjection()?.phase).toBe("requirements");

    const snap = store.readFlowSnapshot("run-1");
    if (!snap) throw new Error("expected snapshot");
    (snap as Record<string, unknown>)["id"] = "mutated";
    expect(store.readFlowSnapshot("run-1")?.["id"]).toBe("x");

    const cfg = store.readConfig();
    if (!cfg) throw new Error("expected config");
    cfg.defaultFlow = "mutated";
    expect(store.readConfig()?.defaultFlow).toBe("default");
  });
});