/**
 * Event-deletion-request wire methods (App API) — Phase-3 packet B4-C5
 * port of the `MixpanelAPIClient` deletion-requests range
 * (`api_client.py:8544-8675`).
 *
 * All methods route through B0 `appRequest` over `maybe_scoped_path`
 * (R10.8). NOTE `create`/`cancel` return the updated full LIST of
 * deletion requests (not the mutated entity) and `cancel` is a DELETE
 * with a JSON `{id}` body — port exactly (Caution #11).
 */

import { appRequest } from "../../client/app-request.js";
import type { ClientCore } from "../../client/client.js";
import type { JsonValue } from "../../client/json-value.js";
import { maybeScopedPath } from "../../client/scope.js";
import { expectListResult } from "./shared.js";

/** The C5 deletion-request method surface (mixed into `MixpanelClient`). */
export interface DeletionRequestMethods {
  /**
   * List deletion requests (`list_deletion_requests`,
   * `api_client.py:8544-8568` — GET
   * `data-definitions/events/deletion-requests/`).
   *
   * @param signal - Optional cancellation signal.
   * @returns The request list verbatim.
   * @throws MixpanelHeadlessError - Non-list response.
   */
  listDeletionRequests: (signal?: AbortSignal) => Promise<JsonValue[]>;

  /**
   * Create a deletion request (`create_deletion_request`,
   * `:8570-8605` — POST; returns the updated full LIST).
   *
   * @param body - Creation payload (eventName, fromDate, toDate, ...).
   * @param signal - Optional cancellation signal.
   * @returns All deletion requests after creation.
   * @throws MixpanelHeadlessError - Non-list response.
   */
  createDeletionRequest: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<JsonValue[]>;

  /**
   * Cancel a pending deletion request (`cancel_deletion_request`,
   * `:8607-8636` — DELETE with JSON body `{id}`; returns the updated
   * full LIST).
   *
   * @param requestId - Deletion request ID to cancel.
   * @param signal - Optional cancellation signal.
   * @returns All deletion requests after cancellation.
   * @throws MixpanelHeadlessError - Non-list response.
   */
  cancelDeletionRequest: (
    requestId: number,
    signal?: AbortSignal,
  ) => Promise<JsonValue[]>;

  /**
   * Preview deletion filters (`preview_deletion_filters`,
   * `:8638-8675` — POST `.../deletion-requests/preview-filters/`).
   *
   * @param body - Preview payload.
   * @param signal - Optional cancellation signal.
   * @returns The expanded/normalized filter list.
   * @throws MixpanelHeadlessError - Non-list response.
   */
  previewDeletionFilters: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<JsonValue[]>;
}

/**
 * Build the C5 deletion-request methods over the C1 core seam.
 *
 * @param core - The shared client internals seam.
 * @returns The method bag.
 */
export function createDeletionRequestMethods(
  core: ClientCore,
): DeletionRequestMethods {
  /** `self.maybe_scoped_path(...)` over the CURRENT pin (call-time). */
  const scopedPath = (domainPath: string): string =>
    maybeScopedPath(domainPath, {
      projectId: core.projectId(),
      workspaceId: core.workspaceId(),
    });

  return {
    listDeletionRequests: async (
      signal?: AbortSignal,
    ): Promise<JsonValue[]> => {
      const path = scopedPath("data-definitions/events/deletion-requests/");
      const result = await appRequest(core.appDeps(signal), "GET", path);
      return expectListResult(result, "list_deletion_requests");
    },

    createDeletionRequest: async (
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<JsonValue[]> => {
      const path = scopedPath("data-definitions/events/deletion-requests/");
      const result = await appRequest(core.appDeps(signal), "POST", path, {
        jsonBody: body,
      });
      return expectListResult(result, "create_deletion_request");
    },

    cancelDeletionRequest: async (
      requestId: number,
      signal?: AbortSignal,
    ): Promise<JsonValue[]> => {
      const path = scopedPath("data-definitions/events/deletion-requests/");
      const result = await appRequest(core.appDeps(signal), "DELETE", path, {
        jsonBody: { id: requestId },
      });
      return expectListResult(result, "cancel_deletion_request");
    },

    previewDeletionFilters: async (
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<JsonValue[]> => {
      const path = scopedPath(
        "data-definitions/events/deletion-requests/preview-filters/",
      );
      const result = await appRequest(core.appDeps(signal), "POST", path, {
        jsonBody: body,
      });
      return expectListResult(result, "preview_deletion_filters");
    },
  };
}
