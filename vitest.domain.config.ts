import { defineConfig, mergeConfig } from "vitest/config";
import applicationConfig from "./vite.config.ts";

export default mergeConfig(
  applicationConfig,
  defineConfig({
    test: {
      env: { FFXIV_DOMAIN_REAL_CASES: "1", FFXIV_PROFILE_TIMING: "1" },
      coverage: {
        provider: "v8",
        include: ["src/domain/**/*.ts"],
        exclude: [
          "**/*.test.ts",
          "**/*.d.ts",
          // Transport and environment adapters are exercised by their own tests.
          "**/*.worker.ts",
          "src/domain/worker-client.ts",
          "src/domain/node/**",
          "src/domain/search/highs-browser.ts",
          "src/domain/search/parallel-baseline-browser-adapter.ts",
        ],
        reporter: ["text", "json-summary", "json", "html"],
        thresholds: { statements: 90, branches: 90, functions: 90, lines: 90 },
      },
    },
  }),
);
