---
title: Design
description: "How the TypeScript port is put together — the core/node/browser split, the isomorphic core with injected seams, the purity boundary, the service layering, the error model, models and serialisation, and how the Python design maps onto it."
---

# Design

The port keeps the Python library's layered architecture and adds one axis
Python does not have: the same code has to run in Node and in a browser. So
the single Python package becomes three, the file system and the environment
become injected seams, and a repository gate keeps the core free of anything
platform-specific.

## Layer diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                       Platform packages                              │
│   @mixpanel-headless/node        createNodeWorkspace, loginUnified,  │
│                                  accounts/session/targets,           │
│                                  ConfigManager, OAuthFlow, MeCache   │
│   @mixpanel-headless/browser     createBrowserWorkspace, beginLogin/ │
│                                  completeLogin, credential stores    │
└──────────────────────────────────────────────────────────────────────┘
                                  │  supplies fetch, env, config, fs,
                                  │  token resolver, storage, logger
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│                   Public API layer  (@mixpanel-headless/core)        │
│   Workspace · Session/Account types · resolveSession ·               │
│   createAccountsNamespace / createSessionNamespace /                 │
│   createTargetsNamespace · loginUnified                              │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│                          Service layer                               │
│   DiscoveryService · LiveQueryService · MeService · ReplaysService · │
│   the query-parameter engine · the entity wire factories             │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│                       Infrastructure layer                           │
│   createMixpanelClient (ClientCore) · fetch transport · backoff ·    │
│   lossless JSON · headers/URLs · response validation                 │
└──────────────────────────────────────────────────────────────────────┘
```

Python's CLI layer (Typer) has no counterpart: the port ships no CLI. The
Python `mp` command reads the same `~/.mp/config.toml`, so it remains the
interactive tool of choice next to a Node script.

## Three packages

| Package                      | Owns                                                                                                                                                                                                                                                                                           | Python counterpart                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `@mixpanel-headless/core`    | Everything that is pure computation over `fetch`: the `Workspace` facade, services, wire client, query engine, models, errors, auth types, the resolver and the account namespaces as factories over an injected effects bag, the Python-parity helpers.                                       | `mixpanel_headless` minus `_internal/config.py`, the on-disk halves of `_internal/auth/` and `cli/`            |
| `@mixpanel-headless/node`    | What touches a Node process: `process.env`, the TOML config file, per-account token files, the localhost OAuth callback server, the browser launcher, the bridge file, the on-disk `/me` cache, `node:fs` reads. Composes core's seams into `createNodeWorkspace()` and the namespace objects. | `_internal/config.py`, `_internal/auth/{flow,storage,token_resolver,bridge,callback_server}.py`, `me.py` cache |
| `@mixpanel-headless/browser` | What a page can safely do: bearer-token sessions, the redirect PKCE flow split into `beginLogin` / `completeLogin`, an injectable `CredentialStore`, and runtime refusals of service-account credentials and of the Export API. Same purity rules as core.                                     | none — new surface                                                                                             |

Core has zero runtime dependencies. Node and browser depend on core and add
nothing else. All three share one version and one changelog cadence.

## Isomorphic core, injected seams

Where Python reaches for `os.environ`, `Path.home()`, `httpx.Client`,
`time.monotonic()` or `random`, the core takes a function or an object.
Every seam has a default that either falls back to a web-standard global or
throws a coded error naming the seam, so a core-only construction fails
loudly rather than silently doing the wrong thing.

| Seam                                 | Where it is injected                                                                                                                                                     | Default in core                                          | Supplied by node                                        | Supplied by browser                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------- |
| Transport                            | [`MixpanelClientOptions`](/reference/core/interfaces/MixpanelClientOptions)`.fetch`                                                                                      | the global `fetch`                                       | global `fetch` (or `fetchImpl`)                         | global `fetch` (or `fetch`)                               |
| Clock                                | `MixpanelClientOptions.now`                                                                                                                                              | `() => new Date()`                                       | `now` option                                            | `now` option                                              |
| Sleep (retry backoff)                | `MixpanelClientOptions.sleep`                                                                                                                                            | `setTimeout`-backed                                      | same                                                    | same                                                      |
| Randomness (jitter)                  | `MixpanelClientOptions.random`                                                                                                                                           | `Math.random`                                            | same                                                    | same                                                      |
| OAuth token resolution               | `MixpanelClientOptions.tokenResolver`                                                                                                                                    | none — OAuth accounts throw `ParamTypeError`             | on-disk resolver with refresh                           | store-backed resolver, no refresh                         |
| Environment, config file, bridge     | [`WorkspaceOptions`](/reference/core/interfaces/WorkspaceOptions)`.sources` ([`ResolverSources`](/reference/core/interfaces/ResolverSources): `env`, `config`, `bridge`) | none — axis construction throws `UNPORTED_AUTH_SEAM`     | `process.env`, `ConfigManager`, `loadBridge`            | not exposed; only explicit `token` / `projectId`          |
| Account and target lookups for `use` | `WorkspaceOptions.seams` (`ResolverSeams`)                                                                                                                               | throw `UNPORTED_RESOLVER_SEAM`                           | real ones from the effects bag                          | core defaults                                             |
| `/me` cache                          | `WorkspaceOptions.meCache`                                                                                                                                               | per-account in-memory store                              | on-disk `MeCache`                                       | in-memory                                                 |
| File reads (`uploadLookupTable`)     | `WorkspaceOptions.readFile`                                                                                                                                              | throws `UNPORTED_FILE_READ_SEAM`                         | `node:fs`                                               | core default                                              |
| Monotonic clock (upload poll)        | `WorkspaceOptions.monotonic`                                                                                                                                             | `Date.now() / 1000`                                      | same                                                    | same                                                      |
| Logging and warnings                 | `WorkspaceOptions.logger`, `WorkspaceOptions.warn`                                                                                                                       | `NOOP_LOGGER` — every message dropped                    | warnings to stderr, as Python's last-resort handler     | `console.warn`-shaped logger                              |
| Alternate API hosts                  | `MixpanelClientOptions.endpointOverrides`                                                                                                                                | the live per-region hosts                                | `MP_API_BASE_URL` / `MP_APP_BASE_URL`, read per request | static bag on the factory options                         |
| Credential persistence               | [`CredentialStore`](/reference/core/interfaces/CredentialStore) (browser factories)                                                                                      | —                                                        | —                                                       | `InMemoryCredentialStore` / `LocalStorageCredentialStore` |
| Account management effects           | [`AuthEffects`](/reference/core/interfaces/AuthEffects) (namespace factories, `loginUnified`)                                                                            | `defaultAuthEffects` — every member throws its seam code | `createNodeAuthEffects()`                               | —                                                         |

A core-only `Workspace` is therefore built from a pre-resolved `Session` plus
whichever seams the caller wants to pin — which is also how the test suites
and the conformance runner drive it:

```ts twoslash
import { parseAccount, Workspace } from "@mixpanel-headless/core";

