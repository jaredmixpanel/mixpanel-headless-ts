---
title: The unified query system
description: "Five analytics engines, one TypeScript vocabulary — Filter, GroupBy, where, group_by, time ranges, inline cohorts and the build / inspect / run pattern shared by Insights, Funnels, Retention, Flows and Users."
---

# The unified query system

Five analytics engines. One TypeScript vocabulary. Every query validated before it hits the network.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { Filter } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

await ws.query("Login"); // Insights
await ws.queryFunnel(["Signup", "Purchase"]); // Funnels
await ws.queryRetention("Signup", "Login"); // Retention
await ws.queryFlow("Purchase"); // Flows
await ws.queryUser({ where: Filter.isSet("$email") }); // Users
```

Each method returns a typed result with `toRows()` and `rowColumns()`. Each method validates every option before making an API call. And the option keys you learn for one method work in all the others.

::: tip Coming from Python?
Methods are `camelCase` (`query_funnel` → `queryFunnel`), keyword arguments become one options object whose keys **stay `snake_case`** (`{ group_by: "platform", last: 90 }`), and `result.df` becomes `result.toRows()`. See [Coming from Python](/guide/coming-from-python).
:::

## The pattern

Every query method shares the same vocabulary:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { Filter, TimeComparison } from "@mixpanel-headless/core";

// These keys mean the same thing everywhere
const insights = await ws.query("Login", {
  where: Filter.equals("country", "US"), // filter
  group_by: "platform", // breakdown
  last: 90, // time range
  time_comparison: TimeComparison.relative("month"), // compare periods
  data_group_id: 42, // data group scope
});

const funnel = await ws.queryFunnel(["Signup", "Purchase"], {
  where: Filter.equals("country", "US"), // same
  group_by: "platform", // same
  last: 90, // same
  time_comparison: TimeComparison.relative("month"), // same
  data_group_id: 42, // same
});

const retention = await ws.queryRetention("Signup", "Login", {
  where: Filter.equals("country", "US"), // same
  group_by: "platform", // same
  last: 90, // same
  time_comparison: TimeComparison.relative("month"), // same
  data_group_id: 42, // same
});

const flow = await ws.queryFlow("Purchase", {
  where: Filter.equals("country", "US"), // property filters supported
  last: 90, // same
  data_group_id: 42, // same
});
```

Learn [`Filter`](/reference/core/classes/Filter), [`GroupBy`](/reference/core/classes/GroupBy), `where`, `group_by`, `last`, `time_comparison` ([`TimeComparison`](/reference/core/classes/TimeComparison)) and `data_group_id` once. Use them across engines (flows has some restrictions — see below).

## Strings first, objects when you need them

Every option that accepts a typed object also accepts a plain string. Start simple, upgrade to objects when you need more control:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { GroupBy } from "@mixpanel-headless/core";

// String — simple and readable
await ws.query("Login", { group_by: "country" });

// GroupBy object — when you need numeric bucketing
await ws.query("Purchase", {
  group_by: new GroupBy({
    property: "revenue",
    property_type: "number",
    bucket_size: 50,
  }),
});
```

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { Filter, FunnelStep } from "@mixpanel-headless/core";

// Strings — just event names
await ws.queryFunnel(["Signup", "Purchase"]);

// FunnelStep objects — when you need per-step filters
await ws.queryFunnel([
  new FunnelStep({ event: "Signup" }),
  new FunnelStep({
    event: "Purchase",
    filters: [Filter.greaterThan("amount", 50)],
  }),
]);
```

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { Filter, RetentionEvent } from "@mixpanel-headless/core";

// Strings — just born and return events
await ws.queryRetention("Signup", "Login");

// RetentionEvent objects — when you need per-event filters
await ws.queryRetention(
  new RetentionEvent({
    event: "Signup",
    filters: [Filter.equals("source", "organic")],
  }),
  "Login",
);
```

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { Filter, FlowStep } from "@mixpanel-headless/core";

// String — just an anchor event
await ws.queryFlow("Purchase");

// FlowStep object — per-step direction or filters
await ws.queryFlow(
  new FlowStep({
    event: "Purchase",
    forward: 5,
    reverse: 2,
    filters: [Filter.greaterThan("amount", 50)],
  }),
);
```

Mix freely. Strings and objects can appear in the same query.

::: info
`FlowStep.filters` accepts any `Filter` for per-step filtering. The query-level `where` option of `queryFlow()` accepts both cohort filters (`Filter.inCohort` / `Filter.notInCohort`) and property filters (`Filter.equals()`, `Filter.greaterThan()`, …).
:::

## Filters: typed builders, not operator strings

Every filter is a static builder on [`Filter`](/reference/core/classes/Filter). Autocomplete shows you every option:

```ts twoslash
import { Filter } from "@mixpanel-headless/core";

// String comparisons
Filter.equals("country", "US");
Filter.equals("country", ["US", "CA", "UK"]); // multi-value
Filter.notEquals("status", "banned");
Filter.contains("email", "@company.com");

// Numeric comparisons
Filter.greaterThan("amount", 100);
Filter.lessThan("age", 18);
Filter.between("revenue", 50, 500);

// Existence
Filter.isSet("utm_source");
Filter.isNotSet("phone");

// Boolean
Filter.isTrue("is_premium");
Filter.isFalse("opted_out");

// Dates
Filter.inTheLast("created", 30, "day");
Filter.before("signup_date", "2025-01-01");

// Cohorts (see "Cohort scoping" below)
Filter.inCohort(123, "Power Users");
Filter.notInCohort(456, "Bots");
```

