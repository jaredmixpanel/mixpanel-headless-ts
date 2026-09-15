---
title: Insights queries
description: "Build typed analytics queries against Mixpanel's Insights engine — the same engine that powers the Mixpanel web UI."
---

# Insights queries

Build typed analytics queries against Mixpanel's Insights engine — the same engine that powers the Mixpanel web UI.

::: tip Recommended
`ws.query()` is the primary way to run analytics queries programmatically. It supports capabilities not available through the legacy query methods, including DAU/WAU/MAU, multi-metric comparison, formulas, per-user aggregation, rolling windows and percentiles.
:::

## When to use `query()`

`query()` uses the Insights engine via inline bookmark params. The legacy methods (`segmentation()`, `funnel()`, `retention()`) use the older Query API endpoints. Use `query()` when you need any of the capabilities in the right column:

| Capability                          | Legacy methods                     | `query()`                                                       |
| ----------------------------------- | ---------------------------------- | --------------------------------------------------------------- |
| Simple event count over time        | `segmentation()`                   | `ws.query("Login")`                                             |
| Unique users                        | `segmentation({ type: "unique" })` | `math: "unique"`                                                |
| DAU / WAU / MAU                     | Not available                      | `math: "dau"`                                                   |
| Multi-metric comparison             | Not available                      | `["Signup", "Login", "Purchase"]`                               |
| Formulas (conversion rates, ratios) | Not available                      | `formula: "(B/A)*100"`                                          |
| Per-user aggregation                | Not available                      | `per_user: "average"`                                           |
| Rolling / cumulative analysis       | Not available                      | `rolling: 7`                                                    |
| Percentiles (p25/p75/p90/p99)       | Not available                      | `math: "p90"`                                                   |
| Typed filters                       | Expression strings                 | `Filter.equals("country", "US")`                                |
| Numeric bucketed breakdowns         | Not available                      | `new GroupBy({ property: "revenue", property_type: "number" })` |
| Save query as a report              | N/A                                | `result.params` → `createBookmark()` / `createReportLink()`     |

Use the legacy methods when:

- You need to query a saved funnel by ID → `funnel()`
- You need to query a saved Flows report → `querySavedFlows()`

For cohort retention curves use `queryRetention()` ([Retention queries](/guide/query-retention)); for ad-hoc funnel conversion analysis with typed step definitions see [Funnel queries](/guide/query-funnels); for ad-hoc flow path analysis see [Flow queries](/guide/query-flows). The legacy methods are covered in [Live analytics](/guide/live-analytics).

## Getting started

The simplest possible query — total event count per day for the last 30 days:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

const result = await ws.query("Login");
console.table(result.toRows());
// date        | event                | count
// 2025-03-01  | Login [Total Events] |   142
// 2025-03-02  | Login [Total Events] |   158
```

Add a time range and aggregation:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Unique users per week for the last 7 days
const weekly = await ws.query("Login", {
  math: "unique",
  last: 7,
  unit: "week",
});

// Last 90 days of DAU
const dau = await ws.query("Login", { math: "dau", last: 90 });

// Specific date range
const q1 = await ws.query("Purchase", {
  from_date: "2025-01-01",
  to_date: "2025-03-31",
  unit: "month",
});
```

Every option lives on [`WorkspaceQueryOptions`](/reference/core/interfaces/WorkspaceQueryOptions); the accepted values of `math`, `per_user`, `unit` and `mode` are the [`MathType`](/reference/core/type-aliases/MathType), [`PerUserAggregation`](/reference/core/type-aliases/PerUserAggregation), [`QueryTimeUnit`](/reference/core/type-aliases/QueryTimeUnit) and [`InsightsMode`](/reference/core/type-aliases/InsightsMode) unions exported by `@mixpanel-headless/core` (each with a sibling `*_VALUES` tuple for runtime checks).

## Aggregation

### Counting

| Math type             | What it counts                            |
| --------------------- | ----------------------------------------- |
| `"total"` (default)   | Total event occurrences                   |
| `"unique"`            | Unique users per period                   |
| `"dau"`               | Daily active users                        |
| `"wau"`               | Weekly active users                       |
| `"mau"`               | Monthly active users                      |
| `"cumulative_unique"` | Running count of distinct users over time |
| `"sessions"`          | Session count (not events or users)       |

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// DAU over the last 90 days
const dau = await ws.query("Login", { math: "dau", last: 90 });

// Monthly active users
const mau = await ws.query("Login", { math: "mau", last: 180, unit: "month" });

// Cumulative unique users over time
const cumulative = await ws.query("Login", {
  math: "cumulative_unique",
  last: 90,
});

// Count sessions instead of events
const sessions = await ws.query("Login", { math: "sessions", last: 30 });

// Distinct values of a property
const products = await ws.query("Purchase", {
  math: "unique_values",
  math_property: "product_id",
});
```

### Property aggregation

Aggregate a numeric property across events. Requires `math_property`:

| Math type                             | Aggregation                               |
| ------------------------------------- | ----------------------------------------- |
| `"total"` + `math_property`           | Sum of a numeric property                 |
| `"average"`                           | Mean value                                |
| `"median"`                            | Median value                              |
| `"min"` / `"max"`                     | Extremes                                  |
| `"p25"` / `"p75"` / `"p90"` / `"p99"` | Percentiles                               |
| `"percentile"` + `percentile_value`   | Custom percentile (e.g. p95)              |
| `"histogram"`                         | Distribution of property values           |
| `"unique_values"`                     | Count of distinct values of a property    |
| `"most_frequent"`                     | Most commonly occurring property value    |
| `"first_value"`                       | First observed value per user             |
| `"multi_attribution"`                 | Multi-touch attribution across a property |
| `"numeric_summary"`                   | Summary stats (count, mean, variance)     |

::: info No `"sum"` math type
Mixpanel has no `"sum"`; use `math: "total"` with a `math_property` to sum its numeric values.
:::

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Average purchase amount per day
const average = await ws.query("Purchase", {
  math: "average",
  math_property: "amount",
  from_date: "2025-01-01",
  to_date: "2025-01-31",
});

// P90 response time
const p90 = await ws.query("API Call", {
  math: "p90",
  math_property: "duration_ms",
});

// Custom percentile (p95) — use math: "percentile" with percentile_value
const p95 = await ws.query("API Call", {
  math: "percentile",
  math_property: "duration_ms",
  percentile_value: 95,
});

// Histogram — distribution of purchase amounts
const histogram = await ws.query("Purchase", {
  math: "histogram",
  math_property: "amount",
});
```

