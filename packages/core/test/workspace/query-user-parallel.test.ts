// Translated parallel query-user tests (B5-S2, packet §3): assertion-
// for-assertion port of tests/test_workspace_query_user_parallel.py
// — ALL 10 classes (TestParallelSinglePageSkip :239,
// TestParallelMultiPageFetch :323, TestParallelLimitAwareDispatch :509,
// TestParallelFailedPageHandling :651, TestParallelWorkerCap :799,
// TestParallelRateLimitWarning :899, TestParallelAggregateValidation
// :997, TestParallelEarlyExitOnLimit :1062, TestParallelResultStructure
// :1184, TestParallelErrorPropagation :1291).
//
// Translation notes:
// - `mock_api_client` / `workspace_factory` come from the shared
//   `workspace-test-helpers.ts` (which also records why the Python
//   `finally: ws.close()` has no TS twin).
// - `caplog.at_level(logging.WARNING)` becomes the injected
//   {@link logCollector} (R9.5 — `core` has no logging module); the
//   substring assertions run against `collector.warnings`.
// - `result.df.columns[0]` / `len(result.df)` become `rowColumns()[0]`
//   / `toRows().length` (C6).
// - Python's `ThreadPoolExecutor` is the bounded promise scheduler; the
//   observable contracts these tests pin (call COUNT, page ORDER in the
//   result, failed-page bookkeeping, coded-error propagation) are
//   identical, which is exactly what the packet's "SAME worker-cap,
//   page-ordering, early-exit-on-limit, and failed-page semantics"
//   requires.
// - `mock.side_effect = [page0, SomeError(...)]` (an iterable side
//   effect) becomes a handler that returns page 0 and throws the coded
//   error for every later page — the same first-failure behaviour with
//   `workers=2`.

import { describe, expect, it } from "vitest";

import {
  AuthenticationError,
  BookmarkValidationError,
  QueryError,
  RateLimitError,
  ServerError,
} from "../../src/errors.js";
import { UserQueryResult } from "../../src/types/results/query-engine.js";
import { codesOf } from "../../test-support/error-codes.js";
import { expectRejects } from "../../test-support/raises.js";
import {
  logCollector,
  makePageResult,
  makeProfilesBatch,
  makeStubWorkspace,
  type MockWorkspaceClient,
  mockWorkspaceClient,
  pageSideEffectFactory,
} from "../../test-support/workspace-test-helpers.js";

// ===========================================================================
// Single-page result skips parallel overhead
// ===========================================================================

describe("Parallel single page skip", () => {
  // python: TestParallelSinglePageSkip
  it("returns all profiles without parallel dispatch", async () => {
    const mock = mockWorkspaceClient();
    const profiles = makeProfilesBatch(0, 3);
    mock.setPageHandler(() =>
      makePageResult(profiles, {
        page: 0,
        total: 3,
        page_size: 1000,
        session_id: "sess_single",
        has_more: false,
      }),
    );

    const ws = makeStubWorkspace(mock);
    const result = await ws.queryUser({
      mode: "profiles",
      parallel: true,
      limit: 100_000,
    });

    expect(result).toBeInstanceOf(UserQueryResult);
    expect(result.profiles).toHaveLength(3);
    // Only page 0 should be fetched — no parallel pages dispatched
    expect(mock.exportPageCalls).toHaveLength(1);
  });

  it("meta reports pages_fetched=1 for a single page", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(() =>
      makePageResult(makeProfilesBatch(0, 5), {
        page: 0,
        total: 5,
        page_size: 1000,
        session_id: "sess_meta",
        has_more: false,
      }),
    );

    const result = await makeStubWorkspace(mock).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 100_000,
    });

    expect(result.meta["pages_fetched"]).toBe(1);
  });

  it("total is preserved for single-page results", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(() =>
      makePageResult(makeProfilesBatch(0, 2), {
        page: 0,
        total: 2,
        page_size: 1000,
        session_id: "sess_total",
        has_more: false,
      }),
    );

    const result = await makeStubWorkspace(mock).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 100_000,
    });

    expect(result.total).toBe(2);
  });
});

// ===========================================================================
// Multi-page parallel fetch collects all profiles
// ===========================================================================

