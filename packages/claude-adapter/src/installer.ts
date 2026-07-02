import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { renderPreToolUseHookSource } from "./hook-source.js";

export { renderPreToolUseHookSource };

/**
 * Install the Claude Code Adapter through Claude Code's native channel: a
 * `PreToolUse` hook registered in `.claude/settings.json` (project) or
 * `~/.claude/settings.json` (user), backed by a generated hook script.
 *
 * Idempotent: re-running is a no-op when the script already carries the
 * current source *and* the settings already reference it. Existing user hooks
 * are preserved — the Fil handler is only added once (deduplicated by command).
 *
 * Claude Code locations:
 *   ~/.claude/settings.json     (global — every project for this user)
 *   .claude/settings.json       (project-local — committable)
 *   ~/.claude/fil/*.js          (global hook script)
 *   .claude/fil/*.js            (project-local hook script)
 */

export type InstallScope = "project" | "user" | "both";

/** Per-scope locations of the two artefacts the adapter writes. */
export interface ClaudeScopePaths {
  /** The generated PreToolUse hook script. */
  hook: string;
  /** The Claude Code settings file that registers the hook. */
  settings: string;
}

export interface InstallResult {
  /** True if at least one artefact was written. */
  installed: boolean;
  /** Per-scope artefact paths (present even when nothing was written). */
  paths: Record<"project" | "user", ClaudeScopePaths>;
  /** True when Claude Code was detected at all. */
  claudeDetected: boolean;
  /** Reason when no install happened (e.g. already installed, Claude missing). */
  reason?: string;
}

export interface InstallOptions {
  /** Absolute project root (where `fil init` is running). */
  projectRoot: string;
  /** Absolute user-Fil directory (defaults to `~/.fil`). */
  userFilDir?: string;
  /** Where to install. Defaults to `"project"`. */
  scope?: InstallScope;
  /** FS probe — injection point for tests. */
  fs?: InstallerFs;
  /** Whether Claude Code was detected — if absent, we run detection. */
  claudeDetected?: boolean;
  /** Override the rendered hook source (tests). */
  source?: string;
}

export interface InstallerFs {
  exists(path: string): boolean;
  read(path: string): string | undefined;
  write(path: string, body: string): void;
  isDirectory(path: string): boolean;
  /** Create `path` and any missing parents (idempotent). */
  mkdir(path: string): void;
}

const HOOK_FILENAME = "pretooluse-hook.js";
const PROJECT_HOOK_DIR = ".claude/fil";
const PROJECT_SETTINGS = ".claude/settings.json";
const USER_HOOK_DIR = ".claude/fil";
const USER_SETTINGS = ".claude/settings.json";
/** Claude Code matcher value that matches every tool (filtering happens inside the hook). */
const ALL_TOOLS_MATCHER = "";

/**
 * Detect whether Claude Code is installed on this machine. `home` defaults to
 * `homedir()`; pass it explicitly in tests to drive a synthetic filesystem.
 */
export function detectClaude(
  fs: InstallerFs = defaultFs(),
  home: string = homedir(),
): boolean {
  if (!home) return false;
  return (
    fs.isDirectory(join(home, ".claude")) ||
    fs.exists(join(home, ".claude.json")) ||
    whichClaudeOnPath(fs)
  );
}

function whichClaudeOnPath(fs: InstallerFs): boolean {
  const pathEnv = process.env["PATH"] ?? "";
  for (const dir of pathEnv.split(delimiter).filter(Boolean)) {
    if (fs.isDirectory(dir) && fs.exists(join(dir, "claude"))) return true;
  }
  return false;
}

/** Install the Claude Code Adapter at the requested scope(s). */
export function installClaudeAdapter(opts: InstallOptions): InstallResult {
  const fs = opts.fs ?? defaultFs();
  const userFilDir = opts.userFilDir ?? join(homedir(), ".fil");
  const projectRoot = opts.projectRoot;
  const scope: InstallScope = opts.scope ?? "project";
  const detected = opts.claudeDetected ?? detectClaude(fs);

  const home = dirname(userFilDir);
  const paths: Record<"project" | "user", ClaudeScopePaths> = {
    project: {
      hook: join(projectRoot, PROJECT_HOOK_DIR, HOOK_FILENAME),
      settings: join(projectRoot, PROJECT_SETTINGS),
    },
    user: {
      hook: join(home, USER_HOOK_DIR, HOOK_FILENAME),
      settings: join(home, USER_SETTINGS),
    },
  };

  if (!detected) {
    return {
      installed: false,
      paths,
      claudeDetected: false,
      reason: "Claude Code not detected on this machine; skipping Claude Adapter install.",
    };
  }

  const source = opts.source ?? renderPreToolUseHookSource();
  let wrote = false;
  for (const s of scopesOf(scope)) {
    wrote = installAtScope(fs, paths[s], s, projectRoot, source) || wrote;
  }

  return {
    installed: wrote,
    paths,
    claudeDetected: true,
    reason: wrote ? undefined : "Claude Adapter already installed (idempotent).",
  };
}

