// Layer-3 translation of `tests/unit/test_workspace_report_links.py`
// (045-report-links, Python PR #223) — the WHOLE file: every class from
// `TestCreateReportLinkFromDict` through `TestWorkspaceScope`
// (:1489), one `describe` per Python class, one `it` per test (Python
// `parametrize` → `it.each`), in source order.
//
// Translation notes:
// - The `mock_api_client` fixture (`MagicMock(spec=MixpanelAPIClient)`,
//   :68-78) becomes `mockApiClient()` below: a stub carrying only the
//   client members the report-link facade touches, each with a per-member
//   call log so `assert_called_once_with` / `assert_not_called` /
//   `method_calls == []` translate to list assertions. Its
//   `create_bookmark_url` echo side effect and `resolve_workspace_id`
//   return value (99) are the fixture defaults.
// - `@patch("mixpanel_headless.workspace.generate_slug", return_value=_SLUG)`
//   becomes the constructor seam `generateSlug: () => SLUG`.
// - The `mock_live_query` fixture (a spec'd `LiveQueryService` mock
//   installed on `ws._live_query`) has NO TS twin: the facade reads the
//   lazily-built `liveQueryService` getter, which is backed by the
//   injected client. The translations therefore stub the CLIENT's
//   `insightsQuery(body, scope)` / `arbFunnelsQuery(body, scope)` with a
//   minimal valid raw response and assert the recorded `body.bookmark`,
//   `body.project_id`, `body.query_type` (flows) and the `scope` bag
//   `{workspace_id, inject_workspace_id}` — the same values Python's
//   `assert_called_once_with(params, 12345, workspace_id=…,
//   inject_workspace_id=False)` pins. `result is sentinel` becomes an
//   `instanceof` check plus `result.params` (the service threads the
//   bookmark params through) — the identity of a mock return value has
//   no twin once the real service runs.
// - `patch.object(Workspace, "_validate_bookmark_params_schema",
//   return_value=[warning])` (:335) has no seam in TS; the twin drives
//   the REAL validator into a warning-only outcome (a `sorting` block
//   with an unknown chart type yields `S4_UNKNOWN_CHART_TYPE` at
//   severity `warning` and nothing else on otherwise-valid params).
// - `caplog` becomes the injected `logger` seam (`logCollector()`).
// - `dataclasses.replace(resolved, …)` becomes a rebuild through the
//   `ResolvedReport` constructor from the source's fields.
// - Error MESSAGE text is out of contract (rulebook R5.4): the
//   `str(exc) == ...` assertions are dropped; class, `.code`, and
//   `.details` (including `hint`) are asserted instead.
// - The `workspace_factory` fixture's `ws.close()` finalizers are
//   dropped (see `workspace-test-helpers.ts` header).

import { describe, expect, it } from "vitest";

import {
  ParamValidationError,
  ReportLinkScopeMismatchError,
  UnsupportedReportLinkError,
} from "../../src/errors.js";
import type { BookmarkType } from "../../src/types/literals.js";
import {
  FlowQueryResult,
  FunnelQueryResult,
  QueryResult,
  RetentionQueryResult,
} from "../../src/types/results/query-engine.js";
import { TEST_SESSION } from "../../test-support/workspace-test-helpers.js";
import {
  detailsOf,
  EU_SESSION,
  expectRaises,
  INSIGHTS_PARAMS,
  makeWorkspace,
  PINNED_SESSION,
  PROJECT_WIDE_SCOPE,
  resolvedReport,
  SLUG,
  slugRecord,
} from "./workspace-report-links-fixtures.js";

