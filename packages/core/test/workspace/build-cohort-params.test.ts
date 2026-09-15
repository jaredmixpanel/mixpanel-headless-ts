// Translated cohort-params tests (B5-S2, packet §3): assertion-for-
// assertion port of tests/test_build_cohort_params.py — ALL 17
// classes (TestBuildFilterEntryCohort :94, TestBuildFilterSectionMixed
// :171, TestBuildFlowCohortFilter :206, TestBuildGroupSectionCohort
// :255, TestBuildGroupSectionMixed :344, TestBuildParamsCohortFilter
// :375, TestBuildFunnelParamsCohortFilter :399,
// TestBuildRetentionParamsCohortFilter :426,
// TestBuildParamsCohortBreakdown :455,
// TestBuildFunnelParamsCohortBreakdown :481,
// TestBuildRetentionParamsCohortBreakdown :507,
// TestBuildParamsCohortMetric :546, TestBuildParamsCohortMetricMixed
// :621, TestBuildParamsCohortMetricMathIgnored :663,
// TestQueryFlowCohortFilter :791, TestBuildFlowCohortFilterDirect :841,
// TestCodedFlowCohortFilterCodes :927).
//
// Per the packet: the builder-DIRECT classes (:94-:344, :841-:927)
// assert B3 functions THROUGH the facade path and stay facade-driven
// here; B3-K2's corpus-mirror describe block is additive, never a
// substitute (`B3-K2-notes.md:125-128`). The two classes that call
// `build_flow_cohort_filter` directly keep doing so (they exercise
// guards unreachable through the facade).
//
// Translation note: `pytest.raises(ValueError, …)` names Python's
// dual-inheriting `ParamValidationError`; the TS twin carries the same
// message and `.code`.

import { describe, expect, it } from "vitest";

import { buildFlowCohortFilter } from "../../src/bookmarks/builders.js";
import {
  BookmarkValidationError,
  ParamValidationError,
} from "../../src/errors.js";
import {
  CohortBreakdown,
  CohortCriteria,
  CohortDefinition,
} from "../../src/types/query-params/cohort.js";
import { Filter } from "../../src/types/query-params/filter.js";
import { GroupBy } from "../../src/types/query-params/group-by.js";
import {
  CohortMetric,
  Formula,
  Metric,
} from "../../src/types/query-params/metric.js";
import { expectRejects, expectThrows } from "../../test-support/raises.js";
import { makeStubWorkspace } from "../../test-support/workspace-test-helpers.js";

/** `_simple_cohort_def()` (test file :78-87). */
function simpleCohortDef(): CohortDefinition {
  return new CohortDefinition(
    CohortCriteria.didEvent("Purchase", { at_least: 1, within_days: 30 }),
  );
}

/** `result["sections"][name]` as an array of records. */
function section(
  result: Record<string, unknown>,
  name: string,
): Array<Record<string, unknown>> {
  const sections = result["sections"] as Record<string, unknown>;
  return sections[name] as Array<Record<string, unknown>>;
}

/** The first `sections.filter` entry. */
function filterEntry(result: Record<string, unknown>): Record<string, unknown> {
  return section(result, "filter")[0]!;
}

/** `result["sections"]["show"][0]["behavior"]`. */
function behaviorOf(result: Record<string, unknown>): Record<string, unknown> {
  return section(result, "show")[0]!["behavior"] as Record<string, unknown>;
}

/** `result["sections"]["show"][0]["measurement"]`. */
function measurementOf(
  result: Record<string, unknown>,
): Record<string, unknown> {
  return section(result, "show")[0]!["measurement"] as Record<string, unknown>;
}

/**
 * Build a cohort filter with a deliberately malformed `_value`
 * (`_malformed_cohort_filter`, test file :902-918).
 *
 * @param value - The raw `_value` payload to install.
 * @returns A directly-constructed `$cohorts` filter.
 */
