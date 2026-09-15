/**
 * Drop-filter wire methods on the App API
 * (`data-definitions/events/drop-filters/`, workspace-scoped through
 * `maybe_scoped_path`). Create, update and delete return the full
 * post-mutation filter list, not the mutated entity; the port hands back
 * exactly what `appRequest` unwraps.
 *
 * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.list_drop_filters
 */

import { appRequest } from "../../client/app-request.js";
import type { ClientCore } from "../../client/core.js";
import type { JsonValue } from "../../client/json-value.js";
import { maybeScopedPath } from "../../client/scope.js";
import { expectListResult, expectRecordResult } from "./shared.js";

/** Drop-filter methods mixed into `MixpanelClient`. */
export interface DropFilterMethods {
  /**
   * List drop filters (`list_drop_filters` — GET
   * `data-definitions/events/drop-filters/`).
   *
   * @param signal - Optional cancellation signal.
   * @returns The filter list verbatim.
   * @throws MixpanelHeadlessError - Non-list response.
   */
  listDropFilters: (signal?: AbortSignal) => Promise<JsonValue[]>;

  /**
   * Create a drop filter (`create_drop_filter` — POST;
   * returns the full post-creation list).
   *
   * @param body - Drop-filter creation parameters.
   * @param signal - Optional cancellation signal.
   * @returns All drop filters after creation.
   * @throws MixpanelHeadlessError - Non-list response.
   */
  createDropFilter: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<JsonValue[]>;

  /**
   * Update a drop filter (`update_drop_filter` — PATCH;
   * returns the full post-update list).
   *
   * @param body - Drop-filter update parameters (id, filters, ...).
   * @param signal - Optional cancellation signal.
   * @returns All drop filters after the update.
   * @throws MixpanelHeadlessError - Non-list response.
   */
  updateDropFilter: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<JsonValue[]>;

  /**
   * Delete a drop filter by ID (`delete_drop_filter` —
   * DELETE with JSON body `{id}`; returns the full post-delete list).
   *
   * @param dropFilterId - ID of the drop filter to delete.
   * @param signal - Optional cancellation signal.
   * @returns All drop filters after deletion.
   * @throws MixpanelHeadlessError - Non-list response.
   */
  deleteDropFilter: (
    dropFilterId: number,
    signal?: AbortSignal,
  ) => Promise<JsonValue[]>;

  /**
   * Get drop-filter usage limits (`get_drop_filter_limits` — GET
   * `.../drop-filters/limits/`).
   *
   * @param signal - Optional cancellation signal.
   * @returns The limits dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  getDropFilterLimits: (
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;
}

/**
 * Build the drop-filter methods over the shared client core.
 *
 * @param core - The shared client internals seam.
 * @returns The method bag.
 */
export function createDropFilterMethods(core: ClientCore): DropFilterMethods {
  /** `maybe_scoped_path` over the pin current at call time. */
  const scopedPath = (domainPath: string): string =>
    maybeScopedPath(domainPath, {
      projectId: core.projectId(),
      workspaceId: core.workspaceId(),
    });

  return {
    listDropFilters: async (signal?: AbortSignal): Promise<JsonValue[]> => {
      const path = scopedPath("data-definitions/events/drop-filters/");
      const result = await appRequest(core.appDeps(signal), "GET", path);
      return expectListResult(result, "list_drop_filters");
    },

    createDropFilter: async (
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<JsonValue[]> => {
      const path = scopedPath("data-definitions/events/drop-filters/");
      const result = await appRequest(core.appDeps(signal), "POST", path, {
        jsonBody: body,
      });
      return expectListResult(result, "create_drop_filter");
    },

    updateDropFilter: async (
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<JsonValue[]> => {
      const path = scopedPath("data-definitions/events/drop-filters/");
      const result = await appRequest(core.appDeps(signal), "PATCH", path, {
        jsonBody: body,
      });
      return expectListResult(result, "update_drop_filter");
    },

    deleteDropFilter: async (
      dropFilterId: number,
      signal?: AbortSignal,
    ): Promise<JsonValue[]> => {
      const path = scopedPath("data-definitions/events/drop-filters/");
      const result = await appRequest(core.appDeps(signal), "DELETE", path, {
        jsonBody: { id: dropFilterId },
      });
      return expectListResult(result, "delete_drop_filter");
    },

    getDropFilterLimits: async (
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath("data-definitions/events/drop-filters/limits/");
      const result = await appRequest(core.appDeps(signal), "GET", path);
      return expectRecordResult(result, "get_drop_filter_limits");
    },
  };
}
