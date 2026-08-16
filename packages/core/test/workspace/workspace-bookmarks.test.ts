// B6-W3 Layer-3 translation (packet `b6-packets.md` §5) of
// `tests/unit/test_workspace_bookmarks.py` — the WHOLE file:
// `TestListBookmarks` (:61), `TestQuerySavedReport` (:210) and
// `TestQueryFlows` (:450).
//
// Scope note: the three MEMBERS these classes exercise
// (`list_bookmarks`, `query_saved_report`, `query_saved_flows`) are
// B5's; the file is a FACADE-level lock (Python replaces `ws._discovery`
// / `ws._live_query` with MagicMocks), distinct from the already-green
// service-level suites (`services/discovery-bookmarks.test.ts`,
// `services/live-query-bookmarks.test.ts`). The packet assigns it to W3
// because it sits in the bookmark family; nothing here changes B5 code.
//
// Translation notes:
// - `ws._discovery = MagicMock()` / `ws._live_query = MagicMock()`
//   become `vi.spyOn(ws, "discoveryService"|"liveQueryService", "get")`
//   — the W1 `workspace-facade.test.ts` precedent for the same idiom.
// - `assert_called_once_with(bookmark_type=…)` reads the recorded call:
//   Python kwargs map to the TS positional / options bag with the SAME
//   VALUES.
// - DIVERGENCE (recorded, behaviour-neutral): Python's
//   `query_saved_report` facade FILLS `bookmark_type="insights"` before
//   forwarding (`workspace.py:1874-1879`); the TS facade forwards the
//   options bag and `LiveQueryService.querySavedReport`
//   (`live-query.ts:537`) applies the identical default, so the values
//   reaching the wire match. The translated assertions therefore read
//   the EFFECTIVE bag (`bookmark_type ?? "insights"`, `from_date ??
//   null`, `to_date ?? null`), which is exactly the four-kwarg tuple
//   Python asserts.
// - `try/finally: ws.close()` is kept (B6-W1 ported `close()`).

import { describe, expect, it, vi } from "vitest";
import { Workspace } from "../../src/workspace.js";
import {
  createMockClient,
  makeSession,
} from "../client/client-test-helpers.js";
import { BookmarkInfo } from "../../src/types/results/discovery.js";
import {
  FlowsResult,
  SavedReportResult,
} from "../../src/types/results/live-query.js";
import type { LiveQuerySavedReportOptions } from "../../src/services/live-query.js";

/** The `_TEST_SESSION` twin (`test_workspace_bookmarks.py:22-31`). */
const TEST_SESSION = makeSession({
  name: "test_account",
  projectId: "12345",
  username: "test_user",
  secret: "test_secret",
});

/**
 * The `workspace_factory` fixture twin (`:44-58`) — a facade over a
 * `MagicMock(spec=MixpanelAPIClient)` stand-in. The mock client is
 * never reached: every case stubs a service first.
 *
 * @returns The facade.
 */
function makeWorkspace(): Workspace {
  const { client } = createMockClient(TEST_SESSION, () => ({
    status: 200,
    json: { status: "ok", results: {} },
  }));
  return new Workspace({ session: TEST_SESSION, client });
}

/** The effective `query_saved_report` kwargs Python asserts on. */
interface EffectiveSavedReportCall {
  /** Positional `bookmark_id`. */
  readonly bookmark_id: number;
  /** `bookmark_type`, default-filled. */
  readonly bookmark_type: string;
  /** `from_date`, default-filled. */
  readonly from_date: string | null;
  /** `to_date`, default-filled. */
  readonly to_date: string | null;
}

/**
 * Normalize a recorded `querySavedReport(bookmarkId, options)` call to
 * the four-kwarg tuple Python's `assert_called_once_with` compares.
 *
 * @param bookmarkId - The recorded positional.
 * @param options - The recorded options bag.
 * @returns The effective kwargs.
 */
function effective(
  bookmarkId: number,
  options: LiveQuerySavedReportOptions,
): EffectiveSavedReportCall {
  return {
    bookmark_id: bookmarkId,
    bookmark_type: options.bookmark_type ?? "insights",
    from_date: options.from_date ?? null,
    to_date: options.to_date ?? null,
  };
}

