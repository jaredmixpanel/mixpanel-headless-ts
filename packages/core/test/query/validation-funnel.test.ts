// `validateFunnelArgs` rules F1-F7, exclusion step ranges (F4b-F4d) and
// multi-error collection — translation of the corresponding classes of
// `tests/test_validation_funnel.py` (the limit classes are in
// validation-funnel-limits.test.ts). `pytest.raises(ValueError, match=)` on a
// dataclass `__post_init__` guard becomes `toThrow(/…/)` against the ported message.
import { describe, expect, it } from "vitest";

import {
  validateFunnelArgs,
  type ValidateFunnelArgsOptions,
} from "../../src/query/validation-args.js";
import { Exclusion, FunnelStep, GroupBy } from "../../src/types/index.js";
import { codes } from "../../test-support/error-codes.js";

// --- Helpers (test_validation_funnel.py) ---

/**
 * Build a default-valid option bag for {@link validateFunnelArgs}.
 *
 * @param overrides - Keys to override in the defaults.
 * @returns A complete {@link ValidateFunnelArgsOptions} bag.
 */
function validFunnelArgs(
  overrides: Partial<ValidateFunnelArgsOptions> = {},
): ValidateFunnelArgsOptions {
  return {
    steps: ["Signup", "Purchase"],
    conversion_window: 14,
    conversion_window_unit: "day",
    math: "conversion_rate_unique",
    math_property: null,
    exclusions: null,
    holding_constant: null,
    from_date: null,
    to_date: null,
    last: 30,
    group_by: null,
    ...overrides,
  };
}

// --- F6: Group-by validation (delegated to validate_group_by_args) ---

/** Group-by rule codes asserted absent by several F6 tests. */
const GROUP_CODES = new Set([
  "V11_BUCKET_REQUIRES_SIZE",
  "V12_BUCKET_SIZE_POSITIVE",
  "V12B_BUCKET_REQUIRES_NUMBER",
  "V12C_BUCKET_REQUIRES_BOUNDS",
  "V18_BUCKET_ORDER",
  "V24_BUCKET_NOT_FINITE",
]);

// --- F1: At least 2 steps required ---

describe("Validate funnel args F1", () => {
  // python: TestValidateFunnelArgsF1
  it("empty steps returns F1 error", () => {
    // python: test_empty_steps_returns_f1_error
    const errors = validateFunnelArgs(validFunnelArgs({ steps: [] }));
    expect(errors.some((e) => e.code === "F1_MIN_STEPS")).toBe(true);
  });

  it("single step returns F1 error", () => {
    // python: test_single_step_returns_f1_error
    const errors = validateFunnelArgs(validFunnelArgs({ steps: ["A"] }));
    expect(errors.some((e) => e.code === "F1_MIN_STEPS")).toBe(true);
  });

  it("single funnel step object returns F1 error", () => {
    // python: test_single_funnel_step_object_returns_f1_error
    const errors = validateFunnelArgs(
      validFunnelArgs({ steps: [new FunnelStep({ event: "Signup" })] }),
    );
    expect(errors.some((e) => e.code === "F1_MIN_STEPS")).toBe(true);
  });

  it("two steps no F1 error", () => {
    // python: test_two_steps_no_f1_error
    const errors = validateFunnelArgs(validFunnelArgs({ steps: ["A", "B"] }));
    expect(codes(errors)).not.toContain("F1_MIN_STEPS");
  });

  it("three steps no F1 error", () => {
    // python: test_three_steps_no_f1_error
    const errors = validateFunnelArgs(
      validFunnelArgs({ steps: ["A", "B", "C"] }),
    );
    expect(codes(errors)).not.toContain("F1_MIN_STEPS");
  });

  it("F1 error message contains count", () => {
    // python: test_f1_error_message_contains_count
    const errors = validateFunnelArgs(validFunnelArgs({ steps: ["A"] }));
    const f1Errors = errors.filter((e) => e.code === "F1_MIN_STEPS");
    expect(f1Errors).toHaveLength(1);
    expect(f1Errors[0]!.message).toContain("1");
  });

  it("F1 error path is steps", () => {
    // python: test_f1_error_path_is_steps
    const errors = validateFunnelArgs(validFunnelArgs({ steps: [] }));
    const f1Errors = errors.filter((e) => e.code === "F1_MIN_STEPS");
    expect(f1Errors).toHaveLength(1);
    expect(f1Errors[0]!.path).toBe("steps");
  });
});

