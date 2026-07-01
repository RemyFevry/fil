/**
 * The hotfix Flow config — the raw object literal the shipped hotfix Flow
 * passes to `createMachine(...)`. Mirror this in `hotfix.js` if you change it.
 */
export default {
  id: "hotfix",
  initial: "triage",
  context: {},
  states: {
    triage: {
      meta: {
        phase: {
          instructions:
            "Triage the incident: identify root cause and the smallest safe fix. Capture the reproduction and the expected outcome.",
          allowedTools: ["read", "write", "edit"],
          skills: [],
          context: {
            files: [],
            notes: "Speed matters, but a clear reproduction prevents a bad patch.",
            priorResults: [],
          },
          actorMode: "collaborative",
          gate: {
            type: "human",
            prompt: "Confirm the root cause and proceed to patch?",
          },
        },
      },
      on: { NEXT: "patch" },
    },
    patch: {
      meta: {
        phase: {
          instructions:
            "Apply the minimal fix and a regression test that reproduces the incident. Keep the blast radius small.",
          allowedTools: ["read", "write", "edit", "bash"],
          skills: ["tdd"],
          context: {
            files: ["src/"],
            notes: "A regression test must fail before the fix and pass after.",
            priorResults: ["triage"],
          },
          actorMode: "agent",
          gate: {
            type: "testsPass",
            command: "npm test",
          },
        },
      },
      on: { NEXT: "done" },
    },
    done: {
      type: "final",
      meta: {
        phase: {
          instructions: "The hotfix is complete.",
          allowedTools: [],
          skills: [],
          context: { files: [], priorResults: [] },
          actorMode: "human",
          gate: { type: "shell", script: "true" },
        },
      },
    },
  },
};