describe("Parallel multi page fetch", () => {
  // python: TestParallelMultiPageFetch
  it("collects all profiles across pages", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(pageSideEffectFactory(250, 100));

    const result = await makeStubWorkspace(mock).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 100_000,
    });

    expect(result.profiles).toHaveLength(250);
    expect(result.total).toBe(250);
  });

  it("makes exactly ceil(limit/page_size) API calls", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(pageSideEffectFactory(250, 100));

    await makeStubWorkspace(mock).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 250,
    });

    expect(mock.exportPageCalls).toHaveLength(Math.ceil(250 / 100)); // 3
  });

  it("meta indicates parallel mode", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(pageSideEffectFactory(200, 100));

    const result = await makeStubWorkspace(mock).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 100_000,
    });

    expect(result.meta["parallel"]).toBe(true);
  });

  it("meta reports total pages fetched including page 0", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(pageSideEffectFactory(500, 100));

    const result = await makeStubWorkspace(mock).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 500,
    });

    expect(result.meta["pages_fetched"]).toBe(Math.ceil(500 / 100)); // 5
  });

  it("preserves the page-0 session_id in meta", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(pageSideEffectFactory(200, 100, "sess_keepme"));

    const result = await makeStubWorkspace(mock).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 100_000,
    });

    expect(result.meta["session_id"]).toBe("sess_keepme");
  });

  it("subsequent pages use the session_id from page 0", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(pageSideEffectFactory(300, 100, "sess_shared"));

    await makeStubWorkspace(mock).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 100_000,
    });

    // All calls after page 0 should pass session_id
    for (const call of mock.exportPageCalls.slice(1)) {
      expect(call.options["session_id"]).toBe("sess_shared");
    }
  });

  it("normalizes profiles from parallel pages", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(pageSideEffectFactory(200, 100));

    const result = await makeStubWorkspace(mock).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 100_000,
    });

    for (const profile of result.profiles) {
      expect(Object.hasOwn(profile, "distinct_id")).toBe(true);
      expect(Object.hasOwn(profile, "$distinct_id")).toBe(false);
      expect(Object.hasOwn(profile, "last_seen")).toBe(true);
      expect(Object.hasOwn(profile, "properties")).toBe(true);
    }
  });

  it("returns a proper UserQueryResult", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(pageSideEffectFactory(200, 100));

    const result = await makeStubWorkspace(mock).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 100_000,
    });

    expect(result).toBeInstanceOf(UserQueryResult);
    expect(result.mode).toBe("profiles");
    expect(result.aggregate_data).toBeNull();
  });
});

// ===========================================================================
// Limit-aware dispatch
// ===========================================================================

describe("Parallel limit aware dispatch", () => {
  // python: TestParallelLimitAwareDispatch
  it("limit below total dispatches fewer pages", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(pageSideEffectFactory(500, 100));

    await makeStubWorkspace(mock).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 150,
    });

    expect(mock.exportPageCalls).toHaveLength(Math.ceil(150 / 100)); // 2
  });

  it("truncates the result to exactly the limit", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(pageSideEffectFactory(500, 100));

    const result = await makeStubWorkspace(mock).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 150,
    });

    expect(result.profiles).toHaveLength(150);
  });

  it("total equals len(profiles), not the API's full count", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(pageSideEffectFactory(5000, 1000));

    const result = await makeStubWorkspace(mock).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 100,
    });

    expect(result.total).toBe(result.profiles.length);
    expect(result.total).toBe(100);
  });

  it("limit equal to page_size fetches exactly one page", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(pageSideEffectFactory(5000, 1000));

    const result = await makeStubWorkspace(mock).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 1000,
    });

    // ceil(1000/1000) = 1, so only page 0
    expect(mock.exportPageCalls).toHaveLength(1);
    expect(result.profiles).toHaveLength(1000);
  });

  it("limit = page_size + 1 requires two pages", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(pageSideEffectFactory(5000, 1000));

    const result = await makeStubWorkspace(mock).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 1001,
    });

    // ceil(1001/1000) = 2
    expect(mock.exportPageCalls).toHaveLength(2);
    expect(result.profiles).toHaveLength(1001);
  });

  it("limit = total fetches all pages", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(pageSideEffectFactory(350, 100));

    const result = await makeStubWorkspace(mock).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 350,
    });

    expect(mock.exportPageCalls).toHaveLength(Math.ceil(350 / 100)); // 4
    expect(result.profiles).toHaveLength(350);
  });
});

// ===========================================================================
// Failed page handling
// ===========================================================================

