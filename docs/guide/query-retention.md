---
title: Retention queries
description: Build typed retention analysis against Mixpanel's Insights engine — define born/return event pairs, retention periods, custom buckets, and segmentation inline without creating saved reports first.
---

# Retention queries

Build typed retention analysis against Mixpanel's Insights engine — define born/return event pairs, retention periods, custom buckets, and segmentation inline without creating saved reports first.

::: tip Recommended
`ws.queryRetention()` is the typed way to run retention analysis programmatically. It supports capabilities not available through the legacy `retention()` method, including per-event filters, custom retention buckets, alignment modes, display modes, and typed breakdowns.
:::

## When to use `queryRetention()`

`queryRetention()` builds retention bookmark params and posts them to the Insights engine. The legacy `retention()` method queries the older Retention API endpoint. Use `queryRetention()` when you need any of the capabilities in the right column:

| Capability               | Legacy `retention()`                           | `queryRetention()`                                        |
| ------------------------ | ---------------------------------------------- | --------------------------------------------------------- |
| Basic cohort retention   | `retention({ born_event, return_event, ... })` | `queryRetention("Signup", "Login")`                       |
| Per-event filters        | Expression strings only                        | `new RetentionEvent({ event: "Signup", filters: [...] })` |
| Custom retention buckets | Not available                                  | `bucket_sizes: [1, 3, 7, 14, 30]`                         |
| Alignment modes          | Not available                                  | `alignment: "birth"` or `"interval_start"`                |
| Display modes            | Not available                                  | `mode: "curve"`, `"trends"`, or `"table"`                 |
| Typed filters            | Expression strings                             | `where: Filter.equals("country", "US")`                   |
| Property breakdowns      | `on: "country"`                                | `group_by: "country"`                                     |
| Math types               | Not available                                  | `math: "retention_rate"` or `"unique"`                    |
| Save query as a report   | N/A                                            | `result.params` → `createBookmark()`                      |

Use the legacy `retention()` when:

- You need the older Query API response format → `retention({ born_event, return_event, from_date, to_date })`
- You need `born_where` / `return_where` expression-string filters → `retention({ ..., born_where: '...' })`

See [Live analytics](/guide/live-analytics) for the legacy methods.

## Getting started

The simplest possible retention query — weekly retention over the last 30 days:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

const result = await ws.queryRetention("Signup", "Login");
console.log(result.average); // synthetic average across all cohorts
console.table(result.toRows().slice(0, 5));
// cohort_date | bucket | count | rate
// 2025-01-01  | 0      | 1000  | 1.000000
// 2025-01-01  | 1      | 800   | 0.800000
// 2025-01-01  | 2      | 650   | 0.650000
```

Add a time range and retention unit:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Daily retention over the last 14 days
const daily = await ws.queryRetention("Signup", "Login", {
  retention_unit: "day",
  last: 14,
});

// Monthly retention over the last 180 days
const monthly = await ws.queryRetention("Signup", "Login", {
  retention_unit: "month",
  last: 180,
});

// Specific date range
const q1 = await ws.queryRetention("Signup", "Login", {
  from_date: "2025-01-01",
  to_date: "2025-03-31",
  retention_unit: "week",
});
```

::: info Coming from Python?
`ws.query_retention("Signup", "Login", retention_unit="week", last=90)` becomes `ws.queryRetention("Signup", "Login", { retention_unit: "week", last: 90 })` — the two events stay positional, every keyword moves into one `snake_case` options object. See [Coming from Python](/guide/coming-from-python).
:::

## Events

### Plain strings

The simplest way to define born and return events — pass event names as strings:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
const result = await ws.queryRetention("Signup", "Login");
```

The first argument is the **born event** (defines cohort membership) and the second is the **return event** (defines what counts as returning).

### The `RetentionEvent` class

For per-event configuration with filters, use `RetentionEvent` objects:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { RetentionEvent, Filter } from "@mixpanel-headless/core";

const result = await ws.queryRetention(
  new RetentionEvent({
    event: "Signup",
    filters: [Filter.equals("source", "organic")],
  }),
  new RetentionEvent({ event: "Login" }),
);
```

`RetentionEvent` fields:

| Field                | Type                        | Default    | Description                            |
| -------------------- | --------------------------- | ---------- | -------------------------------------- |
| `event`              | `string`                    | (required) | Mixpanel event name                    |
| `filters`            | `readonly Filter[] \| null` | `null`     | Per-event filter conditions            |
| `filters_combinator` | `"all" \| "any"`            | `"all"`    | How per-event filters combine (AND/OR) |

