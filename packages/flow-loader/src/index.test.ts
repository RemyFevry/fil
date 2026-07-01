import { describe, expect, it } from "vitest";
import { defaultFlowEngine, builtInFlow } from "@fil/engine";
import { resolveFlow, type FlowLoaderDeps } from "./index.js";

const defaultFlow = builtInFlow("default")!;
const hotfixFlow = builtInFlow("hotfix")!;

/** An in-memory fake filesystem keyed by absolute path. */
function fakeFs(files: Record<string, string>): FlowLoaderDeps {
  return {
    readFile: (path) => files[path],
    listFlowNames: (dir) =>
      Object.keys(files)
        .filter((p) => p.startsWith(`${dir}/`) && p.endsWith(".json"))
        .map((p) => p.slice(dir.length + 1, -5)),
    engine: defaultFlowEngine,
  };
}

describe("flow-loader", () => {
  it("uses a project Flow when present", () => {
    const deps = fakeFs({
      "/proj/.fil/flows/default.json": JSON.stringify(defaultFlow.definition),
      "/user/.fil/flows/default.json": JSON.stringify(hotfixFlow.definition),
    });
    const result = resolveFlow(deps, {
      projectFlowsDir: "/proj/.fil/flows",
      userFlowsDir: "/user/.fil/flows",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source).toBe("project");
      expect(result.name).toBe("default");
      expect(result.instance.getPhaseConfig("requirements")).toBeDefined();
    }
  });

  it("falls back to a user Flow when no project Flow exists", () => {
    const deps = fakeFs({
      "/user/.fil/flows/hotfix.json": JSON.stringify(hotfixFlow.definition),
    });
    const result = resolveFlow(deps, {
      projectFlowsDir: "/proj/.fil/flows",
      userFlowsDir: "/user/.fil/flows",
      flowName: "hotfix",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.source).toBe("user");
  });

  it("fails with a clear error when the Flow is missing", () => {
    const deps = fakeFs({});
    const result = resolveFlow(deps, {
      projectFlowsDir: "/proj/.fil/flows",
      userFlowsDir: "/user/.fil/flows",
      flowName: "nope",
    });
    expect(result.ok).toBe(false);
  });

  it("fails with a load error when the Flow config is invalid JSON", () => {
    const deps = fakeFs({ "/proj/.fil/flows/default.json": "{not json" });
    const result = resolveFlow(deps, {
      projectFlowsDir: "/proj/.fil/flows",
      userFlowsDir: "/user/.fil/flows",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not valid JSON");
  });

  it("fails with a load error when the Flow is not a valid machine", () => {
    const deps = fakeFs({
      "/proj/.fil/flows/default.json": JSON.stringify({
        id: "default",
        initial: "ghost",
        states: {},
      }),
    });
    const result = resolveFlow(deps, {
      projectFlowsDir: "/proj/.fil/flows",
      userFlowsDir: "/user/.fil/flows",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("default");
  });

  it("lists available flows when the requested one is missing", () => {
    const deps = fakeFs({
      "/proj/.fil/flows/default.json": JSON.stringify(defaultFlow.definition),
    });
    const result = resolveFlow(deps, {
      projectFlowsDir: "/proj/.fil/flows",
      userFlowsDir: "/user/.fil/flows",
      flowName: "missing",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("default");
  });

  it("honours a configured default name", () => {
    const deps = fakeFs({
      "/user/.fil/flows/hotfix.json": JSON.stringify(hotfixFlow.definition),
    });
    const result = resolveFlow(deps, {
      projectFlowsDir: "/proj/.fil/flows",
      userFlowsDir: "/user/.fil/flows",
      defaultName: "hotfix",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.instance.flowName).toBe("hotfix");
  });
});
