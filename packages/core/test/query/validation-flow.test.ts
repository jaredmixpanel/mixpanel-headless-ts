/**
 * Layer-3 translation of `tests/test_validation_flow.py`
 * (Python revision: `ts-port/phase2-contract-support` HEAD; 1066 LOC).
 *
 * Scope per b2-packets.md §V1a: the `validate_flow_args` classes. The
 * `TestValidateFlowBookmarkFLB1`–`FLB6` /
 * `TestValidateFlowBookmarkDefaults` classes drive
 * `validate_flow_bookmark` — B2 shard V1b.
 *
 * R10.2: assertion-for-assertion. Suggestion-content asserts kept
 * verbatim (Cautions §6).
 */

import { describe, expect, it } from "vitest";

import {
  validateFlowArgs,
  type ValidateFlowArgsOptions,
} from "../../src/query/validation-args.js";
import { TimeComparison } from "../../src/types/index.js";
import { codes } from "../../test-support/error-codes.js";

// =============================================================================
// Helpers (test_validation_flow.py)
// =============================================================================

/**
 * Build a default-valid option bag for {@link validateFlowArgs}.
 *
 * @param overrides - Keys to override in the defaults.
 * @returns A complete {@link ValidateFlowArgsOptions} bag.
 */
function validFlowArgs(
  overrides: Partial<ValidateFlowArgsOptions> = {},
): ValidateFlowArgsOptions {
  return {
    steps: ["Purchase"],
    forward: 3,
    reverse: 0,
    count_type: "unique",
    mode: "sankey",
    cardinality: 3,
    conversion_window: 7,
    from_date: null,
    to_date: null,
    last: 30,
    ...overrides,
  };
}

// =============================================================================
// T016: FL1 — steps list must be non-empty
// =============================================================================

describe("Validate flow FL1", () => {
  // python: TestValidateFlowFL1
  it("empty steps returns FL1 error", () => {
    // python: test_empty_steps_returns_fl1_error
    const errors = validateFlowArgs(validFlowArgs({ steps: [] }));
    expect(errors.some((e) => e.code === "FL1_EMPTY_STEPS")).toBe(true);
  });

  it("non empty steps no FL1 error", () => {
    // python: test_non_empty_steps_no_fl1_error
    const errors = validateFlowArgs(validFlowArgs({ steps: ["Purchase"] }));
    expect(codes(errors)).not.toContain("FL1_EMPTY_STEPS");
  });

  it("FL1 error path is steps", () => {
    // python: test_fl1_error_path_is_steps
    const errors = validateFlowArgs(validFlowArgs({ steps: [] }));
    const fl1Errors = errors.filter((e) => e.code === "FL1_EMPTY_STEPS");
    expect(fl1Errors).toHaveLength(1);
    expect(fl1Errors[0]!.path).toBe("steps");
  });

  it("multiple steps no FL1 error", () => {
    // python: test_multiple_steps_no_fl1_error
    const errors = validateFlowArgs(
      validFlowArgs({ steps: ["Purchase", "Signup", "Login"] }),
    );
    expect(codes(errors)).not.toContain("FL1_EMPTY_STEPS");
  });
});

// =============================================================================
// T016: FL2 — step event name must be non-empty, no control/invisible chars
// =============================================================================