Combine multiple filters with `where`:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { Filter } from "@mixpanel-headless/core";

// AND logic (default) — all conditions must match
const result = await ws.query("Purchase", {
  where: [
    Filter.equals("country", "US"),
    Filter.greaterThan("amount", 25),
    Filter.isTrue("is_premium"),
  ],
});
```

Filters work identically across `query()`, `queryFunnel()`, `queryRetention()` and `queryFlow()`.

## Results: rows, params and metadata

Insights, funnel and retention results ([`QueryResult`](/reference/core/classes/QueryResult), [`FunnelQueryResult`](/reference/core/classes/FunnelQueryResult), [`RetentionQueryResult`](/reference/core/classes/RetentionQueryResult)) share a common structure:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
const result = await ws.query("Login", { math: "dau", last: 30 });

result.toRows(); // plain row objects — one per data point
result.rowColumns(); // the column names, e.g. ["date", "event", "count"]
result.params; // the exact bookmark JSON sent to the API
result.from_date; // resolved start date
result.to_date; // resolved end date
result.computed_at; // when Mixpanel computed the result
result.meta; // sampling factor, cache status
```

`toRows()` returns `Record<string, unknown>[]` — ready for `console.table`, a DataFrame library, or `JSON.stringify`. Result fields keep their Python spelling (`from_date`, `computed_at`, `overall_conversion_rate`).

Flow results have `computed_at`, `params` and `meta` but not `from_date` / `to_date` — flow data is structured around nodes, edges and trees instead.

Engine-specific results add domain-relevant members:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Funnels
const funnel = await ws.queryFunnel(["Signup", "Purchase"]);
funnel.overall_conversion_rate; // 0.12
funnel.steps_data; // per-step counts and ratios

// Retention
const retention = await ws.queryRetention("Signup", "Login");
retention.cohorts; // per-cohort-date retention data
retention.average; // synthetic average

// Flows (sankey mode)
const flow = await ws.queryFlow("Purchase");
flow.toNodesRows(); // step | event | type | count
flow.toEdgesRows(); // source -> target with counts
flow.graph(); // { nodes, edges } — a plain adjacency object
flow.topTransitions(5); // highest-traffic edges
flow.dropOffSummary(); // per-step drop-off rates

// Flows (tree mode)
const tree = await ws.queryFlow("Purchase", { mode: "tree" });
tree.trees; // recursive FlowTreeNode objects
tree.anytree(); // parent-linked nodes for tree renderers
```

## The five engines

### Insights — `query()`

The general-purpose analytics engine. Counts, aggregations, DAU/WAU/MAU, formulas, rolling windows.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// DAU over 90 days, weekly
const dau = await ws.query("Login", { math: "dau", last: 90, unit: "week" });

// Revenue percentiles
const p99 = await ws.query("Purchase", {
  math: "p99",
  math_property: "amount",
});

// Per-user average purchase amount
const perUser = await ws.query("Purchase", {
  math: "total",
  per_user: "average",
  math_property: "amount",
});

// 7-day rolling average
const rolling = await ws.query("Signup", {
  math: "unique",
  rolling: 7,
  last: 60,
});

// Multi-event comparison
const compare = await ws.query(["Signup", "Login", "Purchase"], {
  math: "unique",
});
```

#### Formulas

Compute derived metrics. Letters A–Z reference events by position:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { Formula, Metric } from "@mixpanel-headless/core";

// Top-level formula option
const conversion = await ws.query(
  [
    new Metric({ event: "Signup", math: "unique" }),
    new Metric({ event: "Purchase", math: "unique" }),
  ],
  { formula: "(B / A) * 100", formula_label: "Conversion Rate", unit: "week" },
);

// Or Formula objects in the event list
const sameThing = await ws.query([
  new Metric({ event: "Signup", math: "unique" }),
  new Metric({ event: "Purchase", math: "unique" }),
  new Formula({ expression: "(B / A) * 100", label: "Conversion Rate" }),
]);
```

#### The Metric class

When different events need different aggregation:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { Filter, Metric } from "@mixpanel-headless/core";

const result = await ws.query([
  new Metric({ event: "Signup", math: "unique" }),
  new Metric({ event: "Purchase", math: "total", property: "revenue" }),
  new Metric({
    event: "Support Ticket",
    math: "unique",
    filters: [Filter.equals("priority", "high")],
  }),
]);
```

**Full reference:** [Insights queries](/guide/query)

### Funnels — `queryFunnel()`

Step-by-step conversion analysis with conversion windows, exclusions and step ordering.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { Exclusion, Filter, FunnelStep } from "@mixpanel-headless/core";

// Two-step funnel with 7-day conversion window
const simple = await ws.queryFunnel(["Signup", "Purchase"], {
  conversion_window: 7,
});
console.log(
  `Conversion: ${(simple.overall_conversion_rate * 100).toFixed(1)}%`,
);

// Per-step filters and labels
const detailed = await ws.queryFunnel([
  new FunnelStep({ event: "Signup" }),
  new FunnelStep({
    event: "Add to Cart",
    filters: [Filter.greaterThan("item_count", 0)],
  }),
  new FunnelStep({ event: "Checkout" }),
  new FunnelStep({ event: "Purchase", label: "Completed Purchase" }),
]);

// Exclude events between steps
const excluded = await ws.queryFunnel(["Signup", "Add to Cart", "Purchase"], {
  exclusions: ["Logout"], // all steps
  // Or target a specific range:
  // exclusions: [new Exclusion({ event: "Refund", from_step: 1, to_step: 2 })],
});

