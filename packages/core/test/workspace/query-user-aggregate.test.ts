// Translated aggregate query-user tests (B5-S2, packet §3): assertion-
// for-assertion port of tests/test_workspace_query_user_aggregate.py
// — ALL 14 classes (TestAggregateCount :121,
// TestAggregateWithProperty :237, TestAggregateSegmented :417,
// TestValidationU14AggregatePropertyRequired :577,
// TestValidationU15AggregatePropertyProhibited :630,
// TestValidationU16SegmentByRequiresAggregate :679,
// TestValidationU18ParallelProfilesOnly :727,
// TestValidationU19SortByProfilesOnly :751,
// TestValidationU20SearchProfilesOnly :775,
// TestValidationU21DistinctIdProfilesOnly :799,
// TestValidationU22PropertiesProfilesOnly :843,
// TestValidationMultipleErrors :872, TestEngageStatsCallParameters
// :928, TestAggregateResultMetadata :1123).
//
// The trailing `TestAggregateConfigError` comment records a
// class REMOVED in Python B1 — nothing to translate.
//
// Translation notes:
// - `mock_api_client` / `workspace_factory` come from the shared
//   `workspace-test-helpers.ts` (which also records why
//   `finally: ws.close()` has no TS twin).
// - `engage_stats.call_args.kwargs` becomes the recorded options bag
//   (`mock.engageStatsCalls[0]`) — the TS client takes one options
//   argument where Python takes kwargs, so the KEYS and VALUES compared
//   are identical.
// - `pytest.mark.parametrize` becomes an explicit `for` loop over the
//   same three ids.
// - `result.df` asserts become `toRows()` / `rowColumns()` (C6).

import { describe, expect, it } from "vitest";

import { BookmarkValidationError } from "../../src/errors.js";
import { UserQueryResult } from "../../src/types/results/query-engine.js";
import { Workspace } from "../../src/workspace.js";
import { expectRejects } from "../../test-support/raises.js";
import {
  type MockWorkspaceClient,
  mockWorkspaceClient,
  TEST_SESSION,
} from "../../test-support/workspace-test-helpers.js";

/**
 * The `workspace_factory` fixture (test file :62-81).
 *
 * @param mock - The stub client.
 * @returns The facade under test.
 */
function workspaceFactory(mock: MockWorkspaceClient): Workspace {
  return new Workspace({ session: TEST_SESSION, client: mock.client });
}

/**
 * Build a mock `engage_stats()` response (`_make_stats_response`).
 *
 * @param results - Scalar (unsegmented) or dict (segmented) result.
 * @param computedAt - ISO timestamp for the computation.
 * @param status - API response status.
 * @returns The response record.
 */
function makeStatsResponse(
  results: number | Record<string, unknown>,
  computedAt = "2025-01-15T10:00:00",
  status = "ok",
): Record<string, unknown> {
  return { results, status, computed_at: computedAt };
}

/** Read the collected `BookmarkValidationError` codes. */
function codesOf(exc: unknown): string[] {
  return (exc as BookmarkValidationError).errors.map((e) => e.code);
}

// ===========================================================================
// Count aggregate returns a scalar value
// ===========================================================================

