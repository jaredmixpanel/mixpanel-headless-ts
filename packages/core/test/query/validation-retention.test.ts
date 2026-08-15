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

import { describe, it, expect } from "vitest";
import { GroupBy } from "../../src/types/index.js";
import type { ValidationError } from "../../src/errors.js";
import {
  validateRetentionArgs,
  type ValidateRetentionArgsOptions,
} from "../../src/query/validation-args.js";

// =============================================================================
// Helpers (test_validation_retention.py:39-78)
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

/**
 * Extract error codes — port of the module helper `_codes(errors)`.
 *
 * @param errors - Validation errors.
 * @returns The codes, in emission order.
 */
function codes(errors: readonly ValidationError[]): string[] {
  return errors.map((e) => e.code);
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

describe("TestValidateRetentionR1", () => {
  it("test_empty_born_event_returns_r1_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ born_event: "" }),
    );
    expect(errors.some((e) => e.code === "R1_EMPTY_BORN_EVENT")).toBe(true);
  });

  it("test_whitespace_only_born_event_returns_r1_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ born_event: "   " }),
    );
    expect(errors.some((e) => e.code === "R1_EMPTY_BORN_EVENT")).toBe(true);
  });

  it("test_tab_only_born_event_returns_r1_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ born_event: "\t\t" }),
    );
    expect(errors.some((e) => e.code === "R1_EMPTY_BORN_EVENT")).toBe(true);
  });

  it("test_control_char_in_born_event_returns_r1_control_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ born_event: "Sign\u0000up" }),
    );
    expect(errors.some((e) => e.code === "R1_CONTROL_CHAR_BORN_EVENT")).toBe(
      true,
    );
  });

  it("test_bell_char_in_born_event_returns_r1_control_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ born_event: "Sign\u0007up" }),
    );
    expect(errors.some((e) => e.code === "R1_CONTROL_CHAR_BORN_EVENT")).toBe(
      true,
    );
  });

  it("test_invisible_only_born_event_returns_r1_invisible_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ born_event: "\u200b" }),
    );
    expect(errors.some((e) => e.code === "R1_INVISIBLE_BORN_EVENT")).toBe(true);
  });

  it("test_zero_width_joiner_only_returns_r1_invisible_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ born_event: "\u200d\u200d" }),
    );
    expect(errors.some((e) => e.code === "R1_INVISIBLE_BORN_EVENT")).toBe(true);
  });

  it("test_valid_born_event_no_r1_error", () => {
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

  it("test_born_event_with_spaces_is_valid", () => {
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

  it("test_r1_error_path_is_born_event", () => {
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

describe("TestValidateRetentionR2", () => {
  it("test_empty_return_event_returns_r2_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ return_event: "" }),
    );
    expect(errors.some((e) => e.code === "R2_EMPTY_RETURN_EVENT")).toBe(true);
  });

  it("test_whitespace_only_return_event_returns_r2_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ return_event: "   " }),
    );
    expect(errors.some((e) => e.code === "R2_EMPTY_RETURN_EVENT")).toBe(true);
  });

  it("test_tab_only_return_event_returns_r2_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ return_event: "\t\t" }),
    );
    expect(errors.some((e) => e.code === "R2_EMPTY_RETURN_EVENT")).toBe(true);
  });

  it("test_control_char_in_return_event_returns_r2_control_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ return_event: "Log\u0000in" }),
    );
    expect(errors.some((e) => e.code === "R2_CONTROL_CHAR_RETURN_EVENT")).toBe(
      true,
    );
  });

  it("test_escape_char_in_return_event_returns_r2_control_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ return_event: "Log\u001bin" }),
    );
    expect(errors.some((e) => e.code === "R2_CONTROL_CHAR_RETURN_EVENT")).toBe(
      true,
    );
  });

  it("test_invisible_only_return_event_returns_r2_invisible_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ return_event: "\u200b" }),
    );
    expect(errors.some((e) => e.code === "R2_INVISIBLE_RETURN_EVENT")).toBe(
      true,
    );
  });

  it("test_zero_width_non_joiner_only_returns_r2_invisible_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ return_event: "\u200c\u200c" }),
    );
    expect(errors.some((e) => e.code === "R2_INVISIBLE_RETURN_EVENT")).toBe(
      true,
    );
  });

  it("test_valid_return_event_no_r2_error", () => {
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

  it("test_return_event_with_unicode_is_valid", () => {
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

  it("test_r2_error_path_is_return_event", () => {
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

describe("TestValidateRetentionR7R8R9", () => {
  it("test_invalid_retention_unit_returns_r7_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ retention_unit: "invalid" }),
    );
    expect(errors.some((e) => e.code === "R7_INVALID_RETENTION_UNIT")).toBe(
      true,
    );
  });

  it("test_valid_retention_unit_day_no_r7_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ retention_unit: "day" }),
    );
    expect(codes(errors)).not.toContain("R7_INVALID_RETENTION_UNIT");
  });

  it("test_valid_retention_unit_week_no_r7_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ retention_unit: "week" }),
    );
    expect(codes(errors)).not.toContain("R7_INVALID_RETENTION_UNIT");
  });

  it("test_valid_retention_unit_month_no_r7_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ retention_unit: "month" }),
    );
    expect(codes(errors)).not.toContain("R7_INVALID_RETENTION_UNIT");
  });

  it("test_retention_unit_close_match_has_suggestion", () => {
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

  it("test_retention_unit_case_sensitive", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ retention_unit: "Week" }),
    );
    expect(errors.some((e) => e.code === "R7_INVALID_RETENTION_UNIT")).toBe(
      true,
    );
  });

  it("test_r7_error_path_is_retention_unit", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ retention_unit: "invalid" }),
    );
    const r7Errors = errors.filter(
      (e) => e.code === "R7_INVALID_RETENTION_UNIT",
    );
    expect(r7Errors).toHaveLength(1);
    expect(r7Errors[0]!.path).toBe("retention_unit");
  });

  it("test_invalid_alignment_returns_r8_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ alignment: "invalid" }),
    );
    expect(errors.some((e) => e.code === "R8_INVALID_ALIGNMENT")).toBe(true);
  });

  it("test_valid_alignment_birth_no_r8_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ alignment: "birth" }),
    );
    expect(codes(errors)).not.toContain("R8_INVALID_ALIGNMENT");
  });

  it("test_valid_alignment_interval_start_no_r8_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ alignment: "interval_start" }),
    );
    expect(codes(errors)).not.toContain("R8_INVALID_ALIGNMENT");
  });

  it("test_alignment_close_match_has_suggestion", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ alignment: "brith" }),
    );
    const r8Errors = errors.filter((e) => e.code === "R8_INVALID_ALIGNMENT");
    expect(r8Errors).toHaveLength(1);
    expect(r8Errors[0]!.suggestion).not.toBeNull();
    expect(r8Errors[0]!.suggestion).toContain("birth");
  });

  it("test_alignment_case_sensitive", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ alignment: "Birth" }),
    );
    expect(errors.some((e) => e.code === "R8_INVALID_ALIGNMENT")).toBe(true);
  });

  it("test_r8_error_path_is_alignment", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ alignment: "invalid" }),
    );
    const r8Errors = errors.filter((e) => e.code === "R8_INVALID_ALIGNMENT");
    expect(r8Errors).toHaveLength(1);
    expect(r8Errors[0]!.path).toBe("alignment");
  });

  it("test_invalid_math_returns_r9_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ math: "invalid" }),
    );
    expect(errors.some((e) => e.code === "R9_INVALID_MATH")).toBe(true);
  });

  it("test_valid_math_retention_rate_no_r9_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ math: "retention_rate" }),
    );
    expect(codes(errors)).not.toContain("R9_INVALID_MATH");
  });

  it("test_valid_math_unique_no_r9_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ math: "unique" }),
    );
    expect(codes(errors)).not.toContain("R9_INVALID_MATH");
  });

  it("test_math_close_match_has_suggestion", () => {
    const errors = validateRetentionArgs(validRetentionArgs({ math: "uniue" }));
    const r9Errors = errors.filter((e) => e.code === "R9_INVALID_MATH");
    expect(r9Errors).toHaveLength(1);
    expect(r9Errors[0]!.suggestion).not.toBeNull();
    expect(r9Errors[0]!.suggestion).toContain("unique");
  });

  it("test_math_case_sensitive", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ math: "Unique" }),
    );
    expect(errors.some((e) => e.code === "R9_INVALID_MATH")).toBe(true);
  });

  it("test_r9_error_path_is_math", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ math: "invalid" }),
    );
    const r9Errors = errors.filter((e) => e.code === "R9_INVALID_MATH");
    expect(r9Errors).toHaveLength(1);
    expect(r9Errors[0]!.path).toBe("math");
  });

  it("test_all_defaults_pass_validation", () => {
    const errors = validateRetentionArgs(validRetentionArgs());
    expect(errors).toEqual([]);
  });
});

