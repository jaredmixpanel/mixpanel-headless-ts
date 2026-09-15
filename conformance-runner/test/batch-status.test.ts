// Batch-status table + verdict-path wiring (phase2-design C7 item 4,
// packet P2-8, R10.5/D12).
//
// Two semantics under test:
// 1. `'pending'` batch + unbound api → `UNPORTED` (counted, never
//    failing — the pre-P2-8 behavior).
// 2. `'done'` batch + unbound api → `FAIL_ERROR` (a straggler in a
//    declared-complete batch must fail loudly, never silently skip).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  BATCH_STATUS,
  type BatchStatus,
  batchStatusFor,
} from "../src/batch-status.js";
import { CodecRegistry } from "../src/codecs.js";
import type { JsonValue } from "../src/json-value.js";
import { loadCorpus, loadCorpusConfig } from "../src/loader.js";
import { parseLossless } from "../src/lossless-json.js";
import {
  ImplementationRegistry,
  type RunnerDeps,
  runVector,
} from "../src/runner.js";
import type { ConformanceVector } from "../src/vector-types.js";

/** The conformance-runner package root. */
const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const RECORD_EPOCH = "2026-01-15T12:00:00Z";

/**
 * Build runner deps with NOTHING bound (bare registries).
 *
 * The production `createRunnerDeps` binds every ported entry point, so
 * exercising the unbound gate for a done batch requires an empty
 * {@link ImplementationRegistry} — the gate never touches the codecs.
 *
 * @returns Bare runner deps.
 */
function bareDeps(): RunnerDeps {
  return {
    implementations: new ImplementationRegistry(),
    codecs: new CodecRegistry(),
    recordEpoch: RECORD_EPOCH,
  };
}

/**
 * Build a minimal synthetic vector for one api name.
 *
 * @param api - The measured api name.
 * @param setup - Optional setup api names (empty inputs).
 * @returns The vector.
 */
function vectorFor(
  api: string,
  setup: readonly string[] = [],
): ConformanceVector {
  const input = parseLossless("{}") as Record<string, JsonValue>;
  return {
    id: "synthetic/batch-status/test",
    kind: "builder",
    api,
    input,
    setup: setup.map((entry) => ({
      api: entry,
      input: parseLossless("{}") as Record<string, JsonValue>,
    })),
    call: { api, input },
    expect: parseLossless('{"output": null}') as Record<string, JsonValue>,
    bundlePath: "synthetic.jsonl",
  };
}

