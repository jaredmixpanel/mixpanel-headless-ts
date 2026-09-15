/**
 * Query-host wire methods — Phase-3 packet B4-C2 port of the
 * `MixpanelAPIClient` discovery/query surface (`api_client.py`
 * `:2342-2546` discovery, `:2547-2641` counts, `:2642-2794`
 * segmentation/funnel/retention, `:2800-3293` phase-008 + saved
 * reports + inline queries).
 *
 * Every method delegates to the C1 `_request` twin
 * (`core.requestQueryHost`) — project-id injection, explicit-only
 * workspace-pin injection, retry/backoff, and `query_origin` all live
 * THERE (B0 `executeWithRetry`); nothing here re-derives them (R10.8,
 * packet Caution "no query_origin double-injection"). Results are the
 * parsed bodies verbatim — result shaping is B5 (Caution #11).
 */

import type { ClientCore } from "../../client/client.js";
import { isPlainRecord, jsonValuePythonStr } from "../../client/internals.js";
import type { JsonValue } from "../../client/json-value.js";
import { pythonInt, pythonJsonDumps } from "../../compat/index.js";
import { QueryError } from "../../errors.js";
import { ValueError } from "../../query/python-builtins.js";
import {
  addDays,
  type CivilDate,
  civilFromInstantUtc,
  formatYmd,
  parseYmd,
} from "./py-dates.js";

/**
 * Server-side ceiling on the `/events/names` `limit` parameter
 * (`api_client.py:2348`).
 */
export const EVENTS_NAMES_MAX_LIMIT = 5000;

/**
 * Widest `from_date` the server accepts (`api_client.py:2355`).
 */
export const EVENTS_NAMES_WIDE_FROM_DATE = "2000-01-01";

/**
 * The `re.search(r"exceeds\s+(\d+)\s+days", ...)` twin
 * (`api_client.py:2420`). Python compiles `\s`/`\d` in Unicode mode:
 * `\s` is the CPython str-pattern whitespace class (spelled out below —
 * NOTE it includes `\x1c-\x1f` and `\x85` which JS `\s` lacks, and
 * EXCLUDES U+FEFF which JS `\s` contains), `\d` is `\p{Nd}` (R11.7:
 * no bare `\s`/`\d` grammars in ported code).
 */
const PY_WS = String.raw`[\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]`;
const DATE_GATE_PATTERN = new RegExp(
  String.raw`exceeds${PY_WS}+(\p{Nd}+)${PY_WS}+days`,
  "u",
);

/**
 * Parse a `YYYY-MM-DD` activity-feed date, raising QueryError on bad
 * input — `_parse_feed_date` (`api_client.py:175-199`).
 *
 * @param value - The date string to parse.
 * @param field - The parameter name for the message.
 * @returns The parsed civil date.
 * @throws QueryError - When the value is not a valid `%Y-%m-%d` date.
 */
function parseFeedDate(value: string, field: string): CivilDate {
  const parsed = parseYmd(value);
  if (parsed === null) {
    throw new QueryError(
      `Invalid ${field} ${JSON.stringify(value)}; expected YYYY-MM-DD`,
    );
  }
  return parsed;
}

/**
 * Build a stream/bookmark `dateRange` object from optional date strings
 * — `_build_activity_feed_date_range` (`api_client.py:202-249`).
 *
 * Both dates are validated up front so a malformed value fails the same
 * way regardless of which arm it lands in.
 *
 * @param fromDate - Optional inclusive start date (`YYYY-MM-DD`).
 * @param toDate - Optional inclusive end date (`YYYY-MM-DD`).
 * @returns A `between` range when both dates are given, a `since` range
 *   for a lone `fromDate`, a 30-day `between` window ending at a lone
 *   `toDate`, and a relative last-30-days window when neither is given.
 * @throws QueryError - When either supplied date is invalid, or when
 *   `toDate` is too early to compute a 30-day window (the Python
 *   `OverflowError` arm).
 * @example
 * ```typescript
 * buildActivityFeedDateRange("2026-05-01", "2026-06-01");
 * // { type: "between", from: "2026-05-01", to: "2026-06-01" }
 * ```
 */
export function buildActivityFeedDateRange(
  fromDate: string | null | undefined,
  toDate: string | null | undefined,
): Record<string, JsonValue> {
  if (fromDate !== undefined && fromDate !== null && fromDate !== "") {
    parseFeedDate(fromDate, "from_date");
  }
  const toTruthy = toDate !== undefined && toDate !== null && toDate !== "";
  const parsedTo = toTruthy ? parseFeedDate(toDate, "to_date") : null;
  const fromTruthy =
    fromDate !== undefined && fromDate !== null && fromDate !== "";
  if (fromTruthy && toTruthy) {
    return { type: "between", from: fromDate, to: toDate };
  }
  if (fromTruthy) {
    return { type: "since", from: fromDate };
  }
  if (toTruthy && parsedTo !== null) {
    const windowStart = addDays(parsedTo, -30);
    if (windowStart === null) {
      // Python: OverflowError from `parsed_to - timedelta(days=30)` —
      // re-raised as QueryError (`api_client.py:244-247`).
      throw new QueryError(
        `to_date ${JSON.stringify(toDate)} is too early to compute a 30-day window`,
      );
    }
    return { type: "between", from: formatYmd(windowStart), to: toDate };
  }
  return { type: "relative_after", window: { unit: "day", value: 30 } };
}