// --- F2: Each step event must be non-empty string ---

describe("Validate funnel args F2", () => {
  // python: TestValidateFunnelArgsF2
  it("empty string step returns F2 error", () => {
    // python: test_empty_string_step_returns_f2_error
    const errors = validateFunnelArgs(
      validFunnelArgs({ steps: ["Signup", ""] }),
    );
    expect(errors.some((e) => e.code === "F2_EMPTY_STEP_EVENT")).toBe(true);
  });

  it("empty string funnel step raises at construction", () => {
    // python: test_empty_string_funnel_step_raises_at_construction
    expect(() => new FunnelStep({ event: "" })).toThrow(
      /FunnelStep\.event must be a non-empty string/,
    );
  });

  it("whitespace only step returns F2 error", () => {
    // python: test_whitespace_only_step_returns_f2_error
    const errors = validateFunnelArgs(
      validFunnelArgs({ steps: ["  ", "Purchase"] }),
    );
    expect(errors.some((e) => e.code === "F2_EMPTY_STEP_EVENT")).toBe(true);
  });

  it("whitespace only funnel step raises at construction", () => {
    // python: test_whitespace_only_funnel_step_raises_at_construction
    expect(() => new FunnelStep({ event: "  \t  " })).toThrow(
      /FunnelStep\.event must be a non-empty string/,
    );
  });

  it("F2 error path contains index", () => {
    // python: test_f2_error_path_contains_index
    const errors = validateFunnelArgs(
      validFunnelArgs({ steps: ["Signup", ""] }),
    );
    const f2Errors = errors.filter((e) => e.code === "F2_EMPTY_STEP_EVENT");
    expect(f2Errors).toHaveLength(1);
    expect(f2Errors[0]!.path).toBe("steps[1]");
  });

  it("F2 error for first step", () => {
    // python: test_f2_error_for_first_step
    const errors = validateFunnelArgs(
      validFunnelArgs({ steps: ["", "Purchase"] }),
    );
    const f2Errors = errors.filter((e) => e.code === "F2_EMPTY_STEP_EVENT");
    expect(f2Errors).toHaveLength(1);
    expect(f2Errors[0]!.path).toBe("steps[0]");
  });

  it("multiple empty steps produce multiple F2 errors", () => {
    // python: test_multiple_empty_steps_produce_multiple_f2_errors
    const errors = validateFunnelArgs(
      validFunnelArgs({ steps: ["", "  ", "Purchase"] }),
    );
    const f2Errors = errors.filter((e) => e.code === "F2_EMPTY_STEP_EVENT");
    expect(f2Errors).toHaveLength(2);
    expect(new Set(f2Errors.map((e) => e.path))).toStrictEqual(
      new Set(["steps[0]", "steps[1]"]),
    );
  });

  it("valid steps no F2 error", () => {
    // python: test_valid_steps_no_f2_error
    const errors = validateFunnelArgs(
      validFunnelArgs({ steps: ["Signup", "Purchase"] }),
    );
    expect(codes(errors)).not.toContain("F2_EMPTY_STEP_EVENT");
  });

  it("valid funnel step objects no F2 error", () => {
    // python: test_valid_funnel_step_objects_no_f2_error
    const errors = validateFunnelArgs(
      validFunnelArgs({
        steps: [
          new FunnelStep({ event: "Signup" }),
          new FunnelStep({ event: "Purchase" }),
        ],
      }),
    );
    expect(codes(errors)).not.toContain("F2_EMPTY_STEP_EVENT");
  });

  it("mixed string and funnel step valid", () => {
    // python: test_mixed_string_and_funnel_step_valid
    const errors = validateFunnelArgs(
      validFunnelArgs({
        steps: ["Signup", new FunnelStep({ event: "Purchase" })],
      }),
    );
    expect(codes(errors)).not.toContain("F2_EMPTY_STEP_EVENT");
  });
});

