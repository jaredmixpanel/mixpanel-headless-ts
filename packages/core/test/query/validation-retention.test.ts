/**
 * Layer-3 translation of `tests/test_validation_retention.py`
 * (Python revision: `ts-port/phase2-contract-support` HEAD; 1087 LOC).
 *
 * Scope per b2-packets.md §V1a: the `validate_retention_args` classes.
 * `TestValidateBookmarkRetentionB20` / `B21` /
 * `TestValidateBookmarkRetentionB9MathDispatch` drive
 * `validate_bookmark` — B2 shard V1b.
 *
 * R10.2: assertion-for-assertion. Suggestion-content asserts are kept
 * verbatim (Cautions §6 — they pin the difflib port).
 */

import { describe, expect, it } from "vitest";

import {
  validateRetentionArgs,
  type ValidateRetentionArgsOptions,
} from "../../src/query/validation-args.js";
import { GroupBy } from "../../src/types/index.js";
import { codes } from "../../test-support/error-codes.js";

// =============================================================================
// Helpers (test_validation_retention.py)
// =============================================================================

/**
 * Build a default-valid option bag for {@link validateRetentionArgs}.
 *
 * @param overrides - Keys to override in the defaults.
 * @returns A complete {@link ValidateRetentionArgsOptions} bag.
 */
function validRetentionArgs(
  overrides: Partial<ValidateRetentionArgsOptions> = {},
): ValidateRetentionArgsOptions {
  return {
    born_event: "Signup",
    return_event: "Login",
    retention_unit: "week",
    alignment: "birth",
    bucket_sizes: null,
    math: "retention_rate",
    mode: "curve",
    unit: "day",
    from_date: null,
    to_date: null,
    last: 30,
    group_by: null,
    ...overrides,
  };
}

/** Group-by rule codes asserted absent by the R4 delegation tests. */
const GROUP_CODES = new Set([
  "V11_BUCKET_REQUIRES_SIZE",
  "V12_BUCKET_SIZE_POSITIVE",
  "V12B_BUCKET_REQUIRES_NUMBER",
  "V12C_BUCKET_REQUIRES_BOUNDS",
  "V18_BUCKET_ORDER",
  "V24_BUCKET_NOT_FINITE",
]);

// =============================================================================
// T011: R1 — born_event must be non-empty string
// =============================================================================

describe("Validate retention R1", () => {
  // python: TestValidateRetentionR1
  it("empty born event returns R1 error", () => {
    // python: test_empty_born_event_returns_r1_error
    const errors = validateRetentionArgs(
      validRetentionArgs({ born_event: "" }),
    );
    expect(errors.some((e) => e.code === "R1_EMPTY_BORN_EVENT")).toBe(true);
  });

  it("whitespace only born event returns R1 error", () => {
    // python: test_whitespace_only_born_event_returns_r1_error
    const errors = validateRetentionArgs(
      validRetentionArgs({ born_event: " ".repeat(3) }),
    );
    expect(errors.some((e) => e.code === "R1_EMPTY_BORN_EVENT")).toBe(true);
  });

  it("tab only born event returns R1 error", () => {
    // python: test_tab_only_born_event_returns_r1_error
    const errors = validateRetentionArgs(
      validRetentionArgs({ born_event: "\t\t" }),
    );
    expect(errors.some((e) => e.code === "R1_EMPTY_BORN_EVENT")).toBe(true);
  });

  it("control char in born event returns R1 control error", () => {
    // python: test_control_char_in_born_event_returns_r1_control_error
    const errors = validateRetentionArgs(
      validRetentionArgs({ born_event: "Sign\u0000up" }),
    );
    expect(errors.some((e) => e.code === "R1_CONTROL_CHAR_BORN_EVENT")).toBe(
      true,
    );
  });

  it("bell char in born event returns R1 control error", () => {
    // python: test_bell_char_in_born_event_returns_r1_control_error
    const errors = validateRetentionArgs(
      validRetentionArgs({ born_event: "Sign\u0007up" }),
    );
    expect(errors.some((e) => e.code === "R1_CONTROL_CHAR_BORN_EVENT")).toBe(
      true,
    );
  });

  it("invisible only born event returns R1 invisible error", () => {
    // python: test_invisible_only_born_event_returns_r1_invisible_error
    const errors = validateRetentionArgs(
      validRetentionArgs({ born_event: "\u200B" }),
    );
    expect(errors.some((e) => e.code === "R1_INVISIBLE_BORN_EVENT")).toBe(true);
  });

  it("zero width joiner only returns R1 invisible error", () => {
    // python: test_zero_width_joiner_only_returns_r1_invisible_error
    const errors = validateRetentionArgs(
      validRetentionArgs({ born_event: "\u200D\u200D" }),
    );
    expect(errors.some((e) => e.code === "R1_INVISIBLE_BORN_EVENT")).toBe(true);
  });

  it("valid born event no R1 error", () => {
    // python: test_valid_born_event_no_r1_error
    const errors = validateRetentionArgs(
      validRetentionArgs({ born_event: "Signup" }),
    );
    const r1Codes = new Set([
      "R1_EMPTY_BORN_EVENT",
      "R1_CONTROL_CHAR_BORN_EVENT",
      "R1_INVISIBLE_BORN_EVENT",
    ]);
    expect(errors.some((e) => r1Codes.has(e.code))).toBe(false);
  });

  it("born event with spaces is valid", () => {
    // python: test_born_event_with_spaces_is_valid
    const errors = validateRetentionArgs(
      validRetentionArgs({ born_event: "User Signup" }),
    );
    const r1Codes = new Set([
      "R1_EMPTY_BORN_EVENT",
      "R1_CONTROL_CHAR_BORN_EVENT",
      "R1_INVISIBLE_BORN_EVENT",
    ]);
    expect(errors.some((e) => r1Codes.has(e.code))).toBe(false);
  });

  it("R1 error path is born event", () => {
    // python: test_r1_error_path_is_born_event
    const errors = validateRetentionArgs(
      validRetentionArgs({ born_event: "" }),
    );
    const r1Errors = errors.filter((e) => e.code === "R1_EMPTY_BORN_EVENT");
    expect(r1Errors).toHaveLength(1);
    expect(r1Errors[0]!.path).toBe("born_event");
  });
});

