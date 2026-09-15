// Referee feed: every insights-shaped `bookmark_builders.*` output is built
// through the same binding the runner replays, injected into the minimal
// valid InsightsBookmarkParams skeleton at its section slot, and must pass
// the ajv bookmark.json referee; `workspace.build_params` outputs are fed
// as-is. Common-shaped date ranges and flows-shaped builders are excluded.

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  canonicalize,
  type ConformanceVector,
  createRunnerDeps,
  createShims,
  type JsonValue,
  loadCorpus,
  loadCorpusConfig,
} from "@mixpanel-headless/conformance-runner";

import {
  type JsonObject,
  KNOWN_VALID_INSIGHTS_PAYLOAD,
} from "../referees/bookmark-schema/known-payloads.js";
import { refereeBookmarkPayload } from "../referees/bookmark-schema/referee.js";

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
 * Apis whose output IS a full `InsightsBookmarkParams` payload, fed as-is
 * with no skeleton wrap (B5 gate, b5-packets.md §7.4 / the D15b
 * routing-table "as-is" row).
 */
const FULL_PAYLOAD_APIS: ReadonlySet<string> = new Set([
  "workspace.build_params",
]);

/**
 * Whether an api participates in this feed (section-slot or full-payload).
 *
 * @param api - The vector's api name.
 * @returns True when the api's output vectors are fed to the referee.
 */
function isFedApi(api: string): boolean {
  return FEED_SLOTS.has(api) || FULL_PAYLOAD_APIS.has(api);
}

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

describe("referee feed — insights-shaped builder outputs", () => {
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
    if (!isFedApi(vector.api)) continue;
    if (Object.hasOwn(vector.expect, "output")) fed.push(vector);
    else skippedErrorVectors.push(vector);
  }

  it("covers every output vector of the six fed apis (none silently dropped)", () => {
    const perApi = new Map<string, number>();
    for (const vector of fed) {
      perApi.set(vector.api, (perApi.get(vector.api) ?? 0) + 1);
    }
    // Every fed api must be present with at least one output vector, and
    // fed + skipped must account for every vector under the fed apis.
    for (const api of [...FEED_SLOTS.keys(), ...FULL_PAYLOAD_APIS]) {
      expect(
        perApi.get(api) ?? 0,
        `no output vectors fed for ${api}`,
      ).toBeGreaterThan(0);
    }
    const total = fed.length + skippedErrorVectors.length;
    const inCorpus = corpus.vectors.filter((v) => isFedApi(v.api)).length;
    expect(total).toBe(inCorpus);
    // 99 builder-fragment vectors (98 B3 + the FIX-1
    // `test_no_custom_property_nesting` addition) + the 127 B5
    // `workspace.build_params` full payloads (115 + the 10
    // `test_workspace_report_links` seam hits from Python PR #223,
    // corpus re-sync 2026-09-03, + the 2 `test_query_limit` `run_params`
    // seam hits from Python PR #225, corpus re-pin 2026-09-14 @ 0dde506).
    expect(fed.length).toBeGreaterThanOrEqual(200);
    expect(perApi.get("workspace.build_params")).toBe(127);
  });

  it("every TS-built fragment is ACCEPTED by the ajv bookmark.json referee (no standing disclosures)", async () => {
    expect(fed.length).toBeGreaterThan(0);
    const unexpectedRejects: string[] = [];
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
      // Full-payload apis feed as-is (D15b routing "as-is" row); the
      // fragment apis are injected into the skeleton's section slot.
      const payload = FULL_PAYLOAD_APIS.has(vector.api)
        ? (plain as JsonObject)
        : wrapFragment(vector.api, plain);
      const verdict = refereeBookmarkPayload(payload);
      if (verdict.valid) continue;
      unexpectedRejects.push(`${vector.id}: ${verdict.errors.join("; ")}`);
    }
    // The R10.7 dataGroupId disclosure pins retired with the four-bug
    // batch re-pin — ANY reject is a new finding and blocks.
    expect(unexpectedRejects, unexpectedRejects.join("\n")).toStrictEqual([]);
  });
});
