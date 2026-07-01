import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BUILT_IN_FLOWS, serializeFlowCode } from "@fil/engine";
import type { CliContext } from "../context.js";

/** `fil init` — scaffold the durable `.fil/` layout (idempotent). */
export function initCommand(ctx: CliContext): number {
  const { store, out } = ctx;
  store.ensureLayout();

  const gitignorePath = join(ctx.cwd, ".gitignore");
  const gitignoreEntries = [
    ".fil/runs/",
    ".fil/run.json",
    ".fil/proposals/",
  ];
  const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
  const missing = gitignoreEntries.filter((entry) => !existing.includes(entry));
  if (missing.length > 0) {
    const block = `\n# Fil — durable local state (Runs/proposals are not committed)\n${missing.join("\n")}\n`;
    appendFileSync(gitignorePath, existing.endsWith("\n") || existing === "" ? block : `\n${block}`);
  }

  const scaffolded: string[] = [];
  for (const flow of BUILT_IN_FLOWS) {
    if (!store.flowExists(flow.name)) {
      store.writeFlowText(flow.name, serializeFlowCode(flow.definition));
      scaffolded.push(flow.name);
    }
  }

  out.log("Initialised Fil in .fil/");
  out.log(`  flows: ${store.listFlows().join(", ") || "(none)"}`);
  if (scaffolded.length > 0) out.log(`  scaffolded built-in flows: ${scaffolded.join(", ")}`);
  out.log(`  default flow: ${store.readConfig()?.defaultFlow ?? "default"}`);
  out.log("  .fil/flows/ and .fil/config.json are committable; runs/proposals are gitignored.");
  return 0;
}
