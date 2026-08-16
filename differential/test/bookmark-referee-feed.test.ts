// Referee (a) runner feed — B3 gate (playbook P3-7 / phase1-design D15a).
//
// D15a's feed rule: pipe builder-kind vector outputs that are
// INSIGHTS-SHAPED through the ajv bookmark.json referee as a secondary
// assert. This suite is that feed: for every insights-shaped B3
// `bookmark_builders.*` output vector it executes the SAME binding the
// conformance runner replays (binding-honesty: the real ported builder),
// injects the TS-BUILT fragment into the recon-proven minimal valid
// `InsightsBookmarkParams` skeleton at the api's section slot, and
// requires an ajv ACCEPT.
//
// Scope (D15a "INSIGHTS-SHAPED ONLY"):
// - `build_filter_entry` / `build_frequency_filter_entry` →
//   `sections.filter` entries; `build_filter_section` → the whole
//   `sections.filter` array. (Schema power is limited: `Sections.filter`
//   items are `JsonValue` — root/sections `additionalProperties` and the
//   skeleton contract still apply. The frequency-filter clause shape the
//   deep voluptuous oracle rejects — the two standing R10.7 true
//   positives — is therefore ACCEPTED here by design.)
// - `build_group_section` → `sections.group` (`GroupClause` items with
//   `additionalProperties: false` — the discriminating slot).
// - `build_time_section` → `sections.time` (items are `JsonValue`).
// - EXCLUDED, per the referee-(b) routing table
//   (`conformance/referee_bookmark_parser/README.md`): `build_date_range`
//   outputs are COMMON-shaped (`{from_date, to_date, type}` — no insights
//   section hosts them; the Python structural oracle covers them wrapped
//   as `{"date_range": …}`), and `build_flow_*` outputs are FLOWS-shaped
//   (feeding either to the insights root would reject correct output —
//   the D15a dead-weight trap).
//
// Error-expectation vectors carry no output and are skipped (counted).
//
// EXPECTED-AND-DISCLOSED REJECTS (R10.7, frequency-filter precedent): the
// library threads its `data_group_id: int | None` parameter verbatim into
// clause-level `dataGroupId`, which BOTH analytics oracles type
// `string | null` (vendored `DataGroupId` def; voluptuous
// `insights/validate.py:222,263,301,368`). Filed Python-side as
// `context/phase3/bug-reports/mixpanel-headless-datagroupid-int-clause.md`
// (B3 gate, 2026-08-15); until that Python-first fix cycle lands, the TS
// port replicates the int byte-for-byte and the four affected vectors are
// pinned below. Any reject beyond the pinned set still blocks.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createRunnerDeps } from "../../conformance-runner/src/bindings.js";
import { canonicalize } from "../../conformance-runner/src/canonical.js";
import type { JsonValue } from "../../conformance-runner/src/json-value.js";
import {
  loadCorpus,
  loadCorpusConfig,
} from "../../conformance-runner/src/loader.js";
import type { ConformanceVector } from "../../conformance-runner/src/vector-types.js";
import { createShims } from "../../conformance-runner/src/shims.js";
import { KNOWN_VALID_INSIGHTS_PAYLOAD } from "../referees/bookmark-schema/known-payloads.js";
import type { JsonObject } from "../referees/bookmark-schema/known-payloads.js";
import { refereeBookmarkPayload } from "../referees/bookmark-schema/referee.js";

/**
 * The pinned expected-REJECT vector ids (see the header disclosure).
 * Every listed vector must reject WITH a `dataGroupId` error; every other
 * fed vector must be accepted.
 */
const EXPECTED_DATAGROUPID_REJECTS: ReadonlySet<string> = new Set([
  "bookmarks/bookmark_builders.build_group_section/test_bookmark_builders-testbuildgroupsectiondatagroupid-test_cohort_breakdown_group_with_data_group_id",
  "bookmarks/bookmark_builders.build_group_section/test_bookmark_builders-testbuildgroupsectiondatagroupid-test_custom_property_ref_group_with_data_group_id",
  "bookmarks/bookmark_builders.build_group_section/test_bookmark_builders-testbuildgroupsectiondatagroupid-test_inline_custom_property_group_with_data_group_id",
  "bookmarks/bookmark_builders.build_group_section/test_bookmark_builders-testbuildgroupsectionfrequency-test_data_group_id_threaded_to_frequency",
]);

/** How each fed api's output lands inside the `sections` object. */
const FEED_SLOTS: ReadonlyMap<string, (output: unknown) => JsonObject> =
  new Map<string, (output: unknown) => JsonObject>([
    ["bookmark_builders.build_filter_entry", (o) => ({ filter: [o] })],
    [
      "bookmark_builders.build_frequency_filter_entry",
      (o) => ({ filter: [o] }),
    ],
    ["bookmark_builders.build_filter_section", (o) => ({ filter: o })],
    ["bookmark_builders.build_group_section", (o) => ({ group: o })],
    ["bookmark_builders.build_time_section", (o) => ({ time: o })],
  ]);

