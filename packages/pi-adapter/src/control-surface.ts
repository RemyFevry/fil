import { spawnSync } from "node:child_process";

/**
 * The Pi Adapter control surface — exposes Fil's control verbs (`start`, `next`,
 * `status`, `propose`, `approve`) as native Pi tools (Pi's `registerTool`).
 *
 * The verbs are *thin callers* over the `fil` CLI: behaviour is identical to the
 * CLI because they invoke the same binary. This keeps the deep logic in
 * `@color-sunset/fil-cli`/`@color-sunset/fil-orchestrator` and out of the Adapter (ADR-0001: steer, don't
 * run). The rendered Pi extension (extension-source.ts) embeds a self-contained
 * equivalent; this module is the unit-testable source of truth for the verb set
 * and the arg↔argv mapping.
 */

export type VerbParamKind = "positional" | "flag";

export interface FilVerbParam {
  name: string;
  kind: VerbParamKind;
  required: boolean;
  description: string;
}

export interface FilVerbTool {
  /** The Pi/MCP tool name (e.g. `fil_next`). */
  toolName: string;
  /** Human-readable label for the runtime UI. */
  label: string;
  /** Description for the model. */
  description: string;
  /** The `fil` CLI verb (e.g. `next`). */
  verb: string;
  params: readonly FilVerbParam[];
  /** Optional one-line snippet for the runtime's available-tools prompt. */
  promptSnippet?: string;
}

/**
 * The five Fil control verbs, mapped to the `fil` CLI surface. Keep these in
 * sync with the CLI's argument shapes (`packages/cli/src/commands/*`).
 */
export const FIL_VERB_TOOLS: readonly FilVerbTool[] = [
  {
    toolName: "fil_start",
    label: "Fil: start",
    description:
      "Start a Fil Run bound to a Change. Begins steering the agent through the Flow's first Phase.",
    verb: "start",
    params: [
      { name: "change", kind: "positional", required: true, description: "The Change this Run delivers (e.g. 'add-login')." },
      { name: "flow", kind: "flag", required: false, description: "Flow name (defaults to the project's default Flow)." },
    ],
    promptSnippet: "Start a Fil Run: fil_start { change, flow? }",
  },
  {
    toolName: "fil_next",
    label: "Fil: next",
    description:
      "Run the current Phase's Gate and advance on pass. The gate runs an external test, not the agent's say-so.",
    verb: "next",
    params: [],
    promptSnippet: "Advance the Fil Run: fil_next",
  },
  {
    toolName: "fil_status",
    label: "Fil: status",
    description: "Show the current Phase, Gate, allowedTools, and skills.",
    verb: "status",
    params: [],
    promptSnippet: "Show Fil Run status: fil_status",
  },
  {
    toolName: "fil_propose",
    label: "Fil: propose",
    description:
      "Propose a Flow edit as a patch under .fil/proposals/ (NOT applied). Validate and apply with fil_approve.",
    verb: "propose",
    params: [
      { name: "flow", kind: "positional", required: true, description: "The Flow being edited." },
      { name: "file", kind: "positional", required: true, description: "Path to the proposed Flow file." },
    ],
    promptSnippet: "Propose a Flow edit: fil_propose { flow, file }",
  },
  {
    toolName: "fil_approve",
    label: "Fil: approve",
    description:
      "Validate (load + reachability + stranded-Run guard) and apply a proposed Flow edit. Shapes future Runs only.",
    verb: "approve",
    params: [
      { name: "id", kind: "positional", required: true, description: "The proposal id (returned by fil_propose)." },
      { name: "flow", kind: "flag", required: false, description: "Flow name if it cannot be inferred from the proposal." },
    ],
    promptSnippet: "Apply a Fil proposal: fil_approve { id, flow? }",
  },
];

export interface VerbResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type VerbRunner = (argv: string[], opts: { cwd: string }) => VerbResult;

/**
 * Resolve a single param's value (or undefined when absent). Throws for a
 * missing required param. Extracted from `toArgv` to keep that function's
 * cognitive complexity under the Sonar threshold — both kinds share the
 * "resolve value → check missing/required → throw or skip" logic here.
 */
function resolveArgValue(
  p: FilVerbParam,
  args: Record<string, unknown>,
  tool: FilVerbTool,
): string | undefined {
  const v = args[p.name];
  const missing = p.kind === "flag" ? v === undefined || v === null || v === false : v === undefined || v === null;
  if (missing) {
    if (p.required) throw new Error(`Missing required argument "${p.name}" for ${tool.toolName}.`);
    return undefined;
  }
  return String(v);
}

/** Map a tool invocation's args to the `fil` CLI argv (positionals in order, then flags). Pure. */
export function toArgv(tool: FilVerbTool, args: Record<string, unknown>): string[] {
  const argv: string[] = [];
  for (const p of tool.params) {
    if (p.kind !== "positional") continue;
    const v = resolveArgValue(p, args, tool);
    if (v !== undefined) argv.push(v);
  }
  for (const p of tool.params) {
    if (p.kind !== "flag") continue;
    const v = resolveArgValue(p, args, tool);
    if (v !== undefined) argv.push(`--${p.name}`, v);
  }
  return argv;
}

