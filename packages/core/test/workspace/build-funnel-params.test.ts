// Translated build_funnel_params tests (B5-S2, packet §3): assertion-
// for-assertion port of tests/test_build_funnel_params.py — ALL
// 11 classes (TestBuildFunnelParamsDefaults :68,
// TestBuildFunnelParamsConfiguration :169,
// TestBuildFunnelParamsPublicMethod :330,
// TestBuildFunnelParamsPerStepFilters :392,
// TestBuildFunnelParamsGlobalFilterGroupBy :528,
// TestBuildFunnelParamsMixedSteps :587,
// TestBuildFunnelParamsExclusions :644,
// TestBuildFunnelParamsHoldingConstant :725,
// TestBuildFunnelParamsNewMathTypes :800,
// TestBuildFunnelParamsReentryMode :819,
// TestDataGroupIdFunnel :868).
//
// Translation note: `mock_api_client.request.assert_not_called()`
// becomes an empty `insightsCalls` log on the shared stub (the facade's
// only wire path from `build_funnel_params` would be `insights_query`).

import { describe, expect, it } from "vitest";

import { BookmarkValidationError } from "../../src/errors.js";
import { Filter } from "../../src/types/query-params/filter.js";
import {
  Exclusion,
  FunnelStep,
  HoldingConstant,
} from "../../src/types/query-params/funnel.js";
import {
  makeStubWorkspace,
  mockWorkspaceClient,
} from "../../test-support/workspace-test-helpers.js";

/** `result["sections"]["show"][0]["behavior"]`. */
function behaviorOf(result: Record<string, unknown>): Record<string, unknown> {
  const sections = result["sections"] as Record<string, unknown>;
  const show = sections["show"] as Array<Record<string, unknown>>;
  return show[0]!["behavior"] as Record<string, unknown>;
}

/** `behavior["behaviors"]`. */
function behaviorsOf(
  result: Record<string, unknown>,
): Array<Record<string, unknown>> {
  return behaviorOf(result)["behaviors"] as Array<Record<string, unknown>>;
}

/** `result["sections"]["show"][0]["measurement"]`. */
function measurementOf(
  result: Record<string, unknown>,
): Record<string, unknown> {
  const sections = result["sections"] as Record<string, unknown>;
  const show = sections["show"] as Array<Record<string, unknown>>;
  return show[0]!["measurement"] as Record<string, unknown>;
}

/** `result["sections"][name]`. */
function section(result: Record<string, unknown>, name: string): unknown {
  return (result["sections"] as Record<string, unknown>)[name];
}

/** `result["displayOptions"]["chartType"]`. */
function chartTypeOf(result: Record<string, unknown>): unknown {
  return (result["displayOptions"] as Record<string, unknown>)["chartType"];
}

// ===========================================================================
// T018: basic bookmark structure
// ===========================================================================

