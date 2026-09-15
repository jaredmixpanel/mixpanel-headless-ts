---
title: Live Analytics
description: "Query Mixpanel's analytics APIs directly for real-time data."
---

# Live Analytics

Query Mixpanel's analytics APIs directly for real-time data.

::: tip Looking for Insights Queries?
For DAU/WAU/MAU, multi-metric comparison, formulas, per-user aggregation, rolling windows, percentiles, typed filters, or numeric breakdowns, see **[Insights Queries](/guide/query)** — the recommended way to run analytics queries programmatically.
:::

::: tip Looking for entity management?
To create, update, or delete dashboards, reports, or cohorts, see the [Entity Management guide](/guide/entity-management).
:::

## When to Use Live Queries

Use live queries when:

- You need the most current data
- You're running one-off analysis
- The query is already optimized by Mixpanel (segmentation, funnels, retention)
- You want to leverage Mixpanel's pre-computed aggregations

The legacy query endpoints on this page take a required date window (`from_date` / `to_date`, `YYYY-MM-DD`) and a handful of string knobs. Every result class keeps its Python field names and exposes `toRows()` / `rowColumns()` where Python exposed a `.df`, and `toJSON()` where Python had `to_dict()`.

## Segmentation

Time-series event counts with optional property segmentation:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

// Simple count over time
const simple = await ws.segmentation("Purchase", {
  from_date: "2025-01-01",
  to_date: "2025-01-31",
});

// Segment by property
const byCountry = await ws.segmentation("Purchase", {
  from_date: "2025-01-01",
  to_date: "2025-01-31",
  on: "country",
});

// With filtering
const result = await ws.segmentation("Purchase", {
  from_date: "2025-01-01",
  to_date: "2025-01-31",
  on: "country",
  where: 'properties["plan"] == "premium"',
  unit: "week", // "day" | "week" | "month"
});

// Rows: one per (date, segment)
console.table(result.toRows());
```

Bare property names passed to `on` are normalized to `properties["…"]` for you.

### [SegmentationResult](/reference/core/classes/SegmentationResult)

```ts
result.event; // "Purchase"
result.from_date; // "2025-01-01"
result.to_date; // "2025-01-31"
result.unit; // "week"
result.segment_property; // "country" | null
result.total; // sum over every series
result.series; // { [segment]: { [date]: count } } — "$overall" when no `on`
result.toRows(); // [{ date, segment, count }, ...]
result.rowColumns(); // ["date", "segment", "count"]
result.toJSON(); // JSON-serializable
```

## Funnels

::: tip Looking for Ad-Hoc Funnel Queries?
For typed funnel definitions with per-step filters, exclusions, holding constant properties, and conversion window control — without creating a saved funnel first — see **[Funnel Queries](/guide/query-funnels)**.
:::

Analyze conversion through a sequence of saved steps:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
// ---cut---
// First, find your funnel ID
const funnels = await ws.funnels();
for (const f of funnels) {
  console.log(`${f.funnel_id}: ${f.name}`);
}

// Query the funnel
const overall = await ws.funnel(12345, {
  from_date: "2025-01-01",
  to_date: "2025-01-31",
});

// With segmentation
const result = await ws.funnel(12345, {
  from_date: "2025-01-01",
  to_date: "2025-01-31",
  on: "country",
});

// Access results
for (const step of result.steps) {
  console.log(
    `${step.event}: ${step.count} (${(step.conversion_rate * 100).toFixed(1)}%)`,
  );
}
```

A funnel id that is not a positive integer is rejected with `ParamValidationError` before any request.

### [FunnelResult](/reference/core/classes/FunnelResult)

```ts
result.funnel_id; // 12345
result.funnel_name; // "Checkout Funnel"
result.conversion_rate; // 0.15 (15% overall conversion)
result.steps; // FunnelResultStep[]
result.toRows(); // one row per step

// Each step
step.event; // "Checkout Started"
step.count; // 5000
step.conversion_rate; // 0.85
```

## Retention

::: tip Looking for Typed Retention Queries?
For per-event filters, custom retention buckets, alignment modes, display modes, typed breakdowns, and persistable results — without expression-string filters — see **[Retention Queries](/guide/query-retention)**.
:::

Cohort-based retention analysis:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
// ---cut---
const result = await ws.retention({
  born_event: "Signup",
  return_event: "Login",
  from_date: "2025-01-01",
  to_date: "2025-01-31",
  born_where: 'properties["source"] == "organic"',
  unit: "week",
});

