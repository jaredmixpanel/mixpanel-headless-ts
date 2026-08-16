// Translated workspace-flow tests (B5-S2, packet §3): assertion-for-
// assertion port of tests/unit/test_workspace_flow.py (R10.2) — ALL 13
// classes (TestBuildFlowParams :77, TestBuildFlowParamsFilters :360,
// TestWorkspaceFlowPublicMethods :490, TestMultiStepNormalization :605,
// TestMultiStepAnchorPosition :759, TestPerStepDirectionValidation :781,
// TestFlowStepDatetimeFilters :846, TestQueryFlowTreeIntegration :937,
// TestDataGroupIdFlow :991, TestFlowSessionEvent :1018,
// TestFlowSegments :1065, TestFlowExclusions :1130,
// TestFlowPropertyFilters :1176).
//
// The Python file also carries a REMOVAL comment for
// `test_query_flow_raises_on_no_credentials` (:527) — nothing to
// translate.
//
// Translation notes:
// - `ws._build_flow_params(...)` (the private method) is the exported
//   free function {@link buildFlowParams} in
//   `src/workspace-query-params.ts` (R7.2 split; it is `self`-free in
//   Python too).
// - `ws._live_query = MagicMock()` (swapping the service to observe the
//   delegation) becomes a stub `arbFunnelsQuery` on the shared client
//   plus assertions on the recorded BODY — the same three facts
//   (`project_id`, `query_type` from `mode`, and a bookmark payload),
//   read one layer lower because `Workspace.liveQueryService` is a lazy
//   getter with no setter (the TS field is `#`-private).
// - `result.df` / `result.to_dict()` / `result.anytree` in the tree
//   round-trip become `toRows()` / `toJSON()` / `anytree()` (C6 + the
//   B5-S2 closure of the Phase-2 anytree TODO(port)).

import { describe, expect, it } from "vitest";
import { Workspace } from "../../src/workspace.js";
import { buildFlowParams } from "../../src/workspace-query-params.js";
import { Filter } from "../../src/types/query-params/filter.js";
import { FlowStep } from "../../src/types/query-params/flow.js";
import { GroupBy } from "../../src/types/query-params/group-by.js";
import {
  FlowQueryResult,
  FlowTreeNode,
} from "../../src/types/results/query-engine.js";
import {
  mockWorkspaceClient,
  TEST_SESSION,
  type MockWorkspaceClient,
} from "./workspace-test-helpers.js";

/**
 * The `workspace_factory` fixture (test file :56-68).
 *
 * @param mock - Optional stub client.
 * @returns The facade under test.
 */
function makeWs(mock: MockWorkspaceClient = mockWorkspaceClient()): Workspace {
  return new Workspace({ session: TEST_SESSION, client: mock.client });
}

/** The keyword-only defaults every `_build_flow_params` case shares. */
const BASE_BUILD = {
  from_date: null,
  to_date: null,
  last: 30,
  conversion_window: 7,
  conversion_window_unit: "day",
  count_type: "unique",
  cardinality: 3,
  collapse_repeated: false,
  hidden_events: null,
  mode: "sankey",
} as const;

/** `params["steps"]` as an array of records. */
function stepsOf(
  params: Record<string, unknown>,
): Array<Record<string, unknown>> {
  return params["steps"] as Array<Record<string, unknown>>;
}

// ===========================================================================
// T020: _build_flow_params
// ===========================================================================

