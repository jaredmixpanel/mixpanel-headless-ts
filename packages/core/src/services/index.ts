/**
 * The `services` module of @mixpanel-headless/core (D11 layout) —
 * Phase-3 B4-C2 populated the queries half (query-host + engage +
 * streaming wire methods and the `stream_events`/`stream_profiles`
 * facade wrappers); the B5 Discovery/LiveQuery services and B6 entity
 * facades land in later batches.
 */

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
