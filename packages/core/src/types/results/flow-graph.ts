/**
 * Flow-query frame builders — the `graph` / `nodes_df` / `edges_df` /
 * `trees_df` / `drop_off_summary` bodies of
 * `mixpanel_headless.types.FlowQueryResult`, as module functions over
 * the result's `steps` / `trees` fields, plus the `types._safe_int`
 * parser they share.
 *
 * `FlowQueryResult` (`query-engine.ts`) delegates to these; keeping the
 * walkers here leaves the result class to its field/decoder surface.
 * `networkx.DiGraph` has no vendored TS library, so {@link buildFlowGraph}
 * emits the adjacency data Python hands to `add_node` / `add_edge`, in
 * the same order and with the same per-key defaults.
 */

import { pythonInt, pythonStrOf } from "../../compat/index.js";
import { MixpanelHeadlessError } from "../../errors.js";
import type { FlowTreeNode } from "./flow-tree.js";
import type { Row } from "./result-base.js";

/** A step / node / edge dict exactly as the flows API returned it. */
type FlowDict = Readonly<Record<string, unknown>>;

/**
 * Parse a value to int, returning `default_` on failure — mirror of
 * `types._safe_int` (the flows API returns `totalCount` as a string).
 * Python's `warnings.warn` side channel is not ported (out of
 * contract).
 *
 * @param value - Value to parse (typically a numeric string).
 * @param default_ - Fallback when parsing fails. Default: `0`.
 * @returns Parsed integer, or `default_`.
 * @internal
 */
export function safeInt(value: unknown, default_ = 0): number {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "boolean") {
    // Python: bool is excluded from the int fast path and warned on.
    return default_;
  }
  if (typeof value === "string") {
    // Python: try int(value) except ValueError -> default. `pythonInt`
    // IS the CPython int(str) grammar (underscores, non-ASCII Nd
    // digits, the CPython numeric-whitespace surround) — the previous
    // `\s`-regex + parseInt pair diverged on all three plus U+FEFF
    // (B0-gate RUN.md 2026-08-15). PY_INT_UNSAFE_INTEGER (>2^53-1,
    // where CPython returns the exact big int) also maps to the
    // default: R4.5 leaves no faithful numeric representation (the
    // playbook Discrepancy #6 pattern; the old parseInt path returned
    // an IMPRECISE number there, which was no more faithful).
    try {
      return pythonInt(value);
    } catch (error) {
      // Guarded catch (b0-review-resolution F3/A2 pattern): only the
      // coded parse rejections are the ValueError analog; anything
      // else propagates.
      if (error instanceof MixpanelHeadlessError) {
        return default_;
      }
      throw error;
    }
  }
  return default_;
}

/** One node of the {@link buildFlowGraph} adjacency object. */
interface FlowGraphNode {
  /** `"{event}@{step}"` — Python's networkx node key. */
  readonly id: string;
  /** Zero-based step index. */
  readonly step: number;
  /** Event name (`""` when absent). */
  readonly event: unknown;
  /** Node type (`""` when absent). */
  readonly type: unknown;
  /** `_safe_int(node["totalCount"])`. */
  readonly count: number;
  /** Anchor classification (`""` when absent). */
  readonly anchor_type: unknown;
}

/** One edge of the {@link buildFlowGraph} adjacency object. */
interface FlowGraphEdge {
  /** Source node id. */
  readonly source: string;
  /** Target node id (`"{event}@{targetStep}"`). */
  readonly target: string;
  /** `_safe_int(edge["totalCount"])`. */
  readonly count: number;
  /** Edge type (`""` when absent). */
  readonly type: unknown;
}

/**
 * The plain adjacency object {@link buildFlowGraph} emits — the
 * stand-in for `networkx.DiGraph` (B5-S2 closure of the Phase-2
 * TODO(port)).
 */
export interface FlowGraph {
  /** Nodes, in Python's `add_node` order. */
  readonly nodes: readonly FlowGraphNode[];
  /** Edges, in Python's `add_edge` order. */
  readonly edges: readonly FlowGraphEdge[];
}

/**
 * Nodes of one sankey step dict (`step.get("nodes", [])`).
 *
 * @param step - The step dict.
 * @returns The node dicts.
 */
function stepNodes(step: FlowDict): readonly FlowDict[] {
  const nodes = step["nodes"];
  return Array.isArray(nodes) ? (nodes as readonly FlowDict[]) : [];
}

/**
 * Edges of one node dict (`node.get("edges", [])`).
 *
 * @param node - The node dict.
 * @returns The edge dicts.
 */
function nodeEdges(node: FlowDict): readonly FlowDict[] {
  const edges = node["edges"];
  return Array.isArray(edges) ? (edges as readonly FlowDict[]) : [];
}

/**
 * The directed flow graph — body of Python's `FlowQueryResult.graph`
 * property. Node ids are `"{event}@{step}"`, node attributes are
 * `step` / `event` / `type` / `count` / `anchor_type`, and edge
 * attributes are `count` / `type` with the `step_idx + 1` target-step
 * fallback. Pure and deterministic, so the result class leaves its
 * codec-visible `_graph_cache` slot `null`.
 *
 * @param steps - The sankey step dicts.
 * @returns The `{nodes, edges}` adjacency object (empty arrays when
 *   `steps` is empty).
 */