describe("TestListBookmarks (test_workspace_bookmarks.py:61)", () => {
  it("list_bookmarks() delegates to DiscoveryService (:64)", async () => {
    const ws = makeWorkspace();
    const listBookmarks = vi.fn().mockResolvedValue([
      new BookmarkInfo({
        id: 12345,
        name: "Test Report",
        type: "insights",
        project_id: 100,
        created: "2024-01-01T00:00:00",
        modified: "2024-01-01T00:00:00",
      }),
    ]);
    vi.spyOn(ws, "discoveryService", "get").mockReturnValue({
      listBookmarks,
    } as never);

    const result = await ws.listBookmarks();

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(12345);
    expect(listBookmarks).toHaveBeenCalledTimes(1);
    await ws.close();
  });

  it("list_bookmarks() passes the bookmark_type filter (:92)", async () => {
    const ws = makeWorkspace();
    const listBookmarks = vi.fn().mockResolvedValue([]);
    vi.spyOn(ws, "discoveryService", "get").mockReturnValue({
      listBookmarks,
    } as never);

    await ws.listBookmarks("funnels");

    expect(listBookmarks).toHaveBeenCalledTimes(1);
    expect(listBookmarks).toHaveBeenCalledWith("funnels");
    await ws.close();
  });

  it("list_bookmarks() returns list[BookmarkInfo] (:111)", async () => {
    const ws = makeWorkspace();
    const listBookmarks = vi.fn().mockResolvedValue([
      new BookmarkInfo({
        id: 1,
        name: "Report A",
        type: "insights",
        project_id: 100,
        created: "2024-01-01T00:00:00",
        modified: "2024-01-01T00:00:00",
      }),
      new BookmarkInfo({
        id: 2,
        name: "Report B",
        type: "funnels",
        project_id: 100,
        created: "2024-01-01T00:00:00",
        modified: "2024-01-01T00:00:00",
      }),
    ]);
    vi.spyOn(ws, "discoveryService", "get").mockReturnValue({
      listBookmarks,
    } as never);

    const result = await ws.listBookmarks();

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result.every((b) => b instanceof BookmarkInfo)).toBe(true);
    await ws.close();
  });

  it("list_bookmarks() handles empty results (:147)", async () => {
    const ws = makeWorkspace();
    vi.spyOn(ws, "discoveryService", "get").mockReturnValue({
      listBookmarks: vi.fn().mockResolvedValue([]),
    } as never);

    expect(await ws.listBookmarks()).toEqual([]);
    await ws.close();
  });

  it("list_bookmarks() calls the service without a filter (:164)", async () => {
    const ws = makeWorkspace();
    const listBookmarks = vi.fn().mockResolvedValue([]);
    vi.spyOn(ws, "discoveryService", "get").mockReturnValue({
      listBookmarks,
    } as never);

    await ws.listBookmarks();

    expect(listBookmarks).toHaveBeenCalledTimes(1);
    expect(listBookmarks).toHaveBeenCalledWith(null);
    await ws.close();
  });

  it("list_bookmarks() accepts every valid type filter (:181)", async () => {
    const bookmarkTypes = [
      "insights",
      "funnels",
      "retention",
      "flows",
      "launch-analysis",
    ] as const;

    for (const bmType of bookmarkTypes) {
      const ws = makeWorkspace();
      const listBookmarks = vi.fn().mockResolvedValue([]);
      vi.spyOn(ws, "discoveryService", "get").mockReturnValue({
        listBookmarks,
      } as never);

      await ws.listBookmarks(bmType);

      expect(listBookmarks).toHaveBeenCalledTimes(1);
      expect(listBookmarks).toHaveBeenCalledWith(bmType);
      await ws.close();
    }
  });
});

