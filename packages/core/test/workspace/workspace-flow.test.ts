// Workspace flow queries: buildFlowParams (filters, multi-step normalization,
// anchor/direction/datetime rules, segments, exclusions), the public queryFlow
// methods and the tree round-trip. Mirrors all 13 classes of
// tests/unit/test_workspace_flow.py; `_build_flow_params` is the exported
// buildFlowParams, `ws._live_query = MagicMock()` a stubbed arbFunnelsQuery.

import { describe, expect, it } from "vitest";

import { Filter } from "../../src/types/query-params/filter.js";
import { FlowStep } from "../../src/types/query-params/flow.js";
import { GroupBy } from "../../src/types/query-params/group-by.js";
import { FlowTreeNode } from "../../src/types/results/flow-tree.js";
import { FlowQueryResult } from "../../src/types/results/query-engine.js";
import { buildFlowParams } from "../../src/workspace-query-params.js";
import {
  makeStubWorkspace,
  mockWorkspaceClient,
} from "../../test-support/workspace-test-helpers.js";

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

// --- _build_flow_params ---

describe("Build flow params", () => {
  // python: TestBuildFlowParams
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
    expect(dr["from_date"]).toStrictEqual({ unit: "day", value: 30 });
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
        new FlowStep({
          event: "Purchase",
          forward: 2,
          reverse: 1,
          label: "Buy",
        }),
      ],
    });
    const step = stepsOf(params)[0]!;
    expect(step["event"]).toBe("Purchase");
    expect(step["step_label"]).toBe("Buy");
    expect(step["forward"]).toBe(2);
    expect(step["reverse"]).toBe(1);
    expect(step["bool_op"]).toBe("and");
    expect(step["property_filter_params_list"]).toStrictEqual([]);
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
    expect(params["hidden_events"]).toStrictEqual(["X"]);
  });

  it("a custom conversion window shows in the output", () => {
    const params = buildFlowParams({
      ...BASE_BUILD,
      steps: [new FlowStep({ event: "Login" })],
      conversion_window: 14,
      conversion_window_unit: "week",
    });
    expect(params["conversion_window"]).toStrictEqual({
      unit: "week",
      value: 14,
    });
  });
});

// --- Filter integration in _build_flow_params ---

describe("Build flow params filters", () => {
  // python: TestBuildFlowParamsFilters
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
    expect(pf).toHaveLength(1);
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
    expect(stepsOf(params)[0]!["property_filter_params_list"]).toStrictEqual(
      [],
    );
  });
});

// --- Workspace public methods ---

describe("Workspace flow public methods", () => {
  // python: TestWorkspaceFlowPublicMethods
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

    const result = await makeStubWorkspace(mock).queryFlow("Login");

    expect(result).toBeInstanceOf(FlowQueryResult);
    expect(result.computed_at).toBe("2025-01-15T10:00:00");
    expect(mock.arbFunnelsCalls).toHaveLength(1);
    const body = mock.arbFunnelsCalls[0]!;
    expect(body["project_id"]).toBe(12345);
    expect(body["query_type"]).toBe("flows_sankey"); // mode="sankey"
    expect(Object.hasOwn(body, "bookmark")).toBe(true);
  });

  it("build_flow_params returns a dict without an API call", async () => {
    const mock = mockWorkspaceClient();
    const params = await makeStubWorkspace(mock).buildFlowParams("Login");

    expect(typeof params).toBe("object");
    expect(Object.hasOwn(params, "steps")).toBe(true);
    expect(Object.hasOwn(params, "date_range")).toBe(true);
    expect(Object.hasOwn(params, "chartType")).toBe(true);
    expect(params["version"]).toBe(2);
    expect(mock.arbFunnelsCalls).toHaveLength(0);
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

    const result = await makeStubWorkspace(mock).queryFlow(
      new FlowStep({ event: "Login", forward: 5, reverse: 2 }),
    );

    expect(result).toBeInstanceOf(FlowQueryResult);
    expect(mock.arbFunnelsCalls).toHaveLength(1);
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

    const result = await makeStubWorkspace(mock).queryFlow(
      ["Login", "Purchase"],
      {
        mode: "paths",
      },
    );

    expect(result).toBeInstanceOf(FlowQueryResult);
    expect(mock.arbFunnelsCalls[0]!["query_type"]).toBe("flows_top_paths");
    expect(result.mode).toBe("paths");
  });
});

