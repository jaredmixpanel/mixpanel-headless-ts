// Loader tests (src/loader.ts, task TS-4): full-snapshot enumeration plus
// integrity-check unit tests over synthetic mini-corpora.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { JsonNumber } from "../src/json-value.js";
import {
  CorpusIntegrityError,
  loadCorpus,
  loadCorpusConfig,
} from "../src/loader.js";

/** The conformance-runner package root. */
const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** A fake 40-char commit SHA for synthetic corpora. */
const FAKE_SHA = "a".repeat(40);

/** Temp directories created by makeMiniCorpus, removed after each test. */
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Build a synthetic one-bundle corpus directory.
 *
 * @param options - Overrides for the manifest/bundle/vector defaults.
 * @returns The corpus directory path.
 */
function makeMiniCorpus(options?: {
  readonly manifestCommit?: string;
  readonly bundleCommit?: string;
  readonly declaredCount?: number;
  readonly total?: number;
  readonly vectorIds?: readonly string[];
  readonly recordEpoch?: string;
}): string {
  const dir = mkdtempSync(join(tmpdir(), "ts4-loader-"));
  tempDirs.push(dir);
  const ids = options?.vectorIds ?? ["filters/segfilter/test_a"];
  const manifest = {
    schema_version: "1.0",
    source_commit: options?.manifestCommit ?? FAKE_SHA,
    extraction_date: "2026-08-14",
    record_epoch: options?.recordEpoch ?? "2026-01-15T12:00:00Z",
    counts: { total: options?.total ?? ids.length },
  };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  const header = {
    $bundle: {
      source_commit: options?.bundleCommit ?? FAKE_SHA,
      source_file: "tests/unit/test_a.py",
      count: options?.declaredCount ?? ids.length,
    },
  };
  const lines = [JSON.stringify(header)];
  for (const id of ids) {
    lines.push(
      JSON.stringify({
        id,
        kind: "builder",
        call: {
          api: "segfilter.build_segfilter_entry",
          input: { value: 18.0 },
        },
        expect: { output: { ok: true } },
      }),
    );
  }
  mkdirSync(join(dir, "filters"), { recursive: true });
  writeFileSync(join(dir, "filters", "test_a.jsonl"), `${lines.join("\n")}\n`);
  return dir;
}

/**
 * Write one authored bundle (`authored/bundle.jsonl`) into a mini corpus.
 *
 * Every vector line carries `origin: "authored"` so the bundle stays
 * outside the manifest `counts.total` reconciliation (design D13/D3.1).
 *
 * @param dir - The corpus directory returned by makeMiniCorpus.
 * @param header - `$bundle` header fields merged over the declared count
 *   (pass `count` to override it).
 * @param ids - Vector ids to emit, one line each.
 */
function addAuthoredBundle(
  dir: string,
  header: Record<string, unknown>,
  ids: readonly string[],
): void {
  const lines = [JSON.stringify({ $bundle: { count: ids.length, ...header } })];
  for (const id of ids) {
    lines.push(
      JSON.stringify({
        id,
        kind: "builder",
        origin: "authored",
        call: {
          api: "segfilter.build_segfilter_entry",
          input: { value: 1 },
        },
        expect: { output: { ok: true } },
      }),
    );
  }
  mkdirSync(join(dir, "authored"), { recursive: true });
  writeFileSync(join(dir, "authored", "bundle.jsonl"), `${lines.join("\n")}\n`);
}

describe("loadCorpus on the committed snapshot (TS-4 done criterion)", () => {
  const config = loadCorpusConfig(PACKAGE_DIR);
  const corpus = loadCorpus(
    resolve(PACKAGE_DIR, config.vectorsPath),
    config.sourceCommit,
    config.recordEpoch,
  );

  /**
   * Extracted (record-pipeline) vectors only: manifest counts cover the
   * extraction, not the hand-authored D13/D3.1 additions.
   */
  const extracted = corpus.vectors.filter(
    (vector) => vector.origin !== "authored",
  );

  it("enumerates the full snapshot and matches the manifest total", () => {
    expect(corpus.manifest.sourceCommit).toBe(config.sourceCommit);
    expect(extracted).toHaveLength(corpus.manifest.total);
    expect(corpus.vectors.length).toBeGreaterThanOrEqual(extracted.length);
    expect(corpus.vectors.length).toBeGreaterThanOrEqual(2500);
    expect(corpus.bundles.length).toBeGreaterThanOrEqual(100);
  });

  it("carries unique ids and non-empty call.api on every vector", () => {
    const ids = new Set(corpus.vectors.map((vector) => vector.id));
    expect(ids.size).toBe(corpus.vectors.length);
    for (const vector of corpus.vectors) {
      expect(vector.api.length).toBeGreaterThan(0);
    }
  });

  it("reconciles per-kind counts against the manifest ledger", () => {
    const byKind = new Map<string, number>();
    for (const vector of extracted) {
      byKind.set(vector.kind, (byKind.get(vector.kind) ?? 0) + 1);
    }
    const counts = corpus.manifest.raw["counts"] as Record<string, unknown>;
    const manifestByKind = counts["by_kind"] as Record<string, JsonNumber>;
    for (const [kind, declared] of Object.entries(manifestByKind)) {
      expect(byKind.get(kind) ?? 0).toBe(declared.toNumber());
    }
  });

  it("preserves raw number tokens (lossless loading, D6 rule 3)", () => {
    let sawToken = false;
    const scan = (value: unknown): void => {
      if (sawToken) {
        return;
      }
      if (value instanceof JsonNumber) {
        sawToken = true;
      } else if (Array.isArray(value)) {
        for (const item of value) {
          scan(item);
        }
      } else if (typeof value === "object" && value !== null) {
        for (const member of Object.values(value)) {
          scan(member);
        }
      }
    };
    for (const vector of corpus.vectors) {
      scan(vector.call);
      scan(vector.expect);
      if (sawToken) {
        break;
      }
    }
    expect(sawToken).toBe(true);
  });
});