describe("batchStatusFor — table lookup", () => {
  it("resolves done prefixes (the Phase-1 gate slice + Phase-2 types.*)", () => {
    expect(batchStatusFor("types.Filter.on")).toBe("done");
    expect(batchStatusFor("types.CohortDefinition.to_dict")).toBe("done");
    expect(batchStatusFor("compat.python_str")).toBe("done");
    expect(batchStatusFor("wirestub.wire_get")).toBe("done");
  });

  it("resolves pending entries via a SYNTHETIC table (terminal re-anchor)", () => {
    // B8-gate retirement (b8-packets.md §5.3a / b6-packets.md §12.5):
    // the shipped table has ZERO pending entries, so pending-lookup
    // logic keeps coverage through a fictional-prefix fixture table
    // pinned to `pending` INSIDE THE TEST — never in the shipped table.
    const table: ReadonlyMap<string, BatchStatus> = new Map([
      ["synthetic_batch.", "pending"],
      ["types.", "done"],
    ]);
    expect(batchStatusFor("synthetic_batch.call", table)).toBe("pending");
    expect(batchStatusFor("types.Filter.on", table)).toBe("done");
  });

  it("defaults to pending when no prefix matches", () => {
    expect(batchStatusFor("mystery.call")).toBe("pending");
  });

  it("prefix matching is real prefix matching, not module equality", () => {
    // `types.` must not swallow a hypothetical sibling module.
    expect(batchStatusFor("typesx.something")).toBe("pending");
  });

  it("longest matching prefix wins (injectable table)", () => {
    const table: ReadonlyMap<string, BatchStatus> = new Map([
      ["types.", "done"],
      ["types.Replay", "pending"],
    ]);
    expect(batchStatusFor("types.Filter", table)).toBe("done");
    expect(batchStatusFor("types.ReplayBundle", table)).toBe("pending");
  });

  it("covers every recorded + authored api-name family (no orphan prefixes)", () => {
    const index = JSON.parse(
      readFileSync(resolve(PACKAGE_DIR, "corpus/api-index.json"), "utf8"),
    ) as Record<string, unknown>;
    const authored = JSON.parse(
      readFileSync(resolve(PACKAGE_DIR, "src/authored-apis.json"), "utf8"),
    ) as { entries: Record<string, unknown> };
    const apis = [...Object.keys(index), ...Object.keys(authored.entries)];
    const orphans = apis.filter((api) =>
      [...BATCH_STATUS.keys()].every((p) => !api.startsWith(p)),
    );
    expect(orphans).toEqual([]);
  });

  it("covers every api name in the corpus snapshot itself (measured + setup)", () => {
    // The api-index is emitted from recorded vectors and the authored
    // supplement from the D13 gate — but the verdict path sees the
    // CORPUS, so the table must cover every api the loader yields
    // (e.g. `rrweb_analyzer.*` rides in the snapshot without an
    // api-index row).
    const config = loadCorpusConfig(PACKAGE_DIR);
    const corpus = loadCorpus(
      resolve(PACKAGE_DIR, config.vectorsPath),
      config.sourceCommit,
      config.recordEpoch,
    );
    const orphans = new Set<string>();
    for (const vector of corpus.vectors) {
      for (const api of [
        ...vector.setup.map((entry) => entry.api),
        vector.api,
      ]) {
        if ([...BATCH_STATUS.keys()].every((p) => !api.startsWith(p))) {
          orphans.add(api);
        }
      }
    }
    expect([...orphans]).toEqual([]);
  });

  it("types.* is declared done (the P2-8 flip)", () => {
    expect(BATCH_STATUS.get("types.")).toBe("done");
  });

  it("validation.* + user_validators.* are declared done (the B2 gate flip)", () => {
    // Playbook P3-5 §4: the B2 gate flips exactly these two prefixes;
    // stragglers under them must FAIL, never skip (Risk #8).
    expect(BATCH_STATUS.get("validation.")).toBe("done");
    expect(BATCH_STATUS.get("user_validators.")).toBe("done");
    expect(batchStatusFor("validation.validate_bookmark")).toBe("done");
    expect(batchStatusFor("user_validators.validate_user_args")).toBe("done");
  });

  it("the six B3 builder prefixes are declared done (the B3 gate flip)", () => {
    // Playbook P3-5 §4: the B3 gate flips exactly these six prefixes
    // (bookmark_schema. is count-neutral — zero corpus vectors; packet
    // b3-packets.md §Batch-status); stragglers under them must FAIL,
    // never skip (Risk #8).
    expect(BATCH_STATUS.get("bookmark_builders.")).toBe("done");
    expect(BATCH_STATUS.get("segfilter.")).toBe("done");
    expect(BATCH_STATUS.get("user_builders.")).toBe("done");
    expect(BATCH_STATUS.get("expressions.")).toBe("done");
    expect(BATCH_STATUS.get("transforms.")).toBe("done");
    expect(BATCH_STATUS.get("bookmark_schema.")).toBe("done");
    expect(batchStatusFor("user_builders.filter_to_selector")).toBe("done");
    expect(batchStatusFor("expressions.normalize_on_expression")).toBe("done");
    expect(batchStatusFor("transforms.transform_event")).toBe("done");
    expect(batchStatusFor("bookmark_builders.build_filter_entry")).toBe("done");
    expect(batchStatusFor("segfilter.build_segfilter_entry")).toBe("done");
    expect(batchStatusFor("bookmark_schema.validate_with_pydantic")).toBe(
      "done",
    );
  });

  it("api_client.* + pagination.* are declared done (the B4 gate flip)", () => {
    // Playbook P3-5 §4: the B4 gate flips exactly these two prefixes
    // (single flip at the gate; bound names already replayed while
    // pending); stragglers under them must FAIL, never skip (Risk #8).
    // The B0-era exact-name entry `api_client._iter_jsonl_lines` stays
    // as a shadowed-but-consistent longer prefix (b4-packets flip spec).
    expect(BATCH_STATUS.get("api_client.")).toBe("done");
    expect(BATCH_STATUS.get("pagination.")).toBe("done");
    expect(BATCH_STATUS.get("api_client._iter_jsonl_lines")).toBe("done");
    expect(batchStatusFor("api_client.activity_feed")).toBe("done");
    expect(batchStatusFor("api_client._iter_jsonl_lines")).toBe("done");
    expect(batchStatusFor("pagination.paginate_all")).toBe("done");
  });

  it("replays-family prefixes are declared done (the B5 gate flip)", () => {
    // Playbook P3-5 §4: the B5 gate flipped the three replays-family
    // prefixes (the 44 B5 exact-name `workspace.<member>` entries it
    // also flipped collapsed into the single `workspace.` prefix at
    // the B6 gate — next test).
    expect(BATCH_STATUS.get("replays.")).toBe("done");
    expect(BATCH_STATUS.get("replay_labels.")).toBe("done");
    expect(BATCH_STATUS.get("rrweb_analyzer.")).toBe("done");
    expect(batchStatusFor("replays.fetch_files")).toBe("done");
    expect(batchStatusFor("replay_labels.url_normalizer")).toBe("done");
    expect(batchStatusFor("rrweb_analyzer.analyze")).toBe("done");
  });

  it("workspace.* is a single collapsed done prefix (the B6 gate flip)", () => {
    // Playbook P3-5 §4 B6-gate rule / b6-packets.md §12.1: the 44 B5
    // exact-name entries, the `workspace.list_bookmarks_v2` pending
    // override, and the `workspace.` pending row all COLLAPSED to one
    // `workspace.` → done entry — longest-prefix keeps every B5 name's
    // state equivalent, and the override removal is the B5-gate
    // forward note landing here.
    expect(BATCH_STATUS.get("workspace.")).toBe("done");
    expect(BATCH_STATUS.get("workspace.list_bookmarks_v2")).toBeUndefined();
    expect(BATCH_STATUS.get("workspace.list_bookmarks")).toBeUndefined();
    expect(BATCH_STATUS.get("workspace.build_params")).toBeUndefined();
    // Representative names across B5 + B6 members all resolve done via
    // the single prefix.
    expect(batchStatusFor("workspace.build_params")).toBe("done");
    expect(batchStatusFor("workspace.list_bookmarks")).toBe("done");
    expect(batchStatusFor("workspace.list_bookmarks_v2")).toBe("done");
    expect(batchStatusFor("workspace.me")).toBe("done");
    expect(batchStatusFor("workspace.use")).toBe("done");
    expect(batchStatusFor("workspace.list_dashboards")).toBe("done");
    // Exactly one workspace-prefixed entry remains in the table.
    const workspaceEntries = [...BATCH_STATUS.keys()].filter((p) =>
      p.startsWith("workspace."),
    );
    expect(workspaceEntries).toEqual(["workspace."]);
  });

  it("region_probe.* is declared done (the B7 gate flip)", () => {
    // Playbook P3-5 §4 B7 row / b7-packets.md §4.1: the B7 gate flips
    // exactly this one prefix (14 vectors, all
    // `region_probe.probe_region`, bound at B7-A2); stragglers under
    // it must FAIL, never skip (Risk #8).
    expect(BATCH_STATUS.get("region_probe.")).toBe("done");
    expect(batchStatusFor("region_probe.probe_region")).toBe("done");
  });

  it("oauth_flow.* is declared done and the table is TERMINAL (the B8 gate flip)", () => {
    // Playbook P3-5 §4 B8 row / b8-packets.md §5.1: the B8 gate flips
    // the LAST pending prefix (7 vectors, all
    // `oauth_flow.refresh_tokens`, bound at B8-N2 and passing while
    // pending). Terminal assertions per the §5.3b re-anchor:
    // zero pending entries remain in the shipped table.
    expect(BATCH_STATUS.get("oauth_flow.")).toBe("done");
    expect(batchStatusFor("oauth_flow.refresh_tokens")).toBe("done");
    const pendingEntries = [...BATCH_STATUS]
      .filter(([, status]) => status === "pending")
      .map(([prefix]) => prefix);
    expect(pendingEntries).toEqual([]);
  });

  it("every corpus api name (measured + setup) resolves done (terminal state)", () => {
    // b8-packets.md §5.3b: with the corpus closed, no api the loader
    // yields may resolve `pending` — a pending resolution would mean a
    // silently skippable vector (Risk #8's terminal form).
    const config = loadCorpusConfig(PACKAGE_DIR);
    const corpus = loadCorpus(
      resolve(PACKAGE_DIR, config.vectorsPath),
      config.sourceCommit,
      config.recordEpoch,
    );
    const pending = new Set<string>();
    for (const vector of corpus.vectors) {
      for (const api of [
        ...vector.setup.map((entry) => entry.api),
        vector.api,
      ]) {
        if (batchStatusFor(api) !== "done") {
          pending.add(api);
        }
      }
    }
    expect([...pending]).toEqual([]);
  });
});

