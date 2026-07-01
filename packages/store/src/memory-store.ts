import type { RunProjection } from "@fil/contract";
import {
  DEFAULT_CONFIG,
  type FilConfig,
  type RunState,
  type Store,
} from "./types.js";

/** An in-memory `Store` for tests — no disk required. */
export class MemoryStore implements Store {
  private config: FilConfig | null = null;
  private readonly flows = new Map<string, Record<string, unknown>>();
  private projection: RunProjection | null = null;
  private readonly runs = new Map<string, RunState>();
  private readonly snapshots = new Map<string, Record<string, unknown>>();
  private readonly proposals = new Map<string, string>();

  ensureLayout(): void {
    /* no-op */
  }

  readConfig(): FilConfig | null {
    return this.config ?? null;
  }

  writeConfig(config: FilConfig): void {
    this.config = { ...config };
  }

  listFlows(): string[] {
    return [...this.flows.keys()];
  }

  readFlow(name: string): Record<string, unknown> | undefined {
    return this.flows.get(name);
  }

  writeFlow(name: string, definition: Record<string, unknown>): void {
    this.flows.set(name, structuredClone(definition));
  }

  flowExists(name: string): boolean {
    return this.flows.has(name);
  }

  readProjection(): RunProjection | null {
    return this.projection;
  }

  writeProjection(projection: RunProjection): void {
    this.projection = structuredClone(projection);
  }

  clearProjection(): void {
    this.projection = null;
  }

  listRuns(): string[] {
    return [...this.runs.keys()];
  }

  readRunState(runId: string): RunState | null {
    return this.runs.get(runId) ?? null;
  }

  writeRunState(state: RunState): void {
    this.runs.set(state.runId, structuredClone(state));
  }

  readFlowSnapshot(runId: string): Record<string, unknown> | null {
    return this.snapshots.get(runId) ?? null;
  }

  writeFlowSnapshot(runId: string, definition: Record<string, unknown>): void {
    this.snapshots.set(runId, structuredClone(definition));
  }

  listProposals(): string[] {
    return [...this.proposals.keys()];
  }

  readProposal(id: string): string | null {
    return this.proposals.get(id) ?? null;
  }

  writeProposal(id: string, patch: string): void {
    this.proposals.set(id, patch);
  }

  removeProposal(id: string): void {
    this.proposals.delete(id);
  }

  /** Seed a default config (handy in tests). */
  withDefaultConfig(): this {
    this.config = { ...DEFAULT_CONFIG };
    return this;
  }
}