function malformedCohortFilter(value: unknown): Filter {
  return new Filter({
    _property: "$cohorts",
    _operator: "contains",
    _value: value as never,
    _property_type: "list",
    _resource_type: "events",
  });
}

// ===========================================================================
// T003: build_filter_entry — cohort filter JSON
// ===========================================================================

describe("Build filter entry cohort", () => {
  // python: TestBuildFilterEntryCohort
  it("the filter entry has resourceType='events'", async () => {
    const result = await makeStubWorkspace().buildParams("Login", {
      where: Filter.inCohort(123, "Power Users"),
    });
    expect(filterEntry(result)["resourceType"]).toBe("events");
  });

  it("the filter entry has filterType='list'", async () => {
    const result = await makeStubWorkspace().buildParams("Login", {
      where: Filter.inCohort(123, "Power Users"),
    });
    expect(filterEntry(result)["filterType"]).toBe("list");
  });

  it("the filter entry has value='$cohorts'", async () => {
    const result = await makeStubWorkspace().buildParams("Login", {
      where: Filter.inCohort(123, "PU"),
    });
    expect(filterEntry(result)["value"]).toBe("$cohorts");
  });

  it("in_cohort produces filterOperator='contains'", async () => {
    const result = await makeStubWorkspace().buildParams("Login", {
      where: Filter.inCohort(123, "PU"),
    });
    expect(filterEntry(result)["filterOperator"]).toBe("contains");
  });

  it("filterValue carries the cohort id and name", async () => {
    const result = await makeStubWorkspace().buildParams("Login", {
      where: Filter.inCohort(123, "Power Users"),
    });
    const fv = filterEntry(result)["filterValue"] as Array<
      Record<string, unknown>
    >;
    expect(Array.isArray(fv)).toBe(true);
    expect(fv).toHaveLength(1);
    const cohort = fv[0]!["cohort"] as Record<string, unknown>;
    expect(cohort["id"]).toBe(123);
    expect(cohort["name"]).toBe("Power Users");
    expect(cohort["negated"]).toBe(false);
  });

  it("an inline CohortDefinition produces raw_cohort in filterValue", async () => {
    const result = await makeStubWorkspace().buildParams("Login", {
      where: Filter.inCohort(simpleCohortDef(), "Buyers"),
    });
    const fv = filterEntry(result)["filterValue"] as Array<
      Record<string, unknown>
    >;
    const cohort = fv[0]!["cohort"] as Record<string, unknown>;
    expect(Object.hasOwn(cohort, "raw_cohort")).toBe(true);
    expect(Object.hasOwn(cohort, "id")).toBe(false);
    expect(cohort["name"]).toBe("Buyers");
  });

  it("not_in_cohort produces filterOperator='does not contain'", async () => {
    const result = await makeStubWorkspace().buildParams("Login", {
      where: Filter.notInCohort(789, "Bots"),
    });
    expect(filterEntry(result)["filterOperator"]).toBe("does not contain");
  });

  it("not_in_cohort sets negated=true in filterValue", async () => {
    const result = await makeStubWorkspace().buildParams("Login", {
      where: Filter.notInCohort(789, "Bots"),
    });
    const fv = filterEntry(result)["filterValue"] as Array<
      Record<string, unknown>
    >;
    const cohort = fv[0]!["cohort"] as Record<string, unknown>;
    expect(cohort["negated"]).toBe(true);
  });
});

// ===========================================================================
// T005: mixed cohort + property filters
// ===========================================================================

describe("Build filter section mixed", () => {
  // python: TestBuildFilterSectionMixed
  it("a mix produces two filter entries", async () => {
    const result = await makeStubWorkspace().buildParams("Login", {
      where: [Filter.inCohort(123, "PU"), Filter.equals("country", "US")],
    });
    expect(section(result, "filter")).toHaveLength(2);
  });

  it("both the cohort and property filters appear", async () => {
    const result = await makeStubWorkspace().buildParams("Login", {
      where: [Filter.inCohort(123, "PU"), Filter.equals("country", "US")],
    });
    const values = section(result, "filter").map((e) => e["value"]);
    expect(values).toContain("$cohorts");
    expect(values).toContain("country");
  });
});