const ws = new Workspace({
  session: {
    account: parseAccount({
      type: "service_account",
      name: "ci",
      region: "us",
      username: "sa.demo",
      secret: "…",
    }),
    project: { id: "12345" },
    headers: new Map(),
  },
  clientOptions: {
    fetch: globalThis.fetch, // transport
    now: () => new Date("2026-01-15T12:00:00Z"), // "today" for date defaults
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    random: () => 0, // deterministic backoff jitter
  },
});

const result = await ws.query("Login", { math: "dau", last: 7 });
console.log(result.rowColumns());
```

[`createNodeWorkspace()`](/reference/node/functions/createNodeWorkspace) is
exactly this construction with the node seams filled in: it builds `ResolverSources` from `process.env`, the TOML file and
the bridge file, wires the on-disk token resolver, the on-disk `/me` cache,
`node:fs` reads and a stderr logger, then calls `new Workspace(...)`. The
[browser factories](/reference/browser/functions/createBrowserWorkspace) do the same with a `CredentialStore`-backed token resolver
and no resolver sources at all.

## Purity boundary and how it is enforced

`packages/core` and `packages/browser` must not import Node built-ins
(`node:*`, `fs`, `path`, `os`) or `undici`, and must not read the `process`
global. Configuration is injected (the contributor-facing statement is the
[Purity boundary](https://github.com/jaredmixpanel/mixpanel-headless-ts/blob/main/CONTRIBUTING.md#purity-boundary)
section of `CONTRIBUTING.md`). The rule is enforced three times:

1. **Lint.** `no-restricted-imports` forbids the built-ins and `undici` in
   both packages; `no-restricted-globals` forbids `process`. Every rule in
   the config is `error`, never `warn`.
2. **Bundle smoke.** The repository gate bundles both entry points with
   esbuild for `platform: "browser"` and fails on any Node dependency in the
   module graph — so a transitive slip is caught even when lint is not.
3. **Public-surface lock.** A repository test asserts that nothing tagged
   `@internal` is reachable from a package's `"."` entry, keeping the
   platform plumbing off the semver-stable surface.

The one place core needs a Node-specific hook — `util.inspect` redaction on
`Secret` — is reached through `Symbol.for("nodejs.util.inspect.custom")`, so
the module stays free of `node:util` and browsers simply never look the
symbol up.

## Components

### `Workspace` (facade)

[One class](/reference/core/classes/Workspace) carrying every public operation of the Python `Workspace`:

- **Session resolution.** Three independent axes — account, project,
  workspace — each resolved through `env → param → target → bridge → config`
  (account ends at `[active].account`, project at the account's
  `default_project`, workspace at `[active].workspace`). The resolver is a
  pure function over `ResolverSources`; an unresolvable axis raises
  `ConfigError` listing every fix path, and perturbing one axis never affects
  another.
- **In-session switching.** `ws.use({ account, project, workspace, target,
persist })` swaps in a new `Session` and returns the same facade for
  chaining. The wire client and the per-account `/me` cache survive the swap,
  so iterating projects is O(1) per turn.
- **Service orchestration.** `DiscoveryService`, `LiveQueryService`,
  `MeService` and `ReplaysService` are built lazily on first use and share
  the facade's client.
- **Entity CRUD and data governance.** Each method is a thin delegation into
  a `workspace-members/*` body, which calls the matching entity wire factory
  on the client; the facade never re-implements what a service does.
- **Lifecycle.** `await ws.close()` releases the client; `me()`, `projects()` and
  `workspaces()` read the cached `/me` response.

### Services

- **`DiscoveryService`** — Lexicon and bookmark parsing, subproperty
  inference over sampled values, and per-instance caching of list-shaped
  results for the service's lifetime (no TTL; `listTopEvents` and
  `listBookmarks` are deliberately not cached). Every `sorted(...)` is
  code-point ordered to match Python.
- **`LiveQueryService`** — the typed front door to the Query API's
  segmentation, funnel, retention, counts, activity-feed, saved-report,
  frequency and numeric endpoints. Each method calls the client, converts the
  lossless JSON tree to the shape `json.loads` would produce, and hands it to
  pure transform functions. Nothing is cached.
- **`MeService`** — a two-level `/me` cache (in-memory plus the injected
  store) and the project / workspace lookups the client's workspace
  auto-resolution reads through.
- **`ReplaysService`** — the session-replay pipeline: discover replays
  through an Insights query, sign them, walk the signed CDN files in parallel
  batches and yield raw rrweb events; the rrweb analyzer runs a layer above.
- **The query-parameter engine** — the insights, funnel, retention, flow and
  user-profile parameter builders behind `query*` / `run*Params` /
  `build*Params`, ported as free functions in guard order, over the argument
  validators and bookmark builders in `query/` and `bookmarks/`.
- **The entity wire factories** (`services/entities/*`) — one module per
  entity family, each exporting a `create<Domain>Methods(core)` factory that
  the client factory spreads into the assembled client.

### Infrastructure

- **`createMixpanelClient`** — the `MixpanelAPIClient` twin, assembled from
  an injectable transport rather than a class singleton: session axes,
  workspace scoping, `query_origin`, project-id injection, the retry loop and
  the public `request()` escape hatch. Per-call `AbortSignal`s are curried
  into signal-aware request and sleep closures; every cancellation exits as
  an `AbortError` `DOMException`.
- **Transport** — the `fetch` adapter that replaces httpx's wire layer:
  normalises every transport failure to one internal error type, sends with
  `redirect: "manual"` because httpx raises on 3xx where fetch would follow,
  and twins httpx's byte-level encoding of query strings, form bodies and
  JSON bodies with big integers.
- **Backoff** — exponential backoff with jitter through the injectable RNG,
  a verbatim (capped) `Retry-After`, shared by every retry loop and spoken in
  Python's seconds.
- **Lossless JSON** — an order-preserving parser
  ([`parseLossless`](/reference/core/functions/parseLossless)) whose
  numbers carry their exact source text
  ([`JsonNumber`](/reference/core/classes/JsonNumber)), so integers beyond
  2^53 and float spellings such as `18.0` survive the round trip; models
  convert with `toNativeJson` at the point of consumption.
- **[`ConfigManager`](/reference/node/classes/ConfigManager)** (node) — the TOML file at `~/.mp/config.toml`: account,
  target and `[active]` blocks, atomic writes, owner-only permissions. The
  same file and schema as the Python library, so one login serves both.

### The three-axis hierarchy

Unchanged from Python. **Account** is _who_ authenticates — `ServiceAccount`
(Basic auth), `OAuthBrowserAccount` (PKCE, tokens refreshed on disk by the
node package) or `OAuthTokenAccount` (static bearer for CI and agents), a
discriminated union on `type`. **Project** is _which project_ the calls run
against, living on the account as `default_project` and overridable per
call. **Workspace** is _which workspace inside the project_ — optional, lazily
resolved through `/me` on the first workspace-scoped call. A persisted
(account, project, optional workspace) bundle is a **target**, a named cursor
position. See [Accounts, sessions and targets](/guide/accounts-sessions-targets).

## Data paths

### Live query path

```
ws.query(...) → Workspace → query-parameter engine → MixpanelClient → Query API
                                                            ↓
                                        lossless JSON → typed result (QueryResult, …)
```

Best for real-time reads, one-off analysis and pre-computed Mixpanel
reports. The same path serves the legacy live queries through
`LiveQueryService`.

### Streaming path

```
ws.streamEvents(...) → Workspace → MixpanelClient → Export API (JSONL)
                                            ↓
                              async generator, one record at a time
```

Python generators port as `async function*`; argument guards fire on first
iteration exactly as in Python, and each line parses through the lossless
parser. Best for ETL to external systems and memory-constrained processing.

::: warning Node.js only
The Export API hosts serve no CORS headers, so `streamEvents` and
`streamProfiles` are refused in the browser before any network attempt
(`BROWSER_EXPORT_UNSUPPORTED`). Session replay fetching is Node-only as well.
See [Streaming](/guide/streaming) and [Session replay](/guide/session-replay).
:::

## Error model

Each Python exception class ports as an `Error` subclass with the same name,
the same parent edge and the same machine `code`; the parent edges and
default codes are generated from the Python-side contract artifact and
diffed against the live classes by a test.
[`MixpanelHeadlessError`](/reference/core/classes/MixpanelHeadlessError) is
the root: `code` and `details` are fixed at construction and exposed as
read-only getters, `toDict()` returns `{ code, message, details }`, and the
runtime `name` is the class name (so a minifying bundler must keep function
names). Class name plus `code` is the compatibility contract that the
conformance corpus asserts; message text is copied from Python but never
asserted. Internal transport failures (`httpx.HTTPError`'s twin) live outside
the hierarchy next to the retry loops and are mapped to public errors before
they surface. [Error handling](/guide/error-handling) lists the classes and
codes.

## Models and serialisation

- **Entity models** (`types/entities/*`) — each Pydantic model is a
  hand-written class extending one `EntityModel` base that owns the model
  boundary: required / default / nullable checks, lax scalar coercion,
  nested-model reconstruction, the per-class `extra` policy and the
  validation aliases. `fromDict()` validates (throwing
  `ResponseValidationError`); `modelDump()` / `modelDumpExcludeNone()` and
  `toJSON()` serialise. Fields keep Python's names in declaration order.
- **Result models** (`types/results/*`) — the frozen-dataclass twins. They do
  not coerce: a wrong JSON type is a `ResponseValidationError`. `toRows()`
  returns the rows Python builds before pandas and `rowColumns()` the frame's
  column list; pandas itself (NaN fill, dtype coercion, index objects) is
  outside the contract.
- **Query vocabulary** (`types/query-params/*`) — the pure builder classes
  (`Filter`, `Metric`, `FunnelStep`, …) that validate their inputs and
  serialise to bookmark params. They hold no session and reach no transport,
  which is why the browser entry point can re-export them as runtime values
  while exporting `Workspace` as a type only.
- **Literals** — Python `Literal[...]` aliases become unions plus a
  `*_VALUES` tuple for runtime membership; Python enums become `as const`
  objects. The port uses no TypeScript `enum` or `namespace`.
- **[`Secret`](/reference/core/classes/Secret)** — the `SecretStr` twin: an ECMAScript private field, invisible
  to `JSON.stringify`, spread and structured logging; every stringification
  renders Pydantic's ten-asterisk literal; the value is reachable only through
  `reveal()`.
- **Python-parity helpers** (`compat/*`) — `str()` / `repr()` rendering,
  float spelling, the CPython whitespace and printability tables (pinned to
  CPython 3.14.6 / Unicode 16.0 rather than the host engine's), `json.dumps`
  separators, `urllib.parse`. Anywhere library output text interpolates a
  value, it goes through these, so `18.0` stays `18.0` across languages.

## Key design decisions

- **Immutable session, O(1) swap.** A `Session` is resolved once at
  construction; `use()` replaces it atomically while the client and `/me`
  cache persist.
- **Dependency injection everywhere.** Services take the client; the client
  takes its transport, clock, sleep and RNG; the facade takes its sources,
  stores and loggers. That is what lets one code base serve Node, the
  browser, the unit tests, the conformance runner and the differential
  oracle.
- **Named exports only.** Core's public entry point lists every export by
  name under section headings; nothing is re-exported wholesale, and the
  browser barrel curates its re-exports the same way.
- **Strict compiler, explicit types.** `strict`, `exactOptionalPropertyTypes`,
  `noUncheckedIndexedAccess`, `isolatedDeclarations` and
  `verbatimModuleSyntax` are on for the library builds; every exported
  binding has an explicit type.
- **Bug-compatibility over cleanliness where behaviour is observable.** Where
  Python's behaviour is odd but visible, the port reproduces it and says so
  in a comment; deliberate differences are marked at the site and listed in
  [Porting](/architecture/porting).

## Technology stack

| Component    | Technology                               | Purpose                                                                              |
| ------------ | ---------------------------------------- | ------------------------------------------------------------------------------------ |
| Language     | TypeScript (strict, ESM, NodeNext)       | One code base for Node ≥ 22.12 and evergreen browsers                                |
| HTTP         | the platform `fetch`                     | Injected; no HTTP library dependency                                                 |
| Crypto       | WebCrypto (`SubtleCrypto`)               | PKCE challenge, slug minting                                                         |
| Validation   | hand-written model classes               | Pydantic and dataclass twins with the same error surface                             |
| Config       | TOML (node package)                      | `~/.mp/config.toml`, shared with the Python `mp` CLI                                 |
| Verification | conformance corpus + differential oracle | Behaviour locked to the Python implementation (see [Porting](/architecture/porting)) |

## Package structure

```
packages/core/src/
├── index.ts                 # Public exports, listed by name in eleven sections
├── internal.ts              # Plumbing for the platform packages and the rig (not semver-stable)
├── workspace.ts             # Workspace facade
├── workspace-members/       # Facade method bodies per entity family, option types
├── workspace-query-params.ts# The five query-parameter builders
├── errors.ts                # Exception hierarchy; errors-codes.gen.ts is the generated code table
├── secret.ts                # Secret (SecretStr twin)
├── coerce.ts                # Lax scalar coercion
├── auth/                    # Account/Session types, resolver, PKCE, OAuth HTTP, region probe, CredentialStore
├── accounts/                # AuthEffects contract; accounts/session/targets namespace factories; loginUnified
├── client/                  # createMixpanelClient, ClientCore, transport, backoff, headers, URLs, lossless JSON, /me
├── services/                # DiscoveryService, LiveQueryService, MeService, ReplaysService
│   ├── entities/            # One wire factory per App API entity family
│   └── queries/             # Query-host wire methods, streaming exports, Python date arithmetic
├── query/                   # Argument validators, selector builders, transforms
├── bookmarks/               # Bookmark param builders, schema sorting, inferBookmarkType
├── replays/                 # rrweb analyzer, UserAction, label functions
├── types/
│   ├── entities/            # EntityModel base and the App API models
│   ├── results/             # Result dataclasses
│   ├── query-params/        # Filter, Metric, GroupBy, FunnelStep, …
│   ├── literals.ts, enums.ts# Literal unions, *_VALUES tuples, enum objects
│   └── report-links.ts
└── compat/                  # CPython-parity helpers and generated Unicode tables

packages/node/src/
├── index.ts                 # createNodeWorkspace, loginUnified, accounts/session/targets, platform classes
├── workspace.ts             # createNodeWorkspace composition
├── auth-effects.ts          # The node AuthEffects bag
├── auth/                    # OAuthFlow, callback server, OAuthStorage, token resolver/store, bridge file
├── config/, config.ts       # ConfigManager (TOML)
├── env.ts                   # process.env readers, endpoint overrides
├── me-cache.ts              # On-disk /me cache
└── io-utils.ts, fs-seams.ts # Atomic writes, credential-path checks, node:fs reads

packages/browser/src/
├── index.ts                 # Factories, redirect flow, stores, curated core re-exports
├── client.ts                # browserSession, createBrowserWorkspace, createBrowserWorkspaceFromStore
├── redirect-flow.ts         # beginLogin / completeLogin
├── registration.ts          # Dynamic client registration
├── credential-store.ts      # InMemoryCredentialStore, LocalStorageCredentialStore
└── errors.ts                # BrowserUnsupportedError and its codes
```

## How the Python design maps

| Python                                                                    | TypeScript                                                                                                             |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `mixpanel_headless.Workspace()`                                           | `createNodeWorkspace()` (node) · `createBrowserWorkspace()` (browser) · `new Workspace({ session })` (core)            |
| `workspace.py`                                                            | `workspace.ts` + `workspace-members/*` + `workspace-query-params.ts`                                                   |
| `_internal/api_client.py` (`MixpanelAPIClient`, `httpx.Client`)           | `client/*` (`createMixpanelClient` over the `fetch` transport)                                                         |
| `_internal/auth/resolver.py` (reads `os.environ`, `ConfigManager()`)      | `auth/resolver.ts` (`resolveSession` over injected `ResolverSources`)                                                  |
| `_internal/config.py`                                                     | `@mixpanel-headless/node` `ConfigManager`                                                                              |
| `_internal/auth/{flow,callback_server,storage,token_resolver}.py`         | `@mixpanel-headless/node` `OAuthFlow`, `OAuthStorage`, on-disk token resolver; browser: `beginLogin` / `completeLogin` |
| `_internal/auth/{pkce,client_registration,token}.py`                      | `auth/pkce.ts`, `auth/oauth-http.ts`, `auth/token.ts` (WebCrypto)                                                      |
| `accounts.py`, `session.py`, `targets.py`                                 | `accounts/*` factories over `AuthEffects`; ready-made objects on the node entry point                                  |
| `_internal/services/{discovery,live_query,replays}.py`, `_internal/me.py` | `services/*`                                                                                                           |
| `exceptions.py`                                                           | `errors.ts` + generated `errors-codes.gen.ts`                                                                          |
| `types.py`, `auth_types.py`, `_literal_types.py`                          | `types/**`, `auth/*`, `types/literals.ts`                                                                              |
| Pydantic models / frozen dataclasses                                      | `EntityModel` subclasses / result classes with `toRows()`                                                              |
| `logging`, `warnings.warn`                                                | injected `logger` / `warn` seams (`NOOP_LOGGER` default)                                                               |
| `cli/`                                                                    | none — use the Python `mp` CLI; the config file is shared                                                              |
