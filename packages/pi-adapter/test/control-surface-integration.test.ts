import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  FIL_VERB_TOOLS,
  defaultRunner,
  findVerbTool,
  runFilVerb,
} from "../src/control-surface.js";

/**
 * Integration: the fil verbs behave identically to the CLI when driven through
 * the control surface. Each verb is invoked via `runFilVerb` + the real default
 * runner, which shells out to the built `fil` binary against a temp project.
 * Requires the CLI to be built (CI runs `build` before `test`); skipped otherwise.
 */

const FIL_BIN = resolve(dirname(fileURLToPath(import.meta.url)), "../../cli/dist/index.js");
const CLI_BUILT = existsSync(FIL_BIN);

const DEMO_FLOW = `import { createMachine } from "@fil/engine";
export default createMachine({
  id: "demo",
  initial: "a",
  context: {},
  states: {
    a: {
      meta: { phase: { instructions: "Phase A", allowedTools: ["read"], skills: [], context: { files: [], priorResults: [] }, actorMode: "agent", gate: { type: "shell", script: "true" } } },
      on: { NEXT: "done" },
    },
    done: {
      type: "final",
      meta: { phase: { instructions: "Done", allowedTools: [], skills: [], context: { files: [], priorResults: [] }, actorMode: "human", gate: { type: "shell", script: "true" } } },
    },
  },
});
`;

let workdir: string;

beforeAll(async () => {
  // defaultRunner reads FIL_BIN from the environment.
  process.env.FIL_BIN = FIL_BIN;
  workdir = await mkdtemp(join(tmpdir(), "fil-pi-control-integration-"));
});
afterAll(async () => {
  await rm(workdir, { recursive: true, force: true });
});
beforeEach(async () => {
  await rm(join(workdir, "proj"), { recursive: true, force: true });
  await mkdir(join(workdir, "proj"), { recursive: true });
});

async function freshProject(): Promise<string> {
  const proj = join(workdir, "proj");
  await mkdir(proj, { recursive: true });
  // `fil init` is a host concern (not a control verb); invoke the binary through
  // the same runner the tools use to scaffold .fil/ + the built-in flows, then
  // add a tiny demo flow with a passing shell gate so fil_next can advance.
  defaultRunner(["init"], { cwd: proj });
  await writeFile(join(proj, ".fil", "flows", "demo.js"), DEMO_FLOW, "utf8");
  return proj;
}

async function readPhase(proj: string): Promise<string> {
  const raw = await readFile(join(proj, ".fil", "run.json"), "utf8");
  return (JSON.parse(raw) as { phase: string }).phase;
}

describe("fil control verbs via runFilVerb (real fil binary)", () => {
  it.skipIf(!CLI_BUILT)("fil_start + fil_next advance the Run (acceptance: fil_next advances)", async () => {
    const proj = await freshProject();
    const start = runFilVerb(findVerbTool("fil_start")!, { change: "add-login", flow: "demo" }, { cwd: proj, runner: defaultRunner });
    expect(start.exitCode).toBe(0);
    expect(await readPhase(proj)).toBe("a");

    const next = runFilVerb(findVerbTool("fil_next")!, {}, { cwd: proj, runner: defaultRunner });
    expect(next.exitCode).toBe(0);
    // Advancing into the terminal Phase reports completion.
    expect(next.stdout).toContain("complete");
    expect(await readPhase(proj)).toBe("done");
  });

  it.skipIf(!CLI_BUILT)("fil_status reports the active Phase (behaves as the CLI)", async () => {
    const proj = await freshProject();
    runFilVerb(findVerbTool("fil_start")!, { change: "add-login", flow: "demo" }, { cwd: proj, runner: defaultRunner });
    const status = runFilVerb(findVerbTool("fil_status")!, {}, { cwd: proj, runner: defaultRunner });
    expect(status.exitCode).toBe(0);
    expect(status.stdout).toContain("Phase");
    expect(status.stdout).toContain("a");
  });

  it.skipIf(!CLI_BUILT)("fil_propose + fil_approve round-trip (behaves as the CLI)", async () => {
    const proj = await freshProject();
    runFilVerb(findVerbTool("fil_start")!, { change: "add-login", flow: "demo" }, { cwd: proj, runner: defaultRunner });

    // Author a proposed flow (instructions-only change — safe).
    const proposed = DEMO_FLOW.replace("Phase A", "Phase A (revised)");
    const proposedPath = join(proj, "proposed.js");
    await writeFile(proposedPath, proposed, "utf8");

    const propose = runFilVerb(
      findVerbTool("fil_propose")!,
      { flow: "demo", file: proposedPath },
      { cwd: proj, runner: defaultRunner },
    );
    expect(propose.exitCode).toBe(0);
    expect(propose.stdout).toContain("Proposal");

    // Recover the proposal id the CLI wrote under .fil/proposals/ (bare id,
    // without the .patch suffix the store appends on disk).
    const proposalsDir = join(proj, ".fil", "proposals");
    const entries = await readdir(proposalsDir);
    const id = (entries[0] ?? "").replace(/\.patch$/, "");
    expect(id).toBeTruthy();

    const approve = runFilVerb(findVerbTool("fil_approve")!, { id: id ?? "" }, { cwd: proj, runner: defaultRunner });
    expect(approve.exitCode).toBe(0);
    expect(approve.stdout).toContain("Applied proposal");
    const applied = await readFile(join(proj, ".fil", "flows", "demo.js"), "utf8");
    expect(applied).toContain("Phase A (revised)");
  });

  it.skipIf(!CLI_BUILT)("the five verbs are exactly the control surface", () => {
    expect(FIL_VERB_TOOLS.map((t) => t.toolName).sort()).toEqual([
      "fil_approve",
      "fil_next",
      "fil_propose",
      "fil_start",
      "fil_status",
    ]);
  });
});
