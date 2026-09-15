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
    // Project names are the `--project` handles (`vitest run --project core`,
    // `--project '!corpus'`). Every project runs under Node: core and browser
    // tests import no Node built-ins (the eslint purity boundary, not a DOM
    // environment, keeps them portable), and no test needs a DOM.
    projects: [
      {
        test: {
          name: "core",
          include: ["packages/core/test/**/*.test.ts"],
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
