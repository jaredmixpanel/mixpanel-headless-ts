/**
 * Option bags of the `Workspace` facade — every `Workspace*Options`
 * interface, the {@link WorkspaceLogger} seam and the option types the
 * member modules declare next to their functions (re-exported here so
 * the facade has one options surface).
 *
 * Constructor/config bags (`WorkspaceOptions`) are camelCase; the bags
 * that mirror a Python method's keyword arguments 1:1 keep snake_case
 * (README "Naming").
 *
 * @see mixpanel_headless.workspace.Workspace
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

/**
 * Options bag of the {@link Workspace} constructor.
 *
 * @see mixpanel_headless.workspace.Workspace.__init__
 */
export interface WorkspaceOptions {
  /**
   * A pre-built, resolved session — the full resolver bypass
   * (`Workspace(session=…)`). When absent, the resolver axes
   * ({@link account} / {@link project} / {@link workspace} /
   * {@link target}) resolve through `resolveSession(...)` over
   * {@link sources}.
   *
   * @defaultValue `undefined` (resolve from the axes)
   */
  readonly session?: Session | undefined;
  /**
   * Named account from config (resolver axis).
   *
   * @defaultValue `null`
   */
  readonly account?: string | null | undefined;
  /**
   * Project id override (resolver axis, digit string).
   *
   * @defaultValue `null`
   */
  readonly project?: string | null | undefined;
  /**
   * Workspace id override (resolver axis, positive integer).
   *
   * @defaultValue `null`
   */
  readonly workspace?: number | null | undefined;
  /**
   * Apply all three axes from `[targets.NAME]`. Mutually exclusive with
   * `account` / `project` / `workspace` (`WS1_TARGET_MUTUALLY_EXCLUSIVE`).
   *
   * @defaultValue `null`
   */
  readonly target?: string | null | undefined;
  /**
   * The resolver sources used when no {@link session} is given. Python
   * builds `ConfigManager()` / `load_bridge()` inline; the core package
   * never touches disk or environment, so `@mixpanel-headless/node`
   * supplies the on-disk defaults and construction from the axes here
   * requires them explicitly.
   *
   * @defaultValue `undefined` (sessionless construction throws
   *   `UNPORTED_AUTH_SEAM`)
   */
  readonly sources?: ResolverSources | undefined;
  /**
   * Injected wire client — the test/replay seam mirroring Python's
   * `_api_client` kwarg.
   *
   * @defaultValue a client built from {@link clientOptions}
   */
  readonly client?: MixpanelClient | undefined;
  /**
   * Extra options for the client the constructor builds when no
   * {@link client} is injected (transport, sleep/RNG/clock seams).
   *
   * @defaultValue `undefined`
   */
  readonly clientOptions?: Omit<MixpanelClientOptions, "session"> | undefined;
  /**
   * `warnings.warn` sink threaded into the discovery service.
   *
   * @defaultValue `undefined` (warnings are dropped)
   */
  readonly warn?: WarningSink | undefined;
  /**
   * Debug/warning/info log sink; the core package never touches
   * `console`. Python's default (`logging.lastResort`) prints WARNING and
   * above to stderr, so hosts that want that visibility inject a logger
   * that writes `warning` somewhere — the node and browser factories are
   * the places to do it. Missing levels are filled with no-ops.
   *
   * @defaultValue {@link NOOP_LOGGER} (every message dropped)
   */
  readonly logger?: WorkspaceLogger | undefined;
  /**
   * Slug minter for {@link Workspace.createReportLink} — the
   * `generate_slug` seam Python tests patch.
   *
   * @defaultValue the CSPRNG-backed `generateSlug()`
   */
  readonly generateSlug?: (() => string) | undefined;
  /**
   * The resolution seams {@link Workspace.use} consumes for the `target`
   * and `account` branches and for `persist: true`.
   * `@mixpanel-headless/node` supplies real ones through
   * `resolverSeamsFromEffects`.
   *
   * @defaultValue seams that throw `UNPORTED_RESOLVER_SEAM`
   *   (`workspace-members/lifecycle.ts`)
   */
  readonly seams?: Partial<ResolverSeams> | undefined;
  /**
   * The `/me` cache store handed to every `MeService` this facade builds
   * (Python `MeCache(account_name=…)`); `@mixpanel-headless/node` injects
   * the on-disk twin.
   *
   * @defaultValue a per-account in-memory store
   */
  readonly meCache?: ((accountName: string) => MeCacheStore) | undefined;
  /**
   * `Path(file_path).read_bytes()` for
   * {@link Workspace.uploadLookupTable}. The core package is
   * runtime-agnostic, so the byte source is injected;
   * `@mixpanel-headless/node` wires `node:fs`.
   *
   * @defaultValue a reader that throws `UNPORTED_FILE_READ_SEAM`
   */
  readonly readFile?: ((path: string) => Promise<Uint8Array>) | undefined;
  /**
   * `time.monotonic()` in seconds, used by the
   * {@link Workspace.uploadLookupTable} poll deadline.
   *
   * @defaultValue `Date.now() / 1000`
   */
  readonly monotonic?: (() => number) | undefined;
}

/**
 * Keyword-only arguments of {@link Workspace.use}.
 *
 * @see mixpanel_headless.workspace.Workspace.use
 */
