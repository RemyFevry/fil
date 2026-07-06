import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer, mcpToolNames, shapeFor, runServer } from "../src/server.js";
import { FIL_VERB_TOOLS, type VerbRunner } from "@color-sunset/fil-pi-adapter";

/** Connect an in-memory client to a server and return the client. */
async function linkClient(server: McpServer): Promise<Client> {
  const [clientTrans, serverTrans] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  // Connect both concurrently — awaiting one before the other deadlocks the
  // handshake (each connect waits for the peer's response).
  await Promise.all([client.connect(clientTrans), server.connect(serverTrans)]);
  return client;
}

function recordingRunner(log: string[][]): VerbRunner {
  return (argv) => {
    log.push(argv);
    return { exitCode: 0, stdout: `ran ${argv.join(" ")}`, stderr: "" };
  };
}

describe("Fil MCP server — tool surface (in-memory client + stub runner)", () => {
  it("exposes the five Fil control verbs", async () => {
    const server = createServer({ cwd: "/p", runner: recordingRunner([]) });
    const client = await linkClient(server);
    const listed = await client.listTools();
    const names = (listed.tools ?? []).map((t) => t.name).sort();
    expect(names).toEqual([...mcpToolNames()].sort());
    await client.close();
  });

  it("fil_next calls the runner with ['next'] and returns its output", async () => {
    const calls: string[][] = [];
    const server = createServer({ cwd: "/p", runner: recordingRunner(calls) });
    const client = await linkClient(server);
    const res = (await client.callTool({ name: "fil_next", arguments: {} })) as {
      content?: { type: string; text: string }[];
      isError?: boolean;
    };
    expect(calls).toEqual([["next"]]);
    expect(res.content?.[0]?.text).toContain("ran next");
    expect(res.isError).toBeFalsy();
    await client.close();
  });

  it("fil_start maps args to the CLI argv (change positional + --flow)", async () => {
    const calls: string[][] = [];
    const server = createServer({ cwd: "/p", runner: recordingRunner(calls) });
    const client = await linkClient(server);
    await client.callTool({ name: "fil_start", arguments: { change: "add-login", flow: "demo" } });
    expect(calls).toEqual([["start", "add-login", "--flow", "demo"]]);
    await client.close();
  });

  it("flags a non-zero exit as an MCP error result", async () => {
    const runner: VerbRunner = () => ({ exitCode: 1, stdout: "", stderr: "boom" });
    const server = createServer({ cwd: "/p", runner });
    const client = await linkClient(server);
    const res = (await client.callTool({ name: "fil_status", arguments: {} })) as {
      content?: { text: string }[];
      isError?: boolean;
    };
    expect(res.isError).toBe(true);
    expect(res.content?.[0]?.text).toContain("boom");
    await client.close();
  });
});

describe("shapeFor — MCP input schema", () => {
  it("marks required params required and optional params optional", () => {
    const start = FIL_VERB_TOOLS.find((t) => t.toolName === "fil_start")!;
    const shape = shapeFor(start);
    expect(shape["change"]?.isOptional()).toBe(false);
    expect(shape["flow"]?.isOptional()).toBe(true);
  });

  it("a parameterless verb yields an empty shape", () => {
    const next = FIL_VERB_TOOLS.find((t) => t.toolName === "fil_next")!;
    expect(Object.keys(shapeFor(next))).toEqual([]);
  });
});

describe("createServer / runServer — defaults + connect", () => {
  it("createServer() with no deps still exposes the verbs (covers default cwd/runner branches)", async () => {
    const server = createServer();
    const [clientTrans, serverTrans] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([client.connect(clientTrans), server.connect(serverTrans)]);
    const listed = await client.listTools();
    expect((listed.tools ?? []).map((t) => t.name).sort()).toEqual([...mcpToolNames()].sort());
    await client.close();
  });

  it("runServer connects the server to an injected transport (the bin's connect path)", async () => {
    const [clientTrans, serverTrans] = InMemoryTransport.createLinkedPair();
    const noopRunner: VerbRunner = () => ({ exitCode: 0, stdout: "ok", stderr: "" });
    const server = await runServer({ cwd: "/p", runner: noopRunner }, serverTrans);
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(clientTrans);
    const res = (await client.callTool({ name: "fil_next", arguments: {} })) as {
      content?: { text: string }[];
    };
    expect(res.content?.[0]?.text).toBe("ok");
    await client.close();
    await server.close();
  });
});
