/**
 * The `Workspace` facade — TS port of `mixpanel_headless/workspace.py`.
 *
 * Phase-3 batch B5 splits this file three ways
 * (`context/phase3/design/b5-packets.md` §2): the class skeleton plus
 * the 22 query members (S2), the 12 discovery/lexicon members (S1) and
 * the 10 session-replay members (S3). Each shard owns ONE marked,
 * append-only section; B6 appends its own below them.
 *
 * SEQUENCING NOTE (B5-S1, recorded in `B5-S1-notes.md` §0): the packet
 * assigns the skeleton below to S2, but the orchestrator dispatched S1
 * first against the Phase-1 placeholder. S1 therefore built the §2
 * skeleton to the packet's contract, verbatim, and filled only its own
 * section. S2 EXTENDS this file — its marker is already in place — and
 * owns the `_live_query_service` accessor plus the `query`-bound
 * `_replays_service` accessor (`workspace.py:1012-1033`) that S3 needs.
 */

import type { Session } from "./auth/session.js";
import {
  createMixpanelClient,
  type MixpanelClient,
  type MixpanelClientOptions,
} from "./client/client.js";
import { toNativeJson, type JsonValue } from "./client/json-value.js";
import { pythonInt, pythonIntCoerce } from "./compat/python-int.js";
import { pythonRepr, type PythonValue } from "./compat/python-str.js";
import { zfill } from "./compat/zfill.js";
import { RrwebAnalyzer } from "./replays/rrweb-analyzer.js";
import {
  AuthenticationError,
  ParamValidationError,
  QueryError,
  RateLimitError,
  ServerError,
} from "./errors.js";
import { KeyError } from "./query/python-builtins.js";
import { transformProfile } from "./query/transforms.js";
import {
  DiscoveryService,
  isoUtc,
  type DiscoveryLogger,
  type WarningSink,
} from "./services/discovery.js";
import {
  LiveQueryService,
  type LiveActivityFeedOptions,
  type LiveEventCountsOptions,
  type LiveFrequencyOptions,
  type LiveFunnelOptions,
  type LiveNumericOptions,
  type LivePropertyCountsOptions,
  type LiveQuerySavedReportOptions,
  type LiveRetentionOptions,
  type LiveSegmentationNumericOptions,
  type LiveSegmentationOptions,
} from "./services/live-query.js";
import { ReplaysService, replayNotFoundError } from "./services/replays.js";
import {
  MeService,
  inMemoryMeCache,
  type MeCacheStore,
} from "./services/me.js";
import {
  streamEvents as streamEventsVeneer,
  streamProfiles as streamProfilesVeneer,
  type StreamEventsOptions,
  type StreamProfilesOptions,
} from "./services/queries/streaming.js";
import {
  getBusinessContext as getBusinessContextMember,
  getBusinessContextChain as getBusinessContextChainMember,
  guardTargetExclusivity,
  mergeResolverSeams,
  noProjectError,
  setBusinessContext as setBusinessContextMember,
  type BusinessContextHost,
  type BusinessContextScopeOptions,
  type ResolverSeams,
} from "./workspace-members/lifecycle.js";
export type {
  BusinessContextLevel,
  BusinessContextScopeOptions,
  ResolveProjectAxisArgs,
  ResolveSessionArgs,
  ResolverSeams,
} from "./workspace-members/lifecycle.js";
export type { MeCacheStore, MeService } from "./services/me.js";
import type { Account } from "./auth/account.js";
import type { Project, WorkspaceRef } from "./auth/session.js";
import type {
  BusinessContext,
  BusinessContextChain,
} from "./types/entities/business-context.js";
import type { PublicWorkspace } from "./types/entities/common.js";
import type { MeResponse } from "./client/me.js";
import type { BookmarkType, EntityType } from "./types/literals.js";
import type { CohortDefinition } from "./types/query-params/cohort.js";
import type { Filter } from "./types/query-params/filter.js";
import type { FlowStep } from "./types/query-params/flow.js";
import type {
  Exclusion,
  FunnelStep,
  HoldingConstant,
} from "./types/query-params/funnel.js";
import type { TimeComparison } from "./types/query-params/metric.js";
import type { RetentionEvent } from "./types/query-params/retention.js";
import type {
  BookmarkInfo,
  FunnelInfo,
  LexiconSchema,
  ProfilePageResult,
  SavedCohort,
  SchemaGraphResult,
  SubPropertyInfo,
  TopEvent,
} from "./types/results/discovery.js";
import type {
  ActivityFeedResult,
  EventCountsResult,
  FlowsResult,
  FrequencyResult,
  FunnelResult,
  NumericAverageResult,
  NumericBucketResult,
  NumericSumResult,
  PropertyCountsResult,
  RetentionResult,
  SavedReportResult,
  SegmentationResult,
} from "./types/results/live-query.js";
import {
  Replay,
  ReplayBundle,
  type ReplayEvent,
  type ReplaySummary,
  type SignedReplay,
} from "./types/results/replays.js";
import {
  UserQueryResult,
  type FlowQueryResult,
  type FunnelQueryResult,
  type QueryResult,
  type RetentionQueryResult,
} from "./types/results/query-engine.js";
import {
  buildPageKwargs,
  buildStatsKwargs,
  resolveAndBuildFlowParams,
  resolveAndBuildFunnelParams,
  resolveAndBuildParams,
  resolveAndBuildRetentionParams,
  resolveAndBuildUserParams,
  type EventsInput,
  type FilterWhereInput,
  type GroupByInput,
  type ParamsDict,
  type TodayFn,
  type WhereInput,
} from "./workspace-query-params.js";

/** Options bag of the {@link Workspace} constructor. */
export interface WorkspaceOptions {
  /** The RESOLVED session (account + project + optional workspace). */
  readonly session: Session;
  /**
   * Injected wire client — the test/replay seam mirroring Python's
   * `_api_client` kwarg (`workspace.py:424-432`; conformance twin
   * `conformance/runner/targets.py:316-328`). When absent the
   * constructor builds one from {@link clientOptions}.
   */
  readonly client?: MixpanelClient | undefined;
  /**
   * Extra options for the client the constructor builds when no
   * {@link client} is injected (transport, sleep/RNG/clock seams).
   */
  readonly clientOptions?: Omit<MixpanelClientOptions, "session"> | undefined;
  /** `warnings.warn` sink threaded into the discovery service (R9.5). */
  readonly warn?: WarningSink | undefined;
  /** Debug-log sink threaded into the discovery service (R9.5). */
  readonly logger?: WorkspaceLogger | undefined;
  /**
   * The W1-D1 resolution seams `use()` consumes. Absent members take
   * the `UNPORTED_RESOLVER_SEAM` defaults until B7 lands
   * (`workspace-members/lifecycle.ts`).
   */
  readonly seams?: Partial<ResolverSeams> | undefined;
  /**
   * The `/me` cache store handed to every {@link MeService} this
   * facade builds (Python `MeCache(account_name=…)`,
   * `workspace.py:874-876`). Absent → a per-account IN-MEMORY store;
   * B8-N2 injects the on-disk twin from `packages/node`.
   */
  readonly meCache?: ((accountName: string) => MeCacheStore) | undefined;
}

/** Keyword-only arguments of {@link Workspace.use} (`workspace.py:552-560`). */
export interface WorkspaceUseOptions {
  /** Replacement account name. */
  readonly account?: string | null | undefined;
  /** Replacement project ID. */
  readonly project?: string | null | undefined;
  /** Replacement workspace ID. */
  readonly workspace?: number | null | undefined;
  /** Apply this target's three axes atomically. */
  readonly target?: string | null | undefined;
  /** Also write the new state to `[active]`. Default `false`. */
  readonly persist?: boolean | undefined;
}

/** Keyword-only arguments of {@link Workspace.me}. */
export interface WorkspaceMeOptions {
  /** Bypass the cache and call the API. Default `false`. */
  readonly force_refresh?: boolean | undefined;
}

/** Keyword-only arguments of {@link Workspace.projects}. */
export interface WorkspaceProjectsOptions {
  /** Bypass the `/me` caches and refetch. Default `false`. */
  readonly refresh?: boolean | undefined;
}

/** Keyword-only arguments of {@link Workspace.workspaces}. */
export interface WorkspaceWorkspacesOptions {
  /** Project to list workspaces for. Defaults to the current project. */
  readonly project_id?: string | null | undefined;
  /** Bypass the `/me` caches and refetch. Default `false`. */
  readonly refresh?: boolean | undefined;
}

/**
 * Debug/warning log seam of the facade (R9.5 — `core` never touches
 * `console`). Extends the S1 {@link DiscoveryLogger} so an existing
 * `{debug}` sink keeps working; `warning` backs the two
 * `logger.warning` sites of the parallel query-user path
 * (`workspace.py:10143`, `:10178`).
 */
export interface WorkspaceLogger extends DiscoveryLogger {
  /**
   * Record a warning message.
   *
   * @param message - The formatted text (never vector-compared).
   */
  warning?(message: string): void;
}

/** Options bag of {@link Workspace.events}. */
export interface WorkspaceEventsOptions {
  /** Maximum events to return (client default: 5000). */
  readonly limit?: number | null | undefined;
  /** `YYYY-MM-DD` lower bound (client default: `2000-01-01`). */
  readonly from_date?: string | null | undefined;
  /** `YYYY-MM-DD` upper bound (client default: today). */
  readonly to_date?: string | null | undefined;
}

/** Options bag of {@link Workspace.propertyValues}. */
export interface WorkspacePropertyValuesOptions {
  /** Optional event to filter by. */
  readonly event?: string | null | undefined;
  /** Maximum number of values to return (default 100). */
  readonly limit?: number | undefined;
}

/** Options bag of {@link Workspace.subproperties}. */
export interface WorkspaceSubpropertiesOptions {
  /** Optional event name to scope the sample. */
  readonly event?: string | null | undefined;
  /** Number of raw values to sample (default 50). */
  readonly sample_size?: number | undefined;
}

/** Options bag of {@link Workspace.topEvents}. */
export interface WorkspaceTopEventsOptions {
  /** Counting method (default `"general"`). */
  readonly type?: "general" | "average" | "unique" | undefined;
  /** Maximum number of events to return. */
  readonly limit?: number | null | undefined;
}

/** Options bag of {@link Workspace.lexiconSchemas}. */
export interface WorkspaceLexiconSchemasOptions {
  /** Optional filter by type (`"event"` / `"profile"`). */
  readonly entity_type?: EntityType | null | undefined;
}

/** Options bag of {@link Workspace.schemaGraph}. */
export interface WorkspaceSchemaGraphOptions {
  /** Request the property-level `densityLocal`. */
  readonly include_density?: boolean | undefined;
  /** Also gather user properties (default `true`). */
  readonly include_user_properties?: boolean | undefined;
  /** Bypass the cache and re-fetch. */
  readonly force_refresh?: boolean | undefined;
}

// ---------------------------------------------------------------------------
// B5-S3 option bags (`workspace.py:10679-11292`)
// ---------------------------------------------------------------------------

/** Keyword-only arguments of {@link Workspace.listReplays}. */
export interface WorkspaceListReplaysOptions {
  /** Mixpanel user identifier. Mutually exclusive with `replay_ids`. */
  readonly distinct_id?: string | null | undefined;
  /** Explicit replay IDs to hydrate. Mutually exclusive with above. */
  readonly replay_ids?: readonly string[] | null | undefined;
  /** ISO date (`YYYY-MM-DD`). Required with `distinct_id`. */
  readonly from_date?: string | null | undefined;
  /** ISO date (`YYYY-MM-DD`). Required with `distinct_id`. */
  readonly to_date?: string | null | undefined;
  /** Maximum summaries to return. Default 100. */
  readonly limit?: number | undefined;
}

/**
 * Keyword-only arguments shared by {@link Workspace.eventsForReplay}
 * and {@link Workspace.eventsForReplays}.
 */
export interface WorkspaceEventsForReplayOptions {
  /** Up to 5 additional event properties to include as group keys. */
  readonly event_properties?: readonly string[] | null | undefined;
  /** ISO date (`YYYY-MM-DD`) lower bound for the events scan. */
  readonly from_date?: string | null | undefined;
  /** ISO date (`YYYY-MM-DD`) upper bound; paired with `from_date`. */
  readonly to_date?: string | null | undefined;
}

/**
 * Keyword-only arguments of {@link Workspace.signReplay} /
 * {@link Workspace.signReplays}.
 */
export interface WorkspaceSignReplayOptions {
  /** `"prod"` (default) or `"dev"`. */
  readonly env?: "prod" | "dev" | undefined;
}

/** Keyword-only arguments of {@link Workspace.fetchReplay}. */
export interface WorkspaceFetchReplayOptions {
  /** Optional user id to stamp on the returned `Replay`. */
  readonly distinct_id?: string | null | undefined;
  /** `"prod"` (default) or `"dev"`. */
  readonly env?: "prod" | "dev" | undefined;
  /** 1, 7, 30, or 90. Auto-discovered when absent. */
  readonly retention_days?: number | null | undefined;
  /** Hard upper bound on the CDN file walk. Default 500. */
  readonly max_files?: number | undefined;
  /** Follow with an events query and populate `mixpanel_events`. */
  readonly include_mixpanel_events?: boolean | undefined;
  /** Up to 5 extra properties for the Mixpanel join query. */
  readonly event_properties?: readonly string[] | null | undefined;
  /** Parallel batch size for CDN fetches. Default 50. */
  readonly cdn_concurrency?: number | undefined;
}

