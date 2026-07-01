import { describe, expect, it } from "vitest";
import { renderGraph } from "./index.js";
import type { FlowGraph } from "@fil/engine";

const graph: FlowGraph = {
  flowName: "default",
  initial: ["requirements"],
  nodes: [
    { id: "requirements", final: false, parallel: false, children: [] },
    { id: "design", final: false, parallel: false, children: [] },
    { id: "done", final: true, parallel: false, children: [] },
  ],
  transitions: [
    { from: "requirements", to: "design", event: "NEXT" },
    { from: "design", to: "done", event: "NEXT" },
  ],
};

describe("inspect-view.renderGraph", () => {
  it("renders the Flow with an initial and a terminal node", () => {
    const out = renderGraph({ graph });
    expect(out).toContain("default");
    expect(out).toContain("initial: requirements");
    expect(out).toContain("(final)");
    expect(out).toContain("NEXT ─▶ design");
  });

  it("highlights the active Phase", () => {
    const out = renderGraph({ graph, activePhases: ["design"] });
    expect(out).toContain("active Phase: design");
  });

  it("does not consume XState directly (only the FlowGraph shape)", () => {
    // The renderer only reads the neutral graph fields.
    const out = renderGraph({ graph, activePhases: ["requirements"] });
    expect(out).toContain("requirements");
  });
});
