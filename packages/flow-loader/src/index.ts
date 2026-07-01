import type {
  EngineInstance,
  FlowDefinition,
  FlowEngine,
} from "@fil/engine";

/**
 * Resolves which Flow file wins and load-validates it.
 *
 * Project-level Flows (`.fil/flows/`) override user-level (`~/.fil/flows/`).
 * The chosen file is load-validated against the active `FlowEngine`
 * (ADR-0002): an invalid Flow fails loudly at load.
 *
 * A fake filesystem is injectable so the tests need no real disk.
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

/** Minimal filesystem the loader needs — faked in tests, real in production. */
export interface FlowLoaderDeps {
  /** Read a file's text, or `undefined` if it does not exist. */
  readFile(path: string): string | undefined;
  /** List flow names (without extension) present in a directory. */
  listFlowNames(dir: string): string[];
  /** The FlowEngine used to load-validate the chosen definition. */
  engine: FlowEngine;
}

export interface ResolveOptions {
  /** Directory of project-level flows (e.g. `<cwd>/.fil/flows`). */
  projectFlowsDir: string;
  /** Directory of user-level flows (e.g. `~/.fil/flows`). */
  userFlowsDir: string;
  /** Flow to resolve. Falls back to `defaultName`, then to `"default"`. */
  flowName?: string;
  /** The project's configured default flow name. */
  defaultName?: string;
}

export function resolveFlow(
  deps: FlowLoaderDeps,
  opts: ResolveOptions,
): ResolvedFlow | FlowLoadError {
  const name = opts.flowName ?? opts.defaultName ?? "default";

  const projectPath = `${opts.projectFlowsDir}/${name}.json`;
  const projectContent = deps.readFile(projectPath);
  if (projectContent !== undefined) {
    return loadAndValidate(deps, name, projectContent, "project");
  }

  const userPath = `${opts.userFlowsDir}/${name}.json`;
  const userContent = deps.readFile(userPath);
  if (userContent !== undefined) {
    return loadAndValidate(deps, name, userContent, "user");
  }

  const available = unique([
    ...deps.listFlowNames(opts.projectFlowsDir),
    ...deps.listFlowNames(opts.userFlowsDir),
  ]);
  return {
    ok: false,
    error:
      available.length > 0
        ? `Flow "${name}" not found. Available: ${available.sort().join(", ")}.`
        : `Flow "${name}" not found in ${opts.projectFlowsDir} or ${opts.userFlowsDir}.`,
  };
}

function loadAndValidate(
  deps: FlowLoaderDeps,
  name: string,
  raw: string,
  source: FlowSource,
): ResolvedFlow | FlowLoadError {
  let definition: FlowDefinition;
  try {
    definition = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      error: `Flow "${name}" (${source}) is not valid JSON.`,
    };
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