describe("TestAggregateCount", () => {
  it("count returns an integer via result.value", async () => {
    const mock = mockWorkspaceClient();
    mock.setEngageStats(makeStatsResponse(42));

    const result = await workspaceFactory(mock).queryUser({
      mode: "aggregate",
      aggregate: "count",
    });

    expect(result).toBeInstanceOf(UserQueryResult);
    expect(result.mode).toBe("aggregate");
    expect(result.value).toBe(42);
  });

  it("aggregate mode returns an empty profiles list", async () => {
    const mock = mockWorkspaceClient();
    mock.setEngageStats(makeStatsResponse(100));

    const result = await workspaceFactory(mock).queryUser({
      mode: "aggregate",
      aggregate: "count",
    });

    expect(result.profiles).toStrictEqual([]);
  });

  it("aggregate_data stores the raw scalar", async () => {
    const mock = mockWorkspaceClient();
    mock.setEngageStats(makeStatsResponse(256));

    const result = await workspaceFactory(mock).queryUser({
      mode: "aggregate",
      aggregate: "count",
    });

    expect(result.aggregate_data).toBe(256);
  });

  it("calls engage_stats with action='count()'", async () => {
    const mock = mockWorkspaceClient();
    mock.setEngageStats(makeStatsResponse(10));

    await workspaceFactory(mock).queryUser({
      mode: "aggregate",
      aggregate: "count",
    });

    expect(mock.engageStatsCalls).toHaveLength(1);
    expect(mock.engageStatsCalls[0]!["action"]).toBe("count()");
  });

  it("a where filter passes the selector to engage_stats", async () => {
    const mock = mockWorkspaceClient();
    mock.setEngageStats(makeStatsResponse(5));

    await workspaceFactory(mock).queryUser({
      mode: "aggregate",
      aggregate: "count",
      where: 'properties["plan"] == "premium"',
    });

    expect(mock.engageStatsCalls).toHaveLength(1);
  });

  it("includes a computed_at timestamp", async () => {
    const mock = mockWorkspaceClient();
    mock.setEngageStats(makeStatsResponse(42, "2025-06-01T12:00:00"));

    const result = await workspaceFactory(mock).queryUser({
      mode: "aggregate",
      aggregate: "count",
    });

    expect(typeof result.computed_at).toBe("string");
    expect(result.computed_at.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// Property-based aggregations
// ===========================================================================

describe("TestAggregateWithProperty", () => {
  it("extremes returns the dict and uses the correct action", async () => {
    const mock = mockWorkspaceClient();
    const extremesResult = { max: 99999.99, min: 10.0, nth_percentile: 500.0 };
    mock.setEngageStats(makeStatsResponse(extremesResult));

    const result = await workspaceFactory(mock).queryUser({
      mode: "aggregate",
      aggregate: "extremes",
      aggregate_property: "revenue",
    });

    expect(typeof result.aggregate_data).toBe("object");
    expect(result.aggregate_data).toStrictEqual(extremesResult);
    expect(result.value).toBeNull(); // dict results have no scalar value
    expect(mock.engageStatsCalls[0]!["action"]).toBe(
      'extremes(properties["revenue"])',
    );
  });

  it("numeric_summary returns the dict and uses the correct action", async () => {
    const mock = mockWorkspaceClient();
    const summaryResult = {
      count: 150,
      mean: 42.7,
      var: 123.4,
      sum_of_squares: 18510.0,
    };
    mock.setEngageStats(makeStatsResponse(summaryResult));

    const result = await workspaceFactory(mock).queryUser({
      mode: "aggregate",
      aggregate: "numeric_summary",
      aggregate_property: "ltv",
    });

    expect(result.aggregate_data).toStrictEqual(summaryResult);
    expect(result.value).toBeNull();
    expect(mock.engageStatsCalls[0]!["action"]).toBe(
      'numeric_summary(properties["ltv"])',
    );
  });

  it("percentile returns the dict and uses the correct action", async () => {
    const mock = mockWorkspaceClient();
    const percentileResult = { percentile: 50, result: 35.0 };
    mock.setEngageStats(makeStatsResponse(percentileResult));

    const result = await workspaceFactory(mock).queryUser({
      mode: "aggregate",
      aggregate: "percentile",
      aggregate_property: "age",
      percentile: 50,
    });

    expect(result.aggregate_data).toStrictEqual(percentileResult);
    expect(result.value).toBeNull();
    expect(mock.engageStatsCalls[0]!["action"]).toBe(
      'percentile(properties["age"], 50)',
    );
  });

  it("a fractional percentile renders in the action string", async () => {
    const mock = mockWorkspaceClient();
    mock.setEngageStats(makeStatsResponse({ percentile: 99.5, result: 980.0 }));

    const result = await workspaceFactory(mock).queryUser({
      mode: "aggregate",
      aggregate: "percentile",
      aggregate_property: "score",
      percentile: 99.5,
    });

    expect(typeof result.aggregate_data).toBe("object");
    expect(mock.engageStatsCalls[0]!["action"]).toBe(
      'percentile(properties["score"], 99.5)',
    );
  });

  it("property-based aggregation sets mode='aggregate'", async () => {
    const mock = mockWorkspaceClient();
    mock.setEngageStats(makeStatsResponse({ max: 500.0, min: 1.0 }));

    const result = await workspaceFactory(mock).queryUser({
      mode: "aggregate",
      aggregate: "extremes",
      aggregate_property: "revenue",
    });

    expect(result.mode).toBe("aggregate");
  });

  it("includes the params dict used for the API call", async () => {
    const mock = mockWorkspaceClient();
    mock.setEngageStats(
      makeStatsResponse({
        count: 50,
        mean: 100.0,
        var: 25.0,
        sum_of_squares: 5000.0,
      }),
    );

    const result = await workspaceFactory(mock).queryUser({
      mode: "aggregate",
      aggregate: "numeric_summary",
      aggregate_property: "score",
    });

    expect(typeof result.params).toBe("object");
    expect(result.params["action"]).toBe(
      'numeric_summary(properties["score"])',
    );
  });
});

// ===========================================================================
// Segmented aggregate
// ===========================================================================

describe("TestAggregateSegmented", () => {
  it("stores a dict in aggregate_data", async () => {
    const mock = mockWorkspaceClient();
    const segmented = { "123": 145.0, "456": 320.5 };
    mock.setEngageStats(makeStatsResponse(segmented));

    const result = await workspaceFactory(mock).queryUser({
      mode: "aggregate",
      aggregate: "count",
      segment_by: [123, 456],
    });

    expect(typeof result.aggregate_data).toBe("object");
    expect(result.aggregate_data).toStrictEqual(segmented);
  });

  it("result.value is null for segmented results", async () => {
    const mock = mockWorkspaceClient();
    mock.setEngageStats(makeStatsResponse({ "123": 145.0, "456": 320.5 }));

    const result = await workspaceFactory(mock).queryUser({
      mode: "aggregate",
      aggregate: "count",
      segment_by: [123, 456],
    });

    expect(result.value).toBeNull();
  });

  it("frame has 'segment' and 'value' columns", async () => {
    const mock = mockWorkspaceClient();
    mock.setEngageStats(
      makeStatsResponse({ cohort_123: 145.0, cohort_456: 320.5 }),
    );

    const result = await workspaceFactory(mock).queryUser({
      mode: "aggregate",
      aggregate: "count",
      segment_by: [123, 456],
    });

    expect(result.rowColumns()).toContain("segment");
    expect(result.rowColumns()).toContain("value");
  });

  it("frame has one row per segment", async () => {
    const mock = mockWorkspaceClient();
    mock.setEngageStats(makeStatsResponse({ "100": 10, "200": 20, "300": 30 }));

    const result = await workspaceFactory(mock).queryUser({
      mode: "aggregate",
      aggregate: "count",
      segment_by: [100, 200, 300],
    });

    expect(result.toRows()).toHaveLength(3);
  });

  it("serializes segment_by cohort IDs for engage_stats", async () => {
    const mock = mockWorkspaceClient();
    mock.setEngageStats(makeStatsResponse({ "123": 10, "456": 20 }));

    await workspaceFactory(mock).queryUser({
      mode: "aggregate",
      aggregate: "count",
      segment_by: [123, 456],
    });

    expect(mock.engageStatsCalls).toHaveLength(1);
  });

  it("returns an empty profiles list", async () => {
    const mock = mockWorkspaceClient();
    mock.setEngageStats(makeStatsResponse({ "123": 10 }));

    const result = await workspaceFactory(mock).queryUser({
      mode: "aggregate",
      aggregate: "extremes",
      aggregate_property: "revenue",
      segment_by: [123],
    });

    expect(result.profiles).toStrictEqual([]);
  });
});

// ===========================================================================
// U14: aggregate_property required for non-count
// ===========================================================================

describe("TestValidationU14AggregatePropertyRequired", () => {
  for (const aggFunc of ["extremes", "percentile", "numeric_summary"]) {
    it(`non-count aggregate '${aggFunc}' without a property raises U14`, async () => {
      const ws = workspaceFactory(mockWorkspaceClient());
      const error = await expectRejects(
        ws.queryUser({ mode: "aggregate", aggregate: aggFunc }),
        "expected BookmarkValidationError",
      );
      expect(error).toBeInstanceOf(BookmarkValidationError);
      expect(codesOf(error)).toContain("U14");
    });
  }

  it("the U14 message mentions aggregate_property", async () => {
    const ws = workspaceFactory(mockWorkspaceClient());
    const error = await expectRejects(
      ws.queryUser({ mode: "aggregate", aggregate: "extremes" }),
      "expected BookmarkValidationError",
    );
    const u14 = (error as BookmarkValidationError).errors.filter(
      (e) => e.code === "U14",
    );
    expect(u14).toHaveLength(1);
    expect(u14[0]!.message).toContain("aggregate_property");
  });
});

// ===========================================================================
// U15: aggregate_property prohibited for count
// ===========================================================================

describe("TestValidationU15AggregatePropertyProhibited", () => {
  it("count with aggregate_property raises U15", async () => {
    const ws = workspaceFactory(mockWorkspaceClient());
    const error = await expectRejects(
      ws.queryUser({
        mode: "aggregate",
        aggregate: "count",
        aggregate_property: "revenue",
      }),
      "expected BookmarkValidationError",
    );
    expect(codesOf(error)).toContain("U15");
  });

  it("the U15 message mentions count", async () => {
    const ws = workspaceFactory(mockWorkspaceClient());
    const error = await expectRejects(
      ws.queryUser({
        mode: "aggregate",
        aggregate: "count",
        aggregate_property: "ltv",
      }),
      "expected BookmarkValidationError",
    );
    const u15 = (error as BookmarkValidationError).errors.filter(
      (e) => e.code === "U15",
    );
    expect(u15).toHaveLength(1);
    expect(u15[0]!.message.toLowerCase()).toContain("count");
  });
});

// ===========================================================================
// U16: segment_by requires mode="aggregate"
// ===========================================================================

describe("TestValidationU16SegmentByRequiresAggregate", () => {
  it("segment_by with mode='profiles' raises U16", async () => {
    const ws = workspaceFactory(mockWorkspaceClient());
    const error = await expectRejects(
      ws.queryUser({ mode: "profiles", segment_by: [123] }),
      "expected BookmarkValidationError",
    );
    expect(codesOf(error)).toContain("U16");
  });

  it("segment_by with mode='aggregate' does not raise U16", async () => {
    const mock = mockWorkspaceClient();
    mock.setEngageStats(makeStatsResponse({ "123": 10 }));

    const result = await workspaceFactory(mock).queryUser({
      mode: "aggregate",
      aggregate: "count",
      segment_by: [123],
    });

    expect(result).toBeInstanceOf(UserQueryResult);
  });
});

// ===========================================================================
// U18-U22: profile-only params rejected in aggregate mode
// ===========================================================================

describe("TestValidationU18ParallelProfilesOnly", () => {
  it("parallel=true with mode='aggregate' raises U18", async () => {
    const ws = workspaceFactory(mockWorkspaceClient());
    const error = await expectRejects(
      ws.queryUser({
        mode: "aggregate",
        aggregate: "count",
        parallel: true,
      }),
      "expected BookmarkValidationError",
    );
    expect(codesOf(error)).toContain("U18");
  });
});

describe("TestValidationU19SortByProfilesOnly", () => {
  it("sort_by with mode='aggregate' raises U19", async () => {
    const ws = workspaceFactory(mockWorkspaceClient());
    const error = await expectRejects(
      ws.queryUser({
        mode: "aggregate",
        aggregate: "count",
        sort_by: "$last_seen",
      }),
      "expected BookmarkValidationError",
    );
    expect(codesOf(error)).toContain("U19");
  });
});

describe("TestValidationU20SearchProfilesOnly", () => {
  it("search with mode='aggregate' raises U20", async () => {
    const ws = workspaceFactory(mockWorkspaceClient());
    const error = await expectRejects(
      ws.queryUser({
        mode: "aggregate",
        aggregate: "count",
        search: "alice",
      }),
      "expected BookmarkValidationError",
    );
    expect(codesOf(error)).toContain("U20");
  });
});

describe("TestValidationU21DistinctIdProfilesOnly", () => {
  it("distinct_id with mode='aggregate' raises U21", async () => {
    const ws = workspaceFactory(mockWorkspaceClient());
    const error = await expectRejects(
      ws.queryUser({
        mode: "aggregate",
        aggregate: "count",
        distinct_id: "user_001",
      }),
      "expected BookmarkValidationError",
    );
    expect(codesOf(error)).toContain("U21");
  });

  it("distinct_ids with mode='aggregate' raises U21", async () => {
    const ws = workspaceFactory(mockWorkspaceClient());
    const error = await expectRejects(
      ws.queryUser({
        mode: "aggregate",
        aggregate: "count",
        distinct_ids: ["user_001", "user_002"],
      }),
      "expected BookmarkValidationError",
    );
    expect(codesOf(error)).toContain("U21");
  });
});

describe("TestValidationU22PropertiesProfilesOnly", () => {
  it("properties with mode='aggregate' raises U22", async () => {
    const ws = workspaceFactory(mockWorkspaceClient());
    const error = await expectRejects(
      ws.queryUser({
        mode: "aggregate",
        aggregate: "count",
        properties: ["$email", "plan"],
      }),
      "expected BookmarkValidationError",
    );
    expect(codesOf(error)).toContain("U22");
  });
});

// ===========================================================================
// Multiple validation errors reported together
// ===========================================================================

describe("TestValidationMultipleErrors", () => {
  it("multiple profile-only params produce multiple errors", async () => {
    const ws = workspaceFactory(mockWorkspaceClient());
    const error = await expectRejects(
      ws.queryUser({
        mode: "aggregate",
        aggregate: "count",
        sort_by: "$last_seen",
        search: "alice",
        properties: ["$email"],
      }),
      "expected BookmarkValidationError",
    );
    const codes = new Set(codesOf(error));
    // Should report U19 (sort_by), U20 (search), U22 (properties)
    expect(codes.has("U19")).toBe(true);
    expect(codes.has("U20")).toBe(true);
    expect(codes.has("U22")).toBe(true);
  });

  it("a missing property AND invalid profile params are all reported", async () => {
    const ws = workspaceFactory(mockWorkspaceClient());
    const error = await expectRejects(
      ws.queryUser({
        mode: "aggregate",
        aggregate: "extremes",
        // Missing aggregate_property (U14)
        search: "bob", // U20
      }),
      "expected BookmarkValidationError",
    );
    const codes = new Set(codesOf(error));
    expect(codes.has("U14")).toBe(true);
    expect(codes.has("U20")).toBe(true);
  });
});

// ===========================================================================
// engage_stats() call parameters
// ===========================================================================

describe("TestEngageStatsCallParameters", () => {
  it("count passes action='count()'", async () => {
    const mock = mockWorkspaceClient();
    mock.setEngageStats(makeStatsResponse(10));

    await workspaceFactory(mock).queryUser({
      mode: "aggregate",
      aggregate: "count",
    });

    expect(mock.engageStatsCalls[0]!["action"]).toBe("count()");
  });

  it("extremes passes the correct action", async () => {
    const mock = mockWorkspaceClient();
    mock.setEngageStats(makeStatsResponse({ max: 500.0, min: 1.0 }));

    await workspaceFactory(mock).queryUser({
      mode: "aggregate",
      aggregate: "extremes",
      aggregate_property: "revenue",
    });

    expect(mock.engageStatsCalls[0]!["action"]).toBe(
      'extremes(properties["revenue"])',
    );
  });

  it("numeric_summary passes the correct action", async () => {
    const mock = mockWorkspaceClient();
    mock.setEngageStats(makeStatsResponse({ count: 10, mean: 25.0 }));

    await workspaceFactory(mock).queryUser({
      mode: "aggregate",
      aggregate: "numeric_summary",
      aggregate_property: "score",
    });

    expect(mock.engageStatsCalls[0]!["action"]).toBe(
      'numeric_summary(properties["score"])',
    );
  });

  it("percentile passes the correct action", async () => {
    const mock = mockWorkspaceClient();
    mock.setEngageStats(makeStatsResponse({ percentile: 90, result: 150.0 }));

    await workspaceFactory(mock).queryUser({
      mode: "aggregate",
      aggregate: "percentile",
      aggregate_property: "age",
      percentile: 90,
    });

    expect(mock.engageStatsCalls[0]!["action"]).toBe(
      'percentile(properties["age"], 90)',
    );
  });

  it("a decimal percentile passes the correct action", async () => {
    const mock = mockWorkspaceClient();
    mock.setEngageStats(makeStatsResponse({ percentile: 95.5, result: 200.0 }));

    await workspaceFactory(mock).queryUser({
      mode: "aggregate",
      aggregate: "percentile",
      aggregate_property: "ltv",
      percentile: 95.5,
    });

    expect(mock.engageStatsCalls[0]!["action"]).toBe(
      'percentile(properties["ltv"], 95.5)',
    );
  });

  it("group_id is forwarded to engage_stats", async () => {
    const mock = mockWorkspaceClient();
    mock.setEngageStats(makeStatsResponse(50));

    await workspaceFactory(mock).queryUser({
      mode: "aggregate",
      aggregate: "count",
      group_id: "companies",
    });

    expect(mock.engageStatsCalls[0]!["group_id"]).toBe("companies");
  });

  it("as_of in aggregate mode is rejected by validation (U30)", async () => {
    const mock = mockWorkspaceClient();
    const ws = workspaceFactory(mock);
    const error = await expectRejects(
      ws.queryUser({
        mode: "aggregate",
        aggregate: "count",
        as_of: 1704067200,
      }),
      "expected BookmarkValidationError",
    );
    expect(codesOf(error)).toContain("U30");
    // engage_stats should never be called
    expect(mock.engageStatsCalls).toHaveLength(0);
  });

  it("include_all_users is forwarded when a cohort is set", async () => {
    const mock = mockWorkspaceClient();
    mock.setEngageStats(makeStatsResponse(100));

    await workspaceFactory(mock).queryUser({
      mode: "aggregate",
      aggregate: "count",
      cohort: 42,
      include_all_users: true,
    });

    expect(mock.engageStatsCalls[0]!["include_all_users"]).toBe(true);
  });
});

// ===========================================================================
// Aggregate result metadata and structure
// ===========================================================================

describe("TestAggregateResultMetadata", () => {
  it("returns a UserQueryResult", async () => {
    const mock = mockWorkspaceClient();
    mock.setEngageStats(makeStatsResponse(42));

    const result = await workspaceFactory(mock).queryUser({
      mode: "aggregate",
      aggregate: "count",
    });

    expect(result).toBeInstanceOf(UserQueryResult);
  });

  it("includes a meta dict", async () => {
    const mock = mockWorkspaceClient();
    mock.setEngageStats(makeStatsResponse(42));

    const result = await workspaceFactory(mock).queryUser({
      mode: "aggregate",
      aggregate: "count",
    });

    expect(typeof result.meta).toBe("object");
    expect(result.meta).not.toBeNull();
  });

  it("has an empty distinct_ids list", async () => {
    const mock = mockWorkspaceClient();
    mock.setEngageStats(makeStatsResponse(42));

    const result = await workspaceFactory(mock).queryUser({
      mode: "aggregate",
      aggregate: "count",
    });

    expect(result.distinct_ids).toStrictEqual([]);
  });

  it("count total reflects the count result", async () => {
    const mock = mockWorkspaceClient();
    mock.setEngageStats(makeStatsResponse(1500));

    const result = await workspaceFactory(mock).queryUser({
      mode: "aggregate",
      aggregate: "count",
    });

    expect(result.total).toBe(1500);
  });

  it("unsegmented aggregate frame has a single 'value' row", async () => {
    const mock = mockWorkspaceClient();
    mock.setEngageStats(makeStatsResponse(42));

    const result = await workspaceFactory(mock).queryUser({
      mode: "aggregate",
      aggregate: "count",
    });

    expect(result.toRows()).toHaveLength(1);
    expect(result.rowColumns()).toContain("value");
  });
});
