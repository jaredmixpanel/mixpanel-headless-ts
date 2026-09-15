---
title: Session Replay
description: "Discover a user's Mixpanel Session Replay recordings, fetch the raw rrweb event stream from the signed CDN, and project the sessions into analysis-ready rows plus an LLM-friendly action timeline."
---

# Session Replay

Discover a user's [Mixpanel Session Replay](https://docs.mixpanel.com/docs/session-replay) recordings, fetch the raw rrweb event stream from the signed CDN, and project the sessions into analysis-ready rows plus an LLM-friendly action timeline — all from TypeScript.

::: warning Run this from Node.js
The examples on this page use `createNodeWorkspace()`. Each replay materializes its full rrweb byte stream in memory and walks up to 500 CDN files in parallel, which is an extraction workload like [streaming](/guide/streaming). The replay methods live in `@mixpanel-headless/core`, so the browser package does not refuse them, but the signed-CDN walk is only exercised under Node.
:::

::: tip The high-leverage type is `ReplayBundle`
A `ReplayBundle` is a collection of replays with cross-session projections. A single `Replay` is conceptually a bundle of size one, and the API treats them the same way — every row projection available on a bundle is available on a replay.
:::

## When to Use It

Session replay answers "what did this user actually _do_?" — the click-by-click story behind an analytics number. Reach for it when you need to:

- Pull a specific user's recent sessions and read the timeline (`replaysForUser`).
- Correlate a tracked Mixpanel event with the on-screen actions around it (`include_mixpanel_events`).
- Rank the most-clicked elements, find rage-click bursts, or surface sessions with console errors across many replays.
- Export the raw rrweb stream to feed Mixpanel's JS player or your own tooling (`toRrwebPlayerJson`).

The surface is built on the same signed-CDN endpoints Mixpanel's own MCP server uses. It does **not** persist anything to disk — signed URLs are time-bounded bearer credentials handled in process.

## Getting Started

The one-call path — discover a user's replays, fetch them, and join the Mixpanel events that fired during each session:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

const bundle = await ws.replaysForUser("user-42", {
  from_date: "2025-01-01",
  to_date: "2025-01-31",
});

// One row per session: duration, action/click/error counts, entry/exit URL
console.table(bundle.toSessionsRows());

// The LLM-friendly action timeline for the first replay
console.log(bundle.replays[0]?.summaryMarkdown());
```

`replaysForUser` defaults `limit` to `20` (each replay materializes its full byte stream, so fetching is byte-heavy) and `include_mixpanel_events` to `true`. Raise `limit` deliberately, or drop to `listReplays` + `streamReplay` for large sweeps.

## Discovery

`listReplays` issues a single Insights query against `$mp_session_record` and returns lightweight [`ReplaySummary`](/reference/core/classes/ReplaySummary) handles (no bytes fetched). Discover by user and date window, or hydrate an explicit list of IDs:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
// ---cut---
// By user (from_date / to_date required)
const summaries = await ws.listReplays({
  distinct_id: "user-42",
  from_date: "2025-01-01",
  to_date: "2025-01-31",
  limit: 100,
});
for (const s of summaries) {
  console.log(s.replay_id, s.start_time, s.retention_days);
}

// Or hydrate explicit replay IDs (no distinct_id needed)
const byId = await ws.listReplays({
  replay_ids: ["0190ebde-d50d-71b1-804c-ec1b4a533ef9"],
});
```

An empty window returns an empty list — it never throws. Passing neither selector, both, or `distinct_id` without a date window throws `ParamValidationError`. Each summary carries the per-replay `retention_days` (read from `$mp_replay_retention_period`, defaulting to 30 with a warning when the property is absent) and `start_time` in Unix milliseconds.

## Fetching a Single Replay

`fetchReplay` signs the replay, walks the CDN files in parallel, runs the vendored rrweb analyzer, and returns a fully-materialized `Replay`:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
// ---cut---
const replay = await ws.fetchReplay("0190ebde-d50d-71b1-804c-ec1b4a533ef9", {
  include_mixpanel_events: true, // optional Mixpanel-event join
});

console.log(replay.duration_seconds); // 2769
console.log(replay.rrweb_events.length); // raw rrweb events
console.log(replay.summaryMarkdown()); // action timeline
console.log(replay.pagePath()); // navigation URL sequence