describe("Build funnel params defaults", () => {
  // python: TestBuildFunnelParamsDefaults
  it("behavior.type is 'funnel'", async () => {
    const result = await makeStubWorkspace().buildFunnelParams([
      "Signup",
      "Purchase",
    ]);
    expect(behaviorOf(result)["type"]).toBe("funnel");
  });

  it("behaviors has one entry per step", async () => {
    const result = await makeStubWorkspace().buildFunnelParams([
      "Signup",
      "Purchase",
    ]);
    expect(behaviorsOf(result)).toHaveLength(2);
  });

  it("behavior names match the step events", async () => {
    const result = await makeStubWorkspace().buildFunnelParams([
      "Signup",
      "Purchase",
    ]);
    const behaviors = behaviorsOf(result);
    expect(behaviors[0]!["name"]).toBe("Signup");
    expect(behaviors[1]!["name"]).toBe("Purchase");
  });

  it("the parent behavior has resourceType='events'", async () => {
    const result = await makeStubWorkspace().buildFunnelParams([
      "Signup",
      "Purchase",
    ]);
    expect(behaviorOf(result)["resourceType"]).toBe("events");
  });

  it("the default conversionWindowDuration is 14", async () => {
    const result = await makeStubWorkspace().buildFunnelParams([
      "Signup",
      "Purchase",
    ]);
    expect(behaviorOf(result)["conversionWindowDuration"]).toBe(14);
  });

  it("the default conversionWindowUnit is 'day'", async () => {
    const result = await makeStubWorkspace().buildFunnelParams([
      "Signup",
      "Purchase",
    ]);
    expect(behaviorOf(result)["conversionWindowUnit"]).toBe("day");
  });

  it("the default funnelOrder is 'loose'", async () => {
    const result = await makeStubWorkspace().buildFunnelParams([
      "Signup",
      "Purchase",
    ]);
    expect(behaviorOf(result)["funnelOrder"]).toBe("loose");
  });

  it("the default measurement.math is 'conversion_rate_unique'", async () => {
    const result = await makeStubWorkspace().buildFunnelParams([
      "Signup",
      "Purchase",
    ]);
    expect(measurementOf(result)["math"]).toBe("conversion_rate_unique");
  });

  it("the default chartType is 'funnel-steps'", async () => {
    const result = await makeStubWorkspace().buildFunnelParams([
      "Signup",
      "Purchase",
    ]);
    expect(chartTypeOf(result)).toBe("funnel-steps");
  });

  it("sections.formula is an empty list", async () => {
    const result = await makeStubWorkspace().buildFunnelParams([
      "Signup",
      "Purchase",
    ]);
    expect(section(result, "formula")).toStrictEqual([]);
  });

  it("sections.time is a list", async () => {
    const result = await makeStubWorkspace().buildFunnelParams([
      "Signup",
      "Purchase",
    ]);
    expect(Array.isArray(section(result, "time"))).toBe(true);
  });

  it("sections.filter is a list", async () => {
    const result = await makeStubWorkspace().buildFunnelParams([
      "Signup",
      "Purchase",
    ]);
    expect(Array.isArray(section(result, "filter"))).toBe(true);
  });

  it("sections.group is a list", async () => {
    const result = await makeStubWorkspace().buildFunnelParams([
      "Signup",
      "Purchase",
    ]);
    expect(Array.isArray(section(result, "group"))).toBe(true);
  });

  it("a three-step funnel produces three behaviors", async () => {
    const result = await makeStubWorkspace().buildFunnelParams([
      "Signup",
      "Add to Cart",
      "Purchase",
    ]);
    const behaviors = behaviorsOf(result);
    expect(behaviors).toHaveLength(3);
    expect(behaviors[0]!["name"]).toBe("Signup");
    expect(behaviors[1]!["name"]).toBe("Add to Cart");
    expect(behaviors[2]!["name"]).toBe("Purchase");
  });

  it("FunnelStep objects are accepted alongside strings", async () => {
    const result = await makeStubWorkspace().buildFunnelParams([
      new FunnelStep({ event: "Signup" }),
      new FunnelStep({ event: "Purchase" }),
    ]);
    const behaviors = behaviorsOf(result);
    expect(behaviors).toHaveLength(2);
    expect(behaviors[0]!["name"]).toBe("Signup");
    expect(behaviors[1]!["name"]).toBe("Purchase");
  });
});

// ===========================================================================
// T019: configuration options
// ===========================================================================

