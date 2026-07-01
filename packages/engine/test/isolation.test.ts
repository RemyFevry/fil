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
 * ADR-0003: no engine-library imports outside the XStateFlowEngine module.
 * Only `packages/engine/src/xstate-engine.ts` may depend on the xstate package.
 */
describe("engine isolation (ADR-0003)", () => {
  it("imports the xstate package only from xstate-engine.ts", () => {
    const offenders: string[] = [];
    for (const file of listTsFiles(packagesDir)) {
      const rel = relative(repoRoot, file).replace(/\\/g, "/");
      const isAdapter = rel === "packages/engine/src/xstate-engine.ts";
      if (isAdapter) continue;
      const text = readFileSync(file, "utf8");
      if (/(?:from\s+|require\s*\(\s*|import\s*\(\s*)["']xstate["']/.test(text)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
