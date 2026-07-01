import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { defaultFlowEngine } from "@fil/engine";
import { MemoryStore } from "@fil/store";
import {
  advance,
  back,
  cancel,
  project,
  startRun,
  type OrchestratorDeps,
} from "./index.js";

/** A linear test Flow: a (shell true) -> b (human) -> c (final). */
function testFlow(): Record<string, unknown> {
  const phase = (
    instructions: string,
    gate: Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ) => ({
    meta: {
      phase: {
        instructions,
        allowedTools: ["read"],
        skills: [],
        context: { files: [], priorResults: [] },
        actorMode: "agent",
        gate,
        ...extra,
      },
    },
  });
  return {
    id: "test",
    initial: "a",
    states: {
      a: { ...phase("Phase A", { type: "shell", script: "true" }), on: { NEXT: "b" } },
      b: { ...phase("Phase B", { type: "human", prompt: "Proceed?" }), on: { NEXT: "c" } },
      c: { ...phase("Phase C", { type: "shell", script: "true" }), type: "final" },
    },
  };
}

let cwd: string;
beforeAll(async () => {
  cwd = await mkdtemp(join(tmpdir(), "fil-orch-"));
});

function makeDeps(overrides: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
  return {
    store: new MemoryStore(),
    engine: defaultFlowEngine,
    cwd,
    ...overrides,
  };
}

