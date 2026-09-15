// Query-parameter validation (V0–V27) exercised through the Workspace facade.
// Mirrors the facade halves of all eleven classes in
// tests/unit/test_query_validation.py; the cases that call validate_query_args
// directly, plus TestValidateTimeArgs / TestValidateGroupByArgs, live in
// test/query/query-validation.test.ts. Constructor ValueErrors are ParamValidationError.

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

// --- Time range validation (V7-V11) ---

describe("Time range validation", () => {
  // python: TestTimeRangeValidation
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

// --- Aggregation validation (V1-V3) ---

describe("Aggregation validation", () => {
  // python: TestAggregationValidation
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

// --- Per-Metric validation (V13-V14) ---

describe("Per metric validation", () => {
  // python: TestPerMetricValidation
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

// --- Formula validation (V4) ---

describe("Formula validation", () => {
  // python: TestFormulaValidation
  it("V4: a formula requires at least 2 events", async () => {
    await expect(
      makeStubWorkspace().query("Login", { formula: "A * 100" }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().query("Login", { formula: "A * 100" }),
    ).rejects.toThrow(/formula requires at least 2 events/);
  });
});

// --- Analysis mode validation (V5-V6) ---

describe("Analysis mode validation", () => {
  // python: TestAnalysisModeValidation
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

// --- GroupBy validation (V11-V12) ---

describe("Group by validation", () => {
  // python: TestGroupByValidation
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

// --- V0: empty events ---

describe("Empty events validation", () => {
  // python: TestEmptyEventsValidation
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

// --- Formula-in-list validation ---

describe("Formula in list validation", () => {
  // python: TestFormulaInListValidation
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

// --- build_params() validation parity ---

describe("Build params validation", () => {
  // python: TestBuildParamsValidation
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

// --- Percentile validation ---

describe("Percentile validation", () => {
  // python: TestPercentileValidation
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

// --- Histogram validation ---

describe("Histogram validation", () => {
  // python: TestHistogramValidation
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
