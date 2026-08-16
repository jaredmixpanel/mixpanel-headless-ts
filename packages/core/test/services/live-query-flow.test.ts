// Translated flow-query tests (B5-S2, packet §3): assertion-for-
// assertion port of tests/unit/test_live_query_flow.py (R10.2) — ALL 6
// classes (TestArbFunnelsQuery :88, TestTransformFlowResult :134,
// TestQueryFlow :189, TestParseTreeNode :326,
// TestTransformFlowResultTree :417, TestQueryFlowTree :455).
//
// Translation notes:
// - Python uses `MagicMock(spec=MixpanelAPIClient)` rather than a
//   transport mock, so the TS twin is {@link mockClient}: a stub object
//   carrying ONLY the client members `LiveQueryService.queryFlow`
//   touches (`arbFunnelsQuery`) plus a call log. The
//   `assert_called_once_with` / `call_args[0][0]` asserts read that log.
// - `_transform_flow_result` / `_parse_tree_node` are
//   {@link transformFlowResult} / {@link parseTreeNode} in
//   `services/live-query-transforms.ts` (R7.2 split).
// - Python's `children` is a TUPLE; the TS field is a readonly array, so
//   `node.children == ()` becomes `toEqual([])`.
// - `TestArbFunnelsQuery`'s three cases assert on the MagicMock itself
//   (they never touch library code — `test_query_type_sankey` /
//   `..._top_paths` are pure dict-literal asserts). They translate
//   verbatim against the same stub so the class stays complete (A-F2).

import { describe, expect, it } from "vitest";
import { LiveQueryService } from "../../src/services/live-query.js";
import {
  parseTreeNode,
  transformFlowResult,
} from "../../src/services/live-query-transforms.js";
import { QueryError } from "../../src/errors.js";
import { FlowQueryResult } from "../../src/types/results/query-engine.js";
import type { MixpanelClient } from "../../src/client/client.js";
import type { JsonValue } from "../../src/client/json-value.js";

// ===========================================================================
// Fixtures (test_live_query_flow.py:22-79)
// ===========================================================================

/** The `MagicMock(spec=MixpanelAPIClient)` twin plus its call log. */
interface MockApiClient {
  /** The stub cast to the client type the service consumes. */
  readonly client: MixpanelClient;
  /** Every `arbFunnelsQuery` body, in call order. */
  readonly arbFunnelsCalls: Array<Record<string, unknown>>;
  /** Set the value the next `arbFunnelsQuery` resolves with. */
  setReturnValue(value: unknown): void;
}

/**
 * The `mock_api_client` fixture (test_live_query_flow.py:27-30).
 *
 * @returns The stub client plus its call log.
 */
function mockClient(): MockApiClient {
  const arbFunnelsCalls: Array<Record<string, unknown>> = [];
  let returnValue: unknown = {};
  const stub = {
    arbFunnelsQuery: (body: Record<string, unknown>): Promise<JsonValue> => {
      arbFunnelsCalls.push(body);
      return Promise.resolve(returnValue as JsonValue);
    },
  };
  return {
    client: stub as unknown as MixpanelClient,
    arbFunnelsCalls,
    setReturnValue(value: unknown): void {
      returnValue = value;
    },
  };
}

/** Build a sample sankey flow API response (`_sample_sankey_response`). */
function sampleSankeyResponse(): Record<string, unknown> {
  return {
    computed_at: "2025-01-15T10:00:00",
    steps: [
      { event: "Login", count: 100 },
      { event: "Purchase", count: 30 },
    ],
    breakdowns: [{ name: "country", values: ["US", "UK"] }],
    overallConversionRate: 0.3,
    metadata: { sampling_factor: 1.0 },
  };
}

/** Build a sample top-paths response (`_sample_top_paths_response`). */
function sampleTopPathsResponse(): Record<string, unknown> {
  return {
    computed_at: "2025-01-15T10:00:00",
    flows: [
      { path: ["Login", "Purchase"], count: 30 },
      { path: ["Login", "Signup"], count: 20 },
    ],
    steps: [],
    breakdowns: [],
    overallConversionRate: 0.5,
    metadata: {},
  };
}

/** Build sample bookmark params (`_sample_bookmark_params`). */
function sampleBookmarkParams(): Record<string, unknown> {
  return {
    steps: [{ event: "Login", forward: 3, reverse: 0 }],
    date_range: {
      type: "in the last",
      from_date: { unit: "day", value: 30 },
      to_date: "$now",
    },
    chartType: "sankey",
    count_type: "unique",
    version: 2,
  };
}

/** Build a sample tree flow API response (`_sample_tree_response`). */
function sampleTreeResponse(): Record<string, unknown> {
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
              children: [
                {
                  step: {
                    type: "ANCHOR",
                    step_number: 2,
                    event: "Purchase",
                    is_computed: false,
                    anchor_type: "NORMAL",
                  },
                  children: [],
                  total_count: 40,
                  drop_off_total_count: 0,
                  converted_total_count: 40,
                },
              ],
              total_count: 80,
              drop_off_total_count: 10,
              converted_total_count: 70,
            },
            {
              step: {
                type: "DROPOFF",
                step_number: 1,
                event: "DROPOFF",
                is_computed: false,
                anchor_type: "NORMAL",
              },
              children: [],
              total_count: 20,
              drop_off_total_count: 20,
              converted_total_count: 0,
            },
          ],
          total_count: 100,
          drop_off_total_count: 20,
          converted_total_count: 80,
        },
        num_steps: 3,
        segments: { segments: [] },
      },
    ],
    metadata: { min_sampling_factor: 1 },
  };
}

