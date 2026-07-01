import type { FlowGraph, FlowGraphNode } from "@fil/engine";

/**
 * A view-only visualizer (ADR: MVP is view-only).
 *
 * Consumes ONLY `FlowEngine.serialize()` (the `FlowGraph`) plus the Run's
 * active Phases — never XState directly. This is the second consumer of the
 * seam (the ADR-0003 pressure test).
 */

export interface InspectInput {
  graph: FlowGraph;
  /** Currently-active Phase ids (highlighted). */
  activePhases?: string[];
}

/** Render a Flow graph + active Phase as a read-only text diagram. */
export function renderGraph(input: InspectInput): string {
  const { graph } = input;
  const active = new Set(input.activePhases ?? []);
  const order = orderNodes(graph);

  const lines: string[] = [
    `${bold(graph.flowName)}  (initial: ${graph.initial.join(", ") || "—"})`,
    "",
  ];

  const transitionsFrom = buildTransitionsFrom(graph);

  for (const node of order) {
    lines.push(formatNodeLine(node, active));
    for (const target of transitionsFrom.get(node.id) ?? []) {
      lines.push(`        └─ NEXT ─▶ ${target.id}`);
    }
  }

  if (active.size > 0) {
    lines.push("", formatActiveLine(active));
  }

  return lines.join("\n");
}

function buildTransitionsFrom(graph: FlowGraph): Map<string, FlowGraphNode[]> {
  const transitionsFrom = new Map<string, FlowGraphNode[]>();
  for (const node of graph.nodes) {
    const targets: FlowGraphNode[] = [];
    for (const t of graph.transitions) {
      if (t.from !== node.id) continue;
      const target = graph.nodes.find((n) => n.id === t.to);
      if (target) targets.push(target);
    }
    transitionsFrom.set(node.id, targets);
  }
  return transitionsFrom;
}

function formatNodeLine(node: FlowGraphNode, active: Set<string>): string {
  const phase = node.phase;
  const marker = active.has(node.id) ? `${cyan("▶")}` : " ";
  const tags: string[] = [];
  if (node.parallel) tags.push("parallel");
  if (phase) tags.push(`[${phase.actorMode}]`);
  if (phase) tags.push(`gate: ${gateLabel(phase.gate.type)}`);
  if (node.final) tags.push("(final)");
  return `  ${marker} ${node.id.padEnd(26)} ${tags.join("  ")}`;
}

function formatActiveLine(active: Set<string>): string {
  const ids = [...active];
  return active.size > 1
    ? `active Phases: ${ids.join(", ")} (parallel)`
    : `active Phase: ${ids.join("")}`;
}

/** Order nodes by traversal from the initial Phases, then any leftovers. */
function orderNodes(graph: FlowGraph): FlowGraphNode[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const visited = new Set<string>();
  const ordered: FlowGraphNode[] = [];

  const visit = (id: string): void => {
    if (visited.has(id)) return;
    const node = byId.get(id);
    if (!node) return;
    visited.add(id);
    ordered.push(node);
    for (const t of graph.transitions) {
      if (t.from === id) visit(t.to);
    }
    for (const child of node.children) visit(child);
  };

  for (const start of graph.initial) visit(start);
  for (const node of graph.nodes) {
    if (!visited.has(node.id)) ordered.push(node);
  }
  return ordered;
}

function gateLabel(type: string): string {
  switch (type) {
    case "shell":
      return "shell";
    case "testsPass":
      return "tests";
    case "human":
      return "human-confirm";
    default:
      return type;
  }
}

function bold(text: string): string {
  return `\x1b[1m${text}\x1b[0m`;
}
function cyan(text: string): string {
  return `\x1b[36m${text}\x1b[0m`;
}
