---
title: Flow queries
description: Build typed flow path analysis against Mixpanel's Insights engine — define anchor events, control forward/reverse step depth, apply per-step filters, and analyze user paths inline without creating saved reports first.
---

# Flow queries

Build typed flow path analysis against Mixpanel's Insights engine — define anchor events, control forward/reverse step depth, apply per-step filters, and analyze user paths inline without creating saved reports first.

::: tip Recommended
`ws.queryFlow()` is the typed way to run flow analysis programmatically. It supports capabilities not available through the legacy `querySavedFlows()` method, including per-step filters, direction controls, multiple visualization modes, a plain `{ nodes, edges }` graph, and typed tree results.
:::

## When to use `queryFlow()`

`queryFlow()` builds flow bookmark params and posts them to the Insights engine. The legacy `querySavedFlows()` method queries a pre-existing saved Flows report by bookmark ID. Use `queryFlow()` when you need any of the capabilities in the right column:

| Capability             | Legacy `querySavedFlows()`            | `queryFlow()`                                                  |
| ---------------------- | ------------------------------------- | -------------------------------------------------------------- |
| Basic flow analysis    | `querySavedFlows(123)`                | `queryFlow("Purchase")`                                        |
| Ad-hoc anchor events   | Not available — requires saved report | `queryFlow("Purchase")` or `queryFlow(["Signup", "Purchase"])` |
| Per-step filters       | Not available                         | `new FlowStep({ event: "Purchase", filters: [...] })`          |
| Direction control      | Not available                         | `forward: 3, reverse: 1`                                       |
| Per-step direction     | Not available                         | `new FlowStep({ event: "Purchase", forward: 5 })`              |
| Visualization modes    | Not available                         | `mode: "sankey"`, `"paths"`, or `"tree"`                       |
| Graph output           | Not available                         | `result.graph()` — `{ nodes, edges }`                          |
| Top transitions        | Not available                         | `result.topTransitions(10)`                                    |
| Drop-off summary       | Not available                         | `result.dropOffSummary()`                                      |
| Tree traversal         | Not available                         | `result.trees` — recursive `FlowTreeNode`                      |
| Save query as a report | N/A                                   | `result.params` → `createBookmark()`                           |

Use the legacy `querySavedFlows()` when:

- You need to query an existing saved Flows report by bookmark ID → `querySavedFlows(123)`

See [Live analytics](/guide/live-analytics) for the legacy methods.

## Getting started

The simplest possible flow query — what happens after a Purchase event, last 30 days:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

const result = await ws.queryFlow("Purchase");
console.table(result.toNodesRows().slice(0, 5));
// step | event        | type    | count | anchor_type
// 0    | Purchase     | ANCHOR  | 5000  | NORMAL
// 1    | View Receipt | FORWARD | 3200  | NORMAL
// 1    | Add to Cart  | FORWARD | 1800  | NORMAL

console.table(result.toEdgesRows().slice(0, 5));
// source_step | source_event | target_step | target_event | count | target_type
// 0           | Purchase     | 1           | View Receipt | 3200  | FORWARD
// 0           | Purchase     | 1           | Add to Cart  | 1800  | FORWARD
```

Add direction controls and time range:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// 3 steps forward and 1 step back from Purchase
const result = await ws.queryFlow("Purchase", {
  forward: 3,
  reverse: 1,
  last: 90,
});

// Top user paths
console.log(result.topTransitions(5));
// [["Purchase@0", "View Receipt@1", 3200], ["View Receipt@1", "Checkout@2", 2100], ...]

// Specific date range
const q1 = await ws.queryFlow("Purchase", {
  from_date: "2025-01-01",
  to_date: "2025-03-31",
});
```

::: info Coming from Python?
`ws.query_flow("Purchase", forward=3, reverse=1)` becomes `ws.queryFlow("Purchase", { forward: 3, reverse: 1 })`. `result.nodes_df` / `edges_df` / `trees_df` become `toNodesRows()` / `toEdgesRows()` / `toTreesRows()`; the NetworkX `graph` property becomes the `graph()` method returning a plain `{ nodes, edges }` object; `to_anytree()` becomes `toAnytree()` returning parent-linked plain objects. See [Coming from Python](/guide/coming-from-python).
:::

## Steps

### Plain strings

The simplest way to define anchor events — pass event names as strings:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Single anchor event
const single = await ws.queryFlow("Purchase");

// Multiple anchor events
const multiple = await ws.queryFlow(["Signup", "Purchase"]);
```

Each string becomes an anchor step in the flow — Mixpanel traces user paths forward and backward from these events.

### The `FlowStep` class

For per-step configuration with filters and direction overrides, use `FlowStep` objects:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { FlowStep, Filter } from "@mixpanel-headless/core";

const result = await ws.queryFlow(
  new FlowStep({
    event: "Purchase",
    forward: 5,
    reverse: 2,
    filters: [Filter.greaterThan("amount", 50)],
  }),
);
```

