// `validateUserArgs` — translation of the `TestValidateUserArgs{AggregateRules,
// ModeSpecific,PercentileRules,MultipleViolations,ErrorShape}` classes of
// `tests/test_user_validators.py` plus the U0 / U7 regression classes (the
// happy-path and basic-rule classes are in user-validators-args.test.ts).
// Dates come from the real clock, as in Python; Python's unused `_only_code` is not carried.
import { describe, expect, it } from "vitest";

import type { ValidationError } from "../../src/errors.js";
import {
  validateUserArgs,
  type ValidateUserArgsOptions,
} from "../../src/query/user-validators.js";
import { Filter } from "../../src/types/index.js";
import { codes } from "../../test-support/error-codes.js";

// --- Helpers (ports of the Python module helpers) ---

/**
 * Check whether a specific error code appears in the error list.
 *
 * @param errors - List of validation errors.
 * @param code - Error code to search for.
 * @returns True if the code appears at least once.
 */
function hasCode(errors: readonly ValidationError[], code: string): boolean {
  return errors.some((e) => e.code === code);
}

// --- TestValidateUserArgsAggregateRules — Rules U14, U15, U16, U17 ---

describe("Validate user args aggregate rules", () => {
  // python: TestValidateUserArgsAggregateRules
  it("U14 aggregate property required for non count", () => {
    // python: test_u14_aggregate_property_required_for_non_count
    for (const agg of ["extremes", "percentile", "numeric_summary"] as const) {
      const errors = validateUserArgs({ mode: "aggregate", aggregate: agg });
      expect(
        hasCode(errors, "U14"),
        `aggregate='${agg}' without aggregate_property should trigger U14`,
      ).toBe(true);
    }
  });

  it("U14 count without property is valid", () => {
    // python: test_u14_count_without_property_is_valid
    const errors = validateUserArgs({ mode: "aggregate", aggregate: "count" });
    expect(hasCode(errors, "U14")).toBe(false);
  });

  it("U14 extremes with property is valid", () => {
    // python: test_u14_extremes_with_property_is_valid
    const errors = validateUserArgs({
      mode: "aggregate",
      aggregate: "extremes",
      aggregate_property: "ltv",
    });
    expect(hasCode(errors, "U14")).toBe(false);
  });

  it("U15 aggregate property must not be set for count", () => {
    // python: test_u15_aggregate_property_must_not_be_set_for_count
    const errors = validateUserArgs({
      mode: "aggregate",
      aggregate: "count",
      aggregate_property: "ltv",
    });
    expect(hasCode(errors, "U15")).toBe(true);
  });

  it("U15 count without property is valid", () => {
    // python: test_u15_count_without_property_is_valid
    const errors = validateUserArgs({ mode: "aggregate", aggregate: "count" });
    expect(hasCode(errors, "U15")).toBe(false);
  });

  it("U16 segment by requires aggregate mode", () => {
    // python: test_u16_segment_by_requires_aggregate_mode
    const errors = validateUserArgs({ segment_by: [1, 2], mode: "profiles" });
    expect(hasCode(errors, "U16")).toBe(true);
  });

  it("U16 segment by in aggregate mode is valid", () => {
    // python: test_u16_segment_by_in_aggregate_mode_is_valid
    const errors = validateUserArgs({
      segment_by: [1, 2],
      mode: "aggregate",
      aggregate: "count",
    });
    expect(hasCode(errors, "U16")).toBe(false);
  });

  it("U17 segment by IDs must be positive", () => {
    // python: test_u17_segment_by_ids_must_be_positive
    const errors = validateUserArgs({
      segment_by: [1, 0, -1],
      mode: "aggregate",
      aggregate: "count",
    });
    expect(hasCode(errors, "U17")).toBe(true);
  });

  it("U17 zero ID", () => {
    // python: test_u17_zero_id
    const errors = validateUserArgs({
      segment_by: [0],
      mode: "aggregate",
      aggregate: "count",
    });
    expect(hasCode(errors, "U17")).toBe(true);
  });

  it("U17 negative ID", () => {
    // python: test_u17_negative_id
    const errors = validateUserArgs({
      segment_by: [-5],
      mode: "aggregate",
      aggregate: "count",
    });
    expect(hasCode(errors, "U17")).toBe(true);
  });

  it("U17 all positive IDs valid", () => {
    // python: test_u17_all_positive_ids_valid
    const errors = validateUserArgs({
      segment_by: [1, 2, 3],
      mode: "aggregate",
      aggregate: "count",
    });
    expect(hasCode(errors, "U17")).toBe(false);
  });
});

