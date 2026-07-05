import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { renderToolRegistrations } from "../src/control-surface.js";
import { renderPiExtensionSource } from "../src/extension-source.js";

/**
 * Acceptance #3 — invoke the fil verbs *through Pi's tool surface*.
 *
 * The full rendered extension is TypeScript that Pi loads via jiti; we can't run
 * jiti/Pi in CI, so we exercise the exact tool-registration code the extension
 * embeds (`renderToolRegistrations()`, plain JS) inside a minimal harness with a
 * stub `pi` whose `registerTool` captures every definition. We then invoke a
 * registered tool's `execute` the way Pi would, routing the fil call through an
 * injected runner (the `__filRunForTests__` seam) so the test is deterministic
 * and doesn't spawn the `fil` binary (which is environment-flaky in CI). The
 * verbs' end-to-end behaviour against the real binary is covered by the CLI's
 * own tests (`packages/cli/test/cli.test.ts`).
 */

type StubRunner = (argv: string[], cwd: string) => { exitCode: number; stdout: string; stderr: string };
type ToolExecute = (
  toolCallId: string,
  params: Record<string, unknown>,
  signal: unknown,
  onUpdate: unknown,
  ctx: { cwd: string },
) => Promise<{ content: { text: string }[] }>;

let workdir: string;
let moduleFile: string;

beforeAll(async () => {
  // Use process.cwd() as the temp root, not os.tmpdir(). On Windows the
  // GitHub-hosted runner's `$USERPROFILE` is the 8.3 short-name form
  // (`C:\Users\RUNNER~1\...`); `pathToFileURL` URL-encodes the `~` as
  // `%7E`, but Node's ESM loader's URL→path round-trip can't find the file
  // we just wrote and reports "Failed to load url ... Does the file exist?".
  // `process.cwd()` is always a canonical long-name path on Windows.
  // No-op on POSIX. See packages/evolution/src/index.ts `loadFlowCode`
  // for the canonical explanation.
  workdir = await mkdtemp(join(process.cwd(), ".fil-pi-tool-surface-"));
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

/** Load the harness with an injected stub runner. Returns (tools, calls). */
async function loadToolsWith(runner: StubRunner): Promise<{
  tools: Map<string, { name: string; execute: ToolExecute }>;
  calls: string[][];
}> {
  const calls: string[][] = [];
  // The harness supplies its own module-scope filRun (a stub) — the same name
  // the production extension defines at module scope. renderToolRegistrations()
  // calls filRun(...) without defining it, so no production test-seam is needed.
  const harness = `const Type = { String: () => ({ type: "string" }), Optional: (s) => s, Object: (o) => ({ type: "object", properties: o }) };
function filRun(argv, cwd) { return globalThis.__stubRunner(argv, cwd); }
const __tools = new Map();
const pi = { on() {}, setActiveTools() {}, registerTool(t) { __tools.set(t.name, t); } };
${renderToolRegistrations()}
export const tools = __tools;
`;
  await mkdir(workdir, { recursive: true });
  await writeFile(moduleFile, harness, "utf8");
  (globalThis as Record<string, unknown>).__stubRunner = (argv: string[], _cwd: string) => {
    calls.push(argv);
    return runner(argv, _cwd);
  };
  const mod = (await import(pathToFileURL(moduleFile).href)) as { tools: Map<string, { name: string; execute: ToolExecute }> };
  return { tools: mod.tools, calls };
}

describe("fil verbs through Pi's tool surface (stub pi + injected runner)", () => {
  it("the rendered extension embeds the exact control-surface code under test", () => {
    expect(controlSurfaceMatchesExtension()).toBe(true);
  });

  it("registers all five fil verbs as native Pi tools", async () => {
    const { tools } = await loadToolsWith(() => ({ exitCode: 0, stdout: "", stderr: "" }));
    expect([...tools.keys()].sort()).toEqual([
      "fil_approve",
      "fil_next",
      "fil_propose",
      "fil_start",
      "fil_status",
    ]);
  });

  it("fil_next.execute dispatches ['next'] to fil from the session cwd (acceptance #1/#3)", async () => {
    const { tools, calls } = await loadToolsWith(() => ({ exitCode: 0, stdout: "advanced", stderr: "" }));
    const res = await tools.get("fil_next")!.execute("c1", {}, undefined, undefined, { cwd: "/proj" });
    expect(calls).toEqual([["next"]]);
    expect(res.content[0]?.text).toContain("advanced");
  });

  it("fil_start.execute maps args to the CLI argv (change positional + --flow)", async () => {
    const { tools, calls } = await loadToolsWith(() => ({ exitCode: 0, stdout: "started", stderr: "" }));
    await tools.get("fil_start")!.execute("c0", { change: "add-login", flow: "demo" }, undefined, undefined, {
      cwd: "/proj",
    });
    expect(calls).toEqual([["start", "add-login", "--flow", "demo"]]);
  });

  it("surfaces a non-zero fil exit in the tool result text", async () => {
    const { tools } = await loadToolsWith(() => ({ exitCode: 1, stdout: "", stderr: "gate failed" }));
    const res = await tools.get("fil_next")!.execute("c1", {}, undefined, undefined, { cwd: "/proj" });
    expect(res.content[0]?.text).toContain("gate failed");
  });
});
