// Translated FlowQueryResult tests (packet P2-6):
// assertion-for-assertion port of tests/test_types_flow.py
// (TestFlowQueryResultConstruction / ToDict / NodesDf / EdgesDf /
// DfModeAware / TopTransitions / DropOffSummary / TestSafeInt) —
// R10.2.
//
// Not ported: immutability suites (compile-time `readonly`);
// TestFlowQueryResultGraph (networkx — TODO(port) batch B5, see
// replays/query-engine module docs); TestRenameVerification
// (Workspace surface, batch B6); the `warnings.warn` side-channel
// assertions of TestSafeInt (out of contract — return values are
// asserted). The FlowStep suites of this file were translated by
// P2-5c.
import { describe, expect, it } from "vitest";
import {
  FlowQueryResult,
  safeInt,
  type FlowQueryResultFields,
} from "../../../src/types/results/query-engine.js";

/** Build a default-valid FlowQueryResult (Python `_make_result`). */
function makeResult(
  overrides: Partial<FlowQueryResultFields> = {},
): FlowQueryResult {
  return new FlowQueryResult({
    computed_at: "2025-01-15T10:00:00",
    steps: [],
    flows: [],
    breakdowns: [],
    overall_conversion_rate: 0.0,
    params: {},
    meta: {},
    mode: "sankey",
    ...overrides,
  });
}

/** Sample sankey steps (Python `_sample_sankey_steps`). */
function sampleSankeySteps(): ReadonlyArray<Record<string, unknown>> {
  return [
    {
      nodes: [
        {
          event: "Login",
          type: "ANCHOR",
          anchorType: "NORMAL",
          totalCount: "100",
          isComputed: false,
          isCustomEvent: false,
          conversionRateChange: 0.0,
          edges: [
            { event: "Search", type: "NORMAL", step: 1, totalCount: "80" },
            { event: "DROPOFF", type: "DROPOFF", step: 1, totalCount: "20" },
          ],
        },
      ],
    },
    {
      nodes: [
        {
          event: "Search",
          type: "NORMAL",
          anchorType: "NORMAL",
          totalCount: "80",
          isComputed: false,
          isCustomEvent: false,
          conversionRateChange: -0.2,
          edges: [
            { event: "Purchase", type: "NORMAL", step: 2, totalCount: "50" },
          ],
        },
      ],
    },
  ];
}

/** Sample top-paths flows (Python `_sample_top_paths_flows`). */
function sampleTopPathsFlows(): ReadonlyArray<Record<string, unknown>> {
  return [
    {
      flowSteps: [
        { event: "Login", type: "ANCHOR", totalCount: "100" },
        { event: "Search", type: "NORMAL", totalCount: "80" },
      ],
      segments: [],
    },
    {
      flowSteps: [
        { event: "Login", type: "ANCHOR", totalCount: "100" },
        { event: "Browse", type: "NORMAL", totalCount: "20" },
      ],
      segments: [],
    },
  ];
}

describe("FlowQueryResult construction (TestFlowQueryResultConstruction)", () => {
  it("test_construct_with_defaults", () => {
    const r = makeResult();
    expect(r.computed_at).toBe("2025-01-15T10:00:00");
    expect(r.steps).toEqual([]);
    expect(r.flows).toEqual([]);
    expect(r.breakdowns).toEqual([]);
    expect(r.overall_conversion_rate).toBe(0.0);
    expect(r.params).toEqual({});
    expect(r.meta).toEqual({});
    expect(r.mode).toBe("sankey");
  });

  it("test_construct_with_overrides", () => {
    const r = makeResult({
      computed_at: "2025-02-01T12:00:00",
      steps: [{ event: "Login" }],
      flows: [{ path: ["Login", "Purchase"] }],
      breakdowns: [{ name: "country" }],
      overall_conversion_rate: 0.75,
      params: { sections: {} },
      meta: { sampling_factor: 1.0 },
      mode: "paths",
    });
    expect(r.computed_at).toBe("2025-02-01T12:00:00");
    expect(r.steps).toHaveLength(1);
    expect(r.flows).toHaveLength(1);
    expect(r.breakdowns).toHaveLength(1);
    expect(r.overall_conversion_rate).toBe(0.75);
    expect(Object.hasOwn(r.params, "sections")).toBe(true);
    expect(r.meta["sampling_factor"]).toBe(1.0);
    expect(r.mode).toBe("paths");
  });

  it("test_default_mode_is_sankey", () => {
    expect(makeResult().mode).toBe("sankey");
  });

  it("test_steps_default_empty_list", () => {
    expect(new FlowQueryResult({ computed_at: "" }).steps).toEqual([]);
  });

  it("test_flows_default_empty_list", () => {
    expect(new FlowQueryResult({ computed_at: "" }).flows).toEqual([]);
  });
});