describe("Validate flow FL2", () => {
  // python: TestValidateFlowFL2
  it("empty event name returns FL2 error", () => {
    // python: test_empty_event_name_returns_fl2_error
    const errors = validateFlowArgs(validFlowArgs({ steps: [""] }));
    expect(errors.some((e) => e.code === "FL2_EMPTY_STEP_EVENT")).toBe(true);
  });

  it("whitespace only event name returns FL2 error", () => {
    // python: test_whitespace_only_event_name_returns_fl2_error
    const errors = validateFlowArgs(validFlowArgs({ steps: [" ".repeat(3)] }));
    expect(errors.some((e) => e.code === "FL2_EMPTY_STEP_EVENT")).toBe(true);
  });

  it("tab only event name returns FL2 error", () => {
    // python: test_tab_only_event_name_returns_fl2_error
    const errors = validateFlowArgs(validFlowArgs({ steps: ["\t"] }));
    expect(errors.some((e) => e.code === "FL2_EMPTY_STEP_EVENT")).toBe(true);
  });

  it("control char in event name returns FL2 control error", () => {
    // python: test_control_char_in_event_name_returns_fl2_control_error
    const errors = validateFlowArgs(validFlowArgs({ steps: ["\u0000Login"] }));
    expect(errors.some((e) => e.code === "FL2_CONTROL_CHAR_STEP_EVENT")).toBe(
      true,
    );
  });

  it("bell char in event name returns FL2 control error", () => {
    // python: test_bell_char_in_event_name_returns_fl2_control_error
    const errors = validateFlowArgs(
      validFlowArgs({ steps: ["Pur\u0007chase"] }),
    );
    expect(errors.some((e) => e.code === "FL2_CONTROL_CHAR_STEP_EVENT")).toBe(
      true,
    );
  });

  it("invisible only event name returns FL2 invisible error", () => {
    // python: test_invisible_only_event_name_returns_fl2_invisible_error
    const errors = validateFlowArgs(validFlowArgs({ steps: ["\u200B"] }));
    expect(errors.some((e) => e.code === "FL2_INVISIBLE_STEP_EVENT")).toBe(
      true,
    );
  });

  it("zero width joiner only returns FL2 invisible error", () => {
    // python: test_zero_width_joiner_only_returns_fl2_invisible_error
    const errors = validateFlowArgs(validFlowArgs({ steps: ["\u200D\u200D"] }));
    expect(errors.some((e) => e.code === "FL2_INVISIBLE_STEP_EVENT")).toBe(
      true,
    );
  });

  it("valid event name no FL2 error", () => {
    // python: test_valid_event_name_no_fl2_error
    const errors = validateFlowArgs(validFlowArgs({ steps: ["Purchase"] }));
    const fl2Codes = new Set([
      "FL2_EMPTY_STEP_EVENT",
      "FL2_CONTROL_CHAR_STEP_EVENT",
      "FL2_INVISIBLE_STEP_EVENT",
    ]);
    expect(errors.some((e) => fl2Codes.has(e.code))).toBe(false);
  });

  it("FL2 error path includes index", () => {
    // python: test_fl2_error_path_includes_index
    const errors = validateFlowArgs(validFlowArgs({ steps: ["Purchase", ""] }));
    const fl2Errors = errors.filter((e) => e.code === "FL2_EMPTY_STEP_EVENT");
    expect(fl2Errors).toHaveLength(1);
    expect(fl2Errors[0]!.path).toBe("steps[1]");
  });

  it("multiple invalid steps report all", () => {
    // python: test_multiple_invalid_steps_report_all
    const errors = validateFlowArgs(
      validFlowArgs({ steps: ["", " ".repeat(3)] }),
    );
    expect(
      errors.filter((e) => e.code === "FL2_EMPTY_STEP_EVENT"),
    ).toHaveLength(2);
  });
});

// =============================================================================
// T016: FL3 — forward must be in range 0-5
// =============================================================================

describe("Validate flow FL3", () => {
  // python: TestValidateFlowFL3
  it("negative forward returns FL3 error", () => {
    // python: test_negative_forward_returns_fl3_error
    const errors = validateFlowArgs(validFlowArgs({ forward: -1 }));
    expect(errors.some((e) => e.code === "FL3_FORWARD_RANGE")).toBe(true);
  });

  it("forward exceeds max returns FL3 error", () => {
    // python: test_forward_exceeds_max_returns_fl3_error
    const errors = validateFlowArgs(validFlowArgs({ forward: 6 }));
    expect(errors.some((e) => e.code === "FL3_FORWARD_RANGE")).toBe(true);
  });

  it("forward zero no FL3 error", () => {
    // python: test_forward_zero_no_fl3_error
    const errors = validateFlowArgs(validFlowArgs({ forward: 0, reverse: 1 }));
    expect(codes(errors)).not.toContain("FL3_FORWARD_RANGE");
  });

  it("forward five no FL3 error", () => {
    // python: test_forward_five_no_fl3_error
    const errors = validateFlowArgs(validFlowArgs({ forward: 5 }));
    expect(codes(errors)).not.toContain("FL3_FORWARD_RANGE");
  });

  it("forward three no FL3 error", () => {
    // python: test_forward_three_no_fl3_error
    const errors = validateFlowArgs(validFlowArgs({ forward: 3 }));
    expect(codes(errors)).not.toContain("FL3_FORWARD_RANGE");
  });

  it("FL3 error path is forward", () => {
    // python: test_fl3_error_path_is_forward
    const errors = validateFlowArgs(validFlowArgs({ forward: -1 }));
    const fl3Errors = errors.filter((e) => e.code === "FL3_FORWARD_RANGE");
    expect(fl3Errors).toHaveLength(1);
    expect(fl3Errors[0]!.path).toBe("forward");
  });
});

