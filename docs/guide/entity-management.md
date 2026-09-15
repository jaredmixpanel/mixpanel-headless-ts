---
title: Entity management
description: Manage Mixpanel dashboards, reports (bookmarks), cohorts, feature flags, experiments, alerts, annotations, and webhooks programmatically. Full CRUD operations with bulk support.
---

# Entity management

Manage Mixpanel dashboards, reports (bookmarks), cohorts, feature flags, experiments, alerts, annotations, and webhooks programmatically. Full CRUD operations with bulk support. For data governance operations (Lexicon definitions, drop filters, custom properties, custom events, lookup tables, schemas), see the [Data governance guide](/guide/data-governance).

::: info Prerequisites
Entity management requires **authentication** — service account or OAuth credentials.

**Scoping differs by entity type:**

- **Dashboards, reports, cohorts, alerts, annotations, webhooks** require a **workspace ID** — set via the `MP_WORKSPACE_ID` env var, `createNodeWorkspace({ workspace: N })`, or `ws.use({ workspace: N })`. List the available workspaces with `ws.workspaces()`.
- **Feature flags and experiments** are **project-scoped** and do NOT require a workspace ID.

See [Accounts, sessions and targets](/guide/accounts-sessions-targets) for the full resolution chain.
:::

## How the models work

Every App API request and response is a typed model class exported from `@mixpanel-headless/core`. The conventions are the same across all the entities on this page:

