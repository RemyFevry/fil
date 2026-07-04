import { createActor } from "xstate";
import type { AnyStateMachine } from "xstate";
import type { PhaseConfig } from "@color-sunset/fil-contract";
import type {
  EngineSnapshot,
  EngineStatus,
  FlowDefinition,
  FlowEngine,
  FlowGraph,
  FlowGraphNode,
  FlowGraphTransition,
  LoadResult,
} from "./seam.js";

/**
 * The default `FlowEngine` implementation over XState v5 (ADR-0002, ADR-0003).
 *
 * A Flow is XState machine JS code, authored with `createMachine(...)` from
 * `@color-sunset/fil-engine` (which wraps xstate's `createMachine` internally) — matching
 * the canonical XState examples at https://stately.ai/docs/xstate. Fil supplies
 * no inline implementations to the machine; per-Phase configuration lives on
 * each state node's `meta.phase`. Gate execution (with Receipt capture) is the
 * orchestrator's job — the machine only carries the Phase config and the
 * unconditional transition graph.
 *
 * Durability uses XState's persisted-snapshot API: snapshots returned here are
 * JSON-serializable and are restored via `createActor(machine, { snapshot })`.
 */
export class XStateFlowEngine implements FlowEngine {
  load(
    flowName: string,
    machine: FlowDefinition,
  ): LoadResult {
    if (!machine || typeof machine !== "object") {
      return { ok: false, error: `Flow "${flowName}" is not a machine.` };
    }
    const config = (machine as AnyStateMachine).config;
    if (!config || typeof config !== "object") {
      return { ok: false, error: `Flow "${flowName}" has no readable config.` };
    }

    const rootId =
      typeof config.id === "string" ? (config.id as string) : flowName;

    const meta = new Map<string, PhaseConfig>();
    const nodes: FlowGraphNode[] = [];
    const transitions: FlowGraphTransition[] = [];

    walkStates(
      config.states,
      "",
      rootId,
      meta,
      nodes,
      transitions,
    );

    // ADR-0004 clean-break aid: a Phase still carrying the pre-ADR-0004 singular
    // `gate` shape fails load with a migration hint (no silent compat shim).
    const legacy = detectLegacyGateShape(meta);
    if (legacy) {
      return {
        ok: false,
        error:
          `Flow "${flowName}" uses the old single-gate shape (Phase "${legacy}" has \`gate\` ` +
          `instead of \`gates\`). Re-run \`fil init\` to re-scaffold, or rename \`gate:{...}\` ` +
          `to \`gates:[{name, type, ...}]\` (ADR-0004).`,
      };
    }

    // Validate the machine actually runs by materialising its initial snapshot.
    let initialSnapshot: EngineSnapshot;
    try {
      initialSnapshot = persist(createActor(machine as AnyStateMachine));
    } catch (err) {
      return { ok: false, error: `Flow "${flowName}" failed to start: ${message(err)}` };
    }
    if (initialSnapshot.status === "error" || initialSnapshot.value == null) {
      return {
        ok: false,
        error: `Flow "${flowName}" has no resolvable initial Phase.`,
      };
    }

    const initialLeaves = flattenValue(initialSnapshot.value);
    const graph: FlowGraph = {
      flowName,
      initial: initialLeaves,
      nodes: [...nodes].sort(byId),
      transitions: [...transitions].sort(byTransition),
    };

    return {
      ok: true,
      instance: {
        flowName,
        initial: () => initialSnapshot,
        send: (snapshot, event) => {
          if (snapshot.status === "done") return snapshot;
          const actor = createActor(machine as AnyStateMachine, { snapshot: snapshot as never });
          actor.start();
          actor.send({ type: event });
          return persist(actor);
        },
        canTransition: (snapshot, event) => {
          if (snapshot.status === "done") return false;
          const before = snapshot.value;
          const actor = createActor(machine as AnyStateMachine, { snapshot: snapshot as never });
          actor.start();
          actor.send({ type: event });
          const after = actor.getSnapshot().value;
          return !sameValue(before, after);
        },
        getStatus: (snapshot) => statusOf(snapshot),
        getPhaseConfig: (phaseId) => meta.get(phaseId),
        serialize: () => graph,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface StateNodeDef {
  type?: string;
  initial?: string;
  on?: Record<string, unknown>;
  states?: Record<string, StateNodeDef>;
  meta?: { phase?: PhaseConfig };
}

/** Persist an actor's current snapshot (start must already have been called). */
function persist(actor: ReturnType<typeof createActor>): EngineSnapshot {
  const persisted = actor.getPersistedSnapshot();
  return persisted as unknown as EngineSnapshot;
}

/**
 * Detect a Phase still carrying the pre-ADR-0004 singular `gate` field. Such a
 * Phase lacks the required `gates` array; surface a clear migration error
 * instead of letting downstream code fail on `undefined` gates.
 */
function detectLegacyGateShape(meta: Map<string, PhaseConfig>): string | null {
  for (const [id, phase] of meta) {
    const raw = phase as unknown as { gate?: unknown; gates?: unknown };
    if (raw.gate !== undefined && !Array.isArray(raw.gates)) {
      return id;
    }
  }
  return null;
}

function statusOf(snapshot: EngineSnapshot): EngineStatus {
  const activePhases = flattenValue(snapshot.value);
  const parallel = activePhases.length > 1;
  const done = snapshot.status === "done";
  return { activePhases, parallel, done };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function byId(a: FlowGraphNode, b: FlowGraphNode): number {
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

function byTransition(a: FlowGraphTransition, b: FlowGraphTransition): number {
  if (a.from === b.from) {
    const byTo = compareByTo(a, b);
    if (byTo !== 0) return byTo;
    return compareString(a.event, b.event);
  }
  const byFrom = compareByFrom(a, b);
  if (byFrom !== 0) return byFrom;
  return compareString(a.event, b.event);
}

function compareByTo(a: FlowGraphTransition, b: FlowGraphTransition): number {
  return compareString(a.to, b.to);
}

function compareByFrom(a: FlowGraphTransition, b: FlowGraphTransition): number {
  return compareString(a.from, b.from);
}

function compareString(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Flatten an XState snapshot value into dot-path leaf Phase ids. */
function flattenValue(value: unknown, prefix = ""): string[] {
  if (typeof value === "string") {
    return [prefix ? `${prefix}.${value}` : value];
  }
  if (value && typeof value === "object") {
    let out: string[] = [];
    for (const [key, child] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      out = out.concat(flattenValue(child, path));
    }
    return out;
  }
  return [];
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Resolve an XState transition target to a dot-path leaf/branch id.
 *
 * XState semantics:
 *   - `".child"` (dot prefix) → relative to the *source* state path
 *   - `"sibling"` (no prefix) → sibling of the source (resolved via parent path)
 *   - `"#id"`              → absolute id reference
 */
function resolveTarget(
  rawTarget: unknown,
  sourcePath: string,
  sourceParent: string,
  rootId: string,
): string | null {
  const target =
    typeof rawTarget === "object" && rawTarget !== null && "target" in rawTarget
      ? (rawTarget as { target: unknown }).target
      : rawTarget;
  if (typeof target !== "string") return null;

  if (target.startsWith("#")) {
    // Absolute id reference: "#<rootId>.<path>" -> "<path>"
    const afterHash = target.slice(1);
    const dot = afterHash.indexOf(".");
    const strippedRoot = dot >= 0 ? afterHash.slice(dot + 1) : afterHash;
    if (strippedRoot === rootId) return rootId;
    return strippedRoot || null;
  }
  if (target.startsWith(".")) {
    // Relative target — append to the source's path.
    return sourcePath ? `${sourcePath}${target}` : target.slice(1);
  }
  // Sibling name — append to the source's parent path.
  return sourceParent ? `${sourceParent}.${target}` : target;
}

function walkStates(
  states: unknown,
  parentPath: string,
  rootId: string,
  meta: Map<string, PhaseConfig>,
  nodes: FlowGraphNode[],
  transitions: FlowGraphTransition[],
): void {
  if (!states || typeof states !== "object") return;
  for (const [name, node] of Object.entries(states as Record<string, StateNodeDef>)) {
    walkState(name, node, parentPath, rootId, meta, nodes, transitions);
  }
}

function walkState(
  name: string,
  node: StateNodeDef,
  parentPath: string,
  rootId: string,
  meta: Map<string, PhaseConfig>,
  nodes: FlowGraphNode[],
  transitions: FlowGraphTransition[],
): void {
  const path = parentPath ? `${parentPath}.${name}` : name;
  const phase = node?.meta?.phase;
  if (phase) {
    meta.set(path, phase);
  }
  const childPaths = collectChildPaths(node, path);
  if (node?.states) {
    walkStates(node.states, path, rootId, meta, nodes, transitions);
  }
  nodes.push({
    id: path,
    phase,
    final: node?.type === "final",
    parallel: node?.type === "parallel",
    children: childPaths,
  });
  recordTransitions(node, path, parentPath, rootId, transitions);
}

function collectChildPaths(node: StateNodeDef, path: string): string[] {
  const childPaths: string[] = [];
  if (!node?.states) return childPaths;
  for (const childName of Object.keys(node.states)) {
    childPaths.push(`${path}.${childName}`);
  }
  return childPaths;
}

function recordTransitions(
  node: StateNodeDef,
  path: string,
  parentPath: string,
  rootId: string,
  transitions: FlowGraphTransition[],
): void {
  if (!node?.on) return;
  for (const [event, target] of Object.entries(node.on)) {
    const list = Array.isArray(target) ? target : [target];
    for (const entry of list) {
      const to = resolveTarget(entry, path, parentPath, rootId);
      if (to) {
        transitions.push({ from: path, to, event });
      }
    }
  }
}