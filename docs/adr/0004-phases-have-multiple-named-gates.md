# A Phase has multiple named gates, AND-aggregated

## Context

ADR-0002/0003 establish a Phase carries a single exit Gate (`gate: GateSpec`),
run on `fil next`, producing one Receipt. Harness engineering needs several
independent checks before a Phase may advance (lint, typecheck, tests, build),
each with its own pass/fail and artifact. Cramming them into one shell gate
yields one coarse Receipt that short-circuits and hides which check failed.

## Decision

A Phase has **`gates: NamedGate[]`**, where `NamedGate = { name: string } & GateSpec`.
Names are **required and unique within a Phase** (enforced at schema parse). On
`fil next`, the orchestrator runs **every gate of every active Phase**, producing
**one Receipt per gate**, and advances only when **all pass (AND)** — running all
and reporting every failure (no short-circuit, mirroring the existing
parallel-Phase semantics). `Receipt` gains `gateName`, so `phase` + `gateName`
uniquely identifies an outcome.

This is a **clean break**: the old singular `gate: {…}` shape is removed (no
dual-read compat shim). A Flow still using `gate:{}` fails to load with a
message pointing to `fil init` (re-scaffold) or the manual rename
`gate:{…}` → `gates:[{name, type, …}]`.

## Why

- Per-check Receipt granularity — the audit trail names each check and its
  evidence separately, instead of one opaque shell script.
- AND + run-all-report-all matches the existing parallel-Phase behaviour and
  surfaces every failure, not just the first.
- Names give stable addressing for the CLI gate verbs (`add-gate`/`remove-gate`/
  `set-gate`) and for Receipt attribution.
- `gate-runner` stays unchanged in *logic* — it still runs one gate at a time.
  Its signature widens from `GateSpec` to `NamedGate` so it can stamp the name
  onto the Receipt; naming is a PhaseConfig concern, not a gate-execution one.

## Trade-off accepted

A singular gate was simpler. Multiple gates add array cardinality + a name + a
uniqueness constraint across the contract, orchestrator, renderers, built-in
Flows, and tests. Accepted: the per-check Receipt trail is the harness value.
No backward-compat shim — the project is early; `fil init` re-scaffolds
canonical files.

## Consequence

- `PhaseConfig.gate: GateSpec` → `PhaseConfig.gates: NamedGate[]`; `Receipt`
  gains `gateName`.
- `gate-runner.runGate` takes a `NamedGate`; `orchestrator.advance` loops gates
  (AND, run-all-report-all).
- Built-in `default`/`hotfix` configs, renderers (`inspect-view`, `fil start`/
  `status`, `pi-adapter`), and tests migrate to `gates[]`.
- `fil init` writes canonical `gates[]`; old `gate:{}` files fail load with a
  migration hint.
