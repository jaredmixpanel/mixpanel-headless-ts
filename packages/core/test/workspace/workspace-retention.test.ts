// Workspace.queryRetention: integration through the stubbed insights client,
// filters, buildRetentionParams and validation. Mirrors all four classes of
// tests/test_workspace_retention.py. `call_args[0][0]` reads become
// `mock.insightsCalls[0]`; `pytest.raises(ValueError, …)` names the
// dual-inheriting ParamValidationError.

import { describe, expect, it } from "vitest";

import { Filter } from "../../src/types/query-params/filter.js";
import { RetentionEvent } from "../../src/types/query-params/retention.js";
import { RetentionQueryResult } from "../../src/types/results/query-engine.js";
import type { Workspace } from "../../src/workspace.js";
import {
  makeStubWorkspace,
  type MockWorkspaceClient,
  mockWorkspaceClient,
} from "../../test-support/workspace-test-helpers.js";

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
  return { ws: makeStubWorkspace(mock), mock };
}

// --- Workspace integration ---

describe("Query retention integration", () => {
  // python: TestQueryRetentionIntegration
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

// --- Per-event filters ---

describe("Query retention with filters", () => {
  // python: TestQueryRetentionWithFilters
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

// --- buildRetentionParams ---

describe("Build retention params", () => {
  // python: TestBuildRetentionParams
  it("returns a dict, not a RetentionQueryResult", async () => {
    const result = await makeStubWorkspace(
      mockWorkspaceClient(),
    ).buildRetentionParams("Signup", "Login");
    expect(typeof result).toBe("object");
    expect(result).not.toBeInstanceOf(RetentionQueryResult);
  });

  it("has sections and displayOptions keys", async () => {
    const result = await makeStubWorkspace(
      mockWorkspaceClient(),
    ).buildRetentionParams("Signup", "Login");
    expect(Object.hasOwn(result, "sections")).toBe(true);
    expect(Object.hasOwn(result, "displayOptions")).toBe(true);
  });

  it("makes no API call", async () => {
    const mock = mockWorkspaceClient();
    await makeStubWorkspace(mock).buildRetentionParams("Signup", "Login");
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

// --- Validation integration ---

describe("Query retention validation integration", () => {
  // python: TestQueryRetentionValidationIntegration
  it("an empty born_event is caught before the API call", async () => {
    const mock = mockWorkspaceClient();
    await expect(
      makeStubWorkspace(mock).queryRetention("", "Login"),
    ).rejects.toThrow(/RetentionEvent\.event must be a non-empty/);
    expect(mock.insightsCalls).toHaveLength(0);
  });
});