export interface WorkspaceUseOptions {
  /**
   * Replacement account name.
   *
   * @defaultValue `null`
   */
  readonly account?: string | null | undefined;
  /**
   * Replacement project ID.
   *
   * @defaultValue `null`
   */
  readonly project?: string | null | undefined;
  /**
   * Replacement workspace ID.
   *
   * @defaultValue `null`
   */
  readonly workspace?: number | null | undefined;
  /**
   * Apply this target's three axes atomically.
   *
   * @defaultValue `null`
   */
  readonly target?: string | null | undefined;
  /**
   * Also write the new state to `[active]`.
   *
   * @defaultValue `false`
   */
  readonly persist?: boolean | undefined;
}

/**
 * Keyword-only arguments of {@link Workspace.me}.
 *
 * @see mixpanel_headless.workspace.Workspace.me
 */
export interface WorkspaceMeOptions {
  /**
   * Bypass the cache and call the API.
   *
   * @defaultValue `false`
   */
  readonly force_refresh?: boolean | undefined;
}

/**
 * Keyword-only arguments of {@link Workspace.projects}.
 *
 * @see mixpanel_headless.workspace.Workspace.projects
 */
export interface WorkspaceProjectsOptions {
  /**
   * Bypass the `/me` caches and refetch.
   *
   * @defaultValue `false`
   */
  readonly refresh?: boolean | undefined;
}

/**
 * Keyword-only arguments of {@link Workspace.workspaces}.
 *
 * @see mixpanel_headless.workspace.Workspace.workspaces
 */
export interface WorkspaceWorkspacesOptions {
  /**
   * Project to list workspaces for. Defaults to the current project.
   *
   * @defaultValue `null` (the current project)
   */
  readonly project_id?: string | null | undefined;
  /**
   * Bypass the `/me` caches and refetch.
   *
   * @defaultValue `false`
   */
  readonly refresh?: boolean | undefined;
}

/**
 * Log seam of the facade; the core package never touches `console`.
 * Extends {@link DiscoveryLogger} so an existing `{ debug }` sink keeps
 * working; `warning` backs the parallel query-user path, `info` the
 * lookup-table upload orchestrator.
 */
export interface WorkspaceLogger extends DiscoveryLogger {
  /**
   * Record a warning message.
   *
   * @param message - The formatted text (never vector-compared).
   */
  warning?: (message: string) => void;
  /**
   * Record an informational message.
   *
   * @param message - The formatted text (never vector-compared).
   */
  info?: (message: string) => void;
}

/** A {@link WorkspaceLogger} with every level present — what the facade stores. */
export type ResolvedWorkspaceLogger = Required<WorkspaceLogger>;

/** A log sink that drops the message (the core package has no stderr). */
function dropMessage(): void {
  // Intentionally empty: the default logger discards every level.
}

/**
 * The facade's default logger: every level is a no-op. Python's default
 * (`logging.lastResort`) prints WARNING and above to stderr; a host that
 * wants the same visibility passes its own {@link WorkspaceOptions.logger}.
 */
export const NOOP_LOGGER: ResolvedWorkspaceLogger = Object.freeze({
  debug: dropMessage,
  warning: dropMessage,
  info: dropMessage,
});

/**
 * Fill the optional levels of an injected logger with no-ops so the
 * facade can call `logger.warning(...)` unconditionally.
 *
 * @param logger - The injected logger, or `undefined` for the default.
 * @returns A logger with every level present.
 * @example
 * ```typescript
 * const logger = resolveWorkspaceLogger({ debug: (m) => console.debug(m) });
 * logger.warning("dropped"); // no-op: `warning` was not supplied
 * ```
 */
export function resolveWorkspaceLogger(
  logger: WorkspaceLogger | undefined,
): ResolvedWorkspaceLogger {
  if (logger === undefined) {
    return NOOP_LOGGER;
  }
  return {
    debug: (message: string): void => {
      logger.debug(message);
    },
    warning: (message: string): void => {
      logger.warning?.(message);
    },
    info: (message: string): void => {
      logger.info?.(message);
    },
  };
}

/**
 * Options bag of {@link Workspace.events}.
 *
 * @see mixpanel_headless.workspace.Workspace.events
 */
export interface WorkspaceEventsOptions {
  /**
   * Maximum events to return.
   *
   * @defaultValue `null` (the client applies 5000)
   */
  readonly limit?: number | null | undefined;
  /**
   * `YYYY-MM-DD` lower bound.
   *
   * @defaultValue `null` (the client applies `2000-01-01`)
   */
  readonly from_date?: string | null | undefined;
  /**
   * `YYYY-MM-DD` upper bound.
   *
   * @defaultValue `null` (the client applies today)
   */
  readonly to_date?: string | null | undefined;
}

/**
 * Options bag of {@link Workspace.propertyValues}.
 *
 * @see mixpanel_headless.workspace.Workspace.property_values
 */
export interface WorkspacePropertyValuesOptions {
  /**
   * Optional event to filter by.
   *
   * @defaultValue `null`
   */
  readonly event?: string | null | undefined;
  /**
   * Maximum number of values to return.
   *
   * @defaultValue `100`
   */
  readonly limit?: number | undefined;
}

