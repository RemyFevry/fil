import { z } from "zod";

/**
 * The Fil state contract.
 *
 * `.fil/run.json` is the single source of truth that Fil authors and every
 * Adapter reads. This module owns its schema (ADR-0001), the per-Phase
 * configuration, and the Gate/Receipt shapes shared across the deep modules.
 */

// ---------------------------------------------------------------------------
// Actor mode — who runs within a Phase.
// ---------------------------------------------------------------------------
export const ActorModeSchema = z.enum(["human", "agent", "collaborative"]);
export type ActorMode = z.infer<typeof ActorModeSchema>;

// ---------------------------------------------------------------------------
// Run lifecycle status.
// ---------------------------------------------------------------------------
export const RunStatusSchema = z.enum(["active", "done", "cancelled"]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

// ---------------------------------------------------------------------------
// Gate — a user-defined executable test on a Transition (ADR: always present).
// Fil runs it on `fil next` and captures a Receipt.
// ---------------------------------------------------------------------------
export const ShellGateSchema = z.object({
  type: z.literal("shell"),
  /** Shell command; exit 0 means pass. */
  script: z.string().min(1),
  /** Optional artifact path recorded as evidence when the gate passes. */
  artifactPath: z.string().optional(),
});

export const HumanGateSchema = z.object({
  type: z.literal("human"),
  /** Optional prompt shown to the human; defaults to a confirmation. */
  prompt: z.string().optional(),
});

export const TestsPassGateSchema = z.object({
  type: z.literal("testsPass"),
  /** Test command; defaults to `npm test`. Exit 0 means pass. */
  command: z.string().optional(),
});

export const GateSpecSchema = z.discriminatedUnion("type", [
  ShellGateSchema,
  HumanGateSchema,
  TestsPassGateSchema,
]);
export type GateSpec = z.infer<typeof GateSpecSchema>;

/** The set of valid gate kinds — reused by Receipt.gateType. */
export const GateTypeSchema = z.enum(["shell", "human", "testsPass", "none"]);
export type GateType = z.infer<typeof GateTypeSchema>;

// ---------------------------------------------------------------------------
// Phase configuration — the harness primitives an Adapter enforces.
// ---------------------------------------------------------------------------
export const PhaseContextSchema = z.object({
  files: z.array(z.string()).default([]),
  notes: z.string().optional(),
  priorResults: z.array(z.string()).default([]),
});
export type PhaseContext = z.infer<typeof PhaseContextSchema>;

export const PhaseConfigSchema = z.object({
  instructions: z.string(),
  allowedTools: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  context: PhaseContextSchema.default({ files: [], priorResults: [] }),
  actorMode: ActorModeSchema.default("agent"),
  gate: GateSpecSchema,
});
export type PhaseConfig = z.infer<typeof PhaseConfigSchema>;

// ---------------------------------------------------------------------------
// Receipt — the artifact a Gate produces (primitive #10 made literal).
// ---------------------------------------------------------------------------
export const ReceiptOutcomeSchema = z.enum(["pass", "fail"]);
export type ReceiptOutcome = z.infer<typeof ReceiptOutcomeSchema>;

export const ReceiptEvidenceSchema = z.object({
  exitCode: z.number().int().optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  artifactPath: z.string().optional(),
  confirmed: z.boolean().optional(),
});
export type ReceiptEvidence = z.infer<typeof ReceiptEvidenceSchema>;

export const ReceiptSchema = z.object({
  /** Phase whose exit Gate produced this receipt. */
  phase: z.string(),
  gateType: GateTypeSchema,
  outcome: ReceiptOutcomeSchema,
  evidence: ReceiptEvidenceSchema.default({}),
  ranAt: z.string(),
});
export type Receipt = z.infer<typeof ReceiptSchema>;

// ---------------------------------------------------------------------------
// Run projection — the exact shape of `.fil/run.json`.
// ---------------------------------------------------------------------------
export const RunProjectionSchema = z
  .object({
    runId: z.string().min(1),
    change: z.string().min(1),
    flowName: z.string().min(1),
    status: RunStatusSchema,
    /** Primary active Phase name (human label). */
    phase: z.string(),
    /** All currently-active Phase names (parallel Phases → more than one). */
    phases: z.array(z.string()).min(1),
    actorMode: ActorModeSchema,
    phaseConfig: PhaseConfigSchema,
  })
  // The orchestrator derives `phase`, `actorMode`, and `phaseConfig` from
  // `phases[0]` (the primary Phase). A hand-edited `run.json` that picks a
  // different `phase` would contradict the live Flow, so reject it at the
  // contract boundary. `actorMode`/`phaseConfig` are checked against the live
  // engine snapshot at load time (see `OrchestratorDeps.engine.getPhaseConfig`).
  .superRefine((proj, ctx) => {
    const primary = proj.phases[0];
    if (primary !== undefined && proj.phase !== primary) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["phase"],
        message: `phase must equal phases[0] (${JSON.stringify(primary)})`,
      });
    }
  });
export type RunProjection = z.infer<typeof RunProjectionSchema>;

// ---------------------------------------------------------------------------
// Serialization / validation helpers.
// ---------------------------------------------------------------------------

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/** Validate an unknown value against a schema, returning a clear error. */
export function validate<S extends z.ZodType>(
  schema: S,
  input: unknown,
): ValidationResult<z.infer<S>> {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  return { ok: false, error: formatZodError(parsed.error) };
}

/** Validate and serialize a RunProjection to a pretty JSON string. */
export function serializeRunProjection(
  input: unknown,
): ValidationResult<string> {
  const result = validate(RunProjectionSchema, input);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return { ok: true, value: JSON.stringify(result.value, null, 2) + "\n" };
}

/** Parse and validate a run.json document. */
export function parseRunProjection(
  raw: string,
): ValidationResult<RunProjection> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: "run.json is not valid JSON." };
  }
  return validate(RunProjectionSchema, json);
}

function formatZodError(error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `  - ${path}: ${issue.message}`;
  });
  return `Invalid run.json:\n${lines.join("\n")}`;
}
