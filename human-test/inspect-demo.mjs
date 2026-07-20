// Manual visual test for the Stately inspector integration (`fil inspect`).
//
// Run:  node human-test/inspect-demo.mjs [flow-name]
//   flow-name defaults to "default" (use "hotfix" for the incident Flow).
//
// What happens:
//   1. Launches the Stately inspector relay (opens https://stately.ai/inspect
//      in your browser automatically) and starts an XState actor for the Flow.
//   2. Prints the starting Phase.
//   3. Each time you press Enter in this terminal, the Flow advances one Phase
//      (NEXT); the active state in the browser updates live.
//   4. When the Flow reaches its terminal Phase, the session closes.
//
// Requires the engine to be built once: `pnpm build` from the repo root.
// Requires internet — the inspector UI is hosted at stately.ai (the actor and
// its events stay local; only the UI is remote).

import { inspectFlow, builtInFlow, BUILT_IN_FLOWS } from "@color-sunset/fil-engine";

const flowName = process.argv[2] ?? "default";
const flow = builtInFlow(flowName);
if (!flow) {
  const available = BUILT_IN_FLOWS.map((f) => f.name).join(", ");
  console.error(`Unknown flow "${flowName}". Available: ${available}.`);
  process.exit(1);
}

const phases = Object.keys(flow.rawConfig.states);
console.log(`Launching the Stately inspector for the "${flowName}" Flow…`);
console.log(`Lifecycle: ${phases.join(" → ")}`);

const handle = await inspectFlow({ machine: flow.machine });
const actor = handle.actor;

const snapshot = () => actor.getSnapshot();
const describe = (value) => (typeof value === "string" ? value : JSON.stringify(value));

const start = snapshot();
console.log(`\nStarting Phase: ${describe(start.value)}`);
console.log(
  "Inspector opening in your browser. Press Enter to advance (NEXT). Ctrl-C to exit.\n",
);

const readline = (await import("node:readline/promises")).default;
const rl = readline.createInterface({ input: process.stdin });

for await (const _line of rl) {
  actor.send({ type: "NEXT" });
  const s = snapshot();
  const done = s.status === "done";
  console.log(`  ▶ current: ${describe(s.value)}${done ? "  (done)" : ""}`);
  if (done) {
    console.log("\nFlow reached its terminal Phase. Closing.");
    break;
  }
}

handle.stop();
rl.close();
process.exit(0);
