import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultContext, type CliContext } from "../src/context.js";
import { initCommand } from "../src/commands/init.js";
import { startCommand } from "../src/commands/start.js";
import { nextCommand } from "../src/commands/next.js";
import { statusCommand } from "../src/commands/status.js";
import { backCommand, cancelCommand } from "../src/commands/back-cancel.js";
import { proposeCommand } from "../src/commands/propose.js";
import { approveCommand } from "../src/commands/approve.js";
import { inspectCommand, runInspectLoop, describeValue } from "../src/commands/inspect.js";
import { parseArgs } from "../src/args.js";
import { serializeFlowCode, createMachine, type FlowDefinition } from "@color-sunset/fil-engine";

let workdir: string;

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), "color-sunset-fil-"));
});
afterAll(async () => {
  if (workdir) {
    await rm(workdir, { recursive: true, force: true });
  }
});

/** A demo flow: a (shell true) -> b (human) -> done (final). */
function demoFlow() {
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
        gates: [{ name: "g", ...gate }],
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

/** Wrap a demoFlow raw config in createMachine, used by commands that need the machine. */
function _demoFlowMachine(): FlowDefinition {
  return createMachine(demoFlow() as Parameters<typeof createMachine>[0]);
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
    ctx.store.writeFlowText("default", "export default { id: 'default', initial: 'x' };\n");
    initCommand(ctx); // again
    expect(ctx.store.readFlowText("default")).toContain("initial: 'x'");
  });

  it("starts a Run on a chosen --flow and reports the first Phase", async () => {
    const { ctx, lines, errors: _errors } = ctxFor();
    initCommand(ctx);
    ctx.store.writeFlowText("demo", serializeFlowCode(demoFlow() as Parameters<typeof serializeFlowCode>[0]));
    const code = await startCommand(ctx, parseArgs(["login", "--flow", "demo"]));
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("phase:  a");
    expect(ctx.store.readProjection()?.phase).toBe("a");
  });

  it("advances on a passing shell Gate, then a human Gate once confirmed", async () => {
    let confirmed = false;
    const { ctx } = ctxFor({ prompter: async () => confirmed });
    initCommand(ctx);
    ctx.store.writeFlowText("demo", serializeFlowCode(demoFlow() as Parameters<typeof serializeFlowCode>[0]));
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
    ctx.store.writeFlowText("demo", serializeFlowCode(demoFlow() as Parameters<typeof serializeFlowCode>[0]));
    await startCommand(ctx, parseArgs(["login", "--flow", "demo"]));
    statusCommand(ctx);
    const out = lines.join("\n");
    expect(out).toContain("Phase   a");
    expect(out).toContain("Gates   g (shell command)");
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
    ctx.store.writeFlowText("demo", serializeFlowCode(demoFlow() as Parameters<typeof serializeFlowCode>[0]));
    await startCommand(ctx, parseArgs(["login", "--flow", "demo"]));
    await nextCommand(ctx); // a -> b
    expect(backCommand(ctx)).toBe(0);
    expect(ctx.store.readProjection()?.phase).toBe("a");
    expect(backCommand(ctx)).toBe(1); // already at initial
  });

  it("cancel ends the Run and blocks further advance", async () => {
    const { ctx } = ctxFor();
    initCommand(ctx);
    ctx.store.writeFlowText("demo", serializeFlowCode(demoFlow() as Parameters<typeof serializeFlowCode>[0]));
    await startCommand(ctx, parseArgs(["login", "--flow", "demo"]));
    expect(cancelCommand(ctx)).toBe(0);
    expect(ctx.store.readProjection()?.status).toBe("cancelled");
    expect(await nextCommand(ctx)).toBe(1);
  });

  it("inspect --text renders the active Run's Flow with the active Phase highlighted", async () => {
    const { ctx, lines } = ctxFor();
    initCommand(ctx);
    ctx.store.writeFlowText("demo", serializeFlowCode(demoFlow() as Parameters<typeof serializeFlowCode>[0]));
    await startCommand(ctx, parseArgs(["login", "--flow", "demo"]));
    await inspectCommand(ctx, parseArgs(["--text"]));
    const out = lines.join("\n");
    expect(out).toContain("demo");
    expect(out).toContain("active Phase: a");
  });

  it("inspect --text renders the default Flow when there is no Run", async () => {
    const { ctx, lines } = ctxFor();
    initCommand(ctx);
    await inspectCommand(ctx, parseArgs(["--text"]));
    expect(lines.join("\n")).toContain("default");
  });

  it("propose + approve applies a valid Flow edit", async () => {
    const { ctx, lines } = ctxFor();
    initCommand(ctx);
    ctx.store.writeFlowText("demo", serializeFlowCode(demoFlow() as Parameters<typeof serializeFlowCode>[0]));
    await startCommand(ctx, parseArgs(["login", "--flow", "demo"]));

    // Author a proposed flow (only instructions change — safe).
    const proposed = structuredClone(demoFlow()) as Record<string, unknown>;
    const states = proposed.states as Record<string, { meta: { phase: { instructions: string } } }>;
    const aState = states.a;
    if (aState) aState.meta.phase.instructions = "Phase A (revised)";
    const proposedPath = join(workdir, "proposed.js");
    await writeFile(proposedPath, serializeFlowCode(proposed));

    expect(proposeCommand(ctx, parseArgs(["demo", proposedPath]))).toBe(0);
    const id = ctx.store.listProposals()[0];
    expect(id).toBeTruthy();

    expect(await approveCommand(ctx, parseArgs([id ?? ""]))).toBe(0);
    const applied = ctx.store.readFlowText("demo") ?? "";
    expect(applied).toContain("Phase A (revised)");
    expect(ctx.store.listProposals()).not.toContain(id);
    expect(lines.join("\n")).toContain("Applied proposal");
  });

  it("approve refuses a broken proposal (load error)", async () => {
    const { ctx, errors } = ctxFor();
    initCommand(ctx);
    ctx.store.writeFlowText("demo", serializeFlowCode(demoFlow() as Parameters<typeof serializeFlowCode>[0]));
    // Write a proposal whose patch corrupts the Flow code.
    ctx.store.writeProposal("bad", "--- a\n+++ b\n@@ -1,1 +1,1 @@\n-BROKEN\n");
    const code = await approveCommand(ctx, parseArgs(["bad", "--flow", "demo"]));
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("Rejected (load)");
    // Flow unchanged, proposal kept.
    expect(ctx.store.readFlowText("demo")).toBeDefined();
    expect(ctx.store.listProposals()).toContain("bad");
  });

  it("approve refuses when an active Run would be stranded", async () => {
    const { ctx, errors } = ctxFor();
    initCommand(ctx);
    ctx.store.writeFlowText("demo", serializeFlowCode(demoFlow() as Parameters<typeof serializeFlowCode>[0]));
    await startCommand(ctx, parseArgs(["login", "--flow", "demo"])); // at phase a

    // Proposed flow RENAMES phase a -> a2, stranding the active Run.
    const proposed = structuredClone(demoFlow()) as Record<string, unknown>;
    const states = structuredClone(proposed.states) as Record<string, unknown>;
    states.a2 = states.a;
    delete states.a;
    proposed.states = states;
    proposed.initial = "a2";
    (states.a2 as { on?: Record<string, string> }).on = { NEXT: "b" };
    const proposedPath = join(workdir, "rename.js");
    await writeFile(proposedPath, serializeFlowCode(proposed));

    proposeCommand(ctx, parseArgs(["demo", proposedPath]));
    const id = ctx.store.listProposals()[0];
    const code = await approveCommand(ctx, parseArgs([id ?? ""]));
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("Refused");
    expect(errors.join("\n")).toContain("stranded");
  });
});

