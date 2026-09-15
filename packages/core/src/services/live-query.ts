/**
 * Live query service: the typed front door to the Query API's
 * segmentation, funnel, retention, counts, activity-feed, saved-report,
 * inline-bookmark, frequency and numeric endpoints. Each method calls
 * the corresponding client wire method, converts the lossless
 * `JsonValue` tree with {@link toNativeJson} to match Python's
 * `json.loads` product, and hands it to the pure transforms in
 * `live-query-transforms.ts`. Nothing is cached — analytics data
 * changes constantly.
 *
 * @see mixpanel_headless._internal.services.live_query.LiveQueryService
 */

import type { MixpanelClient } from "../client/client.js";
import { type JsonValue, toNativeJson } from "../client/json-value.js";
import { ValueError } from "../compat/python-builtins.js";
import { isPythonValue, pythonRepr } from "../compat/python-str.js";
import { normalizeOnExpression } from "../query/expressions.js";
import type { CountType, HourDayUnit, TimeUnit } from "../types/literals.js";
import {
  type ActivityFeedResult,
  EventCountsResult,
  type FlowsResult,
  type FrequencyResult,
  type FunnelResult,
  type NumericAverageResult,
  type NumericBucketResult,
  type NumericSumResult,
  PropertyCountsResult,
  type RetentionResult,
  type SavedReportResult,
  type SegmentationResult,
} from "../types/results/live-query.js";
import type {
  FlowQueryResult,
  FunnelQueryResult,
  QueryResult,
  RetentionQueryResult,
} from "../types/results/query-engine.js";
import type { WarningSink } from "./discovery.js";
import {
  pyMapping,
  type SavedReportBookmarkType,
  transformActivityFeed,
  transformFlowResult,
  transformFlows,
  transformFrequency,
  transformFunnel,
  transformFunnelResult,
  transformNumericAverage,
  transformNumericBucket,
  transformNumericSum,
  transformQueryResult,
  transformRetention,
  transformRetentionResult,
  transformSavedReport,
  transformSegmentation,
} from "./live-query-transforms.js";

/** Counting methods the multi-event/property endpoints accept. */
type CountingType = "general" | "unique" | "average";

/** Day/week/month unit of the multi-event/property endpoints. */
type DayWeekMonth = "day" | "week" | "month";

/** Construction options of {@link LiveQueryService}. */
export interface LiveQueryServiceOptions {
  /**
   * `warnings.warn` sink for the funnel-series transform's
   * unrecognized-format warning (`core` has no stderr, so the sink is
   * injected).
   *
   * @defaultValue A no-op sink — warnings are dropped unless a host
   *   injects one.
   */
  readonly warn?: WarningSink | undefined;
}

/** Options bag of {@link LiveQueryService.segmentation}. */
export interface LiveSegmentationOptions {
  /**
   * Property to segment by (bare names are normalized).
   *
   * @defaultValue `null`
   */
  readonly on?: string | null | undefined;
  /**
   * Time unit for aggregation.
   *
   * @defaultValue `"day"`
   */
  readonly unit?: TimeUnit | undefined;
  /**
   * Filter expression.
   *
   * @defaultValue `null`
   */
  readonly where?: string | null | undefined;
}

/** Options bag of {@link LiveQueryService.funnel}. */
export interface LiveFunnelOptions {
  /**
   * Time unit for grouping.
   *
   * @defaultValue `null`
   */
  readonly unit?: string | null | undefined;
  /**
   * Property to segment by.
   *
   * @defaultValue `null`
   */
  readonly on?: string | null | undefined;
}

/** Options bag of {@link LiveQueryService.retention}. */
export interface LiveRetentionOptions {
  /**
   * Filter for the born event.
   *
   * @defaultValue `null`
   */
  readonly born_where?: string | null | undefined;
  /**
   * Filter for the return event.
   *
   * @defaultValue `null`
   */
  readonly return_where?: string | null | undefined;
  /**
   * Retention interval size.
   *
   * @defaultValue `1`
   */
  readonly interval?: number | undefined;
  /**
   * Number of intervals to track.
   *
   * @defaultValue `10`
   */
  readonly interval_count?: number | undefined;
  /**
   * Interval unit.
   *
   * @defaultValue `"day"`
   */
  readonly unit?: TimeUnit | undefined;
}

/** Options bag of {@link LiveQueryService.eventCounts}. */
export interface LiveEventCountsOptions {
  /**
   * Counting method.
   *
   * @defaultValue `"general"`
   */
  readonly type?: CountingType | undefined;
  /**
   * Time unit.
   *
   * @defaultValue `"day"`
   */
  readonly unit?: DayWeekMonth | undefined;
}

