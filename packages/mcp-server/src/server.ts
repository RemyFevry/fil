import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";
import {
  FIL_VERB_TOOLS,
  runFilVerb,
  formatVerbResult,
  defaultRunner,
  type FilVerbTool,
  type VerbRunner,
} from "@fil/pi-adapter";

/**
 * The Fil MCP server — exposes Fil's control verbs as MCP tools.
 *
 * The verbs are *thin callers* over the `fil` CLI (ADR-0001): each tool's handler
 * invokes the matching `fil <verb>` and returns its output, so behaviour is
 * identical to the CLI. The verb set + arg mapping come from the shared control
 * surface (`@fil/pi-adapter`'s `control-surface`), keeping the two control
 * surfaces (Pi tools, MCP tools) in lockstep.
 */

export interface ServerDeps {
  /** Project root the verbs operate on. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Override the runner (tests). Defaults to the real `fil` shell-out. */
  runner?: VerbRunner;
}

/** Build the MCP server that exposes the Fil control verbs. */
export function createServer(deps: ServerDeps = {}): McpServer {
  const cwd = deps.cwd ?? process.cwd();
  const runner = deps.runner ?? defaultRunner;
  const server = new McpServer({ name: "fil", version: "0.0.0" });

  for (const tool of FIL_VERB_TOOLS) {
    server.registerTool(
      tool.toolName,
      { description: tool.description, inputSchema: shapeFor(tool) },
      async (args) => {
        const result = runFilVerb(
          tool,
          (args ?? {}) as Record<string, unknown>,
          { cwd, runner },
        );
        return {
          content: [{ type: "text" as const, text: formatVerbResult(result) }],
          isError: result.exitCode !== 0,
        };
      },
    );
  }
  return server;
}

/** Build the zod input shape for a verb tool (required/optional strings). Pure. */
export function shapeFor(tool: FilVerbTool): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const p of tool.params) {
    shape[p.name] = p.required ? z.string() : z.string().optional();
  }
  return shape;
}

/** The tool names the server exposes, in a stable order. */
export function mcpToolNames(): readonly string[] {
  return FIL_VERB_TOOLS.map((t) => t.toolName);
}

/**
 * Build the server and connect it to a transport. Defaults to the stdio
 * transport (what the `fil-mcp` bin and Claude Code use); tests inject an
 * in-memory transport. Keeping this out of `bin.ts` lets the connect path be
 * covered by tests (bin.ts is a top-level-await shim).
 */
export async function runServer(
  deps: ServerDeps = {},
  transport: Transport = new StdioServerTransport(),
): Promise<McpServer> {
  const server = createServer(deps);
  await server.connect(transport);
  return server;
}
