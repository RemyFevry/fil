# Fil

An open-source harness for agentic software-development lifecycles. The developer and AI agents are guided through a software-development lifecycle (SDLC) by a state machine whose structure the developer chooses and which evolves as the project progresses.

## Language

**Harness**:
The orchestration layer that turns a reasoning model into a working agent, spanning the ten primitives of harness engineering (instructions, context delivery, context management, tool interface, execution environment, durable state, orchestration, sub-agents, skills & procedures, verification & observability). In Fil, the Orchestration primitive *is* a state machine (the Flow). Fil does **not** run models or agent loops itself — it owns the spine (orchestration, durable state, verification, and the per-Phase configuration) and **steers external Agent Runtimes** to do the actual work.
_Avoid_: framework, wrapper, runtime (in the loose sense).

**Agent Runtime**:
An external AI coding tool that provides the model, the agent loop, and the execution environment — e.g. Claude Code, GitHub Copilot, Cursor, Aider. Fil does not run it; Fil disciplines it via an Adapter.
_Avoid_: agent (too generic — here it means the whole tool, not a single model call).

**Adapter**:
The per-Agent-Runtime bridge that translates a Phase's configuration into that tool's native enforcement mechanisms — instruction files (`CLAUDE.md`, `.cursor/rules`), permission settings, hooks (e.g. Claude Code `PreToolUse`), MCP / skill config — so the tool is constrained to the current Phase. One Adapter per supported Agent Runtime.
_Avoid_: plugin, integration (too loose).

**Flow**: An engine-native code file authored as **XState machine JS code** — a Flow is a `.js` module that calls `createMachine(...)` from `@fil/engine` (which wraps xstate's `createMachine` internally, see ADR-0003) and exports the resulting machine. The shape matches the canonical XState examples at https://stately.ai/docs/xstate. A Flow defines how a Change is delivered — its Phases, Transitions, Gates, and per-Phase harness configuration. Fil is a thin host over the chosen engine (see ADR-0002): it supplies Gate execution and Receipt capture, per-Phase harness configuration, durability, and the FlowEngine seam — and adds SDLC semantics, Adapters, the gate-runner, the CLI, and Flow evolution on top. A Project holds a library of Flows (one default, others per change-type); Flow files live at project level (`.fil/flows/`) or user level (`~/.fil/flows/`), evolve over time, and are versioned via git.
_Avoid_: workflow, pipeline, process, SDLC-template.

**Run**:
A single execution of a Flow, bound to one Change. Snapshots the Flow version it started from, carries its own durable state, current Phase, and history. Frozen once complete.
_Avoid_: session, execution, instance (too generic).

**Change**:
The unit of work a Run delivers — a feature, fix, or refactor. One Run : one Change.
_Avoid_: ticket, task, story, feature (too narrow — a Change may be a fix or refactor).

**Project**:
A repository plus its durable state, its library of Flows, and the history of Runs. A container only — there is no state machine at the Project level.
_Avoid_: workspace, repo (Fil's Project is broader than the git repository).

**Phase**:
A node in a Flow (an XState state node) representing one stage of the lifecycle (e.g. "Requirements", "Design"). The unit agents execute *within*. Carries a per-phase configuration of the harness primitives — **instructions, context delivery, tool-interface restrictions, skills, and its exit verification** — which an **Adapter** enforces on the active Agent Runtime. Fil owns durable state, orchestration, and verification at the Flow/Run level; the model, agent loop, context-management, and execution environment are delegated to the Agent Runtime. Has an **actor mode** ∈ {`human` (no agent runs), `agent` (agent loop runs, human optional), `collaborative` (agent + human converse, done only on convergence)}. **Sub-agents are not a Phase-config field** — they are nudged via the Phase instructions and spawned by the runtime's native capability; Fil neither declares nor orchestrates them. Parallel attention is expressed structurally as **parallel Phases** (XState parallel states).
_Avoid_: state (collides with XState's active-state snapshot), step, stage, task.

**Transition**:
The directed edge between Phases. Carries one property: a **Gate** (its mandatory condition). Whether a transition is human-gated is expressed *within* the Gate (a human-confirmation check), not as a separate control.

**Gate**:
The mandatory condition on a Transition. Always present — there are no ungated transitions. A **user-defined executable test**: a shell script, a test file, an API call, an interactive human-confirmation prompt, or anything else Fil can run to yield pass/fail. Fully configured by the user; executed by **Fil itself** on `fil next`, which captures the result as a **verification receipt** (pass/fail + evidence). Maps to XState's guard concept but is richer — it produces a receipt and may bundle human-in-the-loop approval.
_Avoid_: check, validation (too generic).

**Receipt** (verification receipt):
The artifact a Gate produces when `fil next` executes it: pass/fail plus evidence (test output, the artifact path checked, the human's confirmation). Stored per Run for audit and observability — primitive #10 made literal. Never the agent's say-so.
_Avoid_: result, log (too generic).

**Trigger** _(folded into Gate)_:
Human-gating is now expressed as a Gate whose test is a human-confirmation prompt, so a separate who-may-fire knob was removed.

## Flagged ambiguities

- ~~**"State"** — resolved: **Phase** for the lifecycle node; "active state" only for the XState runtime snapshot.~~