Plain strings and `RetentionEvent` objects can be mixed freely:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { RetentionEvent, Filter } from "@mixpanel-headless/core";
const ws = createNodeWorkspace();
// ---cut---
const result = await ws.queryRetention(
  "Signup", // plain string — no filters needed
  new RetentionEvent({
    event: "Purchase",
    filters: [Filter.greaterThan("amount", 0)],
  }),
);
```

### Per-event filters

Apply filters to individual events using `RetentionEvent.filters`. These restrict which events count for that specific role (born or return):

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { RetentionEvent, Filter } from "@mixpanel-headless/core";

const result = await ws.queryRetention(
  new RetentionEvent({
    event: "Signup",
    filters: [Filter.equals("source", "organic")],
  }),
  new RetentionEvent({
    event: "Purchase",
    filters: [Filter.equals("country", "US"), Filter.greaterThan("amount", 25)],
  }),
);
```

By default, multiple per-event filters combine with AND logic. Use `filters_combinator: "any"` for OR logic:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { RetentionEvent, Filter } from "@mixpanel-headless/core";
const ws = createNodeWorkspace();
// ---cut---
const result = await ws.queryRetention(
  "Signup",
  new RetentionEvent({
    event: "Purchase",
    filters: [Filter.equals("country", "US"), Filter.equals("country", "CA")],
    filters_combinator: "any", // match US OR CA
  }),
);
```

See [Insights queries](/guide/query) for the full list of `Filter` builders.

## Retention unit

Control the retention period granularity with `retention_unit` (`TimeUnit`):

| Unit               | Description               |
| ------------------ | ------------------------- |
| `"day"`            | Daily retention buckets   |
| `"week"` (default) | Weekly retention buckets  |
| `"month"`          | Monthly retention buckets |

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Daily retention
const daily = await ws.queryRetention("Signup", "Login", {
  retention_unit: "day",
  last: 14,
});

// Weekly retention (default)
const weekly = await ws.queryRetention("Signup", "Login", {
  retention_unit: "week",
  last: 90,
});

// Monthly retention
const monthly = await ws.queryRetention("Signup", "Login", {
  retention_unit: "month",
  last: 180,
});
```

## Alignment

The `alignment` option controls how retention periods are anchored (`RetentionAlignment`):

| Alignment           | Behavior                                                                 |
| ------------------- | ------------------------------------------------------------------------ |
| `"birth"` (default) | Each user's retention clock starts from their born event                 |
| `"interval_start"`  | Retention periods align to calendar boundaries (start of day/week/month) |

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Birth-aligned (default) — each user's clock starts individually
const birth = await ws.queryRetention("Signup", "Login", {
  alignment: "birth",
});

// Interval-aligned — retention periods snap to calendar boundaries
const interval = await ws.queryRetention("Signup", "Login", {
  alignment: "interval_start",
});
```

## Custom buckets

By default, retention uses uniform bucket sizes (bucket 0, 1, 2, ...). Use `bucket_sizes` for non-uniform retention periods:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Custom day-based buckets: day 1, 3, 7, 14, 30
const result = await ws.queryRetention("Signup", "Login", {
  retention_unit: "day",
  bucket_sizes: [1, 3, 7, 14, 30],
});
```

Bucket sizes must be:

- Positive integers
- In strictly ascending order
- Maximum 730 values

## Aggregation

The `math` option controls what metric is computed (`RetentionMathType`):

| Math type                    | What it measures                                   |
| ---------------------------- | -------------------------------------------------- |
| `"retention_rate"` (default) | Percentage of cohort retained per bucket (0.0–1.0) |
| `"unique"`                   | Raw unique user count per bucket                   |
| `"total"`                    | Total event count per retention bucket             |
| `"average"`                  | Average of a numeric property per bucket           |

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Retention rate (default)
const rate = await ws.queryRetention("Signup", "Login", {
  math: "retention_rate",
});

// Raw unique user counts
const unique = await ws.queryRetention("Signup", "Login", { math: "unique" });

