import { createMachine } from "./create-machine.js";
import config from "./default.config.js";

/**
 * The default Flow: a full lifecycle, authored as XState machine JS code.
 *
 * This file matches the canonical XState example at
 * https://stately.ai/docs/xstate — `createMachine(...)` from `@fil/engine`
 * (which wraps xstate's `createMachine`) plus a default export of the
 * resulting machine. The raw config lives in `default.config.ts` so
 * `serializeFlowCode` can write the author-original form back out without
 * xstate's normalized shape leaking into the scaffolded user Flow files.
 */
export default createMachine(
  config as Parameters<typeof createMachine>[0],
);