/** Python truthiness for optional string params (`if where:` guards). */
function truthyStr(value: string | null | undefined): value is string {
  return value !== undefined && value !== null && value !== "";
}

/** Python truthiness for optional list params (`if events:` guards). */
function truthyList(value: readonly unknown[] | null | undefined): boolean {
  return value !== undefined && value !== null && value.length > 0;
}

/** Absent-or-None check (`is not None` guards). */
function isSet<T>(value: T | null | undefined): value is T {
  return value !== undefined && value !== null;
}

/** Options bag of {@link QueryHostMethods.getEvents}. */
export interface GetEventsOptions {
  /** Maximum events to return (server-capped at 5000). */
  readonly limit?: number | undefined;
  /** `YYYY-MM-DD` lower bound (default `2000-01-01`). */
  readonly from_date?: string | null | undefined;
  /** `YYYY-MM-DD` upper bound (default today). */
  readonly to_date?: string | null | undefined;
  /** Optional cancellation signal (R6.7). */
  readonly signal?: AbortSignal | undefined;
}

/** Options bag of {@link QueryHostMethods.getPropertyValues}. */
export interface GetPropertyValuesOptions {
  /** Optional event name to scope the property. */
  readonly event?: string | null | undefined;
  /** Maximum number of values to return (default 255). */
  readonly limit?: number | undefined;
  /** Optional cancellation signal (R6.7). */
  readonly signal?: AbortSignal | undefined;
}

/** Options bag of {@link QueryHostMethods.getTopEvents}. */
export interface GetTopEventsOptions {
  /** Counting method — "general", "unique", or "average". */
  readonly type?: string | undefined;
  /** Maximum events to return. */
  readonly limit?: number | null | undefined;
  /** Optional cancellation signal (R6.7). */
  readonly signal?: AbortSignal | undefined;
}

/** Options bag of {@link QueryHostMethods.eventCounts}. */
export interface EventCountsOptions {
  /** Counting method. */
  readonly type?: string | undefined;
  /** Time unit. */
  readonly unit?: string | undefined;
  /** Optional cancellation signal (R6.7). */
  readonly signal?: AbortSignal | undefined;
}

/** Options bag of {@link QueryHostMethods.propertyCounts}. */
export interface PropertyCountsOptions {
  /** Counting method. */
  readonly type?: string | undefined;
  /** Time unit. */
  readonly unit?: string | undefined;
  /** Specific property values to include. */
  readonly values?: readonly string[] | null | undefined;
  /** Maximum property values to return. */
  readonly limit?: number | null | undefined;
  /** Optional cancellation signal (R6.7). */
  readonly signal?: AbortSignal | undefined;
}

/** Options bag of {@link QueryHostMethods.segmentation}. */
export interface SegmentationOptions {
  /** Property to segment by. */
  readonly on?: string | null | undefined;
  /** Time unit. */
  readonly unit?: string | undefined;
  /** Aggregation type. */
  readonly type?: string | undefined;
  /** Filter expression. */
  readonly where?: string | null | undefined;
  /** Optional cancellation signal (R6.7). */
  readonly signal?: AbortSignal | undefined;
}

/** Options bag of {@link QueryHostMethods.funnel}. */
export interface FunnelOptions {
  /** Time unit for grouping. */
  readonly unit?: string | null | undefined;
  /** Property to segment by. */
  readonly on?: string | null | undefined;
  /** Filter expression. */
  readonly where?: string | null | undefined;
  /** Conversion window length. */
  readonly length?: number | null | undefined;
  /** Conversion window unit. */
  readonly length_unit?: string | null | undefined;
  /** Optional cancellation signal (R6.7). */
  readonly signal?: AbortSignal | undefined;
}

/** Options bag of {@link QueryHostMethods.retention}. */
export interface RetentionOptions {
  /** Retention type (birth, compounded). */
  readonly retention_type?: string | undefined;
  /** Filter for the born event. */
  readonly born_where?: string | null | undefined;
  /** Filter for the return event. */
  readonly where?: string | null | undefined;
  /** Retention interval size. */
  readonly interval?: number | undefined;
  /** Number of intervals to track. */
  readonly interval_count?: number | undefined;
  /** Interval unit (day, week, month). */
  readonly unit?: string | undefined;
  /** Optional cancellation signal (R6.7). */
  readonly signal?: AbortSignal | undefined;
}

/** Options bag of {@link QueryHostMethods.activityFeed}. */
export interface ActivityFeedOptions {
  /** Inclusive start date (`YYYY-MM-DD`). */
  readonly from_date?: string | null | undefined;
  /** Inclusive end date (`YYYY-MM-DD`). */
  readonly to_date?: string | null | undefined;
  /** Max events to return. */
  readonly limit?: number | null | undefined;
  /** Event names to include. */
  readonly include_events?: readonly string[] | null | undefined;
  /** Event names to exclude. */
  readonly exclude_events?: readonly string[] | null | undefined;
  /** Pagination cursor from a prior call. */
  readonly sentinel_event?: Record<string, unknown> | null | undefined;
  /** Days (<= 30) bounding each page's scan window. */
  readonly paging_window?: number | null | undefined;
  /** Full-text search string. */
  readonly search?: string | null | undefined;
  /** Property descriptors restricting the search. */
  readonly search_properties?:
    ReadonlyArray<Record<string, unknown>> | null | undefined;
  /** Label raw events matching custom-event definitions. */
  readonly use_custom_events?: boolean | undefined;
  /** Optional cancellation signal (R6.7). */
  readonly signal?: AbortSignal | undefined;
}