// =============================================================================
// T014: R3/R4 — delegation to shared validators
// =============================================================================

describe("TestValidateRetentionDelegation", () => {
  it("test_zero_last_returns_v7_error", () => {
    const errors = validateRetentionArgs(validRetentionArgs({ last: 0 }));
    expect(errors.some((e) => e.code === "V7_LAST_POSITIVE")).toBe(true);
  });

  it("test_negative_last_returns_v7_error", () => {
    const errors = validateRetentionArgs(validRetentionArgs({ last: -5 }));
    expect(errors.some((e) => e.code === "V7_LAST_POSITIVE")).toBe(true);
  });

  it("test_positive_last_no_v7_error", () => {
    const errors = validateRetentionArgs(validRetentionArgs({ last: 30 }));
    expect(codes(errors)).not.toContain("V7_LAST_POSITIVE");
  });

  it("test_invalid_from_date_format_returns_v8_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ from_date: "invalid" }),
    );
    expect(errors.some((e) => e.code === "V8_DATE_FORMAT")).toBe(true);
  });

  it("test_to_date_without_from_date_returns_v9_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ to_date: "2024-01-31" }),
    );
    expect(errors.some((e) => e.code === "V9_TO_REQUIRES_FROM")).toBe(true);
  });

  it("test_valid_date_range_no_time_errors", () => {
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

  it("test_no_dates_with_default_last_no_time_errors", () => {
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

  it("test_from_date_after_to_date_returns_v15_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({
        from_date: "2024-02-01",
        to_date: "2024-01-01",
        last: 30,
      }),
    );
    expect(errors.some((e) => e.code === "V15_DATE_ORDER")).toBe(true);
  });

  it("test_negative_bucket_size_returns_v12_error", () => {
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

  it("test_zero_bucket_size_returns_v12_error", () => {
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

  it("test_string_group_by_no_errors", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ group_by: "platform" }),
    );
    expect(errors.some((e) => GROUP_CODES.has(e.code))).toBe(false);
  });

  it("test_none_group_by_no_errors", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ group_by: null }),
    );
    expect(errors.some((e) => GROUP_CODES.has(e.code))).toBe(false);
  });

  it("test_valid_numeric_group_by_no_errors", () => {
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

  it("test_bucket_min_exceeds_max_returns_v18_error", () => {
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

  it("test_list_group_by_valid", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ group_by: ["platform", "country"] }),
    );
    expect(errors.some((e) => GROUP_CODES.has(e.code))).toBe(false);
  });
});

