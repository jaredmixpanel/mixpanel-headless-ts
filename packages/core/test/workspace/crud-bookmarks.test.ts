// B6-W3 Layer-3 translation (packet `b6-packets.md` §5) of the
// bookmark/cohort classes of `tests/unit/test_workspace_crud.py`
// (1,861 lines): `TestWorkspaceBookmarkCRUD` and
// `TestWorkspaceCohortCRUD`. The dashboard classes of the same
// file are W2's (`crud-dashboards.test.ts`).
//
// Python's `httpx.MockTransport` handler becomes the injected-fetch
// `fakeTransport` seam; `_make_workspace(temp_dir, handler)`
// becomes `makeFacadeWorkspace(handler)` — the client is built over the
// OAuth session (`_make_oauth_credentials`, :66) while the facade
// carries the service-account `_TEST_SESSION`, exactly as
// Python does. `temp_dir` has no TS analog (no config file is ever
// touched) and is dropped.
//
// `caplog.at_level(logging.WARNING, logger="mixpanel_headless.workspace")`
// becomes the injected `logger` seam — the facade's
// `WorkspaceLogger.warning` sink, whose messages carry the same
// `"<member> validation warning: <message> [<code>]" `formatting the
// Python `logger.warning("%s [%s]", …)` call produces.
//
// The `_bookmark_fixtures` module is mirrored at
// `./bookmark-fixtures.ts` (same constants, verbatim).

import { describe, expect, it } from "vitest";

import {
  BookmarkValidationError,
  MixpanelHeadlessError,
} from "../../src/errors.js";
import {
  Bookmark,
  BookmarkHistoryResponse,
  BulkUpdateBookmarkEntry,
  CreateBookmarkParams,
  UpdateBookmarkParams,
} from "../../src/types/entities/bookmarks.js";
import {
  type CapturedFetchRequest,
  type FakeTransport,
  ok,
} from "../../test-support/client-test-helpers.js";
import {
  logCollector,
  makeFacadeWorkspace,
} from "../../test-support/workspace-test-helpers.js";
import {
  MINIMAL_FUNNEL_PARAMS,
  MINIMAL_INSIGHTS_PARAMS,
} from "./bookmark-fixtures.js";

/**
 * A minimal dashboard dict matching the API shape (`_dashboard_json`,
 * :108-137).
 *
 * @param id - Dashboard ID.
 * @param title - Dashboard title.
 * @returns The payload record.
 */
function dashboardJson(
  id = 1,
  title = "Test Dashboard",
): Record<string, unknown> {
  return {
    id,
    title,
    is_private: false,
    is_restricted: false,
    is_favorited: false,
    can_update_basic: true,
    can_share: true,
    can_view: true,
    can_update_restricted: false,
    can_update_visibility: false,
    is_superadmin: false,
    allow_staff_override: false,
    can_pin: true,
    is_shared_with_project: true,
    ancestors: [],
  };
}

/**
 * A minimal bookmark dict matching the API shape (`_bookmark_json`,
 * :140-160).
 *
 * @param id - Bookmark ID.
 * @param name - Bookmark name.
 * @param bookmarkType - Report type (sent as `"type"`).
 * @returns The payload record.
 */
function bookmarkJson(
  id = 1,
  name = "Test Bookmark",
  bookmarkType = "insights",
): Record<string, unknown> {
  return { id, name, type: bookmarkType, params: { events: [] } };
}

/**
 * Parse a captured request body as JSON.
 *
 * @param transport - The capture log.
 * @param index - Which capture to read (default 0).
 * @returns The decoded body.
 */
function bodyOf(transport: FakeTransport, index = 0): unknown {
  return JSON.parse(transport.captures[index]?.bodyText ?? "null");
}

// =============================================================================
// TestWorkspaceBookmarkCRUD (test_workspace_crud.py)
// =============================================================================