// Raw rrweb JSON, timestamp-sorted, ready for the rrweb JS player
const playerJson = replay.toRrwebPlayerJson();
```

Pass `retention_days` to skip the retention-discovery round trip when you already know it, and `distinct_id` to stamp the owning user onto the returned `Replay` (`replaysForUser` does this for you). `max_files` (default `500`) bounds the CDN walk and `cdn_concurrency` (default `50`) its parallelism.

### Streaming large recordings

For long sessions where you don't want the whole byte stream in memory at once, `streamReplay` yields rrweb events one at a time and re-signs transparently if the URL expires mid-walk:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
declare function process(event: Readonly<Record<string, unknown>>): void;
// ---cut---
for await (const event of ws.streamReplay(
  "0190ebde-d50d-71b1-804c-ec1b4a533ef9",
)) {
  process(event);
}
```

Set `re_sign_on_expiry: false` to fail with `SignedURLExpiredError` instead of re-signing.

### Fetching many replays

`fetchReplays` materializes a list of IDs in parallel (`concurrency`, default `4`, across replays; `cdn_concurrency` within each) and returns a `ReplayBundle`. A replay that 404s, stalls, or fails to parse is skipped and recorded on `bundle.failures` ([`ReplayFetchFailure`](/reference/core/interfaces/ReplayFetchFailure)); only an all-fail batch throws.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
// ---cut---
const bundle = await ws.fetchReplays(["r1", "r2", "r3"], {
  concurrency: 4,
  include_mixpanel_events: true,
});
for (const { replay_id, error } of bundle.failures) {
  console.warn(`skipped ${replay_id}: ${error.message}`);
}
```

## Row Projections

A [`ReplayBundle`](/reference/core/classes/ReplayBundle) (and a single [`Replay`](/reference/core/classes/Replay)) exposes long-format projections keyed by `replay_id`. Where Python exposes a pandas frame (`sessions_df`, `actions_df`, …) the port exposes a `to…Rows()` method returning plain objects plus a `…RowColumns()` method with the frame's column contract. `bundle.toRows()` defaults to the sessions rows.

| Projection         | Grain                                       | Key columns                                                                                                                                                                                          |
| ------------------ | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `toSessionsRows()` | one row per replay                          | `replay_id`, `distinct_id`, `start_time`, `end_time`, `duration_s`, `retention_days`, `n_events`, `n_actions`, `n_clicks`, `n_inputs`, `n_pages`, `n_errors`, `n_mp_events`, `entry_url`, `exit_url` |
| `toActionsRows()`  | one row per normalized action               | `replay_id`, `t`, `action`, `target_node_id`, `target_desc`, `description`, `url`, `metadata`                                                                                                        |
| `toEventsRows()`   | one row per raw rrweb event                 | `replay_id`, `t`, `type`, `source`, `mouse_type`, `target_node_id`, `url`, `raw`                                                                                                                     |
| `toMixpanelRows()` | one row per Mixpanel event in the window    | `replay_id`, `t`, `event_name`, `properties`                                                                                                                                                         |
| `toElementsRows()` | one row per `(target_desc, normalized_url)` | `target_desc`, `url`, `n_clicks`, `n_unique_replays`                                                                                                                                                 |

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
const bundle = await ws.replaysForUser("user-42", {
  from_date: "2025-01-01",
  to_date: "2025-01-31",
});
// ---cut---
// Count actions by type across the bundle — the console.table twin of a DuckDB group-by
const byAction = new Map<string, number>();
for (const row of bundle.toActionsRows()) {
  const action = String(row["action"]);
  byAction.set(action, (byAction.get(action) ?? 0) + 1);
}
console.table([...byAction].map(([action, count]) => ({ action, count })));
```

The `description` column on the actions rows is the analyzer's full human-readable phrase (`'Clicked button "Sign in"'`, `'Scrolled'`, `'Console error: …'`); `target_desc` is the bare element label. A single `Replay` adds `toErrorsRows()` (the console-error actions) and `clicksOnRows(predicate)`.

### UserAction

Each entry of `replay.actions` is a [`UserAction`](/reference/core/classes/UserAction):

```ts
action.timestamp; // Unix milliseconds
action.action; // ReplayActionLabel (below)
action.target_node_id; // DOM node id, or null
action.target_desc; // 'button "Sign in"'
action.url; // page URL at action time, or null
action.description; // 'Clicked button "Sign in"'
action.metadata; // analyzer extras
```

