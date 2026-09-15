---
title: Streaming Data
description: "Stream events and user profiles directly from Mixpanel. Ideal for ETL pipelines, data processing, exports, and Unix-style piping."
---

# Streaming Data

Stream events and user profiles directly from Mixpanel as async iterators — constant memory, no intermediate storage, abortable via `AbortSignal`. Ideal for ETL pipelines, data processing, exports, and Unix-style piping.

::: warning Node.js only
The Export API hosts serve no CORS headers, so streaming is Node-only. `@mixpanel-headless/browser` refuses `streamEvents` / `streamProfiles` with a typed error (`BROWSER_EXPORT_UNSUPPORTED`) before any network attempt. Use `@mixpanel-headless/node` for extraction workloads.
:::

## Streaming Events

### Basic Usage

Stream all events for a date range:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

for await (const event of ws.streamEvents({
  from_date: "2025-01-01",
  to_date: "2025-01-31",
})) {
  console.log(event);
  // { event_name, distinct_id, event_time, insert_id, properties }
  // event_time is ISO text; properties holds the remaining fields
}

await ws.close();
```

Both generators yield `unknown`: the shape depends on `raw` (below), so narrow each item yourself. A small type and a cast is the pragmatic pattern:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
// ---cut---
interface NormalizedEvent {
  event_name: string;
  distinct_id: string;
  event_time: string;
  insert_id: string;
  properties: Record<string, unknown>;
}

for await (const raw of ws.streamEvents({
  from_date: "2025-01-01",
  to_date: "2025-01-31",
})) {
  const event = raw as NormalizedEvent;
  console.log(`${event.event_name}: ${event.distinct_id}`);
}
```

### Filtering Events

Filter by event name or expression:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
declare function process(event: unknown): Promise<void>;
// ---cut---
// Filter by event names
for await (const event of ws.streamEvents({
  from_date: "2025-01-01",
  to_date: "2025-01-31",
  events: ["Purchase", "Signup"],
})) {
  await process(event);
}

// Filter with a WHERE clause
for await (const event of ws.streamEvents({
  from_date: "2025-01-01",
  to_date: "2025-01-31",
  where: 'properties["country"]=="US"',
})) {
  await process(event);
}

// Cap the export (1 to 100000)
for await (const event of ws.streamEvents({
  from_date: "2025-01-01",
  to_date: "2025-01-31",
  limit: 1000,
})) {
  await process(event);
}
```

### Raw API Format

By default, streaming returns normalized data with `event_time` as ISO text. Use `raw: true` to get the exact Mixpanel API format:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
declare const legacySystem: { ingest(event: unknown): Promise<void> };
// ---cut---
for await (const event of ws.streamEvents({
  from_date: "2025-01-01",
  to_date: "2025-01-31",
  raw: true,
})) {
  // event has the { event: "...", properties: { ... } } structure
  // properties.time is a Unix timestamp
  await legacySystem.ingest(event);
}
```

## Streaming Profiles

### Basic Usage

Stream all user profiles:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
declare function syncToCrm(profile: unknown): Promise<void>;
// ---cut---
for await (const profile of ws.streamProfiles()) {
  await syncToCrm(profile);
}
```

### Filtering Profiles

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
declare function sendSurvey(profile: unknown): Promise<void>;
// ---cut---
for await (const profile of ws.streamProfiles({
  where: 'properties["plan"]=="premium"',
})) {
  await sendSurvey(profile);
}
```

### Streaming Specific Users

Stream a single user by their distinct ID:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
declare function process(profile: unknown): Promise<void>;
// ---cut---
for await (const profile of ws.streamProfiles({ distinct_id: "user_123" })) {
  await process(profile);
}
```

Stream multiple specific users:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
declare function syncToExternalSystem(profile: unknown): Promise<void>;
// ---cut---
const userIds = ["user_123", "user_456", "user_789"];
for await (const profile of ws.streamProfiles({ distinct_ids: userIds })) {
  await syncToExternalSystem(profile);
}
```