export function buildFlowGraph(steps: readonly FlowDict[]): FlowGraph {
  const nodes: FlowGraphNode[] = [];
  const edges: FlowGraphEdge[] = [];
  for (const [stepIdx, step] of steps.entries()) {
    for (const node of stepNodes(step)) {
      const nodeId = `${pythonStrOf(node["event"] ?? "")}@${String(stepIdx)}`;
      nodes.push({
        id: nodeId,
        step: stepIdx,
        event: node["event"] ?? "",
        type: node["type"] ?? "",
        count: safeInt(node["totalCount"] ?? "0"),
        anchor_type: node["anchorType"] ?? "",
      });
      for (const edge of nodeEdges(node)) {
        const targetStep = safeInt(edge["step"] ?? stepIdx + 1, stepIdx + 1);
        edges.push({
          source: nodeId,
          target: `${pythonStrOf(edge["event"] ?? "")}@${String(targetStep)}`,
          count: safeInt(edge["totalCount"] ?? "0"),
          type: edge["type"] ?? "",
        });
      }
    }
  }
  return { nodes, edges };
}

/**
 * Pre-pandas rows of the Python `nodes_df` body: one row per sankey
 * node with Python's per-key defaults (`totalCount` string parsed via
 * `_safe_int`).
 *
 * @param steps - The sankey step dicts.
 * @returns The rows list.
 */
export function flowNodesRows(steps: readonly FlowDict[]): readonly Row[] {
  const rows: Row[] = [];
  for (const [stepIdx, step] of steps.entries()) {
    for (const node of stepNodes(step)) {
      rows.push({
        step: stepIdx,
        event: node["event"] ?? "",
        type: node["type"] ?? "",
        count: safeInt(node["totalCount"] ?? "0"),
        anchor_type: node["anchorType"] ?? "",
        is_custom_event: node["isCustomEvent"] ?? false,
        conversion_rate_change: node["conversionRateChange"] ?? 0.0,
      });
    }
  }
  return rows;
}

/**
 * Pre-pandas rows of the Python `edges_df` body: one row per
 * (node, edge) pair.
 *
 * @param steps - The sankey step dicts.
 * @returns The rows list.
 */
export function flowEdgesRows(steps: readonly FlowDict[]): readonly Row[] {
  const rows: Row[] = [];
  for (const [stepIdx, step] of steps.entries()) {
    for (const node of stepNodes(step)) {
      for (const edge of nodeEdges(node)) {
        rows.push({
          source_step: stepIdx,
          source_event: node["event"] ?? "",
          target_step: safeInt(edge["step"] ?? stepIdx + 1, stepIdx + 1),
          target_event: edge["event"] ?? "",
          count: safeInt(edge["totalCount"] ?? "0"),
          target_type: edge["type"] ?? "",
        });
      }
    }
  }
  return rows;
}

/**
 * Preorder tree flattening — mirror of Python
 * `FlowQueryResult._flatten_tree_node`.
 *
 * @param node - Current node.
 * @param treeIndex - Root index.
 * @param ancestors - Ancestor event names.
 * @param rows - Output row accumulator.
 */
function flattenTreeNode(
  node: FlowTreeNode,
  treeIndex: number,
  ancestors: readonly string[],
  rows: Row[],
): void {
  const pathParts = [...ancestors, node.event];
  rows.push({
    tree_index: treeIndex,
    depth: ancestors.length,
    path: pathParts.join(" > "),
    event: node.event,
    type: node.type,
    step_number: node.step_number,
    total_count: node.total_count,
    drop_off_count: node.drop_off_count,
    converted_count: node.converted_count,
  });
  for (const child of node.children) {
    flattenTreeNode(child, treeIndex, pathParts, rows);
  }
}

/**
 * Pre-pandas rows of the Python `_build_tree_df` body: preorder
 * flattening of every tree with `tree_index`/`depth`/`" > "`-joined
 * `path`.
 *
 * @param trees - The tree-mode roots.
 * @returns The rows list.
 */
export function flowTreesRows(trees: readonly FlowTreeNode[]): readonly Row[] {
  const rows: Row[] = [];
  for (const [treeIdx, tree] of trees.entries()) {
    flattenTreeNode(tree, treeIdx, [], rows);
  }
  return rows;
}

/**
 * Per-step drop-off totals — body of Python `drop_off_summary()`.
 *
 * @param steps - The sankey step dicts.
 * @returns `{step_N: {total, dropoff, rate}}` (empty when there are no
 *   steps).
 */
export function flowDropOffSummary(
  steps: readonly FlowDict[],
): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const [stepIdx, step] of steps.entries()) {
    let total = 0;
    let dropoff = 0;
    for (const node of stepNodes(step)) {
      const count = safeInt(node["totalCount"] ?? "0");
      const nodeType = node["type"] ?? "";
      total += count;
      if (nodeType !== "DROPOFF") {
        for (const edge of nodeEdges(node)) {
          // eslint-disable-next-line max-depth -- mirrors the Python nesting; flattening would reorder the guards
          if (edge["type"] === "DROPOFF") {
            dropoff += safeInt(edge["totalCount"] ?? "0");
          }
        }
      }
    }
    const rate = total > 0 ? dropoff / total : 0.0;
    summary[`step_${String(stepIdx)}`] = { total, dropoff, rate };
  }
  return summary;
}