// --- F3: Positive conversion window ---

describe("Validate funnel args F3", () => {
  // python: TestValidateFunnelArgsF3
  it("zero conversion window returns F3 error", () => {
    // python: test_zero_conversion_window_returns_f3_error
    const errors = validateFunnelArgs(
      validFunnelArgs({ conversion_window: 0 }),
    );
    expect(errors.some((e) => e.code === "F3_CONVERSION_WINDOW_POSITIVE")).toBe(
      true,
    );
  });

  it("negative conversion window returns F3 error", () => {
    // python: test_negative_conversion_window_returns_f3_error
    const errors = validateFunnelArgs(
      validFunnelArgs({ conversion_window: -1 }),
    );
    expect(errors.some((e) => e.code === "F3_CONVERSION_WINDOW_POSITIVE")).toBe(
      true,
    );
  });

  it("large negative conversion window returns F3 error", () => {
    // python: test_large_negative_conversion_window_returns_f3_error
    const errors = validateFunnelArgs(
      validFunnelArgs({ conversion_window: -100 }),
    );
    expect(errors.some((e) => e.code === "F3_CONVERSION_WINDOW_POSITIVE")).toBe(
      true,
    );
  });

  it("positive conversion window no F3 error", () => {
    // python: test_positive_conversion_window_no_f3_error
    const errors = validateFunnelArgs(
      validFunnelArgs({ conversion_window: 14 }),
    );
    expect(codes(errors)).not.toContain("F3_CONVERSION_WINDOW_POSITIVE");
  });

  it("conversion window one no F3 error", () => {
    // python: test_conversion_window_one_no_f3_error
    const errors = validateFunnelArgs(
      validFunnelArgs({ conversion_window: 1 }),
    );
    expect(codes(errors)).not.toContain("F3_CONVERSION_WINDOW_POSITIVE");
  });

  it("F3 error path is conversion window", () => {
    // python: test_f3_error_path_is_conversion_window
    const errors = validateFunnelArgs(
      validFunnelArgs({ conversion_window: 0 }),
    );
    const f3Errors = errors.filter(
      (e) => e.code === "F3_CONVERSION_WINDOW_POSITIVE",
    );
    expect(f3Errors).toHaveLength(1);
    expect(f3Errors[0]!.path).toBe("conversion_window");
  });

  it("F3 error message mentions positive", () => {
    // python: test_f3_error_message_mentions_positive
    const errors = validateFunnelArgs(
      validFunnelArgs({ conversion_window: -5 }),
    );
    const f3Errors = errors.filter(
      (e) => e.code === "F3_CONVERSION_WINDOW_POSITIVE",
    );
    expect(f3Errors).toHaveLength(1);
    expect(f3Errors[0]!.message.toLowerCase()).toContain("positive");
  });
});

// --- F4: Non-empty exclusion event names ---