/**
 * Options bag of {@link Workspace.subproperties}.
 *
 * @see mixpanel_headless.workspace.Workspace.subproperties
 */
export interface WorkspaceSubpropertiesOptions {
  /**
   * Optional event name to scope the sample.
   *
   * @defaultValue `null`
   */
  readonly event?: string | null | undefined;
  /**
   * Number of raw values to sample.
   *
   * @defaultValue `50`
   */
  readonly sample_size?: number | undefined;
}

/**
 * Options bag of {@link Workspace.topEvents}.
 *
 * @see mixpanel_headless.workspace.Workspace.top_events
 */
export interface WorkspaceTopEventsOptions {
  /**
   * Counting method.
   *
   * @defaultValue `"general"`
   */
  readonly type?: "general" | "average" | "unique" | undefined;
  /**
   * Maximum number of events to return.
   *
   * @defaultValue `null`
   */
  readonly limit?: number | null | undefined;
}

/**
 * Options bag of {@link Workspace.lexiconSchemas}.
 *
 * @see mixpanel_headless.workspace.Workspace.lexicon_schemas
 */
export interface WorkspaceLexiconSchemasOptions {
  /**
   * Optional filter by type (`"event"` / `"profile"`).
   *
   * @defaultValue `null` (both types)
   */
  readonly entity_type?: EntityType | null | undefined;
}

/**
 * Options bag of {@link Workspace.schemaGraph}.
 *
 * @see mixpanel_headless.workspace.Workspace.schema_graph
 */
export interface WorkspaceSchemaGraphOptions {
  /**
   * Request the property-level `densityLocal`.
   *
   * @defaultValue `false`
   */
  readonly include_density?: boolean | undefined;
  /**
   * Also gather user properties.
   *
   * @defaultValue `true`
   */
  readonly include_user_properties?: boolean | undefined;
  /**
   * Bypass the cache and re-fetch.
   *
   * @defaultValue `false`
   */
  readonly force_refresh?: boolean | undefined;
}

// --- Session-replay option bags ---

/**
 * Keyword-only arguments of {@link Workspace.listReplays}.
 *
 * @see mixpanel_headless.workspace.Workspace.list_replays
 */
export interface WorkspaceListReplaysOptions {
  /**
   * Mixpanel user identifier. Mutually exclusive with `replay_ids`.
   *
   * @defaultValue `null`
   */
  readonly distinct_id?: string | null | undefined;
  /**
   * Explicit replay IDs to hydrate. Mutually exclusive with above.
   *
   * @defaultValue `null`
   */
  readonly replay_ids?: readonly string[] | null | undefined;
  /**
   * ISO date (`YYYY-MM-DD`). Required with `distinct_id`.
   *
   * @defaultValue `null`
   */
  readonly from_date?: string | null | undefined;
  /**
   * ISO date (`YYYY-MM-DD`). Required with `distinct_id`.
   *
   * @defaultValue `null`
   */
  readonly to_date?: string | null | undefined;
  /**
   * Maximum summaries to return.
   *
   * @defaultValue `100`
   */
  readonly limit?: number | undefined;
}

/**
 * Keyword-only arguments shared by {@link Workspace.eventsForReplay}
 * and {@link Workspace.eventsForReplays}.
 */
export interface WorkspaceEventsForReplayOptions {
  /**
   * Up to 5 additional event properties to include as group keys.
   *
   * @defaultValue `null`
   */
  readonly event_properties?: readonly string[] | null | undefined;
  /**
   * ISO date (`YYYY-MM-DD`) lower bound for the events scan.
   *
   * @defaultValue `null`
   */
  readonly from_date?: string | null | undefined;
  /**
   * ISO date (`YYYY-MM-DD`) upper bound; paired with `from_date`.
   *
   * @defaultValue `null`
   */
  readonly to_date?: string | null | undefined;
}

/**
 * Keyword-only arguments of {@link Workspace.signReplay} /
 * {@link Workspace.signReplays}.
 */
export interface WorkspaceSignReplayOptions {
  /**
   * `"prod"` or `"dev"`.
   *
   * @defaultValue `"prod"`
   */
  readonly env?: "prod" | "dev" | undefined;
}

/**
 * Keyword-only arguments of {@link Workspace.fetchReplay}.
 *
 * @see mixpanel_headless.workspace.Workspace.fetch_replay
 */
export interface WorkspaceFetchReplayOptions {
  /**
   * Optional user id to stamp on the returned `Replay`.
   *
   * @defaultValue `null`
   */
  readonly distinct_id?: string | null | undefined;
  /**
   * `"prod"` or `"dev"`.
   *
   * @defaultValue `"prod"`
   */
  readonly env?: "prod" | "dev" | undefined;
  /**
   * 1, 7, 30, or 90. Auto-discovered when absent.
   *
   * @defaultValue `null` (auto-discovered)
   */
  readonly retention_days?: number | null | undefined;
  /**
   * Hard upper bound on the CDN file walk.
   *
   * @defaultValue `500`
   */
  readonly max_files?: number | undefined;
  /**
   * Follow with an events query and populate `mixpanel_events`.
   *
   * @defaultValue `false`
   */
  readonly include_mixpanel_events?: boolean | undefined;
  /**
   * Up to 5 extra properties for the Mixpanel join query.
   *
   * @defaultValue `null`
   */
  readonly event_properties?: readonly string[] | null | undefined;
  /**
   * Parallel batch size for CDN fetches.
   *
   * @defaultValue `50`
   */
  readonly cdn_concurrency?: number | undefined;
}

