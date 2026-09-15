// Translated FlowTreeNode + tree-mode FlowQueryResult tests (packet
// P2-6): assertion-for-assertion port of tests/test_types_flow_tree.py
// (R10.2).
//
// Not ported: immutability tests (compile-time `readonly`);
// TestFlowTreeNodeToAnytree and the `anytree` property assertions of
// TestFlowQueryResultTreeMode (anytree — TODO(port) batch B5, see the
// query-engine module doc); TestFlowTreeNodeExports (Python `__all__`
// surface — the TS export is locked by the package barrel + P2-10
// coverage map). Python tuple children translate to readonly arrays.
import { describe, expect, it } from "vitest";

import {
  FlowQueryResult,
  type FlowQueryResultFields,
  FlowTreeNode,
} from "../../../src/types/results/query-engine.js";

/** Build the 3-level sample tree (Python `_sample_tree`). */
function sampleTree(): FlowTreeNode {
  const purchase_via_search = new FlowTreeNode({
    event: "Purchase",
    type: "ANCHOR",
    step_number: 2,
    total_count: 400,
    drop_off_count: 0,
    converted_count: 400,
  });
  const dropoff_after_search = new FlowTreeNode({
    event: "DROPOFF",
    type: "DROPOFF",
    step_number: 2,
    total_count: 100,
    drop_off_count: 100,
    converted_count: 0,
  });
  const search = new FlowTreeNode({
    event: "Search",
    type: "NORMAL",
    step_number: 1,
    total_count: 600,
    drop_off_count: 100,
    converted_count: 500,
    children: [purchase_via_search, dropoff_after_search],
  });
  const purchase_via_browse = new FlowTreeNode({
    event: "Purchase",
    type: "ANCHOR",
    step_number: 2,
    total_count: 200,
    drop_off_count: 0,
    converted_count: 200,
  });
  const browse = new FlowTreeNode({
    event: "Browse",
    type: "NORMAL",
    step_number: 1,
    total_count: 300,
    drop_off_count: 50,
    converted_count: 250,
    children: [purchase_via_browse],
  });
  const dropoff_from_login = new FlowTreeNode({
    event: "DROPOFF",
    type: "DROPOFF",
    step_number: 1,
    total_count: 50,
    drop_off_count: 50,
    converted_count: 0,
  });
  return new FlowTreeNode({
    event: "Login",
    type: "ANCHOR",
    step_number: 0,
    total_count: 1000,
    drop_off_count: 50,
    converted_count: 950,
    children: [search, browse, dropoff_from_login],
  });
}

/** Build a single leaf node (Python `_leaf_node`). */
function leafNode(): FlowTreeNode {
  return new FlowTreeNode({
    event: "Purchase",
    type: "ANCHOR",
    step_number: 0,
    total_count: 100,
    drop_off_count: 0,
    converted_count: 100,
  });
}

/** Build a tree-mode FlowQueryResult (Python `_make_tree_result`). */
function makeTreeResult(
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
    mode: "tree",
    trees: [sampleTree()],
    ...overrides,
  });
}

describe("FlowTreeNode construction (TestFlowTreeNodeConstruction)", () => {
  it("test_construct_with_required_fields", () => {
    const node = new FlowTreeNode({
      event: "Login",
      type: "ANCHOR",
      step_number: 0,
      total_count: 100,
    });
    expect(node.event).toBe("Login");
    expect(node.type).toBe("ANCHOR");
    expect(node.step_number).toBe(0);
    expect(node.total_count).toBe(100);
    expect(node.drop_off_count).toBe(0);
    expect(node.converted_count).toBe(0);
    expect(node.anchor_type).toBe("NORMAL");
    expect(node.is_computed).toBe(false);
    expect(node.children).toEqual([]);
    expect(node.time_percentiles_from_start).toEqual({});
    expect(node.time_percentiles_from_prev).toEqual({});
  });

  it("test_construct_with_all_fields", () => {
    const tp_start = { percentiles: [50, 90], values: [1.0, 5.0] };
    const tp_prev = { percentiles: [50], values: [0.5] };
    const child = new FlowTreeNode({
      event: "Search",
      type: "NORMAL",
      step_number: 1,
      total_count: 50,
    });
    const node = new FlowTreeNode({
      event: "Login",
      type: "ANCHOR",
      step_number: 0,
      total_count: 100,
      drop_off_count: 10,
      converted_count: 90,
      anchor_type: "RELATIVE_FORWARD",
      is_computed: true,
      children: [child],
      time_percentiles_from_start: tp_start,
      time_percentiles_from_prev: tp_prev,
    });
    expect(node.drop_off_count).toBe(10);
    expect(node.converted_count).toBe(90);
    expect(node.anchor_type).toBe("RELATIVE_FORWARD");
    expect(node.is_computed).toBe(true);
    expect(node.children).toHaveLength(1);
    expect(node.children[0]?.event).toBe("Search");
    expect(node.time_percentiles_from_start).toEqual(tp_start);
    expect(node.time_percentiles_from_prev).toEqual(tp_prev);
  });

  it("test_empty_children_default", () => {
    const node = leafNode();
    expect(node.children).toEqual([]);
    expect(Array.isArray(node.children)).toBe(true);
  });
});

