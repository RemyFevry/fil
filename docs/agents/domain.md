# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — the Fil glossary (Harness, Agent Runtime, Adapter, Flow, Run, Change, Project, Phase, Transition, Gate, Receipt).
- **`docs/adr/`** — read ADRs that touch the area you're about to work in. The foundational three are ADR-0001 (steer, don't run), ADR-0002 (engine-native Flow files), ADR-0003 (XState isolated behind the `FlowEngine` seam).
- **`docs/OVERVIEW.md`** — the design synthesis.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront.

## File structure

Single-context repo:

```
/
├── CONTEXT.md
├── docs/
│   ├── OVERVIEW.md
│   ├── adr/
│   │   ├── 0001-steer-dont-run.md
│   │   ├── 0002-flows-are-xstate-code.md
│   │   └── 0003-xstate-isolated-behind-flowengine-seam.md
│   ├── agents/
│   └── prd/
└── (packages — TS/Node pnpm monorepo, per PRD)
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. In particular: say **Phase** (not "state"/"step"/"stage"), **Run** (not "session"), **Change** (not "ticket"/"task"), **Flow** (not "workflow"/"pipeline"), **Gate** (not "check"/"validation"), **Adapter** (not "plugin"), **Agent Runtime** (not "agent" for the whole tool).

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/grill-with-docs`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0003 (XState isolated behind the FlowEngine seam) — but worth reopening because…_

The `FlowEngine` seam is the repo's key insurance: keep XState imports confined to the engine adapter module (and the inspect view). No engine-library coupling outside that boundary.
