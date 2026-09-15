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

import { buildFilterEntry } from "../../src/bookmarks/builders.js";
import { Filter } from "../../src/types/query-params/filter.js";
import {
  FrequencyBreakdown,
  FrequencyFilter,
} from "../../src/types/query-params/frequency.js";
import { GroupBy } from "../../src/types/query-params/group-by.js";
import { Formula, Metric } from "../../src/types/query-params/metric.js";
import { makeStubWorkspace } from "../../test-support/workspace-test-helpers.js";
import { build, measurementOf, section } from "./query-params-fixtures.js";

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
    expect(entry["filterValue"]).toStrictEqual(["2024-01-01", "2024-06-30"]);
    expect(entry["filterOperator"]).toBe("was between");
    expect(Object.hasOwn(entry, "filterDateUnit")).toBe(false);
  });

  it("non-date filters still omit filterDateUnit", () => {
    const entry = buildFilterEntry(Filter.equals("country", "US"));
    expect(Object.hasOwn(entry, "filterDateUnit")).toBe(false);
  });

  it("a date filter works in the where clause", async () => {
    const params = await makeStubWorkspace().buildParams("Login", {
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
    const params = await makeStubWorkspace().buildParams([
      new Metric({ event: "Signup", math: "unique" }),
      new Metric({ event: "Purchase", math: "unique" }),
      new Formula({ expression: "B / A", label: "Conv Rate" }),
      new Formula({ expression: "A + B", label: "Total" }),
    ]);
    const formulas = section(params, "show").filter(
      (e) => e["type"] === "formula",
    );
    expect(formulas).toHaveLength(2);
    expect(formulas[0]!["definition"]).toBe("B / A");
    expect(formulas[0]!["name"]).toBe("Conv Rate");
    expect(formulas[1]!["definition"]).toBe("A + B");
    expect(formulas[1]!["name"]).toBe("Total");
  });

  it("all metrics get isHidden with multiple formulas", async () => {
    const params = await makeStubWorkspace().buildParams([
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
    const params = await makeStubWorkspace().buildParams([
      new Metric({ event: "A", math: "unique" }),
      new Metric({ event: "B", math: "unique" }),
      new Metric({ event: "C", math: "unique" }),
      new Formula({ expression: "A + B", label: "AB" }),
      new Formula({ expression: "B + C", label: "BC" }),
      new Formula({ expression: "(A + B + C) / 3", label: "Avg" }),
    ]);
    const show = section(params, "show");
    expect(show).toHaveLength(6); // 3 metrics + 3 formulas
    expect(show.filter((e) => e["type"] === "formula")).toHaveLength(3);
  });
});

// ===========================================================================
// T065: custom percentile
// ===========================================================================

describe("TestPercentileParams", () => {
  it("math='percentile' maps to 'custom_percentile'", async () => {
    const params = await makeStubWorkspace().buildParams("Login", {
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
    const params = await makeStubWorkspace().buildParams(
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
    const params = await makeStubWorkspace().buildParams("Login", {
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
    const params = await makeStubWorkspace().buildParams("Purchase", {
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
    const params = await makeStubWorkspace().buildParams(
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
    const params = await makeStubWorkspace().buildParams("Login", {
      math: "cumulative_unique",
    });
    expect(measurementOf(params)["math"]).toBe("cumulative_unique");
  });

  it("math='sessions' reaches the measurement", async () => {
    const params = await makeStubWorkspace().buildParams("Login", {
      math: "sessions",
    });
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
      const params = await makeStubWorkspace().buildParams("Purchase", {
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
    const params = await makeStubWorkspace().buildParams(
      new Metric({ event: "Login", segment_method: "first" }),
    );
    expect(measurementOf(params)["segmentMethod"]).toBe("first");
  });

  it("segment_method='all' produces segmentMethod='all'", async () => {
    const params = await makeStubWorkspace().buildParams(
      new Metric({ event: "Login", segment_method: "all" }),
    );
    expect(measurementOf(params)["segmentMethod"]).toBe("all");
  });

  it("a Metric without segment_method omits the key", async () => {
    const params = await makeStubWorkspace().buildParams(
      new Metric({ event: "Login" }),
    );
    expect(Object.hasOwn(measurementOf(params), "segmentMethod")).toBe(false);
  });

  it("a plain string event omits segmentMethod", async () => {
    const params = await makeStubWorkspace().buildParams("Login");
    expect(Object.hasOwn(measurementOf(params), "segmentMethod")).toBe(false);
  });
});

// ===========================================================================
// T023: FrequencyBreakdown in group_by
// ===========================================================================

describe("TestFrequencyBreakdownInBuildParams", () => {
  it("produces a frequency group entry", async () => {
    const params = await makeStubWorkspace().buildParams("Login", {
      group_by: new FrequencyBreakdown({ event: "Purchase" }),
    });
    const group = section(params, "group");
    expect(group).toHaveLength(1);
    expect(group[0]!["resourceType"]).toBe("people");
    const behavior = group[0]!["behavior"] as Record<string, unknown>;
    expect(behavior["behaviorType"]).toBe("$frequency");
    expect(behavior["event"]).toStrictEqual({
      label: "Purchase",
      value: "Purchase",
    });
  });

  it("a labeled FrequencyBreakdown puts the label in `value`", async () => {
    const params = await makeStubWorkspace().buildParams("Login", {
      group_by: new FrequencyBreakdown({
        event: "Purchase",
        label: "Buy Freq",
      }),
    });
    expect(section(params, "group")[0]!["value"]).toBe("Buy Freq");
  });

  it("a mixed string + FrequencyBreakdown list works", async () => {
    const params = await makeStubWorkspace().buildParams("Login", {
      group_by: ["country", new FrequencyBreakdown({ event: "Purchase" })],
    });
    const group = section(params, "group");
    expect(group).toHaveLength(2);
    expect(group[0]!["value"]).toBe("country");
    const behavior = group[1]!["behavior"] as Record<string, unknown>;
    expect(behavior["behaviorType"]).toBe("$frequency");
  });

  it("existing GroupBy usage still works", async () => {
    const params = await makeStubWorkspace().buildParams("Login", {
      group_by: new GroupBy({ property: "country" }),
    });
    const group = section(params, "group");
    expect(group).toHaveLength(1);
    expect(group[0]!["value"]).toBe("country");
  });
});

// ===========================================================================
// T023: FrequencyFilter in where
// ===========================================================================

describe("TestFrequencyFilterInBuildParams", () => {
  it("produces a frequency filter entry", async () => {
    const params = await makeStubWorkspace().buildParams("Login", {
      where: new FrequencyFilter({ event: "Login", value: 5 }),
    });
    const filt = section(params, "filter");
    expect(filt).toHaveLength(1);
    expect(filt[0]!["resourceType"]).toBe("people");
    expect(
      (filt[0]!["behavior"] as Record<string, unknown>)["behaviorType"],
    ).toBe("$frequency");
  });

  it("a mixed Filter + FrequencyFilter list works", async () => {
    const params = await makeStubWorkspace().buildParams("Login", {
      where: [
        Filter.equals("country", "US"),
        new FrequencyFilter({ event: "Login", value: 5 }),
      ],
    });
    const filt = section(params, "filter");
    expect(filt).toHaveLength(2);
    expect(filt[0]!["value"]).toBe("country");
    expect(
      (filt[1]!["behavior"] as Record<string, unknown>)["behaviorType"],
    ).toBe("$frequency");
  });

  it("existing Filter usage still works", async () => {
    const params = await makeStubWorkspace().buildParams("Login", {
      where: Filter.equals("country", "US"),
    });
    const filt = section(params, "filter");
    expect(filt).toHaveLength(1);
    expect(filt[0]!["value"]).toBe("country");
  });
});

// ===========================================================================
// T032: data_group_id
// ===========================================================================

describe("TestDataGroupIdInsights", () => {
  it('build_params with data_group_id=5 emits globalDataGroupId: "5"', async () => {
    const params = await makeStubWorkspace().buildParams("Login", {
      data_group_id: 5,
    });
    const sections = params["sections"] as Record<string, unknown>;
    expect(sections["globalDataGroupId"]).toBe("5");
    // The old off-contract sections-level spelling must not appear (bug (b)).
    expect(Object.hasOwn(sections, "dataGroupId")).toBe(false);
  });

  it("build_params without data_group_id omits the key", async () => {
    const params = await makeStubWorkspace().buildParams("Login");
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
