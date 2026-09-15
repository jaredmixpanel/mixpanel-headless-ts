---
title: Data governance
description: Manage Mixpanel data governance programmatically - Lexicon definitions (events, properties, tags), drop filters, custom properties, custom events, lookup tables, schema registry, schema enforcement, data auditing, volume anomalies, and event deletion requests.
---

# Data governance

Manage Mixpanel data governance programmatically: Lexicon definitions (events, properties, tags), drop filters, custom properties, custom events, lookup tables, schema registry, schema enforcement, data auditing, volume anomalies, and event deletion requests. Full CRUD operations with bulk support.

::: info Prerequisites
Data governance requires **authentication** — service account or OAuth credentials.

All data governance operations require a **workspace ID** — set via the `MP_WORKSPACE_ID` env var, `createNodeWorkspace({ workspace: N })`, or `ws.use({ workspace: N })`. List the available workspaces with `ws.workspaces()`.
:::

::: tip Read-only discovery
For read-only Lexicon schema exploration (listing events/properties with descriptions and metadata), see [Discovery](/guide/discovery). This guide covers **write operations**: creating, updating, and deleting definitions.
:::

The request and response models follow the same conventions as the other App API entities — `new XParams({ ... })` constructors, `snake_case` fields, `toJSON()` / `modelDumpExcludeNone()` serialisation. See [How the models work](/guide/entity-management#how-the-models-work).

## Lexicon — event definitions

### Get event definitions

`names` is required; the call returns one `EventDefinition` per matched name.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

// Get definitions for specific events
const defs = await ws.getEventDefinitions({ names: ["Signup", "Login"] });
for (const d of defs) {
  console.log(`${d.name}: ${d.description ?? ""}`);
  console.log(`  hidden=${String(d.hidden)}, verified=${String(d.verified)}`);
  console.log(`  tags=${(d.tags ?? []).join(", ")}`);
}
```

### Update an event definition

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { UpdateEventDefinitionParams } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

const definition = await ws.updateEventDefinition(
  "Signup",
  new UpdateEventDefinitionParams({
    description: "User signed up for an account",
    verified: true,
    tags: ["core", "acquisition"],
  }),
);
console.log(`Updated: ${definition.name}`);
```

The updatable fields are `hidden`, `dropped`, `merged`, `verified`, `tags`, `display_name` and `description`.

### Delete an event definition

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

await ws.deleteEventDefinition("OldEvent");
```

### Bulk update event definitions

Update multiple event definitions in a single API call:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import {
  BulkEventUpdate,
  BulkUpdateEventsParams,
} from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

const results = await ws.bulkUpdateEventDefinitions(
  new BulkUpdateEventsParams({
    events: [
      new BulkEventUpdate({ name: "OldEvent", hidden: true }),
      new BulkEventUpdate({ name: "NewEvent", verified: true }),
      new BulkEventUpdate({
        name: "Purchase",
        display_name: "Completed purchase",
        tags: ["revenue"],
      }),
    ],
  }),
);
for (const d of results) {
  console.log(
    `${d.name}: hidden=${String(d.hidden)}, verified=${String(d.verified)}`,
  );
}
```

---

## Lexicon — property definitions

### Get property definitions

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

// Get property definitions by name
const defs = await ws.getPropertyDefinitions({
  names: ["plan_type", "country"],
  resource_type: "event", // "event", "user", or "groupprofile"
});
for (const d of defs) {
  console.log(`${d.name} (${d.resource_type ?? "?"}): ${d.description ?? ""}`);
  console.log(`  sensitive=${String(d.sensitive)}, hidden=${String(d.hidden)}`);
}
```

### Update a property definition

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { UpdatePropertyDefinitionParams } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

const definition = await ws.updatePropertyDefinition(
  "plan_type",
  new UpdatePropertyDefinitionParams({
    description: "User subscription tier",
    sensitive: false,
  }),
);
console.log(definition.name);
```

### Bulk update property definitions

Each `BulkPropertyUpdate` names its `resource_type` as `"Event"` or `"User"` (capitalised — this is what the bulk endpoint expects, unlike the lowercase filter values above).

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import {
  BulkPropertyUpdate,
  BulkUpdatePropertiesParams,
} from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

const results = await ws.bulkUpdatePropertyDefinitions(
  new BulkUpdatePropertiesParams({
    properties: [
      new BulkPropertyUpdate({
        name: "email",
        resource_type: "User",
        sensitive: true,
      }),
      new BulkPropertyUpdate({
        name: "country",
        resource_type: "Event",
        display_name: "User country code",
      }),
    ],
  }),
);
console.log(results.length);
```

---

## Lexicon — tags

Organize event and property definitions with tags.

### List tags

The list endpoint may return plain tag-name strings without IDs; those entries come back with `id` set to `0`. Don't pass that sentinel to `updateLexiconTag` — use the name-based `deleteLexiconTag` for such tags.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

const tags = await ws.listLexiconTags();
for (const tag of tags) {
  console.log(`${String(tag.id)}: ${tag.name}`);
}
```

### Create a tag

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { CreateTagParams } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

const tag = await ws.createLexiconTag(
  new CreateTagParams({ name: "core-events" }),
);
console.log(`Created tag ${String(tag.id)}: ${tag.name}`);
```

### Update a tag

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { UpdateTagParams } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

const tag = await ws.updateLexiconTag(
  5,
  new UpdateTagParams({ name: "renamed-tag" }),
);
console.log(tag.name);
```

### Delete a tag

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

await ws.deleteLexiconTag("deprecated-tag");
```

---

## Lexicon — tracking & history

These endpoints return raw records (`Record<string, unknown>`), exactly as the API sends them.

### Tracking metadata

Get tracking metadata for an event (sources, SDKs, volume):

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

const metadata = await ws.getTrackingMetadata("Signup");
console.log(metadata); // Raw tracking metadata record
```

### Event history

View the change history for an event definition:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

const history = await ws.getEventHistory("Signup");
for (const entry of history) {
  console.log(entry); // Chronological list of changes
}
```

### Property history

View the change history for a property definition. The entity type (`"event"`, `"user"`, `"group"`, …) is the second positional argument.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

const history = await ws.getPropertyHistory("plan_type", "event");
for (const entry of history) {
  console.log(entry);
}
```

### Export Lexicon

Export all Lexicon data definitions:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

const exported = await ws.exportLexicon();
console.log(exported); // Raw export record

// Filter by type
const events = await ws.exportLexicon({
  export_types: ["events", "event_properties"],
});
console.log(events);
```

---

## Drop filters

Drop filters suppress events at ingestion time, preventing them from being stored or counted. Every mutation returns the **full list** of drop filters after the change.

### List drop filters

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

const filters = await ws.listDropFilters();
for (const f of filters) {
  console.log(`${String(f.id)}: ${f.event_name} (active=${String(f.active)})`);
}
```

### Create a drop filter

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { CreateDropFilterParams } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

const filters = await ws.createDropFilter(
  new CreateDropFilterParams({
    event_name: "Debug Event",
    filters: { property: "env", value: "test" },
  }),
);
// Returns the full list of drop filters after creation
console.log(filters.length);
```

### Update a drop filter

The filter ID travels inside the params model.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { UpdateDropFilterParams } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

const filters = await ws.updateDropFilter(
  new UpdateDropFilterParams({
    id: 42,
    event_name: "Debug Event v2",
    active: false,
  }),
);
console.log(filters.length);
```

### Delete a drop filter

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

const remaining = await ws.deleteDropFilter(42);
// Returns the full list of remaining drop filters
console.log(remaining.length);
```

### Drop filter limits

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

const limits = await ws.getDropFilterLimits();
console.log(`Drop filter limit: ${String(limits.filter_limit)}`);
```

---

## Custom properties

Custom properties are computed properties defined by formulas or behaviors. They calculate values dynamically from existing event or profile properties. Custom properties use **string IDs**.

::: warning PUT semantics
Custom property `update` uses **full replacement** (PUT semantics). The `resource_type` and `data_group_id` fields are immutable after creation — `UpdateCustomPropertyParams` does not accept them.
:::

### List custom properties

A 400 whose body names `displayFormula` means the project holds a corrupt custom property; the port re-raises it as a `QueryError` with a message pointing at `getCustomProperty`.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

const props = await ws.listCustomProperties();
for (const p of props) {
  console.log(`${p.name}: ${p.display_formula ?? ""}`);
}
```

### Get a custom property

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

const prop = await ws.getCustomProperty("abc123");
console.log(`${prop.name}: ${prop.display_formula ?? ""}`);
console.log(`  resource_type=${prop.resource_type}`);
```

### Create a custom property

Custom properties can be formula-based or behavior-based. `resource_type` is one of `"events"`, `"people"` or `"group_profiles"` (the `CustomPropertyResourceType` constant names them).

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import {
  ComposedPropertyValue,
  CreateCustomPropertyParams,
} from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

// Formula-based custom property
const prop = await ws.createCustomProperty(
  new CreateCustomPropertyParams({
    name: "Full Name",
    resource_type: "events",
    display_formula: 'concat(properties["first"], " ", properties["last"])',
    composed_properties: {
      first: new ComposedPropertyValue({ resource_type: "event" }),
      last: new ComposedPropertyValue({ resource_type: "event" }),
    },
  }),
);
console.log(`Created: ${prop.name} (ID: ${String(prop.custom_property_id)})`);
```

::: info Formula vs behavior
`display_formula` and `behavior` are mutually exclusive. If using `display_formula`, you must also provide `composed_properties` that map the referenced properties.
:::

### Update a custom property

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { UpdateCustomPropertyParams } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

const prop = await ws.updateCustomProperty(
  "abc123",
  new UpdateCustomPropertyParams({ name: "Renamed Property" }),
);
console.log(prop.name);
```

### Delete a custom property

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

await ws.deleteCustomProperty("abc123");
```

### Validate a custom property

Check whether a custom property definition is valid before creating it:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import {
  ComposedPropertyValue,
  CreateCustomPropertyParams,
} from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

const result = await ws.validateCustomProperty(
  new CreateCustomPropertyParams({
    name: "Revenue Per User",
    resource_type: "events",
    display_formula: 'number(properties["amount"])',
    composed_properties: {
      amount: new ComposedPropertyValue({ resource_type: "event" }),
    },
  }),
);
console.log(result); // Raw validation result record
```

---

## Custom events

Custom events are composite aliases that group one or more underlying events under a single display name. They appear alongside regular events in queries and dashboards but resolve to the union of their underlying events at query time.

The `/custom_events/` endpoint (used by `createCustomEvent`) returns the typed `CustomEvent` model — distinct from `EventDefinition`, which is the Lexicon (governance) view returned by `listCustomEvents`, `updateCustomEvent`, and the rest of the `/data-definitions/events/` family.

### List custom events

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

const events = await ws.listCustomEvents();
for (const e of events) {
  console.log(
    `${e.name} (custom_event_id=${String(e.custom_event_id)}): ${e.description ?? ""}`,
  );
}
```

### Create a custom event

Create a new custom event by giving it a display name and the list of underlying event names it should alias. The `alternatives` field accepts bare event names (strings) and is serialized internally to the format the Mixpanel API expects; it must be non-empty and free of duplicates.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { CreateCustomEventParams } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

const ce = await ws.createCustomEvent(
  new CreateCustomEventParams({
    name: "Page View",
    alternatives: ["Home Viewed", "Product Viewed", "Checkout Viewed"],
  }),
);
console.log(
  ce.id,
  ce.name,
  ce.alternatives.map((a) => a.event),
);
```

### Update a custom event

Identify the custom event by its `custom_event_id` (returned as `id` by `createCustomEvent`, or available as `custom_event_id` on entries from `listCustomEvents`). Updating by name alone would create an orphan Lexicon entry — the Mixpanel API needs the ID to disambiguate.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import {
  CreateCustomEventParams,
  UpdateEventDefinitionParams,
} from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

const ce = await ws.createCustomEvent(
  new CreateCustomEventParams({
    name: "My Custom Event",
    alternatives: ["Foo"],
  }),
);
const event = await ws.updateCustomEvent(
  ce.id,
  new UpdateEventDefinitionParams({
    description: "Updated description",
    verified: true,
  }),
);
console.log(event.description);
```

### Delete a custom event

Identify the custom event by its `custom_event_id` for the same reason as `updateCustomEvent` — a name-only DELETE against the data-definitions endpoint is ambiguous when display names collide and may delete the wrong row, an orphan Lexicon entry, or no-op silently while reporting success.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

await ws.deleteCustomEvent(2044168);
```

---

## Lookup tables

Lookup tables are CSV-based reference data used to enrich event and profile properties. Upload a CSV, and Mixpanel maps its columns to properties for real-time enrichment.

::: info Large IDs
A lookup table's `id` / `data_group_id` is a signed 64-bit integer. The port gives you a `number` when the value is a safe integer and a `bigint` beyond 2<sup>53</sup> (Mixpanel assigns IDs such as `-8644926364725811123n`). Every method that takes a data group ID accepts `number | bigint`; a `number` beyond `Number.MAX_SAFE_INTEGER` is rejected up front (it has already been rounded — pass a `bigint`).
:::

### List lookup tables

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

const tables = await ws.listLookupTables();
for (const t of tables) {
  console.log(
    `${t.name} (ID: ${String(t.id)}, mapped=${String(t.has_mapped_properties)})`,
  );
}

// Filter by data group
const some = await ws.listLookupTables({ data_group_id: 123 });
console.log(some.length);
```

### Upload a lookup table

::: info 3-step upload process
`uploadLookupTable()` handles the full workflow automatically:

1. Obtains a signed upload URL from the API
2. Uploads the CSV file to the signed URL
3. Registers the lookup table

For files >= 5 MB, processing is asynchronous. The method automatically polls for completion with a configurable timeout (`poll_interval` / `max_poll_seconds`, both in seconds; defaults `2` / `300`).
:::

::: warning Node.js only
`uploadLookupTable` reads the CSV through the `readFile` seam that `createNodeWorkspace()` wires from `node:fs`. A bare `new Workspace(...)` from `@mixpanel-headless/core` needs `readFile` injected in its options, and the browser package does not offer this method.
:::

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { UploadLookupTableParams } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

const table = await ws.uploadLookupTable(
  new UploadLookupTableParams({
    name: "Country Codes",
    file_path: "/path/to/countries.csv",
  }),
  {
    poll_interval: 2, // Seconds between polls (async only)
    max_poll_seconds: 300, // Max wait time (async only)
  },
);
console.log(`Created: ${table.name} (ID: ${String(table.id)})`);

// Replace an existing lookup table
const replaced = await ws.uploadLookupTable(
  new UploadLookupTableParams({
    name: "Country Codes",
    file_path: "/path/to/countries_v2.csv",
    data_group_id: 456, // Existing table's data group ID
  }),
);
console.log(replaced.last_modified_at);
```

### Update a lookup table

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { UpdateLookupTableParams } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

const table = await ws.updateLookupTable(
  123, // data group ID (number | bigint)
  new UpdateLookupTableParams({ name: "Renamed Table" }),
);
console.log(table.name);
```

### Delete lookup tables

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

// Delete one or more lookup tables by data group ID
await ws.deleteLookupTables([123, 456]);
```

### Download a lookup table

`downloadLookupTable` returns the raw CSV as a `Uint8Array`.

```ts twoslash
import { writeFile } from "node:fs/promises";
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

// Download as raw CSV bytes
const csv = await ws.downloadLookupTable(123);

// Save to file
await writeFile("output.csv", csv);

// Download with a row limit
const sample = await ws.downloadLookupTable(123, { limit: 100 });
console.log(new TextDecoder().decode(sample));
```

### Advanced: upload and download URLs

For manual upload workflows or integration with external tools:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

// Get a signed upload URL (content type defaults to "text/csv")
const urlInfo = await ws.getLookupUploadUrl("text/csv");
console.log(urlInfo.url); // Signed GCS URL
console.log(urlInfo.key); // Pass to markLookupTableReady after uploading

// Check async upload status (raw record)
const status = await ws.getLookupUploadStatus("upload-id-123");
console.log(status);

// Get a signed download URL
const downloadUrl = await ws.getLookupDownloadUrl(123);
console.log(downloadUrl);
```

After uploading to the signed URL yourself, register the table with `markLookupTableReady`:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { MarkLookupTableReadyParams } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

const urlInfo = await ws.getLookupUploadUrl();
// … PUT the CSV bytes to urlInfo.url …
const table = await ws.markLookupTableReady(
  new MarkLookupTableReadyParams({ name: "Country Codes", key: urlInfo.key }),
);
console.log(table.id);
```

---

## Schema registry

Manage JSON Schema Draft 7 definitions in Mixpanel's schema registry. Schemas define the expected structure of events, custom events, and profiles.

### List schema entries

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

// List all schemas
const schemas = await ws.listSchemaRegistry();
for (const s of schemas) {
  console.log(`${s.entity_type}/${s.name}: v${s.version ?? "?"}`);
}

// Filter by entity type ("event", "custom_event", "profile")
const eventSchemas = await ws.listSchemaRegistry({ entity_type: "event" });
console.log(eventSchemas.length);
```

### Create a schema

`createSchema` takes the entity type, the entity name (an event name, or `"$user"` for profiles) and the JSON Schema as positional arguments; the created schema is returned verbatim.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

const result = await ws.createSchema("event", "Purchase", {
  properties: {
    amount: { type: "number" },
    currency: { type: "string" },
  },
  required: ["amount"],
});
console.log(result);
```

### Bulk create schemas

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { BulkCreateSchemasParams, SchemaEntry } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

const params = new BulkCreateSchemasParams({
  entries: [
    new SchemaEntry({
      name: "Login",
      entity_type: "event",
      schema_definition: { properties: { method: { type: "string" } } },
    }),
    new SchemaEntry({
      name: "Signup",
      entity_type: "event",
      schema_definition: { properties: { source: { type: "string" } } },
    }),
  ],
  truncate: false, // true replaces every existing schema of this type
  entity_type: "event",
});
const result = await ws.createSchemasBulk(params);
console.log(
  `Added: ${String(result.added)}, Deleted: ${String(result.deleted)}`,
);
```

### Update a schema (merge semantics)

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

const result = await ws.updateSchema("event", "Purchase", {
  properties: {
    discount_code: { type: "string" },
  },
});
console.log(result);
```

### Bulk update schemas

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { BulkCreateSchemasParams, SchemaEntry } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

const params = new BulkCreateSchemasParams({
  entries: [
    new SchemaEntry({
      name: "Login",
      entity_type: "event",
      schema_definition: { properties: { ip_address: { type: "string" } } },
    }),
  ],
  entity_type: "event",
});
const results = await ws.updateSchemasBulk(params);
for (const r of results) {
  console.log(`${r.name}: ${r.status}`); // "ok" or "error"
}
```

### Delete schemas

::: warning Destructive operation
Schema deletion is irreversible. With both filters a single schema is deleted; with `entity_type` alone every schema of that type; with neither, **every schema in the project**.
:::

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

// Delete a specific schema
const result = await ws.deleteSchemas({
  entity_type: "event",
  entity_name: "Purchase",
});
console.log(`Deleted: ${String(result.delete_count)}`);

// Delete all schemas of a type
const all = await ws.deleteSchemas({ entity_type: "event" });
console.log(all.delete_count);
```

---

## Schema enforcement

Configure how Mixpanel handles events that don't match defined schemas. Enforcement actions include "Warn and Accept", "Warn and Hide", and "Warn and Drop". The init/update/replace/delete calls return the raw API response.

### Get enforcement settings

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

const config = await ws.getSchemaEnforcement();
console.log(`State: ${config.state ?? "?"}`);
console.log(`Rule: ${config.rule_event ?? "?"}`);

// Get specific fields only
const partial = await ws.getSchemaEnforcement({ fields: "state,ruleEvent" });
console.log(partial.state);
```

### Initialize enforcement

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { InitSchemaEnforcementParams } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

const result = await ws.initSchemaEnforcement(
  new InitSchemaEnforcementParams({ rule_event: "Warn and Accept" }),
);
console.log(result);
```

### Update enforcement (PATCH)

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { UpdateSchemaEnforcementParams } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

const result = await ws.updateSchemaEnforcement(
  new UpdateSchemaEnforcementParams({
    rule_event: "Warn and Drop",
    notification_emails: ["data-team@example.com"],
  }),
);
console.log(result);
```

### Replace enforcement (PUT)

::: warning Full replacement
PUT semantics replace the entire enforcement configuration. All fields must be provided — `ReplaceSchemaEnforcementParams` requires them.
:::

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { ReplaceSchemaEnforcementParams } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

const result = await ws.replaceSchemaEnforcement(
  new ReplaceSchemaEnforcementParams({
    events: [],
    common_properties: [],
    user_properties: [],
    rule_event: "Warn and Hide",
    notification_emails: ["admin@example.com"],
  }),
);
console.log(result);
```

### Delete enforcement

::: warning Destructive operation
Deleting the enforcement configuration is irreversible.
:::

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

const result = await ws.deleteSchemaEnforcement();
console.log(result);
```

---

## Data auditing

Audit your project's data against defined schemas to find violations such as unexpected events, missing properties, or type mismatches. Each `AuditViolation` carries the `violation` kind, the offending `name`, a `count`, and — for property violations — the parent `event` and any `property_type_error`.

### Run full audit

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

const audit = await ws.runAudit();
console.log(`Computed at: ${audit.computed_at}`);
for (const v of audit.violations) {
  console.log(`  [${v.violation}] ${v.name}: ${String(v.count)}`);
  if (v.event) {
    console.log(`    on event ${v.event} ${v.property_type_error ?? ""}`);
  }
}
```

### Run events-only audit

A faster variant that only audits event schemas, skipping property-level checks.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

const audit = await ws.runAuditEventsOnly();
for (const v of audit.violations) {
  console.log(`  ${v.name}: ${v.violation}`);
}
```

::: info Divergence
When the audit metadata carries `computed_at: null`, the port raises `ResponseValidationError` (`code: "RESPONSE_VALIDATION_ERROR"`) where Python leaks a bare Pydantic validation error.
:::

---

## Data volume anomalies

Monitor and manage anomalies detected in data volume patterns. Anomalies indicate unexpected spikes or drops that may signal tracking issues or data pipeline problems.

### List anomalies

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

// List all anomalies
const anomalies = await ws.listDataVolumeAnomalies();
for (const a of anomalies) {
  console.log(
    `${a.event_name ?? "?"}: ${a.status} (variance: ${a.percent_variance})`,
  );
}

// Filter with raw query params (status, limit, event_id, …)
const open = await ws.listDataVolumeAnomalies({
  query_params: { status: "open" },
});
console.log(open.length);
```

### Update an anomaly

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { UpdateAnomalyParams } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

const result = await ws.updateAnomaly(
  new UpdateAnomalyParams({
    id: 123,
    status: "dismissed",
    anomaly_class: "Event",
  }),
);
console.log(result);
```

### Bulk update anomalies

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import {
  BulkAnomalyEntry,
  BulkUpdateAnomalyParams,
} from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

const result = await ws.bulkUpdateAnomalies(
  new BulkUpdateAnomalyParams({
    anomalies: [
      new BulkAnomalyEntry({ id: 1, anomaly_class: "Event" }),
      new BulkAnomalyEntry({ id: 2, anomaly_class: "Event" }),
    ],
    status: "dismissed",
  }),
);
console.log(result);
```

---

## Event deletion requests

Submit and manage requests to delete event data by event name, date range, and optional property filters.

::: danger Destructive operation
Event deletion is irreversible. Use `previewDeletionFilters` to validate filters before creating a deletion request.
:::

### List deletion requests

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

const requests = await ws.listDeletionRequests();
for (const r of requests) {
  console.log(`#${String(r.id)}: ${r.event_name} (${r.status})`);
}
```

### Preview deletion filters

Preview what events would be affected before submitting a deletion request. This is a read-only operation with no side effects.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { PreviewDeletionFiltersParams } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

const preview = await ws.previewDeletionFilters(
  new PreviewDeletionFiltersParams({
    event_name: "Test Event",
    from_date: "2026-01-01",
    to_date: "2026-01-31",
  }),
);
for (const item of preview) {
  console.log(item);
}
```

### Create a deletion request

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { CreateDeletionRequestParams } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

const result = await ws.createDeletionRequest(
  new CreateDeletionRequestParams({
    event_name: "Test Event",
    from_date: "2026-01-01",
    to_date: "2026-01-31",
  }),
);
// Returns the updated list of all deletion requests
for (const r of result) {
  console.log(`#${String(r.id)}: ${r.status}`);
}
```

### Cancel a deletion request

Only pending requests can be cancelled.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

const result = await ws.cancelDeletionRequest(456);
console.log(result.length);
```

---

## Next steps

- [Entity management](/guide/entity-management) — dashboards, reports, cohorts, feature flags, experiments, alerts, annotations, and webhooks
- [Discovery](/guide/discovery) — read-only Lexicon schema exploration
- [Error handling](/guide/error-handling) — the error hierarchy and stable `code` values
- [API overview](/api/index) — packages, entry points and the naming rules
