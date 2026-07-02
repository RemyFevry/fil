import { existsSync, readdirSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import type { FlowDefinition } from "@color-sunset/fil-engine";
import { engineEntryUrl } from "@color-sunset/fil-engine";
import { resolveFlow, type FlowLoaderDeps, type ResolvedFlow } from "@color-sunset/fil-flow-loader";
import type { OrchestratorDeps } from "@color-sunset/fil-orchestrator";
import type { RunState } from "@color-sunset/fil-store";
import type { RunProjection } from "@color-sunset/fil-contract";
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
      // Flow files import createMachine from "@color-sunset/fil-engine". Rewrite that bare
      // specifier to an absolute URL resolved from this module so the Flow
      // file can be imported from any location (including temp dirs in tests).
      const source = readFileSync(path, "utf8");
      const rewritten = engineEntryUrl
        ? source.replace(
            /from\s+["']@color-sunset\/fil-engine["']/g,
            `from "${engineEntryUrl}"`,
          )
        : source;
      const rewrittenPath = `${path}.${process.pid}.${Date.now()}.resolved.mjs`;
      const { writeFileSync, rmSync } = await import("node:fs");
      writeFileSync(rewrittenPath, rewritten, { encoding: "utf8", flag: "wx" });
      try {
        const mod = (await import(pathToFileURL(rewrittenPath).href)) as {
          default?: FlowDefinition;
        };
        return mod.default;
      } finally {
        rmSync(rewrittenPath, { force: true });
      }
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
