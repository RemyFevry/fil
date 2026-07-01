import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { defaultContext, type CliContext } from "./context.js";
import { initCommand } from "./commands/init.js";
import { startCommand } from "./commands/start.js";
import { nextCommand } from "./commands/next.js";
import { statusCommand } from "./commands/status.js";
import { backCommand, cancelCommand } from "./commands/back-cancel.js";
import { proposeCommand } from "./commands/propose.js";
import { approveCommand } from "./commands/approve.js";
import { inspectCommand } from "./commands/inspect.js";
import { parseArgs } from "./args.js";
import type { FlowDefinition } from "@fil/engine";

let workdir: string;

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), "fil-cli-"));
});
afterAll(async () => {
  await rm(workdir, { recursive: true, force: true });
});

/** A demo flow: a (shell true) -> b (human) -> done (final). */
function demoFlow(): FlowDefinition {
  const phase = (
    instructions: string,
    gate: Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ) => ({
    meta: {
      phase: {
        instructions,
        allowedTools: ["read"],
        skills: [],
        context: { files: [], priorResults: [] },
        actorMode: "agent",
        gate,
        ...extra,
      },
    },
  });
  return {
    id: "demo",
    initial: "a",
    states: {
      a: { ...phase("Phase A", { type: "shell", script: "true" }), on: { NEXT: "b" } },
      b: { ...phase("Phase B", { type: "human", prompt: "OK?" }), on: { NEXT: "done" } },
      done: { ...phase("Done", { type: "shell", script: "true" }), type: "final" },
    },
  };
}

function ctxFor(overrides: Partial<CliContext> = {}): { ctx: CliContext; lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  const ctx = defaultContext(workdir, {
    out: { log: (l) => lines.push(l), error: (l) => errors.push(l) },
    ...overrides,
  });
  return { ctx, lines, errors };
}