// =============================================================================
// T-US3: R5/R6 — bucket_sizes validation
// =============================================================================

describe("TestValidateRetentionR5R6", () => {
  it("test_bucket_sizes_positive_integers_pass", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ bucket_sizes: [1, 3, 7] }),
    );
    expect(codes(errors)).not.toContain("R5_BUCKET_SIZES_POSITIVE");
    expect(codes(errors)).not.toContain("R5_BUCKET_SIZES_INTEGER");
  });

  it("test_bucket_sizes_zero_returns_r5_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ bucket_sizes: [0, 3] }),
    );
    expect(errors.some((e) => e.code === "R5_BUCKET_SIZES_POSITIVE")).toBe(
      true,
    );
  });

  it("test_bucket_sizes_negative_returns_r5_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ bucket_sizes: [-1, 3] }),
    );
    expect(errors.some((e) => e.code === "R5_BUCKET_SIZES_POSITIVE")).toBe(
      true,
    );
  });

  it("test_bucket_sizes_float_returns_r5_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ bucket_sizes: [1.5, 3] }),
    );
    expect(errors.some((e) => e.code === "R5_BUCKET_SIZES_INTEGER")).toBe(true);
  });

  it("test_bucket_sizes_ascending_pass", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ bucket_sizes: [1, 3, 7, 14] }),
    );
    expect(codes(errors)).not.toContain("R6_BUCKET_SIZES_ASCENDING");
  });

  it("test_bucket_sizes_not_ascending_returns_r6_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ bucket_sizes: [7, 3, 1] }),
    );
    expect(errors.some((e) => e.code === "R6_BUCKET_SIZES_ASCENDING")).toBe(
      true,
    );
  });

  it("test_bucket_sizes_duplicates_returns_r6_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ bucket_sizes: [3, 3, 7] }),
    );
    expect(errors.some((e) => e.code === "R6_BUCKET_SIZES_ASCENDING")).toBe(
      true,
    );
  });

  it("test_bucket_sizes_none_no_errors", () => {
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

  it("test_bucket_sizes_with_invalid_types_skips_r6", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ bucket_sizes: [3, 1.5, 7] }),
    );
    expect(errors.some((e) => e.code === "R5_BUCKET_SIZES_INTEGER")).toBe(true);
    expect(codes(errors)).not.toContain("R6_BUCKET_SIZES_ASCENDING");
  });

  it("test_bucket_sizes_with_non_positive_skips_r6", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ bucket_sizes: [0, -1, 3] }),
    );
    expect(errors.some((e) => e.code === "R5_BUCKET_SIZES_POSITIVE")).toBe(
      true,
    );
    expect(codes(errors)).not.toContain("R6_BUCKET_SIZES_ASCENDING");
  });
});