describe("TestBuildFlowParams", () => {
  it("a single-step flow produces the flat structure", () => {
    const params = buildFlowParams({
      ...BASE_BUILD,
      steps: [new FlowStep({ event: "Login" })],
    });

    // Flat structure — no "sections" wrapper
    expect(Object.hasOwn(params, "sections")).toBe(false);
    for (const key of [
      "steps",
      "date_range",
      "chartType",
      "count_type",
      "cardinality_threshold",
      "conversion_window",
      "anchor_position",
    ]) {
      expect(Object.hasOwn(params, key)).toBe(true);
    }
    expect(params["version"]).toBe(2);
  });

  it("last=30 produces a relative date range", () => {
    const params = buildFlowParams({
      ...BASE_BUILD,
      steps: [new FlowStep({ event: "Login" })],
    });
    const dr = params["date_range"] as Record<string, unknown>;
    expect(dr["type"]).toBe("in the last");
    expect(dr["from_date"]).toEqual({ unit: "day", value: 30 });
    expect(dr["to_date"]).toBe("$now");
  });

  it("absolute dates produce a 'between' date range", () => {
    const params = buildFlowParams({
      ...BASE_BUILD,
      steps: [new FlowStep({ event: "Login" })],
      from_date: "2025-01-01",
      to_date: "2025-01-31",
    });
    const dr = params["date_range"] as Record<string, unknown>;
    expect(dr["type"]).toBe("between");
    expect(dr["from_date"]).toBe("2025-01-01");
    expect(dr["to_date"]).toBe("2025-01-31");
  });

  it("mode='sankey' maps to chartType='sankey' / merge 'graph'", () => {
    const params = buildFlowParams({
      ...BASE_BUILD,
      steps: [new FlowStep({ event: "Login" })],
      mode: "sankey",
    });
    expect(params["chartType"]).toBe("sankey");
    expect(params["flows_merge_type"]).toBe("graph");
  });

  it("mode='paths' maps to chartType='top-paths' / merge 'list'", () => {
    const params = buildFlowParams({
      ...BASE_BUILD,
      steps: [new FlowStep({ event: "Login" })],
      mode: "paths",
    });
    expect(params["chartType"]).toBe("top-paths");
    expect(params["flows_merge_type"]).toBe("list");
  });

  it("mode='tree' maps to chartType='sankey' / merge 'tree'", () => {
    const params = buildFlowParams({
      ...BASE_BUILD,
      steps: [new FlowStep({ event: "Login" })],
      mode: "tree",
    });
    expect(params["chartType"]).toBe("sankey");
    expect(params["flows_merge_type"]).toBe("tree");
  });

  it("each step dict has the required keys", () => {
    const params = buildFlowParams({
      ...BASE_BUILD,
      steps: [
        new FlowStep({ event: "Purchase", forward: 2, reverse: 1, label: "Buy" }),
      ],
    });
    const step = stepsOf(params)[0]!;
    expect(step["event"]).toBe("Purchase");
    expect(step["step_label"]).toBe("Buy");
    expect(step["forward"]).toBe(2);
    expect(step["reverse"]).toBe(1);
    expect(step["bool_op"]).toBe("and");
    expect(step["property_filter_params_list"]).toEqual([]);
  });

  it("collapse_repeated=true shows in the output", () => {
    const params = buildFlowParams({
      ...BASE_BUILD,
      steps: [new FlowStep({ event: "Login" })],
      collapse_repeated: true,
    });
    expect(params["collapse_repeated"]).toBe(true);
  });

  it("hidden_events shows in the output", () => {
    const params = buildFlowParams({
      ...BASE_BUILD,
      steps: [new FlowStep({ event: "Login" })],
      hidden_events: ["X"],
    });
    expect(params["hidden_events"]).toEqual(["X"]);
  });

  it("a custom conversion window shows in the output", () => {
    const params = buildFlowParams({
      ...BASE_BUILD,
      steps: [new FlowStep({ event: "Login" })],
      conversion_window: 14,
      conversion_window_unit: "week",
    });
    expect(params["conversion_window"]).toEqual({ unit: "week", value: 14 });
  });
});

// ===========================================================================
// T021: filter integration in _build_flow_params
// ===========================================================================

describe("TestBuildFlowParamsFilters", () => {
  it("a FlowStep with filters produces the segfilter list", () => {
    const step = new FlowStep({
      event: "Purchase",
      forward: 3,
      reverse: 0,
      filters: [Filter.greaterThan("amount", 50)],
    });
    const params = buildFlowParams({ ...BASE_BUILD, steps: [step] });

    const pf = stepsOf(params)[0]!["property_filter_params_list"] as Array<
      Record<string, unknown>
    >;
    expect(pf.length).toBe(1);
    const property = pf[0]!["property"] as Record<string, unknown>;
    expect(property["name"]).toBe("amount");
    expect(Object.hasOwn(pf[0]!, "filter")).toBe(true);
  });

  it("filters_combinator='any' maps to bool_op='or'", () => {
    const step = new FlowStep({
      event: "Purchase",
      forward: 3,
      reverse: 0,
      filters: [Filter.equals("country", "US"), Filter.equals("country", "UK")],
      filters_combinator: "any",
    });
    const params = buildFlowParams({ ...BASE_BUILD, steps: [step] });
    expect(stepsOf(params)[0]!["bool_op"]).toBe("or");
  });

  it("filters_combinator='all' maps to bool_op='and'", () => {
    const step = new FlowStep({ event: "Purchase", forward: 3, reverse: 0 });
    const params = buildFlowParams({ ...BASE_BUILD, steps: [step] });
    expect(stepsOf(params)[0]!["bool_op"]).toBe("and");
  });

  it("a FlowStep without filters has an empty segfilter list", () => {
    const step = new FlowStep({ event: "Purchase", forward: 3, reverse: 0 });
    const params = buildFlowParams({ ...BASE_BUILD, steps: [step] });
    expect(stepsOf(params)[0]!["property_filter_params_list"]).toEqual([]);
  });
});

