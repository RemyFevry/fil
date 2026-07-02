import { describe, expect, it } from "vitest";
import { renderGraph } from "../src/index.js";
import type { FlowGraph } from "@color-sunset/fil-engine";

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

  it("does not consume XState directly (only the FlowGraph shape)", async () => {
    const { readFileSync, statSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const here = fileURLToPath(import.meta.url);
    const srcDir = join(dirname(here), "..", "src");
    expect(statSync(srcDir).isDirectory()).toBe(true);

    // No source file under inspect-view/src should import xstate in any form.
    const indexSrc = readFileSync(join(srcDir, "index.ts"), "utf8");
    expect(/(?:from\s+|require\s*\(\s*|import\s*\(\s*)["']xstate["']/.test(indexSrc)).toBe(false);

    // The renderer should also not surface xstate-shaped output.
    const out = renderGraph({ graph, activePhases: ["requirements"], color: false });
    expect(out).toContain("requirements");
    expect(out).not.toMatch(/\bxstate\b/i);
  });
});