### Per-user aggregation

Aggregate per user first, then across all users — like a SQL subquery. For example, "what's the average number of purchases per user per week?"

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Average purchases per user per week
const result = await ws.query("Purchase", {
  math: "total",
  per_user: "average",
  unit: "week",
});
```

Valid `per_user` values (`PerUserAggregation`): `"unique_values"`, `"total"`, `"average"`, `"min"`, `"max"`.

::: info
`per_user` is incompatible with the `dau`, `wau`, `mau` and `unique` math types.
:::

### Segment method

Control how events are counted per user with `Metric.segment_method`:

- `"all"` (default) — count every qualifying event
- `"first"` — count only the first qualifying event per user

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { Metric } from "@mixpanel-headless/core";

// Only count each user's first purchase
const result = await ws.query(
  new Metric({ event: "Purchase", segment_method: "first" }),
  { last: 30 },
);
```

### The `Metric` class

When different events need different aggregation settings, use [`Metric`](/reference/core/classes/Metric) objects instead of plain strings:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { Metric } from "@mixpanel-headless/core";

// Different math per event
const result = await ws.query([
  new Metric({ event: "Signup", math: "unique" }),
  new Metric({ event: "Purchase", math: "total", property: "revenue" }),
]);
```

`Metric` also supports `percentile_value` for custom percentiles:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { Metric } from "@mixpanel-headless/core";

// Per-metric custom percentile
const result = await ws.query(
  new Metric({
    event: "API Call",
    math: "percentile",
    property: "duration_ms",
    percentile_value: 95,
  }),
);
```

Plain strings inherit the top-level `math`, `math_property` and `per_user` defaults. `Metric` objects override them per event:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { Metric } from "@mixpanel-headless/core";

// These are equivalent:
await ws.query("Login", { math: "unique" });
await ws.query(new Metric({ event: "Login", math: "unique" }));

// Top-level defaults apply to all string events:
await ws.query(["Signup", "Login"], { math: "unique" });
// Both events use math: "unique"

// Metric overrides per event:
await ws.query([
  new Metric({ event: "Signup", math: "unique" }), // unique users
  new Metric({ event: "Purchase", math: "total" }), // total events
]);
```

`MetricFields` is the constructor bag: `event`, `math`, `property`, `per_user`, `percentile_value`, `filters`, `filters_combinator`, `segment_method`.

## Filters

### Global filters

Apply filters across all metrics with `where`. Construct filters with the [`Filter`](/reference/core/classes/Filter) static builders:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { Filter } from "@mixpanel-headless/core";

// Single filter
const single = await ws.query("Purchase", {
  where: Filter.equals("country", "US"),
});

// Multiple filters (combined with AND)
const multiple = await ws.query("Purchase", {
  where: [Filter.equals("country", "US"), Filter.greaterThan("amount", 50)],
});
```

### Available filter builders

**String filters:**

```ts twoslash
import { Filter } from "@mixpanel-headless/core";
// ---cut---
Filter.equals("browser", "Chrome"); // equals value
Filter.equals("browser", ["Chrome", "Firefox"]); // equals any in list
Filter.notEquals("browser", "Safari"); // does not equal
Filter.contains("email", "@company.com"); // contains substring
Filter.notContains("url", "staging"); // does not contain
Filter.startsWith("email", "admin"); // prefix match
Filter.endsWith("email", "@company.com"); // suffix match
```

**Numeric filters:**

```ts twoslash
import { Filter } from "@mixpanel-headless/core";
// ---cut---
Filter.greaterThan("amount", 100); // > 100
Filter.lessThan("age", 65); // < 65
Filter.between("amount", 10, 100); // 10 <= x <= 100
Filter.notBetween("age", 18, 65); // outside a range
Filter.atLeast("score", 80); // >= 80
Filter.atMost("errors", 5); // <= 5
```

**Existence filters:**

```ts twoslash
import { Filter } from "@mixpanel-headless/core";
// ---cut---
Filter.isSet("phone_number"); // property exists
Filter.isNotSet("email"); // property is null
```

**Boolean filters:**

```ts twoslash
import { Filter } from "@mixpanel-headless/core";
// ---cut---
Filter.isTrue("is_premium"); // boolean true
Filter.isFalse("is_trial"); // boolean false
```

Every builder takes an optional trailing `{ resource_type: "events" | "people" }` bag; the default is `"events"`. Use `"people"` to filter on a profile property.

### List-of-object filters

When a property's value is a list of objects (e.g. `cart` is a list of `{Brand, Category, Price}` items), use `Filter.listContains` to filter on a subproperty. Discover valid subproperty names and types with `ws.subproperties()` first ([Data discovery](/guide/discovery)).

**Equality shorthand** for the common case — each entry of `equals` becomes an inner equality filter. All inner conditions must match the same item:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { Filter } from "@mixpanel-headless/core";

// Cart contains a nike-branded hat
const result = await ws.query("Cart Viewed", {
  where: Filter.listContains("cart", [], {
    equals: { Brand: "nike", Category: "hats" },
  }),
});
```

**Explicit `Filter` instances** for any non-equality operator:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { Filter } from "@mixpanel-headless/core";

// Cart contains an item costing more than $50
const result = await ws.query("Cart Viewed", {
  where: Filter.listContains("cart", [Filter.greaterThan("Price", 50)]),
});
```

**Quantifier** — `"any"` (default) requires at least one item to satisfy all inner conditions; `"all"` requires every item to:

```ts twoslash
import { Filter } from "@mixpanel-headless/core";
// ---cut---
// Every cart item costs more than $50
const where = Filter.listContains("cart", [Filter.greaterThan("Price", 50)], {
  quantifier: "all",
});
```