/** Options bag of {@link LiveQueryService.propertyCounts}. */
export interface LivePropertyCountsOptions {
  /**
   * Counting method.
   *
   * @defaultValue `"general"`
   */
  readonly type?: CountingType | undefined;
  /**
   * Time unit.
   *
   * @defaultValue `"day"`
   */
  readonly unit?: DayWeekMonth | undefined;
  /**
   * Specific property values to include.
   *
   * @defaultValue `null`
   */
  readonly values?: readonly string[] | null | undefined;
  /**
   * Maximum property values to return (server default 255).
   *
   * @defaultValue `null`
   */
  readonly limit?: number | null | undefined;
}

/** Options bag of {@link LiveQueryService.activityFeed}. */
export interface LiveActivityFeedOptions {
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
   * Max events to return (server ceiling 15000).
   *
   * @defaultValue `null`
   */
  readonly limit?: number | null | undefined;
  /**
   * Event names to include (exclusive with `exclude_events`).
   *
   * @defaultValue `null`
   */
  readonly include_events?: readonly string[] | null | undefined;
  /**
   * Event names to exclude (exclusive with `include_events`).
   *
   * @defaultValue `null`
   */
  readonly exclude_events?: readonly string[] | null | undefined;
  /**
   * Pagination cursor from a prior result.
   *
   * @defaultValue `null`
   */
  readonly sentinel_event?: Record<string, unknown> | null | undefined;
  /**
   * Days (at most 30) bounding each page's scan window.
   *
   * @defaultValue `null`
   */
  readonly paging_window?: number | null | undefined;
  /**
   * Full-text search string.
   *
   * @defaultValue `null`
   */
  readonly search?: string | null | undefined;
  /**
   * Property descriptors restricting the search.
   *
   * @defaultValue `null`
   */
  readonly search_properties?:
    ReadonlyArray<Record<string, unknown>> | null | undefined;
  /**
   * Label matching custom events in raw results.
   *
   * @defaultValue `false`
   */
  readonly use_custom_events?: boolean | undefined;
}

/** Options bag of {@link LiveQueryService.querySavedReport}. */
export interface LiveQuerySavedReportOptions {
  /**
   * Bookmark type routing the query.
   *
   * @defaultValue `"insights"`
   */
  readonly bookmark_type?: SavedReportBookmarkType | undefined;
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
}

/** Options bag of {@link LiveQueryService.frequency}. */
export interface LiveFrequencyOptions {
  /**
   * Overall time period.
   *
   * @defaultValue `"day"`
   */
  readonly unit?: TimeUnit | undefined;
  /**
   * Measurement granularity.
   *
   * @defaultValue `"hour"`
   */
  readonly addiction_unit?: HourDayUnit | undefined;
  /**
   * Event name to filter (`null` = all events).
   *
   * @defaultValue `null`
   */
  readonly event?: string | null | undefined;
  /**
   * Filter expression.
   *
   * @defaultValue `null`
   */
  readonly where?: string | null | undefined;
}

/** Options bag of {@link LiveQueryService.segmentationNumeric}. */
export interface LiveSegmentationNumericOptions {
  /**
   * Time aggregation unit.
   *
   * @defaultValue `"day"`
   */
  readonly unit?: HourDayUnit | undefined;
  /**
   * Filter expression.
   *
   * @defaultValue `null`
   */
  readonly where?: string | null | undefined;
  /**
   * Counting method.
   *
   * @defaultValue `"general"`
   */
  readonly type?: CountType | undefined;
}

/** Options bag of the sum/average numeric queries. */
export interface LiveNumericOptions {
  /**
   * Time aggregation unit.
   *
   * @defaultValue `"day"`
   */
  readonly unit?: HourDayUnit | undefined;
  /**
   * Filter expression.
   *
   * @defaultValue `null`
   */
  readonly where?: string | null | undefined;
}

/**
 * Convert a client response to the native tree Python's `json.loads`
 * produces, then hand it to the transforms as a mapping.
 *
 * @param raw - The lossless response tree.
 * @returns The native-valued record.
 */
function nativeRecord(raw: JsonValue): Readonly<Record<string, unknown>> {
  return toNativeJson(raw) as Readonly<Record<string, unknown>>;
}

/**
 * `raw.get("data", {}).get("values", {})` — the shape `event_counts`
 * and `property_counts` inline.
 *
 * Absent keys yield `{}`; an explicitly non-mapping `data` member makes
 * the nested `.get` raise CPython's `AttributeError` via
 * {@link pyMapping}. A plain `Object.hasOwn` read would silently return
 * `{}` for string/number receivers and throw the wrong class for
 * `null`.
 *
 * @param raw - The native response record.
 * @returns The `data.values` mapping.
 * @throws {@link AttributeError} - When the `data` member is not a dict.
 */
