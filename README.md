# Mixpanel Headless for TypeScript

[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/node-%3E%3D22.12-339933)](https://nodejs.org/)
[![Runtime](https://img.shields.io/badge/runtime-Node%20%2B%20Browser-blue)](#which-package-do-i-need)

> **⚠️ Pre-release software.** These packages are not yet published to npm and APIs may
> change before 1.0. Import specifiers in this document use the package names they will
> publish under.

**A complete programmable interface to Mixpanel** — typed analytics queries, schema
discovery, entity management, streaming data extraction, and session replay analysis.
Fully typed, isomorphic (Node.js and browser), and continuously verified against the
battle-tested [Python `mixpanel_headless`](https://github.com/mixpanel/mixpanel-headless)
library it ports — 3,453 conformance vectors, zero divergence.

```typescript
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace(); // env vars, ~/.mp/config.toml, or bridge file

const result = await ws.query("Purchase", {
  math: "unique",
  group_by: "country",
  last: 30,
});

console.table(result.toRows());
// ┌─────────┬──────────────┬────────────┬─────────┬───────┐
// │ (index) │ date         │ event      │ segment │ count │
// ├─────────┼──────────────┼────────────┼─────────┼───────┤
// │ 0       │ '2026-08-01' │ 'Purchase' │ 'US'    │ 1042  │
// │ 1       │ '2026-08-01' │ 'Purchase' │ 'DE'    │ 311   │
// │ …       │              │            │         │       │
```

## Why Mixpanel Headless?

Mixpanel's web UI is powerful for interactive exploration, but programmatic access means
juggling multiple REST endpoints with different conventions, auth schemes, and response
shapes. Mixpanel Headless wraps all of it in one consistent, typed surface:

- **Five composable query engines** — Insights (`query`), funnels (`queryFunnel`),
  retention (`queryRetention`), flows (`queryFlow`), and user profiles (`queryUser`) —
  sharing one `Filter` vocabulary, inline cohort definitions, and uniform tabular results.
- **Discoverable schema** — list your events, properties, property values, funnels,
  cohorts, and saved reports before you query.
- **Full entity lifecycle** — create, read, update, and delete dashboards, reports,
  cohorts, feature flags, experiments, alerts, annotations, webhooks, Lexicon
  definitions, and more.
- **Streaming extraction** — memory-efficient async iterators over raw events and
  profiles for ETL pipelines (Node.js).
- **Session replay analysis** — discover a user's rrweb recordings and project them into
  session-level rows, click heatmap data, and an LLM-friendly markdown action timeline.
- **Built for humans _and_ agents** — every return value is a typed object, every error
  carries a stable machine-readable `code`, and results serialize cleanly. AI coding
  agents can drive the whole surface without external docs.

## Which package do I need?

| Package                      | Runtime         | What's inside                                                                                                                                                                                          |
| ---------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@mixpanel-headless/node`    | Node.js ≥ 22.12 | Everything for servers, scripts, and CI: config-file accounts (`~/.mp/config.toml`), env-var auth, programmatic OAuth login, and ready-made `accounts` / `session` / `targets` management. Start here. |
| `@mixpanel-headless/browser` | Browsers        | Bearer-token and redirect-PKCE auth, injectable credential storage, and a `Workspace` factory gated to browser-safe capabilities.                                                                      |
| `@mixpanel-headless/core`    | Both            | The isomorphic engine: the `Workspace` facade, query builders, result types, and the error hierarchy. Zero Node dependencies — the platform packages wire it up for you.                               |

All packages are ESM, ship TypeScript types, and share the same `Workspace` API — code
written against core runs in either environment.

```bash
npm install @mixpanel-headless/node    # servers, scripts, CI
npm install @mixpanel-headless/browser # web apps
```

## Quick start (Node.js)

### 1. Authenticate

**Service account — scripts and CI/CD.** Set four environment variables and construct a
workspace; nothing touches disk:

```bash
export MP_USERNAME="sa_xxx"
export MP_SECRET="your-secret-here"
export MP_PROJECT_ID="12345"
export MP_REGION="us"          # or "eu", "in"
```

```typescript
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
```

`createNodeWorkspace()` is the twin of Python's bare `Workspace()`: it wires the
resolver sources (env → config file → bridge), the on-disk OAuth token refresh,
and the `/me` cache in one call. (Composing `new Workspace({ sources })` by hand
from `@mixpanel-headless/core` also works, but OAuth accounts then need
`clientOptions: { tokenResolver }` wired explicitly — see the `createNodeWorkspace`
source for the full recipe.)

**Interactive OAuth — your laptop.** One call opens the browser for PKCE login, derives
an account name from your org, picks your project, and persists everything to
`~/.mp/config.toml`:

```typescript
import { loginUnified } from "@mixpanel-headless/node";

const summary = await loginUnified({ region: "us" });
console.log(`Logged in as ${summary.name}`);
```

`loginUnified` reads your environment first and picks the right path automatically:
`MP_USERNAME` + `MP_SECRET` set → service account; `MP_OAUTH_TOKEN` set → static bearer;
neither → browser PKCE flow.

**Static bearer token — agents and pipelines.** If a managed OAuth client hands you a
pre-obtained token, export `MP_OAUTH_TOKEN` + `MP_PROJECT_ID` + `MP_REGION` and construct
the workspace exactly as above.

> The config file is shared with the Python library's `mp` CLI — log in once with either
> tool and both are authenticated.

### 2. Explore your data

```typescript
const events = await ws.events(); // every event in the project
const props = await ws.properties("Purchase"); // properties on an event
const values = await ws.propertyValues("plan"); // observed values of a property
const funnels = await ws.funnels(); // saved funnels
const cohorts = await ws.cohorts(); // saved cohorts
```

### 3. Query

```typescript
const dau = await ws.query("Login", { math: "dau", last: 90 });
console.table(dau.toRows());
```

## The five query engines

All five engines share the same date controls (`from_date`/`to_date` or `last`, which
defaults to the last 30 days), the same `Filter` vocabulary, and the same result
conventions: every result has `toRows()` returning plain row objects (one per data
point — ready for `console.table`, a DataFrame library, or JSON serialization) and
`rowColumns()` naming the columns.

### Insights — `ws.query()`

Event counts, uniques, DAU/WAU/MAU, property aggregations, formulas, breakdowns, and
period-over-period comparison. 21 math types.

```typescript
import {
  Metric,
  Formula,
  Filter,
  GroupBy,
  TimeComparison,
  FrequencyBreakdown,
} from "@mixpanel-headless/core";

// Simple event count
const logins = await ws.query("Login");

// Revenue by country
const revenue = await ws.query("Purchase", {
  math: "total",
  math_property: "amount",
  group_by: "country",
});

// Conversion-rate formula across two metrics
const conversion = await ws.query(
  [
    new Metric({ event: "Signup", math: "unique" }),
    new Metric({ event: "Purchase", math: "unique" }),
    new Formula({ expression: "(B / A) * 100", label: "Conversion Rate" }),
  ],
  { unit: "week" },
);

// Filtered, with a numeric bucket breakdown
const buckets = await ws.query("Purchase", {
  where: Filter.equals("country", "US"),
  group_by: new GroupBy({
    property: "amount",
    property_type: "number",
    bucket_size: 50,
  }),
});

// Compare against the previous month
const trend = await ws.query("Login", {
  math: "dau",
  time_comparison: TimeComparison.relative("month"),
  last: 30,
});

// Segment users by how often they purchase
const frequency = await ws.query("Login", {
  group_by: new FrequencyBreakdown({ event: "Purchase", bucket_max: 10 }),
  last: 30,
});
```

`Filter` has 27+ static builders — `equals`, `notEquals`, `contains`, `greaterThan`,
`between`, `atLeast`, `isSet`, `startsWith`, `isTrue`, `inCohort`, `on`, `before`,
`since`, `inTheLast`, `dateBetween`, `listContains`, and more:

```typescript
const admins = await ws.query("Purchase", {
  where: [Filter.atLeast("amount", 50), Filter.startsWith("email", "admin")],
});
```

### Funnels — `ws.queryFunnel()`

Define steps inline — no saved funnel required:

```typescript
import { FunnelStep, Filter } from "@mixpanel-headless/core";

const funnel = await ws.queryFunnel(
  [
    "Signup",
    "Add to Cart",
    new FunnelStep({
      event: "Purchase",
      filters: [Filter.equals("plan", "pro")],
    }),
  ],
  { conversion_window: 7, last: 90 },
);

funnel.overall_conversion_rate; // e.g. 0.12
funnel.toRows(); // step | event | count | step_conv_ratio | overall_conv_ratio | avg_time | …
```

Supports strict/loose ordering, exclusion steps, holding properties constant, and
re-entry modes.

### Retention — `ws.queryRetention()`

Cohort retention over any born-event → return-event pair:

```typescript
const retention = await ws.queryRetention("Signup", "Login", {
  retention_unit: "week",
  last: 90,
});

retention.average; // average retention curve
retention.toRows(); // cohort_date | bucket | count | rate
```

### Flows — `ws.queryFlow()`

What users do before and after an event:

```typescript
import { FlowStep } from "@mixpanel-headless/core";

const flow = await ws.queryFlow(
  new FlowStep({ event: "Purchase", forward: 3, reverse: 1 }),
);

flow.toNodesRows(); // step | event | type | count | …
flow.topTransitions(5); // [["Purchase@0", "Order Confirmed@1", 812], …]
flow.graph(); // { nodes, edges } — ready for a Sankey renderer
```

### User profiles — `ws.queryUser()`

Filter, sort, and aggregate People profiles:

```typescript
// Profile listing
const premium = await ws.queryUser({
  mode: "profiles",
  where: Filter.equals("plan", "premium", { resource_type: "people" }),
  properties: ["$email", "$name", "ltv"],
  sort_by: "ltv",
  sort_order: "descending",
  limit: 50,
});
premium.toRows(); // distinct_id | last_seen | email | name | ltv

// Aggregate count (the default mode)
const count = await ws.queryUser({ where: Filter.isSet("$email") });
console.log(`Users with email: ${count.value}`);
```

### Build, inspect, run

Every engine has a `build*Params()` half that returns the exact bookmark params
`query*()` would send, and a `run*Params()` half that executes them. Inspect or edit in
between, or run params the typed builders cannot express (a lookup-table join breakdown,
say):

```typescript
const params = await ws.buildParams("Login", { group_by: "$city", last: 7 });
// ...inspect or edit `params` here...
const result = await ws.runParams(params, { limit: 50_000 });

// Flow params carry their own mode; user params route on their `action` key
const tree = await ws.runFlowParams(
  await ws.buildFlowParams("Purchase", { mode: "tree" }),
);
const premium = await ws.runUserParams(
  await ws.buildUserParams({ mode: "profiles", where: Filter.isSet("$email") }),
  { limit: 500, parallel: true },
);
```

`query()`, `queryFunnel()`, `queryRetention()` and their `run*Params()` twins accept
`limit` (1 to 50000, default 3000) to raise the segment cap for high-cardinality
breakdowns. Check `result.meta["is_segmentation_limit_hit"]` to see whether the result
was still truncated.

### Cohorts, defined inline

Build cohorts in code and use them anywhere a filter or breakdown goes — no UI trip
needed:

```typescript
import {
  CohortDefinition,
  CohortCriteria,
  CohortBreakdown,
  Filter,
} from "@mixpanel-headless/core";

const powerUsers = new CohortDefinition(
  CohortCriteria.didEvent("Purchase", { at_least: 3, within_days: 30 }),
);

await ws.query("Login", { where: Filter.inCohort(powerUsers, "Power Users") });
await ws.query("Login", {
  group_by: new CohortBreakdown({ cohort: powerUsers, name: "Power Users" }),
});
await ws.queryUser({ cohort: powerUsers, mode: "profiles", limit: null });
```

`CohortDefinition.allOf(…)` / `.anyOf(…)` compose criteria; `CohortCriteria` covers
event behavior (`didEvent`, `didNotDoEvent` with counts, windows, and aggregations),
profile properties (`hasProperty`, `propertyIsSet`), and membership in saved cohorts.

<details>
<summary><strong>Legacy live-analytics methods</strong></summary>

The classic query endpoints are also available directly: `segmentation`, `funnel`
(saved funnels by id), `retention`, `frequency`, `eventCounts`, `propertyCounts`,
`activityFeed`, `segmentationNumeric`, `segmentationSum`, `segmentationAverage`,
`querySavedReport`, and `querySavedFlows`.

```typescript
const seg = await ws.segmentation({
  event: "Purchase",
  from_date: "2026-01-01",
  to_date: "2026-01-31",
  on: "country",
});
```

</details>

## Report links

Any query can be turned into a URL that opens it in the Mixpanel report editor, and
any Mixpanel report URL (or shortlink, or bare 12-character slug) can be turned back
into its query parameters and run:

```typescript
// Query -> shareable link (stores an unsaved report under a minted slug)
const result = await ws.query("Login", { last: 7 });
const link = await ws.createReportLink(result, { name: "Logins, last 7 days" });
console.log(link.url);
// https://mixpanel.com/project/3/view/75/app/insights#EBrV5bW2u9Mw

// Link -> params -> results
const resolved = await ws.resolveReportLink(
  "https://mixpanel.com/project/3/view/75/app/insights#EBrV5bW2u9Mw",
);
resolved.report_type; // "insights" | "funnels" | "retention" | "flows" | ...
const rows = (await ws.queryReportLink(resolved)).toRows();

// Saved report (bookmark) URL, no network
ws.savedReportLink(123, { report_type: "funnels" });
// https://mixpanel.com/project/3/app/funnels#view/123
```

`resolveReportLink` checks the link's region, project, and (when one is pinned)
workspace against the active session before fetching anything, and rejects dashboard
links and legacy `~(...)` hashes with a `hint` in `details`. Every failure in this
family is a `ReportLinkError` subclass (`ReportLinkParseError`,
`UnsupportedReportLinkError`, `ReportLinkNotFoundError`,
`ReportLinkScopeMismatchError`, `ShortLinkResolutionError`). Browser note: a shortlink
that answers with a `3xx` cannot be expanded from a browser (`fetch` hides redirect
headers); the long-URL `200` form resolves everywhere.

## Streaming data extraction (Node.js)

Raw events and profiles as async iterators — constant memory, no intermediate storage,
abortable via `AbortSignal`:

```typescript
for await (const event of ws.streamEvents({
  from_date: "2026-08-01",
  to_date: "2026-08-15",
  events: ["Purchase"], // optional server-side filter
})) {
  await sendToWarehouse(event);
}

for await (const profile of ws.streamProfiles({
  where: 'properties["plan"] == "premium"',
})) {
  process(profile);
}
```

The Export API has no CORS support upstream, so streaming is Node-only; the browser
package refuses it with a typed error before any network attempt.

## Session replay

Discover a user's rrweb recordings, fetch them, and analyze them — including an action
timeline in markdown designed to drop straight into an LLM prompt:

```typescript
const bundle = await ws.replaysForUser("user-42", {
  from_date: "2026-08-01",
  to_date: "2026-08-15",
});

bundle.toSessionsRows(); // one row per session: duration, clicks, errors, entry URL, …
bundle.replays[0]?.summaryMarkdown(); // human/LLM-readable action timeline
bundle.topClicks(10); // most-clicked elements across the bundle
bundle.rageClicks(); // frustration signals
bundle.errorSessions(); // sessions containing console errors
```

Lower-level primitives are all exposed too: `listReplays`, `fetchReplay`,
`fetchReplays`, `streamReplay`, `signReplay`, `eventsForReplay`, and
`analyzeReplay(id)` which returns the markdown timeline for a single recording. Signed
CDN URLs are redacted by default and never logged.

## Managing entities

The full Mixpanel App API surface, as typed methods — around 200 in total:

| Domain               | Methods                                                                                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboards           | `listDashboards`, `createDashboard`, `updateDashboard`, `deleteDashboard`, favorites, pinning, report placement, text cards, blueprint templates, RCA dashboards |
| Reports (bookmarks)  | `listBookmarks`, `createBookmark`, `updateBookmark`, bulk operations, history, linked dashboards                                                                 |
| Cohorts              | `listCohortsFull`, `createCohort`, `updateCohort`, bulk update/delete                                                                                            |
| Feature flags        | `listFeatureFlags`, `createFeatureFlag`, archive/restore/duplicate, test users, history, limits                                                                  |
| Experiments          | `listExperiments`, `createExperiment`, `launchExperiment`, `concludeExperiment`, `decideExperiment`                                                              |
| Alerts & annotations | `listAlerts`, `createAlert`, alert history/testing; `listAnnotations`, `createAnnotation`, annotation tags                                                       |
| Webhooks             | `listWebhooks`, `createWebhook`, `updateWebhook`, `testWebhook`                                                                                                  |
| Lexicon & governance | event/property definitions, tags, tracking metadata, history, `exportLexicon`, drop filters, custom properties, custom events, lookup tables                     |
| Schema registry      | `listSchemaRegistry`, `createSchema`, bulk operations, enforcement config, `runAudit`, data-volume anomalies, deletion requests                                  |

```typescript
import {
  CreateCohortParams,
  CreateFeatureFlagParams,
} from "@mixpanel-headless/core";

const dashboards = await ws.listDashboards();
const cohort = await ws.createCohort(
  new CreateCohortParams({ name: "Power Users" }),
);
const flag = await ws.createFeatureFlag(
  new CreateFeatureFlagParams({ name: "Dark Mode", key: "dark_mode" }),
);
```

## In the browser

`@mixpanel-headless/browser` exposes the same `Workspace` facade with browser-safe
auth. Two ways in:

**A server-minted bearer token** — your backend holds the real credentials and hands
the page a short-lived token:

```typescript
import { createBrowserWorkspace } from "@mixpanel-headless/browser";

const ws = createBrowserWorkspace({
  token: "eyJ…",
  projectId: "12345",
  region: "us",
});

const result = await ws.query("Login", { math: "dau", last: 30 });
```

**The redirect PKCE flow** — full in-browser OAuth, no backend required. Client
registration, PKCE challenge, CSRF state, and token exchange are all handled for you;
you only navigate:

```typescript
// login page
import {
  beginLogin,
  LocalStorageCredentialStore,
} from "@mixpanel-headless/browser";

const store = new LocalStorageCredentialStore(sessionStorage); // must survive the redirect
const { authorizeUrl } = await beginLogin({
  region: "us",
  redirectUri: "https://app.example.com/oauth/callback",
  store,
});
location.assign(authorizeUrl);
```

```typescript
// callback page
import {
  completeLogin,
  createBrowserWorkspaceFromStore,
  LocalStorageCredentialStore,
} from "@mixpanel-headless/browser";

const store = new LocalStorageCredentialStore(sessionStorage);
await completeLogin({ region: "us", returnUrl: location.href, store });

const ws = await createBrowserWorkspaceFromStore({
  region: "us",
  projectId: "12345",
  store,
});
```

The browser entry also exposes the full query vocabulary — `Filter`, `Metric`,
`Formula`, `GroupBy`, `FunnelStep`, `FlowStep`, `RetentionEvent`, `TimeComparison`,
`FrequencyBreakdown`, the inline-cohort classes, and `validateBookmark` — so a page can
build and re-build queries client-side without a second import from
`@mixpanel-headless/core`. They are the same pure classes core exports; only
`Workspace` itself is type-only here, since construction must go through the gated
factories above. Alongside them it re-exports the two identity helpers a page needs to
name what it just built — `pythonJsonDumpsCanonical` (the CPython-parity canonical
JSON a query-reference hash is taken over) and `inferBookmarkType` (the report type a
params object describes, or `null`).

```typescript
import { Filter, FunnelStep } from "@mixpanel-headless/browser";

const funnel = await ws.queryFunnel(
  [
    "Signup",
    new FunnelStep({
      event: "Purchase",
      filters: [Filter.equals("plan", "pro")],
    }),
  ],
  { last: 30 },
);
```

**Credential storage is injectable and defaults to memory.** `InMemoryCredentialStore`
(the default) keeps tokens out of persistent storage entirely — users re-login on
reload. `LocalStorageCredentialStore` persists across navigations (required for the
redirect flow; back it with `sessionStorage` for narrower exposure) but anything kept
in Web Storage is readable by any script on your origin — a single XSS hole exfiltrates
it. Treat persistent storage as a deliberate trade-off and keep token lifetimes short.

Browser-scoped guardrails, enforced with typed errors rather than silent failures:
service-account (Basic auth) credentials are refused at runtime
(`BROWSER_SERVICE_ACCOUNT_REFUSED`) so project secrets never ship to a page, and the
Export/streaming API is rejected before any network attempt
(`BROWSER_EXPORT_UNSUPPORTED`) — use the Node package for extraction workloads.

## Accounts, sessions, and targets (Node.js)

The Node package ships ready-made management namespaces backed by
`~/.mp/config.toml` — the same file the Python `mp` CLI uses:

```typescript
import { accounts, session, targets } from "@mixpanel-headless/node";

await accounts.list(); // all configured accounts
await accounts.test(); // probe /me for the active account
await accounts.use("staging"); // switch the active account
await accounts.token(); // valid bearer token (auto-refreshed)

await session.show(); // resolved account/project/workspace
await session.use({ project: "67890" }); // repin the active project

await targets.add("prod", { account: "team", project: "12345" });
await targets.use("prod"); // apply all three axes atomically
```

Workspaces can also pin axes per-instance, without touching the persisted session:

```typescript
const ws = createNodeWorkspace({ account: "team", project: "12345" });

await ws.use({ project: "67890" }); // repoint this instance
await ws.use({ account: "other", persist: true }); // …or persist the switch
```

<details>
<summary><strong>Environment variable reference</strong></summary>

| Variable                    | Purpose                                                          |
| --------------------------- | ---------------------------------------------------------------- |
| `MP_USERNAME` / `MP_SECRET` | Service-account credentials (both required together)             |
| `MP_PROJECT_ID`             | Project to query                                                 |
| `MP_REGION`                 | Data residency: `us`, `eu`, or `in`                              |
| `MP_OAUTH_TOKEN`            | Pre-obtained static bearer token                                 |
| `MP_WORKSPACE_ID`           | Optional workspace pin                                           |
| `MP_CONFIG_PATH`            | Override the config file location (default `~/.mp/config.toml`)  |
| `MP_OAUTH_STORAGE_DIR`      | Override the token storage root (default `~/.mp`)                |
| `MP_AUTH_FILE`              | Path to a Cowork bridge credentials file                         |
| `MP_API_BASE_URL`           | Route every API family at one alternate host — see below         |
| `MP_APP_BASE_URL`           | Optional: re-home only the App API family (`{app_base}/api/app`) |

The full service-account set (`MP_USERNAME` + `MP_SECRET` + `MP_PROJECT_ID` +
`MP_REGION`) takes precedence over `MP_OAUTH_TOKEN` when both are present. Environment
variables beat the config file; explicit `Workspace` options beat both.

</details>

<details>
<summary><strong>Alternate API host (<code>MP_API_BASE_URL</code>)</strong></summary>

By default the client picks its hosts per region (`mixpanel.com`, `eu.mixpanel.com`,
`in.mixpanel.com`, plus the `data*.mixpanel.com` export hosts). Set `MP_API_BASE_URL` to
point **every** API family at one alternate host instead — a headless Mixpanel pod behind a
single nginx front door, a local proxy, or an in-sandbox fake server:

```bash
export MP_API_BASE_URL=http://devbox:8080
export MP_USERNAME=... MP_SECRET=... MP_PROJECT_ID=... MP_REGION=us
```

```typescript
const ws = createNodeWorkspace();
await ws.events(); // → GET http://devbox:8080/api/query/events/names
```

When set (a trailing slash is tolerated), the region lookup is bypassed and the families
resolve to fixed path prefixes on that base:

| API family                                               | URL under the override    | Live `us` equivalent                    |
| -------------------------------------------------------- | ------------------------- | --------------------------------------- |
| Query (`/insights`, `/segmentation`, `/events/names`, …) | `{base}/api/query`        | `https://mixpanel.com/api/query`        |
| Export (`streamEvents`)                                  | `{base}/api/2.0`          | `https://data.mixpanel.com/api/2.0`     |
| Engage (`queryUser`, profile streams)                    | `{base}/api/query/engage` | `https://mixpanel.com/api/query/engage` |
| App API (dashboards, cohorts, Lexicon, `/me`, …)         | `{base}/api/app`          | `https://mixpanel.com/api/app`          |

Details:

- **Read per request, not at construction.** `createNodeWorkspace()` wires a `process.env`
  reader that is consulted on every request, so `ws.use({ account })` swaps, long-lived
  processes, and test env patching all see the current value (exactly the Python
  library's `os.environ` semantics). `@mixpanel-headless/core` never reads `process.env`:
  when you build a core client by hand, pass `endpointOverrides` yourself — a static
  `{ apiBaseUrl, appBaseUrl }` bag, or a provider such as
  `createNodeEndpointOverrides()` from `@mixpanel-headless/node`.
- **Route-aware behaviour is preserved.** The App-vs-Query read-timeout choice and the
  pinned `workspace_id` injection key off the API family, not the hostname.
- **`MP_REGION` is still required** and still meaningful for everything that is not a URL
  (account records, `/me` domain cross-checks, report-link hostnames). Report links keep
  producing real `*.mixpanel.com` URLs.
- **Login region probe.** Probing `us → eu → in` against one host is pointless, so under the
  override the probe runs once against the base and labels the account with `MP_REGION`
  (when it is `us`/`eu`/`in`) or `us`.
- **Plain `http://` bases are accepted** with no extra flag. They are intended for local or
  headless deployments only — never send real credentials over cleartext to a remote host.
- **`MP_APP_BASE_URL`** (optional) re-homes just the App API family at `{app_base}/api/app`.
  It works on its own (the other three families stay live) or on top of `MP_API_BASE_URL`
  (App API moves to the second host). With only `MP_APP_BASE_URL` set, the login probe
  still walks `us → eu → in` (each `/me` probe hits the App override base) because the
  region it persists still decides which live cluster the other families use.
- **Family detection is longest-prefix**, so split configs where one base sits under the
  other (for example `MP_API_BASE_URL=https://proxy` with
  `MP_APP_BASE_URL=https://proxy/api/query`) still classify every request correctly.
- **Browser builds** take the same option through `clientOptions.endpointOverrides`
  (config only — there is no env). The Export-API refusal guard is evaluated per
  request against the effective table: `apiBaseUrl` re-homes Export at
  `{apiBaseUrl}/api/2.0`, which the guard admits (the override host must serve CORS
  headers), while the live export origins stay refused even under an override.

With neither variable set, behaviour is byte-identical to the per-region defaults.

</details>

## Error handling

Every error extends `MixpanelHeadlessError` and carries a stable, machine-readable
`code` plus structured `details` — branch on classes and codes, never on message text:

```typescript
import {
  MixpanelHeadlessError,
  AuthenticationError,
  RateLimitError,
  QueryError,
  ReplayNotFoundError,
} from "@mixpanel-headless/core";

try {
  const result = await ws.query("Purchase", { last: 30 });
} catch (err) {
  if (err instanceof RateLimitError) {
    await sleep(err.retryAfter * 1000);
  } else if (err instanceof AuthenticationError) {
    // credentials expired or revoked — code "AUTH_FAILED"
  } else if (err instanceof MixpanelHeadlessError) {
    logger.error(err.toDict()); // { code, message, details }
  } else {
    throw err;
  }
}
```

The hierarchy mirrors the API's failure modes: `ParamValidationError` (client-side,
before any request), `APIError` and its children (`AuthenticationError`,
`RateLimitError` with `retryAfter`, `QueryError`, `ServerError`), `ConfigError`,
`OAuthError`, and a session-replay family (`ReplayNotFoundError`,
`SignedURLExpiredError`, …). Transient failures are retried automatically with
exponential backoff before an error ever reaches you.

## Coming from the Python library?

This is a faithful, behavior-for-behavior port of
[`mixpanel_headless`](https://github.com/mixpanel/mixpanel-headless) — same concepts,
same auth model, same config file, same query semantics. The
[Python guides](https://mixpanel.github.io/mixpanel-headless/) (Insights, funnels,
retention, flows, user profiles, session replay, streaming) apply directly; translate
names with three rules:

| Python                                   | TypeScript                                     | Rule                                                             |
| ---------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| `ws.query_funnel(…)`                     | `ws.queryFunnel(…)`                            | Methods are camelCase                                            |
| `Filter.starts_with(…)`                  | `Filter.startsWith(…)`                         | Static builders are camelCase                                    |
| `ws.query("Login", math="dau", last=90)` | `ws.query("Login", { math: "dau", last: 90 })` | Keyword args become an options object — **keys stay snake_case** |
| `result.df`                              | `result.toRows()` / `result.rowColumns()`      | Rows of plain objects instead of a DataFrame                     |
| `funnel.overall_conversion_rate`         | `funnel.overall_conversion_rate`               | Result fields stay snake_case                                    |

**Parity is verified, not aspirational.** Every release replays a conformance corpus of
**3,453 test vectors extracted from the Python implementation** — covering outputs,
error behavior, and the exact HTTP requests made — with zero failures, and a
cross-language differential oracle continuously fuzzes the two implementations against
each other (run records: [`conformance-runner/GATE.md`](conformance-runner/GATE.md) and
[`differential/oracle/RUN.md`](differential/oracle/RUN.md)). Even Python-specific rendering quirks (float formatting, `str()` semantics)
are reproduced so results match byte-for-byte across languages.

## Requirements

- **Node.js ≥ 22.12** to _use_ `@mixpanel-headless/node`; any evergreen browser
  for `@mixpanel-headless/browser`. _Developing_ this repository needs a newer
  Node — see [Toolchain pins](#toolchain-pins-developing-the-repo).
- **ESM only.** All packages are native ES modules.
- **TypeScript optional but rewarding** — the packages ship complete types under
  `strict`; plain JavaScript works fine.

### Toolchain pins (developing the repo)

- **Two Node floors.** The published packages run on Node ≥ 22.12
  (`.node-version` pins the 22 line; CI runs 24). Developing the repo needs
  **Node ^22.22.2 or ≥ 24.15** — the strictest dev dependency
  (`eslint-plugin-jsdoc` 64) requires it, so the root `package.json`
  `engines` carries that higher floor and `.npmrc`'s `engine-strict=true`
  turns it into one clear `npm ci` error up front rather than a confusing
  per-package failure mid-install.
- **`typescript` is pinned `~6.0.3`, not `^`.** TypeScript 7 is `latest` on npm,
  but typescript-eslint's peer range is `<6.1.0`, so a casual
  `npm i -D typescript` would break `npm run lint`. Move the pin when
  typescript-eslint (and TypeDoc) support TS 7.

---

_Developing the port itself? This README covers the consumer surface — see
[`CLAUDE.md`](CLAUDE.md) for the repository layout, the conformance rig, and the
`npm run check` gate._