// ===========================================================================
// T006: flow cohort filter (filter_by_cohort)
// ===========================================================================

describe("Build flow cohort filter", () => {
  // python: TestBuildFlowCohortFilter
  it("build_flow_params produces a filter_by_cohort key", async () => {
    const result = await makeStubWorkspace().buildFlowParams("Login", {
      where: Filter.inCohort(123, "Power Users"),
    });
    expect(Object.hasOwn(result, "filter_by_cohort")).toBe(true);
  });

  it("filter_by_cohort has the correct id", async () => {
    const result = await makeStubWorkspace().buildFlowParams("Login", {
      where: Filter.inCohort(123, "Power Users"),
    });
    expect((result["filter_by_cohort"] as Record<string, unknown>)["id"]).toBe(
      123,
    );
  });

  it("filter_by_cohort has the correct name", async () => {
    const result = await makeStubWorkspace().buildFlowParams("Login", {
      where: Filter.inCohort(123, "Power Users"),
    });
    expect(
      (result["filter_by_cohort"] as Record<string, unknown>)["name"],
    ).toBe("Power Users");
  });

  it("filter_by_cohort has negated=false for in_cohort", async () => {
    const result = await makeStubWorkspace().buildFlowParams("Login", {
      where: Filter.inCohort(123, "PU"),
    });
    expect(
      (result["filter_by_cohort"] as Record<string, unknown>)["negated"],
    ).toBe(false);
  });

  it("a property filter produces filter_by_event", async () => {
    const result = await makeStubWorkspace().buildFlowParams("Login", {
      where: Filter.equals("country", "US"),
    });
    expect(Object.hasOwn(result, "filter_by_event")).toBe(true);
    const fbe = result["filter_by_event"] as Record<string, unknown>;
    expect(fbe["operator"]).toBe("and");
    expect(fbe["children"] as unknown[]).toHaveLength(1);
  });
});

// ===========================================================================
// T020: CohortBreakdown in sections.group
// ===========================================================================

describe("Build group section cohort", () => {
  // python: TestBuildGroupSectionCohort
  it("produces a non-empty sections.group", async () => {
    const result = await makeStubWorkspace().buildParams("Login", {
      group_by: new CohortBreakdown({ cohort: 123, name: "Power Users" }),
    });
    expect(section(result, "group").length).toBeGreaterThan(0);
  });

  it("the group entry has a 'cohorts' key", async () => {
    const result = await makeStubWorkspace().buildParams("Login", {
      group_by: new CohortBreakdown({ cohort: 123, name: "Power Users" }),
    });
    expect(Object.hasOwn(section(result, "group")[0]!, "cohorts")).toBe(true);
  });

  it("include_negated=true produces two cohort entries", async () => {
    const result = await makeStubWorkspace().buildParams("Login", {
      group_by: new CohortBreakdown({
        cohort: 123,
        name: "Power Users",
        include_negated: true,
      }),
    });
    const cohorts = section(result, "group")[0]!["cohorts"] as Array<
      Record<string, unknown>
    >;
    expect(cohorts).toHaveLength(2);
    expect(cohorts[0]!["negated"]).toBe(false);
    expect(cohorts[1]!["negated"]).toBe(true);
  });

  it("include_negated=false produces one cohort entry", async () => {
    const result = await makeStubWorkspace().buildParams("Login", {
      group_by: new CohortBreakdown({
        cohort: 123,
        name: "Power Users",
        include_negated: false,
      }),
    });
    const cohorts = section(result, "group")[0]!["cohorts"] as Array<
      Record<string, unknown>
    >;
    expect(cohorts).toHaveLength(1);
    expect(cohorts[0]!["negated"]).toBe(false);
  });

  it("the group entry 'value' contains the cohort names", async () => {
    const result = await makeStubWorkspace().buildParams("Login", {
      group_by: new CohortBreakdown({
        cohort: 123,
        name: "Power Users",
        include_negated: true,
      }),
    });
    const value = section(result, "group")[0]!["value"] as unknown[];
    expect(Array.isArray(value)).toBe(true);
    expect(value).toContain("Power Users");
  });

  it("an inline CohortDefinition uses raw_cohort", async () => {
    const result = await makeStubWorkspace().buildParams("Login", {
      group_by: new CohortBreakdown({
        cohort: simpleCohortDef(),
        name: "Active",
      }),
    });
    const cohorts = section(result, "group")[0]!["cohorts"] as Array<
      Record<string, unknown>
    >;
    expect(Object.hasOwn(cohorts[0]!, "raw_cohort")).toBe(true);
  });

  it("the group entry has resourceType='events'", async () => {
    const result = await makeStubWorkspace().buildParams("Login", {
      group_by: new CohortBreakdown({ cohort: 123, name: "PU" }),
    });
    expect(section(result, "group")[0]!["resourceType"]).toBe("events");
  });
});