**Resource type** — `Filter.listContains` accepts `resource_type: "people"` for list-of-object people properties (e.g. `addresses`). With the `equals` shorthand, the inner equality filters inherit the outer `resource_type`. When passing explicit `Filter` instances, each carries its own `resource_type` from its own builder call — pass `{ resource_type }` on each inner builder if you want them to match the outer.

```ts twoslash
import { Filter } from "@mixpanel-headless/core";
// ---cut---
// Filter people by a list-of-object property
const where = Filter.listContains("addresses", [], {
  resource_type: "people",
  equals: { City: "Brooklyn" },
});
```

Cannot be nested (a `listContains` cannot appear inside another `listContains`). Mixing the `equals` shorthand and explicit inner filters in one call throws `ParamValidationError` (`LC3_MIXED_ARGS`).

::: info Coming from Python
Python's `Filter.list_contains("cart", Brand="nike")` keyword shorthand becomes the `equals` record: `Filter.listContains("cart", [], { equals: { Brand: "nike" } })`. Entry order is preserved.
:::

### Per-metric filters

Apply filters to individual metrics with `Metric.filters`:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { Filter, Metric } from "@mixpanel-headless/core";

// Different filters on each event
const result = await ws.query([
  new Metric({ event: "Purchase", math: "unique" }),
  new Metric({
    event: "Purchase",
    math: "unique",
    filters: [Filter.equals("plan", "premium")],
  }),
]);
```

By default, multiple per-metric filters combine with AND logic. Use `filters_combinator: "any"` for OR logic:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { Filter, Metric } from "@mixpanel-headless/core";

const result = await ws.query(
  new Metric({
    event: "Purchase",
    math: "unique",
    filters: [Filter.equals("country", "US"), Filter.equals("country", "CA")],
    filters_combinator: "any", // match US OR CA
  }),
);
```

### Date filters

Filter by datetime properties with purpose-built builders:

```ts twoslash
import { Filter } from "@mixpanel-headless/core";
// ---cut---
// Absolute date filters
Filter.on("created", "2025-01-15"); // exact date match
Filter.notOn("created", "2025-01-15"); // not on date
Filter.before("created", "2025-01-01"); // before a date
Filter.since("created", "2025-01-01"); // on or after a date
Filter.dateBetween("created", "2025-01-01", "2025-06-30"); // date range

// Relative date filters — "in the last N units"
Filter.inTheLast("created", 30, "day"); // last 30 days
Filter.inTheLast("last_seen", 2, "week"); // last 2 weeks
Filter.notInTheLast("created", 90, "day"); // NOT in last 90 days
Filter.dateNotBetween("created", "2025-01-01", "2025-06-30"); // outside a range
Filter.inTheNext("renewal_date", 30, "day"); // relative future date
```

The relative date builders take a `FilterDateUnit`: `"hour"`, `"day"`, `"week"` or `"month"`.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { Filter, type FilterDateUnit } from "@mixpanel-headless/core";

const unit: FilterDateUnit = "day";

// Example: recent signups with purchases
const result = await ws.query("Purchase", {
  where: Filter.inTheLast("signup_date", 7, unit),
  last: 30,
});
```

## Breakdowns

### String breakdowns

Break down results by property values with `group_by`:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Simple string breakdown
const byPlatform = await ws.query("Login", { group_by: "platform", last: 14 });

// Multiple breakdowns
const byTwo = await ws.query("Purchase", { group_by: ["country", "platform"] });
```

### The `GroupBy` class

For numeric bucketing, boolean breakdowns or explicit type annotations, use [`GroupBy`](/reference/core/classes/GroupBy):

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { GroupBy } from "@mixpanel-headless/core";

// Numeric breakdown with buckets
const buckets = await ws.query("Purchase", {
  group_by: new GroupBy({
    property: "revenue",
    property_type: "number",
    bucket_size: 50,
    bucket_min: 0,
    bucket_max: 500,
  }),
});

// Boolean breakdown
const premium = await ws.query("Login", {
  group_by: new GroupBy({ property: "is_premium", property_type: "boolean" }),
});

// Mixed: string shorthand + GroupBy
const mixed = await ws.query("Purchase", {
  group_by: [
    "country",
    new GroupBy({
      property: "amount",
      property_type: "number",
      bucket_size: 25,
    }),
  ],
});
```

`GroupByFields`: `property` (a name, `CustomPropertyRef` or `InlineCustomProperty`), `property_type` (`"string"` default, `"number"`, `"boolean"`, `"datetime"`), `bucket_size`, `bucket_min`, `bucket_max`.

### List-of-object breakdowns

Mirror `Filter.listContains` for breakdowns: when a property is a list of objects, break down by one of its subproperties via `GroupBy.listItem`. Discover valid subproperty names and types with `ws.subproperties()`.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { GroupBy } from "@mixpanel-headless/core";

// Break down Cart Viewed events by cart.Brand
const byBrand = await ws.query("Cart Viewed", {
  group_by: GroupBy.listItem("cart", "Brand"),
});

// Break down by a numeric subproperty (sub_type controls aggregation)
const byPrice = await ws.query("Cart Viewed", {
  group_by: GroupBy.listItem("cart", "Price", { sub_type: "number" }),
});

// Mix list-item with regular breakdowns
const mixed = await ws.query("Cart Viewed", {
  group_by: ["country", GroupBy.listItem("cart", "Brand")],
});
```

`sub_type` accepts the four scalar values of `CustomPropertyType` (`"string"`, `"number"`, `"boolean"`, `"datetime"`). Bucketing (`bucket_size` / `bucket_min` / `bucket_max`) is incompatible with list-item breakdowns.

::: info Asymmetric with `Filter.listContains`
`GroupBy.listItem` is **events-only** — there is no `resource_type` option, because Mixpanel's UI does not support list-of-object breakdowns for people properties. `Filter.listContains` accepts `resource_type: "people"` because the wire format permits list-object filters on people properties (just not breakdowns).
:::

## Formulas

Compute derived metrics from multiple events. Letters A–Z reference events by their position in the list.

### Top-level `formula` option

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { Metric } from "@mixpanel-headless/core";