describe("orchestrator.startRun", () => {
  it("creates a Run at the first Phase and writes the projection", async () => {
    const deps = makeDeps();
    const result = await startRun(deps, {
      change: "feature",
      flowName: "test",
      definition: testFlow(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.run.status).toBe("active");
    expect(result.projection.phase).toBe("a");
    expect(deps.store.readProjection()?.phase).toBe("a");
  });

  it("snapshots the Flow so the Run is reproducible after the Flow is edited", async () => {
    const deps = makeDeps();
    const result = await startRun(deps, {
      change: "feature",
      flowName: "test",
      definition: testFlow(),
    });
    if (!result.ok) return;
    // Mutate the (irrelevant) live flow on disk; the Run keeps its snapshot.
    deps.store.writeFlow("test", { id: "test", initial: "z", states: {} });
    const advanced = await advance(deps, result.run);
    expect(advanced.advanced).toBe(true);
    expect(advanced.run.history[advanced.run.history.length - 1]?.phases).toEqual(["b"]);
  });
});

describe("orchestrator.advance", () => {
  it("runs a passing shell Gate and transitions", async () => {
    const deps = makeDeps();
    const start = await startRun(deps, { change: "x", flowName: "test", definition: testFlow() });
    if (!start.ok) return;
    const out = await advance(deps, start.run);
    expect(out.advanced).toBe(true);
    expect(out.receipts[0]?.outcome).toBe("pass");
    expect(deps.store.readProjection()?.phase).toBe("b");
  });

  it("keeps the Run in place when a Gate fails, with evidence", async () => {
    const flow = testFlow();
    // Make phase a's gate fail.
    const states = flow.states as Record<
      string,
      { meta: { phase: { gate: { script: string; type: string } } } }
    >;
    const phaseA = states.a;
    if (phaseA) phaseA.meta.phase.gate = { type: "shell", script: "exit 1" };
    const deps = makeDeps();
    const start = await startRun(deps, { change: "x", flowName: "test", definition: flow });
    if (!start.ok) return;
    const out = await advance(deps, start.run);
    expect(out.advanced).toBe(false);
    expect(out.receipts[0]?.outcome).toBe("fail");
    expect(out.error).toContain("Gate failed");
    expect(deps.store.readProjection()?.phase).toBe("a");
    // The fail receipt is stored per Run.
    const stored = deps.store.readRunState(start.run.runId);
    expect(stored?.receipts.length).toBe(1);
  });

  it("blocks on a human Gate until confirmed", async () => {
    const deps = makeDeps({ prompter: async () => false });
    const start = await startRun(deps, { change: "x", flowName: "test", definition: testFlow() });
    if (!start.ok) return;
    // a's shell gate passes; then we land on b — but advance runs a's gate first.
    let out = await advance(deps, start.run); // a -> b
    expect(out.advanced).toBe(true);
    // Now at b (human gate). Decline → fail, stays.
    out = await advance(deps, out.run);
    expect(out.advanced).toBe(false);
    expect(out.receipts[0]?.outcome).toBe("fail");
    expect(out.receipts[0]?.evidence?.confirmed).toBe(false);

    // Confirm now → advance.
    deps.prompter = async () => true;
    out = await advance(deps, out.run);
    expect(out.advanced).toBe(true);
    expect(out.done).toBe(true);
  });

  it("rejects advancing a completed Run", async () => {
    const deps = makeDeps({ prompter: async () => true });
    const start = await startRun(deps, { change: "x", flowName: "test", definition: testFlow() });
    if (!start.ok) return;
    let run = start.run;
    for (let i = 0; i < 2; i++) {
      run = (await advance(deps, run)).run;
    }
    expect(deps.store.readProjection()?.status).toBe("done");
    const out = await advance(deps, run);
    expect(out.advanced).toBe(false);
    expect(out.error).toContain("already complete");
  });
});

describe("orchestrator back / cancel", () => {
  it("retreats one Phase", async () => {
    const deps = makeDeps();
    const start = await startRun(deps, { change: "x", flowName: "test", definition: testFlow() });
    if (!start.ok) return;
    const advanced = await advance(deps, start.run); // a -> b
    const out = back(deps, advanced.run);
    expect(out.retreated).toBe(true);
    expect(deps.store.readProjection()?.phase).toBe("a");
  });

  it("is a safe no-op at the initial Phase", async () => {
    const deps = makeDeps();
    const start = await startRun(deps, { change: "x", flowName: "test", definition: testFlow() });
    if (!start.ok) return;
    const out = back(deps, start.run);
    expect(out.retreated).toBe(false);
    expect(out.error).toContain("initial");
  });

  it("cancel ends the Run and blocks further advance", async () => {
    const deps = makeDeps();
    const start = await startRun(deps, { change: "x", flowName: "test", definition: testFlow() });
    if (!start.ok) return;
    const cancelled = cancel(deps, start.run);
    expect(cancelled.status).toBe("cancelled");
    expect(deps.store.readProjection()?.status).toBe("cancelled");
    const out = await advance(deps, cancelled);
    expect(out.advanced).toBe(false);
    expect(out.error).toContain("cancelled");
  });
});

describe("orchestrator.project", () => {
  it("reflects the primary active Phase and its config", async () => {
    const deps = makeDeps();
    const start = await startRun(deps, { change: "x", flowName: "test", definition: testFlow() });
    if (!start.ok) return;
    const instance = defaultFlowEngine.load("test", testFlow());
    if (!instance.ok) throw new Error("load");
    const proj = project(start.run, instance.instance);
    expect(proj.actorMode).toBe("agent");
    expect(proj.phases).toEqual(["a"]);
  });
});

/** Build a parallel Flow: left.l1 (shell gate) and right.r1 (shell gate) -> finals. */
function parallelFlow(rightScript: string): Record<string, unknown> {
  const leaf = (instructions: string, gate: Record<string, unknown>, final = false) => {
    const node: Record<string, unknown> = {
      meta: {
        phase: {
          instructions,
          allowedTools: [],
          skills: [],
          context: { files: [], priorResults: [] },
          actorMode: "agent",
          gate,
        },
      },
    };
    if (final) node.type = "final";
    return node;
  };
  return {
    id: "par",
    type: "parallel",
    states: {
      left: {
        initial: "l1",
        states: {
          l1: { ...leaf("L1", { type: "shell", script: "true" }), on: { NEXT: "l2" } },
          l2: leaf("L2", { type: "shell", script: "true" }, true),
        },
      },
      right: {
        initial: "r1",
        states: {
          r1: { ...leaf("R1", { type: "shell", script: rightScript }), on: { NEXT: "r2" } },
          r2: leaf("R2", { type: "shell", script: "true" }, true),
        },
      },
    },
  };
}

describe("orchestrator — parallel Phases (#19)", () => {
  it("starts with multiple active Phases reflected in the projection", async () => {
    const deps = makeDeps();
    const result = await startRun(deps, {
      change: "x",
      flowName: "par",
      definition: parallelFlow("true"),
    });
    if (!result.ok) return;
    expect(result.projection.phases.sort()).toEqual(["left.l1", "right.r1"]);
    expect(deps.store.readProjection()?.phases.length).toBe(2);
  });

  it("converges when all parallel sub-Gates pass", async () => {
    const deps = makeDeps();
    const start = await startRun(deps, {
      change: "x",
      flowName: "par",
      definition: parallelFlow("true"),
    });
    if (!start.ok) return;
    const out = await advance(deps, start.run);
    expect(out.advanced).toBe(true);
    expect(out.done).toBe(true);
    expect(out.receipts.length).toBe(2); // both sub-Gates ran
  });

  it("does not advance when any sub-Gate fails", async () => {
    const deps = makeDeps();
    const start = await startRun(deps, {
      change: "x",
      flowName: "par",
      definition: parallelFlow("exit 1"), // right gate fails
    });
    if (!start.ok) return;
    const out = await advance(deps, start.run);
    expect(out.advanced).toBe(false);
    expect(out.receipts.some((r) => r.outcome === "pass")).toBe(true);
    expect(out.receipts.some((r) => r.outcome === "fail")).toBe(true);
    expect(deps.store.readProjection()?.phases.sort()).toEqual(["left.l1", "right.r1"]);
  });
});
