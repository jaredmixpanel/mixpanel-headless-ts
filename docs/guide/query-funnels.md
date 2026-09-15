---
title: Funnel queries
description: Build typed funnel conversion analysis against Mixpanel's Insights engine — define steps, exclusions, and conversion windows inline without creating saved funnels first.
---

# Funnel queries

Build typed funnel conversion analysis against Mixpanel's Insights engine — define steps, exclusions, and conversion windows inline without creating saved funnels first.

::: tip Recommended
`ws.queryFunnel()` is the typed way to run funnel analysis programmatically. It supports capabilities not available through the legacy `funnel()` method, including ad-hoc step definitions, per-step filters, exclusions, holding constant properties, and session-based conversion.
:::

## When to use `queryFunnel()`

`queryFunnel()` builds funnel bookmark params and posts them to the Insights engine. The legacy `funnel()` method queries pre-saved funnels by ID. Use `queryFunnel()` when you need any of the capabilities in the right column:

| Capability                 | Legacy `funnel()`                     | `queryFunnel()`                                              |
| -------------------------- | ------------------------------------- | ------------------------------------------------------------ |
| Query a saved funnel by ID | `funnel(123, { from_date, to_date })` | Use `querySavedReport()`                                     |
| Define steps inline        | Not available                         | `["Signup", "Purchase"]`                                     |
| Per-step filters           | Not available                         | `new FunnelStep({ event: "Purchase", filters: [...] })`      |
| Per-step labels            | Not available                         | `new FunnelStep({ event: "Purchase", label: "High-Value" })` |
| Exclusions between steps   | Not available                         | `exclusions: ["Logout"]`                                     |
| Hold properties constant   | Not available                         | `holding_constant: ["platform"]`                             |
| Conversion window control  | Not available                         | `conversion_window: 7, conversion_window_unit: "day"`        |
| Session-based conversion   | Not available                         | `conversion_window_unit: "session"`                          |
| Step ordering modes        | Not available                         | `order: "any"`                                               |
| Property breakdowns        | `on: "country"`                       | `group_by: "country"`                                        |
| Save query as a report     | N/A                                   | `result.params` → `createBookmark()`                         |

Use the legacy `funnel()` when:

- You have an existing saved funnel in Mixpanel and just need its results → `funnel(123, { from_date: "2026-01-01", to_date: "2026-01-31" })`
- You need simple segmentation of a saved funnel → `funnel(123, { from_date, to_date, on: "country" })`

See [Live analytics](/guide/live-analytics) for the legacy methods.

## Getting started

The simplest possible funnel — two steps with default settings (14-day conversion window, last 30 days):

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

const result = await ws.queryFunnel(["Signup", "Purchase"]);
console.log(
  `Conversion: ${(result.overall_conversion_rate * 100).toFixed(1)}%`,
);
// Conversion: 12.3%

console.table(result.toRows());
// step | event    | count | step_conv_ratio | overall_conv_ratio | avg_time | avg_time_from_start
// 1    | Signup   | 1000  | 1.00            | 1.00               | 0.0      | 0.0
// 2    | Purchase | 123   | 0.12            | 0.12               | 3600.0   | 3600.0
```

Add a conversion window and time range:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// 7-day conversion window over the last 90 days
const result = await ws.queryFunnel(
  ["Signup", "Add to Cart", "Checkout", "Purchase"],
  { conversion_window: 7, last: 90 },
);
```

::: info Coming from Python?
Keyword arguments become one options object whose keys stay `snake_case`: `ws.query_funnel(steps, conversion_window=7, last=90)` is `ws.queryFunnel(steps, { conversion_window: 7, last: 90 })`. Result fields keep their Python spelling (`overall_conversion_rate`); `result.df` becomes `result.toRows()`. See [Coming from Python](/guide/coming-from-python).
:::

## Steps

### Plain strings

The simplest way to define steps — pass event names as strings:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
const result = await ws.queryFunnel(["Signup", "Add to Cart", "Purchase"]);
```

At least 2 steps are required, up to a maximum of 100.

### The `FunnelStep` class

For per-step configuration, use `FunnelStep` objects:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { FunnelStep, Filter } from "@mixpanel-headless/core";

const result = await ws.queryFunnel([
  new FunnelStep({ event: "Signup" }),
  new FunnelStep({
    event: "Purchase",
    label: "High-Value Purchase",
    filters: [Filter.greaterThan("amount", 50)],
  }),
]);
```

