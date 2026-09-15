// Translated `limit` / `run_*_params` tests (Python PR #225, Linear
// AIE-924): assertion-for-assertion port of
// tests/unit/test_query_limit.py (R10.2) — ALL 4 classes
// (TestQueryLimitsValidator :150, TestServiceLimitPassthrough :215,
// TestWorkspaceLimitPassthrough :324, TestRunParams :412).
//
// Translation notes:
// - `_query_limits` is the exported {@link queryLimits} twin;
//   `DEFAULT_SEGMENTATION_LIMIT` / `MAX_SEGMENTATION_LIMIT` are exported
//   under the same names.
// - `pytest.raises(ValueError, match=LIMIT_ERROR)` names the
//   python-builtins {@link ValueError} twin (plain, uncoded — Python
//   added NO error code for this guard; the contract still pins 126).
// - `test_rejects_non_integers` parametrizes `3000.0`: a JS number
//   cannot carry float-ness, so `3000.0 === 3000` and that case is
//   NOT translatable (R10.12 — the TS surface has no float twin here).
//   `None.__class__` (a type object) becomes a class reference.
// - The Python `mock_api_client.insights_query.call_args.kwargs`
//   becomes the recorded options bag (`mock.insightsOptions[i]`).
// - `try: ... finally: ws.close()` is dropped per
//   `workspace-test-helpers.ts` (the TS facade owns no pool).
// - The `ws.query(...)` / `ws.buildParams(...)` round-trip pins the
//   `today` clock seam on both sides so the default `last=30` window
//   cannot straddle midnight between the two calls.

import { describe, expect, it } from "vitest";

import { ValueError } from "../../src/query/python-builtins.js";
import {
  DEFAULT_SEGMENTATION_LIMIT,
  LiveQueryService,
  MAX_SEGMENTATION_LIMIT,
  queryLimits,
} from "../../src/services/live-query.js";
import {
  FunnelQueryResult,
  QueryResult,
  RetentionQueryResult,
} from "../../src/types/results/query-engine.js";
import { Workspace } from "../../src/workspace.js";
import {
  type MockWorkspaceClient,
  mockWorkspaceClient,
  TEST_SESSION,
} from "../../test-support/workspace-test-helpers.js";

// ===========================================================================
// Fixtures and mock responses (test file :36-147)
// ===========================================================================

/**
 * The `workspace_factory` fixture (test file :53-79).
 *
 * @param mock - The stub client.
 * @returns The facade under test.
 */
function workspaceFactory(mock: MockWorkspaceClient): Workspace {
  return new Workspace({ session: TEST_SESSION, client: mock.client });
}

/** Expected message for every rejected `limit` (`LIMIT_ERROR`). */
const LIMIT_ERROR = /limit must be an integer between 1 and 50000/;

/** Canonical mock response for an insights query. */
const MOCK_INSIGHTS_RESPONSE: Record<string, unknown> = {
  computed_at: "2025-01-15T12:00:00",
  date_range: { from_date: "2025-01-01", to_date: "2025-01-31" },
  headers: ["$event"],
  series: { "A. Login": { "2025-01-01": 10 } },
  meta: { sampling_factor: 1.0 },
};

/** Canonical mock response for a two-step funnel query. */
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

/** Canonical mock response for a retention query. */
const MOCK_RETENTION_RESPONSE: Record<string, unknown> = {
  computed_at: "2025-01-15T12:00:00",
  date_range: { from_date: "2025-01-01", to_date: "2025-01-31" },
  headers: ["$retention"],
  series: { "2025-01-01": { counts: [100, 40], first: 100 } },
  meta: { sampling_factor: 1.0 },
};

/** The pinned clock for the build/run round-trip. */
const TODAY = (): string => "2025-01-15";

/**
 * Read the `queryLimits.limit` from the last recorded request body
 * (`sent_limit`).
 *
 * @param mock - The stub whose `insightsQuery` was called.
 * @returns The limit integer sent to the API.
 */
