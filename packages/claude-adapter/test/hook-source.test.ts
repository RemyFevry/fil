import { describe, expect, it } from "vitest";
import { renderPreToolUseHookSource } from "../src/hook-source.js";

describe("PreToolUse hook source (rendered string)", () => {
  it("ships a self-contained Node ESM script", () => {
    const src = renderPreToolUseHookSource();
    expect(src).toMatch(/^[\s\S]*from "node:fs"/);
    expect(src).toContain('from "node:path"');
    // No TypeScript types — Claude runs it with `node` directly.
    expect(src).not.toMatch(/:\s*(string|string\[\]|RunProjection)/);
  });

  it("is stable across calls (idempotent installer)", () => {
    expect(renderPreToolUseHookSource()).toBe(renderPreToolUseHookSource());
  });

  it("reads .fil/run.json from the project directory", () => {
    const src = renderPreToolUseHookSource();
    expect(src).toContain('.fil/run.json');
    expect(src).toContain("CLAUDE_PROJECT_DIR");
  });

  it("emits the Claude Code PreToolUse deny decision on block", () => {
    const src = renderPreToolUseHookSource();
    expect(src).toContain('hookEventName: "PreToolUse"');
    expect(src).toContain('permissionDecision: "deny"');
    expect(src).toContain("permissionDecisionReason");
  });

  it("is fail-closed when allowedTools is empty (mirrors decideToolUse)", () => {
    const src = renderPreToolUseHookSource();
    expect(src).toMatch(/allowedTools\.length === 0[\s\S]{0,160}permits no tools/);
  });

  it("reads the tool name from the stdin payload", () => {
    const src = renderPreToolUseHookSource();
    expect(src).toContain("tool_name");
    expect(src).toContain("process.stdin");
  });
});
