// C8(d) bookmark-enum snapshot lock (phase2-design C2): the
// packages/core/src/bookmarks/enums.ts tables must canonical-diff
// clean, constant by constant, against the extracted vector file
// conformance-runner/corpus/enums/bookmark_enums.json
// (source_module mixpanel_headless._internal.bookmark_enums, 34
// constants; extractor normalization = lists sorted, dict keys
// sorted).
//
// Anti-vacuity: the tables must be REAL ReadonlySet/ReadonlyMap
// membership tables (R4.8, membership via .has()) — not arrays or
// plain objects that happen to serialize identically.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BOOKMARK_ENUM_TABLES,
  BOOKMARK_ENUMS_SOURCE_MODULE,
  MAX_CONVERSION_WINDOW,
  VALID_CHART_TYPES,
  bookmarkEnumTablesSnapshot,
} from "@mixpanel-headless/core/internal";

/** The repo root (this file lives in conformance-runner/test). */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Path of the synced extracted enum vector file. */
const VECTOR_PATH = resolve(
  REPO_ROOT,
  "conformance-runner/corpus/enums/bookmark_enums.json",
);

/** Parsed shape of bookmark_enums.json (extractor output). */
interface BookmarkEnumsVector {
  readonly constants: Readonly<
    Record<string, readonly string[] | Readonly<Record<string, number>>>
  >;
  readonly source_module: string;
}

const vector = JSON.parse(
  readFileSync(VECTOR_PATH, "utf8"),
) as BookmarkEnumsVector;

describe("C8(d) bookmark-enum lock", () => {
  it("mirrors the extractor's source module and constant count", () => {
    expect(BOOKMARK_ENUMS_SOURCE_MODULE).toBe(vector.source_module);
    expect(Object.keys(vector.constants)).toHaveLength(34);
    expect(BOOKMARK_ENUM_TABLES.size).toBe(34);
  });

  it("TS tables key exactly the vector's constant names", () => {
    expect([...BOOKMARK_ENUM_TABLES.keys()].sort()).toEqual(
      Object.keys(vector.constants).sort(),
    );
  });

  it("every constant's normalized snapshot equals the vector's", () => {
    const snapshot = bookmarkEnumTablesSnapshot();
    for (const [name, expected] of Object.entries(vector.constants)) {
      expect(snapshot[name], `constant ${name} drifted`).toEqual(expected);
    }
  });

  it("frozensets ported as ReadonlySet and the dict as ReadonlyMap (R4.8)", () => {
    for (const [name, table] of BOOKMARK_ENUM_TABLES) {
      if (name === "MAX_CONVERSION_WINDOW") {
        expect(table).toBeInstanceOf(Map);
      } else {
        expect(table, `${name} must be a Set`).toBeInstanceOf(Set);
      }
    }
  });

  it("membership checks work through .has() as consumers will call them", () => {
    // Spot checks mirroring the C10 consumer note (B2/B3 validators).
    expect(VALID_CHART_TYPES.has("funnel-steps")).toBe(true);
    expect(VALID_CHART_TYPES.has("not-a-chart")).toBe(false);
    // Prototype-pollution honesty (the R4.8 rationale): Python `in`
    // returns False for "constructor"; so must .has().
    expect(VALID_CHART_TYPES.has("constructor")).toBe(false);
    expect(MAX_CONVERSION_WINDOW.get("day")).toBe(367);
    expect(MAX_CONVERSION_WINDOW.has("constructor")).toBe(false);
  });
});
