/**
 * Live query service — TS port of the `LiveQueryService` class of
 * `mixpanel_headless/_internal/services/live_query.py` (`:677-1565`)
 * for Phase-3 batch B5, shard S2
 * (`context/phase3/design/b5-packets.md` §3).
 *
 * The module-level transforms this class delegates to live in the
 * sibling `live-query-transforms.ts` (R7.2 split — the Python file is
 * 2,042 lines).
 *
 * Port-wide conventions applied here:
 *
 * - R10.8 — every wire call is an ALREADY-PORTED B4 client method
 *   (`segmentation`, `funnel`, `retention`, `eventCounts`,
 *   `propertyCounts`, `activityFeed`, `querySavedReport`,
 *   `insightsQuery`, `arbFunnelsQuery`, `querySavedFlows`, `frequency`,
 *   `segmentationNumeric`, `segmentationSum`, `segmentationAverage`);
 *   nothing is re-assembled here.
 * - The B4 client hands back the lossless `JsonValue` tree; every
 *   consumption point converts with {@link toNativeJson} — the
 *   documented point where the TS wire layer matches `json.loads`.
 * - Unlike {@link DiscoveryService} this service caches NOTHING
 *   (`live_query.py:679-681`).
 */

import type { MixpanelClient } from "../client/client.js";
import { toNativeJson, type JsonValue } from "../client/json-value.js";
import { normalizeOnExpression } from "../query/expressions.js";
import type { CountType, HourDayUnit, TimeUnit } from "../types/literals.js";
import {
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
  type FlowMode,
  type SavedReportBookmarkType,
} from "./live-query-transforms.js";

/** Counting methods the multi-event/property endpoints accept. */
export type CountingType = "general" | "unique" | "average";

/** Day/week/month unit of the multi-event/property endpoints. */
export type DayWeekMonth = "day" | "week" | "month";

/** Construction options of {@link LiveQueryService}. */
export interface LiveQueryServiceOptions {
  /**
   * `warnings.warn` sink for
   * `_extract_funnel_steps_from_series`'s unrecognized-format warning
   * (`live_query.py:392-397`; R9.5 — `core` has no stderr).
   */
  readonly warn?: WarningSink | undefined;
}

/** Options bag of {@link LiveQueryService.segmentation}. */
export interface LiveSegmentationOptions {
  /** Property to segment by (bare names are normalized). */
  readonly on?: string | null | undefined;
  /** Time unit for aggregation. Default `"day"`. */
  readonly unit?: TimeUnit | undefined;
  /** Filter expression. */
  readonly where?: string | null | undefined;
}

/** Options bag of {@link LiveQueryService.funnel}. */
export interface LiveFunnelOptions {
  /** Time unit for grouping. */
  readonly unit?: string | null | undefined;
  /** Property to segment by. */
  readonly on?: string | null | undefined;
}

/** Options bag of {@link LiveQueryService.retention}. */
export interface LiveRetentionOptions {
  /** Filter for the born event. */
  readonly born_where?: string | null | undefined;
  /** Filter for the return event. */
  readonly return_where?: string | null | undefined;
  /** Retention interval size. Default `1`. */
  readonly interval?: number | undefined;
  /** Number of intervals to track. Default `10`. */
  readonly interval_count?: number | undefined;
  /** Interval unit. Default `"day"`. */
  readonly unit?: TimeUnit | undefined;
}

/** Options bag of {@link LiveQueryService.eventCounts}. */
export interface LiveEventCountsOptions {
  /** Counting method. Default `"general"`. */
  readonly type?: CountingType | undefined;
  /** Time unit. Default `"day"`. */
  readonly unit?: DayWeekMonth | undefined;
}

/** Options bag of {@link LiveQueryService.propertyCounts}. */
export interface LivePropertyCountsOptions {
  /** Counting method. Default `"general"`. */
  readonly type?: CountingType | undefined;
  /** Time unit. Default `"day"`. */
  readonly unit?: DayWeekMonth | undefined;
  /** Specific property values to include. */
  readonly values?: readonly string[] | null | undefined;
  /** Maximum property values to return (server default 255). */
  readonly limit?: number | null | undefined;
}