describe("Parallel failed page handling", () => {
  // python: TestParallelFailedPageHandling
  it("a failed page still returns the remaining profiles", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(
      pageSideEffectFactory(300, 100, "sess_parallel", new Set([1])),
    );

    const result = await makeStubWorkspace(mock, logCollector()).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 100_000,
    });

    // Pages 0 and 2 succeed (200 profiles); page 1's 100 are missing
    expect(result.profiles).toHaveLength(200);
  });

  it("records the failed page number in meta", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(
      pageSideEffectFactory(300, 100, "sess_parallel", new Set([2])),
    );

    const result = await makeStubWorkspace(mock, logCollector()).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 100_000,
    });

    expect(Object.hasOwn(result.meta, "failed_pages")).toBe(true);
    expect(result.meta["failed_pages"]).toContain(2);
  });

  it("records every failed page", async () => {
    const mock = mockWorkspaceClient();
    const failPages = new Set([1, 3]);
    mock.setPageHandler(
      pageSideEffectFactory(500, 100, "sess_parallel", failPages),
    );

    const result = await makeStubWorkspace(mock, logCollector()).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 100_000,
    });

    expect(Object.hasOwn(result.meta, "failed_pages")).toBe(true);
    for (const fp of failPages) {
      expect(result.meta["failed_pages"]).toContain(fp);
    }
  });

  it("logs a warning for a failed page", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(
      pageSideEffectFactory(200, 100, "sess_parallel", new Set([1])),
    );
    const log = logCollector();

    await makeStubWorkspace(mock, log).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 100_000,
    });

    expect(
      log.warnings.some(
        (msg) =>
          msg.toLowerCase().includes("page") ||
          msg.toLowerCase().includes("fail"),
      ),
    ).toBe(true);
  });

  it("a failed page with no logger injected still resolves (default logger is a no-op)", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(
      pageSideEffectFactory(200, 100, "sess_parallel", new Set([1])),
    );

    const result = await makeStubWorkspace(mock).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 100_000,
    });

    expect(result.meta["failed_pages"]).toStrictEqual([1]);
  });

  it("failed_pages is empty when every page succeeds", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(pageSideEffectFactory(200, 100));

    const result = await makeStubWorkspace(mock).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 100_000,
    });

    const failed = (result.meta["failed_pages"] ?? []) as readonly number[];
    expect(failed).toHaveLength(0);
  });

  it("total equals len(profiles) despite failed pages", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(
      pageSideEffectFactory(300, 100, "sess_parallel", new Set([1])),
    );

    const result = await makeStubWorkspace(mock, logCollector()).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 100_000,
    });

    expect(result.total).toBe(result.profiles.length);
  });
});

// ===========================================================================
// Worker cap enforcement
// ===========================================================================

describe("Parallel worker cap", () => {
  // python: TestParallelWorkerCap
  it("workers > 5 triggers validation error U23", async () => {
    const ws = makeStubWorkspace(mockWorkspaceClient());
    const error = await expectRejects(
      ws.queryUser({
        mode: "profiles",
        parallel: true,
        workers: 10,
        limit: 100_000,
      }),
      "expected BookmarkValidationError",
    );
    expect(error).toBeInstanceOf(BookmarkValidationError);
    expect(codesOf(error)).toContain("U23");
  });

  it("workers = 0 triggers validation error U23", async () => {
    const ws = makeStubWorkspace(mockWorkspaceClient());
    const error = await expectRejects(
      ws.queryUser({
        mode: "profiles",
        parallel: true,
        workers: 0,
        limit: 100_000,
      }),
      "expected BookmarkValidationError",
    );
    expect(codesOf(error)).toContain("U23");
  });

  it("negative workers triggers validation error U23", async () => {
    const ws = makeStubWorkspace(mockWorkspaceClient());
    const error = await expectRejects(
      ws.queryUser({
        mode: "profiles",
        parallel: true,
        workers: -1,
        limit: 100_000,
      }),
      "expected BookmarkValidationError",
    );
    expect(codesOf(error)).toContain("U23");
  });

  it("workers = 5 (the maximum) is accepted", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(pageSideEffectFactory(50, 1000));

    const result = await makeStubWorkspace(mock).queryUser({
      mode: "profiles",
      parallel: true,
      workers: 5,
      limit: 100_000,
    });

    expect(result).toBeInstanceOf(UserQueryResult);
  });

  it("workers = 1 (the minimum) is accepted", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(pageSideEffectFactory(50, 1000));

    const result = await makeStubWorkspace(mock).queryUser({
      mode: "profiles",
      parallel: true,
      workers: 1,
      limit: 100_000,
    });

    expect(result).toBeInstanceOf(UserQueryResult);
  });
});

// ===========================================================================
// Rate-limit warning when pages > 48
// ===========================================================================

