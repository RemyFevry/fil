import {
  createMachine as xstateCreateMachine,
  type AnyStateMachine,
} from "xstate";

/**
 * The Fil Flow author-facing `createMachine` — the wrapper that lets a Flow
 * file look like the canonical XState machine JS code shown in the official
 * XState docs (https://stately.ai/docs/xstate), without importing `xstate`
 * directly.
 *
 * Rule (ADR-0003): **no engine-library imports outside the engine adapter
 * module.** Flow code never imports `xstate`; it imports `createMachine` from
 * `@color-sunset/fil-engine` (i.e. this module), which delegates to xstate's `createMachine`
 * internally. The returned machine is what Fil's `XStateFlowEngine.load(...)`
 * consumes; the engine itself does not call `createMachine` again.
 *
 * ```ts
 * // .fil/flows/default.js — matches https://stately.ai/docs/xstate
 * import { createMachine } from "@color-sunset/fil-engine";
 *
 * export default createMachine({
 *   id: "default",
 *   initial: "design",
 *   context: {},
 *   states: {
 *     design: { on: { NEXT: "code" } },
 *     code:   { on: { NEXT: "review" } },
 *   },
 * });
 * ```
 */
export function createMachine(
  config: Parameters<typeof xstateCreateMachine>[0],
  implementations?: Parameters<typeof xstateCreateMachine>[1],
): AnyStateMachine {
  return xstateCreateMachine(config, implementations);
}