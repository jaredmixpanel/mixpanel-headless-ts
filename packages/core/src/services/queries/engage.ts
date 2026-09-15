/**
 * Engage wire methods: `engageStats` and `exportProfilesPage`, the two
 * `/engage` POSTs outside the streaming export. Both go through
 * `core.requestQueryHost` (the `_request` twin), which owns project-id
 * and workspace-pin injection, retries and `query_origin`; nothing here
 * re-derives them.
 *
 * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.engage_stats
 */

import type { ClientCore } from "../../client/core.js";
import { isPlainRecord, jsonValuePythonStr } from "../../client/internals.js";
import { JsonNumber, type JsonValue } from "../../client/json-value.js";
import { pythonJsonDumps } from "../../compat/index.js";
import { QueryError } from "../../errors.js";
import { ProfilePageResult } from "../../types/results/discovery.js";
import { isSet, pythonTypeNameOf, truthyList, truthyStr } from "../shared.js";

/** Options bag of {@link EngageMethods.engageStats}. */
export interface EngageStatsOptions {
  /** Filter expression (sent as `selector`). */
  readonly where?: string | null | undefined;
  /** Aggregation expression (default `"count()"`). */
  readonly action?: string | undefined;
  /** Pre-encoded JSON cohort filter string. */
  readonly filter_by_cohort?: string | null | undefined;
  /** Cohort-id → include/exclude map (JSON-encoded on the wire). */
  readonly segment_by_cohorts?:
    Readonly<Record<string, boolean>> | null | undefined;
  /** Group analytics group identifier. */
  readonly group_id?: string | null | undefined;
  /** Unix timestamp for point-in-time query. */
  readonly as_of_timestamp?: number | null | undefined;
  /** Include non-members in cohort results. */
  readonly include_all_users?: boolean | undefined;
  /** Optional cancellation signal. */
  readonly signal?: AbortSignal | undefined;
}

/** Options bag of {@link EngageMethods.exportProfilesPage}. */
export interface ExportProfilesPageOptions {
  /** Session ID from the previous page. */
  readonly session_id?: string | null | undefined;
  /** Filter expression. */
  readonly where?: string | null | undefined;
  /** Cohort ID filter (loses to `filter_by_cohort`). */
  readonly cohort_id?: string | null | undefined;
  /** Properties to include. */
  readonly output_properties?: readonly string[] | null | undefined;
  /** Group analytics group identifier. */
  readonly group_id?: string | null | undefined;
  /** Behavioral filter definitions. */
  readonly behaviors?:
    ReadonlyArray<Record<string, unknown>> | null | undefined;
  /** Unix timestamp for point-in-time query. */
  readonly as_of_timestamp?: number | null | undefined;
  /** Include non-members in cohort results. */
  readonly include_all_users?: boolean | undefined;
  /** Sort expression in selector format. */
  readonly sort_key?: string | null | undefined;
  /** Sort direction — "ascending" or "descending". */
  readonly sort_order?: string | null | undefined;
  /** Full-text search string. */
  readonly search?: string | null | undefined;
  /** Server-side result cap per page. */
  readonly limit?: number | null | undefined;
  /** Pre-encoded JSON cohort filter (wins over `cohort_id`). */
  readonly filter_by_cohort?: string | null | undefined;
  /** Single user ID to fetch. */
  readonly distinct_id?: string | null | undefined;
  /** List of user IDs to fetch. */
  readonly distinct_ids?: readonly string[] | null | undefined;
  /** Optional cancellation signal. */
  readonly signal?: AbortSignal | undefined;
}

/** The engage method surface (mixed into `MixpanelClient`). */
export interface EngageMethods {
  /**
   * Aggregate statistics from the Engage API (`MixpanelAPIClient.engage_stats`).
   *
   * @param options - where/action/cohort/segment/group/timestamp knobs.
   * @returns The raw response dict.
   * @throws QueryError - Non-dict 200 response (`status_code: 200` with
   *   the Python `str()` of the body), or API rejections.
   * @throws AuthenticationError | RateLimitError - Per the retry core.
   */
  engageStats: (options?: EngageStatsOptions) => Promise<JsonValue>;

  /**
   * Fetch a single page of profiles (`MixpanelAPIClient.export_profiles_page`).
   *
   * @param page - Zero-based page index.
   * @param options - session/filter/sort/search/limit knobs.
   * @returns The page result (profiles + pagination metadata).
   * @throws AuthenticationError | RateLimitError | QueryError |
   *   ServerError - Per the retry core.
   */
  exportProfilesPage: (
    page: number,
    options?: ExportProfilesPageOptions,
  ) => Promise<ProfilePageResult>;
}

/**
 * `dict.get(key, default)` over a parsed wire body.
 *
 * @param body - The parsed record.
 * @param key - Key to read.
 * @param fallback - Returned when the key is absent.
 * @returns The stored value (a present `null` stays `null`).
 */
function bodyGet(
  body: Readonly<Record<string, JsonValue>>,
  key: string,
  fallback: JsonValue,
): JsonValue {
  return Object.hasOwn(body, key) ? (body[key] as JsonValue) : fallback;
}

