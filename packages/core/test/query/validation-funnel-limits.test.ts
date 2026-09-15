/**
 * Layer-3 translation of `tests/test_validation_funnel.py`
 * (Python revision: `ts-port/phase2-contract-support` HEAD; 1373 LOC,
 * translated in full per b2-packets.md §V1a).
 *
 * R10.2: assertion-for-assertion. Python `pytest.raises(ValueError,
 * match=...)` on a dataclass `__post_init__` guard translates to
 * `expect(...).toThrow(/…/)` against the TS port's own faithfully
 * ported guard message (`ParamValidationError`, phase2 C3).
 * R5.3/R5.4: codes are the contract; suggestion-content asserts are
 * kept verbatim (Cautions §6 — they pin the difflib port).
 */

import { describe, expect, it } from "vitest";

import {
  validateFunnelArgs,
  type ValidateFunnelArgsOptions,
} from "../../src/query/validation-args.js";
import { Exclusion, HoldingConstant } from "../../src/types/index.js";
import { codes } from "../../test-support/error-codes.js";

// =============================================================================
// Helpers (test_validation_funnel.py)
// =============================================================================

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

// =============================================================================
// F1 max: Maximum 100 steps (G2)
// =============================================================================

describe("Validate funnel args F1 max", () => {
  // python: TestValidateFunnelArgsF1Max
  it("101 steps returns F1 max error", () => {
    // python: test_101_steps_returns_f1_max_error
    const errors = validateFunnelArgs(
      validFunnelArgs({ steps: Array.from({ length: 101 }, () => "A") }),
    );
    expect(codes(errors)).toContain("F1_MAX_STEPS");
  });

  it("100 steps no F1 max error", () => {
    // python: test_100_steps_no_f1_max_error
    const errors = validateFunnelArgs(
      validFunnelArgs({ steps: Array.from({ length: 100 }, () => "A") }),
    );
    expect(codes(errors)).not.toContain("F1_MAX_STEPS");
  });

  it("2 steps no F1 max error", () => {
    // python: test_2_steps_no_f1_max_error
    const errors = validateFunnelArgs(
      validFunnelArgs({ steps: Array.from({ length: 2 }, () => "A") }),
    );
    expect(codes(errors)).not.toContain("F1_MAX_STEPS");
  });
});

// =============================================================================
// F3 max: Maximum conversion window per unit (G1)
// =============================================================================

describe("Validate funnel args F3 max", () => {
  // python: TestValidateFunnelArgsF3Max
  it("day 368 returns F3 max error", () => {
    // python: test_day_368_returns_f3_max_error
    const errors = validateFunnelArgs(
      validFunnelArgs({
        conversion_window: 368,
        conversion_window_unit: "day",
      }),
    );
    expect(codes(errors)).toContain("F3_CONVERSION_WINDOW_MAX");
  });

  it("day 367 no F3 max error", () => {
    // python: test_day_367_no_f3_max_error
    const errors = validateFunnelArgs(
      validFunnelArgs({
        conversion_window: 367,
        conversion_window_unit: "day",
      }),
    );
    expect(codes(errors)).not.toContain("F3_CONVERSION_WINDOW_MAX");
  });

  it("week 53 returns F3 max error", () => {
    // python: test_week_53_returns_f3_max_error
    const errors = validateFunnelArgs(
      validFunnelArgs({
        conversion_window: 53,
        conversion_window_unit: "week",
      }),
    );
    expect(codes(errors)).toContain("F3_CONVERSION_WINDOW_MAX");
  });

  it("week 52 no F3 max error", () => {
    // python: test_week_52_no_f3_max_error
    const errors = validateFunnelArgs(
      validFunnelArgs({
        conversion_window: 52,
        conversion_window_unit: "week",
      }),
    );
    expect(codes(errors)).not.toContain("F3_CONVERSION_WINDOW_MAX");
  });

  it("month 13 returns F3 max error", () => {
    // python: test_month_13_returns_f3_max_error
    const errors = validateFunnelArgs(
      validFunnelArgs({
        conversion_window: 13,
        conversion_window_unit: "month",
      }),
    );
    expect(codes(errors)).toContain("F3_CONVERSION_WINDOW_MAX");
  });

  it("month 12 no F3 max error", () => {
    // python: test_month_12_no_f3_max_error
    const errors = validateFunnelArgs(
      validFunnelArgs({
        conversion_window: 12,
        conversion_window_unit: "month",
      }),
    );
    expect(codes(errors)).not.toContain("F3_CONVERSION_WINDOW_MAX");
  });

  it("F3 max error message includes max and unit", () => {
    // python: test_f3_max_error_message_includes_max_and_unit
    const errors = validateFunnelArgs(
      validFunnelArgs({
        conversion_window: 368,
        conversion_window_unit: "day",
      }),
    );
    const f3Max = errors.filter((e) => e.code === "F3_CONVERSION_WINDOW_MAX");
    expect(f3Max).toHaveLength(1);
    expect(f3Max[0]!.message).toContain("367");
    expect(f3Max[0]!.message).toContain("day");
  });
});

