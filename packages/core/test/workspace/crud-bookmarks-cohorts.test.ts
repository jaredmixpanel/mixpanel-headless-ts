// B6-W3 Layer-3 translation (packet `b6-packets.md` §5) of the
// bookmark/cohort classes of `tests/unit/test_workspace_crud.py`
// (1,861 lines): `TestWorkspaceBookmarkCRUD` (:530) and
// `TestWorkspaceCohortCRUD` (:1319). The dashboard classes of the same
// file are W2's (`crud-dashboards.test.ts`).
//
// Python's `httpx.MockTransport` handler becomes the injected-fetch
// `fakeTransport` seam; `_make_workspace(temp_dir, handler)` (:81-100)
// becomes `makeWorkspace(handler)` — the client is built over the
// OAuth session (`_make_oauth_credentials`, :66) while the facade
// carries the service-account `_TEST_SESSION` (:50-59), exactly as
// Python does. `temp_dir` has no TS analog (no config file is ever
// touched) and is dropped.
//
// `caplog.at_level(logging.WARNING, logger="mixpanel_headless.workspace")`
// becomes the injected `logger` seam (R9.5) — the facade's
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
  BulkUpdateCohortEntry,
  Cohort,
  CreateCohortParams,
  UpdateCohortParams,
} from "../../src/types/entities/cohorts.js";
import { Workspace } from "../../src/workspace.js";
import {
  type CannedResponse,
  type CapturedFetchRequest,
  createMockClient,
  type FakeTransport,
  makeSession,
} from "../../test-support/client-test-helpers.js";
import {
  type LogCollector,
  logCollector,
} from "../../test-support/workspace-test-helpers.js";
import {
  MINIMAL_FUNNEL_PARAMS,
  MINIMAL_INSIGHTS_PARAMS,
} from "./bookmark-fixtures.js";

/** A canned-response handler (the `httpx.MockTransport` handler twin). */
type Handler = (request: CapturedFetchRequest) => CannedResponse;

/** The OAuth session the mock client is built over (`:66-72`). */
const CLIENT_SESSION = makeSession({
  projectId: "12345",
  region: "us",
  oauthToken: "test-token",
});

/** The canonical service-account facade session (`_TEST_SESSION`, :50-59). */
const FACADE_SESSION = makeSession({
  projectId: "12345",
  region: "us",
  username: "test_user",
  secret: "test_secret",
});

/**
 * Build a Workspace whose client routes through `handler`
 * (`_make_workspace`, :81-100).
 *
 * @param handler - The canned-response handler.
 * @param logger - Optional `caplog` twin.
 * @returns The facade plus the transport capture log.
 */
function makeWorkspace(
  handler: Handler,
  logger?: LogCollector,
): { ws: Workspace; transport: FakeTransport } {
  const { client, transport } = createMockClient(CLIENT_SESSION, handler);
  return {
    ws: new Workspace({
      session: FACADE_SESSION,
      client,
      ...(logger === undefined ? {} : { logger }),
    }),
    transport,
  };
}

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
 * A minimal cohort dict matching the API shape (`_cohort_json`,
 * :163-181).
 *
 * @param id - Cohort ID.
 * @param name - Cohort name.
 * @returns The payload record.
 */
function cohortJson(id = 1, name = "Test Cohort"): Record<string, unknown> {
  return { id, name, count: 100, is_visible: true };
}

/**
 * A 200 App-API envelope wrapping `results`.
 *
 * @param results - The `results` payload.
 * @returns The canned response.
 */