// ===========================================================================
// T028-T029: workspace public methods
// ===========================================================================

describe("TestWorkspaceFlowPublicMethods", () => {
  /** A minimal sankey response the transform accepts. */
  const SANKEY_OK: Record<string, unknown> = {
    computed_at: "2025-01-15T10:00:00",
    steps: [{ event: "Login", count: 100 }],
    flows: [],
    breakdowns: [],
    overallConversionRate: 0.5,
    metadata: {},
  };

  it("query_flow delegates with the right body", async () => {
    const mock = mockWorkspaceClient();
    mock.setArbFunnelsResponse(SANKEY_OK);

    const result = await makeWs(mock).queryFlow("Login");

    expect(result).toBeInstanceOf(FlowQueryResult);
    expect(result.computed_at).toBe("2025-01-15T10:00:00");
    expect(mock.arbFunnelsCalls.length).toBe(1);
    const body = mock.arbFunnelsCalls[0]!;
    expect(body["project_id"]).toBe(12345);
    expect(body["query_type"]).toBe("flows_sankey"); // mode="sankey"
    expect(Object.hasOwn(body, "bookmark")).toBe(true);
  });

  it("build_flow_params returns a dict without an API call", async () => {
    const mock = mockWorkspaceClient();
    const params = await makeWs(mock).buildFlowParams("Login");

    expect(typeof params).toBe("object");
    expect(Object.hasOwn(params, "steps")).toBe(true);
    expect(Object.hasOwn(params, "date_range")).toBe(true);
    expect(Object.hasOwn(params, "chartType")).toBe(true);
    expect(params["version"]).toBe(2);
    expect(mock.arbFunnelsCalls.length).toBe(0);
  });

  it("query_flow accepts a FlowStep directly", async () => {
    const mock = mockWorkspaceClient();
    mock.setArbFunnelsResponse({
      computed_at: "2025-01-15T10:00:00",
      steps: [],
      flows: [],
      breakdowns: [],
      overallConversionRate: 0.0,
      metadata: {},
    });

    const result = await makeWs(mock).queryFlow(
      new FlowStep({ event: "Login", forward: 5, reverse: 2 }),
    );

    expect(result).toBeInstanceOf(FlowQueryResult);
    expect(mock.arbFunnelsCalls.length).toBe(1);
  });

  it("query_flow accepts a list of event names", async () => {
    const mock = mockWorkspaceClient();
    mock.setArbFunnelsResponse({
      computed_at: "2025-01-15T10:00:00",
      steps: [],
      flows: [],
      breakdowns: [],
      overallConversionRate: 0.0,
      metadata: {},
    });

    const result = await makeWs(mock).queryFlow(["Login", "Purchase"], {
      mode: "paths",
    });

    expect(result).toBeInstanceOf(FlowQueryResult);
    expect(mock.arbFunnelsCalls[0]!["query_type"]).toBe("flows_top_paths");
    expect(result.mode).toBe("paths");
  });
});

// ===========================================================================
// T040-T042: multi-step normalization
// ===========================================================================

