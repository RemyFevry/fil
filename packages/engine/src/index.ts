export * from "./seam.js";
export { XStateFlowEngine } from "./xstate-engine.js";
export {
  BUILT_IN_FLOWS,
  builtInFlow,
  builtInFlowNames,
  serializeFlowCode,
} from "./flows/index.js";
export type { BuiltInFlow } from "./flows/index.js";

import type { FlowEngine } from "./seam.js";
import { XStateFlowEngine } from "./xstate-engine.js";

/** The default FlowEngine implementation (XState, in-process). */
export const defaultFlowEngine: FlowEngine = new XStateFlowEngine();