describe("Parallel rate limit warning", () => {
  // python: TestParallelRateLimitWarning
  it("49 pages emits a rate-limit warning", async () => {
    const mock = mockWorkspaceClient();
    // 49 pages of 100 = 4900 total profiles
    mock.setPageHandler(pageSideEffectFactory(4900, 100));
    const log = logCollector();

    await makeStubWorkspace(mock, log).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 100_000,
    });

    expect(
      log.warnings.some(
        (msg) => msg.toLowerCase().includes("rate") || msg.includes("48"),
      ),
    ).toBe(true);
  });

  it("48 pages emits no rate-limit warning", async () => {
    const mock = mockWorkspaceClient();
    // 48 pages of 100 = 4800 total profiles
    mock.setPageHandler(pageSideEffectFactory(4800, 100));
    const log = logCollector();

    await makeStubWorkspace(mock, log).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 4800,
    });

    const rateWarnings = log.warnings.filter(
      (msg) => msg.toLowerCase().includes("rate") || msg.includes("48"),
    );
    expect(rateWarnings).toHaveLength(0);
  });

  it("a limit that reduces pages below the threshold emits no warning", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(pageSideEffectFactory(10000, 100));
    const log = logCollector();

    // limit=100 -> ceil(100/100) = 1 page -> no warning
    await makeStubWorkspace(mock, log).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 100,
    });

    const rateWarnings = log.warnings.filter(
      (msg) => msg.toLowerCase().includes("rate") || msg.includes("48"),
    );
    expect(rateWarnings).toHaveLength(0);
  });
});

// ===========================================================================
// parallel=True with mode="aggregate" produces U18
// ===========================================================================

describe("Parallel aggregate validation", () => {
  // python: TestParallelAggregateValidation
  it("parallel + aggregate raises U18", async () => {
    const ws = makeStubWorkspace(mockWorkspaceClient());
    const error = await expectRejects(
      ws.queryUser({ parallel: true, mode: "aggregate" }),
      "expected BookmarkValidationError",
    );
    expect(error).toBeInstanceOf(BookmarkValidationError);
    expect(codesOf(error)).toContain("U18");
  });

  it("the U18 message mentions profiles mode", async () => {
    const ws = makeStubWorkspace(mockWorkspaceClient());
    const error = await expectRejects(
      ws.queryUser({ parallel: true, mode: "aggregate" }),
      "expected BookmarkValidationError",
    );
    const u18 = (error as BookmarkValidationError).errors.filter(
      (e) => e.code === "U18",
    );
    expect(u18).toHaveLength(1);
    expect(u18[0]!.message.toLowerCase()).toContain("profiles");
  });

  it("parallel=false with aggregate is accepted", async () => {
    const mock = mockWorkspaceClient();
    mock.setEngageStats({
      results: 42,
      status: "ok",
      computed_at: "2025-01-15T10:00:00",
    });

    const result = await makeStubWorkspace(mock).queryUser({
      mode: "aggregate",
    });

    expect(result).toBeInstanceOf(UserQueryResult);
  });
});

// ===========================================================================
// Early exit when the limit is reached mid-fetch
// ===========================================================================

describe("Parallel early exit on limit", () => {
  // python: TestParallelEarlyExitOnLimit
  it("truncates after parallel collection", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(pageSideEffectFactory(500, 100));

    const result = await makeStubWorkspace(mock).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 250,
    });

    expect(result.profiles).toHaveLength(250);
  });

  it("a limit smaller than page_size needs only page 0", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(pageSideEffectFactory(5000, 1000));

    const result = await makeStubWorkspace(mock).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 50,
    });

    // ceil(50/1000) = 1, only page 0
    expect(mock.exportPageCalls).toHaveLength(1);
    expect(result.profiles).toHaveLength(50);
  });

  it("the default limit=1 with parallel returns exactly one profile", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(pageSideEffectFactory(5000, 1000));
    const log = logCollector();

    // Default limit=1 routes to the SEQUENTIAL path (parallel ignored)
    const result = await makeStubWorkspace(mock, log).queryUser({
      mode: "profiles",
      parallel: true,
    });

    expect(result.profiles).toHaveLength(1);
    expect(mock.exportPageCalls).toHaveLength(1);
  });

  it("a limit requiring a partial last page truncates correctly", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(pageSideEffectFactory(500, 100));

    const result = await makeStubWorkspace(mock).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 350,
    });

    expect(result.profiles).toHaveLength(350);
    // ceil(350/100) = 4 pages
    expect(mock.exportPageCalls).toHaveLength(Math.ceil(350 / 100));
  });

  it("a limit above total returns all available profiles", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(pageSideEffectFactory(150, 100));

    const result = await makeStubWorkspace(mock).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 500,
    });

    expect(result.profiles).toHaveLength(150);
    expect(result.total).toBe(150);
  });
});

