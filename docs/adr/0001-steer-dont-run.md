# Fil steers existing Agent Runtimes; it does not run its own

## Context

Fil is an SDLC orchestration harness. To do actual coding work it needs an agent (model + loop + execution environment). There were two paths: build and run Fil's own agent loop against a model, or steer existing Agent Runtimes (Claude Code, Pi, Copilot, Cursor, Aider).

## Decision

Fil **never runs a model or an agent loop**. It owns only the spine — the XState Flow, durable state, Gate verification, and the per-Phase configuration — and **disciplines external Agent Runtimes** to do the work. Fil runs as a **sidecar governor**, not a parent process: the human keeps using their agent's native UX, while Fil shapes that agent to the current Phase.

Synchronization is via a **state file Fil authors** (`.fil/run.json`) that the active Adapter reads; enforcement is **tiered** (Tier 0 advisory config + CLI → Tier 1 hook/gate-enforced tool restriction → Tier 2 Fil control surface exposed as the runtime's native tools/commands), and **the restrictions strategy is user-owned** — Fil offers mechanisms (advisory, hooks, sandbox, container); it imposes no security model.

## Why

- **Doesn't fight a losing battle.** Frontier agent tools (Claude Code, Cursor) move fast and own the model+loop+UX. Competing means rebuilding all of it, forever behind.
- **Tool-agnostic by construction.** One Fil, any runtime the user already loves — which is the whole pitch.
- **Model-free core.** No model calls inside Fil → maximally open-source-pure, no provider lock-in, works on a laptop or with frontier APIs.

## Considered options (rejected)

- **Own agent runtime (full control).** Rebuilds what Claude Code / Pi already provide, forces a model choice onto the user, and fights the interactive TUI UX that is those tools' main value. Full control wasn't worth duplicating the ecosystem.
- **Parent-process driving** (Fil spawns the agent headlessly per Phase). Doesn't fit interactive/collaborative Phases where the human is in the agent's TUI; lower friction to let the human keep their native surface and govern from the side.

## Consequences

- Fil's value lives in the **Flow + Gates + durable state + the Adapter specification**, not in an agent loop.
- Each supported Agent Runtime needs a maintained **Adapter** that tracks that tool's evolving extension points — a real ongoing cost, accepted in exchange for leverage.
- An agent can in principle escape advisory (Tier 0) constraints; stronger containment (sandbox/container) is the user's call, not Fil's default.