// =============================================================================
// T012: R2 — return_event must be non-empty string
// =============================================================================

describe("Validate retention R2", () => {
  // python: TestValidateRetentionR2
  it("empty return event returns R2 error", () => {
    // python: test_empty_return_event_returns_r2_error
    const errors = validateRetentionArgs(
      validRetentionArgs({ return_event: "" }),
    );
    expect(errors.some((e) => e.code === "R2_EMPTY_RETURN_EVENT")).toBe(true);
  });

  it("whitespace only return event returns R2 error", () => {
    // python: test_whitespace_only_return_event_returns_r2_error
    const errors = validateRetentionArgs(
      validRetentionArgs({ return_event: " ".repeat(3) }),
    );
    expect(errors.some((e) => e.code === "R2_EMPTY_RETURN_EVENT")).toBe(true);
  });

  it("tab only return event returns R2 error", () => {
    // python: test_tab_only_return_event_returns_r2_error
    const errors = validateRetentionArgs(
      validRetentionArgs({ return_event: "\t\t" }),
    );
    expect(errors.some((e) => e.code === "R2_EMPTY_RETURN_EVENT")).toBe(true);
  });

  it("control char in return event returns R2 control error", () => {
    // python: test_control_char_in_return_event_returns_r2_control_error
    const errors = validateRetentionArgs(
      validRetentionArgs({ return_event: "Log\u0000in" }),
    );
    expect(errors.some((e) => e.code === "R2_CONTROL_CHAR_RETURN_EVENT")).toBe(
      true,
    );
  });

  it("escape char in return event returns R2 control error", () => {
    // python: test_escape_char_in_return_event_returns_r2_control_error
    const errors = validateRetentionArgs(
      validRetentionArgs({ return_event: "Log\u001Bin" }),
    );
    expect(errors.some((e) => e.code === "R2_CONTROL_CHAR_RETURN_EVENT")).toBe(
      true,
    );
  });

  it("invisible only return event returns R2 invisible error", () => {
    // python: test_invisible_only_return_event_returns_r2_invisible_error
    const errors = validateRetentionArgs(
      validRetentionArgs({ return_event: "\u200B" }),
    );
    expect(errors.some((e) => e.code === "R2_INVISIBLE_RETURN_EVENT")).toBe(
      true,
    );
  });

  it("zero width non joiner only returns R2 invisible error", () => {
    // python: test_zero_width_non_joiner_only_returns_r2_invisible_error
    const errors = validateRetentionArgs(
      validRetentionArgs({ return_event: "\u200C\u200C" }),
    );
    expect(errors.some((e) => e.code === "R2_INVISIBLE_RETURN_EVENT")).toBe(
      true,
    );
  });

  it("valid return event no R2 error", () => {
    // python: test_valid_return_event_no_r2_error
    const errors = validateRetentionArgs(
      validRetentionArgs({ return_event: "Login" }),
    );
    const r2Codes = new Set([
      "R2_EMPTY_RETURN_EVENT",
      "R2_CONTROL_CHAR_RETURN_EVENT",
      "R2_INVISIBLE_RETURN_EVENT",
    ]);
    expect(errors.some((e) => r2Codes.has(e.code))).toBe(false);
  });

  it("return event with unicode is valid", () => {
    // python: test_return_event_with_unicode_is_valid
    const errors = validateRetentionArgs(
      validRetentionArgs({ return_event: "Compra Realizada" }),
    );
    const r2Codes = new Set([
      "R2_EMPTY_RETURN_EVENT",
      "R2_CONTROL_CHAR_RETURN_EVENT",
      "R2_INVISIBLE_RETURN_EVENT",
    ]);
    expect(errors.some((e) => r2Codes.has(e.code))).toBe(false);
  });

  it("R2 error path is return event", () => {
    // python: test_r2_error_path_is_return_event
    const errors = validateRetentionArgs(
      validRetentionArgs({ return_event: "" }),
    );
    const r2Errors = errors.filter((e) => e.code === "R2_EMPTY_RETURN_EVENT");
    expect(r2Errors).toHaveLength(1);
    expect(r2Errors[0]!.path).toBe("return_event");
  });
});

