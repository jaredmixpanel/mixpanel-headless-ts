---
title: Data Discovery
description: "Explore your Mixpanel project's schema before writing queries. Discovery results are cached for the session."
---

# Data Discovery

Explore your Mixpanel project's schema before writing queries. Discovery results are cached for the lifetime of the `Workspace`.

Every method on this page returns plain arrays of strings or small result classes whose fields keep their Python names (`funnel_id`, `sample_values`, `percent_change`). Result classes with a `toJSON()` serialize to the same shape as Python's `to_dict()`.

## Listing Events

Get all event names in your project:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

const events = await ws.events();
console.log(events); // ['Login', 'Purchase', 'Signup', ...]
```

Events are returned sorted alphabetically. The list reflects events seen in the query window — by default the widest window the endpoint accepts (`from_date: "2000-01-01"`, `to_date` today, `limit: 5000`) — not the Lexicon registry. Narrow it with the option bag:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
// ---cut---
const recent = await ws.events({
  from_date: "2026-01-01",
  to_date: "2026-01-31",
  limit: 200,
});
```

## Listing Properties

Get properties for a specific event:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
// ---cut---
const properties = await ws.properties("Purchase");
console.log(properties); // ['amount', 'country', 'product_id', ...]
```

Properties include both event-specific and common properties, sorted alphabetically. An unknown event name throws [`EventNotFoundError`](/reference/core/classes/EventNotFoundError), whose message suggests close matches.

## Property Values

Sample values for a property:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
// ---cut---
// Sample values for a property
const values = await ws.propertyValues("country", { event: "Purchase" });
console.log(values); // ['US', 'UK', 'DE', 'FR', ...]

// Limit results (default 100)
const top5 = await ws.propertyValues("country", {
  event: "Purchase",
  limit: 5,
});
```

Values come back as strings, unsorted, exactly as the API returns them.

## Subproperties

Some Mixpanel event properties are **lists of objects** — for example, a `cart` property whose value is `[{"Brand": "nike", "Category": "hats", "Price": 51}, ...]`. `propertyValues()` returns these as JSON-encoded strings, which makes them awkward to inspect by eye. `subproperties()` parses a sample of those blobs and infers a scalar type per inner key.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
// ---cut---
for (const sp of await ws.subproperties("cart", { event: "Cart Viewed" })) {
  console.log(sp.name, sp.type, sp.sample_values);
}
// Brand string ['nike', 'puma', 'h&m']
// Category string ['hats', 'jeans']
// Item ID number [35317, 35318]
// Price number [51, 87, 102]

// Sample more rows (default: 50)
const wider = await ws.subproperties("cart", {
  event: "Cart Viewed",
  sample_size: 200,
});
```

Results are alphabetically sorted by `name`. Subproperties whose values are themselves objects or lists are silently skipped (only scalar sub-values are reportable). When a sub-key is observed with mixed scalar shapes, with both scalar and object shapes, or with only `null` values, the call emits a warning through the `warn` sink passed to the `Workspace` (Python's `UserWarning`).

The discovered names and types feed directly into `Filter.listContains` and `GroupBy.listItem` for filtering and breaking down by subproperty values — see [Insights Queries](/guide/query).

### [SubPropertyInfo](/reference/core/classes/SubPropertyInfo)

```ts
sp.name; // "Brand"
sp.type; // "string" | "number" | "boolean" | "datetime"
sp.sample_values; // ['nike', 'puma', 'h&m'] — up to 5 distinct values
sp.toJSON(); // { name: 'Brand', type: 'string', sample_values: ['nike', ...] }
```

## Saved Funnels

List funnels defined in Mixpanel:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
// ---cut---
const funnels = await ws.funnels();
for (const f of funnels) {
  console.log(`${f.funnel_id}: ${f.name}`);
}
```

### [FunnelInfo](/reference/core/classes/FunnelInfo)

```ts
f.funnel_id; // 12345
f.name; // "Checkout Funnel"
```

