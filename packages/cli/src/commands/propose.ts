import { existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createUnifiedPatch } from "@color-sunset/fil-evolution";
import { flag, type ParsedArgs } from "../args.js";
import type { CliContext } from "../context.js";
import { readFlowText } from "./common.js";

/** `fil propose <flow> <file>` — write a proposed Flow patch (never auto-apply). */
export function proposeCommand(ctx: CliContext, args: ParsedArgs): number {
  const flowName = args.positional[0];
  const proposedPath = flag(args, "file") ?? args.positional[1];
  if (!flowName || !proposedPath) {
    ctx.out.error("Usage: fil propose <flow> <proposed-flow-file>");
    return 2;
  }

  const current = readFlowText(ctx, flowName);
  if (current === null) {
    ctx.out.error(`Flow "${flowName}" not found in .fil/flows/.`);
    return 1;
  }
  if (!existsSync(proposedPath)) {
    ctx.out.error(`Proposed file not found: ${proposedPath}`);
    return 1;
  }
  const proposed = readFileSync(proposedPath, "utf8");

  const rel = `.fil/flows/${flowName}.js`;
  const patch = createUnifiedPatch(current, proposed, rel, rel);

  const id = proposalId();
  ctx.store.writeProposal(id, patch);

  ctx.out.log(`Proposal ${id} written under .fil/proposals/.`);
  ctx.out.log("  It is NOT applied. Validate and apply with:");
  ctx.out.log(`    fil approve ${id}`);
  return 0;
}

function proposalId(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  const rand = randomBytes(2).toString("hex");
  return `${stamp}-${rand}`;
}
