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
      validRetentionArgs({ group_by: " ".repeat(3) }),
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
