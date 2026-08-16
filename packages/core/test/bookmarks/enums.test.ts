/**
 * Layer-3 translation of `tests/unit/test_bookmark_enums.py` (Python
 * revision: `ts-port/phase2-contract-support` HEAD; 270 LOC, 6 classes).
 *
 * Scope per b3-packets.md §K1: all six classes
 * (`TestMathTypeCompleteness`, `TestPerUserAggregationCompleteness`,
 * `TestPropertyTypeCompleteness`, `TestEnumCardinality`,
 * `TestNewEnumConstants`, `TestExtendedMathFunnels`). The tables
 * themselves landed at P2-3 in `src/bookmarks/enums.ts`; this file is
 * the missing lock.
 *
 * R10.2: assertion-for-assertion. Python `frozenset` subset/equality
 * asserts become explicit set operations here — `<=` is
 * {@link isSubset}, `==` is {@link setEquals} — never weakened to
 * "contains some".
 *
 * The Python `isinstance(X, frozenset)` asserts (immutability intent)
 * translate to `instanceof Set` plus the compile-time `ReadonlySet`
 * annotation on the export; there is no frozen-Set primitive in JS, so
 * the runtime half of that assertion is the type check.
 */

import { describe, it, expect } from "vitest";
import {
  MATH_NO_PER_USER,
  MATH_PROPERTY_OPTIONAL,
  MATH_REQUIRING_PROPERTY,
  VALID_ANALYSIS_TYPES,
  VALID_CHART_TYPES,
  VALID_CONVERSION_WINDOW_UNITS,
  VALID_FILTER_OPERATORS,
  VALID_FILTERS_DETERMINER,
  VALID_FLOWS_CHART_TYPES,
  VALID_FLOWS_COUNT_TYPES,
  VALID_FUNNEL_ORDER,
  VALID_MATH_FUNNELS,
  VALID_MATH_INSIGHTS,
  VALID_MATH_RETENTION,
  VALID_MATH_TYPES,
  VALID_METRIC_TYPES,
  VALID_PER_USER_AGGREGATIONS,
  VALID_PROPERTY_TYPES,
  VALID_QUERY_TIME_UNITS,
  VALID_RESOURCE_TYPES,
  VALID_RETENTION_ALIGNMENT,
  VALID_RETENTION_UNITS,
  VALID_TIME_UNITS,
} from "../../src/bookmarks/enums.js";
import {
  FILTER_PROPERTY_TYPE_VALUES,
  MATH_TYPE_VALUES,
  PER_USER_AGGREGATION_VALUES,
} from "../../src/types/literals.js";

/**
 * Python `set <= set`.
 *
 * @param sub - Candidate subset.
 * @param sup - Candidate superset.
 * @returns Members of `sub` missing from `sup` (empty when `sub <= sup`).
 */
function missingFrom(
  sub: Iterable<string>,
  sup: ReadonlySet<string>,
): string[] {
  return [...sub].filter((v) => !sup.has(v)).sort();
}

/**
 * Python `set(a) == set(b)` rendered as a sorted-array comparison so
 * failures print the diff.
 *
 * @param actual - The set under test.
 * @returns The members, sorted.
 */
function sorted(actual: Iterable<string>): string[] {
  return [...actual].sort();
}

/**
 * Python set difference `a - b`.
 *
 * @param a - Left operand.
 * @param b - Right operand.
 * @returns A new set of members of `a` not in `b`.
 */
function difference(a: Iterable<string>, b: ReadonlySet<string>): Set<string> {
  return new Set([...a].filter((v) => !b.has(v)));
}

/**
 * Python set intersection `a & b`.
 *
 * @param a - Left operand.
 * @param b - Right operand.
 * @returns A new set of members present in both.
 */
function intersection(
  a: ReadonlySet<string>,
  b: ReadonlySet<string>,
): Set<string> {
  return new Set([...a].filter((v) => b.has(v)));
}

