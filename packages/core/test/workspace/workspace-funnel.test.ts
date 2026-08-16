// Translated workspace-funnel tests (B5-S2, packet §3): assertion-for-
// assertion port of tests/test_workspace_funnel.py (R10.2) — ALL 3
// classes (TestQueryFunnelValidation :108, TestQueryFunnelExecution
// :233, TestBuildFunnelParamsVsQueryFunnel :381).
//
// The Python file also carries a `TestQueryFunnelConfigError` REMOVAL
// comment (:103) — nothing to translate.
//
// Translation notes:
// - `insights_query.call_args[0][0]` becomes `mock.insightsCalls[0]`.
// - `pytest.raises(ValueError, match="FunnelStep.event must be a
//   non-empty")` names Python's `ParamValidationError`, which
//   dual-inherits `ValueError`; the TS twin is `ParamValidationError`
//   with the same message.
// - `result.overall_conversion_rate == pytest.approx(0.12)` becomes
//   `toBeCloseTo(0.12)`.
// - `assert not isinstance(params, FunnelQueryResult)` translates
//   directly.

import { describe, expect, it } from "vitest";
import { Workspace } from "../../src/workspace.js";
import type { BookmarkValidationError } from "../../src/errors.js";
import { FunnelQueryResult } from "../../src/types/results/query-engine.js";
import {
  mockWorkspaceClient,
  TEST_SESSION,
  type MockWorkspaceClient,
} from "./workspace-test-helpers.js";

/**
 * The `workspace_factory` fixture (test file :44-66).
 *
 * @param mock - The stub client.
 * @returns The facade under test.
 */
function workspaceFactory(mock: MockWorkspaceClient): Workspace {
  return new Workspace({ session: TEST_SESSION, client: mock.client });
}

/** Canonical mock response for a two-step funnel query (test file :69). */
const MOCK_FUNNEL_RESPONSE: Record<string, unknown> = {
  computed_at: "2025-01-15T12:00:00",
  date_range: { from_date: "2025-01-01", to_date: "2025-01-31" },
  headers: ["$funnel"],
  series: {
    steps: [
      {
        event: "Signup",
        count: 1000,
        step_conv_ratio: 1.0,
        overall_conv_ratio: 1.0,
        avg_time: 0.0,
        avg_time_from_start: 0.0,
      },
      {
        event: "Purchase",
        count: 120,
        step_conv_ratio: 0.12,
        overall_conv_ratio: 0.12,
        avg_time: 86400.0,
        avg_time_from_start: 86400.0,
      },
    ],
  },
  meta: { sampling_factor: 1.0 },
};

/** Read the collected `BookmarkValidationError` codes. */
function codesOf(exc: unknown): string[] {
  return (exc as BookmarkValidationError).errors.map((e) => e.code);
}

// ===========================================================================
// T021: validation integration
// ===========================================================================

describe("TestQueryFunnelValidation", () => {
  it("a single-step funnel raises F1_MIN_STEPS", async () => {
    const mock = mockWorkspaceClient();
    try {
      await workspaceFactory(mock).queryFunnel(["A"]);
      expect.unreachable("expected BookmarkValidationError");
    } catch (exc) {
      expect(codesOf(exc)).toContain("F1_MIN_STEPS");
    }
    expect(mock.insightsCalls.length).toBe(0);
  });

  it("an empty event name is caught at FunnelStep construction", async () => {
    const mock = mockWorkspaceClient();
    await expect(
      workspaceFactory(mock).queryFunnel(["Signup", ""]),
    ).rejects.toThrow(/FunnelStep\.event must be a non-empty/);
    expect(mock.insightsCalls.length).toBe(0);
  });

  it("a negative conversion_window raises F3", async () => {
    const mock = mockWorkspaceClient();
    try {
      await workspaceFactory(mock).queryFunnel(["A", "B"], {
        conversion_window: -1,
      });
      expect.unreachable("expected BookmarkValidationError");
    } catch (exc) {
      expect(codesOf(exc)).toContain("F3_CONVERSION_WINDOW_POSITIVE");
    }
    expect(mock.insightsCalls.length).toBe(0);
  });

  it("an invalid math type raises B9_INVALID_MATH at Layer 2", async () => {
    const mock = mockWorkspaceClient();
    try {
      await workspaceFactory(mock).queryFunnel(["A", "B"], {
        math: "invalid_math",
      });
      expect.unreachable("expected BookmarkValidationError");
    } catch (exc) {
      expect(codesOf(exc)).toContain("B9_INVALID_MATH");
    }
    expect(mock.insightsCalls.length).toBe(0);
  });

  it("an empty event is caught before validation runs", async () => {
    const mock = mockWorkspaceClient();
    await expect(
      workspaceFactory(mock).queryFunnel([""], { conversion_window: 0 }),
    ).rejects.toThrow(/FunnelStep\.event must be a non-empty/);
    expect(mock.insightsCalls.length).toBe(0);
  });

  it("multiple validation errors are collected into one error", async () => {
    const mock = mockWorkspaceClient();
    try {
      await workspaceFactory(mock).queryFunnel(["ValidEvent"], {
        conversion_window: 0, // F3: must be positive
        from_date: "bad-date", // V8: invalid format
      });
      expect.unreachable("expected BookmarkValidationError");
    } catch (exc) {
      const err = exc as BookmarkValidationError;
      const codes = new Set(codesOf(err));
      expect(codes.has("F1_MIN_STEPS")).toBe(true); // only 1 step
      expect(codes.has("F3_CONVERSION_WINDOW_POSITIVE")).toBe(true);
      expect(err.errorCount).toBeGreaterThanOrEqual(2);
    }
    expect(mock.insightsCalls.length).toBe(0);
  });
});