/**
 * Keyword options of the two inline query methods
 * (`insights_query` / `arb_funnels_query`, 045-report-links): an
 * explicit data view plus the pin opt-out (Python kw-only, R3.8).
 */
export interface InlineQueryOptions {
  /**
   * Optional data view to run under. When set it is sent as the
   * `workspace_id` query parameter and wins over the pinned session
   * workspace.
   */
  readonly workspace_id?: number | null | undefined;
  /**
   * When `true` (default) and `workspace_id` is `null`, the pinned
   * session workspace, if any, is sent. `false` sends no pin, so the
   * query runs project-wide unless `workspace_id` is set.
   */
  readonly inject_workspace_id?: boolean | undefined;
  /** Optional cancellation signal (R6.7). */
  readonly signal?: AbortSignal | undefined;
}

/**
 * Build the query params that carry an explicit data view, or `null`
 * (`_explicit_workspace_params`). `requestQueryHost` injects the pinned
 * workspace with `setdefault` semantics, so a `workspace_id` placed here
 * wins over the pin; `null` leaves the params empty and the pin rule
 * unchanged.
 *
 * @param workspaceId - The data view to run under, or `null`.
 * @returns `{workspace_id}` or `null`.
 */
function explicitWorkspaceParams(
  workspaceId: number | null | undefined,
): Record<string, unknown> | null {
  if (workspaceId === null || workspaceId === undefined) {
    return null;
  }
  return { workspace_id: workspaceId };
}

/** Options bag of {@link QueryHostMethods.querySavedReport}. */
export interface QuerySavedReportOptions {
  /** Bookmark type routing the query. */
  readonly bookmark_type?:
    "insights" | "funnels" | "retention" | "flows" | undefined;
  /** Start date (`YYYY-MM-DD`). */
  readonly from_date?: string | null | undefined;
  /** End date (`YYYY-MM-DD`). */
  readonly to_date?: string | null | undefined;
  /** Optional cancellation signal (R6.7). */
  readonly signal?: AbortSignal | undefined;
}

/** Options bag of {@link QueryHostMethods.frequency}. */
export interface FrequencyOptions {
  /** Event name to filter. */
  readonly event?: string | null | undefined;
  /** Filter expression. */
  readonly where?: string | null | undefined;
  /** Property to segment by. */
  readonly on?: string | null | undefined;
  /** Maximum segmentation values. */
  readonly limit?: number | null | undefined;
  /** Optional cancellation signal (R6.7). */
  readonly signal?: AbortSignal | undefined;
}

/** Options bag of the numeric segmentation family. */
export interface SegmentationNumericOptions {
  /** Time aggregation unit. */
  readonly unit?: string | undefined;
  /** Filter expression. */
  readonly where?: string | null | undefined;
  /** Counting method (numeric bucketing only). */
  readonly type?: string | undefined;
  /** Optional cancellation signal (R6.7). */
  readonly signal?: AbortSignal | undefined;
}

/** The C2 query-host method surface (mixed into `MixpanelClient`). */
export interface QueryHostMethods {
  /**
   * List event names in the project (`get_events`,
   * `api_client.py:2357-2428`) with widest-window defaults and the
   * one-shot 403 "Date range exceeds N days" retry.
   *
   * @param options - Optional limit/date overrides.
   * @returns Event name strings (`str(e)` casts preserved).
   * @throws AuthenticationError - Invalid credentials.
   * @throws QueryError - Non-gate 403s and other 4xx errors.
   * @throws RateLimitError | ServerError | MixpanelHeadlessError - Per
   *   the shared retry core.
   */
  getEvents: (options?: GetEventsOptions) => Promise<string[]>;

  /**
   * List properties for a specific event (`get_event_properties`,
   * `api_client.py:2430-2448`).
   *
   * @param event - Event name.
   * @param signal - Optional cancellation signal.
   * @returns Property name strings (dict keys of the response).
   * @throws AuthenticationError | QueryError - Per the retry core.
   */
  getEventProperties: (
    event: string,
    signal?: AbortSignal,
  ) => Promise<string[]>;

  /**
   * List sample values for a property (`get_property_values`,
   * `api_client.py:2450-2480`).
   *
   * @param propertyName - Property name.
   * @param options - Optional event scope and limit.
   * @returns Property value strings (`str(v)` casts preserved).
   * @throws AuthenticationError - Invalid credentials.
   */
  getPropertyValues: (
    propertyName: string,
    options?: GetPropertyValuesOptions,
  ) => Promise<string[]>;

  /**
   * List saved funnels (`list_funnels`, `api_client.py:2482-2496`).
   *
   * @param signal - Optional cancellation signal.
   * @returns Funnel dicts, or `[]` for a non-list response.
   * @throws AuthenticationError | RateLimitError - Per the retry core.
   */
  listFunnels: (signal?: AbortSignal) => Promise<JsonValue[]>;

  /**
   * List saved cohorts via POST (`list_cohorts`,
   * `api_client.py:2498-2515`).
   *
   * @param signal - Optional cancellation signal.
   * @returns Cohort dicts, or `[]` for a non-list response.
   * @throws AuthenticationError | RateLimitError - Per the retry core.
   */
  listCohorts: (signal?: AbortSignal) => Promise<JsonValue[]>;

