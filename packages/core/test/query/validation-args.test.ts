/**
 * Layer-3 translation of `tests/unit/test_validation.py`
 * (Python revision: `ts-port/phase2-contract-support` HEAD; 1238 LOC).
 *
 * Scope per b2-packets.md §V1a: the `validate_query_args` classes plus
 * the shared `_suggest` class. Deferred with a design citation:
 * - `TestValidationError` / `TestBookmarkValidationError` — already
 *   ported and vector-locked in Phase 2 (`test/errors.test.ts`).
 * - `TestValidateBookmarkLayer2`, `TestValidateMeasurementFunnelContext`,
 *   `TestValidateSortingBlock` — B2 shard V1b (bookmark validators +
 *   sorting slice).
 *
 * R10.2: assertion-for-assertion. R5.3/R5.4: codes are the contract.
 */

import { describe, expect, it } from "vitest";

import {
  ParamValidationError,
  type ValidationError,
} from "../../src/errors.js";
import {
  validateQueryArgs,
  type ValidateQueryArgsOptions,
} from "../../src/query/validation-args.js";
import { suggest } from "../../src/query/validation-shared.js";
import { GroupBy, Metric } from "../../src/types/index.js";

// =============================================================================
// Helpers (test_validation.py)
// =============================================================================

/**
 * Return valid query args with optional overrides — port of the module
 * helper `_valid_args(**overrides)`.
 *
 * @param overrides - Partial option bag merged over the defaults.
 * @returns A complete {@link ValidateQueryArgsOptions} bag.
 */
function validArgs(
  overrides: Partial<ValidateQueryArgsOptions> = {},
): ValidateQueryArgsOptions {
  return {
    events: ["Login"],
    math: "total",
    math_property: null,
    per_user: null,
    from_date: null,
    to_date: null,
    last: 30,
    has_formula: false,
    rolling: null,
    cumulative: false,
    group_by: null,
    ...overrides,
  };
}

// =============================================================================
// Fuzzy matching (test_validation.py)
// =============================================================================

describe("TestFuzzyMatching", () => {
  it("test_close_match", () => {
    const result = suggest("totl", new Set(["total", "unique", "average"]));
    expect(result).not.toBeNull();
    expect(result).toContain("total");
  });

  it("test_no_match", () => {
    const result = suggest("zzzzz", new Set(["total", "unique"]));
    expect(result).toBeNull();
  });

  it("test_returns_tuple", () => {
    // Python asserts `isinstance(result, tuple)`; the TS port returns a
    // frozen array (the closest immutable-sequence analog, R4.2).
    const result = suggest("averge", new Set(["average", "median"]));
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
  });
});

// =============================================================================
// Layer 1: validate_query_args (test_validation.py)
// =============================================================================