::: warning Mutually Exclusive
`distinct_id` and `distinct_ids` cannot be used together. Use `distinct_id` for a single user, `distinct_ids` for multiple users. The guard throws `ParamValidationError` on the first pull.
:::

### Streaming Group Profiles

Stream group profiles (e.g., companies, accounts) instead of user profiles:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
declare function syncCompany(profile: unknown): Promise<void>;
declare function processEnterpriseAccount(profile: unknown): Promise<void>;
// ---cut---
// Stream all company profiles
for await (const company of ws.streamProfiles({ group_id: "companies" })) {
  await syncCompany(company);
}

// Filter group profiles
for await (const account of ws.streamProfiles({
  group_id: "accounts",
  where: 'properties["plan"]=="enterprise"',
})) {
  await processEnterpriseAccount(account);
}
```

### Behavioral Filtering

Stream users based on actions they've performed. Behaviors use a named pattern that you reference in a `where` clause:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
declare function sendThankYou(profile: unknown): Promise<void>;
declare function sendConversionReminder(profile: unknown): Promise<void>;
// ---cut---
// Users who completed a purchase in the last 30 days
const madePurchase = [
  {
    window: "30d",
    name: "made_purchase",
    event_selectors: [{ event: "Purchase" }],
  },
];
for await (const profile of ws.streamProfiles({
  behaviors: madePurchase,
  where: '(behaviors["made_purchase"] > 0)',
})) {
  await sendThankYou(profile);
}

// Users who signed up but didn't purchase
const signedUpNoPurchase = [
  { window: "30d", name: "signed_up", event_selectors: [{ event: "Signup" }] },
  {
    window: "30d",
    name: "purchased",
    event_selectors: [{ event: "Purchase" }],
  },
];
for await (const profile of ws.streamProfiles({
  behaviors: signedUpNoPurchase,
  where: '(behaviors["signed_up"] > 0) and (behaviors["purchased"] == 0)',
})) {
  await sendConversionReminder(profile);
}
```

::: info Behavior Format
Each behavior requires: `window` (time window like `"30d"`), `name` (identifier for the `where` clause), and `event_selectors` (array with `{ event: "Name" }`). `behaviors` also accepts a pre-encoded JSON string.
:::

::: warning Mutually Exclusive
`behaviors` cannot be used with `cohort_id`. Use one or the other for filtering.
:::

### Historical Profile State

Query profile state at a specific point in time:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
declare function compareHistoricalState(profile: unknown): Promise<void>;
// ---cut---
// Profile state from 7 days ago
const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
for await (const profile of ws.streamProfiles({
  as_of_timestamp: sevenDaysAgo,
})) {
  await compareHistoricalState(profile);
}
```

### Cohort Membership Analysis

Get all users with cohort membership marked:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
declare function tagAsCohortMember(profile: unknown): Promise<void>;
declare function tagAsNonMember(profile: unknown): Promise<void>;
// ---cut---
// Stream all users, marking which are in the cohort
for await (const raw of ws.streamProfiles({
  cohort_id: "12345",
  include_all_users: true,
})) {
  const profile = raw as { in_cohort?: boolean };
  if (profile.in_cohort) {
    await tagAsCohortMember(profile);
  } else {
    await tagAsNonMember(profile);
  }
}
```

::: info Requires cohort_id
`include_all_users` is only sent alongside `cohort_id`.
:::

### Limiting Returned Properties

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
// ---cut---
for await (const profile of ws.streamProfiles({
  output_properties: ["$email", "plan"],
})) {
  console.log(profile);
}
```

## Progress and Cancellation

Two TypeScript-only knobs, camelCase because they are not Python keyword arguments: `signal` aborts a stream mid-flight, and `onBatch` (profiles only) reports the cumulative count after each page.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

const controller = new AbortController();
setTimeout(() => controller.abort(), 60_000); // give up after a minute

try {
  for await (const profile of ws.streamProfiles({
    signal: controller.signal,
    onBatch: (count) => console.error(`${count} profiles so far`),
  })) {
    console.log(profile);
  }
} catch (error) {
  if (controller.signal.aborted) {
    console.error("export cancelled");
  } else {
    throw error;
  }
}
```