// =============================================================================
// T-US5: Multi-error collection
// =============================================================================

describe("TestValidateRetentionMultiError", () => {
  it("test_multiple_errors_collected", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ born_event: "", retention_unit: "invalid" }),
    );
    expect(codes(errors)).toContain("R1_EMPTY_BORN_EVENT");
    expect(codes(errors)).toContain("R7_INVALID_RETENTION_UNIT");
  });

  it("test_three_simultaneous_errors", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({
        born_event: "",
        return_event: "",
        math: "invalid",
      }),
    );
    expect(codes(errors)).toContain("R1_EMPTY_BORN_EVENT");
    expect(codes(errors)).toContain("R2_EMPTY_RETURN_EVENT");
    expect(codes(errors)).toContain("R9_INVALID_MATH");
  });
});

// =============================================================================
// R10: mode validation
// =============================================================================

describe("TestValidateRetentionR10", () => {
  it("test_invalid_mode_returns_r10_error", () => {
    const errors = validateRetentionArgs(validRetentionArgs({ mode: "pwned" }));
    expect(errors.some((e) => e.code === "R10_INVALID_MODE")).toBe(true);
  });

  it("test_none_mode_returns_r10_error", () => {
    const errors = validateRetentionArgs(validRetentionArgs({ mode: null }));
    expect(errors.some((e) => e.code === "R10_INVALID_MODE")).toBe(true);
  });

  it("test_valid_mode_curve_no_error", () => {
    const errors = validateRetentionArgs(validRetentionArgs({ mode: "curve" }));
    expect(codes(errors)).not.toContain("R10_INVALID_MODE");
  });

  it("test_valid_mode_trends_no_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ mode: "trends" }),
    );
    expect(codes(errors)).not.toContain("R10_INVALID_MODE");
  });

  it("test_valid_mode_table_no_error", () => {
    const errors = validateRetentionArgs(validRetentionArgs({ mode: "table" }));
    expect(codes(errors)).not.toContain("R10_INVALID_MODE");
  });

  it("test_r10_error_path_is_mode", () => {
    const errors = validateRetentionArgs(validRetentionArgs({ mode: "bad" }));
    const r10Errors = errors.filter((e) => e.code === "R10_INVALID_MODE");
    expect(r10Errors).toHaveLength(1);
    expect(r10Errors[0]!.path).toBe("mode");
  });

  it("test_mode_close_match_has_suggestion", () => {
    const errors = validateRetentionArgs(validRetentionArgs({ mode: "curv" }));
    const r10Errors = errors.filter((e) => e.code === "R10_INVALID_MODE");
    expect(r10Errors).toHaveLength(1);
    expect(r10Errors[0]!.suggestion).not.toBeNull();
    expect(r10Errors[0]!.suggestion).toContain("curve");
  });
});