`FunnelStep` fields:

| Field                | Type                        | Default    | Description                            |
| -------------------- | --------------------------- | ---------- | -------------------------------------- |
| `event`              | `string`                    | (required) | Mixpanel event name                    |
| `label`              | `string \| null`            | `null`     | Display label (defaults to event name) |
| `filters`            | `readonly Filter[] \| null` | `null`     | Per-step filter conditions             |
| `filters_combinator` | `"all" \| "any"`            | `"all"`    | How per-step filters combine (AND/OR)  |
| `order`              | `"loose" \| "any" \| null`  | `null`     | Per-step ordering override             |

Plain strings and `FunnelStep` objects can be mixed freely:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { FunnelStep, Filter } from "@mixpanel-headless/core";
const ws = createNodeWorkspace();
// ---cut---
const result = await ws.queryFunnel([
  "Signup", // plain string — no filters needed
  new FunnelStep({
    event: "Purchase",
    filters: [Filter.greaterThan("amount", 50)],
  }),
]);
```

### Per-step filters

Apply filters to individual steps using `FunnelStep.filters`. These restrict which events count for that specific step:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { FunnelStep, Filter } from "@mixpanel-headless/core";

const result = await ws.queryFunnel([
  new FunnelStep({
    event: "Signup",
    filters: [Filter.equals("source", "organic")],
  }),
  new FunnelStep({
    event: "Purchase",
    filters: [Filter.equals("country", "US"), Filter.greaterThan("amount", 25)],
  }),
]);
```

By default, multiple per-step filters combine with AND logic. Use `filters_combinator: "any"` for OR logic:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { FunnelStep, Filter } from "@mixpanel-headless/core";
const ws = createNodeWorkspace();
// ---cut---
const result = await ws.queryFunnel([
  "Signup",
  new FunnelStep({
    event: "Purchase",
    filters: [Filter.equals("country", "US"), Filter.equals("country", "CA")],
    filters_combinator: "any", // match US OR CA
  }),
]);
```

See [Insights queries](/guide/query) for the full list of `Filter` builders.

## Conversion window

Control how long users have to complete the funnel:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// 7 days (default unit is "day")
const week = await ws.queryFunnel(["Signup", "Purchase"], {
  conversion_window: 7,
});

// 2 hours
const hours = await ws.queryFunnel(["View", "Click"], {
  conversion_window: 2,
  conversion_window_unit: "hour",
});

// 4 weeks
const month = await ws.queryFunnel(["Signup", "Purchase"], {
  conversion_window: 4,
  conversion_window_unit: "week",
});
```

### Conversion window units

The accepted values are the members of the `ConversionWindowUnit` union:

| Unit              | Max value  | Description      |
| ----------------- | ---------- | ---------------- |
| `"second"`        | 31,708,800 | Seconds (min: 2) |
| `"minute"`        | 528,480    | Minutes          |
| `"hour"`          | 8,808      | Hours            |
| `"day"` (default) | 367        | Days             |
| `"week"`          | 52         | Weeks            |
| `"month"`         | 12         | Months           |
| `"session"`       | 12         | Sessions         |

All maximum values correspond to approximately 366 days.

### Session-based conversion

Use `conversion_window_unit: "session"` to count conversions within a single Mixpanel session:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Users must complete all steps within one session
const result = await ws.queryFunnel(
  ["View Product", "Add to Cart", "Purchase"],
  {
    conversion_window: 1,
    conversion_window_unit: "session",
    math: "conversion_rate_session",
  },
);
```

::: info
Session-based conversion requires `conversion_window: 1` and `math: "conversion_rate_session"`.
:::

## Ordering

The `order` option controls how steps must be completed (`FunnelOrder`):

| Order               | Behavior                                                                          |
| ------------------- | --------------------------------------------------------------------------------- |
| `"loose"` (default) | Steps must happen in the specified order, but other events can occur between them |
| `"any"`             | Steps can happen in any order within the conversion window                        |

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Steps in any order
const result = await ws.queryFunnel(
  ["Feature A Used", "Feature B Used", "Feature C Used"],
  { order: "any", conversion_window: 30 },
);
```

### Per-step order override