/**
 * The root node of the sample tree response.
 *
 * @returns The `trees[0].root` record.
 */
function sampleTreeRoot(): Record<string, unknown> {
  const trees = sampleTreeResponse()["trees"] as Array<
    Record<string, unknown>
  >;
  return trees[0]!["root"] as Record<string, unknown>;
}

// ===========================================================================
// T024: TestArbFunnelsQuery — API client method
// ===========================================================================

describe("TestArbFunnelsQuery", () => {
  it("POSTs the body to the /arb_funnels endpoint", async () => {
    const mock = mockClient();
    mock.setReturnValue(sampleSankeyResponse());
    const body: Record<string, unknown> = {
      bookmark: sampleBookmarkParams(),
      project_id: 12345,
      query_type: "flows_sankey",
    };

    const result = (await mock.client.arbFunnelsQuery(body)) as Record<
      string,
      unknown
    >;

    expect(mock.arbFunnelsCalls.length).toBe(1);
    expect(mock.arbFunnelsCalls[0]).toEqual(body);
    expect(Object.hasOwn(result, "computed_at")).toBe(true);
  });

  it("sankey mode uses query_type='flows_sankey'", () => {
    const body: Record<string, unknown> = {
      bookmark: sampleBookmarkParams(),
      project_id: 12345,
      query_type: "flows_sankey",
    };
    expect(body["query_type"]).toBe("flows_sankey");
  });

  it("paths mode uses query_type='flows_top_paths'", () => {
    const body: Record<string, unknown> = {
      bookmark: sampleBookmarkParams(),
      project_id: 12345,
      query_type: "flows_top_paths",
    };
    expect(body["query_type"]).toBe("flows_top_paths");
  });
});

// ===========================================================================
// T026: TestTransformFlowResult
// ===========================================================================

describe("TestTransformFlowResult", () => {
  it("sankey response extracts steps, breakdowns, conversion rate", () => {
    const raw = sampleSankeyResponse();
    const bookmark = sampleBookmarkParams();

    const result = transformFlowResult(raw, bookmark, "sankey");

    expect(result).toBeInstanceOf(FlowQueryResult);
    expect(result.computed_at).toBe("2025-01-15T10:00:00");
    expect(result.steps.length).toBe(2);
    expect(result.steps[0]!["event"]).toBe("Login");
    expect(result.breakdowns.length).toBe(1);
    expect(result.overall_conversion_rate).toBe(0.3);
    expect(result.mode).toBe("sankey");
    expect(result.meta).toEqual({ sampling_factor: 1.0 });
  });

  it("top-paths response extracts the flows field", () => {
    const raw = sampleTopPathsResponse();
    const bookmark = sampleBookmarkParams();

    const result = transformFlowResult(raw, bookmark, "paths");

    expect(result).toBeInstanceOf(FlowQueryResult);
    expect(result.flows.length).toBe(2);
    expect(result.flows[0]!["path"]).toEqual(["Login", "Purchase"]);
    expect(result.overall_conversion_rate).toBe(0.5);
    expect(result.mode).toBe("paths");
  });

  it("response with 'error' raises QueryError", () => {
    const raw: Record<string, unknown> = { error: "Invalid query parameters" };
    const bookmark = sampleBookmarkParams();

    expect(() => transformFlowResult(raw, bookmark, "sankey")).toThrow(
      /Invalid query parameters/,
    );
  });

  it("bookmark params are preserved in the result", () => {
    const raw = sampleSankeyResponse();
    const bookmark = sampleBookmarkParams();

    const result = transformFlowResult(raw, bookmark, "sankey");

    expect(result.params).toEqual(bookmark);
  });
});

// ===========================================================================
// T027: TestQueryFlow
// ===========================================================================

describe("TestQueryFlow", () => {
  it("calls arb_funnels_query with the correct body", async () => {
    const mock = mockClient();
    mock.setReturnValue(sampleSankeyResponse());
    const live = new LiveQueryService(mock.client);
    const bookmark = sampleBookmarkParams();

    const result = await live.queryFlow(bookmark, 12345, "sankey");

    expect(mock.arbFunnelsCalls.length).toBe(1);
    const body = mock.arbFunnelsCalls[0]!;
    expect(body["bookmark"]).toEqual(bookmark);
    expect(body["project_id"]).toBe(12345);
    expect(body["query_type"]).toBe("flows_sankey");

    expect(result).toBeInstanceOf(FlowQueryResult);
    expect(result.computed_at).toBe("2025-01-15T10:00:00");
  });

  it("paths mode uses query_type='flows_top_paths'", async () => {
    const mock = mockClient();
    mock.setReturnValue(sampleTopPathsResponse());
    const live = new LiveQueryService(mock.client);

    await live.queryFlow(sampleBookmarkParams(), 12345, "paths");

    expect(mock.arbFunnelsCalls[0]!["query_type"]).toBe("flows_top_paths");
  });

  it("error-as-200 response raises QueryError", async () => {
    const mock = mockClient();
    mock.setReturnValue({ error: "Bad params" });
    const live = new LiveQueryService(mock.client);

    await expect(
      live.queryFlow(sampleBookmarkParams(), 12345, "sankey"),
    ).rejects.toThrow(/Bad params/);
  });
});

