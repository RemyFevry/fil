import { existsSync, readdirSync, readFileSync } from "node:fs";
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
  return join(projectFlowsDir(ctx), `${name}.json`);
}

export function readFlowText(ctx: CliContext, name: string): string | null {
  const path = flowFilePath(ctx, name);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function realFlowLoaderDeps(ctx: CliContext): FlowLoaderDeps {
  return {
    readFile: (path) => (existsSync(path) ? readFileSync(path, "utf8") : undefined),
    listFlowNames: (dir) =>
      existsSync(dir)
        ? readdirSync(dir)
            .filter((n) => n.endsWith(".json"))
            .map((n) => n.slice(0, -5))
        : [],
    engine: ctx.engine,
  };
}

/** Resolve a Flow across project/user precedence and load-validate it. */
export function resolveFlowDefinition(
  ctx: CliContext,
  flowName?: string,
): ResolvedFlow | { ok: false; error: string } {
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

/** Load a Flow definition from disk (no precedence resolution). */
export function loadDefinitionFromPath(
  ctx: CliContext,
  name: string,
): FlowDefinition | null {
  const text = readFlowText(ctx, name);
  if (text === null) return null;
  try {
    return JSON.parse(text) as FlowDefinition;
  } catch {
    return null;
  }
}