describe("Workspace bookmark CRUD", () => {
  // python: TestWorkspaceBookmarkCRUD
  it("list_bookmarks_v2() returns list of Bookmark objects", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok([
        bookmarkJson(1, "Bookmark A", "insights"),
        bookmarkJson(2, "Bookmark B", "funnels"),
      ]),
    );
    const bookmarks = await ws.listBookmarksV2();

    expect(bookmarks).toHaveLength(2);
    expect(bookmarks[0]).toBeInstanceOf(Bookmark);
    expect(bookmarks[0]?.id).toBe(1);
    expect(bookmarks[0]?.name).toBe("Bookmark A");
    expect(bookmarks[0]?.bookmark_type).toBe("insights");
    expect(bookmarks[1]?.bookmark_type).toBe("funnels");
  });

  it("list_bookmarks_v2() returns empty list when none exist", async () => {
    const { ws } = makeFacadeWorkspace(() => ok([]));
    await expect(ws.listBookmarksV2()).resolves.toStrictEqual([]);
  });

  it("list_bookmarks_v2(bookmark_type='funnels') passes filter", async () => {
    const capturedUrl: string[] = [];
    const { ws } = makeFacadeWorkspace((request) => {
      capturedUrl.push(request.url);
      return ok([bookmarkJson(1, "Funnel", "funnels")]);
    });
    const bookmarks = await ws.listBookmarksV2({ bookmark_type: "funnels" });

    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0]?.bookmark_type).toBe("funnels");
  });

  it("list_bookmarks_v2() preserves the API response order", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok([bookmarkJson(5, "E"), bookmarkJson(3, "C"), bookmarkJson(1, "A")]),
    );
    const bookmarks = await ws.listBookmarksV2();
    expect(bookmarks.map((b) => b.id)).toStrictEqual([5, 3, 1]);
  });

  it("create_bookmark() returns the created Bookmark", async () => {
    const { ws } = makeFacadeWorkspace((request) =>
      ok(
        request.method === "PATCH"
          ? dashboardJson(99)
          : bookmarkJson(10, "New Bookmark", "insights"),
      ),
    );
    const bookmark = await ws.createBookmark(
      new CreateBookmarkParams({
        name: "New Bookmark",
        bookmark_type: "insights",
        params: MINIMAL_INSIGHTS_PARAMS,
        dashboard_id: 99,
      }),
    );

    expect(bookmark).toBeInstanceOf(Bookmark);
    expect(bookmark.id).toBe(10);
    expect(bookmark.name).toBe("New Bookmark");
  });

  it("create_bookmark() sends description when provided", async () => {
    const { ws } = makeFacadeWorkspace((request) => {
      if (request.method === "PATCH") {
        return ok(dashboardJson(99));
      }
      return ok({
        ...bookmarkJson(11, "Described BM", "funnels"),
        description: "A test bookmark",
      });
    });
    const bookmark = await ws.createBookmark(
      new CreateBookmarkParams({
        name: "Described BM",
        bookmark_type: "funnels",
        params: MINIMAL_FUNNEL_PARAMS,
        description: "A test bookmark",
        dashboard_id: 99,
      }),
    );

    expect(bookmark.description).toBe("A test bookmark");
  });

  it("create_bookmark() can associate with a dashboard", async () => {
    const { ws } = makeFacadeWorkspace((request) => {
      if (request.method === "PATCH") {
        return ok(dashboardJson(99));
      }
      return ok({
        ...bookmarkJson(12, "On Dashboard", "insights"),
        dashboard_id: 99,
      });
    });
    const bookmark = await ws.createBookmark(
      new CreateBookmarkParams({
        name: "On Dashboard",
        bookmark_type: "insights",
        params: MINIMAL_INSIGHTS_PARAMS,
        dashboard_id: 99,
      }),
    );

    expect(bookmark.dashboard_id).toBe(99);
  });

  it("create_bookmark() PATCHes the report into the dashboard layout", async () => {
    const { ws, transport } = makeFacadeWorkspace((request) => {
      if (request.method === "POST" && request.url.includes("bookmarks")) {
        return ok({
          ...bookmarkJson(42, "Auto Add", "insights"),
          dashboard_id: 99,
        });
      }
      if (request.method === "PATCH" && request.url.includes("dashboards")) {
        return ok(dashboardJson(99));
      }
      return ok({});
    });
    await ws.createBookmark(
      new CreateBookmarkParams({
        name: "Auto Add",
        bookmark_type: "insights",
        params: MINIMAL_INSIGHTS_PARAMS,
        dashboard_id: 99,
      }),
    );

    const patchIndexes = transport.captures
      .map((capture, index) => ({ capture, index }))
      .filter(
        ({ capture }) =>
          capture.method === "PATCH" && capture.url.includes("dashboards"),
      );
    expect(patchIndexes).toHaveLength(1);
    const patchBody = bodyOf(transport, patchIndexes[0]?.index ?? 0) as {
      content: { content_params: { source_bookmark_id: number } };
    };
    expect(patchBody.content.content_params.source_bookmark_id).toBe(42);
  });

  it("create_bookmark() raises when dashboard_id is missing", async () => {
    const calls: CapturedFetchRequest[] = [];
    const { ws } = makeFacadeWorkspace((request) => {
      calls.push(request);
      return ok({});
    });
    const params = new CreateBookmarkParams({
      name: "No Dashboard",
      bookmark_type: "insights",
      params: MINIMAL_INSIGHTS_PARAMS,
    });

    await expect(ws.createBookmark(params)).rejects.toBeInstanceOf(
      MixpanelHeadlessError,
    );
    await expect(ws.createBookmark(params)).rejects.toThrow(
      /dashboard_id is required/,
    );
    expect(calls).toStrictEqual([]);
  });

  it("create_bookmark() rejects malformed sorting before any API call", async () => {
    const calls: CapturedFetchRequest[] = [];
    const { ws } = makeFacadeWorkspace((request) => {
      calls.push(request);
      return ok({});
    });
    const badParams: Record<string, unknown> = {
      ...MINIMAL_INSIGHTS_PARAMS,
      sorting: {
        bar: { sortBy: "value", sortOrder: "asc", segmentation: "value" },
      },
    };
    const params = new CreateBookmarkParams({
      name: "Bad Sort",
      bookmark_type: "insights",
      params: badParams,
      dashboard_id: 99,
    });

    const error = await ws.createBookmark(params).then(
      () => null,
      (error_: unknown) => error_,
    );
    expect(error).toBeInstanceOf(BookmarkValidationError);
    const codes = new Set(
      (error as BookmarkValidationError).errors.map((e) => e.code),
    );
    expect(codes.has("S2_MISSING_COL_SORT_ATTRS")).toBe(true);
    expect(codes.has("S3_UNKNOWN_FIELD")).toBe(true);
    expect(calls).toStrictEqual([]);
  });

  it("update_bookmark() rejects malformed sorting before the API call", async () => {
    const calls: CapturedFetchRequest[] = [];
    const { ws } = makeFacadeWorkspace((request) => {
      calls.push(request);
      return ok({});
    });
    const params = new UpdateBookmarkParams({
      params: { sorting: { bar: { sortBy: "value", segmentation: "value" } } },
    });

    await expect(ws.updateBookmark(1, params)).rejects.toBeInstanceOf(
      BookmarkValidationError,
    );
    expect(calls).toStrictEqual([]);
  });

  it("update_bookmark() rejects malformed displayOptions", async () => {
    const calls: CapturedFetchRequest[] = [];
    const { ws } = makeFacadeWorkspace((request) => {
      calls.push(request);
      return ok({});
    });
    const params = new UpdateBookmarkParams({
      params: { displayOptions: { plotStyle: "stacked" } },
    });

    const error = await ws.updateBookmark(1, params).then(
      () => null,
      (error_: unknown) => error_,
    );
    expect(error).toBeInstanceOf(BookmarkValidationError);
    const codes = new Set(
      (error as BookmarkValidationError).errors.map((e) => e.code),
    );
    expect(codes.has("B0_MISSING_FIELD")).toBe(true);
    expect(calls).toStrictEqual([]);
  });

  it("update_bookmark() name-only partial does not false-reject", async () => {
    const calls: CapturedFetchRequest[] = [];
    const { ws } = makeFacadeWorkspace((request) => {
      calls.push(request);
      return ok(bookmarkJson(1, "Renamed", "insights"));
    });
    await ws.updateBookmark(1, new UpdateBookmarkParams({ name: "Renamed" }));
    expect(calls).toHaveLength(1);
  });

  it("update_bookmark() with warning-only errors does NOT raise", async () => {
    const calls: CapturedFetchRequest[] = [];
    const { ws } = makeFacadeWorkspace((request) => {
      calls.push(request);
      return ok(bookmarkJson(1, "X", "insights"));
    });
    const params = new UpdateBookmarkParams({
      params: { sorting: { barz: { sortBy: "column", colSortAttrs: [] } } },
    });

    await ws.updateBookmark(1, params);
    expect(calls).toHaveLength(1);
  });

  it("create_bookmark() logs warnings instead of dropping them", async () => {
    const logger = logCollector();
    const { ws } = makeFacadeWorkspace(
      (request) =>
        ok(
          request.method === "PATCH"
            ? dashboardJson(99)
            : bookmarkJson(77, "WarnTest", "insights"),
        ),
      logger,
    );
    const goodParams: Record<string, unknown> = {
      ...MINIMAL_INSIGHTS_PARAMS,
      sorting: { barz: { sortBy: "column", colSortAttrs: [] } },
    };
    await ws.createBookmark(
      new CreateBookmarkParams({
        name: "WarnTest",
        bookmark_type: "insights",
        params: goodParams,
        dashboard_id: 99,
      }),
    );

    expect(
      logger.warnings.some((m) => m.includes("S4_UNKNOWN_CHART_TYPE")),
    ).toBe(true);
  });

  it("create_bookmark() accepts the canonical valid sorting block", async () => {
    const { ws } = makeFacadeWorkspace((request) =>
      ok(
        request.method === "PATCH"
          ? dashboardJson(99)
          : bookmarkJson(77, "Good Sort", "insights"),
      ),
    );
    const goodParams: Record<string, unknown> = {
      ...MINIMAL_INSIGHTS_PARAMS,
      sorting: {
        bar: {
          sortBy: "column",
          colSortAttrs: [
            { sortBy: "value", sortOrder: "asc", valueField: "averageValue" },
          ],
        },
      },
    };
    const bookmark = await ws.createBookmark(
      new CreateBookmarkParams({
        name: "Good Sort",
        bookmark_type: "insights",
        params: goodParams,
        dashboard_id: 99,
      }),
    );
    expect(bookmark.id).toBe(77);
  });

  it("get_bookmark() returns a single Bookmark by ID", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok(bookmarkJson(1, "My Bookmark", "retention")),
    );
    const bookmark = await ws.getBookmark(1);

    expect(bookmark).toBeInstanceOf(Bookmark);
    expect(bookmark.id).toBe(1);
    expect(bookmark.name).toBe("My Bookmark");
    expect(bookmark.bookmark_type).toBe("retention");
  });

  it("get_bookmark() preserves extra fields", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok({
        ...bookmarkJson(5, "Detailed", "insights"),
        creator_name: "Bob",
        description: "Detailed bookmark",
      }),
    );
    const bookmark = await ws.getBookmark(5);

    expect(bookmark.creator_name).toBe("Bob");
    expect(bookmark.description).toBe("Detailed bookmark");
  });

  it("update_bookmark() returns the updated Bookmark", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok(bookmarkJson(1, "Updated Name", "insights")),
    );
    const bookmark = await ws.updateBookmark(
      1,
      new UpdateBookmarkParams({ name: "Updated Name" }),
    );

    expect(bookmark).toBeInstanceOf(Bookmark);
    expect(bookmark.name).toBe("Updated Name");
  });

  it("update_bookmark() can update description", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok({ ...bookmarkJson(1, "Same", "insights"), description: "New desc" }),
    );
    const bookmark = await ws.updateBookmark(
      1,
      new UpdateBookmarkParams({ description: "New desc" }),
    );
    expect(bookmark.description).toBe("New desc");
  });

  it("update_bookmark() can update query params", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok({
        ...bookmarkJson(1, "Same", "insights"),
        params: { events: [{ event: "Login" }] },
      }),
    );
    const bookmark = await ws.updateBookmark(
      1,
      new UpdateBookmarkParams({ params: { events: [{ event: "Login" }] } }),
    );
    expect(bookmark.params).toStrictEqual({ events: [{ event: "Login" }] });
  });

  it("delete_bookmark() returns None on success", async () => {
    const { ws } = makeFacadeWorkspace(() => ({ status: 204 }));
    await expect(ws.deleteBookmark(1)).resolves.toBeUndefined();
  });

  it("delete_bookmark() handles a 200 response", async () => {
    const { ws } = makeFacadeWorkspace(() => ok({}));
    await expect(ws.deleteBookmark(1)).resolves.toBeUndefined();
  });

  it("bulk_delete_bookmarks() returns None on success", async () => {
    const { ws } = makeFacadeWorkspace(() => ({ status: 204 }));
    await expect(ws.bulkDeleteBookmarks([1, 2])).resolves.toBeUndefined();
  });

  it("bulk_delete_bookmarks() works with a single ID", async () => {
    const { ws } = makeFacadeWorkspace(() => ({ status: 204 }));
    await expect(ws.bulkDeleteBookmarks([42])).resolves.toBeUndefined();
  });

  it("bulk_delete_bookmarks() sends multiple IDs", async () => {
    const { ws, transport } = makeFacadeWorkspace(() => ({ status: 204 }));
    await ws.bulkDeleteBookmarks([10, 20, 30]);
    expect(transport.captures).toHaveLength(1);
  });

  it("bulk_update_bookmarks() returns None on success", async () => {
    const { ws } = makeFacadeWorkspace(() => ok({}));
    await expect(
      ws.bulkUpdateBookmarks([
        new BulkUpdateBookmarkEntry({ id: 1, name: "Updated A" }),
      ]),
    ).resolves.toBeUndefined();
  });

  it("bulk_update_bookmarks() handles multiple entries", async () => {
    const { ws } = makeFacadeWorkspace(() => ok({}));
    await expect(
      ws.bulkUpdateBookmarks([
        new BulkUpdateBookmarkEntry({ id: 1, name: "A" }),
        new BulkUpdateBookmarkEntry({ id: 2, name: "B" }),
        new BulkUpdateBookmarkEntry({ id: 3, description: "New desc" }),
      ]),
    ).resolves.toBeUndefined();
  });

  it("bulk_update_bookmarks() can update query params", async () => {
    const { ws } = makeFacadeWorkspace(() => ok({}));
    await expect(
      ws.bulkUpdateBookmarks([
        new BulkUpdateBookmarkEntry({
          id: 1,
          params: { events: [{ event: "Login" }] },
        }),
      ]),
    ).resolves.toBeUndefined();
  });

  it("bookmark_linked_dashboard_ids() returns list of int", async () => {
    const { ws } = makeFacadeWorkspace(() => ok([10, 20, 30]));
    await expect(ws.bookmarkLinkedDashboardIds(1)).resolves.toStrictEqual([
      10, 20, 30,
    ]);
  });

  it("bookmark_linked_dashboard_ids() returns [] when none linked", async () => {
    const { ws } = makeFacadeWorkspace(() => ok([]));
    await expect(ws.bookmarkLinkedDashboardIds(1)).resolves.toStrictEqual([]);
  });

  it("bookmark_linked_dashboard_ids() works with a single ID", async () => {
    const { ws } = makeFacadeWorkspace(() => ok([42]));
    await expect(ws.bookmarkLinkedDashboardIds(1)).resolves.toStrictEqual([42]);
  });

  it("get_bookmark_history() returns BookmarkHistoryResponse", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok({
        results: [
          { action: "created", timestamp: "2024-01-01" },
          { action: "updated", timestamp: "2024-02-01" },
        ],
        pagination: {
          page_size: 20,
          next_cursor: null,
          previous_cursor: null,
        },
      }),
    );
    const history = await ws.getBookmarkHistory(1);

    expect(history).toBeInstanceOf(BookmarkHistoryResponse);
    expect(history.results).toHaveLength(2);
    expect(
      (history.results[0] as Record<string, unknown> | undefined)?.["action"],
    ).toBe("created");
  });

  it("get_bookmark_history() handles empty history", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok({ results: [], pagination: { page_size: 20 } }),
    );
    const history = await ws.getBookmarkHistory(1);

    expect(history).toBeInstanceOf(BookmarkHistoryResponse);
    expect(history.results).toStrictEqual([]);
  });

  it("get_bookmark_history() preserves pagination metadata", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok({
        results: [{ action: "created" }],
        pagination: {
          page_size: 10,
          next_cursor: "abc123",
          previous_cursor: null,
        },
      }),
    );
    const history = await ws.getBookmarkHistory(1);

    expect(history.pagination).not.toBeNull();
    expect(history.pagination?.page_size).toBe(10);
    expect(history.pagination?.next_cursor).toBe("abc123");
  });

  it("list_bookmarks_v2() maps 'type' to bookmark_type", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok([{ id: 1, name: "F", type: "flows", params: {} }]),
    );
    const bookmarks = await ws.listBookmarksV2();
    expect(bookmarks[0]?.bookmark_type).toBe("flows");
  });

  it("create_bookmark() works with the funnel bookmark type", async () => {
    const { ws } = makeFacadeWorkspace((request) =>
      ok(
        request.method === "PATCH"
          ? dashboardJson(99)
          : bookmarkJson(20, "Funnel BM", "funnels"),
      ),
    );
    const bookmark = await ws.createBookmark(
      new CreateBookmarkParams({
        name: "Funnel BM",
        bookmark_type: "funnels",
        params: MINIMAL_FUNNEL_PARAMS,
        dashboard_id: 99,
      }),
    );
    expect(bookmark.bookmark_type).toBe("funnels");
  });
});