// Conversion rate: purchases / signups * 100
const result = await ws.query(
  [
    new Metric({ event: "Signup", math: "unique" }),
    new Metric({ event: "Purchase", math: "unique" }),
  ],
  { formula: "(B / A) * 100", formula_label: "Conversion Rate", unit: "week" },
);
```

When `formula` is set, the underlying metrics are automatically hidden — only the formula result appears in the output.

### `Formula` class in the events list

For inline formula definitions, pass [`Formula`](/reference/core/classes/Formula) objects alongside events:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { Formula, Metric } from "@mixpanel-headless/core";

const result = await ws.query([
  new Metric({ event: "Signup", math: "unique" }),
  new Metric({ event: "Purchase", math: "unique" }),
  new Formula({ expression: "(B / A) * 100", label: "Conversion Rate" }),
]);
```

Both approaches produce identical results. Use whichever reads more naturally — but not both in one call (`V4_FORMULA_CONFLICT`).

### Multi-metric comparison (no formula)

Compare multiple events side by side without a formula:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Three events on the same chart
const result = await ws.query(["Signup", "Login", "Purchase"], {
  math: "unique",
  last: 30,
});
```

## Time ranges

### Relative (default)

By default, `query()` returns the last 30 days. Customize with `last` and `unit`:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Last 7 days (daily granularity)
const week = await ws.query("Login", { last: 7 });

// Last 4 weeks (weekly granularity)
const month = await ws.query("Login", { last: 28, unit: "week" });

// Last 6 months
const halfYear = await ws.query("Login", { last: 180, unit: "month" });
```

`last` is always a number of **days**; `unit` controls how data is bucketed on the time axis. The supported units (`QueryTimeUnit`) are `"hour"`, `"day"`, `"week"`, `"month"` and `"quarter"`.

### Absolute

Specify explicit start and end dates:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Q1 2025
const q1 = await ws.query("Purchase", {
  from_date: "2025-01-01",
  to_date: "2025-03-31",
  unit: "week",
});

// From a date to today
const ytd = await ws.query("Login", { from_date: "2025-01-01" });
```

Dates must be in `YYYY-MM-DD` format. `to_date` requires `from_date`; `from_date` overrides `last`.

### Hourly granularity

Use `unit: "hour"` for intraday analysis:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
const result = await ws.query("Login", { last: 2, unit: "hour" });
```

## Analysis modes

### Rolling windows

Smooth noisy data with a rolling average:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// 7-day rolling average of signups by country
const result = await ws.query("Signup", {
  math: "unique",
  group_by: "country",
  rolling: 7,
  last: 60,
});
```

### Cumulative

Show running totals over time:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
const result = await ws.query("Signup", {
  math: "unique",
  cumulative: true,
  last: 30,
});
```

::: info
`rolling` and `cumulative` are mutually exclusive.
:::

### Result modes

The `mode` option (`InsightsMode`) controls result aggregation semantics:

| Mode                     | Semantics                              | Use case            |
| ------------------------ | -------------------------------------- | ------------------- |
| `"timeseries"` (default) | Per-period values                      | Trends over time    |
| `"total"`                | Single aggregate across the date range | KPI numbers         |
| `"table"`                | Tabular detail                         | Detailed breakdowns |

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Single KPI number: total unique purchasers this month
const result = await ws.query("Purchase", {
  math: "unique",
  from_date: "2025-03-01",
  to_date: "2025-03-31",
  mode: "total",
});
const total = result.toRows()[0]?.["count"];
```

::: warning Mode affects aggregation
`mode: "total"` with `math: "unique"` deduplicates users across the **entire date range**. `mode: "timeseries"` with `math: "unique"` counts unique users **per period** (not additive across periods). This is not just a display difference — it changes the numbers.
:::

## Period-over-period comparison

Compare the current time range against a previous period with [`TimeComparison`](/reference/core/classes/TimeComparison):

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { TimeComparison } from "@mixpanel-headless/core";

// Compare against the previous week
const weekOverWeek = await ws.query("Login", {
  time_comparison: TimeComparison.relative("week"),
  last: 7,
});

// Compare against a window starting on a fixed date
const fromStart = await ws.query("Purchase", {
  time_comparison: TimeComparison.absoluteStart("2025-01-01"),
  from_date: "2026-01-01",
  to_date: "2026-01-31",
});

// Compare against a window ending on a fixed date
const toEnd = await ws.query("Purchase", {
  time_comparison: TimeComparison.absoluteEnd("2025-12-31"),
  from_date: "2026-01-01",
  to_date: "2026-01-31",
});
```

Three static builders:

| Builder                              | What it compares against                                                   |
| ------------------------------------ | -------------------------------------------------------------------------- |
| `TimeComparison.relative(unit)`      | Previous period offset by unit (`day`, `week`, `month`, `quarter`, `year`) |
| `TimeComparison.absoluteStart(date)` | Window starting on a fixed date, same duration                             |
| `TimeComparison.absoluteEnd(date)`   | Window ending on a fixed date, same duration                               |

`time_comparison` only accepts a `TimeComparison` instance (there is no `"previous_period"` string shorthand). It also works with `queryFunnel()` and `queryRetention()`.

## Frequency analysis

### Frequency breakdown

Break down results by how often users performed an event with [`FrequencyBreakdown`](/reference/core/classes/FrequencyBreakdown):

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { FrequencyBreakdown } from "@mixpanel-headless/core";

// How are logins distributed by purchase frequency?
const result = await ws.query("Login", {
  group_by: new FrequencyBreakdown({
    event: "Purchase",
    bucket_size: 1,
    bucket_min: 0,
    bucket_max: 10,
  }),
  last: 30,
});
```

Fields (`FrequencyBreakdownFields`):

| Field         | Type             | Default  | Description                    |
| ------------- | ---------------- | -------- | ------------------------------ |
| `event`       | `string`         | required | Event to count frequency for   |
| `bucket_size` | `number`         | `1`      | Width of each frequency bucket |
| `bucket_min`  | `number`         | `0`      | Minimum frequency value        |
| `bucket_max`  | `number`         | `10`     | Maximum frequency value        |
| `label`       | `string \| null` | `null`   | Display label                  |

### Frequency filter

Filter to users who performed an event a certain number of times with [`FrequencyFilter`](/reference/core/classes/FrequencyFilter):

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { FrequencyFilter } from "@mixpanel-headless/core";

// Logins in March by users who purchased at least 3 times that month
const result = await ws.query("Login", {
  where: new FrequencyFilter({
    event: "Purchase",
    value: 3,
    operator: "is at least",
  }),
  from_date: "2026-03-01",
  to_date: "2026-03-31",
  unit: "month",
});
```