describe("Validate funnel args F4", () => {
  // python: TestValidateFunnelArgsF4
  it("empty exclusion event raises at construction", () => {
    // python: test_empty_exclusion_event_raises_at_construction
    expect(() => new Exclusion({ event: "" })).toThrow(
      /Exclusion\.event must be a non-empty string/,
    );
  });

  it("whitespace exclusion event raises at construction", () => {
    // python: test_whitespace_exclusion_event_raises_at_construction
    expect(() => new Exclusion({ event: " ".repeat(3) })).toThrow(
      /Exclusion\.event must be a non-empty string/,
    );
  });

  it("valid exclusion no F4 error", () => {
    // python: test_valid_exclusion_no_f4_error
    const errors = validateFunnelArgs(
      validFunnelArgs({ exclusions: [new Exclusion({ event: "Logout" })] }),
    );
    expect(codes(errors)).not.toContain("F4_EMPTY_EXCLUSION_EVENT");
  });

  it("null exclusions no F4 error", () => {
    // python: test_none_exclusions_no_f4_error
    const errors = validateFunnelArgs(validFunnelArgs({ exclusions: null }));
    expect(codes(errors)).not.toContain("F4_EMPTY_EXCLUSION_EVENT");
  });

  it("empty list exclusions no F4 error", () => {
    // python: test_empty_list_exclusions_no_f4_error
    const errors = validateFunnelArgs(validFunnelArgs({ exclusions: [] }));
    expect(codes(errors)).not.toContain("F4_EMPTY_EXCLUSION_EVENT");
  });

  it("multiple empty exclusions produce multiple construction errors", () => {
    // python: test_multiple_empty_exclusions_produce_multiple_construction_errors
    expect(() => new Exclusion({ event: "" })).toThrow(
      /Exclusion\.event must be a non-empty string/,
    );
    expect(() => new Exclusion({ event: "  " })).toThrow(
      /Exclusion\.event must be a non-empty string/,
    );
    const errors = validateFunnelArgs(
      validFunnelArgs({ exclusions: [new Exclusion({ event: "Valid" })] }),
    );
    expect(
      errors.filter((e) => e.code === "F4_EMPTY_EXCLUSION_EVENT"),
    ).toHaveLength(0);
  });

  it("F4 error path contains index", () => {
    // python: test_f4_error_path_contains_index
    expect(() => new Exclusion({ event: "" })).toThrow(
      /Exclusion\.event must be a non-empty string/,
    );
  });

  it("F4 error path for first exclusion", () => {
    // python: test_f4_error_path_for_first_exclusion
    expect(() => new Exclusion({ event: "" })).toThrow(
      /Exclusion\.event must be a non-empty string/,
    );
  });

  it("exclusion with step range valid", () => {
    // python: test_exclusion_with_step_range_valid
    const errors = validateFunnelArgs(
      validFunnelArgs({
        exclusions: [
          new Exclusion({ event: "Logout", from_step: 0, to_step: 1 }),
        ],
      }),
    );
    expect(codes(errors)).not.toContain("F4_EMPTY_EXCLUSION_EVENT");
  });
});

// --- F5: Time validation (delegated to validate_time_args) ---

describe("Validate funnel args F5", () => {
  // python: TestValidateFunnelArgsF5
  it("invalid from date format returns V8 error", () => {
    // python: test_invalid_from_date_format_returns_v8_error
    const errors = validateFunnelArgs(
      validFunnelArgs({ from_date: "invalid" }),
    );
    expect(errors.some((e) => e.code === "V8_DATE_FORMAT")).toBe(true);
  });

  it("invalid to date format returns V8 error", () => {
    // python: test_invalid_to_date_format_returns_v8_error
    const errors = validateFunnelArgs(
      validFunnelArgs({ from_date: "2024-01-01", to_date: "not-a-date" }),
    );
    expect(errors.some((e) => e.code === "V8_DATE_FORMAT")).toBe(true);
  });

  it("valid date range no time errors", () => {
    // python: test_valid_date_range_no_time_errors
    const errors = validateFunnelArgs(
      validFunnelArgs({
        from_date: "2024-01-01",
        to_date: "2024-01-31",
        last: 30,
      }),
    );
    const timeCodes = new Set([
      "V7_LAST_POSITIVE",
      "V8_DATE_FORMAT",
      "V8_DATE_INVALID",
    ]);
    expect(errors.some((e) => timeCodes.has(e.code))).toBe(false);
  });

  it("to date without from date returns V9 error", () => {
    // python: test_to_date_without_from_date_returns_v9_error
    const errors = validateFunnelArgs(
      validFunnelArgs({ to_date: "2024-01-31" }),
    );
    expect(errors.some((e) => e.code === "V9_TO_REQUIRES_FROM")).toBe(true);
  });

  it("negative last returns V7 error", () => {
    // python: test_negative_last_returns_v7_error
    const errors = validateFunnelArgs(validFunnelArgs({ last: -1 }));
    expect(errors.some((e) => e.code === "V7_LAST_POSITIVE")).toBe(true);
  });

  it("zero last returns V7 error", () => {
    // python: test_zero_last_returns_v7_error
    const errors = validateFunnelArgs(validFunnelArgs({ last: 0 }));
    expect(errors.some((e) => e.code === "V7_LAST_POSITIVE")).toBe(true);
  });

  it("no dates with default last no time errors", () => {
    // python: test_no_dates_with_default_last_no_time_errors
    const errors = validateFunnelArgs(validFunnelArgs());
    const timeCodes = new Set([
      "V7_LAST_POSITIVE",
      "V8_DATE_FORMAT",
      "V8_DATE_INVALID",
      "V9_TO_REQUIRES_FROM",
      "V10_DATE_LAST_EXCLUSIVE",
      "V15_DATE_ORDER",
      "V20_LAST_TOO_LARGE",
    ]);
    expect(errors.some((e) => timeCodes.has(e.code))).toBe(false);
  });

  it("from date after to date returns V15 error", () => {
    // python: test_from_date_after_to_date_returns_v15_error
    const errors = validateFunnelArgs(
      validFunnelArgs({
        from_date: "2024-02-01",
        to_date: "2024-01-01",
        last: 30,
      }),
    );
    expect(errors.some((e) => e.code === "V15_DATE_ORDER")).toBe(true);
  });

  it("invalid calendar date returns V8 invalid", () => {
    // python: test_invalid_calendar_date_returns_v8_invalid
    const errors = validateFunnelArgs(
      validFunnelArgs({ from_date: "2024-02-30" }),
    );
    expect(errors.some((e) => e.code === "V8_DATE_INVALID")).toBe(true);
  });
});