/** Keyword-only arguments of {@link Workspace.streamReplay}. */
export interface WorkspaceStreamReplayOptions {
  /** `"prod"` (default) or `"dev"`. */
  readonly env?: "prod" | "dev" | undefined;
  /** 1, 7, 30, or 90. Auto-discovered when absent. */
  readonly retention_days?: number | null | undefined;
  /** Hard upper bound on the CDN file walk. Default 500. */
  readonly max_files?: number | undefined;
  /** Re-sign once on a mid-walk 403. Default `true`. */
  readonly re_sign_on_expiry?: boolean | undefined;
  /** Parallel batch size for CDN fetches. Default 50. */
  readonly cdn_concurrency?: number | undefined;
}

/** Keyword-only arguments of {@link Workspace.fetchReplays}. */
export interface WorkspaceFetchReplaysOptions {
  /** `"prod"` (default) or `"dev"`. */
  readonly env?: "prod" | "dev" | undefined;
  /** Per-replay CDN bound. Default 500. */
  readonly max_files?: number | undefined;
  /** Join Mixpanel events (ONE batched query across all replays). */
  readonly include_mixpanel_events?: boolean | undefined;
  /** Up to 5 properties for the join. */
  readonly event_properties?: readonly string[] | null | undefined;
  /** Replay-level parallelism. Default 4. */
  readonly concurrency?: number | undefined;
  /** Per-replay CDN parallelism. Default 50. */
  readonly cdn_concurrency?: number | undefined;
  /** `{replay_id: retention_days}` so each fetch skips discovery. */
  readonly retention_by_id?:
    ReadonlyMap<string, number> | Readonly<Record<string, number>> | undefined;
  /** `{replay_id: distinct_id}` stamped on each fetched `Replay`. */
  readonly distinct_id_by_id?:
    ReadonlyMap<string, string> | Readonly<Record<string, string>> | undefined;
}

/** Keyword-only arguments of {@link Workspace.replaysForUser}. */
export interface WorkspaceReplaysForUserOptions {
  /** ISO date (`YYYY-MM-DD`). */
  readonly from_date: string;
  /** ISO date (`YYYY-MM-DD`). */
  readonly to_date: string;
  /** Maximum replays to fetch. Default 20 (byte-heavy per replay). */
  readonly limit?: number | undefined;
  /** Default `true` for this convenience method. */
  readonly include_mixpanel_events?: boolean | undefined;
  /** Up to 5 properties for the Mixpanel join. */
  readonly event_properties?: readonly string[] | null | undefined;
}

// ---------------------------------------------------------------------------
// B5-S2 option bags (`workspace.py:1583-4463` + `:9722-10256`)
// ---------------------------------------------------------------------------

/** Keyword-only arguments of {@link Workspace.segmentation}. */
export interface WorkspaceSegmentationOptions extends LiveSegmentationOptions {
  /** Start date (`YYYY-MM-DD`). */
  readonly from_date: string;
  /** End date (`YYYY-MM-DD`). */
  readonly to_date: string;
}

/** Keyword-only arguments of {@link Workspace.funnel}. */
export interface WorkspaceFunnelOptions extends LiveFunnelOptions {
  /** Start date (`YYYY-MM-DD`). */
  readonly from_date: string;
  /** End date (`YYYY-MM-DD`). */
  readonly to_date: string;
}

/** Keyword-only arguments of {@link Workspace.retention}. */
export interface WorkspaceRetentionOptions extends LiveRetentionOptions {
  /** Event that defines cohort entry. */
  readonly born_event: string;
  /** Event that defines return. */
  readonly return_event: string;
  /** Start date (`YYYY-MM-DD`). */
  readonly from_date: string;
  /** End date (`YYYY-MM-DD`). */
  readonly to_date: string;
}

/** Keyword-only arguments of {@link Workspace.eventCounts}. */
export interface WorkspaceEventCountsOptions extends LiveEventCountsOptions {
  /** Start date (`YYYY-MM-DD`). */
  readonly from_date: string;
  /** End date (`YYYY-MM-DD`). */
  readonly to_date: string;
}

/** Keyword-only arguments of {@link Workspace.propertyCounts}. */
export interface WorkspacePropertyCountsOptions extends LivePropertyCountsOptions {
  /** Start date (`YYYY-MM-DD`). */
  readonly from_date: string;
  /** End date (`YYYY-MM-DD`). */
  readonly to_date: string;
}

/** Keyword-only arguments of {@link Workspace.frequency}. */
export interface WorkspaceFrequencyOptions extends LiveFrequencyOptions {
  /** Start date (`YYYY-MM-DD`). */
  readonly from_date: string;
  /** End date (`YYYY-MM-DD`). */
  readonly to_date: string;
}

/** Keyword-only arguments of {@link Workspace.segmentationNumeric}. */
export interface WorkspaceSegmentationNumericOptions extends LiveSegmentationNumericOptions {
  /** Start date (`YYYY-MM-DD`). */
  readonly from_date: string;
  /** End date (`YYYY-MM-DD`). */
  readonly to_date: string;
  /** Numeric property expression. */
  readonly on: string;
}

/** Keyword-only arguments of the sum/average numeric members. */
export interface WorkspaceNumericOptions extends LiveNumericOptions {
  /** Start date (`YYYY-MM-DD`). */
  readonly from_date: string;
  /** End date (`YYYY-MM-DD`). */
  readonly to_date: string;
  /** Numeric property expression. */
  readonly on: string;
}

/**
 * Keyword-only arguments shared by {@link Workspace.query} and
 * {@link Workspace.buildParams} (`workspace.py:2285-2340`).
 */
export interface WorkspaceQueryOptions {
  /** Start date (`YYYY-MM-DD`). Overrides `last` when set. */
  readonly from_date?: string | null | undefined;
  /** End date (`YYYY-MM-DD`). Requires `from_date`. */
  readonly to_date?: string | null | undefined;
  /** Relative time range in days. Default `30`. */
  readonly last?: number | undefined;
  /** Time aggregation unit. Default `"day"`. */
  readonly unit?: string | undefined;
  /** Aggregation function for plain-string events. Default `"total"`. */
  readonly math?: string | undefined;
  /** Property name for property-based math. */
  readonly math_property?: unknown;
  /** Per-user pre-aggregation. */
  readonly per_user?: string | null | undefined;
  /** Custom percentile value (required when `math="percentile"`). */
  readonly percentile_value?: number | null | undefined;
  /** Breakdown specification. */
  readonly group_by?: GroupByInput;
  /** Filter conditions. */
  readonly where?: WhereInput;
  /** Formula expression referencing events by position (A, B, C…). */
  readonly formula?: string | null | undefined;
  /** Display label for the formula result. */
  readonly formula_label?: string | null | undefined;
  /** Rolling window size in periods. */
  readonly rolling?: number | null | undefined;
  /** Cumulative analysis mode. Default `false`. */
  readonly cumulative?: boolean | undefined;
  /** Result shape. Default `"timeseries"`. */
  readonly mode?: string | undefined;
  /** Optional period-over-period comparison. */
  readonly time_comparison?: TimeComparison | null | undefined;
  /** Optional data group ID. */
  readonly data_group_id?: number | null | undefined;
  /** Clock seam threaded into the time-section builder. */
  readonly today?: TodayFn | undefined;
}

/**
 * Keyword-only arguments shared by {@link Workspace.queryFunnel} and
 * {@link Workspace.buildFunnelParams} (`workspace.py:3064-3125`).
 */
export interface WorkspaceFunnelQueryOptions {
  /** Conversion window size. Default `14`. */
  readonly conversion_window?: number | undefined;
  /** Conversion window unit. Default `"day"`. */
  readonly conversion_window_unit?: string | undefined;
  /** Funnel step ordering mode. Default `"loose"`. */
  readonly order?: string | undefined;
  /** Start date (`YYYY-MM-DD`). */
  readonly from_date?: string | null | undefined;
  /** End date (`YYYY-MM-DD`). */
  readonly to_date?: string | null | undefined;
  /** Relative time range in days. Default `30`. */
  readonly last?: number | undefined;
  /** Time aggregation unit. Default `"day"`. */
  readonly unit?: string | undefined;
  /** Aggregation function. Default `"conversion_rate_unique"`. */
  readonly math?: string | undefined;
  /** Numeric property for property aggregation. */
  readonly math_property?: string | null | undefined;
  /** Breakdown specification. */
  readonly group_by?: GroupByInput;
  /** Filter conditions. */
  readonly where?: FilterWhereInput;
  /** Events to exclude. */
  readonly exclusions?: ReadonlyArray<string | Exclusion> | null | undefined;
  /** Properties to hold constant. */
  readonly holding_constant?:
    | string
    | HoldingConstant
    | ReadonlyArray<string | HoldingConstant>
    | null
    | undefined;
  /** Display mode. Default `"steps"`. */
  readonly mode?: string | undefined;
  /** Funnel reentry mode. */
  readonly reentry_mode?: string | null | undefined;
  /** Optional period-over-period comparison. */
  readonly time_comparison?: TimeComparison | null | undefined;
  /** Optional data group ID. */
  readonly data_group_id?: number | null | undefined;
  /** Clock seam. */
  readonly today?: TodayFn | undefined;
}

/**
 * Keyword-only arguments shared by {@link Workspace.queryFlow} and
 * {@link Workspace.buildFlowParams} (`workspace.py:3852-3877`).
 */
export interface WorkspaceFlowQueryOptions {
  /** Default forward step count. Default `3`. */
  readonly forward?: number | undefined;
  /** Default reverse step count. Default `0`. */
  readonly reverse?: number | undefined;
  /** Start date (`YYYY-MM-DD`). */
  readonly from_date?: string | null | undefined;
  /** End date (`YYYY-MM-DD`). */
  readonly to_date?: string | null | undefined;
  /** Relative time range in days. Default `30`. */
  readonly last?: number | undefined;
  /** Conversion window size. Default `7`. */
  readonly conversion_window?: number | undefined;
  /** Conversion window unit. Default `"day"`. */
  readonly conversion_window_unit?: string | undefined;
  /** Counting method. Default `"unique"`. */
  readonly count_type?: string | undefined;
  /** Number of top paths. Default `3`. */
  readonly cardinality?: number | undefined;
  /** Merge consecutive repeated events. Default `false`. */
  readonly collapse_repeated?: boolean | undefined;
  /** Events to hide from the visualization. */
  readonly hidden_events?: readonly string[] | null | undefined;
  /** Display mode. Default `"sankey"`. */
  readonly mode?: string | undefined;
  /** Filter conditions. */
  readonly where?: FilterWhereInput;
  /** Optional data group ID. */
  readonly data_group_id?: number | null | undefined;
  /** Segment (breakdown) specification. */
  readonly segments?: GroupByInput;
  /** Event names to exclude from flow paths. */
  readonly exclusions?: readonly string[] | null | undefined;
  /** Clock seam for the `to_date` default. */
  readonly today?: TodayFn | undefined;
}

/**
 * Keyword-only arguments shared by {@link Workspace.queryRetention} and
 * {@link Workspace.buildRetentionParams} (`workspace.py:4225-4249`).
 */
export interface WorkspaceRetentionQueryOptions {
  /** Retention period unit. Default `"week"`. */
  readonly retention_unit?: string | undefined;
  /** Retention alignment mode. Default `"birth"`. */
  readonly alignment?: string | undefined;
  /** Custom bucket sizes. */
  readonly bucket_sizes?: readonly number[] | null | undefined;
  /** Start date (`YYYY-MM-DD`). */
  readonly from_date?: string | null | undefined;
  /** End date (`YYYY-MM-DD`). */
  readonly to_date?: string | null | undefined;
  /** Relative time range in days. Default `30`. */
  readonly last?: number | undefined;
  /** Time aggregation unit. Default `"day"`. */
  readonly unit?: string | undefined;
  /** Aggregation function. Default `"retention_rate"`. */
  readonly math?: string | undefined;
  /** Breakdown specification. */
  readonly group_by?: GroupByInput;
  /** Filter conditions. */
  readonly where?: FilterWhereInput;
  /** Display mode. Default `"curve"`. */
  readonly mode?: string | undefined;
  /** Retention unbounded mode. */
  readonly unbounded_mode?: string | null | undefined;
  /** Cumulative retention counting. Default `false`. */
  readonly retention_cumulative?: boolean | undefined;
  /** Optional period-over-period comparison. */
  readonly time_comparison?: TimeComparison | null | undefined;
  /** Optional data group ID. */
  readonly data_group_id?: number | null | undefined;
  /** Clock seam. */
  readonly today?: TodayFn | undefined;
}

/**
 * Keyword-only arguments shared by {@link Workspace.queryUser} and
 * {@link Workspace.buildUserParams} (`workspace.py:9722-9745`).
 *
 * Python's `build_user_params` orders `limit` after `segment_by` while
 * `query_user` puts it after `sort_order` (packet Caution 8) — the
 * NAMES are identical, and TS options bags are order-free, so one
 * interface serves both.
 */
export interface WorkspaceUserQueryOptions {
  /** Profile filter (single, list, raw selector, or `null`). */
  readonly where?: Filter | readonly Filter[] | string | null | undefined;
  /** Cohort membership filter. */
  readonly cohort?: number | CohortDefinition | null | undefined;
  /** Output properties to include. */
  readonly properties?: readonly string[] | null | undefined;
  /** Property name to sort by. */
  readonly sort_by?: string | null | undefined;
  /** Sort direction. Default `"descending"`. */
  readonly sort_order?: string | undefined;
  /** Maximum profiles to return. Default `1`; `null` fetches all. */
  readonly limit?: number | null | undefined;
  /** Full-text search term. */
  readonly search?: string | null | undefined;
  /** Single distinct-ID lookup. */
  readonly distinct_id?: string | null | undefined;
  /** Batch distinct-ID lookup. */
  readonly distinct_ids?: readonly string[] | null | undefined;
  /** Group-profile scope. */
  readonly group_id?: string | null | undefined;
  /** Point-in-time query (ISO date text or Unix timestamp). */
  readonly as_of?: string | number | null | undefined;
  /** Output mode. Default `"aggregate"`. */
  readonly mode?: string | undefined;
  /** Aggregation function. Default `"count"`. */
  readonly aggregate?: string | undefined;
  /** Property to aggregate on. */
  readonly aggregate_property?: string | null | undefined;
  /** Percentile value (0-100 exclusive). */
  readonly percentile?: number | null | undefined;
  /** Cohort IDs for segmented aggregation. */
  readonly segment_by?: readonly number[] | null | undefined;
  /** Enable concurrent page fetching. Default `false`. */
  readonly parallel?: boolean | undefined;
  /** Maximum concurrent workers. Default `5`. */
  readonly workers?: number | undefined;
  /** Include non-members in cohort query results. Default `false`. */
  readonly include_all_users?: boolean | undefined;
  /** Clock seam for the U8 `as_of` future check. */
  readonly today?: TodayFn | undefined;
}

