/**
 * `FlowTreeNode` — one node of a tree-mode flow query, the TS port of
 * `mixpanel_headless.types.FlowTreeNode`, plus the plain-object
 * `AnyTreeNode` its `toAnytree()` emits in place of `anytree.AnyNode`.
 *
 * Split out of `query-engine.ts` so the flow-graph builders
 * (`flow-graph.ts`) can walk trees without importing the result class
 * that composes them.
 */

import type { FlowAnchorType, FlowNodeType } from "../literals.js";
import {
  expectArray,
  expectBool,
  expectInt,
  expectPayload,
  expectRecord,
  expectStr,
  rejectUnknownKeys,
} from "./result-base.js";

/** Declared fields of {@link FlowTreeNode} (Python field order). */
export interface FlowTreeNodeFields {
  /** Event name at this node. */
  readonly event: string;
  /** Node type. */
  readonly type: FlowNodeType;
  /** Zero-based step number. */
  readonly step_number: number;
  /** Users reaching this node. */
  readonly total_count: number;
  /**
   * Users dropping off at this node.
   *
   * @defaultValue `0`
   */
  readonly drop_off_count?: number;
  /**
   * Users converting from this node.
   *
   * @defaultValue `0`
   */
  readonly converted_count?: number;
  /**
   * Anchor type.
   *
   * @defaultValue `"NORMAL"`
   */
  readonly anchor_type?: FlowAnchorType;
  /**
   * Whether the node was computed (vs observed).
   *
   * @defaultValue `false`
   */
  readonly is_computed?: boolean;
  /**
   * Child nodes (Python tuple → ReadonlyArray).
   *
   * @defaultValue `[]`
   */
  readonly children?: readonly FlowTreeNode[];
  /**
   * Time percentiles from flow start.
   *
   * @defaultValue `{}`
   */
  readonly time_percentiles_from_start?: Readonly<Record<string, unknown>>;
  /**
   * Time percentiles from the previous step.
   *
   * @defaultValue `{}`
   */
  readonly time_percentiles_from_prev?: Readonly<Record<string, unknown>>;
}

/**
 * The parent-linked node {@link FlowTreeNode.toAnytree} emits — the
 * plain-object stand-in for `anytree.AnyNode`.
 */
export interface AnyTreeNode {
  /** Parent node, or `null` at the root. */
  readonly parent: AnyTreeNode | null;
  /** Event name at this node. */
  readonly event: string;
  /** Node type. */
  readonly type: FlowNodeType;
  /** Zero-based step number. */
  readonly step_number: number;
  /** Users reaching this node. */
  readonly total_count: number;
  /** Users dropping off at this node. */
  readonly drop_off_count: number;
  /** Users converting from this node. */
  readonly converted_count: number;
  /** Anchor classification. */
  readonly anchor_type: string;
  /** Whether the node is computed. */
  readonly is_computed: boolean;
  /** Child nodes (populated during the walk). */
  readonly children: AnyTreeNode[];
}

/**
 * One node of a tree-mode flow query.
 *
 * @remarks
 * `to_anytree()` is ported as {@link FlowTreeNode.toAnytree}, emitting
 * the plain {@link AnyTreeNode} tree rather than `anytree.AnyNode`
 * objects.
 * @example
 * ```ts
 * const root = new FlowTreeNode({
 *   event: "Signup",
 *   type: "NORMAL",
 *   step_number: 0,
 *   total_count: 10,
 *   converted_count: 4,
 *   children: [
 *     new FlowTreeNode({ event: "Buy", type: "NORMAL", step_number: 1, total_count: 4 }),
 *   ],
 * });
 * root.conversion_rate; // 0.4
 * root.render(); // "Signup (10)\n└── Buy (4)\n"
 * ```
 * @see mixpanel_headless.types.FlowTreeNode
 */
export class FlowTreeNode {
  /** Event name at this node. */
  readonly event: string;

  /** Node type. */
  readonly type: FlowNodeType;

  /** Zero-based step number. */
  readonly step_number: number;

  /** Users reaching this node. */
  readonly total_count: number;

  /** Users dropping off at this node. */
  readonly drop_off_count: number;

  /** Users converting from this node. */
  readonly converted_count: number;

  /** Anchor type. */
  readonly anchor_type: FlowAnchorType;

  /** Whether the node was computed (vs observed). */
  readonly is_computed: boolean;

  /** Child nodes (Python tuple → ReadonlyArray). */
  readonly children: readonly FlowTreeNode[];