describe("FlowQueryResult.to_dict (TestFlowQueryResultToDict)", () => {
  it("test_to_dict_contains_all_fields", () => {
    const d = makeResult().toJSON();
    for (const key of [
      "computed_at",
      "steps",
      "flows",
      "breakdowns",
      "overall_conversion_rate",
      "params",
      "meta",
      "mode",
    ]) {
      expect(Object.hasOwn(d, key), key).toBe(true);
    }
  });

  it("test_to_dict_values_match_fields", () => {
    const r = makeResult();
    const d = r.toJSON();
    expect(d["computed_at"]).toEqual(r.computed_at);
    expect(d["steps"]).toEqual(r.steps);
    expect(d["flows"]).toEqual(r.flows);
    expect(d["breakdowns"]).toEqual(r.breakdowns);
    expect(d["overall_conversion_rate"]).toEqual(r.overall_conversion_rate);
    expect(d["params"]).toEqual(r.params);
    expect(d["meta"]).toEqual(r.meta);
    expect(d["mode"]).toEqual(r.mode);
  });

  it("test_to_dict_with_populated_data", () => {
    const r = makeResult({
      steps: [
        { event: "Login", count: 100 },
        { event: "Purchase", count: 50 },
      ],
      flows: [{ path: ["Login", "Purchase"], count: 30 }],
      overall_conversion_rate: 0.5,
    });
    const d = r.toJSON();
    const steps = d["steps"] as ReadonlyArray<Record<string, unknown>>;
    const flows = d["flows"] as ReadonlyArray<Record<string, unknown>>;
    expect(steps).toHaveLength(2);
    expect(steps[0]?.["event"]).toBe("Login");
    expect(flows).toHaveLength(1);
    expect(flows[0]?.["count"]).toBe(30);
    expect(d["overall_conversion_rate"]).toBe(0.5);
  });
});

describe("FlowQueryResult.nodes_df (TestFlowQueryResultNodesDf)", () => {
  const expected_cols = [
    "step",
    "event",
    "type",
    "count",
    "anchor_type",
    "is_custom_event",
    "conversion_rate_change",
  ];

  it("test_nodes_df_columns", () => {
    const r = makeResult({ steps: sampleSankeySteps() });
    expect(r.nodesRowColumns()).toEqual(expected_cols);
  });

  it("test_nodes_df_row_count", () => {
    const r = makeResult({ steps: sampleSankeySteps() });
    expect(r.toNodesRows()).toHaveLength(2);
  });

  it("test_nodes_df_empty_steps", () => {
    const r = makeResult({ steps: [] });
    expect(r.toNodesRows()).toHaveLength(0);
    expect(r.nodesRowColumns()).toEqual(expected_cols);
  });

  it("test_nodes_df_total_count_parsed_as_int", () => {
    const r = makeResult({ steps: sampleSankeySteps() });
    const counts = r.toNodesRows().map((row) => row["count"]);
    expect(counts).toEqual([100, 80]);
    for (const count of counts) {
      expect(Number.isInteger(count)).toBe(true);
    }
  });

  it("test_nodes_df_cached (determinism)", () => {
    const r = makeResult({ steps: sampleSankeySteps() });
    expect(r.toNodesRows()).toEqual(r.toNodesRows());
  });
});

