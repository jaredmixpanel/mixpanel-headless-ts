// Translated insights-query integration tests (B5-S2, packet §3):
// assertion-for-assertion port of tests/unit/test_query_integration.py
// (R10.2) — ALL 9 classes (TestQueryTimeseries :109,
// TestQueryNonExistentEvent :191, TestMultiEventIntegration :233,
// TestFormulaIntegration :266, TestTotalModeIntegration :290,
// TestQueryPersistence :310, TestTransformQueryResultValidation :330,
// TestFormulaInListIntegration :374, TestBuildParamsNoApiCall :430).
//
// Translation notes:
// - `mock_api_client` / `ws` come from the shared
//   `workspace-test-helpers.ts` stub; the Python `ws` fixture builds a
//   real Workspace and then assigns `_api_client`, which is the injected
//   `client` option here.
// - `insights_query.call_args` becomes the recorded body
//   (`mock.insightsCalls[0]`).
// - `.df` asserts become `toRows()` / `rowColumns()` (C6);
//   `df.iloc[0]["count"]` becomes `toRows()[0]["count"]`.
// - `test_works_without_credentials` builds a Workspace with NO injected
//   client. In TS the constructor would build a real one from the
//   session, which is exactly Python's behaviour (a client object exists
//   but is never called) — the case still proves `build_params` issues
//   no request, asserted through the fake transport's empty capture log.

import { describe, expect, it } from "vitest";
import { Workspace } from "../../src/workspace.js";
import { QueryError } from "../../src/errors.js";
import { Filter } from "../../src/types/query-params/filter.js";
import { Formula, Metric } from "../../src/types/query-params/metric.js";
import { QueryResult } from "../../src/types/results/query-engine.js";
import {
  createMockClient,
  makeSession,
} from "../client/client-test-helpers.js";
import {
  mockWorkspaceClient,
  TEST_SESSION,
  type MockWorkspaceClient,
} from "./workspace-test-helpers.js";

/**
 * The `ws` fixture (test file :47-52).
 *
 * @param mock - The stub client.
 * @returns The facade under test.
 */
function workspaceFactory(mock: MockWorkspaceClient): Workspace {
  return new Workspace({ session: TEST_SESSION, client: mock.client });
}

const TIMESERIES_RESPONSE: Record<string, unknown> = {
  computed_at: "2024-01-31T12:00:00+00:00",
  date_range: {
    from_date: "2024-01-01T00:00:00-07:00",
    to_date: "2024-01-31T23:59:59.999000-07:00",
  },
  headers: ["$metric"],
  series: {
    "Login [Total Events]": {
      "2024-01-01T00:00:00-07:00": 100,
      "2024-01-02T00:00:00-07:00": 200,
      "2024-01-03T00:00:00-07:00": 150,
    },
  },
  meta: {
    min_sampling_factor: 1.0,
    is_segmentation_limit_hit: false,
    sub_query_count: 1,
  },
};

const TOTAL_RESPONSE: Record<string, unknown> = {
  computed_at: "2024-01-31T12:00:00+00:00",
  date_range: {
    from_date: "2024-01-01T00:00:00-07:00",
    to_date: "2024-01-31T23:59:59.999000-07:00",
  },
  headers: ["$metric"],
  series: { "Login [Unique Users]": { all: 3551 } },
  meta: { min_sampling_factor: 1.0, is_segmentation_limit_hit: false },
};

const EMPTY_RESPONSE: Record<string, unknown> = {
  computed_at: "2024-01-31T12:00:00+00:00",
  date_range: {
    from_date: "2024-01-01T00:00:00-07:00",
    to_date: "2024-01-31T23:59:59.999000-07:00",
  },
  headers: ["$metric"],
  series: {},
  meta: {},
};

const MULTI_EVENT_RESPONSE: Record<string, unknown> = {
  computed_at: "2024-01-31T12:00:00+00:00",
  date_range: {
    from_date: "2024-01-01T00:00:00-07:00",
    to_date: "2024-01-31T23:59:59.999000-07:00",
  },
  headers: ["$metric"],
  series: {
    "Signup [Unique Users]": { "2024-01-01": 50 },
    "Login [Unique Users]": { "2024-01-01": 200 },
    "Purchase [Unique Users]": { "2024-01-01": 30 },
  },
  meta: {},
};

const FORMULA_RESPONSE: Record<string, unknown> = {
  computed_at: "2024-01-31T12:00:00+00:00",
  date_range: {
    from_date: "2024-01-01T00:00:00-07:00",
    to_date: "2024-01-07T23:59:59.999000-07:00",
  },
  headers: ["$metric"],
  series: { "Conversion Rate": { "2024-01-01": 15.5, "2024-01-02": 18.2 } },
  meta: {},
};

/**
 * Build the facade with a canned insights response.
 *
 * @param response - The insights body the stub resolves with.
 * @returns The facade plus the stub (for call-log asserts).
 */
