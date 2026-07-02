import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { PhaseConfig, RunProjection } from "@fil/contract";

/**
 * The Claude Code Adapter enforcement surface (Claude Code is the Agent Runtime).
 *
 * Mirrors the engine-isolation guard (ADR-0003): the only artefact that may
 * reference Claude Code's runtime is the *installed PreToolUse hook* (rendered
 * by `hook-source.ts`). The deep logic below stays pure and depends only on the
 * contract, so CI can exercise enforcement — and the tool-use decision — without
 * Claude Code installed.
 *
 * The hard enforcement layer for Claude Code is a `PreToolUse` hook that reads
 * `.fil/run.json` and blocks any tool not in the active Phase's `allowedTools`.
 * The remaining fields (`systemPrompt`, `skillPaths`, `contextPaths`) are the
 * Tier-0 advisory surface — identical in derivation to the Pi Adapter — kept so
 * a future control-surface / instructions injection can consume them.
 */

/** Where the project-level skill layout lives (committed, shared). */
export const PROJECT_SKILLS_DIR = ".fil/skills";

/** Where the user-level skill layout lives (~/.fil/skills — user-private). */
export function userSkillsDir(userFilDir: string): string {
  return join(userFilDir, "skills");
}

export interface ClaudeEnforcementDeps {
  /** Absolute path to the project root. */
  projectRoot: string;
  /** Absolute path to the user's Fil directory (e.g. ~/.fil). */
  userFilDir: string;
  /** Filesystem probe — injection point for tests. */
  fileExists?: (path: string) => boolean;
  /**
   * Canonical-path probe — injection point for tests. Returns the resolved
   * path (symlinks followed) or `undefined` when missing / not canonicalizable.
   * Defaults to `fs.realpathSync` wrapped to return `undefined` on error.
   */
  realpath?: (path: string) => string | undefined;
}

export interface ClaudeEnforcement {
  /** True if there is an active Run to enforce against. */
  hasActiveRun: boolean;
  /** Primary active Phase (human label). */
  phase: string;
  /** All active Phase ids (parallel runs include more than one). */
  phases: readonly string[];
  /** The allowedTools forwarded verbatim from the Phase's config. */
  allowedTools: readonly string[];
  /** The advisory system-prompt text (instructions + context + Fil footer). */
  systemPrompt: string;
  /** Absolute skill SKILL.md paths for the active Phase (project then user). */
  skillPaths: readonly string[];
  /** Absolute in-project context-file paths that exist on disk. */
  contextPaths: readonly string[];
}

const DORMANT: ClaudeEnforcement = {
  hasActiveRun: false,
  phase: "",
  phases: [],
  allowedTools: [],
  systemPrompt: "",
  skillPaths: [],
  contextPaths: [],
};

/** A pure-projection shape, decoupled from where it was read. */
export interface EnforceInput {
  projection: RunProjection;
}

/** Compute the Claude enforcement state for the given projection. */
export function enforceClaudeEnforcement(
  input: EnforceInput,
  deps: ClaudeEnforcementDeps,
): ClaudeEnforcement {
  if (input.projection.status !== "active") return DORMANT;
  const cfg = input.projection.phaseConfig;
  const exists = deps.fileExists ?? defaultFileExists;
  const realpath = deps.realpath ?? safeRealpath;

  const skillPaths = resolveSkillPaths(cfg.skills, deps, exists);
  const contextPaths = resolveContextPaths(cfg.context.files, deps, realpath, exists);

  return {
    hasActiveRun: true,
    phase: input.projection.phase,
    phases: input.projection.phases,
    allowedTools: cfg.allowedTools,
    systemPrompt: composeSystemPrompt(input.projection),
    skillPaths,
    contextPaths,
  };
}

// ---------------------------------------------------------------------------
// PreToolUse decision — the core of the Claude enforcement layer.
// ---------------------------------------------------------------------------

export interface ToolDecision {
  /** True when the tool call may proceed (Fil imposes no block). */
  allow: boolean;
  /** Present when `allow` is false — surfaced to Claude as the deny reason. */
  reason?: string;
}

/**
 * Decide whether a `PreToolUse` hook should let `toolName` through, given the
 * active Run projection.
 *
 * - No active Run (or done/cancelled) → allow: Fil is dormant and must not
 *   interfere with Claude when nothing is being steered.
 * - Empty `allowedTools` → deny (fail-closed): a Phase that permits no tools
 *   blocks every tool call, mirroring the Pi Adapter's `tool_call` handler.
 * - `toolName` in `allowedTools` → allow (Claude's own permission flow still
 *   applies; Fil only adds its Phase restriction on top).
 * - Otherwise → deny with a reason naming the Phase and the allowed set.
 */
export function decideToolUse(
  projection: RunProjection | null,
  toolName: string,
): ToolDecision {
  if (!projection || projection.status !== "active") return { allow: true };
  const cfg = projection.phaseConfig;
  const allowed = cfg.allowedTools;
  if (allowed.length === 0) {
    return {
      allow: false,
      reason: `Fil Phase '${projection.phase}' permits no tools.`,
    };
  }
  if (allowed.includes(toolName)) return { allow: true };
  return {
    allow: false,
    reason: `Fil Phase '${projection.phase}' disallows tool '${toolName}'. Allowed: ${allowed.join(", ")}.`,
  };
}

