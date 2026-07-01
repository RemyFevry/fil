import { homedir } from "node:os";
import { join } from "node:path";
import { defaultFlowEngine } from "@fil/engine";
import type { FlowEngine } from "@fil/engine";
import { FilStore, type Store } from "@fil/store";

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
  /** Output streams (captured in tests). */
  out: {
    log: (line: string) => void;
    error: (line: string) => void;
  };
  /** Human-confirmation prompter (defaults to interactive stdin). */
  prompter?: (message: string) => Promise<boolean>;
}

export function defaultContext(cwd: string, overrides: Partial<CliContext> = {}): CliContext {
  return {
    cwd,
    store: new FilStore(join(cwd, ".fil")),
    engine: defaultFlowEngine,
    userFlowsDir: join(homedir(), ".fil", "flows"),
    out: { log: console.log, error: console.error },
    ...overrides,
  };
}
