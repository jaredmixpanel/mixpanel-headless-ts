// Root Vitest 3 configuration: discovers tests in every workspace package.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/test/**/*.test.ts",
      "conformance-runner/test/**/*.test.ts",
      "differential/test/**/*.test.ts",
      // Repo-level tests that own no workspace (build recipes, tooling
      // contracts). Typechecked by the root `tsconfig.tests.json`.
      "tests/**/*.test.ts",
    ],
  },
});
