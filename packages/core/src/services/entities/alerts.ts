/**
 * Custom-alert CRUD and operations wire methods on the App API
 * (`alerts/custom/`, workspace-scoped through `maybe_scoped_path`).
 * `get_alert_history` is the one raw-envelope call and re-shapes the
 * envelope into `{results, pagination}` with Python's exact branch
 * ladder; everything else returns the envelope product verbatim after
 * Python's isinstance guard.
 *
 * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.list_alerts
 */

import { appRequest } from "../../client/app-request.js";
import type { ClientCore } from "../../client/core.js";
import { isPlainRecord } from "../../client/internals.js";
import type { JsonValue } from "../../client/json-value.js";
import { maybeScopedPath } from "../../client/scope.js";
import { pythonStr } from "../../compat/python-str.js";
import { MixpanelHeadlessError } from "../../errors.js";
import { pythonTypeNameOf } from "../shared.js";
import {
  expectListResult,
  expectRecordResult,
  paramsOrNone,
} from "./shared.js";

/** Options bag of {@link AlertMethods.listAlerts}. */
export interface ListAlertsOptions {
  /** Filter alerts by linked bookmark ID (`is not None` gate). */
  readonly bookmark_id?: number | null | undefined;
  /**
   * If true, list alerts for all users (`is not None` gate — an
   * explicit `false` is sent, as `"false"`; `str(x).lower()` twin).
   */
  readonly skip_user_filter?: boolean | null | undefined;
  /** Optional cancellation signal. */
  readonly signal?: AbortSignal | undefined;
}

/** Options bag of {@link AlertMethods.getAlertCount}. */
export interface GetAlertCountOptions {
  /** Optional filter by alert type (wire param `type`). */
  readonly alert_type?: string | null | undefined;
  /** Optional cancellation signal. */
  readonly signal?: AbortSignal | undefined;
}

/** Options bag of {@link AlertMethods.getAlertHistory}. */
export interface GetAlertHistoryOptions {
  /** Number of results per page (`str(page_size)` on the wire). */
  readonly page_size?: number | null | undefined;
  /** Cursor for the next page. */
  readonly next_cursor?: string | null | undefined;
  /** Cursor for the previous page. */
  readonly previous_cursor?: string | null | undefined;
  /** Optional cancellation signal. */
  readonly signal?: AbortSignal | undefined;
}

/** Alert methods mixed into `MixpanelClient`. */
export interface AlertMethods {
  /**
   * List custom alerts. Sends GET `alerts/custom/`.
   *
   * @param options - bookmark_id/skip_user_filter filters + signal.
   * @returns The alert list verbatim.
   * @throws {@link MixpanelHeadlessError} - Non-list response.
   * @throws {@link AuthenticationError} - Invalid or expired credentials (401).
   * @throws {@link RateLimitError} - Rate limit still exceeded after the retries
   *   (429).
   * @throws {@link QueryError} - Other 4xx responses (400/403/404/422).
   * @throws {@link ServerError} - Server-side errors (5xx).
   * @internal
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.list_alerts
   */
  listAlerts: (options?: ListAlertsOptions) => Promise<JsonValue[]>;