describe("Validate funnel args F6", () => {
  // python: TestValidateFunnelArgsF6
  it("negative bucket size raises at construction", () => {
    // python: test_negative_bucket_size_raises_at_construction
    expect(
      () =>
        new GroupBy({
          property: "revenue",
          property_type: "number",
          bucket_size: -1,
          bucket_min: 0,
          bucket_max: 100,
        }),
    ).toThrow(/GroupBy\.bucket_size must be positive/);
  });

  it("zero bucket size raises at construction", () => {
    // python: test_zero_bucket_size_raises_at_construction
    expect(
      () =>
        new GroupBy({
          property: "revenue",
          property_type: "number",
          bucket_size: 0,
          bucket_min: 0,
          bucket_max: 100,
        }),
    ).toThrow(/GroupBy\.bucket_size must be positive/);
  });

  it("string group by no errors", () => {
    // python: test_string_group_by_no_errors
    const errors = validateFunnelArgs(
      validFunnelArgs({ group_by: "platform" }),
    );
    expect(errors.some((e) => GROUP_CODES.has(e.code))).toBe(false);
  });

  it("null group by no errors", () => {
    // python: test_none_group_by_no_errors
    const errors = validateFunnelArgs(validFunnelArgs({ group_by: null }));
    expect(errors.some((e) => GROUP_CODES.has(e.code))).toBe(false);
  });

  it("valid numeric group by no errors", () => {
    // python: test_valid_numeric_group_by_no_errors
    const errors = validateFunnelArgs(
      validFunnelArgs({
        group_by: new GroupBy({
          property: "revenue",
          property_type: "number",
          bucket_size: 50,
          bucket_min: 0,
          bucket_max: 500,
        }),
      }),
    );
    expect(errors.some((e) => GROUP_CODES.has(e.code))).toBe(false);
  });

  it("bucket min exceeds max raises at construction", () => {
    // python: test_bucket_min_exceeds_max_raises_at_construction
    expect(
      () =>
        new GroupBy({
          property: "revenue",
          property_type: "number",
          bucket_size: 10,
          bucket_min: 100,
          bucket_max: 50,
        }),
    ).toThrow(/GroupBy\.bucket_min.*must be less than/);
  });

  it("bucket without number type returns V12b error", () => {
    // python: test_bucket_without_number_type_returns_v12b_error
    const errors = validateFunnelArgs(
      validFunnelArgs({
        group_by: new GroupBy({
          property: "country",
          property_type: "string",
          bucket_size: 10,
          bucket_min: 0,
          bucket_max: 100,
        }),
      }),
    );
    expect(errors.some((e) => e.code === "V12B_BUCKET_REQUIRES_NUMBER")).toBe(
      true,
    );
  });

  it("list group by valid", () => {
    // python: test_list_group_by_valid
    const errors = validateFunnelArgs(
      validFunnelArgs({ group_by: ["platform", "country"] }),
    );
    expect(errors.some((e) => GROUP_CODES.has(e.code))).toBe(false);
  });

  it("NaN bucket size returns V24 error", () => {
    // python: test_nan_bucket_size_returns_v24_error
    const errors = validateFunnelArgs(
      validFunnelArgs({
        group_by: new GroupBy({
          property: "revenue",
          property_type: "number",
          bucket_size: Number.NaN,
          bucket_min: 0,
          bucket_max: 100,
        }),
      }),
    );
    expect(errors.some((e) => e.code === "V24_BUCKET_NOT_FINITE")).toBe(true);
  });
});