describe("TestMathTypeCompleteness", () => {
  // Port of `USER_FACING_ALIASES` (`test_bookmark_enums.py:49`).
  const USER_FACING_ALIASES: ReadonlySet<string> = new Set(["percentile"]);

  it("test_math_type_literal_subset_of_insights", () => {
    const literalValues = difference(MATH_TYPE_VALUES, USER_FACING_ALIASES);
    expect(missingFrom(literalValues, VALID_MATH_INSIGHTS)).toEqual([]);
  });

  it("test_math_type_literal_subset_of_all", () => {
    const literalValues = difference(MATH_TYPE_VALUES, USER_FACING_ALIASES);
    expect(missingFrom(literalValues, VALID_MATH_TYPES)).toEqual([]);
  });

  it("test_insights_subset_of_all", () => {
    expect(missingFrom(VALID_MATH_INSIGHTS, VALID_MATH_TYPES)).toEqual([]);
  });

  it("test_funnels_subset_of_all", () => {
    expect(missingFrom(VALID_MATH_FUNNELS, VALID_MATH_TYPES)).toEqual([]);
  });

  it("test_retention_subset_of_all", () => {
    expect(missingFrom(VALID_MATH_RETENTION, VALID_MATH_TYPES)).toEqual([]);
  });

  it("test_requiring_property_subset_of_insights", () => {
    expect(
      missingFrom(
        difference(MATH_REQUIRING_PROPERTY, USER_FACING_ALIASES),
        VALID_MATH_INSIGHTS,
      ),
    ).toEqual([]);
  });

  it("test_property_optional_subset_of_insights", () => {
    expect(missingFrom(MATH_PROPERTY_OPTIONAL, VALID_MATH_INSIGHTS)).toEqual(
      [],
    );
  });

  it("test_no_per_user_subset_of_insights", () => {
    expect(missingFrom(MATH_NO_PER_USER, VALID_MATH_INSIGHTS)).toEqual([]);
  });

  it("test_no_overlap_requiring_and_optional", () => {
    expect(
      sorted(intersection(MATH_REQUIRING_PROPERTY, MATH_PROPERTY_OPTIONAL)),
    ).toEqual([]);
  });
});

describe("TestPerUserAggregationCompleteness", () => {
  it("test_literal_subset_of_valid", () => {
    expect(
      missingFrom(PER_USER_AGGREGATION_VALUES, VALID_PER_USER_AGGREGATIONS),
    ).toEqual([]);
  });
});

describe("TestPropertyTypeCompleteness", () => {
  it("test_filter_property_type_subset", () => {
    expect(
      missingFrom(FILTER_PROPERTY_TYPE_VALUES, VALID_PROPERTY_TYPES),
    ).toEqual([]);
  });
});

describe("TestEnumCardinality", () => {
  it("test_valid_math_types_size", () => {
    expect(VALID_MATH_TYPES.size).toBeGreaterThanOrEqual(20);
  });

  it("test_valid_math_insights_size", () => {
    expect(VALID_MATH_INSIGHTS.size).toBeGreaterThanOrEqual(15);
  });

  it("test_valid_per_user_size", () => {
    expect(VALID_PER_USER_AGGREGATIONS.size).toBeGreaterThanOrEqual(5);
  });

  it("test_valid_property_types_size", () => {
    expect(VALID_PROPERTY_TYPES.size).toBeGreaterThanOrEqual(6);
  });

  it("test_valid_time_units_size", () => {
    expect(VALID_TIME_UNITS.size).toBeGreaterThanOrEqual(7);
  });

  it("test_valid_query_time_units_size", () => {
    expect(missingFrom(VALID_TIME_UNITS, VALID_QUERY_TIME_UNITS)).toEqual([]);
  });

  it("test_valid_resource_types_size", () => {
    expect(VALID_RESOURCE_TYPES.size).toBeGreaterThanOrEqual(6);
  });

  it("test_valid_metric_types_size", () => {
    expect(VALID_METRIC_TYPES.size).toBeGreaterThanOrEqual(8);
  });

  it("test_valid_chart_types_size", () => {
    expect(VALID_CHART_TYPES.size).toBeGreaterThanOrEqual(8);
  });

  it("test_valid_filter_operators_size", () => {
    expect(VALID_FILTER_OPERATORS.size).toBeGreaterThanOrEqual(20);
  });

  it("test_valid_filters_determiner_values", () => {
    expect(sorted(VALID_FILTERS_DETERMINER)).toEqual(["all", "any"]);
  });

  it("test_valid_analysis_types_values", () => {
    expect(sorted(VALID_ANALYSIS_TYPES)).toEqual([
      "cumulative",
      "linear",
      "logarithmic",
      "rolling",
    ]);
  });
});

