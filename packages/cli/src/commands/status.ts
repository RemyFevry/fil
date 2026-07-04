import type { CliContext } from "../context.js";
import { activeRun } from "./common.js";

/** `fil status` — print the current Phase, Gate, and Phase config. */
export function statusCommand(ctx: CliContext): number {
  const current = activeRun(ctx);
  if (!current) {
    ctx.out.log("No active Run. The .fil/run.json projection does not exist.");
    ctx.out.log("Start one with: fil start <change>");
    return 0;
  }

  const { run, projection } = current;
  const cfg = projection.phaseConfig;

  ctx.out.log(`Run     ${run.runId}  [${projection.status}]`);
  ctx.out.log(`Change  ${run.change}`);
  ctx.out.log(`Flow    ${run.flowName}`);
  ctx.out.log(
    `Phase   ${projection.phases.join(", ")}${projection.phases.length > 1 ? "  (parallel)" : ""}`,
  );
  ctx.out.log(`Actor   ${projection.actorMode}`);
  const gateList = cfg.gates.map((g) => `${g.name} (${describeGate(g.type)})`).join(", ");
  ctx.out.log(`Gates   ${gateList}`);
  ctx.out.log(`Tools   ${cfg.allowedTools.join(", ") || "(none)"}`);
  if (cfg.skills.length > 0) ctx.out.log(`Skills  ${cfg.skills.join(", ")}`);
  if (cfg.instructions) ctx.out.log(`\nInstructions:\n  ${cfg.instructions}`);
  return 0;
}

function describeGate(type: string): string {
  switch (type) {
    case "shell":
      return "shell command";
    case "testsPass":
      return "test suite";
    case "human":
      return "human confirmation";
    default:
      return type;
  }
}
