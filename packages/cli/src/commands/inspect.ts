import { renderGraph } from "@color-sunset/fil-inspect-view";
import { currentPhases } from "@color-sunset/fil-orchestrator";
import { createMachine } from "@color-sunset/fil-engine";
import type { EngineSnapshot, FlowDefinition, InspectHandle } from "@color-sunset/fil-engine";
import type { CliContext } from "../context.js";
import type { ParsedArgs } from "../args.js";
import { activeRun, resolveFlowDefinition } from "./common.js";

/** Empty parsed-args — the default when `fil inspect` is called with no flags. */
const EMPTY_ARGS: ParsedArgs = { positional: [], flags: {} };

/**
 * `fil inspect` — visualizer over the active Flow.
 *
 * Default: launch the Stately inspector (`@statelyai/inspect`) in the browser —
 * the ADR-0002 view-only visualizer — and drive the Flow manually from stdin.
 * `--text`: the offline read-only text diagram over `FlowEngine.serialize()`
 * (the ADR-0003 seam's second consumer).
 */
export async function inspectCommand(
  ctx: CliContext,
  args: ParsedArgs = EMPTY_ARGS,
): Promise<number> {
  if (args.flags["text"] !== undefined) {
    return renderText(ctx);
  }
  return launchInspector(ctx);
}

/** `fil inspect --text` — the read-only text diagram. */
async function renderText(ctx: CliContext): Promise<number> {
  const current = activeRun(ctx);

  if (current) {
    const snapshot = ctx.store.readFlowSnapshot(current.run.runId);
    if (!snapshot) {
      ctx.out.error("Could not read the active Run's Flow snapshot.");
      return 1;
    }
    const machine = createMachine(snapshot as Parameters<typeof createMachine>[0]);
    const loaded = ctx.engine.load(current.run.flowName, machine);
    if (!loaded.ok) {
      ctx.out.error(loaded.error);
      return 1;
    }
    const graph = loaded.instance.serialize();
    const activePhases = currentPhases(current.run);
    ctx.out.log(renderGraph({ graph, activePhases }));
    return 0;
  }

  const resolved = await resolveFlowDefinition(ctx);
  if (!resolved.ok) {
    ctx.out.error(resolved.error);
    return 1;
  }
  const loaded = ctx.engine.load(resolved.name, resolved.definition);
  if (!loaded.ok) {
    ctx.out.error(loaded.error);
    return 1;
  }
  ctx.out.log(renderGraph({ graph: loaded.instance.serialize() }));
  return 0;
}

interface InspectTarget {
  ok: true;
  flowName: string;
  machine: FlowDefinition;
  snapshot?: EngineSnapshot;
  startPhases: string[];
}
type InspectTargetResult = InspectTarget | { ok: false; error: string };

/** Resolve what to inspect: the active Run (resumed) or the default Flow. */
async function resolveInspectTarget(ctx: CliContext): Promise<InspectTargetResult> {
  const current = activeRun(ctx);
  if (current) {
    const config = ctx.store.readFlowSnapshot(current.run.runId);
    if (!config) {
      return { ok: false, error: "Could not read the active Run's Flow snapshot." };
    }
    const position = current.run.positions.at(-1);
    return {
      ok: true,
      flowName: current.run.flowName,
      machine: createMachine(config as Parameters<typeof createMachine>[0]),
      snapshot: position?.snapshot,
      startPhases: position?.phases ?? currentPhases(current.run),
    };
  }

  const resolved = await resolveFlowDefinition(ctx);
  if (!resolved.ok) return resolved;
  const status = resolved.instance.getStatus(resolved.instance.initial());
  return {
    ok: true,
    flowName: resolved.name,
    machine: resolved.definition,
    startPhases: status.activePhases,
  };
}

/** `fil inspect` (default) — launch the Stately inspector + manual stdin loop. */
async function launchInspector(ctx: CliContext): Promise<number> {
  const target = await resolveInspectTarget(ctx);
  if (!target.ok) {
    ctx.out.error(target.error);
    return 1;
  }

  const launch = ctx.inspectFlow;
  if (!launch) {
    ctx.out.error("Inspector is not available in this context.");
    return 1;
  }

  let handle: InspectHandle;
  try {
    handle = await launch({ machine: target.machine, snapshot: target.snapshot });
  } catch (err) {
    ctx.out.error(`Could not launch the inspector: ${message(err)}`);
    return 1;
  }

  ctx.out.log(`Inspecting the "${target.flowName}" Flow.`);
  ctx.out.log(`Starting at: ${target.startPhases.join(", ") || "—"}`);
  ctx.out.log("Inspector open in your browser. Press Enter to advance (NEXT). Ctrl-C to exit.");

  let reader;
  try {
    reader = await ctx.openInspectReader();
  } catch (err) {
    handle.stop();
    ctx.out.error(`Could not open input: ${message(err)}`);
    return 1;
  }
  const cleanup = (): void => {
    reader.close();
    handle.stop();
  };
  process.once("SIGINT", cleanup);
  try {
    await runInspectLoop({
      send: () => {
        handle.actor.send({ type: "NEXT" });
      },
      isDone: () => handle.actor.getSnapshot().status === "done",
      openReader: async () => reader.readLine,
      onAdvance: () => {
        const snapshot = handle.actor.getSnapshot();
        ctx.out.log(`current: ${describeValue(snapshot.value)}`);
      },
      onDone: () => ctx.out.log("Flow reached its terminal Phase."),
    });
  } finally {
    process.removeListener("SIGINT", cleanup);
    reader.close();
    handle.stop();
  }
  return 0;
}

/** Dependencies for {@link runInspectLoop} — injectable so the loop is unit-testable. */
export interface InspectLoopDeps {
  /** Advance the Flow by one transition (send `NEXT`). */
  send(): void;
  /** True when the Flow has reached its terminal Phase. */
  isDone(): boolean;
  /** Lazily open the line reader (stdin) and return a `readLine` closure. */
  openReader(): Promise<() => Promise<string | null>>;
  /** Called after each successful advance. */
  onAdvance?(): void;
  /** Called when the Flow reaches its terminal Phase. */
  onDone?(): void;
}

/**
 * The manual advance loop: wait for Enter → advance the Flow → repeat until the
 * terminal Phase or EOF. `openReader` is called lazily, so if the Flow is
 * already done nothing is read (keeps the caller off stdin in that case).
 */
export async function runInspectLoop(deps: InspectLoopDeps): Promise<void> {
  if (deps.isDone()) {
    deps.onDone?.();
    return;
  }
  const readLine = await deps.openReader();
  let line = await readLine();
  while (line !== null) {
    // Any non-EOF line (e.g. the user pressing Enter) advances the Flow.
    deps.send();
    deps.onAdvance?.();
    if (deps.isDone()) {
      deps.onDone?.();
      return;
    }
    line = await readLine();
  }
}

/** Render a snapshot value as a readable Phase label. */
export function describeValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "—";
  try {
    return JSON.stringify(value);
  } catch {
    // JSON.stringify throws on circular refs; fall back to the explicit
    // `Object.prototype.toString` form so the result is predictable (e.g.
    // "[object Object]") rather than triggering the implicit toString() of
    // a host object that might be confusing.
    return Object.prototype.toString.call(value);
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
