// Translated insights params-building tests (B5-S2, packet §3):
// assertion-for-assertion port of tests/unit/test_query_params.py
// (R10.2) — ALL 22 classes (TestBasicParams :49,
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
import { Workspace } from "../../src/workspace.js";
import { ParamTypeError } from "../../src/errors.js";
import { buildFilterEntry } from "../../src/bookmarks/builders.js";
import {
  buildQueryParams,
  type BuildQueryParamsOptions,
  type ParamsDict,
} from "../../src/workspace-query-params.js";
import { Filter } from "../../src/types/query-params/filter.js";
import { GroupBy } from "../../src/types/query-params/group-by.js";
import {
  FrequencyBreakdown,
  FrequencyFilter,
} from "../../src/types/query-params/frequency.js";
import { Formula, Metric } from "../../src/types/query-params/metric.js";
import {
  mockWorkspaceClient,
  TEST_SESSION,
} from "../../test-support/workspace-test-helpers.js";

/**
 * The `ws` fixture (test file :36-41).
 *
 * @returns The facade under test.
 */
function makeWs(): Workspace {
  return new Workspace({
    session: TEST_SESSION,
    client: mockWorkspaceClient().client,
  });
}

/** The keyword-only bag every Python `_build_query_params` call spells. */
const BASE = {
  events: ["Login"],
  math: "total",
  math_property: null,
  per_user: null,
  from_date: null,
  to_date: null,
  last: 30,
  unit: "day",
  group_by: null,
  where: null,
  formulas: [],
  rolling: null,
  cumulative: false,
  mode: "timeseries",
} as const satisfies BuildQueryParamsOptions;

/**
 * `ws._build_query_params(**BASE, **overrides)`.
 *
 * @param overrides - The kwargs the Python call overrides.
 * @returns The bookmark params.
 */
function build(overrides: Partial<BuildQueryParamsOptions> = {}): ParamsDict {
  return buildQueryParams({ ...BASE, ...overrides });
}

/** `params["sections"][name]` as an array of records. */
function section(
  params: Record<string, unknown>,
  name: string,
): Array<Record<string, unknown>> {
  const sections = params["sections"] as Record<string, unknown>;
  return sections[name] as Array<Record<string, unknown>>;
}

/** `params["sections"]["show"][i]["measurement"]`. */
function measurementOf(
  params: Record<string, unknown>,
  index = 0,
): Record<string, unknown> {
  return section(params, "show")[index]!["measurement"] as Record<
    string,
    unknown
  >;
}

/** `params["sections"]["show"][i]["behavior"]`. */
function behaviorOf(
  params: Record<string, unknown>,
  index = 0,
): Record<string, unknown> {
  return section(params, "show")[index]!["behavior"] as Record<string, unknown>;
}

/** `params["displayOptions"]`. */
function displayOf(params: Record<string, unknown>): Record<string, unknown> {
  return params["displayOptions"] as Record<string, unknown>;
}

// ===========================================================================
// T008: basic bookmark params
// ===========================================================================

describe("TestBasicParams", () => {
  it("a single event string produces one show entry", () => {
    const params = build();
    const show = section(params, "show");
    expect(show.length).toBe(1);
    expect(behaviorOf(params)["name"]).toBe("Login");
  });

  it("last=N produces an 'in the last' date range", () => {
    const params = build({ last: 7 });
    const time = section(params, "time")[0]!;
    expect(time["dateRangeType"]).toBe("in the last");
    expect((time["window"] as Record<string, unknown>)["value"]).toBe(7);
    expect(time["unit"]).toBe("day");
  });

  it("from_date/to_date produce a 'between' range", () => {
    const params = build({ from_date: "2024-01-01", to_date: "2024-01-31" });
    const time = section(params, "time")[0]!;
    expect(time["dateRangeType"]).toBe("between");
    expect(time["value"]).toEqual(["2024-01-01", "2024-01-31"]);
  });

  it("from_date alone still produces a two-element 'between'", () => {
    const params = build({ from_date: "2024-01-01" });
    const time = section(params, "time")[0]!;
    expect(time["dateRangeType"]).toBe("between");
    const value = time["value"] as unknown[];
    expect(value[0]).toBe("2024-01-01");
    expect(value.length).toBe(2);
  });

  it("the unit parameter maps into the time section", () => {
    for (const unit of ["hour", "day", "week", "month", "quarter"]) {
      const params = build({ unit });
      expect(section(params, "time")[0]!["unit"]).toBe(unit);
    }
  });

  it("mode='timeseries' produces line/linear display options", () => {
    const params = build();
    expect(displayOf(params)["chartType"]).toBe("line");
    expect(displayOf(params)["analysis"]).toBe("linear");
  });

  it("the default measurement is a total event count", () => {
    const params = build();
    expect(section(params, "show")[0]!["type"]).toBe("metric");
    expect(measurementOf(params)["math"]).toBe("total");
  });
});

