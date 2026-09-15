/**
 * Bookmark (saved report) CRUD wire methods on the App API (`bookmarks`,
 * workspace-scoped through `maybe_scoped_path`). The v2 wire markers are
 * mirrored exactly: list and get send `v=2` as a query param (the string
 * `"2"`), create and update merge `"v": 2` (the integer) into the JSON
 * body. `get_bookmark_history` is the one raw-envelope call and re-shapes
 * the envelope branch for branch as Python does.
 *
 * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.list_bookmarks_v2
 */

import { appRequest } from "../../client/app-request.js";
import type { ClientCore } from "../../client/core.js";
import { isPlainRecord } from "../../client/internals.js";
import type { JsonValue } from "../../client/json-value.js";
import { maybeScopedPath } from "../../client/scope.js";
import { pythonStr } from "../../compat/python-str.js";
import { MixpanelHeadlessError } from "../../errors.js";
import { pythonTypeNameOf, truthyList, truthyStr } from "../shared.js";
import {
  expectListResult,
  expectRecordResult,
  joinIds,
  paramsOrNone,
} from "./shared.js";

/** Options bag of {@link BookmarkMethods.listBookmarksV2}. */
export interface ListBookmarksV2Options {
  /** Optional report-type filter (e.g. `"insights"`, `"funnels"`). */
  readonly bookmark_type?: string | null | undefined;
  /** Optional bookmark-ID filter (`,`-joined on the wire). */
  readonly ids?: readonly number[] | null | undefined;
  /** Optional cancellation signal. */
  readonly signal?: AbortSignal | undefined;
}

/** Options bag of {@link BookmarkMethods.getBookmarkHistory}. */
export interface GetBookmarkHistoryOptions {
  /** Opaque pagination cursor from a previous call. */
  readonly cursor?: string | null | undefined;
  /** Maximum entries per page. */
  readonly page_size?: number | null | undefined;
  /** Optional cancellation signal. */
  readonly signal?: AbortSignal | undefined;
}

/** Bookmark methods mixed into `MixpanelClient`. */
export interface BookmarkMethods {
  /**
   * List bookmarks via the App API. Unwraps the v2
   * `{"results": {"results": [...]}}` envelope.
   *
   * @param options - Type/ids filters + signal.
   * @returns The bookmark list verbatim.
   * @throws {@link MixpanelHeadlessError} - Neither a list nor a v2 envelope.
   * @throws {@link AuthenticationError} - Invalid or expired credentials (401).
   * @throws {@link RateLimitError} - Rate limit still exceeded after the retries
   *   (429).
   * @throws {@link QueryError} - Other 4xx responses (400/403/404/422).
   * @throws {@link ServerError} - Server-side errors (5xx).
   * @internal
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.list_bookmarks_v2
   */
  listBookmarksV2: (options?: ListBookmarksV2Options) => Promise<JsonValue[]>;

