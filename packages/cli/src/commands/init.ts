import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BUILT_IN_FLOWS, serializeFlowCode } from "@fil/engine";
import type { InstallScope, InstallResult } from "@fil/pi-adapter";
import type { InstallResult as ClaudeInstallResult } from "@fil/claude-adapter";
import type { ParsedArgs } from "../args.js";
import { flag } from "../args.js";
import type { CliContext } from "../context.js";

const VALID_SCOPES: readonly InstallScope[] = ["project", "user", "both"];
const EMPTY_ARGS: ParsedArgs = { positional: [], flags: {} };
const GITIGNORE_ENTRIES: readonly string[] = [
  ".fil/runs/",
  ".fil/run.json",
  ".fil/proposals/",
];
const GITIGNORE_HEADER = "# Fil — durable local state (Runs/proposals are not committed)";

/** `fil init` — scaffold the durable `.fil/` layout (idempotent). */
export function initCommand(ctx: CliContext, args?: ParsedArgs): number {
  ensureFilLayout(ctx);
  updateGitignore(ctx.cwd);
  const scaffolded = scaffoldBuiltInFlows(ctx);
  logInitSummary(ctx, scaffolded);
  const parsed = args ?? EMPTY_ARGS;
  // A bad --scope fails fast (exit 2) before touching either adapter.
  const pi = installPiAdapterStep(ctx, parsed);
  if (pi !== 0) return pi;
  return installClaudeAdapterStep(ctx, parsed);
}

/** Ensure `.fil/flows/`, `.fil/runs/`, `.fil/proposals/`, and config.json exist. */
function ensureFilLayout(ctx: CliContext): void {
  ctx.store.ensureLayout();
}

/** Append Fil's gitignore entries to the project `.gitignore` (idempotent). */
function updateGitignore(projectRoot: string): void {
  const path = join(projectRoot, ".gitignore");
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const missing = GITIGNORE_ENTRIES.filter((entry) => !existing.includes(entry));
  if (missing.length === 0) return;
  const block = `\n${GITIGNORE_HEADER}\n${missing.join("\n")}\n`;
  const needsLeadingNewline = existing.length > 0 && !existing.endsWith("\n");
  appendFileSync(path, needsLeadingNewline ? `\n${block}` : block);
}

/** Write the built-in Flows that aren't already on disk. Returns the names scaffolded. */
function scaffoldBuiltInFlows(ctx: CliContext): string[] {
  const scaffolded: string[] = [];
  for (const flow of BUILT_IN_FLOWS) {
    if (!ctx.store.flowExists(flow.name)) {
      ctx.store.writeFlowText(flow.name, serializeFlowCode(flow.rawConfig));
      scaffolded.push(flow.name);
    }
  }
  return scaffolded;
}

/** Print the human-readable summary of the init step. */
function logInitSummary(ctx: CliContext, scaffolded: readonly string[]): void {
  const { store, out } = ctx;
  out.log("Initialised Fil in .fil/");
  out.log(`  flows: ${store.listFlows().join(", ") || "(none)"}`);
  if (scaffolded.length > 0) {
    out.log(`  scaffolded built-in flows: ${scaffolded.join(", ")}`);
  }
  out.log(`  default flow: ${store.readConfig()?.defaultFlow ?? "default"}`);
  out.log("  .fil/flows/ and .fil/config.json are committable; runs/proposals are gitignored.");
}

/**
 * Optional adapter install: tolerant of an uninstalled Pi, idempotent
 * across re-runs, and opt-out via `ctx.installPiAdapter === undefined`
 * (the unit tests use this to exercise the layout path in isolation).
 * Default scope is `project`; the user can widen with `--scope user`
 * or `--scope both`. Returns 2 on an unknown `--scope` (the only
 * non-zero exit the command produces).
 */
function installPiAdapterStep(ctx: CliContext, args: ParsedArgs): number {
  if (!ctx.installPiAdapter) return 0;
  const scope = parseScope(flag(args, "scope"));
  if (!scope.ok) {
    ctx.out.error(scope.error);
    return 2;
  }
  const result = ctx.installPiAdapter({ scope: scope.value });
  ctx.out.log(formatAdapterLog(scope.value, result));
  return 0;
}

function formatAdapterLog(scope: InstallScope, result: InstallResult): string {
  if (!result.piDetected) {
    return `  pi adapter: ${result.reason ?? "skipped (Pi not detected)"}`;
  }
  const targets = formatTargets(scope, result.paths);
  const action = result.installed
    ? `installed (scope=${scope})`
    : (result.reason ?? "already installed");
  return `  pi adapter: ${action} at ${targets}`;
}

function parseScope(
  raw: string | undefined,
): { ok: true; value: InstallScope } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: "project" };
  if ((VALID_SCOPES as readonly string[]).includes(raw)) {
    return { ok: true, value: raw as InstallScope };
  }
  return {
    ok: false,
    error: `Invalid --scope "${raw}"; expected one of: ${VALID_SCOPES.join(", ")}.`,
  };
}

/** Format the target path(s) for a given scope so the log line names them all. */
function formatTargets(
  scope: InstallScope,
  paths: { project: string; user: string },
): string {
  if (scope === "both") return `${paths.project} and ${paths.user}`;
  return paths[scope];
}

/**
 * Optional Claude Code adapter install: tolerant of an uninstalled Claude
 * Code, idempotent across re-runs, and opt-out via
 * `ctx.installClaudeAdapter === undefined`. Shares the single `--scope` flag
 * with the Pi step. Returns 2 on an unknown `--scope`.
 */
function installClaudeAdapterStep(ctx: CliContext, args: ParsedArgs): number {
  if (!ctx.installClaudeAdapter) return 0;
  const scope = parseScope(flag(args, "scope"));
  if (!scope.ok) {
    ctx.out.error(scope.error);
    return 2;
  }
  const result = ctx.installClaudeAdapter({ scope: scope.value });
  ctx.out.log(formatClaudeLog(scope.value, result));
  return 0;
}

function formatClaudeLog(scope: InstallScope, result: ClaudeInstallResult): string {
  if (!result.claudeDetected) {
    return `  claude adapter: ${result.reason ?? "skipped (Claude Code not detected)"}`;
  }
  const targets = formatClaudeTargets(scope, result.paths);
  const action = result.installed
    ? `installed (scope=${scope})`
    : (result.reason ?? "already installed");
  return `  claude adapter: ${action} at ${targets}`;
}

function formatClaudeTargets(
  scope: InstallScope,
  paths: { project: { hook: string; settings: string }; user: { hook: string; settings: string } },
): string {
  const fmt = (p: { hook: string; settings: string }) => `${p.hook} (+ ${p.settings})`;
  if (scope === "both") return `${fmt(paths.project)} and ${fmt(paths.user)}`;
  return fmt(paths[scope]);
}