// Access cohorts
for (const cohort of result.cohorts) {
  console.log(`${cohort.date}: ${cohort.size} users`);
  console.log(`  Retention: ${cohort.retention.join(", ")}`);
}
```

Other knobs: `return_where` filters the return event, `interval` (default `1`) and `interval_count` (default `10`) shape the retention buckets.

### [RetentionResult](/reference/core/classes/RetentionResult)

```ts
result.born_event; // "Signup"
result.return_event; // "Login"
result.unit; // "week"
result.cohorts; // CohortInfo[]
result.toRows(); // the retention matrix: { cohort_date, cohort_size, period_0, period_1, ... }

// Each cohort
cohort.date; // "2025-01-01"
cohort.size; // 1000
cohort.retention; // [1.0, 0.45, 0.32, 0.28, ...]
```

## Event Counts

Multi-event time series comparison:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
// ---cut---
const result = await ws.eventCounts(["Signup", "Purchase", "Churn"], {
  from_date: "2025-01-01",
  to_date: "2025-01-31",
  unit: "day",
});

// Long-format rows: one per (event, date)
console.table(result.toRows());
console.log(result.rowColumns()); // ["date", "event", "count"]
console.log(result.series); // { Signup: { "2025-01-01": 120, ... }, Purchase: { ... }, ... }
```

`type` selects the counting method: `"general"` (default), `"unique"` or `"average"`.

## Property Counts

Break down an event by property values:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
// ---cut---
const result = await ws.propertyCounts("Purchase", "country", {
  from_date: "2025-01-01",
  to_date: "2025-01-31",
  limit: 10,
});

console.table(result.toRows()); // rows: { date, value, count } — one per (value, date)
console.log(result.series); // { US: { "2025-01-01": 42, ... }, UK: { ... }, ... }
```

Pass `values: ["US", "UK"]` to restrict the breakdown to specific values.

## Activity Feed

Get a user's events, sorted chronologically (oldest-first within a page). When you set a `limit`, you get the most recent events first; use `sentinel_event` to page backward to older events (see [Pagination](#pagination) below). With no date filters it defaults to the last 30 days.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
// ---cut---
const result = await ws.activityFeed(["user_123", "user_456"], {
  from_date: "2025-01-01",
  to_date: "2025-01-31",
});

for (const event of result.events) {
  console.log(`${event.time}: ${event.event}`);
  console.log("  Properties:", event.properties);
}
```

### Filtering and search

Narrow the feed to specific events (`include_events` / `exclude_events` are mutually exclusive), full-text search across event properties, and cap the result with `limit`:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
// ---cut---
const result = await ws.activityFeed(["user_123"], {
  from_date: "2025-01-01",
  to_date: "2025-01-31",
  include_events: ["Login", "Purchase"],
  search: "san francisco",
  limit: 50,
});
```

Passing both `include_events` and `exclude_events` throws `QueryError`.

### Pagination

Large feeds page with a cursor. Each result carries `sentinel_event` — an object while more pages remain, or `null` on the final page. Pass it back to fetch the next (older) page:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
// ---cut---
const window = { from_date: "2025-01-01", to_date: "2025-01-31" };
let page = await ws.activityFeed(["user_123"], window);
while (page.sentinel_event !== null) {
  page = await ws.activityFeed(["user_123"], {
    ...window,
    sentinel_event: { ...page.sentinel_event },
  });
}
```

### [ActivityFeedResult](/reference/core/classes/ActivityFeedResult)

```ts
result.distinct_ids; // ["user_123", "user_456"]
result.events; // UserEvent[]
result.sentinel_event; // object | null — the cursor
result.toRows(); // one row per event: { event, time, distinct_id, ...properties }

// Each event
event.event; // "Purchase"
event.time; // ISO text
event.properties; // { ... }
```

## Saved Reports

Query saved reports from Mixpanel (Insights, Retention, Funnels, and Flows).

### Listing Bookmarks

First, find available saved reports:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
// ---cut---
// List all saved reports
const bookmarks = await ws.listBookmarks();
for (const b of bookmarks) {
  console.log(`${b.id}: ${b.name} (${b.type})`);
}

