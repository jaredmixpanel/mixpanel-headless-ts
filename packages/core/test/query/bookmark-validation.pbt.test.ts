/**
 * Layer-3 translation of `tests/unit/test_bookmark_validation_pbt.py`
 * (Python revision: `ts-port/phase2-contract-support` HEAD; 288 LOC,
 * translated in full per b2-packets.md §V1b).
 *
 * Hypothesis `@given` + `@settings(max_examples=100)` translates to
 * fast-check `fc.assert(fc.property(...), { numRuns: 100 })` with the
 * same strategy shapes (V1a `query-validation.pbt.test.ts` precedent).
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  VALID_CHART_TYPES,
  VALID_FILTER_OPERATORS,
  VALID_MATH_FUNNELS,
  VALID_MATH_INSIGHTS,
  VALID_MATH_RETENTION,
} from "../../src/bookmarks/enums.js";
import { validateBookmark } from "../../src/query/validation-bookmark.js";

/** Loose dict, the TS analogue of Python's `dict[str, Any]`. */
type Dict = Record<string, unknown>;

// =============================================================================
// Strategies (test_bookmark_validation_pbt.py:29-45)
// =============================================================================

/** Port of `_all_valid_math`. */
const allValidMath: ReadonlySet<string> = new Set([
  ...VALID_MATH_INSIGHTS,
  ...VALID_MATH_FUNNELS,
  ...VALID_MATH_RETENTION,
]);

/** Port of `invalid_math_strings`. */
const invalidMathStringsArb = fc
  .string({ minLength: 1, maxLength: 30, unit: "binary" })
  .filter((s) => !allValidMath.has(s));

/** Port of `invalid_filter_operators`. */
const invalidFilterOperatorsArb = fc
  .string({ minLength: 1, maxLength: 30, unit: "binary" })
  .filter((s) => !VALID_FILTER_OPERATORS.has(s));

/** Port of `invalid_chart_types`. */
const invalidChartTypesArb = fc
  .string({ minLength: 1, maxLength: 30, unit: "binary" })
  .filter((s) => !VALID_CHART_TYPES.has(s));

// =============================================================================
// Helpers (test_bookmark_validation_pbt.py:53-139)
// =============================================================================

/**
 * Return a minimal valid bookmark params dict.
 *
 * Port of `_minimal_bookmark`.
 *
 * @returns A fresh params dict.
 */
function minimalBookmark(): Dict {
  return {
    sections: {
      show: [
        {
          behavior: {
            type: "event",
            resourceType: "events",
            value: { name: "Login" },
          },
          measurement: {
            math: "total",
          },
        },
      ],
      time: [{ unit: "day", dateRangeType: "in the last", value: 30 }],
      filter: [],
      group: [],
    },
    displayOptions: {
      chartType: "line",
      analysis: "linear",
    },
  };
}

/**
 * Return a minimal bookmark with the given math in `show[0].measurement`.
 *
 * Port of `_bookmark_with_math`.
 *
 * @param math - Math type string to set.
 * @returns A fresh params dict.
 */
function bookmarkWithMath(math: string): Dict {
  const bm = minimalBookmark();
  const sections = bm["sections"] as Dict;
  const show = sections["show"] as Dict[];
  (show[0]!["measurement"] as Dict)["math"] = math;
  return bm;
}

/**
 * Return a minimal bookmark with a filter clause using the given operator.
 *
 * Port of `_bookmark_with_filter`.
 *
 * @param operator - Filter operator string to set.
 * @returns A fresh params dict.
 */
function bookmarkWithFilter(operator: string): Dict {
  const bm = minimalBookmark();
  const sections = bm["sections"] as Dict;
  sections["filter"] = [
    {
      filterType: "string",
      filterOperator: operator,
      value: "country",
      filterValue: ["US"],
      resourceType: "events",
    },
  ];
  return bm;
}

/**
 * Return a minimal bookmark with the given `displayOptions.chartType`.
 *
 * Port of `_bookmark_with_chart_type`.
 *
 * @param chartType - Chart type string to set.
 * @returns A fresh params dict.
 */
function bookmarkWithChartType(chartType: string): Dict {
  const bm = minimalBookmark();
  (bm["displayOptions"] as Dict)["chartType"] = chartType;
  return bm;
}

// =============================================================================
// Math Type Dispatch
// =============================================================================

