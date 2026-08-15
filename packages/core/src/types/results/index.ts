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
  ActivityFeedResult,
  CohortInfo,
  EventCountsResult,
  FlowsResult,
  FrequencyResult,
  FunnelResult,
  FunnelResultStep,
  NumericAverageResult,
  NumericBucketResult,
  NumericSumResult,
  PropertyCountsResult,
  RetentionResult,
  SavedReportResult,
  SegmentationResult,
  UserEvent,
  type ActivityFeedResultFields,
  type CohortInfoFields,
  type EventCountsResultFields,
  type FlowsResultFields,
  type FrequencyResultFields,
  type FunnelResultFields,
  type FunnelResultStepFields,
  type NumericAverageResultFields,
  type NumericBucketResultFields,
  type NumericSumResultFields,
  type PropertyCountsResultFields,
  type RetentionResultFields,
  type SavedReportResultFields,
  type SegmentationResultFields,
  type UserEventFields,
} from "./live-query.js";
export {
  BookmarkInfo,
  FunnelInfo,
  LexiconDefinition,
  LexiconMetadata,
  LexiconProperty,
  LexiconSchema,
  ProfilePageResult,
  SavedCohort,
  SchemaGraphResult,
  SubPropertyInfo,
  TopEvent,
  type BookmarkInfoFields,
  type FunnelInfoFields,
  type LexiconDefinitionFields,
  type LexiconMetadataFields,
  type LexiconPropertyFields,
  type LexiconSchemaFields,
  type ProfilePageResultFields,
  type SavedCohortFields,
  type SchemaGraphResultFields,
  type SubPropertyInfoFields,
  type TopEventFields,
} from "./discovery.js";
export {
  FlowQueryResult,
  FlowTreeNode,
  FunnelQueryResult,
  QueryResult,
  RetentionQueryResult,
  UserQueryResult,
  type FlowQueryResultFields,
  type FlowTreeNodeFields,
  type FunnelQueryResultFields,
  type QueryResultFields,
  type RetentionQueryResultFields,
  type UserQueryMode,
  type UserQueryResultFields,
} from "./query-engine.js";
export {
  Replay,
  ReplayBundle,
  ReplayEvent,
  ReplaySummary,
  SignedReplay,
  UserAction,
  type ReplayBundleFields,
  type ReplayEventFields,
  type ReplayFields,
  type ReplaySummaryFields,
  type SignedReplayFields,
  type UserActionFields,
} from "./replays.js";
export type {
  FlowEdge,
  FlowStepNode,
  FunnelStepData,
  QueryMeta,
  RetentionCohortData,
} from "./typed-dicts.js";