Breaking out of a `for await` loop early (`break`, `return`, or a thrown error) closes the generator and releases the HTTP response, so you rarely need the signal for a clean early exit — it is for cancelling from _outside_ the loop.

## Processing Patterns

Use plain JavaScript to filter, count, and export streamed data:

```ts twoslash
import { createWriteStream } from "node:fs";
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
const window = { from_date: "2025-01-01", to_date: "2025-01-31" };

// Filter to specific events
const purchases: unknown[] = [];
for await (const e of ws.streamEvents(window)) {
  if ((e as { event_name: string }).event_name === "Purchase") {
    purchases.push(e);
  }
}

// Save to a JSONL file
const out = createWriteStream("events.jsonl");
for await (const event of ws.streamEvents(window)) {
  out.write(`${JSON.stringify(event)}\n`);
}
out.end();

// Extract specific fields
const distinctIds: string[] = [];
for await (const p of ws.streamProfiles()) {
  distinctIds.push((p as { distinct_id: string }).distinct_id);
}

await ws.close();
```

## Output Formats

### Normalized Format (Default)

Events:

```json
{
  "event_name": "Purchase",
  "distinct_id": "user_123",
  "event_time": "2025-01-15T10:30:00+00:00",
  "insert_id": "abc123",
  "properties": {
    "amount": 99.99,
    "currency": "USD"
  }
}
```

An event with no `$insert_id` gets a fresh UUID as `insert_id`; pass `uuid` to control the generator (useful in tests).

Profiles:

```json
{
  "distinct_id": "user_123",
  "last_seen": "2025-01-15T14:30:00",
  "properties": {
    "name": "Alice",
    "plan": "premium"
  }
}
```

### Raw Format (`raw: true`)

Events:

```json
{
  "event": "Purchase",
  "properties": {
    "distinct_id": "user_123",
    "time": 1705319400,
    "$insert_id": "abc123",
    "amount": 99.99,
    "currency": "USD"
  }
}
```

Profiles:

```json
{
  "$distinct_id": "user_123",
  "$properties": {
    "$last_seen": "2025-01-15T14:30:00",
    "name": "Alice",
    "plan": "premium"
  }
}
```

## Common Patterns

### ETL Pipeline

Batch events and send them to an external system:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

declare function sendBatch(batch: unknown[]): Promise<void>;
// ---cut---
const ws = createNodeWorkspace();
let batch: unknown[] = [];

for await (const event of ws.streamEvents({
  from_date: "2025-01-01",
  to_date: "2025-01-31",
})) {
  batch.push(event);
  if (batch.length >= 1000) {
    await sendBatch(batch);
    batch = [];
  }
}

// Send the remainder
if (batch.length > 0) {
  await sendBatch(batch);
}

await ws.close();
```

Because the loop `await`s `sendBatch` before pulling the next event, the exporter applies backpressure naturally: the HTTP response body is only read as fast as your sink drains it.

### Aggregation Without Storage

Compute statistics without creating a local table:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
const eventCounts = new Map<string, number>();

for await (const raw of ws.streamEvents({
  from_date: "2025-01-01",
  to_date: "2025-01-31",
})) {
  const { event_name } = raw as { event_name: string };
  eventCounts.set(event_name, (eventCounts.get(event_name) ?? 0) + 1);
}

const top10 = [...eventCounts].sort((a, b) => b[1] - a[1]).slice(0, 10);
console.table(top10);
await ws.close();
```

### Piping to a Web Stream

Async generators plug straight into Node's `Readable.from`, so an export can feed any stream pipeline — here, a gzipped JSONL file:

```ts twoslash
import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
// ---cut---
const toJsonl = new Transform({
  objectMode: true,
  transform(event: unknown, _encoding, callback) {
    callback(null, `${JSON.stringify(event)}\n`);
  },
});

await pipeline(
  Readable.from(
    ws.streamEvents({ from_date: "2025-01-01", to_date: "2025-01-02" }),
  ),
  toJsonl,
  createGzip(),
  createWriteStream("events.jsonl.gz"),
);
```