When the top-level `order` is `"any"`, individual steps can override to `"loose"`:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { FunnelStep } from "@mixpanel-headless/core";
const ws = createNodeWorkspace();
// ---cut---
const result = await ws.queryFunnel(
  [
    new FunnelStep({ event: "Signup" }), // must come first (loose)
    new FunnelStep({ event: "Feature A", order: "any" }),
    new FunnelStep({ event: "Feature B", order: "any" }),
  ],
  { order: "any" },
);
```

## Aggregation

The `math` option controls what metric is computed. Default: `"conversion_rate_unique"`. The 14 accepted values are the members of the `FunnelMathType` union.

### Conversion rates

| Math type                            | What it measures              |
| ------------------------------------ | ----------------------------- |
| `"conversion_rate_unique"` (default) | Unique-user conversion rate   |
| `"conversion_rate_total"`            | Total-event conversion rate   |
| `"conversion_rate_session"`          | Session-based conversion rate |

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Total-event conversion (counts all events, not just unique users)
const result = await ws.queryFunnel(["View", "Purchase"], {
  math: "conversion_rate_total",
});
```

### Raw counts

| Math type  | What it counts             |
| ---------- | -------------------------- |
| `"unique"` | Unique users per step      |
| `"total"`  | Total event count per step |

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Raw unique user counts at each step
const result = await ws.queryFunnel(["Signup", "Purchase"], { math: "unique" });
```

### Property aggregation

| Math type                             | Aggregation                                 |
| ------------------------------------- | ------------------------------------------- |
| `"average"`                           | Mean of a numeric property per step         |
| `"median"`                            | Median value                                |
| `"min"` / `"max"`                     | Extremes                                    |
| `"p25"` / `"p75"` / `"p90"` / `"p99"` | Percentiles                                 |
| `"histogram"`                         | Distribution of a numeric property per step |

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Average purchase amount at each step
const average = await ws.queryFunnel(["Signup", "Purchase"], {
  math: "average",
  math_property: "amount",
});

// Distribution of purchase amounts at each funnel step
const histogram = await ws.queryFunnel(["Browse", "Add to Cart", "Purchase"], {
  math: "histogram",
  math_property: "amount",
});
```

## Filters

### Global filters

Apply filters across all steps with `where`:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { Filter } from "@mixpanel-headless/core";

// Filter the entire funnel
const us = await ws.queryFunnel(["Signup", "Purchase"], {
  where: Filter.equals("country", "US"),
});

// Multiple global filters (AND logic)
const premiumWeb = await ws.queryFunnel(["Signup", "Purchase"], {
  where: [Filter.equals("platform", "web"), Filter.isTrue("is_premium")],
});
```

Global filters apply to all steps in the funnel. For step-specific filtering, use `FunnelStep.filters` (see [Per-step filters](#per-step-filters)).

See [Insights queries](/guide/query) for the complete filter reference.

### Cohort filters

Restrict the funnel to users in a cohort — saved or inline:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import {
  Filter,
  CohortCriteria,
  CohortDefinition,
} from "@mixpanel-headless/core";

// Saved cohort
const saved = await ws.queryFunnel(["Signup", "Purchase"], {
  where: Filter.inCohort(123, "Power Users"),
});

// Inline cohort — no pre-saved cohort needed
const activeUsers = new CohortDefinition(
  CohortCriteria.didEvent("Login", { at_least: 5, within_days: 7 }),
);
const inline = await ws.queryFunnel(["Signup", "Purchase"], {
  where: Filter.inCohort(activeUsers, "Active Users"),
});
```

See [Insights queries](/guide/query) for the full cohort filter reference.

### Custom property filters

Use saved or inline custom properties in funnel filters:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { Filter, CustomPropertyRef } from "@mixpanel-headless/core";

const result = await ws.queryFunnel(["Signup", "Purchase"], {
  where: Filter.greaterThan(new CustomPropertyRef({ id: 42 }), 100),
});
```

::: warning
Custom property filters in funnel `where` may cause server errors due to a known Mixpanel API bug. Custom property breakdowns and measurement work reliably.
:::

See [Insights queries](/guide/query) for `InlineCustomProperty`, validation rules, and full options.

## Breakdowns

Break down funnel results by property values with `group_by`:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { GroupBy } from "@mixpanel-headless/core";

// Simple string breakdown
const byPlatform = await ws.queryFunnel(["Signup", "Purchase"], {
  group_by: "platform",
});

// Multiple breakdowns
const byCountryPlatform = await ws.queryFunnel(["Signup", "Purchase"], {
  group_by: ["country", "platform"],
});

// Numeric bucketing
const byAmount = await ws.queryFunnel(["Signup", "Purchase"], {
  group_by: new GroupBy({
    property: "amount",
    property_type: "number",
    bucket_size: 50,
  }),
});
```

