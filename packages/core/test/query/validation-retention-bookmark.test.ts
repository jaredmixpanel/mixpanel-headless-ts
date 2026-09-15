// `validateBookmark` in retention context — translation of
// `TestValidateBookmarkRetentionB20`, `TestValidateBookmarkRetentionB21` and
// `TestValidateBookmarkRetentionB9MathDispatch` from
// `tests/test_validation_retention.py` (the `validate_retention_args` classes
// are in validation-retention.test.ts and validation-retention-rules.test.ts).
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

// --- Layer 2: rule B20 / rule B21 filter validation (via validate_bookmark) ---

describe("Validate bookmark retention rule B20", () => {
  // python: TestValidateBookmarkRetentionB20
  it("empty filter value list rejected", () => {
    // python: test_empty_filter_value_list_rejected
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

describe("Validate bookmark retention rule B21", () => {
  // python: TestValidateBookmarkRetentionB21
  it("filter value too many rejected", () => {
    // python: test_filter_value_too_many_rejected
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

// --- Layer 2: rule B9 retention math dispatch ---

describe("Validate bookmark retention rule B9 math dispatch", () => {
  // python: TestValidateBookmarkRetentionB9MathDispatch
  it("insights only math rejected for retention", () => {
    // python: test_insights_only_math_rejected_for_retention
    const bookmark = retentionBookmark("dau", []);
    const errors = validateBookmark(bookmark, { bookmark_type: "retention" });
    expect(errors.some((e) => e.code === "B9_INVALID_MATH")).toBe(true);
  });

  it("valid retention math accepted", () => {
    // python: test_valid_retention_math_accepted
    const bookmark = retentionBookmark("retention_rate", []);
    const errors = validateBookmark(bookmark, { bookmark_type: "retention" });
    expect(errors.some((e) => e.code === "B9_INVALID_MATH")).toBe(false);
  });
});
