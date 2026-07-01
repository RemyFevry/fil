#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { defaultContext } from "./context.js";
import { parseArgs } from "./args.js";
import { initCommand } from "./commands/init.js";
import { startCommand } from "./commands/start.js";
import { nextCommand } from "./commands/next.js";
import { statusCommand } from "./commands/status.js";
import { backCommand, cancelCommand } from "./commands/back-cancel.js";
import { proposeCommand } from "./commands/propose.js";
import { approveCommand } from "./commands/approve.js";
import { inspectCommand } from "./commands/inspect.js";

const USAGE = `\
fil — an open-source harness for agentic software-development lifecycles.

Usage:
  fil init                              Scaffold the .fil/ layout
  fil start <change> [--flow <name>]    Start a Run bound to a Change
  fil next                              Run the current Phase's Gate and advance
  fil status                            Show the current Phase and Gate
  fil back                              Retreat one Phase
  fil cancel                            Cancel the active Run
  fil propose <flow> <file>             Propose a Flow edit (not applied)
  fil approve <id> [--flow <name>]      Validate and apply a proposal
  fil inspect                           View the Flow (active Phase highlighted)
`;

type CommandFn = (ctx: ReturnType<typeof defaultContext>, args: ParsedArgsLike) => unknown;

interface ParsedArgsLike {
  positional: string[];
  flags: Record<string, string | boolean | null>;
}

const commands: Record<string, CommandFn> = {
  init: (ctx) => initCommand(ctx),
  start: (ctx, args) => startCommand(ctx, args),
  next: (ctx) => nextCommand(ctx),
  status: (ctx) => statusCommand(ctx),
  back: (ctx) => backCommand(ctx),
  cancel: (ctx) => cancelCommand(ctx),
  propose: (ctx, args) => proposeCommand(ctx, args),
  approve: (ctx, args) => approveCommand(ctx, args),
  inspect: (ctx) => inspectCommand(ctx),
};

export async function run(argv: string[], cwd = process.cwd()): Promise<number> {
  const [verb, ...rest] = argv;
  if (!verb || verb === "help" || verb === "--help" || verb === "-h") {
    process.stdout.write(USAGE);
    return 0;
  }
  if (verb === "--version" || verb === "-v") {
    process.stdout.write("fil 0.0.0\n");
    return 0;
  }

  const fn = commands[verb];
  if (!fn) {
    process.stderr.write(`Unknown command: ${verb}\n\n${USAGE}`);
    return 2;
  }

  const ctx = defaultContext(cwd);
  const args = parseArgs(rest);
  try {
    const code = await fn(ctx, args);
    return typeof code === "number" ? code : 0;
  } catch (err) {
    ctx.out.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

// Execute only when invoked directly as the `fil` bin.
// Compare paths after normalizing both sides (Windows uses `\`, POSIX uses `/`).
const isMain = (() => {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  let entry: string;
  try {
    entry = fileURLToPath(pathToFileURL(resolve(argv1)).href);
  } catch {
    return false;
  }
  return (
    entry.endsWith(`${resolve("packages/cli/dist/index.js")}`) ||
    entry.endsWith(`${resolve("packages/cli/src/index.ts")}`)
  );
})();

if (isMain) {
  const filtered = process.argv.slice(2).filter((a) => a !== "--");
  const code = await run(filtered);
  process.exit(code);
}