function sentLimit(mock: MockWorkspaceClient): unknown {
  const body = mock.insightsCalls.at(-1)!;
  return (body["queryLimits"] as Record<string, unknown>)["limit"];
}

/**
 * The last recorded `insights_query` body (`call_args[0][0]`).
 *
 * @param mock - The stub client.
 * @returns The request body.
 */
function lastBody(mock: MockWorkspaceClient): Record<string, unknown> {
  return mock.insightsCalls.at(-1)!;
}

// ===========================================================================
// TestQueryLimitsValidator (test file :150-212)
// ===========================================================================

describe("TestQueryLimitsValidator", () => {
  it("none yields the default", () => {
    expect(queryLimits(null)).toStrictEqual({
      limit: DEFAULT_SEGMENTATION_LIMIT,
    });
    // TS-only: an omitted option arrives as `undefined` — same default.
    expect(queryLimits(undefined)).toStrictEqual({
      limit: DEFAULT_SEGMENTATION_LIMIT,
    });
  });

  it.each([1, 3000, 49_999, MAX_SEGMENTATION_LIMIT])(
    "accepts values in range: %s",
    (limit) => {
      expect(queryLimits(limit)).toStrictEqual({ limit });
    },
  );

  it.each([0, -1, MAX_SEGMENTATION_LIMIT + 1, 500_000])(
    "rejects values out of range: %s",
    (limit) => {
      expect(() => queryLimits(limit)).toThrow(ValueError);
      expect(() => queryLimits(limit)).toThrow(LIMIT_ERROR);
    },
  );

  it.each([true, false])("rejects booleans: %s", (limit) => {
    expect(() => queryLimits(limit as unknown as number)).toThrow(ValueError);
    expect(() => queryLimits(limit as unknown as number)).toThrow(LIMIT_ERROR);
  });

  // `3000.0` is untranslatable (see the header note); the remaining
  // three cases port as-is.
  it.each([2999.5, "3000", Object])("rejects non-integers: %s", (limit) => {
    expect(() => queryLimits(limit as unknown as number)).toThrow(ValueError);
    expect(() => queryLimits(limit as unknown as number)).toThrow(LIMIT_ERROR);
  });

  it("default and maximum constants", () => {
    expect(DEFAULT_SEGMENTATION_LIMIT).toBe(3000);
    expect(MAX_SEGMENTATION_LIMIT).toBe(50_000);
  });

  // TS-only: the error text renders the rejected value the way Python's
  // `{limit!r}` does, and a JSON-number body is produced for a bigint
  // (a Python int) inside the band.
  it("renders the rejected value with Python repr", () => {
    expect(() => queryLimits("3000" as unknown as number)).toThrow(
      "limit must be an integer between 1 and 50000, got '3000'",
    );
    expect(() => queryLimits(0)).toThrow(
      "limit must be an integer between 1 and 50000, got 0",
    );
  });

  it("narrows an in-band bigint to a JSON number", () => {
    expect(queryLimits(42n)).toStrictEqual({ limit: 42 });
    expect(() => queryLimits(50_001n)).toThrow(LIMIT_ERROR);
  });
});

// ===========================================================================
// TestServiceLimitPassthrough (test file :215-321)
// ===========================================================================