describe("Build funnel params configuration", () => {
  // python: TestBuildFunnelParamsConfiguration
  it("a custom conversion_window is applied", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(
      ["Signup", "Purchase"],
      {
        conversion_window: 7,
        conversion_window_unit: "day",
      },
    );
    const behavior = behaviorOf(result);
    expect(behavior["conversionWindowDuration"]).toBe(7);
    expect(behavior["conversionWindowUnit"]).toBe("day");
  });

  it("conversion_window_unit='hour' is applied", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(
      ["Signup", "Purchase"],
      {
        conversion_window: 2,
        conversion_window_unit: "hour",
      },
    );
    const behavior = behaviorOf(result);
    expect(behavior["conversionWindowDuration"]).toBe(2);
    expect(behavior["conversionWindowUnit"]).toBe("hour");
  });

  it("order='any' sets funnelOrder='any'", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(
      ["Signup", "Purchase"],
      {
        order: "any",
      },
    );
    expect(behaviorOf(result)["funnelOrder"]).toBe("any");
  });

  it("a per-step order override sets funnelOrder on that entry", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(
      [
        new FunnelStep({ event: "Signup" }),
        new FunnelStep({ event: "Browse" }),
        new FunnelStep({ event: "Purchase", order: "any" }),
      ],
      { order: "loose" },
    );
    const behaviors = behaviorsOf(result);
    expect(behaviors[0]!["funnelOrder"]).toBe("loose");
    expect(behaviors[1]!["funnelOrder"]).toBe("loose");
    expect(behaviors[2]!["funnelOrder"]).toBe("any");
  });

  it("from_date/to_date produce a 'between' time section", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(
      ["Signup", "Purchase"],
      {
        from_date: "2025-01-01",
        to_date: "2025-03-31",
      },
    );
    const time = section(result, "time") as Array<Record<string, unknown>>;
    expect(time.length).toBeGreaterThan(0);
    expect(time[0]!["dateRangeType"]).toBe("between");
    expect(time[0]!["value"]).toStrictEqual(["2025-01-01", "2025-03-31"]);
  });

  it("last=90 produces a window-based time section", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(
      ["Signup", "Purchase"],
      {
        last: 90,
      },
    );
    const time = section(result, "time") as Array<Record<string, unknown>>;
    expect(time.length).toBeGreaterThan(0);
    expect(time[0]!["dateRangeType"]).toBe("in the last");
    const window = time[0]!["window"] as Record<string, unknown>;
    expect(window["value"]).toBe(90);
    expect(window["unit"]).toBe("day");
  });

  it("math='unique' sets measurement.math", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(
      ["Signup", "Purchase"],
      {
        math: "unique",
      },
    );
    expect(measurementOf(result)["math"]).toBe("unique");
  });

  it("measurement.property is null when math_property is absent", async () => {
    const result = await makeStubWorkspace().buildFunnelParams([
      "Signup",
      "Purchase",
    ]);
    expect(measurementOf(result)["property"]).toBeNull();
  });

  it("math_property populates measurement.property", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(
      ["Signup", "Purchase"],
      {
        math: "average",
        math_property: "amount",
      },
    );
    expect(measurementOf(result)["property"]).toStrictEqual({
      name: "amount",
      type: "number",
      resourceType: "events",
    });
  });

  it("math_property works with median", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(
      ["Signup", "Purchase"],
      {
        math: "median",
        math_property: "duration",
      },
    );
    const measurement = measurementOf(result);
    expect(measurement["math"]).toBe("median");
    expect((measurement["property"] as Record<string, unknown>)["name"]).toBe(
      "duration",
    );
  });

  it("mode='steps' produces chartType='funnel-steps'", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(
      ["Signup", "Purchase"],
      {
        mode: "steps",
      },
    );
    expect(chartTypeOf(result)).toBe("funnel-steps");
  });

  it("mode='trends' produces chartType='line'", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(
      ["Signup", "Purchase"],
      {
        mode: "trends",
      },
    );
    expect(chartTypeOf(result)).toBe("line");
  });

  it("mode='table' produces chartType='table'", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(
      ["Signup", "Purchase"],
      {
        mode: "table",
      },
    );
    expect(chartTypeOf(result)).toBe("table");
  });

  it("multiple configuration options work together", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(
      ["Signup", "Add to Cart", "Checkout", "Purchase"],
      {
        conversion_window: 7,
        conversion_window_unit: "day",
        order: "any",
        math: "unique",
        last: 90,
        mode: "trends",
      },
    );
    const behavior = behaviorOf(result);
    expect(behavior["conversionWindowDuration"]).toBe(7);
    expect(behavior["conversionWindowUnit"]).toBe("day");
    expect(behavior["funnelOrder"]).toBe("any");
    expect(measurementOf(result)["math"]).toBe("unique");
    expect(chartTypeOf(result)).toBe("line");
    const time = section(result, "time") as Array<Record<string, unknown>>;
    expect((time[0]!["window"] as Record<string, unknown>)["value"]).toBe(90);
  });
});