// ===========================================================================
// T017: aggregation params
// ===========================================================================

describe("TestAggregationParams", () => {
  it("math='unique' reaches the measurement", () => {
    expect(measurementOf(build({ math: "unique" }))["math"]).toBe("unique");
  });

  it("math='dau' reaches the measurement", () => {
    expect(measurementOf(build({ math: "dau" }))["math"]).toBe("dau");
  });

  it("math_property maps to measurement.property", () => {
    const m = measurementOf(
      build({
        events: ["Purchase"],
        math: "average",
        math_property: "amount",
      }),
    );
    expect(m["math"]).toBe("average");
    expect((m["property"] as Record<string, unknown>)["name"]).toBe("amount");
  });

  it("per_user maps to measurement.perUserAggregation", () => {
    const m = measurementOf(
      build({
        events: ["Purchase"],
        math_property: "revenue",
        per_user: "average",
      }),
    );
    expect(m["perUserAggregation"]).toBe("average");
  });

  it("Metric objects override the top-level math/property/per_user", () => {
    const m = measurementOf(
      build({
        events: [
          new Metric({
            event: "Purchase",
            math: "average",
            property: "revenue",
          }),
        ],
      }),
    );
    expect(m["math"]).toBe("average");
    expect((m["property"] as Record<string, unknown>)["name"]).toBe("revenue");
  });
});

// ===========================================================================
// T024-T025: filter and group params
// ===========================================================================

describe("TestFilterParams", () => {
  it("Filter.equals produces the correct filter entry", () => {
    const params = build({ where: [Filter.equals("country", "US")] });
    const f = section(params, "filter")[0]!;
    expect(f["value"]).toBe("country");
    expect(f["filterOperator"]).toBe("equals");
    expect(f["filterValue"]).toEqual(["US"]);
    expect(f["filterType"]).toBe("string");
  });

  it("Filter.greater_than produces a scalar filterValue", () => {
    const params = build({
      events: ["Purchase"],
      where: [Filter.greaterThan("age", 18)],
    });
    const f = section(params, "filter")[0]!;
    expect(f["filterValue"]).toBe(18);
    expect(f["filterType"]).toBe("number");
  });

  it("Filter.contains produces a plain string filterValue", () => {
    const params = build({ where: [Filter.contains("browser", "Chrome")] });
    expect(section(params, "filter")[0]!["filterValue"]).toBe("Chrome");
  });

  it("multiple filters produce multiple entries", () => {
    const params = build({
      events: ["Purchase"],
      where: [Filter.equals("country", "US"), Filter.greaterThan("amount", 10)],
    });
    expect(section(params, "filter").length).toBe(2);
  });

  it("where=null produces an empty filter section", () => {
    expect(section(build(), "filter")).toEqual([]);
  });

  it("Filter.list_contains threads through end-to-end", () => {
    const params = build({
      events: ["Purchase Completed"],
      last: 90,
      where: [
        Filter.listContains("cart", [], {
          equals: { Brand: "nike", Category: "hats" },
        }),
      ],
      mode: "total",
    });
    const filters = section(params, "filter");
    expect(filters.length).toBe(1);
    const f = filters[0]!;
    expect(f["filterType"]).toBe("object");
    expect(f["filterJoinType"]).toBe("list");
    expect(f["listQuantifier"]).toBe("any");
    expect((f["listItemFilters"] as unknown[]).length).toBe(2);
  });
});