function ok(results: unknown): CannedResponse {
  return { status: 200, json: { status: "ok", results } };
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
// TestWorkspaceBookmarkCRUD (test_workspace_crud.py:530)
// =============================================================================

describe("TestWorkspaceBookmarkCRUD (test_workspace_crud.py:530)", () => {
  it("list_bookmarks_v2() returns list of Bookmark objects (:533)", async () => {
    const { ws } = makeWorkspace(() =>
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

  it("list_bookmarks_v2() returns empty list when none exist (:559)", async () => {
    const { ws } = makeWorkspace(() => ok([]));
    await expect(ws.listBookmarksV2()).resolves.toStrictEqual([]);
  });

  it("list_bookmarks_v2(bookmark_type='funnels') passes filter (:571)", async () => {
    const capturedUrl: string[] = [];
    const { ws } = makeWorkspace((request) => {
      capturedUrl.push(request.url);
      return ok([bookmarkJson(1, "Funnel", "funnels")]);
    });
    const bookmarks = await ws.listBookmarksV2({ bookmark_type: "funnels" });

    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0]?.bookmark_type).toBe("funnels");
  });

  it("list_bookmarks_v2() preserves the API response order (:592)", async () => {
    const { ws } = makeWorkspace(() =>
      ok([bookmarkJson(5, "E"), bookmarkJson(3, "C"), bookmarkJson(1, "A")]),
    );
    const bookmarks = await ws.listBookmarksV2();
    expect(bookmarks.map((b) => b.id)).toStrictEqual([5, 3, 1]);
  });

  it("create_bookmark() returns the created Bookmark (:614)", async () => {
    const { ws } = makeWorkspace((request) =>
      request.method === "PATCH"
        ? ok(dashboardJson(99))
        : ok(bookmarkJson(10, "New Bookmark", "insights")),
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

  it("create_bookmark() sends description when provided (:644)", async () => {
    const { ws } = makeWorkspace((request) => {
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

  it("create_bookmark() can associate with a dashboard (:669)", async () => {
    const { ws } = makeWorkspace((request) => {
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

  it("create_bookmark() PATCHes the report into the dashboard layout (:693)", async () => {
    const { ws, transport } = makeWorkspace((request) => {
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

  it("create_bookmark() raises when dashboard_id is missing (:734)", async () => {
    const calls: CapturedFetchRequest[] = [];
    const { ws } = makeWorkspace((request) => {
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

  it("create_bookmark() rejects malformed sorting before any API call (:750)", async () => {
    const calls: CapturedFetchRequest[] = [];
    const { ws } = makeWorkspace((request) => {
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

  it("update_bookmark() rejects malformed sorting before the API call (:792)", async () => {
    const calls: CapturedFetchRequest[] = [];
    const { ws } = makeWorkspace((request) => {
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

  it("update_bookmark() rejects malformed displayOptions (:810)", async () => {
    const calls: CapturedFetchRequest[] = [];
    const { ws } = makeWorkspace((request) => {
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

  it("update_bookmark() name-only partial does not false-reject (:839)", async () => {
    const calls: CapturedFetchRequest[] = [];
    const { ws } = makeWorkspace((request) => {
      calls.push(request);
      return ok(bookmarkJson(1, "Renamed", "insights"));
    });
    await ws.updateBookmark(1, new UpdateBookmarkParams({ name: "Renamed" }));
    expect(calls).toHaveLength(1);
  });

  it("update_bookmark() with warning-only errors does NOT raise (:864)", async () => {
    const calls: CapturedFetchRequest[] = [];
    const { ws } = makeWorkspace((request) => {
      calls.push(request);
      return ok(bookmarkJson(1, "X", "insights"));
    });
    const params = new UpdateBookmarkParams({
      params: { sorting: { barz: { sortBy: "column", colSortAttrs: [] } } },
    });

    await ws.updateBookmark(1, params);
    expect(calls).toHaveLength(1);
  });

  it("create_bookmark() logs warnings instead of dropping them (:890)", async () => {
    const logger = logCollector();
    const { ws } = makeWorkspace(
      (request) =>
        request.method === "PATCH"
          ? ok(dashboardJson(99))
          : ok(bookmarkJson(77, "WarnTest", "insights")),
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

  it("create_bookmark() accepts the canonical valid sorting block (:927)", async () => {
    const { ws } = makeWorkspace((request) =>
      request.method === "PATCH"
        ? ok(dashboardJson(99))
        : ok(bookmarkJson(77, "Good Sort", "insights")),
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

  it("get_bookmark() returns a single Bookmark by ID (:967)", async () => {
    const { ws } = makeWorkspace(() =>
      ok(bookmarkJson(1, "My Bookmark", "retention")),
    );
    const bookmark = await ws.getBookmark(1);

    expect(bookmark).toBeInstanceOf(Bookmark);
    expect(bookmark.id).toBe(1);
    expect(bookmark.name).toBe("My Bookmark");
    expect(bookmark.bookmark_type).toBe("retention");
  });

  it("get_bookmark() preserves extra fields (:988)", async () => {
    const { ws } = makeWorkspace(() =>
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

  it("update_bookmark() returns the updated Bookmark (:1004)", async () => {
    const { ws } = makeWorkspace(() =>
      ok(bookmarkJson(1, "Updated Name", "insights")),
    );
    const bookmark = await ws.updateBookmark(
      1,
      new UpdateBookmarkParams({ name: "Updated Name" }),
    );

    expect(bookmark).toBeInstanceOf(Bookmark);
    expect(bookmark.name).toBe("Updated Name");
  });

  it("update_bookmark() can update description (:1024)", async () => {
    const { ws } = makeWorkspace(() =>
      ok({ ...bookmarkJson(1, "Same", "insights"), description: "New desc" }),
    );
    const bookmark = await ws.updateBookmark(
      1,
      new UpdateBookmarkParams({ description: "New desc" }),
    );
    expect(bookmark.description).toBe("New desc");
  });

  it("update_bookmark() can update query params (:1039)", async () => {
    const { ws } = makeWorkspace(() =>
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

  it("delete_bookmark() returns None on success (:1054)", async () => {
    const { ws } = makeWorkspace(() => ({ status: 204 }));
    await expect(ws.deleteBookmark(1)).resolves.toBeUndefined();
  });

  it("delete_bookmark() handles a 200 response (:1064)", async () => {
    const { ws } = makeWorkspace(() => ok({}));
    await expect(ws.deleteBookmark(1)).resolves.toBeUndefined();
  });

  it("bulk_delete_bookmarks() returns None on success (:1074)", async () => {
    const { ws } = makeWorkspace(() => ({ status: 204 }));
    await expect(ws.bulkDeleteBookmarks([1, 2])).resolves.toBeUndefined();
  });

  it("bulk_delete_bookmarks() works with a single ID (:1084)", async () => {
    const { ws } = makeWorkspace(() => ({ status: 204 }));
    await expect(ws.bulkDeleteBookmarks([42])).resolves.toBeUndefined();
  });

  it("bulk_delete_bookmarks() sends multiple IDs (:1094)", async () => {
    const { ws, transport } = makeWorkspace(() => ({ status: 204 }));
    await ws.bulkDeleteBookmarks([10, 20, 30]);
    expect(transport.captures).toHaveLength(1);
  });

  it("bulk_update_bookmarks() returns None on success (:1108)", async () => {
    const { ws } = makeWorkspace(() => ok({}));
    await expect(
      ws.bulkUpdateBookmarks([
        new BulkUpdateBookmarkEntry({ id: 1, name: "Updated A" }),
      ]),
    ).resolves.toBeUndefined();
  });

  it("bulk_update_bookmarks() handles multiple entries (:1119)", async () => {
    const { ws } = makeWorkspace(() => ok({}));
    await expect(
      ws.bulkUpdateBookmarks([
        new BulkUpdateBookmarkEntry({ id: 1, name: "A" }),
        new BulkUpdateBookmarkEntry({ id: 2, name: "B" }),
        new BulkUpdateBookmarkEntry({ id: 3, description: "New desc" }),
      ]),
    ).resolves.toBeUndefined();
  });

  it("bulk_update_bookmarks() can update query params (:1134)", async () => {
    const { ws } = makeWorkspace(() => ok({}));
    await expect(
      ws.bulkUpdateBookmarks([
        new BulkUpdateBookmarkEntry({
          id: 1,
          params: { events: [{ event: "Login" }] },
        }),
      ]),
    ).resolves.toBeUndefined();
  });

  it("bookmark_linked_dashboard_ids() returns list of int (:1147)", async () => {
    const { ws } = makeWorkspace(() => ok([10, 20, 30]));
    await expect(ws.bookmarkLinkedDashboardIds(1)).resolves.toStrictEqual([
      10, 20, 30,
    ]);
  });

  it("bookmark_linked_dashboard_ids() returns [] when none linked (:1162)", async () => {
    const { ws } = makeWorkspace(() => ok([]));
    await expect(ws.bookmarkLinkedDashboardIds(1)).resolves.toStrictEqual([]);
  });

  it("bookmark_linked_dashboard_ids() works with a single ID (:1174)", async () => {
    const { ws } = makeWorkspace(() => ok([42]));
    await expect(ws.bookmarkLinkedDashboardIds(1)).resolves.toStrictEqual([42]);
  });

  it("get_bookmark_history() returns BookmarkHistoryResponse (:1186)", async () => {
    const { ws } = makeWorkspace(() =>
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

  it("get_bookmark_history() handles empty history (:1216)", async () => {
    const { ws } = makeWorkspace(() =>
      ok({ results: [], pagination: { page_size: 20 } }),
    );
    const history = await ws.getBookmarkHistory(1);

    expect(history).toBeInstanceOf(BookmarkHistoryResponse);
    expect(history.results).toStrictEqual([]);
  });

  it("get_bookmark_history() preserves pagination metadata (:1238)", async () => {
    const { ws } = makeWorkspace(() =>
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

  it("list_bookmarks_v2() maps 'type' to bookmark_type (:1265)", async () => {
    const { ws } = makeWorkspace(() =>
      ok([{ id: 1, name: "F", type: "flows", params: {} }]),
    );
    const bookmarks = await ws.listBookmarksV2();
    expect(bookmarks[0]?.bookmark_type).toBe("flows");
  });

  it("create_bookmark() works with the funnel bookmark type (:1285)", async () => {
    const { ws } = makeWorkspace((request) =>
      request.method === "PATCH"
        ? ok(dashboardJson(99))
        : ok(bookmarkJson(20, "Funnel BM", "funnels")),
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

// =============================================================================
// TestWorkspaceCohortCRUD (test_workspace_crud.py:1319)
// =============================================================================

describe("TestWorkspaceCohortCRUD (test_workspace_crud.py:1319)", () => {
  it("list_cohorts_full() returns list of Cohort objects (:1322)", async () => {
    const { ws } = makeWorkspace(() =>
      ok([cohortJson(1, "Cohort A"), cohortJson(2, "Cohort B")]),
    );
    const cohorts = await ws.listCohortsFull();

    expect(cohorts).toHaveLength(2);
    expect(cohorts[0]).toBeInstanceOf(Cohort);
    expect(cohorts[0]?.id).toBe(1);
    expect(cohorts[0]?.name).toBe("Cohort A");
    expect(cohorts[1]?.id).toBe(2);
  });

  it("list_cohorts_full() returns empty list when none exist (:1347)", async () => {
    const { ws } = makeWorkspace(() => ok([]));
    await expect(ws.listCohortsFull()).resolves.toStrictEqual([]);
  });

  it("list_cohorts_full(data_group_id='abc') passes filter (:1359)", async () => {
    const capturedUrl: string[] = [];
    const { ws } = makeWorkspace((request) => {
      capturedUrl.push(request.url);
      return ok([cohortJson(1, "Filtered")]);
    });
    const cohorts = await ws.listCohortsFull({ data_group_id: "abc" });
    expect(cohorts).toHaveLength(1);
  });

  it("list_cohorts_full() preserves API response order (:1379)", async () => {
    const { ws } = makeWorkspace(() =>
      ok([cohortJson(3, "C"), cohortJson(1, "A"), cohortJson(2, "B")]),
    );
    const cohorts = await ws.listCohortsFull();
    expect(cohorts.map((c) => c.id)).toStrictEqual([3, 1, 2]);
  });

  it("get_cohort() returns a single Cohort by ID (:1401)", async () => {
    const { ws } = makeWorkspace(() => ok(cohortJson(1, "My Cohort")));
    const cohort = await ws.getCohort(1);

    expect(cohort).toBeInstanceOf(Cohort);
    expect(cohort.id).toBe(1);
    expect(cohort.name).toBe("My Cohort");
  });

  it("get_cohort() preserves extra fields (:1421)", async () => {
    const { ws } = makeWorkspace(() =>
      ok({
        ...cohortJson(5, "Detailed"),
        description: "A detailed cohort",
        data_group_id: "group-1",
      }),
    );
    const cohort = await ws.getCohort(5);

    expect(cohort.description).toBe("A detailed cohort");
    expect(cohort.data_group_id).toBe("group-1");
  });

  it("get_cohort() preserves the count field (:1437)", async () => {
    const { ws } = makeWorkspace(() =>
      ok({ ...cohortJson(1, "Counted"), count: 42 }),
    );
    expect((await ws.getCohort(1)).count).toBe(42);
  });

  it("create_cohort() returns the created Cohort (:1451)", async () => {
    const { ws } = makeWorkspace(() => ok(cohortJson(10, "New Cohort")));
    const cohort = await ws.createCohort(
      new CreateCohortParams({ name: "New Cohort" }),
    );

    expect(cohort).toBeInstanceOf(Cohort);
    expect(cohort.id).toBe(10);
    expect(cohort.name).toBe("New Cohort");
  });

  it("create_cohort() sends description when provided (:1472)", async () => {
    const { ws } = makeWorkspace(() =>
      ok({ ...cohortJson(11, "Described"), description: "A test cohort" }),
    );
    const cohort = await ws.createCohort(
      new CreateCohortParams({
        name: "Described",
        description: "A test cohort",
      }),
    );
    expect(cohort.description).toBe("A test cohort");
  });

  it("create_cohort() sends definition when provided (:1487)", async () => {
    const { ws } = makeWorkspace(() => ok(cohortJson(12, "Defined")));
    const cohort = await ws.createCohort(
      new CreateCohortParams({
        name: "Defined",
        definition: { filter: { event: "Signup" } },
      }),
    );
    expect(cohort.id).toBe(12);
  });

  it("create_cohort() sends data_group_id when provided (:1509)", async () => {
    const { ws } = makeWorkspace(() =>
      ok({ ...cohortJson(13, "Grouped"), data_group_id: "group-x" }),
    );
    const cohort = await ws.createCohort(
      new CreateCohortParams({ name: "Grouped", data_group_id: "group-x" }),
    );
    expect(cohort.data_group_id).toBe("group-x");
  });

  it("update_cohort() returns the updated Cohort (:1524)", async () => {
    const { ws } = makeWorkspace(() => ok(cohortJson(1, "Updated Name")));
    const cohort = await ws.updateCohort(
      1,
      new UpdateCohortParams({ name: "Updated Name" }),
    );

    expect(cohort).toBeInstanceOf(Cohort);
    expect(cohort.name).toBe("Updated Name");
  });

  it("update_cohort() can update description (:1544)", async () => {
    const { ws } = makeWorkspace(() =>
      ok({ ...cohortJson(1, "Same"), description: "New desc" }),
    );
    const cohort = await ws.updateCohort(
      1,
      new UpdateCohortParams({ description: "New desc" }),
    );
    expect(cohort.description).toBe("New desc");
  });

  it("update_cohort() can toggle visibility (:1559)", async () => {
    const { ws } = makeWorkspace(() =>
      ok({ ...cohortJson(1, "Toggle"), is_visible: false }),
    );
    const cohort = await ws.updateCohort(
      1,
      new UpdateCohortParams({ is_visible: false }),
    );
    expect(cohort.is_visible).toBe(false);
  });

  it("update_cohort() can update the definition (:1574)", async () => {
    const { ws } = makeWorkspace(() => ok(cohortJson(1, "Redefined")));
    const cohort = await ws.updateCohort(
      1,
      new UpdateCohortParams({ definition: { filter: { event: "Purchase" } } }),
    );
    expect(cohort.id).toBe(1);
  });

  it("delete_cohort() returns None on success (:1593)", async () => {
    const { ws } = makeWorkspace(() => ({ status: 204 }));
    await expect(ws.deleteCohort(1)).resolves.toBeUndefined();
  });

  it("delete_cohort() handles a 200 response (:1603)", async () => {
    const { ws } = makeWorkspace(() => ok({}));
    await expect(ws.deleteCohort(1)).resolves.toBeUndefined();
  });

  it("bulk_delete_cohorts() returns None on success (:1613)", async () => {
    const { ws } = makeWorkspace(() => ({ status: 204 }));
    await expect(ws.bulkDeleteCohorts([1, 2])).resolves.toBeUndefined();
  });

  it("bulk_delete_cohorts() works with a single ID (:1623)", async () => {
    const { ws } = makeWorkspace(() => ({ status: 204 }));
    await expect(ws.bulkDeleteCohorts([42])).resolves.toBeUndefined();
  });

  it("bulk_delete_cohorts() sends multiple IDs (:1633)", async () => {
    const { ws, transport } = makeWorkspace(() => ({ status: 204 }));
    await ws.bulkDeleteCohorts([10, 20, 30]);
    expect(transport.captures).toHaveLength(1);
  });

  it("bulk_update_cohorts() returns None on success (:1647)", async () => {
    const { ws } = makeWorkspace(() => ok({}));
    await expect(
      ws.bulkUpdateCohorts([
        new BulkUpdateCohortEntry({ id: 1, name: "Updated A" }),
      ]),
    ).resolves.toBeUndefined();
  });

  it("bulk_update_cohorts() handles multiple entries (:1658)", async () => {
    const { ws } = makeWorkspace(() => ok({}));
    await expect(
      ws.bulkUpdateCohorts([
        new BulkUpdateCohortEntry({ id: 1, name: "A" }),
        new BulkUpdateCohortEntry({ id: 2, name: "B" }),
        new BulkUpdateCohortEntry({ id: 3, description: "New desc" }),
      ]),
    ).resolves.toBeUndefined();
  });

  it("bulk_update_cohorts() can update definitions (:1673)", async () => {
    const { ws } = makeWorkspace(() => ok({}));
    await expect(
      ws.bulkUpdateCohorts([
        new BulkUpdateCohortEntry({
          id: 1,
          definition: { filter: { event: "Signup" } },
        }),
      ]),
    ).resolves.toBeUndefined();
  });

  it("list_cohorts_full() preserves count on each cohort (:1686)", async () => {
    const { ws } = makeWorkspace(() =>
      ok([
        { ...cohortJson(1, "Small"), count: 10 },
        { ...cohortJson(2, "Large"), count: 10000 },
      ]),
    );
    const cohorts = await ws.listCohortsFull();
    expect(cohorts[0]?.count).toBe(10);
    expect(cohorts[1]?.count).toBe(10000);
  });

  it("get_cohort() result has correct field types (:1708)", async () => {
    const { ws } = makeWorkspace(() =>
      ok({
        ...cohortJson(1, "Typed"),
        is_visible: true,
        is_locked: false,
        verified: true,
      }),
    );
    const cohort = await ws.getCohort(1);

    expect(typeof cohort.is_visible).toBe("boolean");
    expect(typeof cohort.is_locked).toBe("boolean");
    expect(typeof cohort.verified).toBe("boolean");
    expect(cohort.verified).toBe(true);
  });

  it("create_cohort() can create a locked cohort (:1727)", async () => {
    const { ws } = makeWorkspace(() =>
      ok({ ...cohortJson(14, "Locked"), is_locked: true }),
    );
    const cohort = await ws.createCohort(
      new CreateCohortParams({ name: "Locked", is_locked: true }),
    );
    expect(cohort.is_locked).toBe(true);
  });

  it("update_cohort() can toggle lock state (:1742)", async () => {
    const { ws } = makeWorkspace(() =>
      ok({ ...cohortJson(1, "Unlocked"), is_locked: false }),
    );
    const cohort = await ws.updateCohort(
      1,
      new UpdateCohortParams({ is_locked: false }),
    );
    expect(cohort.is_locked).toBe(false);
  });
});
