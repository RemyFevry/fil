import { advance } from "@color-sunset/fil-orchestrator";
import type { CliContext } from "../context.js";
import { activeRun, orchestratorDeps } from "./common.js";

/** `fil next` — run the current Phase's Gate and advance on pass. */
export async function nextCommand(ctx: CliContext): Promise<number> {
  const current = activeRun(ctx);
  if (!current) {
    ctx.out.error("No active Run. Start one with: fil start <change>");
    return 1;
  }
  if (current.projection.status === "cancelled") {
    ctx.out.error(`Run ${current.run.runId} is cancelled.`);
    return 1;
  }

  const outcome = await advance(orchestratorDeps(ctx), current.run);

  if (outcome.advanced) {
    if (outcome.done) {
      ctx.out.log(`Run ${current.run.runId} reached its terminal Phase — complete.`);
    } else {
      const phase = outcome.run.history.at(-1)?.phases.join(", ");
      ctx.out.log(`Advanced to: ${phase}`);
    }
    for (const receipt of outcome.receipts) {
      ctx.out.log(`  gate (${receipt.gateType}): ${receipt.outcome}`);
    }
    return 0;
  }

  ctx.out.error(`Did not advance: ${outcome.error ?? "unknown reason"}`);
  for (const receipt of outcome.receipts) {
    ctx.out.error(`  gate (${receipt.gateType}) on "${receipt.phase}": ${receipt.outcome}`);
    if (receipt.evidence.stderr) ctx.out.error(`    stderr: ${receipt.evidence.stderr}`);
    if (receipt.evidence.stdout) ctx.out.error(`    stdout: ${receipt.evidence.stdout}`);
  }
  return 1;
}