describe("TestValidateQueryArgsLayer1", () => {
  it("test_valid_args_no_errors", () => {
    const errors = validateQueryArgs(validArgs());
    expect(errors).toStrictEqual([]);
  });

  it("test_v0_no_events", () => {
    const errors = validateQueryArgs(validArgs({ events: [] }));
    expect(errors.some((e) => e.code === "V0_NO_EVENTS")).toBe(true);
  });

  it("test_v1_math_requires_property", () => {
    const errors = validateQueryArgs(validArgs({ math: "average" }));
    expect(errors.some((e) => e.code === "V1_MATH_REQUIRES_PROPERTY")).toBe(
      true,
    );
  });

  it("test_v1_valid_with_property", () => {
    const errors = validateQueryArgs(
      validArgs({ math: "average", math_property: "amount" }),
    );
    expect(errors.some((e) => e.code === "V1_MATH_REQUIRES_PROPERTY")).toBe(
      false,
    );
  });

  it("test_v2_rejects_property", () => {
    const errors = validateQueryArgs(
      validArgs({ math: "unique", math_property: "amount" }),
    );
    expect(errors.some((e) => e.code === "V2_MATH_REJECTS_PROPERTY")).toBe(
      true,
    );
  });

  it("test_v2_total_allows_property", () => {
    const errors = validateQueryArgs(
      validArgs({ math: "total", math_property: "amount" }),
    );
    expect(errors.some((e) => e.code === "V2_MATH_REJECTS_PROPERTY")).toBe(
      false,
    );
  });

  it("test_v3_per_user_incompatible", () => {
    const errors = validateQueryArgs(
      validArgs({ math: "dau", per_user: "average" }),
    );
    expect(errors.some((e) => e.code === "V3_PER_USER_INCOMPATIBLE")).toBe(
      true,
    );
  });

  it("test_v3b_per_user_requires_property", () => {
    const errors = validateQueryArgs(
      validArgs({ math: "total", per_user: "average" }),
    );
    expect(
      errors.some((e) => e.code === "V3B_PER_USER_REQUIRES_PROPERTY"),
    ).toBe(true);
  });

  it("test_v4_formula_min_events", () => {
    const errors = validateQueryArgs(
      validArgs({ has_formula: true, events: ["Login"] }),
    );
    expect(errors.some((e) => e.code === "V4_FORMULA_MIN_EVENTS")).toBe(true);
  });

  it("test_v4_formula_with_two_events", () => {
    const errors = validateQueryArgs(
      validArgs({ has_formula: true, events: ["Login", "Signup"] }),
    );
    expect(errors.some((e) => e.code === "V4_FORMULA_MIN_EVENTS")).toBe(false);
  });

  it("test_v5_rolling_cumulative_exclusive", () => {
    const errors = validateQueryArgs(
      validArgs({ rolling: 7, cumulative: true }),
    );
    expect(
      errors.some((e) => e.code === "V5_ROLLING_CUMULATIVE_EXCLUSIVE"),
    ).toBe(true);
  });

  it("test_v6_rolling_positive", () => {
    const errors = validateQueryArgs(validArgs({ rolling: 0 }));
    expect(errors.some((e) => e.code === "V6_ROLLING_POSITIVE")).toBe(true);
  });

  it("test_v7_last_positive", () => {
    const errors = validateQueryArgs(validArgs({ last: 0 }));
    expect(errors.some((e) => e.code === "V7_LAST_POSITIVE")).toBe(true);
  });

  it("test_v8_from_date_format", () => {
    const errors = validateQueryArgs(validArgs({ from_date: "01/01/2024" }));
    expect(errors.some((e) => e.code === "V8_DATE_FORMAT")).toBe(true);
  });

  it("test_v8_valid_date", () => {
    const errors = validateQueryArgs(
      validArgs({ from_date: "2024-01-01", to_date: "2024-01-31" }),
    );
    expect(errors.some((e) => e.code === "V8_DATE_FORMAT")).toBe(false);
  });

  it("test_v9_to_requires_from", () => {
    const errors = validateQueryArgs(validArgs({ to_date: "2024-01-31" }));
    expect(errors.some((e) => e.code === "V9_TO_REQUIRES_FROM")).toBe(true);
  });

  it("test_v10_date_last_exclusive", () => {
    const errors = validateQueryArgs(
      validArgs({ from_date: "2024-01-01", last: 7 }),
    );
    expect(errors.some((e) => e.code === "V10_DATE_LAST_EXCLUSIVE")).toBe(true);
  });

  it("test_v10_default_last_with_dates_ok", () => {
    const errors = validateQueryArgs(
      validArgs({ from_date: "2024-01-01", to_date: "2024-01-31" }),
    );
    expect(errors.some((e) => e.code === "V10_DATE_LAST_EXCLUSIVE")).toBe(
      false,
    );
  });

  it("test_v11_bucket_requires_size", () => {
    const errors = validateQueryArgs(
      validArgs({
        group_by: new GroupBy({
          property: "revenue",
          property_type: "number",
          bucket_min: 0,
        }),
      }),
    );
    expect(errors.some((e) => e.code === "V11_BUCKET_REQUIRES_SIZE")).toBe(
      true,
    );
  });

  it("test_v12_bucket_size_positive", () => {
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

  it("test_v12b_bucket_requires_number", () => {
    const errors = validateQueryArgs(
      validArgs({
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

  it("test_v13_metric_math_property", () => {
    expect(() => new Metric({ event: "Purchase", math: "average" })).toThrow(
      /requires a property/,
    );
    expect(() => new Metric({ event: "Purchase", math: "average" })).toThrow(
      ParamValidationError,
    );
  });

  it("test_v13_valid_metric", () => {
    const errors = validateQueryArgs(
      validArgs({
        events: [
          new Metric({
            event: "Purchase",
            math: "average",
            property: "amount",
          }),
        ],
      }),
    );
    expect(errors.some((e) => e.code === "V13_METRIC_MATH_PROPERTY")).toBe(
      false,
    );
  });

  it("test_collects_all_errors", () => {
    // Use a plain string event so top-level math validation (V1) fires;
    // events=[] would skip V1 because no plain events consume top-level math.
    const errors = validateQueryArgs(
      validArgs({ events: ["Login"], math: "average", last: -1 }),
    );
    const codes = new Set(errors.map((e: ValidationError) => e.code));
    expect(codes.has("V1_MATH_REQUIRES_PROPERTY")).toBe(true);
    expect(codes.has("V7_LAST_POSITIVE")).toBe(true);
  });
});

// =============================================================================
// T036: data_group_id validation for insights (test_validation.py)
// =============================================================================

describe("TestDataGroupIdValidationInsights", () => {
  it("test_valid_data_group_id", () => {
    const errors = validateQueryArgs(validArgs({ data_group_id: 5 }));
    expect(errors.some((e) => e.code === "DG1_INVALID_DATA_GROUP_ID")).toBe(
      false,
    );
  });

  it("test_none_data_group_id", () => {
    const errors = validateQueryArgs(validArgs({ data_group_id: null }));
    expect(errors.some((e) => e.code === "DG1_INVALID_DATA_GROUP_ID")).toBe(
      false,
    );
  });

  it("test_zero_data_group_id", () => {
    const errors = validateQueryArgs(validArgs({ data_group_id: 0 }));
    const dgErrors = errors.filter(
      (e) => e.code === "DG1_INVALID_DATA_GROUP_ID",
    );
    expect(dgErrors).toHaveLength(1);
    expect(dgErrors[0]!.path).toBe("data_group_id");
  });

  it("test_negative_data_group_id", () => {
    const errors = validateQueryArgs(validArgs({ data_group_id: -1 }));
    expect(
      errors.filter((e) => e.code === "DG1_INVALID_DATA_GROUP_ID"),
    ).toHaveLength(1);
  });

  it("test_data_group_id_true_rejected", () => {
    // Python: bool is a subtype of int, so the bool guard must fire first.
    const errors = validateQueryArgs(validArgs({ data_group_id: true }));
    expect(
      errors.filter((e) => e.code === "DG1_INVALID_DATA_GROUP_ID"),
    ).toHaveLength(1);
  });

  it("test_data_group_id_false_rejected", () => {
    const errors = validateQueryArgs(validArgs({ data_group_id: false }));
    expect(
      errors.filter((e) => e.code === "DG1_INVALID_DATA_GROUP_ID"),
    ).toHaveLength(1);
  });
});
