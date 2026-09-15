---
title: Report Links
description: Turn a headless query into a shareable Mixpanel URL, or turn a Mixpanel report URL back into the query behind it and run it.
---

# Report Links

Turn a headless query into a shareable Mixpanel URL, or turn a Mixpanel report URL back into the query behind it and run it.

::: tip Two directions, one round trip each
`createReportLink` makes one App API POST and returns a URL; when no workspace is pinned or passed, workspace auto-resolution may add a lookup call first. `resolveReportLink` makes at most two (one for a shortlink, one for the record) and returns the raw params. `savedReportLink` makes none.
:::

## What a slug is

When you open a report in the Mixpanel web app the URL ends in a 12-character hash such as `https://mixpanel.com/project/3/view/75/app/insights#EBrV5bW2u9Mw`. That hash is a **slug**: a lookup key for an **unsaved report** that Mixpanel stores on the server, per project and per region. It is not an encoded query, so nothing can decode it offline — headless reads the record back through the App API instead.

A **saved report** (a bookmark) has a numeric id and a different hash form, for example `#report/123` or, for funnels, `#view/123`. A **shortlink** looks like `https://mixpanel.com/s/AbC123` and redirects to one of the two forms above.

## Create a link

From a typed result — the report type is inferred from the result class:

```ts twoslash
import { Metric } from "@mixpanel-headless/core";
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

const result = await ws.query(new Metric({ event: "Login", math: "total" }), {
  last: 7,
});
const link = await ws.createReportLink(result, { name: "Logins, last 7 days" });
console.log(link.url);
// https://mixpanel.com/project/3/view/75/app/insights#EBrV5bW2u9Mw
```

From raw params, without running the query first:

```ts twoslash
import { FunnelStep } from "@mixpanel-headless/core";
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
// ---cut---
const params = await ws.buildParams("Login", { last: 7 });
const link = await ws.createReportLink(params); // insights by default

const funnel = await ws.buildFunnelParams(
  [new FunnelStep({ event: "Login" }), new FunnelStep({ event: "Purchase" })],
  {
    last: 30,
  },
);
const funnelLink = await ws.createReportLink(funnel, {
  report_type: "funnels",
});
```

`ReportLink` carries `url`, `slug`, `report_type`, `project_id`, `workspace_id`, `name`, `description`, `bookmark_id`, and `created_at`. `String(link)` is the URL, and `link.toDict()` is the JSON-serializable field set.

Notes:

- Params are validated against the bookmark schema before the upload. Pass `validate: false` to skip the check.
- The `/view/{wid}` segment comes from an explicit `workspace_id`, then the pinned session workspace, then auto-resolution. If nothing resolves, the URL is project-only and still opens.
- An explicit `report_type` that contradicts the result class throws `ParamValidationError` (`RL4_REPORT_TYPE_CONFLICT`) before any network call.

## Resolve a link

`resolveReportLink` accepts a full URL, a bare slug, or a shortlink:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
// ---cut---
const r = await ws.resolveReportLink(
  "https://mixpanel.com/project/3/view/75/app/insights#EBrV5bW2u9Mw",
);
r.report_type; // "insights"  (from the server record, not the URL)
r.params; // the raw params object
r.url; // the canonical URL, rebuilt from the record

await ws.resolveReportLink("EBrV5bW2u9Mw"); // bare slug, active project
await ws.resolveReportLink("https://mixpanel.com/s/AbC123"); // shortlink, followed once
await ws.resolveReportLink(
  "https://mixpanel.com/project/3/app/insights#report/123",
); // saved report
```

`ResolvedReport` carries `source` (`"slug"` or `"bookmark"`), `report_type`, `params`, `project_id`, `workspace_id`, `region`, `url`, `input`, `expanded_url` (the shortlink target), `slug`, `bookmark_id`, `bookmark`, `name`, `description`, and `overrides`. Stored overrides are surfaced as data; they are never merged into `params`.

The Mixpanel server canonicalizes params when it stores them. The record you read back is the web app's internal form: it adds defaults such as `displayOptions.primaryYAxisOptions`, `behavior.behaviors`, and `executedMigrations`; for Insights it rewrites `behavior.type` from `event` to `simple`, may replace an auto-captured event name such as `$mp_web_page_view` with its display name `[Auto] Page View`, and drops `filtersDeterminer`. The canonical params run through `queryReportLink` without change, but do not expect byte-equality with what you sent.

For a saved-report link the type comes from the bookmark itself, so a `/app/insights#report/123` link whose bookmark is a funnel resolves as `funnels`. A trailing `~(...)` override segment on a saved-report link is ignored with a warning; the base params are returned.

::: info Browser note
A shortlink that answers with a `3xx` cannot be expanded from a browser (`fetch` hides redirect headers); the long-URL `200` form resolves everywhere.
:::

## Run a resolved report

`queryReportLink` dispatches on the report type to `query`, `queryFunnel`, `queryRetention`, or `queryFlow` and returns the matching typed result (`QueryResult`, `FunnelQueryResult`, `RetentionQueryResult` or `FlowQueryResult` — narrow with `instanceof` or by `report_type`):

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
const url = "https://mixpanel.com/project/3/view/75/app/flows#report/8";
// ---cut---
const r = await ws.resolveReportLink("EBrV5bW2u9Mw");
const rows = (await ws.queryReportLink(r)).toRows(); // already resolved: no second fetch
const rows2 = (await ws.queryReportLink("EBrV5bW2u9Mw")).toRows(); // resolve and run in one call