function dataValues(
  raw: Readonly<Record<string, unknown>>,
): Readonly<Record<string, Readonly<Record<string, number>>>> {
  const data = pyMapping(Object.hasOwn(raw, "data") ? raw["data"] : {}, "get");
  return (Object.hasOwn(data, "values") ? data["values"] : {}) as Readonly<
    Record<string, Readonly<Record<string, number>>>
  >;
}

/**
 * Data-view scope of the four inline query methods (Python kw-only
 * `workspace_id` / `inject_workspace_id`): forwarded to
 * the client, where an explicit `workspace_id` wins over the pinned
 * session workspace and `inject_workspace_id: false` runs project-wide.
 */
export interface InlineQueryScope {
  /**
   * Optional data view to run under.
   *
   * @defaultValue `null`
   */
  readonly workspace_id?: number | null | undefined;
  /**
   * Let the pinned session workspace apply when `workspace_id` is
   * `null`; `false` runs the query project-wide instead.
   *
   * @defaultValue `true`
   */
  readonly inject_workspace_id?: boolean | undefined;
}

/**
 * Materialize the Python defaults (`workspace_id=None`,
 * `inject_workspace_id=True`) so the client always receives both
 * keywords, exactly as the Python service forwards them.
 *
 * @param options - The caller's scope bag.
 * @returns The fully-populated scope.
 */
function inlineScope(options: InlineQueryScope): {
  readonly workspace_id: number | null;
  readonly inject_workspace_id: boolean;
} {
  return {
    workspace_id: options.workspace_id ?? null,
    inject_workspace_id: options.inject_workspace_id ?? true,
  };
}

/**
 * Segments returned per query when the caller does not ask for more.
 *
 * Matches the Mixpanel UI, which truncates a report at 3000 segments.
 *
 * @see mixpanel_headless._internal.services.live_query.DEFAULT_SEGMENTATION_LIMIT
 */
export const DEFAULT_SEGMENTATION_LIMIT = 3000;

/**
 * Largest `queryLimits.limit` the query API accepts.
 *
 * The cap is enforced server-side. A larger value is rejected with
 * `Query limit exceeds max limit of 50000 (<n> was given)`.
 *
 * @see mixpanel_headless._internal.services.live_query.MAX_SEGMENTATION_LIMIT
 */
export const MAX_SEGMENTATION_LIMIT = 50_000;

/**
 * Render a rejected `limit` the way Python's `{limit!r}` does, falling
 * back to `String()` for values outside the repr-able domain.
 *
 * @param value - The rejected limit.
 * @returns The repr text for the error message.
 */
function reprLimit(value: unknown): string {
  if (isPythonValue(value)) {
    return pythonRepr(value);
  }
  return `<${typeof value}>`;
}

/**
 * Build the `queryLimits` body fragment for a query request.
 *
 * Python rejects `bool` explicitly because `bool` subclasses `int`; in
 * TS the `typeof` check excludes booleans (and strings) on its own. A
 * `bigint` inside the band is accepted — it is a Python int — and
 * narrowed to a `number` so the body serializes as a JSON number, never
 * as a string or `true`.
 *
 * @param limit - Requested segment cap, or `null` / `undefined` for
 *   {@link DEFAULT_SEGMENTATION_LIMIT}.
 * @returns The `queryLimits` dict to place in the request body.
 * @throws {@link ValueError} - `limit` is not an integer, or is outside 1 to
 *   {@link MAX_SEGMENTATION_LIMIT}. Raised before any HTTP call, so a bad
 *   limit never costs a request against the project's rate budget.
 * @example
 * ```typescript
 * queryLimits(null); // { limit: 3000 }
 * queryLimits(50_000); // { limit: 50000 }
 * ```
 * @see mixpanel_headless._internal.services.live_query._query_limits
 */
export function queryLimits(limit: number | bigint | null | undefined): {
  readonly limit: number;
} {
  if (limit === null || limit === undefined) {
    return { limit: DEFAULT_SEGMENTATION_LIMIT };
  }
  const value: unknown = limit;
  const inBand =
    (typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= MAX_SEGMENTATION_LIMIT) ||
    (typeof value === "bigint" &&
      value >= 1n &&
      value <= BigInt(MAX_SEGMENTATION_LIMIT));
  if (!inBand) {
    throw new ValueError(
      `limit must be an integer between 1 and ${MAX_SEGMENTATION_LIMIT}, ` +
        `got ${reprLimit(value)}`,
    );
  }
  return { limit: Number(value) };
}