  /** Time percentiles from flow start. */
  readonly time_percentiles_from_start: Readonly<Record<string, unknown>>;

  /** Time percentiles from the previous step. */
  readonly time_percentiles_from_prev: Readonly<Record<string, unknown>>;

  /**
   * Create a flow tree node.
   *
   * @param fields - Declared fields; Python defaults apply to absent
   *   optionals.
   */
  constructor(fields: FlowTreeNodeFields) {
    this.event = fields.event;
    this.type = fields.type;
    this.step_number = fields.step_number;
    this.total_count = fields.total_count;
    this.drop_off_count = fields.drop_off_count ?? 0;
    this.converted_count = fields.converted_count ?? 0;
    this.anchor_type = fields.anchor_type ?? "NORMAL";
    this.is_computed = fields.is_computed ?? false;
    this.children = fields.children ?? [];
    this.time_percentiles_from_start = fields.time_percentiles_from_start ?? {};
    this.time_percentiles_from_prev = fields.time_percentiles_from_prev ?? {};
  }

  /**
   * Longest child chain below this node (`0` for a leaf).
   *
   * @returns The depth.
   */
  get depth(): number {
    if (this.children.length === 0) {
      return 0;
    }
    return 1 + Math.max(...this.children.map((c) => c.depth));
  }

  /**
   * Total nodes in this subtree (including this node).
   *
   * @returns The node count.
   */
  get node_count(): number {
    return 1 + this.children.reduce((sum, c) => sum + c.node_count, 0);
  }

  /**
   * Leaves in this subtree (`1` for a leaf).
   *
   * @returns The leaf count.
   */
  get leaf_count(): number {
    if (this.children.length === 0) {
      return 1;
    }
    return this.children.reduce((sum, c) => sum + c.leaf_count, 0);
  }

  /**
   * Build the parent-linked tree view — the twin of Python's
   * `to_anytree()`.
   *
   * @remarks
   * `anytree.AnyNode` has no vendored TS library, so the port emits
   * {@link AnyTreeNode}: the same eight attributes Python copies onto
   * each `AnyNode`, plus the `parent` back-reference and `children`
   * array that make the anytree navigation surface (`node.parent`,
   * `node.children`, `node.path`) reproducible in plain TS.
   * `RenderTree` and `findall` are library helpers, not data, and have
   * no twin.
   * @returns The root of the parallel tree (`parent === null`).
   * @example
   * ```ts
   * const at = root.toAnytree();
   * at.children[0]?.parent === at; // true
   * ```
   * @see mixpanel_headless.types.FlowTreeNode.to_anytree
   */
  toAnytree(): AnyTreeNode {
    return this.#buildAnytreeNode(null);
  }

  /**
   * Recursively build the parallel tree.
   *
   * @param parent - The parent node, or `null` for the root.
   * @returns The node with its children attached.
   */
  #buildAnytreeNode(parent: AnyTreeNode | null): AnyTreeNode {
    const node: AnyTreeNode = {
      parent,
      event: this.event,
      type: this.type,
      step_number: this.step_number,
      total_count: this.total_count,
      drop_off_count: this.drop_off_count,
      converted_count: this.converted_count,
      anchor_type: this.anchor_type,
      is_computed: this.is_computed,
      children: [],
    };
    for (const child of this.children) {
      // Python attaches by passing `parent=node`; anytree mutates the
      // parent's `children` tuple. The TS twin pushes explicitly.
      node.children.push(child.#buildAnytreeNode(node));
    }
    return node;
  }

  /**
   * `converted_count / total_count` (`0.0` when `total_count == 0`).
   *
   * @returns The conversion rate.
   */
  get conversion_rate(): number {
    if (this.total_count === 0) {
      return 0.0;
    }
    return this.converted_count / this.total_count;
  }

  /**
   * `drop_off_count / total_count` (`0.0` when `total_count == 0`).
   *
   * @returns The drop-off rate.
   */
  get drop_off_rate(): number {
    if (this.total_count === 0) {
      return 0.0;
    }
    return this.drop_off_count / this.total_count;
  }

  /**
   * Every root-to-leaf path through this subtree.
   *
   * @returns Paths as node lists (a single `[this]` path for a leaf).
   */
  allPaths(): ReadonlyArray<readonly FlowTreeNode[]> {
    if (this.children.length === 0) {
      return [[this]];
    }
    const paths: FlowTreeNode[][] = [];
    for (const child of this.children) {
      for (const childPath of child.allPaths()) {
        paths.push([this, ...childPath]);
      }
    }
    return paths;
  }

