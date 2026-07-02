import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { renderToolRegistrations } from "../src/control-surface.js";
import { renderPiExtensionSource } from "../src/extension-source.js";
import { defaultRunner } from "../src/control-surface.js";

/**
 * Acceptance #3 — invoke the fil verbs *through Pi's tool surface*.
 *
 * The full rendered extension is TypeScript that Pi loads via jiti. We can't run
 * jiti/Pi in CI, so we exercise the exact tool-registration code the extension
 * embeds (`renderToolRegistrations()`, plain JS) inside a minimal harness with a
 * stub `pi` whose `registerTool` captures every definition — then invoke a
 * registered tool's `execute` the way Pi would. `Type` is stubbed (we capture the
 * definition; we don't validate params) and `execute` shells out to the real
 * `fil` binary. Requires the CLI built (CI runs `build` before `test`).
 */

const FIL_BIN = resolve(dirname(fileURLToPath(import.meta.url)), "../../cli/dist/index.js");
const CLI_BUILT = existsSync(FIL_BIN);

const DEMO_FLOW = `import { createMachine } from "@fil/engine";
export default createMachine({
  id: "demo", initial: "a", context: {},
  states: {
    a: { meta: { phase: { instructions: "Phase A", allowedTools: [], skills: [], context: { files: [], priorResults: [] }, actorMode: "agent", gate: { type: "shell", script: "true" } } }, on: { NEXT: "done" } },
    done: { type: "final", meta: { phase: { instructions: "Done", allowedTools: [], skills: [], context: { files: [], priorResults: [] }, actorMode: "human", gate: { type: "shell", script: "true" } } } },
  },
});
`;

let workdir: string;
let moduleFile: string;

beforeAll(async () => {
  process.env.FIL_BIN = FIL_BIN;
  workdir = await mkdtemp(join(tmpdir(), "fil-pi-tool-surface-"));
  moduleFile = join(workdir, "fil-tools.mjs");
});
afterAll(async () => {
  await rm(workdir, { recursive: true, force: true });
});
beforeEach(async () => {
  await rm(join(workdir, "proj"), { recursive: true, force: true });
});

/** The control-surface registration code is identical in the rendered extension. */
function controlSurfaceMatchesExtension() {
  return renderPiExtensionSource().includes(renderToolRegistrations());
}

type ToolExecute = (
  toolCallId: string,
  params: Record<string, unknown>,
  signal: unknown,
  onUpdate: unknown,
  ctx: { cwd: string },
) => Promise<{ content: { text: string }[] }>;

/** Minimal harness: stub `pi` (captures registerTool) + stub `Type`, then the
 *  exact registration code the extension embeds. Plain JS — no TS to strip. */
async function loadTools(): Promise<Map<string, { name: string; execute: ToolExecute }>> {
  const harness = `import { spawnSync } from "node:child_process";
const Type = { String: () => ({ type: "string" }), Optional: (s) => s, Object: (o) => ({ type: "object", properties: o }) };
const __tools = new Map();
const pi = { on() {}, setActiveTools() {}, registerTool(t) { __tools.set(t.name, t); } };
${renderToolRegistrations()}
export const tools = __tools;
`;
  await writeFile(moduleFile, harness, "utf8");
  const mod = (await import(pathToFileURL(moduleFile).href)) as { tools: Map<string, { name: string; execute: ToolExecute }> };
  return mod.tools;
}

async function freshProject(): Promise<string> {
  const proj = join(workdir, "proj");
  await mkdir(join(proj, ".fil", "flows"), { recursive: true });
  defaultRunner(["init"], { cwd: proj });
  await writeFile(join(proj, ".fil", "flows", "demo.js"), DEMO_FLOW, "utf8");
  return proj;
}

async function readPhase(proj: string): Promise<string> {
  const raw = await readFile(join(proj, ".fil", "run.json"), "utf8");
  return (JSON.parse(raw) as { phase: string }).phase;
}

describe("fil verbs through Pi's tool surface (stub pi + real fil)", () => {
  it("the rendered extension embeds the exact control-surface code under test", () => {
    expect(controlSurfaceMatchesExtension()).toBe(true);
  });

  it.skipIf(!CLI_BUILT)("registers all five fil verbs as native Pi tools", async () => {
    const tools = await loadTools();
    expect([...tools.keys()].sort()).toEqual([
      "fil_approve",
      "fil_next",
      "fil_propose",
      "fil_start",
      "fil_status",
    ]);
  });

  it.skipIf(!CLI_BUILT)("fil_next.execute advances the Run exactly like the CLI (acceptance #1/#3)", async () => {
    const tools = await loadTools();
    const proj = await freshProject();

    const start = tools.get("fil_start")!;
    const startRes = (await start.execute("c0", { change: "add-login", flow: "demo" }, undefined, undefined, {
      cwd: proj,
    })) as { content: { text: string }[] };
    expect(startRes.content[0]?.text).toContain("a");
    expect(await readPhase(proj)).toBe("a");

    const next = tools.get("fil_next")!;
    const nextRes = (await next.execute("c1", {}, undefined, undefined, { cwd: proj })) as {
      content: { text: string }[];
    };
    // Advancing into the terminal Phase reports completion.
    expect(nextRes.content[0]?.text).toContain("complete");
    expect(await readPhase(proj)).toBe("done");
  });

  it.skipIf(!CLI_BUILT)("fil_status.execute returns the active Phase", async () => {
    const tools = await loadTools();
    const proj = await freshProject();
    await tools.get("fil_start")!.execute("c0", { change: "add-login", flow: "demo" }, undefined, undefined, {
      cwd: proj,
    });
    const res = (await tools.get("fil_status")!.execute("c1", {}, undefined, undefined, { cwd: proj })) as {
      content: { text: string }[];
    };
    expect(res.content[0]?.text).toContain("Phase");
    expect(res.content[0]?.text).toContain("a");
  });
});
