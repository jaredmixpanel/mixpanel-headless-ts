/**
 * Drop-filter wire methods (App API) — Phase-3 packet B4-C5 port of
 * the `MixpanelAPIClient` drop-filters range
 * (`api_client.py:7178-7344`).
 *
 * All methods route through B0 `appRequest` over `maybe_scoped_path`
 * (R10.8). NOTE the create/update/delete mutations return the full
 * post-mutation filter LIST, not the mutated entity (Behavior spine:
 * "no results-unwrap surprises" — port exactly what `appRequest`
 * hands back, Caution #11).
 */

import { appRequest } from "../../client/app-request.js";
import type { ClientCore } from "../../client/core.js";
import type { JsonValue } from "../../client/json-value.js";
import { maybeScopedPath } from "../../client/scope.js";
import { expectListResult, expectRecordResult } from "./shared.js";

/** The C5 drop-filter method surface (mixed into `MixpanelClient`). */
export interface DropFilterMethods {
  /**
   * List drop filters (`list_drop_filters`, `api_client.py:7178-7206`
   * — GET `data-definitions/events/drop-filters/`).
   *
   * @param signal - Optional cancellation signal.
   * @returns The filter list verbatim.
   * @throws MixpanelHeadlessError - Non-list response.
   */
  listDropFilters: (signal?: AbortSignal) => Promise<JsonValue[]>;

  /**
   * Create a drop filter (`create_drop_filter`, `:7208-7241` — POST;
   * returns the full post-creation LIST).
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
   * Update a drop filter (`update_drop_filter`, `:7243-7276` — PATCH;
   * returns the full post-update LIST).
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
   * Delete a drop filter by ID (`delete_drop_filter`, `:7278-7309` —
   * DELETE with JSON body `{id}`; returns the full post-delete LIST).
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
   * Get drop-filter usage limits (`get_drop_filter_limits`,
   * `:7311-7339` — GET `.../drop-filters/limits/`).
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
 * Build the C5 drop-filter methods over the C1 core seam.
 *
 * @param core - The shared client internals seam.
 * @returns The method bag.
 */
export function createDropFilterMethods(core: ClientCore): DropFilterMethods {
  /** `self.maybe_scoped_path(...)` over the CURRENT pin (call-time). */
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
