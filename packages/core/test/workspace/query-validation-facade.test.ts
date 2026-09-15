// Translated facade-driven query-validation tests (B5-S2, packet §3 +
// §8): the B2-M1 deferral named in the
// `test/query/query-validation.test.ts:5-15` header — assertion-for-
// assertion port of the FACADE halves of
// tests/unit/test_query_validation.py, ALL 11 classes
// (TestTimeRangeValidation :61, TestAggregationValidation :161,
// TestPerMetricValidation :287, TestFormulaValidation :344,
// TestAnalysisModeValidation :377, TestGroupByValidation :405,
// TestEmptyEventsValidation :494, TestFormulaInListValidation :521,
// TestBuildParamsValidation :558, TestPercentileValidation :586,
// TestHistogramValidation :622).
//
// HEADER EXCLUSIONS (already translated at B2 — do NOT re-translate):
// - Every case in the classes above that calls `validate_query_args(...)`
//   DIRECTLY rather than going through the facade
//   (`test_v10_default_last_with_dates_ok` :104,
//   `test_valid_date_range_passes` :120, `test_valid_last_passes` :137,
//   `test_valid_property_math_with_property` :204,
//   `test_valid_per_user_with_property` :221,
//   `test_per_user_without_property_raises` :239,
//   `test_per_user_with_unique_raises` :256,
//   `test_v4_formula_with_two_events_ok` :353): the B2-M1 translation
//   covers the validator directly.
// - `TestValidateTimeArgs` :658 and `TestValidateGroupByArgs` :743 were
//   translated in FULL at B2 (same header).
//
// Translation notes:
// - `pytest.raises(ValueError, …)` on a CONSTRUCTOR (V13, V12, V26) names
//   Python's dual-inheriting `ParamValidationError`; the TS twin carries
//   the same message.
// - `ws._api_client = mock_api_client` mid-test becomes a facade built
//   with that stub from the start (the assignment is Python's way of
//   swapping in a response; nothing observes the pre-swap client).

import { describe, expect, it } from "vitest";

import {
  BookmarkValidationError,
  ParamValidationError,
} from "../../src/errors.js";
import { GroupBy } from "../../src/types/query-params/group-by.js";
import { Formula, Metric } from "../../src/types/query-params/metric.js";
import {
  makeStubWorkspace,
  mockWorkspaceClient,
} from "../../test-support/workspace-test-helpers.js";

/** An empty-but-valid insights response (the Python mock's shape). */
const EMPTY_OK: Record<string, unknown> = {
  computed_at: "",
  date_range: { from_date: "", to_date: "" },
  headers: [],
  series: {},
  meta: {},
};

// ===========================================================================
// T007: time range validation (V7-V11)
// ===========================================================================

