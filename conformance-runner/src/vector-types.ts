/**
 * Typed views over loaded conformance vectors (vector.schema.json).
 *
 * The loader (`loader.ts`) parses vector JSONL losslessly, so all payload
 * values are {@link JsonValue} trees with numbers as raw `JsonNumber`
 * tokens. Only the fields the runner dispatches on (`id`, `kind`,
 * `call.api`, `call.setup[].api`) are lifted into typed properties;
 * everything else stays raw for the replay/diff pipeline to consume through
 * the codecs and canonicalizer.
 *
 * @see conformance.runner.loading.LoadedVector
 */

import type { JsonValue } from "./json-value.js";

/** Vector kinds per vector.schema.json. */
export type VectorKind = "builder" | "wire" | "parse" | "validation-error";

/** Vector provenance per vector.schema.json (`origin`). */
export type VectorOrigin = "extracted" | "authored";

/** One ordered `call.setup[]` entry (tests that make several calls). */
export interface SetupCall {
  /** Python dotted entry-point name. */
  readonly api: string;
  /** Encoded keyword arguments (may contain `$type`-tagged values). */
  readonly input: Readonly<Record<string, JsonValue>>;
}

/** One loaded conformance vector. */
export interface ConformanceVector {
  /** Deterministic vector id (`<capability>/<module-or-api>/<slug>...`). */
  readonly id: string;
  /** Vector kind (dispatch key for the replay model). */
  readonly kind: VectorKind;
  /** Corpus capability directory, when stamped. */
  readonly capability?: string;
  /** Extraction provenance (absent means `extracted`). */
  readonly origin?: VectorOrigin;
  /** Exact pytest nodeid (absent only for authored vectors). */
  readonly sourceTest?: string;
  /** The measured call's Python dotted entry-point name (`call.api`). */
  readonly api: string;
  /** Encoded measured-call kwargs (`call.input`). */
  readonly input: Readonly<Record<string, JsonValue>>;
  /** Ordered setup calls executed before the measured call. */
  readonly setup: readonly SetupCall[];
  /** The complete raw `call` object (session, client_options, ...). */
  readonly call: Readonly<Record<string, JsonValue>>;
  /** The complete raw `expect` object (output/interactions/result/error). */
  readonly expect: Readonly<Record<string, JsonValue>>;
  /** Corpus-relative path of the JSONL bundle this vector came from. */
  readonly bundlePath: string;
}

/** Metadata from one JSONL bundle's `$bundle` header line. */
export interface BundleInfo {
  /** Corpus-relative bundle path, e.g. `funnels/test_api_client.jsonl`. */
  readonly path: string;
  /**
   * The bundle's stamped source commit. Extracted bundles must match the
   * manifest commit; authored bundles keep their authoring-time stamp, and
   * harvest-generated headers (storybook parse corpus) omit it entirely.
   */
  readonly sourceCommit?: string;
  /**
   * The Python test file the bundle was extracted from. Absent for
   * harvest-generated authored bundles, whose headers carry
   * `generator`/`source_root` provenance instead.
   */
  readonly sourceFile?: string;
  /** Declared vector count (validated against actual lines). */
  readonly count: number;
}

/** The manifest fields the TS runner consumes. */
export interface CorpusManifest {
  /** Full 40-char source commit SHA of the extraction. */
  readonly sourceCommit: string;
  /** The frozen record clock, ISO-8601. */
  readonly recordEpoch: string;
  /** Vector schema version stamp. */
  readonly schemaVersion: string;
  /** Externally injected extraction date. */
  readonly extractionDate: string;
  /** Total vector count declared by the manifest. */
  readonly total: number;
  /** The full raw manifest object for auditing. */
  readonly raw: Readonly<Record<string, JsonValue>>;
}

/** A fully loaded corpus snapshot. */
export interface Corpus {
  /** Manifest metadata (source commit verified against the pin). */
  readonly manifest: CorpusManifest;
  /** Per-bundle headers, in corpus-relative path order. */
  readonly bundles: readonly BundleInfo[];
  /** Every vector, in bundle order then line order. */
  readonly vectors: readonly ConformanceVector[];
}
