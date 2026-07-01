import type { FlowEngine } from "@fil/engine";

/**
 * Safe Flow evolution (the differentiator).
 *
 * An agent *proposes* a Flow edit as a unified-diff code patch; a human
 * *approves*. This module NEVER applies anything to disk — it decides whether
 * a patch is safe to apply. Two failure modes:
 *
 *  - `load`         — the patched code does not parse / load as a valid machine.
 *  - `reachability` — the patched machine is structurally broken: a Phase is
 *                     unreachable from the initial state, or a non-final Phase
 *                     can no longer reach a terminal (a deadlock).
 *
 * Pure: no I/O, no side effects.
 */

export interface ApplyProposalDeps {
  engine: FlowEngine;
  flowName: string;
}

export type ApplyProposalResult =
  | { ok: true; newCode: string }
  | { ok: false; error: "load" | "reachability"; message: string };

/** Validate a proposed patch without applying it. */
export function applyProposal(
  flowCode: string,
  patch: string,
  deps: ApplyProposalDeps,
): ApplyProposalResult {
  let newCode: string;
  try {
    newCode = applyUnifiedDiff(flowCode, patch);
  } catch (err) {
    return {
      ok: false,
      error: "load",
      message: `Patch does not apply: ${message(err)}`,
    };
  }

  let definition: unknown;
  try {
    definition = JSON.parse(newCode);
  } catch {
    return {
      ok: false,
      error: "load",
      message: "Patched code is not valid JSON.",
    };
  }

  const loaded = deps.engine.load(deps.flowName, definition as never);
  if (!loaded.ok) {
    return { ok: false, error: "load", message: loaded.error };
  }

  const reach = checkReachability(loaded.instance.serialize());
  if (!reach.ok) {
    return {
      ok: false,
      error: "reachability",
      message: reach.message ?? "Flow has a reachability problem.",
    };
  }

  return { ok: true, newCode };
}

// ---------------------------------------------------------------------------
// Structural reachability (no active-Run knowledge — that is the runtime guard)
// ---------------------------------------------------------------------------

interface ReachResult {
  ok: boolean;
  message?: string;
}