describe("TestNewEnumConstants", () => {
  it("test_valid_funnel_order_values", () => {
    expect(sorted(VALID_FUNNEL_ORDER)).toEqual(["any", "loose"]);
  });

  it("test_valid_funnel_order_is_frozenset", () => {
    expect(VALID_FUNNEL_ORDER).toBeInstanceOf(Set);
  });

  it("test_valid_conversion_window_units_values", () => {
    expect(sorted(VALID_CONVERSION_WINDOW_UNITS)).toEqual([
      "day",
      "hour",
      "minute",
      "month",
      "second",
      "session",
      "week",
    ]);
  });

  it("test_valid_conversion_window_units_is_frozenset", () => {
    expect(VALID_CONVERSION_WINDOW_UNITS).toBeInstanceOf(Set);
  });

  it("test_valid_retention_units_values", () => {
    expect(sorted(VALID_RETENTION_UNITS)).toEqual(["day", "month", "week"]);
  });

  it("test_valid_retention_units_is_frozenset", () => {
    expect(VALID_RETENTION_UNITS).toBeInstanceOf(Set);
  });

  it("test_valid_retention_alignment_values", () => {
    expect(sorted(VALID_RETENTION_ALIGNMENT)).toEqual([
      "birth",
      "interval_start",
    ]);
  });

  it("test_valid_retention_alignment_is_frozenset", () => {
    expect(VALID_RETENTION_ALIGNMENT).toBeInstanceOf(Set);
  });

  it("test_valid_flows_count_types_values", () => {
    expect(sorted(VALID_FLOWS_COUNT_TYPES)).toEqual([
      "session",
      "total",
      "unique",
    ]);
  });

  it("test_valid_flows_count_types_is_frozenset", () => {
    expect(VALID_FLOWS_COUNT_TYPES).toBeInstanceOf(Set);
  });

  it("test_valid_flows_chart_types_values", () => {
    expect(sorted(VALID_FLOWS_CHART_TYPES)).toEqual([
      "sankey",
      "top-paths",
      "tree",
    ]);
  });

  it("test_valid_flows_chart_types_is_frozenset", () => {
    expect(VALID_FLOWS_CHART_TYPES).toBeInstanceOf(Set);
  });
});

describe("TestExtendedMathFunnels", () => {
  it("test_contains_original_values", () => {
    const original = [
      "general",
      "unique",
      "session",
      "total",
      "conversion_rate",
      "conversion_rate_unique",
      "conversion_rate_total",
      "conversion_rate_session",
    ];
    expect(missingFrom(original, VALID_MATH_FUNNELS)).toEqual([]);
  });

  it("test_contains_property_aggregation_types", () => {
    const propertyAgg = [
      "average",
      "median",
      "min",
      "max",
      "p25",
      "p75",
      "p90",
      "p99",
    ];
    expect(missingFrom(propertyAgg, VALID_MATH_FUNNELS)).toEqual([]);
  });

  it("test_all_expected_values", () => {
    expect(sorted(VALID_MATH_FUNNELS)).toEqual(
      [
        "general",
        "unique",
        "session",
        "total",
        "conversion_rate",
        "conversion_rate_unique",
        "conversion_rate_total",
        "conversion_rate_session",
        "average",
        "median",
        "min",
        "max",
        "p25",
        "p75",
        "p90",
        "p99",
        "histogram",
      ].sort(),
    );
  });

  it("test_funnels_still_subset_of_all", () => {
    expect(missingFrom(VALID_MATH_FUNNELS, VALID_MATH_TYPES)).toEqual([]);
  });
});
