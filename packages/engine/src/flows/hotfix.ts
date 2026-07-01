import { createMachine } from "./create-machine.js";
import config from "./hotfix.config.js";

/**
 * The hotfix Flow: a fast incident path, authored as XState machine JS code.
 * Matches https://stately.ai/docs/xstate. The raw config lives in
 * `hotfix.config.ts`.
 */
export default createMachine(
  config as Parameters<typeof createMachine>[0],
);