// ===========================================================================
// TestParseTreeNode
// ===========================================================================

describe("TestParseTreeNode", () => {
  it("extracts event, type and counts from the root dict", () => {
    const node = parseTreeNode(sampleTreeRoot());

    expect(node.event).toBe("Login");
    expect(node.type).toBe("ANCHOR");
    expect(node.step_number).toBe(0);
    expect(node.total_count).toBe(100);
    expect(node.drop_off_count).toBe(20);
    expect(node.converted_count).toBe(80);
    expect(node.anchor_type).toBe("NORMAL");
    expect(node.is_computed).toBe(false);
  });

  it("builds recursive children", () => {
    const node = parseTreeNode(sampleTreeRoot());

    expect(node.children.length).toBe(2);
    expect(node.children[0]!.event).toBe("Search");
    expect(node.children[0]!.total_count).toBe(80);
    expect(node.children[0]!.children.length).toBe(1);
    expect(node.children[0]!.children[0]!.event).toBe("Purchase");
  });

  it("handles leaf nodes with empty children", () => {
    const leafRaw: Record<string, unknown> = {
      step: {
        type: "DROPOFF",
        step_number: 1,
        event: "DROPOFF",
        is_computed: false,
        anchor_type: "NORMAL",
      },
      children: [],
      total_count: 20,
      drop_off_total_count: 20,
      converted_total_count: 0,
    };
    const node = parseTreeNode(leafRaw);
    expect(node.children).toEqual([]);
    expect(node.total_count).toBe(20);
  });

  it("extracts the time-percentile dicts", () => {
    const raw: Record<string, unknown> = {
      step: {
        type: "NORMAL",
        step_number: 1,
        event: "Search",
        is_computed: false,
        anchor_type: "NORMAL",
      },
      children: [],
      total_count: 50,
      drop_off_total_count: 5,
      converted_total_count: 45,
      time_percentiles_from_start: {
        percentiles: [50, 90],
        values: [1.2, 5.8],
      },
      time_percentiles_from_prev: { percentiles: [50], values: [0.5] },
    };
    const node = parseTreeNode(raw);
    expect(node.time_percentiles_from_start["percentiles"]).toEqual([50, 90]);
    expect(node.time_percentiles_from_prev["values"]).toEqual([0.5]);
  });
});

// ===========================================================================
// TestTransformFlowResultTree
// ===========================================================================

describe("TestTransformFlowResultTree", () => {
  it("tree mode parses trees into a FlowTreeNode list", () => {
    const result = transformFlowResult(
      sampleTreeResponse(),
      sampleBookmarkParams(),
      "tree",
    );

    expect(result).toBeInstanceOf(FlowQueryResult);
    expect(result.mode).toBe("tree");
    expect(result.trees.length).toBe(1);
    expect(result.trees[0]!.event).toBe("Login");
    expect(result.trees[0]!.total_count).toBe(100);
  });

  it("tree mode gracefully handles a missing 'trees' key", () => {
    const raw: Record<string, unknown> = {
      computed_at: "2025-01-15T10:00:00",
      metadata: {},
    };

    const result = transformFlowResult(raw, sampleBookmarkParams(), "tree");

    expect(result.mode).toBe("tree");
    expect(result.trees).toEqual([]);
  });

  it("error-as-200 still raises QueryError in tree mode", () => {
    const raw: Record<string, unknown> = { error: "Invalid tree query" };

    expect(() =>
      transformFlowResult(raw, sampleBookmarkParams(), "tree"),
    ).toThrow(/Invalid tree query/);
  });
});

// ===========================================================================
// TestQueryFlowTree
// ===========================================================================

describe("TestQueryFlowTree", () => {
  it("tree mode uses query_type='flows'", async () => {
    const mock = mockClient();
    mock.setReturnValue(sampleTreeResponse());
    const live = new LiveQueryService(mock.client);

    await live.queryFlow(sampleBookmarkParams(), 12345, "tree");

    expect(mock.arbFunnelsCalls[0]!["query_type"]).toBe("flows");
  });

  it("tree mode returns a FlowQueryResult with populated trees", async () => {
    const mock = mockClient();
    mock.setReturnValue(sampleTreeResponse());
    const live = new LiveQueryService(mock.client);

    const result = await live.queryFlow(
      sampleBookmarkParams(),
      12345,
      "tree",
    );

    expect(result).toBeInstanceOf(FlowQueryResult);
    expect(result.mode).toBe("tree");
    expect(result.trees.length).toBe(1);
    expect(result.trees[0]!.event).toBe("Login");
  });
});
