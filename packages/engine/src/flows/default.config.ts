/**
 * The default Flow config — the raw object literal the shipped default Flow
 * passes to `createMachine(...)`. Kept separate from `default.js` so the
 * shipped Flow file matches the canonical XState example at
 * https://stately.ai/docs/xstate (call `createMachine(...)`, default-export
 * the machine), while this raw form is what `serializeFlowCode` writes back
 * out when `fil init` scaffolds a user Flow file.
 *
 * If you change this file, mirror the change in `default.js`.
 */
export default {
  id: "default",
  initial: "requirements",
  context: {},
  states: {
    requirements: {
      meta: {
        phase: {
          instructions:
            "Gather and write down the requirements for this Change. Define the problem, the acceptance criteria, and the scope. Do not write production code here.",
          allowedTools: ["read", "write", "edit"],
          skills: [],
          context: {
            files: ["CONTEXT.md", "docs/"],
            notes: "Capture requirements as a short brief the next phases can rely on.",
            priorResults: [],
          },
          actorMode: "collaborative",
          gate: {
            type: "shell",
            // Cross-platform: invoke `node` (always on PATH in any Fil setup) and
            // check the exact artifact path that the receipt will record. No
            // POSIX-only `find`/`test`, and no `requirements*.md` wildcard that
            // would let a sibling file satisfy the gate.
            script:
              "node -e \"require('node:fs').existsSync('requirements.md') ? process.exit(0) : process.exit(1)\"",
            artifactPath: "requirements.md",
          },
        },
      },
      on: { NEXT: "design" },
    },
    design: {
      meta: {
        phase: {
          instructions:
            "Design the approach for this Change. Sketch the data model, the modules affected, and the key decisions. Reference ADRs where relevant.",
          allowedTools: ["read", "write", "edit"],
          skills: [],
          context: {
            files: ["docs/adr/", "docs/OVERVIEW.md"],
            notes: "Build on the requirements brief from the previous phase.",
            priorResults: ["requirements"],
          },
          actorMode: "collaborative",
          gate: {
            type: "human",
            prompt: "Approve the design and proceed to implementation?",
          },
        },
      },
      on: { NEXT: "code" },
    },
    code: {
      meta: {
        phase: {
          instructions:
            "Implement the Change. Write the code and the tests, keeping the design from the previous phase in mind. The exit gate is the test suite.",
          allowedTools: ["read", "write", "edit", "bash"],
          skills: ["tdd"],
          context: {
            files: ["src/"],
            notes: "The design is the contract; the tests are the proof.",
            priorResults: ["requirements", "design"],
          },
          actorMode: "agent",
          gate: {
            type: "testsPass",
            command: "npm test",
          },
        },
      },
      on: { NEXT: "review" },
    },
    review: {
      meta: {
        phase: {
          instructions:
            "Review the Change against the requirements and design. Confirm quality, remove drift, and approve before merge.",
          allowedTools: ["read", "edit"],
          skills: [],
          context: {
            files: [],
            notes: "A human confirms the Change is ready.",
            priorResults: ["requirements", "design", "code"],
          },
          actorMode: "collaborative",
          gate: {
            type: "human",
            prompt: "Approve this Change for merge?",
          },
        },
      },
      on: { NEXT: "done" },
    },
    done: {
      type: "final",
      meta: {
        phase: {
          instructions: "The Change is complete.",
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
