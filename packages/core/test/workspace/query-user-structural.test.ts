// Structural queryUser behavior: parallel page ordering, the limit=1 and
// page_size 0/null fallbacks, aggregate computed_at sourcing and the ragged-row
// frame. Mirrors eight classes of tests/test_query_user_structural.py (the PBT,
// selector and transform-profile classes live under test/query/). pandas NaN
// asserts become key-absence asserts: ragged rows leave missing keys absent.

import { describe, expect, it } from "vitest";

import { UserQueryResult } from "../../src/types/results/query-engine.js";
import {
  makePageResult,
  makeProfilesBatch,
  makeRawProfile,
  makeStubWorkspace,
  mockWorkspaceClient,
} from "../../test-support/workspace-test-helpers.js";

// --- Structural / behavioral correctness ---

describe("Parallel page ordering preserved", () => {
  // python: TestParallelPageOrderingPreserved
  it("assembles profiles in page order across futures", async () => {
    const total = 500;
    const pageSize = 100;
    const numPages = Math.ceil(total / pageSize); // 5
    const callOrder: number[] = [];

    const mock = mockWorkspaceClient();
    mock.setPageHandler((page) => {
      callOrder.push(page);
      const startIdx = page * pageSize;
      const remaining = total - startIdx;
      const count = remaining > 0 ? Math.min(pageSize, remaining) : 0;
      return makePageResult(makeProfilesBatch(startIdx, count), {
        page,
        total,
        page_size: pageSize,
        session_id: "sess_order",
        has_more: page < numPages - 1,
      });
    });

    const result = await makeStubWorkspace(mock).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 100_000,
    });

    // Profiles are in page order: user_000..user_099 (page 0),
    // user_100..user_199 (page 1), etc.
    for (const [i, profile] of result.profiles.entries()) {
      expect(profile["distinct_id"]).toBe(`user_${String(i).padStart(3, "0")}`);
    }
    expect(callOrder).toHaveLength(numPages);
  });
});

describe("Parallel limit 1 falls back to sequential", () => {
  // python: TestParallelLimit1FallsBackToSequential
  it("limit=1 with parallel=true uses the sequential path", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(() =>
      makePageResult(
        [makeRawProfile("user_solo", undefined, { plan: "premium" })],
        {
          total: 5000,
          page_size: 1000,
          has_more: true,
        },
      ),
    );

    const result = await makeStubWorkspace(mock).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 1,
    });

    expect(result.meta["parallel"]).toBe(false);
    expect(result.profiles).toHaveLength(1);
    // Only one API call should have been made
    expect(mock.exportPageCalls).toHaveLength(1);
  });
});

describe("Parallel page size zero fallback", () => {
  // python: TestParallelPageSizeZeroFallback
  it("page_size=0 from the API falls back to 1000", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(() =>
      makePageResult(makeProfilesBatch(0, 5), {
        page: 0,
        total: 5,
        page_size: 0, // Pathological value
        session_id: "sess_zero",
        has_more: false,
      }),
    );

    const result = await makeStubWorkspace(mock).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 100_000,
    });

    // Should not divide by zero
    expect(result.profiles).toHaveLength(5);
  });
});

describe("Parallel page size none fallback", () => {
  // python: TestParallelPageSizeNoneFallback
  it("page_size=null from the API falls back to 1000", async () => {
    const mock = mockWorkspaceClient();
    const pageResult = makePageResult(makeProfilesBatch(0, 3), {
      page: 0,
      total: 3,
      page_size: 1000, // Placeholder
      session_id: "sess_none_ps",
      has_more: false,
    });
    // Override page_size to null (Python: `object.__setattr__`)
    (pageResult as unknown as { page_size: number | null }).page_size = null;
    mock.setPageHandler(() => pageResult);

    const result = await makeStubWorkspace(mock).queryUser({
      mode: "profiles",
      parallel: true,
      limit: 100_000,
    });

    // Should not crash
    expect(result.profiles).toHaveLength(3);
  });
});