// Hold a property constant across all steps
const samePlatform = await ws.queryFunnel(["Signup", "Purchase"], {
  // users must complete on the same platform
  holding_constant: "platform",
});

// Session-based conversion
const session = await ws.queryFunnel(["Browse", "Add to Cart", "Purchase"], {
  conversion_window: 1,
  conversion_window_unit: "session",
  math: "conversion_rate_session",
});

// Funnel trends over time
const trends = await ws.queryFunnel(["Signup", "Purchase"], {
  mode: "trends",
  last: 90,
  unit: "week",
});
```

**Full reference:** [Funnel queries](/guide/query-funnels)

### Retention — `queryRetention()`

Cohort retention with custom buckets, alignment modes and display options.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { Filter, RetentionEvent } from "@mixpanel-headless/core";

// Weekly retention, last 90 days
const weekly = await ws.queryRetention("Signup", "Login", {
  retention_unit: "week",
  last: 90,
});

// Average retention curve
const rates = weekly.average["rates"] as number[];
rates.forEach((rate, i) => {
  console.log(`  Week ${i}: ${(rate * 100).toFixed(1)}%`);
});

// Custom retention milestones
const milestones = await ws.queryRetention("Signup", "Login", {
  retention_unit: "day",
  bucket_sizes: [1, 3, 7, 14, 30, 60, 90],
  last: 90,
});

// Per-event filters
const organic = await ws.queryRetention(
  new RetentionEvent({
    event: "Signup",
    filters: [Filter.equals("source", "organic")],
  }),
  new RetentionEvent({
    event: "Purchase",
    filters: [Filter.greaterThan("amount", 0)],
  }),
  { retention_unit: "month", last: 180 },
);

// Retention trends over time
const trends = await ws.queryRetention("Signup", "Login", {
  mode: "trends",
  unit: "week",
  last: 180,
});
```

**Full reference:** [Retention queries](/guide/query-retention)

### Flows — `queryFlow()`

Path analysis with forward/reverse tracing, three visualization modes and graph helpers.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// What happens after Purchase?
const after = await ws.queryFlow("Purchase", { forward: 5 });

// What leads to Cancel Subscription?
const before = await ws.queryFlow("Cancel Subscription", {
  forward: 0,
  reverse: 5,
});

// Both directions
const both = await ws.queryFlow("Add to Cart", { forward: 3, reverse: 2 });

// Hide noisy events, increase path variety
const clean = await ws.queryFlow("Purchase", {
  hidden_events: ["Session Start", "Page View", "Heartbeat"],
  cardinality: 10,
  collapse_repeated: true,
  last: 90,
});
```

#### Three visualization modes

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Sankey (default) — aggregated node/edge graph
const sankey = await ws.queryFlow("Purchase", { mode: "sankey" });
console.table(sankey.toNodesRows());
console.table(sankey.toEdgesRows());
const g = sankey.graph(); // { nodes, edges }

// Paths — top user paths as sequences
const paths = await ws.queryFlow("Purchase", { mode: "paths" });
console.table(paths.toRows());

// Tree — recursive decision tree from the anchor
const tree = await ws.queryFlow("Purchase", { mode: "tree" });
for (const root of tree.trees) {
  console.log(root.render()); // ASCII visualization
}
```

#### The graph object

`graph()` returns a plain `{ nodes, edges }` adjacency object — node ids are `"{event}@{step}"`, edges carry a `count`. It is JSON-serializable and drops straight into a Sankey renderer or a graph library of your choice:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
const result = await ws.queryFlow("Signup", { forward: 4 });
// ---cut---
const g = result.graph();

// Micro-conversion between any two steps
const cartOut = g.edges
  .filter((e) => e.source === "Add to Cart@2")
  .reduce((sum, e) => sum + e.count, 0);
const toPurchase =
  g.edges.find((e) => e.source === "Add to Cart@2" && e.target === "Purchase@3")
    ?.count ?? 0;
console.log(`Cart -> Purchase: ${((toPurchase / cartOut) * 100).toFixed(1)}%`);

// Dead ends — reachable but leading nowhere
const hasOut = new Set(g.edges.map((e) => e.source));
const hasIn = new Set(g.edges.map((e) => e.target));
const deadEnds = g.nodes.filter((n) => !hasOut.has(n.id) && hasIn.has(n.id));
```

#### Tree traversal

Tree mode gives per-node conversion and drop-off counts:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
const result = await ws.queryFlow("Signup", { mode: "tree", forward: 4 });

for (const tree of result.trees) {
  // At each fork, what % takes each branch?
  for (const node of tree.flatten()) {
    if (node.children.length > 0) {
      const total = node.total_count;
      console.log(`\nAfter ${node.event} (${total} users):`);
      const ranked = [...node.children].sort(
        (a, b) => b.total_count - a.total_count,
      );
      for (const child of ranked) {
        const pct = (child.total_count / total) * 100;
        console.log(`  -> ${child.event}: ${pct.toFixed(0)}%`);
      }
    }
  }

  // Best path through the product
  const best = tree
    .allPaths()
    .reduce((a, b) =>
      (b.at(-1)?.converted_count ?? 0) > (a.at(-1)?.converted_count ?? 0)
        ? b
        : a,
    );
  console.log(best.map((n) => n.event).join(" -> "));

  // Biggest single drop-off
  const worst = tree
    .flatten()
    .reduce((a, b) => (b.drop_off_count > a.drop_off_count ? b : a));
  console.log(
    `Biggest drop-off: ${worst.event} (${worst.drop_off_count} users lost)`,
  );
}
```

