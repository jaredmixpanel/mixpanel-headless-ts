---
title: API overview
description: "The three packages, their entry points, the naming rules, the error and result contracts, and a map of the public surface into the generated reference."
---

# API overview

Mixpanel Headless for TypeScript ships as three ESM packages that share one
`Workspace` API. This page tells you which package to install, what each
entry point exports, how names translate from the Python library, and how
errors and results are shaped. The per-symbol documentation — every class,
function, option bag and literal union, generated from the source docblocks
— is the reference: [`@mixpanel-headless/core`](/reference/core/),
[`@mixpanel-headless/node`](/reference/node/) and
[`@mixpanel-headless/browser`](/reference/browser/).

## Which package do I need?

| Package                                             | Runtime         | What's inside                                                                                                                                                                                          |
| --------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`@mixpanel-headless/node`](/reference/node/)       | Node.js ≥ 22.12 | Everything for servers, scripts, and CI: config-file accounts (`~/.mp/config.toml`), env-var auth, programmatic OAuth login, and ready-made `accounts` / `session` / `targets` management. Start here. |
| [`@mixpanel-headless/browser`](/reference/browser/) | Browsers        | Bearer-token and redirect-PKCE auth, injectable credential storage, and a `Workspace` factory gated to browser-safe capabilities.                                                                      |
| [`@mixpanel-headless/core`](/reference/core/)       | Both            | The isomorphic engine: the `Workspace` facade, query builders, result types, and the error hierarchy. Zero Node dependencies — the platform packages wire it up for you.                               |

All three are ESM-only, ship their own TypeScript declarations
(`strict`-clean), and are released in lockstep with the same version number.
Code written against core runs unchanged in either environment; the platform
package only decides where credentials come from. See
[Installation](/getting-started/installation) for the package managers and
the runtime floor.

## Entry points

| Specifier                          | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@mixpanel-headless/core`          | The public, semver-stable surface. An explicit named-export list grouped by area (the map [below](#map-of-the-public-surface)); nothing is re-exported wholesale.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `@mixpanel-headless/node`          | The Node additions — [`createNodeWorkspace`](/reference/node/functions/createNodeWorkspace), [`loginUnified`](/reference/node/functions/loginUnified), the [`accounts`](/reference/node/variables/accounts) / [`session`](/reference/node/variables/session) / [`targets`](/reference/node/variables/targets) namespaces, [`ConfigManager`](/reference/node/classes/ConfigManager), [`OAuthFlow`](/reference/node/classes/OAuthFlow), [`OAuthStorage`](/reference/node/classes/OAuthStorage), [`MeCache`](/reference/node/classes/MeCache), the bridge-file functions and the seam factories — plus a re-export of core's `Workspace` class and `WorkspaceOptions` type so a Node script needs one import for the facade. The query vocabulary, entity models and error classes are imported from `@mixpanel-headless/core` (a dependency of the package). |
| `@mixpanel-headless/browser`       | The browser factories ([`browserSession`](/reference/browser/functions/browserSession), [`createBrowserWorkspace`](/reference/browser/functions/createBrowserWorkspace), [`createBrowserWorkspaceFromStore`](/reference/browser/functions/createBrowserWorkspaceFromStore)), the redirect PKCE flow ([`beginLogin`](/reference/browser/functions/beginLogin), [`completeLogin`](/reference/browser/functions/completeLogin)), the credential stores, plus a curated set of core re-exports a page needs at runtime: the full query vocabulary (`Filter`, `Metric`, `FunnelStep`, …), `validateBookmark`, `inferBookmarkType`, `pythonJsonDumpsCanonical`, `CreateAnnotationParams` and the whole error hierarchy. `Workspace` is exported as a **type only** — construction goes through the gated factories.                                              |
| `@mixpanel-headless/core/internal` | Plumbing the platform packages and the verification rig need beyond the public list (validators, bookmark builders, model bases, service classes). **Not semver-stable** — it may change in any release — and not documented on this site. Application code imports from `@mixpanel-headless/core` only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## Import patterns

The Python page's single `import mixpanel_headless as mp` becomes two imports
on Node — the platform package for the workspace, core for the vocabulary —
and one on the browser entry point.

::: code-group

```ts twoslash [Node.js]
import { createNodeWorkspace } from "@mixpanel-headless/node";
import {
  Filter,
  MixpanelHeadlessError,
  RateLimitError,
} from "@mixpanel-headless/core";

