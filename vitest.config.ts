// Root Vitest configuration: discovers tests in every workspace package.
import { defineConfig } from "vitest/config";
import { vitestAliases } from "./scripts/lib/workspace-aliases.mjs";

export default defineConfig({
  resolve: {
    // Bare `@mixpanel-headless/*` specifiers resolve to `src/`, not to the
    // `dist/` the packages' `exports` maps publish — tests execute the
    // TypeScript under test, never a stale build. Table lives in
    // scripts/lib/workspace-aliases.mjs (shared with the esbuild CLIs).
    alias: vitestAliases(),
  },
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