`anytree()` converts each tree into parent-linked nodes (`parent`, `children`, `event`, `total_count`, …) for renderers that want that shape.

**Full reference:** [Flow queries](/guide/query-flows)

### Users — `queryUser()`

Search, filter, sort and aggregate user profiles stored in Mixpanel. The default mode is `"aggregate"` — use `mode: "profiles"` to fetch individual records.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { Filter } from "@mixpanel-headless/core";

// Find premium users, sorted by lifetime value
const premium = await ws.queryUser({
  mode: "profiles",
  where: Filter.equals("plan", "premium", { resource_type: "people" }),
  properties: ["$email", "$name", "ltv"],
  sort_by: "ltv",
  sort_order: "descending",
  limit: 50,
});
console.log(`${premium.total} premium users`);
console.table(premium.toRows());

// Count profiles matching a condition (aggregate is the default mode)
const count = await ws.queryUser({ where: Filter.isSet("$email") });
console.log(`Users with email: ${count.value}`);
```

**Full reference:** [User profile queries](/guide/query-users)

## Cross-cutting capabilities

These features work across multiple engines through the same options.

| Feature                     | Engines                             | Description                                                                          |
| --------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------ |
| `time_comparison`           | Insights, Funnels, Retention        | Compare the current period against a previous period                                 |
| `data_group_id`             | Insights, Funnels, Retention, Flows | Scope queries to a specific data group                                               |
| Property filters in `where` | Flows                               | Flows accept property filters (e.g. `Filter.equals()`) in addition to cohort filters |
| `segments`                  | Flows                               | Break down flow paths by property, cohort or frequency                               |
| `exclusions`                | Flows                               | Hide specific events from flow paths                                                 |
| `limit`                     | Insights, Funnels, Retention        | Raise the segment cap (1 to 50000, default 3000) for high-cardinality breakdowns     |

### Cohort scoping

Three ways to use cohorts — all accept either a saved cohort ID or an inline `CohortDefinition`:

```ts twoslash
import { CohortCriteria, CohortDefinition } from "@mixpanel-headless/core";

// Define a cohort inline — no UI, no saving, no ID to look up
const powerUsers = new CohortDefinition(
  CohortCriteria.didEvent("Purchase", { at_least: 3, within_days: 30 }),
);
```

`CohortDefinition.allOf(…)` / `.anyOf(…)` compose criteria; `CohortCriteria` covers event behaviour (`didEvent`, `didNotDoEvent` with counts, windows and aggregations), profile properties (`hasProperty`, `propertyIsSet`, `propertyIsNotSet`) and membership in saved cohorts (`inCohort`, `notInCohort`).

#### 1. Filter — restrict a query to a segment

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { CohortCriteria, CohortDefinition } from "@mixpanel-headless/core";
const ws = createNodeWorkspace();
const powerUsers = new CohortDefinition(
  CohortCriteria.didEvent("Purchase", { at_least: 3, within_days: 30 }),
);
// ---cut---
import { Filter } from "@mixpanel-headless/core";

// Saved cohort
const saved = await ws.query("Login", {
  where: Filter.inCohort(123, "Power Users"),
});

// Inline cohort
const inline = await ws.query("Login", {
  where: Filter.inCohort(powerUsers, "Power Users"),
});

// Exclude a cohort
const excluded = await ws.query("Login", {
  where: Filter.notInCohort(456, "Bots"),
});

// Works in all five engines
const funnel = await ws.queryFunnel(["Signup", "Purchase"], {
  where: Filter.inCohort(powerUsers, "PU"),
});
const retention = await ws.queryRetention("Signup", "Login", {
  where: Filter.inCohort(123, "PU"),
});
const flow = await ws.queryFlow("Purchase", {
  where: Filter.inCohort(123, "PU"),
});
const users = await ws.queryUser({ cohort: powerUsers, mode: "profiles" });
```

#### 2. Breakdown — compare a segment against everyone else

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { CohortBreakdown } from "@mixpanel-headless/core";

const versus = await ws.query("Purchase", {
  group_by: new CohortBreakdown({ cohort: 123, name: "Power Users" }),
});
// Two segments: "Power Users" and "Not In Power Users"

// Show only the cohort (no negation segment)
const only = await ws.query("Purchase", {
  group_by: new CohortBreakdown({
    cohort: 123,
    name: "PU",
    include_negated: false,
  }),
});

// Combine with property breakdowns
const mixed = await ws.query("Purchase", {
  group_by: [new CohortBreakdown({ cohort: 123, name: "PU" }), "platform"],
});
```

Works with `query()`, `queryFunnel()` and `queryRetention()`.

#### 3. Metric — track cohort size over time

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { CohortMetric, Metric } from "@mixpanel-headless/core";

// How many power users do we have each week?
const size = await ws.query(
  new CohortMetric({ cohort: 123, name: "Power Users" }),
  { last: 90, unit: "week" },
);

// What % of active users are power users?
const share = await ws.query(
  [
    new Metric({ event: "Login", math: "unique" }),
    new CohortMetric({ cohort: 123, name: "Power Users" }),
  ],
  { formula: "(B / A) * 100", formula_label: "Power User %" },
);
```

Works with `query()` only.

#### Engine compatibility

