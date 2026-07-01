import { describe, expect, it } from "vitest";
import { defaultFlowEngine, builtInFlow, serializeFlowCode } from "@fil/engine";
import { resolveFlow, type FlowLoaderDeps } from "../src/index.js";

const defaultFlow = builtInFlow("default")!;
const hotfixFlow = builtInFlow("hotfix")!;

/**
 * An in-memory fake filesystem + importer.
 * `files` maps path -> definition object; the importer "imports" by lookup.
 */
function fakeFs(files: Record<string, FlowDefinitionLike>): FlowLoaderDeps {
  return {
    fileExists: (path) => path in files,
    listFlowNames: (dir) =>
      Object.keys(files)
        .filter((p) => p.startsWith(`${dir}/`) && p.endsWith(".js"))
        .map((p) => p.slice(dir.length + 1, -3)),
    importFlowFile: async (path) => files[path],
    engine: defaultFlowEngine,
  };
}

type FlowDefinitionLike = Record<string, unknown>;

describe("flow-loader", () => {
  it("uses a project Flow when present", async () => {
    const deps = fakeFs({
      "/proj/.fil/flows/default.js": defaultFlow.definition,
      "/user/.fil/flows/default.js": hotfixFlow.definition,
    });
    const result = await resolveFlow(deps, {
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

  it("falls back to a user Flow when no project Flow exists", async () => {
    const deps = fakeFs({
      "/user/.fil/flows/hotfix.js": hotfixFlow.definition,
    });
    const result = await resolveFlow(deps, {
      projectFlowsDir: "/proj/.fil/flows",
      userFlowsDir: "/user/.fil/flows",
      flowName: "hotfix",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.source).toBe("user");
  });

  it("fails with a clear error when the Flow is missing", async () => {
    const deps = fakeFs({});
    const result = await resolveFlow(deps, {
      projectFlowsDir: "/proj/.fil/flows",
      userFlowsDir: "/user/.fil/flows",
      flowName: "nope",
    });
    expect(result.ok).toBe(false);
  });

  it("fails with a load error when the Flow is not a valid machine", async () => {
    const deps = fakeFs({
      "/proj/.fil/flows/default.js": { id: "default", initial: "ghost", states: {} },
    });
    const result = await resolveFlow(deps, {
      projectFlowsDir: "/proj/.fil/flows",
      userFlowsDir: "/user/.fil/flows",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("default");
  });

  it("lists available flows when the requested one is missing", async () => {
    const deps = fakeFs({
      "/proj/.fil/flows/default.js": defaultFlow.definition,
    });
    const result = await resolveFlow(deps, {
      projectFlowsDir: "/proj/.fil/flows",
      userFlowsDir: "/user/.fil/flows",
      flowName: "missing",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("default");
  });

  it("honours a configured default name", async () => {
    const deps = fakeFs({
      "/user/.fil/flows/hotfix.js": hotfixFlow.definition,
    });
    const result = await resolveFlow(deps, {
      projectFlowsDir: "/proj/.fil/flows",
      userFlowsDir: "/user/.fil/flows",
      defaultName: "hotfix",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.instance.flowName).toBe("hotfix");
  });

  it("serialized built-in flows round-trip through the real engine", async () => {
    // The code form (export default {...}) produced by serializeFlowCode must
    // import and load identically to the in-memory definition.
    const code = serializeFlowCode(defaultFlow.definition);
    expect(code).toContain("export default");
    const url = "data:text/javascript;base64," + Buffer.from(code).toString("base64");
    const mod = (await import(url)) as { default: FlowDefinitionLike };
    const reloaded = defaultFlowEngine.load("default", mod.default);
    expect(reloaded.ok).toBe(true);
  });
});
