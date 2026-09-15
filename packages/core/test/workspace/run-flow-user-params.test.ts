// Translated `run_flow_params` / `run_user_params` tests (Python PR
// #225, Linear AIE-924): assertion-for-assertion port of
// tests/unit/test_run_flow_user_params.py (R10.2) — BOTH classes
// (TestRunFlowParams :168, TestRunUserParams :409), plus a direct probe
// of the `_flow_mode_from_params` twin {@link flowModeFromParams}.
//
// Translation notes:
// - `mock_api_client.arb_funnels_query.call_args[0][0]` becomes the
//   recorded body (`mock.arbFunnelsCalls[i]`); `.call_args.kwargs`
//   becomes the recorded options bag (`mock.arbFunnelsOptions[i]`).
// - `test_parallel_path_is_used_when_requested` wraps the private
//   `_execute_user_query_parallel` with `MagicMock(wraps=...)`; TS
//   `#private` members cannot be wrapped, so the parallel path is
//   observed through the `meta` it alone stamps (`parallel: true`,
//   `workers: 2` — `workspace.py:10180-10185`).
// - `try: ... finally: ws.close()` is dropped per
//   `workspace-test-helpers.ts` (the TS facade owns no pool).
// - The `query_flow` / `build_flow_params` round-trips pin the `today`
//   clock seam on both sides so the default date window cannot straddle
//   midnight between the two calls.

import { describe, expect, it } from "vitest";

import type { ProfilePageResult } from "../../src/types/results/discovery.js";
import {
  FlowQueryResult,
  UserQueryResult,
} from "../../src/types/results/query-engine.js";
import { Workspace } from "../../src/workspace.js";
import { flowModeFromParams } from "../../src/workspace-query-params.js";
import {
  makePageResult,
  type MockWorkspaceClient,
  mockWorkspaceClient,
  TEST_SESSION,
} from "../../test-support/workspace-test-helpers.js";

// ===========================================================================
// Fixtures and mock responses (test file :44-165)
// ===========================================================================

/**
 * The `workspace_factory` fixture (test file :60-86).
 *
 * @param mock - The stub client.
 * @returns The facade under test.
 */
function workspaceFactory(mock: MockWorkspaceClient): Workspace {
  return new Workspace({ session: TEST_SESSION, client: mock.client });
}

/** Canonical mock response for a sankey flow query. */
const MOCK_SANKEY_RESPONSE: Record<string, unknown> = {
  computed_at: "2025-01-15T10:00:00",
  steps: [
    { event: "Login", count: 100 },
    { event: "Purchase", count: 30 },
  ],
  breakdowns: [],
  overallConversionRate: 0.3,
  metadata: { sampling_factor: 1.0 },
};

/** Canonical mock response for a top-paths flow query. */
const MOCK_TOP_PATHS_RESPONSE: Record<string, unknown> = {
  computed_at: "2025-01-15T10:00:00",
  flows: [{ path: ["Login", "Purchase"], count: 30 }],
  steps: [],
  breakdowns: [],
  overallConversionRate: 0.5,
  metadata: {},
};

/** Minimal mock response for a tree flow query. */
const MOCK_TREE_RESPONSE: Record<string, unknown> = {
  computed_at: "2025-01-15T10:00:00",
  trees: [],
  metadata: {},
};

/** The response the every-mode round-trips install. */
const MOCK_ANY_MODE_RESPONSE: Record<string, unknown> = {
  ...MOCK_SANKEY_RESPONSE,
  trees: [],
  flows: [],
};

/** Canonical mock response for an Engage `stats` count. */
const MOCK_STATS_RESPONSE: Record<string, unknown> = {
  results: 42,
  status: "ok",
  computed_at: "2025-01-15T10:00:00",
};

/** Three raw Engage profiles (`RAW_PROFILES`). */
const RAW_PROFILES: Array<Record<string, unknown>> = [0, 1, 2].map((i) => ({
  $distinct_id: `user_${String(i).padStart(3, "0")}`,
  $properties: { $last_seen: "2025-01-15" },
}));

/**
 * Build a single-page profile export result (`_page`).
 *
 * @param profiles - Raw profile dicts to return on page zero.
 * @returns A page result with no further pages.
 */
function page(profiles: Array<Record<string, unknown>>): ProfilePageResult {
  return makePageResult(profiles, {
    page: 0,
    total: profiles.length,
    page_size: 1000,
    session_id: "sess",
    has_more: false,
  });
}

/** The pinned clock for the build/run round-trips. */
const TODAY = (): string => "2025-01-15";

/**
 * Read the last body posted to the flows endpoint (`flow_body`).
 *
 * @param mock - The stub whose `arbFunnelsQuery` was called.
 * @returns The request body dict.
 */
function flowBody(mock: MockWorkspaceClient): Record<string, unknown> {
  return mock.arbFunnelsCalls.at(-1)!;
}

