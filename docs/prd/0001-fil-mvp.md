---
Triage: ready-for-agent
---

# PRD — Fil MVP

## Problem Statement

Developers using AI coding agents (Claude Code, Cursor, Pi, Copilot) get raw coding power but no disciplined lifecycle. Requirements gathering, design, review, testing, and deployment happen ad hoc; the agent's scope, context, and tools aren't constrained to the current stage of work; and there is no enforced, auditable progression from one stage to the next. Today developers must either invent a workflow from scratch every time, or accept a rigid one-size-fits-all process imposed by a tool. The agent's "I think it's done" is trusted in lieu of external verification, and the team's process — such as it is — lives in no reusable, evolvable form.

## Solution

**Fil** is an open-source harness that guides a developer and their AI agents through a software-development lifecycle via an evolving state machine (a **Flow**). Fil does **not** replace the coding agent — it **steers the developer's existing Agent Runtime** (Claude Code, Pi) by constraining it per **Phase** (instructions, tool restrictions, context, skills) and requiring a user-defined **Gate** to advance. Flows are fully user-owned and **evolve** over time: an agent may *propose* improvements, a human *approves* them.

Fil owns only the orchestration spine — the Flow, durable **Run** state, Gate verification, and per-Phase configuration — and delegates the model, the agent loop, and the execution environment to whichever Agent Runtime the developer already uses. This makes Fil tool-agnostic, model-free, and a complement to (not a competitor of) the agent tools developers love.

## User Stories

**Onboarding**
1. As a developer, I want to install Fil via npm, so that I can use it in any project.
2. As a developer, I want `fil init` to ask which coding tools I use, so that the right Adapter is installed automatically.
3. As a developer, I want `fil init` to scaffold a `.fil/` directory with a default Flow and config, so that I can start immediately.
4. As a developer, I want `fil init` to install the Pi Adapter as a Pi extension (or the Claude Adapter as a Claude plugin) through the runtime's native channel, so that my agent is constrained by Fil with no manual wiring.
5. As a developer, I want `fil init` to detect an already-installed Adapter and skip reinstalling, so that re-running init is safe.

**Authoring Flows**
6. As a developer, I want to author a Flow as serializable engine config (XState config for the default engine), so that it is version-controllable and reusable.
7. As a developer, I want a library of Flows (a default plus per change-type, e.g. feature / hotfix / refactor), so that different kinds of work follow different lifecycles.
8. As a developer, I want Flows to live at project level or user level, so that I can share team flows or keep personal defaults (user-level overridden by project-level).
9. As a developer, I want each Phase to carry its own instructions, tool restrictions, context, and skills, so that the agent is shaped to the current stage.
10. As a developer, I want to set a Phase's actor mode (`human` / `agent` / `collaborative`), so that some phases are human-only and others agent-driven.
11. As a developer, I want to define a Gate on each Transition as any executable test (shell script / test file / API call / human-confirmation prompt), so that advancement is verifiable and fully owned by me.
12. As a developer, I want to express parallel Phases (concurrent stages), so that I can model parallel attention.

**Starting & tracking a Run**
13. As a developer, I want `fil start <change>` to spawn a Run bound to one Change, so that each unit of work has its own lifecycle.
14. As a developer, I want to choose a Flow when starting (`--flow hotfix`), so that the right lifecycle is used.
15. As a developer, I want a Run to snapshot the Flow version it started from, so that it stays reproducible as the Flow evolves.
16. As a developer, I want `fil status` to show the current Phase and Gate state, so that I know where the Change stands.
17. As a developer, I want `fil back` and `fil cancel`, so that I can revise or abandon a Run.

**Per-Phase enforcement (via the Adapter)**
18. As a developer, I want the Adapter to restrict the agent's tools to the current Phase, so that the agent cannot escape its stage (e.g. no deploys in Design).
19. As a developer, I want the Adapter to inject the Phase's instructions as the system prompt, so that the agent adopts the right persona and goal.
20. As a developer, I want the Adapter to deliver the Phase's context — static files/notes, prior-Phase results, and an always-on Fil system context — so that the agent is grounded and never lost.
21. As a developer, I want the Adapter to expose `fil next` / `status` / `propose` as the runtime's native tools/commands, so that the agent can self-advance and propose improvements.