function wsWith(response: unknown): {
  ws: Workspace;
  mock: MockWorkspaceClient;
} {
  const mock = mockWorkspaceClient();
  mock.setInsightsResponse(response);
  return { ws: workspaceFactory(mock), mock };
}

/** Read `params.sections.show`. */
function showOf(params: Record<string, unknown>): Array<Record<string, unknown>> {
  const sections = params["sections"] as Record<string, unknown>;
  return sections["show"] as Array<Record<string, unknown>>;
}

// ===========================================================================
// T009: end-to-end timeseries
// ===========================================================================

describe("TestQueryTimeseries", () => {
  it("returns a QueryResult", async () => {
    const { ws } = wsWith(TIMESERIES_RESPONSE);
    expect(await ws.query("Login")).toBeInstanceOf(QueryResult);
  });

  it("carries computed_at from the response", async () => {
    const { ws } = wsWith(TIMESERIES_RESPONSE);
    const result = await ws.query("Login");
    expect(result.computed_at).toBe("2024-01-31T12:00:00+00:00");
  });

  it("extracts the nested date_range fields", async () => {
    const { ws } = wsWith(TIMESERIES_RESPONSE);
    const result = await ws.query("Login");
    expect(result.from_date).toContain("2024-01-01");
    expect(result.to_date).toContain("2024-01-31");
  });

  it("contains the series data", async () => {
    const { ws } = wsWith(TIMESERIES_RESPONSE);
    const result = await ws.query("Login");
    expect(Object.hasOwn(result.series, "Login [Total Events]")).toBe(true);
  });

  it("the timeseries frame has 3 rows and date/event/count columns", async () => {
    const { ws } = wsWith(TIMESERIES_RESPONSE);
    const result = await ws.query("Login");
    expect(result.toRows().length).toBe(3);
    expect(result.rowColumns()).toEqual(["date", "event", "count"]);
  });

  it("calls insights_query with the correct body structure", async () => {
    const { ws, mock } = wsWith(TIMESERIES_RESPONSE);
    await ws.query("Login");
    const body = mock.insightsCalls[0]!;
    expect(Object.hasOwn(body, "bookmark")).toBe(true);
    expect(Object.hasOwn(body, "project_id")).toBe(true);
    expect(body["project_id"]).toBe(12345);
    expect(Object.hasOwn(body, "queryLimits")).toBe(true);
  });

  it("params contains the bookmark dict", async () => {
    const { ws } = wsWith(TIMESERIES_RESPONSE);
    const result = await ws.query("Login");
    expect(typeof result.params).toBe("object");
    expect(Object.hasOwn(result.params, "sections")).toBe(true);
  });

  it("meta contains the response metadata", async () => {
    const { ws } = wsWith(TIMESERIES_RESPONSE);
    const result = await ws.query("Login");
    expect(Object.hasOwn(result.meta, "min_sampling_factor")).toBe(true);
  });
});

// ===========================================================================
// T009b: non-existent event
// ===========================================================================

describe("TestQueryNonExistentEvent", () => {
  it("an empty response raises nothing and yields zero rows", async () => {
    const { ws } = wsWith(EMPTY_RESPONSE);
    const result = await ws.query("NonExistentEvent");
    expect(result).toBeInstanceOf(QueryResult);
    expect(result.toRows().length).toBe(0);
  });

  it("an empty result still has computed_at", async () => {
    const { ws } = wsWith(EMPTY_RESPONSE);
    const result = await ws.query("NonExistentEvent");
    expect(result.computed_at).toBe("2024-01-31T12:00:00+00:00");
  });
});

// ===========================================================================
// T033: multi-event
// ===========================================================================

describe("TestMultiEventIntegration", () => {
  it("returns rows for all metrics", async () => {
    const { ws } = wsWith(MULTI_EVENT_RESPONSE);
    const result = await ws.query(["Signup", "Login", "Purchase"], {
      math: "unique",
    });
    expect(result.toRows().length).toBe(3);
    const events = new Set(result.toRows().map((r) => r["event"]));
    expect(events.size).toBe(3);
  });
});

// ===========================================================================
// T037: formula
// ===========================================================================

describe("TestFormulaIntegration", () => {
  it("a formula query returns the formula series", async () => {
    const { ws } = wsWith(FORMULA_RESPONSE);
    const result = await ws.query(
      [
        new Metric({ event: "Signup", math: "unique" }),
        new Metric({ event: "Purchase", math: "unique" }),
      ],
      { formula: "(B / A) * 100", formula_label: "Conversion Rate" },
    );
    expect(Object.hasOwn(result.series, "Conversion Rate")).toBe(true);
    expect(result.toRows().length).toBe(2);
  });
});

// ===========================================================================
// T046: total mode
// ===========================================================================

describe("TestTotalModeIntegration", () => {
  it("total mode returns a single row per metric", async () => {
    const { ws } = wsWith(TOTAL_RESPONSE);
    const result = await ws.query("Login", { math: "unique", mode: "total" });
    expect(result.toRows().length).toBe(1);
    expect(result.rowColumns()).toEqual(["event", "count"]);
    expect(result.toRows()[0]!["count"]).toBe(3551);
  });
});