// =============================================================================
// T016: FL4 — reverse must be in range 0-5
// =============================================================================

describe("Validate flow FL4", () => {
  // python: TestValidateFlowFL4
  it("negative reverse returns FL4 error", () => {
    // python: test_negative_reverse_returns_fl4_error
    const errors = validateFlowArgs(validFlowArgs({ reverse: -1 }));
    expect(errors.some((e) => e.code === "FL4_REVERSE_RANGE")).toBe(true);
  });

  it("reverse exceeds max returns FL4 error", () => {
    // python: test_reverse_exceeds_max_returns_fl4_error
    const errors = validateFlowArgs(validFlowArgs({ reverse: 6 }));
    expect(errors.some((e) => e.code === "FL4_REVERSE_RANGE")).toBe(true);
  });

  it("reverse zero no FL4 error", () => {
    // python: test_reverse_zero_no_fl4_error
    const errors = validateFlowArgs(validFlowArgs({ reverse: 0 }));
    expect(codes(errors)).not.toContain("FL4_REVERSE_RANGE");
  });

  it("reverse five no FL4 error", () => {
    // python: test_reverse_five_no_fl4_error
    const errors = validateFlowArgs(validFlowArgs({ reverse: 5, forward: 0 }));
    expect(codes(errors)).not.toContain("FL4_REVERSE_RANGE");
  });

  it("FL4 error path is reverse", () => {
    // python: test_fl4_error_path_is_reverse
    const errors = validateFlowArgs(validFlowArgs({ reverse: -1 }));
    const fl4Errors = errors.filter((e) => e.code === "FL4_REVERSE_RANGE");
    expect(fl4Errors).toHaveLength(1);
    expect(fl4Errors[0]!.path).toBe("reverse");
  });
});

// =============================================================================
// T016: FL5 — forward + reverse must be > 0
// =============================================================================

describe("Validate flow FL5", () => {
  // python: TestValidateFlowFL5
  it("both zero returns FL5 error", () => {
    // python: test_both_zero_returns_fl5_error
    const errors = validateFlowArgs(validFlowArgs({ forward: 0, reverse: 0 }));
    expect(errors.some((e) => e.code === "FL5_NO_DIRECTION")).toBe(true);
  });

  it("forward one reverse zero no FL5 error", () => {
    // python: test_forward_one_reverse_zero_no_fl5_error
    const errors = validateFlowArgs(validFlowArgs({ forward: 1, reverse: 0 }));
    expect(codes(errors)).not.toContain("FL5_NO_DIRECTION");
  });

  it("forward zero reverse one no FL5 error", () => {
    // python: test_forward_zero_reverse_one_no_fl5_error
    const errors = validateFlowArgs(validFlowArgs({ forward: 0, reverse: 1 }));
    expect(codes(errors)).not.toContain("FL5_NO_DIRECTION");
  });

  it("both nonzero no FL5 error", () => {
    // python: test_both_nonzero_no_fl5_error
    const errors = validateFlowArgs(validFlowArgs({ forward: 2, reverse: 2 }));
    expect(codes(errors)).not.toContain("FL5_NO_DIRECTION");
  });

  it("FL5 error path is forward", () => {
    // python: test_fl5_error_path_is_forward
    const errors = validateFlowArgs(validFlowArgs({ forward: 0, reverse: 0 }));
    const fl5Errors = errors.filter((e) => e.code === "FL5_NO_DIRECTION");
    expect(fl5Errors).toHaveLength(1);
    expect(fl5Errors[0]!.path).toBe("forward");
  });
});