// =============================================================================
// R5c: bucket_sizes max count
// =============================================================================

/**
 * Port of Python `list(range(start, stop))`.
 *
 * @param start - Inclusive lower bound.
 * @param stop - Exclusive upper bound.
 * @returns The ascending integer range as an array.
 */
function pyRange(start: number, stop: number): number[] {
  const out: number[] = [];
  for (let i = start; i < stop; i++) {
    out.push(i);
  }
  return out;
}

describe("TestValidateRetentionR5c", () => {
  it("test_too_many_buckets_returns_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ bucket_sizes: pyRange(1, 1001) }),
    );
    expect(errors.some((e) => e.code === "R5_BUCKET_SIZES_TOO_MANY")).toBe(
      true,
    );
  });

  it("test_730_buckets_no_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ bucket_sizes: pyRange(1, 731) }),
    );
    expect(codes(errors)).not.toContain("R5_BUCKET_SIZES_TOO_MANY");
  });

  it("test_error_message_includes_count", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ bucket_sizes: pyRange(1, 1001) }),
    );
    const r5c = errors.filter((e) => e.code === "R5_BUCKET_SIZES_TOO_MANY");
    expect(r5c).toHaveLength(1);
    expect(r5c[0]!.message).toContain("1000");
  });
});

// =============================================================================
// R11: unit validation for retention context
// =============================================================================

describe("TestValidateRetentionR11", () => {
  it("test_invalid_unit_hour_returns_r11_error", () => {
    const errors = validateRetentionArgs(validRetentionArgs({ unit: "hour" }));
    expect(errors.some((e) => e.code === "R11_INVALID_UNIT")).toBe(true);
  });

  it("test_invalid_unit_minute_returns_r11_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ unit: "minute" }),
    );
    expect(errors.some((e) => e.code === "R11_INVALID_UNIT")).toBe(true);
  });

  it("test_invalid_unit_quarter_returns_r11_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ unit: "quarter" }),
    );
    expect(errors.some((e) => e.code === "R11_INVALID_UNIT")).toBe(true);
  });

  it("test_valid_unit_day_no_error", () => {
    const errors = validateRetentionArgs(validRetentionArgs({ unit: "day" }));
    expect(codes(errors)).not.toContain("R11_INVALID_UNIT");
  });

  it("test_valid_unit_week_no_error", () => {
    const errors = validateRetentionArgs(validRetentionArgs({ unit: "week" }));
    expect(codes(errors)).not.toContain("R11_INVALID_UNIT");
  });

  it("test_valid_unit_month_no_error", () => {
    const errors = validateRetentionArgs(validRetentionArgs({ unit: "month" }));
    expect(codes(errors)).not.toContain("R11_INVALID_UNIT");
  });

  it("test_r11_error_path_is_unit", () => {
    const errors = validateRetentionArgs(validRetentionArgs({ unit: "hour" }));
    const r11 = errors.filter((e) => e.code === "R11_INVALID_UNIT");
    expect(r11).toHaveLength(1);
    expect(r11[0]!.path).toBe("unit");
  });

  it("test_r11_has_suggestion_for_close_match", () => {
    const errors = validateRetentionArgs(validRetentionArgs({ unit: "dya" }));
    const r11 = errors.filter((e) => e.code === "R11_INVALID_UNIT");
    expect(r11).toHaveLength(1);
    expect(r11[0]!.suggestion).not.toBeNull();
    expect(r11[0]!.suggestion).toContain("day");
  });
});

// =============================================================================
// R12: group_by empty string validation
// =============================================================================

describe("TestValidateRetentionR12", () => {
  it("test_empty_string_group_by_returns_r12_error", () => {
    const errors = validateRetentionArgs(validRetentionArgs({ group_by: "" }));
    expect(errors.some((e) => e.code === "R12_EMPTY_GROUP_BY")).toBe(true);
  });

  it("test_whitespace_only_group_by_returns_r12_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ group_by: "   " }),
    );
    expect(errors.some((e) => e.code === "R12_EMPTY_GROUP_BY")).toBe(true);
  });

  it("test_empty_string_in_list_returns_r12_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ group_by: ["platform", ""] }),
    );
    expect(errors.some((e) => e.code === "R12_EMPTY_GROUP_BY")).toBe(true);
  });

  it("test_valid_group_by_no_r12_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ group_by: "platform" }),
    );
    expect(codes(errors)).not.toContain("R12_EMPTY_GROUP_BY");
  });

  it("test_r12_error_path_is_group_by", () => {
    const errors = validateRetentionArgs(validRetentionArgs({ group_by: "" }));
    const r12 = errors.filter((e) => e.code === "R12_EMPTY_GROUP_BY");
    expect(r12).toHaveLength(1);
    expect(r12[0]!.path).toBe("group_by");
  });
});