// --- Multiple errors collected ---

describe("Validate funnel args multiple errors", () => {
  // python: TestValidateFunnelArgsMultipleErrors
  it("F1 and F3 errors collected", () => {
    // python: test_f1_and_f3_errors_collected
    const errors = validateFunnelArgs(
      validFunnelArgs({ steps: ["A"], conversion_window: 0 }),
    );
    expect(codes(errors)).toContain("F1_MIN_STEPS");
    expect(codes(errors)).toContain("F3_CONVERSION_WINDOW_POSITIVE");
  });

  it("F1 F2 F3 F4 errors collected", () => {
    // python: test_f1_f2_f3_f4_errors_collected
    expect(() => new Exclusion({ event: "" })).toThrow(
      /Exclusion\.event must be a non-empty string/,
    );
    expect(() => new Exclusion({ event: "  " })).toThrow(
      /Exclusion\.event must be a non-empty string/,
    );
    const errors = validateFunnelArgs(
      validFunnelArgs({ steps: [""], conversion_window: -1 }),
    );
    expect(codes(errors)).toContain("F1_MIN_STEPS");
    expect(codes(errors)).toContain("F2_EMPTY_STEP_EVENT");
    expect(codes(errors)).toContain("F3_CONVERSION_WINDOW_POSITIVE");
  });

  it("funnel and time errors collected", () => {
    // python: test_funnel_and_time_errors_collected
    const errors = validateFunnelArgs(
      validFunnelArgs({ steps: ["A"], from_date: "bad-date" }),
    );
    expect(codes(errors)).toContain("F1_MIN_STEPS");
    expect(codes(errors)).toContain("V8_DATE_FORMAT");
  });

  it("funnel and group by errors collected", () => {
    // python: test_funnel_and_group_by_errors_collected
    expect(
      () =>
        new GroupBy({
          property: "revenue",
          property_type: "number",
          bucket_size: -1,
          bucket_min: 0,
          bucket_max: 100,
        }),
    ).toThrow(/GroupBy\.bucket_size must be positive/);
    const errors = validateFunnelArgs(
      validFunnelArgs({ conversion_window: 0 }),
    );
    expect(codes(errors)).toContain("F3_CONVERSION_WINDOW_POSITIVE");
  });

  it("all rules violated at once", () => {
    // python: test_all_rules_violated_at_once
    expect(() => new Exclusion({ event: "" })).toThrow(
      /Exclusion\.event must be a non-empty string/,
    );
    expect(
      () =>
        new GroupBy({
          property: "revenue",
          property_type: "number",
          bucket_size: -1,
          bucket_min: 0,
          bucket_max: 100,
        }),
    ).toThrow(/GroupBy\.bucket_size must be positive/);
    expect(() => new Exclusion({ event: "  " })).toThrow(
      /Exclusion\.event must be a non-empty string/,
    );
    const errors = validateFunnelArgs({
      steps: [""],
      conversion_window: 0,
      exclusions: null,
      from_date: "not-a-date",
      to_date: null,
      last: 30,
      group_by: "revenue",
    });
    expect(codes(errors)).toContain("F1_MIN_STEPS");
    expect(codes(errors)).toContain("F2_EMPTY_STEP_EVENT");
    expect(codes(errors)).toContain("F3_CONVERSION_WINDOW_POSITIVE");
    expect(codes(errors)).toContain("V8_DATE_FORMAT");
  });

  it("valid args return empty error list", () => {
    // python: test_valid_args_return_empty_error_list
    const errors = validateFunnelArgs(validFunnelArgs());
    expect(errors).toStrictEqual([]);
  });

  it("valid args with all fields populated", () => {
    // python: test_valid_args_with_all_fields_populated
    const errors = validateFunnelArgs({
      steps: ["Signup", new FunnelStep({ event: "Add to Cart" }), "Purchase"],
      conversion_window: 30,
      exclusions: [
        new Exclusion({ event: "Logout" }),
        new Exclusion({ event: "Refund", from_step: 1, to_step: 2 }),
      ],
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      last: 30,
      group_by: "platform",
    });
    expect(errors).toStrictEqual([]);
  });

  it("error count matches distinct violations", () => {
    // python: test_error_count_matches_distinct_violations
    const errors = validateFunnelArgs(
      validFunnelArgs({ steps: ["", "  ", "Valid"], conversion_window: -1 }),
    );
    const f2Count = errors.filter(
      (e) => e.code === "F2_EMPTY_STEP_EVENT",
    ).length;
    const f3Count = errors.filter(
      (e) => e.code === "F3_CONVERSION_WINDOW_POSITIVE",
    ).length;
    expect(f2Count).toBe(2);
    expect(f3Count).toBe(1);
  });
});

