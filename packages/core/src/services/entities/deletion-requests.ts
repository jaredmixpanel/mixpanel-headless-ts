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
   * List deletion requests. Sends GET
   * `data-definitions/events/deletion-requests/`.
   *
   * @param signal - Optional cancellation signal.
   * @returns The request list verbatim.
   * @throws {@link MixpanelHeadlessError} - Non-list response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.list_deletion_requests
   */
  listDeletionRequests: (signal?: AbortSignal) => Promise<JsonValue[]>;

  /**
   * Create a deletion request. Sends POST; returns the updated full list.
   *
   * @param body - Creation payload (eventName, fromDate, toDate, ...).
   * @param signal - Optional cancellation signal.
   * @returns All deletion requests after creation.
   * @throws {@link MixpanelHeadlessError} - Non-list response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.create_deletion_request
   */
  createDeletionRequest: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<JsonValue[]>;

  /**
   * Cancel a pending deletion request. Sends DELETE with JSON body `{id}`; returns
   * the updated full list.
   *
   * @param requestId - Deletion request ID to cancel.
   * @param signal - Optional cancellation signal.
   * @returns All deletion requests after cancellation.
   * @throws {@link MixpanelHeadlessError} - Non-list response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.cancel_deletion_request
   */
  cancelDeletionRequest: (
    requestId: number,
    signal?: AbortSignal,
  ) => Promise<JsonValue[]>;

  /**
   * Preview deletion filters. Sends POST `.../deletion-requests/preview-filters/`.
   *
   * @param body - Preview payload.
   * @param signal - Optional cancellation signal.
   * @returns The expanded/normalized filter list.
   * @throws {@link MixpanelHeadlessError} - Non-list response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.preview_deletion_filters
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
 * @example
 * ```typescript
 * const deletions = createDeletionRequestMethods(core);
 * const all = await deletions.createDeletionRequest({
 *   eventName: "Debug Ping", fromDate: "2026-01-01", toDate: "2026-01-31",
 * });
 * // every deletion request, including the new one
 * ```
 */
export function createDeletionRequestMethods(
  core: ClientCore,
): DeletionRequestMethods {
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
