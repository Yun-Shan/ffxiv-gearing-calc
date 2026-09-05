import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    testTimeout: 30_000,
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: [
        "src/domain/rules.ts",
        "src/domain/jobs.ts",
        "src/domain/optimizer.ts",
      ],
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
    },
  },
});