const resolved = await ws.resolveReportLink(url);
if (resolved.report_type === "flows") {
  const result = await ws.queryReportLink(resolved, { mode: "paths" }); // else mode comes from params.chartType
}
```

A `launch-analysis` report resolves but cannot be run; `queryReportLink` throws `UnsupportedReportLinkError` (`UNSUPPORTED_REPORT_TYPE`).

A `ResolvedReport` remembers the region, project, and workspace it was resolved in. If you keep one across `ws.use({ project })` or `ws.use({ workspace })`, or hand it to a `Workspace` on another project, `queryReportLink` throws `ReportLinkScopeMismatchError` before it runs anything, the same check `resolveReportLink` applies to a URL. The workspace part applies only when the session has a pinned workspace and the report records one.

## Saved-report links without a network call

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
// ---cut---
ws.savedReportLink(123); // insights: .../app/insights#report/123
ws.savedReportLink(456, { report_type: "funnels" }); // .../app/funnels#view/456
ws.savedReportLink(8, { report_type: "flows", workspace_id: 75 });
```

`savedReportLink` is synchronous and pure. The singular `"funnel"` that `SavedReportResult.report_type` reports is accepted and normalized to `"funnels"`. A zero or negative `bookmark_id` or `workspace_id` throws `ParamValidationError` (`RL6_INVALID_ID`).

## When resolution fails

| Situation                                                                | Error / code                                                      | What to do                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The link names another project                                           | `ReportLinkScopeMismatchError` / `REPORT_LINK_PROJECT_MISMATCH`   | Switch: `await ws.use({ project: "3" })`. The record was not fetched. For a full URL or a bare slug no network call was made; for a shortlink the one redirect GET had to run first.                                                                                                                                                                                                                                       |
| The link host is another region                                          | `ReportLinkScopeMismatchError` / `REPORT_LINK_REGION_MISMATCH`    | Use an account for that region: `await ws.use({ account: "NAME" })`. No network call was made, for shortlinks too.                                                                                                                                                                                                                                                                                                         |
| The link names a workspace and your session is pinned to a different one | `ReportLinkScopeMismatchError` / `REPORT_LINK_WORKSPACE_MISMATCH` | Switch: `await ws.use({ workspace: 75 })`. Query requests carry the pinned workspace, so a different data view would change the results. An unpinned session accepts any link. `queryReportLink` runs under exactly the scope the report records — the URL `wid`, or the pin at resolve time, or project-wide — and never injects the current pin, so a pin cleared or set after resolve time cannot change the data view. |
| A saved-report link 404s while a workspace is pinned                     | `ReportLinkNotFoundError` / `REPORT_LINK_BOOKMARK_NOT_FOUND`      | The lookup was workspace-scoped, so the report may live in a sibling workspace of the same project. The message names the pinned workspace; switch or unpin and retry.                                                                                                                                                                                                                                                     |
| The hash starts with `~(`                                                | `UnsupportedReportLinkError` / `UNSUPPORTED_LEGACY_HASH`          | Open the link in a browser. The app re-issues a slug on load; copy the new URL.                                                                                                                                                                                                                                                                                                                                            |
| The link is a board                                                      | `UnsupportedReportLinkError` / `UNSUPPORTED_DASHBOARD_LINK`       | `ws.getDashboard(ID)` lists its reports; resolve one report link. A board URL that carries `edited-bookmark=<slug>` resolves that slug.                                                                                                                                                                                                                                                                                    |
| The slug is unknown here                                                 | `ReportLinkNotFoundError` / `REPORT_LINK_SLUG_NOT_FOUND`          | A slug is readable only in the project and region that created it.                                                                                                                                                                                                                                                                                                                                                         |
| The shortlink redirects to another shortlink                             | `ShortLinkResolutionError` / `SHORT_LINK_CHAIN`                   | Resolve the target shortlink directly. Headless follows one redirect only.                                                                                                                                                                                                                                                                                                                                                 |
| The shortlink redirects to the login page                                | `AuthenticationError`                                             | The credentials cannot see the shortlink.                                                                                                                                                                                                                                                                                                                                                                                  |

Every error in the family extends `ReportLinkError` and carries the parsed link parts plus a `hint` in `details`:

```ts twoslash
import {
  ReportLinkError,
  ReportLinkScopeMismatchError,
} from "@mixpanel-headless/core";
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
// ---cut---
try {
  await ws.resolveReportLink(
    "https://eu.mixpanel.com/project/9/app/insights#EBrV5bW2u9Mw",
  );
} catch (error) {
  if (error instanceof ReportLinkScopeMismatchError) {
    console.error(error.code, error.details["hint"]);
  } else if (error instanceof ReportLinkError) {
    console.error(error.code, error.message);
  } else {
    throw error;
  }
}
```

The pure URL builders and the `createReportLink` input guards throw `ParamValidationError` (codes `RL1` through `RL6`; `RL6_INVALID_ID` rejects a zero or negative project, workspace, or bookmark id), not a `ReportLinkError`. They fire before any network call.

The parser tolerates surrounding whitespace, a trailing slash before or after `#`, a query string before `#` or a `?` tail after the slug or `report/{id}` hash, an upper-case host, a missing scheme, `http` as well as `https` (no other scheme), a percent-encoded `#` (no other escape is decoded), the legacy `/report/{pid}/` path form, and `mixpanel.org`.

## Out of scope

- Typed decompile of params into `Metric` / `Filter` / `GroupBy` objects.
- Decode of legacy `~(...)` JSURL hashes.
- Creation of shortlinks. The Mixpanel server allows this only from a browser session.
- Merge of stored overrides into params.
- Any change to how saved reports are created or edited.

## Next Steps

- [Insights Queries](/guide/query) — build the params you want to share
- [Live Analytics](/guide/live-analytics) — the legacy query endpoints
- [Error Handling](/guide/error-handling) — the `ReportLinkError` family
