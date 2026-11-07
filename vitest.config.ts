import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "codegen/tests/**/*.test.ts"],
    // The live smoke tests run only through vitest.live.config.ts.
    exclude: ["tests/live/**", "node_modules/**"],
    environment: "node",
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      // The hand-written core (docs/DESIGN.md section 11: 90 % or more).
      include: ["src/core/**", "src/webhooks/**", "src/authentication/**", "src/client.ts"],
      reporter: ["text", "text-summary"],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 90 },
    },
  },
});
