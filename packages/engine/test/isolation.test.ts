import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(import.meta.url);
const repoRoot = join(dirname(here), "../../..");
const packagesDir = join(repoRoot, "packages");

/** Recursively collect .ts source files (excluding tests, dist, defs). */
function listTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      listTsFiles(full, acc);
    } else if (entry.endsWith(".ts")) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * ADR-0003: no engine-library imports outside the engine adapter modules.
 * `xstate-engine.ts` and `create-machine.ts` may depend on the xstate
 * package — they ARE the engine's adapter surface. `create-machine.ts`
 * is the Fil Flow author-facing wrapper around `createMachine`; without
 * it Flow files would have to import xstate directly, breaking ADR-0003
 * at a higher level. `inspect.ts` wires the Stately inspector
 * (`@statelyai/inspect`) to a real XState actor; the inspector needs
 * `createActor`, so it lives here alongside the other xstate adapters.
 */
describe("engine isolation (ADR-0003)", () => {
  it("imports the xstate package only from the engine adapter modules", () => {
    const offenders: string[] = [];
    const allowed = new Set([
      "packages/engine/src/xstate-engine.ts",
      "packages/engine/src/flows/create-machine.ts",
      "packages/engine/src/inspect.ts",
    ]);
    for (const file of listTsFiles(packagesDir)) {
      const rel = relative(repoRoot, file).replace(/\\/g, "/");
      if (allowed.has(rel)) continue;
      const text = readFileSync(file, "utf8");
      if (/(?:from\s+|require\s*\(\s*|import\s*\(\s*)["']xstate["']/.test(text)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
