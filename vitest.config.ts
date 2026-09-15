// Root Vitest configuration: one project per test tree, so `vitest --project
// <name>` runs a single workspace and the corpus replay can be left out of a
// fast local loop (`npm run test:fast`) without touching any test file.
import { defineConfig } from "vitest/config";

import { vitestAliases } from "./scripts/lib/workspace-aliases.mjs";

// Vitest's default exclude does not cover .claude/; without this the include
// globs below would also run every test inside an agent worktree checked out
// under .claude/worktrees/. Inline projects inherit the root `test.exclude`,
// so it is stated once here.
const EXCLUDE = ["**/node_modules/**", "**/dist/**", "**/.claude/**"];

/** The corpus replay is its own project (see `corpus` below). */
const CORPUS_TEST = "conformance-runner/test/corpus.test.ts";

/**
 * Type-level tests (`*.test-d.ts`) for one package: vitest runs `tsc -p` on
 * the package's `tsconfig.test-d.json`, which includes `src/` directly so a
 * stale `dist/` can never satisfy an assertion. Only type-test files are
 * reported; `tsc -b` still checks them as part of the package test project.
 *
 * @param pkg - Workspace directory name under `packages/`.
 * @returns The project's `test.typecheck` block.
 */
function typecheck(pkg: string): {
  enabled: true;
  include: string[];
  tsconfig: string;
} {
  return {
    enabled: true,
    include: [`packages/${pkg}/test/**/*.test-d.ts`],
    tsconfig: `packages/${pkg}/tsconfig.test-d.json`,
  };
}

export default defineConfig({
  resolve: {
    // Bare `@mixpanel-headless/*` specifiers resolve to `src/`, not to the
    // `dist/` the packages' `exports` maps publish — tests execute the
    // TypeScript under test, never a stale build. Table lives in
    // scripts/lib/workspace-aliases.mjs (shared with the esbuild CLIs).
    // Inline projects inherit this root `resolve` block.
    alias: vitestAliases(),
  },
  test: {
    exclude: EXCLUDE,
    // `vitest run --coverage` (npm run test:coverage). Measured over the
    // library sources only; generated tables and pure re-export barrels
    // carry no logic and would only dilute the numbers. Output goes to
    // `coverage/` (git-ignored): lcov for tooling, json-summary for the
    // per-package breakdown, text-summary for the terminal.
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: [
        "**/*.gen.ts",
        "**/*.d.ts",
        "packages/core/src/**/index.ts",
        "packages/core/src/internal.ts",
        "packages/core/src/query/validation.ts",
        "packages/browser/src/index.ts",
      ],
      excludeAfterRemap: true,
      reporter: ["text-summary", "lcov", "json-summary"],
      reportsDirectory: "coverage",
      // Ratchet floor: each value is the measured whole-suite number minus
      // two points, rounded down (measurements in the commit that set it).
      // Global, not per file — the gate asks "did the suite regress", not
      // "is every module at 88 %". Raise by hand after coverage work lands;
      // `autoUpdate` stays off so the floor never moves silently.
      thresholds: {
        lines: 88,
        statements: 88,
        functions: 90,
        branches: 82,
        perFile: false,
        autoUpdate: false,
      },
    },
    // Project names are the `--project` handles (`vitest run --project core`,
    // `--project '!corpus'`). Every project runs under Node: core and browser
    // tests import no Node built-ins (the eslint purity boundary, not a DOM
    // environment, keeps them portable), and no test needs a DOM.
    projects: [
      {
        test: {
          name: "core",
          include: ["packages/core/test/**/*.test.ts"],
          typecheck: typecheck("core"),
        },
      },
      {
        test: {
          name: "node",
          include: ["packages/node/test/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "browser",
          include: ["packages/browser/test/**/*.test.ts"],
          typecheck: typecheck("browser"),
        },
      },
      {
        // The rig's own unit tests (runner, codecs, goldens, generated-file
        // freshness); the corpus replay is split out below.
        test: {
          name: "rig",
          include: ["conformance-runner/test/**/*.test.ts"],
          exclude: [...EXCLUDE, CORPUS_TEST],
        },
      },
      {
        // The full Python-extracted vector corpus replayed through the port
        // (one `it` per vector). Always part of `npm test` and the gate;
        // `npm run test:fast` skips it.
        test: {
          name: "corpus",
          include: [CORPUS_TEST],
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: "differential",
          include: ["differential/test/**/*.test.ts"],
        },
      },
      {
        // Repo-level tests that own no workspace (build recipes, tooling
        // contracts, generated-file provenance). Typechecked by the root
        // `tsconfig.tests.json`. They shell out to esbuild / `npm pack`, so
        // they get a longer per-test budget than the unit projects.
        test: {
          name: "repo",
          include: ["tests/**/*.test.ts"],
          testTimeout: 120_000,
        },
      },
    ],
  },
});
