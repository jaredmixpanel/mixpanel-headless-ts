// Translated insights params-building tests (B5-S2, packet §3):
// assertion-for-assertion port of tests/unit/test_query_params.py
// — ALL 22 classes (TestBasicParams :49,
// TestAggregationParams :214, TestFilterParams :330, TestGroupParams
// :478, TestMultiEventParams :610, TestFormulaParams :687,
// TestAnalysisModeParams :766, TestModeParams :837,
// TestPerMetricFilters :906, TestGroupByTypeError :975,
// TestFiltersCombinatorParams :1007, TestFormulaObjectParams :1089,
// TestBuildParams :1199, TestDateFilterParams :1253,
// TestMultiFormulaParams :1320, TestPercentileParams :1376,
// TestHistogramParams :1422, TestNewMathTypesInBuildParams :1458,
// TestSegmentMethodInBuildParams :1502,
// TestFrequencyBreakdownInBuildParams :1539,
// TestFrequencyFilterInBuildParams :1599,
// TestDataGroupIdInsights :1647).
//
// Translation notes:
// - `ws._build_query_params(...)` (the private method) is the exported
//   free function {@link buildQueryParams} in
//   `src/workspace-query-params.ts` (R7.2 split). Every Python call
//   spells the full keyword-only bag; the TS twin spreads a shared
//   {@link BASE} of the SAME default values and overrides only what the
//   Python call overrides — the inputs are identical.
// - `pytest.raises(TypeError, match="group_by elements must be …")`
//   names the B3 `ParamTypeError` twin (Python's `ParamTypeError`
//   dual-inherits `TypeError`), code `BB1_GROUP_BY_ELEMENT_TYPE`.
// - `build_filter_entry(...)` in `TestDateFilterParams` is the B3
//   builder {@link buildFilterEntry}, called directly exactly as Python
//   does.
// - R10.7 (packet Caution 6): the frequency-filter clause shape is a
//   KNOWN open item with pinned referee REJECTs. The asserts below
//   describe Python's behaviour TODAY and are NOT "fixed".

import { describe, expect, it } from "vitest";

import { ParamTypeError } from "../../src/errors.js";
import { Filter } from "../../src/types/query-params/filter.js";
import { GroupBy } from "../../src/types/query-params/group-by.js";
import { Formula, Metric } from "../../src/types/query-params/metric.js";
import { expectThrows } from "../../test-support/raises.js";
import { makeStubWorkspace } from "../../test-support/workspace-test-helpers.js";
import {
  behaviorOf,
  build,
  displayOf,
  measurementOf,
  section,
} from "./query-params-fixtures.js";

// ===========================================================================
// T041: analysis mode params
// ===========================================================================

describe("TestAnalysisModeParams", () => {
  it("rolling=7 produces analysis='rolling' + rollingWindowSize", () => {
    const params = build({ events: ["Signup"], math: "unique", rolling: 7 });
    expect(displayOf(params)["analysis"]).toBe("rolling");
    expect(displayOf(params)["rollingWindowSize"]).toBe(7);
  });

  it("cumulative=true produces analysis='cumulative'", () => {
    const params = build({
      events: ["Signup"],
      math: "unique",
      cumulative: true,
    });
    expect(displayOf(params)["analysis"]).toBe("cumulative");
  });

  it("neither produces analysis='linear'", () => {
    expect(displayOf(build())["analysis"]).toBe("linear");
  });
});

// ===========================================================================
// T044: mode -> chartType
// ===========================================================================

describe("TestModeParams", () => {
  it("mode='timeseries' maps to 'line'", () => {
    expect(displayOf(build({ mode: "timeseries" }))["chartType"]).toBe("line");
  });

  it("mode='total' maps to 'bar'", () => {
    expect(displayOf(build({ mode: "total" }))["chartType"]).toBe("bar");
  });

  it("mode='table' maps to 'table'", () => {
    expect(displayOf(build({ mode: "table" }))["chartType"]).toBe("table");
  });
});

// ===========================================================================
// Per-metric filters
// ===========================================================================

describe("TestPerMetricFilters", () => {
  it("Metric.filters land in behavior.filters", () => {
    const params = build({
      events: [
        new Metric({
          event: "Purchase",
          filters: [Filter.equals("country", "US")],
        }),
      ],
    });
    const show = section(params, "show");
    expect(show).toHaveLength(1);
    const behavior = behaviorOf(params);
    expect(Object.hasOwn(behavior, "filters")).toBe(true);
    const filters = behavior["filters"] as Array<Record<string, unknown>>;
    expect(filters).toHaveLength(1);
    expect(filters[0]!["value"]).toBe("country");
    expect(filters[0]!["filterValue"]).toStrictEqual(["US"]);
    expect(filters[0]!["filterOperator"]).toBe("equals");
  });

  it("per-metric filters are separate from the global where", () => {
    const params = build({
      events: [
        new Metric({
          event: "Purchase",
          filters: [Filter.equals("country", "US")],
        }),
      ],
      where: Filter.greaterThan("age", 18),
    });

    const globalFilters = section(params, "filter");
    expect(globalFilters).toHaveLength(1);
    expect(globalFilters[0]!["value"]).toBe("age");

    const perMetric = behaviorOf(params)["filters"] as Array<
      Record<string, unknown>
    >;
    expect(perMetric).toHaveLength(1);
    expect(perMetric[0]!["value"]).toBe("country");
  });
});