// --- Exclusion step range validation (F4b, F4c, F4d) ---

describe("Validate funnel args exclusion ranges", () => {
  // python: TestValidateFunnelArgsExclusionRanges
  it("to step less than from step raises at construction", () => {
    // python: test_to_step_less_than_from_step_raises_at_construction
    expect(
      () => new Exclusion({ event: "Logout", from_step: 2, to_step: 1 }),
    ).toThrow(/Exclusion\.to_step.*must be >= from_step/);
  });

  it("to step exceeds step count returns bounds error", () => {
    // python: test_to_step_exceeds_step_count_returns_bounds_error
    const errors = validateFunnelArgs(
      validFunnelArgs({
        steps: ["A", "B"],
        exclusions: [
          new Exclusion({ event: "Logout", from_step: 0, to_step: 5 }),
        ],
      }),
    );
    expect(errors.some((e) => e.code === "F4_EXCLUSION_STEP_BOUNDS")).toBe(
      true,
    );
  });

  it("from step exceeds step count returns bounds error", () => {
    // python: test_from_step_exceeds_step_count_returns_bounds_error
    const errors = validateFunnelArgs(
      validFunnelArgs({
        steps: ["A", "B"],
        exclusions: [new Exclusion({ event: "Logout", from_step: 3 })],
      }),
    );
    expect(errors.some((e) => e.code === "F4_EXCLUSION_STEP_BOUNDS")).toBe(
      true,
    );
  });

  it("valid exclusion range no range errors", () => {
    // python: test_valid_exclusion_range_no_range_errors
    const errors = validateFunnelArgs(
      validFunnelArgs({
        steps: ["A", "B"],
        exclusions: [new Exclusion({ event: "X", from_step: 0, to_step: 1 })],
      }),
    );
    const rangeCodes = new Set([
      "F4_EXCLUSION_STEP_ORDER",
      "F4_EXCLUSION_STEP_BOUNDS",
    ]);
    expect(errors.some((e) => rangeCodes.has(e.code))).toBe(false);
  });

  it("exclusion with default steps no range errors", () => {
    // python: test_exclusion_with_default_steps_no_range_errors
    const errors = validateFunnelArgs(
      validFunnelArgs({ exclusions: [new Exclusion({ event: "X" })] }),
    );
    const rangeCodes = new Set([
      "F4_EXCLUSION_STEP_ORDER",
      "F4_EXCLUSION_STEP_BOUNDS",
    ]);
    expect(errors.some((e) => rangeCodes.has(e.code))).toBe(false);
  });

  it("mixed valid and invalid exclusions", () => {
    // python: test_mixed_valid_and_invalid_exclusions
    const valid = new Exclusion({ event: "Valid", from_step: 0, to_step: 1 });
    expect(valid.event).toBe("Valid");
    expect(
      () => new Exclusion({ event: "Invalid", from_step: 2, to_step: 1 }),
    ).toThrow(/Exclusion\.to_step.*must be >= from_step/);
  });

  it("same from and to step is rejected", () => {
    // python: test_same_from_and_to_step_is_rejected
    const errors = validateFunnelArgs(
      validFunnelArgs({
        steps: ["A", "B"],
        exclusions: [new Exclusion({ event: "X", from_step: 0, to_step: 0 })],
      }),
    );
    expect(codes(errors)).toContain("F4_EXCLUSION_STEP_ORDER");
  });

  it("adjacent steps is valid", () => {
    // python: test_adjacent_steps_is_valid
    const errors = validateFunnelArgs(
      validFunnelArgs({
        steps: ["A", "B", "C"],
        exclusions: [new Exclusion({ event: "X", from_step: 0, to_step: 1 })],
      }),
    );
    const rangeCodes = new Set([
      "F4_EXCLUSION_STEP_ORDER",
      "F4_EXCLUSION_STEP_BOUNDS",
    ]);
    expect(errors.some((e) => rangeCodes.has(e.code))).toBe(false);
  });
});