describe("FlowTreeNode properties (TestFlowTreeNodeProperties)", () => {
  it("test_depth_leaf", () => {
    expect(leafNode().depth).toBe(0);
  });

  it("test_depth_one_level", () => {
    const root = new FlowTreeNode({
      event: "Root",
      type: "ANCHOR",
      step_number: 0,
      total_count: 100,
      children: [leafNode()],
    });
    expect(root.depth).toBe(1);
  });

  it("test_depth_sample_tree", () => {
    expect(sampleTree().depth).toBe(2);
  });

  it("test_node_count_leaf", () => {
    expect(leafNode().node_count).toBe(1);
  });

  it("test_node_count_sample_tree", () => {
    expect(sampleTree().node_count).toBe(7);
  });

  it("test_leaf_count_leaf", () => {
    expect(leafNode().leaf_count).toBe(1);
  });

  it("test_leaf_count_sample_tree", () => {
    expect(sampleTree().leaf_count).toBe(4);
  });

  it("test_conversion_rate_normal", () => {
    expect(sampleTree().conversion_rate).toBeCloseTo(950 / 1000);
  });

  it("test_conversion_rate_zero_total", () => {
    const node = new FlowTreeNode({
      event: "Empty",
      type: "NORMAL",
      step_number: 0,
      total_count: 0,
    });
    expect(node.conversion_rate).toBe(0.0);
  });

  it("test_drop_off_rate_normal", () => {
    expect(sampleTree().drop_off_rate).toBeCloseTo(50 / 1000);
  });

  it("test_drop_off_rate_zero_total", () => {
    const node = new FlowTreeNode({
      event: "Empty",
      type: "NORMAL",
      step_number: 0,
      total_count: 0,
    });
    expect(node.drop_off_rate).toBe(0.0);
  });
});

describe("FlowTreeNode.all_paths (TestFlowTreeNodeAllPaths)", () => {
  it("test_leaf_returns_single_path", () => {
    const leaf = leafNode();
    const paths = leaf.allPaths();
    expect(paths).toHaveLength(1);
    expect(paths[0]).toHaveLength(1);
    expect(paths[0]?.[0]).toBe(leaf);
  });

  it("test_sample_tree_path_count", () => {
    expect(sampleTree().allPaths()).toHaveLength(4);
  });

  it("test_paths_start_with_root", () => {
    for (const path of sampleTree().allPaths()) {
      expect(path[0]?.event).toBe("Login");
    }
  });

  it("test_paths_end_with_leaves", () => {
    for (const path of sampleTree().allPaths()) {
      expect(path.at(-1)?.children).toEqual([]);
    }
  });

  it("test_paths_contain_node_chain", () => {
    const paths = sampleTree().allPaths();
    const purchase_paths = paths.filter((p) => p.at(-1)?.event === "Purchase");
    expect(purchase_paths).toHaveLength(2);
    const search_purchase = purchase_paths.find(
      (p) => p[1]?.event === "Search",
    );
    expect(search_purchase?.[0]?.total_count).toBe(1000); // Login
    expect(search_purchase?.[1]?.total_count).toBe(600); // Search
    expect(search_purchase?.[2]?.total_count).toBe(400); // Purchase
  });
});

describe("FlowTreeNode.find (TestFlowTreeNodeFind)", () => {
  it("test_find_root_event", () => {
    const results = sampleTree().find("Login");
    expect(results).toHaveLength(1);
    expect(results[0]?.event).toBe("Login");
  });

  it("test_find_multiple_matches", () => {
    const results = sampleTree().find("Purchase");
    expect(results).toHaveLength(2);
    expect(results.every((n) => n.event === "Purchase")).toBe(true);
  });

  it("test_find_no_match", () => {
    expect(sampleTree().find("NonExistent")).toEqual([]);
  });

  it("test_find_preserves_node_data", () => {
    const purchases = sampleTree().find("Purchase");
    const counts = purchases.map((p) => p.total_count).sort((a, b) => a - b);
    expect(counts).toEqual([200, 400]);
  });
});

describe("FlowTreeNode.flatten (TestFlowTreeNodeFlatten)", () => {
  it("test_leaf_flattens_to_single", () => {
    const leaf = leafNode();
    expect(leaf.flatten()).toHaveLength(1);
    expect(leaf.flatten()[0]).toBe(leaf);
  });

  it("test_flatten_count_matches_node_count", () => {
    const tree = sampleTree();
    expect(tree.flatten()).toHaveLength(tree.node_count);
  });

  it("test_flatten_is_preorder", () => {
    const flat = sampleTree().flatten();
    expect(flat[0]?.event).toBe("Login");
    const search_idx = flat.findIndex((n) => n.event === "Search");
    const browse_idx = flat.findIndex((n) => n.event === "Browse");
    expect(search_idx).toBeLessThan(browse_idx);
  });
});

