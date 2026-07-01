import { describe, expect, it } from "vitest";
import { defaultFlowEngine, builtInFlow } from "../src/index.js";
import type { FlowEngine, EngineInstance, FlowDefinition } from "../src/seam.js";

const defaultFlow = builtInFlow("default");
if (!defaultFlow) throw new Error("default flow missing");

const loadDefault = (): EngineInstance => {
  const result = defaultFlowEngine.load("default", defaultFlow.definition);
  if (!result.ok) throw new Error(result.error);
  return result.instance;
};

describe("XStateFlowEngine — built-in default Flow", () => {
  it("loads and reports the initial Phase", () => {
    const engine = loadDefault();
    const status = engine.getStatus(engine.initial());
    expect(status.activePhases).toEqual(["requirements"]);
    expect(status.parallel).toBe(false);
    expect(status.done).toBe(false);
  });

  it("transitions on send and reports the new Phase", () => {
    const engine = loadDefault();
    let snap = engine.initial();
    snap = engine.send(snap, "NEXT");
    expect(engine.getStatus(snap).activePhases).toEqual(["design"]);
    snap = engine.send(snap, "NEXT");
    expect(engine.getStatus(snap).activePhases).toEqual(["code"]);
  });

  it("reports canTransition correctly", () => {
    const engine = loadDefault();
    const snap = engine.initial();
    expect(engine.canTransition(snap, "NEXT")).toBe(true);
    expect(engine.canTransition(snap, "BOGUS")).toBe(false);
  });

  it("reaches done at the terminal Phase", () => {
    const engine = loadDefault();
    let snap = engine.initial();
    for (let i = 0; i < 4; i++) snap = engine.send(snap, "NEXT");
    const status = engine.getStatus(snap);
    expect(status.activePhases).toEqual(["done"]);
    expect(status.done).toBe(true);
    expect(engine.canTransition(snap, "NEXT")).toBe(false);
  });

  it("carries per-Phase config via getPhaseConfig", () => {
    const engine = loadDefault();
    const code = engine.getPhaseConfig("code");
    expect(code?.actorMode).toBe("agent");
    expect(code?.gate.type).toBe("testsPass");
    expect(code?.allowedTools).toContain("bash");
    expect(code?.skills).toContain("tdd");
  });

  it("snapshots are JSON-serializable and restore (durable)", () => {
    const engine = loadDefault();
    let snap = engine.initial();
    snap = engine.send(snap, "NEXT"); // -> design
    const persisted = JSON.parse(JSON.stringify(snap));
    expect(engine.getStatus(persisted).activePhases).toEqual(["design"]);
    expect(engine.canTransition(persisted, "NEXT")).toBe(true);
    const next = engine.send(persisted, "NEXT");
    expect(engine.getStatus(next).activePhases).toEqual(["code"]);
  });

  it("serialize() produces a neutral Flow graph", () => {
    const engine = loadDefault();
    const graph = engine.serialize();
    expect(graph.flowName).toBe("default");
    expect(graph.initial).toEqual(["requirements"]);
    const ids = graph.nodes.map((n) => n.id);
    expect(ids).toEqual(
      expect.arrayContaining(["requirements", "design", "code", "review", "done"]),
    );
    const doneNode = graph.nodes.find((n) => n.id === "done");
    expect(doneNode?.final).toBe(true);
    expect(
      graph.transitions.some(
        (t) => t.from === "code" && t.to === "review" && t.event === "NEXT",
      ),
    ).toBe(true);
  });

  it("rejects an invalid Flow with a load error", () => {
    const broken: FlowDefinition = { initial: "missing", states: {} };
    const result = defaultFlowEngine.load("broken", broken);
    expect(result.ok).toBe(false);
  });
});