// =============================================================================
// T016: FL6 — cardinality must be in range 1-50
// =============================================================================

describe("Validate flow FL6", () => {
  // python: TestValidateFlowFL6
  it("cardinality zero returns FL6 error", () => {
    // python: test_cardinality_zero_returns_fl6_error
    const errors = validateFlowArgs(validFlowArgs({ cardinality: 0 }));
    expect(errors.some((e) => e.code === "FL6_CARDINALITY_RANGE")).toBe(true);
  });

  it("cardinality negative returns FL6 error", () => {
    // python: test_cardinality_negative_returns_fl6_error
    const errors = validateFlowArgs(validFlowArgs({ cardinality: -1 }));
    expect(errors.some((e) => e.code === "FL6_CARDINALITY_RANGE")).toBe(true);
  });

  it("cardinality 51 returns FL6 error", () => {
    // python: test_cardinality_51_returns_fl6_error
    const errors = validateFlowArgs(validFlowArgs({ cardinality: 51 }));
    expect(errors.some((e) => e.code === "FL6_CARDINALITY_RANGE")).toBe(true);
  });

  it("cardinality one no FL6 error", () => {
    // python: test_cardinality_one_no_fl6_error
    const errors = validateFlowArgs(validFlowArgs({ cardinality: 1 }));
    expect(codes(errors)).not.toContain("FL6_CARDINALITY_RANGE");
  });

  it("cardinality 50 no FL6 error", () => {
    // python: test_cardinality_50_no_fl6_error
    const errors = validateFlowArgs(validFlowArgs({ cardinality: 50 }));
    expect(codes(errors)).not.toContain("FL6_CARDINALITY_RANGE");
  });

  it("cardinality three no FL6 error", () => {
    // python: test_cardinality_three_no_fl6_error
    const errors = validateFlowArgs(validFlowArgs({ cardinality: 3 }));
    expect(codes(errors)).not.toContain("FL6_CARDINALITY_RANGE");
  });

  it("FL6 error path is cardinality", () => {
    // python: test_fl6_error_path_is_cardinality
    const errors = validateFlowArgs(validFlowArgs({ cardinality: 0 }));
    const fl6Errors = errors.filter((e) => e.code === "FL6_CARDINALITY_RANGE");
    expect(fl6Errors).toHaveLength(1);
    expect(fl6Errors[0]!.path).toBe("cardinality");
  });
});

// =============================================================================
// T016: FL7 — conversion_window must be positive
// =============================================================================

describe("Validate flow FL7", () => {
  // python: TestValidateFlowFL7
  it("conversion window zero returns FL7 error", () => {
    // python: test_conversion_window_zero_returns_fl7_error
    const errors = validateFlowArgs(validFlowArgs({ conversion_window: 0 }));
    expect(
      errors.some((e) => e.code === "FL7_CONVERSION_WINDOW_POSITIVE"),
    ).toBe(true);
  });

  it("conversion window negative returns FL7 error", () => {
    // python: test_conversion_window_negative_returns_fl7_error
    const errors = validateFlowArgs(validFlowArgs({ conversion_window: -1 }));
    expect(
      errors.some((e) => e.code === "FL7_CONVERSION_WINDOW_POSITIVE"),
    ).toBe(true);
  });

  it("conversion window positive no FL7 error", () => {
    // python: test_conversion_window_positive_no_fl7_error
    const errors = validateFlowArgs(validFlowArgs({ conversion_window: 7 }));
    expect(codes(errors)).not.toContain("FL7_CONVERSION_WINDOW_POSITIVE");
  });

  it("conversion window one no FL7 error", () => {
    // python: test_conversion_window_one_no_fl7_error
    const errors = validateFlowArgs(validFlowArgs({ conversion_window: 1 }));
    expect(codes(errors)).not.toContain("FL7_CONVERSION_WINDOW_POSITIVE");
  });

  it("FL7 error path is conversion window", () => {
    // python: test_fl7_error_path_is_conversion_window
    const errors = validateFlowArgs(validFlowArgs({ conversion_window: 0 }));
    const fl7Errors = errors.filter(
      (e) => e.code === "FL7_CONVERSION_WINDOW_POSITIVE",
    );
    expect(fl7Errors).toHaveLength(1);
    expect(fl7Errors[0]!.path).toBe("conversion_window");
  });
});

