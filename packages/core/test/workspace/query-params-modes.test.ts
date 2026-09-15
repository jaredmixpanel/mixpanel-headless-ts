// `buildQueryParams` display modes and per-metric shapes: analysis
// (rolling/cumulative), mode to chartType, per-metric filters, the group_by
// element type guard, filters_combinator, `Formula` objects and the public
// `buildParams` helper. Mirrors the matching classes of
// `tests/unit/test_query_params.py` over the shared `build()` keyword bag.

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

describe("Analysis mode params", () => {
  // python: TestAnalysisModeParams
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

describe("Mode params", () => {
  // python: TestModeParams
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

describe("Per metric filters", () => {
  // python: TestPerMetricFilters
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

describe("Group by type error", () => {
  // python: TestGroupByTypeError
  // `pytest.raises(TypeError, match=…)` names `ParamTypeError`, which
  // dual-inherits `TypeError` in Python (code `BB1_GROUP_BY_ELEMENT_TYPE`).
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

describe("Filters combinator params", () => {
  // python: TestFiltersCombinatorParams
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

describe("Formula object params", () => {
  // python: TestFormulaObjectParams
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

describe("Build params", () => {
  // python: TestBuildParams
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