// ===========================================================================
// T022: execution path
// ===========================================================================

describe("TestQueryFunnelExecution", () => {
  /** Build the facade with the canonical funnel response installed. */
  function funnelWs(): { ws: Workspace; mock: MockWorkspaceClient } {
    const mock = mockWorkspaceClient();
    mock.setInsightsResponse(MOCK_FUNNEL_RESPONSE);
    return { ws: workspaceFactory(mock), mock };
  }

  it("sends a body with bookmark, project_id and queryLimits", async () => {
    const { ws, mock } = funnelWs();
    await ws.queryFunnel(["Signup", "Purchase"]);

    expect(mock.insightsCalls.length).toBe(1);
    const body = mock.insightsCalls[0]!;
    expect(Object.hasOwn(body, "bookmark")).toBe(true);
    expect(Object.hasOwn(body, "project_id")).toBe(true);
    expect(Object.hasOwn(body, "queryLimits")).toBe(true);
    expect(body["project_id"]).toBe(12345);
    expect(body["queryLimits"]).toEqual({ limit: 3000 });
  });

  it("the bookmark carries sections and displayOptions", async () => {
    const { ws, mock } = funnelWs();
    await ws.queryFunnel(["Signup", "Purchase"]);

    const bookmark = mock.insightsCalls[0]!["bookmark"] as Record<
      string,
      unknown
    >;
    expect(Object.hasOwn(bookmark, "sections")).toBe(true);
    expect(Object.hasOwn(bookmark, "displayOptions")).toBe(true);
  });

  it("returns a FunnelQueryResult", async () => {
    const { ws } = funnelWs();
    const result = await ws.queryFunnel(["Signup", "Purchase"]);
    expect(result).toBeInstanceOf(FunnelQueryResult);
  });

  it("the result fields match the mock response", async () => {
    const { ws } = funnelWs();
    const result = await ws.queryFunnel(["Signup", "Purchase"]);

    expect(result.computed_at).toBe("2025-01-15T12:00:00");
    expect(result.from_date).toBe("2025-01-01");
    expect(result.to_date).toBe("2025-01-31");
    expect(result.meta).toEqual({ sampling_factor: 1.0 });
  });

  it("steps_data carries the step-level information", async () => {
    const { ws } = funnelWs();
    const result = await ws.queryFunnel(["Signup", "Purchase"]);

    expect(result.steps_data.length).toBe(2);

    const step1 = result.steps_data[0]!;
    expect(step1["event"]).toBe("Signup");
    expect(step1["count"]).toBe(1000);
    expect(step1["step_conv_ratio"]).toBe(1.0);
    expect(step1["overall_conv_ratio"]).toBe(1.0);

    const step2 = result.steps_data[1]!;
    expect(step2["event"]).toBe("Purchase");
    expect(step2["count"]).toBe(120);
    expect(step2["step_conv_ratio"]).toBe(0.12);
    expect(step2["overall_conv_ratio"]).toBe(0.12);
    expect(step2["avg_time"]).toBe(86400.0);
  });

  it("overall_conversion_rate matches the last step ratio", async () => {
    const { ws } = funnelWs();
    const result = await ws.queryFunnel(["Signup", "Purchase"]);
    expect(result.overall_conversion_rate).toBeCloseTo(0.12);
  });

  it("params is preserved for debugging", async () => {
    const { ws } = funnelWs();
    const result = await ws.queryFunnel(["Signup", "Purchase"]);

    expect(typeof result.params).toBe("object");
    expect(Object.hasOwn(result.params, "sections")).toBe(true);
    expect(Object.hasOwn(result.params, "displayOptions")).toBe(true);
  });
});

// ===========================================================================
// T023: build_funnel_params vs query_funnel
// ===========================================================================

describe("TestBuildFunnelParamsVsQueryFunnel", () => {
  it("returns a plain dict, not a result object", async () => {
    const params = await workspaceFactory(mockWorkspaceClient()).buildFunnelParams(
      ["Signup", "Purchase"],
    );
    expect(typeof params).toBe("object");
    expect(params).not.toBeInstanceOf(FunnelQueryResult);
  });

  it("produces the same params query_funnel sends", async () => {
    const mock = mockWorkspaceClient();
    mock.setInsightsResponse(MOCK_FUNNEL_RESPONSE);
    const ws = workspaceFactory(mock);

    const builtParams = await ws.buildFunnelParams(["Signup", "Purchase"]);
    await ws.queryFunnel(["Signup", "Purchase"]);
    const queryParams = mock.insightsCalls[0]!["bookmark"];

    expect(builtParams).toEqual(queryParams);
  });

  it("makes no API call", async () => {
    const mock = mockWorkspaceClient();
    await workspaceFactory(mock).buildFunnelParams(["Signup", "Purchase"]);
    expect(mock.insightsCalls.length).toBe(0);
  });

  it("raises BookmarkValidationError for invalid inputs", async () => {
    const mock = mockWorkspaceClient();
    try {
      await workspaceFactory(mock).buildFunnelParams(["A"]);
      expect.unreachable("expected BookmarkValidationError");
    } catch (exc) {
      expect(codesOf(exc)).toContain("F1_MIN_STEPS");
    }
    expect(mock.insightsCalls.length).toBe(0);
  });

  it("the result has sections and displayOptions", async () => {
    const params = await workspaceFactory(mockWorkspaceClient()).buildFunnelParams(
      ["Signup", "Purchase"],
    );
    expect(Object.hasOwn(params, "sections")).toBe(true);
    expect(Object.hasOwn(params, "displayOptions")).toBe(true);
  });
});
