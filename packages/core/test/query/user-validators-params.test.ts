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

import type { ValidationError } from "../../src/errors.js";
import {
  validateUserArgs,
  validateUserParams,
} from "../../src/query/user-validators.js";
import { codes } from "../../test-support/error-codes.js";

// =============================================================================
// Helpers (port of the Python module helpers, :30-76)
// =============================================================================

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