`FlowStep` fields:

| Field                | Type                        | Default    | Description                                            |
| -------------------- | --------------------------- | ---------- | ------------------------------------------------------ |
| `event`              | `string`                    | (required) | Mixpanel event name to anchor on                       |
| `forward`            | `number \| null`            | `null`     | Forward steps for this step (0-5, overrides global)    |
| `reverse`            | `number \| null`            | `null`     | Reverse steps for this step (0-5, overrides global)    |
| `label`              | `string \| null`            | `null`     | Display label (defaults to event name)                 |
| `filters`            | `readonly Filter[] \| null` | `null`     | Per-step filter conditions                             |
| `filters_combinator` | `"all" \| "any"`            | `"all"`    | How per-step filters combine (AND/OR)                  |
| `session_event`      | `"start" \| "end" \| null`  | `null`     | Session anchor (see [Session events](#session-events)) |

Plain strings and `FlowStep` objects can be mixed freely:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { FlowStep, Filter } from "@mixpanel-headless/core";
const ws = createNodeWorkspace();
// ---cut---
const result = await ws.queryFlow([
  "Signup", // plain string — no overrides needed
  new FlowStep({
    event: "Purchase",
    filters: [Filter.equals("country", "US")],
  }),
]);
```

### Per-step filters

Apply filters to individual steps using `FlowStep.filters`. These restrict which events count for that specific anchor:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { FlowStep, Filter } from "@mixpanel-headless/core";

const result = await ws.queryFlow(
  new FlowStep({
    event: "Purchase",
    filters: [Filter.equals("country", "US"), Filter.greaterThan("amount", 25)],
  }),
);
```

By default, multiple per-step filters combine with AND logic. Use `filters_combinator: "any"` for OR logic:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { FlowStep, Filter } from "@mixpanel-headless/core";
const ws = createNodeWorkspace();
// ---cut---
const result = await ws.queryFlow(
  new FlowStep({
    event: "Purchase",
    filters: [Filter.equals("country", "US"), Filter.equals("country", "CA")],
    filters_combinator: "any", // match US OR CA
  }),
);
```

See [Insights queries](/guide/query) for the full list of `Filter` builders.

### Filtering with `where`

Restrict flow analysis to a subset of users using the `where` option. Flows support both cohort filters and property filters:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import {
  Filter,
  CohortCriteria,
  CohortDefinition,
} from "@mixpanel-headless/core";

// Cohort filter — what do power users do after purchasing?
const powerUsers = await ws.queryFlow("Purchase", {
  forward: 3,
  where: Filter.inCohort(123, "Power Users"),
});

// Property filter — iOS users only
const ios = await ws.queryFlow("Purchase", {
  where: Filter.equals("platform", "iOS"),
  last: 30,
});

// Inline cohort — what paths do frequent buyers take?
const frequentBuyers = new CohortDefinition(
  CohortCriteria.didEvent("Purchase", { at_least: 5, within_days: 30 }),
);
const frequent = await ws.queryFlow("Purchase", {
  where: Filter.inCohort(frequentBuyers, "Frequent Buyers"),
});
```

::: info
Custom properties (`CustomPropertyRef`, `InlineCustomProperty`) are not supported in flows. Cohort breakdowns go through `segments`, not `group_by` — see [Flow segments](#flow-segments).
:::

See [Insights queries](/guide/query) for the full cohort filter reference and all `Filter` builders.

## Direction

Control how many steps forward and backward from the anchor Mixpanel traces:

| Option    | Range | Default | Description                          |
| --------- | ----- | ------- | ------------------------------------ |
| `forward` | 0–5   | 3       | Steps traced after the anchor event  |
| `reverse` | 0–5   | 0       | Steps traced before the anchor event |

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Forward-only (default) — what happens after Purchase?
const after = await ws.queryFlow("Purchase", { forward: 3 });

// Reverse-only — what led to Purchase?
const before = await ws.queryFlow("Purchase", { forward: 0, reverse: 3 });

// Both directions — context around Purchase
const around = await ws.queryFlow("Purchase", { forward: 3, reverse: 2 });
```

At least one direction must be nonzero — a flow with `forward: 0, reverse: 0` throws a validation error.

### Per-step direction overrides

Each `FlowStep` can override the global direction settings:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { FlowStep } from "@mixpanel-headless/core";

const result = await ws.queryFlow(
  [
    new FlowStep({ event: "Signup", forward: 5 }), // trace 5 steps forward from Signup
    new FlowStep({ event: "Purchase", reverse: 3 }), // trace 3 steps back from Purchase
  ],
  {
    forward: 2, // global default (used when step doesn't override)
    reverse: 0, // global default
  },
);
```

When a step provides `forward` or `reverse`, that value is used for that step. When `null`, the global value applies.

## Visualization modes

The `mode` option controls how flow data is structured and returned (`FlowChartType`):

| Mode                 | `flows_merge_type` | Use case                                                  |
| -------------------- | ------------------ | --------------------------------------------------------- |
| `"sankey"` (default) | `"graph"`          | Aggregated node/edge graph — best for Sankey diagrams     |
| `"paths"`            | `"list"`           | Top user paths as ranked sequences                        |
| `"tree"`             | `"tree"`           | Recursive tree from anchor — detailed node-level analysis |

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Sankey mode (default) — aggregated graph
const sankey = await ws.queryFlow("Purchase", { mode: "sankey" });
console.table(sankey.toNodesRows()); // node-level data
console.table(sankey.toEdgesRows()); // edge-level transitions
console.log(sankey.graph()); // { nodes, edges }

// Paths mode — top user paths
const paths = await ws.queryFlow("Purchase", { mode: "paths" });
console.table(paths.toRows()); // path_index | step | event | type | count

// Tree mode — recursive tree structure
const tree = await ws.queryFlow("Purchase", { mode: "tree" });
for (const root of tree.trees) {
  console.log(`${root.event}: ${root.total_count} users`);
  for (const child of root.children) {
    console.log(`  → ${child.event}: ${child.total_count}`);
  }
}
```

`toRows()` and `rowColumns()` follow the mode: the nodes frame for sankey, the trees frame for tree, and one row per (path, step) for paths.

## Conversion window

Control the maximum time between the first and last step in the flow:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// 7-day conversion window (default)
const week = await ws.queryFlow("Purchase", { conversion_window: 7 });

// 30-day window
const month = await ws.queryFlow("Purchase", {
  conversion_window: 30,
  conversion_window_unit: "day",
});

// Weekly window
const fortnight = await ws.queryFlow("Purchase", {
  conversion_window: 2,
  conversion_window_unit: "week",
});

// Session-based window
const session = await ws.queryFlow("Purchase", {
  conversion_window: 1,
  conversion_window_unit: "session",
});
```

The accepted units are the members of `FlowConversionWindowUnit` — a subset of the funnel units (no second, minute or hour):

| Unit              | Max value | Description                 |
| ----------------- | --------- | --------------------------- |
| `"day"` (default) | 366       | Window measured in days     |
| `"week"`          | 52        | Window measured in weeks    |
| `"month"`         | 12        | Window measured in months   |
| `"session"`       | 1         | Window measured in sessions |

## Count type

The `count_type` option controls how users are counted (`FlowCountType`):

| Count type           | What it measures                                            |
| -------------------- | ----------------------------------------------------------- |
| `"unique"` (default) | Unique users who traversed each path                        |
| `"total"`            | Total event occurrences (one user can count multiple times) |
| `"session"`          | Unique sessions containing the path                         |

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Unique users (default)
const unique = await ws.queryFlow("Purchase", { count_type: "unique" });

// Total events
const total = await ws.queryFlow("Purchase", { count_type: "total" });

// Session-based (requires a session conversion window)
const sessions = await ws.queryFlow("Purchase", {
  count_type: "session",
  conversion_window: 1,
  conversion_window_unit: "session",
});
```

## Additional options

### Data group

Scope flow analysis to a specific data group:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Scope to a data group
const result = await ws.queryFlow("Purchase", { data_group_id: 42, last: 30 });
```

### Cardinality

Control how many unique next/previous events are shown per step. Higher values show more granular paths; lower values collapse rare paths:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Show top 5 events per step (default is 3)
const five = await ws.queryFlow("Purchase", { cardinality: 5 });

// Maximum granularity
const max = await ws.queryFlow("Purchase", { cardinality: 50 });
```

Range: 1–50.

### Collapse repeated events

Merge consecutive occurrences of the same event into a single step:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Collapse repeated events (e.g., multiple "Page View" in a row)
const result = await ws.queryFlow("Purchase", { collapse_repeated: true });
```

### Hidden events

Exclude specific events from the flow analysis:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Hide noisy events from the flow
const result = await ws.queryFlow("Purchase", {
  hidden_events: ["Session Start", "Page View", "Heartbeat"],
});
```

## Time ranges

### Relative (default)

By default, `queryFlow()` returns the last 30 days. Customize with `last`:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Last 7 days
const week = await ws.queryFlow("Purchase", { last: 7 });

// Last 90 days
const quarter = await ws.queryFlow("Purchase", { last: 90 });
```

### Absolute

Specify explicit start and end dates:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Q1 2025
const result = await ws.queryFlow("Purchase", {
  from_date: "2025-01-01",
  to_date: "2025-03-31",
});
```

Dates must be in `YYYY-MM-DD` format. When `from_date` is provided without `to_date`, the end date defaults to today.

## Working with results

### `FlowQueryResult`

`queryFlow()` returns a `FlowQueryResult` with mode-aware accessors:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
const result = await ws.queryFlow("Purchase", {
  forward: 3,
  reverse: 1,
  last: 90,
});

// Node data — one row per node in the flow
result.toNodesRows();
// [{ step: 0, event: "Purchase", type: "ANCHOR", count: 5000, anchor_type: "NORMAL",
//    is_custom_event: false, conversion_rate_change: 0 }, ...]

// Edge data — transitions between nodes
result.toEdgesRows();
// [{ source_step: 0, source_event: "Purchase", target_step: 1,
//    target_event: "View Receipt", count: 3200, target_type: "FORWARD" }, ...]

// Graph — for programmatic path analysis
const g = result.graph();
console.log(`Nodes: ${g.nodes.length}, Edges: ${g.edges.length}`);

// Top transitions by volume
result.topTransitions(5);
// [["Purchase@0", "View Receipt@1", 3200], ["View Receipt@1", "Checkout@2", 2100], ...]

// Per-step drop-off summary
result.dropOffSummary();
// { step_0: { total: 5000, dropoff: 0, rate: 0.0 }, step_1: { ... }, ... }

// Overall conversion rate
result.overall_conversion_rate; // 0.42

// Visualization mode
result.mode; // "sankey"

// Raw payloads
result.steps; // sankey step dicts ({ nodes: [...] } per step)
result.flows; // paths-mode flow dicts ({ flowSteps: [...] })
result.breakdowns; // segment breakdown dicts

// API metadata
result.computed_at; // "2025-03-31T12:00:00.000000+00:00"
result.meta; // { sampling_factor: 1.0, ... }

// Generated bookmark params (for debugging or persistence)
result.params; // the full bookmark JSON sent to the API
```

### Node rows (`toNodesRows()`)

One row per node in the flow graph; `nodesRowColumns()` names the columns:

| Column                   | Description                                                     |
| ------------------------ | --------------------------------------------------------------- |
| `step`                   | Step index (0 = anchor, positive = forward, negative = reverse) |
| `event`                  | Event name                                                      |
| `type`                   | Node type: `ANCHOR`, `FORWARD`, `REVERSE`, `DROPOFF`, `PRUNED`  |
| `count`                  | Number of users at this node                                    |
| `anchor_type`            | `NORMAL`, `RELATIVE_FORWARD`, or `RELATIVE_REVERSE`             |
| `is_custom_event`        | Whether this is a computed/custom event                         |
| `conversion_rate_change` | Change in conversion rate from previous step                    |

### Edge rows (`toEdgesRows()`)

One row per transition between nodes; `edgesRowColumns()` names the columns:

| Column         | Description                              |
| -------------- | ---------------------------------------- |
| `source_step`  | Source node step index                   |
| `source_event` | Source event name                        |
| `target_step`  | Target node step index                   |
| `target_event` | Target event name                        |
| `count`        | Number of users who made this transition |
| `target_type`  | Target node type                         |

### Graph (`graph()`)

`graph()` returns a plain `{ nodes, edges }` adjacency object — the same data Python hands to `networkx.DiGraph`, in the same order:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
const result = await ws.queryFlow("Purchase", { forward: 3 });
// ---cut---
const g = result.graph();

// Anchor nodes
const anchors = g.nodes.filter((n) => n.type === "ANCHOR");

// Everything reachable in one hop from the first anchor
const first = anchors[0];
if (first) {
  for (const edge of g.edges.filter((e) => e.source === first.id)) {
    console.log(`${edge.source} → ${edge.target}: ${edge.count} users`);
  }
}

// Highest-traffic edges
for (const edge of [...g.edges].sort((a, b) => b.count - a.count).slice(0, 5)) {
  console.log(`${edge.source} → ${edge.target}: ${edge.count} users`);
}
```

Nodes are keyed as `"{event}@{step}"` (`id`) with `step`, `event`, `type`, `count` and `anchor_type`; edges carry `source`, `target`, `count` and `type`.

#### What the graph unlocks

The graph turns flow data into a structure that algorithms can reason about. There is no bundled graph library, but the questions NetworkX answers in Python are a few lines of plain TypeScript — or feed `nodes`/`edges` to a graph library of your choice:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
const result = await ws.queryFlow("Signup", { forward: 3 });
// ---cut---
const g = result.graph();
const outEdges = (id: string) => g.edges.filter((e) => e.source === id);
const inEdges = (id: string) => g.edges.filter((e) => e.target === id);

// "What's the shortest path from Signup to Purchase?" — breadth-first search
function shortestPath(from: string, to: string): string[] | null {
  const previous = new Map<string, string | null>([[from, null]]);
  const queue = [from];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (current === to) {
      const path: string[] = [];
      for (
        let at: string | null = to;
        at !== null;
        at = previous.get(at) ?? null
      ) {
        path.unshift(at);
      }
      return path;
    }
    for (const edge of outEdges(current)) {
      if (!previous.has(edge.target)) {
        previous.set(edge.target, current);
        queue.push(edge.target);
      }
    }
  }
  return null;
}
shortestPath("Signup@0", "Purchase@3");
// → ["Signup@0", "Browse@1", "Add to Cart@2", "Purchase@3"]

// "What fraction of Add to Cart users actually Purchase?"
const cartOut = outEdges("Add to Cart@2").reduce((sum, e) => sum + e.count, 0);
const toPurchase =
  outEdges("Add to Cart@2").find((e) => e.target === "Purchase@3")?.count ?? 0;
const microConversion = cartOut > 0 ? toPurchase / cartOut : 0;

// "Which events are dead ends — reachable but leading nowhere?"
const deadEnds = g.nodes.filter(
  (n) => outEdges(n.id).length === 0 && inEdges(n.id).length > 0,
);
```

This is particularly powerful for AI agents: they can programmatically explore path structure, identify optimization opportunities, and quantify the impact of removing or adding steps, without any visualization required.

### Tree mode results

When `mode: "tree"`, results include `FlowTreeNode` objects:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
const result = await ws.queryFlow("Purchase", { mode: "tree" });

for (const tree of result.trees) {
  console.log(`${tree.event}: ${tree.total_count} users`);
  console.log(`  Conversion: ${(tree.conversion_rate * 100).toFixed(1)}%`);
  console.log(`  Drop-off: ${tree.drop_off_count}`);
  console.log(`  Depth: ${tree.depth}`);

  // Traverse children
  for (const child of tree.children) {
    console.log(`  → ${child.event}: ${child.total_count}`);
  }

  // All paths from root to leaves
  for (const path of tree.allPaths()) {
    console.log(path.map((node) => node.event).join(" → "));
  }
}

// Flattened rows, one per node, with a " > "-joined path
console.table(result.toTreesRows());
```

`FlowTreeNode` fields:

| Field             | Type                      | Description                                                   |
| ----------------- | ------------------------- | ------------------------------------------------------------- |
| `event`           | `string`                  | Event name                                                    |
| `type`            | `FlowNodeType`            | `ANCHOR`, `NORMAL`, `DROPOFF`, `PRUNED`, `FORWARD`, `REVERSE` |
| `step_number`     | `number`                  | Zero-based step index                                         |
| `total_count`     | `number`                  | Total users at this node                                      |
| `drop_off_count`  | `number`                  | Users who dropped off                                         |
| `converted_count` | `number`                  | Users who continued                                           |
| `anchor_type`     | `FlowAnchorType`          | `NORMAL`, `RELATIVE_FORWARD`, or `RELATIVE_REVERSE`           |
| `is_computed`     | `boolean`                 | Whether the node was computed rather than observed            |
| `children`        | `readonly FlowTreeNode[]` | Child nodes                                                   |
| `conversion_rate` | `number`                  | Getter: `converted_count / total_count`                       |
| `drop_off_rate`   | `number`                  | Getter: `drop_off_count / total_count`                        |
| `depth`           | `number`                  | Getter: maximum depth of subtree                              |
| `node_count`      | `number`                  | Getter: total nodes in subtree                                |
| `leaf_count`      | `number`                  | Getter: leaves in subtree                                     |

`FlowTreeNode` methods:

| Method        | Returns                                  | Description                                     |
| ------------- | ---------------------------------------- | ----------------------------------------------- |
| `allPaths()`  | `ReadonlyArray<readonly FlowTreeNode[]>` | All root-to-leaf paths through the subtree      |
| `flatten()`   | `readonly FlowTreeNode[]`                | Preorder traversal of all nodes                 |
| `find(event)` | `readonly FlowTreeNode[]`                | All nodes matching an event name                |
| `render()`    | `string`                                 | Box-drawing ASCII visualization                 |
| `toJSON()`    | `Record<string, unknown>`                | JSON-serializable recursive object              |
| `toAnytree()` | parent-linked node                       | Convert to a tree with `parent` back-references |

The trees frame (`toTreesRows()` / `treesRowColumns()`) has the columns `tree_index`, `depth`, `path`, `event`, `type`, `step_number`, `total_count`, `drop_off_count`, `converted_count`.

#### What the tree unlocks

Tree mode gives each node its own `total_count`, `converted_count`, and `drop_off_count` — the full decision tree at every branching point. This lets you answer questions about _where exactly_ users diverge:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
const result = await ws.queryFlow("Signup", { mode: "tree", forward: 4 });

for (const tree of result.trees) {
  // "At each step, what percentage of users take each branch?"
  for (const node of tree.flatten()) {
    if (node.children.length > 0) {
      console.log(`\nAfter ${node.event} (${node.total_count} users):`);
      const ranked = [...node.children].sort(
        (a, b) => b.total_count - a.total_count,
      );
      for (const child of ranked) {
        const pct = (child.total_count / node.total_count) * 100;
        console.log(
          `  → ${child.event}: ${pct.toFixed(0)}% (${child.total_count})`,
        );
      }
    }
  }

  // "What's the highest-converting complete path?"
  const bestPath = [...tree.allPaths()].sort(
    (a, b) =>
      (b.at(-1)?.converted_count ?? 0) - (a.at(-1)?.converted_count ?? 0),
  )[0];
  if (bestPath) {
    console.log(
      bestPath
        .map((n) => `${n.event}(${(n.conversion_rate * 100).toFixed(0)}%)`)
        .join(" → "),
    );
  }

  // "Where is the single biggest drop-off?"
  const worst = [...tree.flatten()].sort(
    (a, b) => b.drop_off_count - a.drop_off_count,
  )[0];
  if (worst) {
    console.log(
      `Biggest drop-off: ${worst.event} — ${worst.drop_off_count} users lost`,
    );
  }

  // Render the full decision tree as ASCII
  console.log(tree.render());
  // Purchase (5000)
  // ├── View Receipt (3200)
  // │   ├── Rate App (1100)
  // │   └── Browse More (2100)
  // └── Contact Support (800)
  //     └── ⊘ Drop-off (800)
}
```

The tree is uniquely suited to _branching analysis_ — understanding not just the top path, but what fraction of users chose each alternative at every fork.

#### Parent-linked trees (`toAnytree()`)

`FlowTreeNode` is immutable and children-only — you can traverse downward, but you can't ask a node "how did I get here?" `toAnytree()` builds a parallel tree of plain objects with **parent references**, the port of Python's `to_anytree()`. Where Python returns `anytree.AnyNode` objects, the port returns plain nodes with the same eight attributes plus `parent` and `children`; `RenderTree`, `findall` and the Graphviz exporters are anytree library helpers and have no twin.

Use `toAnytree()` on any single `FlowTreeNode`, or `result.anytree()` for the full list of converted roots:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
const result = await ws.queryFlow("Purchase", { mode: "tree", forward: 3 });
const root = result.anytree()[0]; // converted root, parent === null

type Linked = NonNullable<typeof root>;

// Preorder walk — the equivalent of anytree's findall()
function* walk(node: Linked): Generator<Linked> {
  yield node;
  for (const child of node.children) {
    yield* walk(child);
  }
}

// Root-to-node chain — the equivalent of anytree's node.path
function pathTo(node: Linked): Linked[] {
  const chain: Linked[] = [];
  for (let at: Linked | null = node; at !== null; at = at.parent) {
    chain.unshift(at);
  }
  return chain;
}

if (root) {
  // Find all drop-off points and trace how users got there
  for (const node of walk(root)) {
    if (node.type === "DROPOFF") {
      const journey = pathTo(node)
        .map((n) => n.event)
        .join(" → ");
      console.log(`${journey} (${node.drop_off_count} users lost)`);
    }
  }

  // Parent references — "what came immediately before this event?"
  const support = [...walk(root)].find((n) => n.event === "Contact Support");
  if (support?.parent) {
    console.log(`${support.event} ← ${support.parent.event}`);
    // Contact Support ← Purchase
  }
}
```

Each linked node carries `parent`, `children`, `event`, `type`, `step_number`, `total_count`, `drop_off_count`, `converted_count`, `anchor_type` and `is_computed`. Depth is `pathTo(node).length - 1`; ancestors are `pathTo(node).slice(0, -1)`; siblings are `node.parent?.children.filter((n) => n !== node)`.

### Persisting as a saved report

The generated bookmark params can be saved as a Mixpanel report:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { CreateBookmarkParams } from "@mixpanel-headless/core";

const result = await ws.queryFlow("Purchase", { forward: 3, reverse: 1 });

await ws.createBookmark(
  new CreateBookmarkParams({
    name: "Purchase Flow Analysis",
    bookmark_type: "flows",
    params: result.params,
  }),
);
```

To share the query without saving a report, pass the result to `createReportLink()` — see [Report links](/guide/report-links).

### Debugging

Inspect `result.params` to see the exact bookmark JSON sent to the API:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
const result = await ws.queryFlow("Purchase");
console.log(JSON.stringify(result.params, null, 2));
```

## Validation

`queryFlow()` validates all parameter combinations **before** making an API call and throws `BookmarkValidationError` with descriptive messages:

| Rule                               | Error code                            | Error message                                                        |
| ---------------------------------- | ------------------------------------- | -------------------------------------------------------------------- |
| No steps provided                  | `FL1_EMPTY_STEPS`                     | At least one step event is required                                  |
| Empty step event name              | `FL2_EMPTY_STEP_EVENT`                | Step event name must be a non-empty string                           |
| Control chars in event name        | `FL2_CONTROL_CHAR_STEP_EVENT`         | Step event name contains control characters                          |
| Forward out of range               | `FL3_FORWARD_RANGE`                   | forward must be between 0 and 5                                      |
| Reverse out of range               | `FL4_REVERSE_RANGE`                   | reverse must be between 0 and 5                                      |
| Both directions zero               | `FL5_NO_DIRECTION`                    | At least one of forward or reverse must be > 0; both are currently 0 |
| Cardinality out of range           | `FL6_CARDINALITY_RANGE`               | cardinality must be between 1 and 50                                 |
| Non-positive conversion window     | `FL7_CONVERSION_WINDOW_POSITIVE`      | conversion_window must be a positive integer                         |
| Window exceeds max for unit        | `FL7_CONVERSION_WINDOW_MAX`           | conversion_window exceeds maximum for unit                           |
| Invalid count type                 | `FL_INVALID_COUNT_TYPE`               | Must be one of: unique, total, session                               |
| Invalid mode                       | `FL_INVALID_MODE`                     | Must be one of: sankey, paths, tree                                  |
| Invalid window unit                | `FL_INVALID_WINDOW_UNIT`              | Must be one of: day, week, month, session                            |
| Session count without session unit | `FL9_SESSION_REQUIRES_SESSION_WINDOW` | count_type='session' requires conversion_window_unit='session'       |
| Session unit without window of 1   | `FL10_SESSION_WINDOW_REQUIRES_ONE`    | conversion_window_unit='session' requires conversion_window=1        |

Errors are collected — all validation issues are reported at once, not just the first:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { BookmarkValidationError } from "@mixpanel-headless/core";

try {
  await ws.queryFlow("", { forward: 10, reverse: -1 });
} catch (error) {
  if (error instanceof BookmarkValidationError) {
    for (const finding of error.errors) {
      console.log(`[${finding.code}] ${finding.path}: ${finding.message}`);
    }
    // [FL2_EMPTY_STEP_EVENT] steps[0]: Step event name must be a non-empty string
    // [FL3_FORWARD_RANGE] forward: forward must be between 0 and 5 (got 10)
    // [FL4_REVERSE_RANGE] reverse: reverse must be between 0 and 5 (got -1)
  } else {
    throw error;
  }
}
```

Constructing a `FlowStep` with a bad field (an empty event name, `forward`/`reverse` outside 0–5, or a `session_event` that does not match the event name) throws `ParamValidationError` immediately, before any query runs. See [Error handling](/guide/error-handling).

## Complete examples

### E-commerce checkout flow

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { FlowStep, Filter } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

// What happens after users add items to cart?
const result = await ws.queryFlow(
  new FlowStep({
    event: "Add to Cart",
    forward: 4,
    filters: [Filter.greaterThan("item_price", 10)],
  }),
  {
    conversion_window: 7,
    last: 90,
    hidden_events: ["Session Start", "Page View"],
  },
);

// Top conversion paths
for (const [src, tgt, count] of result.topTransitions(10)) {
  console.log(`  ${src} → ${tgt}: ${count.toLocaleString()} users`);
}

// Drop-off analysis
for (const [step, stats] of Object.entries(result.dropOffSummary())) {
  const { total, dropoff, rate } = stats as {
    total: number;
    dropoff: number;
    rate: number;
  };
  console.log(
    `  ${step}: ${dropoff.toLocaleString()} of ${total.toLocaleString()} dropped (${(rate * 100).toFixed(1)}%)`,
  );
}
```

### User onboarding paths

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// What do new users do after signing up?
const result = await ws.queryFlow("Signup", {
  forward: 5,
  cardinality: 10,
  last: 30,
  collapse_repeated: true,
});

// Inspect the graph
const g = result.graph();
console.log(`Discovered ${g.nodes.length} unique steps`);
console.log(`Discovered ${g.edges.length} unique transitions`);

// Find the most common next steps from signup
for (const edge of g.edges.filter((e) => e.source === "Signup@0")) {
  console.log(
    `  Signup → ${edge.target}: ${edge.count.toLocaleString()} users`,
  );
}
```

### Reverse flow analysis

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// What led users to churn?
const result = await ws.queryFlow("Cancel Subscription", {
  forward: 0,
  reverse: 5,
  count_type: "unique",
  last: 90,
});

// Analyze the reverse path
console.table(result.toNodesRows().filter((row) => row["type"] === "REVERSE"));
```

### Tree mode exploration

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Detailed tree analysis of purchase paths
const result = await ws.queryFlow("Purchase", { mode: "tree", forward: 3 });

for (const tree of result.trees) {
  console.log(
    `\nAnchor: ${tree.event} (${tree.total_count.toLocaleString()} users)`,
  );
  console.log(`  Tree depth: ${tree.depth}`);
  console.log(`  Total nodes: ${tree.node_count}`);

  // Print all complete paths
  for (const path of tree.allPaths()) {
    const pathStr = path.map((n) => `${n.event}(${n.total_count})`).join(" → ");
    console.log(`  ${pathStr}`);
  }
}
```

## Generating params without querying

Use `buildFlowParams()` to generate bookmark params without making an API call — useful for debugging, inspecting the generated JSON, or saving queries as reports:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { CreateBookmarkParams } from "@mixpanel-headless/core";

// Same arguments as queryFlow(), returns the params object instead of a FlowQueryResult
const params = await ws.buildFlowParams("Purchase", {
  forward: 3,
  reverse: 1,
  conversion_window: 7,
  last: 90,
});

console.log(JSON.stringify(params, null, 2)); // inspect the generated bookmark JSON

// Save as a report directly from params
await ws.createBookmark(
  new CreateBookmarkParams({
    name: "Purchase Flow (3 forward, 1 reverse)",
    bookmark_type: "flows",
    params,
  }),
);
```

### Running built params

Use `runFlowParams()` to execute params that `buildFlowParams()` produced (or params you wrote by hand). It returns the same `FlowQueryResult` as `queryFlow()`. The chart mode is read from the params (`flows_merge_type`, falling back to `chartType`), so sankey, paths, and tree params all run as built. Pass `mode` to override:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
const params = await ws.buildFlowParams("Purchase", {
  forward: 3,
  reverse: 1,
  last: 90,
});
const steps = params["steps"] as Array<Record<string, unknown>>;
if (steps[0]) {
  steps[0]["forward"] = 5; // edit before it runs
}
const result = await ws.runFlowParams(params);

const tree = await ws.runFlowParams(
  await ws.buildFlowParams("Purchase", { mode: "tree" }),
);
tree.mode; // "tree"
```

`runFlowParams()` also takes `workspace_id` to run under a different data view than the session's.

## Flow segments

Break flow results down by a property, cohort, or frequency using the `segments` option:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { GroupBy, CohortBreakdown } from "@mixpanel-headless/core";

// Break down paths by platform
const byPlatform = await ws.queryFlow("Purchase", {
  segments: "platform",
  last: 30,
});

// Segment by a GroupBy with bucketing
const byRevenue = await ws.queryFlow("Purchase", {
  segments: new GroupBy({
    property: "revenue",
    property_type: "number",
    bucket_size: 50,
  }),
  last: 30,
});

// Segment by cohort membership
const byCohort = await ws.queryFlow("Purchase", {
  segments: new CohortBreakdown({ cohort: 123, name: "Power Users" }),
  last: 30,
});
```

`segments` accepts a string (property name), `GroupBy`, `CohortBreakdown`, `FrequencyBreakdown`, or an array of these. Per-segment data lands in `result.breakdowns`.

## Flow exclusions

Hide specific events from flow paths using the `exclusions` option:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Exclude noisy events from the flow
const result = await ws.queryFlow("Purchase", {
  exclusions: ["Page View", "Session Start"],
  forward: 3,
  last: 30,
});
```

Excluded events are removed from the flow graph — they won't appear as nodes or edges, making it easier to see meaningful user paths. Unlike funnel exclusions, flow `exclusions` are plain event-name strings.

## Session events

Anchor a flow step to a session boundary using `FlowStep.session_event`. The event name must be the matching Mixpanel session event — `"$session_start"` for `"start"`, `"$session_end"` for `"end"`:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { FlowStep } from "@mixpanel-headless/core";

// What happens after a session starts?
const afterStart = await ws.queryFlow(
  new FlowStep({ event: "$session_start", session_event: "start" }),
  { forward: 5, last: 30 },
);

// What leads up to a session ending?
const beforeEnd = await ws.queryFlow(
  new FlowStep({ event: "$session_end", session_event: "end" }),
  { reverse: 3, last: 30 },
);
```

Values: `"start"` (session start anchor) or `"end"` (session end anchor) — the `FlowSessionEvent` union.

## Next steps

- [Unified query system](/guide/unified-query-system) — the shared vocabulary: dates, `Filter`, `GroupBy`, cohorts, results
- [Insights queries](/guide/query) — typed analytics with DAU, formulas, filters, and breakdowns
- [Funnel queries](/guide/query-funnels) — typed funnel conversion analysis with steps, exclusions, and conversion windows
- [Retention queries](/guide/query-retention) — typed retention analysis with event pairs and custom buckets
- [Live analytics](/guide/live-analytics) — legacy saved Flows report method
- [API reference](/api/) — full method signatures for `Workspace`, `FlowStep`, `FlowTreeNode`, `FlowQueryResult`