describe("TestGroupParams", () => {
  it("a string group_by produces the correct group entry", () => {
    const params = build({ group_by: "platform" });
    const g = section(params, "group")[0]!;
    expect(g["value"]).toBe("platform");
    expect(g["propertyType"]).toBe("string");
  });

  it("a GroupBy object produces the correct group entry", () => {
    const params = build({
      events: ["Purchase"],
      group_by: new GroupBy({ property: "amount", property_type: "number" }),
    });
    const g = section(params, "group")[0]!;
    expect(g["value"]).toBe("amount");
    expect(g["propertyType"]).toBe("number");
  });

  it("bucket_size produces customBucket", () => {
    const params = build({
      events: ["Purchase"],
      group_by: new GroupBy({
        property: "revenue",
        property_type: "number",
        bucket_size: 50,
        bucket_min: 0,
        bucket_max: 500,
      }),
    });
    const bucket = section(params, "group")[0]!["customBucket"] as Record<
      string,
      unknown
    >;
    expect(bucket["bucketSize"]).toBe(50);
    expect(bucket["min"]).toBe(0);
    expect(bucket["max"]).toBe(500);
  });

  it("a list group_by produces multiple entries", () => {
    const params = build({ group_by: ["platform", "country"] });
    expect(section(params, "group").length).toBe(2);
  });

  it("GroupBy.list_item threads through end-to-end", () => {
    const params = build({
      events: ["Cart Viewed"],
      group_by: GroupBy.listItem("cart", "Brand"),
    });
    const g = section(params, "group")[0]!;
    expect(g["joinPropertyType"]).toBe("list");
    expect(g["propertyType"]).toBe("object");
    const lig = g["listItemGroup"] as Record<string, unknown>;
    expect(lig["propertyName"]).toBe("Brand");
    expect(lig["propertyType"]).toBe("string");
  });
});

// ===========================================================================
// T032: multi-event params
// ===========================================================================

describe("TestMultiEventParams", () => {
  it("a list of strings produces multiple show entries", () => {
    const params = build({
      events: ["Signup", "Login", "Purchase"],
      math: "unique",
    });
    const show = section(params, "show");
    expect(show.length).toBe(3);
    const events = show.map(
      (e) => (e["behavior"] as Record<string, unknown>)["name"],
    );
    expect(events).toEqual(["Signup", "Login", "Purchase"]);
  });

  it("a list of Metrics carries per-event math", () => {
    const params = build({
      events: [
        new Metric({ event: "Signup", math: "unique" }),
        new Metric({ event: "Purchase", math: "total" }),
      ],
    });
    expect(measurementOf(params, 0)["math"]).toBe("unique");
    expect(measurementOf(params, 1)["math"]).toBe("total");
  });

  it("strings in a mixed list inherit the top-level math", () => {
    const params = build({
      events: [
        "Login",
        new Metric({ event: "Purchase", math: "total", property: "amount" }),
      ],
      math: "unique",
    });
    expect(measurementOf(params, 0)["math"]).toBe("unique");
    expect(measurementOf(params, 1)["math"]).toBe("total");
  });
});

// ===========================================================================
// T036: formula params
// ===========================================================================