  /**
   * Create a bookmark. Sends POST `bookmarks` with `"v": 2` merged into the
   * body.
   *
   * @param body - Creation payload.
   * @param signal - Optional cancellation signal.
   * @returns The created bookmark dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.create_bookmark
   */
  createBookmark: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Get a bookmark by ID. Sends GET `bookmarks/{id}` with `v=2`.
   *
   * @param bookmarkId - The bookmark identifier.
   * @param signal - Optional cancellation signal.
   * @returns The bookmark dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.get_bookmark
   */
  getBookmark: (
    bookmarkId: number,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Update a bookmark. Sends PATCH; the body gains `"v": 2`.
   *
   * @param bookmarkId - The bookmark identifier.
   * @param body - Fields to update.
   * @param signal - Optional cancellation signal.
   * @returns The updated bookmark dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.update_bookmark
   */
  updateBookmark: (
    bookmarkId: number,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Delete a bookmark.
   *
   * @param bookmarkId - The bookmark identifier.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.delete_bookmark
   */
  deleteBookmark: (bookmarkId: number, signal?: AbortSignal) => Promise<void>;

  /**
   * Bulk-delete bookmarks. Sends POST `bookmarks/bulk-delete` with
   * `{bookmark_ids}`.
   *
   * @param ids - Bookmark IDs to delete.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.bulk_delete_bookmarks
   */
  bulkDeleteBookmarks: (
    ids: readonly number[],
    signal?: AbortSignal,
  ) => Promise<void>;

  /**
   * Bulk-update bookmarks. Sends POST `bookmarks/bulk-update` with `{bookmarks}`.
   *
   * @param entries - Update dicts, each with `id` + fields.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.bulk_update_bookmarks
   */
  bulkUpdateBookmarks: (
    entries: ReadonlyArray<Record<string, unknown>>,
    signal?: AbortSignal,
  ) => Promise<void>;

  /**
   * List the dashboard IDs linked to a bookmark. Sends GET
   * `bookmarks/{id}/linked-dashboard-ids`.
   *
   * @param bookmarkId - The bookmark identifier.
   * @param signal - Optional cancellation signal.
   * @returns The ID list verbatim.
   * @throws {@link MixpanelHeadlessError} - Non-list response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.bookmark_linked_dashboard_ids
   */
  bookmarkLinkedDashboardIds: (
    bookmarkId: number,
    signal?: AbortSignal,
  ) => Promise<JsonValue[]>;

  /**
   * Get the change history of a bookmark. Sends GET `bookmarks/{id}/history`
   * as a raw-envelope request and re-shapes the envelope to a dict with
   * `results` and `pagination` keys.
   *
   * @param bookmarkId - The bookmark identifier.
   * @param options - Cursor/page-size + signal.
   * @returns `{results, pagination}` per the source's shaping.
   * @throws {@link MixpanelHeadlessError} - Non-dict, non-list raw response.
   * @internal
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.get_bookmark_history
   */
  getBookmarkHistory: (
    bookmarkId: number,
    options?: GetBookmarkHistoryOptions,
  ) => Promise<Record<string, JsonValue>>;
}

/**
 * Build the bookmark methods over the shared client core.
 *
 * @param core - The shared client internals seam.
 * @returns The method bag.
 * @example
 * ```typescript
 * const bookmarks = createBookmarkMethods(core);
 * const insights = await bookmarks.listBookmarksV2({ bookmark_type: "insights" });
 * // [{ id: 1001, name: "Weekly actives", type: "insights", ... }, ...]
 * ```
 */
// eslint-disable-next-line max-lines-per-function -- branch-for-branch port of one Python function (see the docblock); splitting it would scatter the guard order the corpus pins
export function createBookmarkMethods(core: ClientCore): BookmarkMethods {
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
    listBookmarksV2: async (
      options: ListBookmarksV2Options = {},
    ): Promise<JsonValue[]> => {
      const path = scopedPath("bookmarks");
      const params: Record<string, string> = { v: "2" };
      if (truthyStr(options.bookmark_type)) {
        params["type"] = options.bookmark_type;
      }
      if (truthyList(options.ids)) {
        params["ids"] = joinIds(options.ids as readonly number[]);
      }
      const result = await appRequest(
        core.appDeps(options.signal),
        "GET",
        path,
        {
          params,
        },
      );
      // v2 envelope: {"results": {"results": [...]}} — after the
      // appRequest unwrap the method may still see one more layer.
      if (isPlainRecord(result) && Object.hasOwn(result, "results")) {
        const inner = result["results"] as JsonValue;
        if (Array.isArray(inner)) {
          return inner;
        }
      }
      if (Array.isArray(result)) {
        return result;
      }
      throw new MixpanelHeadlessError(
        `Unexpected response from list_bookmarks_v2: ` +
          `expected list or v2 envelope, got ${pythonTypeNameOf(result)}`,
      );
    },

    createBookmark: async (
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath("bookmarks");
      // `{**body, "v": 2}` — the integer marker, spelled after the
      // caller's keys (JS spread preserves the same string-key ordering).
      const bodyV2 = { ...body, v: 2 };
      const result = await appRequest(core.appDeps(signal), "POST", path, {
        jsonBody: bodyV2,
      });
      return expectRecordResult(result, "create_bookmark");
    },

    getBookmark: async (
      bookmarkId: number,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath(`bookmarks/${bookmarkId}`);
      const result = await appRequest(core.appDeps(signal), "GET", path, {
        params: { v: "2" },
      });
      return expectRecordResult(result, "get_bookmark");
    },

    updateBookmark: async (
      bookmarkId: number,
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath(`bookmarks/${bookmarkId}`);
      const bodyV2 = { ...body, v: 2 };
      const result = await appRequest(core.appDeps(signal), "PATCH", path, {
        jsonBody: bodyV2,
      });
      return expectRecordResult(result, "update_bookmark");
    },

    deleteBookmark: async (
      bookmarkId: number,
      signal?: AbortSignal,
    ): Promise<void> => {
      const path = scopedPath(`bookmarks/${bookmarkId}`);
      await appRequest(core.appDeps(signal), "DELETE", path);
    },

    bulkDeleteBookmarks: async (
      ids: readonly number[],
      signal?: AbortSignal,
    ): Promise<void> => {
      const path = scopedPath("bookmarks/bulk-delete");
      await appRequest(core.appDeps(signal), "POST", path, {
        jsonBody: { bookmark_ids: ids },
      });
    },

    bulkUpdateBookmarks: async (
      entries: ReadonlyArray<Record<string, unknown>>,
      signal?: AbortSignal,
    ): Promise<void> => {
      const path = scopedPath("bookmarks/bulk-update");
      await appRequest(core.appDeps(signal), "POST", path, {
        jsonBody: { bookmarks: entries },
      });
    },

    bookmarkLinkedDashboardIds: async (
      bookmarkId: number,
      signal?: AbortSignal,
    ): Promise<JsonValue[]> => {
      const path = scopedPath(`bookmarks/${bookmarkId}/linked-dashboard-ids`);
      const result = await appRequest(core.appDeps(signal), "GET", path);
      return expectListResult(result, "bookmark_linked_dashboard_ids");
    },

    getBookmarkHistory: async (
      bookmarkId: number,
      options: GetBookmarkHistoryOptions = {},
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath(`bookmarks/${bookmarkId}/history`);
      const params: Record<string, string> = {};
      if (truthyStr(options.cursor)) {
        params["cursor"] = options.cursor;
      }
      if (options.page_size !== undefined && options.page_size !== null) {
        // `str(page_size)` — `pythonStr`, never `String()`.
        params["page_size"] = pythonStr(options.page_size);
      }
      const result = await appRequest(
        core.appDeps(options.signal),
        "GET",
        path,
        {
          params: paramsOrNone(params),
          raw: true,
        },
      );
      if (isPlainRecord(result)) {
        // The raw response is {"status": "ok", "results": <inner>}.
        // <inner> may be the history dict {"results": [...],
        // "pagination": {...}} or already a list.
        const inner = Object.hasOwn(result, "results")
          ? (result["results"] as JsonValue)
          : result;
        if (isPlainRecord(inner) && Object.hasOwn(inner, "results")) {
          // inner is {"results": [...], "pagination": {...}} — as-is,
          // defaulting an absent pagination to None (Python mutates
          // `inner` in place; a fresh spread yields the same dict
          // content).
          if (!Object.hasOwn(inner, "pagination")) {
            return { ...inner, pagination: null };
          }
          return inner;
        }
        if (Array.isArray(inner)) {
          // Flat list of history entries — wrap with pagination
          return { results: inner, pagination: null };
        }
        // Unexpected dict shape — return with defaults
        return { results: inner, pagination: null };
      }
      if (Array.isArray(result)) {
        return { results: result, pagination: null };
      }
      throw new MixpanelHeadlessError(
        `Unexpected response from get_bookmark_history: ` +
          `expected dict, got ${pythonTypeNameOf(result)}`,
      );
    },
  };
}
