/**
 * Layer-3 translation of `tests/unit/test_query_validation.py`
 * (Python revision: `ts-port/phase2-contract-support` HEAD; 827 LOC).
 *
 * Scope per b2-packets.md §V1a "Layer-3 test translation": the
 * validator-direct classes only. The classes that exercise validation
 * through `Workspace.query(...)` / `build_params(...)`
 * (`TestTimeRangeValidation` pytest.raises cases,
 * `TestAggregationValidation` pytest.raises cases,
 * `TestPerMetricValidation`, `TestFormulaValidation` raises case,
 * `TestAnalysisModeValidation`, `TestGroupByValidation`,
 * `TestEmptyEventsValidation`, `TestFormulaInListValidation`,
 * `TestBuildParamsValidation`, `TestPercentileValidation`,
 * `TestHistogramValidation`) are B5 facade scope — translated with the
 * B5 S2 shard (phase2-audit A2 style deferral).
 *
 * The `validate_query_args(...)` calls embedded inside those otherwise
 * facade-driven classes ARE validator-direct and are translated here,
 * grouped under their Python class name.
 *
 * R10.2: assertion-for-assertion. R5.3/R5.4: codes are the contract;
 * message asserts are kept only against this port's own faithfully
 * ported strings.
 */

import { describe, expect, it } from "vitest";

import { ParamValidationError } from "../../src/errors.js";
import {
  validateGroupByArgs,
  validateQueryArgs,
  validateTimeArgs,
} from "../../src/query/validation-args.js";
import { GroupBy } from "../../src/types/index.js";

// =============================================================================
// T007: Time range validation rules (V7-V11) — validator-direct members
// =============================================================================

describe("TestTimeRangeValidation", () => {
  it("test_v10_default_last_with_dates_ok", () => {
    // V10: Default last (30) with explicit dates is OK (last is ignored).
    const errors = validateQueryArgs({
      events: ["Login"],
      math: "total",
      math_property: null,
      per_user: null,
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      last: 30,
      has_formula: false,
      rolling: null,
      cumulative: false,
      group_by: null,
    });
    expect(errors).toStrictEqual([]);
  });

  it("test_valid_date_range_passes", () => {
    const errors = validateQueryArgs({
      events: ["Login"],
      math: "total",
      math_property: null,
      per_user: null,
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      last: 30,
      has_formula: false,
      rolling: null,
      cumulative: false,
      group_by: null,
    });
    expect(errors).toStrictEqual([]);
  });

  it("test_valid_last_passes", () => {
    const errors = validateQueryArgs({
      events: ["Login"],
      math: "total",
      math_property: null,
      per_user: null,
      from_date: null,
      to_date: null,
      last: 7,
      has_formula: false,
      rolling: null,
      cumulative: false,
      group_by: null,
    });
    expect(errors).toStrictEqual([]);
  });
});

// =============================================================================
// T016: Aggregation validation rules V1-V3 — validator-direct members
// =============================================================================

describe("TestAggregationValidation", () => {
  it("test_valid_property_math_with_property", () => {
    const errors = validateQueryArgs({
      events: ["Purchase"],
      math: "average",
      math_property: "amount",
      per_user: null,
      from_date: null,
      to_date: null,
      last: 30,
      has_formula: false,
      rolling: null,
      cumulative: false,
      group_by: null,
    });
    expect(errors).toStrictEqual([]);
  });

  it("test_valid_per_user_with_property", () => {
    const errors = validateQueryArgs({
      events: ["Purchase"],
      math: "total",
      math_property: "revenue",
      per_user: "average",
      from_date: null,
      to_date: null,
      last: 30,
      has_formula: false,
      rolling: null,
      cumulative: false,
      group_by: null,
    });
    expect(errors).toStrictEqual([]);
  });

  it("test_per_user_without_property_raises", () => {
    const errors = validateQueryArgs({
      events: ["Purchase"],
      math: "total",
      math_property: null,
      per_user: "average",
      from_date: null,
      to_date: null,
      last: 30,
      has_formula: false,
      rolling: null,
      cumulative: false,
      group_by: null,
    });
    expect(
      errors.some((e) => e.message.includes("per_user requires math_property")),
    ).toBe(true);
  });

  it("test_per_user_with_unique_raises", () => {
    const errors = validateQueryArgs({
      events: ["Login"],
      math: "unique",
      math_property: null,
      per_user: "average",
      from_date: null,
      to_date: null,
      last: 30,
      has_formula: false,
      rolling: null,
      cumulative: false,
      group_by: null,
    });
    expect(
      errors.some((e) => e.message.includes("per_user is incompatible")),
    ).toBe(true);
  });
});