// =============================================================================
// T013: R7/R8/R9 — enum validations with fuzzy suggestion
// =============================================================================

describe("Validate retention R7 R8 R9", () => {
  // python: TestValidateRetentionR7R8R9
  it("invalid retention unit returns R7 error", () => {
    // python: test_invalid_retention_unit_returns_r7_error
    const errors = validateRetentionArgs(
      validRetentionArgs({ retention_unit: "invalid" }),
    );
    expect(errors.some((e) => e.code === "R7_INVALID_RETENTION_UNIT")).toBe(
      true,
    );
  });

  it("valid retention unit day no R7 error", () => {
    // python: test_valid_retention_unit_day_no_r7_error
    const errors = validateRetentionArgs(
      validRetentionArgs({ retention_unit: "day" }),
    );
    expect(codes(errors)).not.toContain("R7_INVALID_RETENTION_UNIT");
  });

  it("valid retention unit week no R7 error", () => {
    // python: test_valid_retention_unit_week_no_r7_error
    const errors = validateRetentionArgs(
      validRetentionArgs({ retention_unit: "week" }),
    );
    expect(codes(errors)).not.toContain("R7_INVALID_RETENTION_UNIT");
  });

  it("valid retention unit month no R7 error", () => {
    // python: test_valid_retention_unit_month_no_r7_error
    const errors = validateRetentionArgs(
      validRetentionArgs({ retention_unit: "month" }),
    );
    expect(codes(errors)).not.toContain("R7_INVALID_RETENTION_UNIT");
  });

  it("retention unit close match has suggestion", () => {
    // python: test_retention_unit_close_match_has_suggestion
    const errors = validateRetentionArgs(
      validRetentionArgs({ retention_unit: "wek" }),
    );
    const r7Errors = errors.filter(
      (e) => e.code === "R7_INVALID_RETENTION_UNIT",
    );
    expect(r7Errors).toHaveLength(1);
    expect(r7Errors[0]!.suggestion).not.toBeNull();
    expect(r7Errors[0]!.suggestion).toContain("week");
  });

  it("retention unit case sensitive", () => {
    // python: test_retention_unit_case_sensitive
    const errors = validateRetentionArgs(
      validRetentionArgs({ retention_unit: "Week" }),
    );
    expect(errors.some((e) => e.code === "R7_INVALID_RETENTION_UNIT")).toBe(
      true,
    );
  });

  it("R7 error path is retention unit", () => {
    // python: test_r7_error_path_is_retention_unit
    const errors = validateRetentionArgs(
      validRetentionArgs({ retention_unit: "invalid" }),
    );
    const r7Errors = errors.filter(
      (e) => e.code === "R7_INVALID_RETENTION_UNIT",
    );
    expect(r7Errors).toHaveLength(1);
    expect(r7Errors[0]!.path).toBe("retention_unit");
  });

  it("invalid alignment returns R8 error", () => {
    // python: test_invalid_alignment_returns_r8_error
    const errors = validateRetentionArgs(
      validRetentionArgs({ alignment: "invalid" }),
    );
    expect(errors.some((e) => e.code === "R8_INVALID_ALIGNMENT")).toBe(true);
  });

  it("valid alignment birth no R8 error", () => {
    // python: test_valid_alignment_birth_no_r8_error
    const errors = validateRetentionArgs(
      validRetentionArgs({ alignment: "birth" }),
    );
    expect(codes(errors)).not.toContain("R8_INVALID_ALIGNMENT");
  });

  it("valid alignment interval start no R8 error", () => {
    // python: test_valid_alignment_interval_start_no_r8_error
    const errors = validateRetentionArgs(
      validRetentionArgs({ alignment: "interval_start" }),
    );
    expect(codes(errors)).not.toContain("R8_INVALID_ALIGNMENT");
  });

  it("alignment close match has suggestion", () => {
    // python: test_alignment_close_match_has_suggestion
    const errors = validateRetentionArgs(
      validRetentionArgs({ alignment: "brith" }),
    );
    const r8Errors = errors.filter((e) => e.code === "R8_INVALID_ALIGNMENT");
    expect(r8Errors).toHaveLength(1);
    expect(r8Errors[0]!.suggestion).not.toBeNull();
    expect(r8Errors[0]!.suggestion).toContain("birth");
  });

  it("alignment case sensitive", () => {
    // python: test_alignment_case_sensitive
    const errors = validateRetentionArgs(
      validRetentionArgs({ alignment: "Birth" }),
    );
    expect(errors.some((e) => e.code === "R8_INVALID_ALIGNMENT")).toBe(true);
  });

  it("R8 error path is alignment", () => {
    // python: test_r8_error_path_is_alignment
    const errors = validateRetentionArgs(
      validRetentionArgs({ alignment: "invalid" }),
    );
    const r8Errors = errors.filter((e) => e.code === "R8_INVALID_ALIGNMENT");
    expect(r8Errors).toHaveLength(1);
    expect(r8Errors[0]!.path).toBe("alignment");
  });

  it("invalid math returns R9 error", () => {
    // python: test_invalid_math_returns_r9_error
    const errors = validateRetentionArgs(
      validRetentionArgs({ math: "invalid" }),
    );
    expect(errors.some((e) => e.code === "R9_INVALID_MATH")).toBe(true);
  });

  it("valid math retention rate no R9 error", () => {
    // python: test_valid_math_retention_rate_no_r9_error
    const errors = validateRetentionArgs(
      validRetentionArgs({ math: "retention_rate" }),
    );
    expect(codes(errors)).not.toContain("R9_INVALID_MATH");
  });

  it("valid math unique no R9 error", () => {
    // python: test_valid_math_unique_no_r9_error
    const errors = validateRetentionArgs(
      validRetentionArgs({ math: "unique" }),
    );
    expect(codes(errors)).not.toContain("R9_INVALID_MATH");
  });

  it("math close match has suggestion", () => {
    // python: test_math_close_match_has_suggestion
    const errors = validateRetentionArgs(validRetentionArgs({ math: "uniue" }));
    const r9Errors = errors.filter((e) => e.code === "R9_INVALID_MATH");
    expect(r9Errors).toHaveLength(1);
    expect(r9Errors[0]!.suggestion).not.toBeNull();
    expect(r9Errors[0]!.suggestion).toContain("unique");
  });

  it("math case sensitive", () => {
    // python: test_math_case_sensitive
    const errors = validateRetentionArgs(
      validRetentionArgs({ math: "Unique" }),
    );
    expect(errors.some((e) => e.code === "R9_INVALID_MATH")).toBe(true);
  });

  it("R9 error path is math", () => {
    // python: test_r9_error_path_is_math
    const errors = validateRetentionArgs(
      validRetentionArgs({ math: "invalid" }),
    );
    const r9Errors = errors.filter((e) => e.code === "R9_INVALID_MATH");
    expect(r9Errors).toHaveLength(1);
    expect(r9Errors[0]!.path).toBe("math");
  });

  it("all defaults pass validation", () => {
    // python: test_all_defaults_pass_validation
    const errors = validateRetentionArgs(validRetentionArgs());
    expect(errors).toStrictEqual([]);
  });
});

