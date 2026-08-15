// C8(b) result-shape golden tests (phase2-design C8b, packet P2-6).
//
// Source of goldens: wire vectors' `expect.result` payloads — the
// recorder's full declared-field walk of the Python result dataclass
// (`_df_cache: null` included) — selected via the hand-maintained
// api → result-class table below (every result-returning api with
// `expect.result` vectors in the current snapshot).
//
// Test body per class: decode the payload through the codec registry
// ($type datetime/float children), `fromDict(...)` through the REAL
// class (strict decode), re-encode the full field walk
// (`toVectorPayload()`), and diff against the ORIGINAL raw payload.
// Numbers compare BY VALUE across token spellings (a raw `1.0` float
// token vs the TS native `1`): live TS outputs carry no int/float
// token distinction (see canonical.ts `renderNativeNumber`), so
// key-set, structure, and value equality are the lock here; tagged
// float spelling fidelity is locked separately by the C8(a) sweep.
//
// Anti-vacuity (arbiter V3): every golden adds (i) an unknown-key
// mutation probe (strict decode must throw ResponseValidationError —
// an echo implementation cannot pass), (ii) an `instanceof` check on
// the decoded product, and (iii) an `Object.keys(toJSON())` equality
// check against the per-class declared to_dict key list.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ResponseValidationError } from "../../packages/core/src/errors.js";
import {
  ActivityFeedResult,
  FlowsResult,
  FrequencyResult,
  FunnelResult,
  NumericAverageResult,
  NumericBucketResult,
  NumericSumResult,
  RetentionResult,
  SavedReportResult,
} from "../../packages/core/src/types/results/live-query.js";
import { ProfilePageResult } from "../../packages/core/src/types/results/discovery.js";
import { createRunnerDeps } from "../src/bindings.js";
import { JsonNumber, type JsonValue } from "../src/json-value.js";
import { loadCorpus, loadCorpusConfig } from "../src/loader.js";

/** The conformance-runner package root. */
const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const config = loadCorpusConfig(PACKAGE_DIR);
const corpus = loadCorpus(
  resolve(PACKAGE_DIR, config.vectorsPath),
  config.sourceCommit,
  config.recordEpoch,
);
const deps = createRunnerDeps(config.recordEpoch);

/** A golden-locked result instance's shared surface. */
interface GoldenInstance {
  toVectorPayload(): Record<string, unknown>;
  toJSON(): Record<string, unknown>;
}

/** One row of the api → result-class golden table. */
interface GoldenEntry {
  /** The recorded dotted api name. */
  readonly api: string;
  /** The core class (for the anti-vacuity instanceof probe). */
  readonly cls: new (...args: never[]) => unknown;
  /** The strict decoder. */
  readonly fromDict: (raw: unknown) => GoldenInstance;
  /** Expected `Object.keys(toJSON())` for a given instance. */
  readonly expectedJsonKeys: (instance: GoldenInstance) => readonly string[];
}

/**
 * The hand-maintained api → result-class table (phase2-design C8b).
 * Every result-class api with `expect.result` wire vectors in the
 * snapshot appears here; classes without any such vectors are locked
 * by translated construction tests instead (C8b empty-case goldens).
 */
const GOLDEN_TABLE: readonly GoldenEntry[] = [
  {
    api: "workspace.funnel",
    cls: FunnelResult,
    fromDict: (raw) => FunnelResult.fromDict(raw),
    expectedJsonKeys: () => [
      "funnel_id",
      "funnel_name",
      "from_date",
      "to_date",
      "conversion_rate",
      "steps",
    ],
  },
  {
    api: "workspace.retention",
    cls: RetentionResult,
    fromDict: (raw) => RetentionResult.fromDict(raw),
    expectedJsonKeys: () => [
      "born_event",
      "return_event",
      "from_date",
      "to_date",
      "unit",
      "cohorts",
    ],
  },
  {
    api: "workspace.frequency",
    cls: FrequencyResult,
    fromDict: (raw) => FrequencyResult.fromDict(raw),
    expectedJsonKeys: () => [
      "event",
      "from_date",
      "to_date",
      "unit",
      "addiction_unit",
      "data",
    ],
  },
  {
    api: "workspace.activity_feed",
    cls: ActivityFeedResult,
    fromDict: (raw) => ActivityFeedResult.fromDict(raw),
    expectedJsonKeys: () => [
      "distinct_ids",
      "from_date",
      "to_date",
      "event_count",
      "events",
      "sentinel_event",
    ],
  },
  {
    api: "workspace.segmentation_numeric",
    cls: NumericBucketResult,
    fromDict: (raw) => NumericBucketResult.fromDict(raw),
    expectedJsonKeys: () => [
      "event",
      "from_date",
      "to_date",
      "property_expr",
      "unit",
      "series",
    ],
  },
  {
    api: "workspace.segmentation_sum",
    cls: NumericSumResult,
    fromDict: (raw) => NumericSumResult.fromDict(raw),
    expectedJsonKeys: (instance) => [
      "event",
      "from_date",
      "to_date",
      "property_expr",
      "unit",
      "results",
      // Python to_dict adds computed_at ONLY when non-None.
      ...((instance as NumericSumResult).computed_at !== null
        ? ["computed_at"]
        : []),
    ],
  },
  {
    api: "workspace.segmentation_average",
    cls: NumericAverageResult,
    fromDict: (raw) => NumericAverageResult.fromDict(raw),
    expectedJsonKeys: () => [
      "event",
      "from_date",
      "to_date",
      "property_expr",
      "unit",
      "results",
    ],
  },
  {
    api: "workspace.query_saved_report",
    cls: SavedReportResult,
    fromDict: (raw) => SavedReportResult.fromDict(raw),
    expectedJsonKeys: () => [
      "bookmark_id",
      "computed_at",
      "from_date",
      "to_date",
      "headers",
      "series",
      "report_type",
    ],
  },
  {
    api: "workspace.query_saved_flows",
    cls: FlowsResult,
    fromDict: (raw) => FlowsResult.fromDict(raw),
    expectedJsonKeys: () => [
      "bookmark_id",
      "computed_at",
      "steps",
      "breakdowns",
      "overall_conversion_rate",
      "metadata",
    ],
  },
  {
    api: "api_client.export_profiles_page",
    cls: ProfilePageResult,
    fromDict: (raw) => ProfilePageResult.fromDict(raw),
    expectedJsonKeys: () => [
      "profiles",
      "session_id",
      "page",
      "has_more",
      "profile_count",
      "total",
      "page_size",
      "num_pages",
    ],
  },
];

