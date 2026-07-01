import { randomUUID } from "node:crypto";
import type {
  GateSpec,
  PhaseConfig,
  Receipt,
  RunProjection,
} from "@fil/contract";
import type { EngineInstance, FlowEngine, FlowDefinition } from "@fil/engine";
import { runGate as defaultRunGate, type GateContext } from "@fil/gate-runner";
import type { RunState, Store } from "@fil/store";

/**
 * The orchestrator binds the deep modules together through their interfaces:
 * it loads the Flow via the `FlowEngine`, runs Gates via `gate-runner`, and
 * persists durable state + the projection through the `Store`.
 *
 * It owns NO state itself — every operation reads the RunState, produces a new
 * one, and writes it back. The engine is reconstructed from the frozen Flow
 * snapshot, so a Run is reproducible as the Flow evolves (#12).
 */

export interface OrchestratorDeps {
  store: Store;
  engine: FlowEngine;
  /** Working directory for shell/test gates. */
  cwd: string;
  /** Override the gate runner (tests) or the human prompter. */
  runGate?: (gate: GateSpec, ctx: GateContext) => Promise<Receipt>;
  prompter?: (message: string) => Promise<boolean>;
}

export interface StartOptions {
  change: string;
  flowName: string;
  /** Resolved Flow definition (the CLI resolves via flow-loader). */
  definition: FlowDefinition;
}

export type StartResult =
  | { ok: true; run: RunState; projection: RunProjection }
  | { ok: false; error: string };

export interface AdvanceOutcome {
  /** Updated Run state (persisted). */
  run: RunState;
  /** Whether the Run transitioned to a new Phase. */
  advanced: boolean;
  /** Whether the Run reached its terminal Phase. */
  done: boolean;
  /** Receipts produced by this invocation. */
  receipts: Receipt[];
  /** Present when the Run did not advance (gate fail / already done / cancelled). */
  error?: string;
}

const FALLBACK_PHASE_CONFIG: PhaseConfig = {
  instructions: "",
  allowedTools: [],
  skills: [],
  context: { files: [], priorResults: [] },
  actorMode: "human",
  gate: { type: "shell", script: "true" },
};

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------
export async function startRun(
  deps: OrchestratorDeps,
  opts: StartOptions,
): Promise<StartResult> {
  const loaded = deps.engine.load(opts.flowName, opts.definition);
  if (!loaded.ok) {
    return { ok: false, error: loaded.error };
  }
  const instance = loaded.instance;
  const snapshot = instance.initial();
  const status = instance.getStatus(snapshot);

  const now = new Date().toISOString();
  const run: RunState = {
    runId: `run-${randomUUID()}`,
    change: opts.change,
    flowName: opts.flowName,
    status: "active",
    createdAt: now,
    history: [{ at: now, action: "start", phases: status.activePhases }],
    positions: [{ phases: status.activePhases, snapshot }],
    receipts: [],
  };

  deps.store.writeFlowSnapshot(run.runId, opts.definition);
  deps.store.writeRunState(run);
  const projection = project(run, instance);
  deps.store.writeProjection(projection);

  return { ok: true, run, projection };
}

// ---------------------------------------------------------------------------
// advance (fil next)
// ---------------------------------------------------------------------------
export async function advance(
  deps: OrchestratorDeps,
  run: RunState,
): Promise<AdvanceOutcome> {
  if (run.status === "cancelled") {
    return { run, advanced: false, done: false, receipts: [], error: "Run is cancelled." };
  }

  const reconstructed = reconstruct(deps, run);
  if (!reconstructed) {
    return {
      run,
      advanced: false,
      done: false,
      receipts: [],
      error: "Could not reconstruct the Run's Flow snapshot.",
    };
  }
  const { instance, snapshot } = reconstructed;
  const status = instance.getStatus(snapshot);

  if (status.done) {
    return { run, advanced: false, done: true, receipts: [], error: "Run is already complete." };
  }
  if (!instance.canTransition(snapshot, "NEXT")) {
    return {
      run,
      advanced: false,
      done: status.done,
      receipts: [],
      error: "There is no NEXT transition from the current Phase(s).",
    };
  }

  // Run the exit Gate of every active Phase. All must pass (parallel Phases).
  const runGate = deps.runGate ?? defaultRunGate;
  const receipts: Receipt[] = [];
  let allPassed = true;
  for (const phaseId of status.activePhases) {
    const config = instance.getPhaseConfig(phaseId);
    if (!config) {
      receipts.push(missingConfigReceipt(phaseId));
      allPassed = false;
      continue;
    }
    const ctx: GateContext = { cwd: deps.cwd, phase: phaseId, prompter: deps.prompter };
    let receipt: Receipt;
    try {
      receipt = await runGate(config.gate, ctx);
    } catch (err) {
      receipt = {
        phase: phaseId,
        gateType: config.gate.type,
        outcome: "fail",
        evidence: { stderr: `Gate runner error: ${errMsg(err)}` },
        ranAt: new Date().toISOString(),
      };
    }
    receipts.push(receipt);
    if (receipt.outcome !== "pass") allPassed = false;
  }

  if (!allPassed) {
    const updated = appendReceipts(run, receipts);
    deps.store.writeRunState(updated);
    const proj = project(updated, instance);
    deps.store.writeProjection(proj);
    return { run: updated, advanced: false, done: false, receipts, error: "A Gate failed." };
  }

  const nextSnapshot = instance.send(snapshot, "NEXT");
  const nextStatus = instance.getStatus(nextSnapshot);
  const now = new Date().toISOString();
  const updated: RunState = {
    ...appendReceipts(run, receipts),
    status: nextStatus.done ? "done" : "active",
    history: [
      ...run.history,
      { at: now, action: "advance", phases: nextStatus.activePhases },
    ],
    positions: [
      ...run.positions,
      { phases: nextStatus.activePhases, snapshot: nextSnapshot },
    ],
  };
  deps.store.writeRunState(updated);
  const proj = project(updated, instance);
  deps.store.writeProjection(proj);
  return { run: updated, advanced: true, done: nextStatus.done, receipts };
}