// Filter by type
const insights = await ws.listBookmarks("insights");
const funnels = await ws.listBookmarks("funnels");
```

### Querying Saved Reports

Query Insights, Retention, or Funnel reports by bookmark ID:

::: tip Get Bookmark IDs First
Run `listBookmarks()` to find the numeric ID of the report you want to query.
:::

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
// ---cut---
// Get the bookmark ID from listBookmarks() first
const bookmarks = await ws.listBookmarks("insights");
const bookmarkId = bookmarks[0]?.id ?? 98765;

const result = await ws.querySavedReport(bookmarkId);
console.log(`Report type: ${result.report_type}`);
console.table(result.toRows());

// Funnel reports take the bookmark type and a date window
const funnel = await ws.querySavedReport(98766, {
  bookmark_type: "funnels",
  from_date: "2025-01-01",
  to_date: "2025-01-31",
});
```

`bookmark_type` routes the query (`"insights"` by default, or `"funnels"`, `"retention"`, `"flows"`).

### [SavedReportResult](/reference/core/classes/SavedReportResult)

```ts
result.bookmark_id; // 98765
result.report_type; // "insights" | "funnel" | "retention" | "flows"
result.computed_at; // ISO text
result.headers; // column names the report returned
result.series; // the raw series
result.toRows(); // rows in `headers` order
```

## Flows

Query saved Flows reports:

::: tip Prefer `queryFlow()` for New Code
The typed [`queryFlow()`](/guide/query-flows) method lets you define flow analysis inline with per-step filters, direction controls, visualization modes, and graph output — no saved report required. Use `querySavedFlows()` only when querying an existing saved Flows report.
:::

::: tip Flows Use Different IDs
Flows reports have their own bookmark IDs. Filter with `listBookmarks("flows")` when listing.
:::

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
// ---cut---
// Get a Flows bookmark ID
const flows = await ws.listBookmarks("flows");
const bookmarkId = flows[0]?.id ?? 54321;

const result = await ws.querySavedFlows(bookmarkId);
console.log(
  `Conversion rate: ${(result.overall_conversion_rate * 100).toFixed(1)}%`,
);
for (const step of result.steps) {
  console.log(step);
}
```

### [FlowsResult](/reference/core/classes/FlowsResult)

```ts
result.bookmark_id; // 54321
result.steps; // one row per step
result.breakdowns; // one row per breakdown segment
result.overall_conversion_rate; // 0.42
result.metadata; // the report's metadata block
result.toRows(); // the steps
```

## Frequency Analysis

Analyze how often users perform an event:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
// ---cut---
const result = await ws.frequency({
  event: "Login",
  from_date: "2025-01-01",
  to_date: "2025-01-31",
  unit: "month", // "day" | "week" | "month"
  addiction_unit: "day", // "hour" | "day"
});

// Distribution of logins per day, one bucket list per period
console.log(result.data); // { "2025-01-01": [1000, 500, 300, ...], ... }
console.table(result.toRows()); // rows: { date, period_1, period_2, ... }
```

Omit `event` to measure all events; `where` filters with a Mixpanel expression.

## Numeric Aggregations

Aggregate numeric properties. `on` takes a property expression (`'properties["amount"]'`); the result's `property_expr` echoes it.

### Bucketing

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
// ---cut---
const result = await ws.segmentationNumeric("Purchase", {
  from_date: "2025-01-01",
  to_date: "2025-01-31",
  on: 'properties["amount"]',
  type: "general", // or "unique", "average"
});
console.table(result.toRows()); // one row per (date, bucket)
```

### Sum

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
// ---cut---
const result = await ws.segmentationSum("Purchase", {
  from_date: "2025-01-01",
  to_date: "2025-01-31",
  on: 'properties["amount"]',
});
// Total revenue per time period
console.log(result.results); // { "2025-01-01": 12345.5, ... }
```