// ===========================================================================
// computed_at and result structure
// ===========================================================================

describe("Parallel result structure", () => {
  // python: TestParallelResultStructure
  it("includes a non-empty computed_at timestamp", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(pageSideEffectFactory(200, 100));

    const result = await makeStubWorkspace(mock).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 100_000,
    });

    expect(typeof result.computed_at).toBe("string");
    expect(result.computed_at.length).toBeGreaterThan(0);
  });

  it("includes the params dict used for the query", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(pageSideEffectFactory(200, 100));

    const result = await makeStubWorkspace(mock).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 100_000,
    });

    expect(typeof result.params).toBe("object");
    expect(result.params).not.toBeNull();
  });

  it("frame columns start with distinct_id then last_seen", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(pageSideEffectFactory(200, 100));

    const result = await makeStubWorkspace(mock).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 100_000,
    });

    const columns = result.rowColumns();
    expect(columns[0]).toBe("distinct_id");
    expect(columns[1]).toBe("last_seen");
  });

  it("frame row count matches the number of profiles", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(pageSideEffectFactory(250, 100));

    const result = await makeStubWorkspace(mock).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 100_000,
    });

    expect(result.toRows()).toHaveLength(250);
  });

  it("distinct_ids matches the profile distinct_id values", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(pageSideEffectFactory(150, 100));

    const result = await makeStubWorkspace(mock).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 100_000,
    });

    const profileIds = result.profiles.map((p) => p["distinct_id"]);
    expect(result.distinct_ids).toStrictEqual(profileIds);
  });
});

// ===========================================================================
// Systemic exceptions propagate immediately
// ===========================================================================

describe("Parallel error propagation", () => {
  // python: TestParallelErrorPropagation
  /**
   * The `side_effect = [page0, <error>]` twin: page 0 succeeds, every
   * later page raises the coded error.
   *
   * @param mock - The stub client.
   * @param sessionId - The page-0 session id.
   * @param error - The error later pages raise.
   */
  function pageZeroThen(
    mock: MockWorkspaceClient,
    sessionId: string,
    error: Error,
  ): void {
    mock.setPageHandler((page) => {
      if (page === 0) {
        return makePageResult(makeProfilesBatch(0, 100), {
          page: 0,
          total: 500,
          page_size: 100,
          session_id: sessionId,
          has_more: true,
        });
      }
      throw error;
    });
  }

  it("AuthenticationError propagates", async () => {
    const mock = mockWorkspaceClient();
    pageZeroThen(
      mock,
      "sess_auth",
      new AuthenticationError("bad creds", { statusCode: 401 }),
    );

    await expect(
      makeStubWorkspace(mock).queryUser({
        mode: "profiles",
        parallel: true,
        limit: 5000,
        workers: 2,
      }),
    ).rejects.toThrow(/bad creds/);
  });

  it("RateLimitError propagates", async () => {
    const mock = mockWorkspaceClient();
    pageZeroThen(
      mock,
      "sess_rate",
      new RateLimitError("throttled", { statusCode: 429 }),
    );

    await expect(
      makeStubWorkspace(mock).queryUser({
        mode: "profiles",
        parallel: true,
        limit: 5000,
        workers: 2,
      }),
    ).rejects.toThrow(/throttled/);
  });

  it("ServerError propagates", async () => {
    const mock = mockWorkspaceClient();
    pageZeroThen(
      mock,
      "sess_server",
      new ServerError("server down", { statusCode: 500 }),
    );

    await expect(
      makeStubWorkspace(mock).queryUser({
        mode: "profiles",
        parallel: true,
        limit: 5000,
        workers: 2,
      }),
    ).rejects.toThrow(/server down/);
  });

  it("QueryError propagates", async () => {
    const mock = mockWorkspaceClient();
    pageZeroThen(
      mock,
      "sess_query",
      new QueryError("bad query", { statusCode: 400 }),
    );

    await expect(
      makeStubWorkspace(mock).queryUser({
        mode: "profiles",
        parallel: true,
        limit: 5000,
        workers: 2,
      }),
    ).rejects.toThrow(/bad query/);
  });
});