- **Request models** are constructed with `new CreateXParams({ ... })` / `new UpdateXParams({ ... })`. The constructor validates required fields, coerces scalars and rejects unknown keys the way the Python Pydantic models do, so a bad request fails before any network call.
- **Field names stay `snake_case`** — they mirror the Python models and the wire (`bookmark_type`, `is_enabled`, `data_group_id`). Method names are `camelCase`.
- **Response models** are read-only class instances (`Dashboard`, `Bookmark`, `Cohort`, …). Fields Python types as `Optional` come back as `null`, not `undefined`.
- **Serialisation:** `model.toJSON()` returns the plain field dictionary; `model.modelDumpExcludeNone()` is Pydantic's `model_dump(exclude_none=True)` (the request-body dump every create/update call performs internally) and `model.modelDump({ byAlias: true })` emits the wire aliases. `X.fromDict(raw)` rebuilds a model from a plain object.
- **Partial updates:** most `update*` calls have PATCH semantics — pass only the fields you want to change and everything else is left alone. The exception is `updateFeatureFlag`, which is a full replacement (PUT); see [Feature flags](#feature-flags).
- **IDs:** dashboards, reports, cohorts, alerts and annotations use positive integer IDs; feature flags, experiments and webhooks use UUID strings. Integer-ID methods reject a zero, negative or non-integer ID up front with a `ParamValidationError` (`code: "RL6_INVALID_ID"`) before any request is made.

```ts twoslash
import { CreateCohortParams } from "@mixpanel-headless/core";

const params = new CreateCohortParams({
  name: "Power Users",
  description: "Users with 10+ sessions in the last 30 days",
});

console.log(params.toJSON());
// { definition: null, name: "Power Users", description: "…", data_group_id: null, … }
console.log(params.modelDumpExcludeNone());
// { name: "Power Users", description: "…" }
```

## Dashboards

### List dashboards

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

// List all dashboards
const dashboards = await ws.listDashboards();
for (const d of dashboards) {
  console.log(`${String(d.id)}: ${d.title}`);
}

// Filter by specific IDs
const some = await ws.listDashboards({ ids: [123, 456] });
console.log(some.length);
```

### Create a dashboard

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { CreateDashboardParams } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

const newDash = await ws.createDashboard(
  new CreateDashboardParams({
    title: "Q1 Metrics",
    description: "Quarterly performance overview",
  }),
);
console.log(`Created dashboard ${String(newDash.id)}: ${newDash.title}`);
```

### Get, update, delete

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { UpdateDashboardParams } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

// Get a dashboard by ID
const dash = await ws.getDashboard(123);
console.log(dash.title);

// Update (PATCH — only the fields you pass)
const updated = await ws.updateDashboard(
  123,
  new UpdateDashboardParams({
    title: "Q1 Metrics (Updated)",
    description: "Revised quarterly overview",
  }),
);
console.log(updated.modified);

// Delete
await ws.deleteDashboard(123);

// Bulk delete
await ws.bulkDeleteDashboards([123, 456, 789]);
```

### Favorites and pins

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

await ws.favoriteDashboard(123);
await ws.unfavoriteDashboard(123);

await ws.pinDashboard(123);
await ws.unpinDashboard(123);
```

### Add a report to a dashboard

`addReportToDashboard` clones the bookmark onto the board and returns the updated `Dashboard`.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

const updatedDash = await ws.addReportToDashboard(123, 456); // dashboardId, bookmarkId
console.log(updatedDash.title);
```

### Remove a report from a dashboard

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

const updatedDash = await ws.removeReportFromDashboard(123, 456); // dashboardId, bookmarkId
console.log(updatedDash.title);
```

### Blueprint dashboards

Create dashboards from pre-built templates:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { BlueprintCard, BlueprintFinishParams } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

// List available templates
const templates = await ws.listBlueprintTemplates();
for (const t of templates) {
  console.log(`${t.title_key}: ${String(t.number_of_reports)} reports`);
}

// Create from template
const dash = await ws.createBlueprint("product_analytics");

// Inspect the template variables, then finalize with cards
const config = await ws.getBlueprintConfig(dash.id);
console.log(config.variables);

await ws.finalizeBlueprint(
  new BlueprintFinishParams({
    dashboard_id: dash.id,
    cards: [new BlueprintCard({ card_type: "text", markdown: "## Overview" })],
  }),
);
```

### Advanced dashboard operations

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import {
  CreateRcaDashboardParams,
  RcaSourceData,
  UpdateReportLinkParams,
  UpdateTextCardParams,
} from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

// Create an RCA (Root Cause Analysis) dashboard
const rcaDash = await ws.createRcaDashboard(
  new CreateRcaDashboardParams({
    rca_source_id: 123,
    rca_source_data: new RcaSourceData({ source_type: "metric" }),
  }),
);
console.log(rcaDash.id);

// Get ERF metrics (raw record)
const erf = await ws.getDashboardErf(123);
console.log(erf);

// Update dashboard components
await ws.updateReportLink(
  123, // dashboardId
  456, // reportLinkId
  new UpdateReportLinkParams({ link_type: "embedded" }),
);
await ws.updateTextCard(
  123, // dashboardId
  789, // textCardId
  new UpdateTextCardParams({ markdown: "## Updated Header" }),
);
```

---

## Reports (bookmarks)

Reports in Mixpanel are stored as "bookmarks". Each bookmark has a type (`insights`, `funnels`, `flows`, `retention`, `user`) and a `params` JSON object defining the query.

### List reports

`listBookmarksV2` is the App API listing that returns full `Bookmark` models. (The discovery helper `ws.listBookmarks()` returns lightweight `BookmarkInfo` summaries instead — see [Discovery](/guide/discovery).)

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

// List all reports
const reports = await ws.listBookmarksV2();

// Filter by type
const insights = await ws.listBookmarksV2({ bookmark_type: "insights" });
const funnels = await ws.listBookmarksV2({ bookmark_type: "funnels" });

// Filter by IDs
const specific = await ws.listBookmarksV2({ ids: [123, 456] });

for (const r of reports) {
  console.log(`${String(r.id)}: ${r.name} (${r.bookmark_type})`);
}
console.log(insights.length, funnels.length, specific.length);
```

### Create a report

The Mixpanel v2 API requires a `dashboard_id` on creation: the bookmark is stored and then placed on that dashboard in a second request. `params` is validated client-side against the bookmark schema before the call, so a malformed query raises `BookmarkValidationError` without touching the network. The easiest way to get well-formed params is to build them with the query engine.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { CreateBookmarkParams } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

const params = await ws.buildParams("Signup", { last: 30, unit: "day" });

const report = await ws.createBookmark(
  new CreateBookmarkParams({
    name: "Daily Signups",
    bookmark_type: "insights",
    description: "Track daily signup volume",
    params,
    dashboard_id: 123,
  }),
);
console.log(`Created report ${String(report.id)}: ${report.name}`);
```

### Get, update, delete

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import {
  BulkUpdateBookmarkEntry,
  UpdateBookmarkParams,
} from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

// Get
const report = await ws.getBookmark(123);
console.log(report.params);

// Update (PATCH)
const updated = await ws.updateBookmark(
  123,
  new UpdateBookmarkParams({
    name: "Daily Signups v2",
    description: "Updated tracking",
  }),
);
console.log(updated.name);

// Delete
await ws.deleteBookmark(123);

// Bulk operations
await ws.bulkDeleteBookmarks([123, 456]);
await ws.bulkUpdateBookmarks([
  new BulkUpdateBookmarkEntry({ id: 123, name: "Renamed Report" }),
  new BulkUpdateBookmarkEntry({ id: 456, description: "Updated desc" }),
]);
```

### Report history and dashboard links

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

// View change history
const history = await ws.getBookmarkHistory(123);
for (const entry of history.results) {
  console.log(entry);
}

// Paginate through history
const firstPage = await ws.getBookmarkHistory(123, { page_size: 10 });
const next = firstPage.pagination?.next_cursor;
if (next) {
  const nextPage = await ws.getBookmarkHistory(123, { cursor: next });
  console.log(nextPage.results.length);
}

// Find which dashboards contain this report
const dashboardIds = await ws.bookmarkLinkedDashboardIds(123);
console.log(dashboardIds);
```

---

## Cohorts

### List cohorts

`listCohortsFull` returns full `Cohort` models from the App API. (The discovery helper `ws.cohorts()` returns lightweight `SavedCohort` summaries.)

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

// List all cohorts
const cohorts = await ws.listCohortsFull();

// Filter by data group
const grouped = await ws.listCohortsFull({ data_group_id: "default" });

// Filter by IDs
const some = await ws.listCohortsFull({ ids: [123, 456] });

for (const c of cohorts) {
  console.log(`${String(c.id)}: ${c.name} (${String(c.count)} users)`);
}
console.log(grouped.length, some.length);
```

### Create a cohort

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { CreateCohortParams } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

const cohort = await ws.createCohort(
  new CreateCohortParams({
    name: "Power Users",
    description: "Users with 10+ sessions in last 30 days",
  }),
);
console.log(`Created cohort ${String(cohort.id)}: ${cohort.name}`);
```

### Get, update, delete

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import {
  BulkUpdateCohortEntry,
  UpdateCohortParams,
} from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

// Get
const cohort = await ws.getCohort(123);
console.log(cohort.count);

// Update (PATCH)
const updated = await ws.updateCohort(
  123,
  new UpdateCohortParams({
    name: "Super Users",
    description: "Updated criteria",
  }),
);
console.log(updated.name);

// Delete
await ws.deleteCohort(123);

// Bulk operations
await ws.bulkDeleteCohorts([123, 456]);
await ws.bulkUpdateCohorts([
  new BulkUpdateCohortEntry({ id: 123, name: "Renamed Cohort" }),
  new BulkUpdateCohortEntry({ id: 456, description: "Updated" }),
]);
```

---

## Feature flags

Feature flags are **project-scoped** — no workspace ID required. They use **UUID string IDs** (not integer IDs like dashboards/reports/cohorts).

::: warning PUT semantics
`updateFeatureFlag` uses **full replacement** (PUT semantics). All required fields (`name`, `key`, `status`, `ruleset`) must be provided on every update — even if you're only changing one field. `UpdateFeatureFlagParams` enforces this at the type level.
:::

### List feature flags

`status` is a plain string literal (`"enabled" | "disabled" | "archived"`); the `FeatureFlagStatus` constant object gives you the named members.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

// List all flags (excludes archived by default)
const flags = await ws.listFeatureFlags();
for (const f of flags) {
  console.log(`${f.name} (${f.key}): ${f.status}`);
}

// Include archived flags
const all = await ws.listFeatureFlags({ include_archived: true });
console.log(all.length);
```

### Create a feature flag

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { CreateFeatureFlagParams } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

const flag = await ws.createFeatureFlag(
  new CreateFeatureFlagParams({
    name: "Dark Mode",
    key: "dark_mode",
    description: "Enable dark mode UI",
    tags: ["ui", "frontend"],
  }),
);
console.log(`Created flag ${flag.id}: ${flag.key}`);
```

### Get, update, delete

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import {
  FeatureFlagStatus,
  UpdateFeatureFlagParams,
} from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

// Get a flag by UUID
const flag = await ws.getFeatureFlag("abc-123-uuid");

// Update (PUT — all required fields must be provided)
const updated = await ws.updateFeatureFlag(
  "abc-123-uuid",
  new UpdateFeatureFlagParams({
    name: "Dark Mode",
    key: "dark_mode",
    status: FeatureFlagStatus.ENABLED,
    ruleset: flag.ruleset, // Must provide the complete ruleset
  }),
);
console.log(updated.status);

// Delete
await ws.deleteFeatureFlag("abc-123-uuid");
```

### Archive, restore, duplicate

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

// Archive (soft-delete)
await ws.archiveFeatureFlag("abc-123-uuid");

// Restore an archived flag
const restored = await ws.restoreFeatureFlag("abc-123-uuid");

// Duplicate
const copy = await ws.duplicateFeatureFlag("abc-123-uuid");
console.log(restored.key, copy.key);
```

### Test users and history

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { SetTestUsersParams } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

// Assign test users to specific variants
await ws.setFlagTestUsers(
  "abc-123-uuid",
  new SetTestUsersParams({ users: { On: "user-1", Off: "user-2" } }),
);

// View change history (paginated)
const history = await ws.getFlagHistory("abc-123-uuid", { page_size: 50 });
console.log(`${String(history.count)} changes`);

// Check account limits
const limits = await ws.getFlagLimits();
console.log(
  `Using ${String(limits.current_usage)}/${String(limits.limit)} flags`,
);
```

---

## Experiments

Experiments are **project-scoped** — no workspace ID required. They have a distinct lifecycle with managed state transitions:

```
Draft → Active (launch) → Concluded (conclude) → Success/Fail (decide)
```

::: info PATCH semantics
`updateExperiment` uses **partial update** (PATCH semantics). Only provide the fields you want to change.
:::

### List experiments

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

const experiments = await ws.listExperiments();
for (const e of experiments) {
  console.log(`${e.name}: ${e.status ?? "unknown"}`);
}

// Include archived
const all = await ws.listExperiments({ include_archived: true });
console.log(all.length);
```

### Create an experiment

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { CreateExperimentParams } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

const exp = await ws.createExperiment(
  new CreateExperimentParams({
    name: "Checkout Flow Test",
    description: "Test simplified checkout",
    hypothesis: "Simpler checkout increases conversions by 10%",
  }),
);
console.log(`Created experiment ${exp.id}: ${exp.name}`);
```

### Get, update, delete

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { UpdateExperimentParams } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

// Get
const exp = await ws.getExperiment("xyz-456-uuid");
console.log(exp.hypothesis);

// Update (PATCH — only changed fields)
const updated = await ws.updateExperiment(
  "xyz-456-uuid",
  new UpdateExperimentParams({
    description: "Updated hypothesis and metrics",
  }),
);
console.log(updated.description);

// Delete
await ws.deleteExperiment("xyz-456-uuid");
```

### Experiment lifecycle

The key differentiator of experiments: a managed lifecycle with state transitions.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import {
  CreateExperimentParams,
  ExperimentConcludeParams,
  ExperimentDecideParams,
} from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

// 1. Create (starts in Draft)
const exp = await ws.createExperiment(
  new CreateExperimentParams({ name: "Pricing Page Test" }),
);

// 2. Launch (Draft → Active)
const launched = await ws.launchExperiment(exp.id);
console.log(launched.status); // "active"

// 3. Conclude (Active → Concluded)
await ws.concludeExperiment(exp.id);
// Or with an explicit end date:
const concluded = await ws.concludeExperiment(exp.id, {
  params: new ExperimentConcludeParams({ end_date: "2026-04-01" }),
});
console.log(concluded.end_date);

// 4. Decide (Concluded → Success or Fail)
const decided = await ws.decideExperiment(
  exp.id,
  new ExperimentDecideParams({
    success: true,
    variant: "simplified",
    message: "15% conversion lift confirmed",
  }),
);
console.log(decided.status); // "success"
```

### Archive, restore, duplicate

`duplicateExperiment` requires a name: the Mixpanel API returns an empty body when duplicating without one.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { DuplicateExperimentParams } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

await ws.archiveExperiment("xyz-456-uuid");
const restored = await ws.restoreExperiment("xyz-456-uuid");
const dup = await ws.duplicateExperiment(
  "xyz-456-uuid",
  new DuplicateExperimentParams({ name: "Pricing Page Test v2" }),
);
console.log(restored.name, dup.name);
```

### ERF experiments

List experiments in ERF (Experiment Results Framework) format. The records are returned verbatim, untyped.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

const erf = await ws.listErfExperiments();
console.log(erf.length);
```

---

## Alerts

Custom alerts monitor saved reports and notify when conditions are met. Alerts are **workspace-scoped** and linked to bookmarks (saved reports).

### List alerts

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

// List all alerts
const alerts = await ws.listAlerts();
for (const a of alerts) {
  console.log(`${String(a.id)}: ${a.name} (paused=${String(a.paused)})`);
}

// Filter by linked bookmark
const forBookmark = await ws.listAlerts({ bookmark_id: 12345 });
console.log(forBookmark.length);
```

### Create an alert

`frequency` is a number of seconds; `AlertFrequencyPreset` names the common values (`HOURLY` = 3600, `DAILY` = 86400, `WEEKLY` = 604800).

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import {
  AlertFrequencyPreset,
  CreateAlertParams,
} from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

const alert = await ws.createAlert(
  new CreateAlertParams({
    bookmark_id: 12345,
    name: "Daily signups drop",
    condition: {
      keys: [{ header: "Signup", value: "Signup" }],
      type: "absolute",
      op: "<",
      value: 100,
    },
    frequency: AlertFrequencyPreset.DAILY,
    paused: false,
    subscriptions: [{ type: "email", value: "team@example.com" }],
  }),
);
console.log(`Created alert ${String(alert.id)}: ${alert.name}`);
```

### Get, update, delete

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { UpdateAlertParams } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

// Get
const alert = await ws.getAlert(42);
console.log(alert.last_fired);

// Update (PATCH semantics)
const updated = await ws.updateAlert(
  42,
  new UpdateAlertParams({
    name: "Updated alert name",
    paused: true,
  }),
);
console.log(updated.paused);

// Delete
await ws.deleteAlert(42);

// Bulk delete
await ws.bulkDeleteAlerts([42, 43, 44]);
```

### Monitoring

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { CreateAlertParams } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

// Check alert count and limits
const count = await ws.getAlertCount();
console.log(
  `${String(count.anomaly_alerts_count)}/${String(count.alert_limit)} alerts`,
);

// View trigger history (paginated)
const history = await ws.getAlertHistory(42, { page_size: 10 });
for (const entry of history.results) {
  console.log(entry);
}
if (history.pagination?.next_cursor) {
  const more = await ws.getAlertHistory(42, {
    page_size: 10,
    next_cursor: history.pagination.next_cursor,
  });
  console.log(more.results.length);
}

// Send a test notification (the raw result is returned verbatim)
const result = await ws.testAlert(
  new CreateAlertParams({
    bookmark_id: 12345,
    name: "Test",
    condition: { type: "absolute", op: "<", value: 100 },
    frequency: 86400,
    paused: false,
    subscriptions: [{ type: "email", value: "me@example.com" }],
  }),
);
console.log(result);

// Get a signed screenshot URL
const screenshot = await ws.getAlertScreenshotUrl("gcs-key-here");
console.log(screenshot.signed_url);
```

### Validate alerts

Check whether alerts are compatible with a bookmark configuration:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { ValidateAlertsForBookmarkParams } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

const params = await ws.buildParams("Signup", { last: 30 });
const result = await ws.validateAlertsForBookmark(
  new ValidateAlertsForBookmarkParams({
    alert_ids: [1, 2, 3],
    bookmark_type: "insights",
    bookmark_params: params,
  }),
);
if (result.invalid_count > 0) {
  for (const v of result.alert_validations) {
    if (!v.valid) {
      console.log(`${v.alert_name}: ${v.reason ?? "invalid"}`);
    }
  }
}
```

---

## Annotations

Timeline annotations mark important events (releases, incidents, campaigns) on your Mixpanel charts.

### List annotations

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

// List all annotations
const annotations = await ws.listAnnotations();

// Filter by date range (ISO YYYY-MM-DD)
const q1 = await ws.listAnnotations({
  from_date: "2025-01-01",
  to_date: "2025-03-31",
});

// Filter by tag IDs
const tagged = await ws.listAnnotations({ tags: [1, 2] });

for (const ann of annotations) {
  console.log(`${ann.date}: ${ann.description}`);
}
console.log(q1.length, tagged.length);
```

### Create an annotation

::: info Date format
Annotation dates use the `%Y-%m-%d %H:%M:%S` format (e.g. `"2025-03-31 00:00:00"`). The description is limited to 512 characters and is checked client-side.
:::

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { CreateAnnotationParams } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

const annotation = await ws.createAnnotation(
  new CreateAnnotationParams({
    date: "2025-03-31 00:00:00",
    description: "v2.5 release",
    tags: [1], // Optional tag IDs
  }),
);
console.log(`Created annotation ${String(annotation.id)}`);
```

### Get, update, delete

::: info Immutable date
The annotation date cannot be changed after creation. Only `description` and `tags` are updatable.
:::

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { UpdateAnnotationParams } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

// Get
const ann = await ws.getAnnotation(123);
console.log(ann.tags.map((t) => t.name));

// Update (description and tags only)
const updated = await ws.updateAnnotation(
  123,
  new UpdateAnnotationParams({
    description: "v2.5 release (hotfix applied)",
  }),
);
console.log(updated.description);

// Delete
await ws.deleteAnnotation(123);
```

### Annotation tags

Organize annotations with tags:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { CreateAnnotationTagParams } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

// List tags
const tags = await ws.listAnnotationTags();
for (const t of tags) {
  console.log(`${String(t.id)}: ${t.name}`);
}

// Create a tag
const tag = await ws.createAnnotationTag(
  new CreateAnnotationTagParams({ name: "releases" }),
);
console.log(tag.id);
```

---

## Webhooks

Project webhooks receive HTTP notifications when events occur in your Mixpanel project. Webhooks use UUID string IDs.

### List webhooks

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

const webhooks = await ws.listWebhooks();
for (const wh of webhooks) {
  console.log(
    `${wh.id}: ${wh.name} (${wh.url}) enabled=${String(wh.is_enabled)}`,
  );
}
```

### Create a webhook

`createWebhook` returns a `WebhookMutationResult` — the new webhook's `id` and `name`, not the full record. Fetch the list again if you need the rest.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { CreateWebhookParams, WebhookAuthType } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

const result = await ws.createWebhook(
  new CreateWebhookParams({
    name: "Pipeline webhook",
    url: "https://example.com/webhook",
  }),
);
console.log(`Created webhook ${result.id}`);

// With basic auth
const authed = await ws.createWebhook(
  new CreateWebhookParams({
    name: "Authenticated webhook",
    url: "https://example.com/webhook",
    auth_type: WebhookAuthType.BASIC,
    username: "user",
    password: process.env["WEBHOOK_PASSWORD"],
  }),
);
console.log(authed.id);
```

### Update, delete

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { UpdateWebhookParams } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

// Update (PATCH semantics)
const result = await ws.updateWebhook(
  "wh-uuid-123",
  new UpdateWebhookParams({
    name: "Updated webhook",
    is_enabled: false,
  }),
);
console.log(result.name);

// Delete
await ws.deleteWebhook("wh-uuid-123");
```

### Test connectivity

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { WebhookTestParams } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

const result = await ws.testWebhook(
  new WebhookTestParams({ url: "https://example.com/webhook" }),
);
if (result.success) {
  console.log(`Webhook reachable (HTTP ${String(result.status_code)})`);
} else {
  console.log(`Webhook failed: ${result.message}`);
}
```

---

## Next steps

- [Data governance](/guide/data-governance) — Lexicon definitions, drop filters, custom properties, custom events, lookup tables, schemas
- [Report links](/guide/report-links) — turn a query or a saved report into a shareable URL
- [Error handling](/guide/error-handling) — the error hierarchy and stable `code` values (`RL6_INVALID_ID`, `RESPONSE_VALIDATION_ERROR`, …)
- [API overview](/api/index) — packages, entry points and the naming rules