// ===========================================================================
// T050: persistence
// ===========================================================================

describe("TestQueryPersistence", () => {
  it("params is suitable for create_bookmark", async () => {
    const { ws } = wsWith(TIMESERIES_RESPONSE);
    const result = await ws.query("Login", { math: "unique", last: 7 });
    expect(Object.hasOwn(result.params, "sections")).toBe(true);
    expect(Object.hasOwn(result.params, "displayOptions")).toBe(true);
    const sections = result.params["sections"] as Record<string, unknown>;
    expect(Object.hasOwn(sections, "show")).toBe(true);
  });
});

// ===========================================================================
// Response validation in the transform
// ===========================================================================

describe("TestTransformQueryResultValidation", () => {
  it("an error-as-200 raises QueryError", async () => {
    const { ws } = wsWith({ error: "invalid query", status: "fail" });
    await expect(ws.query("Login")).rejects.toThrow(
      /Insights query failed: invalid query/,
    );
  });

  it("a response missing 'series' raises QueryError", async () => {
    const { ws } = wsWith({
      computed_at: "2024-01-31T12:00:00+00:00",
      date_range: { from_date: "2024-01-01", to_date: "2024-01-31" },
      headers: [],
      meta: {},
    });
    await expect(ws.query("Login")).rejects.toThrow(/missing 'series' key/);
  });

  it("a valid response with a series key succeeds", async () => {
    const { ws } = wsWith(TIMESERIES_RESPONSE);
    const result = await ws.query("Login");
    expect(result).toBeInstanceOf(QueryResult);
    expect(Object.hasOwn(result.series, "Login [Total Events]")).toBe(true);
  });

  it("the raised class is QueryError", async () => {
    const { ws } = wsWith({ error: "invalid query", status: "fail" });
    await expect(ws.query("Login")).rejects.toBeInstanceOf(QueryError);
  });
});

// ===========================================================================
// Formula-in-list
// ===========================================================================

describe("TestFormulaInListIntegration", () => {
  it("a Formula in the events list produces a formula show clause", async () => {
    const { ws } = wsWith(TIMESERIES_RESPONSE);
    const result = await ws.query([
      new Metric({ event: "Signup", math: "unique" }),
      new Metric({ event: "Purchase", math: "unique" }),
      new Formula({ expression: "(B / A) * 100", label: "Conversion %" }),
    ]);

    const show = showOf(result.params);
    expect(show.length).toBe(3);
    expect((show[0]!["behavior"] as Record<string, unknown>)["name"]).toBe(
      "Signup",
    );
    expect((show[1]!["behavior"] as Record<string, unknown>)["name"]).toBe(
      "Purchase",
    );
    expect(show[2]!["type"]).toBe("formula");
    expect(show[2]!["definition"]).toBe("(B / A) * 100");
    expect(show[2]!["name"]).toBe("Conversion %");
  });

  it("metrics are hidden when a Formula is in the list", async () => {
    const { ws } = wsWith(TIMESERIES_RESPONSE);
    const result = await ws.query([
      new Metric({ event: "A", math: "unique" }),
      new Metric({ event: "B", math: "unique" }),
      new Formula({ expression: "A / B" }),
    ]);

    const show = showOf(result.params);
    expect(show[0]!["isHidden"]).toBe(true);
    expect(show[1]!["isHidden"]).toBe(true);
  });

  it("filters_combinator='any' reaches the behavior block", async () => {
    const { ws } = wsWith(TIMESERIES_RESPONSE);
    const result = await ws.query(
      new Metric({
        event: "Login",
        filters: [Filter.equals("$browser", "Chrome")],
        filters_combinator: "any",
      }),
    );

    const behavior = showOf(result.params)[0]!["behavior"] as Record<
      string,
      unknown
    >;
    expect(behavior["filtersDeterminer"]).toBe("any");
  });
});

// ===========================================================================
// T054d: build_params() does not invoke the API
// ===========================================================================

describe("TestBuildParamsNoApiCall", () => {
  it("build_params returns params without calling the client", async () => {
    const { ws, mock } = wsWith(TIMESERIES_RESPONSE);
    const result = await ws.buildParams("Login");
    expect(mock.insightsCalls.length).toBe(0);
    expect(typeof result).toBe("object");
  });

  it("build_params issues no request at all", async () => {
    // Python builds a Workspace with NO `_api_client`; the TS ctor
    // always has a client, so the equivalent proof is an empty capture
    // log on a real (fake-transport) client.
    const { client, transport } = createMockClient(makeSession(), () => ({
      status: 200,
      json: {},
    }));
    const workspace = new Workspace({ session: makeSession(), client });

    const result = await workspace.buildParams("Login");

    expect(Object.hasOwn(result, "sections")).toBe(true);
    expect(transport.captures.length).toBe(0);
  });
});