describe("TestQuerySavedReport (test_workspace_bookmarks.py:210)", () => {
  it("query_saved_report() delegates to LiveQueryService (:213)", async () => {
    const ws = makeWorkspace();
    const calls: EffectiveSavedReportCall[] = [];
    const querySavedReport = vi
      .fn()
      .mockImplementation(
        (bookmarkId: number, options: LiveQuerySavedReportOptions = {}) => {
          calls.push(effective(bookmarkId, options));
          return Promise.resolve(
            new SavedReportResult({
              bookmark_id: 12345,
              computed_at: "2024-01-15T10:00:00",
              from_date: "2024-01-01",
              to_date: "2024-01-14",
              headers: ["$event"],
              series: { "Page View": { "2024-01-01": 100 } },
            }),
          );
        },
      );
    vi.spyOn(ws, "liveQueryService", "get").mockReturnValue({
      querySavedReport,
    } as never);

    const result = await ws.querySavedReport(12345);

    expect(result.bookmark_id).toBe(12345);
    expect(calls).toEqual([
      {
        bookmark_id: 12345,
        bookmark_type: "insights",
        from_date: null,
        to_date: null,
      },
    ]);
    await ws.close();
  });

  it("query_saved_report() reports the insights report_type (:245)", async () => {
    const ws = makeWorkspace();
    vi.spyOn(ws, "liveQueryService", "get").mockReturnValue({
      querySavedReport: vi.fn().mockResolvedValue(
        new SavedReportResult({
          bookmark_id: 12345,
          computed_at: "2024-01-15T10:00:00",
          from_date: "2024-01-01",
          to_date: "2024-01-14",
          headers: ["$event", "Date"],
          series: { "Page View": { "2024-01-01": 100 } },
        }),
      ),
    } as never);

    expect((await ws.querySavedReport(12345)).report_type).toBe("insights");
    await ws.close();
  });

  it("query_saved_report() reports the retention report_type (:271)", async () => {
    const ws = makeWorkspace();
    vi.spyOn(ws, "liveQueryService", "get").mockReturnValue({
      querySavedReport: vi.fn().mockResolvedValue(
        new SavedReportResult({
          bookmark_id: 12345,
          computed_at: "2024-01-15T10:00:00",
          from_date: "2024-01-01",
          to_date: "2024-01-14",
          headers: ["$retention"],
          series: {
            cohort: { "2024-01-01": { first: 100, counts: [80, 60] } },
          },
        }),
      ),
    } as never);

    expect((await ws.querySavedReport(12345)).report_type).toBe("retention");
    await ws.close();
  });

  it("query_saved_report() reports the funnel report_type (:297)", async () => {
    const ws = makeWorkspace();
    vi.spyOn(ws, "liveQueryService", "get").mockReturnValue({
      querySavedReport: vi.fn().mockResolvedValue(
        new SavedReportResult({
          bookmark_id: 12345,
          computed_at: "2024-01-15T10:00:00",
          from_date: "2024-01-01",
          to_date: "2024-01-14",
          headers: ["$funnel"],
          series: { count: 1000, overall_conv_ratio: 0.5 },
        }),
      ),
    } as never);

    expect((await ws.querySavedReport(12345)).report_type).toBe("funnel");
    await ws.close();
  });

  it("query_saved_report() returns a SavedReportResult (:323)", async () => {
    const ws = makeWorkspace();
    vi.spyOn(ws, "liveQueryService", "get").mockReturnValue({
      querySavedReport: vi.fn().mockResolvedValue(
        new SavedReportResult({
          bookmark_id: 12345,
          computed_at: "2024-01-15T10:00:00",
          from_date: "2024-01-01",
          to_date: "2024-01-14",
          headers: [],
          series: {},
        }),
      ),
    } as never);

    expect(await ws.querySavedReport(12345)).toBeInstanceOf(SavedReportResult);
    await ws.close();
  });

  it("query_saved_report() passes bookmark_type to the service (:349)", async () => {
    const ws = makeWorkspace();
    const calls: EffectiveSavedReportCall[] = [];
    vi.spyOn(ws, "liveQueryService", "get").mockReturnValue({
      querySavedReport: vi
        .fn()
        .mockImplementation(
          (bookmarkId: number, options: LiveQuerySavedReportOptions = {}) => {
            calls.push(effective(bookmarkId, options));
            return Promise.resolve(
              new SavedReportResult({
                bookmark_id: 12345,
                computed_at: "",
                from_date: "",
                to_date: "",
                headers: ["$funnel"],
                series: {},
              }),
            );
          },
        ),
    } as never);

    await ws.querySavedReport(12345, { bookmark_type: "funnels" });

    expect(calls).toEqual([
      {
        bookmark_id: 12345,
        bookmark_type: "funnels",
        from_date: null,
        to_date: null,
      },
    ]);
    await ws.close();
  });

  it("query_saved_report() passes from_date/to_date through (:380)", async () => {
    const ws = makeWorkspace();
    const calls: EffectiveSavedReportCall[] = [];
    vi.spyOn(ws, "liveQueryService", "get").mockReturnValue({
      querySavedReport: vi
        .fn()
        .mockImplementation(
          (bookmarkId: number, options: LiveQuerySavedReportOptions = {}) => {
            calls.push(effective(bookmarkId, options));
            return Promise.resolve(
              new SavedReportResult({
                bookmark_id: 12345,
                computed_at: "",
                from_date: "2024-06-01",
                to_date: "2024-06-30",
                headers: ["$funnel"],
                series: {},
              }),
            );
          },
        ),
    } as never);

    await ws.querySavedReport(12345, {
      bookmark_type: "funnels",
      from_date: "2024-06-01",
      to_date: "2024-06-30",
    });

    expect(calls).toEqual([
      {
        bookmark_id: 12345,
        bookmark_type: "funnels",
        from_date: "2024-06-01",
        to_date: "2024-06-30",
      },
    ]);
    await ws.close();
  });

  it("query_saved_report(bookmark_id) works without new params (:416)", async () => {
    const ws = makeWorkspace();
    const calls: EffectiveSavedReportCall[] = [];
    vi.spyOn(ws, "liveQueryService", "get").mockReturnValue({
      querySavedReport: vi
        .fn()
        .mockImplementation(
          (bookmarkId: number, options: LiveQuerySavedReportOptions = {}) => {
            calls.push(effective(bookmarkId, options));
            return Promise.resolve(
              new SavedReportResult({
                bookmark_id: 12345,
                computed_at: "",
                from_date: "",
                to_date: "",
                headers: ["$metric"],
                series: {},
              }),
            );
          },
        ),
    } as never);

    const result = await ws.querySavedReport(12345);

    expect(result).toBeInstanceOf(SavedReportResult);
    // Should default to insights
    expect(calls).toEqual([
      {
        bookmark_id: 12345,
        bookmark_type: "insights",
        from_date: null,
        to_date: null,
      },
    ]);
    await ws.close();
  });
});