// ===========================================================================
// T023: public method surface
// ===========================================================================

describe("Build funnel params public method", () => {
  // python: TestBuildFunnelParamsPublicMethod
  it("returns a dict", async () => {
    const result = await makeStubWorkspace().buildFunnelParams([
      "Signup",
      "Purchase",
    ]);
    expect(typeof result).toBe("object");
  });

  it("has a 'sections' key", async () => {
    const result = await makeStubWorkspace().buildFunnelParams([
      "Signup",
      "Purchase",
    ]);
    expect(Object.hasOwn(result, "sections")).toBe(true);
  });

  it("has a 'displayOptions' key", async () => {
    const result = await makeStubWorkspace().buildFunnelParams([
      "Signup",
      "Purchase",
    ]);
    expect(Object.hasOwn(result, "displayOptions")).toBe(true);
  });

  it("makes no API call", async () => {
    const mock = mockWorkspaceClient();
    await makeStubWorkspace(mock).buildFunnelParams(["Signup", "Purchase"]);
    expect(mock.insightsCalls).toHaveLength(0);
  });

  it("a single-step funnel raises BookmarkValidationError", async () => {
    await expect(
      makeStubWorkspace().buildFunnelParams(["OnlyOneStep"]),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
  });

  it("an empty steps list raises BookmarkValidationError", async () => {
    await expect(
      makeStubWorkspace().buildFunnelParams([]),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
  });

  it("sections contains show, time, filter, group and formula", async () => {
    const result = await makeStubWorkspace().buildFunnelParams([
      "Signup",
      "Purchase",
    ]);
    const sections = result["sections"] as Record<string, unknown>;
    for (const key of ["show", "time", "filter", "group", "formula"]) {
      expect(Object.hasOwn(sections, key)).toBe(true);
    }
  });

  it("sections.show contains exactly one entry", async () => {
    const result = await makeStubWorkspace().buildFunnelParams([
      "Signup",
      "Purchase",
    ]);
    expect(section(result, "show") as unknown[]).toHaveLength(1);
  });

  it("the show entry has behavior and measurement keys", async () => {
    const result = await makeStubWorkspace().buildFunnelParams([
      "Signup",
      "Purchase",
    ]);
    const show = section(result, "show") as Array<Record<string, unknown>>;
    expect(Object.hasOwn(show[0]!, "behavior")).toBe(true);
    expect(Object.hasOwn(show[0]!, "measurement")).toBe(true);
  });
});

// ===========================================================================
// T031: per-step filters and labels
// ===========================================================================

describe("Build funnel params per step filters", () => {
  // python: TestBuildFunnelParamsPerStepFilters
  /** The two-step list most cases in this class share. */
  function filteredSteps(): Array<string | FunnelStep> {
    return [
      new FunnelStep({ event: "Signup" }),
      new FunnelStep({
        event: "Purchase",
        filters: [Filter.greaterThan("amount", 50)],
      }),
    ];
  }

  it("a step with no filters produces an empty filters list", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(filteredSteps());
    expect(behaviorsOf(result)[0]!["filters"]).toStrictEqual([]);
  });

  it("a step with a filter produces a non-empty filters list", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(filteredSteps());
    expect(
      (behaviorsOf(result)[1]!["filters"] as unknown[]).length,
    ).toBeGreaterThan(0);
  });

  it("the filter entry has value='amount'", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(filteredSteps());
    const filters = behaviorsOf(result)[1]!["filters"] as Array<
      Record<string, unknown>
    >;
    expect(filters[0]!["value"]).toBe("amount");
  });

  it("the filter entry has the correct filterOperator", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(filteredSteps());
    const filters = behaviorsOf(result)[1]!["filters"] as Array<
      Record<string, unknown>
    >;
    expect(filters[0]!["filterOperator"]).toBe("is greater than");
  });

  it("the default filtersDeterminer is 'all'", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(filteredSteps());
    expect(behaviorsOf(result)[1]!["filtersDeterminer"]).toBe("all");
  });

  it("filters_combinator='any' sets filtersDeterminer='any'", async () => {
    const result = await makeStubWorkspace().buildFunnelParams([
      new FunnelStep({ event: "Signup" }),
      new FunnelStep({
        event: "Purchase",
        filters: [Filter.greaterThan("amount", 50)],
        filters_combinator: "any",
      }),
    ]);
    expect(behaviorsOf(result)[1]!["filtersDeterminer"]).toBe("any");
  });

  it("FunnelStep.label appears as 'renamed'", async () => {
    const result = await makeStubWorkspace().buildFunnelParams([
      new FunnelStep({ event: "Signup" }),
      new FunnelStep({ event: "Purchase", label: "High-Value Purchase" }),
    ]);
    expect(behaviorsOf(result)[1]!["renamed"]).toBe("High-Value Purchase");
  });

  it("a step without a label has no 'renamed' key", async () => {
    const result = await makeStubWorkspace().buildFunnelParams([
      new FunnelStep({ event: "Signup" }),
      new FunnelStep({ event: "Purchase" }),
    ]);
    expect(Object.hasOwn(behaviorsOf(result)[0]!, "renamed")).toBe(false);
  });

  it("filters=[] matches filters=null", async () => {
    const resultEmpty = await makeStubWorkspace().buildFunnelParams([
      new FunnelStep({ event: "Signup", filters: [] }),
      new FunnelStep({ event: "Purchase", filters: [] }),
    ]);
    const resultNone = await makeStubWorkspace().buildFunnelParams([
      new FunnelStep({ event: "Signup", filters: null }),
      new FunnelStep({ event: "Purchase", filters: null }),
    ]);
    const behaviorsEmpty = behaviorsOf(resultEmpty);
    const behaviorsNone = behaviorsOf(resultNone);
    expect(behaviorsEmpty[0]!["filters"]).toStrictEqual(
      behaviorsNone[0]!["filters"],
    );
    expect(behaviorsEmpty[1]!["filters"]).toStrictEqual(
      behaviorsNone[1]!["filters"],
    );
  });
});

