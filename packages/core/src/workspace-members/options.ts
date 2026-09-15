/**
 * Option bags of the `Workspace` facade — every `Workspace*Options`
 * interface, the {@link WorkspaceLogger} seam and the option types the
 * member modules declare next to their functions (re-exported here so
 * the facade has one options surface).
 *
 * Constructor/config bags (`WorkspaceOptions`) are camelCase; the bags
 * that mirror a Python method's keyword arguments 1:1 keep snake_case
 * (README "Naming").
 */

import type { ResolverSources } from "../auth/resolver.js";
import type { Session } from "../auth/session.js";
import type {
  MixpanelClient,
  MixpanelClientOptions,
} from "../client/client.js";
import type { DiscoveryLogger, WarningSink } from "../services/discovery.js";
import type {
  FlowMode,
  LiveEventCountsOptions,
  LiveFrequencyOptions,
  LiveFunnelOptions,
  LiveNumericOptions,
  LivePropertyCountsOptions,
  LiveRetentionOptions,
  LiveSegmentationNumericOptions,
  LiveSegmentationOptions,
} from "../services/live-query.js";
import type { MeCacheStore } from "../services/me.js";
import type {
  BookmarkType,
  EntityType,
  ReportLinkType,
} from "../types/literals.js";
import type { CohortDefinition } from "../types/query-params/cohort.js";
import type { Filter } from "../types/query-params/filter.js";
import type {
  Exclusion,
  HoldingConstant,
} from "../types/query-params/funnel.js";
import type { TimeComparison } from "../types/query-params/metric.js";
import type {
  FlowQueryResult,
  FunnelQueryResult,
  QueryResult,
  RetentionQueryResult,
} from "../types/results/query-engine.js";
import type {
  FilterWhereInput,
  GroupByInput,
  TodayFn,
  WhereInput,
} from "../workspace-query-params.js";
import type { ResolverSeams } from "./lifecycle.js";

