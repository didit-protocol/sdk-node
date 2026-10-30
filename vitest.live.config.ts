import { defineConfig } from "vitest/config";

// Live smoke tests (tests/live), run only through `pnpm test:live`.
export default defineConfig({
  test: {
    include: ["tests/live/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
  },
});