// Total login events per retention bucket (not just unique users)
const total = await ws.queryRetention("Signup", "Login", { math: "total" });
```

::: info
`queryRetention()` has no `math_property` option (the Python signature has none either), so `math: "average"` cannot name the property to average through the typed builder. Build the params, add the measurement property by hand, and run them with `runRetentionParams()` — see [Running built params](#running-built-params).
:::

## Filters

### Global filters

Apply filters across the entire query with `where`:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { Filter } from "@mixpanel-headless/core";

// Single filter
const us = await ws.queryRetention("Signup", "Login", {
  where: Filter.equals("country", "US"),
});

// Multiple filters (AND logic)
const premiumWeb = await ws.queryRetention("Signup", "Login", {
  where: [Filter.equals("platform", "web"), Filter.isTrue("is_premium")],
});
```

Global filters apply to the overall query. For event-specific filtering, use `RetentionEvent.filters` (see [Per-event filters](#per-event-filters)).

See [Insights queries](/guide/query) for the complete filter reference.

### Cohort filters

Restrict retention analysis to users in a cohort:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import {
  Filter,
  CohortCriteria,
  CohortDefinition,
} from "@mixpanel-headless/core";

// Do power users retain better?
const powerUsers = await ws.queryRetention("Signup", "Login", {
  where: Filter.inCohort(123, "Power Users"),
  retention_unit: "week",
  last: 90,
});

// Inline cohort — define the segment on the fly
const organic = new CohortDefinition(
  CohortCriteria.didEvent("Signup", {
    at_least: 1,
    within_days: 90,
    where: Filter.equals("source", "organic"),
  }),
);
const organicRetention = await ws.queryRetention("Signup", "Purchase", {
  where: Filter.inCohort(organic, "Organic Signups"),
});
```

See [Insights queries](/guide/query) for the full cohort filter reference.

### Custom property filters

Use saved or inline custom properties in retention filters:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { Filter, CustomPropertyRef } from "@mixpanel-headless/core";

const result = await ws.queryRetention("Signup", "Login", {
  where: Filter.greaterThan(new CustomPropertyRef({ id: 42 }), 100),
  retention_unit: "week",
  last: 90,
});
```

::: warning
Custom property filters in retention `where` may cause server errors due to a known Mixpanel API bug. Custom property breakdowns work reliably.
:::

See [Insights queries](/guide/query) for `InlineCustomProperty`, validation rules, and full options.

## Breakdowns

Break down retention results by property values with `group_by`:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { GroupBy } from "@mixpanel-headless/core";

// Simple string breakdown
const byPlatform = await ws.queryRetention("Signup", "Login", {
  group_by: "platform",
});

// Multiple breakdowns
const byCountryPlatform = await ws.queryRetention("Signup", "Login", {
  group_by: ["country", "platform"],
});

// Numeric bucketing
const byAmount = await ws.queryRetention("Signup", "Purchase", {
  group_by: new GroupBy({
    property: "amount",
    property_type: "number",
    bucket_size: 50,
  }),
});
```

### Cohort breakdowns

Segment retention by cohort membership — compare how a cohort retains vs. everyone else:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { CohortBreakdown } from "@mixpanel-headless/core";

const result = await ws.queryRetention("Signup", "Login", {
  group_by: new CohortBreakdown({ cohort: 123, name: "Power Users" }),
  retention_unit: "week",
  last: 90,
});
```

::: info
`queryRetention()` does not support mixing `CohortBreakdown` with property `GroupBy` in the same `group_by` list. Use one or the other.
:::

See [Insights queries](/guide/query) for inline definitions and options.

### Custom property breakdowns

Break down retention results by a saved or inline custom property:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { GroupBy, CustomPropertyRef } from "@mixpanel-headless/core";

const result = await ws.queryRetention("Signup", "Login", {
  group_by: new GroupBy({
    property: new CustomPropertyRef({ id: 42 }),
    property_type: "number",
  }),
  retention_unit: "week",
  last: 90,
});
```

See [Insights queries](/guide/query) for `InlineCustomProperty` and the full `GroupBy` reference.

## Time ranges

### Relative (default)

By default, `queryRetention()` returns the last 30 days. Customize with `last` (always in days) and `unit` (aggregation granularity):

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Last 7 days
const week = await ws.queryRetention("Signup", "Login", { last: 7 });

// Last 90 days, weekly granularity
const quarter = await ws.queryRetention("Signup", "Login", {
  last: 90,
  unit: "week",
});

// Last 180 days, monthly granularity
const halfYear = await ws.queryRetention("Signup", "Login", {
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
const result = await ws.queryRetention("Signup", "Login", {
  from_date: "2025-01-01",
  to_date: "2025-03-31",
});
```

Dates must be in `YYYY-MM-DD` format.

## Display modes

The `mode` option controls result presentation (`RetentionMode`):

| Mode                | Chart type      | Use case                              |
| ------------------- | --------------- | ------------------------------------- |
| `"curve"` (default) | Retention curve | Standard retention analysis           |
| `"trends"`          | Line chart      | Track retention performance over time |
| `"table"`           | Table           | Detailed cohort-level comparison      |

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Retention curve (default)
const curve = await ws.queryRetention("Signup", "Login", { mode: "curve" });

// Trends over time
const trends = await ws.queryRetention("Signup", "Login", {
  mode: "trends",
  last: 90,
  unit: "week",
});

// Tabular format
const table = await ws.queryRetention("Signup", "Login", { mode: "table" });
```

## Unbounded mode

Control how users who perform the return event outside their retention bucket are counted using `unbounded_mode` (`RetentionUnboundedMode`):

| Mode                    | Behavior                                                                 |
| ----------------------- | ------------------------------------------------------------------------ |
| `"none"`                | Standard counting — only count in the exact bucket (default)             |
| `"carry_back"`          | If a user returns in bucket N, also count them in all prior buckets      |
| `"carry_forward"`       | If a user returns in bucket N, also count them in all subsequent buckets |
| `"consecutive_forward"` | Count forward from the last bucket where the user was active             |

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Carry-forward: once a user returns, count them as retained in all later buckets
const carryForward = await ws.queryRetention("Signup", "Login", {
  unbounded_mode: "carry_forward",
  retention_unit: "week",
  last: 90,
});

// Carry-back: if a user returns in W4, also count them in W1-W3
const carryBack = await ws.queryRetention("Signup", "Login", {
  unbounded_mode: "carry_back",
  retention_unit: "week",
  last: 90,
});
```

::: tip
Unbounded modes are useful for products where engagement is irregular. `carry_forward` gives an optimistic view, `carry_back` fills gaps.
:::

## Cumulative retention

Enable cumulative counting with `retention_cumulative: true`. In cumulative mode, each bucket shows the total number of users who returned at least once up to that bucket, rather than the count for that specific bucket.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Cumulative: bucket N = users who returned at least once in buckets 0..N
const result = await ws.queryRetention("Signup", "Login", {
  retention_cumulative: true,
  retention_unit: "week",
  last: 90,
});
```

## Period-over-period comparison

Compare retention curves against a previous period using `TimeComparison`:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { TimeComparison } from "@mixpanel-headless/core";

// Compare this month's retention against last month
const result = await ws.queryRetention("Signup", "Login", {
  time_comparison: TimeComparison.relative("month"),
  retention_unit: "week",
  last: 30,
});
```

See [Insights queries](/guide/query) for all `TimeComparison` builders.

## Data group scoping

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Scope retention to a data group
const result = await ws.queryRetention("Signup", "Login", {
  data_group_id: 42,
});
```

## Working with results

### `RetentionQueryResult`

`queryRetention()` returns a `RetentionQueryResult` with:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
const result = await ws.queryRetention("Signup", "Login", {
  retention_unit: "week",
  last: 90,
});

// Cohort data — keyed by cohort date
for (const [date, data] of Object.entries(result.cohorts)) {
  console.log(`${date}: ${String(data["first"])} users born`);
  console.log(`  Retention: ${JSON.stringify(data["rates"])}`); // [1.0, 0.8, 0.65, ...]
}

// Synthetic average across all cohorts
result.average; // { first: 500, counts: [...], rates: [...] }

// Rows of plain objects, one per (cohort_date, bucket) pair
result.toRows();
// [{ cohort_date: "2025-01-01", bucket: 0, count: 1000, rate: 1.0 },
//  { cohort_date: "2025-01-01", bucket: 1, count: 800,  rate: 0.8 },
//  { cohort_date: "2025-01-01", bucket: 2, count: 650,  rate: 0.65 },
//  { cohort_date: "2025-01-08", bucket: 0, count: 950,  rate: 1.0 },
//  { cohort_date: "2025-01-08", bucket: 1, count: 760,  rate: 0.8 }]
result.rowColumns(); // ["cohort_date", "bucket", "count", "rate"]

// Segmented results (when group_by was set)
result.segments; // { [segment]: { [cohort_date]: { first, counts, rates } } }
result.segment_averages; // { [segment]: { first, counts, rates } }

// Time range
result.from_date; // "2025-01-01"
result.to_date; // "2025-03-31"

// Metadata
result.computed_at; // "2025-03-31T12:00:00.000000+00:00"
result.meta; // { sampling_factor: 1.0, ... }

// Generated bookmark params (for debugging or persistence)
result.params; // the full bookmark JSON sent to the API
```

### Row structure

`toRows()` returns one row per (cohort_date, bucket) pair; when the query had a `group_by`, a leading `segment` column is added and rows come from `segments` instead of `cohorts`:

| Column        | Description                                                            |
| ------------- | ---------------------------------------------------------------------- |
| `segment`     | Breakdown value (segmented queries only)                               |
| `cohort_date` | Date string identifying the cohort (users born on this date)           |
| `bucket`      | Retention bucket index (0 = born period, 1 = first return period, ...) |
| `count`       | Number of users retained in this bucket                                |
| `rate`        | Retention rate for this bucket (count / cohort size, 0.0–1.0)          |

### Cohort data structure

Each entry in `result.cohorts` (and each per-segment entry in `result.segments`) is a record with the keys of the exported `RetentionCohortData` type:

| Key      | Type                | Description                                             |
| -------- | ------------------- | ------------------------------------------------------- |
| `first`  | `number`            | Cohort size — users who did the born event on this date |
| `counts` | `readonly number[]` | User counts retained per bucket                         |
| `rates`  | `readonly number[]` | Retention rates per bucket (0.0–1.0)                    |

The records are typed as `Record<string, unknown>` because the API can carry extra keys; read `data["first"]`, `data["counts"]`, `data["rates"]` and narrow as needed.

### Persisting as a saved report

The generated bookmark params can be saved as a Mixpanel report:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { CreateBookmarkParams } from "@mixpanel-headless/core";

const result = await ws.queryRetention("Signup", "Login", {
  retention_unit: "week",
  last: 90,
});

await ws.createBookmark(
  new CreateBookmarkParams({
    name: "Signup → Login Retention (Weekly)",
    bookmark_type: "retention",
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
const result = await ws.queryRetention("Signup", "Login");
console.log(JSON.stringify(result.params, null, 2));
```

## Validation

`queryRetention()` validates all parameter combinations **before** making an API call and throws `BookmarkValidationError` with descriptive messages:

| Rule                          | Error code                     | Error message                                                        |
| ----------------------------- | ------------------------------ | -------------------------------------------------------------------- |
| Empty born event name         | `R1_EMPTY_BORN_EVENT`          | born_event must be a non-empty string                                |
| Control chars in born event   | `R1_CONTROL_CHAR_BORN_EVENT`   | born_event contains control characters                               |
| Empty return event name       | `R2_EMPTY_RETURN_EVENT`        | return_event must be a non-empty string                              |
| Control chars in return event | `R2_CONTROL_CHAR_RETURN_EVENT` | return_event contains control characters                             |
| Non-positive bucket sizes     | `R5_BUCKET_SIZES_POSITIVE`     | Each bucket size must be a positive integer                          |
| Float bucket sizes            | `R5_BUCKET_SIZES_INTEGER`      | Bucket sizes must be integers, not floats                            |
| Too many bucket sizes         | `R5_BUCKET_SIZES_TOO_MANY`     | Maximum 730 bucket sizes                                             |
| Buckets not ascending         | `R6_BUCKET_SIZES_ASCENDING`    | Bucket sizes must be in strictly ascending order                     |
| Invalid retention unit        | `R7_INVALID_RETENTION_UNIT`    | Must be one of: day, week, month                                     |
| Invalid alignment             | `R8_INVALID_ALIGNMENT`         | Must be one of: birth, interval_start                                |
| Invalid math                  | `R9_INVALID_MATH`              | Must be one of: retention_rate, unique, total, average               |
| Invalid mode                  | `R10_INVALID_MODE`             | Must be one of: curve, trends, table                                 |
| Invalid unit                  | `R11_INVALID_UNIT`             | Must be one of: day, week, month                                     |
| Empty group_by list           | `R12_EMPTY_GROUP_BY`           | group_by list must not be empty                                      |
| Invalid unbounded mode        | `R13_INVALID_UNBOUNDED_MODE`   | Must be one of: none, carry_back, carry_forward, consecutive_forward |

Errors are collected — all validation issues are reported at once, not just the first:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { BookmarkValidationError } from "@mixpanel-headless/core";

try {
  await ws.queryRetention("", "Login", { bucket_sizes: [5, 3, 1] });
} catch (error) {
  if (error instanceof BookmarkValidationError) {
    for (const finding of error.errors) {
      console.log(`[${finding.code}] ${finding.path}: ${finding.message}`);
    }
    // [R1_EMPTY_BORN_EVENT] born_event: born_event must be a non-empty string
    // [R6_BUCKET_SIZES_ASCENDING] bucket_sizes: Bucket sizes must be in strictly ascending order
  } else {
    throw error;
  }
}
```

Constructing a `RetentionEvent` with an empty or control-character event name throws `ParamValidationError` immediately, before any query runs. See [Error handling](/guide/error-handling).

## Complete examples

### User onboarding retention

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { RetentionEvent, Filter } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

// Weekly retention: do new signups come back?
const result = await ws.queryRetention(
  new RetentionEvent({
    event: "Signup",
    filters: [Filter.equals("source", "organic")],
  }),
  "Login",
  { retention_unit: "week", last: 90, group_by: "platform" },
);

// Inspect the average retention curve
const avg = result.average;
console.log(`Cohort size: ${String(avg["first"])}`);
const rates = Array.isArray(avg["rates"]) ? (avg["rates"] as number[]) : [];
rates.forEach((rate, i) => {
  console.log(`  Week ${i}: ${(rate * 100).toFixed(1)}%`);
});

// Rows for further analysis
console.table(result.toRows());
```

### Product engagement

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { Filter } from "@mixpanel-headless/core";
const ws = createNodeWorkspace();
// ---cut---
// Do users who complete onboarding keep making purchases?
const result = await ws.queryRetention("Complete Onboarding", "Purchase", {
  retention_unit: "month",
  last: 180,
  where: Filter.isTrue("is_premium"),
});

// Custom bucket sizes for key retention milestones
const milestoneRetention = await ws.queryRetention("Signup", "Login", {
  retention_unit: "day",
  bucket_sizes: [1, 3, 7, 14, 30, 60, 90],
  last: 90,
});
```

### Retention trends

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
// Track how retention is changing over time
const result = await ws.queryRetention("Signup", "Login", {
  mode: "trends",
  unit: "week",
  retention_unit: "week",
  last: 180,
});
console.table(result.toRows());
```

## Generating params without querying

Use `buildRetentionParams()` to generate bookmark params without making an API call — useful for debugging, inspecting the generated JSON, or saving queries as reports:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { CreateBookmarkParams } from "@mixpanel-headless/core";

// Same arguments as queryRetention(), returns the params object instead of a RetentionQueryResult
const params = await ws.buildRetentionParams("Signup", "Login", {
  retention_unit: "week",
  bucket_sizes: [1, 3, 7, 14, 30],
  last: 90,
});

console.log(JSON.stringify(params, null, 2)); // inspect the generated bookmark JSON

// Save as a report directly from params
await ws.createBookmark(
  new CreateBookmarkParams({
    name: "Signup → Login Retention (Custom Buckets)",
    bookmark_type: "retention",
    params,
  }),
);
```

### Running built params

Use `runRetentionParams()` to execute params that `buildRetentionParams()` produced (or params you wrote by hand). It returns the same `RetentionQueryResult` as `queryRetention()`, and it is the way to run params the typed builder cannot express, such as a lookup-table join breakdown:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
const params = await ws.buildRetentionParams("Signup", "Login", {
  retention_unit: "week",
  last: 90,
});
const result = await ws.runRetentionParams(params, { limit: 50_000 });
console.table(result.toRows().slice(0, 5));
```

Both `queryRetention()` and `runRetentionParams()` accept `limit` (1 to 50000, default 3000) to raise the segment cap for high-cardinality breakdowns. Check `result.meta["is_segmentation_limit_hit"]` to see whether the result was still truncated. `runRetentionParams()` also takes `workspace_id` to run under a different data view than the session's.

## Next steps

- [Unified query system](/guide/unified-query-system) — the shared vocabulary: dates, `Filter`, `GroupBy`, cohorts, results
- [Insights queries](/guide/query) — typed analytics with DAU, formulas, filters, and breakdowns
- [Funnel queries](/guide/query-funnels) — typed funnel conversion analysis with steps, exclusions, and conversion windows
- [Flow queries](/guide/query-flows) — typed flow path analysis with steps, directions, and graph output
- [Live analytics](/guide/live-analytics) — legacy retention method
- [API reference](/api/) — full method signatures for `Workspace`, `RetentionEvent`, `RetentionQueryResult`, `RetentionAlignment`, `RetentionMode`, `RetentionMathType`