// =============================================================================
// F4 negative: Negative from_step in exclusions (G3)
// =============================================================================

describe("Validate funnel args F4 negative", () => {
  // python: TestValidateFunnelArgsF4Negative
  it("negative one from step raises at construction", () => {
    // python: test_negative_one_from_step_raises_at_construction
    expect(() => new Exclusion({ event: "X", from_step: -1 })).toThrow(
      /Exclusion\.from_step must be >= 0/,
    );
  });

  it("large negative from step raises at construction", () => {
    // python: test_large_negative_from_step_raises_at_construction
    expect(() => new Exclusion({ event: "X", from_step: -100 })).toThrow(
      /Exclusion\.from_step must be >= 0/,
    );
  });

  it("zero from step no negative error", () => {
    // python: test_zero_from_step_no_negative_error
    const errors = validateFunnelArgs(
      validFunnelArgs({
        exclusions: [new Exclusion({ event: "X", from_step: 0 })],
      }),
    );
    expect(codes(errors)).not.toContain("F4_EXCLUSION_NEGATIVE_STEP");
  });
});

// =============================================================================
// F4 control chars: Control characters in exclusion events (G7)
// =============================================================================

describe("Validate funnel args F4 control chars", () => {
  // python: TestValidateFunnelArgsF4ControlChars
  it("null byte in exclusion raises at construction", () => {
    // python: test_null_byte_in_exclusion_raises_at_construction
    expect(() => new Exclusion({ event: "X\u0000Y" })).toThrow(
      /Exclusion\.event contains control characters/,
    );
  });

  it("valid exclusion no control char error", () => {
    // python: test_valid_exclusion_no_control_char_error
    const errors = validateFunnelArgs(
      validFunnelArgs({ exclusions: [new Exclusion({ event: "Valid" })] }),
    );
    expect(codes(errors)).not.toContain("F4_CONTROL_CHAR_EXCLUSION");
  });
});

// =============================================================================
// F2 control chars: Control/invisible characters in step events (G8)
// =============================================================================

describe("Validate funnel args F2 control chars", () => {
  // python: TestValidateFunnelArgsF2ControlChars
  it("null byte in step returns control char error", () => {
    // python: test_null_byte_in_step_returns_control_char_error
    const errors = validateFunnelArgs(
      validFunnelArgs({ steps: ["A\u0000B", "C"] }),
    );
    expect(codes(errors)).toContain("F2_CONTROL_CHAR_STEP_EVENT");
  });

  it("zero width space only returns invisible error", () => {
    // python: test_zero_width_space_only_returns_invisible_error
    const errors = validateFunnelArgs(
      validFunnelArgs({ steps: ["\u200B", "C"] }),
    );
    expect(codes(errors)).toContain("F2_INVISIBLE_STEP_EVENT");
  });

  it("valid steps no control or invisible errors", () => {
    // python: test_valid_steps_no_control_or_invisible_errors
    const errors = validateFunnelArgs(
      validFunnelArgs({ steps: ["Valid", "Also Valid"] }),
    );
    expect(codes(errors)).not.toContain("F2_CONTROL_CHAR_STEP_EVENT");
    expect(codes(errors)).not.toContain("F2_INVISIBLE_STEP_EVENT");
  });
});

// =============================================================================
// F8 max holding: Maximum 3 holding constants (G5)
// =============================================================================