// ===========================================================================
// T032: global filter and group-by
// ===========================================================================

describe("Build funnel params global filter group by", () => {
  // python: TestBuildFunnelParamsGlobalFilterGroupBy
  it("a where filter populates sections.filter", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(
      ["Signup", "Purchase"],
      {
        where: [Filter.equals("country", "US")],
      },
    );
    expect((section(result, "filter") as unknown[]).length).toBeGreaterThan(0);
  });

  it("group_by populates sections.group", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(
      ["Signup", "Purchase"],
      {
        group_by: "platform",
      },
    );
    expect((section(result, "group") as unknown[]).length).toBeGreaterThan(0);
  });

  it("where and group_by work together", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(
      ["Signup", "Purchase"],
      {
        where: [Filter.equals("country", "US")],
        group_by: "platform",
      },
    );
    expect((section(result, "filter") as unknown[]).length).toBeGreaterThan(0);
    expect((section(result, "group") as unknown[]).length).toBeGreaterThan(0);
  });

  it("the filter entry references the correct property", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(
      ["Signup", "Purchase"],
      {
        where: [Filter.equals("country", "US")],
      },
    );
    const filters = section(result, "filter") as Array<Record<string, unknown>>;
    expect(filters[0]!["value"]).toBe("country");
  });

  it("the group entry references the correct property", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(
      ["Signup", "Purchase"],
      {
        group_by: "platform",
      },
    );
    const groups = section(result, "group") as Array<Record<string, unknown>>;
    expect(groups[0]!["value"]).toBe("platform");
  });
});

// ===========================================================================
// T033: mixed steps
// ===========================================================================

