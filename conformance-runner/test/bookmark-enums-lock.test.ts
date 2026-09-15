// bookmark-enum lock: the packages/core/src/bookmarks/enums.ts tables must
// canonical-diff clean, constant by constant, against the extracted
// corpus/enums/bookmark_enums.json (34 constants), and must be real
// ReadonlySet/ReadonlyMap membership tables rather than look-alikes.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  BOOKMARK_ENUM_TABLES,
  BOOKMARK_ENUMS_SOURCE_MODULE,
  bookmarkEnumTablesSnapshot,
  MAX_CONVERSION_WINDOW,
  VALID_CHART_TYPES,
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

describe("bookmark-enum lock", () => {
  it("mirrors the extractor's source module and constant count", () => {
    expect(BOOKMARK_ENUMS_SOURCE_MODULE).toBe(vector.source_module);
    expect(Object.keys(vector.constants)).toHaveLength(34);
    expect(BOOKMARK_ENUM_TABLES.size).toBe(34);
  });

  it("TS tables key exactly the vector's constant names", () => {
    expect([...BOOKMARK_ENUM_TABLES.keys()].sort()).toStrictEqual(
      Object.keys(vector.constants).sort(),
    );
  });

  it("every constant's normalized snapshot equals the vector's", () => {
    const snapshot = bookmarkEnumTablesSnapshot();
    for (const [name, expected] of Object.entries(vector.constants)) {
      expect(snapshot[name], `constant ${name} drifted`).toStrictEqual(
        expected,
      );
    }
  });

  it("frozensets ported as ReadonlySet and the dict as ReadonlyMap", () => {
    for (const [name, table] of BOOKMARK_ENUM_TABLES) {
      const expected = name === "MAX_CONVERSION_WINDOW" ? Map : Set;
      expect(table, `${name} must be a ${expected.name}`).toBeInstanceOf(
        expected,
      );
    }
  });

  it("membership checks work through .has() as consumers will call them", () => {
    // Spot checks mirroring how the validators consume the tables.
    expect(VALID_CHART_TYPES.has("funnel-steps")).toBe(true);
    expect(VALID_CHART_TYPES.has("not-a-chart")).toBe(false);
    // Prototype-pollution honesty (why these are Sets): Python `in`
    // returns False for "constructor"; so must .has().
    expect(VALID_CHART_TYPES.has("constructor")).toBe(false);
    expect(MAX_CONVERSION_WINDOW.get("day")).toBe(367);
    expect(MAX_CONVERSION_WINDOW.has("constructor")).toBe(false);
  });
});
