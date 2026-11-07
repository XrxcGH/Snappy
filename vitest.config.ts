import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    environment: "node",
    // One empty folder per run, shared by the workers (see apps/cli/test/shared-runs.ts).
    globalSetup: ["apps/cli/test/global-setup.ts"],
    // Test files run in parallel and the CLI suites do real PBKDF2 and zip work, so a
    // heavy core test can take several times longer than it does alone. Assertions are unchanged.
    testTimeout: 30_000,
    // Setup and teardown hooks (temp folders, built bundles) are slow under the same load.
    hookTimeout: 60_000,
  },
});