// --- TestValidateUserArgsModeSpecific — Rules U18-U22, U30 ---

describe("Validate user args mode specific", () => {
  // python: TestValidateUserArgsModeSpecific
  it("U18 parallel only profiles mode", () => {
    // python: test_u18_parallel_only_profiles_mode
    const errors = validateUserArgs({
      parallel: true,
      mode: "aggregate",
      aggregate: "count",
    });
    expect(hasCode(errors, "U18")).toBe(true);
  });

  it("U18 parallel in profiles mode is valid", () => {
    // python: test_u18_parallel_in_profiles_mode_is_valid
    const errors = validateUserArgs({ parallel: true, mode: "profiles" });
    expect(hasCode(errors, "U18")).toBe(false);
  });

  it("U18 parallel false in aggregate is valid", () => {
    // python: test_u18_parallel_false_in_aggregate_is_valid
    const errors = validateUserArgs({
      parallel: false,
      mode: "aggregate",
      aggregate: "count",
    });
    expect(hasCode(errors, "U18")).toBe(false);
  });

  it("U19 sort by only profiles mode", () => {
    // python: test_u19_sort_by_only_profiles_mode
    const errors = validateUserArgs({
      sort_by: "$last_seen",
      mode: "aggregate",
      aggregate: "count",
    });
    expect(hasCode(errors, "U19")).toBe(true);
  });

  it("U19 sort by in profiles mode is valid", () => {
    // python: test_u19_sort_by_in_profiles_mode_is_valid
    const errors = validateUserArgs({
      sort_by: "$last_seen",
      mode: "profiles",
    });
    expect(hasCode(errors, "U19")).toBe(false);
  });

  it("U20 search only profiles mode", () => {
    // python: test_u20_search_only_profiles_mode
    const errors = validateUserArgs({
      search: "john",
      mode: "aggregate",
      aggregate: "count",
    });
    expect(hasCode(errors, "U20")).toBe(true);
  });

  it("U20 search in profiles mode is valid", () => {
    // python: test_u20_search_in_profiles_mode_is_valid
    const errors = validateUserArgs({ search: "john", mode: "profiles" });
    expect(hasCode(errors, "U20")).toBe(false);
  });

  it("U21 distinct ID only profiles mode", () => {
    // python: test_u21_distinct_id_only_profiles_mode
    const errors = validateUserArgs({
      distinct_id: "user1",
      mode: "aggregate",
      aggregate: "count",
    });
    expect(hasCode(errors, "U21")).toBe(true);
  });

  it("U21 distinct IDs only profiles mode", () => {
    // python: test_u21_distinct_ids_only_profiles_mode
    const errors = validateUserArgs({
      distinct_ids: ["user1"],
      mode: "aggregate",
      aggregate: "count",
    });
    expect(hasCode(errors, "U21")).toBe(true);
  });

  it("U21 distinct ID in profiles mode is valid", () => {
    // python: test_u21_distinct_id_in_profiles_mode_is_valid
    const errors = validateUserArgs({ distinct_id: "user1", mode: "profiles" });
    expect(hasCode(errors, "U21")).toBe(false);
  });

  it("U22 properties only profiles mode", () => {
    // python: test_u22_properties_only_profiles_mode
    const errors = validateUserArgs({
      properties: ["$email"],
      mode: "aggregate",
      aggregate: "count",
    });
    expect(hasCode(errors, "U22")).toBe(true);
  });

  it("U22 properties in profiles mode is valid", () => {
    // python: test_u22_properties_in_profiles_mode_is_valid
    const errors = validateUserArgs({
      properties: ["$email"],
      mode: "profiles",
    });
    expect(hasCode(errors, "U22")).toBe(false);
  });

  it("U30 as of in aggregate mode rejected", () => {
    // python: test_u30_as_of_in_aggregate_mode_rejected
    const errors = validateUserArgs({
      as_of: "2025-01-01",
      mode: "aggregate",
      aggregate: "count",
    });
    expect(hasCode(errors, "U30")).toBe(true);
  });

  it("U30 as of int in aggregate mode rejected", () => {
    // python: test_u30_as_of_int_in_aggregate_mode_rejected
    const errors = validateUserArgs({
      as_of: 1735689600,
      mode: "aggregate",
      aggregate: "count",
    });
    expect(hasCode(errors, "U30")).toBe(true);
  });

  it("U30 as of in profiles mode is valid", () => {
    // python: test_u30_as_of_in_profiles_mode_is_valid
    const errors = validateUserArgs({ as_of: "2025-01-01", mode: "profiles" });
    expect(hasCode(errors, "U30")).toBe(false);
  });
});

