// Translated workspace-cohort tests (B5-S2, packet §3): assertion-for-
// assertion port of tests/test_workspace_cohort.py (R10.2) — BOTH
// classes (TestQueryFlowWhere :114,
// TestResolveAndBuildParamsCohortMetric :250).
//
// Translation notes:
// - `mock_api_client.request.assert_not_called()` /
//   `insights_query.assert_not_called()` become empty call logs on the
//   shared stub (which records `insightsQuery` and `arbFunnelsQuery`;
//   the generic `request` has no facade caller here).
// - `pytest.raises(ValueError, match="CohortMetric does not support
//   inline CohortDefinition")` names Python's dual-inheriting
//   `ParamValidationError`; the TS twin carries the same message and the
//   `CM5_INLINE_COHORT_METRIC` code.

import { describe, expect, it } from "vitest";
import { Workspace } from "../../src/workspace.js";
import { Filter } from "../../src/types/query-params/filter.js";
import {
  CohortBreakdown,
  CohortCriteria,
  CohortDefinition,
} from "../../src/types/query-params/cohort.js";
import {
  CohortMetric,
  Formula,
  Metric,
} from "../../src/types/query-params/metric.js";
import {
  mockWorkspaceClient,
  TEST_SESSION,
  type MockWorkspaceClient,
} from "./workspace-test-helpers.js";

/**
 * The `workspace_factory` fixture.
 *
 * @param mock - The stub client.
 * @returns The facade under test.
 */
function workspaceFactory(mock: MockWorkspaceClient): Workspace {
  return new Workspace({ session: TEST_SESSION, client: mock.client });
}

/** `_simple_cohort_def()` (test file :95-105). */
function simpleCohortDef(): CohortDefinition {
  return new CohortDefinition(
    CohortCriteria.didEvent("Purchase", { at_least: 1, within_days: 30 }),
  );
}

/** Read `params.sections.<name>` as an array. */
function section(
  params: Record<string, unknown>,
  name: string,
): unknown[] {
  const sections = params["sections"] as Record<string, unknown>;
  return sections[name] as unknown[];
}

// ===========================================================================
// T007: query_flow where= parameter
// ===========================================================================

describe("TestQueryFlowWhere", () => {
  it("build_flow_params accepts a cohort filter in where=", async () => {
    const result = await workspaceFactory(mockWorkspaceClient()).buildFlowParams(
      "Login",
      { where: Filter.inCohort(123, "Power Users") },
    );
    expect(Object.hasOwn(result, "filter_by_cohort")).toBe(true);
  });

  it("filter_by_cohort has the correct cohort id", async () => {
    const result = await workspaceFactory(mockWorkspaceClient()).buildFlowParams(
      "Login",
      { where: Filter.inCohort(456, "Active") },
    );
    const fbc = result["filter_by_cohort"] as Record<string, unknown>;
    expect(fbc["id"]).toBe(456);
  });

  it("filter_by_cohort has the correct cohort name", async () => {
    const result = await workspaceFactory(mockWorkspaceClient()).buildFlowParams(
      "Login",
      { where: Filter.inCohort(456, "Active") },
    );
    const fbc = result["filter_by_cohort"] as Record<string, unknown>;
    expect(fbc["name"]).toBe("Active");
  });

  it("not_in_cohort sets negated=true", async () => {
    const result = await workspaceFactory(mockWorkspaceClient()).buildFlowParams(
      "Login",
      { where: Filter.notInCohort(789, "Bots") },
    );
    const fbc = result["filter_by_cohort"] as Record<string, unknown>;
    expect(fbc["negated"]).toBe(true);
  });

  it("a property filter produces filter_by_event", async () => {
    const result = await workspaceFactory(mockWorkspaceClient()).buildFlowParams(
      "Login",
      { where: Filter.equals("country", "US") },
    );
    expect(Object.hasOwn(result, "filter_by_event")).toBe(true);
    const fbe = result["filter_by_event"] as Record<string, unknown>;
    expect(fbe["operator"]).toBe("and");
    expect((fbe["children"] as unknown[]).length).toBe(1);
  });

  it("mixed cohort + property filters produce both keys", async () => {
    const result = await workspaceFactory(mockWorkspaceClient()).buildFlowParams(
      "Login",
      {
        where: [Filter.inCohort(123, "PU"), Filter.equals("country", "US")],
      },
    );
    expect(Object.hasOwn(result, "filter_by_cohort")).toBe(true);
    expect(Object.hasOwn(result, "filter_by_event")).toBe(true);
    const fbc = result["filter_by_cohort"] as Record<string, unknown>;
    expect(fbc["name"]).toBe("PU");
    const fbe = result["filter_by_event"] as Record<string, unknown>;
    expect((fbe["children"] as unknown[]).length).toBe(1);
  });

  it("no where= produces no filter_by_cohort key", async () => {
    const result = await workspaceFactory(mockWorkspaceClient()).buildFlowParams(
      "Login",
    );
    expect(Object.hasOwn(result, "filter_by_cohort")).toBe(false);
  });

  it("build_flow_params makes no API call", async () => {
    const mock = mockWorkspaceClient();
    await workspaceFactory(mock).buildFlowParams("Login", {
      where: Filter.inCohort(123),
    });
    expect(mock.arbFunnelsCalls.length).toBe(0);
    expect(mock.insightsCalls.length).toBe(0);
  });
});