/**
 * {@link InlineQueryScope} plus the segment cap, for the three insights
 * query paths that carry a `queryLimits` block (Python kw-only `limit`
 * on `query` / `query_funnel` / `query_retention`).
 */
export interface InlineQueryScopeWithLimit extends InlineQueryScope {
  /**
   * Segments to return, 1 to {@link MAX_SEGMENTATION_LIMIT}.
   *
   * @defaultValue `null`, which keeps {@link DEFAULT_SEGMENTATION_LIMIT}
   */
  readonly limit?: number | bigint | null | undefined;
}

/**
 * Run live queries against the Mixpanel Query API and return typed
 * results.
 *
 * @remarks
 * Nothing is cached: analytics data changes constantly and every call
 * returns fresh data. Each method forwards to the matching client wire
 * method and hands the native response to a pure transform.
 * @example
 * ```typescript
 * const live = new LiveQueryService(client);
 * const result = await live.segmentation(
 *   "Sign Up",
 *   "2024-01-01",
 *   "2024-01-31",
 *   { unit: "week" },
 * );
 * result.total; // events in the window
 * ```
 * @see mixpanel_headless._internal.services.live_query.LiveQueryService
 */
export class LiveQueryService {
  /**
   * The bound wire client (`self._api_client`).
   *
   * @internal
   */
  readonly apiClient: MixpanelClient;

  /** The `warnings.warn` sink handed to the funnel-series transform. */
  readonly #warn: WarningSink;

  /**
   * Initialize the live query service.
   *
   * @param apiClient - Authenticated Mixpanel client.
   * @param options - Injected warning seam.
   */
  constructor(
    apiClient: MixpanelClient,
    options: LiveQueryServiceOptions = {},
  ) {
    this.apiClient = apiClient;
    this.#warn =
      options.warn ??
      ((): void => {
        // No sink injected: core has no stderr, so warnings are dropped
        // here; the node/browser entry points inject their own sink.
      });
  }

  /**
   * Run a segmentation query.
   *
   * Bare property names in `on` are normalized to filter-expression
   * syntax before the wire call; the result keeps the caller's
   * un-normalized `on` in `segment_property`, as Python does.
   *
   * @param event - Event name to segment.
   * @param fromDate - Start date (`YYYY-MM-DD`).
   * @param toDate - End date (`YYYY-MM-DD`).
   * @param options - Optional `on`, `unit` and `where`; see
   *   {@link LiveSegmentationOptions}.
   * @returns The typed result with the calculated total.
   * @throws {@link AuthenticationError} - Invalid credentials.
   * @throws {@link QueryError} - Invalid query parameters.
   * @throws {@link RateLimitError} - Rate limit exceeded.
   * @see mixpanel_headless._internal.services.live_query.LiveQueryService.segmentation
   */
  async segmentation(
    event: string,
    fromDate: string,
    toDate: string,
    options: LiveSegmentationOptions = {},
  ): Promise<SegmentationResult> {
    const on = options.on ?? null;
    const unit = options.unit ?? "day";
    const where = options.where ?? null;
    // Normalize bare property names to filter expression syntax
    // (Python: `normalize_on_expression(on) if on else None` — an empty
    // string is falsy and stays `None`).
    const normalizedOn = on ? normalizeOnExpression(on) : null;

    const raw = await this.apiClient.segmentation(event, fromDate, toDate, {
      on: normalizedOn,
      unit,
      where,
    });
    return transformSegmentation(
      nativeRecord(raw),
      event,
      fromDate,
      toDate,
      unit,
      on,
    );
  }

  /**
   * Run a funnel analysis query.
   *
   * @param funnelId - Funnel identifier.
   * @param fromDate - Start date (`YYYY-MM-DD`).
   * @param toDate - End date (`YYYY-MM-DD`).
   * @param options - Optional `unit` and `on`; see {@link LiveFunnelOptions}.
   * @returns The typed result with aggregated steps and rates.
   * @throws {@link AuthenticationError} - Invalid credentials.
   * @throws {@link QueryError} - Invalid funnel ID or parameters.
   * @throws {@link RateLimitError} - Rate limit exceeded.
   * @see mixpanel_headless._internal.services.live_query.LiveQueryService.funnel
   */
  async funnel(
    funnelId: number,
    fromDate: string,
    toDate: string,
    options: LiveFunnelOptions = {},
  ): Promise<FunnelResult> {
    const raw = await this.apiClient.funnel(funnelId, fromDate, toDate, {
      unit: options.unit ?? null,
      on: options.on ?? null,
    });
    return transformFunnel(nativeRecord(raw), funnelId, fromDate, toDate);
  }