describe("Validate funnel args F8 max holding", () => {
  // python: TestValidateFunnelArgsF8MaxHolding
  it("four holding constants returns F8 error", () => {
    // python: test_four_holding_constants_returns_f8_error
    const errors = validateFunnelArgs(
      validFunnelArgs({ holding_constant: ["a", "b", "c", "d"] }),
    );
    expect(codes(errors)).toContain("F8_MAX_HOLDING_CONSTANT");
  });

  it("three holding constants no F8 error", () => {
    // python: test_three_holding_constants_no_f8_error
    const errors = validateFunnelArgs(
      validFunnelArgs({ holding_constant: ["a", "b", "c"] }),
    );
    expect(codes(errors)).not.toContain("F8_MAX_HOLDING_CONSTANT");
  });

  it("null holding constant no F8 error", () => {
    // python: test_none_holding_constant_no_f8_error
    const errors = validateFunnelArgs(
      validFunnelArgs({ holding_constant: null }),
    );
    expect(codes(errors)).not.toContain("F8_MAX_HOLDING_CONSTANT");
  });

  it("F8 error message includes count", () => {
    // python: test_f8_error_message_includes_count
    const errors = validateFunnelArgs(
      validFunnelArgs({ holding_constant: ["a", "b", "c", "d"] }),
    );
    const f8 = errors.filter((e) => e.code === "F8_MAX_HOLDING_CONSTANT");
    expect(f8).toHaveLength(1);
    expect(f8[0]!.message).toContain("4");
  });
});

// =============================================================================
// F9 session math: Session math/window constraints (G6)
// =============================================================================

describe("Validate funnel args F9 session math", () => {
  // python: TestValidateFunnelArgsF9SessionMath
  it("session math with day unit returns F9 error", () => {
    // python: test_session_math_with_day_unit_returns_f9_error
    const errors = validateFunnelArgs(
      validFunnelArgs({
        math: "conversion_rate_session",
        conversion_window_unit: "day",
      }),
    );
    expect(codes(errors)).toContain("F9_SESSION_MATH_REQUIRES_SESSION_WINDOW");
  });

  it("session math with session unit no F9 error", () => {
    // python: test_session_math_with_session_unit_no_f9_error
    const errors = validateFunnelArgs(
      validFunnelArgs({
        math: "conversion_rate_session",
        conversion_window_unit: "session",
        conversion_window: 1,
      }),
    );
    const f9Codes = new Set([
      "F9_SESSION_MATH_REQUIRES_SESSION_WINDOW",
      "F9_SESSION_WINDOW_REQUIRES_ONE",
    ]);
    expect(errors.some((e) => f9Codes.has(e.code))).toBe(false);
  });

  it("session unit with non session math window 2 returns F9 error", () => {
    // python: test_session_unit_with_non_session_math_window_2_returns_f9_error
    const errors = validateFunnelArgs(
      validFunnelArgs({
        conversion_window_unit: "session",
        conversion_window: 2,
      }),
    );
    expect(codes(errors)).toContain("F9_SESSION_WINDOW_REQUIRES_ONE");
  });

  it("session unit with non session math window 1 no F9 error", () => {
    // python: test_session_unit_with_non_session_math_window_1_no_f9_error
    const errors = validateFunnelArgs(
      validFunnelArgs({
        conversion_window_unit: "session",
        conversion_window: 1,
        math: "conversion_rate_unique",
      }),
    );
    const f9Codes = new Set([
      "F9_SESSION_MATH_REQUIRES_SESSION_WINDOW",
      "F9_SESSION_WINDOW_REQUIRES_ONE",
    ]);
    expect(errors.some((e) => f9Codes.has(e.code))).toBe(false);
  });
});

// =============================================================================
// F3 type: conversion_window must be int
// =============================================================================

describe("Validate funnel args F3 type", () => {
  // python: TestValidateFunnelArgsF3Type
  it("float returns type error", () => {
    // python: test_float_returns_type_error
    const errors = validateFunnelArgs(
      validFunnelArgs({ conversion_window: 14.5 }),
    );
    expect(codes(errors)).toContain("F3_CONVERSION_WINDOW_TYPE");
  });

  it("bool returns type error", () => {
    // python: test_bool_returns_type_error
    // Python: `isinstance(True, int)` is True, so the bool reject must
    // fire first (Cautions §8).
    const errors = validateFunnelArgs(
      validFunnelArgs({ conversion_window: true }),
    );
    expect(codes(errors)).toContain("F3_CONVERSION_WINDOW_TYPE");
  });

  it("int no type error", () => {
    // python: test_int_no_type_error
    const errors = validateFunnelArgs(
      validFunnelArgs({ conversion_window: 14 }),
    );
    expect(codes(errors)).not.toContain("F3_CONVERSION_WINDOW_TYPE");
  });
});

// =============================================================================
// F10: property math requires math_property
// =============================================================================

