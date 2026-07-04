---
"@color-sunset/fil-contract": minor
"@color-sunset/fil-gate-runner": minor
"@color-sunset/fil-engine": minor
"@color-sunset/fil-orchestrator": patch
"@color-sunset/fil-inspect-view": patch
"@color-sunset/fil-cli": minor
"@color-sunset/fil-pi-adapter": patch
"@color-sunset/fil": minor
---

A Phase now has multiple named gates (ADR-0004), AND-aggregated.

- **Breaking:** `PhaseConfig.gate: GateSpec` → `PhaseConfig.gates: NamedGate[]` (names required + unique per Phase). `Receipt` gains `gateName`. `gate-runner.runGate` now takes a `NamedGate` so it can stamp the name onto the Receipt.
- `fil next` runs every gate of every active Phase; all must pass (AND) to advance, and every failure is reported (no short-circuit — mirroring parallel-Phase semantics). Each gate produces its own Receipt, giving per-check audit granularity (e.g. lint, typecheck, tests, build as separate gates instead of one opaque shell script).
- Built-in `default`/`hotfix` flows, the CLI / inspect-view / pi-adapter renderers, and all tests migrate to `gates[]`.
- **Migration:** a Flow still using the old singular `gate:{...}` fails to load with a hint to re-run `fil init` or rename `gate:{...}` → `gates:[{name, type, ...}]`. No backward-compat shim (early project).