| Capability            | `query()` | `queryFunnel()` | `queryRetention()` | `queryFlow()` | `queryUser()` |
| --------------------- | :-------: | :-------------: | :----------------: | :-----------: | :-----------: |
| **Cohort filters**    |    yes    |       yes       |        yes         |      yes      |      yes      |
| **Cohort breakdowns** |    yes    |       yes       |        yes         |      --       |      --       |
| **Cohort metrics**    |    yes    |       --        |         --         |      --       |      --       |

### Custom properties

Use saved custom properties by ID or define computed properties inline at query time:

```ts twoslash
import {
  CustomPropertyRef,
  InlineCustomProperty,
} from "@mixpanel-headless/core";

// Reference a saved custom property
const ref = new CustomPropertyRef({ id: 42 });

// Or define one inline — no UI, no saving
const revenue = InlineCustomProperty.numeric("A * B", {
  A: "price",
  B: "quantity",
});
```

Custom properties plug into the same options you already know:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import {
  CustomPropertyRef,
  InlineCustomProperty,
} from "@mixpanel-headless/core";
const ws = createNodeWorkspace();
const ref = new CustomPropertyRef({ id: 42 });
const revenue = InlineCustomProperty.numeric("A * B", {
  A: "price",
  B: "quantity",
});
// ---cut---
import { Filter, GroupBy, Metric } from "@mixpanel-headless/core";

// Breakdown
const breakdown = await ws.query("Purchase", {
  group_by: new GroupBy({
    property: revenue,
    property_type: "number",
    bucket_size: 100,
  }),
});

// Filter
const filtered = await ws.query("Purchase", {
  where: Filter.greaterThan(ref, 100),
});

// Measurement
const measured = await ws.query(
  new Metric({ event: "Purchase", math: "average", property: ref }),
);

// Mix with regular properties
const mixed = await ws.query("Purchase", {
  group_by: [
    "country",
    new GroupBy({
      property: revenue,
      property_type: "number",
      bucket_size: 50,
    }),
  ],
  where: [Filter.equals("platform", "iOS"), Filter.greaterThan(ref, 100)],
});
```

Works with `query()`, `queryFunnel()` and `queryRetention()`.

### Breakdowns

`group_by` accepts strings, `GroupBy` objects, `CohortBreakdown` objects, `FrequencyBreakdown` objects and arrays mixing them:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import {
  CohortBreakdown,
  CustomPropertyRef,
  GroupBy,
} from "@mixpanel-headless/core";

// String — simple property breakdown
const byPlatform = await ws.query("Login", { group_by: "platform" });

// Multiple properties
const byTwo = await ws.query("Purchase", { group_by: ["country", "platform"] });

// Numeric bucketing
const buckets = await ws.query("Purchase", {
  group_by: new GroupBy({
    property: "revenue",
    property_type: "number",
    bucket_size: 50,
    bucket_min: 0,
    bucket_max: 500,
  }),
});

// Cohort breakdown
const byCohort = await ws.query("Purchase", {
  group_by: new CohortBreakdown({ cohort: 123, name: "Power Users" }),
});

// Custom property breakdown
const byCustom = await ws.query("Purchase", {
  group_by: new GroupBy({
    property: new CustomPropertyRef({ id: 42 }),
    property_type: "number",
  }),
});

// Mix all types
const everything = await ws.query("Purchase", {
  group_by: [
    "country",
    new GroupBy({
      property: "revenue",
      property_type: "number",
      bucket_size: 50,
    }),
    new CohortBreakdown({ cohort: 123, name: "Power Users" }),
  ],
});
```

### Time ranges

`last` and absolute dates (`from_date` / `to_date`) work in all four event engines. The `unit` option applies to insights, funnels and retention (flows and users have no `unit`).

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Relative — last N days (default: 30)
const ninety = await ws.query("Login", { last: 90 });
const weekly = await ws.query("Login", { last: 84, unit: "week" });

// Absolute — explicit dates
const q1 = await ws.query("Login", {
  from_date: "2025-01-01",
  to_date: "2025-03-31",
});

// Hourly granularity (insights only)
const hourly = await ws.query("Login", { last: 2, unit: "hour" });
```

`last` is always a number of **days**, whatever `unit` you bucket by.

## Validation

Every query is validated **before** the API call. Invalid options throw [`BookmarkValidationError`](/reference/core/classes/BookmarkValidationError) with all errors at once — no "fix one, discover the next" cycle:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { BookmarkValidationError } from "@mixpanel-headless/core";

try {
  await ws.queryFunnel([""], { conversion_window: -1 });
} catch (err) {
  if (err instanceof BookmarkValidationError) {
    for (const error of err.errors) {
      console.log(`[${error.code}] ${error.path}: ${error.message}`);
      if (error.suggestion) {
        console.log(`  Did you mean: ${error.suggestion.join(", ")}`);
      }
    }
    // [F2_EMPTY_STEP_EVENT] steps[0].event:
    //   Step event name must be a non-empty string
    // [F1_MIN_STEPS] steps:
    //   At least 2 steps are required (got 1)
    // [F3_CONVERSION_WINDOW_POSITIVE] conversion_window:
    //   conversion_window must be a positive integer
  } else {
    throw err;
  }
}
```

Each [`ValidationError`](/reference/core/classes/ValidationError) carries:

| Field        | What it is                                                    |
| ------------ | ------------------------------------------------------------- |
| `code`       | Machine-readable rule ID (e.g. `V1_MATH_REQUIRES_PROPERTY`)   |
| `path`       | JSONPath-like location (e.g. `show[0].math`)                  |
| `message`    | Human-readable description                                    |
| `severity`   | `"error"` or `"warning"`                                      |
| `suggestion` | Fuzzy-matched alternatives for invalid enum values, or `null` |
| `fix`        | Suggested fix payload for programmatic correction, or `null`  |

