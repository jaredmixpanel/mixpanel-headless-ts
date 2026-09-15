/**
 * Custom-alert CRUD + operations wire methods (App API) — Phase-3
 * packet B4-C4 port of the `MixpanelAPIClient` alerts range
 * (`api_client.py:6078-6474`).
 *
 * All methods route through B0 `appRequest` over `maybe_scoped_path`
 * (R10.8). `get_alert_history` is the one `_raw=True` consumer in the
 * shard — it re-shapes the raw envelope into
 * `{results, pagination}` per the source's exact branch ladder
 * (`:6352-6371`). Everything else returns the envelope product
 * verbatim after the source's isinstance guard (Caution #11).
 */

import { appRequest } from "../../client/app-request.js";
import type { ClientCore } from "../../client/core.js";
import { isPlainRecord } from "../../client/internals.js";
import type { JsonValue } from "../../client/json-value.js";
import { maybeScopedPath } from "../../client/scope.js";
import { pythonStr } from "../../compat/python-str.js";
import { MixpanelHeadlessError } from "../../errors.js";
import {
  expectListResult,
  expectRecordResult,
  paramsOrNone,
  pythonTypeNameOf,
} from "./shared.js";

/** Options bag of {@link AlertMethods.listAlerts}. */
export interface ListAlertsOptions {
  /** Filter alerts by linked bookmark ID (`is not None` gate). */
  readonly bookmark_id?: number | null | undefined;
  /**
   * If true, list alerts for all users (`is not None` gate — an
   * explicit `false` IS sent, as `"false"`; `str(x).lower()` twin).
   */
  readonly skip_user_filter?: boolean | null | undefined;
  /** Optional cancellation signal (R6.7). */
  readonly signal?: AbortSignal | undefined;
}

/** Options bag of {@link AlertMethods.getAlertCount}. */
export interface GetAlertCountOptions {
  /** Optional filter by alert type (wire param `type`). */
  readonly alert_type?: string | null | undefined;
  /** Optional cancellation signal (R6.7). */
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
  /** Optional cancellation signal (R6.7). */
  readonly signal?: AbortSignal | undefined;
}

/** The C4 alert method surface (mixed into `MixpanelClient`). */
export interface AlertMethods {
  /**
   * List custom alerts (`list_alerts`, `api_client.py:6078-6120` —
   * GET `alerts/custom/`).
   *
   * @param options - bookmark_id/skip_user_filter filters + signal.
   * @returns The alert list verbatim.
   * @throws MixpanelHeadlessError - Non-list response.
   * @throws AuthenticationError | RateLimitError | QueryError |
   *   ServerError - Per the B0 `appRequest` contract.
   */
  listAlerts: (options?: ListAlertsOptions) => Promise<JsonValue[]>;

  /**
   * Create a custom alert (`create_alert`, `:6122-6153` — POST
   * `alerts/custom/`).
   *
   * @param body - Alert creation parameters.
   * @param signal - Optional cancellation signal.
   * @returns The created alert dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  createAlert: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Get a custom alert by ID (`get_alert`, `:6155-6186`).
   *
   * @param alertId - Alert ID (integer).
   * @param signal - Optional cancellation signal.
   * @returns The alert dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  getAlert: (
    alertId: number,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Update a custom alert (`update_alert`, `:6188-6220` — PATCH).
   *
   * @param alertId - Alert ID (integer).
   * @param body - Fields to update.
   * @param signal - Optional cancellation signal.
   * @returns The updated alert dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  updateAlert: (
    alertId: number,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Delete a custom alert (`delete_alert`, `:6222-6244`).
   *
   * @param alertId - Alert ID (integer).
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   */
  deleteAlert: (alertId: number, signal?: AbortSignal) => Promise<void>;

  /**
   * Bulk-delete custom alerts (`bulk_delete_alerts`, `:6246-6268` —
   * POST `alerts/custom/bulk-delete/` with `{alert_ids}`).
   *
   * @param ids - Alert IDs to delete.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   */
  bulkDeleteAlerts: (
    ids: readonly number[],
    signal?: AbortSignal,
  ) => Promise<void>;

  /**
   * Get alert count and limits (`get_alert_count`, `:6270-6304` — GET
   * `alerts/custom/alert-count/`).
   *
   * @param options - alert_type filter + signal.
   * @returns The count dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  getAlertCount: (
    options?: GetAlertCountOptions,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Get alert trigger history (`get_alert_history`, `:6306-6371` —
   * GET `alerts/custom/{id}/history/` with `_raw=True`, then the
   * source's exact `{results, pagination}` re-shape ladder).
   *
   * @param alertId - Alert ID (integer).
   * @param options - page_size/cursor params + signal.
   * @returns A dict with `results` list and `pagination` metadata.
   * @throws MixpanelHeadlessError - Missing/malformed `results` shape.
   */
  getAlertHistory: (
    alertId: number,
    options?: GetAlertHistoryOptions,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Send a test alert notification (`test_alert`, `:6373-6404` — POST
   * `alerts/custom/test/`).
   *
   * @param body - Alert parameters for the test.
   * @param signal - Optional cancellation signal.
   * @returns The test result dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  testAlert: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Get a signed screenshot URL (`get_alert_screenshot_url`,
   * `:6406-6437` — GET `alerts/custom/screenshot/` with the
   * ALWAYS-present `gcs_key` param).
   *
   * @param gcsKey - GCS object key for the screenshot.
   * @param signal - Optional cancellation signal.
   * @returns The dict with `signed_url`.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  getAlertScreenshotUrl: (
    gcsKey: string,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Validate alerts against a bookmark
   * (`validate_alerts_for_bookmark`, `:6439-6474` — POST
   * `alerts/custom/validate-alerts-for-bookmark/`).
   *
   * @param body - Validation parameters.
   * @param signal - Optional cancellation signal.
   * @returns The validation result dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  validateAlertsForBookmark: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;
}

/**
 * Build the C4 alert methods over the C1 core seam.
 *
 * @param core - The shared client internals seam.
 * @returns The method bag.
 */
export function createAlertMethods(core: ClientCore): AlertMethods {
  /** `self.maybe_scoped_path(...)` over the CURRENT pin (call-time). */
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
        // `str(skip_user_filter).lower()` — `str(True)` is `"True"`
        // (R11.7: pythonStr, never String(...)).
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
      // The source's exact branch ladder (`api_client.py:6352-6371`).
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