describe("TestServiceLimitPassthrough", () => {
  /**
   * The `service` fixture (test file :218-228).
   *
   * @param mock - The stub client.
   * @returns The service under test.
   */
  function service(mock: MockWorkspaceClient): LiveQueryService {
    return new LiveQueryService(mock.client);
  }

  it("query defaults to 3000", async () => {
    const mock = mockWorkspaceClient();
    mock.setInsightsResponse(MOCK_INSIGHTS_RESPONSE);
    await service(mock).query({ sections: {} }, 12345);
    expect(sentLimit(mock)).toBe(3000);
  });

  it("query forwards limit", async () => {
    const mock = mockWorkspaceClient();
    mock.setInsightsResponse(MOCK_INSIGHTS_RESPONSE);
    await service(mock).query({ sections: {} }, 12345, { limit: 50_000 });
    expect(sentLimit(mock)).toBe(50_000);
  });

  it("query_funnel defaults to 3000", async () => {
    const mock = mockWorkspaceClient();
    mock.setInsightsResponse(MOCK_FUNNEL_RESPONSE);
    await service(mock).queryFunnel({ sections: {} }, 12345);
    expect(sentLimit(mock)).toBe(3000);
  });

  it("query_funnel forwards limit", async () => {
    const mock = mockWorkspaceClient();
    mock.setInsightsResponse(MOCK_FUNNEL_RESPONSE);
    await service(mock).queryFunnel({ sections: {} }, 12345, {
      limit: 25_000,
    });
    expect(sentLimit(mock)).toBe(25_000);
  });

  it("query_retention defaults to 3000", async () => {
    const mock = mockWorkspaceClient();
    mock.setInsightsResponse(MOCK_RETENTION_RESPONSE);
    await service(mock).queryRetention({ sections: {} }, 12345);
    expect(sentLimit(mock)).toBe(3000);
  });

  it("query_retention forwards limit", async () => {
    const mock = mockWorkspaceClient();
    mock.setInsightsResponse(MOCK_RETENTION_RESPONSE);
    await service(mock).queryRetention({ sections: {} }, 12345, {
      limit: 10,
    });
    expect(sentLimit(mock)).toBe(10);
  });

  it.each(["query", "queryFunnel", "queryRetention"] as const)(
    "out-of-range limit never reaches the API: %s",
    async (method) => {
      const mock = mockWorkspaceClient();
      const live = service(mock);
      await expect(
        live[method]({ sections: {} }, 12345, { limit: 50_001 }),
      ).rejects.toThrow(ValueError);
      await expect(
        live[method]({ sections: {} }, 12345, { limit: 50_001 }),
      ).rejects.toThrow(LIMIT_ERROR);
      expect(mock.insightsCalls).toHaveLength(0);
    },
  );
});

// ===========================================================================
// TestWorkspaceLimitPassthrough (test file :324-409)
// ===========================================================================

describe("TestWorkspaceLimitPassthrough", () => {
  it("query forwards limit", async () => {
    const mock = mockWorkspaceClient();
    mock.setInsightsResponse(MOCK_INSIGHTS_RESPONSE);
    const ws = workspaceFactory(mock);
    await ws.query("Login", { limit: 50_000 });
    expect(sentLimit(mock)).toBe(50_000);
  });

  it("query default is unchanged", async () => {
    const mock = mockWorkspaceClient();
    mock.setInsightsResponse(MOCK_INSIGHTS_RESPONSE);
    const ws = workspaceFactory(mock);
    await ws.query("Login");
    expect(sentLimit(mock)).toBe(3000);
  });

  it("query_funnel forwards limit", async () => {
    const mock = mockWorkspaceClient();
    mock.setInsightsResponse(MOCK_FUNNEL_RESPONSE);
    const ws = workspaceFactory(mock);
    await ws.queryFunnel(["Signup", "Purchase"], { limit: 12_345 });
    expect(sentLimit(mock)).toBe(12_345);
  });

  it("query_retention forwards limit", async () => {
    const mock = mockWorkspaceClient();
    mock.setInsightsResponse(MOCK_RETENTION_RESPONSE);
    const ws = workspaceFactory(mock);
    await ws.queryRetention("Signup", "Login", { limit: 42 });
    expect(sentLimit(mock)).toBe(42);
  });

  it("out-of-range limit raises", async () => {
    const mock = mockWorkspaceClient();
    const ws = workspaceFactory(mock);
    await expect(ws.query("Login", { limit: 0 })).rejects.toThrow(ValueError);
    await expect(ws.query("Login", { limit: 0 })).rejects.toThrow(LIMIT_ERROR);
    expect(mock.insightsCalls).toHaveLength(0);
  });

  // TS-only: `limit` is an execution setting; the builders must not
  // leak it into the params dict (Python's `build_*_params` signatures
  // never received it).
  it("build_params ignores limit", async () => {
    const ws = workspaceFactory(mockWorkspaceClient());
    const withLimit = await ws.buildParams("Login", {
      limit: 50_000,
      today: TODAY,
    });
    const without = await ws.buildParams("Login", { today: TODAY });
    expect(withLimit).toStrictEqual(without);
    expect(JSON.stringify(withLimit)).not.toContain("50000");
  });
});