/**
 * Keyword-only arguments of {@link Workspace.streamReplay}.
 *
 * @see mixpanel_headless.workspace.Workspace.stream_replay
 */
export interface WorkspaceStreamReplayOptions {
  /**
   * `"prod"` or `"dev"`.
   *
   * @defaultValue `"prod"`
   */
  readonly env?: "prod" | "dev" | undefined;
  /**
   * 1, 7, 30, or 90. Auto-discovered when absent.
   *
   * @defaultValue `null` (auto-discovered)
   */
  readonly retention_days?: number | null | undefined;
  /**
   * Hard upper bound on the CDN file walk.
   *
   * @defaultValue `500`
   */
  readonly max_files?: number | undefined;
  /**
   * Re-sign once on a mid-walk 403.
   *
   * @defaultValue `true`
   */
  readonly re_sign_on_expiry?: boolean | undefined;
  /**
   * Parallel batch size for CDN fetches.
   *
   * @defaultValue `50`
   */
  readonly cdn_concurrency?: number | undefined;
}

/**
 * Keyword-only arguments of {@link Workspace.fetchReplays}.
 *
 * @see mixpanel_headless.workspace.Workspace.fetch_replays
 */
export interface WorkspaceFetchReplaysOptions {
  /**
   * `"prod"` or `"dev"`.
   *
   * @defaultValue `"prod"`
   */
  readonly env?: "prod" | "dev" | undefined;
  /**
   * Per-replay CDN bound.
   *
   * @defaultValue `500`
   */
  readonly max_files?: number | undefined;
  /**
   * Join Mixpanel events (one batched query across all replays).
   *
   * @defaultValue `false`
   */
  readonly include_mixpanel_events?: boolean | undefined;
  /**
   * Up to 5 properties for the join.
   *
   * @defaultValue `null`
   */
  readonly event_properties?: readonly string[] | null | undefined;
  /**
   * Replay-level parallelism.
   *
   * @defaultValue `4`
   */
  readonly concurrency?: number | undefined;
  /**
   * Per-replay CDN parallelism.
   *
   * @defaultValue `50`
   */
  readonly cdn_concurrency?: number | undefined;
  /**
   * `{replay_id: retention_days}` so each fetch skips discovery.
   *
   * @defaultValue `null` (each fetch discovers its retention)
   */
  readonly retention_by_id?:
    ReadonlyMap<string, number> | Readonly<Record<string, number>> | undefined;
  /**
   * `{replay_id: distinct_id}` stamped on each fetched `Replay`.
   *
   * @defaultValue `null`
   */
  readonly distinct_id_by_id?:
    ReadonlyMap<string, string> | Readonly<Record<string, string>> | undefined;
}

/**
 * Keyword-only arguments of {@link Workspace.replaysForUser}.
 *
 * @see mixpanel_headless.workspace.Workspace.replays_for_user
 */
export interface WorkspaceReplaysForUserOptions {
  /** ISO date (`YYYY-MM-DD`). */
  readonly from_date: string;
  /** ISO date (`YYYY-MM-DD`). */
  readonly to_date: string;
  /**
   * Maximum replays to fetch.
   *
   * @defaultValue `20`
   */
  readonly limit?: number | undefined;
  /**
   * Also join the Mixpanel events of each replay.
   *
   * @defaultValue `true`
   */
  readonly include_mixpanel_events?: boolean | undefined;
  /**
   * Up to 5 properties for the Mixpanel join.
   *
   * @defaultValue `null`
   */
  readonly event_properties?: readonly string[] | null | undefined;
}

// --- Query option bags ---

/**
 * Keyword-only arguments of {@link Workspace.segmentation}.
 *
 * @see mixpanel_headless.workspace.Workspace.segmentation
 */
export interface WorkspaceSegmentationOptions extends LiveSegmentationOptions {
  /** Start date (`YYYY-MM-DD`). */
  readonly from_date: string;
  /** End date (`YYYY-MM-DD`). */
  readonly to_date: string;
}

/**
 * Keyword-only arguments of {@link Workspace.funnel}.
 *
 * @see mixpanel_headless.workspace.Workspace.funnel
 */
export interface WorkspaceFunnelOptions extends LiveFunnelOptions {
  /** Start date (`YYYY-MM-DD`). */
  readonly from_date: string;
  /** End date (`YYYY-MM-DD`). */
  readonly to_date: string;
}

/**
 * Keyword-only arguments of {@link Workspace.retention}.
 *
 * @see mixpanel_headless.workspace.Workspace.retention
 */
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

/**
 * Keyword-only arguments of {@link Workspace.eventCounts}.
 *
 * @see mixpanel_headless.workspace.Workspace.event_counts
 */
export interface WorkspaceEventCountsOptions extends LiveEventCountsOptions {
  /** Start date (`YYYY-MM-DD`). */
  readonly from_date: string;
  /** End date (`YYYY-MM-DD`). */
  readonly to_date: string;
}

