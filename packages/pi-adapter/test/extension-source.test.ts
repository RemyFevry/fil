import { describe, expect, it } from "vitest";
import { renderPiExtensionSource } from "../src/extension-source.js";

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
});

