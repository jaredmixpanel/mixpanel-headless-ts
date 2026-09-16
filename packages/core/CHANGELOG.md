# @mixpanel-headless/core

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

- a7be79c: Stop sending `User-Agent` from the browser package: it is a Fetch forbidden
  request header, and Safari forwards it into the CORS preflight, where Mixpanel
  rejects it and every bearer-authenticated call fails. `MixpanelClientOptions`
  gains `getUserAgent` (`UserAgentSource`; `null` omits the header) — Node keeps
  sending the library value.

## 0.1.0

Initial release (not yet published; the manifests carry `"private": true`
until the owner flips them — `CONTRIBUTING.md`, "Releasing").

- The isomorphic port of the Python `mixpanel_headless` library: the
  `Workspace` facade, the five query engines (Insights, Funnels, Retention,
  Flows, User profiles), the query vocabulary (`Filter`, `Metric`, `GroupBy`,
  …), inline cohorts, report links, session-replay analysis, entity models and
  the coded error hierarchy.
- Zero Node dependencies; `fetch`, clocks, randomness and storage are
  injected.
- Behaviour verified against a corpus of vectors extracted from the Python
  implementation and a cross-language differential oracle (`PORTING.md`).
