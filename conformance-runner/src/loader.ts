/**
 * Corpus snapshot loader (design D12, task TS-4).
 *
 * Loads the committed corpus snapshot (`conformance-runner/corpus/`, written
 * by `scripts/sync-corpus.sh`) into typed vectors:
 *
 * - Every JSONL line is parsed with the LOSSLESS parser (D6 rule 3 hard
 *   requirement): raw number tokens survive as `JsonNumber`, so `18` vs
 *   `18.0` and integers above 2^53 are preserved — plain `JSON.parse` is
 *   never used for vector payloads.
 * - Drift protection: `manifest.source_commit` must equal the pinned
 *   `sourceCommit` (from `corpus.config.json`); every EXTRACTED bundle's
 *   `$bundle` header must carry the same commit and an accurate line
 *   count; vector ids must be corpus-unique. Authored bundles (the
 *   `authored/` subtree, outside the record pipeline) keep their
 *   authoring-time stamp — or none at all for storybook harvest headers —
 *   and are exempt from the commit equality (count and id checks still
 *   apply). Any violation raises {@link CorpusIntegrityError} — a stale
 *   or hand-edited snapshot must never silently skew a conformance run.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { boundJsonReaders } from "./internal/guards.js";
import { JsonNumber, type JsonValue } from "./json-value.js";
import { parseLossless } from "./lossless-json.js";
import type {
  BundleInfo,
  ConformanceVector,
  Corpus,
  CorpusManifest,
  SetupCall,
  VectorKind,
  VectorOrigin,
} from "./vector-types.js";

/** Raised when the snapshot fails a structural or provenance check. */
export class CorpusIntegrityError extends Error {
  /**
   * Create an integrity error.
   *
   * @param message - Description of the failed check.
   */
  constructor(message: string) {
    super(message);
    this.name = "CorpusIntegrityError";
  }
}

/**
 * The object/string readers, raising {@link CorpusIntegrityError}; every
 * manifest / vector string field must be non-empty.
 */
const { asObject, requireString, optionalString } = boundJsonReaders(
  (message) => new CorpusIntegrityError(message),
  { nonEmpty: true },
);

/** The pinned corpus configuration (`corpus.config.json`, design D12). */
export interface CorpusConfig {
  /** Snapshot directory, relative to the conformance-runner package. */
  readonly vectorsPath: string;
  /** Pinned full source-commit SHA the snapshot must carry. */
  readonly sourceCommit: string;
  /** The frozen record clock both runners inject (design D1.4). */
  readonly recordEpoch: string;
}

/** Vector kinds accepted from vector.schema.json. */
const VECTOR_KINDS: ReadonlySet<string> = new Set([
  "builder",
  "wire",
  "parse",
  "validation-error",
]);

/** Origins accepted from vector.schema.json. */
const VECTOR_ORIGINS: ReadonlySet<string> = new Set(["extracted", "authored"]);

/**
 * Load and validate `corpus.config.json`.
 *
 * @param packageDir - The conformance-runner package root.
 * @returns The parsed configuration.
 * @throws CorpusIntegrityError - If the file is missing a required field.
 */
export function loadCorpusConfig(packageDir: string): CorpusConfig {
  const configPath = resolve(packageDir, "corpus.config.json");
  const parsed: unknown = JSON.parse(readFileSync(configPath, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new CorpusIntegrityError(
      `corpus.config.json is not an object: ${configPath}`,
    );
  }
  const record = parsed as Record<string, unknown>;
  for (const field of ["vectorsPath", "sourceCommit", "recordEpoch"]) {
    if (typeof record[field] !== "string" || record[field] === "") {
      throw new CorpusIntegrityError(
        `corpus.config.json missing string field ${JSON.stringify(field)}`,
      );
    }
  }
  return {
    vectorsPath: record["vectorsPath"] as string,
    sourceCommit: record["sourceCommit"] as string,
    recordEpoch: record["recordEpoch"] as string,
  };
}

/**
 * Assert an object field is an integer-token number and return it.
 *
 * @param record - The containing object.
 * @param key - The field name.
 * @param context - Human-readable location for the error message.
 * @returns The integer value as a JS number.
 * @throws CorpusIntegrityError - When absent, non-numeric, or unsafe.
 */
function requireInteger(
  record: Record<string, JsonValue>,
  key: string,
  context: string,
): number {
  const value = record[key];
  if (
    !(value instanceof JsonNumber) ||
    !value.isIntegerToken() ||
    value.isUnsafeInteger()
  ) {
    throw new CorpusIntegrityError(
      `${context}: field ${JSON.stringify(key)} is not a safe integer`,
    );
  }
  return value.toNumber();
}

/**
 * Recursively enumerate `.jsonl` bundle files under a directory.
 *
 * @param root - The corpus directory.
 * @returns Corpus-relative bundle paths, sorted for determinism.
 */
function enumerateBundles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        found.push(relative(root, full));
      }
    }
  };
  walk(root);
  return found.sort();
}

