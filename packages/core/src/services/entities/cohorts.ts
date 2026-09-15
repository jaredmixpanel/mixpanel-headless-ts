/**
 * Cohort CRUD wire methods (App API) — Phase-3 packet B4-C3 port of the
 * `MixpanelAPIClient` cohorts range (`api_client.py:4736-4937`).
 *
 * All methods route through B0 `appRequest` over `maybe_scoped_path`
 * (R10.8) and return the envelope product verbatim after the source's
 * isinstance guard (Caution #11 — no `Cohort` model shaping; the
 * recorded request bodies are already-flattened dicts).
 */

import { appRequest } from "../../client/app-request.js";
import type { ClientCore } from "../../client/client.js";
import type { JsonValue } from "../../client/json-value.js";
import { maybeScopedPath } from "../../client/scope.js";
import {
  expectListResult,
  expectRecordResult,
  joinIds,
  paramsOrNone,
  truthyList,
  truthyStr,
} from "./shared.js";

/** Options bag of {@link CohortMethods.listCohortsApp}. */
export interface ListCohortsAppOptions {
  /** Optional data group filter. */
  readonly data_group_id?: string | null | undefined;
  /** Optional cohort-ID filter (`,`-joined on the wire). */
  readonly ids?: readonly number[] | null | undefined;
  /** Optional cancellation signal (R6.7). */
  readonly signal?: AbortSignal | undefined;
}

/** The C3 cohort method surface (mixed into `MixpanelClient`). */
export interface CohortMethods {
  /**
   * List cohorts via the App API (`list_cohorts_app`,
   * `api_client.py:4736-4775`).
   *
   * @param options - data_group_id/ids filters + signal.
   * @returns The cohort list verbatim.
   * @throws MixpanelHeadlessError - Non-list response.
   * @throws AuthenticationError | RateLimitError | QueryError |
   *   ServerError - Per the B0 `appRequest` contract.
   */
  listCohortsApp: (options?: ListCohortsAppOptions) => Promise<JsonValue[]>;

  /**
   * Get a cohort by ID (`get_cohort`, `:4777-4805`).
   *
   * @param cohortId - The cohort identifier.
   * @param signal - Optional cancellation signal.
   * @returns The cohort dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  getCohort: (
    cohortId: number,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Create a cohort (`create_cohort`, `:4807-4835`).
   *
   * @param body - Cohort definition payload.
   * @param signal - Optional cancellation signal.
   * @returns The created cohort dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  createCohort: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Update a cohort (`update_cohort`, `:4837-4866`; PATCH).
   *
   * @param cohortId - The cohort identifier.
   * @param body - Fields to update.
   * @param signal - Optional cancellation signal.
   * @returns The updated cohort dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  updateCohort: (
    cohortId: number,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Delete a cohort (`delete_cohort`, `:4868-4887`).
   *
   * @param cohortId - The cohort identifier.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   */
  deleteCohort: (cohortId: number, signal?: AbortSignal) => Promise<void>;

  /**
   * Bulk-delete cohorts (`bulk_delete_cohorts`, `:4889-4908` — POST
   * `cohorts/bulk-delete` with `{cohort_ids}`).
   *
   * @param ids - Cohort IDs to delete.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   */
  bulkDeleteCohorts: (
    ids: readonly number[],
    signal?: AbortSignal,
  ) => Promise<void>;

  /**
   * Bulk-update cohorts (`bulk_update_cohorts`, `:4910-4932` — POST
   * `cohorts/bulk-update` with `{cohorts}`).
   *
   * @param entries - Update dicts, each with `id` + fields.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   */
  bulkUpdateCohorts: (
    entries: ReadonlyArray<Record<string, unknown>>,
    signal?: AbortSignal,
  ) => Promise<void>;
}

/**
 * Build the C3 cohort methods over the C1 core seam.
 *
 * @param core - The shared client internals seam.
 * @returns The method bag.
 */
export function createCohortMethods(core: ClientCore): CohortMethods {
  /** `self.maybe_scoped_path(...)` over the CURRENT pin (call-time). */
  const scopedPath = (domainPath: string): string =>
    maybeScopedPath(domainPath, {
      projectId: core.projectId(),
      workspaceId: core.workspaceId(),
    });

  return {
    listCohortsApp: async (
      options: ListCohortsAppOptions = {},
    ): Promise<JsonValue[]> => {
      const path = scopedPath("cohorts");
      const params: Record<string, string> = {};
      if (truthyStr(options.data_group_id)) {
        params["data_group_id"] = options.data_group_id;
      }
      if (truthyList(options.ids)) {
        params["ids"] = joinIds(options.ids as readonly number[]);
      }
      const result = await appRequest(
        core.appDeps(options.signal),
        "GET",
        path,
        {
          params: paramsOrNone(params),
        },
      );
      return expectListResult(result, "list_cohorts_app");
    },

    getCohort: async (
      cohortId: number,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath(`cohorts/${cohortId}`);
      const result = await appRequest(core.appDeps(signal), "GET", path);
      return expectRecordResult(result, "get_cohort");
    },

    createCohort: async (
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath("cohorts");
      const result = await appRequest(core.appDeps(signal), "POST", path, {
        jsonBody: body,
      });
      return expectRecordResult(result, "create_cohort");
    },

    updateCohort: async (
      cohortId: number,
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath(`cohorts/${cohortId}`);
      const result = await appRequest(core.appDeps(signal), "PATCH", path, {
        jsonBody: body,
      });
      return expectRecordResult(result, "update_cohort");
    },

    deleteCohort: async (
      cohortId: number,
      signal?: AbortSignal,
    ): Promise<void> => {
      const path = scopedPath(`cohorts/${cohortId}`);
      await appRequest(core.appDeps(signal), "DELETE", path);
    },

    bulkDeleteCohorts: async (
      ids: readonly number[],
      signal?: AbortSignal,
    ): Promise<void> => {
      const path = scopedPath("cohorts/bulk-delete");
      await appRequest(core.appDeps(signal), "POST", path, {
        jsonBody: { cohort_ids: ids },
      });
    },

    bulkUpdateCohorts: async (
      entries: ReadonlyArray<Record<string, unknown>>,
      signal?: AbortSignal,
    ): Promise<void> => {
      const path = scopedPath("cohorts/bulk-update");
      await appRequest(core.appDeps(signal), "POST", path, {
        jsonBody: { cohorts: entries },
      });
    },
  };
}