/**
 * Whether a raw payload node is a `$type`-tagged object of one tag.
 *
 * @param value - Raw payload node.
 * @param tag - The tag name.
 * @returns True on a match.
 */
function isTagged(value: JsonValue, tag: string): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof JsonNumber) &&
    value["$type"] === tag
  );
}

/**
 * Diff a re-encoded TS field walk against the ORIGINAL raw payload
 * subtree. Structure and key sets must match exactly; numbers compare
 * by value across token spellings (see the module doc).
 *
 * @param actual - The `toVectorPayload()` output node.
 * @param expected - The raw vector payload node (JsonNumber tokens).
 * @param path - JSON path for failure messages.
 */
function diffPlain(actual: unknown, expected: JsonValue, path: string): void {
  if (expected instanceof JsonNumber) {
    expect(typeof actual, path).toBe("number");
    expect(actual, path).toBe(expected.toNumber());
    return;
  }
  if (isTagged(expected, "float")) {
    const tagged = expected as Readonly<Record<string, JsonValue>>;
    expect(typeof actual, path).toBe("number");
    expect(actual, path).toBe(Number(tagged["value"] as string));
    return;
  }
  if (isTagged(expected, "datetime")) {
    // toVectorPayload re-tags datetimes with the preserved iso text.
    const tagged = expected as Readonly<Record<string, JsonValue>>;
    expect(actual, path).toEqual({
      $type: "datetime",
      iso: tagged["iso"] as string,
    });
    return;
  }
  if (expected === null || typeof expected !== "object") {
    expect(actual, path).toBe(expected);
    return;
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true);
    const actualArray = actual as readonly unknown[];
    expect(actualArray.length, path).toBe(expected.length);
    expected.forEach((item, index) => {
      diffPlain(actualArray[index], item, `${path}[${String(index)}]`);
    });
    return;
  }
  expect(typeof actual === "object" && actual !== null, path).toBe(true);
  const actualRecord = actual as Readonly<Record<string, unknown>>;
  expect(Object.keys(actualRecord).sort(), path).toEqual(
    Object.keys(expected).sort(),
  );
  for (const [key, item] of Object.entries(expected)) {
    diffPlain(actualRecord[key], item, `${path}.${key}`);
  }
}

describe("C8(b) result-shape goldens", () => {
  for (const entry of GOLDEN_TABLE) {
    const vectors = corpus.vectors.filter(
      (vector) =>
        vector.call["api"] === entry.api &&
        Object.hasOwn(vector.expect, "result"),
    );

    describe(entry.api, () => {
      it("has expect.result vectors in the snapshot (table honesty)", () => {
        expect(vectors.length).toBeGreaterThan(0);
      });

      it("round-trips every expect.result through the class", () => {
        for (const vector of vectors) {
          const raw = vector.expect["result"] as JsonValue;
          const decoded = deps.codecs.decodeValue(raw);
          const instance = entry.fromDict(decoded);
          // Anti-vacuity: the decode product is the REAL core class.
          expect(instance, vector.id).toBeInstanceOf(entry.cls);
          diffPlain(instance.toVectorPayload(), raw, `${vector.id} @ result`);
        }
      });

      it("rejects an unknown-key mutation (strict-decode probe)", () => {
        for (const vector of vectors) {
          const decoded = deps.codecs.decodeValue(
            vector.expect["result"] as JsonValue,
          ) as Readonly<Record<string, unknown>>;
          expect(
            () => entry.fromDict({ ...decoded, __p2_6_unknown__: true }),
            vector.id,
          ).toThrow(ResponseValidationError);
        }
      });

      it("toJSON() emits exactly the declared to_dict key list", () => {
        for (const vector of vectors) {
          const decoded = deps.codecs.decodeValue(
            vector.expect["result"] as JsonValue,
          );
          const instance = entry.fromDict(decoded);
          expect(Object.keys(instance.toJSON()), vector.id).toEqual([
            ...entry.expectedJsonKeys(instance),
          ]);
        }
      });
    });
  }
});