/** Options bag of the {@link Workspace} constructor. */
export interface WorkspaceOptions {
  /**
   * A pre-built RESOLVED session — the full resolver bypass
   * (`Workspace(session=…)`, `workspace.py:473-474`). When absent, the
   * B7 resolver axes ({@link account} / {@link project} /
   * {@link workspace} / {@link target}) resolve through
   * `resolveSession(...)` over {@link sources}.
   */
  readonly session?: Session | undefined;
  /** Named account from config (resolver axis, `workspace.py:427`). */
  readonly account?: string | null | undefined;
  /** Project ID override (resolver axis, digit string). */
  readonly project?: string | null | undefined;
  /** Workspace ID override (resolver axis, positive int). */
  readonly workspace?: number | null | undefined;
  /**
   * Apply all three axes from `[targets.NAME]`. Mutually exclusive
   * with `account`/`project`/`workspace`
   * (`WS1_TARGET_MUTUALLY_EXCLUSIVE`, `workspace.py:455-465`).
   */
  readonly target?: string | null | undefined;
  /**
   * The injected resolver sources used when no {@link session} is
   * given (R9.4 — Python builds `ConfigManager()` / `load_bridge()`
   * inline; B8's node wiring supplies the on-disk defaults). Required
   * for resolver-path construction in `packages/core`.
   */
  readonly sources?: ResolverSources | undefined;
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
   * Slug minter for {@link Workspace.createReportLink} (the
   * `generate_slug` seam Python tests patch; R6.3). Defaults to the
   * CSPRNG-backed `generateSlug()`.
   */
  readonly generateSlug?: (() => string) | undefined;
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
  /**
   * `Path(file_path).read_bytes()` for {@link Workspace.uploadLookupTable}
   * (`workspace.py:8044`) — B6-W7 decision W7-D1. `packages/core` is
   * runtime-agnostic, so the byte source is injected; the default
   * throws `UNPORTED_FILE_READ_SEAM` until B8 wires `node:fs` in
   * `packages/node`.
   */
  readonly readFile?: ((path: string) => Promise<Uint8Array>) | undefined;
  /**
   * `time.monotonic()` in SECONDS, used by the
   * {@link Workspace.uploadLookupTable} poll deadline
   * (`workspace.py:8099`) — B6-W7 decision W7-D2. Default:
   * `Date.now() / 1000`.
   */
  readonly monotonic?: (() => number) | undefined;
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
  warning?: (message: string) => void;
  /**
   * Record an informational message — added at B6-W7 for the single
   * `logger.info` site of the lookup-table upload orchestrator
   * (`workspace.py:8062-8066`).
   *
   * @param message - The formatted text (never vector-compared).
   */
  info?: (message: string) => void;
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
  /**
   * Segments to return, 1 to 50000. Default `null` keeps the 3000 the
   * Mixpanel UI uses. Raise it for a high-cardinality breakdown, and
   * check `result.meta["is_segmentation_limit_hit"]` to see whether the
   * answer was still truncated. Ignored by {@link Workspace.buildParams}
   * (an execution setting the params do not store).
   */
  readonly limit?: number | null | undefined;
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
  /**
   * Segments to return, 1 to 50000. Default `null` keeps the 3000 the
   * Mixpanel UI uses. Ignored by {@link Workspace.buildFunnelParams}.
   */
  readonly limit?: number | null | undefined;
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
  /**
   * Segments to return, 1 to 50000. Default `null` keeps the 3000 the
   * Mixpanel UI uses. Ignored by {@link Workspace.buildRetentionParams}.
   */
  readonly limit?: number | null | undefined;
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
 * Keyword-only arguments of {@link Workspace.runParams},
 * {@link Workspace.runFunnelParams} and
 * {@link Workspace.runRetentionParams} (`workspace.py:2518-2523`,
 * `:3340-3345`, `:4584-4589`).
 */
export interface WorkspaceRunParamsOptions {
  /**
   * Segments to return, 1 to 50000. Default `null` keeps the 3000 the
   * Mixpanel UI uses.
   */
  readonly limit?: number | null | undefined;
  /**
   * Optional data view to run under. Wins over the pinned session
   * workspace.
   */
  readonly workspace_id?: number | null | undefined;
}

/**
 * Keyword-only arguments of {@link Workspace.runFlowParams}
 * (`workspace.py:4170-4175`).
 */
export interface WorkspaceRunFlowParamsOptions {
  /**
   * Flow chart mode. `null` / `undefined` (default) derives it from the
   * params: `flows_merge_type` (`"tree"`, `"list"` for paths, `"graph"`
   * for sankey) when present, else `chartType` (`"top-paths"` or
   * `"paths"` for paths, `"tree"`, anything else sankey). Params from
   * {@link Workspace.buildFlowParams} always resolve to the mode they
   * were built with. Pass a value to override.
   */
  readonly mode?: FlowMode | null | undefined;
  /**
   * Optional data view to run under. Wins over the pinned session
   * workspace.
   */
  readonly workspace_id?: number | null | undefined;
}

/**
 * Keyword-only arguments of {@link Workspace.runUserParams}
 * (`workspace.py:10141-10148`) — the execution settings
 * {@link Workspace.buildUserParams} does not store, with the same
 * defaults as {@link Workspace.queryUser}.
 */
export interface WorkspaceRunUserParamsOptions {
  /**
   * Maximum profiles to return in profiles mode. `null` fetches all
   * matching profiles. Ignored in aggregate mode. Default `1`.
   */
  readonly limit?: number | null | undefined;
  /**
   * Fetch profile pages concurrently. Ignored when `limit` is `1` or
   * in aggregate mode. Default `false`.
   */
  readonly parallel?: boolean | undefined;
  /** Maximum concurrent workers for parallel fetching. Default `5`. */
  readonly workers?: number | undefined;
}

/**
 * `create_report_link` accepts raw bookmark params or a typed result
 * from `query` / `queryFunnel` / `queryRetention` / `queryFlow` (a typed
 * result supplies both the params and the report type).
 */
export type ReportLinkParamsInput =
  | Readonly<Record<string, unknown>>
  | QueryResult
  | FunnelQueryResult
  | RetentionQueryResult
  | FlowQueryResult;

/** Options bag of {@link Workspace.createReportLink} (Python kw-only). */
export interface WorkspaceCreateReportLinkOptions {
  /**
   * `insights`, `funnels`, `retention`, or `flows`. Defaults to
   * `insights` for a dict; inferred from a typed result. An explicit
   * value that contradicts the inferred one is rejected.
   */
  readonly report_type?: ReportLinkType | null | undefined;
  /** Optional name stored with the record. */
  readonly name?: string | undefined;
  /** Optional description stored with the record. */
  readonly description?: string | undefined;
  /**
   * Workspace for the `/view/{wid}` URL segment. Defaults to the pinned
   * session workspace, then `resolveWorkspaceId()`; if nothing resolves
   * the URL is project-only.
   */
  readonly workspace_id?: number | null | undefined;
  /** Optional saved-report reference to store. */
  readonly bookmark_id?: number | null | undefined;
  /**
   * Run the client-side bookmark schema check before the POST
   * (default). `false` sends the params as given.
   */
  readonly validate?: boolean | undefined;
}

/** Options bag of {@link Workspace.queryReportLink} (Python kw-only). */
export interface WorkspaceQueryReportLinkOptions {
  /**
   * Flows chart mode. When `null` it is derived from
   * `params["chartType"]` if that is `sankey`, `paths`, or `tree`, else
   * `sankey`. Ignored for other report types.
   */
  readonly mode?: "sankey" | "paths" | "tree" | null | undefined;
}

/** Options bag of {@link Workspace.savedReportLink} (Python kw-only). */
export interface WorkspaceSavedReportLinkOptions {
  /**
   * `insights` (default), `funnels`, `retention`, `flows`, or
   * `launch-analysis`. The singular `funnel` that
   * `SavedReportResult.report_type` reports is accepted and normalized
   * to `funnels`.
   */
  readonly report_type?: BookmarkType | "funnel" | undefined;
  /**
   * Workspace for the `/view/{wid}` segment. Defaults to the pinned
   * session workspace; when none is pinned the segment is omitted.
   * `resolveWorkspaceId()` is never called here.
   */
  readonly workspace_id?: number | null | undefined;
}
