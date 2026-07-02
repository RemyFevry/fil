---
"@fil/mcp-server": minor
---

Add the **Fil MCP server** (`@fil/mcp-server`), closing #17.

- Exposes Fil's control verbs (`fil_start`/`fil_next`/`fil_status`/`fil_propose`/`fil_approve`) as MCP tools, so an MCP client (e.g. Claude Code) can drive Fil's lifecycle. The verbs are *thin callers* over the `fil` CLI — behaviour is identical because they invoke the same binary; the verb set + arg mapping are reused from the shared control surface (`@fil/pi-adapter`), keeping the Pi and MCP control surfaces in lockstep.
- `createServer(deps)` builds the `McpServer`; each tool's handler runs the matching `fil <verb>` in the project `cwd` and returns the output (non-zero exit → MCP error result). `fil-mcp` bin runs the server over stdio (`StdioServerTransport`).
- Tests: in-memory client + stub runner (tool list, argv mapping, error flagging, input-schema shapes); integration driving the **real `fil`** over an in-memory MCP client (`fil_start` + `fil_next` advance the Run; `fil_status` reports the Phase).

Stacked on #15 (reuses its control surface and the `fil`-bin `isMain` fix). Retarget to `main` after #15 merges.