// =============================================================================
// T016b: FL7b — conversion_window per-unit maximum
// =============================================================================

describe("Validate flow FL7 max", () => {
  // python: TestValidateFlowFL7Max
  it("day max exceeded", () => {
    // python: test_day_max_exceeded
    const errors = validateFlowArgs(
      validFlowArgs({
        conversion_window: 367,
        conversion_window_unit: "day",
      }),
    );
    expect(errors.some((e) => e.code === "FL7_CONVERSION_WINDOW_MAX")).toBe(
      true,
    );
  });

  it("day max at boundary", () => {
    // python: test_day_max_at_boundary
    const errors = validateFlowArgs(
      validFlowArgs({
        conversion_window: 366,
        conversion_window_unit: "day",
      }),
    );
    expect(codes(errors)).not.toContain("FL7_CONVERSION_WINDOW_MAX");
  });

  it("week max exceeded", () => {
    // python: test_week_max_exceeded
    const errors = validateFlowArgs(
      validFlowArgs({ conversion_window: 53, conversion_window_unit: "week" }),
    );
    expect(errors.some((e) => e.code === "FL7_CONVERSION_WINDOW_MAX")).toBe(
      true,
    );
  });

  it("week max at boundary", () => {
    // python: test_week_max_at_boundary
    const errors = validateFlowArgs(
      validFlowArgs({ conversion_window: 52, conversion_window_unit: "week" }),
    );
    expect(codes(errors)).not.toContain("FL7_CONVERSION_WINDOW_MAX");
  });

  it("month max exceeded", () => {
    // python: test_month_max_exceeded
    const errors = validateFlowArgs(
      validFlowArgs({ conversion_window: 13, conversion_window_unit: "month" }),
    );
    expect(errors.some((e) => e.code === "FL7_CONVERSION_WINDOW_MAX")).toBe(
      true,
    );
  });

  it("month max at boundary", () => {
    // python: test_month_max_at_boundary
    const errors = validateFlowArgs(
      validFlowArgs({ conversion_window: 12, conversion_window_unit: "month" }),
    );
    expect(codes(errors)).not.toContain("FL7_CONVERSION_WINDOW_MAX");
  });

  it("session unit skips max check", () => {
    // python: test_session_unit_skips_max_check
    const errors = validateFlowArgs(
      validFlowArgs({
        conversion_window: 1,
        conversion_window_unit: "session",
        count_type: "session",
      }),
    );
    expect(codes(errors)).not.toContain("FL7_CONVERSION_WINDOW_MAX");
  });

  it("FL7 max error message includes limit", () => {
    // python: test_fl7_max_error_message_includes_limit
    const errors = validateFlowArgs(
      validFlowArgs({
        conversion_window: 400,
        conversion_window_unit: "day",
      }),
    );
    const fl7Max = errors.filter((e) => e.code === "FL7_CONVERSION_WINDOW_MAX");
    expect(fl7Max).toHaveLength(1);
    expect(fl7Max[0]!.message).toContain("366");
  });
});

// =============================================================================
// T016: FL8 — time validation delegated to validate_time_args
// =============================================================================