// ===========================================================================
// T021: mixed CohortBreakdown + GroupBy/str
// ===========================================================================

describe("Build group section mixed", () => {
  // python: TestBuildGroupSectionMixed
  it("a CohortBreakdown plus a string produces two group entries", async () => {
    const result = await makeStubWorkspace().buildParams("Login", {
      group_by: [new CohortBreakdown({ cohort: 123, name: "PU" }), "country"],
    });
    expect(section(result, "group")).toHaveLength(2);
  });

  it("a CohortBreakdown plus a GroupBy produces two group entries", async () => {
    const result = await makeStubWorkspace().buildParams("Login", {
      group_by: [
        new CohortBreakdown({ cohort: 123, name: "PU" }),
        new GroupBy({ property: "platform" }),
      ],
    });
    expect(section(result, "group")).toHaveLength(2);
  });
});

// ===========================================================================
// T009-T011: cohort filters across the three engines
// ===========================================================================

describe("Build params cohort filter", () => {
  // python: TestBuildParamsCohortFilter
  it("a cohort filter populates sections.filter", async () => {
    const result = await makeStubWorkspace().buildParams("Login", {
      where: Filter.inCohort(123, "PU"),
    });
    expect(section(result, "filter").length).toBeGreaterThan(0);
  });

  it("the filter entry targets $cohorts", async () => {
    const result = await makeStubWorkspace().buildParams("Login", {
      where: Filter.inCohort(123, "PU"),
    });
    expect(filterEntry(result)["value"]).toBe("$cohorts");
  });
});

describe("Build funnel params cohort filter", () => {
  // python: TestBuildFunnelParamsCohortFilter
  it("a cohort filter populates funnel sections.filter", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(
      ["Signup", "Purchase"],
      {
        where: Filter.inCohort(123, "PU"),
      },
    );
    expect(section(result, "filter").length).toBeGreaterThan(0);
  });

  it("the funnel filter entry targets $cohorts", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(
      ["Signup", "Purchase"],
      {
        where: Filter.inCohort(123, "PU"),
      },
    );
    expect(filterEntry(result)["value"]).toBe("$cohorts");
  });
});

describe("Build retention params cohort filter", () => {
  // python: TestBuildRetentionParamsCohortFilter
  it("a cohort filter populates retention sections.filter", async () => {
    const result = await makeStubWorkspace().buildRetentionParams(
      "Signup",
      "Login",
      {
        where: Filter.inCohort(123, "PU"),
      },
    );
    expect(section(result, "filter").length).toBeGreaterThan(0);
  });

  it("the retention filter entry targets $cohorts", async () => {
    const result = await makeStubWorkspace().buildRetentionParams(
      "Signup",
      "Login",
      {
        where: Filter.inCohort(123, "PU"),
      },
    );
    expect(filterEntry(result)["value"]).toBe("$cohorts");
  });
});