describe("Query report link", () => {
  // python: TestQueryReportLink
  it("insights", async () => {
    // python: test_insights
    const { ws, mock } = makeWorkspace();

    const result = await ws.queryReportLink(
      resolvedReport("insights", INSIGHTS_PARAMS),
    );

    expect(result).toBeInstanceOf(QueryResult);
    expect(result.params).toStrictEqual(INSIGHTS_PARAMS);
    expect(mock.insightsCalls).toHaveLength(1);
    const call = mock.insightsCalls[0]!;
    expect(call.body["bookmark"]).toStrictEqual(INSIGHTS_PARAMS);
    expect(call.body["project_id"]).toBe(12345);
    expect(call.scope).toStrictEqual(PROJECT_WIDE_SCOPE);
  });

  it("funnels", async () => {
    // python: test_funnels
    const { ws, mock } = makeWorkspace();

    const result = await ws.queryReportLink(
      resolvedReport("funnels", { steps: [] }),
    );

    expect(result).toBeInstanceOf(FunnelQueryResult);
    expect(result.params).toStrictEqual({ steps: [] });
    expect(mock.insightsCalls).toHaveLength(1);
    const call = mock.insightsCalls[0]!;
    expect(call.body["bookmark"]).toStrictEqual({ steps: [] });
    expect(call.body["project_id"]).toBe(12345);
    expect(call.scope).toStrictEqual(PROJECT_WIDE_SCOPE);
  });

  it("retention", async () => {
    // python: test_retention
    const { ws, mock } = makeWorkspace();

    const result = await ws.queryReportLink(
      resolvedReport("retention", { r: 1 }),
    );

    expect(result).toBeInstanceOf(RetentionQueryResult);
    expect(result.params).toStrictEqual({ r: 1 });
    expect(mock.insightsCalls).toHaveLength(1);
    const call = mock.insightsCalls[0]!;
    expect(call.body["bookmark"]).toStrictEqual({ r: 1 });
    expect(call.body["project_id"]).toBe(12345);
    expect(call.scope).toStrictEqual(PROJECT_WIDE_SCOPE);
  });

  /** `mode` → `/arb_funnels` `query_type` (`LiveQueryService.queryFlow`). */
  const QUERY_TYPE_FOR_MODE: Readonly<Record<string, string>> = {
    paths: "flows_top_paths",
    tree: "flows",
    sankey: "flows_sankey",
  };

  it.each<[Record<string, unknown>, string]>([
    [{ chartType: "paths" }, "paths"],
    [{ chartType: "tree" }, "tree"],
    [{ chartType: "sankey" }, "sankey"],
    [{ chartType: "bar" }, "sankey"],
    [{}, "sankey"],
  ])(
    "flows mode derived from params[%j-%s]", // python: test_flows_mode_derived_from_params
    async (params, expectedMode) => {
      const { ws, mock } = makeWorkspace();

      const result = await ws.queryReportLink(resolvedReport("flows", params));

      expect(result).toBeInstanceOf(FlowQueryResult);
      expect((result as FlowQueryResult).mode).toBe(expectedMode);
      expect(result.params).toStrictEqual(params);
      expect(mock.arbFunnelsCalls).toHaveLength(1);
      const call = mock.arbFunnelsCalls[0]!;
      expect(call.body["bookmark"]).toStrictEqual(params);
      expect(call.body["project_id"]).toBe(12345);
      expect(call.body["query_type"]).toBe(QUERY_TYPE_FOR_MODE[expectedMode]);
      expect(call.scope).toStrictEqual(PROJECT_WIDE_SCOPE);
    },
  );

  it("flows explicit mode wins", async () => {
    // python: test_flows_explicit_mode_wins
    const { ws, mock } = makeWorkspace();

    const result = await ws.queryReportLink(
      resolvedReport("flows", { chartType: "paths" }),
      { mode: "tree" },
    );

    expect((result as FlowQueryResult).mode).toBe("tree");
    expect(mock.arbFunnelsCalls).toHaveLength(1);
    const call = mock.arbFunnelsCalls[0]!;
    expect(call.body["bookmark"]).toStrictEqual({ chartType: "paths" });
    expect(call.body["project_id"]).toBe(12345);
    expect(call.body["query_type"]).toBe("flows");
    expect(call.scope).toStrictEqual(PROJECT_WIDE_SCOPE);
  });

  it("launch analysis unsupported", async () => {
    // python: test_launch_analysis_unsupported
    const { ws, mock } = makeWorkspace();

    const exc = await expectRaises(
      ws.queryReportLink(resolvedReport("launch-analysis", {})),
      UnsupportedReportLinkError,
    );

    expect(exc.code).toBe("UNSUPPORTED_REPORT_TYPE");
    expect(detailsOf(exc)["hint"]).toBe(
      "Supported types are insights, funnels, retention, and flows.",
    );
    expect(mock.insightsCalls).toHaveLength(0);
    expect(mock.arbFunnelsCalls).toHaveLength(0);
  });

  it("resolved input does not refetch", async () => {
    // python: test_resolved_input_does_not_refetch
    const { ws, mock } = makeWorkspace();

    await ws.queryReportLink(resolvedReport("insights", INSIGHTS_PARAMS));

    expect(mock.bookmarkUrlGetCalls).toHaveLength(0);
    expect(mock.bookmarkGetCalls).toHaveLength(0);
  });

  it("str input resolves first", async () => {
    // python: test_str_input_resolves_first
    const { ws, mock } = makeWorkspace();
    mock.setGetBookmarkUrl(() => slugRecord());

    const result = await ws.queryReportLink(SLUG);

    expect(result).toBeInstanceOf(QueryResult);
    expect(mock.bookmarkUrlGetCalls).toStrictEqual([SLUG]);
    expect(mock.insightsCalls).toHaveLength(1);
    const call = mock.insightsCalls[0]!;
    expect(call.body["bookmark"]).toStrictEqual(INSIGHTS_PARAMS);
    expect(call.body["project_id"]).toBe(12345);
    expect(call.scope).toStrictEqual(PROJECT_WIDE_SCOPE);
  });
});