// ===========================================================================
// _flow_mode_from_params (docstring examples, workspace.py:452-459)
// ===========================================================================

describe("flowModeFromParams", () => {
  it("reads flows_merge_type first, chartType second, else sankey", () => {
    expect(
      flowModeFromParams({ chartType: "sankey", flows_merge_type: "tree" }),
    ).toBe("tree");
    expect(flowModeFromParams({ chartType: "top-paths" })).toBe("paths");
    expect(flowModeFromParams({})).toBe("sankey");
  });

  it("ignores non-string values", () => {
    expect(flowModeFromParams({ flows_merge_type: 1, chartType: null })).toBe(
      "sankey",
    );
    expect(
      flowModeFromParams({ flows_merge_type: ["tree"], chartType: "tree" }),
    ).toBe("tree");
  });
});

// ===========================================================================
// TestRunFlowParams (test file :168-406)
// ===========================================================================

describe("TestRunFlowParams", () => {
  it("returns a flow result and posts params as bookmark", async () => {
    const mock = mockWorkspaceClient();
    mock.setArbFunnelsResponse(MOCK_SANKEY_RESPONSE);
    const ws = workspaceFactory(mock);
    const params = await ws.buildFlowParams("Login");
    const result = await ws.runFlowParams(params);

    expect(result).toBeInstanceOf(FlowQueryResult);
    const body = flowBody(mock);
    expect(body["bookmark"]).toStrictEqual(params);
    expect(body["project_id"]).toBe(12345);
    expect(body["query_type"]).toBe("flows_sankey");
  });

  it("matches query_flow", async () => {
    const mock = mockWorkspaceClient();
    mock.setArbFunnelsResponse(MOCK_SANKEY_RESPONSE);
    const ws = workspaceFactory(mock);

    await ws.queryFlow("Login", { forward: 2, last: 7, today: TODAY });
    const direct = flowBody(mock);

    await ws.runFlowParams(
      await ws.buildFlowParams("Login", { forward: 2, last: 7, today: TODAY }),
    );
    const roundTrip = flowBody(mock);

    expect(roundTrip).toStrictEqual(direct);
  });

  it("derives paths mode from chart_type", async () => {
    const mock = mockWorkspaceClient();
    mock.setArbFunnelsResponse(MOCK_TOP_PATHS_RESPONSE);
    const ws = workspaceFactory(mock);
    const params = await ws.buildFlowParams("Login", { mode: "paths" });
    expect(params["chartType"]).toBe("top-paths");

    const result = await ws.runFlowParams(params);

    expect(flowBody(mock)["query_type"]).toBe("flows_top_paths");
    expect(result.mode).toBe("paths");
  });

  it("derives tree mode from flows_merge_type", async () => {
    const mock = mockWorkspaceClient();
    mock.setArbFunnelsResponse(MOCK_TREE_RESPONSE);
    const ws = workspaceFactory(mock);
    const params = await ws.buildFlowParams("Login", { mode: "tree" });
    expect(params["chartType"]).toBe("sankey");
    expect(params["flows_merge_type"]).toBe("tree");

    const result = await ws.runFlowParams(params);

    expect(flowBody(mock)["query_type"]).toBe("flows");
    expect(result.mode).toBe("tree");
  });

  it.each(["sankey", "paths", "tree"] as const)(
    "every built mode round-trips: %s",
    async (builtMode) => {
      const mock = mockWorkspaceClient();
      mock.setArbFunnelsResponse(MOCK_ANY_MODE_RESPONSE);
      const ws = workspaceFactory(mock);

      await ws.queryFlow("Login", { mode: builtMode, today: TODAY });
      const direct = flowBody(mock);

      await ws.runFlowParams(
        await ws.buildFlowParams("Login", { mode: builtMode, today: TODAY }),
      );
      const roundTrip = flowBody(mock);

      expect(roundTrip).toStrictEqual(direct);
    },
  );

  it("explicit mode overrides params", async () => {
    const mock = mockWorkspaceClient();
    mock.setArbFunnelsResponse(MOCK_TOP_PATHS_RESPONSE);
    const ws = workspaceFactory(mock);
    const params = await ws.buildFlowParams("Login", { mode: "tree" });

    const result = await ws.runFlowParams(params, { mode: "paths" });

    expect(flowBody(mock)["query_type"]).toBe("flows_top_paths");
    expect(result.mode).toBe("paths");
  });

  it.each<[Record<string, unknown>, string]>([
    [{ steps: [] }, "flows_sankey"],
    [{ steps: [], chartType: "sankey" }, "flows_sankey"],
    [{ steps: [], chartType: "top-paths" }, "flows_top_paths"],
    [{ steps: [], chartType: "paths" }, "flows_top_paths"],
    [{ steps: [], chartType: "tree" }, "flows"],
    [{ steps: [], chartType: "something-else" }, "flows_sankey"],
    [{ steps: [], flows_merge_type: "tree" }, "flows"],
    [{ steps: [], flows_merge_type: "list" }, "flows_top_paths"],
    [{ steps: [], flows_merge_type: "graph" }, "flows_sankey"],
    [{ steps: [], chartType: "sankey", flows_merge_type: "tree" }, "flows"],
    [
      { steps: [], chartType: "top-paths", flows_merge_type: "list" },
      "flows_top_paths",
    ],
    [{ steps: [], flows_merge_type: "unknown" }, "flows_sankey"],
  ])("chart_type to query_type: %j → %s", async (params, expected) => {
    const mock = mockWorkspaceClient();
    mock.setArbFunnelsResponse(MOCK_ANY_MODE_RESPONSE);
    const ws = workspaceFactory(mock);
    await ws.runFlowParams(params);
    expect(flowBody(mock)["query_type"]).toBe(expected);
  });

  it("forwards workspace_id", async () => {
    const mock = mockWorkspaceClient();
    mock.setArbFunnelsResponse(MOCK_SANKEY_RESPONSE);
    const ws = workspaceFactory(mock);
    await ws.runFlowParams({ steps: [] }, { workspace_id: 99 });
    expect(mock.arbFunnelsOptions.at(-1)!["workspace_id"]).toBe(99);
  });
});