[`ReplayActionLabel`](/reference/core/type-aliases/ReplayActionLabel) is the closed set of labels the analyzer emits: `"click"`, `"input"`, `"scroll"`, `"navigate"`, `"select"`, `"console_error"`, `"viewport_resize"`, `"touch_start"`, `"media_interaction"`.

## The Action Timeline

`summaryMarkdown()` renders a compact, LLM-friendly timeline — one line per action as `{timestamp_seconds}: {description}`, with consecutive duplicate actions collapsed into a `(×N)` suffix so a re-rendering data grid doesn't flood the output:

```text
1779693081: Navigated to https://app.example.com/boards
1779693457: Focused mp-button "hor-ellipsis"
1779693459: Clicked div in li "Refresh Data"
1779693483: Scrolled (×3)
```

`bundle.summaryMarkdown()` concatenates the per-replay timelines with a totals header. `ws.analyzeReplay(id)` signs, fetches and renders in one call when the timeline is all you need:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
// ---cut---
const timeline = await ws.analyzeReplay("0190ebde-d50d-71b1-804c-ec1b4a533ef9");
console.log(timeline);
```

## Aggregations

Bundle-level aggregations return rows:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
const bundle = await ws.replaysForUser("user-42", {
  from_date: "2025-01-01",
  to_date: "2025-01-31",
});
// ---cut---
console.table(bundle.topClicks(10)); // target_desc, count — genuine clicks only
console.table(bundle.rageClicks({ threshold: 3, windowMs: 1000 })); // replay_id, t_start, target_desc, count
console.table(bundle.longPauses(10)); // replay_id, t_start, duration_s
const err = bundle.errorSessions(); // a NEW bundle of only the replays with console errors
```

`topClicks` (and `toElementsRows`) count **genuine clicks only** — a real user click fires both a `focused` and a `clicked` interaction, and counting both would double every click, so the focus-only interactions are excluded.

## Filters and Comparison

Filters return a **new** bundle (immutable semantics) — the original is untouched, so chains stay cheap:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
const bundle = await ws.replaysForUser("user-42", {
  from_date: "2025-01-01",
  to_date: "2025-01-31",
});
// ---cut---
// Sessions that visited /checkout AND lasted longer than 60s
const checkout = bundle
  .where({ contains_url: "/checkout" })
  .filter((r) => r.duration_seconds > 60);

// Deterministic sample for manual review (CPython `random.Random(42)` parity)
for (const r of checkout.sample(3, 42).replays) {
  console.log(r.summaryMarkdown().slice(0, 200), "…");
}

// Sessions whose action labels contain a contiguous sub-sequence
const matched = bundle.findPattern(["click:button@/", "navigate:…@/checkout"]);

// Diff action frequencies between two cohorts of sessions
const converters = await ws.replaysForUser("user-99", {
  from_date: "2025-01-01",
  to_date: "2025-01-31",
});
console.table(bundle.compareRows(converters)); // action | self_count | other_count | delta
```

`where(...)` accepts `distinct_id`, `contains_url`, `has_event`, `min_duration_s`, and `max_duration_s`. `head(n)` keeps the first `n` replays. `findPattern` accepts a `labelFn` override — [`defaultLabelFn`](/reference/core/functions/defaultLabelFn), [`selectorLabelFn`](/reference/core/functions/selectorLabelFn) and [`urlNormalizer`](/reference/core/functions/urlNormalizer) are exported from `@mixpanel-headless/core`:

```ts twoslash
import { selectorLabelFn } from "@mixpanel-headless/core";
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
const bundle = await ws.replaysForUser("user-42", {
  from_date: "2025-01-01",
  to_date: "2025-01-31",
});
// ---cut---
// Prefer a stable selector attribute (default "data-testid") when the action carries one
const bySelector = bundle.findPattern(["click:checkout-button@/cart"], {
  labelFn: selectorLabelFn("data-testid"),
});
```

`sample(n, seed)` needs a seed: the core package has no entropy source of its own, so an unseeded call throws unless you pass 32-bit `entropy` words as the third argument.

## Correlating Mixpanel Events

`toMixpanelRows()` is populated when you fetch with `include_mixpanel_events: true` (the default for `replaysForUser`). It holds the tracked Mixpanel events that fired during each replay's time window — the analytics layer alongside the action layer:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
// ---cut---
const bundle = await ws.replaysForUser("user-42", {
  from_date: "2025-01-01",
  to_date: "2025-01-31",
  event_properties: ["$browser", "plan"], // up to 5 extra properties
});
console.table(bundle.toMixpanelRows()); // replay_id | t | event_name | properties
```

