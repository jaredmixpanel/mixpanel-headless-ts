---
title: Quick Start
description: Set up credentials, explore your project and run your first typed queries in about five minutes.
---

# Quick Start

This guide walks you through your first queries with `@mixpanel-headless/node` in about five minutes.

## Prerequisites

You'll need:

- `@mixpanel-headless/node` installed ([Installation](/getting-started/installation)) on Node.js ≥ 22.12
- **Either** a Mixpanel service account (username, secret, project id) **or** a Mixpanel user account (for OAuth login)
- Your project's data residency region (`us`, `eu`, or `in`)

## Step 1: Set up credentials

### Recommended: `loginUnified()`

One call runs the right auth flow for your environment, hits `/me` to discover what you can access, derives an account name from your org, pins a default project, and persists everything to `~/.mp/config.toml`:

```ts twoslash
import { loginUnified } from "@mixpanel-headless/node";

const summary = await loginUnified({ region: "us" });
console.log(`Logged in as ${summary.user_email ?? summary.name}`);
```

`loginUnified` is the engine behind the Python CLI's `mp login`. It auto-detects the auth type from the environment:

| Env vars set                | Auth type used         | Region behaviour                                 | Persistence                                                                                           |
| --------------------------- | ---------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `MP_USERNAME` + `MP_SECRET` | `service_account`      | probes `us → eu → in` unless `region` is given   | username + secret persisted to `~/.mp/config.toml`                                                    |
| `MP_OAUTH_TOKEN`            | `oauth_token`          | probes `us → eu → in` unless `region` is given   | bearer persisted inline to `~/.mp/config.toml` (pass `token_env: "VAR"` to persist a pointer instead) |
| Neither                     | `oauth_browser` (PKCE) | defaults to `us` (pass `region: "eu"` or `"in"`) | refresh-capable tokens at `~/.mp/accounts/{name}/tokens.json`                                         |

The browser flow opens your browser for PKCE login and listens on a loopback callback (with a paste fallback when the callback is blocked). When `/me` lists several projects and none is pinned by `MP_PROJECT_ID` or `project`, pass a `project_picker` callback; the other options mirror the CLI flags: `name` overrides the derived account name, `project` skips the picker, `service_account` / `token_env` force a non-browser path, `no_browser` prints the authorize URL instead of launching a browser.

::: tip Shared with the Python CLI
`~/.mp/config.toml` is the same file the Python library's `mp` CLI uses. Log in once with either tool and both are authenticated.
:::

### Other auth paths

For a non-persistent path — no account record on disk — set the environment variables and skip `loginUnified` entirely; the resolver picks them up directly.

**Service-account env vars.** For unattended automation, set the four variables:

```bash
export MP_USERNAME="sa_abc123..."
export MP_SECRET="your-secret-here"
export MP_PROJECT_ID="12345"
export MP_REGION="us"
```

**Raw OAuth bearer (CI / agents).** If a managed OAuth client hands you a pre-obtained access token, inject it via env vars (the library sends `Authorization: Bearer <token>`):

```bash
export MP_OAUTH_TOKEN="<bearer-token>"
export MP_PROJECT_ID="12345"
export MP_REGION="us"  # or "eu", "in"
```

Tokens injected this way are not persisted and are never refreshed — pass a fresh token when the previous one expires. The full service-account set takes precedence when both sets are complete.

**Explicit two-step add.** For full control over the account name and region at registration time, register the account and then run the browser flow:

```ts twoslash
import { accounts } from "@mixpanel-headless/node";

await accounts.add("personal", { type: "oauth_browser", region: "us" });
const login = await accounts.login("personal");
console.log(`Authenticated as ${login.user?.["email"]}`);
```

