# Flows are XState code; reuse XState, don't reinvent

## Context

Fil needs a format for Flows. Two options: a custom declarative schema (e.g. JSONC) that Fil compiles *to* an XState machine at runtime, or author Flows *directly as* XState machine code.

## Decision

**Flows are XState machine code** (`createMachine` / `setup`). Fil is a thin **host** over XState: it provides the implementations XState needs via `setup()` — **guards** that run the user's Gate scripts, **actions** that sync `.fil/run.json` and write receipts, **invoked actors** that drive the active Adapter — and layers SDLC semantics, durable Run records, the Adapter system, the gate-runner, and the CLI on top.

Fil does **not** reimplement: state machines, states, transitions, guards, actors, inspection/visualization, or versioning. Flow versioning is **git** (Flows are committed code).

## Why

- Reuses a mature, shipped library instead of maintaining a parallel schema + compiler.
- Aligns with the Stately/XState tooling ecosystem — `@statelyai/inspect` for the (view-only) visualizer, and Stately's editor tooling for any future visual editing.
- Keeps Fil's surface minimal and honest: Fil's value is the SDLC / Adapter / durability layer, not a state-machine reimplementation.

## Mapping (Fil term → XState primitive)

| Fil | XState |
|---|---|
| Phase | state node |
| Transition | transition |
| Gate | guard (extended: produces a receipt, may bundle human approval) |
| Parallel Phases | parallel states |
| Run working state | machine context |

Sub-agents are **not** Fil-invoked actors (Fil runs no agents). They are nudged via Phase instructions and spawned by the Agent Runtime's native capability; Fil neither declares nor orchestrates them. Parallel attention is expressed structurally as parallel Phases (XState parallel states).

## Trade-off accepted

Authoring Flows as code (not a custom schema) means a future visual *editor* must lean on Stately/XState tooling rather than a lossless editor over a bespoke schema. Accepted: the MVP visualizer is view-only, and round-trip editing is a later concern.

## Consequence

When designing any Fil feature, first ask "does XState already ship this?" — reuse it. Fil only adds what XState lacks: SDLC/Phase semantics, per-Phase harness configuration, Adapters, durable Run history + receipts, the gate-runner, Flow evolution, and the CLI.
