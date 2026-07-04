---
"@color-sunset/fil": minor
"@color-sunset/fil-cli": minor
"@color-sunset/fil-engine": minor
---

`fil inspect` now launches the Stately inspector (`@statelyai/inspect`) — the
ADR-0002 view-only visualizer — in the browser, and advances the Flow manually
(press Enter = next Phase, Ctrl-C to exit). The previous text diagram is kept
as `fil inspect --text` (offline; active Phase highlighted).

- `@color-sunset/fil-engine` exports `inspectFlow()` (+ `InspectFlowOptions`,
  `InspectFlowDeps`, `InspectHandle`) which wires a real XState actor to the
  Stately inspector via a local WebSocket relay. It lives in the engine package
  so it can import `xstate` (ADR-0003), and the `@statelyai/inspect` modules are
  imported lazily so they stay out of the engine's hot path. The stately
  factories are injectable so the actor wiring is unit-tested without a network
  or browser.
- `@color-sunset/fil-cli` resolves the active Run (resumed from its persisted
  snapshot) or the default Flow, then drives the inspector via a testable
  `runInspectLoop`.