describe("TestMultiStepNormalization", () => {
  it("a list of strings produces N steps with the defaults", async () => {
    const params = await makeWs().buildFlowParams(["A", "B"]);
    const steps = stepsOf(params);
    expect(steps.length).toBe(2);
    expect(steps[0]!["event"]).toBe("A");
    expect(steps[1]!["event"]).toBe("B");
    // Top-level defaults: forward=3, reverse=0
    expect(steps[0]!["forward"]).toBe(3);
    expect(steps[0]!["reverse"]).toBe(0);
    expect(steps[1]!["forward"]).toBe(3);
    expect(steps[1]!["reverse"]).toBe(0);
  });

  it("a list of FlowSteps preserves per-step forward/reverse", async () => {
    const params = await makeWs().buildFlowParams([
      new FlowStep({ event: "A", forward: 3 }),
      new FlowStep({ event: "B", reverse: 2 }),
    ]);
    const steps = stepsOf(params);
    expect(steps.length).toBe(2);
    expect(steps[0]!["event"]).toBe("A");
    expect(steps[0]!["forward"]).toBe(3);
    expect(steps[1]!["event"]).toBe("B");
    expect(steps[1]!["reverse"]).toBe(2);
  });

  it("a mixed list works correctly", async () => {
    const params = await makeWs().buildFlowParams([
      "A",
      new FlowStep({ event: "B", forward: 1 }),
    ]);
    const steps = stepsOf(params);
    expect(steps.length).toBe(2);
    expect(steps[0]!["event"]).toBe("A");
    expect(steps[0]!["forward"]).toBe(3);
    expect(steps[0]!["reverse"]).toBe(0);
    expect(steps[1]!["event"]).toBe("B");
    expect(steps[1]!["forward"]).toBe(1);
  });

  it("a single string wraps into a one-element list", async () => {
    const params = await makeWs().buildFlowParams("Purchase");
    const steps = stepsOf(params);
    expect(steps.length).toBe(1);
    expect(steps[0]!["event"]).toBe("Purchase");
  });

  it("a single FlowStep wraps into a one-element list", async () => {
    const params = await makeWs().buildFlowParams(
      new FlowStep({ event: "A", forward: 3 }),
    );
    const steps = stepsOf(params);
    expect(steps.length).toBe(1);
    expect(steps[0]!["event"]).toBe("A");
    expect(steps[0]!["forward"]).toBe(3);
  });

  it("string steps inherit the top-level defaults", async () => {
    const params = await makeWs().buildFlowParams(["X", "Y"], {
      forward: 5,
      reverse: 2,
    });
    for (const step of stepsOf(params)) {
      expect(step["forward"]).toBe(5);
      expect(step["reverse"]).toBe(2);
    }
  });

  it("explicit FlowStep values override the top-level defaults", async () => {
    const params = await makeWs().buildFlowParams(
      new FlowStep({ event: "A", forward: 5, reverse: 4 }),
      { forward: 3, reverse: 0 },
    );
    const step = stepsOf(params)[0]!;
    expect(step["forward"]).toBe(5);
    expect(step["reverse"]).toBe(4);
  });

  it("a FlowStep with null values inherits the defaults", async () => {
    const params = await makeWs().buildFlowParams(
      new FlowStep({ event: "A" }),
      { forward: 5, reverse: 2 },
    );
    const step = stepsOf(params)[0]!;
    expect(step["forward"]).toBe(5);
    expect(step["reverse"]).toBe(2);
  });
});

// ===========================================================================
// T042: anchor_position
// ===========================================================================

describe("TestMultiStepAnchorPosition", () => {
  it("anchor_position is 1", async () => {
    const params = await makeWs().buildFlowParams("Login");
    expect(params["anchor_position"]).toBe(1);
  });
});

// ===========================================================================
// T043: FL5 respects per-step overrides
// ===========================================================================

describe("TestPerStepDirectionValidation", () => {
  it("a per-step forward override is not rejected when top-level is 0", async () => {
    const params = await makeWs().buildFlowParams(
      new FlowStep({ event: "Login", forward: 3 }),
      { forward: 0, reverse: 0 },
    );
    const step = stepsOf(params)[0]!;
    expect(step["forward"]).toBe(3);
    expect(step["reverse"]).toBe(0);
  });

  it("FL5 still rejects when no step has a non-zero direction", async () => {
    await expect(
      makeWs().buildFlowParams(new FlowStep({ event: "Login" }), {
        forward: 0,
        reverse: 0,
      }),
    ).rejects.toThrow(/forward or reverse must be > 0/);
  });

  it("mixed per-step overrides pass when one direction is > 0", async () => {
    const params = await makeWs().buildFlowParams(
      [
        new FlowStep({ event: "A", forward: 3 }),
        new FlowStep({ event: "B", reverse: 2 }),
      ],
      { forward: 0, reverse: 0 },
    );
    const steps = stepsOf(params);
    expect(steps[0]!["forward"]).toBe(3);
    expect(steps[0]!["reverse"]).toBe(0);
    expect(steps[1]!["forward"]).toBe(0);
    expect(steps[1]!["reverse"]).toBe(2);
  });
});

// ===========================================================================
// T044: datetime filter -> segfilter operator mapping
// ===========================================================================