/**
 * Parse the corpus manifest and verify the source-commit pin.
 *
 * @param corpusDir - The snapshot directory.
 * @param expectedSourceCommit - The pinned SHA from the config.
 * @param expectedRecordEpoch - Optional record-epoch pin from the config.
 * @returns The typed manifest view.
 * @throws CorpusIntegrityError - On missing fields or pin mismatches.
 */
function loadManifest(
  corpusDir: string,
  expectedSourceCommit: string,
  expectedRecordEpoch?: string,
): CorpusManifest {
  const manifestPath = resolve(corpusDir, "manifest.json");
  let text: string;
  try {
    text = readFileSync(manifestPath, "utf8");
  } catch (error) {
    throw new CorpusIntegrityError(
      `corpus manifest not found at ${manifestPath} (run scripts/sync-corpus.sh): ${String(error)}`,
    );
  }
  const raw = asObject(parseLossless(text), "manifest.json");
  const sourceCommit = requireString(raw, "source_commit", "manifest.json");
  if (sourceCommit !== expectedSourceCommit) {
    throw new CorpusIntegrityError(
      `manifest.source_commit ${sourceCommit} does not match the pinned sourceCommit ` +
        `${expectedSourceCommit} (corpus.config.json) — refusing to run on a drifted snapshot (D12)`,
    );
  }
  const recordEpoch = requireString(raw, "record_epoch", "manifest.json");
  if (
    expectedRecordEpoch !== undefined &&
    recordEpoch !== expectedRecordEpoch
  ) {
    throw new CorpusIntegrityError(
      `manifest.record_epoch ${recordEpoch} does not match the configured recordEpoch ${expectedRecordEpoch}`,
    );
  }
  const counts = asObject(raw["counts"], "manifest.json counts");
  return {
    sourceCommit,
    recordEpoch,
    schemaVersion: requireString(raw, "schema_version", "manifest.json"),
    extractionDate: requireString(raw, "extraction_date", "manifest.json"),
    total: requireInteger(counts, "total", "manifest.json counts"),
    raw,
  };
}

/**
 * Parse one vector line into its typed view.
 *
 * @param value - The lossless-parsed line value.
 * @param context - Bundle path + line number for error messages.
 * @returns The typed vector.
 * @throws CorpusIntegrityError - On schema-shape violations.
 */
function toVector(
  value: JsonValue,
  context: string,
): Omit<ConformanceVector, "bundlePath"> {
  const record = asObject(value, context);
  const id = requireString(record, "id", context);
  const kind = requireString(record, "kind", context);
  if (!VECTOR_KINDS.has(kind)) {
    throw new CorpusIntegrityError(
      `${context}: unknown vector kind ${JSON.stringify(kind)}`,
    );
  }
  const call = asObject(record["call"], `${context} call`);
  const expectValue = asObject(record["expect"], `${context} expect`);
  const api = requireString(call, "api", `${context} call`);
  const input = asObject(call["input"], `${context} call.input`);
  const setup: SetupCall[] = [];
  const rawSetup = call["setup"];
  if (rawSetup !== undefined) {
    if (!Array.isArray(rawSetup)) {
      throw new CorpusIntegrityError(`${context}: call.setup must be an array`);
    }
    for (const [index, entry] of rawSetup.entries()) {
      const setupRecord = asObject(
        entry,
        `${context} call.setup[${String(index)}]`,
      );
      setup.push({
        api: requireString(
          setupRecord,
          "api",
          `${context} call.setup[${String(index)}]`,
        ),
        input: asObject(
          setupRecord["input"],
          `${context} call.setup[${String(index)}].input`,
        ),
      });
    }
  }
  const origin = record["origin"];
  if (
    origin !== undefined &&
    (typeof origin !== "string" || !VECTOR_ORIGINS.has(origin))
  ) {
    throw new CorpusIntegrityError(`${context}: invalid origin`);
  }
  const capability = record["capability"];
  const sourceTest = record["source_test"];
  return {
    id,
    kind: kind as VectorKind,
    ...(typeof capability === "string" ? { capability } : {}),
    ...(origin === undefined ? {} : { origin: origin as VectorOrigin }),
    ...(typeof sourceTest === "string" ? { sourceTest } : {}),
    api,
    input,
    setup,
    call,
    expect: expectValue,
  };
}