/**
 * Main facade for Mixpanel operations — TS port of
 * `workspace.Workspace` (`workspace.py:274+`).
 *
 * The B5 constructor takes a RESOLVED {@link Session} only. Python's
 * `account` / `project` / `workspace` / `target` kwargs
 * (`workspace.py:427-430`) are the resolver axes, which are batch B7;
 * `use()` is B6-W1.
 *
 * @example
 * ```typescript
 * const ws = new Workspace({ session });
 * const events = await ws.events();
 * ```
 */
export class Workspace {
  /** The resolved session bound to this facade (`self._session`). */
  #session: Session;

  /** The bound wire client (Python `self._api_client`). @internal */
  readonly client: MixpanelClient;

  /** Lazily-created discovery service (`self._discovery`). */
  #discovery: DiscoveryService | null = null;

  /** Lazily-created live query service (`self._live_query`). */
  #liveQuery: LiveQueryService | null = null;

  /** Lazily-created session-replay service (`self._replays_svc`). */
  #replays: ReplaysService | null = null;

  /** Lazily-created `/me` service (`self._me_service`). */
  #meService: MeService | null = null;

  /** `self._account_name` — the MeCache scope, refreshed on `use()`. */
  #accountName: string;

  // NOTE (W1-D2): Python also carries `self._initial_workspace_id`
  // (`workspace.py:522`), whose ONLY reader is the client-recreation
  // arm of `_get_api_client()` (`:757-766`) — the arm this port does
  // not have, because `close()` releases the pool IN PLACE and the
  // `readonly client` keeps its own pin (R6.2 identity). The field is
  // therefore deliberately absent rather than dead
  // (`B6-W1-notes.md` §W1-D2).

  /** The W1-D1 resolution seams (B7 replaces the defaults). */
  readonly #seams: ResolverSeams;

  /** Factory for the `/me` cache store handed to each MeService. */
  readonly #meCacheFactory: (accountName: string) => MeCacheStore;

  /** `warnings.warn` sink handed to the discovery service. */
  readonly #warn: WarningSink | undefined;

  /** Debug-log sink handed to the discovery service. */
  readonly #logger: WorkspaceLogger | undefined;

  /**
   * Create a workspace facade.
   *
   * @param options - The resolved session plus the optional injected
   *   client / seams.
   */
  constructor(options: WorkspaceOptions) {
    this.#session = options.session;
    this.client =
      options.client ??
      createMixpanelClient({
        session: options.session,
        ...(options.clientOptions ?? {}),
      });
    this.#accountName = options.session.account.name;
    this.#seams = mergeResolverSeams(options.seams);
    this.#meCacheFactory = options.meCache ?? inMemoryMeCache;
    this.#warn = options.warn;
    this.#logger = options.logger;
    this.#installWorkspaceResolver();
    // TODO(port): the `account` / `project` / `workspace` / `target`
    // constructor kwargs (`workspace.py:427-430`) resolve through
    // `resolve_session(...)` — batch B7. B5 takes a resolved Session.
  }

  /**
   * The resolved session bound to this facade (`session` property,
   * `workspace.py:546-548`). Read-only: `use()` swaps it in place.
   */
  get session(): Session {
    return this.#session;
  }