Funnels are sorted by name. Pass `funnel_id` to `ws.funnel()` to run one — see [Live Analytics](/guide/live-analytics#funnels).

## Saved Cohorts

List cohorts defined in Mixpanel:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
// ---cut---
const cohorts = await ws.cohorts();
for (const c of cohorts) {
  console.log(`${c.id}: ${c.name} (${c.count} users)`);
}
```

### [SavedCohort](/reference/core/classes/SavedCohort)

```ts
c.id; // 12345
c.name; // "Power Users"
c.count; // 5000
c.description; // "Users with 10+ logins"
c.created; // "2025-01-15T10:30:00" (ISO text)
c.is_visible; // true
```

## Saved Reports

List saved reports (bookmarks), optionally filtered by type. Unlike the other discovery calls this one is **not cached**:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
// ---cut---
const bookmarks = await ws.listBookmarks();
for (const b of bookmarks) {
  console.log(`${b.id}: ${b.name} (${b.type})`);
}

// Filter by type: "insights" | "funnels" | "retention" | "flows" | "launch-analysis"
const insights = await ws.listBookmarks("insights");
const flows = await ws.listBookmarks("flows");
```

### [BookmarkInfo](/reference/core/classes/BookmarkInfo)

```ts
b.id; // 98765
b.name; // "Weekly Actives"
b.type; // "insights"
b.project_id; // 3
b.created; // ISO text
b.modified; // ISO text
b.workspace_id; // number | null
b.dashboard_id; // number | null
b.description; // string | null
b.creator_id; // number | null
b.creator_name; // string | null
```

The numeric `id` is what `ws.querySavedReport()`, `ws.querySavedFlows()` and `ws.savedReportLink()` take.

## Lexicon Schemas

Retrieve data dictionary schemas for events and profile properties. Schemas include descriptions, property types, and metadata defined in Mixpanel's Lexicon.

::: info Schema Coverage
The Lexicon API returns only events/properties with explicit schemas (defined via API, CSV import, or UI). It does not return all events visible in Lexicon's UI.
:::

::: tip Schema Registry CRUD
For write operations on the schema registry (create, update, delete schemas and enforcement configuration), see the [Data Governance guide](/guide/data-governance).
:::

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
// ---cut---
// List all schemas
const schemas = await ws.lexiconSchemas();
for (const s of schemas) {
  console.log(`${s.entity_type}: ${s.name}`);
}

// Filter by entity type
const eventSchemas = await ws.lexiconSchemas({ entity_type: "event" });
const profileSchemas = await ws.lexiconSchemas({ entity_type: "profile" });

// Get a specific schema
const schema = await ws.lexiconSchema("event", "Purchase");
console.log(schema.schema_json.description);
for (const [prop, info] of Object.entries(schema.schema_json.properties)) {
  console.log(`  ${prop}: ${info.type}`);
}
```

### [LexiconSchema](/reference/core/classes/LexiconSchema)

```ts
s.entity_type; // "event", "profile", or other API-returned types
s.name; // "Purchase"
s.schema_json; // LexiconDefinition
```

### [LexiconDefinition](/reference/core/classes/LexiconDefinition)

```ts
s.schema_json.description; // "User completes a purchase"
s.schema_json.properties; // Record<string, LexiconProperty>
s.schema_json.metadata; // LexiconMetadata | null
```

### [LexiconProperty](/reference/core/classes/LexiconProperty)

```ts
const prop = s.schema_json.properties["amount"];
prop.type; // "number"
prop.description; // "Purchase amount in USD"
prop.metadata; // LexiconMetadata | null
```

### [LexiconMetadata](/reference/core/classes/LexiconMetadata)

```ts
const meta = s.schema_json.metadata;
meta.display_name; // "Purchase Event"
meta.tags; // ["core", "revenue"]
meta.hidden; // false
meta.dropped; // false
meta.contacts; // ["owner@company.com"]
meta.team_contacts; // ["Analytics Team"]
```

::: warning Rate Limit
The Lexicon API has a strict rate limit of **5 requests per minute**. Schema results are cached for the session to minimize API calls.
:::

::: tip Write Operations
The Lexicon schemas shown here are **read-only discovery** methods. For full CRUD operations on Lexicon definitions (update, delete events/properties, manage tags, bulk updates), see the [Data Governance guide](/guide/data-governance).
:::

## Schema Graph

`schemaGraph()` gathers the whole project's Lexicon in one pass — event definitions, event properties, and user properties — plus the event↔property relationship graph (which properties appear on which events). It returns a typed `SchemaGraphResult` with row views and a plain adjacency export, so you can map the schema without a per-entity lookup.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
// ---cut---
const schema = await ws.schemaGraph();

schema.toEventsRows(); // event definitions (name, display_name, count, ...)
schema.toPropertiesRows(); // event + user properties, with a resource_type column
schema.toRelationshipsRows(); // one row per (event, property) edge — the headline view

schema.propertiesForEvent("Purchase"); // ['amount', 'currency', ...]
schema.eventsForProperty("utm_source"); // events carrying the property
schema.orphanProperties(); // event properties that appear on no events

const graph = schema.toGraph(); // { nodes, edges }: events -> properties
graph.nodes.find((n) => n.name === "Purchase")?.kind; // "event"
graph.edges.filter((e) => e.source === "Purchase").map((e) => e.target);
```

Python returns a `networkx.DiGraph` from `to_graph()`; the port has no graph library, so `toGraph()` hands back the adjacency it is built from — `nodes` (`{ name, kind }`, in insertion order) and `edges` (`{ source, target, density_local }`, one per unique pair). Successors of an event are `edges.filter((e) => e.source === event)`.

The relationships come from the query API's per-event properties gather — one pass for the whole project rather than a schema lookup per entity; on very large projects it can still take minutes. Group properties are not gathered (headless has no data-groups listing to enumerate them).

### [SchemaGraphResult](/reference/core/classes/SchemaGraphResult)

```ts
schema.events; // raw event definitions
schema.properties; // event properties (each carries an `events` list)
schema.user_properties; // user properties
schema.event_to_properties; // { [event]: [property, ...] }
schema.property_to_events; // { [property]: [event, ...] }
schema.toRelationshipsRows(); // rows: event | property | density_local
schema.relationshipsRowColumns(); // ["event", "property", "density_local"]
schema.meta; // counts and dropped-entry tallies
schema.toGraph(); // { nodes, edges }
schema.toJSON(); // JSON-serializable
```

Options: `include_density: true` requests the per-property `densityLocal` (repeated onto each edge); `include_user_properties: false` skips the user-property gather.

::: info Caching
Like other discovery methods, `schemaGraph()` is cached for the lifetime of the Workspace, per `(include_density, include_user_properties)`. Pass `force_refresh: true` to re-fetch, or call `clearDiscoveryCache()`.
:::

## Top Events

Get today's most active events:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
// ---cut---
// General top events
const top = await ws.topEvents({ type: "general" });
for (const event of top) {
  const sign = event.percent_change >= 0 ? "+" : "";
  console.log(
    `${event.event}: ${event.count} (${sign}${event.percent_change.toFixed(1)}%)`,
  );
}

// Average top events, capped
const avg = await ws.topEvents({ type: "average", limit: 5 });
```

### [TopEvent](/reference/core/classes/TopEvent)

```ts
event.event; // "Login"
event.count; // 15000
event.percent_change; // 12.5 (compared to yesterday)
```

::: info Not Cached
Unlike other discovery methods, `topEvents()` always makes an API call since it returns real-time data.
:::

## Caching

Discovery results are cached for the lifetime of the Workspace:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

// First call hits the API
const events1 = await ws.events();

// Second call returns the cached result (instant)
const events2 = await ws.events();

// Clear the cache to force a refresh
await ws.clearDiscoveryCache();

// Now hits the API again
const events3 = await ws.events();
```

The cache key includes the call's options, so `ws.propertyValues("plan")` and `ws.propertyValues("plan", { limit: 5 })` are separate entries.

## Discovery Workflow

A typical discovery workflow before analysis:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

// 1. What events exist?
console.log("Events:");
for (const event of (await ws.events()).slice(0, 10)) {
  console.log(`  - ${event}`);
}

// 2. What properties does Purchase have?
console.log("\nPurchase properties:");
for (const prop of await ws.properties("Purchase")) {
  console.log(`  - ${prop}`);
}

// 3. What values does 'country' have?
console.log("\nCountry values:");
for (const value of await ws.propertyValues("country", {
  event: "Purchase",
  limit: 10,
})) {
  console.log(`  - ${value}`);
}

// 4. What funnels are defined?
console.log("\nFunnels:");
for (const f of await ws.funnels()) {
  console.log(`  - ${f.name} (ID: ${f.funnel_id})`);
}

// 5. Run a live query with the discovered data
const result = await ws.segmentation("Purchase", {
  from_date: "2025-01-01",
  to_date: "2025-01-31",
  on: "country",
});
console.table(result.toRows());
```

## Next Steps

- [Live Analytics](/guide/live-analytics) — Segmentation, funnels, retention and the activity feed
- [Streaming Data](/guide/streaming) — Stream events and profiles
- [API Reference](/api/) — Complete API documentation; every method on this page is a member of [`Workspace`](/reference/core/classes/Workspace)
- Option bags: [`WorkspaceEventsOptions`](/reference/core/interfaces/WorkspaceEventsOptions), [`WorkspacePropertyValuesOptions`](/reference/core/interfaces/WorkspacePropertyValuesOptions), [`WorkspaceSubpropertiesOptions`](/reference/core/interfaces/WorkspaceSubpropertiesOptions), [`WorkspaceTopEventsOptions`](/reference/core/interfaces/WorkspaceTopEventsOptions), [`WorkspaceLexiconSchemasOptions`](/reference/core/interfaces/WorkspaceLexiconSchemasOptions), [`WorkspaceSchemaGraphOptions`](/reference/core/interfaces/WorkspaceSchemaGraphOptions)
