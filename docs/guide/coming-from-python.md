---
title: Coming from the Python library?
description: How the TypeScript port maps onto mixpanel_headless — three naming rules, results without pandas, and what is verified to behave identically.
---

# Coming from the Python library?

This is a faithful, behaviour-for-behaviour port of [`mixpanel_headless`](https://github.com/mixpanel/mixpanel-headless) — same concepts, same auth model, same config file, same query semantics. The [Python guides](https://mixpanel.github.io/mixpanel-headless/) apply directly; translate names with three rules.

## The three rules

| Python                                   | TypeScript                                     | Rule                                                             |
| ---------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| `ws.query_funnel(…)`                     | `ws.queryFunnel(…)`                            | Methods are camelCase                                            |
| `Filter.starts_with(…)`                  | `Filter.startsWith(…)`                         | Static builders are camelCase                                    |
| `ws.query("Login", math="dau", last=90)` | `ws.query("Login", { math: "dau", last: 90 })` | Keyword args become an options object — **keys stay snake_case** |
| `result.df`                              | `result.toRows()` / `result.rowColumns()`      | Rows of plain objects instead of a DataFrame                     |
| `funnel.overall_conversion_rate`         | `funnel.overall_conversion_rate`               | Result fields stay snake_case                                    |

The rule behind the table: **identifiers are camelCase, data is spelled the way Python spells it.**

- **Constructor and config option bags are camelCase**: `new Workspace({ session, clientOptions })` takes `WorkspaceOptions`; `MixpanelClientOptions`, `OAuthFlowOptions`, `MeCacheOptions` and the browser store options follow suit. So do methods, classes, functions and constants.
- **Per-call option bags mirror Python keyword arguments in snake_case**: `ws.fetchReplay(id, { retention_days, cdn_concurrency })` is the 1:1 image of `Workspace.fetch_replay(replay_id, retention_days=…, cdn_concurrency=…)`; likewise `ws.query("Login", { from_date, to_date })`. TypeScript-only additions to such a bag (`signal`, `onBatch`, `maxPages`) stay camelCase.
- **Data keeps Python's spelling**: entity, result and param fields (`funnel.overall_conversion_rate`), bookmark params, error `details`, and on-disk records (`default_project`, `token_env`).

The split lets Python code and the Python guides transliterate mechanically while everything that is "just JavaScript" reads like JavaScript.

## Constructing a workspace

Python's bare `Workspace()` reads the environment, `~/.mp/config.toml` and the bridge file implicitly. The core package is pure — no environment, no file system — so that wiring lives in a platform package:

::: code-group

```py [Python]
import mixpanel_headless as mp

ws = mp.Workspace()
ws = mp.Workspace(account="team", project="3713224")
ws = mp.Workspace(target="ecom")
```

```ts [TypeScript]
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
const team = createNodeWorkspace({ account: "team", project: "3713224" });
const ecom = createNodeWorkspace({ target: "ecom" });
```

:::

`createNodeWorkspace()` wires the resolver sources (env → config file → bridge), the on-disk OAuth token refresh and the `/me` cache in one call — exactly what `Workspace.__init__` does. In a browser, construction goes through `createBrowserWorkspace` / `createBrowserWorkspaceFromStore` from `@mixpanel-headless/browser` ([In the browser](/guide/browser)); `new Workspace({ session })` from `@mixpanel-headless/core` is for callers who already hold a resolved session.

## Queries and the vocabulary

The query vocabulary — `Filter`, `Metric`, `Formula`, `GroupBy`, `FunnelStep`, `FlowStep`, `RetentionEvent`, `TimeComparison`, `FrequencyBreakdown`, `CohortDefinition`, `CohortCriteria`, `CohortBreakdown` — is the same set of classes with the same fields. Two mechanical differences: builders take a single fields object instead of positional arguments, and `mp.Filter` becomes a named import.

::: code-group

```py [Python]
from mixpanel_headless import Filter, FunnelStep, Metric

result = ws.query(
    [Metric("Signup", math="unique"), Metric("Purchase", math="unique")],
    formula="(B / A) * 100",
    formula_label="Conversion Rate",
    last=90,
)

funnel = ws.query_funnel(
    [
        "Signup",
        FunnelStep("Purchase", filters=[Filter.greater_than("amount", 50)]),
    ],
    conversion_window=7,
    last=90,
)
```

```ts twoslash [TypeScript]
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { Filter, FunnelStep, Metric } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

const result = await ws.query(
  [
    new Metric({ event: "Signup", math: "unique" }),
    new Metric({ event: "Purchase", math: "unique" }),
  ],
  { formula: "(B / A) * 100", formula_label: "Conversion Rate", last: 90 },
);

const funnel = await ws.queryFunnel(
  [
    "Signup",
    new FunnelStep({
      event: "Purchase",
      filters: [Filter.greaterThan("amount", 50)],
    }),
  ],
  { conversion_window: 7, last: 90 },
);
```

:::

Every method that performs I/O returns a `Promise`; `await` it. Literal option values (`math: "dau"`, `retention_unit: "week"`, `sort_order: "descending"`) are the same strings Python accepts.

## Results without pandas

Python results expose a `.df` DataFrame. The port exposes `toRows()` — plain row objects, one per data point, with the same column names — and `rowColumns()`. Results whose Python `.df` is not the uniform rows pattern have named variants: flows have `toNodesRows()`, `toEdgesRows()` and `toTreesRows()` (Python's `nodes_df`, `edges_df`, `trees_df`).

::: code-group

```py [Python]
result = ws.query("Purchase", math="unique", group_by="country", last=30)
print(result.df.head())
print(result.df["count"].sum())

flow = ws.query_flow("Purchase", forward=3)
print(flow.nodes_df)
print(flow.edges_df)
```

```ts twoslash [TypeScript]
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();

const result = await ws.query("Purchase", {
  math: "unique",
  group_by: "country",
  last: 30,
});
console.table(result.toRows().slice(0, 5));
const total = result
  .toRows()
  .reduce((sum, row) => sum + Number(row["count"] ?? 0), 0);

const flow = await ws.queryFlow("Purchase", { forward: 3 });
console.table(flow.toNodesRows());
console.table(flow.toEdgesRows());
```

:::

Rows are `Record<string, unknown>` — index them with `row["count"]` and narrow the value yourself. Every result also has `toJSON()`, so `JSON.stringify(result)` gives the same shape Python's `to_dict()` does.

## Iteration and streaming

Python's generators become async iterators:

::: code-group

```py [Python]
for event in ws.stream_events(from_date="2026-01-01", to_date="2026-01-31"):
    send_to_warehouse(event)
ws.close()
```

```ts twoslash [TypeScript]
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

:::

::: warning Node.js only
Streaming (`streamEvents`, `streamProfiles`) and session replay fetching are Node-only; the browser package refuses them with a typed error. See [Streaming](/guide/streaming) and [Session replay](/guide/session-replay).
:::

## Exceptions become error classes

Every Python exception class ports as an `Error` subclass with the same name, the same parent, and the same machine `code`. `except` clauses become `instanceof` checks, `e.code` and `e.details` are unchanged, and `to_dict()` is `toDict()`:

::: code-group

```py [Python]
from mixpanel_headless import RateLimitError, MixpanelHeadlessError

try:
    ws.query("Purchase", last=30)
except RateLimitError as e:
    time.sleep(e.retry_after or 1)
except MixpanelHeadlessError as e:
    log.error(e.to_dict())
```

```ts twoslash [TypeScript]
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { MixpanelHeadlessError, RateLimitError } from "@mixpanel-headless/core";

const ws = createNodeWorkspace();
try {
  await ws.query("Purchase", { last: 30 });
} catch (err) {
  if (err instanceof RateLimitError) {
    await new Promise((r) => setTimeout(r, (err.retryAfter ?? 1) * 1000));
  } else if (err instanceof MixpanelHeadlessError) {
    console.error(err.toDict());
  } else {
    throw err;
  }
}
```

:::

Python-specific attribute names on the error object follow the camelCase rule (`retry_after` → `retryAfter`, `status_code` → `statusCode`); the `details` bag keeps snake_case keys. Where Python raises a bare `ValueError` / `TypeError` from a guard, the port generally does too; the few sites that raise a coded library error instead are listed in the divergence notes. The full hierarchy and code tables are in [Error handling](/guide/error-handling).

## Module namespaces

The `mp.accounts`, `mp.session` and `mp.targets` namespaces are named exports of `@mixpanel-headless/node`, with the same methods:

::: code-group

```py [Python]
import mixpanel_headless as mp

mp.accounts.use("staging")
mp.session.use(project="67890")
mp.targets.use("prod")
summary = mp.accounts.login_unified(region="us")
```

```ts twoslash [TypeScript]
import {
  accounts,
  loginUnified,
  session,
  targets,
} from "@mixpanel-headless/node";

accounts.use("staging");
session.use({ project: "67890" });
targets.use("prod");
const summary = await loginUnified({ region: "us" });
```

:::

Methods that only touch the config file are synchronous; anything that reaches the network or the token store returns a `Promise`. See [Accounts, sessions and targets](/guide/accounts-sessions-targets).

## What stays exactly the same

- **The config file.** `~/.mp/config.toml`, `~/.mp/accounts/{name}/tokens.json` and the bridge file are read and written in the same format with the same permissions — log in with either tool and both are authenticated ([Configuration](/getting-started/configuration)).
- **The environment variables.** `MP_USERNAME`, `MP_SECRET`, `MP_PROJECT_ID`, `MP_REGION`, `MP_OAUTH_TOKEN`, `MP_WORKSPACE_ID`, `MP_CONFIG_PATH`, `MP_OAUTH_STORAGE_DIR`, `MP_AUTH_FILE`, `MP_API_BASE_URL`, `MP_APP_BASE_URL` — same names, same precedence.
- **The wire.** Bookmark params, request bodies, headers and query-reference hashes are byte-identical, including Python's float formatting and `str()` rendering, so a report link minted by one implementation resolves in the other.
- **The semantics.** Date defaults (`last: 30`), the segment `limit` (1–50000, default 3000), retry timing on `429`, validation guards and their codes.

## No CLI

The port ships no `mp` command. Because the on-disk state is shared, the Python CLI is the CLI for both — install `mixpanel-headless` from PyPI and use [its command reference](https://mixpanel.github.io/mixpanel-headless/cli/) for `mp login`, `mp account …`, `mp target …` and friends. Where a Python doc page shows a `CLI` tab, read the `Python` tab and apply the three rules.

## Parity is verified, not aspirational

Every release replays a conformance corpus of **3,453 test vectors extracted from the Python implementation** — covering outputs, error class and code, and the exact HTTP requests made — with zero failures, and a cross-language differential oracle continuously fuzzes the two implementations against each other (28,091 examples, 0 divergences at the current pin). Even Python-specific rendering quirks (float formatting, `str()` semantics) are reproduced so results match byte for byte.

The port is pinned to one Python revision, and every known behavioural difference is written down against the TypeScript symbol that carries it. They fall into a few categories:

- **Numbers beyond 2<sup>53</sup>** — CPython integers are arbitrary precision; the port returns JS `number` and rejects anything beyond ±(2<sup>53</sup> − 1) with `PY_INT_UNSAFE_INTEGER` rather than rounding silently.
- **Integer-like object keys** — JavaScript hoists them to the front of an object; only key order differs, which the sorted-key canonical JSON does not see.
- **Error class or message only** — a handful of sites raise a coded library error where Python raises a bare `ValueError`, or word a message differently. Class and code are the contract; message text is not.
- **Clocks, timeouts and I/O seams** — `fetch` has no per-read timeout, so the port arms a wall clock; sleeps, clocks and randomness are injectable.
- **Node file system and OAuth callback** — permission tightening and symlink refusal on credential paths, the loopback callback server.
- **Browser** — no refresh-token grant, header-redirect shortlinks resolve only on Node, service-account credentials and the Export API are refused.
- **Runtime immutability** — entity instances are `readonly` at the type level, not frozen at runtime.

The list itself lives in one place so it cannot drift: [Porting](/architecture/porting) on this site, and [`PORTING.md`](https://github.com/jaredmixpanel/mixpanel-headless-ts/blob/main/PORTING.md) in the repository, which also states what the corpus and oracle do — and do not — prove.
