import { startRun } from "@fil/orchestrator";
import { flag, type ParsedArgs } from "../args.js";
import type { CliContext } from "../context.js";
import { activeRun, orchestratorDeps, resolveFlowDefinition } from "./common.js";

/** `fil start <change> [--flow name]` — spawn a Run bound to a Change. */
export async function startCommand(ctx: CliContext, args: ParsedArgs): Promise<number> {
  const existing = activeRun(ctx);
  if (existing && existing.run.status === "active") {
    ctx.out.error(
      `Run ${existing.run.runId} is still active on Phase "${existing.projection.phase}". ` +
        `Finish or cancel it before starting another Run.`,
    );
    return 1;
  }

  const change = args.positional[0];
  if (!change) {
    ctx.out.error("Usage: fil start <change> [--flow <name>]");
    return 2;
  }

  const flowName = flag(args, "flow");
  const resolved = await resolveFlowDefinition(ctx, flowName);
  if (!resolved.ok) {
    ctx.out.error(resolved.error);
    return 1;
  }

  const result = await startRun(orchestratorDeps(ctx), {
    change,
    flowName: resolved.name,
    definition: resolved.definition,
  });
  if (!result.ok) {
    ctx.out.error(result.error);
    return 1;
  }

  ctx.out.log(`Started Run ${result.run.runId}`);
  ctx.out.log(`  change: ${result.run.change}`);
  ctx.out.log(`  flow:   ${result.run.flowName} (${resolved.source}-level)`);
  ctx.out.log(`  phase:  ${result.projection.phase}`);
  ctx.out.log(`  gate:   ${gateLabel(result.projection.phaseConfig.gate.type)}`);
  ctx.out.log(`  actor:  ${result.projection.actorMode}`);
  ctx.out.log("Run `fil status` for details, `fil next` to advance.");
  return 0;
}

function gateLabel(type: string): string {
  switch (type) {
    case "testsPass":
      return "tests";
    case "human":
      return "human-confirm";
    default:
      return type;
  }
}
