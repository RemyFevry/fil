import type { FlowDefinition } from "../seam.js";
import defaultFlow from "./default.js";
import hotfixFlow from "./hotfix.js";

export interface BuiltInFlow {
  name: string;
  definition: FlowDefinition;
  description: string;
}

/** The library of Flows shipped with Fil. `fil init` scaffolds these. */
export const BUILT_IN_FLOWS: BuiltInFlow[] = [
  {
    name: "default",
    definition: defaultFlow,
    description:
      "The full lifecycle: Requirements -> Design -> Code -> Review -> Done.",
  },
  {
    name: "hotfix",
    definition: hotfixFlow,
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
 * Serialise a Flow definition into engine-native code (a module exporting the
 * config). Used by `fil init` to scaffold user Flow files. The result is real
 * code (commentable, JS syntax) — not JSON.
 */
export function serializeFlowCode(definition: FlowDefinition): string {
  return `export default ${JSON.stringify(definition, null, 2)};\n`;
}