/** Options bag of {@link LiveQueryService.activityFeed}. */
export interface LiveActivityFeedOptions {
  /** Start date (`YYYY-MM-DD`). */
  readonly from_date?: string | null | undefined;
  /** End date (`YYYY-MM-DD`). */
  readonly to_date?: string | null | undefined;
  /** Max events to return (server ceiling 15000). */
  readonly limit?: number | null | undefined;
  /** Event names to include (exclusive with `exclude_events`). */
  readonly include_events?: readonly string[] | null | undefined;
  /** Event names to exclude (exclusive with `include_events`). */
  readonly exclude_events?: readonly string[] | null | undefined;
  /** Pagination cursor from a prior result. */
  readonly sentinel_event?: Record<string, unknown> | null | undefined;
  /** Days (<= 30) bounding each page's scan window. */
  readonly paging_window?: number | null | undefined;
  /** Full-text search string. */
  readonly search?: string | null | undefined;
  /** Property descriptors restricting the search. */
  readonly search_properties?:
    ReadonlyArray<Record<string, unknown>> | null | undefined;
  /** Label matching custom events in raw results. Default `false`. */
  readonly use_custom_events?: boolean | undefined;
}

/** Options bag of {@link LiveQueryService.querySavedReport}. */
export interface LiveQuerySavedReportOptions {
  /** Bookmark type routing the query. Default `"insights"`. */
  readonly bookmark_type?: SavedReportBookmarkType | undefined;
  /** Start date (`YYYY-MM-DD`). */
  readonly from_date?: string | null | undefined;
  /** End date (`YYYY-MM-DD`). */
  readonly to_date?: string | null | undefined;
}

/** Options bag of {@link LiveQueryService.frequency}. */
export interface LiveFrequencyOptions {
  /** Overall time period. Default `"day"`. */
  readonly unit?: TimeUnit | undefined;
  /** Measurement granularity. Default `"hour"`. */
  readonly addiction_unit?: HourDayUnit | undefined;
  /** Event name to filter (`null` = all events). */
  readonly event?: string | null | undefined;
  /** Filter expression. */
  readonly where?: string | null | undefined;
}

/** Options bag of {@link LiveQueryService.segmentationNumeric}. */
export interface LiveSegmentationNumericOptions {
  /** Time aggregation unit. Default `"day"`. */
  readonly unit?: HourDayUnit | undefined;
  /** Filter expression. */
  readonly where?: string | null | undefined;
  /** Counting method. Default `"general"`. */
  readonly type?: CountType | undefined;
}

/** Options bag of the sum/average numeric queries. */
export interface LiveNumericOptions {
  /** Time aggregation unit. Default `"day"`. */
  readonly unit?: HourDayUnit | undefined;
  /** Filter expression. */
  readonly where?: string | null | undefined;
}

/**
 * Convert a B4 client response to the native tree Python's
 * `json.loads` produces, then hand it to the transforms as a mapping.
 *
 * @param raw - The lossless response tree.
 * @returns The native-valued record.
 */
function nativeRecord(raw: JsonValue): Readonly<Record<string, unknown>> {
  return toNativeJson(raw) as Readonly<Record<string, unknown>>;
}

/**
 * `raw.get("data", {}).get("values", {})` — the shape `event_counts`
 * and `property_counts` inline (`live_query.py:923`, `:996`).
 *
 * Absent keys yield `{}`; an explicitly non-mapping `data` member makes
 * the nested `.get` raise CPython's `AttributeError` via
 * {@link pyMapping} (B5-ARB FID-F2 — the pre-fix `Object.hasOwn` read
 * silently returned `{}` for str/number receivers and threw the wrong
 * class for `null`).
 *
 * @param raw - The native response record.
 * @returns The `data.values` mapping.
 * @throws AttributeError - When the `data` member is not a dict.
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
 * Service for executing live queries against the Mixpanel Query API —
 * TS port of `live_query.LiveQueryService` (`live_query.py:677`).
 *
 * Transforms raw API responses into the typed Phase-2 result objects.
 * Nothing is cached: analytics data changes constantly and queries
 * must return fresh data.
 *
 * @example
 * ```typescript
 * const live = new LiveQueryService(client);
 * const result = await live.segmentation("Sign Up", "2024-01-01", "2024-01-31");
 * console.log(result.total);
 * ```
 */
