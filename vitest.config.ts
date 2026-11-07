import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    environment: "node",
    // Test files run in parallel and the CLI suites do real PBKDF2 and zip work, so a
    // heavy core test can take several times longer than it does alone. Assertions are unchanged.
    testTimeout: 30_000,
  },
});
