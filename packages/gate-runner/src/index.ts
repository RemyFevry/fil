import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type {
  GateType,
  NamedGate,
  Receipt,
  ReceiptEvidence,
  ReceiptOutcome,
} from "@color-sunset/fil-contract";

/**
 * The deep module that turns a user-defined Gate into a Receipt.
 * Pure over its inputs (the shell it spawns is the gate's own test).
 */

export interface GateContext {
  /** Working directory in which to execute the gate. */
  cwd: string;
  /** Phase whose exit Gate is being run (stamped onto the Receipt). */
  phase?: string;
  /**
   * Human-confirmation prompter for `human` gates.
   * Returns true to confirm (advance), false to decline (fail receipt).
   * Defaults to an interactive yes/no prompt on stdin/stdout.
   */
  prompter?: (message: string) => Promise<boolean>;
}

/** Run a named Gate, capturing a Receipt (pass/fail + evidence). */
export async function runGate(
  gate: NamedGate,
  ctx: GateContext,
): Promise<Receipt> {
  switch (gate.type) {
    case "shell":
      return runShell(gate.script, gate.artifactPath, gate.name, ctx);
    case "testsPass":
      return runShell(gate.command ?? "npm test", undefined, gate.name, ctx);
    case "human":
      return runHuman(gate.prompt, gate.name, ctx);
    default: {
      // Defensive fallback: an unknown gate.type (e.g. from a hand-edited or
      // future-engine Flow) must not crash the orchestrator's run-all loop.
      // Produce a fail receipt so the Phase's other gates still run and the
      // AND-aggregation surfaces this as a failure (ADR-0004).
      const name = typeof gate === "object" && gate !== null && "name" in gate && typeof (gate as { name?: unknown }).name === "string"
        ? (gate as { name: string }).name
        : "(unknown)";
      return buildReceipt(ctx, name, "none", "fail", {
        stderr: `Unknown gate type (${JSON.stringify(gate)})`,
      });
    }
  }
}

function runShell(
  script: string,
  artifactPath: string | undefined,
  gateName: string,
  ctx: GateContext,
): Receipt {
  const result = spawnSync(script, {
    shell: true,
    cwd: ctx.cwd,
    encoding: "utf8",
    timeout: 10 * 60 * 1000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const outcome: ReceiptOutcome = result.status === 0 ? "pass" : "fail";
  const evidence: ReceiptEvidence = {
    exitCode: typeof result.status === "number" ? result.status : -1,
    stdout: trim(result.stdout),
    stderr: trim(result.stderr ?? result.error?.message),
  };
  if (artifactPath && outcome === "pass") {
    evidence.artifactPath = artifactPath;
  }
  return buildReceipt(ctx, gateName, "shell", outcome, evidence);
}

async function runHuman(
  prompt: string | undefined,
  gateName: string,
  ctx: GateContext,
): Promise<Receipt> {
  const message = prompt ?? "Confirm this phase is complete and may advance.";
  const confirmed = ctx.prompter
    ? await ctx.prompter(message)
    : await defaultPrompter(message);
  return buildReceipt(ctx, gateName, "human", confirmed ? "pass" : "fail", {
    confirmed,
  });
}

async function defaultPrompter(message: string): Promise<boolean> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question(`${message} [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

function buildReceipt(
  ctx: GateContext,
  gateName: string,
  gateType: GateType,
  outcome: ReceiptOutcome,
  evidence: ReceiptEvidence,
): Receipt {
  return {
    phase: ctx.phase ?? "",
    gateName,
    gateType,
    outcome,
    evidence,
    ranAt: new Date().toISOString(),
  };
}

/** Verify a gate's declared artifact exists (helper for tests/Adapters). */
export function artifactExists(
  artifactPath: string | undefined,
  cwd: string,
): boolean {
  if (!artifactPath) return true;
  // Resolve against `cwd` for relative paths so we don't accidentally fall
  // back to process.cwd() via existsSync's bare-relative behaviour.
  const resolved = isAbsolute(artifactPath) ? artifactPath : join(cwd, artifactPath);
  return existsSync(resolved);
}

function trim(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const out = value.trim();
  return out.length === 0 ? undefined : out;
}
