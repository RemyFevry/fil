import { back, cancel } from "@fil/orchestrator";
import type { CliContext } from "../context.js";
import { activeRun, orchestratorDeps } from "./common.js";

/** `fil back` — retreat the Run one Phase. */
export function backCommand(ctx: CliContext): number {
  const current = activeRun(ctx);
  if (!current) {
    ctx.out.error("No active Run to retreat.");
    return 1;
  }
  const result = back(orchestratorDeps(ctx), current.run);
  if (result.retreated) {
    const phase = result.run.history.at(-1)?.phases.join(", ");
    ctx.out.log(`Retreated to: ${phase}`);
    return 0;
  }
  ctx.out.log(result.error ?? "Could not retreat.");
  return 1;
}

/** `fil cancel` — end the Run as cancelled. */
export function cancelCommand(ctx: CliContext): number {
  const current = activeRun(ctx);
  if (!current) {
    ctx.out.error("No active Run to cancel.");
    return 1;
  }
  const updated = cancel(orchestratorDeps(ctx), current.run);
  ctx.out.log(`Run ${updated.runId} cancelled.`);
  return 0;
}