// ---------------------------------------------------------------------------
// fil init — Pi adapter install
// ---------------------------------------------------------------------------

describe("fil init — Pi adapter install", () => {
  it("installs the Pi extension on first init (real FS, project scope)", () => {
    const calls: Array<{ scope: string }> = [];
    const { ctx, lines } = ctxFor({
      installPiAdapter: ({ scope }) => {
        calls.push({ scope });
        return {
          installed: true,
          paths: { project: join(ctx.cwd, ".pi/extensions/fil.ts"), user: "" },
          piDetected: true,
        };
      },
    });
    const code = initCommand(ctx);
    expect(code).toBe(0);
    expect(calls).toEqual([{ scope: "project" }]);
    expect(lines.join("\n")).toContain("pi adapter: installed");
    expect(lines.join("\n")).toContain("scope=project");
  });

  it("respects --scope user", () => {
    const calls: Array<{ scope: string }> = [];
    const { ctx } = ctxFor({
      installPiAdapter: ({ scope }) => {
        calls.push({ scope });
        return {
          installed: true,
          paths: { project: "", user: "/h/.pi/agent/extensions/fil.ts" },
          piDetected: true,
        };
      },
    });
    const code = initCommand(ctx, parseArgs(["--scope", "user"]));
    expect(code).toBe(0);
    expect(calls).toEqual([{ scope: "user" }]);
  });

  it("--scope both lists both project and user paths in the log line", () => {
    const { ctx, lines } = ctxFor({
      installPiAdapter: () => ({
        installed: true,
        paths: {
          project: "/p/.pi/extensions/fil.ts",
          user: "/h/.pi/agent/extensions/fil.ts",
        },
        piDetected: true,
      }),
    });
    expect(initCommand(ctx, parseArgs(["--scope", "both"]))).toBe(0);
    const out = lines.join("\n");
    expect(out).toContain("scope=both");
    expect(out).toContain("/p/.pi/extensions/fil.ts");
    expect(out).toContain("/h/.pi/agent/extensions/fil.ts");
    expect(out).toContain(" and ");
  });

  it("is idempotent — re-running init does not reinstall the adapter", () => {
    let n = 0;
    const { ctx, lines } = ctxFor({
      installPiAdapter: () => {
        n++;
        return {
          installed: n === 1, // only the first call "installs"
          paths: { project: join(ctx.cwd, ".pi/extensions/fil.ts"), user: "" },
          piDetected: true,
          reason: n === 1 ? undefined : "Pi extension already installed (idempotent).",
        };
      },
    });
    expect(initCommand(ctx)).toBe(0);
    expect(initCommand(ctx)).toBe(0);
    // Both runs called the install callback exactly once each (the second was
    // a no-op as far as the callback's `installed` flag is concerned).
    expect(n).toBe(2);
    // The second run prints the idempotent reason, not "installed".
    const out = lines.join("\n");
    expect(out).toMatch(/already installed|idempotent/i);
  });

  it("skips the adapter install line when Pi is not detected", () => {
    const { ctx, lines } = ctxFor({
      installPiAdapter: () => ({
        installed: false,
        paths: { project: "", user: "" },
        piDetected: false,
        reason: "Pi not detected on this machine; skipping Pi Adapter install.",
      }),
    });
    expect(initCommand(ctx)).toBe(0);
    const out = lines.join("\n");
    expect(out).toContain("Pi not detected");
    expect(out).not.toContain("pi adapter: installed");
  });

  it("rejects an unknown --scope with exit code 2", () => {
    const calls: Array<{ scope: string }> = [];
    const { ctx, errors } = ctxFor({
      installPiAdapter: ({ scope }) => {
        calls.push({ scope });
        return {
          installed: false,
          paths: { project: "", user: "" },
          piDetected: true,
        };
      },
    });
    const code = initCommand(ctx, parseArgs(["--scope", "global"]));
    expect(code).toBe(2);
    expect(calls).toEqual([]); // never reached the callback
    expect(errors.join("\n")).toContain("Invalid --scope");
    expect(errors.join("\n")).toContain("global");
  });

  it("skips the adapter step entirely when no callback is on the context", () => {
    const lines: string[] = [];
    const ctx = defaultContext(workdir, {
      installPiAdapter: undefined,
      out: { log: (l) => lines.push(l), error: () => {} },
    });
    expect(initCommand(ctx)).toBe(0);
    // No "pi adapter:" line is emitted.
    expect(lines.join("\n")).not.toMatch(/pi adapter:/);
  });
});