/**
 * Keyword-only arguments of {@link Workspace.propertyCounts}.
 *
 * @see mixpanel_headless.workspace.Workspace.property_counts
 */
export interface WorkspacePropertyCountsOptions extends LivePropertyCountsOptions {
  /** Start date (`YYYY-MM-DD`). */
  readonly from_date: string;
  /** End date (`YYYY-MM-DD`). */
  readonly to_date: string;
}

/**
 * Keyword-only arguments of {@link Workspace.frequency}.
 *
 * @see mixpanel_headless.workspace.Workspace.frequency
 */
export interface WorkspaceFrequencyOptions extends LiveFrequencyOptions {
  /** Start date (`YYYY-MM-DD`). */
  readonly from_date: string;
  /** End date (`YYYY-MM-DD`). */
  readonly to_date: string;
}

/**
 * Keyword-only arguments of {@link Workspace.segmentationNumeric}.
 *
 * @see mixpanel_headless.workspace.Workspace.segmentation_numeric
 */
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
 * {@link Workspace.buildParams}.
 */
export interface WorkspaceQueryOptions {
  /**
   * Start date (`YYYY-MM-DD`). Overrides `last` when set.
   *
   * @defaultValue `null`
   */
  readonly from_date?: string | null | undefined;
  /**
   * End date (`YYYY-MM-DD`). Requires `from_date`.
   *
   * @defaultValue `null`
   */
  readonly to_date?: string | null | undefined;
  /**
   * Relative time range in days.
   *
   * @defaultValue `30`
   */
  readonly last?: number | undefined;
  /**
   * Time aggregation unit.
   *
   * @defaultValue `"day"`
   */
  readonly unit?: string | undefined;
  /**
   * Aggregation function for plain-string events.
   *
   * @defaultValue `"total"`
   */
  readonly math?: string | undefined;
  /**
   * Property name for property-based math.
   *
   * @defaultValue `null`
   */
  readonly math_property?: unknown;
  /**
   * Per-user pre-aggregation.
   *
   * @defaultValue `null`
   */
  readonly per_user?: string | null | undefined;
  /**
   * Custom percentile value (required when `math="percentile"`).
   *
   * @defaultValue `null`
   */
  readonly percentile_value?: number | null | undefined;
  /**
   * Breakdown specification.
   *
   * @defaultValue `null`
   */
  readonly group_by?: GroupByInput;
  /**
   * Filter conditions.
   *
   * @defaultValue `null`
   */
  readonly where?: WhereInput;
  /**
   * Formula expression referencing events by position (A, B, C…).
   *
   * @defaultValue `null`
   */
  readonly formula?: string | null | undefined;
  /**
   * Display label for the formula result.
   *
   * @defaultValue `null`
   */
  readonly formula_label?: string | null | undefined;
  /**
   * Rolling window size in periods.
   *
   * @defaultValue `null`
   */
  readonly rolling?: number | null | undefined;
  /**
   * Cumulative analysis mode.
   *
   * @defaultValue `false`
   */
  readonly cumulative?: boolean | undefined;
  /**
   * Result shape.
   *
   * @defaultValue `"timeseries"`
   */
  readonly mode?: string | undefined;
  /**
   * Optional period-over-period comparison.
   *
   * @defaultValue `null`
   */
  readonly time_comparison?: TimeComparison | null | undefined;
  /**
   * Optional data group ID.
   *
   * @defaultValue `null`
   */
  readonly data_group_id?: number | null | undefined;
  /**
   * Segments to return, 1 to 50000; `null` keeps the 3000 the Mixpanel
   * UI uses. Raise it for a high-cardinality breakdown, and
   * check `result.meta["is_segmentation_limit_hit"]` to see whether the
   * answer was still truncated. Ignored by {@link Workspace.buildParams}
   * (an execution setting the params do not store).
   *
   * @defaultValue `null` (the 3000 segments the Mixpanel UI uses)
   */
  readonly limit?: number | null | undefined;
  /**
   * Clock seam threaded into the time-section builder.
   *
   * @defaultValue the host's current date
   */
  readonly today?: TodayFn | undefined;
}

/**
 * Keyword-only arguments shared by {@link Workspace.queryFunnel} and
 * {@link Workspace.buildFunnelParams}.
 */