  /**
   * Today's top events (`get_top_events`, `api_client.py:2517-2545`).
   *
   * @param options - Counting type and limit.
   * @returns The response dict, or `{events: [], type}` for a non-dict.
   * @throws AuthenticationError | RateLimitError - Per the retry core.
   */
  getTopEvents: (options?: GetTopEventsOptions) => Promise<JsonValue>;

  /**
   * Aggregate counts for multiple events (`event_counts`,
   * `api_client.py:2547-2585`).
   *
   * @param events - Event names (JSON-encoded on the wire).
   * @param fromDate - Start date.
   * @param toDate - End date.
   * @param options - Counting type and unit.
   * @returns The raw response.
   * @throws AuthenticationError | QueryError | RateLimitError - Per the
   *   retry core.
   */
  eventCounts: (
    events: readonly string[],
    fromDate: string,
    toDate: string,
    options?: EventCountsOptions,
  ) => Promise<JsonValue>;

  /**
   * Aggregate counts by property values (`property_counts`,
   * `api_client.py:2587-2636`).
   *
   * @param event - Event name.
   * @param propertyName - Property to segment by.
   * @param fromDate - Start date.
   * @param toDate - End date.
   * @param options - Type/unit/values/limit.
   * @returns The raw response.
   * @throws AuthenticationError | QueryError | RateLimitError - Per the
   *   retry core.
   */
  propertyCounts: (
    event: string,
    propertyName: string,
    fromDate: string,
    toDate: string,
    options?: PropertyCountsOptions,
  ) => Promise<JsonValue>;

  /**
   * Run a segmentation query (`segmentation`,
   * `api_client.py:2642-2685`).
   *
   * @param event - Event name to segment.
   * @param fromDate - Start date.
   * @param toDate - End date.
   * @param options - on/unit/type/where.
   * @returns The raw response.
   * @throws AuthenticationError | QueryError | RateLimitError - Per the
   *   retry core.
   */
  segmentation: (
    event: string,
    fromDate: string,
    toDate: string,
    options?: SegmentationOptions,
  ) => Promise<JsonValue>;

  /**
   * Run a funnel query (`funnel`, `api_client.py:2687-2736`).
   *
   * @param funnelId - Funnel identifier.
   * @param fromDate - Start date.
   * @param toDate - End date.
   * @param options - unit/on/where/length/length_unit.
   * @returns The raw response.
   * @throws AuthenticationError | QueryError | RateLimitError - Per the
   *   retry core.
   */
  funnel: (
    funnelId: number,
    fromDate: string,
    toDate: string,
    options?: FunnelOptions,
  ) => Promise<JsonValue>;

  /**
   * Run a retention query (`retention`, `api_client.py:2738-2794`).
   * `unit` and `interval` are mutually exclusive on the wire: `interval`
   * is sent only when != 1, otherwise `unit`.
   *
   * @param bornEvent - Cohort-defining event.
   * @param event - Return event.
   * @param fromDate - Start date.
   * @param toDate - End date.
   * @param options - retention_type/born_where/where/interval/
   *   interval_count/unit.
   * @returns The raw response.
   * @throws AuthenticationError | QueryError | RateLimitError - Per the
   *   retry core.
   */
  retention: (
    bornEvent: string,
    event: string,
    fromDate: string,
    toDate: string,
    options?: RetentionOptions,
  ) => Promise<JsonValue>;

  /**
   * Query the activity feed via stream/bookmark (`activity_feed`,
   * `api_client.py:2800-2909`). Resolves the workspace id (pin or
   * auto-discovery) into the request body.
   *
   * @param distinctIds - User identifiers to query.
   * @param options - Dates/limit/include/exclude/search/pagination.
   * @returns The raw response.
   * @throws QueryError - include/exclude conflict, search_properties
   *   without search, malformed dates, or API rejections.
   * @throws AuthenticationError | RateLimitError - Per the retry core.
   */
  activityFeed: (
    distinctIds: readonly string[],
    options?: ActivityFeedOptions,
  ) => Promise<JsonValue>;

  /**
   * Query a saved report by bookmark type (`query_saved_report`,
   * `api_client.py:2911-2988`).
   *
   * @param bookmarkId - Saved report identifier.
   * @param options - bookmark_type and the funnel date window.
   * @returns The raw response.
   * @throws AuthenticationError | QueryError | RateLimitError - Per the
   *   retry core.
   */
  querySavedReport: (
    bookmarkId: number,
    options?: QuerySavedReportOptions,
  ) => Promise<JsonValue>;

  /**
   * List saved reports (LEGACY query-side listing — `list_bookmarks`,
   * `api_client.py:2990-3020`; the App-API twin `list_bookmarks_v2` is
   * shard C3).
   *
   * @param bookmarkType - Optional report-type filter.
   * @param signal - Optional cancellation signal.
   * @returns The raw response (`results` array inside).
   * @throws AuthenticationError | QueryError | RateLimitError - Per the
   *   retry core.
   */
  listBookmarks: (
    bookmarkType?: string | null,
    signal?: AbortSignal,
  ) => Promise<JsonValue>;

  /**
   * Execute an inline insights query via POST (`insights_query`,
   * `api_client.py:3022-3052`). The body carries `project_id` itself —
   * no query-param injection.
   *
   * @param body - Request body (bookmark params + project_id).
   * @param signal - Optional cancellation signal.
   * @returns The raw response.
   * @throws AuthenticationError | QueryError | RateLimitError - Per the
   *   retry core.
   */
  insightsQuery: (
    body: Record<string, unknown>,
    options?: InlineQueryOptions,
  ) => Promise<JsonValue>;