  /**
   * Run a retention analysis query.
   *
   * Python renames on the wire: the service's `return_event` is the
   * client's `event`, and `return_where` is the client's `where`.
   *
   * @param bornEvent - Event that defines cohort membership.
   * @param returnEvent - Event that defines return.
   * @param fromDate - Start date (`YYYY-MM-DD`).
   * @param toDate - End date (`YYYY-MM-DD`).
   * @param options - Optional `born_where`, `return_where`, `interval`,
   *   `interval_count` and `unit`; see {@link LiveRetentionOptions}.
   * @returns The typed result with cohorts sorted by date.
   * @throws {@link AuthenticationError} - Invalid credentials.
   * @throws {@link QueryError} - Invalid parameters.
   * @throws {@link RateLimitError} - Rate limit exceeded.
   * @see mixpanel_headless._internal.services.live_query.LiveQueryService.retention
   */
  async retention(
    bornEvent: string,
    returnEvent: string,
    fromDate: string,
    toDate: string,
    options: LiveRetentionOptions = {},
  ): Promise<RetentionResult> {
    const unit = options.unit ?? "day";
    const raw = await this.apiClient.retention(
      bornEvent,
      returnEvent,
      fromDate,
      toDate,
      {
        born_where: options.born_where ?? null,
        where: options.return_where ?? null,
        interval: options.interval ?? 1,
        interval_count: options.interval_count ?? 10,
        unit,
      },
    );
    return transformRetention(
      nativeRecord(raw),
      bornEvent,
      returnEvent,
      fromDate,
      toDate,
      unit,
    );
  }

  /**
   * Query aggregate counts for multiple events.
   *
   * @param events - Event names to query.
   * @param fromDate - Start date (`YYYY-MM-DD`).
   * @param toDate - End date (`YYYY-MM-DD`).
   * @param options - Optional `type` and `unit`; see
   *   {@link LiveEventCountsOptions}.
   * @returns The typed result with per-event time series.
   * @throws {@link AuthenticationError} - Invalid credentials.
   * @throws {@link QueryError} - Invalid parameters.
   * @throws {@link RateLimitError} - Rate limit exceeded.
   * @see mixpanel_headless._internal.services.live_query.LiveQueryService.event_counts
   */
  async eventCounts(
    events: readonly string[],
    fromDate: string,
    toDate: string,
    options: LiveEventCountsOptions = {},
  ): Promise<EventCountsResult> {
    const type = options.type ?? "general";
    const unit = options.unit ?? "day";
    const raw = await this.apiClient.eventCounts(events, fromDate, toDate, {
      type,
      unit,
    });
    return new EventCountsResult({
      events: [...events],
      from_date: fromDate,
      to_date: toDate,
      unit,
      type,
      series: dataValues(nativeRecord(raw)),
    });
  }

  /**
   * Query aggregate counts by property value.
   *
   * @param event - Event name to query.
   * @param propertyName - Property to segment by.
   * @param fromDate - Start date (`YYYY-MM-DD`).
   * @param toDate - End date (`YYYY-MM-DD`).
   * @param options - Optional `type`, `unit`, `values` and `limit`; see
   *   {@link LivePropertyCountsOptions}.
   * @returns The typed result with per-value time series.
   * @throws {@link AuthenticationError} - Invalid credentials.
   * @throws {@link QueryError} - Invalid parameters.
   * @throws {@link RateLimitError} - Rate limit exceeded.
   * @see mixpanel_headless._internal.services.live_query.LiveQueryService.property_counts
   */
  async propertyCounts(
    event: string,
    propertyName: string,
    fromDate: string,
    toDate: string,
    options: LivePropertyCountsOptions = {},
  ): Promise<PropertyCountsResult> {
    const type = options.type ?? "general";
    const unit = options.unit ?? "day";
    const raw = await this.apiClient.propertyCounts(
      event,
      propertyName,
      fromDate,
      toDate,
      {
        type,
        unit,
        values: options.values ?? null,
        limit: options.limit ?? null,
      },
    );
    return new PropertyCountsResult({
      event,
      property_name: propertyName,
      from_date: fromDate,
      to_date: toDate,
      unit,
      type,
      series: dataValues(nativeRecord(raw)),
    });
  }

  // --- Activity feed, saved reports, inline bookmarks, numeric queries ---