// =============================================================================
// saved_report_link (US5)
// =============================================================================

describe("Saved report link", () => {
  // python: TestSavedReportLink
  it.each<[BookmarkType, string]>([
    ["insights", "insights#report/123"],
    ["funnels", "funnels#view/123"],
    ["retention", "retention#report/123"],
    ["flows", "flows#report/123"],
    ["launch-analysis", "impact#report/123"],
  ])("URL shape per type[%s]", (reportType, tail) => {
    // python: test_url_shape_per_type
    const { ws, mock } = makeWorkspace();

    const url = ws.savedReportLink(123, { report_type: reportType });

    expect(url).toBe(`https://mixpanel.com/project/12345/app/${tail}`);
    expect(mock.methodCalls).toStrictEqual([]);
  });

  it("default type is insights", () => {
    // python: test_default_type_is_insights
    const { ws } = makeWorkspace();

    expect(ws.savedReportLink(123)).toBe(
      "https://mixpanel.com/project/12345/app/insights#report/123",
    );
  });

  it("singular funnel normalizes", () => {
    // python: test_singular_funnel_normalizes
    const { ws } = makeWorkspace();

    expect(ws.savedReportLink(456, { report_type: "funnel" })).toBe(
      "https://mixpanel.com/project/12345/app/funnels#view/456",
    );
  });

  it("explicit workspace", () => {
    // python: test_explicit_workspace
    const { ws, mock } = makeWorkspace();

    const url = ws.savedReportLink(123, { workspace_id: 5 });

    expect(url).toBe(
      "https://mixpanel.com/project/12345/view/5/app/insights#report/123",
    );
    expect(mock.resolveWorkspaceIdCalls).toHaveLength(0);
  });

  it("pinned workspace", () => {
    // python: test_pinned_workspace
    const { ws, mock } = makeWorkspace({ session: PINNED_SESSION });

    const url = ws.savedReportLink(123);

    expect(url).toContain("/view/75/");
    expect(mock.resolveWorkspaceIdCalls).toHaveLength(0);
  });

  it("explicit beats pinned", () => {
    // python: test_explicit_beats_pinned
    const { ws } = makeWorkspace({ session: PINNED_SESSION });

    expect(ws.savedReportLink(123, { workspace_id: 5 })).toContain("/view/5/");
  });

  it("no workspace is omitted never resolved", () => {
    // python: test_no_workspace_is_omitted_never_resolved
    const { ws, mock } = makeWorkspace();

    const url = ws.savedReportLink(123);

    expect(url).not.toContain("/view/");
    expect(mock.resolveWorkspaceIdCalls).toHaveLength(0);
  });

  it("EU session host", () => {
    // python: test_eu_session_host
    const { ws } = makeWorkspace({ session: EU_SESSION });

    expect(ws.savedReportLink(123).startsWith("https://eu.mixpanel.com/")).toBe(
      true,
    );
  });

  it("unknown type raises RL1", () => {
    // python: test_unknown_type_raises_rl1
    const { ws } = makeWorkspace();

    let caught: unknown = null;
    try {
      // `# type: ignore[arg-type]` — an out-of-union literal on purpose.
      ws.savedReportLink(123, {
        report_type: "boards" as unknown as BookmarkType,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ParamValidationError);
    expect((caught as ParamValidationError).code).toBe(
      "RL1_UNKNOWN_REPORT_TYPE",
    );
  });

  it("client records zero calls", () => {
    // python: test_client_records_zero_calls
    const { ws, mock } = makeWorkspace();

    ws.savedReportLink(1);
    ws.savedReportLink(2, { report_type: "flows", workspace_id: 3 });

    expect(mock.methodCalls).toStrictEqual([]);
  });
});

// =============================================================================
// review follow-ups (PR #223)
// =============================================================================

describe("Query report link scope on resolved input", () => {
  // python: TestQueryReportLinkScopeOnResolvedInput
  it("project mismatch raises before query", async () => {
    // python: test_project_mismatch_raises_before_query
    const { ws, mock } = makeWorkspace();
    const resolved = resolvedReport("insights", INSIGHTS_PARAMS, {
      project_id: 3,
    });

    const exc = await expectRaises(
      ws.queryReportLink(resolved),
      ReportLinkScopeMismatchError,
    );

    expect(exc.code).toBe("REPORT_LINK_PROJECT_MISMATCH");
    const details = detailsOf(exc);
    expect(details["link_project_id"]).toBe(3);
    expect(details["session_project_id"]).toBe(12345);
    expect(details["hint"] as string).toContain('ws.use(project="3")');
    expect(mock.insightsCalls).toHaveLength(0);
  });

  it("region mismatch raises before query", async () => {
    // python: test_region_mismatch_raises_before_query
    const { ws, mock } = makeWorkspace();
    const resolved = resolvedReport("insights", INSIGHTS_PARAMS, {
      region: "eu",
    });

    const exc = await expectRaises(
      ws.queryReportLink(resolved),
      ReportLinkScopeMismatchError,
    );

    expect(exc.code).toBe("REPORT_LINK_REGION_MISMATCH");
    expect(mock.insightsCalls).toHaveLength(0);
  });

  it("matching scope runs", async () => {
    // python: test_matching_scope_runs
    const { ws, mock } = makeWorkspace();

    const result = await ws.queryReportLink(
      resolvedReport("insights", INSIGHTS_PARAMS),
    );

    expect(result).toBeInstanceOf(QueryResult);
    expect(mock.insightsCalls).toHaveLength(1);
  });

  it("scope checked after use switch", async () => {
    // python: test_scope_checked_after_use_switch
    // The Python fixture shares ONE mock client between both Workspaces.
    const { ws, mock } = makeWorkspace();
    mock.setGetBookmarkUrl(() => slugRecord());
    const resolved = await ws.resolveReportLink(SLUG);

    const { ws: other } = makeWorkspace(
      { session: { ...TEST_SESSION, project: { id: "777" } } },
      mock,
    );

    await expectRaises(
      other.queryReportLink(resolved),
      ReportLinkScopeMismatchError,
    );

    expect(mock.insightsCalls).toHaveLength(0);
  });
});
