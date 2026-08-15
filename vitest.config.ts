// Root Vitest 3 configuration: discovers tests in every workspace package.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/test/**/*.test.ts",
      "conformance-runner/test/**/*.test.ts",
      "differential/test/**/*.test.ts",
    ],
  },
});
