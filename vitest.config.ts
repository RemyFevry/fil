import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests live under packages/<pkg>/test/ AND scripts/test/ — the latter
    // covers the shell-script-level guarantees (e.g. scripts/bootstrap.sh
    // idempotency, see R05). Both trees share the same test runner + reporter
    // so `pnpm test` runs them all in one pass.
    include: [
      "packages/**/test/**/*.test.ts",
      "scripts/test/**/*.test.ts",
    ],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/*.d.ts"],
    },
  },
});