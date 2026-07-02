import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BUILT_IN_FLOWS, serializeFlowCode } from "@fil/engine";
import type { InstallScope } from "@fil/pi-adapter";
import type { ParsedArgs } from "../args.js";
import { flag } from "../args.js";
import type { CliContext } from "../context.js";

const VALID_SCOPES: readonly InstallScope[] = ["project", "user", "both"];

/** `fil init` — scaffold the durable `.fil/` layout (idempotent). */
export function initCommand(ctx: CliContext, args: ParsedArgs = { positional: [], flags: {} }): number {
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
      store.writeFlowText(flow.name, serializeFlowCode(flow.rawConfig));
      scaffolded.push(flow.name);
    }
  }

  out.log("Initialised Fil in .fil/");
  out.log(`  flows: ${store.listFlows().join(", ") || "(none)"}`);
  if (scaffolded.length > 0) out.log(`  scaffolded built-in flows: ${scaffolded.join(", ")}`);
  out.log(`  default flow: ${store.readConfig()?.defaultFlow ?? "default"}`);
  out.log("  .fil/flows/ and .fil/config.json are committable; runs/proposals are gitignored.");

  // Adapter install: optional (tests stub the callback) and tolerant of an
  // uninstalled Pi. Default scope is `project`; the user can pick a wider
  // scope with `--scope user` or `--scope both`.
  if (ctx.installPiAdapter) {
    const scope = parseScope(flag(args, "scope"));
    if (!scope.ok) {
      out.error(scope.error);
      return 2;
    }
    const result = ctx.installPiAdapter({ scope: scope.value });
    if (result.piDetected) {
      const targets = formatTargets(scope.value, result.paths);
      if (result.installed) {
        out.log(`  pi adapter: installed (scope=${scope.value}) at ${targets}`);
      } else {
        out.log(`  pi adapter: ${result.reason ?? "already installed"} at ${targets}`);
      }
    } else {
      out.log(`  pi adapter: ${result.reason ?? "skipped (Pi not detected)"}`);
    }
  }

  return 0;
}

function parseScope(raw: string | undefined): { ok: true; value: InstallScope } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: "project" };
  if ((VALID_SCOPES as readonly string[]).includes(raw)) {
    return { ok: true, value: raw as InstallScope };
  }
  return {
    ok: false,
    error: `Invalid --scope "${raw}"; expected one of: ${VALID_SCOPES.join(", ")}.`,
  };
}

/** Format the target path(s) for a given scope so the log line names them all. */
function formatTargets(
  scope: InstallScope,
  paths: { project: string; user: string },
): string {
  if (scope === "both") return `${paths.project} and ${paths.user}`;
  return paths[scope];
}