  /**
   * Wire the facade's `/me` cache into the client's workspace
   * auto-resolver (`_install_workspace_resolver`,
   * `workspace.py:775-793`).
   *
   * The closure reads {@link meService} on every call, so it keeps
   * pointing at the CURRENT service across `use()` cache clears. A
   * resolver already installed on an INJECTED client is left in place
   * (`workspace.py:789-791`).
   *
   * @internal
   */
  #installWorkspaceResolver(): void {
    if (this.client.hasWorkspaceResolver) {
      return;
    }
    this.client.setWorkspaceResolver((pid: string) =>
      this.meService.resolveWorkspace(pid),
    );
  }

  /**
   * Get or create the discovery service (lazy initialization —
   * `workspace.py:1005-1010`).
   *
   * @returns The memoized service.
   * @internal
   */
  get discoveryService(): DiscoveryService {
    if (this.#discovery === null) {
      this.#discovery = new DiscoveryService(this.client, {
        ...(this.#warn !== undefined ? { warn: this.#warn } : {}),
        ...(this.#logger !== undefined ? { logger: this.#logger } : {}),
      });
    }
    return this.#discovery;
  }

  /**
   * Swap one or more session axes in place; returns `this` for
   * chaining (`use`, `workspace.py:552-694`).
   *
   * `target=` is mutually exclusive with
   * `account=`/`project=`/`workspace=`. The wire client — and with it
   * the connection pool — is PRESERVED across every switch (R6.2): the
   * swap is delegated to {@link MixpanelClient.use}, which rebuilds the
   * auth header in place. Every lazy service is then discarded so
   * subsequent reads observe the new session.
   *
   * `use(workspace: N)` pins App-API and Query-host scoping; raw export
   * streaming stays project-scoped by design (W1-D3).
   *
   * @param options - The axes to swap plus `persist`.
   * @returns `this`.
   * @throws ParamValidationError - `WS1_TARGET_MUTUALLY_EXCLUSIVE`.
   * @throws MixpanelHeadlessError - `UNPORTED_RESOLVER_SEAM` while the
   *   B7 seams are unimplemented (the `target=` / `account=` /
   *   `persist=true` branches).
   * @throws ConfigError - `account=` swap resolves no project axis.
   *
   * @example
   * ```typescript
   * for (const project of await ws.projects()) {
   *   await ws.use({ project: project.id });
   * }
   * ```
   */
  async use(options: WorkspaceUseOptions = {}): Promise<this> {
    guardTargetExclusivity(options);

    const account = options.account ?? null;
    const project = options.project ?? null;
    const workspace = options.workspace ?? null;
    const target = options.target ?? null;

    let newAccount: Account | null = null;
    let newProject: Project | null = null;
    let newWorkspace: WorkspaceRef | null = null;

    if (target !== null) {
      // Route through the same resolver as construction so
      // env > param > target > bridge > config applies (FR-017).
      const resolved = await this.#seams.resolveSession({ target });
      newAccount = resolved.account;
      newProject = resolved.project;
      newWorkspace = resolved.workspace ?? null;
    } else if (account !== null) {
      // Explicit account swap (FR-033): the project re-resolves against
      // the NEW account; the workspace axis is cleared unless supplied
      // explicitly or by MP_WORKSPACE_ID.
      newAccount = await this.#seams.getAccount(account);
      const projectId = await this.#seams.resolveProjectAxis({
        explicit: project,
        target_project: null,
        account: newAccount,
      });
      if (projectId === null) {
        throw noProjectError(newAccount);
      }
      newProject = { id: projectId };
      if (workspace !== null) {
        newWorkspace = { id: workspace };
      } else {
        const envWs = await this.#seams.envWorkspaceId();
        newWorkspace = envWs !== null ? { id: envWs } : null;
      }
    } else {
      newProject = project !== null ? { id: project } : null;
      newWorkspace = workspace !== null ? { id: workspace } : null;
    }

    await this.client.use({
      account: newAccount,
      project: newProject,
      workspace: newWorkspace,
    });
    this.#session = this.client.session;

    // Clear the lazy services so subsequent reads observe the new
    // session rather than the prior one (`workspace.py:679-693`).
    this.#accountName = this.#session.account.name;
    this.#discovery = null;
    this.#liveQuery = null;
    this.#meService = null;
    this.#replays = null;
    this.#installWorkspaceResolver();

    if (options.persist === true) {
      await this.#seams.persistActive(this.#session);
    }
    return this;
  }

  /**
   * Close all resources (`close`, `workspace.py:744-753`).
   *
   * Idempotent and safe to call repeatedly.
   *
   * W1-D2 (arbiter-visible): Python nulls `self._api_client` and lets
   * `_get_api_client()` build a REPLACEMENT on the next call; TS keeps
   * the `readonly client` the R6.2 identity assertions track and closes
   * the pool IN PLACE — the client's own `close()` drops the pool
   * token and `ensureHttp()` recreates it on the next request, so a
   * post-close call behaves as Python's recreated client does. The one
   * divergence (recorded in `B6-W1-notes.md`): Python's replacement
   * client forgets a runtime `set_workspace_id()` pin and re-applies
   * `_initial_workspace_id`, while the TS client keeps its current pin.
   *
   * @returns Nothing.
   */
  async close(): Promise<void> {
    await this.client.close();
  }

  /**
   * `await using` support (R6.2) — delegates to {@link close}, the
   * `__exit__` twin (`workspace.py:730-742`).
   *
   * @returns Nothing.
   */
  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }

  // === B5-S2 query members (S2 owns; append-only) ===

  /**
   * Get or create the live query service (lazy initialization —
   * `workspace.py:1012-1017`).
   *
   * @returns The memoized service.
   * @internal
   */
  get liveQueryService(): LiveQueryService {
    if (this.#liveQuery === null) {
      this.#liveQuery = new LiveQueryService(this.client, {
        ...(this.#warn !== undefined ? { warn: this.#warn } : {}),
      });
    }
    return this.#liveQuery;
  }

  // Placement note (B5-ARB, resolving the stale S2 TODO): the
  // `_replays_service` accessor (`workspace.py:1019-1033`) was assigned
  // to this section by packet §2, but S3 landed it in the S3 section
  // below (`replaysService` get/set, memoized in `#replays`) with the
  // packet-specified `query_fn` DI. Behavior is per spec; only the
  // placement differs. See `b5-review-resolution.md` ASR-F5.

  /**
   * Run a segmentation query against the Mixpanel API
   * (`segmentation`, `workspace.py:1583-1616`).
   *
   * @param event - Event name to query.
   * @param options - Required date window plus `on` / `unit` / `where`.
   * @returns Time-series data with the calculated total.
   * @throws ConfigError - Credentials not available.
   * @throws AuthenticationError | QueryError | RateLimitError - Wire
   *   failures.
   */
  async segmentation(
    event: string,
    options: WorkspaceSegmentationOptions,
  ): Promise<SegmentationResult> {
    const { from_date, to_date, ...rest } = options;
    return this.liveQueryService.segmentation(event, from_date, to_date, rest);
  }

  /**
   * Run a funnel analysis query (`funnel`,
   * `workspace.py:1618-1648`).
   *
   * @param funnelId - ID of the saved funnel.
   * @param options - Required date window plus `unit` / `on`.
   * @returns Step conversion rates.
   * @throws ConfigError - Credentials not available.
   * @throws AuthenticationError | QueryError | RateLimitError - Wire
   *   failures.
   */
  async funnel(
    funnelId: number,
    options: WorkspaceFunnelOptions,
  ): Promise<FunnelResult> {
    const { from_date, to_date, ...rest } = options;
    return this.liveQueryService.funnel(funnelId, from_date, to_date, rest);
  }

  /**
   * Run a retention analysis query (`retention`,
   * `workspace.py:1650-1692`).
   *
   * @param options - Born/return events, the date window and the
   *   interval knobs (all keyword-only in Python).
   * @returns Cohort retention data.
   * @throws ConfigError - Credentials not available.
   * @throws AuthenticationError | QueryError | RateLimitError - Wire
   *   failures.
   */
  async retention(
    options: WorkspaceRetentionOptions,
  ): Promise<RetentionResult> {
    const { born_event, return_event, from_date, to_date, ...rest } = options;
    return this.liveQueryService.retention(
      born_event,
      return_event,
      from_date,
      to_date,
      rest,
    );
  }

  /**
   * Get counts for multiple events (`event_counts`,
   * `workspace.py:1694-1724`).
   *
   * @param events - Event names.
   * @param options - Required date window plus `type` / `unit`.
   * @returns Time series per event.
   * @throws ConfigError - Credentials not available.
   * @throws AuthenticationError | QueryError | RateLimitError - Wire
   *   failures.
   */
  async eventCounts(
    events: readonly string[],
    options: WorkspaceEventCountsOptions,
  ): Promise<EventCountsResult> {
    const { from_date, to_date, ...rest } = options;
    return this.liveQueryService.eventCounts(events, from_date, to_date, rest);
  }

  /**
   * Get event counts broken down by property value
   * (`property_counts`, `workspace.py:1726-1765`).
   *
   * @param event - Event name.
   * @param propertyName - Property to break down by.
   * @param options - Required date window plus `type` / `unit` /
   *   `values` / `limit`.
   * @returns Time series per property value.
   * @throws ConfigError - Credentials not available.
   * @throws AuthenticationError | QueryError | RateLimitError - Wire
   *   failures.
   */
  async propertyCounts(
    event: string,
    propertyName: string,
    options: WorkspacePropertyCountsOptions,
  ): Promise<PropertyCountsResult> {
    const { from_date, to_date, ...rest } = options;
    return this.liveQueryService.propertyCounts(
      event,
      propertyName,
      from_date,
      to_date,
      rest,
    );
  }

  /**
   * Get the activity feed for specific users (`activity_feed`,
   * `workspace.py:1767-1844`).
   *
   * Events come back oldest-first within a page; when `limit` is set
   * the most recent events lead and `sentinel_event` pages backward.
   *
   * @param distinctIds - User identifiers.
   * @param options - Dates / limit / include / exclude / search /
   *   pagination.
   * @returns The events plus the `sentinel_event` cursor.
   * @throws ConfigError - Credentials not available.
   * @throws QueryError - Both `include_events` and `exclude_events`
   *   given (and the other wire rejections).
   */
  async activityFeed(
    distinctIds: readonly string[],
    options: LiveActivityFeedOptions = {},
  ): Promise<ActivityFeedResult> {
    return this.liveQueryService.activityFeed(distinctIds, options);
  }

  /**
   * Query a saved report by bookmark type (`query_saved_report`,
   * `workspace.py:1846-1880`).
   *
   * @param bookmarkId - ID of the saved report.
   * @param options - `bookmark_type` plus the funnel date window.
   * @returns The normalized report data.
   * @throws ConfigError - Credentials not available.
   * @throws QueryError - Invalid `bookmark_id` or report not found.
   */
  async querySavedReport(
    bookmarkId: number,
    options: LiveQuerySavedReportOptions = {},
  ): Promise<SavedReportResult> {
    return this.liveQueryService.querySavedReport(bookmarkId, options);
  }

  /**
   * Query a saved Flows report (`query_saved_flows`,
   * `workspace.py:1882-1898`).
   *
   * @param bookmarkId - ID of the saved flows report.
   * @returns Steps, breakdowns and the conversion rate.
   * @throws ConfigError - Credentials not available.
   * @throws QueryError - Invalid `bookmark_id` or report not found.
   */
  async querySavedFlows(bookmarkId: number): Promise<FlowsResult> {
    return this.liveQueryService.querySavedFlows(bookmarkId);
  }

  /**
   * Analyze the event frequency distribution (`frequency`,
   * `workspace.py:1900-1933`).
   *
   * @param options - Required date window plus `unit` /
   *   `addiction_unit` / `event` / `where`.
   * @returns The frequency distribution.
   * @throws ConfigError - Credentials not available.
   * @throws AuthenticationError | QueryError | RateLimitError - Wire
   *   failures.
   */
  async frequency(
    options: WorkspaceFrequencyOptions,
  ): Promise<FrequencyResult> {
    const { from_date, to_date, ...rest } = options;
    return this.liveQueryService.frequency(from_date, to_date, rest);
  }

  /**
   * Bucket events by numeric property ranges
   * (`segmentation_numeric`, `workspace.py:1935-1971`).
   *
   * @param event - Event name.
   * @param options - Required date window and `on`, plus `unit` /
   *   `where` / `type`.
   * @returns The bucketed data.
   * @throws ConfigError - Credentials not available.
   * @throws QueryError - Invalid parameters or a non-numeric property.
   */
  async segmentationNumeric(
    event: string,
    options: WorkspaceSegmentationNumericOptions,
  ): Promise<NumericBucketResult> {
    const { from_date, to_date, on, ...rest } = options;
    return this.liveQueryService.segmentationNumeric(
      event,
      from_date,
      to_date,
      on,
      rest,
    );
  }

  /**
   * Calculate the sum of a numeric property over time
   * (`segmentation_sum`, `workspace.py:1973-2006`).
   *
   * @param event - Event name.
   * @param options - Required date window and `on`, plus `unit` /
   *   `where`.
   * @returns Sum values per period.
   * @throws ConfigError - Credentials not available.
   * @throws QueryError - Invalid parameters or a non-numeric property.
   */
  async segmentationSum(
    event: string,
    options: WorkspaceNumericOptions,
  ): Promise<NumericSumResult> {
    const { from_date, to_date, on, ...rest } = options;
    return this.liveQueryService.segmentationSum(
      event,
      from_date,
      to_date,
      on,
      rest,
    );
  }

  /**
   * Calculate the average of a numeric property over time
   * (`segmentation_average`, `workspace.py:2008-2041`).
   *
   * @param event - Event name.
   * @param options - Required date window and `on`, plus `unit` /
   *   `where`.
   * @returns Average values per period.
   * @throws ConfigError - Credentials not available.
   * @throws QueryError - Invalid parameters or a non-numeric property.
   */
  async segmentationAverage(
    event: string,
    options: WorkspaceNumericOptions,
  ): Promise<NumericAverageResult> {
    const { from_date, to_date, on, ...rest } = options;
    return this.liveQueryService.segmentationAverage(
      event,
      from_date,
      to_date,
      on,
      rest,
    );
  }

  // -------------------------------------------------------------------
  // INSIGHTS QUERY API (Phase 029) — `workspace.py:2043-2743`
  // -------------------------------------------------------------------

  /**
   * Run a typed insights query (`query`, `workspace.py:2285-2429`).
   *
   * Builds bookmark params from the arguments, POSTs them inline to
   * `/api/query/insights`, and returns the structured result.
   *
   * @param events - Event name(s): a string, a `Metric`, a
   *   `CohortMetric`, a `Formula`, or a sequence mixing them (Formula
   *   members are extracted and appended as formula show clauses).
   * @param options - The 17 keyword-only knobs.
   * @returns The series data and metadata.
   * @throws BookmarkValidationError - Argument or bookmark validation.
   * @throws AuthenticationError | QueryError | RateLimitError - Wire
   *   failures.
   *
   * @example
   * ```typescript
   * const result = await ws.query("Login", { math: "unique", last: 7 });
   * ```
   */
  async query(
    events: EventsInput,
    options: WorkspaceQueryOptions = {},
  ): Promise<QueryResult> {
    const params = this.#resolveQueryParams(events, options);
    return this.liveQueryService.query(params, this.#projectId());
  }

  /**
   * Build validated insights bookmark params WITHOUT calling the API
   * (`build_params`, `workspace.py:2431-2544`).
   *
   * @param events - Same input union as {@link query}.
   * @param options - The same 17 keyword-only knobs.
   * @returns Bookmark params with `sections` and `displayOptions`.
   * @throws BookmarkValidationError - Argument or bookmark validation.
   */
  async buildParams(
    events: EventsInput,
    options: WorkspaceQueryOptions = {},
  ): Promise<ParamsDict> {
    return this.#resolveQueryParams(events, options);
  }

  /**
   * Shared body of {@link query} and {@link buildParams} — the option
   * unpacking Python spells out twice (`:2402-2421`, `:2523-2542`).
   *
   * @param events - The events input.
   * @param options - The keyword-only knobs.
   * @returns The validated bookmark params.
   * @throws BookmarkValidationError - Any validation layer.
   */
  #resolveQueryParams(
    events: EventsInput,
    options: WorkspaceQueryOptions,
  ): ParamsDict {
    return resolveAndBuildParams({
      events,
      from_date: options.from_date ?? null,
      to_date: options.to_date ?? null,
      last: options.last ?? 30,
      unit: options.unit ?? "day",
      math: options.math ?? "total",
      math_property: options.math_property ?? null,
      per_user: options.per_user ?? null,
      percentile_value: options.percentile_value ?? null,
      group_by: options.group_by ?? null,
      where: options.where ?? null,
      formula: options.formula ?? null,
      formula_label: options.formula_label ?? null,
      rolling: options.rolling ?? null,
      cumulative: options.cumulative ?? false,
      mode: options.mode ?? "timeseries",
      time_comparison: options.time_comparison ?? null,
      data_group_id: options.data_group_id ?? null,
      ...(options.today !== undefined ? { today: options.today } : {}),
    });
  }

  // -------------------------------------------------------------------
  // FUNNEL QUERY (Phase 032) — `workspace.py:2744-3320`
  // -------------------------------------------------------------------

  /**
   * Run a typed funnel query (`query_funnel`,
   * `workspace.py:3064-3200`).
   *
   * @param steps - Funnel steps (strings or `FunnelStep` objects).
   * @param options - The 17 keyword-only knobs.
   * @returns Step data, conversion rates and metadata.
   * @throws BookmarkValidationError - Argument or bookmark validation.
   * @throws AuthenticationError | QueryError | RateLimitError - Wire
   *   failures.
   */
  async queryFunnel(
    steps: ReadonlyArray<string | FunnelStep>,
    options: WorkspaceFunnelQueryOptions = {},
  ): Promise<FunnelQueryResult> {
    const params = this.#resolveFunnelParams(steps, options);
    return this.liveQueryService.queryFunnel(params, this.#projectId());
  }

  /**
   * Build validated funnel bookmark params WITHOUT calling the API
   * (`build_funnel_params`, `workspace.py:3202-3319`).
   *
   * @param steps - Funnel steps (strings or `FunnelStep` objects).
   * @param options - The same 17 keyword-only knobs.
   * @returns Bookmark params with `sections` and `displayOptions`.
   * @throws BookmarkValidationError - Argument or bookmark validation.
   */
  async buildFunnelParams(
    steps: ReadonlyArray<string | FunnelStep>,
    options: WorkspaceFunnelQueryOptions = {},
  ): Promise<ParamsDict> {
    return this.#resolveFunnelParams(steps, options);
  }

  /**
   * Shared body of {@link queryFunnel} and
   * {@link buildFunnelParams}.
   *
   * @param steps - The step specs.
   * @param options - The keyword-only knobs.
   * @returns The validated bookmark params.
   * @throws BookmarkValidationError - Any validation layer.
   */
  #resolveFunnelParams(
    steps: ReadonlyArray<string | FunnelStep>,
    options: WorkspaceFunnelQueryOptions,
  ): ParamsDict {
    return resolveAndBuildFunnelParams({
      steps,
      conversion_window: options.conversion_window ?? 14,
      conversion_window_unit: options.conversion_window_unit ?? "day",
      order: options.order ?? "loose",
      math: options.math ?? "conversion_rate_unique",
      math_property: options.math_property ?? null,
      from_date: options.from_date ?? null,
      to_date: options.to_date ?? null,
      last: options.last ?? 30,
      unit: options.unit ?? "day",
      group_by: options.group_by ?? null,
      where: options.where ?? null,
      exclusions: options.exclusions ?? null,
      holding_constant: options.holding_constant ?? null,
      mode: options.mode ?? "steps",
      reentry_mode: options.reentry_mode ?? null,
      time_comparison: options.time_comparison ?? null,
      data_group_id: options.data_group_id ?? null,
      ...(options.today !== undefined ? { today: options.today } : {}),
    });
  }

  // -------------------------------------------------------------------
  // FLOW QUERY (inline ad-hoc) — `workspace.py:3489-4096`
  // -------------------------------------------------------------------

  /**
   * Run a typed flow query (`query_flow`,
   * `workspace.py:3852-3986`).
   *
   * @param event - Anchor event(s): a string, a `FlowStep`, or a list.
   * @param options - The 16 keyword-only knobs.
   * @returns Steps, flows, breakdowns and metadata.
   * @throws BookmarkValidationError - Argument or bookmark validation.
   * @throws AuthenticationError | QueryError | RateLimitError - Wire
   *   failures.
   */
  async queryFlow(
    event: string | FlowStep | ReadonlyArray<string | FlowStep>,
    options: WorkspaceFlowQueryOptions = {},
  ): Promise<FlowQueryResult> {
    const params = this.#resolveFlowParams(event, options);
    return this.liveQueryService.queryFlow(
      params,
      this.#projectId(),
      options.mode ?? "sankey",
    );
  }

  /**
   * Build validated flow bookmark params WITHOUT calling the API
   * (`build_flow_params`, `workspace.py:3988-4095`).
   *
   * @param event - Anchor event(s).
   * @param options - The same 16 keyword-only knobs.
   * @returns The FLAT flow bookmark params dict.
   * @throws BookmarkValidationError - Argument or bookmark validation.
   */
  async buildFlowParams(
    event: string | FlowStep | ReadonlyArray<string | FlowStep>,
    options: WorkspaceFlowQueryOptions = {},
  ): Promise<ParamsDict> {
    return this.#resolveFlowParams(event, options);
  }

  /**
   * Shared body of {@link queryFlow} and {@link buildFlowParams}.
   *
   * @param event - The anchor event input.
   * @param options - The keyword-only knobs.
   * @returns The validated flow bookmark params.
   * @throws BookmarkValidationError - Any validation layer.
   */
  #resolveFlowParams(
    event: string | FlowStep | ReadonlyArray<string | FlowStep>,
    options: WorkspaceFlowQueryOptions,
  ): ParamsDict {
    return resolveAndBuildFlowParams({
      event,
      forward: options.forward ?? 3,
      reverse: options.reverse ?? 0,
      from_date: options.from_date ?? null,
      to_date: options.to_date ?? null,
      last: options.last ?? 30,
      conversion_window: options.conversion_window ?? 7,
      conversion_window_unit: options.conversion_window_unit ?? "day",
      count_type: options.count_type ?? "unique",
      cardinality: options.cardinality ?? 3,
      collapse_repeated: options.collapse_repeated ?? false,
      hidden_events: options.hidden_events ?? null,
      mode: options.mode ?? "sankey",
      where: options.where ?? null,
      data_group_id: options.data_group_id ?? null,
      segments: options.segments ?? null,
      exclusions: options.exclusions ?? null,
      ...(options.today !== undefined ? { today: options.today } : {}),
    });
  }

  // -------------------------------------------------------------------
  // RETENTION QUERY (inline ad-hoc) — `workspace.py:4097-4463`
  // -------------------------------------------------------------------

  /**
   * Run a typed retention query (`query_retention`,
   * `workspace.py:4225-4347`).
   *
   * @param bornEvent - Event defining cohort membership.
   * @param returnEvent - Event defining return.
   * @param options - The 15 keyword-only knobs.
   * @returns Cohort data, averages and metadata.
   * @throws BookmarkValidationError - Argument or bookmark validation.
   * @throws AuthenticationError | QueryError | RateLimitError - Wire
   *   failures.
   */
  async queryRetention(
    bornEvent: string | RetentionEvent,
    returnEvent: string | RetentionEvent,
    options: WorkspaceRetentionQueryOptions = {},
  ): Promise<RetentionQueryResult> {
    const params = this.#resolveRetentionParams(
      bornEvent,
      returnEvent,
      options,
    );
    return this.liveQueryService.queryRetention(params, this.#projectId());
  }

  /**
   * Build validated retention bookmark params WITHOUT calling the API
   * (`build_retention_params`, `workspace.py:4349-4463`).
   *
   * @param bornEvent - Event defining cohort membership.
   * @param returnEvent - Event defining return.
   * @param options - The same 15 keyword-only knobs.
   * @returns Bookmark params with `sections`, `displayOptions`,
   *   `sorting` and `columnWidths`.
   * @throws BookmarkValidationError - Argument or bookmark validation.
   */
  async buildRetentionParams(
    bornEvent: string | RetentionEvent,
    returnEvent: string | RetentionEvent,
    options: WorkspaceRetentionQueryOptions = {},
  ): Promise<ParamsDict> {
    return this.#resolveRetentionParams(bornEvent, returnEvent, options);
  }

  /**
   * Shared body of {@link queryRetention} and
   * {@link buildRetentionParams}.
   *
   * @param bornEvent - The born-event input.
   * @param returnEvent - The return-event input.
   * @param options - The keyword-only knobs.
   * @returns The validated bookmark params.
   * @throws BookmarkValidationError - Any validation layer.
   */
  #resolveRetentionParams(
    bornEvent: string | RetentionEvent,
    returnEvent: string | RetentionEvent,
    options: WorkspaceRetentionQueryOptions,
  ): ParamsDict {
    return resolveAndBuildRetentionParams({
      born_event: bornEvent,
      return_event: returnEvent,
      retention_unit: options.retention_unit ?? "week",
      alignment: options.alignment ?? "birth",
      bucket_sizes: options.bucket_sizes ?? null,
      math: options.math ?? "retention_rate",
      from_date: options.from_date ?? null,
      to_date: options.to_date ?? null,
      last: options.last ?? 30,
      unit: options.unit ?? "day",
      group_by: options.group_by ?? null,
      where: options.where ?? null,
      mode: options.mode ?? "curve",
      unbounded_mode: options.unbounded_mode ?? null,
      retention_cumulative: options.retention_cumulative ?? false,
      time_comparison: options.time_comparison ?? null,
      data_group_id: options.data_group_id ?? null,
      ...(options.today !== undefined ? { today: options.today } : {}),
    });
  }

  // -------------------------------------------------------------------
  // USER QUERY ENGINE (Phase 039) — `workspace.py:9336-10256`
  // -------------------------------------------------------------------

  /**
   * Query user profiles from Mixpanel's Engage API (`query_user`,
   * `workspace.py:9722-9881`).
   *
   * `mode="aggregate"` (the default) routes to the engage stats
   * endpoint; `mode="profiles"` fetches pages sequentially, or
   * concurrently when `parallel` is set and `limit !== 1`.
   *
   * @param options - The 19 keyword-only knobs.
   * @returns Profiles/aggregate payload with metadata.
   * @throws BookmarkValidationError - Argument or param validation.
   * @throws AuthenticationError | QueryError | RateLimitError |
   *   ServerError - Wire failures.
   */
  async queryUser(
    options: WorkspaceUserQueryOptions = {},
  ): Promise<UserQueryResult> {
    const limit = options.limit === undefined ? 1 : options.limit;
    const mode = options.mode ?? "aggregate";
    const parallel = options.parallel ?? false;
    const workers = options.workers ?? 5;
    const params = this.#resolveUserParams(options);

    // Route by mode
    if (mode === "aggregate") {
      const [aggregateData, total, computedAt, meta] =
        await this.#executeUserAggregate(params);
      return new UserQueryResult({
        computed_at: computedAt,
        total,
        profiles: [],
        params,
        meta,
        mode: "aggregate",
        aggregate_data: aggregateData,
      });
    }

    // Profiles mode — choose sequential or parallel
    let profiles: Array<Record<string, unknown>>;
    let total: number;
    let computedAt: string;
    let meta: Record<string, unknown>;
    if (parallel && limit !== 1) {
      [profiles, total, computedAt, meta] =
        await this.#executeUserQueryParallel(params, limit, workers);
    } else {
      if (parallel && limit === 1) {
        this.#logger?.debug(
          "parallel=True ignored: limit=1 uses sequential path",
        );
      }
      [profiles, total, computedAt, meta] =
        await this.#executeUserQuerySequential(params, limit);
    }

    return new UserQueryResult({
      computed_at: computedAt,
      total,
      profiles,
      params,
      meta,
      mode: "profiles",
      aggregate_data: null,
    });
  }

  /**
   * Build validated engage params WITHOUT calling the API
   * (`build_user_params`, `workspace.py:9883-9997`).
   *
   * @param options - The same 19 keyword-only knobs.
   * @returns The engage params dict.
   * @throws BookmarkValidationError - Argument or param validation.
   */
  async buildUserParams(
    options: WorkspaceUserQueryOptions = {},
  ): Promise<ParamsDict> {
    return this.#resolveUserParams(options);
  }

  /**
   * Shared body of {@link queryUser} and {@link buildUserParams}.
   *
   * @param options - The keyword-only knobs.
   * @returns The validated engage params dict.
   * @throws BookmarkValidationError - Any validation layer.
   */
  #resolveUserParams(options: WorkspaceUserQueryOptions): ParamsDict {
    return resolveAndBuildUserParams({
      where: options.where ?? null,
      cohort: options.cohort ?? null,
      properties: options.properties ?? null,
      sort_by: options.sort_by ?? null,
      sort_order: options.sort_order ?? "descending",
      search: options.search ?? null,
      distinct_id: options.distinct_id ?? null,
      distinct_ids: options.distinct_ids ?? null,
      group_id: options.group_id ?? null,
      as_of: options.as_of ?? null,
      mode: options.mode ?? "aggregate",
      aggregate: options.aggregate ?? "count",
      aggregate_property: options.aggregate_property ?? null,
      percentile: options.percentile ?? null,
      segment_by: options.segment_by ?? null,
      limit: options.limit === undefined ? 1 : options.limit,
      parallel: options.parallel ?? false,
      workers: options.workers ?? 5,
      include_all_users: options.include_all_users ?? false,
      ...(options.today !== undefined ? { today: options.today } : {}),
    });
  }

  /**
   * Execute a user profile query with sequential page fetching
   * (`_execute_user_query_sequential`, `workspace.py:9629-9720`).
   *
   * @param params - Engage params from the resolver.
   * @param limit - Maximum profiles to collect (`null` = all).
   * @returns `[profiles, total, computed_at, meta]`.
   * @throws AuthenticationError | RateLimitError | QueryError |
   *   ServerError - Wire failures.
   */
  async #executeUserQuerySequential(
    params: ParamsDict,
    limit: number | null,
  ): Promise<[Array<Record<string, unknown>>, number, string, ParamsDict]> {
    // Reuse buildPageKwargs for params→kwargs translation; pass the
    // limit server-side for efficient fetching. `total` is
    // `len(profiles)` — the count in THIS response, not the API's
    // population total (use mode="aggregate" for that).
    const apiKwargs = buildPageKwargs(params);
    apiKwargs["limit"] = limit;

    let result = await this.#exportPage(0, apiKwargs);
    let profiles: Array<Record<string, unknown>> = result.profiles.map((p) =>
      transformProfile(p as Readonly<Record<string, unknown>>),
    );
    const sessionId = result.session_id;
    let pagesFetched = 1;

    // Check if we already have enough
    if (limit !== null && profiles.length >= limit) {
      profiles = profiles.slice(0, limit);
    } else if (result.has_more && result.profiles.length > 0) {
      // Paginate for more (guard: stop if a page returns no profiles)
      let currentPage = 0;
      while (result.has_more) {
        if (limit !== null && profiles.length >= limit) {
          break;
        }
        currentPage += 1;
        result = await this.#exportPage(currentPage, {
          ...apiKwargs,
          session_id: sessionId,
        });
        if (result.profiles.length === 0) {
          break;
        }
        for (const p of result.profiles) {
          profiles.push(
            transformProfile(p as Readonly<Record<string, unknown>>),
          );
        }
        pagesFetched += 1;
      }

      // Python `profiles[:None]` returns everything (limit=None case).
      profiles = limit === null ? profiles : profiles.slice(0, limit);
    }

    const computedAt = isoUtc(this.client.core.now());
    const meta: ParamsDict = {
      session_id: sessionId,
      pages_fetched: pagesFetched,
      parallel: false,
    };

    return [profiles, profiles.length, computedAt, meta];
  }

  /**
   * Execute an aggregate query via the Engage stats endpoint
   * (`_execute_user_aggregate`, `workspace.py:10002-10064`).
   *
   * @param params - Engage params from the resolver.
   * @returns `[aggregate_data, total, computed_at, meta]`.
   * @throws AuthenticationError | RateLimitError | QueryError |
   *   ServerError - Wire failures.
   */
  async #executeUserAggregate(
    params: ParamsDict,
  ): Promise<
    [
      Readonly<Record<string, unknown>> | number | null,
      number,
      string,
      ParamsDict,
    ]
  > {
    // The kwargs block is the exported `buildStatsKwargs` (R7.2 split
    // of the `self`-free half, `workspace.py:10027-10046`).
    const statsKwargs = buildStatsKwargs(params);

    const response = (await this.client.engageStats(
      statsKwargs as never,
    )) as unknown;
    const body = toNativeRecord(response);

    const aggregateData = Object.hasOwn(body, "results")
      ? body["results"]
      : undefined;
    const computedAt = Object.hasOwn(body, "computed_at")
      ? (body["computed_at"] as string)
      : isoUtc(this.client.core.now());
    let total: number;
    if (typeof aggregateData === "number") {
      // Python: `int(aggregate_data)` — truncation toward zero.
      total = params["action"] === "count()" ? Math.trunc(aggregateData) : 0;
    } else {
      total = 0;
    }

    const action = Object.hasOwn(params, "action")
      ? params["action"]
      : "count()";
    const segmented = Object.hasOwn(params, "segment_by_cohorts");
    const meta: ParamsDict = { action, segmented };

    return [
      (aggregateData ?? null) as
        Readonly<Record<string, unknown>> | number | null,
      total,
      computedAt,
      meta,
    ];
  }

  /**
   * Fetch profiles with concurrent page retrieval
   * (`_execute_user_query_parallel`, `workspace.py:10069-10207`).
   *
   * Page 0 is fetched first for metadata, then pages `1..n-1` run under
   * a bounded scheduler with the SAME worker cap Python's
   * `ThreadPoolExecutor(max_workers=min(workers, 5))` applies. Results
   * are re-ordered by page number, failed pages are recorded rather
   * than aborting, and the four CODED wire errors abort the whole
   * query (Python cancels the queued futures and re-raises; the TS twin
   * stops scheduling and lets the in-flight pages settle, exactly as
   * `ThreadPoolExecutor.__exit__` does).
   *
   * @param params - Engage params from the resolver.
   * @param limit - Maximum profiles to return (`null` = all).
   * @param workers - Requested worker count (capped at 5).
   * @returns `[profiles, total, computed_at, meta]`.
   * @throws AuthenticationError | RateLimitError | ServerError |
   *   QueryError - Propagated from any page.
   */
  async #executeUserQueryParallel(
    params: ParamsDict,
    limit: number | null,
    workers: number,
  ): Promise<[Array<Record<string, unknown>>, number, string, ParamsDict]> {
    const cappedWorkers = Math.min(workers, 5);
    const pageKwargs = buildPageKwargs(params);

    // Page 0: get metadata
    const page0 = await this.#exportPage(0, pageKwargs);
    const total = page0.total;
    // Python `page0.page_size or 1000` — 0/None fall back.
    const pageSize = page0.page_size ? page0.page_size : 1000;
    const sessionId = page0.session_id;
    const computedAt = isoUtc(this.client.core.now());

    let allProfiles: Array<Record<string, unknown>> = page0.profiles.map((p) =>
      transformProfile(p as Readonly<Record<string, unknown>>),
    );

    let pagesNeeded: number;
    if (limit === null) {
      pagesNeeded = Math.ceil(total / pageSize);
    } else {
      // Cap by total to avoid fetching empty pages when limit > total
      const effective = total > 0 ? Math.min(limit, total) : limit;
      pagesNeeded = Math.ceil(effective / pageSize);
    }

    // Single page — skip parallel overhead
    if (pagesNeeded <= 1 || !page0.has_more) {
      allProfiles = limit === null ? allProfiles : allProfiles.slice(0, limit);
      return [
        allProfiles,
        allProfiles.length,
        computedAt,
        {
          session_id: sessionId,
          pages_fetched: 1,
          failed_pages: [],
          parallel: true,
          workers: cappedWorkers,
        },
      ];
    }

    if (pagesNeeded > 48) {
      this.#logger?.warning?.(
        `Fetching ${pagesNeeded} pages may trigger rate limiting ` +
          "(engage API allows ~60 queries/hour).",
      );
    }

    const failedPages: number[] = [];
    const pageResults = new Map<number, Array<Record<string, unknown>>>();

    /**
     * Fetch and normalize a single page (`_fetch_page`, `:10152`).
     *
     * @param pageNum - The page index.
     * @returns The page number and its normalized profiles.
     */
    const fetchPage = async (
      pageNum: number,
    ): Promise<[number, Array<Record<string, unknown>>]> => {
      const result = await this.#exportPage(pageNum, {
        ...pageKwargs,
        session_id: sessionId,
      });
      return [
        pageNum,
        result.profiles.map((p) =>
          transformProfile(p as Readonly<Record<string, unknown>>),
        ),
      ];
    };

    // Bounded-concurrency scheduler: the TS twin of
    // `ThreadPoolExecutor(max_workers=capped)` + `as_completed`.
    let next = 1;
    let aborted: unknown = null;
    const runWorker = async (): Promise<void> => {
      for (;;) {
        if (aborted !== null) {
          return;
        }
        const pageNum = next;
        if (pageNum >= pagesNeeded) {
          return;
        }
        next += 1;
        try {
          const [pnum, profiles] = await fetchPage(pageNum);
          pageResults.set(pnum, profiles);
        } catch (exc) {
          if (
            exc instanceof AuthenticationError ||
            exc instanceof RateLimitError ||
            exc instanceof ServerError ||
            exc instanceof QueryError
          ) {
            // Python cancels the queued futures and re-raises out of
            // the `with` block (running futures still finish).
            aborted = exc;
            return;
          }
          this.#logger?.warning?.(
            `Failed to fetch page ${pageNum} (${
              exc instanceof Error ? exc.constructor.name : typeof exc
            }: ${String(exc)}), continuing with partial results`,
          );
          failedPages.push(pageNum);
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(cappedWorkers, pagesNeeded - 1) }, () =>
        runWorker(),
      ),
    );
    if (aborted !== null) {
      throw aborted;
    }

    for (const p of [...pageResults.keys()].sort((a, b) => a - b)) {
      allProfiles.push(...pageResults.get(p)!);
    }

    allProfiles = limit === null ? allProfiles : allProfiles.slice(0, limit);

    return [
      allProfiles,
      allProfiles.length,
      computedAt,
      {
        session_id: sessionId,
        pages_fetched: pagesNeeded - failedPages.length,
        failed_pages: [...failedPages].sort((a, b) => a - b),
        parallel: true,
        workers: cappedWorkers,
      },
    ];
  }

  /**
   * `api_client.export_profiles_page(page=..., **kwargs)` with the
   * dynamic kwargs bag the two engines build.
   *
   * @param page - Zero-based page index.
   * @param kwargs - The dynamic options bag.
   * @returns The page result.
   * @throws AuthenticationError | RateLimitError | QueryError |
   *   ServerError - Wire failures.
   */
  async #exportPage(
    page: number,
    kwargs: Readonly<Record<string, unknown>>,
  ): Promise<ProfilePageResult> {
    return this.client.exportProfilesPage(page, kwargs as never);
  }

  /**
   * `int(self._session.project.id)` (`workspace.py:2428`) — the
   * project id every inline query body carries.
   *
   * @returns The numeric project id.
   * @throws PythonIntError - When the stored id is not an integer
   *   literal (CPython's `int(str)` twin, R11.7).
   */
  #projectId(): number {
    return pythonInt(this.session.project.id);
  }

  // === B5-S1 discovery/lexicon members (append-only; S1 owns) ===

  /**
   * List event names in the Mixpanel project (`events`,
   * `workspace.py:1039-1088`).
   *
   * Defaults to the widest window `/events/names` accepts
   * (`limit=5000`, `from_date=2000-01-01`, `to_date=today`); the wire
   * layer retries a date-range-gated 403 with the project's
   * `max_data_history_days` ceiling. The result reflects events seen in
   * the window — it is NOT the Lexicon registry.
   *
   * Cached per `(limit, from_date, to_date)` for the facade's lifetime.
   *
   * @param options - Optional limit / date bounds.
   * @returns Alphabetically sorted event names.
   * @throws AuthenticationError - Credentials rejected.
   * @throws QueryError - Non-gate 403s and other 4xx errors.
   */
  async events(options: WorkspaceEventsOptions = {}): Promise<string[]> {
    return this.discoveryService.listEvents(options);
  }

  /**
   * List all property names for an event (`properties`,
   * `workspace.py:1090-1104`). Cached per event.
   *
   * @param event - Event name.
   * @returns Alphabetically sorted property names.
   * @throws EventNotFoundError - Unknown event (with suggestions).
   */
  async properties(event: string): Promise<string[]> {
    return this.discoveryService.listProperties(event);
  }

  /**
   * Get sample values for a property (`property_values`,
   * `workspace.py:1106-1130`). Cached per
   * `(property, event, limit)`.
   *
   * @param propertyName - Property to get values for.
   * @param options - Optional event filter and limit.
   * @returns Sample property values as strings (unsorted).
   * @throws AuthenticationError - Credentials rejected.
   */
  async propertyValues(
    propertyName: string,
    options: WorkspacePropertyValuesOptions = {},
  ): Promise<string[]> {
    return this.discoveryService.listPropertyValues(propertyName, options);
  }

  /**
   * List inferred subproperties of a list-of-object property
   * (`subproperties`, `workspace.py:1132-1191`).
   *
   * Only SCALAR sub-values (string / number / boolean / ISO datetime
   * string) are reported; nested dicts and lists are skipped because
   * `GroupBy.list_item` / `Filter.list_contains` cannot use them.
   *
   * @param propertyName - Top-level property name (e.g. `"cart"`).
   * @param options - Optional event scope and sample size.
   * @returns Alphabetically sorted subproperty infos.
   * @throws AuthenticationError - Credentials rejected.
   *
   * Emits the injected {@link WarningSink} (Python `UserWarning`) for
   * mixed scalar types, mixed scalar/nested shapes, and all-null keys.
   *
   * @example
   * ```typescript
   * for (const sp of await ws.subproperties("cart", { event: "Cart Viewed" })) {
   *   console.log(sp.name, sp.type, sp.sample_values);
   * }
   * ```
   */
  async subproperties(
    propertyName: string,
    options: WorkspaceSubpropertiesOptions = {},
  ): Promise<SubPropertyInfo[]> {
    return this.discoveryService.listSubproperties(propertyName, options);
  }

  /**
   * List saved funnels (`funnels`, `workspace.py:1193-1204`). Cached.
   *
   * @returns Funnel infos sorted by name.
   * @throws AuthenticationError - Credentials rejected.
   */
  async funnels(): Promise<FunnelInfo[]> {
    return this.discoveryService.listFunnels();
  }

  /**
   * List saved cohorts (`cohorts`, `workspace.py:1206-1217`). Cached.
   *
   * @returns Saved cohorts sorted by name.
   * @throws AuthenticationError - Credentials rejected.
   */
  async cohorts(): Promise<SavedCohort[]> {
    return this.discoveryService.listCohorts();
  }

  /**
   * List saved reports (bookmarks) (`list_bookmarks`,
   * `workspace.py:1219-1241`). NOT cached.
   *
   * @param bookmarkType - Optional report-type filter.
   * @returns Bookmark metadata rows (empty when none exist).
   * @throws QueryError - Permission denied or invalid type parameter.
   */
  async listBookmarks(
    bookmarkType: BookmarkType | null = null,
  ): Promise<BookmarkInfo[]> {
    return this.discoveryService.listBookmarks(bookmarkType);
  }

  /**
   * Today's most active events (`top_events`,
   * `workspace.py:1243-1271`). NOT cached — real-time data.
   *
   * @param options - Counting method and limit.
   * @returns Top events with `event`, `count` and `percent_change`.
   * @throws AuthenticationError - Credentials rejected.
   */
  async topEvents(
    options: WorkspaceTopEventsOptions = {},
  ): Promise<TopEvent[]> {
    return this.discoveryService.listTopEvents({
      type: options.type ?? "general",
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
    });
  }

  /**
   * Clear cached discovery results (`clear_discovery_cache`,
   * `workspace.py:1273-1279`).
   *
   * Mirrors Python's guard exactly: when the discovery service has
   * never been created there is nothing to clear and NO service is
   * constructed as a side effect.
   */
  async clearDiscoveryCache(): Promise<void> {
    if (this.#discovery !== null) {
      this.#discovery.clearCache();
    }
  }

  /**
   * List Lexicon schemas (`lexicon_schemas`,
   * `workspace.py:1285-1313`). Cached for the facade's lifetime — the
   * Lexicon API allows only 5 requests/minute.
   *
   * @param options - Optional entity-type filter.
   * @returns Schemas sorted by `(entity_type, name)`.
   * @throws AuthenticationError - Credentials rejected.
   */
  async lexiconSchemas(
    options: WorkspaceLexiconSchemasOptions = {},
  ): Promise<LexiconSchema[]> {
    return this.discoveryService.listSchemas(options);
  }

  /**
   * Get one Lexicon schema (`lexicon_schema`,
   * `workspace.py:1315-1344`). Cached.
   *
   * @param entityType - Entity type (`"event"` / `"profile"`).
   * @param name - Entity name.
   * @returns The schema.
   * @throws QueryError - Schema not found.
   */
  async lexiconSchema(
    entityType: EntityType,
    name: string,
  ): Promise<LexiconSchema> {
    return this.discoveryService.getSchema(entityType, name);
  }

  /**
   * Gather the full Lexicon schema and the event↔property
   * relationships (`schema_graph`, `workspace.py:1346-1394`). Cached
   * per `(include_density, include_user_properties)`.
   *
   * Group properties are not gathered (headless has no data-groups
   * listing to enumerate them).
   *
   * @param options - Density / user-property / refresh switches.
   * @returns The schema graph, with row views and `toGraph()`.
   * @throws AuthenticationError - Credentials rejected.
   *
   * @example
   * ```typescript
   * const schema = await ws.schemaGraph();
   * schema.propertiesForEvent("Purchase");
   * schema.toGraph();
   * ```
   */
  async schemaGraph(
    options: WorkspaceSchemaGraphOptions = {},
  ): Promise<SchemaGraphResult> {
    return this.discoveryService.getSchemaGraph(options);
  }

  // === B5-S3 session-replay members (append-only; S3 owns) ===

  /**
   * Get or create the session-replay service (044, lazy
   * initialization — `_replays_service`, `workspace.py:1019-1033`).
   *
   * Constructed on first access with the BOUND {@link query} so
   * `ReplaysService.discover` / `eventsFor` can issue Insights queries
   * without taking a hard dependency on `Workspace`
   * (circular-import-free DI, `replays.py:150-176`). S2 left this
   * accessor for S3 because `ReplaysService` did not exist in the tree
   * when S2 landed (`B5-S2-notes.md` §2).
   *
   * Settable, mirroring Python's `self._replays_svc = ...` attribute
   * assignment — the seam the Layer-3 suites and the conformance
   * bindings substitute a stub through.
   *
   * @returns The memoized service.
   * @internal
   */
  get replaysService(): ReplaysService {
    if (this.#replays === null) {
      this.#replays = new ReplaysService(this.client, {
        queryFn: async (
          events: string,
          options: Readonly<Record<string, unknown>>,
        ) => this.query(events, options as WorkspaceQueryOptions),
        ...(this.#warn !== undefined ? { warn: this.#warn } : {}),
        ...(this.#logger !== undefined ? { logger: this.#logger } : {}),
      });
    }
    return this.#replays;
  }

  /**
   * Replace the memoized replays service (Python's plain attribute
   * write).
   *
   * @param service - The service to bind.
   * @internal
   */
  set replaysService(service: ReplaysService) {
    this.#replays = service;
  }

  /**
   * List replays for a user, or hydrate summaries for explicit IDs
   * (`list_replays`, `workspace.py:10679-10755`).
   *
   * Exactly one of `distinct_id` or `replay_ids` MUST be provided.
   * When `distinct_id` is set, `from_date` and `to_date` are required.
   *
   * @param options - The selector, the optional window, and the limit.
   * @returns `ReplaySummary` rows, possibly empty.
   * @throws ParamValidationError - Neither or both selectors
   *   (`WR4_REPLAY_SELECTOR_REQUIRED`), or `distinct_id` without a date
   *   window (`WR5_DATE_RANGE_REQUIRED`).
   * @throws QueryError - Underlying Insights API failure.
   */
  async listReplays(
    options: WorkspaceListReplaysOptions = {},
  ): Promise<ReplaySummary[]> {
    const distinctId = options.distinct_id ?? null;
    const replayIds = options.replay_ids ?? null;
    const fromDate = options.from_date ?? null;
    const toDate = options.to_date ?? null;
    const limit = options.limit ?? 100;

    // Guard order is SOURCE order (`workspace.py:10730-10744`); Python's
    // `not replay_ids` is falsiness, so an EMPTY list trips WR4.
    const hasReplayIds = replayIds !== null && replayIds.length > 0;
    if (distinctId === null && !hasReplayIds) {
      throw new ParamValidationError(
        "list_replays requires exactly one of distinct_id or replay_ids.",
        "WR4_REPLAY_SELECTOR_REQUIRED",
      );
    }
    if (distinctId !== null && hasReplayIds) {
      throw new ParamValidationError(
        "list_replays requires exactly one of distinct_id or " +
          "replay_ids; both were given.",
        "WR4_REPLAY_SELECTOR_REQUIRED",
      );
    }
    if (distinctId !== null && (fromDate === null || toDate === null)) {
      throw new ParamValidationError(
        "list_replays(distinct_id=...) requires from_date and to_date.",
        "WR5_DATE_RANGE_REQUIRED",
      );
    }

    return this.replaysService.discover({
      distinctId,
      replayIds,
      fromDate,
      toDate,
      limit,
    });
  }

  /**
   * Mixpanel events that occurred during a single replay's time window
   * (`events_for_replay`, `workspace.py:10757-10793`).
   *
   * @param replayId - The replay to fetch events for.
   * @param options - Extra group keys and the optional window.
   * @returns Ordered `ReplayEvent`s; empty when the window has none.
   * @throws ParamValidationError - More than 5 `event_properties`
   *   (`WR1_TOO_MANY_EVENT_PROPERTIES`).
   * @throws QueryError - Underlying Insights API failure.
   */
  async eventsForReplay(
    replayId: string,
    options: WorkspaceEventsForReplayOptions = {},
  ): Promise<ReplayEvent[]> {
    checkEventPropertiesCount(options.event_properties ?? null);
    const bundle = await this.replaysService.eventsFor([replayId], {
      eventProperties: options.event_properties ?? null,
      fromDate: options.from_date ?? null,
      toDate: options.to_date ?? null,
    });
    return bundle.get(replayId) ?? [];
  }

  /**
   * Batched version of {@link eventsForReplay} — single round-trip
   * (`events_for_replays`, `workspace.py:10795-10830`).
   *
   * @param replayIds - Replays to fetch events for.
   * @param options - Extra group keys and the optional window.
   * @returns `replay_id` → ordered `ReplayEvent` list (R4.8 Map);
   *   replays with no events are omitted.
   * @throws ParamValidationError - More than 5 `event_properties`
   *   (`WR1_TOO_MANY_EVENT_PROPERTIES`).
   * @throws QueryError - Underlying Insights API failure.
   */
  async eventsForReplays(
    replayIds: readonly string[],
    options: WorkspaceEventsForReplayOptions = {},
  ): Promise<Map<string, ReplayEvent[]>> {
    checkEventPropertiesCount(options.event_properties ?? null);
    return this.replaysService.eventsFor(replayIds, {
      eventProperties: options.event_properties ?? null,
      fromDate: options.from_date ?? null,
      toDate: options.to_date ?? null,
    });
  }

  /**
   * Sign a single replay ID; sugar over {@link signReplays}
   * (`sign_replay`, `workspace.py:10832-10852`).
   *
   * @param replayId - Replay to sign.
   * @param options - `env` (`"prod"` default).
   * @returns One `SignedReplay`. `query_string` is a 5-minute bearer
   *   credential — treat it like a session token.
   * @throws SessionReplayAccessError - Sensitive-data flag set.
   * @throws QueryError | ServerError - Other 4xx / 5xx.
   */
  async signReplay(
    replayId: string,
    options: WorkspaceSignReplayOptions = {},
  ): Promise<SignedReplay> {
    const signed = await this.replaysService.sign(
      [replayId],
      options.env ?? "prod",
    );
    return signed[0] as SignedReplay;
  }

  /**
   * Sign multiple replays via the bulk endpoint (`sign_replays`,
   * `workspace.py:10854-10873`).
   *
   * @param replayIds - Replays to sign.
   * @param options - `env` (`"prod"` default).
   * @returns `SignedReplay`s in input order.
   * @throws SessionReplayAccessError - Sensitive-data flag set.
   * @throws QueryError | ServerError - Other 4xx / 5xx.
   */
  async signReplays(
    replayIds: readonly string[],
    options: WorkspaceSignReplayOptions = {},
  ): Promise<SignedReplay[]> {
    return this.replaysService.sign(replayIds, options.env ?? "prod");
  }

  /**
   * Sign, fetch, and assemble a single `Replay` (`fetch_replay`,
   * `workspace.py:10875-10981`).
   *
   * Runs the vendored rrweb analyzer to populate `Replay.actions`; the
   * raw `rrweb_events` list is also populated for downstream tools.
   *
   * Python's event-loop caveat (`asyncio.run` cannot run inside a
   * running loop) has NO TS twin — this member is `async` and composes
   * naturally (R6.1). The Python docstring's guidance to drive
   * `walk_cdn_async` directly maps to
   * {@link ReplaysService.walkCdnAsync}, which is public here too.
   *
   * @param replayId - The replay to fetch.
   * @param options - Retention / bounds / concurrency / join knobs.
   * @returns A `Replay` with `rrweb_events` and `actions` populated.
   * @throws ReplayNotFoundError - First CDN file 404'd, or the walk
   *   yielded zero events.
   * @throws SessionReplayAccessError - Sensitive-data flag set.
   * @throws SignedURLExpiredError - Signed URL expired during fetch.
   * @throws ParamValidationError - More than 5 `event_properties`.
   */
  async fetchReplay(
    replayId: string,
    options: WorkspaceFetchReplayOptions = {},
  ): Promise<Replay> {
    checkEventPropertiesCount(options.event_properties ?? null);
    const env = options.env ?? "prod";
    const resolvedRetention = await this.#resolveRetention(
      replayId,
      options.retention_days ?? null,
    );
    const signed = (await this.replaysService.sign([replayId], env))[0];
    const rrwebEvents = await this.replaysService.fetchFiles(
      signed as SignedReplay,
      {
        retentionDays: resolvedRetention,
        maxFiles: options.max_files ?? 500,
        concurrency: options.cdn_concurrency ?? 50,
      },
    );
    if (rrwebEvents.length === 0) {
      throw replayNotFoundError(replayId, {
        retentionDays: resolvedRetention,
        cdnUrlPrefix: (signed as SignedReplay).url,
      });
    }

    // Derive the window from min/max rather than first/last:
    // `walkCdnAsync` yields in (file-number, in-file timestamp) order
    // with no global merge, so indexing [0]/[-1] would drift if CDN
    // files ever overlap in time.
    // Python `int(ev["timestamp"])` (`workspace.py:10946`) — a
    // SUBSCRIPT, so a missing key is a KeyError, not the int() ladder's
    // TypeError (B5-ARB FID-F5).
    const eventTimestamps = rrwebEvents.map((ev) => {
      if (!Object.hasOwn(ev, "timestamp")) {
        throw new KeyError("timestamp");
      }
      return pythonIntCoerce(ev["timestamp"]);
    });
    const startTime = Math.min(...eventTimestamps);
    const endTime = Math.max(...eventTimestamps);

    let mixpanelEvents: ReplayEvent[] = [];
    if (options.include_mixpanel_events === true) {
      // Scope the events scan to the replay's own day(s).
      const winFrom = utcYmdFromEpochMs(startTime);
      const winTo = utcYmdFromEpochMs(endTime);
      mixpanelEvents = await this.eventsForReplay(replayId, {
        event_properties: options.event_properties ?? null,
        from_date: winFrom,
        to_date: winTo,
      });
    }

    // Run the rrweb analyzer to populate actions.
    const analyzerResult = new RrwebAnalyzer().analyze(rrwebEvents);
    return new Replay({
      replay_id: replayId,
      distinct_id: options.distinct_id ?? null,
      project_id: this.#projectId(),
      start_time: startTime,
      end_time: endTime,
      retention_days: resolvedRetention,
      rrweb_events: rrwebEvents,
      actions: [...analyzerResult.actions],
      mixpanel_events: mixpanelEvents,
    });
  }

  /**
   * Yield raw rrweb events one at a time, batched-parallel under the
   * hood (`stream_replay`, `workspace.py:10983-11043`).
   *
   * R6.6 — item-level `yield*` over the service generator; nothing
   * buffers. Python's private-event-loop plumbing
   * (`asyncio.new_event_loop` + `run_until_complete(gen.__anext__())`)
   * has no TS twin: the async generator composes directly, and the
   * `finally: gen.aclose()` contract is what `for await` +
   * `AsyncGenerator.return()` already guarantee.
   *
   * @param replayId - The replay to stream.
   * @param options - Retention / bounds / concurrency / re-sign policy.
   * @yields Raw rrweb event dicts in timestamp order.
   * @throws ReplayNotFoundError - First CDN file 404'd.
   * @throws SignedURLExpiredError - Re-sign retry exhausted or
   *   disabled.
   * @throws SessionReplayAccessError - Sensitive-data flag set.
   */
  async *streamReplay(
    replayId: string,
    options: WorkspaceStreamReplayOptions = {},
  ): AsyncGenerator<Readonly<Record<string, unknown>>, void, undefined> {
    const resolvedRetention = await this.#resolveRetention(
      replayId,
      options.retention_days ?? null,
    );
    const signed = (
      await this.replaysService.sign([replayId], options.env ?? "prod")
    )[0];
    yield* this.replaysService.walkCdnAsync(signed as SignedReplay, {
      retentionDays: resolvedRetention,
      maxFiles: options.max_files ?? 500,
      concurrency: options.cdn_concurrency ?? 50,
      reSignOnExpiry: options.re_sign_on_expiry ?? true,
    });
  }

  /**
   * Fetch N replays in parallel; return a `ReplayBundle`
   * (`fetch_replays`, `workspace.py:11045-11184`).
   *
   * Materializes each replay via {@link fetchReplay} and bundles them.
   * Outer `concurrency` parallelizes across replays; inner
   * `cdn_concurrency` parallelizes each replay's CDN file walk. Python
   * uses a `ThreadPoolExecutor` purely so each replay's `asyncio.run`
   * gets its own event loop — the TS port needs no such isolation, so
   * the outer level is BOUNDED-CONCURRENCY promise scheduling with the
   * same worker cap, the same input-order output, and the same
   * per-replay failure isolation.
   *
   * Per-replay failures are isolated: a replay that 404s, stalls, or
   * fails to parse is logged and skipped; only an all-fail batch
   * throws (the FIRST underlying error, preserving its type).
   *
   * @param replayIds - Replays to fetch.
   * @param options - Env / bounds / concurrency / join / retention and
   *   distinct-id maps.
   * @returns A `ReplayBundle` with `replays` in INPUT order (failed
   *   replays omitted).
   * @throws MixpanelHeadlessError - Only when every requested replay
   *   failed; the first underlying error propagates with its type.
   * @throws ParamValidationError - More than 5 `event_properties`.
   */
  async fetchReplays(
    replayIds: readonly string[],
    options: WorkspaceFetchReplaysOptions = {},
  ): Promise<ReplayBundle> {
    checkEventPropertiesCount(options.event_properties ?? null);
    const retentionMap = options.retention_by_id ?? new Map<string, number>();
    const distinctMap = options.distinct_id_by_id ?? new Map<string, string>();
    const concurrency = Math.max(1, options.concurrency ?? 4);

    // Events are joined ONCE after assembly (below), not per replay — so
    // each fetch runs with include_mixpanel_events=false here regardless
    // of the caller's flag.
    const results = new Map<number, Replay>();
    const failures: Array<[string, unknown]> = [];
    let cursor = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= replayIds.length) {
          return;
        }
        const rid = replayIds[index] as string;
        try {
          results.set(
            index,
            await this.fetchReplay(rid, {
              distinct_id: mapGet(distinctMap, rid) ?? null,
              env: options.env ?? "prod",
              retention_days: mapGet(retentionMap, rid) ?? null,
              max_files: options.max_files ?? 500,
              include_mixpanel_events: false,
              cdn_concurrency: options.cdn_concurrency ?? 50,
            }),
          );
        } catch (exc) {
          // One replay's CDN stall, 404, or parse error must not sink
          // the whole bundle. Log it and keep the successful replays;
          // only an all-fail batch raises.
          this.#logger?.warning?.(
            `fetch_replays: skipping replay ${rid} — ` +
              `${exc instanceof Error ? exc.name : typeof exc}: ${String(exc)}`,
          );
          failures.push([rid, exc]);
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(concurrency, replayIds.length) }, () =>
        worker(),
      ),
    );
    if (results.size === 0 && failures.length > 0) {
      // Every replay failed — surface the first underlying error rather
      // than a generic wrapper, preserving its type for callers that
      // branch on it. Python's `failures[0]` is completion-ordered
      // (`as_completed`); the port keeps INPUT order, which is the
      // deterministic reading of the same rule (recorded in
      // `B5-S3-notes.md` §2).
      throw failures[0]?.[1];
    }
    let ordered = [...results.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, replay]) => replay);

    // Join Mixpanel events in ONE query across all replays (the
    // per-replay alternative fans out N queries and exhausts the
    // Insights rate limit). The combined window spans the earliest
    // start to the latest end.
    if (options.include_mixpanel_events === true && ordered.length > 0) {
      const winFrom = utcYmdFromEpochMs(
        Math.min(...ordered.map((r) => r.start_time)),
      );
      const winTo = utcYmdFromEpochMs(
        Math.max(...ordered.map((r) => r.end_time)),
      );
      const eventsByReplay = await this.eventsForReplays(
        ordered.map((r) => r.replay_id),
        {
          event_properties: options.event_properties ?? null,
          from_date: winFrom,
          to_date: winTo,
        },
      );
      ordered = ordered.map((r) =>
        eventsByReplay.has(r.replay_id)
          ? replaceReplayEvents(
              r,
              eventsByReplay.get(r.replay_id) as ReplayEvent[],
            )
          : r,
      );
    }
    return new ReplayBundle({
      replays: ordered,
      computed_at: isoUtc(this.client.core.now()),
      project_id: this.#projectId(),
    });
  }

  /**
   * Discovery + fetch in one call (`replays_for_user`,
   * `workspace.py:11186-11249`).
   *
   * Composes {@link listReplays} and {@link fetchReplays}. Defaults
   * `include_mixpanel_events` to `true` since this is the "show me what
   * this user did" convenience method. The default `limit` is a
   * conservative 20 — each replay materializes its full byte stream.
   *
   * @param distinctId - Mixpanel user identifier.
   * @param options - The required window plus the limit / join knobs.
   * @returns A `ReplayBundle`; empty when no replays exist in the
   *   window.
   * @throws ParamValidationError - More than 5 `event_properties`.
   */
  async replaysForUser(
    distinctId: string,
    options: WorkspaceReplaysForUserOptions,
  ): Promise<ReplayBundle> {
    checkEventPropertiesCount(options.event_properties ?? null);
    const summaries = await this.listReplays({
      distinct_id: distinctId,
      from_date: options.from_date,
      to_date: options.to_date,
      limit: options.limit ?? 20,
    });
    if (summaries.length === 0) {
      return new ReplayBundle({
        replays: [],
        computed_at: isoUtc(this.client.core.now()),
        project_id: this.#projectId(),
      });
    }
    return this.fetchReplays(
      summaries.map((s) => s.replay_id),
      {
        include_mixpanel_events: options.include_mixpanel_events ?? true,
        event_properties: options.event_properties ?? null,
        // We already discovered each replay's retention above — pass it
        // through so fetchReplay skips re-discovering it per replay.
        retention_by_id: new Map(
          summaries.map((s) => [s.replay_id, s.retention_days]),
        ),
        // Every replay was discovered for this user — stamp it.
        distinct_id_by_id: new Map(
          summaries.map((s) => [s.replay_id, distinctId]),
        ),
      },
    );
  }

  /**
   * Sign + fetch + analyze a replay, returning only the markdown
   * timeline (`analyze_replay`, `workspace.py:11251-11273`).
   *
   * @param replayId - The replay to analyze.
   * @returns The markdown timeline (`Replay.summaryMarkdown()`).
   * @throws ReplayNotFoundError - First CDN file 404'd.
   * @throws SessionReplayAccessError - Sensitive-data flag set.
   */
  async analyzeReplay(replayId: string): Promise<string> {
    return (await this.fetchReplay(replayId)).summaryMarkdown();
  }

  /**
   * Resolve a replay's retention window, discovering it when `null`
   * (`_resolve_retention`, `workspace.py:11275-11292`).
   *
   * @param replayId - The replay to look up.
   * @param retentionDays - Caller-provided value; pass-through when
   *   set.
   * @returns One of 1, 7, 30, or 90. Defaults to 30 when discovery
   *   returns no summary (the warning already fired in `discover`).
   */
  async #resolveRetention(
    replayId: string,
    retentionDays: number | null,
  ): Promise<number> {
    if (retentionDays !== null) {
      return retentionDays;
    }
    const summaries = await this.listReplays({ replay_ids: [replayId] });
    if (summaries.length > 0) {
      return (summaries[0] as ReplaySummary).retention_days;
    }
    return 30;
  }

  // === B6 members land below in W1–W7 sections (append-only) ===

  // === B6-W1 lifecycle / workspace-management / me / business-context
  // members (W1 owns; append-only) ===

  /**
   * The resolved account of the current session (`account` property,
   * `workspace.py:530-533`).
   */
  get account(): Account {
    return this.#session.account;
  }

  /**
   * The resolved project of the current session (`project` property,
   * `workspace.py:535-538`).
   */
  get project(): Project {
    return this.#session.project;
  }

  /**
   * The resolved workspace, or `null` when scoping stays lazy
   * (`workspace` property, `workspace.py:540-543`).
   */
  get workspace(): WorkspaceRef | null {
    return this.#session.workspace ?? null;
  }

  /**
   * Direct access to the wire client — the escape hatch for endpoints
   * the facade does not cover (`api` property,
   * `workspace.py:4464-4501`).
   */
  get api(): MixpanelClient {
    return this.client;
  }

  /**
   * Get or create the `/me` service (`_me_svc`,
   * `workspace.py:865-885`).
   *
   * @returns The memoized service, scoped to the CURRENT account.
   * @internal
   */
  get meService(): MeService {
    if (this.#meService === null) {
      this.#meService = new MeService(
        this.client,
        this.#meCacheFactory(this.#accountName),
        this.#session.account.region,
        { accountType: this.#session.account.type },
      );
    }
    return this.#meService;
  }

  /**
   * The `/me` service ONLY IF it has already been created — the
   * `self._me_service is None` peek `_cached_organization_id` performs
   * (`workspace.py:10355-10357`). Never constructs one.
   *
   * @internal
   */
  get meServiceIfCreated(): MeService | null {
    return this.#meService;
  }

  /**
   * List every public workspace of the current project
   * (`list_workspaces`, `workspace.py:801-824`).
   *
   * @returns The project's `PublicWorkspace` models.
   * @throws AuthenticationError | QueryError | ServerError - Wire
   *   failures.
   */
  async listWorkspaces(): Promise<PublicWorkspace[]> {
    return this.client.listWorkspaces();
  }

  /**
   * Resolve the workspace ID used for scoped requests
   * (`resolve_workspace_id`, `workspace.py:827-860`).
   *
   * @returns The resolved workspace ID.
   * @throws WorkspaceScopeError - No workspace resolvable.
   */
  async resolveWorkspaceId(): Promise<number> {
    return this.client.resolveWorkspaceId();
  }

  /**
   * Get the `/me` response for the current credentials (cached 24h by
   * the injected store) — `me`, `workspace.py:886-911`.
   *
   * @param options - `force_refresh` bypasses the caches.
   * @returns The `/me` response.
   * @throws ConfigError - Credentials lack `/me` access (401/403).
   * @throws QueryError - Any other API error.
   */
  async me(options: WorkspaceMeOptions = {}): Promise<MeResponse> {
    return this.meService.fetch({
      force_refresh: options.force_refresh ?? false,
    });
  }

  /**
   * List accessible projects via the `/me` API (FR-035; `projects`,
   * `workspace.py:913-956`).
   *
   * @param options - `refresh` bypasses the `/me` caches first.
   * @returns Projects sorted by name.
   * @throws ConfigError - Credentials lack `/me` access.
   *
   * @example
   * ```typescript
   * for (const project of await ws.projects()) {
   *   await ws.use({ project: project.id });
   * }
   * ```
   */
  async projects(options: WorkspaceProjectsOptions = {}): Promise<Project[]> {
    const service = this.meService;
    if (options.refresh === true) {
      await service.fetch({ force_refresh: true });
    }
    const entries = await service.listProjects();
    return entries.map(([pid, info]) => ({
      id: pid,
      name: info.name,
      organization_id: info.organization_id,
      timezone: info.timezone,
    }));
  }

  /**
   * List a project's workspaces via the `/me` API (FR-036;
   * `workspaces`, `workspace.py:958-1003`).
   *
   * @param options - `project_id` (defaults to the current project)
   *   and `refresh`.
   * @returns Workspace references sorted by name.
   * @throws ConfigError - Credentials lack `/me` access, or a
   *   non-numeric `project_id`.
   */
  async workspaces(
    options: WorkspaceWorkspacesOptions = {},
  ): Promise<WorkspaceRef[]> {
    const service = this.meService;
    if (options.refresh === true) {
      await service.fetch({ force_refresh: true });
    }
    const pid = options.project_id ?? this.#session.project.id;
    const infos = await service.listWorkspaces({ project_id: pid });
    return infos.map((info) => ({
      id: info.id,
      name: info.name,
      is_default: info.is_default,
    }));
  }

  /**
   * Stream events straight from the Export API (`stream_events`,
   * `workspace.py:1400-1467`) — the W1-D3 R6.6 veneer over the B4-C2
   * helper. PROJECT-scoped by design even when a workspace is pinned.
   *
   * @param options - Date window plus filters / `raw`.
   * @returns An async generator of event dicts.
   * @throws ParamValidationError - `WR2_LIMIT_TOO_SMALL` /
   *   `WR3_LIMIT_TOO_LARGE` (on the first pull).
   */
  async *streamEvents(
    options: StreamEventsOptions,
  ): AsyncGenerator<unknown, void, undefined> {
    yield* streamEventsVeneer(this.client, options);
  }

  /**
   * Stream user profiles straight from the Engage API
   * (`stream_profiles`, `workspace.py:1469-1578`) — the W1-D3 R6.6
   * veneer over the B4-C2 helper.
   *
   * @param options - Filters plus `raw`.
   * @returns An async generator of profile dicts.
   * @throws ParamValidationError - The mutually-exclusive-filter
   *   guards (on the first pull).
   */
  async *streamProfiles(
    options: StreamProfilesOptions = {},
  ): AsyncGenerator<unknown, void, undefined> {
    yield* streamProfilesVeneer(this.client, options);
  }

  /**
   * Read business context at the given scope
   * (`get_business_context`, `workspace.py:10405-10479`).
   *
   * @param options - `level` (default `"project"`) and an optional
   *   explicit `organization_id`.
   * @returns The populated context (`content: ""` when unset).
   * @throws ParamValidationError - `WS2_INVALID_LEVEL`.
   * @throws WorkspaceScopeError - `ORGANIZATION_AMBIGUOUS`.
   * @throws MixpanelHeadlessError - Response missing `content`.
   */
  async getBusinessContext(
    options: BusinessContextScopeOptions = {},
  ): Promise<BusinessContext> {
    return getBusinessContextMember(this.#businessContextHost(), options);
  }

  /**
   * Replace business context at the given scope
   * (`set_business_context`, `workspace.py:10481-10566`).
   *
   * @param content - New markdown content (empty string clears).
   * @param options - `level` / `organization_id`.
   * @returns The context echoed by the server.
   * @throws BusinessContextValidationError - Content over 50,000
   *   characters (no HTTP call is made).
   * @throws ParamValidationError - `WS2_INVALID_LEVEL`.
   */
  async setBusinessContext(
    content: string,
    options: BusinessContextScopeOptions = {},
  ): Promise<BusinessContext> {
    return setBusinessContextMember(
      this.#businessContextHost(),
      content,
      options,
    );
  }

  /**
   * Clear business context at the given scope
   * (`clear_business_context`, `workspace.py:10568-10610`) — the
   * documented alias for `set_business_context("")`.
   *
   * @param options - `level` / `organization_id`.
   * @returns The cleared context.
   * @throws ParamValidationError - `WS2_INVALID_LEVEL`.
   */
  async clearBusinessContext(
    options: BusinessContextScopeOptions = {},
  ): Promise<BusinessContext> {
    return this.setBusinessContext("", options);
  }

  /**
   * Read organization and project business context together in ONE
   * request (`get_business_context_chain`,
   * `workspace.py:10612-10674`).
   *
   * @returns Both scopes; `organization.organization_id` stays `null`
   *   when the `/me` cache is cold (single-round-trip guarantee).
   * @throws MixpanelHeadlessError - Response missing `org_context` or
   *   `project_context`.
   */
  async getBusinessContextChain(): Promise<BusinessContextChain> {
    return getBusinessContextChainMember(this.#businessContextHost());
  }

  /**
   * The facade slice the business-context member module reads.
   *
   * @returns The host view over this facade.
   * @internal
   */
  #businessContextHost(): BusinessContextHost {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const facade = this;
    return {
      client: facade.client,
      projectId: facade.#session.project.id,
      get meService(): MeService {
        return facade.meService;
      },
      get meServiceIfCreated(): MeService | null {
        return facade.meServiceIfCreated;
      },
    };
  }
}