describe("TestTimeRangeValidation", () => {
  it("V7: last must be a positive integer", async () => {
    await expect(
      makeStubWorkspace().query("Login", { last: 0 }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().query("Login", { last: 0 }),
    ).rejects.toThrow(/last must be a positive integer/);
  });

  it("V7: a negative last is rejected", async () => {
    await expect(
      makeStubWorkspace().query("Login", { last: -5 }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().query("Login", { last: -5 }),
    ).rejects.toThrow(/last must be a positive integer/);
  });

  it("V8: from_date must be YYYY-MM-DD", async () => {
    await expect(
      makeStubWorkspace().query("Login", { from_date: "01/01/2024" }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().query("Login", { from_date: "01/01/2024" }),
    ).rejects.toThrow(/from_date must be YYYY-MM-DD format/);
  });

  it("V8: to_date must also be YYYY-MM-DD", async () => {
    await expect(
      makeStubWorkspace().query("Login", {
        from_date: "2024-01-01",
        to_date: "Jan 31 2024",
      }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().query("Login", {
        from_date: "2024-01-01",
        to_date: "Jan 31 2024",
      }),
    ).rejects.toThrow(/to_date must be YYYY-MM-DD format/);
  });

  it("V9: to_date without from_date is rejected", async () => {
    await expect(
      makeStubWorkspace().query("Login", { to_date: "2024-01-31" }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().query("Login", { to_date: "2024-01-31" }),
    ).rejects.toThrow(/to_date requires from_date/);
  });

  it("V10: a non-default last cannot combine with explicit dates", async () => {
    await expect(
      makeStubWorkspace().query("Login", {
        last: 7,
        from_date: "2024-01-01",
        to_date: "2024-01-31",
      }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().query("Login", {
        last: 7,
        from_date: "2024-01-01",
        to_date: "2024-01-31",
      }),
    ).rejects.toThrow(/Cannot combine last=.*with explicit dates/);
  });
});

// ===========================================================================
// T016: aggregation validation (V1-V3)
// ===========================================================================

describe("TestAggregationValidation", () => {
  it("V1: property-based math requires math_property", async () => {
    await expect(
      makeStubWorkspace().query("Purchase", { math: "average" }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().query("Purchase", { math: "average" }),
    ).rejects.toThrow(/requires math_property/);
  });

  it("V1: every property math type requires math_property", async () => {
    for (const mathType of [
      "average",
      "median",
      "min",
      "max",
      "p25",
      "p75",
      "p90",
      "p99",
    ]) {
      await expect(
        makeStubWorkspace().query("Purchase", { math: mathType }),
      ).rejects.toBeInstanceOf(BookmarkValidationError);
      await expect(
        makeStubWorkspace().query("Purchase", { math: mathType }),
      ).rejects.toThrow(/requires math_property/);
    }
  });

  it("V2: non-property math rejects math_property", async () => {
    await expect(
      makeStubWorkspace().query("Login", {
        math: "unique",
        math_property: "amount",
      }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().query("Login", {
        math: "unique",
        math_property: "amount",
      }),
    ).rejects.toThrow(/math_property is only valid/);
  });

  it("V2: 'unique' math rejects math_property", async () => {
    await expect(
      makeStubWorkspace().query("Login", {
        math: "unique",
        math_property: "amount",
      }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().query("Login", {
        math: "unique",
        math_property: "amount",
      }),
    ).rejects.toThrow(/math_property is only valid/);
  });

  it("V3: per_user is incompatible with DAU", async () => {
    await expect(
      makeStubWorkspace().query("Login", { math: "dau", per_user: "average" }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().query("Login", { math: "dau", per_user: "average" }),
    ).rejects.toThrow(/per_user is incompatible/);
  });

  it("V3: per_user is incompatible with WAU", async () => {
    await expect(
      makeStubWorkspace().query("Login", { math: "wau", per_user: "total" }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().query("Login", { math: "wau", per_user: "total" }),
    ).rejects.toThrow(/per_user is incompatible/);
  });

  it("V3: per_user is incompatible with MAU", async () => {
    await expect(
      makeStubWorkspace().query("Login", { math: "mau", per_user: "min" }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().query("Login", { math: "mau", per_user: "min" }),
    ).rejects.toThrow(/per_user is incompatible/);
  });
});

// ===========================================================================
// T018: per-Metric validation (V13-V14)
// ===========================================================================

describe("TestPerMetricValidation", () => {
  it("V13: a Metric with property math requires a property", () => {
    expect(() => new Metric({ event: "Purchase", math: "average" })).toThrow(
      ParamValidationError,
    );
    expect(() => new Metric({ event: "Purchase", math: "average" })).toThrow(
      /requires a property/,
    );
  });

  it("V14: a Metric with non-property math rejects a property", async () => {
    await expect(
      makeStubWorkspace().query(
        new Metric({ event: "Login", math: "unique", property: "amount" }),
      ),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().query(
        new Metric({ event: "Login", math: "unique", property: "amount" }),
      ),
    ).rejects.toThrow(/property is only valid/);
  });

  it("V14: math='total' with a property is allowed (sum semantics)", async () => {
    const mock = mockWorkspaceClient();
    mock.setInsightsResponse(EMPTY_OK);

    await makeStubWorkspace(mock).query(
      new Metric({ event: "Purchase", math: "total", property: "amount" }),
    );

    expect(mock.insightsCalls).toHaveLength(1);
  });

  it("per-Metric per_user is incompatible with DAU", async () => {
    await expect(
      makeStubWorkspace().query(
        new Metric({ event: "Login", math: "dau", per_user: "average" }),
      ),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().query(
        new Metric({ event: "Login", math: "dau", per_user: "average" }),
      ),
    ).rejects.toThrow(/per_user is incompatible/);
  });

  it("per-Metric per_user requires a property", async () => {
    await expect(
      makeStubWorkspace().query(
        new Metric({ event: "Login", math: "total", per_user: "average" }),
      ),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().query(
        new Metric({ event: "Login", math: "total", per_user: "average" }),
      ),
    ).rejects.toThrow(/per_user requires property/);
  });
});

// ===========================================================================
// T035: formula validation (V4)
// ===========================================================================

describe("TestFormulaValidation", () => {
  it("V4: a formula requires at least 2 events", async () => {
    await expect(
      makeStubWorkspace().query("Login", { formula: "A * 100" }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().query("Login", { formula: "A * 100" }),
    ).rejects.toThrow(/formula requires at least 2 events/);
  });
});

// ===========================================================================
// T040: analysis mode validation (V5-V6)
// ===========================================================================

describe("TestAnalysisModeValidation", () => {
  it("V5: rolling and cumulative are mutually exclusive", async () => {
    await expect(
      makeStubWorkspace().query("Login", { rolling: 7, cumulative: true }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().query("Login", { rolling: 7, cumulative: true }),
    ).rejects.toThrow(/mutually exclusive/);
  });

  it("V6: rolling must be a positive integer", async () => {
    await expect(
      makeStubWorkspace().query("Login", { rolling: 0 }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().query("Login", { rolling: 0 }),
    ).rejects.toThrow(/rolling must be a positive integer/);
  });

  it("V6: a negative rolling is rejected", async () => {
    await expect(
      makeStubWorkspace().query("Login", { rolling: -3 }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().query("Login", { rolling: -3 }),
    ).rejects.toThrow(/rolling must be a positive integer/);
  });
});

// ===========================================================================
// GroupBy validation (V11-V12)
// ===========================================================================

describe("TestGroupByValidation", () => {
  it("V11: bucket_min requires bucket_size", async () => {
    await expect(
      makeStubWorkspace().query("Purchase", {
        group_by: new GroupBy({ property: "amount", bucket_min: 0 }),
      }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().query("Purchase", {
        group_by: new GroupBy({ property: "amount", bucket_min: 0 }),
      }),
    ).rejects.toThrow(/bucket_min\/bucket_max require bucket_size/);
  });

  it("V11: bucket_max requires bucket_size", async () => {
    await expect(
      makeStubWorkspace().query("Purchase", {
        group_by: new GroupBy({ property: "amount", bucket_max: 100 }),
      }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().query("Purchase", {
        group_by: new GroupBy({ property: "amount", bucket_max: 100 }),
      }),
    ).rejects.toThrow(/bucket_min\/bucket_max require bucket_size/);
  });

  it("V12: bucket_size must be positive (caught at construction)", () => {
    expect(() => new GroupBy({ property: "amount", bucket_size: 0 })).toThrow(
      ParamValidationError,
    );
    expect(() => new GroupBy({ property: "amount", bucket_size: 0 })).toThrow(
      /bucket_size must be positive/,
    );
  });

  it("V12: a negative bucket_size is caught at construction", () => {
    expect(() => new GroupBy({ property: "amount", bucket_size: -10 })).toThrow(
      ParamValidationError,
    );
    expect(() => new GroupBy({ property: "amount", bucket_size: -10 })).toThrow(
      /bucket_size must be positive/,
    );
  });

  it("bucket_size with the default string property_type is rejected", async () => {
    await expect(
      makeStubWorkspace().query("Purchase", {
        group_by: new GroupBy({ property: "amount", bucket_size: 10 }),
      }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().query("Purchase", {
        group_by: new GroupBy({ property: "amount", bucket_size: 10 }),
      }),
    ).rejects.toThrow(/bucket_size requires property_type='number'/);
  });

  it("bucket_size with property_type='number' passes", async () => {
    const mock = mockWorkspaceClient();
    mock.setInsightsResponse(EMPTY_OK);

    await makeStubWorkspace(mock).query("Purchase", {
      group_by: new GroupBy({
        property: "amount",
        property_type: "number",
        bucket_size: 10,
        bucket_min: 0,
        bucket_max: 100,
      }),
    });

    expect(mock.insightsCalls).toHaveLength(1);
  });

  it("bucket_size without bucket_min/bucket_max is rejected", async () => {
    await expect(
      makeStubWorkspace().query("Purchase", {
        group_by: new GroupBy({
          property: "amount",
          property_type: "number",
          bucket_size: 10,
        }),
      }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().query("Purchase", {
        group_by: new GroupBy({
          property: "amount",
          property_type: "number",
          bucket_size: 10,
        }),
      }),
    ).rejects.toThrow(/bucket_size requires both/);
  });
});

// ===========================================================================
// V0: empty events
// ===========================================================================

describe("TestEmptyEventsValidation", () => {
  it("V0: an empty events list is rejected", async () => {
    await expect(makeStubWorkspace().query([])).rejects.toBeInstanceOf(
      BookmarkValidationError,
    );
    await expect(makeStubWorkspace().query([])).rejects.toThrow(
      /At least one event is required/,
    );
  });

  it("V0: a non-empty events list passes validation", async () => {
    // Any error other than the V0 one is acceptable (the stub response
    // is not a valid insights body, so the transform raises).
    const error = await makeStubWorkspace()
      .query(["Login"])
      .then(
        () => null,
        (error_: unknown) => error_,
      );
    expect(String(error)).not.toContain("At least one event is required");
  });
});

// ===========================================================================
// Formula-in-list validation
// ===========================================================================

describe("TestFormulaInListValidation", () => {
  it("a Formula as the sole argument is rejected", async () => {
    await expect(
      makeStubWorkspace().query(new Formula({ expression: "A * 100" })),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().query(new Formula({ expression: "A * 100" })),
    ).rejects.toThrow(/Formula cannot be the only item/);
  });

  it("mixing a list Formula with a top-level formula is rejected", async () => {
    await expect(
      makeStubWorkspace().query(
        [
          new Metric({ event: "A" }),
          new Metric({ event: "B" }),
          new Formula({ expression: "A + B" }),
        ],
        { formula: "A - B" },
      ),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().query(
        [
          new Metric({ event: "A" }),
          new Metric({ event: "B" }),
          new Formula({ expression: "A + B" }),
        ],
        { formula: "A - B" },
      ),
    ).rejects.toThrow(/Cannot combine top-level/);
  });

  it("a list Formula with only 1 event triggers V4", async () => {
    await expect(
      makeStubWorkspace().query([
        "Login",
        new Formula({ expression: "A * 100" }),
      ]),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().query([
        "Login",
        new Formula({ expression: "A * 100" }),
      ]),
    ).rejects.toThrow(/formula requires at least 2 events/);
  });
});

// ===========================================================================
// T054c: build_params() validation parity
// ===========================================================================

describe("TestBuildParamsValidation", () => {
  it("rejects last=0", async () => {
    await expect(
      makeStubWorkspace().buildParams("Login", { last: 0 }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildParams("Login", { last: 0 }),
    ).rejects.toThrow(/last must be a positive integer/);
  });

  it("rejects a formula without enough events", async () => {
    await expect(
      makeStubWorkspace().buildParams("Login", { formula: "A + B" }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildParams("Login", { formula: "A + B" }),
    ).rejects.toThrow(/formula requires at least 2 events/);
  });

  it("rejects an invalid date format", async () => {
    await expect(
      makeStubWorkspace().buildParams("Login", { from_date: "01/01/2024" }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildParams("Login", { from_date: "01/01/2024" }),
    ).rejects.toThrow(/YYYY-MM-DD/);
  });
});

// ===========================================================================
// T064: percentile validation
// ===========================================================================

describe("TestPercentileValidation", () => {
  it("V1: math='percentile' requires math_property", async () => {
    await expect(
      makeStubWorkspace().buildParams("Login", {
        math: "percentile",
        percentile_value: 95,
      }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildParams("Login", {
        math: "percentile",
        percentile_value: 95,
      }),
    ).rejects.toThrow(/requires math_property/);
  });

  it("V26: math='percentile' requires percentile_value", async () => {
    await expect(
      makeStubWorkspace().buildParams("Login", {
        math: "percentile",
        math_property: "duration",
      }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildParams("Login", {
        math: "percentile",
        math_property: "duration",
      }),
    ).rejects.toThrow(/percentile_value/);
  });

  it("V26: a Metric with math='percentile' requires a value", () => {
    expect(
      () =>
        new Metric({
          event: "Login",
          math: "percentile",
          property: "duration",
        }),
    ).toThrow(ParamValidationError);
    expect(
      () =>
        new Metric({
          event: "Login",
          math: "percentile",
          property: "duration",
        }),
    ).toThrow(/percentile_value/);
  });

  it("percentile with a property and a value passes", async () => {
    const result = await makeStubWorkspace().buildParams("Login", {
      math: "percentile",
      math_property: "duration",
      percentile_value: 95,
    });
    expect(typeof result).toBe("object");
  });
});

// ===========================================================================
// T068: histogram validation
// ===========================================================================

describe("TestHistogramValidation", () => {
  it("V1: math='histogram' requires math_property", async () => {
    await expect(
      makeStubWorkspace().buildParams("Login", { math: "histogram" }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildParams("Login", { math: "histogram" }),
    ).rejects.toThrow(/requires math_property/);
  });

  it("V27: math='histogram' requires per_user", async () => {
    await expect(
      makeStubWorkspace().buildParams("Purchase", {
        math: "histogram",
        math_property: "amount",
      }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildParams("Purchase", {
        math: "histogram",
        math_property: "amount",
      }),
    ).rejects.toThrow(/requires per_user/);
  });

  it("V27: Metric(math='histogram') requires per_user", async () => {
    await expect(
      makeStubWorkspace().buildParams(
        new Metric({
          event: "Purchase",
          math: "histogram",
          property: "amount",
        }),
      ),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildParams(
        new Metric({
          event: "Purchase",
          math: "histogram",
          property: "amount",
        }),
      ),
    ).rejects.toThrow(/requires per_user/);
  });

  it("histogram with a property and per_user passes", async () => {
    const result = await makeStubWorkspace().buildParams("Purchase", {
      math: "histogram",
      math_property: "amount",
      per_user: "total",
    });
    expect(typeof result).toBe("object");
  });
});
