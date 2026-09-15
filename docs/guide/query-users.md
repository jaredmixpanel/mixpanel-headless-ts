---
title: User profile queries
description: Query user profiles from Mixpanel's Engage API — filter by properties, sort, select fields, count matching profiles, and fetch large result sets with parallel pagination. Uses the same Filter vocabulary as all other query engines.
---

# User profile queries

Query user profiles from Mixpanel's Engage API — filter by properties, sort, select fields, count matching profiles, and fetch large result sets with parallel pagination. Uses the same `Filter` vocabulary as all other query engines.

::: tip Recommended
`ws.queryUser()` is the 5th engine in the [unified query system](/guide/unified-query-system). It answers **identity** questions ("who are these users?") that complement the behavioral questions answered by insights, funnels, retention, and flows.
:::

## When to use `queryUser()`

Use `queryUser()` when you need to work with **user profiles** rather than events:

| Use case                    | Example                                                                                |
| --------------------------- | -------------------------------------------------------------------------------------- |
| Filter profiles by property | `queryUser({ mode: "profiles", where: Filter.equals("plan", "premium") })`             |
| Count matching profiles     | `queryUser({ where: Filter.isSet("$email") })`                                         |
| Get top users by a metric   | `queryUser({ mode: "profiles", sort_by: "ltv", sort_order: "descending", limit: 50 })` |
| Look up specific users      | `queryUser({ mode: "profiles", distinct_id: "user_abc123" })`                          |
| Profile a behavioral cohort | `queryUser({ mode: "profiles", cohort: CohortDefinition.allOf(...) })`                 |
| Export profiles at scale    | `queryUser({ mode: "profiles", properties: [...], limit: 5000, parallel: true })`      |
| Cross-engine profiling      | Insights identifies a segment, `queryUser()` profiles those users                      |

Use `streamProfiles()` (Node.js only) when you need to iterate over raw profile records without structured filtering or row output — see [Streaming](/guide/streaming).

## Getting started

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { Filter } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

// Quick count — how many profiles exist? (default: mode "aggregate")
const count = await ws.queryUser();
console.log(`Total profiles: ${count.value}`);

// Quick peek — one sample profile (limit defaults to 1)
const sample = await ws.queryUser({ mode: "profiles" });
console.table(sample.toRows());

// Filter and select properties
const premium = await ws.queryUser({
  mode: "profiles",
  where: Filter.equals("plan", "premium"),
  properties: ["$email", "$name", "ltv"],
  sort_by: "ltv",
  sort_order: "descending",
  limit: 50,
});
console.table(premium.toRows()); // distinct_id | last_seen | email | name | ltv
```

::: info Coming from Python?
`ws.query_user(mode="profiles", where=..., limit=50)` becomes `ws.queryUser({ mode: "profiles", where: ..., limit: 50 })` — every argument is keyword-only in Python, so the whole call is one `snake_case` options object. `result.df` becomes `result.toRows()`; `result.to_dict()` becomes `result.toJSON()`. See [Coming from Python](/guide/coming-from-python).
:::

## Aggregate mode

Aggregate mode is the default (`mode: "aggregate"`). Compute statistics across matching profiles without fetching individual records. `aggregate` is one of `"count"` (default), `"extremes"`, `"percentile"` or `"numeric_summary"`:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { Filter } from "@mixpanel-headless/core";
const ws = createNodeWorkspace();
// ---cut---
// Count users with email (aggregate is the default mode)
const withEmail = await ws.queryUser({ where: Filter.isSet("$email") });
console.log(`Users with email: ${withEmail.value}`);

// Total users (all)
const total = await ws.queryUser();
console.log(`Total profiles: ${total.value}`);

// Extremes (min/max) of a numeric property
const extremes = await ws.queryUser({
  aggregate: "extremes",
  aggregate_property: "ltv",
});
console.log(extremes.aggregate_data); // { max: 9500, min: 0, ... }

// Percentile
const p90 = await ws.queryUser({
  aggregate: "percentile",
  aggregate_property: "ltv",
  percentile: 90,
});
console.log(p90.aggregate_data); // { percentile: 90, result: 4500 }

// Numeric summary (count, mean, variance, sum_of_squares)
const summary = await ws.queryUser({
  aggregate: "numeric_summary",
  aggregate_property: "ltv",
});
console.log(summary.aggregate_data); // { count: 1532, mean: 245.6, ... }

// Segmented count by cohort IDs
const segmented = await ws.queryUser({ segment_by: [12345, 67890] });
console.table(segmented.toRows()); // columns: segment, value
```

`aggregate_property` is required for every aggregate except `"count"` (and rejected for `"count"`); `percentile` is required exactly for `"percentile"` and must be strictly between 0 and 100.