describe("Validate funnel args F10 math property", () => {
  // python: TestValidateFunnelArgsF10MathProperty
  it("average without property returns F10 error", () => {
    // python: test_average_without_property_returns_f10_error
    const errors = validateFunnelArgs(
      validFunnelArgs({ math: "average", math_property: null }),
    );
    expect(codes(errors)).toContain("F10_MATH_MISSING_PROPERTY");
  });

  it("median without property returns F10 error", () => {
    // python: test_median_without_property_returns_f10_error
    const errors = validateFunnelArgs(
      validFunnelArgs({ math: "median", math_property: null }),
    );
    expect(codes(errors)).toContain("F10_MATH_MISSING_PROPERTY");
  });

  it("P99 without property returns F10 error", () => {
    // python: test_p99_without_property_returns_f10_error
    const errors = validateFunnelArgs(
      validFunnelArgs({ math: "p99", math_property: null }),
    );
    expect(codes(errors)).toContain("F10_MATH_MISSING_PROPERTY");
  });

  it("average with property no F10 error", () => {
    // python: test_average_with_property_no_f10_error
    const errors = validateFunnelArgs(
      validFunnelArgs({ math: "average", math_property: "amount" }),
    );
    expect(codes(errors)).not.toContain("F10_MATH_MISSING_PROPERTY");
  });

  it("conversion rate unique without property no F10 error", () => {
    // python: test_conversion_rate_unique_without_property_no_f10_error
    const errors = validateFunnelArgs(
      validFunnelArgs({
        math: "conversion_rate_unique",
        math_property: null,
      }),
    );
    expect(codes(errors)).not.toContain("F10_MATH_MISSING_PROPERTY");
  });

  it("unique without property no F10 error", () => {
    // python: test_unique_without_property_no_f10_error
    const errors = validateFunnelArgs(
      validFunnelArgs({ math: "unique", math_property: null }),
    );
    expect(codes(errors)).not.toContain("F10_MATH_MISSING_PROPERTY");
  });
});

// =============================================================================
// F11: non-property math rejects math_property
// =============================================================================

describe("Validate funnel args F11 math rejects property", () => {
  // python: TestValidateFunnelArgsF11MathRejectsProperty
  it("conversion rate unique with property returns F11 error", () => {
    // python: test_conversion_rate_unique_with_property_returns_f11_error
    const errors = validateFunnelArgs(
      validFunnelArgs({
        math: "conversion_rate_unique",
        math_property: "amount",
      }),
    );
    expect(codes(errors)).toContain("F11_MATH_REJECTS_PROPERTY");
  });

  it("unique with property returns F11 error", () => {
    // python: test_unique_with_property_returns_f11_error
    const errors = validateFunnelArgs(
      validFunnelArgs({ math: "unique", math_property: "amount" }),
    );
    expect(codes(errors)).toContain("F11_MATH_REJECTS_PROPERTY");
  });

  it("total with property no F11 error", () => {
    // python: test_total_with_property_no_f11_error
    const errors = validateFunnelArgs(
      validFunnelArgs({ math: "total", math_property: "amount" }),
    );
    expect(codes(errors)).not.toContain("F11_MATH_REJECTS_PROPERTY");
  });

  it("average with property no F11 error", () => {
    // python: test_average_with_property_no_f11_error
    const errors = validateFunnelArgs(
      validFunnelArgs({ math: "average", math_property: "amount" }),
    );
    expect(codes(errors)).not.toContain("F11_MATH_REJECTS_PROPERTY");
  });
});

// =============================================================================
// T010: F12 — reentry_mode validation
// =============================================================================