describe("TestQueryFlows (test_workspace_bookmarks.py:450)", () => {
  it("query_saved_flows() delegates to LiveQueryService (:453)", async () => {
    const ws = makeWorkspace();
    const querySavedFlows = vi.fn().mockResolvedValue(
      new FlowsResult({
        bookmark_id: 12345,
        computed_at: "2024-01-15T10:00:00",
        steps: [{ step: 1, event: "Page View", count: 1000 }],
        breakdowns: [],
        overall_conversion_rate: 0.5,
      }),
    );
    vi.spyOn(ws, "liveQueryService", "get").mockReturnValue({
      querySavedFlows,
    } as never);

    const result = await ws.querySavedFlows(12345);

    expect(result.bookmark_id).toBe(12345);
    expect(querySavedFlows).toHaveBeenCalledTimes(1);
    expect(querySavedFlows).toHaveBeenCalledWith(12345);
    await ws.close();
  });

  it("query_saved_flows() returns a FlowsResult (:479)", async () => {
    const ws = makeWorkspace();
    vi.spyOn(ws, "liveQueryService", "get").mockReturnValue({
      querySavedFlows: vi.fn().mockResolvedValue(
        new FlowsResult({
          bookmark_id: 12345,
          computed_at: "2024-01-15T10:00:00",
        }),
      ),
    } as never);

    expect(await ws.querySavedFlows(12345)).toBeInstanceOf(FlowsResult);
    await ws.close();
  });

  it("query_saved_flows() returns steps and breakdowns (:501)", async () => {
    const ws = makeWorkspace();
    vi.spyOn(ws, "liveQueryService", "get").mockReturnValue({
      querySavedFlows: vi.fn().mockResolvedValue(
        new FlowsResult({
          bookmark_id: 12345,
          computed_at: "2024-01-15T10:00:00",
          steps: [
            { step: 1, event: "Page View", count: 1000 },
            { step: 2, event: "Add to Cart", count: 500 },
          ],
          breakdowns: [{ path: "Page View -> Add to Cart", count: 500 }],
          overall_conversion_rate: 0.5,
        }),
      ),
    } as never);

    const result = await ws.querySavedFlows(12345);

    expect(result.steps).toHaveLength(2);
    expect(result.breakdowns).toHaveLength(1);
    expect(result.overall_conversion_rate).toBe(0.5);
    await ws.close();
  });
});