describe("TestFormulaParams", () => {
  it("a formula entry is appended to sections.show", () => {
    const params = build({
      events: [
        new Metric({ event: "Signup", math: "unique" }),
        new Metric({ event: "Purchase", math: "unique" }),
      ],
      formulas: [
        new Formula({ expression: "(B / A) * 100", label: "Conversion Rate" }),
      ],
    });
    const show = section(params, "show");
    // 2 metrics + 1 formula = 3 show entries
    expect(show.length).toBe(3);
    expect(show[2]!["type"]).toBe("formula");
    expect(show[2]!["definition"]).toBe("(B / A) * 100");
    expect(show[2]!["name"]).toBe("Conversion Rate");
  });

  it("input metrics are hidden when a formula is present", () => {
    const params = build({
      events: [
        new Metric({ event: "A", math: "unique" }),
        new Metric({ event: "B", math: "unique" }),
      ],
      formulas: [new Formula({ expression: "B / A" })],
    });
    expect(section(params, "show")[0]!["isHidden"]).toBe(true);
    expect(section(params, "show")[1]!["isHidden"]).toBe(true);
  });

  it("without a formula, metrics are not hidden", () => {
    const params = build();
    expect(section(params, "show")[0]!["isHidden"]).not.toBe(true);
  });
});

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
    expect(show.length).toBe(1);
    const behavior = behaviorOf(params);
    expect(Object.hasOwn(behavior, "filters")).toBe(true);
    const filters = behavior["filters"] as Array<Record<string, unknown>>;
    expect(filters.length).toBe(1);
    expect(filters[0]!["value"]).toBe("country");
    expect(filters[0]!["filterValue"]).toEqual(["US"]);
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
    expect(globalFilters.length).toBe(1);
    expect(globalFilters[0]!["value"]).toBe("age");

    const perMetric = behaviorOf(params)["filters"] as Array<
      Record<string, unknown>
    >;
    expect(perMetric.length).toBe(1);
    expect(perMetric[0]!["value"]).toBe("country");
  });
});

// ===========================================================================
// group_by element type validation
// ===========================================================================