/**
 * Raise a coded error when `event_properties` exceeds the Insights cap
 * (`_check_event_properties_count`, `workspace.py:303-324`).
 *
 * Mixpanel's Insights API caps group-by at 5 properties; the
 * session-replay surfaces all pass through to that endpoint.
 *
 * @param eventProperties - Caller-supplied list (or `null`).
 * @throws ParamValidationError - Code `WR1_TOO_MANY_EVENT_PROPERTIES`.
 */
export function checkEventPropertiesCount(
  eventProperties: readonly string[] | null,
): void {
  if (eventProperties !== null && eventProperties.length > 5) {
    throw new ParamValidationError(
      `events_for_replay accepts at most 5 event_properties ` +
        `(Insights group-by limit). Got ${String(eventProperties.length)}: ` +
        `${pythonRepr(eventProperties as unknown as PythonValue)}`,
      "WR1_TOO_MANY_EVENT_PROPERTIES",
    );
  }
}

/**
 * `datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y-%m-%d")`
 * — the two window-derivation sites in `fetch_replay` / `fetch_replays`
 * (`workspace.py:10958-10963`, `:11205-11210`).
 *
 * @param epochMs - Unix milliseconds.
 * @returns The `YYYY-MM-DD` UTC date.
 */
function utcYmdFromEpochMs(epochMs: number): string {
  const date = new Date(epochMs);
  return [
    zfill(String(date.getUTCFullYear()), 4),
    zfill(String(date.getUTCMonth() + 1), 2),
    zfill(String(date.getUTCDate()), 2),
  ].join("-");
}

