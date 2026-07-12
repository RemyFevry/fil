import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Fil Adapter host-filesystem plumbing.
 *
 * Every Adapter (Claude, Pi, …) owns only its target-specific knowledge: the
 * target subdirectory, the PATH probe, and the rendered artefact body. The
 * host-fs surface around those decisions is identical across adapters, so it
 * lives here once: the `InstallerFs` abstraction, a real-FS default, safe read
 * / mkdir+write helpers, install-scope expansion, and an in-memory FS for tests.
 */

export type InstallScope = "project" | "user" | "both";

export interface InstallerFs {
  exists(path: string): boolean;
  read(path: string): string | undefined;
  write(path: string, body: string): void;
  isDirectory(path: string): boolean;
  /** Create `path` and any missing parents (idempotent). */
  mkdir(path: string): void;
}

/** Expand an `InstallScope` into the concrete scopes to install at. */
export function scopesOf(scope: InstallScope): Array<"project" | "user"> {
  if (scope === "both") return ["project", "user"];
  if (scope === "user") return ["user"];
  return ["project"];
}

/** Read a file's contents via `fs`, or `undefined` when it is absent. */
export function safeRead(fs: InstallerFs, path: string): string | undefined {
  if (!fs.exists(path)) return undefined;
  return fs.read(path);
}

/** Ensure `path`'s directory exists, then write `body` to it. */
export function writeAt(fs: InstallerFs, path: string, body: string): void {
  fs.mkdir(dirname(path));
  fs.write(path, body);
}

/** A real-filesystem `InstallerFs` backed by `node:fs`. */
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

/**
 * An in-memory `InstallerFs` for tests. `write` records files; `mkdir` records
 * directories and every ancestor up to the root (matching `defaultFs`'s
 * recursive `mkdir` and the InstallerFs contract); neither touches disk.
 * Mirrors the real-FS contract closely enough to drive installer logic
 * deterministically without I/O.
 */
export function memFs(): InstallerFs {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  return {
    exists: (p) => files.has(p) || dirs.has(p),
    read: (p) => files.get(p),
    write: (p, body) => {
      files.set(p, body);
    },
    isDirectory: (p) => dirs.has(p),
    mkdir: (p) => {
      let current = p;
      while (true) {
        dirs.add(current);
        const parent = dirname(current);
        if (parent === current) break;
        current = parent;
      }
    },
  };
}
