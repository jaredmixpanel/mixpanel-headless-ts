/**
 * Layer-3 translation of `tests/test_user_validators.py`
 * (Python revision: `ts-port/phase2-contract-support` HEAD; 1,340 LOC,
 * 149 test methods — the WHOLE file, per b2-packets.md §V2
 * "Layer-3 test translation (V2)").
 *
 * R10.2 assertion-for-assertion. Notes on the translation:
 *
 * - The Python module helper `_only_code` is dead code in the Python
 *   file (defined, never called) and is therefore not translated — it
 *   carries no assertion.
 * - `date.today()` is a clock read. Python's tests build `yesterday` /
 *   `today` / `future` from the real clock, so the TS twins do the
 *   same through {@link todayIso} / {@link shiftDays} and let
 *   `validateUserArgs` use its DEFAULT clock seam. The frozen-clock
 *   path (`options.today`) is exercised by its own describe block at
 *   the bottom — that seam is what the (b′) binding feeds from
 *   `context.shims` (b2-packets.md §V2 trap 2b).
 * - `MagicMock(spec=CohortDefinition)` (U24) has no TS analog; the
 *   twin builds a real-prototype object whose `toDict` throws. Python
 *   catches `(ValueError, TypeError, RuntimeError)`; the ported
 *   `ParamValidationError` dual-inherits `ValueError`
 *   (`exceptions.py:97`), so both a `ParamValidationError` and a
 *   native `TypeError` are asserted.
 * - The 4 `validation/`-capability vectors extracted from
 *   `tests/test_query_user_edge_cases.py` replay through the corpus;
 *   that FILE is B5 Layer-3 scope (playbook B5 row) and is NOT
 *   translated here.
 */

import { describe, expect, it } from "vitest";

import {
  ParamValidationError,
  type ValidationError,
} from "../../src/errors.js";
import {
  validateUserArgs,
  type ValidateUserArgsOptions,
  validateUserParams,
} from "../../src/query/user-validators.js";
import {
  CohortCriteria,
  CohortDefinition,
  Filter,
} from "../../src/types/index.js";

// =============================================================================
// Helpers (port of the Python module helpers, :30-76)
// =============================================================================

/**
 * Extract error codes from a list of ValidationError objects.
 *
 * @param errors - List of validation errors.
 * @returns List of error code strings.
 */
function codes(errors: readonly ValidationError[]): string[] {
  return errors.map((e) => e.code);
}

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

/**
 * Build a valid CohortDefinition for testing.
 *
 * @returns A CohortDefinition with a single behavioral criterion.
 */
function makeCohortDefinition(): CohortDefinition {
  return CohortDefinition.allOf(
    CohortCriteria.didEvent("Purchase", { at_least: 1, within_days: 30 }),
  );
}

/**
 * Today's LOCAL calendar date as `YYYY-MM-DD` — the test-side twin of
 * Python `date.today().isoformat()`.
 *
 * @returns Today's date string.
 */