// ===========================================================================
// T024-T026: CohortBreakdown across the three engines
// ===========================================================================

describe("Build params cohort breakdown", () => {
  // python: TestBuildParamsCohortBreakdown
  it("a CohortBreakdown appears in sections.group", async () => {
    const result = await makeStubWorkspace().buildParams("Login", {
      group_by: new CohortBreakdown({ cohort: 123, name: "PU" }),
    });
    expect(section(result, "group").length).toBeGreaterThan(0);
  });

  it("the group entry has a cohorts key", async () => {
    const result = await makeStubWorkspace().buildParams("Login", {
      group_by: new CohortBreakdown({ cohort: 123, name: "PU" }),
    });
    expect(Object.hasOwn(section(result, "group")[0]!, "cohorts")).toBe(true);
  });
});

describe("Build funnel params cohort breakdown", () => {
  // python: TestBuildFunnelParamsCohortBreakdown
  it("a CohortBreakdown appears in funnel sections.group", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(
      ["Signup", "Purchase"],
      {
        group_by: new CohortBreakdown({ cohort: 123, name: "PU" }),
      },
    );
    expect(section(result, "group").length).toBeGreaterThan(0);
  });

  it("the funnel group entry has a cohorts key", async () => {
    const result = await makeStubWorkspace().buildFunnelParams(
      ["Signup", "Purchase"],
      {
        group_by: new CohortBreakdown({ cohort: 123, name: "PU" }),
      },
    );
    expect(Object.hasOwn(section(result, "group")[0]!, "cohorts")).toBe(true);
  });
});

