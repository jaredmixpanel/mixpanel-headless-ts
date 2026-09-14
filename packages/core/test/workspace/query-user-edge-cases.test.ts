// Translated query-user edge-case tests (B5-S2, packet §3 + §8): the
// B2-M3 / B3-K4 file deferral (`B2-M3-notes.md:44`,
// `B3-K4-notes.md:86`) — assertion-for-assertion port of
// tests/test_query_user_edge_cases.py (R10.2), ALL 3 classes
// (TestTier1DataCorruption :173, TestTier2CrashPaths :593,
// TestTier3ValidationGaps :768).
//
// Translation notes:
// - Python's Tier-2 cases reach three PRIVATE methods
//   (`_execute_user_query_sequential`, `_build_page_kwargs`,
//   `_execute_user_aggregate`) to exercise their bare `json.loads`.
//   In TS those decodes live in the exported {@link buildPageKwargs}
//   and {@link buildStatsKwargs} (the `self`-free blocks, R7.2 split);
//   the sequential engine's `output_properties` decode IS
//   `buildPageKwargs`, so T2-02 and T2-03 both assert there.
// - `json.JSONDecodeError` is `LosslessJsonError`: the engage-param
//   round-trips decode through the shared lossless parser, never a bare
//   `JSON.parse` (B0-1 F1).
// - `pytest.raises(ValueError, …)` on `filter_to_selector` names
//   Python's dual-inheriting `ParamValidationError`; the TS twin
//   carries the same message.
// - `.df` asserts become `toRows()` / `rowColumns()` (C6).

import { describe, expect, it } from "vitest";
import { Workspace } from "../../src/workspace.js";
import {
  BookmarkValidationError,
  ParamValidationError,
} from "../../src/errors.js";
import { LosslessJsonError } from "../../src/client/lossless-json.js";
import {
  buildPageKwargs,
  buildStatsKwargs,
} from "../../src/workspace-query-params.js";
import { filterToSelector } from "../../src/query/user-builders.js";
import {
  validateUserArgs,
  validateUserParams,
} from "../../src/query/user-validators.js";
import {
  Filter,
  filterUnchecked,
} from "../../src/types/query-params/filter.js";
import { UserQueryResult } from "../../src/types/results/query-engine.js";
import {
  makePageResult,
  makeProfilesBatch,
  makeRawProfile,
  mockWorkspaceClient,
  TEST_SESSION,
  type MockWorkspaceClient,
} from "./workspace-test-helpers.js";

/**
 * The `workspace_factory` fixture (test file :141-163).
 *
 * @param mock - The stub client.
 * @returns The facade under test.
 */
function workspaceFactory(mock: MockWorkspaceClient): Workspace {
  return new Workspace({ session: TEST_SESSION, client: mock.client });
}

/** Read the collected `BookmarkValidationError` codes. */
function codesOf(exc: unknown): string[] {
  return (exc as BookmarkValidationError).errors.map((e) => e.code);
}

// ===========================================================================
// TIER 1 — data corruption / silent wrong results
// ===========================================================================

