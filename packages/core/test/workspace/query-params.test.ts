// `buildQueryParams` core shapes: time range and unit, aggregation math
// and properties, filter and group entries (including list-item forms),
// multi-event show entries and formula clauses. Mirrors the first six
// classes of `tests/unit/test_query_params.py`; `build()` spreads the same
// keyword bag every Python `_build_query_params` call spells.

import { describe, expect, it } from "vitest";

import { Filter } from "../../src/types/query-params/filter.js";
import { GroupBy } from "../../src/types/query-params/group-by.js";
import { Formula, Metric } from "../../src/types/query-params/metric.js";
import {
  behaviorOf,
  build,
  displayOf,
  measurementOf,
  section,
} from "./query-params-fixtures.js";

// ===========================================================================
// T008: basic bookmark params
// ===========================================================================

describe("Basic params", () => {
  // python: TestBasicParams
  it("a single event string produces one show entry", () => {
    const params = build();
    const show = section(params, "show");
    expect(show).toHaveLength(1);
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
    expect(time["value"]).toStrictEqual(["2024-01-01", "2024-01-31"]);
  });

  it("from_date alone still produces a two-element 'between'", () => {
    const params = build({ from_date: "2024-01-01" });
    const time = section(params, "time")[0]!;
    expect(time["dateRangeType"]).toBe("between");
    const value = time["value"] as unknown[];
    expect(value[0]).toBe("2024-01-01");
    expect(value).toHaveLength(2);
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

describe("Aggregation params", () => {
  // python: TestAggregationParams
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

describe("Filter params", () => {
  // python: TestFilterParams
  it("Filter.equals produces the correct filter entry", () => {
    const params = build({ where: [Filter.equals("country", "US")] });
    const f = section(params, "filter")[0]!;
    expect(f["value"]).toBe("country");
    expect(f["filterOperator"]).toBe("equals");
    expect(f["filterValue"]).toStrictEqual(["US"]);
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
    expect(section(params, "filter")).toHaveLength(2);
  });

  it("where=null produces an empty filter section", () => {
    expect(section(build(), "filter")).toStrictEqual([]);
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
    expect(filters).toHaveLength(1);
    const f = filters[0]!;
    expect(f["filterType"]).toBe("object");
    expect(f["filterJoinType"]).toBe("list");
    expect(f["listQuantifier"]).toBe("any");
    expect(f["listItemFilters"] as unknown[]).toHaveLength(2);
  });
});

describe("Group params", () => {
  // python: TestGroupParams
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
    expect(section(params, "group")).toHaveLength(2);
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

describe("Multi event params", () => {
  // python: TestMultiEventParams
  it("a list of strings produces multiple show entries", () => {
    const params = build({
      events: ["Signup", "Login", "Purchase"],
      math: "unique",
    });
    const show = section(params, "show");
    expect(show).toHaveLength(3);
    const events = show.map(
      (e) => (e["behavior"] as Record<string, unknown>)["name"],
    );
    expect(events).toStrictEqual(["Signup", "Login", "Purchase"]);
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

describe("Formula params", () => {
  // python: TestFormulaParams
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
    expect(show).toHaveLength(3);
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
