import { describe, expect, it, vi } from "vitest";
import { inspectFlow } from "../src/inspect.js";
import {
  builtInFlow,
  createMachine,
  defaultFlowEngine,
} from "../src/index.js";
const defaultFlow = builtInFlow("default");
if (!defaultFlow) throw new Error("default flow missing");

/** Fake relay server + inspector used to exercise inspectFlow off the network. */
function fakes() {
  const server = { stop: () => {} };
  const inspector = { inspect: () => {}, stop: () => {} };
  const createServer = () => server;
  const createInspector = () => inspector;
  return { server, inspector, createServer, createInspector };
}

describe("inspectFlow", () => {
  it("starts an actor at the Flow's initial Phase", async () => {
    const deps = fakes();
    const handle = await inspectFlow(
      { machine: defaultFlow.machine },
      deps,
    );
    try {
      expect(handle.actor.getSnapshot().value).toBe("requirements");
      expect(handle.actor.getSnapshot().status).toBe("active");
    } finally {
      handle.stop();
    }
  });

  it("advances the Flow when the actor receives NEXT", async () => {
    const deps = fakes();
    const handle = await inspectFlow(
      { machine: defaultFlow.machine },
      deps,
    );
    try {
      handle.actor.send({ type: "NEXT" });
      expect(handle.actor.getSnapshot().value).toBe("design");
      handle.actor.send({ type: "NEXT" });
      expect(handle.actor.getSnapshot().value).toBe("code");
    } finally {
      handle.stop();
    }
  });

  it("restores from a persisted snapshot when one is supplied", async () => {
    const machine = createMachine(
      defaultFlow.rawConfig as Parameters<typeof createMachine>[0],
    );
    // Build the durable snapshot the same way the orchestrator does: via the
    // engine API (initial -> send NEXT twice lands at "code"). This is the
    // exact restored-snapshot path `fil inspect` uses for an active Run.
    const loaded = defaultFlowEngine.load("default", machine);
    if (!loaded.ok) throw new Error(loaded.error);
    let snap = loaded.instance.initial(); // requirements
    snap = loaded.instance.send(snap, "NEXT"); // design
    snap = loaded.instance.send(snap, "NEXT"); // code

    const deps = fakes();
    const handle = await inspectFlow(
      { machine, snapshot: snap },
      deps,
    );
    try {
      expect(handle.actor.getSnapshot().value).toBe("code");
    } finally {
      handle.stop();
    }
  });

  it("stop() tears the session down without throwing", async () => {
    const deps = fakes();
    const handle = await inspectFlow(
      { machine: defaultFlow.machine },
      deps,
    );
    expect(() => handle.stop()).not.toThrow();
    // idempotent
    expect(() => handle.stop()).not.toThrow();
  });

  it("forwards options to the injected server + inspector factories", async () => {
    const serverOpts: { port?: number; url?: string; autoOpen?: boolean }[] = [];
    const inspectorOpts: { url: string }[] = [];
    const deps = {
      createServer: (opts: { port?: number; url?: string; autoOpen?: boolean }) => {
        serverOpts.push(opts);
        return { stop: () => {} };
      },
      createInspector: (opts: { url: string }) => {
        inspectorOpts.push(opts);
        return { inspect: () => {}, stop: () => {} };
      },
    };
    const handle = await inspectFlow(
      { machine: defaultFlow.machine, port: 1234, url: "https://example.test/inspect", autoOpen: false },
      deps,
    );
    handle.stop();
    expect(serverOpts).toEqual([
      { port: 1234, url: "https://example.test/inspect", autoOpen: false },
    ]);
    // The WebSocket client connects to the local relay, not the inspector UI.
    expect(inspectorOpts).toEqual([{ url: "ws://localhost:1234" }]);
  });

  it("stops the server when createInspector rejects (partial-init cleanup)", async () => {
    let serverStopped = 0;
    const deps = {
      createServer: () => ({ stop: () => { serverStopped += 1; } }),
      createInspector: () => Promise.reject(new Error("ws boom")),
    };
    await expect(
      inspectFlow({ machine: defaultFlow.machine }, deps),
    ).rejects.toThrow("ws boom");
    expect(serverStopped).toBe(1);
  });

  it("stops server + inspector when createActor throws (partial-init cleanup)", async () => {
    let serverStopped = 0;
    let inspectorStopped = 0;
    vi.doMock("xstate", async () => {
      const actual = await vi.importActual<typeof import("xstate")>("xstate");
      return {
        ...actual,
        createActor: () => { throw new Error("actor boom"); },
      };
    });
    vi.resetModules();
    const { inspectFlow: mockedInspectFlow } = await import("../src/inspect.js");
    try {
      const deps = {
        createServer: () => ({ stop: () => { serverStopped += 1; } }),
        createInspector: () => ({ inspect: () => {}, stop: () => { inspectorStopped += 1; } }),
      };
      await expect(
        mockedInspectFlow({ machine: defaultFlow.machine }, deps),
      ).rejects.toThrow("actor boom");
      expect(serverStopped).toBe(1);
      expect(inspectorStopped).toBe(1);
    } finally {
      vi.doUnmock("xstate");
      vi.resetModules();
    }
  });

  it("exercises the default lazy-import factories with vi.mock (no network)", async () => {
    const serverOpts: unknown[] = [];
    const inspectorOpts: unknown[] = [];
    const server = { stop: vi.fn() };
    const inspector = { inspect: vi.fn(), stop: vi.fn() };
    vi.doMock("@statelyai/inspect/server", () => ({
      createInspectorServer: (opts: unknown) => { serverOpts.push(opts); return server; },
    }));
    vi.doMock("@statelyai/inspect", () => ({
      createWebSocketInspector: (opts: unknown) => { inspectorOpts.push(opts); return inspector; },
    }));
    vi.resetModules();
    const { inspectFlow: mockedInspectFlow } = await import("../src/inspect.js");
    try {
      const handle = await mockedInspectFlow({
        machine: defaultFlow.machine, port: 4567, autoOpen: false,
      });
      expect(handle.actor.getSnapshot().value).toBe("requirements");
      expect(serverOpts).toEqual([{ port: 4567, url: "https://stately.ai/inspect", autoOpen: false }]);
      expect(inspectorOpts).toEqual([{ url: "ws://localhost:4567" }]);
      handle.stop();
    } finally {
      vi.doUnmock("@statelyai/inspect/server");
      vi.doUnmock("@statelyai/inspect");
      vi.resetModules();
    }
  });
});