`err.errorCount` and `err.warningCount` split the list by severity. Wire and config failures use the other error classes — see [Error handling](/guide/error-handling).

You can also validate insights, funnel or retention bookmark JSON directly (flow params are validated internally by `queryFlow()`):

```ts twoslash
import { validateBookmark } from "@mixpanel-headless/core";

declare const someBookmark: Record<string, unknown>;
const errors = validateBookmark(someBookmark);
const funnelErrors = validateBookmark(someBookmark, {
  bookmark_type: "funnels",
});
```

## Inspect, edit, persist: `build*Params()` and `run*Params()`

Every `query*()` method has a corresponding `build*Params()` that generates and validates the bookmark JSON without executing the query, and a `run*Params()` that executes a params object:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { Filter } from "@mixpanel-headless/core";

// Inspect what would be sent to the API
const insights = await ws.buildParams("Login", {
  math: "dau",
  group_by: "platform",
  last: 90,
});
const funnel = await ws.buildFunnelParams(["Signup", "Purchase"], {
  conversion_window: 7,
});
const retention = await ws.buildRetentionParams("Signup", "Login", {
  retention_unit: "week",
});
const flow = await ws.buildFlowParams("Purchase", { forward: 3, reverse: 1 });
const users = await ws.buildUserParams({
  mode: "profiles",
  where: Filter.isSet("$email"),
});

console.log(JSON.stringify(insights, null, 2));
```

Edit the params in between, or run params the typed builders cannot express (a lookup-table join breakdown, say):

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
const myCustomFilter: unknown[] = [];
// ---cut---
const params = await ws.buildParams("Login", { group_by: "$city", last: 7 });
// ...inspect or edit `params` here...
(params["sections"] as Record<string, unknown>)["filter"] = myCustomFilter;
const result = await ws.runParams(params, { limit: 50_000 });

// Flow params carry their own mode; user params route on their `action` key
const tree = await ws.runFlowParams(
  await ws.buildFlowParams("Purchase", { mode: "tree" }),
);
const premium = await ws.runUserParams(
  await ws.buildUserParams({ mode: "profiles" }),
  {
    limit: 500,
    parallel: true,
  },
);
```

`query()`, `queryFunnel()`, `queryRetention()` and their `run*Params()` twins accept `limit` (1 to 50000, default 3000) to raise the segment cap for high-cardinality breakdowns. Check `result.meta["is_segmentation_limit_hit"]` to see whether the result was still truncated.

::: info `build*Params()` returns a Promise
Unlike Python's synchronous `build_*_params()`, the TypeScript builders return a `Promise` so that validation failures surface as rejections, exactly like `query*()`. Always `await` them.
:::

### Save any query as a Mixpanel report

`result.params` is the exact bookmark JSON that ran. Persist it as a saved report, or mint a shareable link that opens it in the report editor:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import {
  CreateBookmarkParams,
  CreateDashboardParams,
} from "@mixpanel-headless/core";

const result = await ws.query("Login", {
  math: "dau",
  group_by: "platform",
  last: 90,
});

// Saved report on a dashboard (the v2 API requires a dashboard_id)
const dashboard = await ws.createDashboard(
  new CreateDashboardParams({ title: "Engagement" }),
);
await ws.createBookmark(
  new CreateBookmarkParams({
    name: "DAU by Platform (90d)",
    bookmark_type: "insights",
    params: result.params,
    dashboard_id: dashboard.id,
  }),
);

// Shareable link — an unsaved report under a minted slug
const link = await ws.createReportLink(result, { name: "DAU by Platform" });
console.log(link.url);
```

This works for all four report engines (`insights`, `funnels`, `retention`, `flows`). Build params in code, persist them as reports visible in the Mixpanel UI. See [Report links](/guide/report-links) and [Entity management](/guide/entity-management).

## One query, eight capabilities

Here's the single query that best demonstrates what the unified system can do. The business question it answers: _"What's the ARPU among activated users, by pricing plan, as a 4-week rolling average over the last quarter?"_

Every B2B SaaS PM asks this. In the Mixpanel UI it requires creating a saved custom property, creating a saved cohort, building a two-metric report with a formula, adding a breakdown and configuring rolling analysis — minimum 10 clicks across 3 screens, plus two permanent entities to manage.

Here it's one call with zero pre-saved entities:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import {
  CohortCriteria,
  CohortDefinition,
  Filter,
  InlineCustomProperty,
  Metric,
} from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

// Revenue doesn't exist in the data — compute it
const revenue = InlineCustomProperty.numeric("A * B", {
  A: "price",
  B: "quantity",
});

// Define the target segment in code
const activated = new CohortDefinition(
  CohortCriteria.didEvent("Complete Onboarding", {
    at_least: 1,
    within_days: 14,
  }),
);

// One call. Eight capabilities.
const result = await ws.query(
  [
    new Metric({
      event: "Purchase",
      math: "total",
      property: revenue, // inline custom property
    }),
    new Metric({ event: "Purchase", math: "unique" }),
  ],
  {
    formula: "(A / B)", // ARPU formula
    formula_label: "ARPU",
    where: Filter.inCohort(activated, "Activated"), // inline cohort filter
    group_by: "plan", // breakdown by plan tier
    rolling: 4, // 4-week rolling average
    unit: "week",
    last: 90,
  },
);

console.table(result.toRows());
// date        | event | segment | count
// 2025-01-06  | ARPU  | Free    |  12.50
// 2025-01-06  | ARPU  | Pro     |  87.30
// 2025-01-06  | ARPU  | Ent     | 245.00
// ...

// Happy with it? Share it as a report link:
const link = await ws.createReportLink(result, {
  name: "ARPU by Plan (Activated Users)",
});
```

