#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

/**
 * The `fil-mcp` bin: runs the Fil MCP server over stdio, so an MCP client
 * (e.g. Claude Code via `claude mcp add fil -- node path/to/fil-mcp`) can drive
 * Fil's control verbs as tools.
 */
async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`fil-mcp: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
