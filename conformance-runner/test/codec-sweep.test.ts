// C8(a) corpus-wide codec round-trip sweep (phase2-design C8, packet
// P2-4 initial form — the P2-8 packet finalizes it with an EMPTY
// allowlist).
//
// For every `$type`-tagged object found anywhere in a corpus vector
// (recursive descent through `call` and `expect`, including inside
// arrays/objects/nested tags): decode through the codec registry into
// the real TS instance, encode back, canonical-diff against the
// original subtree (RAW subtree — no operand normalization, Risk #4).
//
// Anti-vacuity (mandatory, arbiter V3): the decoded product must be an
// `instanceof` the registered core class, and `SecretStr` round-trips
// must preserve the REVEALED value — a `'**********'` mask appearing in
// encoded output is a FAIL.
//
// The explicit ALLOWLIST below names every rich tag whose port packet
// has not yet landed (P2-5a..c query params, P2-6 results, P2-7
// entities). Packet ordering in C10 shrinks it to empty; a stale entry
// (tag both allowlisted AND registered) fails loudly.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OAuthTokens } from "../../packages/core/src/auth/token.js";
import { Secret } from "../../packages/core/src/secret.js";
import { createRunnerDeps } from "../src/bindings.js";
import { canonicalize } from "../src/canonical.js";
import { PyDate, PyDatetime, RecordingCallback } from "../src/codecs.js";
import { JsonNumber, type JsonValue } from "../src/json-value.js";
import { loadCorpus, loadCorpusConfig } from "../src/loader.js";

/** The conformance-runner package root. */
const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Rich tags whose port packet has NOT landed yet (explicit, tracked). */
const ALLOWLIST: ReadonlySet<string> = new Set([
  // P2-5a filter/metric/group core
  "Filter",
  "ListItemGroupMode",
  "PropertyInput",
  "CustomPropertyRef",
  "InlineCustomProperty",
  "GroupBy",
  "Metric",
  "CohortMetric",
  "Formula",
  "TimeComparison",
  // P2-5b cohort family
  "CohortCriteria",
  "CohortDefinition",
  "CohortBreakdown",
  // P2-5c funnel/retention/flow/frequency
  "FunnelStep",
  "Exclusion",
  "HoldingConstant",
  "RetentionEvent",
  "FlowStep",
  "FrequencyBreakdown",
  "FrequencyFilter",
  // P2-6 result classes + replay models
  "UserAction",
  "Replay",
  "SignedReplay",
  // P2-7 entity/params models
  "BlueprintCard",
  "BlueprintFinishParams",
  "BulkAnomalyEntry",
  "BulkCreateSchemasParams",
  "BulkEventUpdate",
  "BulkPropertyUpdate",
  "BulkUpdateAnomalyParams",
  "BulkUpdateBookmarkEntry",
  "BulkUpdateCohortEntry",
  "BulkUpdateEventsParams",
  "BulkUpdatePropertiesParams",
  "ComposedPropertyValue",
  "CreateAlertParams",
  "CreateAnnotationParams",
  "CreateAnnotationTagParams",
  "CreateBookmarkParams",
  "CreateCohortParams",
  "CreateCustomEventParams",
  "CreateCustomPropertyParams",
  "CreateDashboardParams",
  "CreateDeletionRequestParams",
  "CreateDropFilterParams",
  "CreateExperimentParams",
  "CreateFeatureFlagParams",
  "CreateRcaDashboardParams",
  "CreateTagParams",
  "CreateWebhookParams",
  "DuplicateExperimentParams",
  "ExperimentConcludeParams",
  "ExperimentDecideParams",
  "InitSchemaEnforcementParams",
  "MarkLookupTableReadyParams",
  "PreviewDeletionFiltersParams",
  "RcaSourceData",
  "ReplaceSchemaEnforcementParams",
  "SchemaEntry",
  "SetTestUsersParams",
  "UpdateAlertParams",
  "UpdateAnnotationParams",
  "UpdateAnomalyParams",
  "UpdateBookmarkParams",
  "UpdateCohortParams",
  "UpdateCustomPropertyParams",
  "UpdateDashboardParams",
  "UpdateDropFilterParams",
  "UpdateEventDefinitionParams",
  "UpdateExperimentParams",
  "UpdateFeatureFlagParams",
  "UpdateLookupTableParams",
  "UpdatePropertyDefinitionParams",
  "UpdateReportLinkParams",
  "UpdateSchemaEnforcementParams",
  "UpdateTagParams",
  "UpdateWebhookParams",
  "ValidateAlertsForBookmarkParams",
  "WebhookTestParams",
]);