// --- F7: conversion window unit validation ---

describe("Validate funnel args F7", () => {
  // python: TestValidateFunnelArgsF7
  it("invalid unit returns F7 error", () => {
    // python: test_invalid_unit_returns_f7_error
    const errors = validateFunnelArgs(
      validFunnelArgs({ conversion_window_unit: "invalid" }),
    );
    expect(codes(errors)).toContain("F7_INVALID_WINDOW_UNIT");
  });

  it("valid units no F7 error", () => {
    // python: test_valid_units_no_f7_error
    for (const unit of [
      "second",
      "minute",
      "hour",
      "day",
      "week",
      "month",
      "session",
    ]) {
      const errors = validateFunnelArgs(
        validFunnelArgs({
          conversion_window: 2,
          conversion_window_unit: unit,
        }),
      );
      const f7 = errors.filter((e) => e.code.startsWith("F7"));
      expect(f7, `unit='${unit}' should be valid`).toStrictEqual([]);
    }
  });

  it("invalid unit has suggestion", () => {
    // python: test_invalid_unit_has_suggestion
    const errors = validateFunnelArgs(
      validFunnelArgs({ conversion_window_unit: "hou" }),
    );
    const f7 = errors.filter((e) => e.code === "F7_INVALID_WINDOW_UNIT");
    expect(f7).toHaveLength(1);
    expect(f7[0]!.suggestion).not.toBeNull();
    expect(f7[0]!.suggestion).toContain("hour");
  });

  it("second unit min 2 returns F7b error", () => {
    // python: test_second_unit_min_2_returns_f7b_error
    const errors = validateFunnelArgs(
      validFunnelArgs({
        conversion_window: 1,
        conversion_window_unit: "second",
      }),
    );
    expect(codes(errors)).toContain("F7_SECOND_MIN_WINDOW");
  });

  it("second unit with 2 passes", () => {
    // python: test_second_unit_with_2_passes
    const errors = validateFunnelArgs(
      validFunnelArgs({
        conversion_window: 2,
        conversion_window_unit: "second",
      }),
    );
    expect(codes(errors)).not.toContain("F7_SECOND_MIN_WINDOW");
  });

  it("day unit with 1 passes", () => {
    // python: test_day_unit_with_1_passes
    const errors = validateFunnelArgs(
      validFunnelArgs({ conversion_window: 1, conversion_window_unit: "day" }),
    );
    expect(errors.filter((e) => e.code.startsWith("F7"))).toStrictEqual([]);
  });

  it("F7b error has suggestion", () => {
    // python: test_f7b_error_has_suggestion
    const errors = validateFunnelArgs(
      validFunnelArgs({
        conversion_window: 1,
        conversion_window_unit: "second",
      }),
    );
    const f7b = errors.filter((e) => e.code === "F7_SECOND_MIN_WINDOW");
    expect(f7b).toHaveLength(1);
    expect(f7b[0]!.suggestion).not.toBeNull();
    expect(f7b[0]!.suggestion).toContain("2");
  });

  it("default unit is day", () => {
    // python: test_default_unit_is_day
    const errors = validateFunnelArgs(validFunnelArgs());
    expect(errors.filter((e) => e.code.startsWith("F7"))).toStrictEqual([]);
  });
});
