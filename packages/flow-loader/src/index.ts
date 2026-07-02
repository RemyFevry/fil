import type {
  EngineInstance,
  FlowDefinition,
  FlowEngine,
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
