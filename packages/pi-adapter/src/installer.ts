import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import {
  defaultFs,
  safeRead,
  writeAt,
  scopesOf,
  type InstallScope,
  type InstallerFs,
} from "@color-sunset/fil-adapter-host";
import { renderPiExtensionSource } from "./extension-source.js";

export { renderPiExtensionSource };

// The host-filesystem plumbing (InstallerFs, defaultFs, safeRead, writeAt,
// scopesOf, InstallScope) lives in @color-sunset/fil-adapter-host and is
// re-exported here to preserve this adapter's public surface.
export { defaultFs, type InstallScope, type InstallerFs };

/**
 * Install the Pi Adapter — write the generated extension into Pi's native
 * location. Idempotent: re-running is a no-op if the file already carries
 * the current source (so humans can edit hooks around it without surprise).
 *
 * The Pi extension directory layout (from Pi's docs):
 *   ~/.pi/agent/extensions/      (global — affects every project for this user)
 *   .pi/extensions/              (project-local — committed is optional)
 *
 * `fil init` calls this with `scope: "project"` by default and
 * `scope: "user"` only when explicitly opted in (the global install affects
 * every Pi session on the machine, so it deserves consent).
 */

export interface InstallResult {
  /** True if at least one extension file was written. */
  installed: boolean;
  /**
   * Where each real install location lives (present even when not written).
   * `both` is an aggregate scope, not a real path, so it's intentionally
   * absent from this record — callers formatting output for `--scope both`
   * should list both `project` and `user` paths.
   */
  paths: Record<"project" | "user", string>;
  /** True when Pi was detected at all. */
  piDetected: boolean;
  /** Reason when no install happened (e.g. already installed, Pi missing). */
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
  /** Whether Pi was detected — if absent, we run detection. */
  piDetected?: boolean;
  /** Override the rendered extension source (tests). */
  source?: string;
}

const FIL_EXTENSION_FILENAME = "fil.ts";
const PROJECT_PI_EXT_DIR = ".pi/extensions";
const USER_PI_EXT_DIR = ".pi/agent/extensions";

/**
 * Detect whether Pi is installed on this machine.
 *
 * `home` is read from `homedir()` by default; pass it explicitly in tests
 * to drive the check against a synthetic filesystem.
 */
export function detectPi(
  fs: InstallerFs = defaultFs(),
  home: string = homedir(),
): boolean {
  if (!home) return false;
  return (
    fs.isDirectory(join(home, USER_PI_EXT_DIR)) ||
    fs.isDirectory(join(home, ".pi")) ||
    whichPiOnPath(fs)
  );
}

function whichPiOnPath(fs: InstallerFs): boolean {
  const pathEnv = process.env["PATH"] ?? "";
  for (const dir of pathEnv.split(delimiter).filter(Boolean)) {
    if (fs.isDirectory(dir) && fs.exists(join(dir, "pi"))) return true;
  }
  return false;
}

/** Install the Pi Adapter's extension file at the requested scope(s). */
export function installPiAdapter(opts: InstallOptions): InstallResult {
  const fs = opts.fs ?? defaultFs();
  const userFilDir = opts.userFilDir ?? join(homedir(), ".fil");
  const projectRoot = opts.projectRoot;
  const scope: InstallScope = opts.scope ?? "project";
  const detected = opts.piDetected ?? detectPi(fs);

  const paths: Record<"project" | "user", string> = {
    project: join(projectRoot, PROJECT_PI_EXT_DIR, FIL_EXTENSION_FILENAME),
    user: join(userFilDir, "..", USER_PI_EXT_DIR, FIL_EXTENSION_FILENAME),
  };

  if (!detected) {
    return {
      installed: false,
      paths,
      piDetected: false,
      reason: "Pi not detected on this machine; skipping Pi Adapter install.",
    };
  }

  const source = opts.source ?? renderPiExtensionSource();
  const wanted = scopesOf(scope);
  let wrote = false;
  for (const s of wanted) {
    const target = resolveTargetPath(paths, s, projectRoot, userFilDir);
    const existing = safeRead(fs, target);
    if (existing === source) continue; // idempotent
    writeAt(fs, target, source);
    wrote = true;
  }

  return {
    installed: wrote,
    paths,
    piDetected: true,
    reason: wrote ? undefined : "Pi extension already installed (idempotent).",
  };
}

function resolveTargetPath(
  paths: Record<"project" | "user", string>,
  scope: "project" | "user",
  projectRoot: string,
  userFilDir: string,
): string {
  if (scope === "project") {
    return join(projectRoot, PROJECT_PI_EXT_DIR, FIL_EXTENSION_FILENAME);
  }
  // user scope: `userFilDir` is `~/.fil`; Pi loads from `~/.pi/agent/extensions` (sibling).
  const parent = dirname(userFilDir);
  return join(parent, USER_PI_EXT_DIR, FIL_EXTENSION_FILENAME);
}

/** Convert an absolute or project-relative path into one under projectRoot. */
export function withinProject(
  projectRoot: string,
  candidate: string,
): string {
  if (isAbsolute(candidate)) return candidate;
  return resolve(projectRoot, candidate);
}
