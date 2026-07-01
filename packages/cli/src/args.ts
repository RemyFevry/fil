export interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean | null>;
}

/**
 * Minimal argv parser: `fil <verb> <positional...> [--flag value | --flag]`.
 *
 * `null` represents a flag that was supplied without a value (bare `--flag`).
 * Callers that *require* a value should use {@link requireFlag} so they fail
 * fast instead of silently falling back to a default.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean | null> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = null;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

/** Read an optional flag value (`--flag value` only). */
export function flag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name];
  return typeof value === "string" ? value : undefined;
}

/** Read a required flag value. Rejects bare `--flag` (valueless) and absent flags. */
export function requireFlag(args: ParsedArgs, name: string): string {
  const value = args.flags[name];
  if (typeof value !== "string") {
    if (value === undefined) {
      throw new Error(`Missing required flag --${name}.`);
    }
    throw new Error(`Flag --${name} requires a value.`);
  }
  return value;
}
