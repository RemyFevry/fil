import type { RunProjection } from "@color-sunset/fil-contract";

/**
 * The Claude Code Adapter enforcement surface (Claude Code is the Agent Runtime).
 *
 * Claude Code's hard enforcement layer is a `PreToolUse` hook (rendered by
 * `hook-source.ts`) that blocks tools outside the active Phase's `allowedTools`.
 * Unlike the Pi Adapter, Claude Code does not inject a system prompt or surface
 * skill paths through this surface, so this module is intentionally lean: it
 * derives only what the tool-decision needs from the contract's `RunProjection`,
 * plus the fail-closed {@link decideToolUse}. Stays pure so CI can exercise it
 * without Claude Code installed.
 */

export interface ClaudeEnforcement {
  /** True if there is an active Run to enforce against. */
  hasActiveRun: boolean;
  /** Primary active Phase (human label). */
  phase: string;
  /** All active Phase ids (parallel runs include more than one). */
  phases: readonly string[];
  /** The allowedTools forwarded verbatim from the Phase's config. */
  allowedTools: readonly string[];
}

/** A pure-projection shape, decoupled from where it was read. */
export interface EnforceInput {
  projection: RunProjection;
}

const DORMANT: ClaudeEnforcement = {
  hasActiveRun: false,
  phase: "",
  phases: [],
  allowedTools: [],
};

/** Compute the lean Claude enforcement state for the given projection. */
export function enforceClaudeEnforcement(input: EnforceInput): ClaudeEnforcement {
  if (input.projection.status !== "active") return DORMANT;
  return {
    hasActiveRun: true,
    phase: input.projection.phase,
    phases: input.projection.phases,
    allowedTools: input.projection.phaseConfig.allowedTools,
  };
}

// ---------------------------------------------------------------------------
// PreToolUse decision — the core of the Claude enforcement layer.
// ---------------------------------------------------------------------------

export interface ToolDecision {
  /** True when the tool call may proceed (Fil imposes no block). */
  allow: boolean;
  /** Present when `allow` is false — surfaced to Claude as the deny reason. */
  reason?: string;
}

/**
 * Decide whether a `PreToolUse` hook should let `toolName` through, given the
 * active Run projection.
 *
 * - No active Run (or done/cancelled) → allow: Fil is dormant and must not
 *   interfere with Claude when nothing is being steered.
 * - Empty `allowedTools` → deny (fail-closed): a Phase that permits no tools
 *   blocks every tool call, mirroring the Pi Adapter's `tool_call` handler.
 * - `toolName` in `allowedTools` → allow (Claude's own permission flow still
 *   applies; Fil only adds its Phase restriction on top).
 * - Otherwise → deny with a reason naming the Phase and the allowed set.
 */
export function decideToolUse(
  projection: RunProjection | null,
  toolName: string,
): ToolDecision {
  if (projection?.status !== "active") return { allow: true };
  const cfg = projection.phaseConfig;
  const allowed = cfg.allowedTools;
  if (allowed.length === 0) {
    return {
      allow: false,
      reason: `Fil Phase '${projection.phase}' permits no tools.`,
    };
  }
  if (allowed.includes(toolName)) return { allow: true };
  return {
    allow: false,
    reason: `Fil Phase '${projection.phase}' disallows tool '${toolName}'. Allowed: ${allowed.join(", ")}.`,
  };
}