### Cohort breakdowns

Segment funnel results by cohort membership:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { CohortBreakdown } from "@mixpanel-headless/core";

// Compare power users vs. everyone else through the funnel
const result = await ws.queryFunnel(["Signup", "Purchase"], {
  group_by: new CohortBreakdown({ cohort: 123, name: "Power Users" }),
});
```

See [Insights queries](/guide/query) for inline definitions and options.

### Custom property breakdowns

Break down funnel results by a saved or inline custom property:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { GroupBy, InlineCustomProperty } from "@mixpanel-headless/core";

const result = await ws.queryFunnel(["Signup", "Purchase"], {
  group_by: new GroupBy({
    property: InlineCustomProperty.numeric("A * B", {
      A: "price",
      B: "quantity",
    }),
    property_type: "number",
    bucket_size: 50,
  }),
});
```

See [Insights queries](/guide/query) for `CustomPropertyRef` and the full `GroupBy` reference.

## Exclusions

Exclude users who perform specific events between funnel steps. Users who trigger an excluded event within the specified step range are removed from the funnel.

### String shorthand

Pass event names as strings to exclude them between all steps:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Exclude users who log out anywhere in the funnel
const result = await ws.queryFunnel(["Signup", "Add to Cart", "Purchase"], {
  exclusions: ["Logout"],
});
```

### The `Exclusion` class

For targeted exclusion between specific steps, use `Exclusion` objects:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { Exclusion } from "@mixpanel-headless/core";

const result = await ws.queryFunnel(
  ["Signup", "Add to Cart", "Checkout", "Purchase"],
  {
    exclusions: [
      new Exclusion({ event: "Logout" }), // between all steps (same as string)
      new Exclusion({ event: "Refund", from_step: 2, to_step: 3 }), // only between Checkout and Purchase
    ],
  },
);
```

`Exclusion` fields:

| Field       | Type             | Default    | Description                                                       |
| ----------- | ---------------- | ---------- | ----------------------------------------------------------------- |
| `event`     | `string`         | (required) | Event name to exclude                                             |
| `from_step` | `number`         | `0`        | Start of exclusion range (0-indexed, inclusive)                   |
| `to_step`   | `number \| null` | `null`     | End of exclusion range (0-indexed, inclusive). `null` = last step |

::: info
Step indices are 0-based. For a 3-step funnel `["A", "B", "C"]`, `from_step: 0, to_step: 2` covers the entire funnel.
:::

## Holding constant

Hold properties constant across all funnel steps. Only users whose property value is the same at every step are counted as converting.

### String shorthand

Pass property names as strings:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Only count conversions where platform is the same at every step
const single = await ws.queryFunnel(["Signup", "Purchase"], {
  holding_constant: "platform",
});

// Multiple properties
const multiple = await ws.queryFunnel(["Signup", "Purchase"], {
  holding_constant: ["platform", "country"],
});
```

### The `HoldingConstant` class

For user-profile properties, use `HoldingConstant` objects:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { HoldingConstant } from "@mixpanel-headless/core";

const result = await ws.queryFunnel(["Signup", "Purchase"], {
  holding_constant: [
    new HoldingConstant({ property: "platform" }), // event property (default)
    new HoldingConstant({ property: "plan_tier", resource_type: "people" }), // user-profile property
  ],
});
```

`HoldingConstant` fields:

| Field           | Type                   | Default    | Description                                       |
| --------------- | ---------------------- | ---------- | ------------------------------------------------- |
| `property`      | `string`               | (required) | Property name to hold constant                    |
| `resource_type` | `"events" \| "people"` | `"events"` | Whether this is an event or user-profile property |

::: info
Maximum 3 holding constant properties per query.
:::

## Time ranges

### Relative (default)

