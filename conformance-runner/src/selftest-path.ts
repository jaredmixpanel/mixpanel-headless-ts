/**
 * Resolution of the shared `canonical-selftest.json` location.
 *
 * The selftest file is the cross-language contract artifact for the two
 * canonicalizer implementations. Its home in this repo is the committed
 * corpus snapshot (`conformance-runner/corpus/`, synced by
 * `scripts/sync-corpus.sh`), which always carries it alongside the vectors.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Directory containing this module (`conformance-runner/src`). */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/** The `conformance-runner` package root. */
const PACKAGE_DIR = resolve(MODULE_DIR, "..");

/** Selftest file name as written by the Python side (`conformance/schema/`). */
const SELFTEST_FILENAME = "canonical-selftest.json";

/** Shape of the optional `corpus.config.json` fields used here. */
interface CorpusConfig {
  /** Path to the corpus snapshot directory, relative to the package. */
  readonly vectorsPath?: string;
}

/**
 * Resolve the path to `canonical-selftest.json`.
 *
 * Resolution order:
 * 1. `MP_CANONICAL_SELFTEST` environment variable (explicit override).
 * 2. `corpus.config.json`'s `vectorsPath` directory (the committed corpus
 *    snapshot; `sync-corpus.sh` copies the selftest alongside the vectors)
 *    — used when the file exists there.
 * 3. The default snapshot location `conformance-runner/corpus/`.
 *
 * @returns An absolute path. The last candidate is returned even when the
 *   file does not exist so the caller can raise a diagnostic naming the
 *   expected location.
 */
export function resolveSelftestPath(): string {
  const override = process.env["MP_CANONICAL_SELFTEST"];
  if (override !== undefined && override !== "") {
    return resolve(override);
  }
  const fallback = resolve(PACKAGE_DIR, "corpus", SELFTEST_FILENAME);
  const configured = readConfiguredVectorsPath();
  const candidates =
    configured === undefined
      ? [fallback]
      : [resolve(PACKAGE_DIR, configured, SELFTEST_FILENAME), fallback];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return fallback;
}

/**
 * Read `vectorsPath` from `conformance-runner/corpus.config.json` if the
 * config file exists.
 *
 * @returns The configured path string, or `undefined` when the config
 *   file is absent or carries no usable `vectorsPath`.
 */
function readConfiguredVectorsPath(): string | undefined {
  const configPath = resolve(PACKAGE_DIR, "corpus.config.json");
  if (!existsSync(configPath)) {
    return undefined;
  }
  const parsed = JSON.parse(readFileSync(configPath, "utf8")) as CorpusConfig;
  if (typeof parsed.vectorsPath === "string" && parsed.vectorsPath !== "") {
    return parsed.vectorsPath;
  }
  return undefined;
}