  /**
   * Every node in this subtree whose event matches.
   *
   * @param event - Event name to match.
   * @returns Matching nodes in preorder.
   */
  find(event: string): readonly FlowTreeNode[] {
    const results: FlowTreeNode[] = [];
    if (this.event === event) {
      results.push(this);
    }
    for (const child of this.children) {
      results.push(...child.find(event));
    }
    return results;
  }

  /**
   * All nodes of this subtree in preorder.
   *
   * @returns The flattened node list.
   */
  flatten(): readonly FlowTreeNode[] {
    const result: FlowTreeNode[] = [this];
    for (const child of this.children) {
      result.push(...child.flatten());
    }
    return result;
  }

  /**
   * Serialize for JSON output — byte-shape of Python `to_dict()`
   * (recursive over `children`).
   *
   * @returns The plain dict shape.
   */
  toJSON(): Record<string, unknown> {
    return {
      event: this.event,
      type: this.type,
      step_number: this.step_number,
      total_count: this.total_count,
      drop_off_count: this.drop_off_count,
      converted_count: this.converted_count,
      anchor_type: this.anchor_type,
      is_computed: this.is_computed,
      children: this.children.map((c) => c.toJSON()),
      time_percentiles_from_start: this.time_percentiles_from_start,
      time_percentiles_from_prev: this.time_percentiles_from_prev,
    };
  }

  /**
   * ASCII-art rendering of this subtree, byte-identical to Python's
   * `render()` (box-drawing connectors, `event (total_count)` lines).
   *
   * @param _prefix - Accumulated indentation (internal recursion).
   * @param _isLast - Whether this node is its parent's last child.
   * @param _isRoot - Whether this node is the render root.
   * @returns The rendered text (trailing newline included).
   */
  render(_prefix = "", _isLast = true, _isRoot = true): string {
    let line: string;
    let childPrefix: string;
    if (_isRoot) {
      line = `${this.event} (${String(this.total_count)})\n`;
      childPrefix = "";
    } else {
      const connector = _isLast ? "└── " : "├── ";
      line = `${_prefix}${connector}${this.event} (${String(this.total_count)})\n`;
      childPrefix = _prefix + (_isLast ? " ".repeat(4) : "│   ");
    }
    for (const [i, child] of this.children.entries()) {
      const isLastChild = i === this.children.length - 1;
      line += child.render(childPrefix, isLastChild, false);
    }
    return line;
  }

  /**
   * Strictly decode a recorded payload (recursive over `children`).
   *
   * @param raw - The payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On unknown keys or wrong types.
   * @internal
   */
  static fromDict(raw: unknown): FlowTreeNode {
    const cls = "FlowTreeNode";
    const payload = expectPayload(raw, cls);
    rejectUnknownKeys(
      payload,
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
      cls,
    );
    return new FlowTreeNode({
      event: expectStr(payload, "event", cls),
      type: expectStr(payload, "type", cls) as FlowNodeType,
      step_number: expectInt(payload, "step_number", cls),
      total_count: expectInt(payload, "total_count", cls),
      ...(Object.hasOwn(payload, "drop_off_count")
        ? { drop_off_count: expectInt(payload, "drop_off_count", cls) }
        : {}),
      ...(Object.hasOwn(payload, "converted_count")
        ? { converted_count: expectInt(payload, "converted_count", cls) }
        : {}),
      ...(Object.hasOwn(payload, "anchor_type")
        ? {
            anchor_type: expectStr(
              payload,
              "anchor_type",
              cls,
            ) as FlowAnchorType,
          }
        : {}),
      ...(Object.hasOwn(payload, "is_computed")
        ? { is_computed: expectBool(payload, "is_computed", cls) }
        : {}),
      ...(Object.hasOwn(payload, "children")
        ? {
            children: expectArray(payload, "children", cls).map((item) =>
              FlowTreeNode.fromDict(item),
            ),
          }
        : {}),
      ...(Object.hasOwn(payload, "time_percentiles_from_start")
        ? {
            time_percentiles_from_start: expectRecord(
              payload,
              "time_percentiles_from_start",
              cls,
            ),
          }
        : {}),
      ...(Object.hasOwn(payload, "time_percentiles_from_prev")
        ? {
            time_percentiles_from_prev: expectRecord(
              payload,
              "time_percentiles_from_prev",
              cls,
            ),
          }
        : {}),
    });
  }
}
