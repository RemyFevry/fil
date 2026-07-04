import { homedir } from "node:os";
import { join } from "node:path";
import { defaultFlowEngine, inspectFlow } from "@color-sunset/fil-engine";
import type {
  FlowEngine,
  InspectFlowDeps,
  InspectFlowOptions,
  InspectHandle,
} from "@color-sunset/fil-engine";
import {
  detectPi,
  defaultFs as defaultPiFs,
  installPiAdapter as installPiAdapterReal,
  type InstallResult as PiInstallResult,
  type InstallScope,
} from "@color-sunset/fil-pi-adapter";
import {
  detectClaude,
  defaultFs as defaultClaudeFs,
  installClaudeAdapter as installClaudeAdapterReal,
  type InstallResult as ClaudeInstallResult,
} from "@color-sunset/fil-claude-adapter";
import { FilStore, type Store } from "@color-sunset/fil-store";

/** Runtime context shared by every CLI command. */
export interface CliContext {
  /** The project root Fil operates on (usually `process.cwd()`). */
  cwd: string;
  /** The `.fil/` repository. */
  store: Store;
  /** The FlowEngine (XState by default). */
  engine: FlowEngine;
  /** User-level flows directory (`~/.fil/flows`). */
  userFlowsDir: string;
  /** User-level Fil directory (`~/.fil`) — used by the Pi Adapter installer. */
  userFilDir: string;
  /** Output streams (captured in tests). */
  out: {
    log: (line: string) => void;
    error: (line: string) => void;
  };
  /** Human-confirmation prompter (defaults to interactive stdin). */
  prompter?: (message: string) => Promise<boolean>;
  /**
   * Launch the Stately inspector for a Flow (ADR-0002 visualizer). Optional so
   * tests can stub it; `defaultContext` binds the real engine export, which
   * opens the inspector UI in the browser.
   */
  inspectFlow?: (
    options: InspectFlowOptions,
    deps?: InspectFlowDeps,
  ) => Promise<InspectHandle>;
  /**
   * Installs the Pi adapter for the project. Optional so tests can stub it;
   * `defaultContext` binds a real one that respects the working directory
   * and detects Pi via the host filesystem.
   */
  installPiAdapter?: (opts: { scope: InstallScope }) => PiInstallResult;
  /**
   * Installs the Claude Code adapter for the project. Optional so tests can
   * stub it; `defaultContext` binds a real one that detects Claude Code via
   * the host filesystem and registers the PreToolUse hook in settings.json.
   */
  installClaudeAdapter?: (opts: { scope: InstallScope }) => ClaudeInstallResult;
}

/** Options for {@link defaultContext}. `cwd` is always required. */
export type DefaultContextOptions = Partial<Omit<CliContext, "cwd">>;

/** The full default context — production wiring. */
export function defaultContext(
  cwd: string,
  overrides: DefaultContextOptions = {},
): CliContext {
  // Resolve the *final* values first (after overrides merge) so the
  // installPiAdapter closure below reads the same paths the rest of the
  // context exposes — otherwise an overridden `userFilDir` would be
  // ignored at install time.
  const base: CliContext = {
    cwd,
    store: new FilStore(join(cwd, ".fil")),
    engine: defaultFlowEngine,
    userFlowsDir: join(overrides.userFilDir ?? join(homedir(), ".fil"), "flows"),
    userFilDir: overrides.userFilDir ?? join(homedir(), ".fil"),
    out: { log: console.log, error: console.error },
  };
  const merged: CliContext = { ...base, ...overrides };
  if (!("inspectFlow" in overrides)) {
    merged.inspectFlow = inspectFlow;
  }
  // Only auto-bind the real installer if the caller didn't supply one
  // (an explicit `installPiAdapter: undefined` opts out — the test for
  // the "no callback" branch relies on this).
  if (!("installPiAdapter" in overrides)) {
    merged.installPiAdapter = ({ scope }) =>
      installPiAdapterReal({
        projectRoot: merged.cwd,
        userFilDir: merged.userFilDir,
        scope,
        fs: defaultPiFs(),
        piDetected: detectPi(),
      });
  }
  if (!("installClaudeAdapter" in overrides)) {
    merged.installClaudeAdapter = ({ scope }) =>
      installClaudeAdapterReal({
        projectRoot: merged.cwd,
        userFilDir: merged.userFilDir,
        scope,
        fs: defaultClaudeFs(),
        claudeDetected: detectClaude(),
      });
  }
  return merged;
}
