import type { EngineSnapshot } from "@fil/engine";
import type { Receipt, RunProjection, RunStatus } from "@fil/contract";

/**
 * Durable Fil layout (PRD):
 *   .fil/config.json       (committed)
 *   .fil/flows/*.json      (committed — the shared recipe)
 *   .fil/run.json          (gitignored — the projection Adapters read)
 *   .fil/runs/<id>/        (gitignored — Run state + receipts + flow snapshot)
 *   .fil/proposals/*.patch (gitignored — agent-proposed Flow edits)
 */

export interface FilConfig {
  /** Agent runtimes this project steers (e.g. ["pi", "claude"]). */
  agentRuntimes: string[];
  /** The Flow used when `fil start` is called without `--flow`. */
  defaultFlow: string;
}

export type RunAction = "start" | "advance" | "back" | "cancel";

/** An audit-trail entry (append-only) — what happened and when. */
export interface AuditEntry {
  at: string;
  action: RunAction;
  /** Active Phase ids after this action. */
  phases: string[];
}

/** A point the Run has occupied (its position stack; the last is current). */
export interface Position {
  /** Active Phase ids at this position. */
  phases: string[];
  /** Engine snapshot at this position (durable, JSON-serializable). */
  snapshot: EngineSnapshot;
}

export interface RunState {
  runId: string;
  change: string;
  flowName: string;
  status: RunStatus;
  createdAt: string;
  /** Append-only audit trail of every action. */
  history: AuditEntry[];
  /** Position stack; the last entry is the Run's current position. */
  positions: Position[];
  /** Every Gate receipt, in order (the audit trail). */
  receipts: Receipt[];
}

/** A definition of the `.fil/` repository the orchestrator depends on. */
export interface Store {
  // --- layout / config ---
  ensureLayout(): void;
  readConfig(): FilConfig | null;
  writeConfig(config: FilConfig): void;

  // --- flows ---
  listFlows(): string[];
  readFlow(name: string): Record<string, unknown> | undefined;
  writeFlow(name: string, definition: Record<string, unknown>): void;
  flowExists(name: string): boolean;

  // --- active projection ---
  readProjection(): RunProjection | null;
  writeProjection(projection: RunProjection): void;
  clearProjection(): void;

  // --- runs ---
  listRuns(): string[];
  readRunState(runId: string): RunState | null;
  writeRunState(state: RunState): void;

  // --- flow snapshots (frozen per Run) ---
  readFlowSnapshot(runId: string): Record<string, unknown> | null;
  writeFlowSnapshot(runId: string, definition: Record<string, unknown>): void;

  // --- proposals ---
  listProposals(): string[];
  readProposal(id: string): string | null;
  writeProposal(id: string, patch: string): void;
  removeProposal(id: string): void;
}

export const DEFAULT_CONFIG: FilConfig = {
  agentRuntimes: [],
  defaultFlow: "default",
};