describe("loadCorpus integrity checks (synthetic corpora)", () => {
  it("accepts a well-formed mini corpus", () => {
    const corpus = loadCorpus(makeMiniCorpus(), FAKE_SHA);
    expect(corpus.vectors).toHaveLength(1);
    expect(corpus.vectors[0]?.api).toBe("segfilter.build_segfilter_entry");
    expect(corpus.bundles[0]?.sourceFile).toBe("tests/unit/test_a.py");
  });

  it("refuses a source-commit pin mismatch (D12 drift protection)", () => {
    expect(() => loadCorpus(makeMiniCorpus(), "b".repeat(40))).toThrow(
      CorpusIntegrityError,
    );
    expect(() => loadCorpus(makeMiniCorpus(), "b".repeat(40))).toThrow(
      /drifted snapshot/,
    );
  });

  it("refuses a record-epoch mismatch when a pin is provided", () => {
    expect(() =>
      loadCorpus(makeMiniCorpus(), FAKE_SHA, "1999-01-01T00:00:00Z"),
    ).toThrow(/record_epoch/);
  });

  it("refuses bundle headers whose commit disagrees with the manifest", () => {
    const dir = makeMiniCorpus({ bundleCommit: "c".repeat(40) });
    expect(() => loadCorpus(dir, FAKE_SHA)).toThrow(/\$bundle source_commit/);
  });

  it("accepts authored bundles stamped with their authoring-time commit", () => {
    const dir = makeMiniCorpus();
    addAuthoredBundle(
      dir,
      {
        source_commit: "c".repeat(40),
        source_file: "conformance/vectors/authored/bundle.jsonl",
      },
      ["compat/segfilter/authored-a"],
    );
    const corpus = loadCorpus(dir, FAKE_SHA);
    expect(corpus.vectors).toHaveLength(2);
    const bundle = corpus.bundles.find((b) => b.path.startsWith("authored"));
    expect(bundle?.sourceCommit).toBe("c".repeat(40));
    expect(bundle?.sourceFile).toBe(
      "conformance/vectors/authored/bundle.jsonl",
    );
  });

  it("accepts harvest-style authored headers without source_commit", () => {
    const dir = makeMiniCorpus();
    addAuthoredBundle(
      dir,
      {
        generator: "conformance/record/harvest_storybook.py",
        source_root: "analytics/iron/.storybook/mocks/api",
      },
      ["parse/workspace/authored-storybook-a"],
    );
    const corpus = loadCorpus(dir, FAKE_SHA);
    expect(corpus.vectors).toHaveLength(2);
    const bundle = corpus.bundles.find((b) => b.path.startsWith("authored"));
    expect(bundle?.sourceCommit).toBeUndefined();
    expect(bundle?.sourceFile).toBeUndefined();
  });

  it("still refuses count mismatches in authored bundles", () => {
    const dir = makeMiniCorpus();
    addAuthoredBundle(dir, { source_commit: "c".repeat(40), count: 9 }, [
      "compat/segfilter/authored-a",
    ]);
    expect(() => loadCorpus(dir, FAKE_SHA)).toThrow(/count 9 != 1/);
  });

  it("refuses bundles whose declared count disagrees with actual lines", () => {
    const dir = makeMiniCorpus({ declaredCount: 5 });
    expect(() => loadCorpus(dir, FAKE_SHA)).toThrow(/count 5 != 1/);
  });

  it("refuses duplicate vector ids", () => {
    const dir = makeMiniCorpus({
      vectorIds: ["filters/segfilter/test_dup", "filters/segfilter/test_dup"],
      total: 2,
    });
    expect(() => loadCorpus(dir, FAKE_SHA)).toThrow(/duplicate vector id/);
  });

  it("refuses a manifest total that disagrees with loaded vectors", () => {
    const dir = makeMiniCorpus({ total: 7 });
    expect(() => loadCorpus(dir, FAKE_SHA)).toThrow(/counts\.total/);
  });
});

describe("loadCorpusConfig", () => {
  it("reads the committed pin", () => {
    const config = loadCorpusConfig(PACKAGE_DIR);
    expect(config.vectorsPath).toBe("./corpus");
    expect(config.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(config.recordEpoch).toBe("2026-01-15T12:00:00Z");
  });
});