// ---------------------------------------------------------------------------
// enforcement through the contract — end to end
// ---------------------------------------------------------------------------

describe("Pi enforcement — through the contract", () => {
  it("matches the projection the orchestrator writes to .fil/run.json", async () => {
    const { ctx } = ctxFor();
    initCommand(ctx);
    ctx.store.writeFlowText(
      "demo",
      serializeFlowCode(demoFlow() as Parameters<typeof serializeFlowCode>[0]),
    );
    await startCommand(ctx, parseArgs(["login", "--flow", "demo"]));

    const projection = ctx.store.readProjection();
    expect(projection).not.toBeNull();
    if (!projection) return;

    // Now run the same enforcement logic the Pi extension will run on load.
    const { enforcePiEnforcement } = await import("@color-sunset/fil-pi-adapter");
    const enforced = enforcePiEnforcement(
      { projection },
      { projectRoot: ctx.cwd, userFilDir: ctx.userFilDir, fileExists: () => false },
    );
    expect(enforced.hasActiveRun).toBe(true);
    // The orchestrator's projection is the single source of truth — the
    // Pi extension reads the same `.fil/run.json` and surfaces identical
    // allowedTools to the agent.
    expect(enforced.allowedTools).toEqual(projection.phaseConfig.allowedTools);
    expect(enforced.phase).toBe(projection.phase);
    expect(enforced.phases).toEqual(projection.phases);
    expect(enforced.systemPrompt).toContain(projection.phaseConfig.instructions);
    expect(enforced.systemPrompt).toContain(projection.runId);
  });
});