describe("TestTier1DataCorruption", () => {
  it("T1.01: both paths pass the wrapped sort_key format", async () => {
    const total = 200;
    const pageSize = 100;
    const mock = mockWorkspaceClient();
    mock.setPageHandler((page) => {
      const start = page * pageSize;
      const count = Math.min(pageSize, total - start);
      return makePageResult(makeProfilesBatch(start, count), {
        page,
        total,
        page_size: pageSize,
        session_id: "sess_sort",
        has_more: page < Math.ceil(total / pageSize) - 1,
      });
    });

    await workspaceFactory(mock).queryUser({
      mode: "profiles",
      sort_by: "ltv",
      parallel: true,
      limit: 100_000,
    });

    for (const call of mock.exportPageCalls) {
      expect(call.options["sort_key"]).toBe('properties["ltv"]');
    }
  });

  it("T1.02: $-prefixed and custom names collide after stripping", () => {
    const result = new UserQueryResult({
      computed_at: "2025-01-01T00:00:00Z",
      total: 1,
      profiles: [
        {
          distinct_id: "u1",
          last_seen: "2025-01-01",
          properties: { $email: "builtin@x.com", email: "custom@x.com" },
        },
      ],
      params: {},
      meta: {},
      mode: "profiles",
    });

    // After $-stripping, both map to "email" — only one column survives
    const emailCols = result.rowColumns().filter((c) => c === "email");
    expect(emailCols.length).toBe(1);
    // Document which value wins (last-write-wins in the property loop)
    const emailValue = result.toRows()[0]!["email"];
    expect(["builtin@x.com", "custom@x.com"]).toContain(emailValue);
  });

  it("T1.03: failed pages cause a total-vs-len mismatch against the API total", async () => {
    const total = 500;
    const pageSize = 100;
    const failPages = new Set([2, 3]);
    const mock = mockWorkspaceClient();
    mock.setPageHandler((page) => {
      if (failPages.has(page)) {
        throw new Error(`Simulated failure on page ${String(page)}`);
      }
      const start = page * pageSize;
      const count = Math.min(pageSize, total - start);
      return makePageResult(makeProfilesBatch(start, count), {
        page,
        total,
        page_size: pageSize,
        session_id: "sess_fail",
        has_more: page < Math.ceil(total / pageSize) - 1,
      });
    });

    const result = await workspaceFactory(mock).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 100_000,
    });

    // Total equals len(profiles), not the API total
    expect(result.profiles.length).toBe(300);
    expect(result.total).toBe(result.profiles.length);
    expect(result.meta["failed_pages"]).toEqual([2, 3]);
  });

  it("T1.04: when all parallel pages fail, only page 0 is returned", async () => {
    const total = 500;
    const pageSize = 100;
    const failPages = new Set([1, 2, 3, 4]);
    const mock = mockWorkspaceClient();
    mock.setPageHandler((page) => {
      if (failPages.has(page)) {
        throw new Error(`Simulated failure on page ${String(page)}`);
      }
      const start = page * pageSize;
      const count = Math.min(pageSize, total - start);
      return makePageResult(makeProfilesBatch(start, count), {
        page,
        total,
        page_size: pageSize,
        session_id: "sess_allfail",
        has_more: page < Math.ceil(total / pageSize) - 1,
      });
    });

    const result = await workspaceFactory(mock).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 100_000,
    });

    expect(result.profiles.length).toBe(100);
    expect(result.total).toBe(result.profiles.length);
    expect(result.meta["failed_pages"]).toEqual([1, 2, 3, 4]);
  });

  it("T1.05: distinct_ids yields '' for a profile without the key", () => {
    const result = new UserQueryResult({
      computed_at: "2025-01-01T00:00:00Z",
      total: 1,
      // NOTE: no "distinct_id" key
      profiles: [{ last_seen: "2025-01-01", properties: {} }],
      params: {},
      meta: {},
      mode: "profiles",
    });

    expect(result.distinct_ids).toEqual([""]);
  });

  it("T1.06: empty pages with has_more=true terminate the sequential loop", async () => {
    let callCount = 0;
    const maxCalls = 10;
    const mock = mockWorkspaceClient();
    mock.setPageHandler((page) => {
      callCount += 1;
      if (callCount > maxCalls) {
        throw new Error(
          `Loop guard: exceeded ${String(maxCalls)} calls, likely infinite loop`,
        );
      }
      if (page === 0) {
        return makePageResult([makeRawProfile("user_000")], {
          page: 0,
          total: 100,
          page_size: 1000,
          session_id: "sess_loop",
          has_more: true,
        });
      }
      // Subsequent pages: empty but claim more exist
      return makePageResult([], {
        page,
        total: 100,
        page_size: 1000,
        session_id: "sess_loop",
        has_more: true,
      });
    });

    const result = await workspaceFactory(mock).queryUser({
      mode: "profiles",
      limit: 100_000,
    });

    expect(result.profiles.length).toBeGreaterThanOrEqual(1);
  });

  it("T1.07: limit == page_size fetches no extra page", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(() =>
      makePageResult(makeProfilesBatch(0, 1000), {
        page: 0,
        total: 5000,
        page_size: 1000,
        session_id: "sess_boundary",
        has_more: true,
      }),
    );

    const result = await workspaceFactory(mock).queryUser({
      mode: "profiles",
      limit: 1000,
    });

    expect(mock.exportPageCalls.length).toBe(1);
    expect(result.profiles.length).toBe(1000);
  });

  it("T1.08: parallel workers use session_id=null when page 0 has none", async () => {
    const total = 200;
    const pageSize = 100;
    const mock = mockWorkspaceClient();
    mock.setPageHandler((page) => {
      const start = page * pageSize;
      const count = Math.min(pageSize, total - start);
      return makePageResult(makeProfilesBatch(start, count), {
        page,
        total,
        page_size: pageSize,
        session_id: null,
        has_more: page < Math.ceil(total / pageSize) - 1,
      });
    });

    const result = await workspaceFactory(mock).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 100_000,
    });

    expect(result.profiles.length).toBe(total);
    expect(result.meta["session_id"]).toBeNull();
    for (const call of mock.exportPageCalls.slice(1)) {
      expect(call.options["session_id"] ?? null).toBeNull();
    }
  });
});