// ===========================================================================
// TestRunParams (test file :412-568)
// ===========================================================================

describe("TestRunParams", () => {
  it("run_params returns a query result", async () => {
    const mock = mockWorkspaceClient();
    mock.setInsightsResponse(MOCK_INSIGHTS_RESPONSE);
    const ws = workspaceFactory(mock);
    const params = await ws.buildParams("Login");
    const result = await ws.runParams(params);

    expect(result).toBeInstanceOf(QueryResult);
    const body = lastBody(mock);
    expect(body["bookmark"]).toStrictEqual(params);
    expect(body["project_id"]).toBe(12345);
    expect(body["queryLimits"]).toStrictEqual({ limit: 3000 });
  });

  it("run_params matches query", async () => {
    const mock = mockWorkspaceClient();
    mock.setInsightsResponse(MOCK_INSIGHTS_RESPONSE);
    const ws = workspaceFactory(mock);

    await ws.query("Login", { last: 7, today: TODAY });
    const direct = lastBody(mock);

    await ws.runParams(
      await ws.buildParams("Login", { last: 7, today: TODAY }),
    );
    const roundTrip = lastBody(mock);

    expect(roundTrip).toStrictEqual(direct);
  });

  it("run_params forwards limit", async () => {
    const mock = mockWorkspaceClient();
    mock.setInsightsResponse(MOCK_INSIGHTS_RESPONSE);
    const ws = workspaceFactory(mock);
    await ws.runParams({ sections: {} }, { limit: 50_000 });
    expect(sentLimit(mock)).toBe(50_000);
  });

  it("run_params forwards workspace_id", async () => {
    const mock = mockWorkspaceClient();
    mock.setInsightsResponse(MOCK_INSIGHTS_RESPONSE);
    const ws = workspaceFactory(mock);
    await ws.runParams({ sections: {} }, { workspace_id: 99 });
    expect(mock.insightsOptions.at(-1)!["workspace_id"]).toBe(99);
  });

  it("run_funnel_params returns a funnel result", async () => {
    const mock = mockWorkspaceClient();
    mock.setInsightsResponse(MOCK_FUNNEL_RESPONSE);
    const ws = workspaceFactory(mock);
    const params = await ws.buildFunnelParams(["Signup", "Purchase"]);
    const result = await ws.runFunnelParams(params, { limit: 7000 });

    expect(result).toBeInstanceOf(FunnelQueryResult);
    expect(sentLimit(mock)).toBe(7000);
    expect(lastBody(mock)["bookmark"]).toStrictEqual(params);
  });

  it("run_retention_params returns a retention result", async () => {
    const mock = mockWorkspaceClient();
    mock.setInsightsResponse(MOCK_RETENTION_RESPONSE);
    const ws = workspaceFactory(mock);
    const params = await ws.buildRetentionParams("Signup", "Login");
    const result = await ws.runRetentionParams(params, { limit: 7000 });

    expect(result).toBeInstanceOf(RetentionQueryResult);
    expect(sentLimit(mock)).toBe(7000);
    expect(lastBody(mock)["bookmark"]).toStrictEqual(params);
  });

  it.each(["runParams", "runFunnelParams", "runRetentionParams"] as const)(
    "out-of-range limit raises: %s",
    async (method) => {
      const mock = mockWorkspaceClient();
      const ws = workspaceFactory(mock);
      await expect(
        ws[method]({ sections: {} }, { limit: 50_001 }),
      ).rejects.toThrow(ValueError);
      await expect(
        ws[method]({ sections: {} }, { limit: 50_001 }),
      ).rejects.toThrow(LIMIT_ERROR);
      expect(mock.insightsCalls).toHaveLength(0);
    },
  );
});
