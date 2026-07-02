import { createMachine } from "./create-machine.js";
import defaultFlowConfig from "./default.config.js";
import hotfixFlowConfig from "./hotfix.config.js";

/** The raw config object a Flow author writes inside `createMachine(...)`. */
export type FlowConfig = Parameters<typeof createMachine>[0];
/** The machine instance returned by `createMachine(...)`. */
export type FlowMachine = ReturnType<typeof createMachine>;

/**
 * A pre-built shipped Flow: the raw config the author wrote (the object
 * passed to `createMachine(...)`) plus the machine it produces. We keep both
 * so `serializeFlowCode` can write the author-original form back out without
 * xstate's normalized shape leaking into the scaffolded user Flow files.
 */
export interface BuiltInFlow {
  name: string;
  /** The raw Flow config — what the Flow author writes inside `createMachine(...)`. */
  rawConfig: FlowConfig;
  /** A pre-built machine — the result of `createMachine(rawConfig)`. */
  machine: FlowMachine;
  description: string;
}

/** The library of Flows shipped with Fil. `fil init` scaffolds these. */
export const BUILT_IN_FLOWS: BuiltInFlow[] = [
  {
    name: "default",
    rawConfig: defaultFlowConfig as FlowConfig,
    machine: createMachine(defaultFlowConfig as FlowConfig),
    description:
      "The full lifecycle: Requirements -> Design -> Code -> Review -> Done.",
  },
  {
    name: "hotfix",
    rawConfig: hotfixFlowConfig as FlowConfig,
    machine: createMachine(hotfixFlowConfig as FlowConfig),
    description:
      "A fast incident path: Triage -> Patch -> Done, gated by the test suite.",
  },
];

export function builtInFlow(name: string): BuiltInFlow | undefined {
  return BUILT_IN_FLOWS.find((flow) => flow.name === name);
}

export function builtInFlowNames(): string[] {
  return BUILT_IN_FLOWS.map((flow) => flow.name);
}

/**
 * Serialise a Flow's raw config back to source code in the canonical XState
 * format (matches https://stately.ai/docs/xstate). Used by `fil init` to
 * scaffold user Flow files. The argument is the object the Flow author
 * passed to `createMachine(...)` — i.e. the input to the wrapper, not the
 * machine itself.
 */
export function serializeFlowCode(rawConfig: FlowConfig): string {
  return (
    `import { createMachine } from "@color-sunset/fil-engine";\n` +
    `\n` +
    `export default createMachine(${JSON.stringify(rawConfig, null, 2)});\n`
  );
}