describe("Build retention params cohort breakdown", () => {
  // python: TestBuildRetentionParamsCohortBreakdown
  it("a CohortBreakdown alone works in retention group_by", async () => {
    const result = await makeStubWorkspace().buildRetentionParams(
      "Signup",
      "Login",
      {
        group_by: new CohortBreakdown({ cohort: 123, name: "PU" }),
      },
    );
    expect(section(result, "group").length).toBeGreaterThan(0);
  });

  it("CB3: mixing with a GroupBy in retention raises", async () => {
    await expect(
      makeStubWorkspace().buildRetentionParams("Signup", "Login", {
        group_by: [
          new CohortBreakdown({ cohort: 123, name: "PU" }),
          new GroupBy({ property: "platform" }),
        ],
      }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
  });

  it("CB3: mixing with a string in retention raises", async () => {
    await expect(
      makeStubWorkspace().buildRetentionParams("Signup", "Login", {
        group_by: [
          new CohortBreakdown({ cohort: 123, name: "PU" }),
          "platform",
        ],
      }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
  });
});

// ===========================================================================
// T038: CohortMetric in events
// ===========================================================================

describe("Build params cohort metric", () => {
  // python: TestBuildParamsCohortMetric
  /** `ws.build_params(CohortMetric(123, "Power Users"))`. */
  async function powerUsers(): Promise<Record<string, unknown>> {
    return makeStubWorkspace().buildParams(
      new CohortMetric({ cohort: 123, name: "Power Users" }),
    );
  }

  it("produces a non-empty sections.show", async () => {
    expect(section(await powerUsers(), "show").length).toBeGreaterThan(0);
  });

  it("the show entry has type='metric'", async () => {
    expect(section(await powerUsers(), "show")[0]!["type"]).toBe("metric");
  });

  it("behavior.type is 'cohort'", async () => {
    expect(behaviorOf(await powerUsers())["type"]).toBe("cohort");
  });

  it("behavior.name matches the provided name", async () => {
    expect(behaviorOf(await powerUsers())["name"]).toBe("Power Users");
  });

  it("behavior.id matches the cohort id", async () => {
    expect(behaviorOf(await powerUsers())["id"]).toBe(123);
  });

  it("behavior.resourceType is 'cohorts'", async () => {
    expect(behaviorOf(await powerUsers())["resourceType"]).toBe("cohorts");
  });

  it("behavior.dataset is '$mixpanel'", async () => {
    expect(behaviorOf(await powerUsers())["dataset"]).toBe("$mixpanel");
  });

  it("measurement.math is 'unique'", async () => {
    expect(measurementOf(await powerUsers())["math"]).toBe("unique");
  });

  it("measurement.property is null", async () => {
    expect(measurementOf(await powerUsers())["property"]).toBeNull();
  });

  it("CM5: an inline CohortDefinition raises at construction", () => {
    expect(
      () => new CohortMetric({ cohort: simpleCohortDef(), name: "Active" }),
    ).toThrow(/CohortMetric does not support inline CohortDefinition/);
  });
});

// ===========================================================================
// T039: CohortMetric mixed with Metric and Formula
// ===========================================================================

describe("Build params cohort metric mixed", () => {
  // python: TestBuildParamsCohortMetricMixed
  it("a CohortMetric and a Metric produce two show entries", async () => {
    const result = await makeStubWorkspace().buildParams([
      new CohortMetric({ cohort: 123, name: "Power Users" }),
      new Metric({ event: "Login" }),
    ]);
    expect(section(result, "show")).toHaveLength(2);
  });

  it("a CohortMetric and a string event produce two show entries", async () => {
    const result = await makeStubWorkspace().buildParams([
      new CohortMetric({ cohort: 123, name: "PU" }),
      "Login",
    ]);
    expect(section(result, "show")).toHaveLength(2);
  });

  it("a CohortMetric and a Formula work together", async () => {
    const result = await makeStubWorkspace().buildParams([
      new CohortMetric({ cohort: 123, name: "PU" }),
      new Metric({ event: "Login" }),
      new Formula({ expression: "A/B", label: "Rate" }),
    ]);
    expect(section(result, "show").length).toBeGreaterThanOrEqual(2);
  });
});

// ===========================================================================
// T040: CM3 — math/math_property/per_user ignored for CohortMetric
// ===========================================================================

describe("Build params cohort metric math ignored", () => {
  // python: TestBuildParamsCohortMetricMathIgnored
  it("math='total' does not change the cohort metric's math", async () => {
    const result = await makeStubWorkspace().buildParams(
      new CohortMetric({ cohort: 123, name: "PU" }),
      { math: "total" },
    );
    expect(measurementOf(result)["math"]).toBe("unique");
  });

  it("math_property does not appear in the cohort measurement", async () => {
    const result = await makeStubWorkspace().buildParams(
      new CohortMetric({ cohort: 123, name: "PU" }),
      { math: "average", math_property: "amount" },
    );
    expect(measurementOf(result)["property"]).toBeNull();
  });

  it("property-math without math_property is ignored for cohort-only", async () => {
    const result = await makeStubWorkspace().buildParams(
      new CohortMetric({ cohort: 123, name: "PU" }),
      { math: "average" },
    );
    expect(measurementOf(result)["math"]).toBe("unique");
  });

  it("percentile without a value is ignored for cohort-only", async () => {
    const result = await makeStubWorkspace().buildParams(
      new CohortMetric({ cohort: 123, name: "PU" }),
      { math: "percentile" },
    );
    expect(measurementOf(result)["math"]).toBe("unique");
  });

  it("histogram without per_user is ignored for cohort-only", async () => {
    const result = await makeStubWorkspace().buildParams(
      new CohortMetric({ cohort: 123, name: "PU" }),
      { math: "histogram" },
    );
    expect(measurementOf(result)["math"]).toBe("unique");
  });

  it("an incompatible per_user is ignored for cohort-only", async () => {
    const result = await makeStubWorkspace().buildParams(
      new CohortMetric({ cohort: 123, name: "PU" }),
      { math: "unique", per_user: "average" },
    );
    expect(measurementOf(result)["math"]).toBe("unique");
  });

  it("mixed events still validate the top-level math", async () => {
    await expect(
      makeStubWorkspace().buildParams(
        [new CohortMetric({ cohort: 123, name: "PU" }), "Login"],
        { math: "average" },
      ),
    ).rejects.toThrow(/requires math_property/);
  });

  it("per_user does not appear in the cohort measurement", async () => {
    const result = await makeStubWorkspace().buildParams([
      new CohortMetric({ cohort: 123, name: "PU" }),
      new Metric({
        event: "Login",
        math: "average",
        property: "amount",
        per_user: "average",
      }),
    ]);
    // The CohortMetric is first in the show list
    const cm = measurementOf(result);
    expect(cm["perUserAggregation"] ?? null).toBeNull();
    expect(cm["math"]).toBe("unique");
  });
});

// ===========================================================================
// T007: query_flow where= — cohort filter
// ===========================================================================

describe("Query flow cohort filter", () => {
  // python: TestQueryFlowCohortFilter
  it("build_flow_params with a cohort filter produces filter_by_cohort", async () => {
    const result = await makeStubWorkspace().buildFlowParams("Login", {
      where: Filter.inCohort(123, "PU"),
    });
    expect(Object.hasOwn(result, "filter_by_cohort")).toBe(true);
  });

  it("build_flow_params without where= has no filter_by_cohort", async () => {
    const result = await makeStubWorkspace().buildFlowParams("Login");
    expect(Object.hasOwn(result, "filter_by_cohort")).toBe(false);
  });

  it("a property filter produces filter_by_event", async () => {
    const result = await makeStubWorkspace().buildFlowParams("Login", {
      where: Filter.equals("country", "US"),
    });
    expect(Object.hasOwn(result, "filter_by_event")).toBe(true);
    const fbe = result["filter_by_event"] as Record<string, unknown>;
    expect(fbe["operator"]).toBe("and");
    expect(fbe["children"] as unknown[]).toHaveLength(1);
  });

  it("multiple cohort filters raise", async () => {
    await expect(
      makeStubWorkspace().buildFlowParams("Login", {
        where: [Filter.inCohort(123, "A"), Filter.inCohort(456, "B")],
      }),
    ).rejects.toThrow(/query_flow supports a single cohort filter, but 2/);
  });
});

// ===========================================================================
// build_flow_cohort_filter — direct unit tests
// ===========================================================================

describe("Build flow cohort filter direct", () => {
  // python: TestBuildFlowCohortFilterDirect
  it("a saved cohort filter produces a dict with the id", () => {
    const result = buildFlowCohortFilter(Filter.inCohort(123, "PU"));
    expect(result).not.toBeNull();
    expect(result!["id"]).toBe(123);
    expect(result!["name"]).toBe("PU");
    expect(result!["negated"]).toBe(false);
  });

  it("an inline cohort filter produces a dict with raw_cohort", () => {
    const result = buildFlowCohortFilter(
      Filter.inCohort(simpleCohortDef(), "Active"),
    );
    expect(result).not.toBeNull();
    expect(Object.hasOwn(result!, "raw_cohort")).toBe(true);
    expect(result!["name"]).toBe("Active");
    expect(result!["negated"]).toBe(false);
  });

  it("not_in_cohort produces negated=true", () => {
    const result = buildFlowCohortFilter(Filter.notInCohort(123, "Bots"));
    expect(result).not.toBeNull();
    expect(result!["negated"]).toBe(true);
  });

  it("a non-cohort filter raises", () => {
    expect(() => buildFlowCohortFilter(Filter.equals("country", "US"))).toThrow(
      /only accepts cohort filters/,
    );
  });

  it("multiple cohort filters raise", () => {
    expect(() =>
      buildFlowCohortFilter([Filter.inCohort(1, "A"), Filter.inCohort(2, "B")]),
    ).toThrow(/single cohort filter, but 2/);
  });
});

// ===========================================================================
// Coded guard errors (BB4-BB8)
// ===========================================================================

describe("Coded flow cohort filter codes", () => {
  // python: TestCodedFlowCohortFilterCodes
  /** Assert the thrown guard carries `code`. */
  function expectCode(fn: () => unknown, code: string): void {
    const error = expectThrows(
      () => fn(),
      `expected ParamValidationError ${code}`,
    );
    expect(error).toBeInstanceOf(ParamValidationError);
    expect((error as ParamValidationError).code).toBe(code);
  }

  it("BB4: a non-cohort property filter", () => {
    expectCode(
      () => buildFlowCohortFilter(Filter.equals("country", "US")),
      "BB4_FLOW_COHORT_FILTER_TYPE",
    );
  });

  it("BB4: a numeric filter inside a list", () => {
    expectCode(
      () =>
        buildFlowCohortFilter([
          Filter.inCohort(1, "A"),
          Filter.greaterThan("age", 18),
        ]),
      "BB4_FLOW_COHORT_FILTER_TYPE",
    );
  });

  it("BB5: two cohort filters", () => {
    expectCode(
      () =>
        buildFlowCohortFilter([
          Filter.inCohort(1, "A"),
          Filter.inCohort(2, "B"),
        ]),
      "BB5_FLOW_MULTIPLE_COHORT_FILTERS",
    );
  });

  it("BB5: three cohort filters", () => {
    expectCode(
      () =>
        buildFlowCohortFilter([
          Filter.inCohort(1, "A"),
          Filter.inCohort(2, "B"),
          Filter.notInCohort(3, "C"),
        ]),
      "BB5_FLOW_MULTIPLE_COHORT_FILTERS",
    );
  });

  it("BB5 surfaces through the build_flow_params facade seam", async () => {
    const error = await expectRejects(
      makeStubWorkspace().buildFlowParams("Login", {
        where: [Filter.inCohort(123, "A"), Filter.inCohort(456, "B")],
      }),
      "expected ParamValidationError BB5",
    );
    expect(error).toBeInstanceOf(ParamValidationError);
    expect((error as ParamValidationError).code).toBe(
      "BB5_FLOW_MULTIPLE_COHORT_FILTERS",
    );
  });

  for (const value of ["oops", []] as const) {
    it(`BB6: a non-list _value (${JSON.stringify(value)})`, () => {
      expectCode(
        () => buildFlowCohortFilter(malformedCohortFilter(value)),
        "BB6_COHORT_VALUE_NOT_LIST",
      );
    });
  }

  for (const value of [[42], ["cohort"]] as const) {
    it(`BB7: a non-dict first item (${JSON.stringify(value)})`, () => {
      expectCode(
        () => buildFlowCohortFilter(malformedCohortFilter(value)),
        "BB7_COHORT_VALUE_NOT_DICT",
      );
    });
  }

  for (const value of [[{}], [{ other: 1 }]] as const) {
    it(`BB8: a missing cohort key (${JSON.stringify(value)})`, () => {
      expectCode(
        () => buildFlowCohortFilter(malformedCohortFilter(value)),
        "BB8_COHORT_KEY_MISSING",
      );
    });
  }

  it("converted BB* guards stay ParamValidationError instances", () => {
    // Python asserts they remain catchable as bare `ValueError` (the
    // dual-inheritance); the TS conformance key is class + code,
    // so the assertion is the class and the code.
    const error = expectThrows(
      () => buildFlowCohortFilter(Filter.equals("country", "US")),
      "expected ParamValidationError",
    );
    expect(error).toBeInstanceOf(ParamValidationError);
    expect((error as ParamValidationError).code).toBe(
      "BB4_FLOW_COHORT_FILTER_TYPE",
    );
  });
});
