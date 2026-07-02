#!/usr/bin/env node
// The `fil-mcp` bin: runs the Fil MCP server over stdio, so an MCP client
// (e.g. Claude Code via `claude mcp add fil -- node path/to/fil-mcp`) can drive
// Fil's control verbs as tools. The connect logic lives in `runServer` so it is
// covered by tests; this is a thin top-level-await entry.
import { runServer } from "./server.js";

await runServer();