/**
 * Coerce a parsed wire number (native or lossless token) to a JS
 * number for the `ProfilePageResult` int fields. Integer tokens within
 * the safe range convert exactly (real Mixpanel totals/page sizes).
 *
 * @param value - The parsed value.
 * @returns The numeric value (non-numeric bodies pass through as-is,
 *   exactly like Python's untyped `response.get`).
 */
function toCount(value: JsonValue): number {
  if (value instanceof JsonNumber) {
    return value.toNumber();
  }
  return value as number;
}

/**
 * Build the engage methods over the shared client core.
 *
 * @param core - The shared client internals seam.
 * @returns The method bag.
 */
// eslint-disable-next-line max-lines-per-function -- branch-for-branch port of one Python function (see the docblock); splitting it would scatter the guard order the corpus pins
export function createEngageMethods(core: ClientCore): EngageMethods {
  return {
    engageStats: async (
      options: EngageStatsOptions = {},
    ): Promise<JsonValue> => {
      const url = core.buildUrl("engage", "stats");
      const params: Record<string, unknown> = {
        project_id: core.projectId(),
        action: options.action ?? "count()",
      };
      if (truthyStr(options.where)) {
        // The stats endpoint accepts "selector", not "where".
        params["selector"] = options.where;
      }
      if (truthyStr(options.filter_by_cohort)) {
        params["filter_by_cohort"] = options.filter_by_cohort;
      }
      if (isSet(options.segment_by_cohorts)) {
        params["segment_by_cohorts"] = pythonJsonDumps(
          options.segment_by_cohorts,
        );
      }
      if (truthyStr(options.group_id)) {
        params["data_group_id"] = options.group_id;
      }
      if (isSet(options.as_of_timestamp)) {
        params["as_of_timestamp"] = options.as_of_timestamp;
      }
      if (truthyStr(options.filter_by_cohort)) {
        // Sent explicitly because the API defaults to True.
        params["include_all_users"] = options.include_all_users ?? false;
      }
      const response = await core.requestQueryHost("POST", url, {
        data: params,
        signal: options.signal,
      });
      if (!isPlainRecord(response)) {
        throw new QueryError(
          `engage_stats returned unexpected response type ` +
            `${pythonTypeNameOf(response)}: ${jsonValuePythonStr(response)}`,
          {
            statusCode: 200,
            responseBody: jsonValuePythonStr(response),
          },
        );
      }
      return response;
    },

    exportProfilesPage: async (
      page: number,
      options: ExportProfilesPageOptions = {},
    ): Promise<ProfilePageResult> => {
      const url = core.buildUrl("engage", "");
      const params: Record<string, unknown> = {
        project_id: core.projectId(),
        page,
      };
      if (truthyStr(options.session_id)) {
        params["session_id"] = options.session_id;
      }
      if (truthyStr(options.where)) {
        params["where"] = options.where;
      }
      // filter_by_cohort takes precedence over cohort_id.
      if (truthyStr(options.filter_by_cohort)) {
        params["filter_by_cohort"] = options.filter_by_cohort;
      } else if (truthyStr(options.cohort_id)) {
        params["filter_by_cohort"] = pythonJsonDumps({
          id: options.cohort_id,
        });
      }
      if (truthyList(options.output_properties)) {
        params["output_properties"] = pythonJsonDumps(
          options.output_properties,
        );
      }
      if (truthyStr(options.group_id)) {
        params["data_group_id"] = options.group_id;
      }
      if (truthyList(options.behaviors)) {
        params["behaviors"] = pythonJsonDumps(options.behaviors);
      }
      if (isSet(options.as_of_timestamp)) {
        params["as_of_timestamp"] = options.as_of_timestamp;
      }
      // Sent when either cohort filter is set.
      if (truthyStr(options.cohort_id) || truthyStr(options.filter_by_cohort)) {
        params["include_all_users"] = options.include_all_users ?? false;
      }
      if (truthyStr(options.sort_key)) {
        params["sort_key"] = options.sort_key;
      }
      if (truthyStr(options.sort_order)) {
        params["sort_order"] = options.sort_order;
      }
      if (truthyStr(options.search)) {
        params["search"] = options.search;
      }
      if (isSet(options.limit)) {
        params["limit"] = options.limit;
      }
      if (truthyStr(options.distinct_id)) {
        params["distinct_id"] = options.distinct_id;
      }
      if (truthyList(options.distinct_ids)) {
        params["distinct_ids"] = pythonJsonDumps(options.distinct_ids);
      }
      const response = await core.requestQueryHost("POST", url, {
        data: params,
        signal: options.signal,
      });
      if (!isPlainRecord(response)) {
        // Python `response.get(...)` on a non-dict raises AttributeError;
        // the closest JS class stands in (no recorded vector reaches
        // this arm).
        throw new TypeError(
          `'${pythonTypeNameOf(response)}' object has no attribute 'get'`,
        );
      }
      const profiles = bodyGet(response, "results", []);
      const returnedSessionId = bodyGet(response, "session_id", null);
      const hasMore = returnedSessionId !== null;
      const total = bodyGet(response, "total", 0);
      const pageSize = bodyGet(response, "page_size", 1000);
      return new ProfilePageResult({
        profiles: profiles as ReadonlyArray<Readonly<Record<string, unknown>>>,
        session_id: returnedSessionId as string | null,
        page,
        has_more: hasMore,
        total: toCount(total),
        page_size: toCount(pageSize),
      });
    },
  };
}