describe("FlowTreeNode.to_dict (TestFlowTreeNodeToDict)", () => {
  it("test_leaf_to_dict_keys", () => {
    const d = leafNode().toJSON();
    expect(new Set(Object.keys(d))).toEqual(
      new Set([
        "event",
        "type",
        "step_number",
        "total_count",
        "drop_off_count",
        "converted_count",
        "anchor_type",
        "is_computed",
        "children",
        "time_percentiles_from_start",
        "time_percentiles_from_prev",
      ]),
    );
  });

  it("test_leaf_to_dict_values", () => {
    const d = leafNode().toJSON();
    expect(d["event"]).toBe("Purchase");
    expect(d["total_count"]).toBe(100);
    expect(d["children"]).toEqual([]);
  });

  it("test_recursive_to_dict", () => {
    const d = sampleTree().toJSON();
    const children = d["children"] as ReadonlyArray<Record<string, unknown>>;
    expect(children).toHaveLength(3);
    expect(children[0]?.["event"]).toBe("Search");
    const grandchildren = children[0]?.["children"] as ReadonlyArray<
      Record<string, unknown>
    >;
    expect(grandchildren).toHaveLength(2);
    expect(grandchildren[0]?.["event"]).toBe("Purchase");
  });
});

describe("FlowTreeNode.render (TestFlowTreeNodeRender)", () => {
  it("test_leaf_render", () => {
    const rendered = leafNode().render();
    expect(rendered).toContain("Purchase");
    expect(rendered).toContain("100");
  });

  it("test_sample_tree_render_contains_all_events", () => {
    const rendered = sampleTree().render();
    expect(rendered).toContain("Login");
    expect(rendered).toContain("Search");
    expect(rendered).toContain("Browse");
    expect(rendered).toContain("Purchase");
    expect(rendered).toContain("DROPOFF");
  });

  it("test_render_uses_box_drawing", () => {
    const rendered = sampleTree().render();
    expect(rendered.includes("├──") || rendered.includes("└──")).toBe(true);
  });
});

describe("FlowQueryResult tree mode (TestFlowQueryResultTreeMode)", () => {
  const expected_cols = [
    "tree_index",
    "depth",
    "path",
    "event",
    "type",
    "step_number",
    "total_count",
    "drop_off_count",
    "converted_count",
  ];

  it("test_accepts_tree_mode", () => {
    expect(makeTreeResult().mode).toBe("tree");
  });

  it("test_trees_field_populated", () => {
    const r = makeTreeResult();
    expect(r.trees).toHaveLength(1);
    expect(r.trees[0]).toBeInstanceOf(FlowTreeNode);
    expect(r.trees[0]?.event).toBe("Login");
  });

  it("test_trees_default_empty", () => {
    const r = new FlowQueryResult({
      computed_at: "2025-01-15T10:00:00",
      mode: "tree",
    });
    expect(r.trees).toEqual([]);
  });

  it("test_df_tree_mode_columns", () => {
    expect(makeTreeResult().rowColumns()).toEqual(expected_cols);
  });

  it("test_df_tree_mode_row_count", () => {
    expect(makeTreeResult().toRows()).toHaveLength(sampleTree().node_count);
  });

  it("test_df_tree_mode_path_column", () => {
    const paths = makeTreeResult()
      .toRows()
      .map((row) => row["path"]);
    expect(paths).toContain("Login"); // root
    expect(paths).toContain("Login > Search");
    expect(paths).toContain("Login > Search > Purchase");
    expect(paths).toContain("Login > Browse > Purchase");
  });

  it("test_df_tree_mode_cached (determinism)", () => {
    const r = makeTreeResult();
    expect(r.toRows()).toEqual(r.toRows());
  });

  it("test_df_tree_mode_empty_trees", () => {
    const r = makeTreeResult({ trees: [] });
    expect(r.toRows()).toHaveLength(0);
    expect(r.rowColumns()).toEqual(expected_cols);
  });

  it("test_to_dict_includes_trees", () => {
    const d = makeTreeResult().toJSON();
    expect(Object.hasOwn(d, "trees")).toBe(true);
    const trees = d["trees"] as ReadonlyArray<Record<string, unknown>>;
    expect(trees).toHaveLength(1);
    expect(trees[0]?.["event"]).toBe("Login");
    expect(trees[0]?.["children"]).toHaveLength(3);
  });

  it("test_multiple_trees", () => {
    const tree2 = new FlowTreeNode({
      event: "Signup",
      type: "ANCHOR",
      step_number: 0,
      total_count: 500,
      drop_off_count: 25,
      converted_count: 475,
    });
    const r = makeTreeResult({ trees: [sampleTree(), tree2] });
    expect(r.trees).toHaveLength(2);
    // df includes nodes from both trees.
    expect(r.toRows()).toHaveLength(sampleTree().node_count + tree2.node_count);
    // tree_index distinguishes them.
    expect(new Set(r.toRows().map((row) => row["tree_index"]))).toEqual(
      new Set([0, 1]),
    );
  });
});
