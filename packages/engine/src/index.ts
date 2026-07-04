export * from "./seam.js";
export { XStateFlowEngine } from "./xstate-engine.js";
export {
  BUILT_IN_FLOWS,
  builtInFlow,
  builtInFlowNames,
  serializeFlowCode,
} from "./flows/index.js";
export { createMachine } from "./flows/create-machine.js";
export { inspectFlow } from "./inspect.js";
export type { BuiltInFlow } from "./flows/index.js";
export type {
  InspectFlowOptions,
  InspectFlowDeps,
  InspectHandle,
} from "./inspect.js";

import type { FlowEngine } from "./seam.js";
import { XStateFlowEngine } from "./xstate-engine.js";

/** The default FlowEngine implementation (XState, in-process). */
export const defaultFlowEngine: FlowEngine = new XStateFlowEngine();

/**
 * The absolute file:// URL of this module (`@color-sunset/fil-engine`'s dist entry). Used
 * by the Flow loader to rewrite the bare `@color-sunset/fil-engine` specifier in Flow code
 * to an absolute URL, so the Flow file can be imported from any location
 * (including temp directories outside the workspace's node_modules hierarchy).
 */
export const engineEntryUrl: string = import.meta.url;