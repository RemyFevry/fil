import type { FlowDefinition, FlowEngine } from "@color-sunset/fil-engine";
import { engineEntryUrl } from "@color-sunset/fil-engine";

/**
 * Safe Flow evolution (the differentiator).
 *
 * An agent *proposes* a Flow edit as a unified-diff code patch; a human
 * *approves*. This module NEVER applies anything to disk — it decides whether
 * a patch is safe to apply. Two failure modes:
 *
 *  - `load`         — the patched code does not import / load as a valid machine.
 *  - `reachability` — the patched machine is structurally broken: a Phase is
 *                     unreachable from the initial state, or a non-final Phase
 *                     can no longer reach a terminal (a deadlock).
 *
 * Deterministic: no disk I/O. Code execution (importing the patched module) is
 * delegated to an injected `loadCode`, so the logic is unit-testable.
 */

export type FlowCodeResult =
  | { ok: true; definition: FlowDefinition }
  | { ok: false; error: string };

export interface ApplyProposalDeps {
  engine: FlowEngine;
  flowName: string;
  /** Execute Flow source code, returning its exported definition. */
  loadCode: (code: string) => Promise<FlowCodeResult>;
}

export type ApplyProposalResult =
  | { ok: true; newCode: string }
  | { ok: false; error: "load" | "reachability"; message: string };

/** Validate a proposed patch without applying it. */
export async function applyProposal(
  flowCode: string,
  patch: string,
  deps: ApplyProposalDeps,
): Promise<ApplyProposalResult> {
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

  const loaded = await deps.loadCode(newCode);
  if (!loaded.ok) {
    return {
      ok: false,
      error: "load",
      message: `Patched code failed to load: ${loaded.error}`,
    };
  }

  const machine = deps.engine.load(deps.flowName, loaded.definition);
  if (!machine.ok) {
    return { ok: false, error: "load", message: machine.error };
  }

  const reach = checkReachability(machine.instance.serialize());
  if (!reach.ok) {
    return {
      ok: false,
      error: "reachability",
      message: reach.message ?? "Flow has a reachability problem.",
    };
  }

  return { ok: true, newCode };
}

/**
 * Default `loadCode`: write the Flow source to a temporary file, then
 * dynamically import it. The `@color-sunset/fil-engine` import in the Flow code is
 * rewritten to an absolute path resolved from this module's own location,
 * so the temp file can live anywhere (including the OS temp directory)
 * without Node ESM resolution failures.
 */