describe("Build funnel params mixed steps", () => {
  // python: TestBuildFunnelParamsMixedSteps
  /** The mixed list the first three cases share. */
  function mixedSteps(): Array<string | FunnelStep> {
    return [
      "Signup",
      new FunnelStep({
        event: "Purchase",
        filters: [Filter.greaterThan("amount", 50)],
      }),
    ];
  }

  it("a mixed list produces the right number of behaviors", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(mixedSteps());
    expect(behaviorsOf(result)).toHaveLength(2);
  });

  it("the string step has empty filters", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(mixedSteps());
    expect(behaviorsOf(result)[0]!["filters"]).toStrictEqual([]);
  });

  it("the FunnelStep with filters has non-empty filters", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(mixedSteps());
    expect(
      (behaviorsOf(result)[1]!["filters"] as unknown[]).length,
    ).toBeGreaterThan(0);
  });

  it("filters=[] matches filters=null for a mixed list", async () => {
    const resultEmpty = await makeStubWorkspace().buildFunnelParams([
      "Signup",
      new FunnelStep({ event: "Purchase", filters: [] }),
    ]);
    const resultNone = await makeStubWorkspace().buildFunnelParams([
      "Signup",
      new FunnelStep({ event: "Purchase", filters: null }),
    ]);
    expect(behaviorsOf(resultEmpty)[1]!["filters"]).toStrictEqual(
      behaviorsOf(resultNone)[1]!["filters"],
    );
  });
});

// ===========================================================================
// T038: exclusions
// ===========================================================================

describe("Build funnel params exclusions", () => {
  // python: TestBuildFunnelParamsExclusions
  it("a string exclusion produces a non-empty exclusions list", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(
      ["A", "B", "C"],
      {
        exclusions: ["Logout"],
      },
    );
    expect(
      (behaviorOf(result)["exclusions"] as unknown[]).length,
    ).toBeGreaterThan(0);
  });

  it("the string exclusion entry has event='Logout'", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(
      ["A", "B", "C"],
      {
        exclusions: ["Logout"],
      },
    );
    const exclusions = behaviorOf(result)["exclusions"] as Array<
      Record<string, unknown>
    >;
    expect(exclusions[0]!["event"]).toBe("Logout");
  });

  it("the parent behavior keeps resourceType='events'", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(
      ["A", "B", "C"],
      {
        exclusions: ["Logout"],
      },
    );
    expect(behaviorOf(result)["resourceType"]).toBe("events");
  });

  it("a string exclusion covers all steps (1-indexed)", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(
      ["A", "B", "C"],
      {
        exclusions: ["Logout"],
      },
    );
    const exclusions = behaviorOf(result)["exclusions"] as Array<
      Record<string, unknown>
    >;
    const steps = exclusions[0]!["steps"] as Record<string, unknown>;
    expect(steps["from"]).toBe(1);
    expect(steps["to"]).toBe(3);
  });

  it("an Exclusion with a step range is 1-indexed", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(
      ["A", "B", "C"],
      {
        exclusions: [
          new Exclusion({ event: "Refund", from_step: 1, to_step: 2 }),
        ],
      },
    );
    const exclusions = behaviorOf(result)["exclusions"] as Array<
      Record<string, unknown>
    >;
    const steps = exclusions[0]!["steps"] as Record<string, unknown>;
    expect(steps["from"]).toBe(2);
    expect(steps["to"]).toBe(3);
  });

  it("an Exclusion with no range covers all steps", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(
      ["A", "B", "C", "D"],
      {
        exclusions: [new Exclusion({ event: "Cancel" })],
      },
    );
    const exclusions = behaviorOf(result)["exclusions"] as Array<
      Record<string, unknown>
    >;
    const steps = exclusions[0]!["steps"] as Record<string, unknown>;
    expect(steps["from"]).toBe(1);
    expect(steps["to"]).toBe(4);
  });

  it("no exclusions produce an empty list", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(["A", "B"]);
    expect(behaviorOf(result)["exclusions"]).toStrictEqual([]);
  });
});

// ===========================================================================
// T039: holding constant
// ===========================================================================