/**
 * Built-in tags the runner cannot round-trip yet: `float` has no decode
 * arm in codecs.ts (the Python built-in table has one) — closing that
 * gap belongs to the P2-5a flip / P2-8 finalization; `callback` decodes
 * to a RecordingCallback stub that has no encode form by design (the
 * stub records calls; it is not a value). Both are decode-gap entries,
 * not port-packet allowlist entries.
 */
const DECODE_GAP: ReadonlySet<string> = new Set(["float", "callback"]);

/** Parsed shape of the P2-1 tag-universe contract artifact. */
interface TagUniverse {
  readonly built_in_tags: readonly string[];
  readonly rich_tags: readonly string[];
  readonly tags: Readonly<Record<string, number>>;
}

const tagUniverse = JSON.parse(
  readFileSync(
    resolve(PACKAGE_DIR, "corpus/contract/tag-universe.json"),
    "utf8",
  ),
) as TagUniverse;

const config = loadCorpusConfig(PACKAGE_DIR);
const corpus = loadCorpus(
  resolve(PACKAGE_DIR, config.vectorsPath),
  config.sourceCommit,
  config.recordEpoch,
);
const deps = createRunnerDeps(config.recordEpoch);

/** Occurrence tally per `$type` tag, filled by the walk below. */
const tally = new Map<string, number>();

/** One tagged subtree scheduled for a round-trip check. */
interface TaggedNode {
  readonly vectorId: string;
  readonly path: string;
  readonly tag: string;
  readonly node: Readonly<Record<string, JsonValue>>;
}

/** Every round-trippable tagged node found in the corpus. */
const roundTrippable: TaggedNode[] = [];

/**
 * Recursively collect `$type`-tagged objects (JSON-aware — an escaped
 * `"$type"` inside a string payload is NOT a tag, which a grep would
 * miscount; the walk only inspects real object keys).
 *
 * @param value - The current subtree.
 * @param vectorId - The owning vector id (for failure messages).
 * @param path - JSON path of `value` (for failure messages).
 */
function walk(value: JsonValue, vectorId: string, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      walk(item, vectorId, `${path}[${String(index)}]`);
    });
    return;
  }
  if (typeof value !== "object" || value === null) {
    return;
  }
  if (value instanceof JsonNumber) {
    return; // number tokens are leaves
  }
  const record = value as Readonly<Record<string, JsonValue>>;
  const tag = record["$type"];
  if (typeof tag === "string") {
    tally.set(tag, (tally.get(tag) ?? 0) + 1);
    if (!ALLOWLIST.has(tag) && !DECODE_GAP.has(tag)) {
      roundTrippable.push({ vectorId, path, tag, node: record });
    }
  }
  for (const [key, item] of Object.entries(record)) {
    if (key === "$type") {
      continue;
    }
    walk(item, vectorId, `${path}.${key}`);
  }
}

for (const vector of corpus.vectors) {
  walk(vector.call as JsonValue, vector.id, "call");
  walk(vector.expect as JsonValue, vector.id, "expect");
}

/**
 * Assert the anti-vacuity `instanceof` probe for one decoded product.
 *
 * @param entry - The tagged node under test.
 * @param decoded - The decode product.
 */
function assertRealInstance(entry: TaggedNode, decoded: unknown): void {
  const where = `${entry.vectorId} @ ${entry.path}`;
  switch (entry.tag) {
    case "SecretStr": {
      expect(decoded, where).toBeInstanceOf(Secret);
      // Round-trip must preserve the REVEALED value: a '**********'
      // mask in encoded output would compare mask-vs-mask vacuously.
      expect((decoded as Secret).reveal(), where).toBe(entry.node["value"]);
      break;
    }
    case "OAuthTokens":
      expect(decoded, where).toBeInstanceOf(OAuthTokens);
      break;
    case "datetime":
      expect(decoded, where).toBeInstanceOf(PyDatetime);
      break;
    case "date":
      expect(decoded, where).toBeInstanceOf(PyDate);
      break;
    case "bytes":
      expect(decoded, where).toBeInstanceOf(Uint8Array);
      break;
    case "callback":
      expect(decoded, where).toBeInstanceOf(RecordingCallback);
      break;
    default:
      throw new Error(`no instanceof probe for round-tripped tag ${entry.tag}`);
  }
}