// --- TestValidateUserArgsPercentileRules — Rules U26, U27, U28 ---

describe("Validate user args percentile rules", () => {
  // python: TestValidateUserArgsPercentileRules
  it("U26 percentile required for percentile aggregate", () => {
    // python: test_u26_percentile_required_for_percentile_aggregate
    const errors = validateUserArgs({
      mode: "aggregate",
      aggregate: "percentile",
      aggregate_property: "age",
    });
    expect(hasCode(errors, "U26")).toBe(true);
  });

  it("U26 percentile provided is valid", () => {
    // python: test_u26_percentile_provided_is_valid
    const errors = validateUserArgs({
      mode: "aggregate",
      aggregate: "percentile",
      aggregate_property: "age",
      percentile: 50,
    });
    expect(hasCode(errors, "U26")).toBe(false);
  });

  it("U27 percentile prohibited for non percentile", () => {
    // python: test_u27_percentile_prohibited_for_non_percentile
    for (const agg of ["count", "extremes", "numeric_summary"] as const) {
      const options: ValidateUserArgsOptions = {
        mode: "aggregate",
        aggregate: agg,
        percentile: 50,
        ...(agg === "count" ? {} : { aggregate_property: "ltv" }),
      };
      const errors = validateUserArgs(options);
      expect(
        hasCode(errors, "U27"),
        `aggregate='${agg}' with percentile should trigger U27`,
      ).toBe(true);
    }
  });

  it("U27 no percentile for extremes is valid", () => {
    // python: test_u27_no_percentile_for_extremes_is_valid
    const errors = validateUserArgs({
      mode: "aggregate",
      aggregate: "extremes",
      aggregate_property: "ltv",
    });
    expect(hasCode(errors, "U27")).toBe(false);
  });

  it("U28 percentile must be between 0 and 100 exclusive", () => {
    // python: test_u28_percentile_must_be_between_0_and_100_exclusive
    // Python iterates (0, 100, -1, 101, 0.0, 100.0). JS cannot spell
    // `0.0` distinctly from `0`; the int/float pair collapses to one
    // value each — the assertion (U28 present) is unchanged.
    for (const val of [0, 100, -1, 101]) {
      const errors = validateUserArgs({
        mode: "aggregate",
        aggregate: "percentile",
        aggregate_property: "age",
        percentile: val,
      });
      expect(
        hasCode(errors, "U28"),
        `percentile=${val} should trigger U28`,
      ).toBe(true);
    }
  });

  it("U28 valid percentile values", () => {
    // python: test_u28_valid_percentile_values
    for (const val of [0.1, 1, 25, 50, 75, 99, 99.9]) {
      const errors = validateUserArgs({
        mode: "aggregate",
        aggregate: "percentile",
        aggregate_property: "age",
        percentile: val,
      });
      expect(hasCode(errors, "U28"), `percentile=${val} should be valid`).toBe(
        false,
      );
    }
  });

  it("U28 boundary values", () => {
    // python: test_u28_boundary_values
    const errorsZero = validateUserArgs({
      mode: "aggregate",
      aggregate: "percentile",
      aggregate_property: "age",
      percentile: 0,
    });
    expect(hasCode(errorsZero, "U28")).toBe(true);

    const errorsHundred = validateUserArgs({
      mode: "aggregate",
      aggregate: "percentile",
      aggregate_property: "age",
      percentile: 100,
    });
    expect(hasCode(errorsHundred, "U28")).toBe(true);
  });
});

// --- TestValidateUserArgsMultipleViolations — Simultaneous error collection ---