// =============================================================================
// T010: R13 — unbounded_mode validation
// =============================================================================

describe("TestValidateRetentionR13UnboundedMode", () => {
  it("test_valid_unbounded_mode_none_no_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ unbounded_mode: "none" }),
    );
    expect(codes(errors)).not.toContain("R13_INVALID_UNBOUNDED_MODE");
  });

  it("test_valid_unbounded_mode_carry_back_no_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ unbounded_mode: "carry_back" }),
    );
    expect(codes(errors)).not.toContain("R13_INVALID_UNBOUNDED_MODE");
  });

  it("test_valid_unbounded_mode_carry_forward_no_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ unbounded_mode: "carry_forward" }),
    );
    expect(codes(errors)).not.toContain("R13_INVALID_UNBOUNDED_MODE");
  });

  it("test_valid_unbounded_mode_consecutive_forward_no_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ unbounded_mode: "consecutive_forward" }),
    );
    expect(codes(errors)).not.toContain("R13_INVALID_UNBOUNDED_MODE");
  });

  it("test_none_unbounded_mode_no_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ unbounded_mode: null }),
    );
    expect(codes(errors)).not.toContain("R13_INVALID_UNBOUNDED_MODE");
  });

  it("test_invalid_unbounded_mode_returns_r13_error", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ unbounded_mode: "invalid" }),
    );
    expect(codes(errors)).toContain("R13_INVALID_UNBOUNDED_MODE");
  });

  it("test_r13_error_path_is_unbounded_mode", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ unbounded_mode: "bad" }),
    );
    const r13 = errors.filter((e) => e.code === "R13_INVALID_UNBOUNDED_MODE");
    expect(r13).toHaveLength(1);
    expect(r13[0]!.path).toBe("unbounded_mode");
  });
});

// =============================================================================
// R5: bucket_sizes boolean edge case
// =============================================================================

describe("TestValidateRetentionR5Boolean", () => {
  it("test_boolean_true_rejected", () => {
    // Python `bool` is a subclass of `int`, so the validator must
    // reject booleans explicitly (Cautions §8).
    const errors = validateRetentionArgs(
      validRetentionArgs({ bucket_sizes: [true, 3] }),
    );
    expect(errors.some((e) => e.code === "R5_BUCKET_SIZES_POSITIVE")).toBe(
      true,
    );
  });

  it("test_boolean_false_rejected", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ bucket_sizes: [false] }),
    );
    expect(errors.some((e) => e.code === "R5_BUCKET_SIZES_POSITIVE")).toBe(
      true,
    );
  });
});

// =============================================================================
// T036: data_group_id validation for retention
// =============================================================================

describe("TestDataGroupIdValidationRetention", () => {
  it("test_valid_data_group_id", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ data_group_id: 5 }),
    );
    expect(errors.some((e) => e.code === "DG1_INVALID_DATA_GROUP_ID")).toBe(
      false,
    );
  });

  it("test_none_data_group_id", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ data_group_id: null }),
    );
    expect(errors.some((e) => e.code === "DG1_INVALID_DATA_GROUP_ID")).toBe(
      false,
    );
  });

  it("test_zero_data_group_id", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ data_group_id: 0 }),
    );
    expect(
      errors.filter((e) => e.code === "DG1_INVALID_DATA_GROUP_ID"),
    ).toHaveLength(1);
  });

  it("test_negative_data_group_id", () => {
    const errors = validateRetentionArgs(
      validRetentionArgs({ data_group_id: -2 }),
    );
    expect(
      errors.filter((e) => e.code === "DG1_INVALID_DATA_GROUP_ID"),
    ).toHaveLength(1);
  });
});