/**
 * `dataclasses.replace(replay, mixpanel_events=...)` — the one
 * `replace()` site in `fetch_replays` (`workspace.py:11178-11182`).
 *
 * @param replay - The replay to copy.
 * @param mixpanelEvents - The events to attach.
 * @returns A new `Replay` with the events attached.
 */
function replaceReplayEvents(
  replay: Replay,
  mixpanelEvents: readonly ReplayEvent[],
): Replay {
  return new Replay({
    replay_id: replay.replay_id,
    distinct_id: replay.distinct_id,
    project_id: replay.project_id,
    start_time: replay.start_time,
    end_time: replay.end_time,
    retention_days: replay.retention_days,
    rrweb_events: replay.rrweb_events,
    actions: replay.actions,
    mixpanel_events: mixpanelEvents,
  });
}

/**
 * `Mapping.get(key)` over the optional retention / distinct-id maps,
 * which callers may hand in as a `Map` OR a plain record.
 *
 * @param source - The map or record.
 * @param key - The replay id.
 * @returns The value, or `undefined`.
 */
function mapGet<T>(
  source: ReadonlyMap<string, T> | Readonly<Record<string, T>>,
  key: string,
): T | undefined {
  if (source instanceof Map) {
    return source.get(key);
  }
  const record = source as Readonly<Record<string, T>>;
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/**
 * Convert a B4 client response to the native tree Python's
 * `json.loads` produces (the engage-stats body is read with plain
 * `dict.get` in Python).
 *
 * @param value - The lossless response tree.
 * @returns The native-valued record.
 */
function toNativeRecord(value: unknown): Record<string, unknown> {
  return toNativeJson(value as JsonValue) as Record<string, unknown>;
}