By default, `queryFunnel()` returns the last 30 days. Customize with `last` (always in days) and `unit` (aggregation granularity):

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Last 7 days
const week = await ws.queryFunnel(["Signup", "Purchase"], { last: 7 });

// Last 84 days (~12 weeks), weekly granularity
const quarter = await ws.queryFunnel(["Signup", "Purchase"], {
  last: 84,
  unit: "week",
});

// Last 180 days (~6 months), monthly granularity
const halfYear = await ws.queryFunnel(["Signup", "Purchase"], {
  last: 180,
  unit: "month",
});
```

### Absolute

Specify explicit start and end dates:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Q1 2025
const result = await ws.queryFunnel(["Signup", "Purchase"], {
  from_date: "2025-01-01",
  to_date: "2025-03-31",
});
```

Dates must be in `YYYY-MM-DD` format.

## Display modes

The `mode` option controls result presentation (`FunnelMode`):

| Mode                | Description                | Use case                        |
| ------------------- | -------------------------- | ------------------------------- |
| `"steps"` (default) | Step-level conversion data | Standard funnel analysis        |
| `"trends"`          | Conversion over time       | Track funnel performance trends |
| `"table"`           | Tabular breakdown          | Detailed segment comparison     |

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Conversion trend over time
const result = await ws.queryFunnel(["Signup", "Purchase"], {
  mode: "trends",
  last: 90,
  unit: "week",
});
```

## Reentry mode

Control how users re-enter the funnel after conversion using the `reentry_mode` option (`FunnelReentryMode`):

| Mode           | Behavior                                                 |
| -------------- | -------------------------------------------------------- |
| `"default"`    | Server default reentry behavior                          |
| `"basic"`      | Users can re-enter after their conversion window expires |
| `"aggressive"` | Users can re-enter as soon as they convert               |
| `"optimized"`  | Server-optimized reentry (best for most use cases)       |

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Allow aggressive re-entry for repeat purchase funnels
const result = await ws.queryFunnel(["Browse", "Add to Cart", "Purchase"], {
  reentry_mode: "aggressive",
  last: 30,
});
```

::: info
Reentry mode only matters for funnels where the same user can convert multiple times.
:::

## Period-over-period comparison

Compare funnel conversion against a previous period using `TimeComparison`:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { TimeComparison } from "@mixpanel-headless/core";

// Compare this week's funnel against last week
const result = await ws.queryFunnel(["Signup", "Activate", "Purchase"], {
  time_comparison: TimeComparison.relative("week"),
  last: 7,
});
```

See [Insights queries](/guide/query) for all `TimeComparison` builders (`relative`, `absoluteStart`, `absoluteEnd`).

## Data group scoping

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Scope funnel to a data group
const result = await ws.queryFunnel(["Signup", "Purchase"], {
  data_group_id: 42,
});
```

## Working with results

### `FunnelQueryResult`

`queryFunnel()` returns a `FunnelQueryResult` with:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
const result = await ws.queryFunnel(["Signup", "Add to Cart", "Purchase"]);

// Overall conversion rate (first to last step)
result.overall_conversion_rate; // 0.12 (12%)

// Rows of plain objects, one per step
result.toRows();
// [{ step: 1, event: "Signup",      count: 1000, step_conv_ratio: 1.00, overall_conv_ratio: 1.00, avg_time: 0.0,    avg_time_from_start: 0.0 },
//  { step: 2, event: "Add to Cart", count: 450,  step_conv_ratio: 0.45, overall_conv_ratio: 0.45, avg_time: 1800.0, avg_time_from_start: 1800.0 },
//  { step: 3, event: "Purchase",    count: 120,  step_conv_ratio: 0.27, overall_conv_ratio: 0.12, avg_time: 3600.0, avg_time_from_start: 5400.0 }]
result.rowColumns(); // ["step", "event", "count", "step_conv_ratio", ...]

// Raw step data
result.steps_data; // array of step-level metric records
result.series; // raw API series data

// Time range
result.from_date; // "2025-03-01"
result.to_date; // "2025-03-31"

// Metadata
result.computed_at; // "2025-03-31T12:00:00.000000+00:00"
result.meta; // { sampling_factor: 1.0, ... }