export class LiveQueryService {
  /** The bound wire client (`self._api_client`). @internal */
  readonly apiClient: MixpanelClient;

  /** The `warnings.warn` sink handed to the funnel-series transform. */
  readonly #warn: WarningSink;

  /**
   * Initialize the live query service (`__init__`,
   * `live_query.py:697-704`).
   *
   * @param apiClient - Authenticated Mixpanel client (B4, R10.8).
   * @param options - Injected warning seam (R9.5).
   */
  constructor(
    apiClient: MixpanelClient,
    options: LiveQueryServiceOptions = {},
  ) {
    this.apiClient = apiClient;
    this.#warn = options.warn ?? ((): void => {});
  }

  /**
   * Run a segmentation query (`segmentation`,
   * `live_query.py:705-759`).
   *
   * Bare property names in `on` are normalized to filter-expression
   * syntax before the wire call; the RESULT keeps the caller's
   * un-normalized `on` in `segment_property` (Python passes the
   * original, `:759`).
   *
   * @param event - Event name to segment.
   * @param fromDate - Start date (`YYYY-MM-DD`).
   * @param toDate - End date (`YYYY-MM-DD`).
   * @param options - on / unit / where.
   * @returns The typed result with the calculated total.
   * @throws AuthenticationError - Invalid credentials.
   * @throws QueryError - Invalid query parameters.
   * @throws RateLimitError - Rate limit exceeded.
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
   * Run a funnel analysis query (`funnel`, `live_query.py:761-810`).
   *
   * @param funnelId - Funnel identifier.
   * @param fromDate - Start date (`YYYY-MM-DD`).
   * @param toDate - End date (`YYYY-MM-DD`).
   * @param options - unit / on.
   * @returns The typed result with aggregated steps and rates.
   * @throws AuthenticationError - Invalid credentials.
   * @throws QueryError - Invalid funnel ID or parameters.
   * @throws RateLimitError - Rate limit exceeded.
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
   * Run a retention analysis query (`retention`,
   * `live_query.py:812-874`).
   *
   * NOTE the wire-argument rename Python performs: the service's
   * `return_event` is the client's `event`, and `return_where` is the
   * client's `where` (`:864-874`).
   *
   * @param bornEvent - Event that defines cohort membership.
   * @param returnEvent - Event that defines return.
   * @param fromDate - Start date (`YYYY-MM-DD`).
   * @param toDate - End date (`YYYY-MM-DD`).
   * @param options - born_where / return_where / interval /
   *   interval_count / unit.
   * @returns The typed result with cohorts sorted by date.
   * @throws AuthenticationError - Invalid credentials.
   * @throws QueryError - Invalid parameters.
   * @throws RateLimitError - Rate limit exceeded.
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
   * Query aggregate counts for multiple events (`event_counts`,
   * `live_query.py:876-930`).
   *
   * @param events - Event names to query.
   * @param fromDate - Start date (`YYYY-MM-DD`).
   * @param toDate - End date (`YYYY-MM-DD`).
   * @param options - type / unit.
   * @returns The typed result with per-event time series.
   * @throws AuthenticationError - Invalid credentials.
   * @throws QueryError - Invalid parameters.
   * @throws RateLimitError - Rate limit exceeded.
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
   * Query aggregate counts by property value (`property_counts`,
   * `live_query.py:932-1001`).
   *
   * @param event - Event name to query.
   * @param propertyName - Property to segment by.
   * @param fromDate - Start date (`YYYY-MM-DD`).
   * @param toDate - End date (`YYYY-MM-DD`).
   * @param options - type / unit / values / limit.
   * @returns The typed result with per-value time series.
   * @throws AuthenticationError - Invalid credentials.
   * @throws QueryError - Invalid parameters.
   * @throws RateLimitError - Rate limit exceeded.
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

  // =========================================================================
  // Phase 008: Query Service Enhancements (`live_query.py:1003-1565`)
  // =========================================================================

  /**
   * Query the activity feed for specific users (`activity_feed`,
   * `live_query.py:1003-1077`).
   *
   * @param distinctIds - User identifiers to query.
   * @param options - Dates / limit / include / exclude / search /
   *   pagination.
   * @returns The typed result with user events and the pagination
   *   cursor.
   * @throws AuthenticationError - Invalid credentials.
   * @throws QueryError - Invalid parameters (e.g. include AND exclude).
   * @throws RateLimitError - Rate limit exceeded.
   * @throws ValueError - An event without a `time` property.
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
   * Query a saved report by bookmark type (`query_saved_report`,
   * `live_query.py:1079-1124`).
   *
   * @param bookmarkId - Saved report identifier.
   * @param options - bookmark_type / from_date / to_date.
   * @returns The typed result with the detected report type.
   * @throws AuthenticationError - Invalid credentials.
   * @throws QueryError - Invalid bookmark_id or report not found.
   * @throws RateLimitError - Rate limit exceeded.
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
   * Execute an inline insights query with pre-built bookmark params
   * (`query`, `live_query.py:1126-1163`).
   *
   * @param bookmarkParams - Pre-built bookmark params dict.
   * @param projectId - Mixpanel project ID.
   * @returns The typed result with series data and metadata.
   * @throws AuthenticationError - Invalid credentials.
   * @throws QueryError - Invalid bookmark params or an error-as-200.
   * @throws RateLimitError - Rate limit exceeded.
   */
  async query(
    bookmarkParams: Readonly<Record<string, unknown>>,
    projectId: number,
  ): Promise<QueryResult> {
    const body: Record<string, unknown> = {
      bookmark: bookmarkParams,
      project_id: projectId,
      queryLimits: { limit: 3000 },
    };
    const raw = await this.apiClient.insightsQuery(body);
    return transformQueryResult(nativeRecord(raw), bookmarkParams);
  }