describe("FlowQueryResult.edges_df (TestFlowQueryResultEdgesDf)", () => {
  const expected_cols = [
    "source_step",
    "source_event",
    "target_step",
    "target_event",
    "count",
    "target_type",
  ];

  it("test_edges_df_columns", () => {
    const r = makeResult({ steps: sampleSankeySteps() });
    expect(r.edgesRowColumns()).toEqual(expected_cols);
  });

  it("test_edges_df_row_count", () => {
    const r = makeResult({ steps: sampleSankeySteps() });
    // Login->Search, Login->DROPOFF, Search->Purchase = 3 edges
    expect(r.toEdgesRows()).toHaveLength(3);
  });

  it("test_edges_df_empty_steps", () => {
    const r = makeResult({ steps: [] });
    expect(r.toEdgesRows()).toHaveLength(0);
    expect(r.edgesRowColumns()).toEqual(expected_cols);
  });

  it("test_edges_df_count_parsed_as_int", () => {
    const r = makeResult({ steps: sampleSankeySteps() });
    for (const row of r.toEdgesRows()) {
      expect(Number.isInteger(row["count"])).toBe(true);
    }
  });

  it("test_edges_df_cached (determinism)", () => {
    const r = makeResult({ steps: sampleSankeySteps() });
    expect(r.toEdgesRows()).toEqual(r.toEdgesRows());
  });
});

describe("FlowQueryResult.df mode-aware (TestFlowQueryResultDfModeAware)", () => {
  it("test_df_sankey_returns_nodes_df", () => {
    const r = makeResult({ mode: "sankey", steps: sampleSankeySteps() });
    expect(r.toRows()).toEqual(r.toNodesRows());
    expect(r.rowColumns()).toEqual(r.nodesRowColumns());
  });

  it("test_df_paths_returns_paths_dataframe", () => {
    const r = makeResult({ mode: "paths", flows: sampleTopPathsFlows() });
    const rows = r.toRows();
    expect(rows.length).toBeGreaterThan(0);
    expect(r.rowColumns()).toContain("path_index");
    expect(r.rowColumns()).toContain("step");
    expect(r.rowColumns()).toContain("event");
    expect(r.rowColumns()).toContain("count");
  });

  it("test_df_paths_empty_flows", () => {
    const r = makeResult({ mode: "paths", flows: [] });
    expect(r.toRows()).toHaveLength(0);
  });
});

describe("FlowQueryResult.top_transitions (TestFlowQueryResultTopTransitions)", () => {
  it("test_returns_list_of_tuples", () => {
    const transitions = makeResult({
      steps: sampleSankeySteps(),
    }).topTransitions();
    expect(Array.isArray(transitions)).toBe(true);
    for (const t of transitions) {
      expect(t).toHaveLength(3);
    }
  });

  it("test_sorted_by_count_descending", () => {
    const transitions = makeResult({
      steps: sampleSankeySteps(),
    }).topTransitions();
    const counts = transitions.map((t) => t[2]);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });

  it("test_respects_n_limit", () => {
    const transitions = makeResult({
      steps: sampleSankeySteps(),
    }).topTransitions(1);
    expect(transitions.length).toBeLessThanOrEqual(1);
  });

  it("test_empty_edges_returns_empty_list", () => {
    expect(makeResult({ steps: [] }).topTransitions()).toEqual([]);
  });

  it("test_default_n_is_10", () => {
    // Sample data has 3 edges, all should be returned.
    expect(
      makeResult({ steps: sampleSankeySteps() }).topTransitions(),
    ).toHaveLength(3);
  });
});