export interface WorkspaceFunnelQueryOptions {
  /**
   * Conversion window size.
   *
   * @defaultValue `14`
   */
  readonly conversion_window?: number | undefined;
  /**
   * Conversion window unit.
   *
   * @defaultValue `"day"`
   */
  readonly conversion_window_unit?: string | undefined;
  /**
   * Funnel step ordering mode.
   *
   * @defaultValue `"loose"`
   */
  readonly order?: string | undefined;
  /**
   * Start date (`YYYY-MM-DD`).
   *
   * @defaultValue `null`
   */
  readonly from_date?: string | null | undefined;
  /**
   * End date (`YYYY-MM-DD`).
   *
   * @defaultValue `null`
   */
  readonly to_date?: string | null | undefined;
  /**
   * Relative time range in days.
   *
   * @defaultValue `30`
   */
  readonly last?: number | undefined;
  /**
   * Time aggregation unit.
   *
   * @defaultValue `"day"`
   */
  readonly unit?: string | undefined;
  /**
   * Aggregation function.
   *
   * @defaultValue `"conversion_rate_unique"`
   */
  readonly math?: string | undefined;
  /**
   * Numeric property for property aggregation.
   *
   * @defaultValue `null`
   */
  readonly math_property?: string | null | undefined;
  /**
   * Breakdown specification.
   *
   * @defaultValue `null`
   */
  readonly group_by?: GroupByInput;
  /**
   * Filter conditions.
   *
   * @defaultValue `null`
   */
  readonly where?: FilterWhereInput;
  /**
   * Events to exclude.
   *
   * @defaultValue `null`
   */
  readonly exclusions?: ReadonlyArray<string | Exclusion> | null | undefined;
  /**
   * Properties to hold constant.
   *
   * @defaultValue `null`
   */
  readonly holding_constant?:
    | string
    | HoldingConstant
    | ReadonlyArray<string | HoldingConstant>
    | null
    | undefined;
  /**
   * Display mode.
   *
   * @defaultValue `"steps"`
   */
  readonly mode?: string | undefined;
  /**
   * Funnel reentry mode.
   *
   * @defaultValue `null`
   */
  readonly reentry_mode?: string | null | undefined;
  /**
   * Optional period-over-period comparison.
   *
   * @defaultValue `null`
   */
  readonly time_comparison?: TimeComparison | null | undefined;
  /**
   * Optional data group ID.
   *
   * @defaultValue `null`
   */
  readonly data_group_id?: number | null | undefined;
  /**
   * Segments to return, 1 to 50000; `null` keeps the 3000 the Mixpanel
   * UI uses. Ignored by {@link Workspace.buildFunnelParams}.
   *
   * @defaultValue `null` (the 3000 segments the Mixpanel UI uses)
   */
  readonly limit?: number | null | undefined;
  /**
   * Clock seam.
   *
   * @defaultValue the host's current date
   */
  readonly today?: TodayFn | undefined;
}

/**
 * Keyword-only arguments shared by {@link Workspace.queryFlow} and
 * {@link Workspace.buildFlowParams}.
 */
export interface WorkspaceFlowQueryOptions {
  /**
   * Default forward step count.
   *
   * @defaultValue `3`
   */
  readonly forward?: number | undefined;
  /**
   * Default reverse step count.
   *
   * @defaultValue `0`
   */
  readonly reverse?: number | undefined;
  /**
   * Start date (`YYYY-MM-DD`).
   *
   * @defaultValue `null`
   */
  readonly from_date?: string | null | undefined;
  /**
   * End date (`YYYY-MM-DD`).
   *
   * @defaultValue `null` (today when `from_date` is set)
   */
  readonly to_date?: string | null | undefined;
  /**
   * Relative time range in days.
   *
   * @defaultValue `30`
   */
  readonly last?: number | undefined;
  /**
   * Conversion window size.
   *
   * @defaultValue `7`
   */
  readonly conversion_window?: number | undefined;
  /**
   * Conversion window unit.
   *
   * @defaultValue `"day"`
   */
  readonly conversion_window_unit?: string | undefined;
  /**
   * Counting method.
   *
   * @defaultValue `"unique"`
   */
  readonly count_type?: string | undefined;
  /**
   * Number of top paths.
   *
   * @defaultValue `3`
   */
  readonly cardinality?: number | undefined;
  /**
   * Merge consecutive repeated events.
   *
   * @defaultValue `false`
   */
  readonly collapse_repeated?: boolean | undefined;
  /**
   * Events to hide from the visualization.
   *
   * @defaultValue `null`
   */
  readonly hidden_events?: readonly string[] | null | undefined;
  /**
   * Display mode.
   *
   * @defaultValue `"sankey"`
   */
  readonly mode?: string | undefined;
  /**
   * Filter conditions.
   *
   * @defaultValue `null`
   */
  readonly where?: FilterWhereInput;
  /**
   * Optional data group ID.
   *
   * @defaultValue `null`
   */
  readonly data_group_id?: number | null | undefined;
  /**
   * Segment (breakdown) specification.
   *
   * @defaultValue `null`
   */
  readonly segments?: GroupByInput;
  /**
   * Event names to exclude from flow paths.
   *
   * @defaultValue `null`
   */
  readonly exclusions?: readonly string[] | null | undefined;
  /**
   * Clock seam for the `to_date` default.
   *
   * @defaultValue the host's current date
   */
  readonly today?: TodayFn | undefined;
}

/**
 * Keyword-only arguments shared by {@link Workspace.queryRetention} and
 * {@link Workspace.buildRetentionParams}.
 */