  /**
   * Query the activity feed for specific users.
   *
   * @param distinctIds - User identifiers to query.
   * @param options - Date window, `limit`, include / exclude lists, search
   *   and pagination cursor; see {@link LiveActivityFeedOptions}.
   * @returns The typed result with user events and the pagination
   *   cursor.
   * @throws {@link AuthenticationError} - Invalid credentials.
   * @throws {@link QueryError} - Invalid parameters (e.g. include AND exclude).
   * @throws {@link RateLimitError} - Rate limit exceeded.
   * @throws {@link ValueError} - An event without a `time` property.
   * @see mixpanel_headless._internal.services.live_query.LiveQueryService.activity_feed
   */
  async activityFeed(
    distinctIds: readonly string[],
    options: LiveActivityFeedOptions = {},
  ): Promise<ActivityFeedResult> {
    const fromDate = options.from_date ?? null;
    const toDate = options.to_date ?? null;
    const raw = await this.apiClient.activityFeed(distinctIds, {
      from_date: fromDate,
      to_date: toDate,
      limit: options.limit ?? null,
      include_events: options.include_events ?? null,
      exclude_events: options.exclude_events ?? null,
      sentinel_event: options.sentinel_event ?? null,
      paging_window: options.paging_window ?? null,
      search: options.search ?? null,
      search_properties: options.search_properties ?? null,
      use_custom_events: options.use_custom_events ?? false,
    });
    return transformActivityFeed(
      nativeRecord(raw),
      distinctIds,
      fromDate,
      toDate,
    );
  }

  /**
   * Query a saved report by bookmark type.
   *
   * @param bookmarkId - Saved report identifier.
   * @param options - Optional `bookmark_type`, `from_date` and `to_date`;
   *   see {@link LiveQuerySavedReportOptions}.
   * @returns The typed result with the detected report type.
   * @throws {@link AuthenticationError} - Invalid credentials.
   * @throws {@link QueryError} - Invalid bookmark_id or report not found.
   * @throws {@link RateLimitError} - Rate limit exceeded.
   * @see mixpanel_headless._internal.services.live_query.LiveQueryService.query_saved_report
   */
  async querySavedReport(
    bookmarkId: number,
    options: LiveQuerySavedReportOptions = {},
  ): Promise<SavedReportResult> {
    const bookmarkType = options.bookmark_type ?? "insights";
    const raw = await this.apiClient.querySavedReport(bookmarkId, {
      bookmark_type: bookmarkType,
      from_date: options.from_date ?? null,
      to_date: options.to_date ?? null,
    });
    return transformSavedReport(nativeRecord(raw), bookmarkId, bookmarkType);
  }

  /**
   * Execute an inline insights query with pre-built bookmark params.
   *
   * @param bookmarkParams - Pre-built bookmark params dict.
   * @param projectId - Mixpanel project ID.
   * @param options - `limit` (segments to return, 1 to 50000; default
   *   3000) plus the data-view scope.
   * @returns The typed result with series data and metadata.
   * @throws {@link ValueError} - `limit` is not an integer from 1 to 50000.
   * @throws {@link AuthenticationError} - Invalid credentials.
   * @throws {@link QueryError} - Invalid bookmark params or an error-as-200.
   * @throws {@link RateLimitError} - Rate limit exceeded.
   * @see mixpanel_headless._internal.services.live_query.LiveQueryService.query
   */
  async query(
    bookmarkParams: Readonly<Record<string, unknown>>,
    projectId: number,
    options: InlineQueryScopeWithLimit = {},
  ): Promise<QueryResult> {
    const body: Record<string, unknown> = {
      bookmark: bookmarkParams,
      project_id: projectId,
      queryLimits: queryLimits(options.limit),
    };
    const raw = await this.apiClient.insightsQuery(body, inlineScope(options));
    return transformQueryResult(nativeRecord(raw), bookmarkParams);
  }