Operators (`FrequencyFilterOperator`): `"is at least"` (default), `"is at most"`, `"is greater than"`, `"is less than"`, `"is equal to"`. `FrequencyFilter` is accepted by `query()`'s `where` only — the other engines take `Filter` values.

::: warning The count is evaluated per time bucket, not over the date range
The query engine evaluates a `FrequencyFilter` threshold **inside each time bucket of the query** (`unit`). With the default `unit: "day"`, `new FrequencyFilter({ event: "Purchase", value: 3 })` keeps only users who purchased three or more times _on the same day_; a user who purchased 30 times in a month but never three times on one day is excluded from every daily bucket. An empty `series` / zero rows from `toRows()` is the expected result when no user reaches the threshold inside one bucket, not a sign that the filter failed.

Choose the `unit` that matches the period you mean: `"day"` for "N times in a day", `"month"` for "N times in a month". `unit: "month"` over a multi-month range still yields one threshold per month; "N times over the whole period" needs a date range that fits inside a single bucket. `last` is always a number of _days_ regardless of `unit`, so pin a month with `from_date` / `to_date`.

Measured on a seeded 10,000-user dataset (event `enter dungeon`, 2026-03-01 to 2026-03-31), with every library number matching a DuckDB ground-truth count over the raw events. The default `math: "total"` counts events; `math: "unique"` counts users.

| Query                                                            | `math`            | Library result   | Ground truth                                                                                            |
| ---------------------------------------------------------------- | ----------------- | ---------------- | ------------------------------------------------------------------------------------------------------- |
| unfiltered, `unit: "day"`, summed over days                      | `total` (default) | 30,541           | 30,541 events from 8,281 users                                                                          |
| `FrequencyFilter({ value: 2 })`, `unit: "day"`, summed over days | `total`           | 3,893            | 3,893 events by users with 2+ **on the same day** (1,894 user-days)                                     |
| `FrequencyFilter({ value: 3 })`, `unit: "day"`                   | `total`           | 305              | 305 events, same-day 3+                                                                                 |
| `FrequencyFilter({ value: 4 })`, `unit: "day"`                   | `total`           | 20               | 20 events, same-day 4+                                                                                  |
| `FrequencyFilter({ value: 5 })`, `unit: "day"`                   | `total`           | **empty series** | same-day 5+: no user-days. Whole-month 5+: 2,571 users, 16,363 events (not what a daily query measures) |
| `FrequencyFilter({ value: 2 })`, `unit: "month"`                 | `total`           | 29,188           | 29,188 events by the 6,928 users with 2+ in the month                                                   |
| `FrequencyFilter({ value: 2 })`, `unit: "month"`                 | `unique`          | 6,928            | 6,928 users with 2+ in the month                                                                        |
| :::                                                              |

::: info `date_range_value` / `date_range_unit` are unverified for inline filters
These two fields render as a `behavior.dateRange` lookback on the wire. In a probe against the analytics query API they had no observable effect on inline insights filters: a 31-day lookback returned the same numbers as no lookback. Do not rely on them to widen the counting window; use `unit` instead.
:::

## Data groups

Scope a query to a specific data group for group-level analytics:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
const result = await ws.query("Login", { data_group_id: 42, last: 30 });
```

`data_group_id` is available on all event engines: `query()`, `queryFunnel()`, `queryRetention()` and `queryFlow()`.

## Working with results

### `QueryResult`

`query()` resolves to a [`QueryResult`](/reference/core/classes/QueryResult):

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
const result = await ws.query("Login", { math: "unique", last: 7 });

// Rows
result.toRows(); // [{ date, event, count }, …]
result.rowColumns(); // ["date", "event", "count"]

// Raw series data
result.series; // { "Login [Unique Users]": { "2025-03-01T00:00:00": 142, … } }

// Time range
result.from_date; // "2025-03-25T00:00:00-07:00"
result.to_date; // "2025-03-31T23:59:59.999000-07:00"

// Metadata
result.computed_at; // "2025-03-31T12:00:00.000000+00:00"
result.headers; // ["$metric"]
result.meta; // { min_sampling_factor: 1.0, … }

// Generated bookmark params (for debugging or persistence)
result.params; // the full bookmark JSON sent to the API
```

### Row structure

`toRows()` returns one plain object per data point; `rowColumns()` names the active layout. Timezone offsets are stripped from date keys.

| Layout                      | `rowColumns()`                          |
| --------------------------- | --------------------------------------- |
| timeseries                  | `["date", "event", "count"]`            |
| timeseries with a breakdown | `["date", "event", "segment", "count"]` |
| total                       | `["event", "count"]`                    |
| total with a breakdown      | `["event", "segment", "count"]`         |

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
const result = await ws.query(["Signup", "Login"], { math: "unique" });
console.table(result.toRows());
// date        | event                  | count
// 2025-03-01  | Signup [Unique Users]  |    85
// 2025-03-01  | Login [Unique Users]   |   312
// 2025-03-02  | Signup [Unique Users]  |    92
```

An empty result reports `["date", "event", "count"]`. The rows are plain `Record<string, unknown>` objects — hand them to `console.table`, a DataFrame library, or `JSON.stringify`.

### Persisting as a saved report

The generated bookmark params can be saved as a Mixpanel report. The v2 API requires every bookmark to live on a dashboard, so pass a `dashboard_id`:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import {
  CreateBookmarkParams,
  CreateDashboardParams,
} from "@mixpanel-headless/core";

// Run query
const result = await ws.query("Login", {
  math: "dau",
  group_by: "platform",
  last: 90,
});

// Save as a report using the generated params
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
```

For a shareable URL without a saved entity, `ws.createReportLink(result, { name })` mints an unsaved-report link — see [Report links](/guide/report-links).

### Debugging

Inspect `result.params` to see the exact bookmark JSON sent to the API. This is useful for:

- Understanding what was actually queried
- Comparing with Mixpanel web UI bookmark params
- Diagnosing unexpected results

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
const result = await ws.query("Login", {
  math: "unique",
  group_by: "platform",
});
console.log(JSON.stringify(result.params, null, 2));
```

## Validation

`query()` validates all option combinations **before** making an API call and throws [`BookmarkValidationError`](/reference/core/classes/BookmarkValidationError) with every finding at once. Each [`ValidationError`](/reference/core/classes/ValidationError) has a stable `code`:

| Rule                             | Code                              | Message                                                        |
| -------------------------------- | --------------------------------- | -------------------------------------------------------------- |
| Property math without property   | `V1_MATH_REQUIRES_PROPERTY`       | `math='average' requires math_property to be set`              |
| Property set with counting math  | `V2_MATH_REJECTS_PROPERTY`        | `math_property is only valid with property-based math types …` |
| Per-user with DAU/WAU/MAU/unique | `V3_PER_USER_INCOMPATIBLE`        | `per_user is incompatible with math='dau'`                     |
| Formula with < 2 events          | `V4_FORMULA_MIN_EVENTS`           | `formula requires at least 2 events`                           |
| Rolling + cumulative             | `V5_ROLLING_CUMULATIVE_EXCLUSIVE` | `rolling and cumulative are mutually exclusive`                |
| `to_date` without `from_date`    | `V9_TO_REQUIRES_FROM`             | `to_date requires from_date`                                   |
| Invalid date format              | `V8_DATE_FORMAT`                  | `from_date must be YYYY-MM-DD format`                          |
| Invalid bucket config            | `V11_BUCKET_REQUIRES_SIZE`        | `bucket_min/bucket_max require bucket_size`                    |
| `percentile` without a value     | `V26_PERCENTILE_REQUIRES_VALUE`   | `math='percentile' requires percentile_value to be set`        |

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { BookmarkValidationError } from "@mixpanel-headless/core";

try {
  await ws.query("Purchase", { math: "average" });
} catch (err) {
  if (err instanceof BookmarkValidationError) {
    for (const e of err.errors) {
      console.log(`[${e.code}] ${e.path}: ${e.message}`);
    }
    // [V1_MATH_REQUIRES_PROPERTY] math: math='average' requires math_property to be set
  } else {
    throw err;
  }
}
```