**Gates & transitions**
22. As a developer, I want `fil next` to run the current Phase's Gate and capture a Receipt, so that advancement is verified externally — never the agent's say-so.
23. As a developer, I want a Gate with a human-confirmation prompt to block until I confirm, so that human approval is enforced.
24. As a developer, I want `fil next` to transition to the next Phase and the Adapter to reconfigure, so that work continues under the new constraints.
25. As a developer, I want every transition's Receipt stored per Run, so that there is an auditable trail.

**Evolution**
26. As a developer, I want to edit Flow files directly between Runs, so that I can refine my process freely.
27. As an agent, I want to propose a Flow edit as a code patch, so that the recipe can improve from lived friction.
28. As a developer, I want proposed patches stored under proposals and **not** auto-applied, so that the agent cannot mutate the Flow without my approval.
29. As a developer, I want `fil approve` to validate a patch (it loads as a valid machine, and no active Run is stranded) and git-apply it, so that bad edits are caught and good ones are versioned.
30. As a developer, I want a big Flow revamp to let me cancel and restart a Run, so that I avoid live-rewriting complexity.

**Visualization & portability**
31. As a developer, I want a view-only visualization of the Flow with the active Phase highlighted, so that I can see where I am at a glance.
32. As a maintainer, I want XState isolated behind a `FlowEngine` seam, so that Fil can swap to another state-machine library (even a Python one) later without re-architecting the core.
33. As a developer, I want Fil's core to be model-free, so that there is no provider lock-in.
34. As a team lead, I want Flow files and config committed to git (with Runs/proposals local), so that the whole team follows the same shared, evolving lifecycle.

## Implementation Decisions

**Architecture (ADR-0001 — steer, don't run).** Fil is a sidecar governor, never a parent process and never a model caller. It owns: orchestration (the Flow), durable Run state, Gate verification, and per-Phase configuration. It delegates to the Agent Runtime: the model, the agent loop, context-management, and the execution environment. Enforcement is **tiered** (Tier 0 advisory config + CLI → Tier 1 hook/gate-enforced tool restriction → Tier 2 Fil control surface exposed as the runtime's native tools/commands); the **restrictions strategy is user-owned**.

**Flows & engine (ADR-0002, ADR-0003).** A Flow is serializable engine config (XState config for the default engine); Fil supplies every guard/action/actor implementation via `setup()`, so the Flow contains no inline functions. The `FlowEngine` seam (`load` / `run` / `send` / `getStatus` / `serialize` / `canTransition`) isolates XState in one module; the seam is protocol-shaped for future cross-language engines. Flow files are engine-specific; migrating between engines is the user's responsibility. **Rule: no engine-library imports outside the engine adapter module (and the inspect view).**

**Modules to build.** TypeScript/Node monorepo (pnpm workspaces), MIT license.
- `FlowEngine` (interface) + the default XState implementation — the engine seam.
- `gate-runner` — `runGate(gateSpec, ctx) → Receipt`. Executes shell / test-file / API / human-CLI-prompt gates and captures evidence.
- `run-orchestrator` — `startRun(flow, change) → RunState` and `advance(runState) → RunState'`: evaluate the current Phase's Gate via `gate-runner`, transition via `FlowEngine`, write the Receipt, refresh the projection. Depends on the engine and gate-runner through their interfaces only.
- `store` — repository over `.fil/`: Runs, the `run.json` projection, Flow snapshots, proposals.
- `flow-loader` — resolves Flow files across project/user precedence and load-validates the config.
- `evolution` — `applyProposal(flowCode, patch) → { ok, newCode } | { error: 'load' | 'reachability' }`. Pure validation of proposed Flow patches.
- `contract` — the `.fil/run.json` schema plus serializers/validators; shared with every Adapter.
- CLI — `fil init | start | next | status | propose | approve | back | cancel`; thin wiring over the modules above.
- Pi Adapter (a Pi extension) and Claude Adapter (a Claude plugin), each with an `init` installer step.
- inspect-view — view-only visualizer over `FlowEngine.serialize()` + the active Phase.

**Adapter contract (a specification, not a loaded interface).** Fil and an Adapter communicate through two halves Fil owns:
- the **state contract** Fil writes — `.fil/run.json`, the single source of truth the Adapter reads. Shape (decision-rich contract):
  ```jsonc
  {
    "runId": "...", "change": "...",
    "phase": "Code", "actorMode": "agent",
    "phaseConfig": {
      "instructions": "...",
      "allowedTools": ["read","write","edit","bash"],
      "skills": ["tdd"],
      "context": { "files": ["..."], "notes": "...", "priorResults": ["..."] },
      "gate": { "type": "testsPass" }
    }
  }
  ```