/** Find a verb tool by its tool name. */
export function findVerbTool(toolName: string): FilVerbTool | undefined {
  return FIL_VERB_TOOLS.find((t) => t.toolName === toolName);
}

/** Run a fil verb via the runner. Pure given the runner. */
export function runFilVerb(
  tool: FilVerbTool,
  args: Record<string, unknown>,
  deps: { cwd: string; runner: VerbRunner },
): VerbResult {
  let argv: string[];
  try {
    argv = toArgv(tool, args);
  } catch (err) {
    return { exitCode: 2, stdout: "", stderr: err instanceof Error ? err.message : String(err) };
  }
  return deps.runner([tool.verb, ...argv], { cwd: deps.cwd });
}

/**
 * Resolve the `fil` executable. `FIL_BIN` (absolute path to the CLI entry, a
 * `.js`) → run via `node <entry>`; otherwise the `fil` bin is expected on PATH.
 * The `isMain` guard in `@color-sunset/fil-cli` recognises both forms from any cwd.
 */
export function filBin(): { cmd: string; pre: string[] } {
  const envBin = process.env.FIL_BIN;
  if (envBin) return { cmd: process.execPath, pre: [envBin] };
  return { cmd: "fil", pre: [] };
}

/** Default runner: shells out to the `fil` CLI. */
export const defaultRunner: VerbRunner = (argv, opts) => {
  const { cmd, pre } = filBin();
  const res = spawnSync(cmd, [...pre, ...argv], { cwd: opts.cwd, encoding: "utf8" });
  return { exitCode: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
};

/** Render the textual result a runtime tool returns to the model. Pure. */
export function formatVerbResult(r: VerbResult): string {
  const text = (r.stdout + (r.stderr ? `\n${r.stderr}` : "")).trim();
  if (text) return text;
  return `(fil exited ${r.exitCode})`;
}

// ---------------------------------------------------------------------------
// Rendered Pi tool registrations — embedded into the installed extension.
// Self-contained (no @fil imports): Pi loads the extension via jiti where only
// `typebox`/`@sinclair/typebox` and node builtins resolve. `Type` and
// `spawnSync` are imported at the top of the extension module.
// ---------------------------------------------------------------------------

interface RenderedTool {
  name: string;
  verb: string;
  label: string;
  description: string;
  snippet: string | undefined;
  params: Array<[name: string, kind: VerbParamKind, required: boolean]>;
}

/** Render the registerTool block (data + helpers + loop) as a JS string. */
export function renderToolRegistrations(): string {
  const tools: RenderedTool[] = FIL_VERB_TOOLS.map((t) => ({
    name: t.toolName,
    verb: t.verb,
    label: t.label,
    description: t.description,
    snippet: t.promptSnippet,
    params: t.params.map((p) => [p.name, p.kind, p.required]),
  }));
  return `// --- Fil control surface: register the fil verbs as native Pi tools (#15). ---
const FIL_TOOLS = ${JSON.stringify(tools)};

function filBuildSchema(params) {
  const props = {};
  for (const [name, _kind, required] of params) {
    props[name] = required ? Type.String() : Type.Optional(Type.String());
  }
  return Type.Object(props);
}

function filToArgv(params, spec) {
  const positionals = [];
  const flags = [];
  for (const [name, kind, required] of spec) {
    const v = params ? params[name] : undefined;
    if (v === undefined || v === null || v === false) {
      if (required) throw new Error("Missing required argument '" + name + "'.");
      continue;
    }
    if (kind === "positional") positionals.push(String(v));
    else flags.push("--" + name, String(v));
  }
  return [...positionals, ...flags];
}

function filRun(argv, cwd) {
  // Test seam: when set, route through the injected runner instead of spawning
  // the fil binary. Lets the tool-surface tests verify dispatch without spawning
  // it (environment-flaky in CI). Undefined in production.
  if (typeof globalThis !== "undefined" && globalThis.__filRunForTests__) {
    return globalThis.__filRunForTests__(argv, cwd);
  }
  const envBin = process.env.FIL_BIN;
  const res = envBin
    ? spawnSync(process.execPath, [envBin, ...argv], { cwd, encoding: "utf8" })
    : spawnSync("fil", argv, { cwd, encoding: "utf8" });
  return { exitCode: res.status == null ? -1 : res.status, stdout: res.stdout || "", stderr: res.stderr || "" };
}

function filToolResult(r) {
  const text = (r.stdout + (r.stderr ? "\\n" + r.stderr : "")).trim();
  return {
    content: [{ type: "text", text: text || ("(fil exited " + r.exitCode + ")") }],
    details: { exitCode: r.exitCode },
    terminate: false,
  };
}

for (const t of FIL_TOOLS) {
  pi.registerTool({
    name: t.name,
    label: t.label,
    description: t.description,
    promptSnippet: t.snippet,
    parameters: filBuildSchema(t.params),
    execute: async function (_toolCallId, params, _signal, _onUpdate, ctx) {
      const cwd = (ctx && ctx.cwd) || process.cwd();
      let argv;
      try {
        argv = filToArgv(params, t.params);
      } catch (err) {
        return {
          content: [{ type: "text", text: String((err && err.message) || err) }],
          details: { exitCode: 2 },
          terminate: false,
        };
      }
      return filToolResult(filRun([t.verb, ...argv], cwd));
    },
  });
}`;
}