  /**
   * Query a saved flows report (`query_saved_flows`,
   * `api_client.py:3054-3080`).
   *
   * @param bookmarkId - Saved flows report identifier.
   * @param signal - Optional cancellation signal.
   * @returns The raw response.
   * @throws AuthenticationError | QueryError | RateLimitError - Per the
   *   retry core.
   */
  querySavedFlows: (
    bookmarkId: number,
    signal?: AbortSignal,
  ) => Promise<JsonValue>;

  /**
   * Execute an inline flow/funnel query (`arb_funnels_query`,
   * `api_client.py:3082-3112` — index-absent, ported for the B5
   * LiveQueryService `query_flow` path; Layer-3-locked only).
   *
   * @param body - Request body (bookmark + project_id + query_type).
   * @param signal - Optional cancellation signal.
   * @returns The raw response.
   * @throws AuthenticationError | QueryError | RateLimitError - Per the
   *   retry core.
   */
  arbFunnelsQuery: (
    body: Record<string, unknown>,
    options?: InlineQueryOptions,
  ) => Promise<JsonValue>;

  /**
   * Event frequency distribution (`frequency`,
   * `api_client.py:3114-3162`).
   *
   * @param fromDate - Start date.
   * @param toDate - End date.
   * @param unit - Overall time period.
   * @param addictionUnit - Measurement granularity.
   * @param options - event/where/on/limit.
   * @returns The raw response.
   * @throws AuthenticationError | QueryError | RateLimitError - Per the
   *   retry core.
   */
  frequency: (
    fromDate: string,
    toDate: string,
    unit: string,
    addictionUnit: string,
    options?: FrequencyOptions,
  ) => Promise<JsonValue>;

  /**
   * Events bucketed by numeric property ranges (`segmentation_numeric`,
   * `api_client.py:3164-3206`).
   *
   * @param event - Event name.
   * @param fromDate - Start date.
   * @param toDate - End date.
   * @param on - Numeric property expression.
   * @param options - unit/where/type.
   * @returns The raw response.
   * @throws AuthenticationError | QueryError | RateLimitError - Per the
   *   retry core.
   */
  segmentationNumeric: (
    event: string,
    fromDate: string,
    toDate: string,
    on: string,
    options?: SegmentationNumericOptions,
  ) => Promise<JsonValue>;

  /**
   * Sum of numeric property values (`segmentation_sum`,
   * `api_client.py:3208-3247`).
   *
   * @param event - Event name.
   * @param fromDate - Start date.
   * @param toDate - End date.
   * @param on - Numeric property expression.
   * @param options - unit/where.
   * @returns The raw response.
   * @throws AuthenticationError | QueryError | RateLimitError - Per the
   *   retry core.
   */
  segmentationSum: (
    event: string,
    fromDate: string,
    toDate: string,
    on: string,
    options?: SegmentationNumericOptions,
  ) => Promise<JsonValue>;

  /**
   * Average of numeric property values (`segmentation_average`,
   * `api_client.py:3249-3292`).
   *
   * @param event - Event name.
   * @param fromDate - Start date.
   * @param toDate - End date.
   * @param on - Numeric property expression.
   * @param options - unit/where.
   * @returns The raw response.
   * @throws AuthenticationError | QueryError | RateLimitError - Per the
   *   retry core.
   */
  segmentationAverage: (
    event: string,
    fromDate: string,
    toDate: string,
    on: string,
    options?: SegmentationNumericOptions,
  ) => Promise<JsonValue>;
}

/**
 * The slice of the assembled client the C2 factory needs beyond
 * {@link ClientCore} (`activity_feed` calls `resolve_workspace_id`).
 */
export interface QueryHostClientDeps {
  /**
   * Resolve the workspace ID (pin → cache → discovery), exactly the C1
   * client method.
   *
   * @returns The resolved workspace id.
   */
  resolveWorkspaceId: () => Promise<number>;
}

/**
 * Build the C2 query-host methods over the C1 core seam (R2.9 factory
 * half; spread into `createMixpanelClient` at the documented merge
 * point).
 *
 * @param core - The shared client internals seam.
 * @param client - The client-method slice (workspace resolution).
 * @returns The method bag.
 */