describe("FlowQueryResult.drop_off_summary (TestFlowQueryResultDropOffSummary)", () => {
  it("test_returns_dict", () => {
    const summary = makeResult({ steps: sampleSankeySteps() }).dropOffSummary();
    expect(typeof summary).toBe("object");
  });

  it("test_per_step_structure", () => {
    const summary = makeResult({ steps: sampleSankeySteps() }).dropOffSummary();
    for (const value of Object.values(summary)) {
      const entry = value as Record<string, unknown>;
      expect(Object.hasOwn(entry, "total")).toBe(true);
      expect(Object.hasOwn(entry, "dropoff")).toBe(true);
      expect(Object.hasOwn(entry, "rate")).toBe(true);
    }
  });

  it("test_dropoff_count_from_edges_of_non_dropoff_nodes", () => {
    const summary = makeResult({ steps: sampleSankeySteps() }).dropOffSummary();
    // Step 0: Login ANCHOR has DROPOFF edge count=20
    const step_0 = summary["step_0"] as Record<string, unknown>;
    expect(step_0["total"]).toBe(100);
    expect(step_0["dropoff"]).toBe(20);
    expect(step_0["rate"]).toBe(20 / 100);
  });

  it("test_empty_steps_returns_empty_dict", () => {
    expect(makeResult({ steps: [] }).dropOffSummary()).toEqual({});
  });
});

describe("safeInt (TestSafeInt)", () => {
  it("test_valid_string", () => {
    expect(safeInt("100")).toBe(100);
  });

  it("test_int_passthrough", () => {
    expect(safeInt(42)).toBe(42);
  });

  it("test_zero_int", () => {
    expect(safeInt(0)).toBe(0);
  });

  it("test_none_returns_default", () => {
    expect(safeInt(null)).toBe(0);
  });

  it("test_empty_string (default, warning channel not ported)", () => {
    expect(safeInt("")).toBe(0);
  });

  it("test_non_numeric_string (default, warning channel not ported)", () => {
    expect(safeInt("N/A")).toBe(0);
  });

  it("test_float_string (default, warning channel not ported)", () => {
    expect(safeInt("100.5")).toBe(0);
  });

  it("test_bool (rejected, warning channel not ported)", () => {
    expect(safeInt(true)).toBe(0);
  });

  it("test_custom_default", () => {
    expect(safeInt(null, -1)).toBe(-1);
  });

  it("test_negative_string", () => {
    expect(safeInt("-5")).toBe(-5);
  });
});

describe("safeInt string branch = CPython int(str) grammar (B0-gate RUN.md 2026-08-15: trim/regex sites replaced with pythonCompat)", () => {
  it("accepts underscores between digits like int('1_0')", () => {
    expect(safeInt("1_0")).toBe(10);
    expect(safeInt("100_000")).toBe(100000);
  });

  it("rejects malformed underscores (default)", () => {
    expect(safeInt("1__0")).toBe(0);
    expect(safeInt("_1")).toBe(0);
    expect(safeInt("1_")).toBe(0);
  });

  it("accepts non-ASCII Nd digits like int('٤٢')", () => {
    expect(safeInt("٤٢")).toBe(42);
  });

  it("accepts CPython numeric-whitespace surround incl. U+0085/NBSP", () => {
    // CPython probe (python-int.test.ts:98 precedent): int("\u008542\u00a0") == 42.
    expect(safeInt("\u008542\u00a0")).toBe(42);
  });

  it("rejects U+FEFF surround (JS \\s matches the BOM; CPython int() raises)", () => {
    expect(safeInt("\ufeff42")).toBe(0);
    expect(safeInt("42\ufeff")).toBe(0);
  });

  it("rejects U+001C..1F surround (str.isspace() true but Py_ISSPACE false)", () => {
    // CPython probe (python-int.test.ts:103-105): int('\x1c42\x1f') raises.
    expect(safeInt("\x1c42\x1f")).toBe(0);
  });

  it("magnitude beyond 2^53-1 maps to the default (R4.5 policy; playbook Discrepancy #6 pattern — CPython returns the exact big int, JS number cannot)", () => {
    expect(safeInt("9007199254740993")).toBe(0);
    expect(safeInt("9007199254740991")).toBe(9007199254740991);
  });
});