describe("FlowEngine seam — fake in-memory engine (no library coupling)", () => {
  // A hand-rolled engine proving the seam is usable WITHOUT XState.
  const makeFakeEngine = (): FlowEngine => {
    const order = ["a", "b", "final"];
    return {
      load(name, _def) {
        const indexOf = (phase: string) => order.indexOf(phase);
        const instance: EngineInstance = {
          flowName: name,
          initial: () => ({ value: "a", status: "active" }),
          send: (snap, _event) => {
            const current = String(snap.value);
            const idx = indexOf(current);
            const next = order[idx + 1];
            if (!next) return snap;
            return {
              value: next,
              status: next === "final" ? "done" : "active",
            };
          },
          canTransition: (snap, _event) => {
            const idx = indexOf(String(snap.value));
            return idx >= 0 && idx < order.length - 1;
          },
          getStatus: (snap) => ({
            activePhases: [String(snap.value)],
            parallel: false,
            done: snap.status === "done",
          }),
          getPhaseConfig: () => undefined,
          serialize: () => ({
            flowName: name,
            initial: ["a"],
            nodes: order.map((id) => ({
              id,
              final: id === "final",
              parallel: false,
              children: [],
            })),
            transitions: [
              { from: "a", to: "b", event: "NEXT" },
              { from: "b", to: "final", event: "NEXT" },
            ],
          }),
        };
        return { ok: true, instance };
      },
    };
  };

  it("drives a Run through the seam using only the interface", () => {
    const loaded = makeFakeEngine().load("fake", {});
    if (!loaded.ok) throw new Error(loaded.error);
    const engine = loaded.instance;
    let snap = engine.initial();
    expect(engine.getStatus(snap).activePhases).toEqual(["a"]);
    expect(engine.canTransition(snap, "NEXT")).toBe(true);

    snap = engine.send(snap, "NEXT");
    expect(engine.getStatus(snap).activePhases).toEqual(["b"]);

    snap = engine.send(snap, "NEXT");
    expect(engine.getStatus(snap).done).toBe(true);
    expect(engine.canTransition(snap, "NEXT")).toBe(false);
  });
});

describe("XStateFlowEngine — parallel Phases", () => {
  const parallelFlow: FlowDefinition = {
    id: "parallel",
    type: "parallel",
    states: {
      left: {
        initial: "l1",
        states: {
          l1: {
            meta: {
              phase: {
                instructions: "L1",
                allowedTools: [],
                skills: [],
                context: { files: [], priorResults: [] },
                actorMode: "agent",
                gate: { type: "shell", script: "true" },
              },
            },
            on: { NEXT: "l2" },
          },
          l2: {
            type: "final",
            meta: {
              phase: {
                instructions: "L2",
                allowedTools: [],
                skills: [],
                context: { files: [], priorResults: [] },
                actorMode: "human",
                gate: { type: "shell", script: "true" },
              },
            },
          },
        },
      },
      right: {
        initial: "r1",
        states: {
          r1: {
            meta: {
              phase: {
                instructions: "R1",
                allowedTools: [],
                skills: [],
                context: { files: [], priorResults: [] },
                actorMode: "agent",
                gate: { type: "shell", script: "true" },
              },
            },
            on: { NEXT: "r2" },
          },
          r2: {
            type: "final",
            meta: {
              phase: {
                instructions: "R2",
                allowedTools: [],
                skills: [],
                context: { files: [], priorResults: [] },
                actorMode: "human",
                gate: { type: "shell", script: "true" },
              },
            },
          },
        },
      },
    },
  };

  const load = () => {
    const result = defaultFlowEngine.load("parallel", parallelFlow);
    if (!result.ok) throw new Error(result.error);
    return result.instance;
  };

  it("reports multiple active Phases in a parallel region", () => {
    const engine = load();
    const status = engine.getStatus(engine.initial());
    expect(status.activePhases.sort()).toEqual(["left.l1", "right.r1"]);
    expect(status.parallel).toBe(true);
  });

  it("carries per-Phase config for each parallel Phase", () => {
    const engine = load();
    expect(engine.getPhaseConfig("left.l1")?.instructions).toBe("L1");
    expect(engine.getPhaseConfig("right.r1")?.instructions).toBe("R1");
  });

  it("converges (reaches done) when all regions reach their terminal", () => {
    const engine = load();
    const snap = engine.send(engine.initial(), "NEXT");
    expect(engine.getStatus(snap).done).toBe(true);
  });

  it("serialize() describes both regions", () => {
    const engine = load();
    const graph = engine.serialize();
    expect(graph.initial.sort()).toEqual(["left.l1", "right.r1"]);
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(
      ["left", "left.l1", "left.l2", "right", "right.r1", "right.r2"],
    );
  });
});
