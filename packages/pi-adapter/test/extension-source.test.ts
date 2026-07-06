import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { spawnSync as SpawnSyncFn } from "node:child_process";
import { defaultRunner } from "../src/control-surface.js";
import { renderPiExtensionSource } from "../src/extension-source.js";

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    spawnSync: ((cmd: string, args: readonly string[], opts: { cwd: string; encoding: string }) => {
      (globalThis as Record<string, unknown>).__filSpawnCalls ??= [];
      ((globalThis as Record<string, unknown>).__filSpawnCalls as Array<[string, readonly string[], { cwd: string; encoding: string }]>).push([cmd, args, opts]);
      return { status: 0, stdout: "", stderr: "" };
    }) as unknown as typeof actual.spawnSync,
  };
});

describe("Pi extension source (rendered string)", () => {
  it("ships a TypeScript ESM module with a default-exported factory", () => {
    const src = renderPiExtensionSource();
    expect(src).toMatch(/^[\s\S]*export default function filPiExtension/m);
    expect(src).toContain('import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"');
  });

  it("is stable across calls (idempotent installer)", () => {
    expect(renderPiExtensionSource()).toBe(renderPiExtensionSource());
  });

  it("registers every enforcement hook (Tier 0 + Tier 1 + skills)", () => {
    const src = renderPiExtensionSource();
    expect(src).toMatch(/pi\.on\(\s*["']session_start["']/);
    expect(src).toMatch(/pi\.on\(\s*["']resources_discover["']/);
    expect(src).toMatch(/pi\.on\(\s*["']before_agent_start["']/);
    expect(src).toMatch(/pi\.on\(\s*["']tool_call["']/);
    expect(src).toContain("pi.setActiveTools");
    expect(src).toContain("block: true");
  });

  it("reads .fil/run.json from the project's cwd (no in-memory state)", () => {
    const src = renderPiExtensionSource();
    expect(src).toContain('.fil/run.json"');
    expect(src).toContain("session_start");
  });

  it("tool_call blocks every tool when allowedTools is empty (fail-closed)", () => {
    // The tool_call handler must mirror session_start's setActiveTools([])
    // by blocking all tool calls, not by short-circuiting. A test that
    // asserts the rendered source contains the explicit "permits no tools"
    // branch catches a regression to the old `if (length === 0) return;`.
    const src = renderPiExtensionSource();
    expect(src).toMatch(/allowedTools\.length === 0[\s\S]{0,200}block:\s*true/);
    expect(src).toContain("permits no tools");
  });

  it("enforce() does not compute dead contextPaths in the extension", () => {
    // The contract round-trip surface is in `enforcement.ts`; the
    // installed extension doesn't need to compute it (the contract's
    // `context.files` is already named in the system prompt). This guards
    // against re-introducing a field that nothing in the extension reads.
    const src = renderPiExtensionSource();
    expect(src).not.toContain("contextPaths");
  });
});

describe("Pi extension source — control surface (#15)", () => {
  it("imports the runtime deps Pi aliases (typebox) and child_process", () => {
    const src = renderPiExtensionSource();
    expect(src).toContain('from "node:child_process"');
    expect(src).toContain('from "@sinclair/typebox"');
  });

  it("registers every fil verb as a native Pi tool", () => {
    const src = renderPiExtensionSource();
    expect(src).toContain("pi.registerTool");
    for (const name of ["fil_start", "fil_next", "fil_status", "fil_propose", "fil_approve"]) {
      expect(src).toContain(`"name":"${name}"`);
    }
  });

  it("maps each tool to its fil CLI verb and shells out via FIL_BIN/fil", () => {
    const src = renderPiExtensionSource();
    // The FIL_TOOLS data carries the verb mapping.
    expect(src).toContain('"verb":"next"');
    expect(src).toContain('"verb":"start"');
    expect(src).toContain('"verb":"propose"');
    // The execute path runs the fil CLI from the session cwd.
    expect(src).toContain("spawnSync");
    expect(src).toContain("process.env.FIL_BIN");
    expect(src).toContain("ctx.cwd");
  });

  it("still keeps the enforcement hooks intact (regression)", () => {
    const src = renderPiExtensionSource();
    expect(src).toMatch(/pi\.on\(\s*["']session_start["']/);
    expect(src).toMatch(/pi\.on\(\s*["']tool_call["']/);
    expect(src).toContain("setActiveTools");
    expect(src).toContain("block: true");
  });

  it("exempts the Fil control verbs from the Phase tool-block (CodeRabbit #3513613141)", () => {
    // The fil_* verbs ARE the steering surface — they must not be blocked by a
    // Phase's allowedTools restriction, and they stay in the active-tools set.
    const src = renderPiExtensionSource();
    expect(src).toContain("FIL_TOOL_NAMES.includes(event.toolName)");
    expect(src).toContain("[...cachedEnforcement.allowedTools, ...FIL_TOOL_NAMES]");
    expect(src).toContain("const FIL_TOOL_NAMES = FIL_TOOLS.map");
  });

  it("does not ship a production test-seam for the runner (CodeRabbit #3514146636)", () => {
    const src = renderPiExtensionSource();
    expect(src).not.toContain("__filRunForTests__");
  });

  it("rendered filToArgv aligns with resolveArgValue for false-valued positionals (CodeRabbit on #79)", () => {
    // The extension ships its own copy of filToArgv (no @fil imports); drift
    // here means Pi tools diverge from the CLI. Extract the function from the
    // rendered source and assert it matches the unit-tested resolveArgValue
    // semantics: positionals accept false, flags treat false as missing.
    const src = renderPiExtensionSource();
    const m = src.match(/function filToArgv\([^)]*\)\s*\{[\s\S]*?\n\}/);
    if (!m) throw new Error("filToArgv not found in rendered extension source");
    const filToArgv = new Function(`${m[0]}; return filToArgv;`)();

    const startSpec: Array<[string, "positional" | "flag", boolean]> = [
      ["change", "positional", true],
      ["flow", "flag", false],
    ];
    expect(filToArgv({ change: false }, startSpec)).toEqual(["false"]);
    expect(filToArgv({ change: false, flow: false }, startSpec)).toEqual(["false"]);
    expect(filToArgv({ change: "x", flow: false }, startSpec)).toEqual(["x"]);
    expect(() => filToArgv({}, startSpec)).toThrow(/change/);
  });

  describe("rendered filRun / defaultRunner lockstep (CodeRabbit on #79)", () => {
  // vi.mock at the top of the file replaces spawnSync for both defaultRunner
  // (control-surface) and the rendered (in-extension) filRun. Drift shows up
  // as a non-equal captured argv between the two paths.
  type Call = [string, readonly string[], { cwd: string; encoding: string }];
  const calls = (): Call[] =>
    ((globalThis as Record<string, unknown>).__filSpawnCalls as Call[] | undefined) ?? [];

  beforeEach(() => {
    (globalThis as Record<string, unknown>).__filSpawnCalls = [];
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__filSpawnCalls;
  });

  it("defaultRunner and the rendered filRun spawn identical argv in both FIL_BIN states", () => {
    const src = renderPiExtensionSource();
    const m = src.match(/function filRun\([^)]*\)\s*\{[\s\S]*?\n\}/);
    if (!m) throw new Error("filRun not found in rendered extension source");
    // The rendered filRun references `spawnSync` as a free variable (the
    // import is at the module top level); passing it as a Function parameter
    // makes it visible inside the body and lets us inject our mock.
    const renderedFilRun = new Function("spawnSync", `${m[0]}; return filRun;`);

    const argv = ["next", "x", "--flow", "demo"] as const;
    const cwd = "/tmp/proj";
    const originalBin = process.env.FIL_BIN;
    try {
      // The rendered filRun uses an injected spawnSync — push to the same
      // global so the captured argv can be compared directly.
      const injection: typeof SpawnSyncFn = ((cmd: string, args: readonly string[], opts: { cwd: string; encoding: string }) => {
        calls().push([cmd, args, opts]);
        return { status: 0, stdout: "", stderr: "" };
      }) as unknown as typeof SpawnSyncFn;

      // Case A: FIL_BIN set -> both must spawn `node <FIL_BIN>` with the verb argv.
      process.env.FIL_BIN = "/abs/path/to/cli/dist/index.js";
      // defaultRunner uses the vi.mock'd spawnSync (pushes to global __filSpawnCalls).
      calls().length = 0;
      defaultRunner([...argv], { cwd });
      const capturedDefault = calls().slice();
      calls().length = 0;
      renderedFilRun(injection)([...argv], cwd);
      const capturedRendered = calls().slice();
      expect(capturedRendered).toEqual(capturedDefault);
      expect(capturedRendered[0]?.[0]).toBe(process.execPath);
      expect(capturedRendered[0]?.[1]).toEqual(["/abs/path/to/cli/dist/index.js", ...argv]);

      // Case B: FIL_BIN unset -> both must spawn `fil` on PATH with the verb argv.
      delete process.env.FIL_BIN;
      calls().length = 0;
      defaultRunner([...argv], { cwd });
      const capturedDefault2 = calls().slice();
      calls().length = 0;
      renderedFilRun(injection)([...argv], cwd);
      const capturedRendered2 = calls().slice();
      expect(capturedRendered2).toEqual(capturedDefault2);
      expect(capturedRendered2[0]?.[0]).toBe("fil");
      expect(capturedRendered2[0]?.[1]).toEqual([...argv]);
    } finally {
      if (originalBin === undefined) delete process.env.FIL_BIN;
      else process.env.FIL_BIN = originalBin;
    }
  });
});
});