// --- Multi-step normalization ---

describe("Multi step normalization", () => {
  // python: TestMultiStepNormalization
  it("a list of strings produces N steps with the defaults", async () => {
    const params = await makeStubWorkspace().buildFlowParams(["A", "B"]);
    const steps = stepsOf(params);
    expect(steps).toHaveLength(2);
    expect(steps[0]!["event"]).toBe("A");
    expect(steps[1]!["event"]).toBe("B");
    // Top-level defaults: forward=3, reverse=0
    expect(steps[0]!["forward"]).toBe(3);
    expect(steps[0]!["reverse"]).toBe(0);
    expect(steps[1]!["forward"]).toBe(3);
    expect(steps[1]!["reverse"]).toBe(0);
  });

  it("a list of FlowSteps preserves per-step forward/reverse", async () => {
    const params = await makeStubWorkspace().buildFlowParams([
      new FlowStep({ event: "A", forward: 3 }),
      new FlowStep({ event: "B", reverse: 2 }),
    ]);
    const steps = stepsOf(params);
    expect(steps).toHaveLength(2);
    expect(steps[0]!["event"]).toBe("A");
    expect(steps[0]!["forward"]).toBe(3);
    expect(steps[1]!["event"]).toBe("B");
    expect(steps[1]!["reverse"]).toBe(2);
  });

  it("a mixed list works correctly", async () => {
    const params = await makeStubWorkspace().buildFlowParams([
      "A",
      new FlowStep({ event: "B", forward: 1 }),
    ]);
    const steps = stepsOf(params);
    expect(steps).toHaveLength(2);
    expect(steps[0]!["event"]).toBe("A");
    expect(steps[0]!["forward"]).toBe(3);
    expect(steps[0]!["reverse"]).toBe(0);
    expect(steps[1]!["event"]).toBe("B");
    expect(steps[1]!["forward"]).toBe(1);
  });

  it("a single string wraps into a one-element list", async () => {
    const params = await makeStubWorkspace().buildFlowParams("Purchase");
    const steps = stepsOf(params);
    expect(steps).toHaveLength(1);
    expect(steps[0]!["event"]).toBe("Purchase");
  });

  it("a single FlowStep wraps into a one-element list", async () => {
    const params = await makeStubWorkspace().buildFlowParams(
      new FlowStep({ event: "A", forward: 3 }),
    );
    const steps = stepsOf(params);
    expect(steps).toHaveLength(1);
    expect(steps[0]!["event"]).toBe("A");
    expect(steps[0]!["forward"]).toBe(3);
  });

  it("string steps inherit the top-level defaults", async () => {
    const params = await makeStubWorkspace().buildFlowParams(["X", "Y"], {
      forward: 5,
      reverse: 2,
    });
    for (const step of stepsOf(params)) {
      expect(step["forward"]).toBe(5);
      expect(step["reverse"]).toBe(2);
    }
  });

  it("explicit FlowStep values override the top-level defaults", async () => {
    const params = await makeStubWorkspace().buildFlowParams(
      new FlowStep({ event: "A", forward: 5, reverse: 4 }),
      { forward: 3, reverse: 0 },
    );
    const step = stepsOf(params)[0]!;
    expect(step["forward"]).toBe(5);
    expect(step["reverse"]).toBe(4);
  });

  it("a FlowStep with null values inherits the defaults", async () => {
    const params = await makeStubWorkspace().buildFlowParams(
      new FlowStep({ event: "A" }),
      { forward: 5, reverse: 2 },
    );
    const step = stepsOf(params)[0]!;
    expect(step["forward"]).toBe(5);
    expect(step["reverse"]).toBe(2);
  });
});

// --- anchor_position ---

describe("Multi step anchor position", () => {
  // python: TestMultiStepAnchorPosition
  it("anchor_position is 1", async () => {
    const params = await makeStubWorkspace().buildFlowParams("Login");
    expect(params["anchor_position"]).toBe(1);
  });
});

// --- FL5 respects per-step overrides ---

