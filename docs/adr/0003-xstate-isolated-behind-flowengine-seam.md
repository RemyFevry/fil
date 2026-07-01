# XState is the default engine, behind a cross-language FlowEngine seam

## Context

ADR-0002 chose engine-native Flow files, with XState as the v1 default engine. Fil must not hard-lock to that choice — a license change, deprecation, or a better library could warrant swapping, including to a different runtime (e.g. `python-statemachine`, which is Python).

## Decision

fil-core talks to a **`FlowEngine` seam** (`load` / `run` / `send` / `getStatus` / `serialize` / `inspect`), **never to XState directly**. **XState is the default `FlowEngine` implementation** (in-process, TypeScript). The seam is **designed to be expressible as a cross-language protocol** (stdio JSON-RPC, MCP/LSP-style), so a future engine can be a **subprocess in any language** (e.g. a Python service running `python-statemachine`).

**Flow files are engine-specific code/config, by design** — XState config (JSON) for the XState engine; `python-statemachine` code for a Python engine. There is **no single neutral Flow format**. **Swapping engines is the user's responsibility:** they rewrite/migrate the Flow files for the new engine. Old Flow files are not expected to work on a new engine.

## Why

- **Genuine cross-language portability at the core**: Fil's logic (gate-runner, Adapters, durable Run state, CLI, Flow evolution) is engine- and language-agnostic; only the engine + Flow files change on a swap.
- **Accepts reality**: state-machine libraries are code with idiosyncratic formats; auto-migrating between them is explicitly not a goal.

## Scope & trade-off

- **v1 ships the XState engine in-process** (TypeScript). No IPC in v1.
- The `FlowEngine` interface is kept narrow and protocol-shaped so a subprocess engine (any language) can implement it later without re-architecting fil-core.
- Cost: one indirection layer. Accepted as the price of cross-language independence.

## Consequence

Rule: **no XState imports outside the `XStateFlowEngine` module (and the inspect view).** Everything else talks to `FlowEngine`.