For a single replay or an explicit ID list, use `eventsForReplay(replayId)` / `eventsForReplays(replayIds)`; the batched form returns a `Map` from `replay_id` to its [`ReplayEvent`](/reference/core/classes/ReplayEvent) list:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
// ---cut---
const events = await ws.eventsForReplay(
  "0190ebde-d50d-71b1-804c-ec1b4a533ef9",
  {
    event_properties: ["$current_url"],
  },
);
for (const e of events) {
  console.log(e.event_time, e.event_name, e.properties);
}

const byReplay = await ws.eventsForReplays(["r1", "r2"], {
  from_date: "2025-01-01",
  to_date: "2025-01-31",
});
byReplay.get("r1")?.length;
```

More than 5 `event_properties` throws `ParamValidationError` before any request.

## Signed URLs and Security

Replay files live behind a time-bounded signed CDN URL (≈5-minute TTL). The query string is a **bearer credential**:

- [`SignedReplay`](/reference/core/classes/SignedReplay)`.toString()` masks the credential (`query_string='<redacted N chars>'`), and the library **never logs it** at any level.
- `signReplay` / `signReplays` return the handles; `fetchReplay` signs and fetches in one step.
- A 403 indicating the project's `SESSION_RECORDING_SENSITIVE_DATA` flag throws [`SessionReplayAccessError`](/reference/core/classes/SessionReplayAccessError) with the missing permission in `details`. An expired URL throws [`SignedURLExpiredError`](/reference/core/classes/SignedURLExpiredError); a replay absent from the CDN throws [`ReplayNotFoundError`](/reference/core/classes/ReplayNotFoundError). All three extend [`SessionReplayError`](/reference/core/classes/SessionReplayError).

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
// ---cut---
const signed = await ws.signReplay("0190ebde-d50d-71b1-804c-ec1b4a533ef9");
console.log(String(signed)); // SignedReplay(replay_id='…', url='…', query_string='<redacted N chars>', …)
signed.is_expired; // false while the ~5-minute TTL holds
```

`signed.toJSON()` **does** include the credential (with a leading `_warning` key) — it exists so you can hand the handle to a player; do not log it.

::: warning DOM text can carry PII
The analyzer's `target_desc` and `description` fields surface text that rrweb captured from the page — `aria-label`, `title`, `alt`, and visible element text. If a recorded page rendered personal data (e.g. a `"Welcome, Jane Doe"` heading), that text lands in the action rows, the markdown timelines, and anything you build from them (logs, files, LLM context). The library faithfully reflects what rrweb recorded — it does not scrub content — so treat analyzer output with the same care as the underlying recording, and rely on Mixpanel's recording-side masking to keep sensitive fields out of the capture in the first place.
:::

## See Also

- [Streaming Data](/guide/streaming) — the other Node-only extraction surface
- [Error Handling](/guide/error-handling) — the `SessionReplayError` family and its codes
- Reference: [`Workspace`](/reference/core/classes/Workspace), [`ReplayBundle`](/reference/core/classes/ReplayBundle), [`Replay`](/reference/core/classes/Replay), [`ReplaySummary`](/reference/core/classes/ReplaySummary), [`ReplayEvent`](/reference/core/classes/ReplayEvent), [`SignedReplay`](/reference/core/classes/SignedReplay), [`UserAction`](/reference/core/classes/UserAction)
- Option bags: [`WorkspaceReplaysForUserOptions`](/reference/core/interfaces/WorkspaceReplaysForUserOptions), [`WorkspaceListReplaysOptions`](/reference/core/interfaces/WorkspaceListReplaysOptions), [`WorkspaceFetchReplayOptions`](/reference/core/interfaces/WorkspaceFetchReplayOptions), [`WorkspaceFetchReplaysOptions`](/reference/core/interfaces/WorkspaceFetchReplaysOptions), [`WorkspaceStreamReplayOptions`](/reference/core/interfaces/WorkspaceStreamReplayOptions), [`WorkspaceEventsForReplayOptions`](/reference/core/interfaces/WorkspaceEventsForReplayOptions), [`WorkspaceSignReplayOptions`](/reference/core/interfaces/WorkspaceSignReplayOptions)
