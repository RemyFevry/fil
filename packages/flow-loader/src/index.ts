import { realpathSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  engineEntryUrl,
  type EngineInstance,
  type FlowDefinition,
  type FlowEngine,
} from "@color-sunset/fil-engine";

/**
 * Resolves which Flow file wins and load-validates it.
 *
 * Project-level Flows (`.fil/flows/`) override user-level (`~/.fil/flows/`).
 * Flows are engine-native CODE (ADR-0002): `.js`/`.ts` modules exporting a
 * config. The chosen file is imported and load-validated against the active
 * `FlowEngine` — an invalid Flow fails loudly at load.
 *
 * A fake filesystem / importer is injectable so the tests need no real disk.
 */

export type FlowSource = "project" | "user";

export interface ResolvedFlow {
  ok: true;
  name: string;
  definition: FlowDefinition;
  source: FlowSource;
  instance: EngineInstance;
}

export interface FlowLoadError {
  ok: false;
  error: string;
}

/** Minimal dependencies the loader needs — faked in tests, real in production. */
export interface FlowLoaderDeps {
  /** Whether a path exists (used for precedence resolution). */
  fileExists(path: string): boolean;
  /** List flow names (without extension) present in a directory. */
  listFlowNames(dir: string): string[];
  /** Import a Flow module, returning its exported definition. */
  importFlowFile(path: string): Promise<FlowDefinition | undefined>;
  /** The FlowEngine used to load-validate the chosen definition. */
  engine: FlowEngine;
}

export interface ResolveOptions {
  projectFlowsDir: string;
  userFlowsDir: string;
  flowName?: string;
  defaultName?: string;
}

export async function resolveFlow(
  deps: FlowLoaderDeps,
  opts: ResolveOptions,
): Promise<ResolvedFlow | FlowLoadError> {
  const name = opts.flowName ?? opts.defaultName ?? "default";

  const projectPath = `${opts.projectFlowsDir}/${name}.js`;
  if (deps.fileExists(projectPath)) {
    return loadAndValidate(deps, name, projectPath, "project");
  }

  const userPath = `${opts.userFlowsDir}/${name}.js`;
  if (deps.fileExists(userPath)) {
    return loadAndValidate(deps, name, userPath, "user");
  }

  const available = unique([
    ...deps.listFlowNames(opts.projectFlowsDir),
    ...deps.listFlowNames(opts.userFlowsDir),
  ]);
  return {
    ok: false,
    error:
      available.length > 0
        ? `Flow "${name}" not found. Available: ${[...available].sort((a, b) => a.localeCompare(b)).join(", ")}.`
        : `Flow "${name}" not found in ${opts.projectFlowsDir} or ${opts.userFlowsDir}.`,
  };
}

