// Root Vitest configuration: discovers tests in every workspace package.
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
    // Vitest's default exclude does not cover .claude/; without this the
    // include globs above would also run every test inside an agent
    // worktree checked out under .claude/worktrees/.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.claude/**"],
  },
});
