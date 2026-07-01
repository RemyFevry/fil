import { existsSync, readdirSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import type { FlowDefinition } from "@fil/engine";
import { resolveFlow, type FlowLoaderDeps, type ResolvedFlow } from "@fil/flow-loader";
import type { OrchestratorDeps } from "@fil/orchestrator";
import type { RunState } from "@fil/store";
import type { RunProjection } from "@fil/contract";
import type { CliContext } from "../context.js";

export function orchestratorDeps(ctx: CliContext): OrchestratorDeps {
  return {
    store: ctx.store,
    engine: ctx.engine,
    cwd: ctx.cwd,
    prompter: ctx.prompter,
  };
}

export function projectFlowsDir(ctx: CliContext): string {
  return join(ctx.cwd, ".fil", "flows");
}

export function flowFilePath(ctx: CliContext, name: string): string {
  return join(projectFlowsDir(ctx), `${name}.js`);
}

export function readFlowText(ctx: CliContext, name: string): string | null {
  const path = flowFilePath(ctx, name);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function realFlowLoaderDeps(ctx: CliContext): FlowLoaderDeps {
  return {
    fileExists: (path) => existsSync(path),
    listFlowNames: (dir) =>
      existsSync(dir)
        ? readdirSync(dir)
            .filter((n) => n.endsWith(".js"))
            .map((n) => n.slice(0, -3))
        : [],
    importFlowFile: async (path) => {
      const mod = (await import(pathToFileURL(path).href)) as {
        default?: FlowDefinition;
      };
      return mod.default;
    },
    engine: ctx.engine,
  };
}

/** Resolve a Flow across project/user precedence and load-validate it. */
export function resolveFlowDefinition(
  ctx: CliContext,
  flowName?: string,
): Promise<ResolvedFlow | { ok: false; error: string }> {
  const config = ctx.store.readConfig();
  return resolveFlow(realFlowLoaderDeps(ctx), {
    projectFlowsDir: projectFlowsDir(ctx),
    userFlowsDir: ctx.userFlowsDir,
    flowName,
    defaultName: config?.defaultFlow ?? "default",
  });
}

/** Read the active Run (projection + state), or null if there isn't one. */
export function activeRun(ctx: CliContext): {
  run: RunState;
  projection: RunProjection;
} | null {
  const projection = ctx.store.readProjection();
  if (!projection) return null;
  const run = ctx.store.readRunState(projection.runId);
  if (!run) return null;
  return { run, projection };
}
/** Import a Flow file directly by path (used by inspect for ad-hoc flows). */
export async function loadDefinitionFromPath(
  path: string,
): Promise<FlowDefinition | null> {
  if (!existsSync(path)) return null;
  const mod = (await import(pathToFileURL(path).href)) as {
    default?: FlowDefinition;
  };
  return mod.default ?? null;
}