describe("Aggregate computed at from API", () => {
  // python: TestAggregateComputedAtFromAPI
  it("uses the API's computed_at when present", async () => {
    const mock = mockWorkspaceClient();
    mock.setEngageStats({
      results: 42,
      status: "ok",
      computed_at: "2025-01-01T00:00:00Z",
    });

    const result = await makeStubWorkspace(mock).queryUser({
      mode: "aggregate",
    });

    expect(result.computed_at).toBe("2025-01-01T00:00:00Z");
  });
});

describe("Aggregate computed at fallback", () => {
  // python: TestAggregateComputedAtFallback
  it("falls back to a local ISO timestamp when the API omits it", async () => {
    const mock = mockWorkspaceClient();
    mock.setEngageStats({ results: 42, status: "ok" }); // no computed_at

    const result = await makeStubWorkspace(mock).queryUser({
      mode: "aggregate",
    });

    expect(typeof result.computed_at).toBe("string");
    expect(result.computed_at.length).toBeGreaterThan(0);
    // Should look like an ISO timestamp (contains the T separator)
    expect(result.computed_at).toContain("T");
  });
});

// --- Edge cases ---

describe("Df profiles varying property sets union columns", () => {
  // python: TestDfProfilesVaryingPropertySetsUnionColumns
  it("profiles with different property sets produce the union of columns", () => {
    const profiles = [
      {
        distinct_id: "user_1",
        last_seen: "2025-01-01T00:00:00",
        properties: { a: 1 },
      },
      {
        distinct_id: "user_2",
        last_seen: "2025-01-02T00:00:00",
        properties: { b: 2 },
      },
      {
        distinct_id: "user_3",
        last_seen: "2025-01-03T00:00:00",
        properties: { a: 3, c: 4 },
      },
    ];
    const result = new UserQueryResult({
      computed_at: "2025-01-15T10:00:00",
      total: 3,
      profiles,
      params: {},
      meta: {},
      mode: "profiles",
      aggregate_data: null,
    });

    const columns = result.rowColumns();

    // All property columns should be present
    expect(new Set(columns)).toStrictEqual(
      new Set(["distinct_id", "last_seen", "a", "b", "c"]),
    );

    // Column order: distinct_id, last_seen, then alphabetical
    expect(columns).toStrictEqual(["distinct_id", "last_seen", "a", "b", "c"]);

    // Where pandas shows NaN, the TS ragged row leaves the key ABSENT
    const rows = result.toRows();
    const byId = new Map(rows.map((r) => [r["distinct_id"], r]));
    expect(Object.hasOwn(byId.get("user_1")!, "b")).toBe(false);
    expect(Object.hasOwn(byId.get("user_1")!, "c")).toBe(false);
    expect(Object.hasOwn(byId.get("user_2")!, "a")).toBe(false);
    expect(Object.hasOwn(byId.get("user_2")!, "c")).toBe(false);
    expect(Object.hasOwn(byId.get("user_3")!, "b")).toBe(false);

    // Present values should be correct
    expect(byId.get("user_1")!["a"]).toBe(1);
    expect(byId.get("user_2")!["b"]).toBe(2);
    expect(byId.get("user_3")!["a"]).toBe(3);
    expect(byId.get("user_3")!["c"]).toBe(4);
  });
});

describe("Df property named distinct ID collision", () => {
  // python: TestDfPropertyNamedDistinctIdCollision
  it("a property named 'distinct_id' overwrites the top-level value", () => {
    const profiles = [
      {
        distinct_id: "real_id",
        last_seen: "2025-01-01T00:00:00",
        properties: { distinct_id: "collision_id", plan: "free" },
      },
    ];
    const result = new UserQueryResult({
      computed_at: "2025-01-15T10:00:00",
      total: 1,
      profiles,
      params: {},
      meta: {},
      mode: "profiles",
      aggregate_data: null,
    });

    // The property value overwrites the top-level distinct_id because
    // the row builder iterates properties AFTER setting it.
    expect(result.toRows()[0]!["distinct_id"]).toBe("collision_id");
  });
});