// ===========================================================================
// TestRunUserParams (test file :409-544)
// ===========================================================================

describe("TestRunUserParams", () => {
  it("aggregate params route to engage stats", async () => {
    const mock = mockWorkspaceClient();
    mock.setEngageStats(MOCK_STATS_RESPONSE);
    const ws = workspaceFactory(mock);
    const params = await ws.buildUserParams({ mode: "aggregate" });
    expect(Object.hasOwn(params, "action")).toBe(true);

    const result = await ws.runUserParams(params);

    expect(result).toBeInstanceOf(UserQueryResult);
    expect(result.mode).toBe("aggregate");
    expect(result.total).toBe(42);
    expect(result.params).toStrictEqual(params);
    expect(mock.engageStatsCalls).toHaveLength(1);
    expect(mock.exportPageCalls).toHaveLength(0);
  });

  it("aggregate matches query_user", async () => {
    const mock = mockWorkspaceClient();
    mock.setEngageStats(MOCK_STATS_RESPONSE);
    const ws = workspaceFactory(mock);

    await ws.queryUser({ mode: "aggregate", aggregate: "count" });
    const direct = mock.engageStatsCalls.at(-1);

    await ws.runUserParams(
      await ws.buildUserParams({ mode: "aggregate", aggregate: "count" }),
    );
    const roundTrip = mock.engageStatsCalls.at(-1);

    expect(roundTrip).toStrictEqual(direct);
  });

  it("profile params route to export", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(() => page(RAW_PROFILES));
    const ws = workspaceFactory(mock);
    const params = await ws.buildUserParams({ mode: "profiles" });
    expect(Object.hasOwn(params, "action")).toBe(false);

    const result = await ws.runUserParams(params);

    expect(result.mode).toBe("profiles");
    expect(result.profiles).toHaveLength(1);
    expect(result.params).toStrictEqual(params);
    expect(mock.engageStatsCalls).toHaveLength(0);
  });

  it("profile limit is forwarded", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(() => page(RAW_PROFILES));
    const ws = workspaceFactory(mock);

    const result = await ws.runUserParams({}, { limit: 2 });

    expect(result.profiles).toHaveLength(2);
    expect(mock.exportPageCalls.at(-1)!.options["limit"]).toBe(2);
  });

  it("profiles match query_user", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(() => page(RAW_PROFILES));
    const ws = workspaceFactory(mock);

    await ws.queryUser({ mode: "profiles", properties: ["$email"], limit: 2 });
    const direct = mock.exportPageCalls.at(-1);

    await ws.runUserParams(
      await ws.buildUserParams({ mode: "profiles", properties: ["$email"] }),
      { limit: 2 },
    );
    const roundTrip = mock.exportPageCalls.at(-1);

    expect(roundTrip).toStrictEqual(direct);
  });

  it("parallel path is used when requested", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(() => page(RAW_PROFILES));
    const ws = workspaceFactory(mock);

    const result = await ws.runUserParams(
      {},
      { limit: 3, parallel: true, workers: 2 },
    );

    expect(result.meta["parallel"]).toBe(true);
    expect(result.meta["workers"]).toBe(2);
    expect(result.profiles).toHaveLength(3);
  });

  it("parallel is ignored at the default limit of 1", async () => {
    const mock = mockWorkspaceClient();
    mock.setPageHandler(() => page(RAW_PROFILES));
    const ws = workspaceFactory(mock);

    const result = await ws.runUserParams({}, { parallel: true });

    expect(result.meta["parallel"]).toBe(false);
    expect(result.profiles).toHaveLength(1);
  });
});
