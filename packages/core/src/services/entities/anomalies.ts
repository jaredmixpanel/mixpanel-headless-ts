/**
 * Data-volume-anomaly wire methods on the App API
 * (`data-definitions/data-volume-anomalies/`, workspace-scoped through
 * `maybe_scoped_path`). The list call is a raw-envelope request that
 * digs `results.anomalies` out with Python's exact fall-through ladder;
 * the two updates are plain PATCH dict-returns.
 *
 * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.list_data_volume_anomalies
 */

import { appRequest } from "../../client/app-request.js";
import type { ClientCore } from "../../client/core.js";
import { isPlainRecord } from "../../client/internals.js";
import type { JsonValue } from "../../client/json-value.js";
import { maybeScopedPath } from "../../client/scope.js";
import { MixpanelHeadlessError } from "../../errors.js";
import { expectRecordResult } from "./shared.js";

/** Options bag of {@link AnomalyMethods.listDataVolumeAnomalies}. */
export interface ListDataVolumeAnomaliesOptions {
  /** Optional filters (status, limit, event_id, ...). */
  readonly query_params?: Record<string, string> | null | undefined;
  /** Optional cancellation signal. */
  readonly signal?: AbortSignal | undefined;
}

/** Anomaly methods mixed into `MixpanelClient`. */
export interface AnomalyMethods {
  /**
   * List data-volume anomalies. Sends GET
   * `data-definitions/data-volume-anomalies/` with `_raw=True`; extracts
   * `results.anomalies`.
   *
   * @param options - Optional `query_params` filters + signal.
   * @returns The anomaly list.
   * @throws {@link MixpanelHeadlessError} - Missing `anomalies` key ("missing
   *   'anomalies' key in results") or an unexpected format.
   * @internal
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.list_data_volume_anomalies
   */
  listDataVolumeAnomalies: (
    options?: ListDataVolumeAnomaliesOptions,
  ) => Promise<JsonValue[]>;

  /**
   * Update one anomaly's status. Sends a PATCH.
   *
   * @param body - Update payload (id, status, anomalyClass).
   * @param signal - Optional cancellation signal.
   * @returns The raw response dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.update_anomaly
   */
  updateAnomaly: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Bulk-update anomaly statuses. Sends PATCH `.../data-volume-anomalies/bulk/`.
   *
   * @param body - Bulk update payload.
   * @param signal - Optional cancellation signal.
   * @returns The raw response dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.bulk_update_anomalies
   */
  bulkUpdateAnomalies: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;
}

/**
 * Build the anomaly methods over the shared client core.
 *
 * @param core - The shared client internals seam.
 * @returns The method bag.
 * @example
 * ```typescript
 * const anomalies = createAnomalyMethods(core);
 * const open = await anomalies.listDataVolumeAnomalies({ query_params: { status: "open" } });
 * // [{ id: 3, event_id: 12, status: "open", ... }, ...]
 * ```
 */
export function createAnomalyMethods(core: ClientCore): AnomalyMethods {
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
    listDataVolumeAnomalies: async (
      options: ListDataVolumeAnomaliesOptions = {},
    ): Promise<JsonValue[]> => {
      const path = scopedPath("data-definitions/data-volume-anomalies/");
      const result = await appRequest(
        core.appDeps(options.signal),
        "GET",
        path,
        {
          params: options.query_params ?? null,
          raw: true,
        },
      );
      // Response: {"status":"ok","results":{"anomalies":[...]}} — the
      // ladder mirrors Python branch for branch.
      if (isPlainRecord(result)) {
        const results = Object.hasOwn(result, "results")
          ? (result["results"] as JsonValue)
          : result;
        if (isPlainRecord(results)) {
          if (!Object.hasOwn(results, "anomalies")) {
            throw new MixpanelHeadlessError(
              "Unexpected response from list_data_volume_anomalies: " +
                "missing 'anomalies' key in results",
            );
          }
          const anomalies = results["anomalies"] as JsonValue;
          if (Array.isArray(anomalies)) {
            return anomalies;
          }
        }
      }
      throw new MixpanelHeadlessError(
        "Unexpected response format from list_data_volume_anomalies",
      );
    },

    updateAnomaly: async (
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath("data-definitions/data-volume-anomalies/");
      const result = await appRequest(core.appDeps(signal), "PATCH", path, {
        jsonBody: body,
      });
      return expectRecordResult(result, "update_anomaly");
    },

    bulkUpdateAnomalies: async (
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath("data-definitions/data-volume-anomalies/bulk/");
      const result = await appRequest(core.appDeps(signal), "PATCH", path, {
        jsonBody: body,
      });
      return expectRecordResult(result, "bulk_update_anomalies");
    },
  };
}
