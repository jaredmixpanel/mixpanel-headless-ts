/**
 * Barrel for the result dataclass ports (phase2-design C1/C6, packet
 * P2-6).
 *
 * The class names are the public `__all__` surface; the `*Fields`
 * constructor-bag types ride along for callers. `result-base.ts` is
 * `@internal` plumbing and never barrel-exported; `ReplayActionLabel`
 * mirrors a module-private Python literal (`_REPLAY_ACTION_LITERAL`
 * is NOT in `__all__`) and stays a module-level export of
 * `replays.ts` only.
 */

export {
  BookmarkInfo,
  type BookmarkInfoFields,
  FunnelInfo,
  type FunnelInfoFields,
  LexiconDefinition,
  type LexiconDefinitionFields,
  LexiconMetadata,
  type LexiconMetadataFields,
  LexiconProperty,
  type LexiconPropertyFields,
  LexiconSchema,
  type LexiconSchemaFields,
  ProfilePageResult,
  type ProfilePageResultFields,
  SavedCohort,
  type SavedCohortFields,
  SchemaGraphResult,
  type SchemaGraphResultFields,
  SubPropertyInfo,
  type SubPropertyInfoFields,
  TopEvent,
  type TopEventFields,
} from "./discovery.js";
export {
  ActivityFeedResult,
  type ActivityFeedResultFields,
  CohortInfo,
  type CohortInfoFields,
  EventCountsResult,
  type EventCountsResultFields,
  FlowsResult,
  type FlowsResultFields,
  FrequencyResult,
  type FrequencyResultFields,
  FunnelResult,
  type FunnelResultFields,
  FunnelResultStep,
  type FunnelResultStepFields,
  NumericAverageResult,
  type NumericAverageResultFields,
  NumericBucketResult,
  type NumericBucketResultFields,
  NumericSumResult,
  type NumericSumResultFields,
  PropertyCountsResult,
  type PropertyCountsResultFields,
  RetentionResult,
  type RetentionResultFields,
  SavedReportResult,
  type SavedReportResultFields,
  SegmentationResult,
  type SegmentationResultFields,
  UserEvent,
  type UserEventFields,
} from "./live-query.js";
export {
  FlowQueryResult,
  type FlowQueryResultFields,
  FlowTreeNode,
  type FlowTreeNodeFields,
  FunnelQueryResult,
  type FunnelQueryResultFields,
  QueryResult,
  type QueryResultFields,
  RetentionQueryResult,
  type RetentionQueryResultFields,
  type UserQueryMode,
  UserQueryResult,
  type UserQueryResultFields,
} from "./query-engine.js";
export {
  Replay,
  ReplayBundle,
  type ReplayBundleFields,
  ReplayEvent,
  type ReplayEventFields,
  type ReplayFields,
  ReplaySummary,
  type ReplaySummaryFields,
  SignedReplay,
  type SignedReplayFields,
  UserAction,
  type UserActionFields,
} from "./replays.js";
export type {
  FlowEdge,
  FlowStepNode,
  FunnelStepData,
  QueryMeta,
  RetentionCohortData,
} from "./typed-dicts.js";
