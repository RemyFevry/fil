import { describe, expect, it } from "vitest";
import {
  createMachine,
  defaultFlowEngine,
  engineEntryUrl,
  builtInFlow,
  serializeFlowCode,
} from "@fil/engine";
import { resolveFlow, type FlowLoaderDeps } from "../src/index.js";

const defaultFlow = builtInFlow("default")!;
const hotfixFlow = builtInFlow("hotfix")!;

/**
 * An in-memory fake filesystem + importer.
 * `files` maps path -> machine (the result of `createMachine(...)`); the
 * importer "imports" by lookup.
 */
function fakeFs(files: Record<string, unknown>): FlowLoaderDeps {
  return {
    fileExists: (path) => path in files,
    listFlowNames: (dir) =>
      Object.keys(files)
        .filter((p) => p.startsWith(`${dir}/`) && p.endsWith(".js"))
        .map((p) => p.slice(dir.length + 1, -3)),
    importFlowFile: async (path) => files[path] as never,
    engine: defaultFlowEngine,
  };
}

describe("flow-loader", () => {
  it("uses a project Flow when present", async () => {
    const deps = fakeFs({
      "/proj/.fil/flows/default.js": defaultFlow.machine,
      "/user/.fil/flows/default.js": hotfixFlow.machine,
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
      "/user/.fil/flows/hotfix.js": hotfixFlow.machine,
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
    // createMachine with a missing initial state: xstate builds a machine, but
    // the engine detects "no resolvable initial Phase" and rejects it.
    const broken = createMachine({
      id: "default",
      initial: "ghost",
      states: {},
    });
    const deps = fakeFs({
      "/proj/.fil/flows/default.js": broken,
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
      "/proj/.fil/flows/default.js": defaultFlow.machine,
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
      "/user/.fil/flows/hotfix.js": hotfixFlow.machine,
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
    // The code form (import { createMachine } from "@fil/engine"; export default
    // createMachine({...})) produced by serializeFlowCode must import and load
    // identically to the in-memory machine. Rewrite the @fil/engine specifier
    // to the engine's absolute URL so the temp file can live anywhere.
    const { writeFile, mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { pathToFileURL } = await import("node:url");
    const code = serializeFlowCode(defaultFlow.rawConfig).replace(
      /from\s+["']@fil\/engine["']/g,
      `from "${engineEntryUrl}"`,
    );
    expect(code).toContain("export default");
    expect(code).toContain("createMachine");
    const dir = await mkdtemp(join(tmpdir(), "fil-fl-"));
    const file = join(dir, "flow.mjs");
    try {
      await writeFile(file, code, "utf8");
      const mod = (await import(pathToFileURL(file).href)) as {
        default: unknown;
      };
      const reloaded = defaultFlowEngine.load("default", mod.default as never);
      expect(reloaded.ok).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });
});