export async function loadFlowCode(code: string): Promise<FlowCodeResult> {
  const { realpathSync } = await import("node:fs");
  const { writeFile, mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { pathToFileURL } = await import("node:url");

  const resolvedCode = engineEntryUrl
    ? code.replace(
        /from\s+["']@color-sunset\/fil-engine["']/g,
        `from "${engineEntryUrl}"`,
      )
    : code;

  // On Windows, `os.tmpdir()` returns the 8.3 short-name form
  // (`C:\Users\RUNNER~1\AppData\Local\Temp\…`) on the GitHub-hosted
  // runner. `pathToFileURL` URL-encodes the `~` as `%7E`, but Node's
  // ESM loader can't round-trip the URL back to a path the OS can
  // open, so dynamic `import()` reports "Failed to load url ... Does
  // the file exist?" even though the file is on disk. `realpathSync`
  // on `tmpdir()` itself asks the OS to expand the short name once,
  // so every subsequent path (dir, file, URL) is a long-name path
  // with no 8.3 components. No-op on POSIX.
  const tmpRoot = realpathSync(tmpdir());
  const dir = await mkdtemp(join(tmpRoot, "fil-evo-"));
  const file = join(dir, "flow.mjs");
  try {
    await writeFile(file, resolvedCode, "utf8");
    const mod = (await import(pathToFileURL(file).href)) as {
      default?: FlowDefinition;
    };
    if (!mod.default) {
      return { ok: false, error: "Flow module has no default export." };
    }
    return { ok: true, definition: mod.default };
  } catch (err) {
    return { ok: false, error: message(err) };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
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
  const adjacency = buildAdjacency(graph.transitions);
  const reachable = computeReachable(graph.initial, adjacency);

  const unreachable = graph.nodes.find((n) => !reachable.has(n.id));
  if (unreachable) {
    return {
      ok: false,
      message: `Phase "${unreachable.id}" is unreachable from the initial state.`,
    };
  }

  return checkDeadlocks(graph, reachable, adjacency);
}

function buildAdjacency(transitions: { from: string; to: string }[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const t of transitions) {
    const list = adjacency.get(t.from) ?? [];
    list.push(t.to);
    adjacency.set(t.from, list);
  }
  return adjacency;
}

function computeReachable(
  initial: string[],
  adjacency: Map<string, string[]>,
): Set<string> {
  const reachable = new Set<string>();
  const queue = [...initial];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (reachable.has(cur)) continue;
    reachable.add(cur);
    for (const next of adjacency.get(cur) ?? []) {
      if (!reachable.has(next)) queue.push(next);
    }
  }
  return reachable;
}

function checkDeadlocks(
  graph: { nodes: { id: string; final: boolean }[] },
  reachable: Set<string>,
  adjacency: Map<string, string[]>,
): ReachResult {
  const memo = new Map<string, boolean>();
  for (const node of graph.nodes) {
    if (node.final) continue;
    if (!reachable.has(node.id)) continue;
    if (canReachFinal(node.id, graph, adjacency, memo, new Set())) continue;
    return {
      ok: false,
      message: `Phase "${node.id}" cannot reach a terminal state (deadlock).`,
    };
  }
  return { ok: true };
}

function canReachFinal(
  id: string,
  graph: { nodes: { id: string; final: boolean }[] },
  adjacency: Map<string, string[]>,
  memo: Map<string, boolean>,
  stack: Set<string>,
): boolean {
  const cached = memo.get(id);
  if (cached !== undefined) return cached;
  const node = graph.nodes.find((n) => n.id === id);
  if (node?.final) {
    memo.set(id, true);
    return true;
  }
  if (stack.has(id)) return false; // cycle without reaching final on this path
  stack.add(id);
  const succ = adjacency.get(id) ?? [];
  const result = succ.some((s) => canReachFinal(s, graph, adjacency, memo, stack));
  stack.delete(id);
  memo.set(id, result);
  return result;
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
  const startIdx = skipPreamble(patchLines, 0);

  if (patch.trim() !== "" && startIdx >= patchLines.length) {
    throw new Error("Patch contains no hunks.");
  }

  let i = startIdx;
  let sawHunk = false;
  while (i < patchLines.length && patchAt(i).startsWith("@@")) {
    sawHunk = true;
    const header = patchAt(i);
    const origStart = parseHunkHeader(header);
    origIdx = copyContextBeforeHunk(origIdx, origStart, origLines, out, origAt);
    i++;
    const body = applyHunkBody(patchLines, i, origLines, origIdx, out);
    i = body.nextPatchIdx;
    origIdx = body.nextOrigIdx;
    assertNoUnexpectedContent(patchLines, i);
  }

  if (!sawHunk && patch.trim() !== "") {
    throw new Error("Patch contains no hunks.");
  }

  return appendTrailing(origLines, origIdx, out, origAt);
}

function assertNoUnexpectedContent(patchLines: string[], i: number): void {
  if (i >= patchLines.length) return;
  const next = patchLines[i] ?? "";
  if (next.startsWith("@@")) return;
  // Allow trailing whitespace-only lines after the final hunk.
  if (next.trim() === "") return;
  throw new Error(`Unexpected patch content after hunks: ${JSON.stringify(next)}`);
}

/** Skip any header/preamble lines (e.g. "diff --git", "---", "+++") before the first hunk. */
function skipPreamble(patchLines: string[], start: number): number {
  let i = start;
  while (i < patchLines.length && !patchLines[i]?.startsWith("@@")) {
    i++;
  }
  return i;
}

function parseHunkHeader(header: string): number {
  const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(header);
  if (!match) {
    throw new Error(`Malformed hunk header: "${header}"`);
  }
  return Number.parseInt(match[1] ?? "", 10);
}

function copyContextBeforeHunk(
  origIdx: number,
  origStart: number,
  origLines: string[],
  out: string[],
  origAt: (k: number) => string,
): number {
  const target = origStart - 1;
  let idx = origIdx;
  while (idx < target) {
    if (idx >= origLines.length) {
      throw new Error("Hunk start is beyond the end of the original file.");
    }
    out.push(origAt(idx));
    idx++;
  }
  return idx;
}

interface HunkBodyResult {
  nextPatchIdx: number;
  nextOrigIdx: number;
}

function applyHunkBody(
  patchLines: string[],
  start: number,
  origLines: string[],
  origIdx: number,
  out: string[],
): HunkBodyResult {
  let i = start;
  let idx = origIdx;
  while (i < patchLines.length && !patchLines[i]?.startsWith("@@")) {
    const line = patchLines[i] ?? "";
    const tag = line.charAt(0);
    const rest = line.slice(1);
    if (tag === " ") {
      assertMatch(origLines, idx, rest);
      out.push(rest);
      idx++;
    } else if (tag === "-") {
      assertMatch(origLines, idx, rest);
      idx++;
    } else if (tag === "+") {
      out.push(rest);
    } else if (tag === "\\") {
      // "\ No newline at end of file" marker — ignore.
    } else {
      break;
    }
    i++;
  }
  return { nextPatchIdx: i, nextOrigIdx: idx };
}

function appendTrailing(
  origLines: string[],
  origIdx: number,
  out: string[],
  origAt: (k: number) => string,
): string {
  let idx = origIdx;
  while (idx < origLines.length) {
    out.push(origAt(idx));
    idx++;
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
  const lines: string[] = [`--- ${oldPath}`, `+++ ${newPath}`];
  for (const hunk of hunks) {
    lines.push(hunk.header, ...hunk.body);
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
  const changes = collectChangeIndices(ops);
  if (changes.length === 0) return [];

  const ranges = groupChangeRuns(changes, context);
  return ranges.flatMap(([lo, hi]) => {
    const hunk = buildHunk(ops, a, b, lo, hi, context);
    return hunk ? [hunk] : [];
  });
}

function collectChangeIndices(ops: Op[]): number[] {
  const indices: number[] = [];
  for (let p = 0; p < ops.length; p++) {
    if (ops[p]?.type !== "context") indices.push(p);
  }
  return indices;
}

/** Group change indices into runs separated by more than 2*context context lines. */
function groupChangeRuns(changes: number[], context: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let runStart = changes[0] ?? 0;
  let runEnd = runStart;
  for (let k = 1; k < changes.length; k++) {
    const c = changes[k];
    if (c === undefined) continue;
    if (c - runEnd <= 2 * context) {
      runEnd = c;
    } else {
      ranges.push([runStart, runEnd]);
      runStart = c;
      runEnd = runStart;
    }
  }
  ranges.push([runStart, runEnd]);
  return ranges;
}

function buildHunk(
  ops: Op[],
  a: string[],
  b: string[],
  lo: number,
  hi: number,
  context: number,
): Hunk | null {
  const start = Math.max(0, lo - context);
  const end = Math.min(ops.length - 1, hi + context);
  if (start > end) return null;
  const first = ops[start];
  if (!first) return null;
  const aStart = first.a;
  const bStart = first.b;

  const body: string[] = [];
  let aCount = 0;
  let bCount = 0;
  for (let p = start; p <= end; p++) {
    const op = ops[p];
    if (!op) continue;
    appendOpLine(op, a, b, body);
    const counts = countOp(op);
    aCount += counts.a;
    bCount += counts.b;
  }
  return {
    header: `@@ -${aStart + 1},${aCount} +${bStart + 1},${bCount} @@`,
    body,
  };
}

function appendOpLine(op: Op, a: string[], b: string[], body: string[]): void {
  if (op.type === "context") body.push(` ${a[op.a] ?? ""}`);
  else if (op.type === "add") body.push(`+${b[op.b] ?? ""}`);
  else body.push(`-${a[op.a] ?? ""}`);
}

function countOp(op: Op): { a: number; b: number } {
  if (op.type === "context") return { a: 1, b: 1 };
  if (op.type === "add") return { a: 0, b: 1 };
  return { a: 1, b: 0 };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}