function scopesOf(scope: InstallScope): Array<"project" | "user"> {
  if (scope === "both") return ["project", "user"];
  if (scope === "user") return ["user"];
  return ["project"];
}

/**
 * Install one scope. Returns true if anything was written.
 * - Writes the hook script when its on-disk content differs from `source`.
 * - Adds the PreToolUse handler to settings.json when not already present.
 */
function installAtScope(
  fs: InstallerFs,
  paths: ClaudeScopePaths,
  scope: "project" | "user",
  projectRoot: string,
  source: string,
): boolean {
  let wrote = false;

  // 1. Hook script (idempotent on exact source match).
  const existingScript = safeRead(fs, paths.hook);
  if (existingScript !== source) {
    writeAt(fs, paths.hook, source);
    wrote = true;
  }

  // 2. Settings.json PreToolUse registration (deduplicated by command+args).
  const scriptRef = scope === "project"
    ? `\${CLAUDE_PROJECT_DIR}/${PROJECT_HOOK_DIR}/${HOOK_FILENAME}`
    : paths.hook;
  const handler = { type: "command", command: "node", args: [scriptRef] };
  const { body, added } = mergePreToolUseHandler(safeRead(fs, paths.settings), handler);
  if (added) {
    writeAt(fs, paths.settings, body);
    wrote = true;
  }
  return wrote;
}

// ---------------------------------------------------------------------------
// settings.json merge (pure)
// ---------------------------------------------------------------------------

interface HookHandler {
  type: string;
  command?: string;
  args?: unknown[];
  [key: string]: unknown;
}

interface MatcherGroup {
  matcher?: string;
  hooks?: HookHandler[];
  [key: string]: unknown;
}

type SettingsDoc = Record<string, unknown>;

/** Stable dedupe key for a command hook handler. */
function handlerKey(h: HookHandler): string {
  return `${h.type}|${h.command ?? ""}|${JSON.stringify(h.args ?? [])}`;
}

/**
 * Merge a Fil PreToolUse handler into the existing settings document.
 *
 * Preserves every existing hook and setting. The Fil handler joins the
 * all-tools group (matcher `""`), reusing it if present so we never spawn a
 * redundant group. Deduplicated by command+args, so re-running `fil init` is a
 * no-op. Returns the serialized document and whether a handler was added.
 */
export function mergePreToolUseHandler(
  existingRaw: string | undefined,
  handler: HookHandler,
): { body: string; added: boolean } {
  const doc = parseSettings(existingRaw);
  const hooks = (doc["hooks"] ?? {}) as Record<string, unknown>;
  const preToolUse = (hooks["PreToolUse"] ?? []) as MatcherGroup[];

  // Reuse an existing all-tools group, else create one.
  let group = preToolUse.find((g) => (g.matcher ?? "") === ALL_TOOLS_MATCHER);
  if (!group) {
    group = { matcher: ALL_TOOLS_MATCHER, hooks: [] };
    preToolUse.push(group);
  }
  const groupHooks = (group.hooks ?? []) as HookHandler[];

  const wantKey = handlerKey(handler);
  const alreadyPresent = groupHooks.some((h) => handlerKey(h) === wantKey);
  let added = false;
  if (!alreadyPresent) {
    groupHooks.push(handler);
    group.hooks = groupHooks;
    added = true;
  }

  hooks["PreToolUse"] = preToolUse;
  doc["hooks"] = hooks;
  return { body: stringifySettings(doc), added };
}

function parseSettings(raw: string | undefined): SettingsDoc {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as SettingsDoc)
      : {};
  } catch {
    // A malformed settings.json is treated as empty rather than clobbering
    // silently; the serialized output is always valid JSON.
    return {};
  }
}

function stringifySettings(doc: SettingsDoc): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// fs helpers
// ---------------------------------------------------------------------------

function safeRead(fs: InstallerFs, path: string): string | undefined {
  if (!fs.exists(path)) return undefined;
  return fs.read(path);
}

function writeAt(fs: InstallerFs, path: string, body: string): void {
  fs.mkdir(dirname(path));
  fs.write(path, body);
}

export function defaultFs(): InstallerFs {
  return {
    exists: (p) => existsSync(p),
    read: (p) => (existsSync(p) ? readFileSync(p, "utf8") : undefined),
    write: (p, body) => {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, body, "utf8");
    },
    isDirectory: (p) => {
      try {
        return statSync(p).isDirectory();
      } catch {
        return false;
      }
    },
    mkdir: (p) => mkdirSync(p, { recursive: true }),
  };
}