// ---------------------------------------------------------------------------
// helpers (pure)
// ---------------------------------------------------------------------------

/** Resolve a Phase's skill names to absolute SKILL.md paths, project first. */
function resolveSkillPaths(
  skills: readonly string[],
  deps: ClaudeEnforcementDeps,
  exists: (path: string) => boolean,
): string[] {
  const userSkillsRoot = userSkillsDir(deps.userFilDir);
  const out: string[] = [];
  for (const name of skills) {
    const project = resolveSkillPath(deps.projectRoot, name);
    if (project && exists(project)) {
      out.push(project);
      continue;
    }
    const user = resolveSkillAt(userSkillsRoot, name);
    if (user && exists(user)) {
      out.push(user);
    }
  }
  return out;
}

/**
 * Resolve a Phase's context files to absolute paths that exist on disk *and*
 * stay within the project root. Traversal escapes *and* out-of-project
 * symlinks are dropped; fail-closed when realpath can't resolve a candidate.
 */
function resolveContextPaths(
  files: readonly string[],
  deps: ClaudeEnforcementDeps,
  realpath: (path: string) => string | undefined,
  exists: (path: string) => boolean,
): string[] {
  const realRoot = realpath(deps.projectRoot) ?? deps.projectRoot;
  const out: string[] = [];
  for (const file of files) {
    const abs = isAbsolute(file) ? resolve(file) : resolve(deps.projectRoot, file);
    const real = realpath(abs);
    if (!real) continue;
    if (!isWithinProject(realRoot, real)) continue;
    if (exists(real)) out.push(real);
  }
  return out;
}

/** Compose the advisory system-prompt injection from the contract's content. */
function composeSystemPrompt(projection: RunProjection): string {
  const cfg = projection.phaseConfig;
  const phaseLine =
    projection.phases.length > 1
      ? `${projection.phases.join(", ")} (parallel)`
      : projection.phase;
  const blocks: string[] = [
    "# Fil — Phase instructions",
    "",
    cfg.instructions.trim(),
    "",
    contextBlock(cfg),
    "",
    "# Fil — current Run",
    `Run ${projection.runId} · change "${projection.change}" · flow "${projection.flowName}"`,
    `Phase ${phaseLine} · actor ${projection.actorMode}`,
    `Gate (to advance): ${describeGate(cfg.gate.type)}`,
    "Advance via `fil next` (the gate runs an external test, not the agent's say-so).",
  ];
  return blocks.filter((b) => b.length > 0).join("\n");
}

/** Build the "Fil — context" block from the contract's context. */
function contextBlock(cfg: PhaseConfig): string {
  const parts: string[] = ["# Fil — context"];
  if (cfg.context.files.length > 0) {
    parts.push("Files in scope:", ...cfg.context.files.map((f) => `  - ${f}`));
  }
  const notes = cfg.context.notes?.trim();
  if (notes) {
    parts.push("Notes:", notes);
  }
  if (cfg.context.priorResults.length > 0) {
    parts.push(
      "Receipts from prior Phases:",
      ...cfg.context.priorResults.map((r) => `  - ${r}`),
    );
  }
  return parts.length === 1 ? "" : parts.join("\n");
}

function describeGate(type: string): string {
  switch (type) {
    case "shell":
      return "shell command (exit 0 = pass)";
    case "testsPass":
      return "test suite (exit 0 = pass)";
    case "human":
      return "human confirmation prompt";
    default:
      return type;
  }
}

function defaultFileExists(path: string): boolean {
  return existsSync(path);
}

/** Best-effort `realpathSync` returning `undefined` on any failure. */
function safeRealpath(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

/** True when `candidate` is `projectRoot` itself or sits under it. */
function isWithinProject(projectRoot: string, candidate: string): boolean {
  const rel = relative(projectRoot, candidate);
  if (rel === "") return true;
  if (rel.startsWith("..")) return false;
  if (isAbsolute(rel)) return false;
  return true;
}

/** Resolve a skill name under `${projectRoot}/.fil/skills/`. */
function resolveSkillPath(projectRoot: string, name: string): string | null {
  return resolveSkillAt(join(projectRoot, PROJECT_SKILLS_DIR), name);
}

/** Resolve `${dir}/${name}/SKILL.md` if the segment is safe. */
function resolveSkillAt(dir: string, name: string): string | null {
  if (!isSafeSkillSegment(name)) return null;
  return join(dir, name, "SKILL.md");
}

/**
 * Safe skill segment: lowercase a-z, digits, hyphens; 1-64 chars; no
 * leading/trailing hyphen, no consecutive hyphens. Anything else fails closed.
 */
function isSafeSkillSegment(name: string): boolean {
  if (name.length === 0 || name.length > 64) return false;
  if (!/^[a-z0-9-]+$/.test(name)) return false;
  if (name.startsWith("-") || name.endsWith("-")) return false;
  if (name.includes("--")) return false;
  return true;
}
