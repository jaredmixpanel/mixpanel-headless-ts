// The one esbuild bundle-and-import step behind the source-executing
// launchers (`scripts/run-conformance.mjs`, `scripts/run-oracle.mjs`): bundle
// a TypeScript entry point for Node into the owning workspace's `dist/` with
// the workspace aliases applied — so the bundle runs the code under `src/`,
// never a possibly stale `dist/` — then import it. esbuild diagnostics are
// silenced because the oracle protocol reserves stdout for line framing.
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

import { esbuildAliases } from "./workspace-aliases.mjs";

/** Repo root (this module lives in scripts/lib/). */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Bundle one TypeScript entry for Node 22 and import the resulting module.
 *
 * @param {object} options - Repo-relative paths.
 * @param {string} options.entry - The TypeScript entry point to bundle.
 * @param {string} options.outFile - Where the ESM bundle is written (a
 *   git-ignored `dist/` path; parent directories are created).
 * @returns {Promise<Record<string, unknown>>} The bundle's module namespace.
 */
export async function bundleAndImport({ entry, outFile }) {
  const outPath = resolve(REPO_ROOT, outFile);
  mkdirSync(dirname(outPath), { recursive: true });
  await build({
    entryPoints: [resolve(REPO_ROOT, entry)],
    outfile: outPath,
    bundle: true,
    alias: esbuildAliases(),
    platform: "node",
    format: "esm",
    target: "node22.12",
    sourcemap: false,
    logLevel: "silent",
  });
  return import(pathToFileURL(outPath).href);
}
