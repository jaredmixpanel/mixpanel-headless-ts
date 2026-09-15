// C8(a) corpus-wide codec round-trip sweep — FINAL form (phase2-design
// C8(a), packet P2-8: the interim not-yet-ported allowlist mechanism is
// REMOVED — every rich tag in the corpus must be registered and must
// round-trip; the only exemption left is the named DECODE_GAP below).
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
// encoded output is a FAIL. The companion raw-payload-retention audit
// lives in `raw-payload-audit.test.ts`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import * as entityClasses from "@mixpanel-headless/core";
import {
  CohortBreakdown,
  CohortCriteria,
  CohortDefinition,
  CohortMetric,
  CustomPropertyRef,
  Exclusion,
  Filter,
  FlowStep,
  Formula,
  FrequencyBreakdown,
  FrequencyFilter,
  FunnelStep,
  GroupBy,
  HoldingConstant,
  InlineCustomProperty,
  ListItemGroupMode,
  Metric,
  OAuthTokens,
  PropertyInput,
  Replay,
  RetentionEvent,
  Secret,
  SignedReplay,
  TimeComparison,
  UserAction,
} from "@mixpanel-headless/core";
import { EntityModel } from "@mixpanel-headless/core/internal";

import { createRunnerDeps } from "../src/bindings.js";
import { canonicalize } from "../src/canonical.js";
import {
  PyDate,
  PyDatetime,
  PyFloat,
  RecordingCallback,
} from "../src/codecs.js";
import { JsonNumber, type JsonValue } from "../src/json-value.js";
import { loadCorpus, loadCorpusConfig } from "../src/loader.js";

/** The conformance-runner package root. */
const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Built-in tags the runner cannot round-trip: `callback` decodes to a
 * RecordingCallback stub that has no encode form by design (the stub
 * records calls; it is not a value). The former `float` entry closed
 * with the P2-5a flip: the tag now decodes to the lossless `PyFloat`
 * wrapper and round-trips (see the Risk #3 integral-float amendment in
 * the Python repo's EXTRACTION-LEDGER).
 */
const DECODE_GAP: ReadonlySet<string> = new Set(["callback"]);

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
    if (!DECODE_GAP.has(tag)) {
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
    case "OAuthTokens": {
      expect(decoded, where).toBeInstanceOf(OAuthTokens);
      break;
    }
    case "datetime": {
      expect(decoded, where).toBeInstanceOf(PyDatetime);
      break;
    }
    case "date": {
      expect(decoded, where).toBeInstanceOf(PyDate);
      break;
    }
    case "float": {
      expect(decoded, where).toBeInstanceOf(PyFloat);
      break;
    }
    case "bytes": {
      expect(decoded, where).toBeInstanceOf(Uint8Array);
      break;
    }
    case "callback": {
      expect(decoded, where).toBeInstanceOf(RecordingCallback);
      break;
    }
    // P2-5a rich tags (+ the early cohort shells).
    case "Filter": {
      expect(decoded, where).toBeInstanceOf(Filter);
      break;
    }
    case "ListItemGroupMode": {
      expect(decoded, where).toBeInstanceOf(ListItemGroupMode);
      break;
    }
    case "PropertyInput": {
      expect(decoded, where).toBeInstanceOf(PropertyInput);
      break;
    }
    case "CustomPropertyRef": {
      expect(decoded, where).toBeInstanceOf(CustomPropertyRef);
      break;
    }
    case "InlineCustomProperty": {
      expect(decoded, where).toBeInstanceOf(InlineCustomProperty);
      break;
    }
    case "GroupBy": {
      expect(decoded, where).toBeInstanceOf(GroupBy);
      break;
    }
    case "Metric": {
      expect(decoded, where).toBeInstanceOf(Metric);
      break;
    }
    case "CohortMetric": {
      expect(decoded, where).toBeInstanceOf(CohortMetric);
      break;
    }
    case "Formula": {
      expect(decoded, where).toBeInstanceOf(Formula);
      break;
    }
    case "TimeComparison": {
      expect(decoded, where).toBeInstanceOf(TimeComparison);
      break;
    }
    case "CohortCriteria": {
      expect(decoded, where).toBeInstanceOf(CohortCriteria);
      break;
    }
    case "CohortDefinition": {
      expect(decoded, where).toBeInstanceOf(CohortDefinition);
      break;
    }
    // P2-5b cohort-family addition.
    case "CohortBreakdown": {
      expect(decoded, where).toBeInstanceOf(CohortBreakdown);
      break;
    }
    // P2-5c funnel/retention/flow/frequency family.
    case "FunnelStep": {
      expect(decoded, where).toBeInstanceOf(FunnelStep);
      break;
    }
    case "Exclusion": {
      expect(decoded, where).toBeInstanceOf(Exclusion);
      break;
    }
    case "HoldingConstant": {
      expect(decoded, where).toBeInstanceOf(HoldingConstant);
      break;
    }
    case "RetentionEvent": {
      expect(decoded, where).toBeInstanceOf(RetentionEvent);
      break;
    }
    case "FlowStep": {
      expect(decoded, where).toBeInstanceOf(FlowStep);
      break;
    }
    case "FrequencyBreakdown": {
      expect(decoded, where).toBeInstanceOf(FrequencyBreakdown);
      break;
    }
    case "FrequencyFilter": {
      expect(decoded, where).toBeInstanceOf(FrequencyFilter);
      break;
    }
    // P2-6 replay-family tags.
    case "UserAction": {
      expect(decoded, where).toBeInstanceOf(UserAction);
      break;
    }
    case "Replay": {
      expect(decoded, where).toBeInstanceOf(Replay);
      break;
    }
    case "SignedReplay": {
      expect(decoded, where).toBeInstanceOf(SignedReplay);
      break;
    }
    default: {
      // P2-7 entity-model tags: the class is exported from the
      // entities barrel under EXACTLY the tag name — probe against the
      // real class (independent of the codec's own `matches`, so a
      // lazily registered echo codec cannot satisfy this).
      const cls = (entityClasses as Readonly<Record<string, unknown>>)[
        entry.tag
      ];
      if (typeof cls !== "function") {
        throw new Error(
          `no instanceof probe for round-tripped tag ${entry.tag}`,
        );
      }
      expect(decoded, where).toBeInstanceOf(cls);
      expect(decoded, where).toBeInstanceOf(EntityModel);
    }
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

  it("every corpus tag is registered or a named decode gap (no allowlist)", () => {
    const unknown = [...tally.keys()].filter(
      (tag) => !deps.codecs.knows(tag) && !DECODE_GAP.has(tag),
    );
    expect(unknown).toEqual([]);
  });

  it("every tag-universe tag is accounted for (artifact coverage)", () => {
    const artifactTags = [
      ...tagUniverse.built_in_tags,
      ...tagUniverse.rich_tags,
    ];
    const unaccounted = artifactTags.filter(
      (tag) => !deps.codecs.knows(tag) && !DECODE_GAP.has(tag),
    );
    expect(unaccounted).toEqual([]);
  });

  it("every registered rich tag was exercised at least once", async () => {
    // Registered rich tags = the full contract table (P2-4 OAuthTokens +
    // the P2-5a query-param family + the early cohort shells). Built-ins
    // are exempt ('date' has zero corpus occurrences by design —
    // registered but unexercised, phase2-design inventory).
    const { CONTRACT_TAG_CODECS } = await import("../src/vector-codecs.js");
    for (const tag of CONTRACT_TAG_CODECS.keys()) {
      expect(tally.get(tag) ?? 0, `tag ${tag}`).toBeGreaterThanOrEqual(1);
    }
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