// ===========================================================================
// group_by element type validation
// ===========================================================================

describe("TestGroupByTypeError", () => {
  it("a non-str, non-GroupBy element raises", () => {
    const error = expectThrows(
      () => build({ group_by: [42] as never }),
      "expected ParamTypeError",
    );
    expect(error).toBeInstanceOf(ParamTypeError);
    expect((error as ParamTypeError).message).toContain(
      "group_by elements must be str, GroupBy, CohortBreakdown, or FrequencyBreakdown",
    );
  });
});

// ===========================================================================
// filters_combinator
// ===========================================================================

describe("TestFiltersCombinatorParams", () => {
  it("the default combinator is 'all'", () => {
    const params = build({ events: [new Metric({ event: "Login" })] });
    expect(behaviorOf(params)["filtersDeterminer"]).toBe("all");
  });

  it("filters_combinator='any' reaches filtersDeterminer", () => {
    const params = build({
      events: [
        new Metric({
          event: "Login",
          filters: [Filter.equals("$browser", "Chrome")],
          filters_combinator: "any",
        }),
      ],
    });
    expect(behaviorOf(params)["filtersDeterminer"]).toBe("any");
  });

  it("plain string events always use 'all'", () => {
    expect(behaviorOf(build())["filtersDeterminer"]).toBe("all");
  });
});

// ===========================================================================
// Formula objects passed via `formulas`
// ===========================================================================

describe("TestFormulaObjectParams", () => {
  it("a single Formula produces a formula show clause", () => {
    const params = build({
      events: [
        new Metric({ event: "Signup", math: "unique" }),
        new Metric({ event: "Purchase", math: "unique" }),
      ],
      formulas: [new Formula({ expression: "(B / A) * 100", label: "Conv %" })],
    });
    const show = section(params, "show");
    expect(show).toHaveLength(3);
    expect(show[2]!["type"]).toBe("formula");
    expect(show[2]!["definition"]).toBe("(B / A) * 100");
    expect(show[2]!["name"]).toBe("Conv %");
  });

  it("a Formula without a label omits `name`", () => {
    const params = build({
      events: [new Metric({ event: "A" }), new Metric({ event: "B" })],
      formulas: [new Formula({ expression: "A + B" })],
    });
    const clause = section(params, "show")[2]!;
    expect(clause["type"]).toBe("formula");
    expect(Object.hasOwn(clause, "name")).toBe(false);
  });

  it("multiple Formulas produce multiple clauses", () => {
    const params = build({
      events: [new Metric({ event: "A" }), new Metric({ event: "B" })],
      formulas: [
        new Formula({ expression: "A + B", label: "Sum" }),
        new Formula({ expression: "A / B", label: "Ratio" }),
      ],
    });
    const show = section(params, "show");
    expect(show).toHaveLength(4); // 2 metrics + 2 formulas
    expect(show[2]!["definition"]).toBe("A + B");
    expect(show[3]!["definition"]).toBe("A / B");
  });

  it("metrics are hidden when formulas are present", () => {
    const params = build({
      events: [new Metric({ event: "A" }), new Metric({ event: "B" })],
      formulas: [new Formula({ expression: "A / B" })],
    });
    expect(section(params, "show")[0]!["isHidden"]).toBe(true);
    expect(section(params, "show")[1]!["isHidden"]).toBe(true);
  });
});

// ===========================================================================
// T054: build_params() public helper
// ===========================================================================

describe("TestBuildParams", () => {
  it("returns a dict with sections and displayOptions", async () => {
    const result = await makeStubWorkspace().buildParams("Login");
    expect(typeof result).toBe("object");
    expect(Object.hasOwn(result, "sections")).toBe(true);
    expect(Object.hasOwn(result, "displayOptions")).toBe(true);
  });

  it("accepts the full query() signature", async () => {
    const result = await makeStubWorkspace().buildParams(
      [
        new Metric({ event: "Login", math: "unique" }),
        new Metric({ event: "Purchase" }),
      ],
      {
        from_date: "2024-01-01",
        to_date: "2024-01-31",
        unit: "week",
        group_by: new GroupBy({ property: "country" }),
        where: Filter.equals("region", "US"),
        formula: "A + B",
        formula_label: "Combined",
        mode: "total",
      },
    );
    expect(behaviorOf(result)["name"]).toBe("Login");
    expect(measurementOf(result)["math"]).toBe("unique");
    expect(displayOf(result)["chartType"]).toBe("bar");
  });

  it("output matches _build_query_params for the same input", async () => {
    const buildResult = await makeStubWorkspace().buildParams("Login", {
      math: "unique",
      last: 7,
      unit: "day",
    });
    const internalResult = build({ math: "unique", last: 7 });
    expect(buildResult).toStrictEqual(internalResult);
  });
});
