export {
  enforceClaudeEnforcement,
  decideToolUse,
  PROJECT_SKILLS_DIR,
  userSkillsDir,
  type ClaudeEnforcement,
  type ClaudeEnforcementDeps,
  type EnforceInput,
  type ToolDecision,
} from "./enforcement.js";

export { renderPreToolUseHookSource } from "./hook-source.js";

export {
  detectClaude,
  installClaudeAdapter,
  mergePreToolUseHandler,
  defaultFs,
  type InstallResult,
  type InstallScope,
  type InstallerFs,
  type InstallOptions,
  type ClaudeScopePaths,
} from "./installer.js";

import {
  installClaudeAdapter,
  defaultFs,
  detectClaude,
  type InstallerFs,
  type InstallScope,
  type InstallResult,
} from "./installer.js";

/**
 * Convenience: install the Claude Code Adapter for a project. The CLI prefers
 * this over calling `installClaudeAdapter` directly so call sites stay short.
 */
export function ensureClaudeAdapter(
  projectRoot: string,
  scope: InstallScope = "project",
  deps: { fs?: InstallerFs; claudeDetected?: boolean; userFilDir?: string } = {},
): InstallResult {
  const fs = deps.fs ?? defaultFs();
  return installClaudeAdapter({
    projectRoot,
    scope,
    fs,
    userFilDir: deps.userFilDir,
    claudeDetected: deps.claudeDetected ?? detectClaude(fs),
  });
}
