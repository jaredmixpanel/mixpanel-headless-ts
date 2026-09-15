/**
 * Layer-3 translation of the `validate_bookmark` classes of
 * `tests/test_validation_retention.py` (Python revision:
 * `ts-port/phase2-contract-support` HEAD; 1,087 LOC).
 *
 * Scope per b2-packets.md §V1b: `TestValidateBookmarkRetentionB20` (1),
 * `TestValidateBookmarkRetentionB21` (1) and
 * `TestValidateBookmarkRetentionB9MathDispatch` (2) — the four tests
 * shard V1a deferred (`validation-retention.test.ts` header). The
 * `validate_retention_args` classes of the same source file are V1a's.
 *
 * R10.2: assertion-for-assertion.
 */

import { describe, expect, it } from "vitest";

import { validateBookmark } from "../../src/query/validation-bookmark.js";

/** Loose dict, the TS analogue of Python's `dict[str, Any]`. */
type Dict = Record<string, unknown>;

/**
 * Build the retention bookmark skeleton the four Python tests share.
 *
 * @param math - `measurement.math` for the single show clause.
 * @param filters - The `sections.filter` list.
 * @returns A fresh params dict.
 */
function retentionBookmark(math: string, filters: Dict[]): Dict {
  return {
    sections: {
      show: [
        {
          behavior: {
            type: "event",
            resourceType: "events",
            value: { name: "Signup" },
          },
          measurement: { math },
        },
      ],
      time: [{ unit: "day", dateRangeType: "in the last", value: 30 }],
      filter: filters,
      group: [],
    },
    displayOptions: { chartType: "line", analysis: "linear" },
  };
}

// =============================================================================
// Layer 2: B20/B21 filter validation (via validate_bookmark)
// =============================================================================

describe("TestValidateBookmarkRetentionB20", () => {
  it("test_empty_filter_value_list_rejected", () => {
    const bookmark = retentionBookmark("retention_rate", [
      {
        filterType: "string",
        filterOperator: "in",
        filterValue: [],
        propertyObjectKey: "properties",
        resourceType: "events",
        propertyName: "country",
      },
    ]);
    const errors = validateBookmark(bookmark, { bookmark_type: "retention" });
    expect(errors.some((e) => e.code === "B20_EMPTY_FILTER_VALUE")).toBe(true);
  });
});

describe("TestValidateBookmarkRetentionB21", () => {
  it("test_filter_value_too_many_rejected", () => {
    const filterValue = Array.from(
      { length: 1001 },
      (_unused, i) => `val_${String(i)}`,
    );
    const bookmark = retentionBookmark("retention_rate", [
      {
        filterType: "string",
        filterOperator: "in",
        filterValue,
        propertyObjectKey: "properties",
        resourceType: "events",
        propertyName: "country",
      },
    ]);
    const errors = validateBookmark(bookmark, { bookmark_type: "retention" });
    expect(errors.some((e) => e.code === "B21_FILTER_VALUE_TOO_MANY")).toBe(
      true,
    );
  });
});

// =============================================================================
// Layer 2: B9 retention math dispatch
// =============================================================================

describe("TestValidateBookmarkRetentionB9MathDispatch", () => {
  it("test_insights_only_math_rejected_for_retention", () => {
    const bookmark = retentionBookmark("dau", []);
    const errors = validateBookmark(bookmark, { bookmark_type: "retention" });
    expect(errors.some((e) => e.code === "B9_INVALID_MATH")).toBe(true);
  });

  it("test_valid_retention_math_accepted", () => {
    const bookmark = retentionBookmark("retention_rate", []);
    const errors = validateBookmark(bookmark, { bookmark_type: "retention" });
    expect(errors.some((e) => e.code === "B9_INVALID_MATH")).toBe(false);
  });
});