describe("C8(a) codec round-trip sweep", () => {
  it("finds tagged payloads to exercise (sweep is not vacuous)", () => {
    expect(roundTrippable.length).toBeGreaterThan(0);
    // The two P2-4 behavioral targets are exercised, per the corpus
    // tag-universe counts (SecretStr 20, OAuthTokens 7 at pin time).
    expect(tally.get("SecretStr") ?? 0).toBeGreaterThanOrEqual(1);
    expect(tally.get("OAuthTokens") ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("every corpus tag is registered, allowlisted, or a named decode gap", () => {
    const unknown = [...tally.keys()].filter(
      (tag) =>
        !deps.codecs.knows(tag) && !ALLOWLIST.has(tag) && !DECODE_GAP.has(tag),
    );
    expect(unknown).toEqual([]);
  });

  it("every tag-universe tag is accounted for (artifact coverage)", () => {
    const artifactTags = [
      ...tagUniverse.built_in_tags,
      ...tagUniverse.rich_tags,
    ];
    const unaccounted = artifactTags.filter(
      (tag) =>
        !deps.codecs.knows(tag) && !ALLOWLIST.has(tag) && !DECODE_GAP.has(tag),
    );
    expect(unaccounted).toEqual([]);
  });

  it("the allowlist contains no stale entries (registered tags must leave it)", () => {
    const stale = [...ALLOWLIST].filter((tag) => deps.codecs.knows(tag));
    expect(stale).toEqual([]);
  });

  it("every registered rich tag was exercised at least once", () => {
    // Registered rich tags so far: the P2-4 contract table (OAuthTokens).
    // Built-ins are exempt ('date' has zero corpus occurrences by
    // design — registered but unexercised, phase2-design inventory).
    expect(tally.get("OAuthTokens") ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("round-trips every decodable tagged subtree byte-canonically", () => {
    for (const entry of roundTrippable) {
      const where = `${entry.vectorId} @ ${entry.path} ($type ${entry.tag})`;
      const decoded = deps.codecs.decodeValue(entry.node);
      assertRealInstance(entry, decoded);
      const encoded = deps.codecs.encodeValue(decoded);
      expect(canonicalize(encoded), where).toBe(
        canonicalize(entry.node as JsonValue),
      );
    }
  });

  it("guards against raw-payload echo codecs (spot anti-vacuity)", () => {
    // A codec that stored the payload and echoed it back would satisfy
    // the round-trip; the instanceof probes above plus this negative
    // probe (decode of a mutated payload must FAIL, not echo) close the
    // hole for the P2-4 tag.
    const sample = roundTrippable.find((entry) => entry.tag === "OAuthTokens");
    if (sample === undefined) {
      throw new Error("no OAuthTokens vector payload found in the corpus");
    }
    const mutated = { ...sample.node, injected_key: true };
    expect(() => deps.codecs.decodeValue(mutated)).toThrow(
      /unknown fields|could not reconstruct/,
    );
  });
});

/**
 * Recursively list `.jsonl` files under a directory (sorted, stable).
 *
 * @param dir - Directory to scan.
 * @returns Absolute paths of every `.jsonl` file below `dir`.
 */
function listJsonl(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...listJsonl(full));
    } else if (name.endsWith(".jsonl")) {
      out.push(full);
    }
  }
  return out;
}

describe("sweep input completeness", () => {
  it("the loader saw every JSONL line on disk (vectors + bundle headers)", () => {
    const vectorsDir = resolve(PACKAGE_DIR, config.vectorsPath);
    let lines = 0;
    for (const file of listJsonl(vectorsDir)) {
      const text = readFileSync(file, "utf8");
      lines += text.split("\n").filter((line) => line.trim() !== "").length;
    }
    // Every bundle's first line is its `$bundle` header; the rest are
    // vectors — so the walk above covered the entire snapshot.
    expect(corpus.vectors.length + corpus.bundles.length).toBe(lines);
  });
});