// ===========================================================================
// T041: _resolve_and_build_params type guard for CohortMetric
// ===========================================================================

describe("TestResolveAndBuildParamsCohortMetric", () => {
  it("a CohortMetric alone produces a valid params dict", async () => {
    const result = await workspaceFactory(mockWorkspaceClient()).buildParams(
      new CohortMetric({ cohort: 123, name: "Power Users" }),
    );
    expect(typeof result).toBe("object");
    expect(Object.hasOwn(result, "sections")).toBe(true);
    expect(Object.hasOwn(result, "displayOptions")).toBe(true);
  });

  it("a CohortMetric produces a non-empty sections.show", async () => {
    const result = await workspaceFactory(mockWorkspaceClient()).buildParams(
      new CohortMetric({ cohort: 123, name: "PU" }),
    );
    expect(section(result, "show").length).toBeGreaterThan(0);
  });

  it("the show entry has behavior.type='cohort'", async () => {
    const result = await workspaceFactory(mockWorkspaceClient()).buildParams(
      new CohortMetric({ cohort: 123, name: "PU" }),
    );
    const show = section(result, "show") as Array<Record<string, unknown>>;
    const behavior = show[0]!["behavior"] as Record<string, unknown>;
    expect(behavior["type"]).toBe("cohort");
  });

  it("a CohortMetric in a sequence with a string event is accepted", async () => {
    const result = await workspaceFactory(mockWorkspaceClient()).buildParams([
      new CohortMetric({ cohort: 123, name: "PU" }),
      "Login",
    ]);
    expect(section(result, "show").length).toBe(2);
  });

  it("a CohortMetric in a sequence with a Metric is accepted", async () => {
    const result = await workspaceFactory(mockWorkspaceClient()).buildParams([
      new CohortMetric({ cohort: 123, name: "PU" }),
      new Metric({ event: "Login", math: "unique" }),
    ]);
    expect(section(result, "show").length).toBe(2);
  });

  it("a CohortMetric with a Formula in the sequence is accepted", async () => {
    const result = await workspaceFactory(mockWorkspaceClient()).buildParams([
      new CohortMetric({ cohort: 123, name: "PU" }),
      new Metric({ event: "Login" }),
      new Formula({ expression: "A/B", label: "Ratio" }),
    ]);
    expect(Object.hasOwn(result, "sections")).toBe(true);
  });

  it("build_params with a CohortMetric makes no API call", async () => {
    const mock = mockWorkspaceClient();
    await workspaceFactory(mock).buildParams(
      new CohortMetric({ cohort: 123, name: "PU" }),
    );
    expect(mock.insightsCalls.length).toBe(0);
  });

  it("CM5: an inline CohortDefinition raises at construction", () => {
    const cohortDef = simpleCohortDef();
    expect(
      () => new CohortMetric({ cohort: cohortDef, name: "Active" }),
    ).toThrow(/CohortMetric does not support inline CohortDefinition/);
  });

  it("a CohortMetric with group_by produces both show and group", async () => {
    const result = await workspaceFactory(mockWorkspaceClient()).buildParams(
      new CohortMetric({ cohort: 123, name: "PU" }),
      { group_by: "platform" },
    );
    expect(section(result, "show").length).toBeGreaterThan(0);
    expect(section(result, "group").length).toBeGreaterThan(0);
  });

  it("a CohortMetric with where= produces both show and filter", async () => {
    const result = await workspaceFactory(mockWorkspaceClient()).buildParams(
      new CohortMetric({ cohort: 123, name: "PU" }),
      { where: Filter.inCohort(456, "Other") },
    );
    expect(section(result, "show").length).toBeGreaterThan(0);
    expect(section(result, "filter").length).toBeGreaterThan(0);
  });

  it("a CohortMetric with a CohortBreakdown produces both show and group", async () => {
    const result = await workspaceFactory(mockWorkspaceClient()).buildParams(
      new CohortMetric({ cohort: 123, name: "PU" }),
      { group_by: new CohortBreakdown({ cohort: 456, name: "Other Cohort" }) },
    );
    expect(section(result, "show").length).toBeGreaterThan(0);
    expect(section(result, "group").length).toBeGreaterThan(0);
  });
});