describe("Validate user args multiple violations", () => {
  // python: TestValidateUserArgsMultipleViolations
  it("multiple basic violations", () => {
    // python: test_multiple_basic_violations
    const errors = validateUserArgs({
      limit: -1,
      distinct_ids: [],
      sort_by: "",
      mode: "profiles",
    });
    const c = codes(errors);
    expect(c, "negative limit should produce U3").toContain("U3");
    expect(c, "empty distinct_ids should produce U4").toContain("U4");
    expect(c, "empty sort_by should produce U5").toContain("U5");
  });

  it("mutual exclusion plus value violations", () => {
    // python: test_mutual_exclusion_plus_value_violations
    const errors = validateUserArgs({
      distinct_id: "user1",
      distinct_ids: [],
      mode: "profiles",
    });
    const c = codes(errors);
    expect(c, "U1 for mutual exclusion").toContain("U1");
    expect(c, "U4 for empty distinct_ids").toContain("U4");
  });

  it("mode violations collected together", () => {
    // python: test_mode_violations_collected_together
    const errors = validateUserArgs({
      parallel: true,
      sort_by: "$last_seen",
      search: "john",
      distinct_id: "user1",
      properties: ["$email"],
      as_of: "2025-01-01",
      mode: "aggregate",
      aggregate: "count",
    });
    const c = codes(errors);
    expect(c, "parallel in aggregate mode").toContain("U18");
    expect(c, "sort_by in aggregate mode").toContain("U19");
    expect(c, "search in aggregate mode").toContain("U20");
    expect(c, "distinct_id in aggregate mode").toContain("U21");
    expect(c, "properties in aggregate mode").toContain("U22");
    expect(c, "as_of in aggregate mode").toContain("U30");
  });

  it("aggregate violations collected", () => {
    // python: test_aggregate_violations_collected
    const errors = validateUserArgs({
      mode: "aggregate",
      aggregate: "extremes",
      // Missing aggregate_property → U14
      segment_by: [0, -1], // Invalid IDs → U17
    });
    const c = codes(errors);
    expect(c, "missing aggregate_property").toContain("U14");
    expect(c, "non-positive segment_by IDs").toContain("U17");
  });

  it("cross mode and basic violations", () => {
    // python: test_cross_mode_and_basic_violations
    const errors = validateUserArgs({
      workers: 0,
      include_all_users: true, // No cohort → U7
      mode: "profiles",
    });
    const c = codes(errors);
    expect(c, "workers=0").toContain("U23");
    expect(c, "include_all_users without cohort").toContain("U7");
  });
});

// --- TestValidateUserArgsErrorShape — ValidationError structure ---

describe("Validate user args error shape", () => {
  // python: TestValidateUserArgsErrorShape
  it("error has path", () => {
    // python: test_error_has_path
    const errors = validateUserArgs({ limit: -1, mode: "profiles" });
    expect(errors.length).toBeGreaterThanOrEqual(1);
    const error = errors.find((e) => e.code === "U3");
    expect(error).toBeDefined();
    // Python `assert error.path` — truthy, i.e. a non-empty string.
    expect(error!.path.length, "path should be non-empty").toBeGreaterThan(0);
  });

  it("error has message", () => {
    // python: test_error_has_message
    const errors = validateUserArgs({ limit: -1, mode: "profiles" });
    expect(errors.length).toBeGreaterThanOrEqual(1);
    const error = errors.find((e) => e.code === "U3");
    expect(error).toBeDefined();
    expect(
      error!.message.length,
      "message should be non-empty",
    ).toBeGreaterThan(0);
  });

  it("error has code", () => {
    // python: test_error_has_code
    const errors = validateUserArgs({ limit: -1, mode: "profiles" });
    expect(errors.length).toBeGreaterThanOrEqual(1);
    const error = errors.find((e) => e.code === "U3");
    expect(error).toBeDefined();
    expect(error!.code).toBe("U3");
  });

  it("error severity is error", () => {
    // python: test_error_severity_is_error
    const errors = validateUserArgs({ limit: -1, mode: "profiles" });
    expect(errors.length).toBeGreaterThanOrEqual(1);
    const error = errors.find((e) => e.code === "U3");
    expect(error).toBeDefined();
    expect(error!.severity).toBe("error");
  });
});

// --- PR #118 review fixes — U0 type-check and U7 false-positive ---

describe("Validate user args where type check", () => {
  // python: TestValidateUserArgsWhereTypeCheck
  it("U0 non filter in where list", () => {
    // python: test_u0_non_filter_in_where_list
    const errors = validateUserArgs({ where: ["not-a-filter"] });
    expect(hasCode(errors, "U0")).toBe(true);
  });

  it("U0 mixed filter and non filter", () => {
    // python: test_u0_mixed_filter_and_non_filter
    const errors = validateUserArgs({
      where: [Filter.equals("plan", "premium"), 42],
    });
    expect(hasCode(errors, "U0")).toBe(true);
  });
});

describe("Validate user args U7 with in cohort filter", () => {
  // python: TestValidateUserArgsU7WithInCohortFilter
  it("U7 include all users with in cohort filter is valid", () => {
    // python: test_u7_include_all_users_with_in_cohort_filter_is_valid
    const errors = validateUserArgs({
      include_all_users: true,
      where: [Filter.inCohort(42)],
    });
    expect(hasCode(errors, "U7")).toBe(false);
  });

  it("U7 include all users without any cohort is invalid", () => {
    // python: test_u7_include_all_users_without_any_cohort_is_invalid
    const errors = validateUserArgs({ include_all_users: true });
    expect(hasCode(errors, "U7")).toBe(true);
  });
});