describe("TestGroupByTypeError", () => {
  it("a non-str, non-GroupBy element raises", () => {
    try {
      build({ group_by: [42] as never });
      expect.unreachable("expected ParamTypeError");
    } catch (exc) {
      expect(exc).toBeInstanceOf(ParamTypeError);
      expect((exc as ParamTypeError).message).toContain(
        "group_by elements must be str, GroupBy, CohortBreakdown, or FrequencyBreakdown",
      );
    }
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
    expect(show.length).toBe(3);
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
    expect(show.length).toBe(4); // 2 metrics + 2 formulas
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
    const result = await makeWs().buildParams("Login");
    expect(typeof result).toBe("object");
    expect(Object.hasOwn(result, "sections")).toBe(true);
    expect(Object.hasOwn(result, "displayOptions")).toBe(true);
  });

  it("accepts the full query() signature", async () => {
    const result = await makeWs().buildParams(
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
    const buildResult = await makeWs().buildParams("Login", {
      math: "unique",
      last: 7,
      unit: "day",
    });
    const internalResult = build({ math: "unique", last: 7 });
    expect(buildResult).toEqual(internalResult);
  });
});

// ===========================================================================
// T057: date filter bookmark params
// ===========================================================================

describe("TestDateFilterParams", () => {
  it("an absolute date filter omits filterDateUnit", () => {
    const entry = buildFilterEntry(Filter.on("created", "2024-06-15"));
    expect(entry["filterType"]).toBe("datetime");
    expect(entry["filterOperator"]).toBe("was on");
    expect(entry["filterValue"]).toBe("2024-06-15");
    expect(Object.hasOwn(entry, "filterDateUnit")).toBe(false);
  });

  it("a relative date filter includes filterDateUnit", () => {
    const entry = buildFilterEntry(Filter.inTheLast("created", 7, "day"));
    expect(entry["filterDateUnit"]).toBe("day");
    expect(entry["filterValue"]).toBe(7);
    expect(entry["filterType"]).toBe("datetime");
  });

  it("a date-between filterValue is a two-element list", () => {
    const entry = buildFilterEntry(
      Filter.dateBetween("created", "2024-01-01", "2024-06-30"),
    );
    expect(entry["filterValue"]).toEqual(["2024-01-01", "2024-06-30"]);
    expect(entry["filterOperator"]).toBe("was between");
    expect(Object.hasOwn(entry, "filterDateUnit")).toBe(false);
  });

  it("non-date filters still omit filterDateUnit", () => {
    const entry = buildFilterEntry(Filter.equals("country", "US"));
    expect(Object.hasOwn(entry, "filterDateUnit")).toBe(false);
  });

  it("a date filter works in the where clause", async () => {
    const params = await makeWs().buildParams("Login", {
      where: Filter.inTheLast("created", 7, "day"),
    });
    const filt = section(params, "filter")[0]!;
    expect(filt["filterDateUnit"]).toBe("day");
    expect(filt["filterType"]).toBe("datetime");
  });

  it("Filter.before produces the correct entry", () => {
    const entry = buildFilterEntry(Filter.before("created", "2024-01-01"));
    expect(entry["filterOperator"]).toBe("was before");
    expect(entry["filterValue"]).toBe("2024-01-01");
    expect(entry["filterType"]).toBe("datetime");
  });

  it("Filter.since produces the correct entry", () => {
    const entry = buildFilterEntry(Filter.since("created", "2024-01-01"));
    expect(entry["filterOperator"]).toBe("was since");
    expect(entry["filterValue"]).toBe("2024-01-01");
  });

  it("Filter.not_in_the_last includes filterDateUnit", () => {
    const entry = buildFilterEntry(Filter.notInTheLast("created", 30, "day"));
    expect(entry["filterDateUnit"]).toBe("day");
    expect(entry["filterOperator"]).toBe("was not in the");
  });
});

// ===========================================================================
// T060: multiple formulas via the events list
// ===========================================================================

describe("TestMultiFormulaParams", () => {
  it("two Formulas in the events list produce two entries", async () => {
    const params = await makeWs().buildParams([
      new Metric({ event: "Signup", math: "unique" }),
      new Metric({ event: "Purchase", math: "unique" }),
      new Formula({ expression: "B / A", label: "Conv Rate" }),
      new Formula({ expression: "A + B", label: "Total" }),
    ]);
    const formulas = section(params, "show").filter(
      (e) => e["type"] === "formula",
    );
    expect(formulas.length).toBe(2);
    expect(formulas[0]!["definition"]).toBe("B / A");
    expect(formulas[0]!["name"]).toBe("Conv Rate");
    expect(formulas[1]!["definition"]).toBe("A + B");
    expect(formulas[1]!["name"]).toBe("Total");
  });

  it("all metrics get isHidden with multiple formulas", async () => {
    const params = await makeWs().buildParams([
      new Metric({ event: "A" }),
      new Metric({ event: "B" }),
      new Formula({ expression: "A+B" }),
      new Formula({ expression: "A-B" }),
    ]);
    const metrics = section(params, "show").filter(
      (e) => e["type"] === "metric",
    );
    expect(metrics.every((e) => e["isHidden"] === true)).toBe(true);
  });

  it("three formulas with three events all produce entries", async () => {
    const params = await makeWs().buildParams([
      new Metric({ event: "A", math: "unique" }),
      new Metric({ event: "B", math: "unique" }),
      new Metric({ event: "C", math: "unique" }),
      new Formula({ expression: "A + B", label: "AB" }),
      new Formula({ expression: "B + C", label: "BC" }),
      new Formula({ expression: "(A + B + C) / 3", label: "Avg" }),
    ]);
    const show = section(params, "show");
    expect(show.length).toBe(6); // 3 metrics + 3 formulas
    expect(show.filter((e) => e["type"] === "formula").length).toBe(3);
  });
});

// ===========================================================================
// T065: custom percentile
// ===========================================================================

describe("TestPercentileParams", () => {
  it("math='percentile' maps to 'custom_percentile'", async () => {
    const params = await makeWs().buildParams("Login", {
      math: "percentile",
      math_property: "duration",
      percentile_value: 95,
    });
    const m = measurementOf(params);
    expect(m["math"]).toBe("custom_percentile");
    expect(m["percentile"]).toBe(95);
    expect((m["property"] as Record<string, unknown>)["name"]).toBe("duration");
  });

  it("Metric(math='percentile') maps to custom_percentile", async () => {
    const params = await makeWs().buildParams(
      new Metric({
        event: "Login",
        math: "percentile",
        property: "duration",
        percentile_value: 95,
      }),
    );
    const m = measurementOf(params);
    expect(m["math"]).toBe("custom_percentile");
    expect(m["percentile"]).toBe(95);
  });

  it("a float percentile value is supported", async () => {
    const params = await makeWs().buildParams("Login", {
      math: "percentile",
      math_property: "duration",
      percentile_value: 99.9,
    });
    expect(measurementOf(params)["percentile"]).toBe(99.9);
  });
});

// ===========================================================================
// T069: histogram
// ===========================================================================

describe("TestHistogramParams", () => {
  it("math='histogram' maps directly", async () => {
    const params = await makeWs().buildParams("Purchase", {
      math: "histogram",
      math_property: "amount",
      per_user: "total",
    });
    const m = measurementOf(params);
    expect(m["math"]).toBe("histogram");
    expect((m["property"] as Record<string, unknown>)["name"]).toBe("amount");
    expect(m["perUserAggregation"]).toBe("total");
  });

  it("Metric(math='histogram') maps correctly", async () => {
    const params = await makeWs().buildParams(
      new Metric({
        event: "Purchase",
        math: "histogram",
        property: "amount",
        per_user: "total",
      }),
    );
    const m = measurementOf(params);
    expect(m["math"]).toBe("histogram");
    expect(m["perUserAggregation"]).toBe("total");
  });
});

// ===========================================================================
// T005: new math types in build_params
// ===========================================================================

describe("TestNewMathTypesInBuildParams", () => {
  it("math='cumulative_unique' reaches the measurement", async () => {
    const params = await makeWs().buildParams("Login", {
      math: "cumulative_unique",
    });
    expect(measurementOf(params)["math"]).toBe("cumulative_unique");
  });

  it("math='sessions' reaches the measurement", async () => {
    const params = await makeWs().buildParams("Login", { math: "sessions" });
    expect(measurementOf(params)["math"]).toBe("sessions");
  });

  for (const mathType of [
    "unique_values",
    "most_frequent",
    "first_value",
    "multi_attribution",
    "numeric_summary",
  ]) {
    it(`property-requiring math '${mathType}' reaches the measurement`, async () => {
      const params = await makeWs().buildParams("Purchase", {
        math: mathType,
        math_property: "amount",
      });
      const m = measurementOf(params);
      expect(m["math"]).toBe(mathType);
      expect((m["property"] as Record<string, unknown>)["name"]).toBe("amount");
    });
  }
});

// ===========================================================================
// T009: Metric.segment_method
// ===========================================================================

describe("TestSegmentMethodInBuildParams", () => {
  it("segment_method='first' produces segmentMethod='first'", async () => {
    const params = await makeWs().buildParams(
      new Metric({ event: "Login", segment_method: "first" }),
    );
    expect(measurementOf(params)["segmentMethod"]).toBe("first");
  });

  it("segment_method='all' produces segmentMethod='all'", async () => {
    const params = await makeWs().buildParams(
      new Metric({ event: "Login", segment_method: "all" }),
    );
    expect(measurementOf(params)["segmentMethod"]).toBe("all");
  });

  it("a Metric without segment_method omits the key", async () => {
    const params = await makeWs().buildParams(new Metric({ event: "Login" }));
    expect(Object.hasOwn(measurementOf(params), "segmentMethod")).toBe(false);
  });

  it("a plain string event omits segmentMethod", async () => {
    const params = await makeWs().buildParams("Login");
    expect(Object.hasOwn(measurementOf(params), "segmentMethod")).toBe(false);
  });
});

// ===========================================================================
// T023: FrequencyBreakdown in group_by
// ===========================================================================

describe("TestFrequencyBreakdownInBuildParams", () => {
  it("produces a frequency group entry", async () => {
    const params = await makeWs().buildParams("Login", {
      group_by: new FrequencyBreakdown({ event: "Purchase" }),
    });
    const group = section(params, "group");
    expect(group.length).toBe(1);
    expect(group[0]!["resourceType"]).toBe("people");
    const behavior = group[0]!["behavior"] as Record<string, unknown>;
    expect(behavior["behaviorType"]).toBe("$frequency");
    expect(behavior["event"]).toEqual({
      label: "Purchase",
      value: "Purchase",
    });
  });

  it("a labeled FrequencyBreakdown puts the label in `value`", async () => {
    const params = await makeWs().buildParams("Login", {
      group_by: new FrequencyBreakdown({
        event: "Purchase",
        label: "Buy Freq",
      }),
    });
    expect(section(params, "group")[0]!["value"]).toBe("Buy Freq");
  });

  it("a mixed string + FrequencyBreakdown list works", async () => {
    const params = await makeWs().buildParams("Login", {
      group_by: ["country", new FrequencyBreakdown({ event: "Purchase" })],
    });
    const group = section(params, "group");
    expect(group.length).toBe(2);
    expect(group[0]!["value"]).toBe("country");
    const behavior = group[1]!["behavior"] as Record<string, unknown>;
    expect(behavior["behaviorType"]).toBe("$frequency");
  });

  it("existing GroupBy usage still works", async () => {
    const params = await makeWs().buildParams("Login", {
      group_by: new GroupBy({ property: "country" }),
    });
    const group = section(params, "group");
    expect(group.length).toBe(1);
    expect(group[0]!["value"]).toBe("country");
  });
});

// ===========================================================================
// T023: FrequencyFilter in where
// ===========================================================================

describe("TestFrequencyFilterInBuildParams", () => {
  it("produces a frequency filter entry", async () => {
    const params = await makeWs().buildParams("Login", {
      where: new FrequencyFilter({ event: "Login", value: 5 }),
    });
    const filt = section(params, "filter");
    expect(filt.length).toBe(1);
    expect(filt[0]!["resourceType"]).toBe("people");
    expect(
      (filt[0]!["behavior"] as Record<string, unknown>)["behaviorType"],
    ).toBe("$frequency");
  });

  it("a mixed Filter + FrequencyFilter list works", async () => {
    const params = await makeWs().buildParams("Login", {
      where: [
        Filter.equals("country", "US"),
        new FrequencyFilter({ event: "Login", value: 5 }),
      ],
    });
    const filt = section(params, "filter");
    expect(filt.length).toBe(2);
    expect(filt[0]!["value"]).toBe("country");
    expect(
      (filt[1]!["behavior"] as Record<string, unknown>)["behaviorType"],
    ).toBe("$frequency");
  });

  it("existing Filter usage still works", async () => {
    const params = await makeWs().buildParams("Login", {
      where: Filter.equals("country", "US"),
    });
    const filt = section(params, "filter");
    expect(filt.length).toBe(1);
    expect(filt[0]!["value"]).toBe("country");
  });
});

// ===========================================================================
// T032: data_group_id
// ===========================================================================

describe("TestDataGroupIdInsights", () => {
  it('build_params with data_group_id=5 emits globalDataGroupId: "5"', async () => {
    const params = await makeWs().buildParams("Login", { data_group_id: 5 });
    const sections = params["sections"] as Record<string, unknown>;
    expect(sections["globalDataGroupId"]).toBe("5");
    // The old off-contract sections-level spelling must not appear (bug (b)).
    expect(Object.hasOwn(sections, "dataGroupId")).toBe(false);
  });

  it("build_params without data_group_id omits the key", async () => {
    const params = await makeWs().buildParams("Login");
    const sections = params["sections"] as Record<string, unknown>;
    expect(Object.hasOwn(sections, "globalDataGroupId")).toBe(false);
    expect(Object.hasOwn(sections, "dataGroupId")).toBe(false);
  });

  it('_build_query_params with data_group_id=3 emits globalDataGroupId: "3"', () => {
    const params = build({ data_group_id: 3 });
    const sections = params["sections"] as Record<string, unknown>;
    expect(sections["globalDataGroupId"]).toBe("3");
    expect(Object.hasOwn(sections, "dataGroupId")).toBe(false);
  });

  it("_build_query_params without data_group_id omits the key", () => {
    const params = build();
    const sections = params["sections"] as Record<string, unknown>;
    expect(Object.hasOwn(sections, "globalDataGroupId")).toBe(false);
    expect(Object.hasOwn(sections, "dataGroupId")).toBe(false);
  });
});
