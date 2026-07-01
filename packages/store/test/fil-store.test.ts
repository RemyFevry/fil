import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FilStore } from "../src/fil-store.js";
import type { RunState } from "../src/types.js";

let workdir: string;
let store: FilStore;

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), "fil-store-"));
  store = new FilStore(join(workdir, ".fil"));
});

afterAll(async () => {
  await rm(workdir, { recursive: true, force: true });
});

const sampleRun: RunState = {
  runId: "run-1",
  change: "add-login",
  flowName: "default",
  status: "active",
  createdAt: "2026-07-01T00:00:00.000Z",
  history: [{ at: "2026-07-01T00:00:00.000Z", action: "start", phases: ["requirements"] }],
  positions: [
    { phases: ["requirements"], snapshot: { value: "requirements", status: "active" } },
  ],
  receipts: [],
};

describe("FilStore (real fs, tmpdir)", () => {
  it("ensureLayout creates the durable layout and a default config", () => {
    store.ensureLayout();
    expect(store.readConfig()?.defaultFlow).toBe("default");
  });

  it("round-trips a Flow definition as code", () => {
    store.writeFlowText("default", "export default { id: \"default\" };\n");
    expect(store.flowExists("default")).toBe(true);
    expect(store.readFlowText("default")).toContain("export default");
    expect(store.listFlows()).toContain("default");
  });

  it("round-trips a Run state and survives a restart", () => {
    store.writeRunState(sampleRun);
    const reopened = new FilStore(join(workdir, ".fil"));
    const read = reopened.readRunState("run-1");
    expect(read?.change).toBe("add-login");
    expect(read?.history[0]?.phases).toEqual(["requirements"]);
    expect(read?.positions[0]?.phases).toEqual(["requirements"]);
    expect(reopened.listRuns()).toContain("run-1");
  });

  it("round-trips a flow snapshot for a Run", () => {
    store.writeFlowSnapshot("run-1", { id: "default", states: {} });
    const snap = store.readFlowSnapshot("run-1");
    expect(snap?.["id"]).toBe("default");
  });

  it("round-trips the run.json projection", () => {
    const projection = {
      runId: "run-1",
      change: "add-login",
      flowName: "default",
      status: "active" as const,
      phase: "requirements",
      phases: ["requirements"],
      actorMode: "collaborative" as const,
      phaseConfig: {
        instructions: "x",
        allowedTools: [],
        skills: [],
        context: { files: [], priorResults: [] },
        actorMode: "collaborative" as const,
        gate: { type: "shell" as const, script: "true" },
      },
    };
    store.writeProjection(projection);
    expect(store.readProjection()?.phase).toBe("requirements");
    store.clearProjection();
    expect(store.readProjection()).toBeNull();
  });

  it("round-trips proposals", () => {
    store.writeProposal("001", "--- a\n+++ b\n@@ -1 +1 @@\n");
    expect(store.listProposals()).toContain("001");
    expect(store.readProposal("001")?.startsWith("---")).toBe(true);
    store.removeProposal("001");
    expect(store.readProposal("001")).toBeNull();
  });
});
