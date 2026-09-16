# @mixpanel-headless/node

## 0.2.0

### Minor Changes

- 7fa773e: Export the types that public signatures already named but the barrels did not
  carry, so a consumer can annotate what the facade accepts and returns and every
  `{@link}` in the generated reference resolves.

  `@mixpanel-headless/core` gains:

  - Facade inputs and results: `Row`, `WhereInput`, `FilterWhereInput`,
    `GroupByInput`, `EventsInput`, `ParamsDict`, `TodayFn`, `FlowMode`,
    `SavedReportBookmarkType`, `FlowGraph` (with `FlowGraphNode`,
    `FlowGraphEdge`), `AnyTreeNode`, `SchemaGraph` (with `SchemaGraphNode`,
    `SchemaGraphEdge`, `SchemaGraphNodeKind`), `ReplayActionLabel`,
    `CountingType`, `DayWeekMonth`, `LiveActivityFeedOptions`,
    `LiveQuerySavedReportOptions`, `StreamEventsOptions`,
    `StreamProfilesOptions`, `ExportEventsOptions`, `ExportProfilesOptions`,
    `ModelDumpOptions`, `FilterValueInput`, `ToNativeJsonOptions`.
  - Accounts namespace option bags and callbacks: `AccountsAddOptions`,
    `AccountsUpdateOptions`, `AccountsLoginOptions`, `ExportBridgeOptions`,
    `ProgressFactory`, `ProgressHandle`, `ProjectPicker`.
  - Injection seams: `WarningSink`, `DiscoveryLogger`, `ResolverSeams`
    (with `ResolveSessionArgs`, `ResolveProjectAxisArgs`), `RetryLogger`,
    `RandomSource`.
  - The CPython-twin errors public methods document throwing: `ValueError`
    (`query`, `queryFunnel`, `queryRetention`, `runParams`, …),
    `OverflowError` (`pythonFloatCoerce`) and `KeyError`
    (`CohortCriteria.hasProperty`).

  `ClientCore` moves from the public entry to `@mixpanel-headless/core/internal`
  (its own contract says it is not semver-stable); `ValueError`, `EventsInput`
  and `LiveActivityFeedOptions` move the other way. The low-level
  `MixpanelClient` endpoint members whose per-endpoint option bags stay
  unexported are now tagged `@internal`, which only affects the generated
  reference.

  `@mixpanel-headless/node` gains its injection seams: `AtomicWriteOptions`,
  `AtomicWriteFsOps`, `StdinReadSync`, `EnsureClientRegisteredOptions` and
  `StartCallbackServerOptions`.

### Patch Changes

- Updated dependencies [a7be79c]
- Updated dependencies [7fa773e]
  - @mixpanel-headless/core@0.2.0

## 0.1.0

Initial release (not yet published; the manifests carry `"private": true`
until the owner flips them — `CONTRIBUTING.md`, "Releasing").

- `createNodeWorkspace()` and the resolver sources that read `~/.mp/config.toml`
  (shared with the Python `mp` CLI), the `MP_*` environment variables and the
  bridge file.
- OAuth (PKCE) login with a loopback callback and a paste fallback, on-disk
  token storage and refresh, the `/me` cache.
- `accounts` / `session` / `targets` management namespaces and `loginUnified`.
- Streaming Export API (`streamEvents`, `streamProfiles`).