describe("Per step direction validation", () => {
  // python: TestPerStepDirectionValidation
  it("a per-step forward override is not rejected when top-level is 0", async () => {
    const params = await makeStubWorkspace().buildFlowParams(
      new FlowStep({ event: "Login", forward: 3 }),
      { forward: 0, reverse: 0 },
    );
    const step = stepsOf(params)[0]!;
    expect(step["forward"]).toBe(3);
    expect(step["reverse"]).toBe(0);
  });

  it("FL5 still rejects when no step has a non-zero direction", async () => {
    await expect(
      makeStubWorkspace().buildFlowParams(new FlowStep({ event: "Login" }), {
        forward: 0,
        reverse: 0,
      }),
    ).rejects.toThrow(/forward or reverse must be > 0/);
  });

  it("an out-of-union filters_combinator is still rejected at runtime (8.11 guard retained)", async () => {
    // The type says "all" | "any"; the guard exists for untyped callers
    // (Python raises for anything else) and must survive the lint sweep.
    await expect(
      makeStubWorkspace().buildFlowParams(
        new FlowStep({
          event: "Login",
          forward: 3,
          filters_combinator: "xor" as never,
        }),
      ),
    ).rejects.toThrow(
      /filters_combinator must be 'all' or 'any' \(got 'xor'\)/,
    );
  });

  it("mixed per-step overrides pass when one direction is > 0", async () => {
    const params = await makeStubWorkspace().buildFlowParams(
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

// --- Datetime filter -> segfilter operator mapping ---

describe("Flow step datetime filters", () => {
  // python: TestFlowStepDatetimeFilters
  it("Filter.before produces segfilter operator '>'", async () => {
    const params = await makeStubWorkspace().buildFlowParams(
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
    const params = await makeStubWorkspace().buildFlowParams(
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

// --- End-to-end tree mode ---

/** `_sample_tree_api_response()` . */
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

describe("Query flow tree integration", () => {
  // python: TestQueryFlowTreeIntegration
  it("query_flow(mode='tree') returns a structured result", async () => {
    const mock = mockWorkspaceClient();
    mock.setArbFunnelsResponse(sampleTreeApiResponse());

    const result = await makeStubWorkspace(mock).queryFlow("Login", {
      mode: "tree",
    });

    expect(result).toBeInstanceOf(FlowQueryResult);
    expect(result.mode).toBe("tree");
    expect(result.trees).toHaveLength(1);

    const root = result.trees[0]!;
    expect(root).toBeInstanceOf(FlowTreeNode);
    expect(root.event).toBe("Login");
    expect(root.total_count).toBe(100);
    expect(root.drop_off_count).toBe(20);
    expect(root.converted_count).toBe(80);

    expect(root.children).toHaveLength(1);
    expect(root.children[0]!.event).toBe("Search");
    expect(root.children[0]!.total_count).toBe(80);

    // Frame rows work
    const rows = result.toRows();
    expect(rows).toHaveLength(root.node_count);
    expect(result.rowColumns()).toContain("path");
    expect(rows.map((r) => r["path"])).toContain("Login > Search");

    // toJSON is serializable
    const d = result.toJSON();
    const trees = d["trees"] as Array<Record<string, unknown>>;
    expect(trees).toHaveLength(1);
    expect(trees[0]!["event"]).toBe("Login");

    // The anytree view of the same tree.
    const atRoots = result.anytree();
    expect(atRoots).toHaveLength(1);
    expect(atRoots[0]!.event).toBe("Login");
    expect(atRoots[0]!.children).toHaveLength(1);
    // The parent back-reference anytree provides
    expect(atRoots[0]!.children[0]!.parent).toBe(atRoots[0]);
  });
});

// --- data_group_id ---

describe("Data group ID flow", () => {
  // python: TestDataGroupIdFlow
  it("data_group_id=5 is emitted snake_case for flows", async () => {
    const result = await makeStubWorkspace().buildFlowParams("Login", {
      data_group_id: 5,
    });
    expect(result["data_group_id"]).toBe(5);
  });

  it("omitting data_group_id omits the key", async () => {
    const result = await makeStubWorkspace().buildFlowParams("Login");
    expect(Object.hasOwn(result, "data_group_id")).toBe(false);
  });
});

// --- session_event ---

describe("Flow session event", () => {
  // python: TestFlowSessionEvent
  it("session_event='start' is emitted in the step dict", async () => {
    const params = await makeStubWorkspace().buildFlowParams(
      new FlowStep({ event: "$session_start", session_event: "start" }),
    );
    expect(stepsOf(params)[0]!["session_event"]).toBe("start");
  });

  it("session_event='end' is emitted in the step dict", async () => {
    const params = await makeStubWorkspace().buildFlowParams(
      new FlowStep({ event: "$session_end", session_event: "end" }),
    );
    expect(stepsOf(params)[0]!["session_event"]).toBe("end");
  });

  it("a regular FlowStep omits the session_event key", async () => {
    const params = await makeStubWorkspace().buildFlowParams("Login");
    expect(Object.hasOwn(stepsOf(params)[0]!, "session_event")).toBe(false);
  });
});

// --- Segments ---

describe("Flow segments", () => {
  // python: TestFlowSegments
  it("segments=GroupBy('country') produces segments", async () => {
    const params = await makeStubWorkspace().buildFlowParams("Login", {
      segments: new GroupBy({ property: "country" }),
    });
    expect(Object.hasOwn(params, "segments")).toBe(true);
    const segments = params["segments"] as Array<Record<string, unknown>>;
    expect(Array.isArray(segments)).toBe(true);
    expect(segments).toHaveLength(1);
    expect(segments[0]!["value"]).toBe("country");
  });

  it("segments='country' (string shorthand) produces segments", async () => {
    const params = await makeStubWorkspace().buildFlowParams("Login", {
      segments: "country",
    });
    expect(Object.hasOwn(params, "segments")).toBe(true);
    expect(params["segments"] as unknown[]).toHaveLength(1);
  });

  it("a list of GroupBy produces multiple segments", async () => {
    const params = await makeStubWorkspace().buildFlowParams("Login", {
      segments: [
        new GroupBy({ property: "country" }),
        new GroupBy({ property: "platform" }),
      ],
    });
    expect(params["segments"] as unknown[]).toHaveLength(2);
  });

  it("no segments omits the key", async () => {
    const params = await makeStubWorkspace().buildFlowParams("Login");
    expect(Object.hasOwn(params, "segments")).toBe(false);
  });
});

// --- Exclusions ---

describe("Flow exclusions", () => {
  // python: TestFlowExclusions
  it("a single exclusion produces the exclusions list", async () => {
    const params = await makeStubWorkspace().buildFlowParams("Login", {
      exclusions: ["Error Event"],
    });
    expect(params["exclusions"]).toStrictEqual(["Error Event"]);
  });

  it("multiple exclusions all appear", async () => {
    const params = await makeStubWorkspace().buildFlowParams("Login", {
      exclusions: ["Error", "Debug", "Test"],
    });
    expect(params["exclusions"]).toStrictEqual(["Error", "Debug", "Test"]);
  });

  it("no exclusions produce an empty list", async () => {
    const params = await makeStubWorkspace().buildFlowParams("Login");
    expect(params["exclusions"]).toStrictEqual([]);
  });
});

// --- Property filters (filter_by_event) ---

describe("Flow property filters", () => {
  // python: TestFlowPropertyFilters
  it("where=Filter.equals produces filter_by_event", async () => {
    const params = await makeStubWorkspace().buildFlowParams("Login", {
      where: Filter.equals("country", "US"),
    });
    expect(Object.hasOwn(params, "filter_by_event")).toBe(true);
    const fbe = params["filter_by_event"] as Record<string, unknown>;
    expect(fbe["operator"]).toBe("and");
    const children = fbe["children"] as Array<Record<string, unknown>>;
    expect(children).toHaveLength(1);
    expect(children[0]!["filterOperator"]).toBe("equals");
    expect(children[0]!["propertyName"]).toBe("country");
    expect(children[0]!["filterValue"]).toStrictEqual(["US"]);
  });

  it("a list of property filters produces a children array", async () => {
    const params = await makeStubWorkspace().buildFlowParams("Login", {
      where: [Filter.equals("country", "US"), Filter.greaterThan("age", 18)],
    });
    const fbe = params["filter_by_event"] as Record<string, unknown>;
    expect(fbe["children"] as unknown[]).toHaveLength(2);
  });

  it("a cohort filter still produces filter_by_cohort", async () => {
    const params = await makeStubWorkspace().buildFlowParams("Login", {
      where: Filter.inCohort(123, "Power Users"),
    });
    expect(Object.hasOwn(params, "filter_by_cohort")).toBe(true);
    expect(Object.hasOwn(params, "filter_by_event")).toBe(false);
  });

  it("no where produces neither filter key", async () => {
    const params = await makeStubWorkspace().buildFlowParams("Login");
    expect(Object.hasOwn(params, "filter_by_event")).toBe(false);
    expect(Object.hasOwn(params, "filter_by_cohort")).toBe(false);
  });
});