`pipeline` propagates backpressure end to end, so a slow disk throttles the HTTP read.

### Automatic Cleanup

`Workspace` implements `Symbol.asyncDispose`, so `await using` closes the HTTP pool for you — the twin of Python's `with mp.Workspace() as ws:`:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
declare function process(event: unknown): void;
// ---cut---
{
  await using ws = createNodeWorkspace();
  for await (const event of ws.streamEvents({
    from_date: "2025-01-01",
    to_date: "2025-01-31",
  })) {
    process(event);
  }
} // ws.close() runs here
```

`close()` is idempotent, and a later call on the same `Workspace` reopens the pool.

## Method Signatures

### [`streamEvents()`](/reference/core/classes/Workspace#streamevents)

```ts
streamEvents(options: StreamEventsOptions): AsyncGenerator<unknown, void, undefined>
```

| Option      | Type               | Description                                  |
| ----------- | ------------------ | -------------------------------------------- |
| `from_date` | `string`           | Start date (`YYYY-MM-DD`), required          |
| `to_date`   | `string`           | End date (`YYYY-MM-DD`), required            |
| `events`    | `string[] \| null` | Event names to include                       |
| `where`     | `string \| null`   | Mixpanel expression filter                   |
| `limit`     | `number \| null`   | Maximum number of events (1 to 100000)       |
| `raw`       | `boolean`          | Return the raw API format                    |
| `uuid`      | `() => string`     | `insert_id` generator for events missing one |
| `signal`    | `AbortSignal`      | Cancellation signal                          |

### [`streamProfiles()`](/reference/core/classes/Workspace#streamprofiles)

```ts
streamProfiles(options?: StreamProfilesOptions): AsyncGenerator<unknown, void, undefined>
```

| Option              | Type                      | Description                                  |
| ------------------- | ------------------------- | -------------------------------------------- |
| `where`             | `string \| null`          | Mixpanel expression filter                   |
| `cohort_id`         | `string \| null`          | Filter by cohort membership                  |
| `output_properties` | `string[] \| null`        | Limit returned properties                    |
| `raw`               | `boolean`                 | Return the raw API format                    |
| `distinct_id`       | `string \| null`          | Single user ID to fetch                      |
| `distinct_ids`      | `string[] \| null`        | Multiple user IDs to fetch (deduplicated)    |
| `group_id`          | `string \| null`          | Group type for group profiles                |
| `behaviors`         | `unknown[] \| string`     | Behavioral filters (objects or JSON text)    |
| `as_of_timestamp`   | `number \| null`          | Historical state, Unix timestamp in the past |
| `include_all_users` | `boolean`                 | Include all users with cohort marking        |
| `onBatch`           | `(count: number) => void` | Progress callback, cumulative count per page |
| `signal`            | `AbortSignal`             | Cancellation signal                          |

**Parameter constraints** (each throws `ParamValidationError` on the first pull):

- `distinct_id` and `distinct_ids` are mutually exclusive
- `behaviors` and `cohort_id` are mutually exclusive
- `include_all_users` requires `cohort_id` to be set

Event export is project-scoped by design: a pinned workspace (`ws.use({ workspace })`) does not narrow `streamEvents`.

## Next Steps

- [Live Analytics](/guide/live-analytics) — Real-time Mixpanel reports
- [User Profiles](/guide/query-users) — Typed profile queries with cohorts and aggregation
- Reference: [`Workspace.streamEvents()`](/reference/core/classes/Workspace#streamevents), [`Workspace.streamProfiles()`](/reference/core/classes/Workspace#streamprofiles), [`createNodeWorkspace()`](/reference/node/functions/createNodeWorkspace), [`StreamEventsOptions`](/reference/core/interfaces/StreamEventsOptions), [`StreamProfilesOptions`](/reference/core/interfaces/StreamProfilesOptions), [`ParamValidationError`](/reference/core/classes/ParamValidationError)
