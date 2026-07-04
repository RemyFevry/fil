import { createActor, type AnyActor } from "xstate";
import type { AnyStateMachine } from "xstate";
import type { EngineSnapshot, FlowDefinition } from "./seam.js";

/**
 * Stately inspector integration for Fil Flows (ADR-0002: view-only visualizer
 * is `@statelyai/inspect`).
 *
 * Lives inside the engine package because ADR-0003 forbids `xstate` imports
 * outside the engine adapter: the inspector needs a real XState actor
 * (`createActor`), and only the engine module is allowed to import `xstate`.
 * The neutral `FlowEngine` seam is untouched — callers hand in an
 * already-resolved Flow machine (the same `FlowDefinition` the engine loads).
 *
 * The heavy `@statelyai/inspect` modules are imported **lazily** (only when an
 * inspect actually runs), so they stay out of the engine's hot path.
 *
 * The stately factories are injectable (`InspectFlowDeps`) so the unit test can
 * exercise the actor wiring without binding a port or opening a browser.
 */

/** Options for {@link inspectFlow}. */
export interface InspectFlowOptions {
  /** A loaded Flow machine (the same value handed to `FlowEngine.load`). */
  machine: FlowDefinition;
  /** Restore the actor at this persisted snapshot (e.g. an active Run's position). */
  snapshot?: EngineSnapshot;
  /** Port for the local relay server. Default `8080`. */
  port?: number;
  /** Stately inspector UI URL the relay opens. Default `https://stately.ai/inspect`. */
  url?: string;
  /** Open the inspector in the default browser automatically. Default `true`. */
  autoOpen?: boolean;
}

/** A running inspect session. */
export interface InspectHandle {
  /** The XState actor for the Flow — send `NEXT` to advance, `getSnapshot()` to read position. */
  actor: AnyActor;
  /** Stop the actor and tear down the relay server. */
  stop(): void;
}

/** Injectable seams over `@statelyai/inspect` (tests pass fakes to avoid the network). */
export interface InspectFlowDeps {
  /** Default: lazily imported `createInspectorServer` from `@statelyai/inspect/server`. */
  createServer?: (opts: {
    port?: number;
    url?: string;
    autoOpen?: boolean;
  }) => Promise<{ stop(): void }> | { stop(): void };
  /** Default: lazily imported `createWebSocketInspector` from `@statelyai/inspect`. */
  createInspector?: (opts: {
    url: string;
  }) => Promise<{ inspect: unknown; stop?: () => void }> | {
    inspect: unknown;
    stop?: () => void;
  };
}

/**
 * Launch the Stately inspector for a Flow and return a running actor handle.
 *
 * Starts a local WebSocket relay (opens `https://stately.ai/inspect` in the
 * browser by default), connects an inspector, and starts an XState actor for
 * the Flow wired to that inspector. Non-blocking — the caller owns the run loop
 * (e.g. advancing phases on stdin) and must call `handle.stop()` on exit.
 */
export async function inspectFlow(
  options: InspectFlowOptions,
  deps: InspectFlowDeps = {},
): Promise<InspectHandle> {
  const port = options.port ?? 8080;
  const url = options.url ?? "https://stately.ai/inspect";
  const autoOpen = options.autoOpen ?? true;
  const wsUrl = `ws://localhost:${port}`;

  const createServer: NonNullable<InspectFlowDeps["createServer"]> =
    deps.createServer ??
    (async (opts) => {
      const { createInspectorServer } = await import("@statelyai/inspect/server");
      return createInspectorServer(opts);
    });
  const createInspector: NonNullable<InspectFlowDeps["createInspector"]> =
    deps.createInspector ??
    (async (opts) => {
      const { createWebSocketInspector } = await import("@statelyai/inspect");
      return createWebSocketInspector(opts);
    });

  const server = await createServer({ port, url, autoOpen });
  const inspector = await createInspector({ url: wsUrl });

  const actor = createActor(options.machine as AnyStateMachine, {
    inspect: inspector.inspect as never,
    snapshot: options.snapshot as never,
  });
  actor.start();

  // Idempotent teardown: the CLI may call stop() from both the normal exit
  // path and the SIGINT handler.
  let stopped = false;
  return {
    actor,
    stop: () => {
      if (stopped) return;
      stopped = true;
      actor.stop();
      inspector.stop?.();
      server.stop();
    },
  };
}
