// Translated workspace-retention tests (B5-S2, packet §3): assertion-
// for-assertion port of tests/test_workspace_retention.py — ALL
// 4 classes (TestQueryRetentionIntegration :105,
// TestQueryRetentionWithFilters :219, TestBuildRetentionParams :252,
// TestQueryRetentionValidationIntegration :319).
//
// The Python file also carries a `TestQueryRetentionConfigError` REMOVAL
// comment — nothing to translate.
//
// Translation notes: identical to the sibling `workspace-funnel.test.ts`
// header (`insights_query.call_args[0][0]` -> `mock.insightsCalls[0]`;
// `pytest.raises(ValueError, …)` names Python's dual-inheriting
// `ParamValidationError`).

import { describe, expect, it } from "vitest";

import { Filter } from "../../src/types/query-params/filter.js";
import { RetentionEvent } from "../../src/types/query-params/retention.js";
import { RetentionQueryResult } from "../../src/types/results/query-engine.js";
import { Workspace } from "../../src/workspace.js";
import {
  type MockWorkspaceClient,
  mockWorkspaceClient,
  TEST_SESSION,
} from "../../test-support/workspace-test-helpers.js";

/**
 * The `workspace_factory` fixture (test file :52-75).
 *
 * @param mock - The stub client.
 * @returns The facade under test.
 */
function workspaceFactory(mock: MockWorkspaceClient): Workspace {
  return new Workspace({ session: TEST_SESSION, client: mock.client });
}

/** Canonical mock response for a retention query (test file :78). */
const MOCK_RETENTION_RESPONSE: Record<string, unknown> = {
  computed_at: "2025-01-15T12:00:00",
  date_range: { from_date: "2025-01-01", to_date: "2025-01-31" },
  series: {
    "Signup and then Login": {
      "2025-01-01": {
        first: 100,
        counts: [100, 50, 25],
        rates: [1.0, 0.5, 0.25],
      },
      $average: { first: 100, counts: [100, 50, 25], rates: [1.0, 0.5, 0.25] },
    },
  },
  meta: { sampling_factor: 1.0 },
};

/** Build the facade with the canonical retention response installed. */
function retentionWs(): { ws: Workspace; mock: MockWorkspaceClient } {
  const mock = mockWorkspaceClient();
  mock.setInsightsResponse(MOCK_RETENTION_RESPONSE);
  return { ws: workspaceFactory(mock), mock };
}

// ===========================================================================
// T019: workspace integration
// ===========================================================================

describe("TestQueryRetentionIntegration", () => {
  it("sends a body with bookmark, project_id and queryLimits", async () => {
    const { ws, mock } = retentionWs();
    await ws.queryRetention("Signup", "Login");

    expect(mock.insightsCalls).toHaveLength(1);
    const body = mock.insightsCalls[0]!;
    expect(Object.hasOwn(body, "bookmark")).toBe(true);
    expect(Object.hasOwn(body, "project_id")).toBe(true);
    expect(Object.hasOwn(body, "queryLimits")).toBe(true);
    expect(body["project_id"]).toBe(12345);
  });

  it("returns a RetentionQueryResult", async () => {
    const { ws } = retentionWs();
    const result = await ws.queryRetention("Signup", "Login");
    expect(result).toBeInstanceOf(RetentionQueryResult);
  });

  it("cohorts has the right date keys (excluding $average)", async () => {
    const { ws } = retentionWs();
    const result = await ws.queryRetention("Signup", "Login");

    expect(Object.hasOwn(result.cohorts, "2025-01-01")).toBe(true);
    expect(Object.hasOwn(result.cohorts, "$average")).toBe(false);
    const cohort = result.cohorts["2025-01-01"]!;
    expect(cohort["first"]).toBe(100);
    expect(cohort["counts"]).toStrictEqual([100, 50, 25]);
    expect(cohort["rates"]).toStrictEqual([1.0, 0.5, 0.25]);
  });

  it("average is populated from the $average series entry", async () => {
    const { ws } = retentionWs();
    const result = await ws.queryRetention("Signup", "Login");

    expect(result.average).not.toBeNull();
    expect(result.average["first"]).toBe(100);
    expect(result.average["counts"]).toStrictEqual([100, 50, 25]);
    expect(result.average["rates"]).toStrictEqual([1.0, 0.5, 0.25]);
  });

  it("params is a non-empty dict with a sections key", async () => {
    const { ws } = retentionWs();
    const result = await ws.queryRetention("Signup", "Login");

    expect(typeof result.params).toBe("object");
    expect(Object.keys(result.params).length).toBeGreaterThan(0);
    expect(Object.hasOwn(result.params, "sections")).toBe(true);
  });
});

// ===========================================================================
// T-US2: per-event filters
// ===========================================================================

describe("TestQueryRetentionWithFilters", () => {
  it("per-event filters appear in the bookmark behaviors", async () => {
    const { ws, mock } = retentionWs();
    const born = new RetentionEvent({
      event: "Signup",
      filters: [Filter.equals("source", "organic")],
    });

    await ws.queryRetention(born, "Login");

    const bookmark = mock.insightsCalls[0]!["bookmark"] as Record<
      string,
      unknown
    >;
    const sections = bookmark["sections"] as Record<string, unknown>;
    const show = sections["show"] as Array<Record<string, unknown>>;
    const behavior = show[0]!["behavior"] as Record<string, unknown>;
    const behaviors = behavior["behaviors"] as Array<Record<string, unknown>>;
    expect((behaviors[0]!["filters"] as unknown[]).length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// T-US4: build_retention_params
// ===========================================================================

describe("TestBuildRetentionParams", () => {
  it("returns a dict, not a RetentionQueryResult", async () => {
    const result = await workspaceFactory(
      mockWorkspaceClient(),
    ).buildRetentionParams("Signup", "Login");
    expect(typeof result).toBe("object");
    expect(result).not.toBeInstanceOf(RetentionQueryResult);
  });

  it("has sections and displayOptions keys", async () => {
    const result = await workspaceFactory(
      mockWorkspaceClient(),
    ).buildRetentionParams("Signup", "Login");
    expect(Object.hasOwn(result, "sections")).toBe(true);
    expect(Object.hasOwn(result, "displayOptions")).toBe(true);
  });

  it("makes no API call", async () => {
    const mock = mockWorkspaceClient();
    await workspaceFactory(mock).buildRetentionParams("Signup", "Login");
    expect(mock.insightsCalls).toHaveLength(0);
  });

  it("matches the bookmark query_retention sends", async () => {
    const { ws, mock } = retentionWs();
    const params = await ws.buildRetentionParams("Signup", "Login");

    await ws.queryRetention("Signup", "Login");
    const bookmark = mock.insightsCalls[0]!["bookmark"];

    expect(params).toStrictEqual(bookmark);
  });
});

// ===========================================================================
// T-US5: validation integration
// ===========================================================================

describe("TestQueryRetentionValidationIntegration", () => {
  it("an empty born_event is caught before the API call", async () => {
    const mock = mockWorkspaceClient();
    await expect(
      workspaceFactory(mock).queryRetention("", "Login"),
    ).rejects.toThrow(/RetentionEvent\.event must be a non-empty/);
    expect(mock.insightsCalls).toHaveLength(0);
  });
});