describe("TestMathTypeDispatch", () => {
  it("test_insights_valid_math_passes", () => {
    fc.assert(
      fc.property(fc.constantFrom(...VALID_MATH_INSIGHTS), (math) => {
        const errors = validateBookmark(bookmarkWithMath(math), {
          bookmark_type: "insights",
        });
        const b9Errors = errors.filter((e) => e.code === "B9_INVALID_MATH");
        expect(
          b9Errors,
          `Valid insights math '${math}' produced B9 error: ${JSON.stringify(
            b9Errors.map((e) => e.message),
          )}`,
        ).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });

  it("test_insights_invalid_math_fails", () => {
    fc.assert(
      fc.property(invalidMathStringsArb, (math) => {
        const errors = validateBookmark(bookmarkWithMath(math), {
          bookmark_type: "insights",
        });
        const b9Codes = new Set(errors.map((e) => e.code));
        expect(
          b9Codes.has("B9_INVALID_MATH"),
          `Invalid insights math '${math}' should produce B9 error, got ${JSON.stringify(
            [...b9Codes],
          )}`,
        ).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("test_funnel_valid_math_passes", () => {
    fc.assert(
      fc.property(fc.constantFrom(...VALID_MATH_FUNNELS), (math) => {
        const errors = validateBookmark(bookmarkWithMath(math), {
          bookmark_type: "funnels",
        });
        const b9Errors = errors.filter((e) => e.code === "B9_INVALID_MATH");
        expect(
          b9Errors,
          `Valid funnel math '${math}' produced B9 error: ${JSON.stringify(
            b9Errors.map((e) => e.message),
          )}`,
        ).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });

  it("test_retention_valid_math_passes", () => {
    fc.assert(
      fc.property(fc.constantFrom(...VALID_MATH_RETENTION), (math) => {
        const errors = validateBookmark(bookmarkWithMath(math), {
          bookmark_type: "retention",
        });
        const b9Errors = errors.filter((e) => e.code === "B9_INVALID_MATH");
        expect(
          b9Errors,
          `Valid retention math '${math}' produced B9 error: ${JSON.stringify(
            b9Errors.map((e) => e.message),
          )}`,
        ).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Filter Enum Consistency
// =============================================================================

describe("TestFilterEnumConsistency", () => {
  it("test_valid_filter_operators_pass", () => {
    fc.assert(
      fc.property(fc.constantFrom(...VALID_FILTER_OPERATORS), (op) => {
        const errors = validateBookmark(bookmarkWithFilter(op));
        const b15Errors = errors.filter(
          (e) => e.code === "B15_INVALID_FILTER_OPERATOR",
        );
        expect(
          b15Errors,
          `Valid filter operator '${op}' produced B15 error: ${JSON.stringify(
            b15Errors.map((e) => e.message),
          )}`,
        ).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });

  it("test_invalid_filter_operators_fail", () => {
    fc.assert(
      fc.property(invalidFilterOperatorsArb, (op) => {
        const errors = validateBookmark(bookmarkWithFilter(op));
        const b15Codes = new Set(errors.map((e) => e.code));
        expect(
          b15Codes.has("B15_INVALID_FILTER_OPERATOR"),
          `Invalid filter operator '${op}' should produce B15 error, got ${JSON.stringify(
            [...b15Codes],
          )}`,
        ).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Chart Type Consistency
// =============================================================================

describe("TestChartTypeConsistency", () => {
  it("test_valid_chart_types_pass", () => {
    fc.assert(
      fc.property(fc.constantFrom(...VALID_CHART_TYPES), (ct) => {
        const errors = validateBookmark(bookmarkWithChartType(ct));
        const b5Errors = errors.filter(
          (e) => e.code === "B5_INVALID_CHART_TYPE",
        );
        expect(
          b5Errors,
          `Valid chart type '${ct}' produced B5 error: ${JSON.stringify(
            b5Errors.map((e) => e.message),
          )}`,
        ).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });

  it("test_invalid_chart_types_fail", () => {
    fc.assert(
      fc.property(invalidChartTypesArb, (ct) => {
        const errors = validateBookmark(bookmarkWithChartType(ct));
        const b5Codes = new Set(errors.map((e) => e.code));
        expect(
          b5Codes.has("B5_INVALID_CHART_TYPE"),
          `Invalid chart type '${ct}' should produce B5 error, got ${JSON.stringify(
            [...b5Codes],
          )}`,
        ).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