What each line proves:

| Feature                                   | What it demonstrates                         |
| ----------------------------------------- | -------------------------------------------- |
| `InlineCustomProperty.numeric(...)`       | Compute values that don't exist in your data |
| `new CohortDefinition(CohortCriteria...)` | Define segments in code, no UI trip          |
| `new Metric({ property: revenue })`       | Custom properties plug into standard options |
| Two `Metric` objects                      | Different aggregation per metric             |
| `formula: "(A / B)"`                      | Derived KPIs from multiple metrics           |
| `Filter.inCohort(activated, ...)`         | Scope to a programmatic segment              |
| `group_by: "plan"`                        | Segment by the dimension that matters        |
| `rolling: 4`                              | Smooth weekly noise into a trend             |

Change `within_days: 14` to `within_days: 7` and re-run. Swap `"plan"` for `"country"`. Change the formula to `A * B * (1 - C)` to add discounts. Each iteration is instant — no UI round-trips, no saved entities to update.

## Putting it all together

A complete analysis combining multiple engines:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import {
  CohortBreakdown,
  CohortCriteria,
  CohortDefinition,
  Filter,
  FunnelStep,
  InlineCustomProperty,
  Metric,
  RetentionEvent,
} from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

// --- Reusable segments and computed properties ---

const premiumUsers = new CohortDefinition(
  CohortCriteria.didEvent("Upgrade", { at_least: 1, within_days: 365 }),
);

const revenue = InlineCustomProperty.numeric("A * B", {
  A: "price",
  B: "quantity",
});

// --- Insights: revenue trends by country ---

const weeklyRevenue = await ws.query(
  new Metric({ event: "Purchase", math: "total", property: revenue }),
  { group_by: "country", last: 90, unit: "week" },
);
console.table(weeklyRevenue.toRows());

// --- Insights: conversion rate formula ---

const conversion = await ws.query(
  [
    new Metric({ event: "Signup", math: "unique" }),
    new Metric({ event: "Purchase", math: "unique" }),
  ],
  {
    formula: "(B / A) * 100",
    formula_label: "Conversion Rate",
    where: Filter.inCohort(premiumUsers, "Premium"),
    unit: "week",
    last: 90,
  },
);
console.table(conversion.toRows());

// --- Funnels: checkout flow, premium vs. everyone ---

const checkout = await ws.queryFunnel(
  [
    new FunnelStep({ event: "Browse" }),
    new FunnelStep({
      event: "Add to Cart",
      filters: [Filter.greaterThan("item_count", 0)],
    }),
    new FunnelStep({ event: "Checkout" }),
    new FunnelStep({ event: "Purchase" }),
  ],
  {
    conversion_window: 7,
    exclusions: ["Logout"],
    group_by: new CohortBreakdown({
      cohort: premiumUsers,
      name: "Premium Users",
    }),
    last: 90,
  },
);
console.log(`Overall: ${(checkout.overall_conversion_rate * 100).toFixed(1)}%`);
console.table(checkout.toRows());

// --- Retention: do organic signups retain better? ---

const bucketSizes = [1, 3, 7, 14, 30];
const organicRetention = await ws.queryRetention(
  new RetentionEvent({
    event: "Signup",
    filters: [Filter.equals("source", "organic")],
  }),
  "Login",
  { retention_unit: "day", bucket_sizes: bucketSizes, last: 90 },
);
const rates = organicRetention.average["rates"] as number[];
bucketSizes.forEach((day, i) => {
  console.log(`  Day ${day}: ${((rates[i] ?? 0) * 100).toFixed(1)}%`);
});

// --- Flows: what do users do after a failed checkout? ---

const failedCheckout = await ws.queryFlow("Checkout Error", {
  forward: 4,
  hidden_events: ["Session Start", "Page View"],
  cardinality: 10,
  last: 90,
});
for (const [src, tgt, count] of failedCheckout.topTransitions(5)) {
  console.log(`  ${src} -> ${tgt}: ${count.toLocaleString()}`);
}

// Tree mode: where do users diverge?
const treeResult = await ws.queryFlow("Checkout Error", {
  mode: "tree",
  forward: 4,
});
for (const tree of treeResult.trees) {
  console.log(tree.render());
}

// --- Share any result as a report link ---