async function loadAndValidate(
  deps: FlowLoaderDeps,
  name: string,
  path: string,
  source: FlowSource,
): Promise<ResolvedFlow | FlowLoadError> {
  let definition: FlowDefinition | undefined;
  try {
    definition = await deps.importFlowFile(path);
  } catch (err) {
    return {
      ok: false,
      error: `Flow "${name}" (${source}) failed to import: ${message(err)}`,
    };
  }
  if (!definition) {
    return { ok: false, error: `Flow "${name}" (${source}) has no default export.` };
  }

  const loaded = deps.engine.load(name, definition);
  if (!loaded.ok) {
    return loaded;
  }
  return { ok: true, name, definition, source, instance: loaded.instance };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Default dynamic-import loader (the "dance")
// ---------------------------------------------------------------------------
//
// The pattern — rewrite the bare `@color-sunset/fil-engine` specifier to the
// engine's absolute entry URL, write the rewritten source to a temp file under
// a Windows-safe root, canonicalize the path with `realpathSync`, dynamically
// `import()` it, and clean up — used to be re-implemented at every call site
// (CLI's `importFlowFile`, evolution's `loadFlowCode`, plus test-only copies).
// It lives here, once, behind the `importFlowFile`/`importFlowCode` seam.
//
// Windows note (ADR-0005 §Windows URL normalization): the GitHub-hosted Windows
// runner's home dir resolves to the 8.3 short-name form
// (`C:\Users\RUNNER~1\…`); `pathToFileURL` URL-encodes the `~` as `%7E`, but
// Node's ESM loader's URL→path round-trip then can't find the file. Two
// complementary defences, both now in this one place: (1) prefer
// `process.cwd()` over `os.tmpdir()` for the temp root (cwd is always a
// canonical long-name path on Windows); (2) `realpathSync` the temp file
// before `pathToFileURL` so any residual short-name alias / symlink resolves.
// Both are no-ops on POSIX.

const ENGINE_SPECIFIER_RE = /from\s+["']@color-sunset\/fil-engine["']/g;

/**
 * Pick a writable temp root for the dynamic-`import()` loader.
 *
 * Prefers `process.cwd()` (Windows-safe — see the module note + ADR-0005);
 * falls back to `os.tmpdir()` when cwd is unwritable (read-only checkouts,
 * restrictive containers). Each candidate is probed with a real `mkdtemp` +
 * `rm` cycle so we never silently pick an unusable root. Both candidates are
 * typically equivalent on POSIX.
 *
 * `candidates` is exported for testing; defaults to the production pair.
 */
export async function pickTempRoot(
  candidates?: readonly string[],
): Promise<string> {
  const roots = candidates ?? [process.cwd(), tmpdir()];
  for (const root of roots) {
    try {
      const probe = await mkdtemp(join(root, ".fil-flow-loader-probe-"));
      await rm(probe, { recursive: true, force: true }).catch(() => {});
      return root;
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error(
    "Could not create a writable temp directory under process.cwd() or os.tmpdir().",
  );
}

/**
 * Rewrite the bare `@color-sunset/fil-engine` specifier in Flow source to the
 * engine's absolute entry URL, so the rewritten module imports cleanly from any
 * location (including a temp dir outside the workspace's `node_modules`).
 */
function rewriteEngineSpecifier(code: string): string {
  return engineEntryUrl
    ? code.replace(ENGINE_SPECIFIER_RE, `from "${engineEntryUrl}"`)
    : code;
}

/**
 * The dynamic-`import()` dance on already-resolved Flow source. Rewrite the
 * engine specifier, write to a temp file under a Windows-safe root, canonicalize
 * with `realpathSync`, import, clean up. Returns the module's default export
 * (or `undefined` if it has none).
 */
async function importFlowSource(
  code: string,
): Promise<FlowDefinition | undefined> {
  const rewritten = rewriteEngineSpecifier(code);
  const tmpRoot = await pickTempRoot();
  const dir = await mkdtemp(join(tmpRoot, ".fil-flow-loader-"));
  const file = join(dir, "flow.mjs");
  try {
    await writeFile(file, rewritten, "utf8");
    const real = realpathSync(file);
    const mod = (await import(pathToFileURL(real).href)) as {
      default?: FlowDefinition;
    };
    return mod.default;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Default `importFlowFile`: read a Flow module from `path`, then run the
 * dynamic-import dance. Satisfies the `FlowLoaderDeps.importFlowFile` seam —
 * production callers pass this directly rather than re-implementing the dance.
 */
export async function importFlowFile(
  path: string,
): Promise<FlowDefinition | undefined> {
  const source = await readFile(path, "utf8");
  return importFlowSource(source);
}

/**
 * Default `importFlowCode`: run the dynamic-import dance directly on a Flow
 * source string. Used by evolution, which patches Flow source before loading
 * and so doesn't have a path to hand to `importFlowFile`.
 */
export async function importFlowCode(
  code: string,
): Promise<FlowDefinition | undefined> {
  return importFlowSource(code);
}
