import type { PhaseConfig } from "@fil/contract";

/**
 * The FlowEngine seam (ADR-0003).
 *
 * Fil-core talks ONLY to this interface, never to a state-machine library
 * directly. The seam is protocol-shaped so a future engine — even a subprocess
 * in another language — can implement it without re-architecting the core.
 *
 * Rule (ADR-0003): **no engine-library imports outside the engine adapter
 * module.** This file must not import XState or any other engine.
 *
 * Flows are serializable engine config (ADR-0002). The `FlowDefinition` is
 * engine-specific — there is no neutral Flow format. For the default XState
 * engine a `FlowDefinition` is XState machine config (data-only JSON).
 */

/** Engine-specific Flow configuration (XState config JSON for the default engine). */
export type FlowDefinition = Record<string, unknown>;

/**
 * A durable, JSON-serializable snapshot of a Run's position in the Flow.
 * Opaque to callers; only an `EngineInstance` interprets it.
 */
export interface EngineSnapshot {
  value: unknown;
  status: string;
  [extra: string]: unknown;
}

/** Where a Run currently stands within the Flow. */
export interface EngineStatus {
  /** Leaf Phase ids currently active (parallel Phases → more than one). */
  activePhases: string[];
  /** True when the Flow is in a parallel region with >1 active phase. */
  parallel: boolean;
  /** True when the Flow has reached its terminal state. */
  done: boolean;
}

/** A node in the neutral Flow graph (for the view-only inspect surface). */
export interface FlowGraphNode {
  id: string;
  phase?: PhaseConfig;
  final: boolean;
  parallel: boolean;
  children: string[];
}

/** A directed edge in the neutral Flow graph. */
export interface FlowGraphTransition {
  from: string;
  to: string;
  event: string;
}

/** Neutral, serializable description of a Flow — the inspect surface's input. */
export interface FlowGraph {
  flowName: string;
  initial: string[];
  nodes: FlowGraphNode[];
  transitions: FlowGraphTransition[];
}

/** An error raised when a Flow fails to load as a valid machine. */
export interface FlowLoadError {
  ok: false;
  error: string;
}

/** A successfully loaded Flow, ready to run. */
export interface EngineInstance {
  /** The snapshot at the Flow's initial Phase. */
  initial(): EngineSnapshot;
  /** Apply an event, returning the resulting snapshot (unchanged if unhandled). */
  send(snapshot: EngineSnapshot, event: string): EngineSnapshot;
  /** Whether the event would change the active Phase(s). */
  canTransition(snapshot: EngineSnapshot, event: string): boolean;
  /** Active Phase set + done flag for a snapshot. */
  getStatus(snapshot: EngineSnapshot): EngineStatus;
  /** The PhaseConfig carried by a Phase node (from its meta), if any. */
  getPhaseConfig(phaseId: string): PhaseConfig | undefined;
  /** The neutral graph (read-only inspect surface). */
  serialize(): FlowGraph;
  /** Name of the loaded Flow. */
  readonly flowName: string;
}

/** Result of loading a FlowDefinition. */
export type LoadResult =
  | { ok: true; instance: EngineInstance }
  | FlowLoadError;

/** Loads a FlowDefinition into a runnable EngineInstance. */
export interface FlowEngine {
  load(
    flowName: string,
    definition: FlowDefinition,
  ): LoadResult;
}