const link = await ws.createReportLink(checkout, {
  name: "Checkout Funnel (Premium Segment)",
});
console.log(link.url);
```

## Quick reference

### Methods

| Method             | Engine    | Positional arguments                                                            |
| ------------------ | --------- | ------------------------------------------------------------------------------- |
| `query()`          | Insights  | `events` — string, `Metric`, `CohortMetric`, `Formula`, or an array mixing them |
| `queryFunnel()`    | Funnels   | `steps` — array of strings or `FunnelStep`                                      |
| `queryRetention()` | Retention | `bornEvent`, `returnEvent` — string or `RetentionEvent`                         |
| `queryFlow()`      | Flows     | `event` — string, `FlowStep`, or an array of either                             |
| `queryUser()`      | Users     | options only — `where`, `properties`, `sort_by`, `limit`, …                     |

Each has a matching `build*Params()` that returns the validated params object without querying, and a `run*Params()` that executes one.

### Shared options

The option bags are [`WorkspaceQueryOptions`](/reference/core/interfaces/WorkspaceQueryOptions), [`WorkspaceFunnelQueryOptions`](/reference/core/interfaces/WorkspaceFunnelQueryOptions), [`WorkspaceRetentionQueryOptions`](/reference/core/interfaces/WorkspaceRetentionQueryOptions), [`WorkspaceFlowQueryOptions`](/reference/core/interfaces/WorkspaceFlowQueryOptions) and [`WorkspaceUserQueryOptions`](/reference/core/interfaces/WorkspaceUserQueryOptions).

| Option            | Type                                                                  | Default       | Engines                     |
| ----------------- | --------------------------------------------------------------------- | ------------- | --------------------------- |
| `where`           | `Filter \| Filter[]` (Insights also `FrequencyFilter`)                | `null`        | All                         |
| `group_by`        | `string \| GroupBy \| CohortBreakdown \| FrequencyBreakdown \| array` | `null`        | I, F, R (Flows: `segments`) |
| `last`            | `number` (days)                                                       | `30`          | I, F, R, Fl                 |
| `from_date`       | `string` (`YYYY-MM-DD`)                                               | `null`        | I, F, R, Fl                 |
| `to_date`         | `string` (`YYYY-MM-DD`)                                               | `null`        | I, F, R, Fl                 |
| `unit`            | `"day" \| "week" \| "month"` (Insights also `"hour"`, `"quarter"`)    | `"day"`       | I, F, R                     |
| `time_comparison` | `TimeComparison`                                                      | `null`        | I, F, R                     |
| `data_group_id`   | `number`                                                              | `null`        | I, F, R, Fl                 |
| `mode`            | engine-specific                                                       | varies        | All                         |
| `math`            | engine-specific                                                       | varies        | I, F, R                     |
| `math_property`   | `string`                                                              | `null`        | I, F                        |
| `limit`           | `number` (1 to 50000)                                                 | `null` (3000) | I, F, R                     |

I = Insights, F = Funnels, R = Retention, Fl = Flows

### Engine-specific options

| Engine        | Unique options                                                                                                                                                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Insights**  | `per_user`, `percentile_value`, `formula`, `formula_label`, `rolling`, `cumulative`                                                                                                                                                       |
| **Funnels**   | `conversion_window`, `conversion_window_unit`, `order`, `exclusions`, `holding_constant`, `reentry_mode`                                                                                                                                  |
| **Retention** | `retention_unit`, `alignment`, `bucket_sizes`, `unbounded_mode`, `retention_cumulative`                                                                                                                                                   |
| **Flows**     | `forward`, `reverse`, `conversion_window`, `conversion_window_unit`, `count_type`, `cardinality`, `collapse_repeated`, `hidden_events`, `segments`, `exclusions`                                                                          |
| **Users**     | `cohort`, `properties`, `sort_by`, `sort_order`, `limit`, `mode`, `aggregate`, `aggregate_property`, `percentile`, `segment_by`, `search`, `distinct_id`, `distinct_ids`, `group_id`, `as_of`, `include_all_users`, `parallel`, `workers` |

### Result types

| Engine    | Result type                                                            | Key members                                                              |
| --------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Insights  | [`QueryResult`](/reference/core/classes/QueryResult)                   | `toRows()`, `series`, `params`, `meta`                                   |
| Funnels   | [`FunnelQueryResult`](/reference/core/classes/FunnelQueryResult)       | `toRows()`, `overall_conversion_rate`, `steps_data`                      |
| Retention | [`RetentionQueryResult`](/reference/core/classes/RetentionQueryResult) | `toRows()`, `cohorts`, `average`                                         |
| Flows     | [`FlowQueryResult`](/reference/core/classes/FlowQueryResult)           | `toNodesRows()`, `toEdgesRows()`, `graph()`, `trees`, `topTransitions()` |
| Users     | [`UserQueryResult`](/reference/core/classes/UserQueryResult)           | `toRows()`, `total`, `value`, `profiles`, `params`                       |

### Imports

```ts twoslash
// Everything you might need
import { createNodeWorkspace } from "@mixpanel-headless/node";
import {
  // Insights
  Metric,
  Formula,
  GroupBy,
  Filter,
  TimeComparison,
  FrequencyBreakdown,
  FrequencyFilter,
  type MathType,
  type PerUserAggregation,

  // Funnels
  FunnelStep,
  Exclusion,
  HoldingConstant,
  type FunnelMathType,

  // Retention
  RetentionEvent,
  type RetentionMathType,

  // Flows
  FlowStep,
  FlowTreeNode,

  // Cohorts
  CohortCriteria,
  CohortDefinition,
  CohortBreakdown,
  CohortMetric,

  // Custom properties
  CustomPropertyRef,
  InlineCustomProperty,
  PropertyInput,

  // Persistence
  CreateBookmarkParams,

  // Validation
  validateBookmark,
  BookmarkValidationError,
} from "@mixpanel-headless/core";
```

## Next steps

- [Insights queries](/guide/query) — full option reference, all 22 math types, per-user aggregation
- [Funnel queries](/guide/query-funnels) — step configuration, exclusion targeting, session funnels
- [Retention queries](/guide/query-retention) — alignment modes, custom buckets, cohort structure
- [Flow queries](/guide/query-flows) — graph helpers, tree traversal, visualization modes
- [User profile queries](/guide/query-users) — filtering, sorting, property selection, aggregation
- [API overview](/api/) — packages, entry points, naming, results
- [`Workspace` reference](/reference/core/classes/Workspace) — every method signature