## Behavioral filtering

Filter by behavioral criteria using the same `CohortDefinition` builders available across all engines:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
import { CohortDefinition, CohortCriteria } from "@mixpanel-headless/core";

// Users who purchased 3+ times in 30 days
const powerBuyers = await ws.queryUser({
  mode: "profiles",
  cohort: CohortDefinition.allOf(
    CohortCriteria.didEvent("Purchase", { at_least: 3, within_days: 30 }),
  ),
  properties: ["$email", "plan", "ltv"],
  limit: 200,
});
console.log(`Power buyers: ${powerBuyers.profiles.length}`);

// Filter by saved cohort ID
const savedCohort = await ws.queryUser({
  mode: "profiles",
  cohort: 12345,
  limit: 100,
});
```

`cohort` and a `Filter.inCohort()` in `where` are mutually exclusive; `Filter.notInCohort()` is not supported by the Engage API. Set `include_all_users: true` to include non-members in a cohort query's results.

## Parallel fetching

For large result sets, enable concurrent page retrieval. `limit: null` fetches every matching profile:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { Filter } from "@mixpanel-headless/core";
const ws = createNodeWorkspace();
// ---cut---
const result = await ws.queryUser({
  mode: "profiles",
  where: Filter.isSet("$email"),
  properties: ["$email", "plan", "ltv"],
  limit: 5000,
  parallel: true,
  workers: 5,
});
console.log(`Fetched ${result.profiles.length} profiles`);
console.log(
  `Pages: ${String(result.meta["pages_fetched"])}, Workers: ${String(result.meta["workers"])}`,
);
```

`workers` ranges from 1 to 5. `parallel` is ignored when `limit` is `1` (the default) — one page is one request either way.

## Cross-engine composition