const ws = createNodeWorkspace(); // env → ~/.mp/config.toml → bridge file

try {
  const result = await ws.query("Login", {
    math: "dau",
    last: 30,
    where: Filter.equals("plan", "pro"),
  });
  console.table(result.toRows());
  console.log(result.rowColumns());
} catch (err) {
  if (err instanceof RateLimitError) {
    console.warn(err.code, err.retryAfter); // "RATE_LIMITED", seconds or null
  } else if (err instanceof MixpanelHeadlessError) {
    console.error(err.toDict()); // { code, message, details }
  } else {
    throw err;
  }
}
```

```python [Python]
import mixpanel_headless as mp
from mixpanel_headless import Filter, MixpanelHeadlessError, RateLimitError

ws = mp.Workspace()

try:
    result = ws.query("Login", math="dau", last=30, where=Filter.equals("plan", "pro"))
    print(result.df)
except RateLimitError as err:
    print(err.code, err.retry_after)
except MixpanelHeadlessError as err:
    print(err.to_dict())
```

:::

In the browser the vocabulary and the errors come from
`@mixpanel-headless/browser` itself:

```ts
import {
  createBrowserWorkspace,
  Filter,
  FunnelStep,
  MixpanelHeadlessError,
} from "@mixpanel-headless/browser";
```

See [In the browser](/guide/browser) for the two construction paths.

## Naming

The rule: **identifiers are camelCase, data is spelled the way Python spells
it.**

| Python                                   | TypeScript                                     | Rule                                                             |
| ---------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| `ws.query_funnel(…)`                     | `ws.queryFunnel(…)`                            | Methods are camelCase                                            |
| `Filter.starts_with(…)`                  | `Filter.startsWith(…)`                         | Static builders are camelCase                                    |
| `ws.query("Login", math="dau", last=90)` | `ws.query("Login", { math: "dau", last: 90 })` | Keyword args become an options object — **keys stay snake_case** |
| `Workspace(session=…)`                   | `new Workspace({ session, clientOptions })`    | Constructor and config option bags are camelCase                 |
| `result.df`                              | `result.toRows()` / `result.rowColumns()`      | Rows of plain objects instead of a DataFrame                     |
| `funnel.overall_conversion_rate`         | `funnel.overall_conversion_rate`               | Result, entity and param fields stay snake_case                  |

More precisely:

- **Per-call option bags mirror Python keyword arguments 1:1 in
  snake_case**: `ws.fetchReplay(id, { retention_days, cdn_concurrency })`
  takes
  [`WorkspaceFetchReplayOptions`](/reference/core/interfaces/WorkspaceFetchReplayOptions),
  the image of
  `Workspace.fetch_replay(replay_id, retention_days=…, cdn_concurrency=…)`.
  TypeScript-only additions to such a bag (`signal`, `onBatch`, `maxPages`)
  stay camelCase.
- **Constructor and config option bags are camelCase**:
  [`WorkspaceOptions`](/reference/core/interfaces/WorkspaceOptions),
  [`MixpanelClientOptions`](/reference/core/interfaces/MixpanelClientOptions),
  `OAuthFlowOptions`, `MeCacheOptions` and the browser factory options.
- **Data keeps Python's spelling**: entity, result and param fields, bookmark
  params, error `details`, and on-disk records (`default_project`,
  `token_env`).

Every option type is named after its method — `ws.queryRetention()` takes
[`WorkspaceRetentionQueryOptions`](/reference/core/interfaces/WorkspaceRetentionQueryOptions),
`ws.listDashboards()` takes
[`WorkspaceListDashboardsOptions`](/reference/core/interfaces/WorkspaceListDashboardsOptions)
— so the reference page for a method's options is one search away. The full
translation table, including the behavioral differences, is in
[Coming from Python](/guide/coming-from-python).

## Errors

Every error extends
[`MixpanelHeadlessError`](/reference/core/classes/MixpanelHeadlessError) and
carries a stable machine-readable `code`, a structured `details` bag
(snake_case keys, the wire spelling) and `toDict()`, which serializes to
[`{ code, message, details }`](/reference/core/interfaces/ErrorDict) exactly
as Python's `to_dict()` does. Branch on classes and codes, never on message
text — class name plus `code` is the compatibility contract; the message is
copied from Python for fidelity but may change.

The hierarchy mirrors the Python one class for class:
[`ParamValidationError`](/reference/core/classes/ParamValidationError)
(client-side, before any request), [`APIError`](/reference/core/classes/APIError)
and its children
([`AuthenticationError`](/reference/core/classes/AuthenticationError),
[`RateLimitError`](/reference/core/classes/RateLimitError) with `retryAfter`,
[`QueryError`](/reference/core/classes/QueryError),
[`ServerError`](/reference/core/classes/ServerError)),
[`ConfigError`](/reference/core/classes/ConfigError) and its account variants,
[`OAuthError`](/reference/core/classes/OAuthError),
[`ResponseValidationError`](/reference/core/classes/ResponseValidationError),
the report-link family and the session-replay family. Transient failures are
retried with exponential backoff before an error reaches you. The browser
package adds one class,
[`BrowserUnsupportedError`](/reference/browser/classes/BrowserUnsupportedError),
for its runtime refusals
([`BROWSER_SERVICE_ACCOUNT_REFUSED`](/reference/browser/variables/BROWSER_SERVICE_ACCOUNT_REFUSED),
[`BROWSER_EXPORT_UNSUPPORTED`](/reference/browser/variables/BROWSER_EXPORT_UNSUPPORTED),
[`BROWSER_NO_PENDING_LOGIN`](/reference/browser/variables/BROWSER_NO_PENDING_LOGIN)).

[Error handling](/guide/error-handling) has the full hierarchy and the code
table.

## Results

Python's result dataclasses expose a pandas `.df`; the port has no pandas, so
every result class exposes the rows Python builds _before_ the DataFrame:

- `toRows()` — the list of plain objects (`Record<string, unknown>`), one per
  row, in Python's order. `console.table(result.toRows())` is the `print(df)`
  twin.
- `rowColumns()` — the column names, in order; also the answer when there are
  no rows (Python's empty-frame columns).
- `toJSON()` — the raw payload fields, so `JSON.stringify(result)` works.

Fields keep their Python names and are `readonly` at the type level
(`funnel.overall_conversion_rate`, `users.distinct_ids`). Four classes
whose Python `.df` is not the uniform rows pattern expose `toRows()` variants
instead; their reference pages say so. Entity models (dashboards, bookmarks,
cohorts, flags, …) are the Pydantic twins: `fromDict()` validates a payload
(throwing `ResponseValidationError`), `modelDump()` / `modelDumpExcludeNone()`
serialize it the way `model_dump()` does.

## Map of the public surface

`@mixpanel-headless/core` lists every export by name under eleven section
headings; the reference groups the same symbols by kind
([classes](/reference/core/), functions, interfaces, type aliases,
variables). The headings, with the symbols you will meet most:

### Facade

[`Workspace`](/reference/core/classes/Workspace) — one class carrying every
operation: the five query engines (`query`, `queryFunnel`, `queryRetention`,
`queryFlow`, `queryUser`, each with `run*Params` / `build*Params`
companions), discovery (`events`, `properties`, `propertyValues`, `funnels`,
`cohorts`, `lexiconSchemas`, `schemaGraph`), live queries (`segmentation`,
`funnel`, `retention`, `eventCounts`, …), streaming (`streamEvents`,
`streamProfiles`), session replay (`listReplays`, `fetchReplay`,
`analyzeReplay`, …), report links, lifecycle (`use`, `close`, `me`,
`projects`, `workspaces`) and the entity CRUD families — dashboards,
bookmarks, cohorts, feature flags, experiments, annotations, webhooks, alerts,
Lexicon, drop filters, custom properties and events, lookup tables, schema
registry and enforcement, audits, anomalies, deletion requests, business
context. Each method's option bag is a `Workspace*Options` type
([`WorkspaceQueryOptions`](/reference/core/interfaces/WorkspaceQueryOptions),
[`WorkspaceUseOptions`](/reference/core/interfaces/WorkspaceUseOptions),
[`WorkspaceListDashboardsOptions`](/reference/core/interfaces/WorkspaceListDashboardsOptions),
…); [`WorkspaceOptions`](/reference/core/interfaces/WorkspaceOptions) is the
constructor bag and [`WorkspaceLogger`](/reference/core/interfaces/WorkspaceLogger)
/ [`NOOP_LOGGER`](/reference/core/variables/NOOP_LOGGER) the log seam.
[`validateBookmarkParamsSchema`](/reference/core/functions/validateBookmarkParamsSchema)
pre-flights a bookmark payload.

### Client

[`createMixpanelClient`](/reference/core/functions/createMixpanelClient) and
[`MixpanelClient`](/reference/core/interfaces/MixpanelClient) /
[`MixpanelClientOptions`](/reference/core/interfaces/MixpanelClientOptions) —
the wire client `Workspace` builds (or accepts injected), with its transport,
clock, sleep and RNG seams; [`ENDPOINTS`](/reference/core/variables/ENDPOINTS),
[`EndpointOverrides`](/reference/core/interfaces/EndpointOverrides) and
[`endpointOverridesFromEnv`](/reference/core/functions/endpointOverridesFromEnv)
for alternate hosts; the lossless JSON layer
([`parseLossless`](/reference/core/functions/parseLossless),
[`JsonNumber`](/reference/core/classes/JsonNumber),
[`JsonValue`](/reference/core/type-aliases/JsonValue),
[`toNativeJson`](/reference/core/functions/toNativeJson)) that keeps big
integers and float spelling exact; the `/me` models
([`MeResponse`](/reference/core/classes/MeResponse), `MeProjectInfo`,
`MeWorkspaceInfo`, `MeOrgInfo`); `getEntryPoint` / `setEntryPoint` for the
User-Agent tag.

### Errors, `Secret`, coercion

The error hierarchy described [above](#errors) with its option types
(`APIErrorOptions`, `RateLimitErrorOptions`, …) and
[`ErrorDict`](/reference/core/interfaces/ErrorDict);
[`Secret`](/reference/core/classes/Secret), the `SecretStr` twin that redacts
on every stringification path and reveals only through `.reveal()`; the lax
scalar coercers ([`coerceInt`](/reference/core/functions/coerceInt),
`coerceFloat`, `coerceBool`, `coerceStr`, `coerceInt64`,
`resolveWithDefault`).

### Entity models

The App API request and response models, one class per Python Pydantic model,
each with an `*Init` constructor type: accounts (`AccountSummary`, `Target`,
`OAuthLoginResult`), alerts, annotations, bookmarks
([`Bookmark`](/reference/core/classes/Bookmark), `CreateBookmarkParams`,
`BookmarkUrl`), business context, cohorts
([`Cohort`](/reference/core/classes/Cohort)), dashboards
([`Dashboard`](/reference/core/classes/Dashboard), `CreateDashboardParams`,
blueprints), data governance (`EventDefinition`, `DropFilter`,
`CustomProperty`, `CustomEvent`, `LookupTable`), experiments, feature flags,
Lexicon, schemas (`SchemaEntry`, `SchemaEnforcementConfig`, `AuditResponse`,
`DataVolumeAnomaly`, `EventDeletionRequest`), webhooks and the pagination
envelopes (`PaginatedResponse`, `CursorPagination`, `PublicWorkspace`).

### Result models

The typed results of every query family:
[`QueryResult`](/reference/core/classes/QueryResult),
[`FunnelQueryResult`](/reference/core/classes/FunnelQueryResult),
[`RetentionQueryResult`](/reference/core/classes/RetentionQueryResult),
[`FlowQueryResult`](/reference/core/classes/FlowQueryResult) (with
[`FlowTreeNode`](/reference/core/classes/FlowTreeNode)) and
[`UserQueryResult`](/reference/core/classes/UserQueryResult) from the five
engines; [`SegmentationResult`](/reference/core/classes/SegmentationResult),
[`FunnelResult`](/reference/core/classes/FunnelResult),
[`RetentionResult`](/reference/core/classes/RetentionResult),
`EventCountsResult`, `ActivityFeedResult`, `FrequencyResult`, the numeric
results and `SavedReportResult` from the live queries; the discovery results
([`TopEvent`](/reference/core/classes/TopEvent), `FunnelInfo`, `SavedCohort`,
`LexiconSchema`, [`SchemaGraphResult`](/reference/core/classes/SchemaGraphResult),
`ProfilePageResult`); the replay models (`Replay`, `ReplaySummary`,
[`ReplayBundle`](/reference/core/classes/ReplayBundle), `SignedReplay`,
[`UserAction`](/reference/core/classes/UserAction));
[`ReportLink`](/reference/core/classes/ReportLink) /
[`ResolvedReport`](/reference/core/classes/ResolvedReport); and the
plain-object shapes ([`QueryMeta`](/reference/core/interfaces/QueryMeta),
`FunnelStepData`, `RetentionCohortData`, `FlowEdge`, `FlowStepNode`).

### Query vocabulary

The builders you compose queries from:
[`Filter`](/reference/core/classes/Filter) (with
[`PropertyInput`](/reference/core/classes/PropertyInput),
[`CustomPropertyRef`](/reference/core/classes/CustomPropertyRef),
[`InlineCustomProperty`](/reference/core/classes/InlineCustomProperty),
[`ListItemGroupMode`](/reference/core/classes/ListItemGroupMode)),
[`Metric`](/reference/core/classes/Metric),
[`Formula`](/reference/core/classes/Formula),
[`GroupBy`](/reference/core/classes/GroupBy),
[`TimeComparison`](/reference/core/classes/TimeComparison),
[`CohortMetric`](/reference/core/classes/CohortMetric),
[`CohortBreakdown`](/reference/core/classes/CohortBreakdown),
[`CohortDefinition`](/reference/core/classes/CohortDefinition) /
[`CohortCriteria`](/reference/core/classes/CohortCriteria) (inline cohorts),
[`FunnelStep`](/reference/core/classes/FunnelStep),
[`Exclusion`](/reference/core/classes/Exclusion),
[`HoldingConstant`](/reference/core/classes/HoldingConstant),
[`RetentionEvent`](/reference/core/classes/RetentionEvent),
[`FlowStep`](/reference/core/classes/FlowStep),
[`FrequencyBreakdown`](/reference/core/classes/FrequencyBreakdown),
[`FrequencyFilter`](/reference/core/classes/FrequencyFilter). The
[Unified query system](/guide/unified-query-system) guide walks through them.

### Literal unions, membership tuples, enums

Every Python `Literal[...]` alias as a TypeScript union with a matching
`*_VALUES` tuple for runtime membership checks —
[`MathType`](/reference/core/type-aliases/MathType) /
[`MATH_TYPE_VALUES`](/reference/core/variables/MATH_TYPE_VALUES),
[`FilterOperator`](/reference/core/type-aliases/FilterOperator) /
[`FILTER_OPERATOR_VALUES`](/reference/core/variables/FILTER_OPERATOR_VALUES),
[`TimeUnit`](/reference/core/type-aliases/TimeUnit),
[`CountType`](/reference/core/type-aliases/CountType),
[`Region`](/reference/core/type-aliases/Region) /
[`REGION_VALUES`](/reference/core/variables/REGION_VALUES), the funnel,
retention and flow enumerations — plus the `as const` objects that stand in
for Python enums ([`ExperimentStatus`](/reference/core/variables/ExperimentStatus),
[`FeatureFlagStatus`](/reference/core/variables/FeatureFlagStatus),
[`WebhookAuthType`](/reference/core/variables/WebhookAuthType), …). The port
uses no TypeScript `enum`.

### Auth

The account and session types the resolver produces:
[`Account`](/reference/core/type-aliases/Account) (the discriminated union of
[`ServiceAccount`](/reference/core/interfaces/ServiceAccount),
[`OAuthBrowserAccount`](/reference/core/interfaces/OAuthBrowserAccount) and
[`OAuthTokenAccount`](/reference/core/interfaces/OAuthTokenAccount)),
[`Session`](/reference/core/interfaces/Session),
[`Project`](/reference/core/interfaces/Project),
[`WorkspaceRef`](/reference/core/interfaces/WorkspaceRef),
[`ActiveSession`](/reference/core/interfaces/ActiveSession), their parsers
([`parseAccount`](/reference/core/functions/parseAccount),
[`parseSession`](/reference/core/functions/parseSession), `parseProject`, …),
[`TokenResolver`](/reference/core/interfaces/TokenResolver),
[`resolveSession`](/reference/core/functions/resolveSession) with its
injected [`ResolverSources`](/reference/core/interfaces/ResolverSources)
(`env`, `config`, `bridge`), the OAuth primitives
([`PkceChallenge`](/reference/core/classes/PkceChallenge),
[`OAuthTokens`](/reference/core/classes/OAuthTokens), `buildAuthorizeUrl`,
`postTokenRequest`, `registerClient`, `parsePastedRedirect`,
[`OAUTH_BASE_URLS`](/reference/core/variables/OAUTH_BASE_URLS),
[`DEFAULT_SCOPE`](/reference/core/variables/DEFAULT_SCOPE)), the
[`CredentialStore`](/reference/core/interfaces/CredentialStore) interface
with [`CREDENTIAL_KEYS`](/reference/core/variables/CREDENTIAL_KEYS), and the
region probe ([`probeRegion`](/reference/core/functions/probeRegion),
`probeRegionForCredential`).

### Accounts

The management surface as pure factories over an injected
[`AuthEffects`](/reference/core/interfaces/AuthEffects) bag:
[`createAccountsNamespace`](/reference/core/functions/createAccountsNamespace),
[`createSessionNamespace`](/reference/core/functions/createSessionNamespace),
[`createTargetsNamespace`](/reference/core/functions/createTargetsNamespace),
[`loginUnified`](/reference/core/functions/loginUnified),
[`defaultAuthEffects`](/reference/core/functions/defaultAuthEffects) and the
effects contract types (`TokenStore`, `ConfigWrites`, `BridgeEffects`,
`OAuthFlowEffects`, …). `@mixpanel-headless/node` binds them to the file
system and exports the ready-made `accounts` / `session` / `targets`
objects — see
[Accounts, sessions and targets](/guide/accounts-sessions-targets).

### Query, replays and bookmarks helpers

The few public members of the otherwise internal engine modules:
[`validateBookmark`](/reference/core/functions/validateBookmark) (pre-flight a
params object), [`inferBookmarkType`](/reference/core/functions/inferBookmarkType)
(the report type a params object describes) and the replay label functions
([`defaultLabelFn`](/reference/core/functions/defaultLabelFn),
`selectorLabelFn`, `urlNormalizer`) that `analyzeReplay` accepts.

### Python-parity helpers

The `compat/` functions the port uses to produce byte-identical output and
that are useful on their own: [`pythonStr`](/reference/core/functions/pythonStr)
/ [`pythonRepr`](/reference/core/functions/pythonRepr),
[`pythonFloatStr`](/reference/core/functions/pythonFloatStr),
[`pythonInt`](/reference/core/functions/pythonInt) / `pythonFloat` and their
coercing variants, [`pythonJsonDumps`](/reference/core/functions/pythonJsonDumps)
/ [`pythonJsonDumpsCanonical`](/reference/core/functions/pythonJsonDumpsCanonical),
[`pythonStrip`](/reference/core/functions/pythonStrip),
[`zfill`](/reference/core/functions/zfill), the code-point helpers
(`cpLength`, `cpSlice`, `sortedByCodepoint`, …) and the `urllib.parse` twins
([`urlsplit`](/reference/core/functions/urlsplit), `urljoin`, `urlunsplit`).

### Node additions

[`createNodeWorkspace`](/reference/node/functions/createNodeWorkspace) /
[`NodeWorkspaceOptions`](/reference/node/interfaces/NodeWorkspaceOptions)
(Python's bare `Workspace()`),
[`loginUnified`](/reference/node/functions/loginUnified),
[`accounts`](/reference/node/variables/accounts),
[`session`](/reference/node/variables/session),
[`targets`](/reference/node/variables/targets);
[`createNodeAuthEffects`](/reference/node/functions/createNodeAuthEffects),
[`createNodeResolverSources`](/reference/node/functions/createNodeResolverSources),
[`createNodeWorkspaceSources`](/reference/node/functions/createNodeWorkspaceSources),
[`createNodeEnv`](/reference/node/functions/createNodeEnv),
[`createNodeEndpointOverrides`](/reference/node/functions/createNodeEndpointOverrides)
for callers composing their own wiring;
[`ConfigManager`](/reference/node/classes/ConfigManager) (the TOML file),
[`OAuthFlow`](/reference/node/classes/OAuthFlow) (PKCE with a localhost
callback), [`OAuthStorage`](/reference/node/classes/OAuthStorage),
[`MeCache`](/reference/node/classes/MeCache), the bridge-file functions
([`loadBridge`](/reference/node/functions/loadBridge),
[`exportBridge`](/reference/node/functions/exportBridge),
[`removeBridge`](/reference/node/functions/removeBridge),
[`parseBridgeFile`](/reference/node/functions/parseBridgeFile),
[`defaultBridgeSearchPaths`](/reference/node/functions/defaultBridgeSearchPaths)),
[`findAvailablePort`](/reference/node/functions/findAvailablePort) and
[`CredentialPathError`](/reference/node/classes/CredentialPathError).

### Browser additions

[`browserSession`](/reference/browser/functions/browserSession),
[`createBrowserWorkspace`](/reference/browser/functions/createBrowserWorkspace),
[`createBrowserWorkspaceFromStore`](/reference/browser/functions/createBrowserWorkspaceFromStore);
[`beginLogin`](/reference/browser/functions/beginLogin),
[`completeLogin`](/reference/browser/functions/completeLogin),
[`ensureBrowserClientRegistered`](/reference/browser/functions/ensureBrowserClientRegistered),
[`DEFAULT_MAX_PENDING_AGE_MS`](/reference/browser/variables/DEFAULT_MAX_PENDING_AGE_MS);
[`InMemoryCredentialStore`](/reference/browser/classes/InMemoryCredentialStore),
[`LocalStorageCredentialStore`](/reference/browser/classes/LocalStorageCredentialStore),
[`StorageLike`](/reference/browser/interfaces/StorageLike);
[`BrowserUnsupportedError`](/reference/browser/classes/BrowserUnsupportedError)
and its three codes;
[`serializeTokensPayload`](/reference/browser/functions/serializeTokensPayload)
/ `serializeClientInfoPayload`.

## Where to go next

- [Quickstart](/getting-started/quickstart) — authenticate and run the first
  query.
- [Design](/architecture/design) — how the packages, seams and services fit
  together.
- [Porting](/architecture/porting) — the pinned Python revision, what the
  conformance rig proves, and the known divergences.
