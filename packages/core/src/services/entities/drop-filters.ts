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
   * List drop filters. Sends GET `data-definitions/events/drop-filters/`.
   *
   * @param signal - Optional cancellation signal.
   * @returns The filter list verbatim.
   * @throws {@link MixpanelHeadlessError} - Non-list response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.list_drop_filters
   */
  listDropFilters: (signal?: AbortSignal) => Promise<JsonValue[]>;

  /**
   * Create a drop filter. Sends POST; returns the full post-creation list.
   *
   * @param body - Drop-filter creation parameters.
   * @param signal - Optional cancellation signal.
   * @returns All drop filters after creation.
   * @throws {@link MixpanelHeadlessError} - Non-list response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.create_drop_filter
   */
  createDropFilter: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<JsonValue[]>;

  /**
   * Update a drop filter. Sends PATCH; returns the full post-update list.
   *
   * @param body - Drop-filter update parameters (id, filters, ...).
   * @param signal - Optional cancellation signal.
   * @returns All drop filters after the update.
   * @throws {@link MixpanelHeadlessError} - Non-list response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.update_drop_filter
   */
  updateDropFilter: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<JsonValue[]>;

  /**
   * Delete a drop filter by ID. Sends DELETE with JSON body `{id}`; returns the
   * full post-delete list.
   *
   * @param dropFilterId - ID of the drop filter to delete.
   * @param signal - Optional cancellation signal.
   * @returns All drop filters after deletion.
   * @throws {@link MixpanelHeadlessError} - Non-list response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.delete_drop_filter
   */
  deleteDropFilter: (
    dropFilterId: number,
    signal?: AbortSignal,
  ) => Promise<JsonValue[]>;

  /**
   * Get drop-filter usage limits. Sends GET `.../drop-filters/limits/`.
   *
   * @param signal - Optional cancellation signal.
   * @returns The limits dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.get_drop_filter_limits
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
 * @example
 * ```typescript
 * const dropFilters = createDropFilterMethods(core);
 * const all = await dropFilters.deleteDropFilter(5);
 * // the remaining drop filters
 * ```
 */
export function createDropFilterMethods(core: ClientCore): DropFilterMethods {
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
