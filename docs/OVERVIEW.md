# Fil — Design Overview

> Synthesis of the design. For terminology see [`CONTEXT.md`](../CONTEXT.md); for decisions see [`docs/adr/`](./adr/).

## What it is

Fil is an open-source harness for agentic software-development lifecycles. A developer and their AI coding agents are guided through a software-development lifecycle (SDLC) by a state machine (a **Flow**) whose structure the developer chooses and which **evolves** as the project progresses. Fil does **not** run models or agent loops — it owns the orchestration spine and **steers external Agent Runtimes** (Claude Code, Pi, …) to do the actual work.

## The one idea

Most agent harnesses (Claude Code, Cursor, Pi) leave the SDLC to the human's discretion. Fil makes the SDLC itself the first-class, machine-enforced, evolving spine: at each **Phase**, the active Agent Runtime is constrained (instructions, tools, context) to that phase, and leaving a phase requires passing a user-defined **Gate**.

## Architecture: steer, don't run (ADR-0001)

- Fil runs as a **sidecar governor**, not a parent process — the human keeps their agent's native UX.
- **Fil owns:** the Flow (state machine), durable Run state, Gate verification, and the per-Phase configuration.
- **Fil delegates to the Agent Runtime:** the model, the agent loop, context-management, the execution environment.
- An **Adapter** (one per runtime) translates the current Phase's config into the runtime's native enforcement points and reads `.fil/run.json`. Enforcement is **tiered** (advisory config → hooks → MCP/control-surface); the **restrictions strategy is user-owned** (advisory / hooks / sandbox / container).

## Core model

- **Project** — repo + durable state + a library of **Flows** + Run history. No machine at this level.
- **Flow** — a state machine (default engine: XState) defining how a **Change** is delivered: its **Phases**, **Transitions**, **Gates**, and per-Phase harness config. Lives at project (`.fil/flows/`) or user (`~/.fil/flows/`) level; versioned via git; authored as serializable engine config.
- **Run** — one execution of a Flow, bound to one **Change** (feature / fix / refactor). Snapshots the Flow version at start; frozen when done.
- **Phase** — a node (XState state) agents execute within. Actor mode ∈ {`human`, `agent`, `collaborative`}. Carries per-Phase config: instructions, context delivery, tool-interface restrictions, skills, exit verification. Sub-agents are nudged via instructions (not declared); parallel attention = parallel Phases.
- **Transition** — edge; carries one property: a **Gate**. Human-gating is simply a Gate whose test is a human-confirmation prompt.
- **Gate** — a user-defined executable test (script / test file / API call / human-confirmation prompt). Always present (no ungated transitions). **Fil runs it** on `fil next`, capturing a **Receipt** (pass/fail + evidence).
- **FlowEngine** seam (ADR-0003) — XState is the default; the seam is cross-language-capable so a future engine (e.g. a Python service) can replace it. Flow files are engine-specific; migration is the user's job.

## How a Run flows

1. `fil init` → picks Agent Runtime(s), installs the matching Adapter(s) through their native channels, scaffolds `.fil/`.
2. `fil start <change>` → spawns a Run from the chosen Flow, snapshots the Flow, writes the current Phase to `.fil/run.json`.
3. The Adapter reads `run.json` and constrains the active runtime to the Phase (instructions, tools, context, skills). Human/agent work in the runtime's native UX.
4. `fil next` (human or agent) → Fil runs the Phase's Gate → on pass (and no human-confirmation needed) → transition → Adapter reconfigures for the next Phase. Receipt stored.
5. Repeat until the terminal Phase → Run frozen.

## Evolution (the differentiator)

- **Human** edits Flow files directly (free; git-committed).
- **Agent** proposes Flow edits as **code patches** in `.fil/proposals/`; `fil approve` validates (load + reachability) and git-applies. Edits shape **future** Runs; a running Run is frozen (cancel-and-restart for big revamps; stranding → Run cancelled).

## What Fil owns vs delegates

| Harness primitive | Owner |
|---|---|
| Instructions | Fil (delivered via Adapter) |
| Context delivery | shared — Fil selects (files/notes + prior-Phase results + always-on Fil system context), Adapter injects |
| Context management (compaction) | delegated (runtime) |
| Tool interface | shared — Fil restricts per Phase, Adapter enforces |
| Execution environment | delegated (runtime) |
| Durable state | Fil |
| Orchestration | Fil (the Flow) |
| Sub-agents | delegated (runtime), nudged via instructions |
| Skills & procedures | shared — Fil maps per Phase, runtime loads |
| Verification & observability | Fil (Gates + Receipts); runtime owns its own trace |

## MVP scope

- **Engine:** XState, in-process.
- **Adapters:** **Pi** (extension: `setActiveTools` / `tool_call` / `before_agent_start` / `registerTool`) + **Claude Code** (plugin: hooks / MCP / skills).
- **Visualizer:** view-only (`@statelyai/inspect`).
- **Stack:** TypeScript/Node monorepo; MIT; `fil` CLI on npm; Adapters distributed via each runtime's native channel.
- **Durable state:** `flows/` + `config.json` committed; `runs/` + `run.json` + `proposals/` gitignored.

## Artifacts

- [`CONTEXT.md`](../CONTEXT.md) — glossary.
- [ADR-0001](./adr/0001-steer-dont-run.md) — steer existing Agent Runtimes; don't run one.
- [ADR-0002](./adr/0002-flows-are-xstate-code.md) — Flows are engine-native code; reuse the chosen engine, don't reinvent.
- [ADR-0003](./adr/0003-xstate-isolated-behind-flowengine-seam.md) — XState is the default engine, behind a cross-language `FlowEngine` seam.