// ===========================================================================
// TIER 2 — crash paths
// ===========================================================================

describe("TestTier2CrashPaths", () => {
  it("T2.01: a malformed cohort filter raises U_COHORT", async () => {
    // A Filter that passes the cohort-filter predicate but has the
    // wrong internal structure.
    const malformedFilter = new Filter({
      _property: "$cohorts",
      _operator: "contains",
      _value: [{ not_cohort: true }] as never,
      _property_type: "list",
    });

    const ws = workspaceFactory(mockWorkspaceClient());
    try {
      await ws.buildUserParams({ where: malformedFilter });
      expect.unreachable("expected BookmarkValidationError");
    } catch (exc) {
      expect(codesOf(exc)).toContain("U_COHORT");
    }
  });

  it("T2.02: malformed output_properties JSON raises the decode error", () => {
    expect(() =>
      buildPageKwargs({ output_properties: "not valid json" }),
    ).toThrow(LosslessJsonError);
  });

  it("T2.03: malformed distinct_ids JSON raises the decode error", () => {
    expect(() => buildPageKwargs({ distinct_ids: "broken json" })).toThrow(
      LosslessJsonError,
    );
  });

  it("T2.04: malformed segment_by_cohorts JSON raises the decode error", () => {
    expect(() =>
      buildStatsKwargs({ segment_by_cohorts: "{invalid json" }),
    ).toThrow(LosslessJsonError);
  });

  it("T2.05: an unsupported filter operator raises", () => {
    // Python PR #236: unknown operators no longer survive the constructor;
    // the ES13 seam is driven through the unchecked rebuild instead.
    const f = filterUnchecked({
      _property: "fake",
      _operator: "unknown_op",
      _value: null,
      _property_type: "string",
    });

    expect(() => filterToSelector(f)).toThrow(ParamValidationError);
    expect(() => filterToSelector(f)).toThrow(
      /Unsupported filter operator.*unknown_op/,
    );
  });

  it("T2.06: equals with a non-list value raises", () => {
    const f = new Filter({
      _property: "plan",
      _operator: "equals",
      _value: "string_not_list",
      _property_type: "string",
    });

    expect(() => filterToSelector(f)).toThrow(ParamValidationError);
    expect(() => filterToSelector(f)).toThrow(/Expected list/);
  });

  it("T2.07: between with the wrong list length raises", () => {
    const f = new Filter({
      _property: "amount",
      _operator: "is between",
      _value: [1, 2, 3] as never,
      _property_type: "number",
    });

    expect(() => filterToSelector(f)).toThrow(ParamValidationError);
    expect(() => filterToSelector(f)).toThrow(/Expected list/);
  });

  it("T2.08: an engage response without 'results' yields null", async () => {
    const mock = mockWorkspaceClient();
    mock.setEngageStats({ status: "ok" });

    const result = await workspaceFactory(mock).queryUser({
      mode: "aggregate",
    });

    expect(result.aggregate_data).toBeNull();
    expect(result.value).toBeNull();
  });
});