  /**
   * Execute an inline funnel query with pre-built bookmark params.
   *
   * @param bookmarkParams - Pre-built funnel bookmark params dict.
   * @param projectId - Mixpanel project ID.
   * @param options - `limit` (segments to return, 1 to 50000; default
   *   3000) plus the data-view scope.
   * @returns The typed result with step data and metadata.
   * @throws {@link ValueError} - `limit` is not an integer from 1 to 50000.
   * @throws {@link AuthenticationError} - Invalid credentials.
   * @throws {@link QueryError} - Invalid bookmark params or an error-as-200.
   * @throws {@link RateLimitError} - Rate limit exceeded.
   * @see mixpanel_headless._internal.services.live_query.LiveQueryService.query_funnel
   */
  async queryFunnel(
    bookmarkParams: Readonly<Record<string, unknown>>,
    projectId: number,
    options: InlineQueryScopeWithLimit = {},
  ): Promise<FunnelQueryResult> {
    const body: Record<string, unknown> = {
      bookmark: bookmarkParams,
      project_id: projectId,
      queryLimits: queryLimits(options.limit),
    };
    const raw = await this.apiClient.insightsQuery(body, inlineScope(options));
    return transformFunnelResult(nativeRecord(raw), bookmarkParams, this.#warn);
  }

  /**
   * Execute an inline retention query with pre-built bookmark params.
   *
   * @param bookmarkParams - Pre-built retention bookmark params dict.
   * @param projectId - Mixpanel project ID.
   * @param options - `limit` (segments to return, 1 to 50000; default
   *   3000) plus the data-view scope.
   * @returns The typed result with cohort data and metadata.
   * @throws {@link ValueError} - `limit` is not an integer from 1 to 50000.
   * @throws {@link AuthenticationError} - Invalid credentials.
   * @throws {@link QueryError} - Invalid bookmark params or an error-as-200.
   * @throws {@link RateLimitError} - Rate limit exceeded.
   * @see mixpanel_headless._internal.services.live_query.LiveQueryService.query_retention
   */
  async queryRetention(
    bookmarkParams: Readonly<Record<string, unknown>>,
    projectId: number,
    options: InlineQueryScopeWithLimit = {},
  ): Promise<RetentionQueryResult> {
    const body: Record<string, unknown> = {
      bookmark: bookmarkParams,
      project_id: projectId,
      queryLimits: queryLimits(options.limit),
    };
    const raw = await this.apiClient.insightsQuery(body, inlineScope(options));
    return transformRetentionResult(nativeRecord(raw), bookmarkParams);
  }

  /**
   * Execute an inline flow query with pre-built bookmark params.
   *
   * The `mode` maps to the `/arb_funnels` `query_type` exactly as
   * Python does: `"paths"` → `flows_top_paths`, `"tree"` → `flows`,
   * anything else → `flows_sankey`.
   *
   * @param bookmarkParams - Pre-built flow bookmark params dict.
   * @param projectId - Mixpanel project ID.
   * @param mode - Flow visualization mode. Default `"sankey"`.
   * @param options - The data-view scope.
   * @returns The typed result with steps, flows and breakdowns.
   * @throws {@link AuthenticationError} - Invalid credentials.
   * @throws {@link QueryError} - Invalid bookmark params or an error-as-200.
   * @throws {@link RateLimitError} - Rate limit exceeded.
   * @see mixpanel_headless._internal.services.live_query.LiveQueryService.query_flow
   */
  async queryFlow(
    bookmarkParams: Readonly<Record<string, unknown>>,
    projectId: number,
    mode: string = "sankey",
    options: InlineQueryScope = {},
  ): Promise<FlowQueryResult> {
    let queryType: string;
    if (mode === "paths") {
      queryType = "flows_top_paths";
    } else if (mode === "tree") {
      queryType = "flows";
    } else {
      queryType = "flows_sankey";
    }
    const body: Record<string, unknown> = {
      bookmark: bookmarkParams,
      project_id: projectId,
      query_type: queryType,
    };
    const raw = await this.apiClient.arbFunnelsQuery(
      body,
      inlineScope(options),
    );
    return transformFlowResult(nativeRecord(raw), bookmarkParams, mode);
  }

  /**
   * Query a saved Flows report.
   *
   * @param bookmarkId - Saved flows report identifier.
   * @returns The typed result with steps, breakdowns and the rate.
   * @throws {@link AuthenticationError} - Invalid credentials.
   * @throws {@link QueryError} - Invalid bookmark_id or report not found.
   * @throws {@link RateLimitError} - Rate limit exceeded.
   * @see mixpanel_headless._internal.services.live_query.LiveQueryService.query_saved_flows
   */
  async querySavedFlows(bookmarkId: number): Promise<FlowsResult> {
    const raw = await this.apiClient.querySavedFlows(bookmarkId);
    return transformFlows(nativeRecord(raw), bookmarkId);
  }

  /**
   * Query the event frequency distribution.
   *
   * @param fromDate - Start date (`YYYY-MM-DD`).
   * @param toDate - End date (`YYYY-MM-DD`).
   * @param options - Optional `unit`, `addiction_unit`, `event` and
   *   `where`; see {@link LiveFrequencyOptions}.
   * @returns The typed result with frequency arrays.
   * @throws {@link AuthenticationError} - Invalid credentials.
   * @throws {@link QueryError} - Invalid parameters.
   * @throws {@link RateLimitError} - Rate limit exceeded.
   * @see mixpanel_headless._internal.services.live_query.LiveQueryService.frequency
   */
  async frequency(
    fromDate: string,
    toDate: string,
    options: LiveFrequencyOptions = {},
  ): Promise<FrequencyResult> {
    const unit = options.unit ?? "day";
    const addictionUnit = options.addiction_unit ?? "hour";
    const event = options.event ?? null;
    const raw = await this.apiClient.frequency(
      fromDate,
      toDate,
      unit,
      addictionUnit,
      { event, where: options.where ?? null },
    );
    return transformFrequency(
      nativeRecord(raw),
      event,
      fromDate,
      toDate,
      unit,
      addictionUnit,
    );
  }

  /**
   * Query events bucketed by numeric property ranges.
   *
   * @param event - Event name to analyze.
   * @param fromDate - Start date (`YYYY-MM-DD`).
   * @param toDate - End date (`YYYY-MM-DD`).
   * @param on - Numeric property expression to bucket.
   * @param options - Optional `unit`, `where` and `type`; see
   *   {@link LiveSegmentationNumericOptions}.
   * @returns The typed result with the bucketed time series.
   * @throws {@link AuthenticationError} - Invalid credentials.
   * @throws {@link QueryError} - Invalid parameters or non-numeric property.
   * @throws {@link RateLimitError} - Rate limit exceeded.
   * @see mixpanel_headless._internal.services.live_query.LiveQueryService.segmentation_numeric
   */
  async segmentationNumeric(
    event: string,
    fromDate: string,
    toDate: string,
    on: string,
    options: LiveSegmentationNumericOptions = {},
  ): Promise<NumericBucketResult> {
    const unit = options.unit ?? "day";
    // Normalize bare property names to filter expression syntax
    // (unconditional here — Python has no `if on` guard).
    const normalizedOn = normalizeOnExpression(on);

    const raw = await this.apiClient.segmentationNumeric(
      event,
      fromDate,
      toDate,
      normalizedOn,
      { unit, where: options.where ?? null, type: options.type ?? "general" },
    );
    return transformNumericBucket(
      nativeRecord(raw),
      event,
      fromDate,
      toDate,
      on,
      unit,
    );
  }

  /**
   * Query the sum of a numeric property.
   *
   * @param event - Event name to analyze.
   * @param fromDate - Start date (`YYYY-MM-DD`).
   * @param toDate - End date (`YYYY-MM-DD`).
   * @param on - Numeric property expression to sum.
   * @param options - Optional `unit` and `where`; see
   *   {@link LiveNumericOptions}.
   * @returns The typed result with the sum values.
   * @throws {@link AuthenticationError} - Invalid credentials.
   * @throws {@link QueryError} - Invalid parameters or non-numeric property.
   * @throws {@link RateLimitError} - Rate limit exceeded.
   * @see mixpanel_headless._internal.services.live_query.LiveQueryService.segmentation_sum
   */
  async segmentationSum(
    event: string,
    fromDate: string,
    toDate: string,
    on: string,
    options: LiveNumericOptions = {},
  ): Promise<NumericSumResult> {
    const unit = options.unit ?? "day";
    const normalizedOn = normalizeOnExpression(on);

    const raw = await this.apiClient.segmentationSum(
      event,
      fromDate,
      toDate,
      normalizedOn,
      { unit, where: options.where ?? null },
    );
    return transformNumericSum(
      nativeRecord(raw),
      event,
      fromDate,
      toDate,
      on,
      unit,
    );
  }

  /**
   * Query the average of a numeric property.
   *
   * @param event - Event name to analyze.
   * @param fromDate - Start date (`YYYY-MM-DD`).
   * @param toDate - End date (`YYYY-MM-DD`).
   * @param on - Numeric property expression to average.
   * @param options - Optional `unit` and `where`; see
   *   {@link LiveNumericOptions}.
   * @returns The typed result with the average values.
   * @throws {@link AuthenticationError} - Invalid credentials.
   * @throws {@link QueryError} - Invalid parameters or non-numeric property.
   * @throws {@link RateLimitError} - Rate limit exceeded.
   * @see mixpanel_headless._internal.services.live_query.LiveQueryService.segmentation_average
   */
  async segmentationAverage(
    event: string,
    fromDate: string,
    toDate: string,
    on: string,
    options: LiveNumericOptions = {},
  ): Promise<NumericAverageResult> {
    const unit = options.unit ?? "day";
    const normalizedOn = normalizeOnExpression(on);

    const raw = await this.apiClient.segmentationAverage(
      event,
      fromDate,
      toDate,
      normalizedOn,
      { unit, where: options.where ?? null },
    );
    return transformNumericAverage(
      nativeRecord(raw),
      event,
      fromDate,
      toDate,
      on,
      unit,
    );
  }
}

export { type FlowMode } from "./live-query-transforms.js";
