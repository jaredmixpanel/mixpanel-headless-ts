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
import { pythonInt } from "./compat/python-int.js";
import {
  AuthenticationError,
  MixpanelHeadlessError,
  QueryError,
  RateLimitError,
  ServerError,
} from "./errors.js";
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
  UserQueryResult,
  type FlowQueryResult,
  type FunnelQueryResult,
  type QueryResult,
  type RetentionQueryResult,
} from "./types/results/query-engine.js";
import {
  buildPageKwargs,
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
  /** The resolved session bound to this facade. */
  readonly session: Session;

  /** The bound wire client (Python `self._api_client`). @internal */
  readonly client: MixpanelClient;

  /** Lazily-created discovery service (`self._discovery`). */
  #discovery: DiscoveryService | null = null;

  /** Lazily-created live query service (`self._live_query`). */
  #liveQuery: LiveQueryService | null = null;

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
    this.session = options.session;
    this.client =
      options.client ??
      createMixpanelClient({
        session: options.session,
        ...(options.clientOptions ?? {}),
      });
    this.#warn = options.warn;
    this.#logger = options.logger;
    // TODO(port): the `account` / `project` / `workspace` / `target`
    // constructor kwargs (`workspace.py:427-430`) resolve through
    // `resolve_session(...)` — batch B7. B5 takes a resolved Session.
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
   * Switch account / project / workspace axes in place
   * (`workspace.py` `use`).
   *
   * @returns Never — B6-W1 owns this member.
   * @throws MixpanelHeadlessError - Always, code `UNPORTED_MEMBER`.
   */
  use(): this {
    // TODO(port): B6-W1 — the axis-switch facade (and the discovery-cache
    // reset `TestDiscoveryCacheAcrossUse` locks) land with the resolver.
    throw new MixpanelHeadlessError(
      "Workspace.use() is not ported yet (batch B6-W1)",
      "UNPORTED_MEMBER",
      { member: "workspace.use" },
    );
  }

  /**
   * Release the underlying connection pool (`close`).
   *
   * @returns Never — B6-W1 owns this member.
   * @throws MixpanelHeadlessError - Always, code `UNPORTED_MEMBER`.
   */
  close(): Promise<void> {
    // TODO(port): B6-W1 — pairs with `use()` and the R6.2 connection-reuse
    // invariant.
    return Promise.reject(
      new MixpanelHeadlessError(
        "Workspace.close() is not ported yet (batch B6-W1)",
        "UNPORTED_MEMBER",
        { member: "workspace.close" },
      ),
    );
  }

  /**
   * `await using` support (R6.2) — delegates to {@link close}.
   *
   * @returns Never — B6-W1 owns this member.
   * @throws MixpanelHeadlessError - Always, code `UNPORTED_MEMBER`.
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

  // TODO(port): the `_replays_service` accessor (`workspace.py:1019-1033`)
  // belongs in THIS section by packet §2 ("S2 … owns the
  // `query`-bound `_replays_service` accessor that S3 needs"), but
  // `ReplaysService` does not exist in the TS tree until S3 lands, so
  // S2 cannot reference the class. **S3 must add it here**, memoized in
  // a `#replays` field, constructed as
  // `new ReplaysService(this.client, {query_fn: (...a) => this.query(...a)})`
  // — the bound `query` member, so `discover`/`events_for` can issue
  // Insights queries without a hard dependency on `Workspace`
  // (circular-import-free DI, `replays.py:150-176`). Recorded in
  // `B5-S2-notes.md` §2.

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
    const statsKwargs: Record<string, unknown> = {};
    if (Object.hasOwn(params, "where")) {
      statsKwargs["where"] = params["where"];
    }
    if (Object.hasOwn(params, "action")) {
      statsKwargs["action"] = params["action"];
    }
    if (Object.hasOwn(params, "filter_by_cohort")) {
      statsKwargs["filter_by_cohort"] = params["filter_by_cohort"];
    }
    if (Object.hasOwn(params, "segment_by_cohorts")) {
      const raw = params["segment_by_cohorts"];
      statsKwargs["segment_by_cohorts"] =
        typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
    }
    if (Object.hasOwn(params, "data_group_id")) {
      statsKwargs["group_id"] = params["data_group_id"];
    }
    if (Object.hasOwn(params, "as_of_timestamp")) {
      statsKwargs["as_of_timestamp"] = params["as_of_timestamp"];
    }
    if (Object.hasOwn(params, "include_all_users")) {
      statsKwargs["include_all_users"] = params["include_all_users"];
    }

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

  // === B6 members land below in W1–W7 sections (append-only) ===
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