### Average

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
// ---cut---
const result = await ws.segmentationAverage("Purchase", {
  from_date: "2025-01-01",
  to_date: "2025-01-31",
  on: 'properties["amount"]',
});
// Average purchase amount per time period
console.log(result.results);
```

All three accept `unit: "hour" | "day"` and `where`. A non-numeric property is rejected by the server with `QueryError`.

## API Escape Hatch

For Mixpanel APIs not covered by the `Workspace` class, use the [`api`](/reference/core/classes/Workspace#api) property — a [`MixpanelClient`](/reference/core/interfaces/MixpanelClient) — to make authenticated requests directly:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
const client = ws.api;

// Example: list annotations from the Annotations API.
// Many Mixpanel APIs require the project ID in the URL path.
const baseUrl = "https://mixpanel.com/api/app"; // eu.mixpanel.com for EU
const url = `${baseUrl}/projects/${client.projectId}/annotations`;

const response = await client.request("GET", url);
console.log(response); // the parsed JSON body

// The App API has a dedicated helper that unwraps `results` for you
const annotations = await client.appRequest(
  "GET",
  `/projects/${client.projectId}/annotations`,
);
console.log(annotations);
```

### Request Parameters

```ts
client.request("POST", "https://mixpanel.com/api/some/endpoint", {
  params: { key: "value" }, // query parameters
  jsonBody: { data: "payload" }, // JSON request body
  headers: { "X-Custom": "header" }, // additional headers
  timeoutSeconds: 60, // request timeout in seconds
  signal, // optional AbortSignal
});

client.appRequest("POST", "/projects/3/annotations", {
  params: { key: "value" }, // query parameters (strings)
  jsonBody: { data: "payload" }, // or `formBody` for form-encoded
  raw: true, // return the full body instead of `results`
});
```

Authentication is handled automatically — the client adds the proper `Authorization` header to all requests, retries rate limits, and maps failures to the same error classes as the rest of the library (`AuthenticationError`, `RateLimitError`, `QueryError`, `ServerError`).

Both methods return the parsed JSON as a [`JsonValue`](/reference/core/type-aliases/JsonValue) — a lossless tree that preserves integers beyond 2⁵³. Narrow it yourself, or pass it through [`toNativeJson()`](/reference/core/functions/toNativeJson) from `@mixpanel-headless/core` to get plain JavaScript values. The option bags are [`ClientRequestOptions`](/reference/core/interfaces/ClientRequestOptions) and [`ClientAppRequestOptions`](/reference/core/interfaces/ClientAppRequestOptions).

The client also exposes `projectId`, `region` and `workspaceId`, which are useful when constructing URLs for APIs that require these values in the path.

## Share a Result as a Link

`ws.createReportLink(...)` turns a typed query result or raw params into a Mixpanel URL that opens the same report in the browser, and `ws.savedReportLink(id)` builds the URL of a saved report without a network call. The legacy `segmentation` result on this page is not a typed Insights result, so rebuild it with `ws.query()` first if you want a link. See the [Report Links guide](/guide/report-links).

## Next Steps

- [Report Links](/guide/report-links) — Share a query as a URL, or resolve a URL back into a query
- [Data Discovery](/guide/discovery) — Explore your event schema
- [API Reference](/api/) — Complete API documentation; every method on this page is a member of [`Workspace`](/reference/core/classes/Workspace)
- Option bags: [`WorkspaceSegmentationOptions`](/reference/core/interfaces/WorkspaceSegmentationOptions), [`WorkspaceFunnelOptions`](/reference/core/interfaces/WorkspaceFunnelOptions), [`WorkspaceRetentionOptions`](/reference/core/interfaces/WorkspaceRetentionOptions), [`WorkspaceEventCountsOptions`](/reference/core/interfaces/WorkspaceEventCountsOptions), [`WorkspacePropertyCountsOptions`](/reference/core/interfaces/WorkspacePropertyCountsOptions), [`WorkspaceFrequencyOptions`](/reference/core/interfaces/WorkspaceFrequencyOptions), [`WorkspaceSegmentationNumericOptions`](/reference/core/interfaces/WorkspaceSegmentationNumericOptions), [`WorkspaceNumericOptions`](/reference/core/interfaces/WorkspaceNumericOptions)
- Result classes not shown above: [`FunnelResultStep`](/reference/core/classes/FunnelResultStep), [`CohortInfo`](/reference/core/classes/CohortInfo), [`EventCountsResult`](/reference/core/classes/EventCountsResult), [`PropertyCountsResult`](/reference/core/classes/PropertyCountsResult), [`UserEvent`](/reference/core/classes/UserEvent), [`FrequencyResult`](/reference/core/classes/FrequencyResult), [`NumericBucketResult`](/reference/core/classes/NumericBucketResult), [`NumericSumResult`](/reference/core/classes/NumericSumResult), [`NumericAverageResult`](/reference/core/classes/NumericAverageResult)