// ---------------------------------------------------------------------------
// back / cancel
// ---------------------------------------------------------------------------
export function back(deps: OrchestratorDeps, run: RunState): {
  run: RunState;
  retreated: boolean;
  error?: string;
} {
  if (run.status === "cancelled") {
    return { run, retreated: false, error: "Run is cancelled." };
  }
  if (run.positions.length <= 1) {
    return { run, retreated: false, error: "Already at the initial Phase." };
  }
  const popped = run.positions.slice(0, -1);
  const current = popped.at(-1);
  if (!current) {
    return { run, retreated: false, error: "No previous Phase to retreat to." };
  }
  const now = new Date().toISOString();
  const updated: RunState = {
    ...run,
    status: "active",
    history: [...run.history, { at: now, action: "back", phases: current.phases }],
    positions: popped,
  };
  const reconstructed = reconstruct(deps, updated);
  if (reconstructed) deps.store.writeProjection(project(updated, reconstructed.instance));
  deps.store.writeRunState(updated);
  return { run: updated, retreated: true };
}

export function cancel(deps: OrchestratorDeps, run: RunState): RunState {
  if (run.status === "cancelled") return run;
  const now = new Date().toISOString();
  const current = run.positions.at(-1);
  const updated: RunState = {
    ...run,
    status: "cancelled",
    history: [
      ...run.history,
      {
        at: now,
        action: "cancel",
        phases: current?.phases ?? [],
      },
    ],
  };
  const reconstructed = reconstruct(deps, updated);
  if (reconstructed) deps.store.writeProjection(project(updated, reconstructed.instance));
  deps.store.writeRunState(updated);
  return updated;
}

/** The Run's current Phase ids. */
export function currentPhases(run: RunState): string[] {
  return run.positions.at(-1)?.phases ?? [];
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

interface Reconstructed {
  instance: EngineInstance;
  snapshot: ReturnType<EngineInstance["initial"]>;
}

function reconstruct(deps: OrchestratorDeps, run: RunState): Reconstructed | null {
  const definition = deps.store.readFlowSnapshot(run.runId);
  if (!definition) return null;
  const loaded = deps.engine.load(run.flowName, definition);
  if (!loaded.ok) return null;
  const current = run.positions.at(-1);
  if (!current) return null;
  return { instance: loaded.instance, snapshot: current.snapshot };
}

function appendReceipts(run: RunState, receipts: Receipt[]): RunState {
  return { ...run, receipts: [...run.receipts, ...receipts] };
}

function missingConfigReceipt(phaseId: string): Receipt {
  return {
    phase: phaseId,
    gateType: "none",
    outcome: "fail",
    evidence: { stderr: `Phase "${phaseId}" has no PhaseConfig.` },
    ranAt: new Date().toISOString(),
  };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Derive the `.fil/run.json` projection from a Run's current position. */
export function project(run: RunState, instance: EngineInstance): RunProjection {
  const current = run.positions.at(-1);
  const snapshot = current?.snapshot ?? instance.initial();
  const status = instance.getStatus(snapshot);
  const phases = status.activePhases;
  const primary = phases[0] ?? "";
  const phaseConfig = instance.getPhaseConfig(primary) ?? FALLBACK_PHASE_CONFIG;
  let projectedStatus: RunProjection["status"];
  if (run.status === "cancelled") projectedStatus = "cancelled";
  else if (status.done) projectedStatus = "done";
  else projectedStatus = "active";
  return {
    runId: run.runId,
    change: run.change,
    flowName: run.flowName,
    status: projectedStatus,
    phase: primary,
    phases,
    actorMode: phaseConfig.actorMode,
    phaseConfig,
  };
}
