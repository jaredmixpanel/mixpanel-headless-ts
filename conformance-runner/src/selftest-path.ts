/**
 * Resolution of the shared `canonical-selftest.json` location (D6/D12).
 *
 * The selftest file is the cross-language contract artifact for the two
 * canonicalizer implementations. Its home in this repo is the committed
 * corpus snapshot (`conformance-runner/corpus/`, synced by
 * `scripts/sync-corpus.sh` in TS-4); before the first snapshot exists, the
 * suite falls back to reading it directly from the Python repo checkout.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Directory containing this module (`conformance-runner/src`). */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/** The `conformance-runner` package root. */
const PACKAGE_DIR = resolve(MODULE_DIR, "..");

/** Selftest file name as written by Python task PR-4 (D6). */
const SELFTEST_FILENAME = "canonical-selftest.json";

/**
 * Pre-snapshot fallback: the authoring location in the Python repo
 * (`conformance/schema/`, task PR-4 of design D18).
 */
const PYTHON_REPO_FALLBACK = resolve(
  "/Users/jaredmcfarland/Developer/mixpanel-headless/conformance/schema",
  SELFTEST_FILENAME,
);

/** Shape of the optional `corpus.config.json` fields used here (D12). */
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
 *    snapshot; `sync-corpus.sh` copies the selftest alongside the vectors
 *    per D12) — used when the file exists there.
 * 3. The default snapshot location `conformance-runner/corpus/`.
 * 4. The Python repo authoring path (pre-snapshot use).
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
  const candidates: string[] = [];
  const configured = readConfiguredVectorsPath();
  if (configured !== undefined) {
    candidates.push(resolve(PACKAGE_DIR, configured, SELFTEST_FILENAME));
  }
  candidates.push(resolve(PACKAGE_DIR, "corpus", SELFTEST_FILENAME));
  candidates.push(PYTHON_REPO_FALLBACK);
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[candidates.length - 1] as string;
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