export interface WorkspaceRetentionQueryOptions {
  /**
   * Retention period unit.
   *
   * @defaultValue `"week"`
   */
  readonly retention_unit?: string | undefined;
  /**
   * Retention alignment mode.
   *
   * @defaultValue `"birth"`
   */
  readonly alignment?: string | undefined;
  /**
   * Custom bucket sizes.
   *
   * @defaultValue `null`
   */
  readonly bucket_sizes?: readonly number[] | null | undefined;
  /**
   * Start date (`YYYY-MM-DD`).
   *
   * @defaultValue `null`
   */
  readonly from_date?: string | null | undefined;
  /**
   * End date (`YYYY-MM-DD`).
   *
   * @defaultValue `null`
   */
  readonly to_date?: string | null | undefined;
  /**
   * Relative time range in days.
   *
   * @defaultValue `30`
   */
  readonly last?: number | undefined;
  /**
   * Time aggregation unit.
   *
   * @defaultValue `"day"`
   */
  readonly unit?: string | undefined;
  /**
   * Aggregation function.
   *
   * @defaultValue `"retention_rate"`
   */
  readonly math?: string | undefined;
  /**
   * Breakdown specification.
   *
   * @defaultValue `null`
   */
  readonly group_by?: GroupByInput;
  /**
   * Filter conditions.
   *
   * @defaultValue `null`
   */
  readonly where?: FilterWhereInput;
  /**
   * Display mode.
   *
   * @defaultValue `"curve"`
   */
  readonly mode?: string | undefined;
  /**
   * Retention unbounded mode.
   *
   * @defaultValue `null`
   */
  readonly unbounded_mode?: string | null | undefined;
  /**
   * Cumulative retention counting.
   *
   * @defaultValue `false`
   */
  readonly retention_cumulative?: boolean | undefined;
  /**
   * Optional period-over-period comparison.
   *
   * @defaultValue `null`
   */
  readonly time_comparison?: TimeComparison | null | undefined;
  /**
   * Optional data group ID.
   *
   * @defaultValue `null`
   */
  readonly data_group_id?: number | null | undefined;
  /**
   * Segments to return, 1 to 50000; `null` keeps the 3000 the Mixpanel
   * UI uses. Ignored by {@link Workspace.buildRetentionParams}.
   *
   * @defaultValue `null` (the 3000 segments the Mixpanel UI uses)
   */
  readonly limit?: number | null | undefined;
  /**
   * Clock seam.
   *
   * @defaultValue the host's current date
   */
  readonly today?: TodayFn | undefined;
}

/**
 * Keyword-only arguments shared by {@link Workspace.queryUser} and
 * {@link Workspace.buildUserParams}.
 *
 * Python's `build_user_params` orders `limit` after `segment_by` while
 * `query_user` puts it after `sort_order`; the names are identical and
 * option bags are order-free, so one interface serves both.
 */
export interface WorkspaceUserQueryOptions {
  /**
   * Profile filter (single, list, raw selector, or `null`).
   *
   * @defaultValue `null`
   */
  readonly where?: Filter | readonly Filter[] | string | null | undefined;
  /**
   * Cohort membership filter.
   *
   * @defaultValue `null`
   */
  readonly cohort?: number | CohortDefinition | null | undefined;
  /**
   * Output properties to include.
   *
   * @defaultValue `null`
   */
  readonly properties?: readonly string[] | null | undefined;
  /**
   * Property name to sort by.
   *
   * @defaultValue `null`
   */
  readonly sort_by?: string | null | undefined;
  /**
   * Sort direction.
   *
   * @defaultValue `"descending"`
   */
  readonly sort_order?: string | undefined;
  /**
   * Maximum profiles to return. Default `1`; `null` fetches all.
   *
   * @defaultValue `1`
   */
  readonly limit?: number | null | undefined;
  /**
   * Full-text search term.
   *
   * @defaultValue `null`
   */
  readonly search?: string | null | undefined;
  /**
   * Single distinct-ID lookup.
   *
   * @defaultValue `null`
   */
  readonly distinct_id?: string | null | undefined;
  /**
   * Batch distinct-ID lookup.
   *
   * @defaultValue `null`
   */
  readonly distinct_ids?: readonly string[] | null | undefined;
  /**
   * Group-profile scope.
   *
   * @defaultValue `null`
   */
  readonly group_id?: string | null | undefined;
  /**
   * Point-in-time query (ISO date text or Unix timestamp).
   *
   * @defaultValue `null`
   */
  readonly as_of?: string | number | null | undefined;
  /**
   * Output mode.
   *
   * @defaultValue `"aggregate"`
   */
  readonly mode?: string | undefined;
  /**
   * Aggregation function.
   *
   * @defaultValue `"count"`
   */
  readonly aggregate?: string | undefined;
  /**
   * Property to aggregate on.
   *
   * @defaultValue `null`
   */
  readonly aggregate_property?: string | null | undefined;
  /**
   * Percentile value (0-100 exclusive).
   *
   * @defaultValue `null`
   */
  readonly percentile?: number | null | undefined;
  /**
   * Cohort IDs for segmented aggregation.
   *
   * @defaultValue `null`
   */
  readonly segment_by?: readonly number[] | null | undefined;
  /**
   * Enable concurrent page fetching.
   *
   * @defaultValue `false`
   */
  readonly parallel?: boolean | undefined;
  /**
   * Maximum concurrent workers.
   *
   * @defaultValue `5`
   */
  readonly workers?: number | undefined;
  /**
   * Include non-members in cohort query results.
   *
   * @defaultValue `false`
   */
  readonly include_all_users?: boolean | undefined;
  /**
   * Clock seam for the U8 `as_of` future check.
   *
   * @defaultValue the host's current date
   */
  readonly today?: TodayFn | undefined;
}

