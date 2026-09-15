/**
 * Event-deletion-request wire methods on the App API
 * (`data-definitions/events/deletion-requests/`, workspace-scoped through
 * `maybe_scoped_path`). Create and cancel return the updated full list of
 * deletion requests, not the mutated entity, and cancel is a DELETE
 * carrying a JSON `{id}` body — both mirrored as-is.
 *
 * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.list_deletion_requests
 */

import { appRequest } from "../../client/app-request.js";
import type { ClientCore } from "../../client/core.js";
import type { JsonValue } from "../../client/json-value.js";
import { maybeScopedPath } from "../../client/scope.js";
import { expectListResult } from "./shared.js";

/** Deletion-request methods mixed into `MixpanelClient`. */
export interface DeletionRequestMethods {
  /**
   * List deletion requests (`list_deletion_requests` — GET
   * `data-definitions/events/deletion-requests/`).
   *
   * @param signal - Optional cancellation signal.
   * @returns The request list verbatim.
   * @throws MixpanelHeadlessError - Non-list response.
   */
  listDeletionRequests: (signal?: AbortSignal) => Promise<JsonValue[]>;

  /**
   * Create a deletion request (`create_deletion_request` — POST; returns the
   * updated full list).
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
   * Cancel a pending deletion request (`cancel_deletion_request` — DELETE with
   * JSON body `{id}`; returns the updated full list).
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
   * Preview deletion filters (`preview_deletion_filters` — POST
   * `.../deletion-requests/preview-filters/`).
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
 * Build the deletion-request methods over the shared client core.
 *
 * @param core - The shared client internals seam.
 * @returns The method bag.
 */
export function createDeletionRequestMethods(
  core: ClientCore,
): DeletionRequestMethods {
  /** `maybe_scoped_path` over the pin current at call time. */
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