describe("fil CLI — end to end", () => {
  beforeEach(async () => {
    await rm(join(workdir, ".fil"), { recursive: true, force: true });
    await rm(join(workdir, ".gitignore"), { force: true });
  });

  it("init scaffolds the layout, built-in flows, and .gitignore", () => {
    const { ctx, lines } = ctxFor();
    const code = initCommand(ctx);
    expect(code).toBe(0);
    expect(ctx.store.listFlows()).toEqual(expect.arrayContaining(["default", "hotfix"]));
    expect(ctx.store.readConfig()?.defaultFlow).toBe("default");
    expect(lines.join("\n")).toContain("Initialised Fil");
  });

  it("init is idempotent (does not clobber existing flows)", () => {
    const { ctx } = ctxFor();
    initCommand(ctx);
    ctx.store.writeFlow("default", { id: "default", initial: "x", states: {} });
    initCommand(ctx); // again
    expect(ctx.store.readFlow("default")?.["initial"]).toBe("x");
  });

  it("starts a Run on a chosen --flow and reports the first Phase", async () => {
    const { ctx, lines } = ctxFor();
    initCommand(ctx);
    ctx.store.writeFlow("demo", demoFlow());
    const code = await startCommand(ctx, parseArgs(["login", "--flow", "demo"]));
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("phase:  a");
    expect(ctx.store.readProjection()?.phase).toBe("a");
  });

  it("advances on a passing shell Gate, then a human Gate once confirmed", async () => {
    let confirmed = false;
    const { ctx } = ctxFor({ prompter: async () => confirmed });
    initCommand(ctx);
    ctx.store.writeFlow("demo", demoFlow());
    await startCommand(ctx, parseArgs(["login", "--flow", "demo"]));

    expect(await nextCommand(ctx)).toBe(0); // a (shell) -> b
    expect(ctx.store.readProjection()?.phase).toBe("b");

    // b is a human gate; declining keeps the Run in place.
    expect(await nextCommand(ctx)).toBe(1);
    expect(ctx.store.readProjection()?.phase).toBe("b");

    confirmed = true;
    expect(await nextCommand(ctx)).toBe(0); // b -> done
    expect(ctx.store.readProjection()?.status).toBe("done");
  });

  it("status prints the Phase, Gate, and tools", async () => {
    const { ctx, lines } = ctxFor();
    initCommand(ctx);
    ctx.store.writeFlow("demo", demoFlow());
    await startCommand(ctx, parseArgs(["login", "--flow", "demo"]));
    statusCommand(ctx);
    const out = lines.join("\n");
    expect(out).toContain("Phase   a");
    expect(out).toContain("Gate    shell command");
    expect(out).toContain("Actor   agent");
  });

  it("status reports no active Run before start", () => {
    const { ctx, lines } = ctxFor();
    initCommand(ctx);
    statusCommand(ctx);
    expect(lines.join("\n")).toContain("No active Run");
  });

  it("back retreats one Phase and is a no-op at the initial Phase", async () => {
    const { ctx } = ctxFor();
    initCommand(ctx);
    ctx.store.writeFlow("demo", demoFlow());
    await startCommand(ctx, parseArgs(["login", "--flow", "demo"]));
    await nextCommand(ctx); // a -> b
    expect(backCommand(ctx)).toBe(0);
    expect(ctx.store.readProjection()?.phase).toBe("a");
    expect(backCommand(ctx)).toBe(1); // already at initial
  });

  it("cancel ends the Run and blocks further advance", async () => {
    const { ctx } = ctxFor();
    initCommand(ctx);
    ctx.store.writeFlow("demo", demoFlow());
    await startCommand(ctx, parseArgs(["login", "--flow", "demo"]));
    expect(cancelCommand(ctx)).toBe(0);
    expect(ctx.store.readProjection()?.status).toBe("cancelled");
    expect(await nextCommand(ctx)).toBe(1);
  });

  it("inspect renders the active Run's Flow with the active Phase highlighted", async () => {
    const { ctx, lines } = ctxFor();
    initCommand(ctx);
    ctx.store.writeFlow("demo", demoFlow());
    await startCommand(ctx, parseArgs(["login", "--flow", "demo"]));
    inspectCommand(ctx);
    const out = lines.join("\n");
    expect(out).toContain("demo");
    expect(out).toContain("active Phase: a");
  });

  it("inspect renders the default Flow when there is no Run", () => {
    const { ctx, lines } = ctxFor();
    initCommand(ctx);
    inspectCommand(ctx);
    expect(lines.join("\n")).toContain("default");
  });

  it("propose + approve applies a valid Flow edit", async () => {
    const { ctx, lines } = ctxFor();
    initCommand(ctx);
    ctx.store.writeFlow("demo", demoFlow());
    await startCommand(ctx, parseArgs(["login", "--flow", "demo"]));

    // Author a proposed flow (only instructions change — safe).
    const proposed = demoFlow() as Record<string, unknown>;
    const states = proposed.states as Record<string, { meta: { phase: { instructions: string } } }>;
    const aState = states.a;
    if (aState) aState.meta.phase.instructions = "Phase A (revised)";
    const proposedPath = join(workdir, "proposed.json");
    await writeFile(proposedPath, JSON.stringify(proposed, null, 2));

    expect(proposeCommand(ctx, parseArgs(["demo", proposedPath]))).toBe(0);
    const id = ctx.store.listProposals()[0];
    expect(id).toBeTruthy();

    expect(approveCommand(ctx, parseArgs([id ?? ""]))).toBe(0);
    const applied = ctx.store.readFlow("demo") as Record<string, unknown>;
    const aFinal = (applied.states as Record<string, { meta: { phase: { instructions: string } } }>).a;
    expect(aFinal?.meta.phase.instructions).toBe("Phase A (revised)");
    expect(ctx.store.listProposals()).not.toContain(id);
    expect(lines.join("\n")).toContain("Applied proposal");
  });

  it("approve refuses a broken proposal (load error)", () => {
    const { ctx, errors } = ctxFor();
    initCommand(ctx);
    ctx.store.writeFlow("demo", demoFlow());
    // Write a proposal whose patch corrupts the JSON.
    ctx.store.writeProposal("bad", "--- a\n+++ b\n@@ -1,1 +1,1 @@\n-BROKEN\n");
    const code = approveCommand(ctx, parseArgs(["bad", "--flow", "demo"]));
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("Rejected (load)");
    // Flow unchanged, proposal kept.
    expect(ctx.store.readFlow("demo")).toBeDefined();
    expect(ctx.store.listProposals()).toContain("bad");
  });

  it("approve refuses when an active Run would be stranded", async () => {
    const { ctx, errors } = ctxFor();
    initCommand(ctx);
    ctx.store.writeFlow("demo", demoFlow());
    await startCommand(ctx, parseArgs(["login", "--flow", "demo"])); // at phase a

    // Proposed flow RENAMES phase a -> a2, stranding the active Run.
    const proposed = demoFlow() as Record<string, unknown>;
    const states = structuredClone(proposed.states) as Record<string, unknown>;
    states.a2 = states.a;
    delete states.a;
    proposed.states = states;
    proposed.initial = "a2";
    (states.a2 as { on?: Record<string, string> }).on = { NEXT: "b" };
    const proposedPath = join(workdir, "rename.json");
    await writeFile(proposedPath, JSON.stringify(proposed, null, 2));

    proposeCommand(ctx, parseArgs(["demo", proposedPath]));
    const id = ctx.store.listProposals()[0];
    const code = approveCommand(ctx, parseArgs([id ?? ""]));
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("Refused");
    expect(errors.join("\n")).toContain("stranded");
  });
});