The real power of `queryUser()` is combining it with behavioral engines. Identify interesting behavior with event engines, then profile those users:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { Filter } from "@mixpanel-headless/core";
const ws = createNodeWorkspace();
// ---cut---
// Step 1: Which plan drives the most DAU?
const dau = await ws.query("Login", {
  math: "dau",
  group_by: "plan",
  last: 30,
});
const totals = new Map<string, number>();
for (const row of dau.toRows()) {
  const plan = String(row["segment"]);
  totals.set(plan, (totals.get(plan) ?? 0) + Number(row["count"] ?? 0));
}
const topPlan = [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";

// Step 2: Profile users from that plan
const users = await ws.queryUser({
  mode: "profiles",
  where: Filter.equals("plan", topPlan),
  properties: ["$email", "company", "ltv"],
  sort_by: "ltv",
  sort_order: "descending",
  limit: 100,
});
console.log(`Plan '${topPlan}' has ${users.profiles.length} top users`);
console.table(users.toRows());
```

## Other options

| Option               | Type                           | Default        | Description                                                                |
| -------------------- | ------------------------------ | -------------- | -------------------------------------------------------------------------- |
| `where`              | `Filter \| Filter[] \| string` | `null`         | Profile filter; a string is a raw Engage selector expression               |
| `cohort`             | `number \| CohortDefinition`   | `null`         | Saved cohort ID or inline definition                                       |
| `properties`         | `string[]`                     | `null`         | Output properties to include (profiles mode)                               |
| `sort_by`            | `string`                       | `null`         | Property name to sort by (profiles mode)                                   |
| `sort_order`         | `"ascending" \| "descending"`  | `"descending"` | Sort direction                                                             |
| `limit`              | `number \| null`               | `1`            | Maximum profiles to return; `null` fetches all (ignored in aggregate mode) |
| `search`             | `string`                       | `null`         | Full-text search term (profiles mode)                                      |
| `distinct_id`        | `string`                       | `null`         | Single distinct-ID lookup (profiles mode)                                  |
| `distinct_ids`       | `string[]`                     | `null`         | Batch distinct-ID lookup (profiles mode; exclusive with `distinct_id`)     |
| `group_id`           | `string`                       | `null`         | Group-profile scope                                                        |
| `as_of`              | `string \| number`             | `null`         | Point-in-time query — ISO date text or Unix timestamp (profiles mode)      |
| `mode`               | `"aggregate" \| "profiles"`    | `"aggregate"`  | Output mode                                                                |
| `aggregate`          | see above                      | `"count"`      | Aggregation function (aggregate mode)                                      |
| `aggregate_property` | `string`                       | `null`         | Property to aggregate on                                                   |
| `percentile`         | `number`                       | `null`         | Percentile value, 0–100 exclusive                                          |
| `segment_by`         | `number[]`                     | `null`         | Cohort IDs for segmented aggregation (aggregate mode)                      |
| `parallel`           | `boolean`                      | `false`        | Enable concurrent page fetching (profiles mode)                            |
| `workers`            | `number`                       | `5`            | Maximum concurrent workers, 1–5                                            |
| `include_all_users`  | `boolean`                      | `false`        | Include non-members in cohort query results                                |

Options marked "profiles mode" are rejected in aggregate mode, and vice versa; every rule is checked before any request and reported through `BookmarkValidationError` — see [Error handling](/guide/error-handling).

## `UserQueryResult`

All results are returned as a `UserQueryResult` with:

| Member           | Type                                        | Description                                                                                                                                                                               |
| ---------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `toRows()`       | `readonly Record<string, unknown>[]`        | Profiles mode: one row per profile with `distinct_id`, `last_seen`, then each property (`$` prefix stripped). Aggregate mode: `metric`/`value` rows, or `segment`/`value` when segmented. |
| `rowColumns()`   | `readonly string[]`                         | Column names in order: `distinct_id`, `last_seen`, then the remaining properties alphabetically                                                                                           |
| `total`          | `number`                                    | Number of profiles returned (`profiles.length`). Use `mode: "aggregate"` with `aggregate: "count"` for the full population count                                                          |
| `profiles`       | `readonly Record<string, unknown>[]`        | Normalized profile records                                                                                                                                                                |
| `distinct_ids`   | `readonly string[]`                         | Distinct IDs from the profiles (empty outside profiles mode)                                                                                                                              |
| `value`          | `number \| null`                            | Scalar aggregate result (aggregate mode with a scalar payload only)                                                                                                                       |
| `aggregate_data` | `Record<string, unknown> \| number \| null` | Raw aggregate payload — a record for `extremes`, `percentile`, `numeric_summary` and segmented counts                                                                                     |
| `mode`           | `"profiles" \| "aggregate"`                 | The mode the query ran in                                                                                                                                                                 |
| `params`         | `Record<string, unknown>`                   | Engage API params used (for debugging)                                                                                                                                                    |
| `meta`           | `Record<string, unknown>`                   | Execution metadata (`session_id`, `pages_fetched`, `parallel`, `workers`, `failed_pages`; `action`, `segmented` in aggregate mode)                                                        |
| `computed_at`    | `string`                                    | When the query was computed (ISO text)                                                                                                                                                    |
| `toJSON()`       | `Record<string, unknown>`                   | JSON-serializable output (also what `JSON.stringify(result)` uses)                                                                                                                        |

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { Filter } from "@mixpanel-headless/core";
const ws = createNodeWorkspace();
// ---cut---
const result = await ws.queryUser({
  mode: "profiles",
  where: Filter.equals("plan", "premium"),
  properties: ["$email", "ltv"],
  limit: 25,
});

result.total; // 25
result.distinct_ids; // ["user_1", "user_2", ...]
result.rowColumns(); // ["distinct_id", "last_seen", "email", "ltv"]
for (const profile of result.profiles) {
  const props = profile["properties"] as Record<string, unknown> | undefined;
  console.log(profile["distinct_id"], props?.["$email"]);
}
```

## Previewing parameters

Inspect the generated Engage API params without executing:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { Filter } from "@mixpanel-headless/core";
const ws = createNodeWorkspace();
// ---cut---
const params = await ws.buildUserParams({
  where: Filter.equals("plan", "premium"),
  properties: ["$email", "ltv"],
  sort_by: "ltv",
  mode: "profiles",
});
console.log(JSON.stringify(params, null, 2));
```

## Running built params

Use `runUserParams()` to execute params that `buildUserParams()` produced (or params you wrote by hand). It returns the same `UserQueryResult` as `queryUser()`. The mode is read from the params: a record with an aggregate `action` key runs as an aggregate query, anything else runs as a profiles query. `limit`, `parallel`, and `workers` are execution settings the builder does not store, so pass them here:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { Filter } from "@mixpanel-headless/core";
const ws = createNodeWorkspace();
// ---cut---
const params = await ws.buildUserParams({
  mode: "profiles",
  where: Filter.equals("plan", "premium"),
  properties: ["$email", "ltv"],
});
const result = await ws.runUserParams(params, { limit: 500, parallel: true });
console.table(result.toRows().slice(0, 5));
```

## What's next

- [Unified query system](/guide/unified-query-system) — how all five engines work together
- [Insights queries](/guide/query) — event-level analytics
- [Funnel queries](/guide/query-funnels) — conversion analysis
- [Retention queries](/guide/query-retention) — cohort retention
- [Flow queries](/guide/query-flows) — path analysis
- [Streaming](/guide/streaming) — raw profile export with `streamProfiles()` (Node.js)
- [API reference](/api/) — full method signatures for `Workspace` and `UserQueryResult`