export function createQueryHostMethods(
  core: ClientCore,
  client: QueryHostClientDeps,
): QueryHostMethods {
  const getEvents = async (
    options: GetEventsOptions = {},
  ): Promise<string[]> => {
    const limit = options.limit ?? EVENTS_NAMES_MAX_LIMIT;
    const fromDate = options.from_date;
    const toDate = options.to_date;
    const url = core.buildUrl("query", "/events/names");
    // Capture today once so the initial to_date and the retry's
    // from_date can't diverge across midnight (`api_client.py:2399`).
    const today = civilFromInstantUtc(core.now());
    const resolvedFrom = fromDate ?? EVENTS_NAMES_WIDE_FROM_DATE;
    const resolvedTo = toDate ?? formatYmd(today);
    const params: Record<string, unknown> = {
      type: "general",
      limit,
      from_date: resolvedFrom,
      to_date: resolvedTo,
    };
    let response: JsonValue;
    try {
      response = await core.requestQueryHost("GET", url, {
        params,
        signal: options.signal,
      });
    } catch (error) {
      if (!(error instanceof QueryError)) {
        throw error;
      }
      const match = DATE_GATE_PATTERN.exec(error.message);
      if (
        match === null ||
        (fromDate !== undefined && fromDate !== null) ||
        error.statusCode !== 403
      ) {
        throw error;
      }
      const allowedDays = pythonInt(match[1] as string);
      const retryFrom = addDays(today, -allowedDays);
      if (retryFrom === null) {
        // Python would raise OverflowError from the date subtraction —
        // out of reach for real gate values; propagate the original.
        throw error;
      }
      params["from_date"] = formatYmd(retryFrom);
      response = await core.requestQueryHost("GET", url, {
        params,
        signal: options.signal,
      });
    }
    if (Array.isArray(response)) {
      return response.map((e) => jsonValuePythonStr(e));
    }
    return [];
  };

  const activityFeed = async (
    distinctIds: readonly string[],
    options: ActivityFeedOptions = {},
  ): Promise<JsonValue> => {
    const includeEvents = options.include_events;
    const excludeEvents = options.exclude_events;
    if (truthyList(includeEvents) && truthyList(excludeEvents)) {
      throw new QueryError(
        "include_events and exclude_events are mutually exclusive",
        {
          requestParams: {
            include_events: includeEvents,
            exclude_events: excludeEvents,
          },
        },
      );
    }
    if (isSet(options.search_properties) && !isSet(options.search)) {
      throw new QueryError("search_properties requires a search string", {
        requestParams: {
          search_properties: options.search_properties,
        },
      });
    }
    const url = core.buildUrl("query", "/stream/bookmark");
    const body: Record<string, unknown> = {
      project_id: core.projectId(),
      workspace_id: await client.resolveWorkspaceId(),
      bookmark: {
        dateRange: buildActivityFeedDateRange(
          options.from_date,
          options.to_date,
        ),
        entries: [],
      },
      distinct_ids: distinctIds,
      mode: "raw",
    };
    if (isSet(options.limit)) {
      body["limit"] = options.limit;
    }
    if (truthyList(includeEvents)) {
      body["include_events"] = includeEvents;
    }
    if (truthyList(excludeEvents)) {
      body["exclude_events"] = excludeEvents;
    }
    if (isSet(options.sentinel_event)) {
      body["sentinel_event"] = options.sentinel_event;
    }
    if (isSet(options.paging_window)) {
      body["paging_window"] = options.paging_window;
    }
    if (isSet(options.search)) {
      body["search"] = options.search;
    }
    if (isSet(options.search_properties)) {
      body["search_properties"] = options.search_properties;
    }
    if (options.use_custom_events === true) {
      body["use_custom_events"] = options.use_custom_events;
    }
    return core.requestQueryHost("POST", url, {
      data: body,
      injectProjectId: false,
      signal: options.signal,
    });
  };

  const querySavedReport = async (
    bookmarkId: number,
    options: QuerySavedReportOptions = {},
  ): Promise<JsonValue> => {
    const bookmarkType = options.bookmark_type ?? "insights";
    // Python's if/elif chain ends in an insights `else`; start from that
    // shape so an out-of-contract bookmark type (JS callers bypassing the
    // literal union) lands there too.
    let url = core.buildUrl("query", "/insights");
    let params: Record<string, unknown> = { bookmark_id: bookmarkId };
    switch (bookmarkType) {
      case "funnels": {
        url = core.buildUrl("query", "/funnels");
        let fromDate = options.from_date ?? null;
        let toDate = options.to_date ?? null;
        if (fromDate === null && toDate === null) {
          const now = civilFromInstantUtc(core.now());
          toDate = formatYmd(now);
          const monthAgo = addDays(now, -30);
          fromDate = formatYmd(monthAgo ?? now);
        } else if (fromDate === null && toDate !== null) {
          const parsedTo = parseYmd(toDate);
          if (parsedTo === null) {
            // Python: `datetime.strptime` raises a BARE ValueError that
            // propagates uncaught (`api_client.py:2960`) — port the same
            // class, CPython's message shape (out of contract, R5.4).
            throw new ValueError(
              `time data '${toDate}' does not match format '%Y-%m-%d'`,
            );
          }
          const derived = addDays(parsedTo, -30);
          fromDate = formatYmd(derived ?? parsedTo);
        } else if (toDate === null && fromDate !== null) {
          const parsedFrom = parseYmd(fromDate);
          if (parsedFrom === null) {
            throw new ValueError(
              `time data '${fromDate}' does not match format '%Y-%m-%d'`,
            );
          }
          const computedTo = addDays(parsedFrom, 30) ?? parsedFrom;
          const now = core.now();
          const nowCivil = civilFromInstantUtc(now);
          // Python: `min(computed_to, datetime.now())` — midnight of the
          // derived date vs the live instant; the CALENDAR comparison is
          // what survives strftime, so compare civil dates.
          toDate = earlierYmd(formatYmd(computedTo), formatYmd(nowCivil));
        }
        params = {
          funnel_id: bookmarkId,
          from_date: fromDate,
          to_date: toDate,
        };

        break;
      }
      case "retention": {
        url = core.buildUrl("query", "/retention");
        params = { bookmark_id: bookmarkId };

        break;
      }
      case "flows": {
        url = core.buildUrl("query", "/arb_funnels");
        params = { bookmark_id: bookmarkId, query_type: "flows_sankey" };

        break;
      }
      case "insights": {
        break;
      }
    }
    return core.requestQueryHost("GET", url, {
      params,
      signal: options.signal,
    });
  };

  return {
    getEvents,

    getEventProperties: async (
      event: string,
      signal?: AbortSignal,
    ): Promise<string[]> => {
      const url = core.buildUrl("query", "/events/properties/top");
      const response = await core.requestQueryHost("GET", url, {
        params: { event },
        signal,
      });
      if (isPlainRecord(response)) {
        return Object.keys(response);
      }
      return [];
    },

    getPropertyValues: async (
      propertyName: string,
      options: GetPropertyValuesOptions = {},
    ): Promise<string[]> => {
      const url = core.buildUrl("query", "/events/properties/values");
      const params: Record<string, unknown> = {
        name: propertyName,
        limit: options.limit ?? 255,
      };
      if (truthyStr(options.event)) {
        params["event"] = options.event;
      }
      const response = await core.requestQueryHost("GET", url, {
        params,
        signal: options.signal,
      });
      if (Array.isArray(response)) {
        return response.map((v) => jsonValuePythonStr(v));
      }
      return [];
    },

    listFunnels: async (signal?: AbortSignal): Promise<JsonValue[]> => {
      const url = core.buildUrl("query", "/funnels/list");
      const response = await core.requestQueryHost("GET", url, { signal });
      return Array.isArray(response) ? response : [];
    },

    listCohorts: async (signal?: AbortSignal): Promise<JsonValue[]> => {
      // POST for a read is unusual but per API spec (`api_client.py:2510`).
      const url = core.buildUrl("query", "/cohorts/list");
      const response = await core.requestQueryHost("POST", url, { signal });
      return Array.isArray(response) ? response : [];
    },

    getTopEvents: async (
      options: GetTopEventsOptions = {},
    ): Promise<JsonValue> => {
      const type = options.type ?? "general";
      const url = core.buildUrl("query", "/events/top");
      const params: Record<string, unknown> = { type };
      if (isSet(options.limit)) {
        params["limit"] = options.limit;
      }
      const response = await core.requestQueryHost("GET", url, {
        params,
        signal: options.signal,
      });
      if (isPlainRecord(response)) {
        return response;
      }
      return { events: [], type };
    },

    eventCounts: async (
      events: readonly string[],
      fromDate: string,
      toDate: string,
      options: EventCountsOptions = {},
    ): Promise<JsonValue> => {
      const url = core.buildUrl("query", "/events");
      const params: Record<string, unknown> = {
        event: pythonJsonDumps(events),
        type: options.type ?? "general",
        unit: options.unit ?? "day",
        from_date: fromDate,
        to_date: toDate,
      };
      return core.requestQueryHost("GET", url, {
        params,
        signal: options.signal,
      });
    },

    propertyCounts: async (
      event: string,
      propertyName: string,
      fromDate: string,
      toDate: string,
      options: PropertyCountsOptions = {},
    ): Promise<JsonValue> => {
      const url = core.buildUrl("query", "/events/properties");
      const params: Record<string, unknown> = {
        event,
        name: propertyName,
        type: options.type ?? "general",
        unit: options.unit ?? "day",
        from_date: fromDate,
        to_date: toDate,
      };
      if (isSet(options.values)) {
        params["values"] = pythonJsonDumps(options.values);
      }
      if (isSet(options.limit)) {
        params["limit"] = options.limit;
      }
      return core.requestQueryHost("GET", url, {
        params,
        signal: options.signal,
      });
    },

    segmentation: async (
      event: string,
      fromDate: string,
      toDate: string,
      options: SegmentationOptions = {},
    ): Promise<JsonValue> => {
      const url = core.buildUrl("query", "/segmentation");
      const params: Record<string, unknown> = {
        event,
        from_date: fromDate,
        to_date: toDate,
        unit: options.unit ?? "day",
        type: options.type ?? "general",
      };
      if (truthyStr(options.on)) {
        params["on"] = options.on;
      }
      if (truthyStr(options.where)) {
        params["where"] = options.where;
      }
      return core.requestQueryHost("GET", url, {
        params,
        signal: options.signal,
      });
    },

    funnel: async (
      funnelId: number,
      fromDate: string,
      toDate: string,
      options: FunnelOptions = {},
    ): Promise<JsonValue> => {
      const url = core.buildUrl("query", "/funnels");
      const params: Record<string, unknown> = {
        funnel_id: funnelId,
        from_date: fromDate,
        to_date: toDate,
      };
      if (truthyStr(options.unit)) {
        params["unit"] = options.unit;
      }
      if (truthyStr(options.on)) {
        params["on"] = options.on;
      }
      if (truthyStr(options.where)) {
        params["where"] = options.where;
      }
      if (isSet(options.length)) {
        params["length"] = options.length;
      }
      if (truthyStr(options.length_unit)) {
        params["length_unit"] = options.length_unit;
      }
      return core.requestQueryHost("GET", url, {
        params,
        signal: options.signal,
      });
    },

    retention: async (
      bornEvent: string,
      event: string,
      fromDate: string,
      toDate: string,
      options: RetentionOptions = {},
    ): Promise<JsonValue> => {
      const interval = options.interval ?? 1;
      const url = core.buildUrl("query", "/retention");
      const params: Record<string, unknown> = {
        born_event: bornEvent,
        event,
        from_date: fromDate,
        to_date: toDate,
        retention_type: options.retention_type ?? "birth",
        interval_count: options.interval_count ?? 8,
      };
      // The API rejects `unit` and `interval` together
      // (`api_client.py:2783-2788`).
      if (interval === 1) {
        params["unit"] = options.unit ?? "day";
      } else {
        params["interval"] = interval;
      }
      if (truthyStr(options.born_where)) {
        params["born_where"] = options.born_where;
      }
      if (truthyStr(options.where)) {
        params["where"] = options.where;
      }
      return core.requestQueryHost("GET", url, {
        params,
        signal: options.signal,
      });
    },

    activityFeed,
    querySavedReport,

    listBookmarks: async (
      bookmarkType?: string | null,
      signal?: AbortSignal,
    ): Promise<JsonValue> => {
      const url = core.buildUrl(
        "app",
        `/projects/${core.projectId()}/bookmarks`,
      );
      const params: Record<string, unknown> = { v: "2" };
      if (isSet(bookmarkType)) {
        params["type"] = bookmarkType;
      }
      return core.requestQueryHost("GET", url, { params, signal });
    },

    insightsQuery: async (
      body: Record<string, unknown>,
      options: InlineQueryOptions = {},
    ): Promise<JsonValue> => {
      const url = core.buildUrl("query", "/insights");
      return core.requestQueryHost("POST", url, {
        params: explicitWorkspaceParams(options.workspace_id),
        data: body,
        injectProjectId: false,
        injectWorkspaceId: options.inject_workspace_id ?? true,
        signal: options.signal,
      });
    },

    querySavedFlows: async (
      bookmarkId: number,
      signal?: AbortSignal,
    ): Promise<JsonValue> => {
      const url = core.buildUrl("query", "/arb_funnels");
      return core.requestQueryHost("GET", url, {
        params: { bookmark_id: bookmarkId, query_type: "flows_sankey" },
        signal,
      });
    },

    arbFunnelsQuery: async (
      body: Record<string, unknown>,
      options: InlineQueryOptions = {},
    ): Promise<JsonValue> => {
      const url = core.buildUrl("query", "/arb_funnels");
      return core.requestQueryHost("POST", url, {
        params: explicitWorkspaceParams(options.workspace_id),
        data: body,
        injectProjectId: false,
        injectWorkspaceId: options.inject_workspace_id ?? true,
        signal: options.signal,
      });
    },

    frequency: async (
      fromDate: string,
      toDate: string,
      unit: string,
      addictionUnit: string,
      options: FrequencyOptions = {},
    ): Promise<JsonValue> => {
      const url = core.buildUrl("query", "/retention/addiction");
      const params: Record<string, unknown> = {
        from_date: fromDate,
        to_date: toDate,
        unit,
        addiction_unit: addictionUnit,
      };
      if (truthyStr(options.event)) {
        params["event"] = options.event;
      }
      if (truthyStr(options.where)) {
        params["where"] = options.where;
      }
      if (truthyStr(options.on)) {
        params["on"] = options.on;
      }
      if (isSet(options.limit)) {
        params["limit"] = options.limit;
      }
      return core.requestQueryHost("GET", url, {
        params,
        signal: options.signal,
      });
    },

    segmentationNumeric: async (
      event: string,
      fromDate: string,
      toDate: string,
      on: string,
      options: SegmentationNumericOptions = {},
    ): Promise<JsonValue> => {
      const url = core.buildUrl("query", "/segmentation/numeric");
      const params: Record<string, unknown> = {
        event,
        from_date: fromDate,
        to_date: toDate,
        on,
        unit: options.unit ?? "day",
        type: options.type ?? "general",
      };
      if (truthyStr(options.where)) {
        params["where"] = options.where;
      }
      return core.requestQueryHost("GET", url, {
        params,
        signal: options.signal,
      });
    },

    segmentationSum: async (
      event: string,
      fromDate: string,
      toDate: string,
      on: string,
      options: SegmentationNumericOptions = {},
    ): Promise<JsonValue> => {
      const url = core.buildUrl("query", "/segmentation/sum");
      const params: Record<string, unknown> = {
        event,
        from_date: fromDate,
        to_date: toDate,
        on,
        unit: options.unit ?? "day",
      };
      if (truthyStr(options.where)) {
        params["where"] = options.where;
      }
      return core.requestQueryHost("GET", url, {
        params,
        signal: options.signal,
      });
    },

    segmentationAverage: async (
      event: string,
      fromDate: string,
      toDate: string,
      on: string,
      options: SegmentationNumericOptions = {},
    ): Promise<JsonValue> => {
      const url = core.buildUrl("query", "/segmentation/average");
      const params: Record<string, unknown> = {
        event,
        from_date: fromDate,
        to_date: toDate,
        on,
        unit: options.unit ?? "day",
      };
      if (truthyStr(options.where)) {
        params["where"] = options.where;
      }
      return core.requestQueryHost("GET", url, {
        params,
        signal: options.signal,
      });
    },
  };
}

/**
 * The earlier of two `YYYY-MM-DD` dates — lexicographic order is calendar
 * order for that shape, so this is a string comparison, never `Math.min`.
 *
 * @param a - One ISO calendar date.
 * @param b - Another ISO calendar date.
 * @returns Whichever is not later.
 */
function earlierYmd(a: string, b: string): string {
  if (a <= b) {
    return a;
  }
  return b;
}
