import { applyProposal } from "@fil/evolution";
import { flag, type ParsedArgs } from "../args.js";
import type { CliContext } from "../context.js";
import { readFlowText } from "./common.js";

/** `fil approve <id> [--flow name]` — validate a proposal and apply it. */
export function approveCommand(ctx: CliContext, args: ParsedArgs): number {
  const id = args.positional[0];
  if (!id) {
    ctx.out.error("Usage: fil approve <proposal-id> [--flow <name>]");
    return 2;
  }

  const patch = ctx.store.readProposal(id);
  if (patch === null) {
    ctx.out.error(`Proposal "${id}" not found in .fil/proposals/.`);
    return 1;
  }

  const flowName = flag(args, "flow") ?? inferFlowFromPatch(patch);
  if (!flowName) {
    ctx.out.error("Could not determine the Flow. Use: fil approve <id> --flow <name>");
    return 2;
  }

  const current = readFlowText(ctx, flowName);
  if (current === null) {
    ctx.out.error(`Flow "${flowName}" not found in .fil/flows/.`);
    return 1;
  }

  const result = applyProposal(current, patch, { engine: ctx.engine, flowName });
  if (!result.ok) {
    ctx.out.error(`Rejected (${result.error}): ${result.message}`);
    ctx.out.error("The Flow was NOT modified. The proposal is kept for revision.");
    return 1;
  }

  // Stranded-Run guard: refuse if an active Run sits on a removed/renamed Phase.
  const stranded = strandedRunCheck(ctx, flowName, result.newCode);
  if (stranded) {
    ctx.out.error(`Refused: ${stranded}`);
    ctx.out.error("Cancel the affected Run first (fil cancel), then approve again.");
    return 1;
  }

  // Apply: write the validated new Flow content (flows are git-versioned).
  ctx.store.writeFlow(flowName, JSON.parse(result.newCode));
  ctx.store.removeProposal(id);
  ctx.out.log(`Applied proposal ${id} to flow "${flowName}".`);
  ctx.out.log("  Future Runs use the new Flow. Active Runs keep their frozen snapshot.");
  ctx.out.log("  Commit the change to version it (git add .fil/flows/).");
  return 0;
}

/** Check that no active Run on this flow is stranded by the new definition. */
function strandedRunCheck(
  ctx: CliContext,
  flowName: string,
  newCode: string,
): string | null {
  const loaded = ctx.engine.load(flowName, JSON.parse(newCode));
  if (!loaded.ok) return null; // already validated; nothing to do
  const newNodeIds = new Set(loaded.instance.serialize().nodes.map((n) => n.id));

  for (const runId of ctx.store.listRuns()) {
    const run = ctx.store.readRunState(runId);
    if (!run || run.status !== "active" || run.flowName !== flowName) continue;
    const current = run.history[run.history.length - 1];
    const phases = current?.phases ?? [];
    const strandedPhase = phases.find((p) => !newNodeIds.has(p));
    if (strandedPhase) {
      return `active Run ${run.runId} would be stranded on Phase "${strandedPhase}" (the patch removes or renames it).`;
    }
  }
  return null;
}

function inferFlowFromPatch(patch: string): string | undefined {
  const match = patch.match(/^\+\+\+ [^\s]*\/([^/]+)\.json$/m);
  return match?.[1];
}