describe("Build funnel params holding constant", () => {
  // python: TestBuildFunnelParamsHoldingConstant
  it("a string holding_constant produces a non-empty aggregateBy", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(["A", "B"], {
      holding_constant: "platform",
    });
    expect(
      (behaviorOf(result)["aggregateBy"] as unknown[]).length,
    ).toBeGreaterThan(0);
  });

  it("the string entry has value='platform'", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(["A", "B"], {
      holding_constant: "platform",
    });
    const agg = behaviorOf(result)["aggregateBy"] as Array<
      Record<string, unknown>
    >;
    expect(agg[0]!["value"]).toBe("platform");
  });

  it("the string entry defaults to resourceType='events'", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(["A", "B"], {
      holding_constant: "platform",
    });
    const agg = behaviorOf(result)["aggregateBy"] as Array<
      Record<string, unknown>
    >;
    expect(agg[0]!["resourceType"]).toBe("events");
  });

  it("HoldingConstant with resource_type='people' is honoured", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(["A", "B"], {
      holding_constant: new HoldingConstant({
        property: "plan_tier",
        resource_type: "people",
      }),
    });
    const agg = behaviorOf(result)["aggregateBy"] as Array<
      Record<string, unknown>
    >;
    expect(agg[0]!["resourceType"]).toBe("people");
  });

  it("a list of holding constants produces multiple entries", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(["A", "B"], {
      holding_constant: [
        new HoldingConstant({ property: "platform" }),
        new HoldingConstant({
          property: "plan_tier",
          resource_type: "people",
        }),
      ],
    });
    const agg = behaviorOf(result)["aggregateBy"] as Array<
      Record<string, unknown>
    >;
    expect(agg).toHaveLength(2);
    expect(agg[0]!["value"]).toBe("platform");
    expect(agg[1]!["value"]).toBe("plan_tier");
  });

  it("no holding_constant produces an empty aggregateBy", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(["A", "B"]);
    expect(behaviorOf(result)["aggregateBy"]).toStrictEqual([]);
  });
});

// ===========================================================================
// T005: new funnel math types
// ===========================================================================

describe("Build funnel params new math types", () => {
  // python: TestBuildFunnelParamsNewMathTypes
  it("math='histogram' is accepted", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(
      ["Signup", "Purchase"],
      {
        math: "histogram",
        math_property: "amount",
      },
    );
    const measurement = measurementOf(result);
    expect(measurement["math"]).toBe("histogram");
    expect((measurement["property"] as Record<string, unknown>)["name"]).toBe(
      "amount",
    );
  });
});

// ===========================================================================
// T009: reentry_mode
// ===========================================================================

describe("Build funnel params reentry mode", () => {
  // python: TestBuildFunnelParamsReentryMode
  for (const mode of ["aggressive", "default", "basic", "optimized"]) {
    it(`reentry_mode='${mode}' produces funnelReentryMode`, async () => {
      const result = await makeStubWorkspace().buildFunnelParams(
        ["Signup", "Purchase"],
        {
          reentry_mode: mode,
        },
      );
      expect(behaviorOf(result)["funnelReentryMode"]).toBe(mode);
    });
  }

  it("omitting reentry_mode omits the key", async () => {
    const result = await makeStubWorkspace().buildFunnelParams([
      "Signup",
      "Purchase",
    ]);
    expect(Object.hasOwn(behaviorOf(result), "funnelReentryMode")).toBe(false);
  });
});

// ===========================================================================
// T032: data_group_id
// ===========================================================================

describe("Data group ID funnel", () => {
  // python: TestDataGroupIdFunnel
  it('data_group_id=5 includes globalDataGroupId: "5" in sections', async () => {
    const result = await makeStubWorkspace().buildFunnelParams(
      ["Signup", "Purchase"],
      {
        data_group_id: 5,
      },
    );
    expect(section(result, "globalDataGroupId")).toBe("5");
    const sections = result["sections"] as Record<string, unknown>;
    expect(Object.hasOwn(sections, "dataGroupId")).toBe(false);
  });

  it("omitting data_group_id omits the key", async () => {
    const result = await makeStubWorkspace().buildFunnelParams([
      "Signup",
      "Purchase",
    ]);
    const sections = result["sections"] as Record<string, unknown>;
    expect(Object.hasOwn(sections, "globalDataGroupId")).toBe(false);
    expect(Object.hasOwn(sections, "dataGroupId")).toBe(false);
  });
});
