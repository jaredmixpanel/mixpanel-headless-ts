// The batch-status table (`src/batch-status.ts`) and its verdict wiring in
// `runVector`: an unbound api in a `pending` batch replays as `UNPORTED`, an
// unbound api in a `done` batch is a straggler and fails as `FAIL_ERROR`.
// Rig-only; no Python suite is mirrored.
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
 * Build runner deps with nothing bound (bare registries).
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
  it("resolves the compat, wirestub and types prefixes as done", () => {
    expect(batchStatusFor("types.Filter.on")).toBe("done");
    expect(batchStatusFor("types.CohortDefinition.to_dict")).toBe("done");
    expect(batchStatusFor("compat.python_str")).toBe("done");
    expect(batchStatusFor("wirestub.wire_get")).toBe("done");
  });

  it("resolves pending entries of an injected table", () => {
    // The shipped table has no pending entries, so the pending branch is
    // covered through a fictional prefix pinned inside the test.
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
    expect(orphans).toStrictEqual([]);
  });

  it("covers every api name in the corpus snapshot itself (measured + setup)", () => {
    // The api-index is emitted from recorded vectors and the authored
    // supplement is hand-written, but the verdict path sees the corpus, so
    // the table must cover every api the loader yields (e.g.
    // `rrweb_analyzer.*` rides in the snapshot without an api-index row).
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
    expect([...orphans]).toStrictEqual([]);
  });

  it("declares types.* done", () => {
    expect(BATCH_STATUS.get("types.")).toBe("done");
  });

  it("declares validation.* and user_validators.* done", () => {
    expect(BATCH_STATUS.get("validation.")).toBe("done");
    expect(BATCH_STATUS.get("user_validators.")).toBe("done");
    expect(batchStatusFor("validation.validate_bookmark")).toBe("done");
    expect(batchStatusFor("user_validators.validate_user_args")).toBe("done");
  });

  it("declares the six builder prefixes done", () => {
    // `bookmark_schema.` carries zero corpus vectors; it is listed so the
    // two oracle-probed schema apis are covered by the table.
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

  it("declares api_client.* and pagination.* done", () => {
    // The exact-name entry `api_client._iter_jsonl_lines` is a longer
    // prefix shadowed by `api_client.`; both read done.
    expect(BATCH_STATUS.get("api_client.")).toBe("done");
    expect(BATCH_STATUS.get("pagination.")).toBe("done");
    expect(BATCH_STATUS.get("api_client._iter_jsonl_lines")).toBe("done");
    expect(batchStatusFor("api_client.activity_feed")).toBe("done");
    expect(batchStatusFor("api_client._iter_jsonl_lines")).toBe("done");
    expect(batchStatusFor("pagination.paginate_all")).toBe("done");
  });

  it("declares the three replays-family prefixes done", () => {
    expect(BATCH_STATUS.get("replays.")).toBe("done");
    expect(BATCH_STATUS.get("replay_labels.")).toBe("done");
    expect(BATCH_STATUS.get("rrweb_analyzer.")).toBe("done");
    expect(batchStatusFor("replays.fetch_files")).toBe("done");
    expect(batchStatusFor("replay_labels.url_normalizer")).toBe("done");
    expect(batchStatusFor("rrweb_analyzer.analyze")).toBe("done");
  });

  it("covers the whole facade with the single workspace. prefix", () => {
    // No per-member `workspace.<name>` rows remain: every facade member
    // resolves through the one prefix.
    expect(BATCH_STATUS.get("workspace.")).toBe("done");
    expect(BATCH_STATUS.get("workspace.list_bookmarks_v2")).toBeUndefined();
    expect(BATCH_STATUS.get("workspace.list_bookmarks")).toBeUndefined();
    expect(BATCH_STATUS.get("workspace.build_params")).toBeUndefined();
    // Representative members all resolve done via the single prefix.
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
    expect(workspaceEntries).toStrictEqual(["workspace."]);
  });

  it("declares region_probe.* done", () => {
    expect(BATCH_STATUS.get("region_probe.")).toBe("done");
    expect(batchStatusFor("region_probe.probe_region")).toBe("done");
  });

  it("declares oauth_flow.* done and ships no pending entry at all", () => {
    expect(BATCH_STATUS.get("oauth_flow.")).toBe("done");
    expect(batchStatusFor("oauth_flow.refresh_tokens")).toBe("done");
    const pendingEntries = [...BATCH_STATUS]
      .filter(([, status]) => status === "pending")
      .map(([prefix]) => prefix);
    expect(pendingEntries).toStrictEqual([]);
  });

  it("resolves every corpus api name (measured + setup) as done", () => {
    // A pending resolution would mean a silently skippable vector.
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
    expect([...pending]).toStrictEqual([]);
  });
});

describe("runVector — batch-status verdict wiring", () => {
  it("replays an unbound api of a pending batch as UNPORTED", async () => {
    // The shipped table has no pending entries, so the UNPORTED path is
    // exercised with a synthetic pending table injected through the
    // `RunnerDeps.batchStatuses` seam over a mapped-but-unbound api name
    // (`oauth_flow.build_authorize_url` is module-known, never a corpus
    // name).
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

  it("fails an unbound api of a done batch as FAIL_ERROR", async () => {
    const result = await runVector(vectorFor("types.Filter.on"), bareDeps());
    expect(result.verdict).toBe("FAIL_ERROR");
    expect(result.diff).toContain("types.Filter.on");
    expect(result.diff).toContain("declared done");
  });

  it("fails an unbound setup api of a done batch as FAIL_ERROR too", async () => {
    const deps = bareDeps();
    deps.implementations.register("api_client.activity_feed", () => null);
    const result = await runVector(
      vectorFor("api_client.activity_feed", ["types.Filter.on"]),
      deps,
    );
    expect(result.verdict).toBe("FAIL_ERROR");
    expect(result.diff).toContain("types.Filter.on");
  });

  it("reports UNMAPPED_API ahead of the batch gate", async () => {
    const result = await runVector(vectorFor("mystery.call"), bareDeps());
    expect(result.verdict).toBe("UNMAPPED_API");
  });
});
