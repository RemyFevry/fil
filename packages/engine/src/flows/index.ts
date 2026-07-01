import type { FlowDefinition } from "../seam.js";
import defaultFlow from "./default.json" with { type: "json" };
import hotfixFlow from "./hotfix.json" with { type: "json" };

export interface BuiltInFlow {
  name: string;
  definition: FlowDefinition;
  description: string;
}

/** The library of Flows shipped with Fil. `fil init` scaffolds these. */
export const BUILT_IN_FLOWS: BuiltInFlow[] = [
  {
    name: "default",
    definition: defaultFlow as FlowDefinition,
    description:
      "The full lifecycle: Requirements -> Design -> Code -> Review -> Done.",
  },
  {
    name: "hotfix",
    definition: hotfixFlow as FlowDefinition,
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
