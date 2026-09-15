---
"@mixpanel-headless/core": minor
"@mixpanel-headless/node": minor
---

Export the types that public signatures already named but the barrels did not
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