- the **control surface** Fil exposes — the `fil` CLI / API (`start` / `next` / `status` / `propose` / `approve`), identical for every runtime, callable by human and agent.

Each Adapter realizes enforcement in its runtime's native way: Pi via `setActiveTools`, the `tool_call` block, `before_agent_start` prompt injection, `resources_discover` skills, and `registerTool`/`registerCommand` for the control surface; Claude via a `PreToolUse` hook that reads `run.json`, an MCP server exposing the verbs, and per-Phase skills.

**Gates & Receipts.** A Gate is a user-defined executable test; Fil runs it on `fil next` and stores the resulting Receipt (pass/fail + evidence) per Run. Human-gating is expressed as a Gate whose test is a human-confirmation prompt (no separate "trigger" knob).

**Evolution.** Human edits Flow files directly (free, git-committed). The agent proposes edits as code patches written under proposals; `fil approve` validates (loads + reachability) and git-applies. Edits shape future Runs; a running Run is frozen to its snapshot (cancel-and-restart on big revamps; a stranded Run is cancelled).

**Sub-agents & parallelism.** Sub-agents are **not** a Phase-config field — they are nudged via Phase instructions and spawned by the runtime; Fil neither declares nor orchestrates them. Parallel attention is expressed structurally as parallel Phases (engine parallel states).

**Durable layout.** `.fil/flows/` + `.fil/config.json` are committed (the shared recipe); `.fil/runs/`, `.fil/run.json`, `.fil/proposals/` are gitignored (local work-in-progress). Flow versioning is git.

## Testing Decisions

A good test exercises **external behavior through a module's public interface**, not its implementation details. The deep modules below have narrow, stable interfaces and are tested in isolation; the CLI, Adapters, and inspect-view are covered by integration tests.

Greenfield codebase — this PRD establishes the testing pattern (unit tests for deep modules; integration tests for Adapters via the `contract`).

Modules to be unit-tested (all approved):
- **FlowEngine** — tested with a fake in-memory engine; the XState implementation is verified separately. No engine-library coupling in the seam's tests.
- **gate-runner** — pure `gateSpec → Receipt`, including a human-confirmation gate tested against a stubbed prompt.
- **run-orchestrator** — `startRun` / `advance` driven by a fake engine + fake gate-runner, asserting Run-state transitions and projection output.
- **store** — Run/proposal/snapshot persistence and the `run.json` projection, against a tmpdir.
- **flow-loader** — project/user precedence resolution and config load-validation, against a fake filesystem.
- **evolution** (`applyProposal`) — pure: valid patches produce new code; broken patches fail with `load`; patches that strand an active Phase fail with `reachability`.
- **contract** — `run.json` round-trip serialization and validation (shared with Adapters).

## Out of Scope

- Visual **editing** of Flows (MVP is view-only).
- Headless / drive mode (Fil spawning the agent headlessly) — sidecar only.
- Non-XState / cross-language engines (e.g. Python) shipped — the seam is designed for this but none ship in the MVP.
- Multi-user shared Run history (Runs are local/gitignored).
- Adapters beyond Pi and Claude (Cursor, Copilot, Aider — later).
- Dynamic context scripts (static files + notes only).
- Sub-agent orchestration by Fil (nudge via instructions only).
- Automatic migration of Flow files between engines.
- Built-in sandboxing / containers (left to the user's restrictions strategy).

## Further Notes

- **Name:** Fil (French: *thread* — *fil d'Ariane*, the guiding thread through the labyrinth). CLI: `fil`. npm package namespace is TBD (`fil` is likely taken; it will be scoped under an org).
- **Triage:** marked `ready-for-agent`; currently a local file at `docs/prd/` because the repo has no issue tracker yet — to be published to a tracker when one exists.
- **Foundational artifacts:** `CONTEXT.md` (glossary), `docs/OVERVIEW.md` (design synthesis), and ADRs 0001–0003 (steer-don't-run; Flows are XState config; XState isolated behind the `FlowEngine` seam).
- **Key insurance:** the `FlowEngine` seam is what keeps Fil engine-agnostic and cross-language-capable; keep it narrow and protocol-shaped.
- Suggested first vertical slice: `FlowEngine` interface + the XState implementation + `gate-runner` + `store`/`contract`, validated end-to-end through the **Pi Adapter** (Pi's extension model is the fastest path to a working Phase).
