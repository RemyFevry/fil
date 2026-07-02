import { existsSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { RunProjection } from "@fil/contract";

/**
 * The Pi Adapter enforcement surface (Pi is the Agent Runtime).
 *
 * Mirroring the engine-isolation guard (ADR-0003): the only file in this
 * package that may import the Pi runtime is the *installed extension source*
 * — the deep logic below stays pure and depends only on the contract. CI can
 * exercise enforcement without Pi installed.
 *
 * Two inputs matter: the active `RunProjection` (`.fil/run.json`), the
 * project's Fil layout, and the user's Fil layout. Three outputs follow:
 * `allowedTools` (the exact set Pi's UI should expose), `systemPrompt`
 * (the composed instructions + Fil context to inject), and `skillPaths`
 * (the absolute paths to expose to Pi's `resources_discover` for skill
 * loading — Phase skills resolve by name through project/user precedence).
 */

/** Where the project-level skill layout lives (committed, shared). */
export const PROJECT_SKILLS_DIR = ".fil/skills";

/** Where the user-level skill layout lives (~/.fil/skills — user-private). */
export function userSkillsDir(userFilDir: string): string {
  return join(userFilDir, "skills");
}

export interface PiEnforcementDeps {
  /** Absolute path to the project root. */
  projectRoot: string;
  /** Absolute path to the user's Fil directory (e.g. ~/.fil). */
  userFilDir: string;
  /** Filesystem probe — injection point for tests. */
  fileExists?: (path: string) => boolean;
}

export interface PiEnforcement {
  /** True if there is an active Run to enforce against. */
  hasActiveRun: boolean;

  /** Primary active Phase (human label). */
  phase: string;
  /** All active Phase ids (parallel runs include more than one). */
  phases: readonly string[];

  /**
   * The set of tools Pi should have active, forwarded verbatim from the
   * Phase's `allowedTools` (Tier 0 advisory — Pi still renders the tools
   * list to the user; unsupported tool names are Pi's concern to filter).
   */
  allowedTools: readonly string[];

  /**
   * The system-prompt text the extension injects in `before_agent_start`.
   * Contains the Phase's `instructions`, the loaded `context`, and a
   * always-on Fil footer (the current Run/Phase identity) so the agent
   * always knows where it stands.
   */
  systemPrompt: string;

  /**
   * Absolute paths Pi should expose via `resources_discover.skillPaths`.
   * Resolved from the Phase's `skills` list by name through project then
   * user precedence.
   */
  skillPaths: readonly string[];

  /**
   * Absolute paths the extension makes available as Phase context. The
   * ones that exist on disk are returned; missing files are omitted so
   * Pi can render a clear "context file missing" without crashing.
   */
  contextPaths: readonly string[];
}

const DORMANT: PiEnforcement = {
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

/** Compute the Pi enforcement state for the given projection. */
export function enforcePiEnforcement(
  input: EnforceInput,
  deps: PiEnforcementDeps,
): PiEnforcement {
  if (input.projection.status !== "active") return DORMANT;
  const cfg = input.projection.phaseConfig;
  const exists = deps.fileExists ?? defaultFileExists;
  const projectRoot = deps.projectRoot;
  const userSkillsRoot = userSkillsDir(deps.userFilDir);

  // Resolve Phase skills by name (project then user precedence).
  const skillPaths: string[] = [];
  for (const name of cfg.skills) {
    const project = resolveSkillPath(projectRoot, name);
    if (project && exists(project)) {
      skillPaths.push(project);
      continue;
    }
    const user = resolveSkillAt(userSkillsRoot, name);
    if (user && exists(user)) {
      skillPaths.push(user);
    }
  }

  // Resolve Phase context files (absolute paths that exist on disk and
  // stay within the project root). Traversal escapes are dropped — the
  // Phase's context stays in-repo so the adapter cannot be tricked into
  // surfacing files outside the user's tree.
  const contextPaths: string[] = [];
  for (const file of cfg.context.files) {
    const abs = isAbsolute(file) ? resolve(file) : resolve(projectRoot, file);
    if (!isWithinProject(projectRoot, abs)) continue;
    if (exists(abs)) contextPaths.push(abs);
  }

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
// helpers (pure)
// ---------------------------------------------------------------------------

/** Compose the system-prompt injection from the contract's content. */
function composeSystemPrompt(projection: RunProjection): string {
  const cfg = projection.phaseConfig;
  const lines: string[] = [];
  lines.push("# Fil — Phase instructions");
  lines.push("");
  lines.push(cfg.instructions.trim());
  lines.push("");
  lines.push("# Fil — context");
  if (cfg.context.files.length > 0) {
    lines.push("Files in scope:");
    for (const file of cfg.context.files) lines.push(`  - ${file}`);
  }
  if (cfg.context.notes && cfg.context.notes.trim().length > 0) {
    lines.push("");
    lines.push("Notes:");
    lines.push(cfg.context.notes.trim());
  }
  if (cfg.context.priorResults.length > 0) {
    lines.push("");
    lines.push("Receipts from prior Phases:");
    for (const entry of cfg.context.priorResults) lines.push(`  - ${entry}`);
  }
  lines.push("");
  lines.push("# Fil — current Run");
  lines.push(`Run ${projection.runId} · change "${projection.change}" · flow "${projection.flowName}"`);
  lines.push(
    `Phase ${projection.phases.length > 1 ? projection.phases.join(", ") + " (parallel)" : projection.phase}` +
      ` · actor ${projection.actorMode}`,
  );
  lines.push(`Gate (to advance): ${describeGate(cfg.gate.type)}`);
  lines.push(
    "Advance via `fil next` (the gate runs an external test, not the agent's say-so).",
  );
  return lines.join("\n");
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

/**
 * True when `candidate` is `projectRoot` itself or sits under it. Symlinks
 * and `/../` traversals that escape the project are rejected — the caller
 * should drop the path so a misconfigured Phase cannot surface files
 * outside the user's tree.
 */
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
 * Pi's Agent Skills standard: lowercase a-z, digits, hyphens; 1-64 chars;
 * no leading/trailing hyphen, no consecutive hyphens. Anything else is treated
 * as a non-existent skill so a misconfigured Phase fails closed (Pi still
 * loads — the skill simply is not surfaced).
 */
function isSafeSkillSegment(name: string): boolean {
  if (name.length === 0 || name.length > 64) return false;
  if (!/^[a-z0-9-]+$/.test(name)) return false;
  if (name.startsWith("-") || name.endsWith("-")) return false;
  if (name.includes("--")) return false;
  return true;
}