describe("fil init — adapter installs (Claude + Pi, stubbed)", () => {
  beforeEach(async () => {
    await rm(join(workdir, ".fil"), { recursive: true, force: true });
    await rm(join(workdir, ".gitignore"), { force: true });
  });

  /** A stub Claude result with the two-scope paths shape the CLI formats. */
  function claudeResult(installed: boolean, detected = true) {
    return {
      installed,
      claudeDetected: detected,
      paths: {
        project: { hook: "/p/.claude/fil/pretooluse-hook.js", settings: "/p/.claude/settings.json" },
        user: { hook: "/u/.claude/fil/pretooluse-hook.js", settings: "/u/.claude/settings.json" },
      },
      reason: installed ? undefined : "already installed (idempotent).",
    };
  }

  it("installs the Claude adapter and logs it when detected", () => {
    let scope: string | undefined;
    const { ctx, lines } = ctxFor({
      installPiAdapter: () => ({ installed: false, paths: { project: "p", user: "u" }, piDetected: false, reason: "stub" }),
      installClaudeAdapter: (opts) => {
        scope = opts.scope;
        return claudeResult(true);
      },
    });
    expect(initCommand(ctx)).toBe(0);
    expect(scope).toBe("project");
    const out = lines.join("\n");
    expect(out).toContain("claude adapter: installed (scope=project)");
    expect(out).toContain("pi adapter:"); // the stubbed Pi step reports its reason
  });

  it("honors --scope both for the Claude adapter too", () => {
    let scope: string | undefined;
    const { ctx } = ctxFor({
      installPiAdapter: () => ({ installed: false, paths: { project: "p", user: "u" }, piDetected: false, reason: "stub" }),
      installClaudeAdapter: (opts) => {
        scope = opts.scope;
        return claudeResult(true);
      },
    });
    expect(initCommand(ctx, parseArgs(["--scope", "both"]))).toBe(0);
    expect(scope).toBe("both");
  });

  it("skips both adapters when their callbacks are absent (opt-out)", () => {
    const { ctx, lines } = ctxFor({
      installPiAdapter: undefined,
      installClaudeAdapter: undefined,
    });
    expect(initCommand(ctx)).toBe(0);
    const out = lines.join("\n");
    expect(out).not.toContain("claude adapter");
    expect(out).not.toContain("pi adapter");
  });

  it("rejects an unknown --scope even when both adapter callbacks are absent", () => {
    const { ctx, errors } = ctxFor({
      installPiAdapter: undefined,
      installClaudeAdapter: undefined,
    });
    const code = initCommand(ctx, parseArgs(["--scope", "nope"]));
    expect(code).toBe(2);
    expect(errors.join("\n")).toContain("Invalid --scope");
    expect(errors.join("\n")).toContain("nope");
  });

  it("logs 'not detected' for Claude when it is absent on the host", () => {
    const { ctx, lines } = ctxFor({
      installPiAdapter: () => ({ installed: false, paths: { project: "p", user: "u" }, piDetected: false, reason: "stub" }),
      installClaudeAdapter: () => ({ ...claudeResult(false, false), reason: "Claude Code not detected on this machine; skipping Claude Adapter install." }),
    });
    expect(initCommand(ctx)).toBe(0);
    expect(lines.join("\n")).toContain("claude adapter:");
    expect(lines.join("\n")).toContain("not detected");
  });

  it("fails fast with exit 2 on an unknown --scope before either adapter runs", () => {
    const calls: string[] = [];
    const { ctx } = ctxFor({
      installPiAdapter: () => {
        calls.push("pi");
        return { installed: false, paths: { project: "p", user: "u" }, piDetected: true };
      },
      installClaudeAdapter: () => {
        calls.push("claude");
        return claudeResult(true);
      },
    });
    expect(initCommand(ctx, parseArgs(["--scope", "nope"]))).toBe(2);
    expect(calls).toEqual([]);
  });
});
describe("runInspectLoop", () => {
  it("exits immediately if the Flow is already done (never opens the reader)", async () => {
    const opened: boolean[] = [];
    const onDone = vi.fn();
    await runInspectLoop({
      isDone: () => true,
      send: () => {},
      openReader: async () => {
        opened.push(true);
        return async () => null;
      },
      onDone,
    });
    expect(opened).toHaveLength(0);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("advances once per line and stops at the terminal Phase", async () => {
    const script = ["a", "a", ""]; // Enter, Enter, then EOF
    let value = "a";
    const sends = vi.fn(() => {
      value = value === "a" ? "b" : "done";
    });
    const onAdvance = vi.fn();
    const onDone = vi.fn();
    await runInspectLoop({
      isDone: () => value === "done",
      send: sends,
      openReader: async () => async () => script.shift() ?? null,
      onAdvance,
      onDone,
    });
    // Two advances: a -> b, then b -> done.
    expect(sends).toHaveBeenCalledTimes(2);
    expect(onAdvance).toHaveBeenCalledTimes(2);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("stops on EOF before reaching done", async () => {
    const sends = vi.fn();
    await runInspectLoop({
      isDone: () => false,
      send: sends,
      openReader: async () => async () => null,
      onDone: vi.fn(),
    });
    expect(sends).toHaveBeenCalledTimes(0);
  });
});

describe("describeValue", () => {
  it("renders a leaf Phase name as-is", () => {
    expect(describeValue("code")).toBe("code");
  });

  it("renders null/undefined as a placeholder", () => {
    expect(describeValue(null)).toBe("—");
    expect(describeValue(undefined)).toBe("—");
  });

  it("renders a parallel Phase value (object) as JSON", () => {
    expect(describeValue({ branchA: "x", branchB: "y" })).toBe(
      JSON.stringify({ branchA: "x", branchB: "y" }),
    );
  });

  it("falls back to String() for non-serialisable values (circular)", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    // JSON.stringify throws on cycles; describeValue must not.
    expect(typeof describeValue(cyclic)).toBe("string");
  });
});

describe("fil inspect — error branches", () => {
  it("returns 1 and logs an error when the target Flow cannot be resolved", async () => {
    const isolated = await mkdtemp(join(tmpdir(), "color-sunset-fil-iso-"));
    const errs: string[] = [];
    try {
      const ctx = defaultContext(isolated, {
        out: { log: () => {}, error: (l) => errs.push(l) },
        inspectFlow: async () => {
          throw new Error("should not be called");
        },
      });
      const code = await inspectCommand(ctx, parseArgs([]));
      expect(code).toBe(1);
      expect(errs.join("\n")).toMatch(/not found|default/);
    } finally {
      await rm(isolated, { recursive: true, force: true });
    }
  });

  it("returns 1 and logs an error when ctx.inspectFlow is not bound", async () => {
    const { ctx, errors } = ctxFor({ inspectFlow: undefined });
    initCommand(ctx);
    const code = await inspectCommand(ctx, parseArgs([]));
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("Inspector is not available");
  });
});