function todayIso(): string {
  const now = new Date();
  return isoOf(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/**
 * Shift an ISO date string by whole days — twin of Python
 * `date.today() ± timedelta(days=n)`.
 *
 * Arithmetic runs through `Date.UTC` (a numeric constructor, never the
 * string-parsing one — watchlist #5).
 *
 * @param iso - Base date as `YYYY-MM-DD`.
 * @param days - Signed day offset.
 * @returns The shifted date as `YYYY-MM-DD`.
 */
function shiftDays(iso: string, days: number): string {
  const digits = (s: string): number => {
    // R11.7: no `parseInt` / `Number(string)` anywhere in this tree,
    // test helpers included; the slices are `[0-9]+` by construction.
    let v = 0;
    for (let i = 0; i < s.length; i++) {
      v = v * 10 + (s.charCodeAt(i) - 0x30);
    }
    return v;
  };
  const y = digits(iso.slice(0, 4));
  const m = digits(iso.slice(5, 7));
  const d = digits(iso.slice(8, 10));
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return isoOf(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

/**
 * Render a Y/M/D triple as a zero-padded `YYYY-MM-DD` string.
 *
 * @param year - Full year.
 * @param month - 1-based month.
 * @param day - 1-based day.
 * @returns The ISO date string.
 */
function isoOf(year: number, month: number, day: number): string {
  const p = (n: number, width: number): string => `${n}`.padStart(width, "0");
  return `${p(year, 4)}-${p(month, 2)}-${p(day, 2)}`;
}

/**
 * Build a Filter with an empty property name, bypassing the factory
 * validation exactly as the Python tests do with keyword construction.
 *
 * @returns A Filter whose `_property` is the empty string.
 */
function emptyPropertyFilter(): Filter {
  return new Filter({
    _property: "",
    _operator: "equals",
    _value: ["test"],
    _property_type: "string",
  });
}

// =============================================================================
// TestValidateUserArgsValid — Happy-path tests
// =============================================================================

describe("TestValidateUserArgsValid", () => {
  it("test_defaults_are_valid", () => {
    const errors = validateUserArgs();
    expect(errors).toStrictEqual([]);
  });

  it("test_profiles_mode_with_filter", () => {
    const errors = validateUserArgs({
      where: Filter.equals("plan", "premium"),
      mode: "profiles",
    });
    expect(errors).toStrictEqual([]);
  });

  it("test_profiles_mode_with_string_where", () => {
    const errors = validateUserArgs({
      where: 'properties["plan"] == "premium"',
      mode: "profiles",
    });
    expect(errors).toStrictEqual([]);
  });

  it("test_profiles_mode_with_filter_list", () => {
    const errors = validateUserArgs({
      where: [Filter.equals("plan", "premium"), Filter.greaterThan("age", 18)],
      mode: "profiles",
    });
    expect(errors).toStrictEqual([]);
  });

  it("test_profiles_mode_with_cohort_id", () => {
    const errors = validateUserArgs({ cohort: 123, mode: "profiles" });
    expect(errors).toStrictEqual([]);
  });

  it("test_profiles_mode_with_cohort_definition", () => {
    const errors = validateUserArgs({
      cohort: makeCohortDefinition(),
      mode: "profiles",
    });
    expect(errors).toStrictEqual([]);
  });

  it("test_profiles_mode_with_properties", () => {
    const errors = validateUserArgs({
      properties: ["$email", "$name"],
      mode: "profiles",
    });
    expect(errors).toStrictEqual([]);
  });

  it("test_profiles_mode_with_sort_by", () => {
    const errors = validateUserArgs({
      sort_by: "$last_seen",
      mode: "profiles",
    });
    expect(errors).toStrictEqual([]);
  });

  it("test_profiles_mode_with_search", () => {
    const errors = validateUserArgs({ search: "john", mode: "profiles" });
    expect(errors).toStrictEqual([]);
  });

  it("test_profiles_mode_with_distinct_id", () => {
    const errors = validateUserArgs({
      distinct_id: "user123",
      mode: "profiles",
    });
    expect(errors).toStrictEqual([]);
  });

  it("test_profiles_mode_with_distinct_ids", () => {
    const errors = validateUserArgs({
      distinct_ids: ["user1", "user2"],
      mode: "profiles",
    });
    expect(errors).toStrictEqual([]);
  });

  it("test_profiles_mode_with_parallel", () => {
    const errors = validateUserArgs({ parallel: true, mode: "profiles" });
    expect(errors).toStrictEqual([]);
  });

  it("test_profiles_mode_with_as_of_date", () => {
    const yesterday = shiftDays(todayIso(), -1);
    const errors = validateUserArgs({ as_of: yesterday, mode: "profiles" });
    expect(errors).toStrictEqual([]);
  });

  it("test_profiles_mode_with_as_of_today", () => {
    const errors = validateUserArgs({ as_of: todayIso(), mode: "profiles" });
    expect(errors).toStrictEqual([]);
  });

  it("test_profiles_mode_with_as_of_int", () => {
    const errors = validateUserArgs({ as_of: 1700000000, mode: "profiles" });
    expect(errors).toStrictEqual([]);
  });

  it("test_aggregate_mode_count", () => {
    const errors = validateUserArgs({ mode: "aggregate", aggregate: "count" });
    expect(errors).toStrictEqual([]);
  });

  it("test_aggregate_mode_extremes_with_property", () => {
    const errors = validateUserArgs({
      mode: "aggregate",
      aggregate: "extremes",
      aggregate_property: "ltv",
    });
    expect(errors).toStrictEqual([]);
  });

  it("test_aggregate_mode_numeric_summary_with_property", () => {
    const errors = validateUserArgs({
      mode: "aggregate",
      aggregate: "numeric_summary",
      aggregate_property: "revenue",
    });
    expect(errors).toStrictEqual([]);
  });

  it("test_aggregate_mode_percentile_with_property", () => {
    const errors = validateUserArgs({
      mode: "aggregate",
      aggregate: "percentile",
      aggregate_property: "age",
      percentile: 50,
    });
    expect(errors).toStrictEqual([]);
  });

  it("test_aggregate_mode_with_segment_by", () => {
    const errors = validateUserArgs({
      mode: "aggregate",
      aggregate: "count",
      segment_by: [1, 2, 3],
    });
    expect(errors).toStrictEqual([]);
  });

  it("test_aggregate_mode_with_cohort_filter", () => {
    const errors = validateUserArgs({
      mode: "aggregate",
      aggregate: "count",
      cohort: 123,
    });
    expect(errors).toStrictEqual([]);
  });

  it("test_include_all_users_with_cohort", () => {
    const errors = validateUserArgs({
      cohort: 123,
      include_all_users: true,
      mode: "profiles",
    });
    expect(errors).toStrictEqual([]);
  });

  it("test_workers_valid_range", () => {
    for (const n of [1, 2, 3, 4, 5]) {
      const errors = validateUserArgs({ workers: n, mode: "profiles" });
      expect(errors, `workers=${n} should be valid`).toStrictEqual([]);
    }
  });

  it("test_single_in_cohort_filter_in_where", () => {
    const errors = validateUserArgs({
      where: [Filter.inCohort(123)],
      mode: "profiles",
    });
    expect(errors).toStrictEqual([]);
  });
});

// =============================================================================
// TestValidateUserArgsMutualExclusion — Rules U1, U2, U9
// =============================================================================

describe("TestValidateUserArgsMutualExclusion", () => {
  it("test_u1_distinct_id_and_distinct_ids_mutually_exclusive", () => {
    const errors = validateUserArgs({
      distinct_id: "user1",
      distinct_ids: ["user2", "user3"],
      mode: "profiles",
    });
    expect(hasCode(errors, "U1")).toBe(true);
  });

  it("test_u1_only_distinct_id_is_valid", () => {
    const errors = validateUserArgs({ distinct_id: "user1", mode: "profiles" });
    expect(hasCode(errors, "U1")).toBe(false);
  });

  it("test_u1_only_distinct_ids_is_valid", () => {
    const errors = validateUserArgs({
      distinct_ids: ["user1"],
      mode: "profiles",
    });
    expect(hasCode(errors, "U1")).toBe(false);
  });

  it("test_u2_cohort_and_in_cohort_filter_mutually_exclusive", () => {
    const errors = validateUserArgs({
      cohort: 123,
      where: [Filter.inCohort(456)],
      mode: "profiles",
    });
    expect(hasCode(errors, "U2")).toBe(true);
  });

  it("test_u2_cohort_without_in_cohort_filter_is_valid", () => {
    const errors = validateUserArgs({
      cohort: 123,
      where: Filter.equals("plan", "premium"),
      mode: "profiles",
    });
    expect(hasCode(errors, "U2")).toBe(false);
  });

  it("test_u2_in_cohort_filter_without_cohort_is_valid", () => {
    const errors = validateUserArgs({
      where: [Filter.inCohort(456)],
      mode: "profiles",
    });
    expect(hasCode(errors, "U2")).toBe(false);
  });

  it("test_u2_cohort_definition_and_in_cohort_filter", () => {
    const errors = validateUserArgs({
      cohort: makeCohortDefinition(),
      where: [Filter.inCohort(789)],
      mode: "profiles",
    });
    expect(hasCode(errors, "U2")).toBe(true);
  });

  it("test_u9_where_type_is_either_string_or_filter_not_both", () => {
    // A valid string is fine
    const errorsStr = validateUserArgs({
      where: 'properties["plan"] == "premium"',
      mode: "profiles",
    });
    expect(hasCode(errorsStr, "U9")).toBe(false);

    // A valid Filter is fine
    const errorsFilter = validateUserArgs({
      where: Filter.equals("plan", "premium"),
      mode: "profiles",
    });
    expect(hasCode(errorsFilter, "U9")).toBe(false);
  });
});

// =============================================================================
// TestValidateUserArgsBasic — Rules U3-U6, U8, U10, U11, U23
// =============================================================================

describe("TestValidateUserArgsBasic", () => {
  it("test_u3_limit_must_be_positive", () => {
    const errors = validateUserArgs({ limit: 0, mode: "profiles" });
    expect(hasCode(errors, "U3")).toBe(true);
  });

  it("test_u3_negative_limit", () => {
    const errors = validateUserArgs({ limit: -5, mode: "profiles" });
    expect(hasCode(errors, "U3")).toBe(true);
  });

  it("test_u3_positive_limit_is_valid", () => {
    const errors = validateUserArgs({ limit: 10, mode: "profiles" });
    expect(hasCode(errors, "U3")).toBe(false);
  });

  it("test_u3_large_limit_is_valid", () => {
    const errors = validateUserArgs({ limit: 100_000, mode: "profiles" });
    expect(hasCode(errors, "U3")).toBe(false);
  });

  it("test_u4_distinct_ids_must_be_non_empty", () => {
    const errors = validateUserArgs({ distinct_ids: [], mode: "profiles" });
    expect(hasCode(errors, "U4")).toBe(true);
  });

  it("test_u4_non_empty_distinct_ids_is_valid", () => {
    const errors = validateUserArgs({
      distinct_ids: ["user1"],
      mode: "profiles",
    });
    expect(hasCode(errors, "U4")).toBe(false);
  });

  it("test_u5_sort_by_must_be_non_empty_string", () => {
    const errors = validateUserArgs({ sort_by: "", mode: "profiles" });
    expect(hasCode(errors, "U5")).toBe(true);
  });

  it("test_u5_whitespace_only_sort_by", () => {
    const errors = validateUserArgs({
      sort_by: " ".repeat(3),
      mode: "profiles",
    });
    expect(hasCode(errors, "U5")).toBe(true);
  });

  it("test_u5_valid_sort_by", () => {
    const errors = validateUserArgs({
      sort_by: "$last_seen",
      mode: "profiles",
    });
    expect(hasCode(errors, "U5")).toBe(false);
  });

  it("test_u6_as_of_string_must_be_valid_date", () => {
    const errors = validateUserArgs({ as_of: "not-a-date", mode: "profiles" });
    expect(hasCode(errors, "U6")).toBe(true);
  });

  it("test_u6_invalid_date_format_slash", () => {
    const errors = validateUserArgs({ as_of: "2025/01/15", mode: "profiles" });
    expect(hasCode(errors, "U6")).toBe(true);
  });

  it("test_u6_invalid_calendar_date", () => {
    const errors = validateUserArgs({ as_of: "2025-02-30", mode: "profiles" });
    expect(hasCode(errors, "U6")).toBe(true);
  });

  it("test_u6_valid_date_string", () => {
    const yesterday = shiftDays(todayIso(), -1);
    const errors = validateUserArgs({ as_of: yesterday, mode: "profiles" });
    expect(hasCode(errors, "U6")).toBe(false);
  });

  it("test_u6_integer_as_of_skips_date_validation", () => {
    const errors = validateUserArgs({ as_of: 1700000000, mode: "profiles" });
    expect(hasCode(errors, "U6")).toBe(false);
  });

  it("test_u8_as_of_must_not_be_in_future", () => {
    const future = shiftDays(todayIso(), 30);
    const errors = validateUserArgs({ as_of: future, mode: "profiles" });
    expect(hasCode(errors, "U8")).toBe(true);
  });

  it("test_u8_today_is_not_future", () => {
    const errors = validateUserArgs({ as_of: todayIso(), mode: "profiles" });
    expect(hasCode(errors, "U8")).toBe(false);
  });

  it("test_u8_past_date_is_valid", () => {
    const past = shiftDays(todayIso(), -365);
    const errors = validateUserArgs({ as_of: past, mode: "profiles" });
    expect(hasCode(errors, "U8")).toBe(false);
  });

  it("test_u10_filter_property_names_must_be_non_empty", () => {
    const f = emptyPropertyFilter();
    const errors = validateUserArgs({ where: f, mode: "profiles" });
    expect(hasCode(errors, "U10")).toBe(true);
  });

  it("test_u10_filter_with_valid_property_name", () => {
    const errors = validateUserArgs({
      where: Filter.equals("country", "US"),
      mode: "profiles",
    });
    expect(hasCode(errors, "U10")).toBe(false);
  });

  it("test_u10_filter_list_with_empty_property", () => {
    const fValid = Filter.equals("plan", "premium");
    const fInvalid = emptyPropertyFilter();
    const errors = validateUserArgs({
      where: [fValid, fInvalid],
      mode: "profiles",
    });
    expect(hasCode(errors, "U10")).toBe(true);
  });

  it("test_u29_empty_properties_list", () => {
    const errors = validateUserArgs({ properties: [], mode: "profiles" });
    expect(hasCode(errors, "U29")).toBe(true);
  });

  it("test_u29_non_empty_properties_is_valid", () => {
    const errors = validateUserArgs({
      properties: ["$email"],
      mode: "profiles",
    });
    expect(hasCode(errors, "U29")).toBe(false);
  });

  it("test_u29_none_properties_is_valid", () => {
    const errors = validateUserArgs({ properties: null, mode: "profiles" });
    expect(hasCode(errors, "U29")).toBe(false);
  });

  it("test_u11_properties_items_must_be_non_empty", () => {
    const errors = validateUserArgs({
      properties: ["$email", ""],
      mode: "profiles",
    });
    expect(hasCode(errors, "U11")).toBe(true);
  });

  it("test_u11_whitespace_only_property", () => {
    const errors = validateUserArgs({ properties: ["  "], mode: "profiles" });
    expect(hasCode(errors, "U11")).toBe(true);
  });

  it("test_u11_valid_properties", () => {
    const errors = validateUserArgs({
      properties: ["$email", "$name", "plan"],
      mode: "profiles",
    });
    expect(hasCode(errors, "U11")).toBe(false);
  });

  it("test_u23_workers_below_minimum", () => {
    const errors = validateUserArgs({ workers: 0, mode: "profiles" });
    expect(hasCode(errors, "U23")).toBe(true);
  });

  it("test_u23_workers_negative", () => {
    const errors = validateUserArgs({ workers: -1, mode: "profiles" });
    expect(hasCode(errors, "U23")).toBe(true);
  });

  it("test_u23_workers_above_maximum", () => {
    const errors = validateUserArgs({ workers: 6, mode: "profiles" });
    expect(hasCode(errors, "U23")).toBe(true);
  });

  it("test_u23_workers_at_boundaries", () => {
    for (const n of [1, 5]) {
      const errors = validateUserArgs({ workers: n, mode: "profiles" });
      expect(hasCode(errors, "U23"), `workers=${n} should be valid`).toBe(
        false,
      );
    }
  });
});

// =============================================================================
// TestValidateUserArgsCohortDependency — Rules U7, U12, U13, U24
// =============================================================================

describe("TestValidateUserArgsCohortDependency", () => {
  it("test_u7_include_all_users_requires_cohort", () => {
    const errors = validateUserArgs({
      include_all_users: true,
      mode: "profiles",
    });
    expect(hasCode(errors, "U7")).toBe(true);
  });

  it("test_u7_include_all_users_with_cohort_is_valid", () => {
    const errors = validateUserArgs({
      include_all_users: true,
      cohort: 123,
      mode: "profiles",
    });
    expect(hasCode(errors, "U7")).toBe(false);
  });

  it("test_u7_include_all_users_false_without_cohort_is_valid", () => {
    const errors = validateUserArgs({
      include_all_users: false,
      mode: "profiles",
    });
    expect(hasCode(errors, "U7")).toBe(false);
  });

  it("test_u12_not_in_cohort_filter_not_supported", () => {
    const errors = validateUserArgs({
      where: Filter.notInCohort(123),
      mode: "profiles",
    });
    expect(hasCode(errors, "U12")).toBe(true);
  });

  it("test_u12_not_in_cohort_in_list", () => {
    const errors = validateUserArgs({
      where: [Filter.equals("plan", "premium"), Filter.notInCohort(123)],
      mode: "profiles",
    });
    expect(hasCode(errors, "U12")).toBe(true);
  });

  it("test_u12_in_cohort_is_valid", () => {
    const errors = validateUserArgs({
      where: Filter.inCohort(123),
      mode: "profiles",
    });
    expect(hasCode(errors, "U12")).toBe(false);
  });

  it("test_u13_at_most_one_in_cohort_in_where", () => {
    const errors = validateUserArgs({
      where: [Filter.inCohort(123), Filter.inCohort(456)],
      mode: "profiles",
    });
    expect(hasCode(errors, "U13")).toBe(true);
  });

  it("test_u13_single_in_cohort_is_valid", () => {
    const errors = validateUserArgs({
      where: [Filter.inCohort(123)],
      mode: "profiles",
    });
    expect(hasCode(errors, "U13")).toBe(false);
  });

  it("test_u13_no_in_cohort_is_valid", () => {
    const errors = validateUserArgs({
      where: [Filter.equals("plan", "premium")],
      mode: "profiles",
    });
    expect(hasCode(errors, "U13")).toBe(false);
  });

  it("test_u24_cohort_definition_to_dict_must_succeed", () => {
    // Python: MagicMock(spec=CohortDefinition) with
    // to_dict.side_effect = ValueError("broken definition").
    // TS twin: a real-prototype instance whose toDict throws the
    // ValueError analog (ParamValidationError, exceptions.py:97).
    const broken = Object.create(
      CohortDefinition.prototype,
    ) as CohortDefinition;
    Object.defineProperty(broken, "toDict", {
      value: (): never => {
        throw new ParamValidationError("broken definition", "CD_TEST_BROKEN");
      },
    });
    const errors = validateUserArgs({ cohort: broken, mode: "profiles" });
    expect(hasCode(errors, "U24")).toBe(true);
  });

  it("test_u24_cohort_definition_to_dict_type_error", () => {
    // Extension of the Python test's single case: the Python catch
    // tuple is (ValueError, TypeError, RuntimeError) — the native
    // TypeError arm is asserted here (not an R10.2 weakening; the
    // Python assertion above is translated verbatim).
    const broken = Object.create(
      CohortDefinition.prototype,
    ) as CohortDefinition;
    Object.defineProperty(broken, "toDict", {
      value: (): never => {
        throw new TypeError("bad criteria");
      },
    });
    const errors = validateUserArgs({ cohort: broken, mode: "profiles" });
    expect(hasCode(errors, "U24")).toBe(true);
  });

  it("test_u24_valid_cohort_definition", () => {
    const errors = validateUserArgs({
      cohort: makeCohortDefinition(),
      mode: "profiles",
    });
    expect(hasCode(errors, "U24")).toBe(false);
  });
});

// =============================================================================
// TestValidateUserArgsAggregateRules — Rules U14, U15, U16, U17
// =============================================================================

describe("TestValidateUserArgsAggregateRules", () => {
  it("test_u14_aggregate_property_required_for_non_count", () => {
    for (const agg of ["extremes", "percentile", "numeric_summary"] as const) {
      const errors = validateUserArgs({ mode: "aggregate", aggregate: agg });
      expect(
        hasCode(errors, "U14"),
        `aggregate='${agg}' without aggregate_property should trigger U14`,
      ).toBe(true);
    }
  });

  it("test_u14_count_without_property_is_valid", () => {
    const errors = validateUserArgs({ mode: "aggregate", aggregate: "count" });
    expect(hasCode(errors, "U14")).toBe(false);
  });

  it("test_u14_extremes_with_property_is_valid", () => {
    const errors = validateUserArgs({
      mode: "aggregate",
      aggregate: "extremes",
      aggregate_property: "ltv",
    });
    expect(hasCode(errors, "U14")).toBe(false);
  });

  it("test_u15_aggregate_property_must_not_be_set_for_count", () => {
    const errors = validateUserArgs({
      mode: "aggregate",
      aggregate: "count",
      aggregate_property: "ltv",
    });
    expect(hasCode(errors, "U15")).toBe(true);
  });

  it("test_u15_count_without_property_is_valid", () => {
    const errors = validateUserArgs({ mode: "aggregate", aggregate: "count" });
    expect(hasCode(errors, "U15")).toBe(false);
  });

  it("test_u16_segment_by_requires_aggregate_mode", () => {
    const errors = validateUserArgs({ segment_by: [1, 2], mode: "profiles" });
    expect(hasCode(errors, "U16")).toBe(true);
  });

  it("test_u16_segment_by_in_aggregate_mode_is_valid", () => {
    const errors = validateUserArgs({
      segment_by: [1, 2],
      mode: "aggregate",
      aggregate: "count",
    });
    expect(hasCode(errors, "U16")).toBe(false);
  });

  it("test_u17_segment_by_ids_must_be_positive", () => {
    const errors = validateUserArgs({
      segment_by: [1, 0, -1],
      mode: "aggregate",
      aggregate: "count",
    });
    expect(hasCode(errors, "U17")).toBe(true);
  });

  it("test_u17_zero_id", () => {
    const errors = validateUserArgs({
      segment_by: [0],
      mode: "aggregate",
      aggregate: "count",
    });
    expect(hasCode(errors, "U17")).toBe(true);
  });

  it("test_u17_negative_id", () => {
    const errors = validateUserArgs({
      segment_by: [-5],
      mode: "aggregate",
      aggregate: "count",
    });
    expect(hasCode(errors, "U17")).toBe(true);
  });

  it("test_u17_all_positive_ids_valid", () => {
    const errors = validateUserArgs({
      segment_by: [1, 2, 3],
      mode: "aggregate",
      aggregate: "count",
    });
    expect(hasCode(errors, "U17")).toBe(false);
  });
});

// =============================================================================
// TestValidateUserArgsModeSpecific — Rules U18-U22, U30
// =============================================================================

describe("TestValidateUserArgsModeSpecific", () => {
  it("test_u18_parallel_only_profiles_mode", () => {
    const errors = validateUserArgs({
      parallel: true,
      mode: "aggregate",
      aggregate: "count",
    });
    expect(hasCode(errors, "U18")).toBe(true);
  });

  it("test_u18_parallel_in_profiles_mode_is_valid", () => {
    const errors = validateUserArgs({ parallel: true, mode: "profiles" });
    expect(hasCode(errors, "U18")).toBe(false);
  });

  it("test_u18_parallel_false_in_aggregate_is_valid", () => {
    const errors = validateUserArgs({
      parallel: false,
      mode: "aggregate",
      aggregate: "count",
    });
    expect(hasCode(errors, "U18")).toBe(false);
  });

  it("test_u19_sort_by_only_profiles_mode", () => {
    const errors = validateUserArgs({
      sort_by: "$last_seen",
      mode: "aggregate",
      aggregate: "count",
    });
    expect(hasCode(errors, "U19")).toBe(true);
  });

  it("test_u19_sort_by_in_profiles_mode_is_valid", () => {
    const errors = validateUserArgs({
      sort_by: "$last_seen",
      mode: "profiles",
    });
    expect(hasCode(errors, "U19")).toBe(false);
  });

  it("test_u20_search_only_profiles_mode", () => {
    const errors = validateUserArgs({
      search: "john",
      mode: "aggregate",
      aggregate: "count",
    });
    expect(hasCode(errors, "U20")).toBe(true);
  });

  it("test_u20_search_in_profiles_mode_is_valid", () => {
    const errors = validateUserArgs({ search: "john", mode: "profiles" });
    expect(hasCode(errors, "U20")).toBe(false);
  });

  it("test_u21_distinct_id_only_profiles_mode", () => {
    const errors = validateUserArgs({
      distinct_id: "user1",
      mode: "aggregate",
      aggregate: "count",
    });
    expect(hasCode(errors, "U21")).toBe(true);
  });

  it("test_u21_distinct_ids_only_profiles_mode", () => {
    const errors = validateUserArgs({
      distinct_ids: ["user1"],
      mode: "aggregate",
      aggregate: "count",
    });
    expect(hasCode(errors, "U21")).toBe(true);
  });

  it("test_u21_distinct_id_in_profiles_mode_is_valid", () => {
    const errors = validateUserArgs({ distinct_id: "user1", mode: "profiles" });
    expect(hasCode(errors, "U21")).toBe(false);
  });

  it("test_u22_properties_only_profiles_mode", () => {
    const errors = validateUserArgs({
      properties: ["$email"],
      mode: "aggregate",
      aggregate: "count",
    });
    expect(hasCode(errors, "U22")).toBe(true);
  });

  it("test_u22_properties_in_profiles_mode_is_valid", () => {
    const errors = validateUserArgs({
      properties: ["$email"],
      mode: "profiles",
    });
    expect(hasCode(errors, "U22")).toBe(false);
  });

  it("test_u30_as_of_in_aggregate_mode_rejected", () => {
    const errors = validateUserArgs({
      as_of: "2025-01-01",
      mode: "aggregate",
      aggregate: "count",
    });
    expect(hasCode(errors, "U30")).toBe(true);
  });

  it("test_u30_as_of_int_in_aggregate_mode_rejected", () => {
    const errors = validateUserArgs({
      as_of: 1735689600,
      mode: "aggregate",
      aggregate: "count",
    });
    expect(hasCode(errors, "U30")).toBe(true);
  });

  it("test_u30_as_of_in_profiles_mode_is_valid", () => {
    const errors = validateUserArgs({ as_of: "2025-01-01", mode: "profiles" });
    expect(hasCode(errors, "U30")).toBe(false);
  });
});

// =============================================================================
// TestValidateUserArgsPercentileRules — Rules U26, U27, U28
// =============================================================================

describe("TestValidateUserArgsPercentileRules", () => {
  it("test_u26_percentile_required_for_percentile_aggregate", () => {
    const errors = validateUserArgs({
      mode: "aggregate",
      aggregate: "percentile",
      aggregate_property: "age",
    });
    expect(hasCode(errors, "U26")).toBe(true);
  });

  it("test_u26_percentile_provided_is_valid", () => {
    const errors = validateUserArgs({
      mode: "aggregate",
      aggregate: "percentile",
      aggregate_property: "age",
      percentile: 50,
    });
    expect(hasCode(errors, "U26")).toBe(false);
  });

  it("test_u27_percentile_prohibited_for_non_percentile", () => {
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

  it("test_u27_no_percentile_for_extremes_is_valid", () => {
    const errors = validateUserArgs({
      mode: "aggregate",
      aggregate: "extremes",
      aggregate_property: "ltv",
    });
    expect(hasCode(errors, "U27")).toBe(false);
  });

  it("test_u28_percentile_must_be_between_0_and_100_exclusive", () => {
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

  it("test_u28_valid_percentile_values", () => {
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

  it("test_u28_boundary_values", () => {
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

// =============================================================================
// TestValidateUserArgsMultipleViolations — Simultaneous error collection
// =============================================================================

describe("TestValidateUserArgsMultipleViolations", () => {
  it("test_multiple_basic_violations", () => {
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

  it("test_mutual_exclusion_plus_value_violations", () => {
    const errors = validateUserArgs({
      distinct_id: "user1",
      distinct_ids: [],
      mode: "profiles",
    });
    const c = codes(errors);
    expect(c, "U1 for mutual exclusion").toContain("U1");
    expect(c, "U4 for empty distinct_ids").toContain("U4");
  });

  it("test_mode_violations_collected_together", () => {
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

  it("test_aggregate_violations_collected", () => {
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

  it("test_cross_mode_and_basic_violations", () => {
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

// =============================================================================
// TestValidateUserArgsErrorShape — ValidationError structure
// =============================================================================

describe("TestValidateUserArgsErrorShape", () => {
  it("test_error_has_path", () => {
    const errors = validateUserArgs({ limit: -1, mode: "profiles" });
    expect(errors.length).toBeGreaterThanOrEqual(1);
    const error = errors.find((e) => e.code === "U3");
    expect(error).toBeDefined();
    // Python `assert error.path` — truthy, i.e. a non-empty string.
    expect(
      (error as ValidationError).path.length,
      "path should be non-empty",
    ).toBeGreaterThan(0);
  });

  it("test_error_has_message", () => {
    const errors = validateUserArgs({ limit: -1, mode: "profiles" });
    expect(errors.length).toBeGreaterThanOrEqual(1);
    const error = errors.find((e) => e.code === "U3");
    expect(error).toBeDefined();
    expect(
      (error as ValidationError).message.length,
      "message should be non-empty",
    ).toBeGreaterThan(0);
  });

  it("test_error_has_code", () => {
    const errors = validateUserArgs({ limit: -1, mode: "profiles" });
    expect(errors.length).toBeGreaterThanOrEqual(1);
    const error = errors.find((e) => e.code === "U3");
    expect(error).toBeDefined();
    expect((error as ValidationError).code).toBe("U3");
  });

  it("test_error_severity_is_error", () => {
    const errors = validateUserArgs({ limit: -1, mode: "profiles" });
    expect(errors.length).toBeGreaterThanOrEqual(1);
    const error = errors.find((e) => e.code === "U3");
    expect(error).toBeDefined();
    expect((error as ValidationError).severity).toBe("error");
  });
});

// =============================================================================
// TestValidateUserParams — Layer 2 rules UP1-UP4
// =============================================================================

describe("TestValidateUserParamsValid", () => {
  it("test_empty_params_are_valid", () => {
    expect(validateUserParams({})).toStrictEqual([]);
  });

  it("test_valid_params_with_sort_order", () => {
    expect(validateUserParams({ sort_order: "ascending" })).toStrictEqual([]);
  });

  it("test_valid_params_with_output_properties", () => {
    expect(
      validateUserParams({ output_properties: ["$email", "$name"] }),
    ).toStrictEqual([]);
  });

  it("test_valid_params_with_filter_by_cohort_id", () => {
    expect(validateUserParams({ filter_by_cohort: { id: 123 } })).toStrictEqual(
      [],
    );
  });

  it("test_valid_params_with_filter_by_cohort_raw", () => {
    expect(
      validateUserParams({
        filter_by_cohort: { raw_cohort: { selector: {}, behaviors: {} } },
      }),
    ).toStrictEqual([]);
  });

  it("test_valid_params_with_action", () => {
    for (const action of [
      "count()",
      'extremes(properties["ltv"])',
      'numeric_summary(properties["revenue"])',
      'percentile(properties["age"], 50)',
    ]) {
      const errors = validateUserParams({ action });
      expect(errors, `action='${action}' should be valid`).toStrictEqual([]);
    }
  });
});

describe("TestValidateUserParamsUP1", () => {
  it("test_up1_invalid_sort_order", () => {
    expect(hasCode(validateUserParams({ sort_order: "asc" }), "UP1")).toBe(
      true,
    );
  });

  it("test_up1_random_string", () => {
    expect(hasCode(validateUserParams({ sort_order: "random" }), "UP1")).toBe(
      true,
    );
  });

  it("test_up1_ascending_is_valid", () => {
    expect(
      hasCode(validateUserParams({ sort_order: "ascending" }), "UP1"),
    ).toBe(false);
  });

  it("test_up1_descending_is_valid", () => {
    expect(
      hasCode(validateUserParams({ sort_order: "descending" }), "UP1"),
    ).toBe(false);
  });

  it("test_up1_missing_sort_order_is_valid", () => {
    expect(hasCode(validateUserParams({}), "UP1")).toBe(false);
  });
});

describe("TestValidateUserParamsUP2", () => {
  it("test_up2_missing_both_keys", () => {
    expect(
      hasCode(
        validateUserParams({ filter_by_cohort: { name: "Power Users" } }),
        "UP2",
      ),
    ).toBe(true);
  });

  it("test_up2_empty_dict", () => {
    expect(hasCode(validateUserParams({ filter_by_cohort: {} }), "UP2")).toBe(
      true,
    );
  });

  it("test_up2_with_id_is_valid", () => {
    expect(
      hasCode(validateUserParams({ filter_by_cohort: { id: 123 } }), "UP2"),
    ).toBe(false);
  });

  it("test_up2_with_raw_cohort_is_valid", () => {
    expect(
      hasCode(
        validateUserParams({
          filter_by_cohort: { raw_cohort: { selector: {} } },
        }),
        "UP2",
      ),
    ).toBe(false);
  });

  it("test_up2_missing_filter_by_cohort_is_valid", () => {
    expect(hasCode(validateUserParams({}), "UP2")).toBe(false);
  });
});

describe("TestValidateUserParamsUP3", () => {
  it("test_up3_empty_output_properties", () => {
    expect(hasCode(validateUserParams({ output_properties: [] }), "UP3")).toBe(
      true,
    );
  });

  it("test_up3_non_empty_output_properties_is_valid", () => {
    expect(
      hasCode(validateUserParams({ output_properties: ["$email"] }), "UP3"),
    ).toBe(false);
  });

  it("test_up3_json_encoded_empty_array", () => {
    expect(
      hasCode(validateUserParams({ output_properties: "[]" }), "UP3"),
    ).toBe(true);
  });

  it("test_up3_json_encoded_non_empty_array_is_valid", () => {
    expect(
      hasCode(validateUserParams({ output_properties: '["$email"]' }), "UP3"),
    ).toBe(false);
  });

  it("test_up3_missing_output_properties_is_valid", () => {
    expect(hasCode(validateUserParams({}), "UP3")).toBe(false);
  });
});

describe("TestValidateUserParamsUP4", () => {
  it("test_up4_invalid_action_expression", () => {
    expect(hasCode(validateUserParams({ action: "invalid" }), "UP4")).toBe(
      true,
    );
  });

  it("test_up4_empty_string_action", () => {
    expect(hasCode(validateUserParams({ action: "" }), "UP4")).toBe(true);
  });

  it("test_up4_count_is_valid", () => {
    expect(hasCode(validateUserParams({ action: "count()" }), "UP4")).toBe(
      false,
    );
  });

  it("test_up4_extremes_with_property_is_valid", () => {
    expect(
      hasCode(
        validateUserParams({ action: 'extremes(properties["ltv"])' }),
        "UP4",
      ),
    ).toBe(false);
  });

  it("test_up4_numeric_summary_with_property_is_valid", () => {
    expect(
      hasCode(
        validateUserParams({
          action: 'numeric_summary(properties["revenue"])',
        }),
        "UP4",
      ),
    ).toBe(false);
  });

  it("test_up4_percentile_with_property_is_valid", () => {
    expect(
      hasCode(
        validateUserParams({ action: 'percentile(properties["age"], 50)' }),
        "UP4",
      ),
    ).toBe(false);
  });

  it("test_up4_missing_action_is_valid", () => {
    expect(hasCode(validateUserParams({}), "UP4")).toBe(false);
  });

  it("test_up4_unsupported_function", () => {
    expect(hasCode(validateUserParams({ action: "median(ltv)" }), "UP4")).toBe(
      true,
    );
  });
});

describe("TestValidateUserParamsMultipleViolations", () => {
  it("test_multiple_param_violations", () => {
    const errors = validateUserParams({
      sort_order: "invalid",
      output_properties: [],
      filter_by_cohort: {},
      action: "bad",
    });
    const c = codes(errors);
    expect(c, "invalid sort_order").toContain("UP1");
    expect(c, "empty filter_by_cohort").toContain("UP2");
    expect(c, "empty output_properties").toContain("UP3");
    expect(c, "invalid action").toContain("UP4");
  });
});

// =============================================================================
// PR #118 review fixes — U0 type-check and U7 false-positive
// =============================================================================

describe("TestValidateUserArgsWhereTypeCheck", () => {
  it("test_u0_non_filter_in_where_list", () => {
    const errors = validateUserArgs({ where: ["not-a-filter"] });
    expect(hasCode(errors, "U0")).toBe(true);
  });

  it("test_u0_mixed_filter_and_non_filter", () => {
    const errors = validateUserArgs({
      where: [Filter.equals("plan", "premium"), 42],
    });
    expect(hasCode(errors, "U0")).toBe(true);
  });
});

describe("TestValidateUserArgsU7WithInCohortFilter", () => {
  it("test_u7_include_all_users_with_in_cohort_filter_is_valid", () => {
    const errors = validateUserArgs({
      include_all_users: true,
      where: [Filter.inCohort(42)],
    });
    expect(hasCode(errors, "U7")).toBe(false);
  });

  it("test_u7_include_all_users_without_any_cohort_is_invalid", () => {
    const errors = validateUserArgs({ include_all_users: true });
    expect(hasCode(errors, "U7")).toBe(true);
  });
});

// =============================================================================
// TS-only: the `today` clock seam (b2-packets.md §V2 trap 2b)
// =============================================================================

describe("today clock seam (TS-only — no Python twin)", () => {
  /**
   * Frozen clock at the corpus `recordEpoch` date (2026-01-15), which
   * is what the (b′) binding feeds through `context.shims`.
   *
   * @returns The frozen date string.
   */
  const frozen = (): string => "2026-01-15";

  it("today's date under the frozen clock is not future (U8 silent)", () => {
    const errors = validateUserArgs({
      as_of: "2026-01-15",
      mode: "profiles",
      today: frozen,
    });
    expect(errors).toStrictEqual([]);
  });

  it("a date after the frozen clock raises U8", () => {
    const errors = validateUserArgs({
      as_of: "2026-02-14",
      mode: "profiles",
      today: frozen,
    });
    expect(codes(errors)).toStrictEqual(["U8"]);
  });

  it("a date before the frozen clock is silent", () => {
    const errors = validateUserArgs({
      as_of: "2025-01-15",
      mode: "profiles",
      today: frozen,
    });
    expect(errors).toStrictEqual([]);
  });

  it("the seam does not affect the U6 grammar", () => {
    const errors = validateUserArgs({
      as_of: "2026-02-30",
      mode: "profiles",
      today: frozen,
    });
    expect(codes(errors)).toStrictEqual(["U6"]);
  });
});