/**
 * Wrap a TS-built fragment into the minimal valid insights payload.
 *
 * @param api - The fed api name (selects the section slot).
 * @param output - The plain-JSON builder output.
 * @returns A full `InsightsBookmarkParams`-shaped payload.
 */
function wrapFragment(api: string, output: unknown): JsonObject {
  const wrap = FEED_SLOTS.get(api);
  if (wrap === undefined) {
    throw new Error(`no feed slot for api ${JSON.stringify(api)}`);
  }
  const payload = JSON.parse(
    JSON.stringify(KNOWN_VALID_INSIGHTS_PAYLOAD),
  ) as JsonObject;
  const sections = payload["sections"] as JsonObject;
  Object.assign(sections, wrap(output));
  return payload;
}

describe("referee (a) feed — insights-shaped B3 builder outputs", () => {
  const packageDir = resolve(
    fileURLToPath(new URL(".", import.meta.url)),
    "../../conformance-runner",
  );
  const config = loadCorpusConfig(packageDir);
  const corpus = loadCorpus(
    resolve(packageDir, config.vectorsPath),
    config.sourceCommit,
    config.recordEpoch,
  );
  const deps = createRunnerDeps(config.recordEpoch);

  const fed: ConformanceVector[] = [];
  const skippedErrorVectors: ConformanceVector[] = [];
  for (const vector of corpus.vectors) {
    if (!FEED_SLOTS.has(vector.api)) continue;
    if (Object.hasOwn(vector.expect, "output")) fed.push(vector);
    else skippedErrorVectors.push(vector);
  }

  it("covers every output vector of the five fed apis (none silently dropped)", () => {
    const perApi = new Map<string, number>();
    for (const vector of fed) {
      perApi.set(vector.api, (perApi.get(vector.api) ?? 0) + 1);
    }
    // Every fed api must be present with at least one output vector, and
    // fed + skipped must account for every vector under the fed apis.
    for (const api of FEED_SLOTS.keys()) {
      expect(
        perApi.get(api) ?? 0,
        `no output vectors fed for ${api}`,
      ).toBeGreaterThan(0);
    }
    const total = fed.length + skippedErrorVectors.length;
    const inCorpus = corpus.vectors.filter((v) => FEED_SLOTS.has(v.api)).length;
    expect(total).toBe(inCorpus);
    expect(fed.length).toBeGreaterThanOrEqual(90);
  });

  it("every TS-built fragment is ACCEPTED by the ajv bookmark.json referee (modulo the 4 pinned dataGroupId disclosures)", async () => {
    expect(fed.length).toBeGreaterThan(0);
    const unexpectedRejects: string[] = [];
    const seenExpectedRejects = new Set<string>();
    for (const vector of fed) {
      const implementation = deps.implementations.get(vector.api);
      expect(implementation, `unbound api ${vector.api}`).toBeDefined();
      if (implementation === undefined) continue;
      const kwargs = deps.codecs.decodeInputKwargs(vector.input);
      const returned = await implementation({
        api: vector.api,
        kwargs,
        rawInput: vector.input,
        shims: createShims(config.recordEpoch),
        state: new Map<string, unknown>(),
      });
      // Bindings emit expect-position encodings (JsonNumber wrappers);
      // the canonical writer renders them as plain JSON for ajv.
      const plain: unknown = JSON.parse(canonicalize(returned as JsonValue));
      const verdict = refereeBookmarkPayload(wrapFragment(vector.api, plain));
      if (verdict.valid) continue;
      if (EXPECTED_DATAGROUPID_REJECTS.has(vector.id)) {
        // The pinned disclosure must fail for the DISCLOSED reason only.
        expect(
          verdict.errors.some((e) => e.includes("dataGroupId")),
          `${vector.id} rejected without a dataGroupId error: ${verdict.errors.join("; ")}`,
        ).toBe(true);
        seenExpectedRejects.add(vector.id);
        continue;
      }
      unexpectedRejects.push(`${vector.id}: ${verdict.errors.join("; ")}`);
    }
    expect(unexpectedRejects, unexpectedRejects.join("\n")).toEqual([]);
    // The disclosure set must stay exact: a pinned vector turning ACCEPT
    // means the Python-side fix landed — unpin and close the bug report.
    expect([...seenExpectedRejects].sort()).toEqual(
      [...EXPECTED_DATAGROUPID_REJECTS].sort(),
    );
  });
});