`loginUnified({ name: "personal", region: "us" })` is the one-line equivalent. See [Configuration → Token storage](/getting-started/configuration#oauth-browser-token-storage) for the persistence details.

Either way, construct the workspace the same way:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace(); // env vars, ~/.mp/config.toml, or bridge file
```

`createNodeWorkspace()` is the twin of Python's bare `Workspace()`: it wires the resolver sources (env → config file → bridge), the on-disk OAuth token refresh and the `/me` cache in one call.

## Step 2: Switch projects (optional)

`loginUnified` already pinned a project. This step is for _changing_ it later — pointing the same account at a different project, or swapping in-session:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
for (const project of await ws.projects()) {
  console.log(project.id, project.name);
}

await ws.use({ project: "3018488", persist: true });
```

`persist: true` writes the new project to the active account's `default_project`. Without it the switch is per-instance; to override at construction without persisting, pass `createNodeWorkspace({ project: "3018488" })`.

::: info Env-only paths skip this step
`persist: true` needs an active account in `~/.mp/config.toml`. If you set up via the service-account env quad or `MP_OAUTH_TOKEN` without registering an account, set the project through `MP_PROJECT_ID` (already required by both env-only paths) or pass `project` per instance.
:::

## Step 3: Test your connection

Verify credentials are working. `accounts.test()` never throws — check `ok` and `error`:

```ts twoslash
import { accounts } from "@mixpanel-headless/node";

const result = await accounts.test(); // AccountTestResult for the active account
if (result.ok) {
  console.log(result.user?.["email"], result.accessible_project_count);
} else {
  console.log("test failed:", result.error, result.error_code);
}
```

## Step 4: Explore your data

Before writing queries, survey your data landscape. Discovery methods let you see what exists in your project without guessing.

### List events

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
const events = await ws.events(); // string[]
for (const name of events.slice(0, 10)) {
  console.log(name);
}
```

### Drill into properties

Once you know an event name, see what properties it has:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
const props = await ws.properties("Purchase"); // string[]
```

### Sample property values

See actual values a property contains:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
const values = await ws.propertyValues("country", { event: "Purchase" });
console.log(values); // ['US', 'UK', 'DE', 'FR', ...]
```

### See what's active

Check today's top events by volume:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
const top = await ws.topEvents();
for (const e of top.slice(0, 5)) {
  console.log(`${e.event}: ${e.count.toLocaleString()} events`);
}
```

### Browse saved assets

See funnels, cohorts, and saved reports already defined in Mixpanel:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
const ws = createNodeWorkspace();
// ---cut---
const funnels = await ws.funnels();
const cohorts = await ws.cohorts();
const bookmarks = await ws.listBookmarks();
```

This discovery workflow ensures your queries reference real event names, valid properties, and actual values — no trial and error. The [Discovery guide](/guide/discovery) covers the whole surface.

## Step 5: Run analytics queries

### Insights queries (recommended)

Use `query()` for typed, composable analytics — DAU/WAU/MAU, formulas, filters, breakdowns, and more. Options mirror the Python keyword arguments and keep their `snake_case` keys:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { Filter, Metric } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

// Simple event count (last 30 days by default)
const purchases = await ws.query("Purchase");
console.table(purchases.toRows());

// DAU with property breakdown
const dau = await ws.query("Login", {
  math: "dau",
  group_by: "platform",
  last: 90,
});

// Filtered aggregation
const revenue = await ws.query("Purchase", {
  math: "total",
  math_property: "amount",
  where: Filter.equals("country", "US"),
});

// Multi-metric formula
const conversion = await ws.query(
  [
    new Metric({ event: "Signup", math: "unique" }),
    new Metric({ event: "Purchase", math: "unique" }),
  ],
  { formula: "(B / A) * 100", formula_label: "Conversion Rate" },
);
```

Every result has `toRows()` — plain row objects, one per data point, ready for `console.table`, a DataFrame library or JSON — and `rowColumns()` naming the columns.

### Cohort-scoped queries

Scope any query to a user segment — define cohorts inline without saving them first:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import {
  CohortBreakdown,
  CohortCriteria,
  CohortDefinition,
  Filter,
} from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

// Define a cohort on the fly
const powerUsers = new CohortDefinition(
  CohortCriteria.didEvent("Purchase", { at_least: 3, within_days: 30 }),
);

// Filter to that cohort
const logins = await ws.query("Login", {
  where: Filter.inCohort(powerUsers, "Power Users"),
});

// Compare cohort vs. everyone else
const compared = await ws.query("Login", {
  group_by: new CohortBreakdown({ cohort: powerUsers, name: "Power Users" }),
});
```

Cohort filters work across all five query engines. See the [Insights guide](/guide/query) for full coverage.

### Funnel queries

Define funnels inline with typed steps — no saved funnel required:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { Filter, FunnelStep } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

// Simple funnel
const simple = await ws.queryFunnel(["Signup", "Purchase"]);
console.log(
  `Conversion: ${(simple.overall_conversion_rate * 100).toFixed(1)}%`,
);

// With per-step filters and conversion window
const filtered = await ws.queryFunnel(
  [
    new FunnelStep({ event: "Signup" }),
    new FunnelStep({
      event: "Purchase",
      filters: [Filter.greaterThan("amount", 50)],
    }),
  ],
  { conversion_window: 7, last: 90 },
);
console.table(filtered.toRows());
```

See the [Funnels guide](/guide/query-funnels) for full coverage.

### Retention queries

Measure cohort retention with typed event pairs — no saved report required:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { Filter, RetentionEvent } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

// Simple retention: do signups come back?
const weekly = await ws.queryRetention("Signup", "Login", {
  retention_unit: "week",
  last: 90,
});
console.table(weekly.toRows().slice(0, 5));
// cohort_date | bucket | count | rate

// With per-event filters and custom buckets
const organic = await ws.queryRetention(
  new RetentionEvent({
    event: "Signup",
    filters: [Filter.equals("source", "organic")],
  }),
  "Login",
  { retention_unit: "day", bucket_sizes: [1, 3, 7, 14, 30] },
);
```

See the [Retention guide](/guide/query-retention) for full coverage.

### Flow queries

Analyze user paths through your product — what users do before and after key events:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { Filter, FlowStep } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

// What happens after Purchase?
const after = await ws.queryFlow("Purchase", { forward: 3, last: 90 });
console.log(after.topTransitions(5));

// With per-step filters and reverse analysis
const around = await ws.queryFlow(
  new FlowStep({
    event: "Purchase",
    filters: [Filter.greaterThan("amount", 50)],
  }),
  { forward: 3, reverse: 2 },
);
console.table(around.toNodesRows());
console.table(around.toEdgesRows());
```

See the [Flows guide](/guide/query-flows) for full coverage.

### User profile queries

Search, filter, and aggregate user profiles stored in Mixpanel:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { Filter } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

// Query user profiles
const premium = await ws.queryUser({
  mode: "profiles",
  where: Filter.equals("plan", "premium", { resource_type: "people" }),
  properties: ["$email", "$name", "ltv"],
  sort_by: "ltv",
  sort_order: "descending",
  limit: 50,
});
console.log(`${premium.total} premium users`);
console.table(premium.toRows());

// Count matching profiles (the default mode)
const count = await ws.queryUser({ where: Filter.isSet("$email") });
console.log(`Users with email: ${count.value}`);
```

See the [User profiles guide](/guide/query-users) for full coverage.

### Legacy query methods

For segmentation, saved funnels, and retention via the older Query API:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

const seg = await ws.segmentation("Purchase", {
  from_date: "2026-01-01",
  to_date: "2026-01-31",
});
console.table(seg.toRows());
```

See [Live analytics](/guide/live-analytics).

## Step 6: Switch accounts and projects in-session

`ws.use()` swaps any axis without rebuilding the underlying HTTP client, so cross-project iteration is cheap:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

// In-session switching (returns `this` for chaining)
await ws.use({ account: "team" }); // implicitly clears workspace
await ws.use({ project: "3018488" });
await ws.use({ workspace: 3448414 });
await ws.use({ target: "ecom" }); // apply all three at once

// Persist the new state to ~/.mp/config.toml
await ws.use({ project: "3018488", persist: true });

// Iterate across projects
for (const project of await ws.projects()) {
  await ws.use({ project: project.id });
  console.log(project.name, (await ws.events()).length);
}
```

See [Accounts, sessions and targets](/guide/accounts-sessions-targets) for the full workflow.

## Step 7: Manage entities and data governance (optional)

Create, update, and delete dashboards, reports, cohorts, feature flags, and experiments:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import {
  CreateCohortParams,
  CreateExperimentParams,
} from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

const dashboards = await ws.listDashboards();
const cohort = await ws.createCohort(
  new CreateCohortParams({ name: "Premium Users" }),
);
const reports = await ws.listBookmarksV2({ bookmark_type: "insights" });

// Feature flags and experiments
const flags = await ws.listFeatureFlags();
const exp = await ws.createExperiment(
  new CreateExperimentParams({ name: "Checkout Flow Test" }),
);

// Data governance
const eventDefs = await ws.getEventDefinitions({ names: ["Signup"] });
const dropFilters = await ws.listDropFilters();
const schemas = await ws.listSchemaRegistry();
const audit = await ws.runAudit();
```

See the [Entity management guide](/guide/entity-management) for dashboards, reports, cohorts, feature flags and experiments, and the [Data governance guide](/guide/data-governance) for Lexicon definitions, drop filters, custom properties, lookup tables, the schema registry and auditing.

## Step 8: Stream data

::: warning Node.js only
The Export API serves no CORS headers, so streaming is Node-only; the browser package refuses it with a typed error before any network attempt.
:::

For ETL pipelines or data processing, stream raw events as an async iterator — constant memory, no intermediate storage:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
declare function sendToWarehouse(event: unknown): Promise<void>;
// ---cut---
const ws = createNodeWorkspace();
for await (const event of ws.streamEvents({
  from_date: "2026-01-01",
  to_date: "2026-01-31",
})) {
  await sendToWarehouse(event);
}
await ws.close();
```

See the [Streaming guide](/guide/streaming).

## Next steps

- [Configuration](/getting-started/configuration) — multiple accounts and advanced settings
- [Unified query system](/guide/unified-query-system) — what the five engines share
- [Insights](/guide/query) — typed analytics with DAU, formulas, filters, and breakdowns
- [Funnels](/guide/query-funnels), [Retention](/guide/query-retention), [Flows](/guide/query-flows), [User profiles](/guide/query-users)
- [Error handling](/guide/error-handling) — the class hierarchy and stable `code`s
- [In the browser](/guide/browser) — bearer tokens and redirect PKCE
