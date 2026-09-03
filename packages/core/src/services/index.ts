/**
 * The `services` module of @mixpanel-headless/core (D11 layout) —
 * B5-S1 added the DiscoveryService (services/discovery.ts).
 * Phase-3 B4-C2 populated the queries half (query-host + engage +
 * streaming wire methods and the `stream_events`/`stream_profiles`
 * facade wrappers); B4-C3 added the entity-CRUD wire factories
 * (dashboards + bookmarks-v2 + cohorts-app); the B5 LiveQuery/Replays
 * services and the B6 entity facades land in later shards.
 */

export {
  DiscoveryService,
  inferScalarType,
  inferSubproperties,
  isValidIso,
  iterDictRows,
  parseBookmarkInfo,
  parseLexiconDefinition,
  parseLexiconMetadata,
  parseLexiconProperty,
  parseLexiconSchema,
  type DiscoveryLogger,
  type DiscoveryServiceOptions,
  type GetSchemaGraphOptions,
  type ListEventsOptions,
  type ListPropertyValuesOptions,
  type ListSchemasOptions,
  type ListSubpropertiesOptions,
  type ListTopEventsOptions,
  type ScalarSubValue,
  type WarningSink,
} from "./discovery.js";

export {
  createBookmarkMethods,
  type BookmarkMethods,
  type GetBookmarkHistoryOptions,
  type ListBookmarksV2Options,
} from "./entities/bookmarks.js";
export {
  createBookmarkUrlMethods,
  type BookmarkUrlMethods,
} from "./entities/bookmark-urls.js";
export {
  createCohortMethods,
  type CohortMethods,
  type ListCohortsAppOptions,
} from "./entities/cohorts.js";
export {
  createDashboardMethods,
  type DashboardMethods,
  type ListBlueprintTemplatesOptions,
  type ListDashboardsOptions,
} from "./entities/dashboards.js";

export {
  createEngageMethods,
  type EngageMethods,
  type EngageStatsOptions,
  type ExportProfilesPageOptions,
} from "./queries/engage.js";
export {
  buildActivityFeedDateRange,
  createQueryHostMethods,
  EVENTS_NAMES_MAX_LIMIT,
  EVENTS_NAMES_WIDE_FROM_DATE,
  type ActivityFeedOptions,
  type InlineQueryOptions,
  type QueryHostMethods,
  type QuerySavedReportOptions,
  type RetentionOptions,
  type SegmentationOptions,
} from "./queries/query-host.js";
export {
  createStreamingMethods,
  streamEvents,
  streamProfiles,
  validateLimit,
  type ExportEventsOptions,
  type ExportProfilesOptions,
  type StreamEventsOptions,
  type StreamProfilesOptions,
  type StreamingClient,
  type StreamingMethods,
} from "./queries/streaming.js";