// ===========================================================================
// TIER 3 — validation gaps
// ===========================================================================

describe("TestTier3ValidationGaps", () => {
  /** The `ws` the Tier-3 cases build. */
  function makeWs(): Workspace {
    return workspaceFactory(mockWorkspaceClient());
  }

  it("T3.01: a double quote in sort_by is escaped", async () => {
    const params = await makeWs().buildUserParams({
      mode: "profiles",
      sort_by: 'foo"bar',
    });
    expect(params["sort_key"]).toBe('properties["foo\\"bar"]');
  });

  it("T3.02: a close bracket in sort_by is escaped", async () => {
    const params = await makeWs().buildUserParams({
      mode: "profiles",
      sort_by: '"]',
    });
    expect(params["sort_key"]).toBe('properties["\\"]"]');
  });

  it("T3.03: an empty where list produces no 'where' param", async () => {
    const params = await makeWs().buildUserParams({ where: [] });
    expect(Object.hasOwn(params, "where")).toBe(false);
  });

  it("T3.04: a raw-string where plus an int cohort produces both", async () => {
    const params = await makeWs().buildUserParams({
      where: 'properties["plan"] == "premium"',
      cohort: 42,
    });
    expect(params["where"]).toBe('properties["plan"] == "premium"');
    expect(Object.hasOwn(params, "filter_by_cohort")).toBe(true);
    const parsed = JSON.parse(params["filter_by_cohort"] as string) as Record<
      string,
      unknown
    >;
    expect(parsed["id"]).toBe(42);
  });

  it("T3.05: UP2 is dead code for a JSON-string filter_by_cohort", () => {
    const errors = validateUserParams({ filter_by_cohort: '{"id": 42}' });
    expect(errors.filter((e) => e.code === "UP2").length).toBe(0);
  });

  it("T3.06: include_all_users with an in_cohort filter is accepted", async () => {
    const params = await makeWs().buildUserParams({
      where: Filter.inCohort(42),
      include_all_users: true,
    });
    expect(Object.hasOwn(params, "include_all_users")).toBe(true);
  });

  it("T3.07: as_of=0 is accepted, not treated as falsy", async () => {
    const params = await makeWs().buildUserParams({
      mode: "profiles",
      as_of: 0,
    });
    expect(params["as_of_timestamp"]).toBe(0);
  });

  it("T3.08: a negative as_of is accepted without validation", async () => {
    const params = await makeWs().buildUserParams({
      mode: "profiles",
      as_of: -1,
    });
    expect(params["as_of_timestamp"]).toBe(-1);
  });

  it("T3.09: UP4 rejects a malformed action string", () => {
    const errors = validateUserParams({ action: "extremes(None)" });
    expect(errors.filter((e) => e.code === "UP4").length).toBe(1);
  });

  it("T3.10: workers=6 triggers U23", async () => {
    try {
      await makeWs().buildUserParams({ workers: 6 });
      expect.unreachable("expected BookmarkValidationError");
    } catch (exc) {
      expect(codesOf(exc)).toContain("U23");
    }
  });

  it("T3.11: limit=0 triggers U3", () => {
    const errors = validateUserArgs({ limit: 0 });
    expect(errors.map((e) => e.code)).toContain("U3");
  });

  it("T3.12: limit=-5 triggers U3", () => {
    const errors = validateUserArgs({ limit: -5 });
    expect(errors.map((e) => e.code)).toContain("U3");
  });
});
