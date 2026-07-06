import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { defaultRunner } from "@color-sunset/fil-pi-adapter";

/**
 * Integration: the MCP verbs behave identically to the CLI. Drives the real
 * `fil` binary over an in-memory MCP client. Requires the CLI built (CI runs
 * `build` before `test`).
 */

const FIL_BIN = resolve(dirname(fileURLToPath(import.meta.url)), "../../cli/dist/index.js");
const CLI_BUILT = existsSync(FIL_BIN);

const DEMO_FLOW = `import { createMachine } from "@color-sunset/fil-engine";
export default createMachine({
  id: "demo", initial: "a", context: {},
  states: {
    a: { meta: { phase: { instructions: "Phase A", allowedTools: [], skills: [], context: { files: [], priorResults: [] }, actorMode: "agent", gates: [{ name: "noop", type: "shell", script: "true" }] } }, on: { NEXT: "done" } },
    done: { type: "final", meta: { phase: { instructions: "Done", allowedTools: [], skills: [], context: { files: [], priorResults: [] }, actorMode: "human", gates: [{ name: "noop", type: "shell", script: "true" }] } } },
  },
});
`;

let workdir: string;
let originalFilBin: string | undefined;

beforeAll(async () => {
  originalFilBin = process.env.FIL_BIN;
  process.env.FIL_BIN = FIL_BIN;
  workdir = await mkdtemp(join(tmpdir(), "fil-mcp-integration-"));
});
afterAll(async () => {
  if (originalFilBin === undefined) {
    delete process.env.FIL_BIN;
  } else {
    process.env.FIL_BIN = originalFilBin;
  }
  await rm(workdir, { recursive: true, force: true });
});
beforeEach(async () => {
  await rm(join(workdir, "proj"), { recursive: true, force: true });
});

async function freshProject(): Promise<string> {
  const proj = join(workdir, "proj");
  await mkdir(join(proj, ".fil", "flows"), { recursive: true });
  const initResult = defaultRunner(["init"], { cwd: proj });
  if (initResult.exitCode !== 0) {
    throw new Error(`fil init failed: ${initResult.stderr || initResult.stdout}`);
  }
  await writeFile(join(proj, ".fil", "flows", "demo.js"), DEMO_FLOW, "utf8");
  return proj;
}

async function readPhase(proj: string): Promise<string> {
  const raw = await readFile(join(proj, ".fil", "run.json"), "utf8");
  return (JSON.parse(raw) as { phase: string }).phase;
}

async function link(server: ReturnType<typeof createServer>): Promise<Client> {
  const [clientTrans, serverTrans] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  // Connect both concurrently — awaiting one before the other deadlocks the handshake.
  await Promise.all([client.connect(clientTrans), server.connect(serverTrans)]);
  return client;
}

describe("Fil MCP server — verbs over MCP behave as the CLI (real fil)", () => {
  it.skipIf(!CLI_BUILT)("fil_start then fil_next over MCP advance the Run (acceptance: fil next over MCP)", async () => {
    const proj = await freshProject();
    const client = await link(createServer({ cwd: proj }));
    try {
      const start = (await client.callTool({
        name: "fil_start",
        arguments: { change: "add-login", flow: "demo" },
      })) as { isError?: boolean };
      expect(start.isError).toBeFalsy();
      expect(await readPhase(proj)).toBe("a");

      const next = (await client.callTool({ name: "fil_next", arguments: {} })) as {
        content?: { text: string }[];
        isError?: boolean;
      };
      expect(next.isError).toBeFalsy();
      expect(next.content?.[0]?.text).toContain("complete");
      expect(await readPhase(proj)).toBe("done");
    } finally {
      await client.close();
    }
  });

  it.skipIf(!CLI_BUILT)("fil_status over MCP reports the active Phase", async () => {
    const proj = await freshProject();
    const client = await link(createServer({ cwd: proj }));
    try {
      await client.callTool({ name: "fil_start", arguments: { change: "add-login", flow: "demo" } });
      const res = (await client.callTool({ name: "fil_status", arguments: {} })) as {
        content?: { text: string }[];
      };
      expect(res.content?.[0]?.text).toContain("Phase");
      expect(res.content?.[0]?.text).toContain("a");
    } finally {
      await client.close();
    }
  });
});