describe("Validate funnel args F12 reentry mode", () => {
  // python: TestValidateFunnelArgsF12ReentryMode
  it("valid reentry mode default no error", () => {
    // python: test_valid_reentry_mode_default_no_error
    const errors = validateFunnelArgs(
      validFunnelArgs({ reentry_mode: "default" }),
    );
    expect(codes(errors)).not.toContain("F12_INVALID_REENTRY_MODE");
  });

  it("valid reentry mode basic no error", () => {
    // python: test_valid_reentry_mode_basic_no_error
    const errors = validateFunnelArgs(
      validFunnelArgs({ reentry_mode: "basic" }),
    );
    expect(codes(errors)).not.toContain("F12_INVALID_REENTRY_MODE");
  });

  it("valid reentry mode aggressive no error", () => {
    // python: test_valid_reentry_mode_aggressive_no_error
    const errors = validateFunnelArgs(
      validFunnelArgs({ reentry_mode: "aggressive" }),
    );
    expect(codes(errors)).not.toContain("F12_INVALID_REENTRY_MODE");
  });

  it("valid reentry mode optimized no error", () => {
    // python: test_valid_reentry_mode_optimized_no_error
    const errors = validateFunnelArgs(
      validFunnelArgs({ reentry_mode: "optimized" }),
    );
    expect(codes(errors)).not.toContain("F12_INVALID_REENTRY_MODE");
  });

  it("null reentry mode no error", () => {
    // python: test_none_reentry_mode_no_error
    const errors = validateFunnelArgs(validFunnelArgs({ reentry_mode: null }));
    expect(codes(errors)).not.toContain("F12_INVALID_REENTRY_MODE");
  });

  it("invalid reentry mode returns F12 error", () => {
    // python: test_invalid_reentry_mode_returns_f12_error
    const errors = validateFunnelArgs(
      validFunnelArgs({ reentry_mode: "invalid" }),
    );
    expect(codes(errors)).toContain("F12_INVALID_REENTRY_MODE");
  });

  it("F12 error path is reentry mode", () => {
    // python: test_f12_error_path_is_reentry_mode
    const errors = validateFunnelArgs(validFunnelArgs({ reentry_mode: "bad" }));
    const f12 = errors.filter((e) => e.code === "F12_INVALID_REENTRY_MODE");
    expect(f12).toHaveLength(1);
    expect(f12[0]!.path).toBe("reentry_mode");
  });
});

// =============================================================================
// F8b: HoldingConstant property validation
// =============================================================================

describe("F8b holding constant property validation", () => {
  // python: TestF8bHoldingConstantPropertyValidation
  it("empty string property raises at construction", () => {
    // python: test_empty_string_property_raises_at_construction
    expect(() => new HoldingConstant({ property: "" })).toThrow(
      /HoldingConstant\.property must be a non-empty string/,
    );
  });

  it("whitespace only property raises at construction", () => {
    // python: test_whitespace_only_property_raises_at_construction
    expect(() => new HoldingConstant({ property: " ".repeat(3) })).toThrow(
      /HoldingConstant\.property must be a non-empty string/,
    );
  });

  it("valid property no error", () => {
    // python: test_valid_property_no_error
    const errors = validateFunnelArgs(
      validFunnelArgs({
        holding_constant: [new HoldingConstant({ property: "platform" })],
      }),
    );
    expect(codes(errors)).not.toContain("F8_EMPTY_HOLDING_CONSTANT_PROPERTY");
  });

  it("multiple with one empty raises at construction", () => {
    // python: test_multiple_with_one_empty_raises_at_construction
    const valid = new HoldingConstant({ property: "platform" });
    expect(valid.property).toBe("platform");
    expect(() => new HoldingConstant({ property: "" })).toThrow(
      /HoldingConstant\.property must be a non-empty string/,
    );
  });
});

// =============================================================================
// T036: data_group_id validation for funnels
// =============================================================================

describe("Data group ID validation funnel", () => {
  // python: TestDataGroupIdValidationFunnel
  it("valid data group ID", () => {
    // python: test_valid_data_group_id
    const errors = validateFunnelArgs(validFunnelArgs({ data_group_id: 5 }));
    expect(errors.some((e) => e.code === "DG1_INVALID_DATA_GROUP_ID")).toBe(
      false,
    );
  });

  it("null data group ID", () => {
    // python: test_none_data_group_id
    const errors = validateFunnelArgs(validFunnelArgs({ data_group_id: null }));
    expect(errors.some((e) => e.code === "DG1_INVALID_DATA_GROUP_ID")).toBe(
      false,
    );
  });

  it("zero data group ID", () => {
    // python: test_zero_data_group_id
    const errors = validateFunnelArgs(validFunnelArgs({ data_group_id: 0 }));
    expect(
      errors.filter((e) => e.code === "DG1_INVALID_DATA_GROUP_ID"),
    ).toHaveLength(1);
  });

  it("negative data group ID", () => {
    // python: test_negative_data_group_id
    const errors = validateFunnelArgs(validFunnelArgs({ data_group_id: -3 }));
    expect(
      errors.filter((e) => e.code === "DG1_INVALID_DATA_GROUP_ID"),
    ).toHaveLength(1);
  });
});