function checkReachability(graph: {
  initial: string[];
  nodes: { id: string; final: boolean }[];
  transitions: { from: string; to: string }[];
}): ReachResult {
  const ids = new Set(graph.nodes.map((n) => n.id));
  const adjacency = new Map<string, string[]>();
  for (const t of graph.transitions) {
    const list = adjacency.get(t.from) ?? [];
    list.push(t.to);
    adjacency.set(t.from, list);
  }

  // 1. Every node must be reachable from an initial phase.
  const reachable = new Set<string>();
  const queue = [...graph.initial];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (reachable.has(cur)) continue;
    reachable.add(cur);
    for (const next of adjacency.get(cur) ?? []) {
      if (!reachable.has(next)) queue.push(next);
    }
  }
  for (const id of ids) {
    if (!reachable.has(id)) {
      return {
        ok: false,
        message: `Phase "${id}" is unreachable from the initial state.`,
      };
    }
  }

  // 2. Every non-final reachable phase must be able to reach a terminal.
  const memo = new Map<string, boolean>();
  const canReachFinal = (id: string, stack: Set<string>): boolean => {
    if (memo.has(id)) return memo.get(id)!;
    const node = graph.nodes.find((n) => n.id === id);
    if (node?.final) {
      memo.set(id, true);
      return true;
    }
    if (stack.has(id)) return false; // cycle without reaching final on this path
    stack.add(id);
    const succ = adjacency.get(id) ?? [];
    const result = succ.length > 0 && succ.some((s) => canReachFinal(s, stack));
    stack.delete(id);
    memo.set(id, result);
    return result;
  };
  for (const node of graph.nodes) {
    if (node.final) continue;
    if (reachable.has(node.id) && !canReachFinal(node.id, new Set())) {
      return {
        ok: false,
        message: `Phase "${node.id}" cannot reach a terminal state (deadlock).`,
      };
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Unified-diff apply (git-apply compatible)
// ---------------------------------------------------------------------------

export function applyUnifiedDiff(original: string, patch: string): string {
  const origLines = original.split("\n");
  const patchLines = patch.split("\n");
  const patchAt = (k: number): string => patchLines[k] ?? "";
  const origAt = (k: number): string => origLines[k] ?? "";
  const out: string[] = [];
  let origIdx = 0;
  let i = 0;

  // Skip any header/preamble (e.g. "diff --git", "---", "+++") up to first hunk.
  while (i < patchLines.length && !patchAt(i).startsWith("@@")) {
    i++;
  }

  while (i < patchLines.length && patchAt(i).startsWith("@@")) {
    const header = patchAt(i);
    const match = header.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (!match) {
      throw new Error(`Malformed hunk header: "${header}"`);
    }
    const origStart = Number.parseInt(match[1] ?? "", 10);
    const target = origStart - 1;
    while (origIdx < target) {
      if (origIdx >= origLines.length) {
        throw new Error("Hunk start is beyond the end of the original file.");
      }
      out.push(origAt(origIdx));
      origIdx++;
    }
    i++;

    while (i < patchLines.length && !patchAt(i).startsWith("@@")) {
      const line = patchAt(i);
      const tag = line.charAt(0);
      const rest = line.slice(1);
      if (tag === " ") {
        assertMatch(origLines, origIdx, rest);
        out.push(rest);
        origIdx++;
      } else if (tag === "-") {
        assertMatch(origLines, origIdx, rest);
        origIdx++;
      } else if (tag === "+") {
        out.push(rest);
      } else if (tag === "\\") {
        // "\ No newline at end of file" marker — ignore.
      } else {
        break;
      }
      i++;
    }
  }

  while (origIdx < origLines.length) {
    out.push(origAt(origIdx));
    origIdx++;
  }
  return out.join("\n");
}

function assertMatch(lines: string[], idx: number, expected: string): void {
  if (idx >= lines.length || lines[idx] !== expected) {
    throw new Error(
      `Context mismatch at line ${idx + 1}: expected "${expected}", got "${lines[idx] ?? "<eof>"}".`,
    );
  }
}

// ---------------------------------------------------------------------------
// Unified-diff generation (used by `fil propose`)
// ---------------------------------------------------------------------------

/** Generate a unified-diff patch from old -> new text (3 lines of context). */
export function createUnifiedPatch(
  oldText: string,
  newText: string,
  oldPath = "flow.json",
  newPath = "flow.json",
): string {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const ops = diffLines(a, b);
  const hunks = groupHunks(ops, a, b);
  if (hunks.length === 0) return "";
  const lines: string[] = [
    `--- ${oldPath}`,
    `+++ ${newPath}`,
  ];
  for (const hunk of hunks) {
    lines.push(hunk.header);
    lines.push(...hunk.body);
  }
  return lines.join("\n") + "\n";
}

interface Op {
  type: "context" | "add" | "remove";
  a: number; // index into a (for context/remove)
  b: number; // index into b (for context/add)
}

/** LCS-based line diff producing an ordered op list. */
function diffLines(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );
  const get = (i: number, j: number): number => dp[i]?.[j] ?? 0;
  const set = (i: number, j: number, v: number): void => {
    const row = dp[i];
    if (row) row[j] = v;
  };
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      set(i, j, a[i] === b[j] ? get(i + 1, j + 1) + 1 : Math.max(get(i + 1, j), get(i, j + 1)));
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "context", a: i, b: j });
      i++;
      j++;
    } else if (get(i + 1, j) >= get(i, j + 1)) {
      ops.push({ type: "remove", a: i, b: j });
      i++;
    } else {
      ops.push({ type: "add", a: i, b: j });
      j++;
    }
  }
  while (i < n) {
    ops.push({ type: "remove", a: i, b: j });
    i++;
  }
  while (j < m) {
    ops.push({ type: "add", a: i, b: j });
    j++;
  }
  return ops;
}

interface Hunk {
  header: string;
  body: string[];
}

function groupHunks(ops: Op[], a: string[], b: string[]): Hunk[] {
  const context = 3;
  const changes: number[] = [];
  for (let p = 0; p < ops.length; p++) {
    const op = ops[p];
    if (op && op.type !== "context") changes.push(p);
  }
  if (changes.length === 0) return [];

  // Group change indices into runs separated by more than 2*context context lines.
  const ranges: Array<[number, number]> = [];
  let runStart = changes[0] ?? 0;
  let runEnd = runStart;
  for (let k = 1; k < changes.length; k++) {
    const c = changes[k];
    if (c !== undefined && c - runEnd <= 2 * context) {
      runEnd = c;
    } else {
      ranges.push([runStart, runEnd]);
      runStart = c ?? runEnd;
      runEnd = runStart;
    }
  }
  ranges.push([runStart, runEnd]);

  const hunks: Hunk[] = [];
  for (const [lo, hi] of ranges) {
    const start = Math.max(0, lo - context);
    const end = Math.min(ops.length - 1, hi + context);
    if (start > end) continue;
    const first = ops[start];
    if (!first) continue;
    const aStart = first.a;
    const bStart = first.b;

    const body: string[] = [];
    let aCount = 0;
    let bCount = 0;
    for (let p = start; p <= end; p++) {
      const op = ops[p];
      if (!op) continue;
      if (op.type === "context") {
        body.push(` ${a[op.a] ?? ""}`);
        aCount++;
        bCount++;
      } else if (op.type === "add") {
        body.push(`+${b[op.b] ?? ""}`);
        bCount++;
      } else {
        body.push(`-${a[op.a] ?? ""}`);
        aCount++;
      }
    }
    hunks.push({
      header: `@@ -${aStart + 1},${aCount} +${bStart + 1},${bCount} @@`,
      body,
    });
  }
  return hunks;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
