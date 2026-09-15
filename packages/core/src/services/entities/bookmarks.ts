/**
 * Bookmark (saved report) CRUD wire methods — Phase-3 packet B4-C3 port
 * of the `MixpanelAPIClient` bookmarks-v2 range
 * (`api_client.py:4427-4735`).
 *
 * All methods route through B0 `appRequest` over `maybe_scoped_path`
 * (R10.8). The v2 wire markers port verbatim: list/get send `v=2` as a
 * query param (STRING `"2"`); create/update merge `"v": 2` (INT) into
 * the JSON body. `get_bookmark_history` is the one `_raw=True` call in
 * the shard — it re-shapes the raw envelope exactly per the source.
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
  joinIds,
  paramsOrNone,
  pythonTypeNameOf,
  truthyList,
  truthyStr,
} from "./shared.js";

/** Options bag of {@link BookmarkMethods.listBookmarksV2}. */
export interface ListBookmarksV2Options {
  /** Optional report-type filter (e.g. `"insights"`, `"funnels"`). */
  readonly bookmark_type?: string | null | undefined;
  /** Optional bookmark-ID filter (`,`-joined on the wire). */
  readonly ids?: readonly number[] | null | undefined;
  /** Optional cancellation signal (R6.7). */
  readonly signal?: AbortSignal | undefined;
}

/** Options bag of {@link BookmarkMethods.getBookmarkHistory}. */
export interface GetBookmarkHistoryOptions {
  /** Opaque pagination cursor from a previous call. */
  readonly cursor?: string | null | undefined;
  /** Maximum entries per page. */
  readonly page_size?: number | null | undefined;
  /** Optional cancellation signal (R6.7). */
  readonly signal?: AbortSignal | undefined;
}

/** The C3 bookmark method surface (mixed into `MixpanelClient`). */
export interface BookmarkMethods {
  /**
   * List bookmarks via the App API (`list_bookmarks_v2`,
   * `api_client.py:4427-4477`). Unwraps the v2
   * `{"results": {"results": [...]}}` envelope.
   *
   * @param options - Type/ids filters + signal.
   * @returns The bookmark list verbatim.
   * @throws MixpanelHeadlessError - Neither a list nor a v2 envelope.
   * @throws AuthenticationError | RateLimitError | QueryError |
   *   ServerError - Per the B0 `appRequest` contract.
   */
  listBookmarksV2: (options?: ListBookmarksV2Options) => Promise<JsonValue[]>;

  /**
   * Create a bookmark (`create_bookmark`, `:4479-4513` — the body
   * gains `"v": 2`).
   *
   * @param body - Creation payload.
   * @param signal - Optional cancellation signal.
   * @returns The created bookmark dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  createBookmark: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Get a bookmark by ID (`get_bookmark`, `:4515-4543` — sends
   * `v=2`).
   *
   * @param bookmarkId - The bookmark identifier.
   * @param signal - Optional cancellation signal.
   * @returns The bookmark dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  getBookmark: (
    bookmarkId: number,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Update a bookmark (`update_bookmark`, `:4545-4575` — PATCH; the
   * body gains `"v": 2`).
   *
   * @param bookmarkId - The bookmark identifier.
   * @param body - Fields to update.
   * @param signal - Optional cancellation signal.
   * @returns The updated bookmark dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  updateBookmark: (
    bookmarkId: number,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Delete a bookmark (`delete_bookmark`, `:4577-4596`).
   *
   * @param bookmarkId - The bookmark identifier.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   */
  deleteBookmark: (bookmarkId: number, signal?: AbortSignal) => Promise<void>;

  /**
   * Bulk-delete bookmarks (`bulk_delete_bookmarks`, `:4598-4617` —
   * POST `bookmarks/bulk-delete` with `{bookmark_ids}`).
   *
   * @param ids - Bookmark IDs to delete.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   */
  bulkDeleteBookmarks: (
    ids: readonly number[],
    signal?: AbortSignal,
  ) => Promise<void>;

  /**
   * Bulk-update bookmarks (`bulk_update_bookmarks`, `:4619-4640` —
   * POST `bookmarks/bulk-update` with `{bookmarks}`).
   *
   * @param entries - Update dicts, each with `id` + fields.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   */
  bulkUpdateBookmarks: (
    entries: ReadonlyArray<Record<string, unknown>>,
    signal?: AbortSignal,
  ) => Promise<void>;

  /**
   * Dashboard IDs linked to a bookmark
   * (`bookmark_linked_dashboard_ids`, `:4642-4670` — GET
   * `bookmarks/{id}/linked-dashboard-ids`).
   *
   * @param bookmarkId - The bookmark identifier.
   * @param signal - Optional cancellation signal.
   * @returns The ID list verbatim.
   * @throws MixpanelHeadlessError - Non-list response.
   */
  bookmarkLinkedDashboardIds: (
    bookmarkId: number,
    signal?: AbortSignal,
  ) => Promise<JsonValue[]>;

  /**
   * Change history for a bookmark (`get_bookmark_history`,
   * `:4672-4730` — `_raw=True`, then the source's envelope re-shape:
   * always a dict with `results` + `pagination` keys).
   *
   * @param bookmarkId - The bookmark identifier.
   * @param options - Cursor/page-size + signal.
   * @returns `{results, pagination}` per the source's shaping.
   * @throws MixpanelHeadlessError - Non-dict, non-list raw response.
   */
  getBookmarkHistory: (
    bookmarkId: number,
    options?: GetBookmarkHistoryOptions,
  ) => Promise<Record<string, JsonValue>>;
}

/**
 * Build the C3 bookmark methods over the C1 core seam.
 *
 * @param core - The shared client internals seam.
 * @returns The method bag.
 */
export function createBookmarkMethods(core: ClientCore): BookmarkMethods {
  /** `self.maybe_scoped_path(...)` over the CURRENT pin (call-time). */
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
      // appRequest unwrap the method may still see one more layer
      // (`api_client.py:4467-4473`).
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
      // `{**body, "v": 2}` — the INT marker, spelled after the caller's
      // keys (JS spread preserves the same string-key ordering).
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
        // `str(page_size)` (R11.7: pythonStr, never String()).
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
        // "pagination": {...}} or already a list (`:4710-4724`).
        const inner = Object.hasOwn(result, "results")
          ? (result["results"] as JsonValue)
          : result;
        if (isPlainRecord(inner) && Object.hasOwn(inner, "results")) {
          // inner is {"results": [...], "pagination": {...}} — as-is,
          // defaulting an absent pagination to None (the source
          // MUTATES inner; a fresh spread is observationally the same
          // dict content).
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