describe("runVector — batch-status verdict wiring", () => {
  it("pending batch + unbound api → UNPORTED (counted, never failing)", async () => {
    // Terminal re-anchor (b8-packets.md §5.3a): the shipped table has
    // no pending entries left, so the UNPORTED code path is exercised
    // with a SYNTHETIC pending table injected via the
    // `RunnerDeps.batchStatuses` seam over a mapped-but-unbound api
    // name (`oauth_flow.build_authorize_url` — module-known, never a
    // corpus name; the batch-status logic test's arbitrary-name seam
    // precedent). The fictional table lives only inside this test.
    const deps: RunnerDeps = {
      ...bareDeps(),
      batchStatuses: new Map<string, BatchStatus>([["oauth_flow.", "pending"]]),
    };
    const result = await runVector(
      vectorFor("oauth_flow.build_authorize_url"),
      deps,
    );
    expect(result.verdict).toBe("UNPORTED");
    expect(result.diff).toBeUndefined();
  });

  it("done batch + unbound api → FAIL_ERROR (straggler, no silent skip)", async () => {
    const result = await runVector(vectorFor("types.Filter.on"), bareDeps());
    expect(result.verdict).toBe("FAIL_ERROR");
    expect(result.diff).toContain("types.Filter.on");
    expect(result.diff).toContain("declared done");
  });

  it("done batch + unbound SETUP api → FAIL_ERROR too", async () => {
    const deps = bareDeps();
    deps.implementations.register("api_client.activity_feed", () => null);
    const result = await runVector(
      vectorFor("api_client.activity_feed", ["types.Filter.on"]),
      deps,
    );
    expect(result.verdict).toBe("FAIL_ERROR");
    expect(result.diff).toContain("types.Filter.on");
  });

  it("UNMAPPED_API still fails fast ahead of the batch gate", async () => {
    const result = await runVector(vectorFor("mystery.call"), bareDeps());
    expect(result.verdict).toBe("UNMAPPED_API");
  });
});