describe("Validate flow FL8", () => {
  // python: TestValidateFlowFL8
  it("zero last returns V7 error", () => {
    // python: test_zero_last_returns_v7_error
    const errors = validateFlowArgs(validFlowArgs({ last: 0 }));
    expect(errors.some((e) => e.code === "V7_LAST_POSITIVE")).toBe(true);
  });

  it("negative last returns V7 error", () => {
    // python: test_negative_last_returns_v7_error
    const errors = validateFlowArgs(validFlowArgs({ last: -5 }));
    expect(errors.some((e) => e.code === "V7_LAST_POSITIVE")).toBe(true);
  });

  it("positive last no V7 error", () => {
    // python: test_positive_last_no_v7_error
    const errors = validateFlowArgs(validFlowArgs({ last: 30 }));
    expect(codes(errors)).not.toContain("V7_LAST_POSITIVE");
  });

  it("invalid from date format returns V8 error", () => {
    // python: test_invalid_from_date_format_returns_v8_error
    const errors = validateFlowArgs(validFlowArgs({ from_date: "invalid" }));
    expect(errors.some((e) => e.code === "V8_DATE_FORMAT")).toBe(true);
  });

  it("to date without from date returns V9 error", () => {
    // python: test_to_date_without_from_date_returns_v9_error
    const errors = validateFlowArgs(validFlowArgs({ to_date: "2024-01-31" }));
    expect(errors.some((e) => e.code === "V9_TO_REQUIRES_FROM")).toBe(true);
  });

  it("valid dates no time errors", () => {
    // python: test_valid_dates_no_time_errors
    const errors = validateFlowArgs(
      validFlowArgs({
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
    const errors = validateFlowArgs(validFlowArgs());
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
});

// =============================================================================
// T016: Enum validation — count_type, mode
// =============================================================================

describe("Validate flow enums", () => {
  // python: TestValidateFlowEnums
  it("invalid count type returns error", () => {
    // python: test_invalid_count_type_returns_error
    const errors = validateFlowArgs(validFlowArgs({ count_type: "invalid" }));
    expect(errors.some((e) => e.code === "FL_INVALID_COUNT_TYPE")).toBe(true);
  });

  it("valid count type unique no error", () => {
    // python: test_valid_count_type_unique_no_error
    const errors = validateFlowArgs(validFlowArgs({ count_type: "unique" }));
    expect(codes(errors)).not.toContain("FL_INVALID_COUNT_TYPE");
  });

  it("valid count type total no error", () => {
    // python: test_valid_count_type_total_no_error
    const errors = validateFlowArgs(validFlowArgs({ count_type: "total" }));
    expect(codes(errors)).not.toContain("FL_INVALID_COUNT_TYPE");
  });

  it("valid count type session no error", () => {
    // python: test_valid_count_type_session_no_error
    const errors = validateFlowArgs(validFlowArgs({ count_type: "session" }));
    expect(codes(errors)).not.toContain("FL_INVALID_COUNT_TYPE");
  });

  it("count type close match has suggestion", () => {
    // python: test_count_type_close_match_has_suggestion
    const errors = validateFlowArgs(validFlowArgs({ count_type: "uniqe" }));
    const ctErrors = errors.filter((e) => e.code === "FL_INVALID_COUNT_TYPE");
    expect(ctErrors).toHaveLength(1);
    expect(ctErrors[0]!.suggestion).not.toBeNull();
    expect(ctErrors[0]!.suggestion).toContain("unique");
  });

  it("count type error path", () => {
    // python: test_count_type_error_path
    const errors = validateFlowArgs(validFlowArgs({ count_type: "bad" }));
    const ctErrors = errors.filter((e) => e.code === "FL_INVALID_COUNT_TYPE");
    expect(ctErrors).toHaveLength(1);
    expect(ctErrors[0]!.path).toBe("count_type");
  });

  it("invalid mode returns error", () => {
    // python: test_invalid_mode_returns_error
    const errors = validateFlowArgs(validFlowArgs({ mode: "invalid" }));
    expect(errors.some((e) => e.code === "FL_INVALID_MODE")).toBe(true);
  });

  it("valid mode sankey no error", () => {
    // python: test_valid_mode_sankey_no_error
    const errors = validateFlowArgs(validFlowArgs({ mode: "sankey" }));
    expect(codes(errors)).not.toContain("FL_INVALID_MODE");
  });

  it("valid mode paths no error", () => {
    // python: test_valid_mode_paths_no_error
    const errors = validateFlowArgs(validFlowArgs({ mode: "paths" }));
    expect(codes(errors)).not.toContain("FL_INVALID_MODE");
  });

  it("valid mode tree no error", () => {
    // python: test_valid_mode_tree_no_error
    const errors = validateFlowArgs(validFlowArgs({ mode: "tree" }));
    expect(codes(errors)).not.toContain("FL_INVALID_MODE");
  });

  it("mode close match has suggestion", () => {
    // python: test_mode_close_match_has_suggestion
    const errors = validateFlowArgs(validFlowArgs({ mode: "sanke" }));
    const modeErrors = errors.filter((e) => e.code === "FL_INVALID_MODE");
    expect(modeErrors).toHaveLength(1);
    expect(modeErrors[0]!.suggestion).not.toBeNull();
    expect(modeErrors[0]!.suggestion).toContain("sankey");
  });

  it("mode error path", () => {
    // python: test_mode_error_path
    const errors = validateFlowArgs(validFlowArgs({ mode: "bad" }));
    const modeErrors = errors.filter((e) => e.code === "FL_INVALID_MODE");
    expect(modeErrors).toHaveLength(1);
    expect(modeErrors[0]!.path).toBe("mode");
  });
});

// =============================================================================
// FL9/FL10: Session count_type + conversion_window_unit constraints
// =============================================================================

describe("Validate flow FL9", () => {
  // python: TestValidateFlowFL9
  it("session count type without session window", () => {
    // python: test_session_count_type_without_session_window
    const errors = validateFlowArgs(
      validFlowArgs({ count_type: "session", conversion_window_unit: "day" }),
    );
    expect(
      errors.some((e) => e.code === "FL9_SESSION_REQUIRES_SESSION_WINDOW"),
    ).toBe(true);
  });

  it("session count type with session window", () => {
    // python: test_session_count_type_with_session_window
    const errors = validateFlowArgs(
      validFlowArgs({
        count_type: "session",
        conversion_window_unit: "session",
        conversion_window: 1,
      }),
    );
    expect(
      errors.some((e) => e.code === "FL9_SESSION_REQUIRES_SESSION_WINDOW"),
    ).toBe(false);
  });

  it("non session count type with any unit", () => {
    // python: test_non_session_count_type_with_any_unit
    const errors = validateFlowArgs(validFlowArgs({ count_type: "unique" }));
    expect(
      errors.some((e) => e.code === "FL9_SESSION_REQUIRES_SESSION_WINDOW"),
    ).toBe(false);
  });
});

describe("Validate flow FL10", () => {
  // python: TestValidateFlowFL10
  it("session window requires one", () => {
    // python: test_session_window_requires_one
    const errors = validateFlowArgs(
      validFlowArgs({
        count_type: "session",
        conversion_window_unit: "session",
        conversion_window: 7,
      }),
    );
    expect(
      errors.some((e) => e.code === "FL10_SESSION_WINDOW_REQUIRES_ONE"),
    ).toBe(true);
  });

  it("session window with one", () => {
    // python: test_session_window_with_one
    const errors = validateFlowArgs(
      validFlowArgs({
        count_type: "session",
        conversion_window_unit: "session",
        conversion_window: 1,
      }),
    );
    expect(
      errors.some((e) => e.code === "FL10_SESSION_WINDOW_REQUIRES_ONE"),
    ).toBe(false);
  });
});

describe("Validate flow window unit", () => {
  // python: TestValidateFlowWindowUnit
  it("invalid window unit", () => {
    // python: test_invalid_window_unit
    const errors = validateFlowArgs(
      validFlowArgs({ conversion_window_unit: "invalid" }),
    );
    expect(errors.some((e) => e.code === "FL_INVALID_WINDOW_UNIT")).toBe(true);
  });

  it("valid window units", () => {
    // python: test_valid_window_units
    for (const unit of ["day", "week", "month", "session"]) {
      const kwargs = validFlowArgs({ conversion_window_unit: unit });
      const args: ValidateFlowArgsOptions =
        unit === "session"
          ? { ...kwargs, count_type: "session", conversion_window: 1 }
          : kwargs;
      const errors = validateFlowArgs(args);
      expect(
        errors.some((e) => e.code === "FL_INVALID_WINDOW_UNIT"),
        `unit=${JSON.stringify(unit)} incorrectly rejected`,
      ).toBe(false);
    }
  });
});

// =============================================================================
// T016: Multi-error collection
// =============================================================================

describe("Validate flow multi error", () => {
  // python: TestValidateFlowMultiError
  it("multiple errors collected", () => {
    // python: test_multiple_errors_collected
    const errors = validateFlowArgs(
      validFlowArgs({ steps: [], forward: -1, count_type: "invalid" }),
    );
    expect(codes(errors)).toContain("FL1_EMPTY_STEPS");
    expect(codes(errors)).toContain("FL3_FORWARD_RANGE");
    expect(codes(errors)).toContain("FL_INVALID_COUNT_TYPE");
  });

  it("four simultaneous errors", () => {
    // python: test_four_simultaneous_errors
    const errors = validateFlowArgs(
      validFlowArgs({
        steps: [""],
        forward: 6,
        reverse: -1,
        cardinality: 0,
      }),
    );
    expect(codes(errors)).toContain("FL2_EMPTY_STEP_EVENT");
    expect(codes(errors)).toContain("FL3_FORWARD_RANGE");
    expect(codes(errors)).toContain("FL4_REVERSE_RANGE");
    expect(codes(errors)).toContain("FL6_CARDINALITY_RANGE");
  });
});

// =============================================================================
// T016: All defaults pass
// =============================================================================

describe("Validate flow defaults", () => {
  // python: TestValidateFlowDefaults
  it("all defaults pass validation", () => {
    // python: test_all_defaults_pass_validation
    const errors = validateFlowArgs(validFlowArgs());
    expect(errors).toStrictEqual([]);
  });
});

// =============================================================================
// T016: time_comparison validation for flows
// =============================================================================

describe("Validate flow args time comparison", () => {
  // python: TestValidateFlowArgsTimeComparison
  it("time comparison set produces error", () => {
    // python: test_time_comparison_set_produces_error
    const tc = TimeComparison.relative("month");
    const errors = validateFlowArgs(validFlowArgs({ time_comparison: tc }));
    expect(
      errors.some((e) => e.code === "FL_TIME_COMPARISON_NOT_SUPPORTED"),
      `Expected FL_TIME_COMPARISON_NOT_SUPPORTED error, got: ${JSON.stringify(codes(errors))}`,
    ).toBe(true);
  });

  it("time comparison null no error", () => {
    // python: test_time_comparison_none_no_error
    const errors = validateFlowArgs(validFlowArgs({ time_comparison: null }));
    expect(
      errors.some((e) => e.code === "FL_TIME_COMPARISON_NOT_SUPPORTED"),
    ).toBe(false);
  });

  it("time comparison error path", () => {
    // python: test_time_comparison_error_path
    const tc = TimeComparison.relative("month");
    const errors = validateFlowArgs(validFlowArgs({ time_comparison: tc }));
    const tcErrors = errors.filter(
      (e) => e.code === "FL_TIME_COMPARISON_NOT_SUPPORTED",
    );
    expect(tcErrors).toHaveLength(1);
    expect(tcErrors[0]!.path).toBe("time_comparison");
  });
});

// =============================================================================
// T036: data_group_id validation for flows
// =============================================================================

describe("Data group ID validation flow", () => {
  // python: TestDataGroupIdValidationFlow
  it("valid data group ID", () => {
    // python: test_valid_data_group_id
    const errors = validateFlowArgs(validFlowArgs({ data_group_id: 5 }));
    expect(errors.some((e) => e.code === "DG1_INVALID_DATA_GROUP_ID")).toBe(
      false,
    );
  });

  it("null data group ID", () => {
    // python: test_none_data_group_id
    const errors = validateFlowArgs(validFlowArgs({ data_group_id: null }));
    expect(errors.some((e) => e.code === "DG1_INVALID_DATA_GROUP_ID")).toBe(
      false,
    );
  });

  it("zero data group ID", () => {
    // python: test_zero_data_group_id
    const errors = validateFlowArgs(validFlowArgs({ data_group_id: 0 }));
    expect(
      errors.filter((e) => e.code === "DG1_INVALID_DATA_GROUP_ID"),
    ).toHaveLength(1);
  });

  it("negative data group ID", () => {
    // python: test_negative_data_group_id
    const errors = validateFlowArgs(validFlowArgs({ data_group_id: -1 }));
    expect(
      errors.filter((e) => e.code === "DG1_INVALID_DATA_GROUP_ID"),
    ).toHaveLength(1);
  });
});