/**
 * Load the full corpus snapshot (design D12).
 *
 * @param corpusDir - The snapshot directory (usually `<pkg>/corpus`).
 * @param expectedSourceCommit - The pinned SHA (config `sourceCommit`).
 * @param expectedRecordEpoch - Optional record-epoch pin (config
 *   `recordEpoch`); checked against the manifest when provided.
 * @returns The manifest, bundle headers, and every vector.
 * @throws CorpusIntegrityError - On any provenance or structure violation:
 *   pin mismatch, malformed bundle header, header/vector count mismatch,
 *   bundle commit drift, duplicate vector ids, malformed vector lines, or
 *   a manifest total that disagrees with the loaded vector count.
 * @example
 * ```typescript
 * const config = loadCorpusConfig(packageDir);
 * const corpus = loadCorpus(
 *   resolve(packageDir, config.vectorsPath),
 *   config.sourceCommit,
 *   config.recordEpoch,
 * );
 * // corpus.vectors.length === corpus.manifest.total
 * ```
 */
export function loadCorpus(
  corpusDir: string,
  expectedSourceCommit: string,
  expectedRecordEpoch?: string,
): Corpus {
  const manifest = loadManifest(
    corpusDir,
    expectedSourceCommit,
    expectedRecordEpoch,
  );
  const bundles: BundleInfo[] = [];
  const vectors: ConformanceVector[] = [];
  const seenIds = new Set<string>();
  for (const bundlePath of enumerateBundles(corpusDir)) {
    const text = readFileSync(resolve(corpusDir, bundlePath), "utf8");
    const lines = text.split("\n").filter((line) => line !== "");
    if (lines.length === 0) {
      throw new CorpusIntegrityError(`${bundlePath}: empty bundle`);
    }
    const headerLine = asObject(
      parseLossless(lines[0] as string),
      `${bundlePath} header`,
    );
    const header = asObject(
      headerLine["$bundle"],
      `${bundlePath} $bundle header`,
    );
    // Authored bundles (corpus `authored/` subtree, design D13/D3.1) sit
    // outside the record pipeline: their `source_commit` is the
    // authoring-time stamp (or absent entirely for storybook harvest
    // headers, which carry `generator`/`source_root` provenance instead),
    // so only extracted bundles are held to the manifest-commit equality
    // (D12 drift protection).
    const isAuthored = bundlePath.split(/[/\\]/, 1)[0] === "authored";
    const bundleCommit = isAuthored
      ? optionalString(header, "source_commit", `${bundlePath} $bundle`)
      : requireString(header, "source_commit", `${bundlePath} $bundle`);
    if (!isAuthored && bundleCommit !== manifest.sourceCommit) {
      throw new CorpusIntegrityError(
        `${bundlePath}: $bundle source_commit ${String(bundleCommit)} != manifest ${manifest.sourceCommit}`,
      );
    }
    const declaredCount = requireInteger(
      header,
      "count",
      `${bundlePath} $bundle`,
    );
    const vectorLines = lines.slice(1);
    if (vectorLines.length !== declaredCount) {
      throw new CorpusIntegrityError(
        `${bundlePath}: $bundle count ${String(declaredCount)} != ${String(vectorLines.length)} vector lines`,
      );
    }
    const sourceFile = isAuthored
      ? optionalString(header, "source_file", `${bundlePath} $bundle`)
      : requireString(header, "source_file", `${bundlePath} $bundle`);
    bundles.push({
      path: bundlePath,
      ...(bundleCommit === undefined ? {} : { sourceCommit: bundleCommit }),
      ...(sourceFile === undefined ? {} : { sourceFile }),
      count: declaredCount,
    });
    for (const [index, line] of vectorLines.entries()) {
      const context = `${bundlePath}:${String(index + 2)}`;
      const vector = toVector(parseLossless(line), context);
      if (seenIds.has(vector.id)) {
        throw new CorpusIntegrityError(
          `${context}: duplicate vector id ${vector.id}`,
        );
      }
      seenIds.add(vector.id);
      vectors.push({ ...vector, bundlePath });
    }
  }
  // manifest counts.total covers the RECORD-PIPELINE extraction only;
  // authored vectors (origin "authored", design D13/D3.1) are hand-written
  // additions outside the manifest's reconciliation scope.
  const extractedCount = vectors.filter(
    (vector) => vector.origin !== "authored",
  ).length;
  if (extractedCount !== manifest.total) {
    throw new CorpusIntegrityError(
      `loaded ${String(extractedCount)} extracted vectors but manifest counts.total is ${String(manifest.total)}`,
    );
  }
  return { manifest, bundles, vectors };
}
