import { renderGraph } from "@fil/inspect-view";
import { currentPhases } from "@fil/orchestrator";
import type { FlowDefinition } from "@fil/engine";
import type { CliContext } from "../context.js";
import { activeRun, resolveFlowDefinition } from "./common.js";

/** `fil inspect` — view-only visualizer over FlowEngine.serialize(). */
export async function inspectCommand(ctx: CliContext): Promise<number> {
  const current = activeRun(ctx);

  if (current) {
    const snapshot = ctx.store.readFlowSnapshot(current.run.runId);
    if (!snapshot) {
      ctx.out.error("Could not read the active Run's Flow snapshot.");
      return 1;
    }
    const loaded = ctx.engine.load(current.run.flowName, snapshot as FlowDefinition);
    if (!loaded.ok) {
      ctx.out.error(loaded.error);
      return 1;
    }
    const graph = loaded.instance.serialize();
    const activePhases = currentPhases(current.run);
    ctx.out.log(renderGraph({ graph, activePhases }));
    return 0;
  }

  // No active Run — show the default Flow.
  const resolved = await resolveFlowDefinition(ctx);
  if (!resolved.ok) {
    ctx.out.error(resolved.error);
    return 1;
  }
  const loaded = ctx.engine.load(resolved.name, resolved.definition);
  if (!loaded.ok) {
    ctx.out.error(loaded.error);
    return 1;
  }
  ctx.out.log(renderGraph({ graph: loaded.instance.serialize() }));
  return 0;
}