// Generated bookmark params (for debugging or persistence)
result.params; // the full bookmark JSON sent to the API
```

### Row structure

`toRows()` returns one row per funnel step; `rowColumns()` names the columns in order:

| Column                | Description                                             |
| --------------------- | ------------------------------------------------------- |
| `step`                | Step number (1-indexed)                                 |
| `event`               | Event name                                              |
| `count`               | Number of users/events reaching this step               |
| `step_conv_ratio`     | Conversion rate from previous step (1.0 for first step) |
| `overall_conv_ratio`  | Conversion rate from first step                         |
| `avg_time`            | Average time from previous step (seconds)               |
| `avg_time_from_start` | Average time from first step (seconds)                  |

Rows are plain objects (`Record<string, unknown>`), ready for `console.table`, a DataFrame library, or `JSON.stringify`. The typed per-step shape is exported as `FunnelStepData`.

### Persisting as a saved report

The generated bookmark params can be saved as a Mixpanel report:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { CreateBookmarkParams } from "@mixpanel-headless/core";

const result = await ws.queryFunnel(["Signup", "Purchase"], {
  conversion_window: 7,
  last: 90,
});

await ws.createBookmark(
  new CreateBookmarkParams({
    name: "Signup → Purchase Funnel (7d window)",
    bookmark_type: "funnels",
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
const result = await ws.queryFunnel(["Signup", "Purchase"]);
console.log(JSON.stringify(result.params, null, 2));
```

## Validation

`queryFunnel()` validates all parameter combinations **before** making an API call and throws `BookmarkValidationError` with descriptive messages:

| Rule                                  | Error code                                | Error message                                                 |
| ------------------------------------- | ----------------------------------------- | ------------------------------------------------------------- |
| Fewer than 2 steps                    | `F1_MIN_STEPS`                            | At least 2 steps are required                                 |
| More than 100 steps                   | `F1_MAX_STEPS`                            | Maximum 100 steps allowed                                     |
| Empty step event name                 | `F2_EMPTY_STEP_EVENT`                     | Step event name must be a non-empty string                    |
| Control chars in step name            | `F2_CONTROL_CHAR_STEP_EVENT`              | Step event name contains control characters                   |
| Non-positive conversion window        | `F3_CONVERSION_WINDOW_POSITIVE`           | conversion_window must be a positive integer                  |
| Window exceeds max for unit           | `F3_CONVERSION_WINDOW_MAX`                | conversion_window exceeds maximum for unit                    |
| Empty exclusion event                 | `F4_EMPTY_EXCLUSION_EVENT`                | Exclusion event name must be non-empty                        |
| Exclusion step order invalid          | `F4_EXCLUSION_STEP_ORDER`                 | to_step must be > from_step                                   |
| Exclusion step out of bounds          | `F4_EXCLUSION_STEP_BOUNDS`                | Step index exceeds step count                                 |
| Invalid conversion window unit        | `F7_INVALID_WINDOW_UNIT`                  | Must be one of: second, minute, ...                           |
| Second unit requires window >= 2      | `F7_SECOND_MIN_WINDOW`                    | Must be at least 2 for seconds                                |
| More than 3 holding constant          | `F8_MAX_HOLDING_CONSTANT`                 | Maximum 3 holding_constant properties                         |
| Session math without session unit     | `F9_SESSION_MATH_REQUIRES_SESSION_WINDOW` | Requires conversion_window_unit='session'                     |
| Session unit without window of 1      | `F9_SESSION_WINDOW_REQUIRES_ONE`          | conversion_window_unit='session' requires conversion_window=1 |
| Property math missing math_property   | `F10_MATH_MISSING_PROPERTY`               | Property-aggregation math types require math_property         |
| Non-property math given math_property | `F11_MATH_REJECTS_PROPERTY`               | Count/rate math types don't accept math_property              |
| Invalid reentry mode                  | `F12_INVALID_REENTRY_MODE`                | Must be one of: default, basic, aggressive, optimized         |

Errors are collected — all validation issues are reported at once, not just the first. Each finding is a `ValidationError` with `code`, `path` and `message`:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { BookmarkValidationError } from "@mixpanel-headless/core";