The bookmark JSON itself is checked in a second layer (`B*` codes) before it is sent. A `limit` outside 1 to 50000 is rejected with a plain error, not a `BookmarkValidationError`. See [The unified query system — Validation](/guide/unified-query-system#validation) for the `ValidationError` fields.

## Complete examples

### Revenue dashboard metrics

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { Filter, GroupBy, Metric } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

// Total revenue by country this quarter
const revenue = await ws.query("Purchase", {
  math: "total",
  math_property: "amount",
  group_by: "country",
  from_date: "2025-01-01",
  to_date: "2025-03-31",
  unit: "month",
});

// Revenue distribution by bucket
const distribution = await ws.query("Purchase", {
  group_by: new GroupBy({
    property: "amount",
    property_type: "number",
    bucket_size: 25,
    bucket_min: 0,
    bucket_max: 500,
  }),
  last: 30,
});

// Conversion rate with per-metric filters
const conversion = await ws.query(
  [
    new Metric({ event: "Purchase", math: "unique" }),
    new Metric({
      event: "Purchase",
      math: "unique",
      filters: [Filter.equals("plan", "premium")],
    }),
  ],
  {
    formula: "(B / A) * 100",
    formula_label: "Premium %",
    group_by: "platform",
    unit: "week",
  },
);
```

### User engagement analysis

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { Filter } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

// 7-day rolling average of DAU by platform
const engagement = await ws.query("Login", {
  math: "dau",
  group_by: "platform",
  rolling: 7,
  last: 90,
});

// Average sessions per user per week
const sessions = await ws.query("Session Start", {
  math: "total",
  per_user: "average",
  unit: "week",
  last: 84,
});

// WAU trend for premium users
const wau = await ws.query("Login", {
  math: "wau",
  where: Filter.isTrue("is_premium"),
  last: 180,
  unit: "month",
});
```

## Generating params without querying

Use `buildParams()` to generate bookmark params without making an API call — useful for debugging, inspecting the generated JSON, or saving queries as reports. It takes the same arguments as `query()` and resolves to a plain object instead of a `QueryResult`:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
declare const dashboardId: number;
// ---cut---
import { CreateBookmarkParams, Filter } from "@mixpanel-headless/core";

const params = await ws.buildParams("Login", {
  math: "dau",
  group_by: "platform",
  where: Filter.inTheLast("created", 30, "day"),
  last: 90,
});

console.log(JSON.stringify(params, null, 2)); // inspect the generated bookmark JSON

// Save as a report directly from params
await ws.createBookmark(
  new CreateBookmarkParams({
    name: "DAU by Platform (90d)",
    bookmark_type: "insights",
    params,
    dashboard_id: dashboardId,
  }),
);
```

`buildParams()` returns a `Promise` — validation failures arrive as rejections, exactly like `query()`.

### Running built params

Use `runParams()` to execute params that `buildParams()` produced (or params you wrote by hand). It resolves to the same `QueryResult` as `query()`, and it is the way to run params the typed builder cannot express, such as a lookup-table join breakdown:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
const myCustomFilter: unknown[] = [];
// ---cut---
const params = await ws.buildParams("Login", { group_by: "$city", last: 7 });
(params["sections"] as Record<string, unknown>)["filter"] = myCustomFilter; // edit before it runs
const result = await ws.runParams(params, { limit: 50_000 });
console.table(result.toRows());
```

Both `query()` and `runParams()` accept `limit` (1 to 50000, default 3000) to raise the segment cap for high-cardinality breakdowns. Check `result.meta["is_segmentation_limit_hit"]` to see whether the result was still truncated. `runParams()` also takes `workspace_id` to run the params under a different data view.

## What's next

`query()` is the foundation for a family of typed query methods. Each follows the same pattern — typed TypeScript options generating the correct bookmark params:

- **[`queryFunnel()`](/guide/query-funnels)** — Ad-hoc funnel conversion analysis with typed step definitions, exclusions and conversion windows
- **[`queryRetention()`](/guide/query-retention)** — Ad-hoc retention curves with event pairs, custom buckets and alignment modes
- **[`queryFlow()`](/guide/query-flows)** — Ad-hoc flow path analysis with step definitions, direction controls and visualization modes
- **Cohort-scoped queries** — Filter, break down or track cohort membership across all engines (see below)

## Cohort-scoped queries

Scope any query to a user segment — filter by cohort membership, break down by cohort, or track cohort size as a metric. Use saved cohort IDs or define cohorts inline with `CohortDefinition`.

### Cohort filters

Restrict queries to users in (or not in) a cohort with `Filter.inCohort()` and `Filter.notInCohort()`:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import {
  CohortCriteria,
  CohortDefinition,
  Filter,
} from "@mixpanel-headless/core";

// Saved cohort
const saved = await ws.query("Purchase", {
  where: Filter.inCohort(123, "Power Users"),
});

// Inline cohort — define the segment right where you use it
const powerUsers = new CohortDefinition(
  CohortCriteria.didEvent("Purchase", { at_least: 3, within_days: 30 }),
);
const inline = await ws.query("Login", {
  where: Filter.inCohort(powerUsers, "Power Users"),
});

// Exclude a cohort
const excluded = await ws.query("Purchase", {
  where: Filter.notInCohort(789, "Bots"),
});

// Combine with property filters
const combined = await ws.query("Purchase", {
  where: [Filter.inCohort(powerUsers, "PU"), Filter.equals("platform", "iOS")],
});
```

Cohort filters work with all five query methods: `query()`, `queryFunnel()`, `queryRetention()`, `queryFlow()` and `queryUser()`.

### Cohort breakdowns

Segment results by cohort membership with [`CohortBreakdown`](/reference/core/classes/CohortBreakdown) in `group_by`:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { CohortCriteria, CohortDefinition } from "@mixpanel-headless/core";
const ws = createNodeWorkspace();
const powerUsers = new CohortDefinition(
  CohortCriteria.didEvent("Purchase", { at_least: 3, within_days: 30 }),
);
// ---cut---
import { CohortBreakdown } from "@mixpanel-headless/core";

// Compare cohort vs. everyone else
const versus = await ws.query("Purchase", {
  group_by: new CohortBreakdown({ cohort: 123, name: "Power Users" }),
});
// Result segments: "Power Users" and "Not In Power Users"

// Inline cohort breakdown
const inline = await ws.query("Purchase", {
  group_by: new CohortBreakdown({ cohort: powerUsers, name: "Power Users" }),
});

// Only the cohort segment (no "Not In" group)
const only = await ws.query("Purchase", {
  group_by: new CohortBreakdown({
    cohort: 123,
    name: "PU",
    include_negated: false,
  }),
});

// Mix with property breakdowns
const mixed = await ws.query("Purchase", {
  group_by: [
    new CohortBreakdown({ cohort: 123, name: "Power Users" }),
    "platform",
  ],
});
```

Cohort breakdowns work with `query()`, `queryFunnel()` and `queryRetention()` (not flows).

### Cohort metrics

Track cohort size over time as a metric — insights only:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { CohortMetric, Metric } from "@mixpanel-headless/core";

// Track cohort growth
const growth = await ws.query(
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

`CohortMetric` is insights-only — it cannot be used with `queryFunnel()`, `queryRetention()` or `queryFlow()`.

### Engine compatibility

| Capability                         | `query()` | `queryFunnel()` | `queryRetention()` | `queryFlow()` |
| ---------------------------------- | :-------: | :-------------: | :----------------: | :-----------: |
| **Cohort filters** (`where`)       |     ✓     |        ✓        |         ✓          |       ✓       |
| **Cohort breakdowns** (`group_by`) |     ✓     |        ✓        |         ✓          |       —       |
| **Cohort metrics** (`events`)      |     ✓     |        —        |         —          |       —       |

## Custom properties in queries

Use saved custom properties or define computed properties inline — in breakdowns, filters and metric measurement. Custom properties work everywhere a plain string property name does.

To create and manage custom properties in Mixpanel, see [Data governance](/guide/data-governance).

### Referencing a saved custom property

Use [`CustomPropertyRef`](/reference/core/classes/CustomPropertyRef) to reference a custom property that already exists in your Mixpanel project by its numeric ID:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import {
  CustomPropertyRef,
  Filter,
  GroupBy,
  Metric,
} from "@mixpanel-headless/core";

const ref = new CustomPropertyRef({ id: 42 });

// Breakdown by saved custom property
const breakdown = await ws.query("Purchase", {
  group_by: new GroupBy({ property: ref, property_type: "number" }),
});

// Filter by saved custom property
const filtered = await ws.query("Purchase", {
  where: Filter.greaterThan(ref, 100),
});

// Aggregate a saved custom property
const measured = await ws.query(
  new Metric({ event: "Purchase", math: "average", property: ref }),
);
```

Find custom property IDs with `ws.listCustomProperties()`.

### Inline custom properties

Use [`InlineCustomProperty`](/reference/core/classes/InlineCustomProperty) to define a computed property at query time — no need to save it to your project first. Formulas reference raw properties through single-letter variables (A–Z), each mapped to a [`PropertyInput`](/reference/core/classes/PropertyInput):

```ts twoslash
import { InlineCustomProperty, PropertyInput } from "@mixpanel-headless/core";

// Full constructor — explicit control over types
const revenue = new InlineCustomProperty({
  formula: "A * B",
  inputs: {
    A: new PropertyInput({ name: "price", type: "number" }),
    B: new PropertyInput({ name: "quantity", type: "number" }),
  },
  property_type: "number",
});
```

For the common case of numeric formulas over event properties, use the `numeric()` convenience builder:

```ts twoslash
import { InlineCustomProperty } from "@mixpanel-headless/core";

// Shorthand — auto-creates numeric PropertyInput objects
const revenue = InlineCustomProperty.numeric("A * B", {
  A: "price",
  B: "quantity",
});
```

Both forms produce identical results. Use the full constructor when you need non-numeric types or user-profile properties (`new PropertyInput({ name, resource_type: "user" })`).

### Custom property breakdowns

Pass a custom property to `GroupBy.property` for breakdowns. Numeric bucketing works the same as with regular properties:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import {
  CustomPropertyRef,
  GroupBy,
  InlineCustomProperty,
} from "@mixpanel-headless/core";

// Saved custom property with numeric buckets
const saved = await ws.query("Purchase", {
  group_by: new GroupBy({
    property: new CustomPropertyRef({ id: 42 }),
    property_type: "number",
    bucket_size: 50,
  }),
});

// Inline computed property
const inline = await ws.query("Purchase", {
  group_by: new GroupBy({
    property: InlineCustomProperty.numeric("A * B", {
      A: "price",
      B: "quantity",
    }),
    property_type: "number",
    bucket_size: 100,
    bucket_min: 0,
    bucket_max: 1000,
  }),
});

// Mix with regular property breakdowns
const mixed = await ws.query("Purchase", {
  group_by: [
    "country",
    new GroupBy({
      property: new CustomPropertyRef({ id: 42 }),
      property_type: "number",
    }),
  ],
});
```

### Custom property filters

Every `Filter` builder accepts a custom property in the `property` position:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import {
  CustomPropertyRef,
  Filter,
  InlineCustomProperty,
} from "@mixpanel-headless/core";

// Saved custom property
const saved = await ws.query("Purchase", {
  where: Filter.greaterThan(new CustomPropertyRef({ id: 42 }), 100),
});

// Inline computed property
const inline = await ws.query("Purchase", {
  where: Filter.between(
    InlineCustomProperty.numeric("A * B", { A: "price", B: "quantity" }),
    100,
    1000,
  ),
});

// Combine with regular filters
const combined = await ws.query("Purchase", {
  where: [
    Filter.equals("country", "US"),
    Filter.greaterThan(new CustomPropertyRef({ id: 42 }), 50),
  ],
});
```

### Custom property measurement

Aggregate a custom property as the metric value with `Metric.property`:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import {
  CustomPropertyRef,
  InlineCustomProperty,
  Metric,
} from "@mixpanel-headless/core";

const revenue = InlineCustomProperty.numeric("A * B", {
  A: "price",
  B: "quantity",
});

// Average of a saved custom property
const average = await ws.query(
  new Metric({
    event: "Purchase",
    math: "average",
    property: new CustomPropertyRef({ id: 42 }),
  }),
);

// Sum of an inline computed property
const sum = await ws.query(
  new Metric({ event: "Purchase", math: "total", property: revenue }),
);

// Per-metric custom properties in multi-metric queries
const multi = await ws.query([
  new Metric({ event: "Purchase", math: "total", property: revenue }),
  new Metric({ event: "Purchase", math: "unique" }),
]);
```

::: warning Use `Metric.property`, not `math_property`
The top-level `math_property` option is meant for plain string property names. To use a custom property for measurement, wrap the event in a `Metric` and set `property` on it.
:::

### Engine compatibility

| Capability                             | `query()` | `queryFunnel()` | `queryRetention()` | `queryFlow()` |
| -------------------------------------- | :-------: | :-------------: | :----------------: | :-----------: |
| **CP breakdowns** (`group_by`)         |     ✓     |        ✓        |         ✓          |       —       |
| **CP filters** (`where`)               |     ✓     |        ⚠        |         ⚠          |       —       |
| **CP measurement** (`Metric.property`) |     ✓     |        —        |         —          |       —       |

⚠ = Supported, but a known Mixpanel server bug may cause errors when custom property filters are used in funnel and retention global `where`. Custom property breakdowns and measurement work reliably in those engines.

`queryFlow()` does not support custom properties in any position (Mixpanel limitation).

### Custom property validation

Custom properties are validated **before** any API call. Invalid configurations throw `BookmarkValidationError`:

| Rule                          | Error code              | Error message                                                   |
| ----------------------------- | ----------------------- | --------------------------------------------------------------- |
| ID must be a positive integer | `CP1_INVALID_ID`        | custom property ID must be a positive integer (got {id})        |
| Formula must be non-empty     | `CP2_EMPTY_FORMULA`     | inline custom property formula must be non-empty                |
| At least one input required   | `CP3_EMPTY_INPUTS`      | inline custom property must have at least one input             |
| Input keys must be single A–Z | `CP4_INVALID_INPUT_KEY` | input keys must be single uppercase letters (A-Z), got {key}    |
| Formula max 20,000 chars      | `CP5_FORMULA_TOO_LONG`  | formula exceeds maximum length of 20,000 characters (got {len}) |
| Input property name non-empty | `CP6_EMPTY_INPUT_NAME`  | input {key} has an empty property name                          |

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import {
  BookmarkValidationError,
  CustomPropertyRef,
  GroupBy,
} from "@mixpanel-headless/core";

try {
  await ws.query("Purchase", {
    group_by: new GroupBy({
      property: new CustomPropertyRef({ id: 0 }),
      property_type: "number",
    }),
  });
} catch (err) {
  if (err instanceof BookmarkValidationError) {
    for (const e of err.errors) {
      console.log(`[${e.code}] ${e.path}: ${e.message}`);
    }
    // [CP1_INVALID_ID] group_by[0].property: custom property ID must be a positive integer (got 0)
  } else {
    throw err;
  }
}
```

## Next steps

- [The unified query system](/guide/unified-query-system) — the shared vocabulary across all five engines
- [Funnel queries](/guide/query-funnels) — Typed funnel conversion analysis
- [Retention queries](/guide/query-retention) — Typed retention analysis with event pairs and custom buckets
- [Flow queries](/guide/query-flows) — Typed flow path analysis with steps, directions and graph output
- [Live analytics](/guide/live-analytics) — Legacy query methods (segmentation, funnels, retention)
- [Data discovery](/guide/discovery) — Explore events and properties before querying
- [Data governance](/guide/data-governance) — Create and manage custom properties
- [API overview](/api/) — packages, entry points, naming, results
- [`Workspace.query` reference](/reference/core/classes/Workspace#query) and [`WorkspaceQueryOptions`](/reference/core/interfaces/WorkspaceQueryOptions) — the full signature and every option