// =============================================================================
// T014: R3/R4 — delegation to shared validators
// =============================================================================

describe("Validate retention delegation", () => {
  // python: TestValidateRetentionDelegation
  it("zero last returns V7 error", () => {
    // python: test_zero_last_returns_v7_error
    const errors = validateRetentionArgs(validRetentionArgs({ last: 0 }));
    expect(errors.some((e) => e.code === "V7_LAST_POSITIVE")).toBe(true);
  });

  it("negative last returns V7 error", () => {
    // python: test_negative_last_returns_v7_error
    const errors = validateRetentionArgs(validRetentionArgs({ last: -5 }));
    expect(errors.some((e) => e.code === "V7_LAST_POSITIVE")).toBe(true);
  });

  it("positive last no V7 error", () => {
    // python: test_positive_last_no_v7_error
    const errors = validateRetentionArgs(validRetentionArgs({ last: 30 }));
    expect(codes(errors)).not.toContain("V7_LAST_POSITIVE");
  });

  it("invalid from date format returns V8 error", () => {
    // python: test_invalid_from_date_format_returns_v8_error
    const errors = validateRetentionArgs(
      validRetentionArgs({ from_date: "invalid" }),
    );
    expect(errors.some((e) => e.code === "V8_DATE_FORMAT")).toBe(true);
  });

  it("to date without from date returns V9 error", () => {
    // python: test_to_date_without_from_date_returns_v9_error
    const errors = validateRetentionArgs(
      validRetentionArgs({ to_date: "2024-01-31" }),
    );
    expect(errors.some((e) => e.code === "V9_TO_REQUIRES_FROM")).toBe(true);
  });

  it("valid date range no time errors", () => {
    // python: test_valid_date_range_no_time_errors
    const errors = validateRetentionArgs(
      validRetentionArgs({
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

  it("no dates with default last no time errors", () => {
    // python: test_no_dates_with_default_last_no_time_errors
    const errors = validateRetentionArgs(validRetentionArgs());
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
    const errors = validateRetentionArgs(
      validRetentionArgs({
        from_date: "2024-02-01",
        to_date: "2024-01-01",
        last: 30,
      }),
    );
    expect(errors.some((e) => e.code === "V15_DATE_ORDER")).toBe(true);
  });

  it("negative bucket size returns V12 error", () => {
    // python: test_negative_bucket_size_returns_v12_error
    expect(
      () =>
        new GroupBy({
          property: "revenue",
          property_type: "number",
          bucket_size: -1,
          bucket_min: 0,
          bucket_max: 100,
        }),
    ).toThrow(/bucket_size must be positive/);
  });

  it("zero bucket size returns V12 error", () => {
    // python: test_zero_bucket_size_returns_v12_error
    expect(
      () =>
        new GroupBy({
          property: "revenue",
          property_type: "number",
          bucket_size: 0,
          bucket_min: 0,
          bucket_max: 100,
        }),
    ).toThrow(/bucket_size must be positive/);
  });

  it("string group by no errors", () => {
    // python: test_string_group_by_no_errors
    const errors = validateRetentionArgs(
      validRetentionArgs({ group_by: "platform" }),
    );
    expect(errors.some((e) => GROUP_CODES.has(e.code))).toBe(false);
  });

  it("null group by no errors", () => {
    // python: test_none_group_by_no_errors
    const errors = validateRetentionArgs(
      validRetentionArgs({ group_by: null }),
    );
    expect(errors.some((e) => GROUP_CODES.has(e.code))).toBe(false);
  });

  it("valid numeric group by no errors", () => {
    // python: test_valid_numeric_group_by_no_errors
    const errors = validateRetentionArgs(
      validRetentionArgs({
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

  it("bucket min exceeds max returns V18 error", () => {
    // python: test_bucket_min_exceeds_max_returns_v18_error
    expect(
      () =>
        new GroupBy({
          property: "revenue",
          property_type: "number",
          bucket_size: 10,
          bucket_min: 100,
          bucket_max: 50,
        }),
    ).toThrow(/bucket_min.*must be less than/);
  });

  it("list group by valid", () => {
    // python: test_list_group_by_valid
    const errors = validateRetentionArgs(
      validRetentionArgs({ group_by: ["platform", "country"] }),
    );
    expect(errors.some((e) => GROUP_CODES.has(e.code))).toBe(false);
  });
});

// =============================================================================
// T-US3: R5/R6 — bucket_sizes validation
// =============================================================================

describe("Validate retention R5 R6", () => {
  // python: TestValidateRetentionR5R6
  it("bucket sizes positive integers pass", () => {
    // python: test_bucket_sizes_positive_integers_pass
    const errors = validateRetentionArgs(
      validRetentionArgs({ bucket_sizes: [1, 3, 7] }),
    );
    expect(codes(errors)).not.toContain("R5_BUCKET_SIZES_POSITIVE");
    expect(codes(errors)).not.toContain("R5_BUCKET_SIZES_INTEGER");
  });

  it("bucket sizes zero returns R5 error", () => {
    // python: test_bucket_sizes_zero_returns_r5_error
    const errors = validateRetentionArgs(
      validRetentionArgs({ bucket_sizes: [0, 3] }),
    );
    expect(errors.some((e) => e.code === "R5_BUCKET_SIZES_POSITIVE")).toBe(
      true,
    );
  });

  it("bucket sizes negative returns R5 error", () => {
    // python: test_bucket_sizes_negative_returns_r5_error
    const errors = validateRetentionArgs(
      validRetentionArgs({ bucket_sizes: [-1, 3] }),
    );
    expect(errors.some((e) => e.code === "R5_BUCKET_SIZES_POSITIVE")).toBe(
      true,
    );
  });

  it("bucket sizes float returns R5 error", () => {
    // python: test_bucket_sizes_float_returns_r5_error
    const errors = validateRetentionArgs(
      validRetentionArgs({ bucket_sizes: [1.5, 3] }),
    );
    expect(errors.some((e) => e.code === "R5_BUCKET_SIZES_INTEGER")).toBe(true);
  });

  it("bucket sizes ascending pass", () => {
    // python: test_bucket_sizes_ascending_pass
    const errors = validateRetentionArgs(
      validRetentionArgs({ bucket_sizes: [1, 3, 7, 14] }),
    );
    expect(codes(errors)).not.toContain("R6_BUCKET_SIZES_ASCENDING");
  });

  it("bucket sizes not ascending returns R6 error", () => {
    // python: test_bucket_sizes_not_ascending_returns_r6_error
    const errors = validateRetentionArgs(
      validRetentionArgs({ bucket_sizes: [7, 3, 1] }),
    );
    expect(errors.some((e) => e.code === "R6_BUCKET_SIZES_ASCENDING")).toBe(
      true,
    );
  });

  it("bucket sizes duplicates returns R6 error", () => {
    // python: test_bucket_sizes_duplicates_returns_r6_error
    const errors = validateRetentionArgs(
      validRetentionArgs({ bucket_sizes: [3, 3, 7] }),
    );
    expect(errors.some((e) => e.code === "R6_BUCKET_SIZES_ASCENDING")).toBe(
      true,
    );
  });

  it("bucket sizes null no errors", () => {
    // python: test_bucket_sizes_none_no_errors
    const errors = validateRetentionArgs(
      validRetentionArgs({ bucket_sizes: null }),
    );
    const r5r6Codes = new Set([
      "R5_BUCKET_SIZES_POSITIVE",
      "R5_BUCKET_SIZES_INTEGER",
      "R6_BUCKET_SIZES_ASCENDING",
    ]);
    expect(errors.some((e) => r5r6Codes.has(e.code))).toBe(false);
  });

  it("bucket sizes with invalid types skips R6", () => {
    // python: test_bucket_sizes_with_invalid_types_skips_r6
    const errors = validateRetentionArgs(
      validRetentionArgs({ bucket_sizes: [3, 1.5, 7] }),
    );
    expect(errors.some((e) => e.code === "R5_BUCKET_SIZES_INTEGER")).toBe(true);
    expect(codes(errors)).not.toContain("R6_BUCKET_SIZES_ASCENDING");
  });

  it("bucket sizes with non positive skips R6", () => {
    // python: test_bucket_sizes_with_non_positive_skips_r6
    const errors = validateRetentionArgs(
      validRetentionArgs({ bucket_sizes: [0, -1, 3] }),
    );
    expect(errors.some((e) => e.code === "R5_BUCKET_SIZES_POSITIVE")).toBe(
      true,
    );
    expect(codes(errors)).not.toContain("R6_BUCKET_SIZES_ASCENDING");
  });
});