  /**
   * Execute an inline funnel query with pre-built bookmark params
   * (`query_funnel`, `live_query.py:1165-1205`).
   *
   * @param bookmarkParams - Pre-built funnel bookmark params dict.
   * @param projectId - Mixpanel project ID.
   * @returns The typed result with step data and metadata.
   * @throws AuthenticationError - Invalid credentials.
   * @throws QueryError - Invalid bookmark params or an error-as-200.
   * @throws RateLimitError - Rate limit exceeded.
   */
  async queryFunnel(
    bookmarkParams: Readonly<Record<string, unknown>>,
    projectId: number,
  ): Promise<FunnelQueryResult> {
    const body: Record<string, unknown> = {
      bookmark: bookmarkParams,
      project_id: projectId,
      queryLimits: { limit: 3000 },
    };
    const raw = await this.apiClient.insightsQuery(body);
    return transformFunnelResult(nativeRecord(raw), bookmarkParams, this.#warn);
  }

  /**
   * Execute an inline retention query with pre-built bookmark params
   * (`query_retention`, `live_query.py:1207-1247`).
   *
   * @param bookmarkParams - Pre-built retention bookmark params dict.
   * @param projectId - Mixpanel project ID.
   * @returns The typed result with cohort data and metadata.
   * @throws AuthenticationError - Invalid credentials.
   * @throws QueryError - Invalid bookmark params or an error-as-200.
   * @throws RateLimitError - Rate limit exceeded.
   */
  async queryRetention(
    bookmarkParams: Readonly<Record<string, unknown>>,
    projectId: number,
  ): Promise<RetentionQueryResult> {
    const body: Record<string, unknown> = {
      bookmark: bookmarkParams,
      project_id: projectId,
      queryLimits: { limit: 3000 },
    };
    const raw = await this.apiClient.insightsQuery(body);
    return transformRetentionResult(nativeRecord(raw), bookmarkParams);
  }

  /**
   * Execute an inline flow query with pre-built bookmark params
   * (`query_flow`, `live_query.py:1249-1303`).
   *
   * The `mode` maps to the `/arb_funnels` `query_type` exactly as
   * Python does: `"paths"` → `flows_top_paths`, `"tree"` → `flows`,
   * anything else → `flows_sankey` (`:1289-1294`).
   *
   * @param bookmarkParams - Pre-built flow bookmark params dict.
   * @param projectId - Mixpanel project ID.
   * @param mode - Flow visualization mode. Default `"sankey"`.
   * @returns The typed result with steps, flows and breakdowns.
   * @throws AuthenticationError - Invalid credentials.
   * @throws QueryError - Invalid bookmark params or an error-as-200.
   * @throws RateLimitError - Rate limit exceeded.
   */
  async queryFlow(
    bookmarkParams: Readonly<Record<string, unknown>>,
    projectId: number,
    mode: string = "sankey",
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
    const raw = await this.apiClient.arbFunnelsQuery(body);
    return transformFlowResult(nativeRecord(raw), bookmarkParams, mode);
  }

  /**
   * Query a saved Flows report (`query_saved_flows`,
   * `live_query.py:1305-1333`).
   *
   * @param bookmarkId - Saved flows report identifier.
   * @returns The typed result with steps, breakdowns and the rate.
   * @throws AuthenticationError - Invalid credentials.
   * @throws QueryError - Invalid bookmark_id or report not found.
   * @throws RateLimitError - Rate limit exceeded.
   */
  async querySavedFlows(bookmarkId: number): Promise<FlowsResult> {
    const raw = await this.apiClient.querySavedFlows(bookmarkId);
    return transformFlows(nativeRecord(raw), bookmarkId);
  }

  /**
   * Query the event frequency distribution (`frequency`,
   * `live_query.py:1335-1388`).
   *
   * @param fromDate - Start date (`YYYY-MM-DD`).
   * @param toDate - End date (`YYYY-MM-DD`).
   * @param options - unit / addiction_unit / event / where.
   * @returns The typed result with frequency arrays.
   * @throws AuthenticationError - Invalid credentials.
   * @throws QueryError - Invalid parameters.
   * @throws RateLimitError - Rate limit exceeded.
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
   * Query events bucketed by numeric property ranges
   * (`segmentation_numeric`, `live_query.py:1390-1447`).
   *
   * @param event - Event name to analyze.
   * @param fromDate - Start date (`YYYY-MM-DD`).
   * @param toDate - End date (`YYYY-MM-DD`).
   * @param on - Numeric property expression to bucket.
   * @param options - unit / where / type.
   * @returns The typed result with the bucketed time series.
   * @throws AuthenticationError - Invalid credentials.
   * @throws QueryError - Invalid parameters or non-numeric property.
   * @throws RateLimitError - Rate limit exceeded.
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
    // (unconditional here — Python has no `if on` guard, `:1436`).
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
   * Query the sum of a numeric property (`segmentation_sum`,
   * `live_query.py:1449-1503`).
   *
   * @param event - Event name to analyze.
   * @param fromDate - Start date (`YYYY-MM-DD`).
   * @param toDate - End date (`YYYY-MM-DD`).
   * @param on - Numeric property expression to sum.
   * @param options - unit / where.
   * @returns The typed result with the sum values.
   * @throws AuthenticationError - Invalid credentials.
   * @throws QueryError - Invalid parameters or non-numeric property.
   * @throws RateLimitError - Rate limit exceeded.
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
   * Query the average of a numeric property
   * (`segmentation_average`, `live_query.py:1505-1562`).
   *
   * @param event - Event name to analyze.
   * @param fromDate - Start date (`YYYY-MM-DD`).
   * @param toDate - End date (`YYYY-MM-DD`).
   * @param on - Numeric property expression to average.
   * @param options - unit / where.
   * @returns The typed result with the average values.
   * @throws AuthenticationError - Invalid credentials.
   * @throws QueryError - Invalid parameters or non-numeric property.
   * @throws RateLimitError - Rate limit exceeded.
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

export type { FlowMode, SavedReportBookmarkType };