/**
 * Keyword-only arguments of {@link Workspace.runParams},
 * {@link Workspace.runFunnelParams} and
 * {@link Workspace.runRetentionParams}.
 */
export interface WorkspaceRunParamsOptions {
  /**
   * Segments to return, 1 to 50000; `null` keeps the 3000 the Mixpanel
   * UI uses.
   *
   * @defaultValue `null` (the 3000 segments the Mixpanel UI uses)
   */
  readonly limit?: number | null | undefined;
  /**
   * Data view to run under; wins over the pinned session workspace.
   *
   * @defaultValue `null`
   */
  readonly workspace_id?: number | null | undefined;
}

/**
 * Keyword-only arguments of {@link Workspace.runFlowParams}.
 *
 * @see mixpanel_headless.workspace.Workspace.run_flow_params
 */
export interface WorkspaceRunFlowParamsOptions {
  /**
   * Flow chart mode. `null` / `undefined` derives it from the
   * params: `flows_merge_type` (`"tree"`, `"list"` for paths, `"graph"`
   * for sankey) when present, else `chartType` (`"top-paths"` or
   * `"paths"` for paths, `"tree"`, anything else sankey). Params from
   * {@link Workspace.buildFlowParams} always resolve to the mode they
   * were built with. Pass a value to override.
   *
   * @defaultValue `null` (derived from the params)
   */
  readonly mode?: FlowMode | null | undefined;
  /**
   * Data view to run under; wins over the pinned session workspace.
   *
   * @defaultValue `null`
   */
  readonly workspace_id?: number | null | undefined;
}

/**
 * Keyword-only arguments of {@link Workspace.runUserParams} — the
 * execution settings {@link Workspace.buildUserParams} does not store,
 * with the same defaults as {@link Workspace.queryUser}.
 */
export interface WorkspaceRunUserParamsOptions {
  /**
   * Maximum profiles to return in profiles mode. `null` fetches all
   * matching profiles. Ignored in aggregate mode.
   *
   * @defaultValue `1`
   */
  readonly limit?: number | null | undefined;
  /**
   * Fetch profile pages concurrently. Ignored when `limit` is `1` or
   * in aggregate mode.
   *
   * @defaultValue `false`
   */
  readonly parallel?: boolean | undefined;
  /**
   * Maximum concurrent workers for parallel fetching.
   *
   * @defaultValue `5`
   */
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

/**
 * Options bag of {@link Workspace.createReportLink}.
 *
 * @see mixpanel_headless.workspace.Workspace.create_report_link
 */
export interface WorkspaceCreateReportLinkOptions {
  /**
   * `insights`, `funnels`, `retention`, or `flows`; inferred from a typed
   * result. An explicit
   * value that contradicts the inferred one is rejected.
   *
   * @defaultValue `null` (`insights` for a dict; inferred from a typed result)
   */
  readonly report_type?: ReportLinkType | null | undefined;
  /**
   * Optional name stored with the record.
   *
   * @defaultValue `""`
   */
  readonly name?: string | undefined;
  /**
   * Optional description stored with the record.
   *
   * @defaultValue `""`
   */
  readonly description?: string | undefined;
  /**
   * Workspace for the `/view/{wid}` URL segment. Defaults to the pinned
   * session workspace, then `resolveWorkspaceId()`; if nothing resolves
   * the URL is project-only.
   *
   * @defaultValue `null` (resolved as described)
   */
  readonly workspace_id?: number | null | undefined;
  /**
   * Optional saved-report reference to store.
   *
   * @defaultValue `null`
   */
  readonly bookmark_id?: number | null | undefined;
  /**
   * Run the client-side bookmark schema check before the POST; `false`
   * sends the params as given.
   *
   * @defaultValue `true`
   */
  readonly validate?: boolean | undefined;
}

/**
 * Options bag of {@link Workspace.queryReportLink}.
 *
 * @see mixpanel_headless.workspace.Workspace.query_report_link
 */
export interface WorkspaceQueryReportLinkOptions {
  /**
   * Flows chart mode. When `null` it is derived from
   * `params["chartType"]` if that is `sankey`, `paths`, or `tree`, else
   * `sankey`. Ignored for other report types.
   *
   * @defaultValue `null` (derived from `chartType`)
   */
  readonly mode?: "sankey" | "paths" | "tree" | null | undefined;
}

/**
 * Options bag of {@link Workspace.savedReportLink}.
 *
 * @see mixpanel_headless.workspace.Workspace.saved_report_link
 */
export interface WorkspaceSavedReportLinkOptions {
  /**
   * `insights`, `funnels`, `retention`, `flows`, or
   * `launch-analysis`. The singular `funnel` that
   * `SavedReportResult.report_type` reports is accepted and normalized
   * to `funnels`.
   *
   * @defaultValue `"insights"`
   */
  readonly report_type?: BookmarkType | "funnel" | undefined;
  /**
   * Workspace for the `/view/{wid}` segment. Defaults to the pinned
   * session workspace; when none is pinned the segment is omitted.
   * `resolveWorkspaceId()` is never called here.
   *
   * @defaultValue `null` (the pinned session workspace)
   */
  readonly workspace_id?: number | null | undefined;
}