// =============================================================================
// T029: Formula validation V4 — validator-direct member
// =============================================================================

describe("TestFormulaValidation", () => {
  it("test_v4_formula_with_two_events_ok", () => {
    const errors = validateQueryArgs({
      events: ["Login", "Signup"],
      math: "total",
      math_property: null,
      per_user: null,
      from_date: null,
      to_date: null,
      last: 30,
      has_formula: true,
      rolling: null,
      cumulative: false,
      group_by: null,
    });
    expect(errors).toStrictEqual([]);
  });
});

// =============================================================================
// Reusable validate_time_args() (US2 shared-infra) — test_query_validation.py
// =============================================================================

describe("TestValidateTimeArgs", () => {
  it("test_v7_last_zero", () => {
    const errors = validateTimeArgs({
      from_date: null,
      to_date: null,
      last: 0,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe("V7_LAST_POSITIVE");
  });

  it("test_v7_last_negative", () => {
    const errors = validateTimeArgs({
      from_date: null,
      to_date: null,
      last: -5,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe("V7_LAST_POSITIVE");
  });

  it("test_v8_from_date_bad_format", () => {
    const errors = validateTimeArgs({
      from_date: "01/01/2024",
      to_date: null,
      last: 30,
    });
    expect(errors.some((e) => e.code === "V8_DATE_FORMAT")).toBe(true);
  });

  it("test_v8_to_date_bad_format", () => {
    const errors = validateTimeArgs({
      from_date: "2024-01-01",
      to_date: "Jan 31 2024",
      last: 30,
    });
    expect(errors.some((e) => e.code === "V8_DATE_FORMAT")).toBe(true);
  });

  it("test_v8_invalid_calendar_date", () => {
    const errors = validateTimeArgs({
      from_date: "2024-02-30",
      to_date: null,
      last: 30,
    });
    expect(errors.some((e) => e.code === "V8_DATE_INVALID")).toBe(true);
  });

  it("test_v9_to_date_without_from_date", () => {
    const errors = validateTimeArgs({
      from_date: null,
      to_date: "2024-01-31",
      last: 30,
    });
    expect(errors.some((e) => e.code === "V9_TO_REQUIRES_FROM")).toBe(true);
  });

  it("test_v10_from_date_with_non_default_last", () => {
    const errors = validateTimeArgs({
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      last: 7,
    });
    expect(errors.some((e) => e.code === "V10_DATE_LAST_EXCLUSIVE")).toBe(true);
  });

  it("test_v10_from_date_with_default_last_ok", () => {
    const errors = validateTimeArgs({
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      last: 30,
    });
    expect(errors.some((e) => e.code === "V10_DATE_LAST_EXCLUSIVE")).toBe(
      false,
    );
  });

  it("test_v15_from_date_after_to_date", () => {
    const errors = validateTimeArgs({
      from_date: "2024-02-01",
      to_date: "2024-01-01",
      last: 30,
    });
    expect(errors.some((e) => e.code === "V15_DATE_ORDER")).toBe(true);
  });

  it("test_v20_last_too_large", () => {
    const errors = validateTimeArgs({
      from_date: null,
      to_date: null,
      last: 5000,
    });
    expect(errors.some((e) => e.code === "V20_LAST_TOO_LARGE")).toBe(true);
  });

  it("test_valid_date_range", () => {
    const errors = validateTimeArgs({
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      last: 30,
    });
    expect(errors).toStrictEqual([]);
  });

  it("test_valid_last_only", () => {
    const errors = validateTimeArgs({
      from_date: null,
      to_date: null,
      last: 30,
    });
    expect(errors).toStrictEqual([]);
  });
});

// =============================================================================
// Reusable validate_group_by_args() (US2 shared-infra) — :743
// =============================================================================

describe("TestValidateGroupByArgs", () => {
  it("test_v11_bucket_min_without_bucket_size", () => {
    const errors = validateGroupByArgs({
      group_by: new GroupBy({ property: "amount", bucket_min: 0 }),
    });
    expect(errors.some((e) => e.code === "V11_BUCKET_REQUIRES_SIZE")).toBe(
      true,
    );
  });

  it("test_v12_bucket_size_zero", () => {
    // V12: bucket_size=0 is rejected by GroupBy's constructor guard
    // (Python `__post_init__` → ValueError; TS ParamValidationError).
    expect(() => new GroupBy({ property: "amount", bucket_size: 0 })).toThrow(
      ParamValidationError,
    );
    expect(() => new GroupBy({ property: "amount", bucket_size: 0 })).toThrow(
      /bucket_size must be positive/,
    );
  });

  it("test_v12_bucket_size_negative", () => {
    expect(() => new GroupBy({ property: "amount", bucket_size: -5 })).toThrow(
      /bucket_size must be positive/,
    );
  });

  it("test_v12b_bucket_size_wrong_property_type", () => {
    const errors = validateGroupByArgs({
      group_by: new GroupBy({
        property: "amount",
        property_type: "string",
        bucket_size: 10,
      }),
    });
    expect(errors.some((e) => e.code === "V12B_BUCKET_REQUIRES_NUMBER")).toBe(
      true,
    );
  });

  it("test_v12c_bucket_size_without_bounds", () => {
    const errors = validateGroupByArgs({
      group_by: new GroupBy({
        property: "amount",
        property_type: "number",
        bucket_size: 10,
      }),
    });
    expect(errors.some((e) => e.code === "V12C_BUCKET_REQUIRES_BOUNDS")).toBe(
      true,
    );
  });

  it("test_v18_bucket_min_gte_bucket_max", () => {
    expect(
      () =>
        new GroupBy({
          property: "amount",
          property_type: "number",
          bucket_size: 10,
          bucket_min: 100,
          bucket_max: 50,
        }),
    ).toThrow(/bucket_min.*must be less than/);
  });

  it("test_v24_bucket_size_nan", () => {
    const errors = validateGroupByArgs({
      group_by: new GroupBy({ property: "amount", bucket_size: Number.NaN }),
    });
    expect(errors.some((e) => e.code === "V24_BUCKET_NOT_FINITE")).toBe(true);
  });

  it("test_v24_bucket_min_inf", () => {
    const errors = validateGroupByArgs({
      group_by: new GroupBy({
        property: "amount",
        bucket_min: Number.POSITIVE_INFINITY,
      }),
    });
    expect(errors.some((e) => e.code === "V24_BUCKET_NOT_FINITE")).toBe(true);
  });

  it("test_valid_none_group_by", () => {
    const errors = validateGroupByArgs({ group_by: null });
    expect(errors).toStrictEqual([]);
  });

  it("test_valid_string_group_by", () => {
    const errors = validateGroupByArgs({ group_by: "country" });
    expect(errors).toStrictEqual([]);
  });

  it("test_valid_group_by_with_buckets", () => {
    const errors = validateGroupByArgs({
      group_by: new GroupBy({
        property: "revenue",
        property_type: "number",
        bucket_size: 50,
        bucket_min: 0,
        bucket_max: 500,
      }),
    });
    expect(errors).toStrictEqual([]);
  });
});
