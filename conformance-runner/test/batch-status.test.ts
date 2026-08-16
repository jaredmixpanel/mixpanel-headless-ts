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
  batchStatusFor,
  type BatchStatus,
} from "../src/batch-status.js";
import { parseLossless } from "../src/lossless-json.js";
import { CodecRegistry } from "../src/codecs.js";
import type { JsonValue } from "../src/json-value.js";
import { loadCorpus, loadCorpusConfig } from "../src/loader.js";
import type { RunnerDeps } from "../src/runner.js";
import { ImplementationRegistry, runVector } from "../src/runner.js";
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

  it("resolves pending prefixes (Phase-3 batches)", () => {
    expect(batchStatusFor("workspace.build_funnel_params")).toBe("pending");
    expect(batchStatusFor("api_client.activity_feed")).toBe("pending");
    expect(batchStatusFor("pagination.paginate")).toBe("pending");
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
    const orphans = apis.filter(
      (api) => ![...BATCH_STATUS.keys()].some((p) => api.startsWith(p)),
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
        if (![...BATCH_STATUS.keys()].some((p) => api.startsWith(p))) {
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
});

describe("runVector — batch-status verdict wiring", () => {
  it("pending batch + unbound api → UNPORTED (counted, never failing)", async () => {
    const result = await runVector(
      vectorFor("api_client.activity_feed"),
      bareDeps(),
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