describe("TestFlowStepDatetimeFilters", () => {
  it("Filter.before produces segfilter operator '>'", async () => {
    const params = await makeWs().buildFlowParams(
      new FlowStep({
        event: "Login",
        filters: [Filter.before("$time", "2026-01-15")],
      }),
    );
    const pf = stepsOf(params)[0]!["property_filter_params_list"] as Array<
      Record<string, unknown>
    >;
    const filter = pf[0]!["filter"] as Record<string, unknown>;
    expect(filter["operator"]).toBe(">");
    expect(filter["operand"]).toBe("01/15/2026");
  });

  it("Filter.in_the_last produces operator, operand and unit", async () => {
    const params = await makeWs().buildFlowParams(
      new FlowStep({
        event: "Login",
        filters: [Filter.inTheLast("$time", 7, "day")],
      }),
    );
    const pf = stepsOf(params)[0]!["property_filter_params_list"] as Array<
      Record<string, unknown>
    >;
    const filter = pf[0]!["filter"] as Record<string, unknown>;
    expect(filter["operator"]).toBe(">");
    expect(filter["operand"]).toBe(7);
    expect(filter["unit"]).toBe("days");
  });
});

// ===========================================================================
// T053: end-to-end tree mode
// ===========================================================================

/** `_sample_tree_api_response()` (test file :890-935). */
function sampleTreeApiResponse(): Record<string, unknown> {
  return {
    computed_at: "2025-01-15T10:00:00",
    trees: [
      {
        root: {
          step: {
            type: "ANCHOR",
            step_number: 0,
            event: "Login",
            is_computed: false,
            anchor_type: "NORMAL",
          },
          children: [
            {
              step: {
                type: "NORMAL",
                step_number: 1,
                event: "Search",
                is_computed: false,
                anchor_type: "NORMAL",
              },
              children: [],
              total_count: 80,
              drop_off_total_count: 10,
              converted_total_count: 70,
            },
          ],
          total_count: 100,
          drop_off_total_count: 20,
          converted_total_count: 80,
        },
        num_steps: 2,
        segments: { segments: [] },
      },
    ],
    metadata: { min_sampling_factor: 1 },
  };
}

describe("TestQueryFlowTreeIntegration", () => {
  it("query_flow(mode='tree') returns a structured result", async () => {
    const mock = mockWorkspaceClient();
    mock.setArbFunnelsResponse(sampleTreeApiResponse());

    const result = await makeWs(mock).queryFlow("Login", { mode: "tree" });

    expect(result).toBeInstanceOf(FlowQueryResult);
    expect(result.mode).toBe("tree");
    expect(result.trees.length).toBe(1);

    const root = result.trees[0]!;
    expect(root).toBeInstanceOf(FlowTreeNode);
    expect(root.event).toBe("Login");
    expect(root.total_count).toBe(100);
    expect(root.drop_off_count).toBe(20);
    expect(root.converted_count).toBe(80);

    expect(root.children.length).toBe(1);
    expect(root.children[0]!.event).toBe("Search");
    expect(root.children[0]!.total_count).toBe(80);

    // Frame rows work
    const rows = result.toRows();
    expect(rows.length).toBe(root.node_count);
    expect(result.rowColumns()).toContain("path");
    expect(rows.map((r) => r["path"])).toContain("Login > Search");

    // toJSON is serializable
    const d = result.toJSON();
    const trees = d["trees"] as Array<Record<string, unknown>>;
    expect(trees.length).toBe(1);
    expect(trees[0]!["event"]).toBe("Login");

    // The anytree view works (B5-S2 closure of the Phase-2 TODO)
    const atRoots = result.anytree();
    expect(atRoots.length).toBe(1);
    expect(atRoots[0]!.event).toBe("Login");
    expect(atRoots[0]!.children.length).toBe(1);
    // The parent back-reference anytree provides
    expect(atRoots[0]!.children[0]!.parent).toBe(atRoots[0]);
  });
});

// ===========================================================================
// T032: data_group_id
// ===========================================================================

describe("TestDataGroupIdFlow", () => {
  it("data_group_id=5 is emitted snake_case for flows", async () => {
    const result = await makeWs().buildFlowParams("Login", {
      data_group_id: 5,
    });
    expect(result["data_group_id"]).toBe(5);
  });

  it("omitting data_group_id omits the key", async () => {
    const result = await makeWs().buildFlowParams("Login");
    expect(Object.hasOwn(result, "data_group_id")).toBe(false);
  });
});

// ===========================================================================
// T038: session_event
// ===========================================================================

