import { describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createMachine,
  defaultFlowEngine,
  builtInFlow,
  serializeFlowCode,
} from "@color-sunset/fil-engine";
import {
  resolveFlow,
  importFlowCode,
  importFlowFile,
  pickTempRoot,
  type FlowLoaderDeps,
} from "../src/index.js";

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

  it("serialized built-in flows round-trip through the default importFlowCode", async () => {
    // The code form (import { createMachine } from "@color-sunset/fil-engine"; export default
    // createMachine({...})) produced by serializeFlowCode must import and load
    // identically to the in-memory machine. The default `importFlowCode` owns
    // the engine-specifier rewrite + temp-file dance, so this proves the whole
    // consolidated path end-to-end (the same path CLI + evolution now share).
    const code = serializeFlowCode(defaultFlow.rawConfig);
    expect(code).toContain("export default");
    expect(code).toContain("createMachine");
    const definition = await importFlowCode(code);
    const reloaded = defaultFlowEngine.load("default", definition as never);
    expect(reloaded.ok).toBe(true);
  });
});

describe("importFlowFile (default)", () => {
  it("reads a Flow file from disk and returns its default export", async () => {
    const code = serializeFlowCode(defaultFlow.rawConfig);
    const dir = await mkdtemp(join(process.cwd(), ".fil-flow-loader-test-"));
    const file = join(dir, "flow.mjs");
    try {
      await writeFile(file, code, "utf8");
      const definition = await importFlowFile(file);
      expect(defaultFlowEngine.load("default", definition as never).ok).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("returns undefined when the file has no default export", async () => {
    const dir = await mkdtemp(join(process.cwd(), ".fil-flow-loader-test-"));
    const file = join(dir, "flow.mjs");
    try {
      await writeFile(file, "export const notDefault = 1;", "utf8");
      const definition = await importFlowFile(file);
      expect(definition).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

describe("importFlowCode (failure paths)", () => {
  it("returns undefined when the module has no default export", async () => {
    const definition = await importFlowCode("export const notDefault = 1;");
    expect(definition).toBeUndefined();
  });

  it("rejects when the code is syntactically invalid", async () => {
    await expect(importFlowCode("export default { broken")).rejects.toThrow();
  });
});

describe("pickTempRoot", () => {
  it("returns the cwd candidate when it is writable", async () => {
    expect(await pickTempRoot()).toBe(process.cwd());
  });

  it("falls back to the next candidate when the first is unwritable", async () => {
    const root = await pickTempRoot(["/__nonexistent_root__", tmpdir()]);
    expect(root).toBe(tmpdir());
  });

  it("throws when no candidate is writable", async () => {
    await expect(
      pickTempRoot(["/__nonexistent_a__", "__/nonexistent_b__"]),
    ).rejects.toThrow(/writable temp directory/);
  });
});