try {
  await ws.queryFunnel(["Signup"], { conversion_window: 0 });
} catch (error) {
  if (error instanceof BookmarkValidationError) {
    for (const finding of error.errors) {
      console.log(`[${finding.code}] ${finding.path}: ${finding.message}`);
    }
    // [F1_MIN_STEPS] steps: At least 2 steps are required (got 1)
    // [F3_CONVERSION_WINDOW_POSITIVE] conversion_window: conversion_window must be a positive integer
  } else {
    throw error;
  }
}
```

Constructing a `FunnelStep`, `Exclusion` or `HoldingConstant` with a bad field (an empty event name, `from_step` below zero, `to_step` before `from_step`) throws `ParamValidationError` immediately, before any query runs. See [Error handling](/guide/error-handling).

## Complete examples

### E-commerce funnel

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { FunnelStep, Filter, Exclusion } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

// Full purchase funnel with exclusions and filters
const result = await ws.queryFunnel(
  [
    new FunnelStep({ event: "View Product" }),
    new FunnelStep({ event: "Add to Cart" }),
    new FunnelStep({
      event: "Purchase",
      filters: [Filter.greaterThan("amount", 0)],
    }),
  ],
  {
    conversion_window: 7,
    exclusions: [
      new Exclusion({ event: "Remove from Cart", from_step: 1, to_step: 2 }),
    ],
    holding_constant: "platform",
    where: Filter.equals("country", "US"),
    group_by: "platform",
    last: 90,
  },
);

console.log(
  `Overall conversion: ${(result.overall_conversion_rate * 100).toFixed(1)}%`,
);
console.table(result.toRows());
```

### Onboarding funnel

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Track user onboarding completion
const result = await ws.queryFunnel(
  ["Create Account", "Verify Email", "Complete Profile", "First Action"],
  {
    conversion_window: 3,
    conversion_window_unit: "day",
    order: "loose",
    math: "conversion_rate_unique",
    last: 30,
    unit: "week",
    mode: "trends", // track onboarding trends over time
  },
);

// Identify the biggest drop-off point
for (const step of result.steps_data) {
  const ratio = Number(step["step_conv_ratio"] ?? 0);
  console.log(
    `${String(step["event"])}: ${(ratio * 100).toFixed(0)}% step conversion`,
  );
}
```

## Generating params without querying

Use `buildFunnelParams()` to generate bookmark params without making an API call — useful for debugging, inspecting the generated JSON, or saving queries as reports:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { CreateBookmarkParams } from "@mixpanel-headless/core";

// Same arguments as queryFunnel(), returns the params object instead of a FunnelQueryResult
const params = await ws.buildFunnelParams(
  ["Signup", "Add to Cart", "Purchase"],
  {
    conversion_window: 7,
    exclusions: ["Logout"],
    holding_constant: "platform",
    last: 90,
  },
);

console.log(JSON.stringify(params, null, 2)); // inspect the generated bookmark JSON

// Save as a report directly from params
await ws.createBookmark(
  new CreateBookmarkParams({
    name: "Purchase Funnel (7d)",
    bookmark_type: "funnels",
    params,
  }),
);
```

### Running built params

Use `runFunnelParams()` to execute params that `buildFunnelParams()` produced (or params you wrote by hand). It returns the same `FunnelQueryResult` as `queryFunnel()`, and it is the way to run params the typed builder cannot express, such as a lookup-table join breakdown:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
const params = await ws.buildFunnelParams(
  ["Signup", "Add to Cart", "Purchase"],
  { last: 90 },
);
const result = await ws.runFunnelParams(params, { limit: 50_000 });
console.table(result.toRows().slice(0, 5));
```

Both `queryFunnel()` and `runFunnelParams()` accept `limit` (1 to 50000, default 3000) to raise the segment cap for high-cardinality breakdowns. Check `result.meta["is_segmentation_limit_hit"]` to see whether the result was still truncated. `runFunnelParams()` also takes `workspace_id` to run under a different data view than the session's.

## Next steps

- [Unified query system](/guide/unified-query-system) — the shared vocabulary: dates, `Filter`, `GroupBy`, cohorts, results
- [Insights queries](/guide/query) — typed analytics with DAU, formulas, filters, and breakdowns
- [Retention queries](/guide/query-retention) — typed retention analysis with event pairs and custom buckets
- [Flow queries](/guide/query-flows) — typed flow path analysis with steps, directions, and graph output
- [Live analytics](/guide/live-analytics) — legacy funnel method (saved funnels by ID)
- [API reference](/api/) — full method signatures for `Workspace`, `FunnelStep`, `Exclusion`, `HoldingConstant`, `FunnelQueryResult`