  /**
   * Create a custom alert. Sends POST `alerts/custom/`.
   *
   * @param body - Alert creation parameters.
   * @param signal - Optional cancellation signal.
   * @returns The created alert dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.create_alert
   */
  createAlert: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Get a custom alert by ID.
   *
   * @param alertId - Alert ID (integer).
   * @param signal - Optional cancellation signal.
   * @returns The alert dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.get_alert
   */
  getAlert: (
    alertId: number,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Update a custom alert. Sends a PATCH.
   *
   * @param alertId - Alert ID (integer).
   * @param body - Fields to update.
   * @param signal - Optional cancellation signal.
   * @returns The updated alert dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.update_alert
   */
  updateAlert: (
    alertId: number,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Delete a custom alert.
   *
   * @param alertId - Alert ID (integer).
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.delete_alert
   */
  deleteAlert: (alertId: number, signal?: AbortSignal) => Promise<void>;

  /**
   * Bulk-delete custom alerts. Sends POST `alerts/custom/bulk-delete/` with
   * `{alert_ids}`.
   *
   * @param ids - Alert IDs to delete.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.bulk_delete_alerts
   */
  bulkDeleteAlerts: (
    ids: readonly number[],
    signal?: AbortSignal,
  ) => Promise<void>;

  /**
   * Get alert count and limits. Sends GET `alerts/custom/alert-count/`.
   *
   * @param options - alert_type filter + signal.
   * @returns The count dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @internal
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.get_alert_count
   */
  getAlertCount: (
    options?: GetAlertCountOptions,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Get alert trigger history. Sends GET `alerts/custom/{id}/history/` with
   * `_raw=True`, then the source's exact `{results, pagination}` re-shape ladder.
   *
   * @param alertId - Alert ID (integer).
   * @param options - page_size/cursor params + signal.
   * @returns A dict with `results` list and `pagination` metadata.
   * @throws {@link MixpanelHeadlessError} - Missing/malformed `results` shape.
   * @internal
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.get_alert_history
   */
  getAlertHistory: (
    alertId: number,
    options?: GetAlertHistoryOptions,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Send a test alert notification. Sends POST `alerts/custom/test/`.
   *
   * @param body - Alert parameters for the test.
   * @param signal - Optional cancellation signal.
   * @returns The test result dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.test_alert
   */
  testAlert: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Get a signed screenshot URL. Sends GET `alerts/custom/screenshot/` with the
   * always-present `gcs_key` param.
   *
   * @param gcsKey - GCS object key for the screenshot.
   * @param signal - Optional cancellation signal.
   * @returns The dict with `signed_url`.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.get_alert_screenshot_url
   */
  getAlertScreenshotUrl: (
    gcsKey: string,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Validate alerts against a bookmark. Sends POST
   * `alerts/custom/validate-alerts-for-bookmark/`.
   *
   * @param body - Validation parameters.
   * @param signal - Optional cancellation signal.
   * @returns The validation result dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.validate_alerts_for_bookmark
   */
  validateAlertsForBookmark: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;
}

/**
 * Build the alert methods over the shared client core.
 *
 * @param core - The shared client internals seam.
 * @returns The method bag.
 * @example
 * ```typescript
 * const alerts = createAlertMethods(core);
 * const open = await alerts.listAlerts({ skip_user_filter: true });
 * // [{ id: 42, name: "Signups dropped", ... }, ...]
 * ```
 */
// eslint-disable-next-line max-lines-per-function -- branch-for-branch port of one Python function (see the docblock); splitting it would scatter the guard order the corpus pins
export function createAlertMethods(core: ClientCore): AlertMethods {
  /**
   * Scope a domain path to the project and the workspace pinned at call
   * time.
   *
   * @param domainPath - Path relative to the domain root.
   * @returns The `/projects/{pid}[/workspaces/{wid}]/{domainPath}` path.
   */
  const scopedPath = (domainPath: string): string =>
    maybeScopedPath(domainPath, {
      projectId: core.projectId(),
      workspaceId: core.workspaceId(),
    });

  return {
    listAlerts: async (
      options: ListAlertsOptions = {},
    ): Promise<JsonValue[]> => {
      const path = scopedPath("alerts/custom/");
      const params: Record<string, string> = {};
      if (options.bookmark_id !== undefined && options.bookmark_id !== null) {
        params["bookmark_id"] = pythonStr(options.bookmark_id);
      }
      if (
        options.skip_user_filter !== undefined &&
        options.skip_user_filter !== null
      ) {
        // `str(skip_user_filter).lower()` — `str(True)` is `"True"`, so
        // `pythonStr`, never `String(...)`.
        params["skip_user_filter"] = pythonStr(
          options.skip_user_filter,
        ).toLowerCase();
      }
      const result = await appRequest(
        core.appDeps(options.signal),
        "GET",
        path,
        { params: paramsOrNone(params) },
      );
      return expectListResult(result, "list_alerts");
    },

    createAlert: async (
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath("alerts/custom/");
      const result = await appRequest(core.appDeps(signal), "POST", path, {
        jsonBody: body,
      });
      return expectRecordResult(result, "create_alert");
    },

    getAlert: async (
      alertId: number,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath(`alerts/custom/${alertId}/`);
      const result = await appRequest(core.appDeps(signal), "GET", path);
      return expectRecordResult(result, "get_alert");
    },

    updateAlert: async (
      alertId: number,
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath(`alerts/custom/${alertId}/`);
      const result = await appRequest(core.appDeps(signal), "PATCH", path, {
        jsonBody: body,
      });
      return expectRecordResult(result, "update_alert");
    },

    deleteAlert: async (
      alertId: number,
      signal?: AbortSignal,
    ): Promise<void> => {
      const path = scopedPath(`alerts/custom/${alertId}/`);
      await appRequest(core.appDeps(signal), "DELETE", path);
    },

    bulkDeleteAlerts: async (
      ids: readonly number[],
      signal?: AbortSignal,
    ): Promise<void> => {
      const path = scopedPath("alerts/custom/bulk-delete/");
      await appRequest(core.appDeps(signal), "POST", path, {
        jsonBody: { alert_ids: ids },
      });
    },

    getAlertCount: async (
      options: GetAlertCountOptions = {},
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath("alerts/custom/alert-count/");
      const params: Record<string, string> = {};
      if (options.alert_type !== undefined && options.alert_type !== null) {
        params["type"] = options.alert_type;
      }
      const result = await appRequest(
        core.appDeps(options.signal),
        "GET",
        path,
        { params: paramsOrNone(params) },
      );
      return expectRecordResult(result, "get_alert_count");
    },

    getAlertHistory: async (
      alertId: number,
      options: GetAlertHistoryOptions = {},
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath(`alerts/custom/${alertId}/history/`);
      const params: Record<string, string> = {};
      if (options.page_size !== undefined && options.page_size !== null) {
        params["page_size"] = pythonStr(options.page_size);
      }
      if (options.next_cursor !== undefined && options.next_cursor !== null) {
        params["next_cursor"] = options.next_cursor;
      }
      if (
        options.previous_cursor !== undefined &&
        options.previous_cursor !== null
      ) {
        params["previous_cursor"] = options.previous_cursor;
      }
      const result = await appRequest(
        core.appDeps(options.signal),
        "GET",
        path,
        { params: paramsOrNone(params), raw: true },
      );
      // Python's exact branch ladder.
      if (isPlainRecord(result)) {
        if (!Object.hasOwn(result, "results")) {
          throw new MixpanelHeadlessError(
            "Unexpected response from get_alert_history: " +
              "dict missing 'results' key",
          );
        }
        const inner = result["results"] as JsonValue;
        if (isPlainRecord(inner) && Object.hasOwn(inner, "results")) {
          if (!Object.hasOwn(inner, "pagination")) {
            inner["pagination"] = null;
          }
          return inner;
        }
        if (Array.isArray(inner)) {
          return { results: inner, pagination: null };
        }
      } else if (Array.isArray(result)) {
        return { results: result, pagination: null };
      }
      throw new MixpanelHeadlessError(
        `Unexpected response from get_alert_history: ` +
          `got ${pythonTypeNameOf(result)} without results list`,
      );
    },

    testAlert: async (
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath("alerts/custom/test/");
      const result = await appRequest(core.appDeps(signal), "POST", path, {
        jsonBody: body,
      });
      return expectRecordResult(result, "test_alert");
    },

    getAlertScreenshotUrl: async (
      gcsKey: string,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath("alerts/custom/screenshot/");
      const result = await appRequest(core.appDeps(signal), "GET", path, {
        params: { gcs_key: gcsKey },
      });
      return expectRecordResult(result, "get_alert_screenshot_url");
    },

    validateAlertsForBookmark: async (
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath("alerts/custom/validate-alerts-for-bookmark/");
      const result = await appRequest(core.appDeps(signal), "POST", path, {
        jsonBody: body,
      });
      return expectRecordResult(result, "validate_alerts_for_bookmark");
    },
  };
}