describe("TestFlowSessionEvent", () => {
  it("session_event='start' is emitted in the step dict", async () => {
    const params = await makeWs().buildFlowParams(
      new FlowStep({ event: "$session_start", session_event: "start" }),
    );
    expect(stepsOf(params)[0]!["session_event"]).toBe("start");
  });

  it("session_event='end' is emitted in the step dict", async () => {
    const params = await makeWs().buildFlowParams(
      new FlowStep({ event: "$session_end", session_event: "end" }),
    );
    expect(stepsOf(params)[0]!["session_event"]).toBe("end");
  });

  it("a regular FlowStep omits the session_event key", async () => {
    const params = await makeWs().buildFlowParams("Login");
    expect(Object.hasOwn(stepsOf(params)[0]!, "session_event")).toBe(false);
  });
});

// ===========================================================================
// T038: segments
// ===========================================================================

describe("TestFlowSegments", () => {
  it("segments=GroupBy('country') produces segments", async () => {
    const params = await makeWs().buildFlowParams("Login", {
      segments: new GroupBy({ property: "country" }),
    });
    expect(Object.hasOwn(params, "segments")).toBe(true);
    const segments = params["segments"] as Array<Record<string, unknown>>;
    expect(Array.isArray(segments)).toBe(true);
    expect(segments.length).toBe(1);
    expect(segments[0]!["value"]).toBe("country");
  });

  it("segments='country' (string shorthand) produces segments", async () => {
    const params = await makeWs().buildFlowParams("Login", {
      segments: "country",
    });
    expect(Object.hasOwn(params, "segments")).toBe(true);
    expect((params["segments"] as unknown[]).length).toBe(1);
  });

  it("a list of GroupBy produces multiple segments", async () => {
    const params = await makeWs().buildFlowParams("Login", {
      segments: [
        new GroupBy({ property: "country" }),
        new GroupBy({ property: "platform" }),
      ],
    });
    expect((params["segments"] as unknown[]).length).toBe(2);
  });

  it("no segments omits the key", async () => {
    const params = await makeWs().buildFlowParams("Login");
    expect(Object.hasOwn(params, "segments")).toBe(false);
  });
});

// ===========================================================================
// T038: exclusions
// ===========================================================================

describe("TestFlowExclusions", () => {
  it("a single exclusion produces the exclusions list", async () => {
    const params = await makeWs().buildFlowParams("Login", {
      exclusions: ["Error Event"],
    });
    expect(params["exclusions"]).toEqual(["Error Event"]);
  });

  it("multiple exclusions all appear", async () => {
    const params = await makeWs().buildFlowParams("Login", {
      exclusions: ["Error", "Debug", "Test"],
    });
    expect(params["exclusions"]).toEqual(["Error", "Debug", "Test"]);
  });

  it("no exclusions produce an empty list", async () => {
    const params = await makeWs().buildFlowParams("Login");
    expect(params["exclusions"]).toEqual([]);
  });
});

// ===========================================================================
// T038: property filters (filter_by_event)
// ===========================================================================

describe("TestFlowPropertyFilters", () => {
  it("where=Filter.equals produces filter_by_event", async () => {
    const params = await makeWs().buildFlowParams("Login", {
      where: Filter.equals("country", "US"),
    });
    expect(Object.hasOwn(params, "filter_by_event")).toBe(true);
    const fbe = params["filter_by_event"] as Record<string, unknown>;
    expect(fbe["operator"]).toBe("and");
    const children = fbe["children"] as Array<Record<string, unknown>>;
    expect(children.length).toBe(1);
    expect(children[0]!["filterOperator"]).toBe("equals");
    expect(children[0]!["propertyName"]).toBe("country");
    expect(children[0]!["filterValue"]).toEqual(["US"]);
  });

  it("a list of property filters produces a children array", async () => {
    const params = await makeWs().buildFlowParams("Login", {
      where: [Filter.equals("country", "US"), Filter.greaterThan("age", 18)],
    });
    const fbe = params["filter_by_event"] as Record<string, unknown>;
    expect((fbe["children"] as unknown[]).length).toBe(2);
  });

  it("a cohort filter still produces filter_by_cohort", async () => {
    const params = await makeWs().buildFlowParams("Login", {
      where: Filter.inCohort(123, "Power Users"),
    });
    expect(Object.hasOwn(params, "filter_by_cohort")).toBe(true);
    expect(Object.hasOwn(params, "filter_by_event")).toBe(false);
  });

  it("no where produces neither filter key", async () => {
    const params = await makeWs().buildFlowParams("Login");
    expect(Object.hasOwn(params, "filter_by_event")).toBe(false);
    expect(Object.hasOwn(params, "filter_by_cohort")).toBe(false);
  });
});
