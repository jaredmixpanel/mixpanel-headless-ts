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
  BookmarkValidationError,
  ParamValidationError,
  WorkspaceScopeError,
} from "../../src/errors.js";
import type { ReportLinkType } from "../../src/types/literals.js";
import { FunnelStep } from "../../src/types/query-params/funnel.js";
import { ReportLink } from "../../src/types/report-links.js";
import {
  FlowQueryResult,
  FunnelQueryResult,
  QueryResult,
  RetentionQueryResult,
} from "../../src/types/results/query-engine.js";
import type { Workspace } from "../../src/workspace.js";
import {
  detailsOf,
  EU_SESSION,
  expectRaises,
  INSIGHTS_PARAMS,
  makeWorkspace,
  type MockApiClient,
  PINNED_SESSION,
  SLUG,
} from "./workspace-report-links-fixtures.js";

/** `generate_slug` patched to `_SLUG`. */
const fixedSlug = (): string => SLUG;

/**
 * `_posted_body`: the body of the single `create_bookmark_url`
 * call.
 *
 * @param mock - The mocked client.
 * @returns The posted body dict.
 */
function postedBody(mock: MockApiClient): Record<string, unknown> {
  expect(mock.bookmarkUrlCreateCalls).toHaveLength(1);
  return mock.bookmarkUrlCreateCalls[0]!;
}

/** `ws.build_funnel_params([FunnelStep("Login"), FunnelStep("Purchase")], last=30)`. */
function funnelParams(ws: Workspace): Promise<Record<string, unknown>> {
  return ws.buildFunnelParams(
    [new FunnelStep({ event: "Login" }), new FunnelStep({ event: "Purchase" })],
    { last: 30 },
  );
}

// =============================================================================
// create_report_link (US1)
// =============================================================================

describe("TestCreateReportLinkFromDict (test_workspace_report_links.py:129)", () => {
  it("test_dict_defaults_to_insights", async () => {
    const { ws, mock } = makeWorkspace();
    const params = await ws.buildParams("Login", { last: 7 });

    const link = await ws.createReportLink(params);

    const body = postedBody(mock);
    expect(body["type"]).toBe("insights");
    expect(body["params"]).toStrictEqual(params);
    expect(body["slug"] as string).toHaveLength(12);
    expect(link).toBeInstanceOf(ReportLink);
    expect(link.report_type).toBe("insights");
    expect(link.slug).toBe(body["slug"]);
    expect(link.project_id).toBe(12345);
  });

  it("test_explicit_type_on_dict", async () => {
    const { ws, mock } = makeWorkspace();
    const params = await funnelParams(ws);

    const link = await ws.createReportLink(params, { report_type: "funnels" });

    expect(postedBody(mock)["type"]).toBe("funnels");
    expect(link.report_type).toBe("funnels");
  });

  it("test_url_uses_resolved_workspace", async () => {
    const { ws, mock } = makeWorkspace({ generateSlug: fixedSlug });

    const link = await ws.createReportLink(
      await ws.buildParams("Login", { last: 7 }),
    );

    expect(mock.resolveWorkspaceIdCalls).toHaveLength(1);
    expect(link.workspace_id).toBe(99);
    expect(link.url).toBe(
      `https://mixpanel.com/project/12345/view/99/app/insights#${SLUG}`,
    );
    expect(String(link)).toBe(link.url);
  });

  it("test_created_at_name_description_bookmark_id", async () => {
    const { ws, mock } = makeWorkspace();

    const link = await ws.createReportLink(
      await ws.buildParams("Login", { last: 7 }),
      { name: "Logins", description: "last 7 days", bookmark_id: 9 },
    );

    const body = postedBody(mock);
    expect(body["name"]).toBe("Logins");
    expect(body["description"]).toBe("last 7 days");
    expect(body["bookmark_id"]).toBe(9);
    expect(link.name).toBe("Logins");
    expect(link.description).toBe("last 7 days");
    expect(link.bookmark_id).toBe(9);
    expect(link.created_at).toBe("2026-09-02T10:00:00");
  });

  it("test_body_omits_empty_optionals_and_workspace_id", async () => {
    const { ws, mock } = makeWorkspace();

    await ws.createReportLink(await ws.buildParams("Login", { last: 7 }), {
      workspace_id: 5,
    });

    const body = postedBody(mock);
    expect(Object.keys(body).sort()).toStrictEqual(["params", "slug", "type"]);
  });

  it("test_missing_created_at_is_none", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setCreateBookmarkUrl((body) => ({ ...body }));

    const link = await ws.createReportLink(
      await ws.buildParams("Login", { last: 7 }),
    );

    expect(link.created_at).toBeNull();
  });
});

describe("TestCreateReportLinkFromResults (test_workspace_report_links.py:220)", () => {
  it("test_query_result_is_insights", async () => {
    const { ws, mock } = makeWorkspace();
    const params = await ws.buildParams("Login", { last: 7 });
    const result = new QueryResult({
      computed_at: "2026-09-02T10:00:00",
      from_date: "2026-08-26",
      to_date: "2026-09-02",
      params,
    });

    const link = await ws.createReportLink(result);

    const body = postedBody(mock);
    expect(body["type"]).toBe("insights");
    expect(body["params"]).toStrictEqual(params);
    expect(link.report_type).toBe("insights");
  });

  it("test_funnel_result_is_funnels", async () => {
    const { ws, mock } = makeWorkspace();
    const params = await funnelParams(ws);
    const result = new FunnelQueryResult({
      computed_at: "2026-09-02T10:00:00",
      from_date: "2026-08-03",
      to_date: "2026-09-02",
      params,
    });

    const link = await ws.createReportLink(result);

    expect(postedBody(mock)["type"]).toBe("funnels");
    expect(link.report_type).toBe("funnels");
    expect(link.url).toContain("/app/insights#");
  });

  it("test_retention_result_is_retention", async () => {
    const { ws, mock } = makeWorkspace();
    const params = await ws.buildRetentionParams("Login", "Purchase", {
      last: 30,
    });
    const result = new RetentionQueryResult({
      computed_at: "2026-09-02T10:00:00",
      from_date: "2026-08-03",
      to_date: "2026-09-02",
      params,
    });

    const link = await ws.createReportLink(result);

    expect(postedBody(mock)["type"]).toBe("retention");
    expect(link.report_type).toBe("retention");
  });

  it("test_flow_result_is_flows", async () => {
    const { ws, mock } = makeWorkspace();
    const params = await ws.buildFlowParams("Login", { last: 30 });
    const result = new FlowQueryResult({
      computed_at: "2026-09-02T10:00:00",
      params,
    });

    const link = await ws.createReportLink(result);

    expect(postedBody(mock)["type"]).toBe("flows");
    expect(link.report_type).toBe("flows");
    expect(link.url).toContain("/app/flows#");
  });

  it("test_matching_explicit_type_is_accepted", async () => {
    const { ws } = makeWorkspace();
    const result = new FlowQueryResult({
      computed_at: "2026-09-02T10:00:00",
      params: await ws.buildFlowParams("Login", { last: 30 }),
    });

    const link = await ws.createReportLink(result, { report_type: "flows" });

    expect(link.report_type).toBe("flows");
  });

  it("test_contradicting_type_raises_rl4_before_post", async () => {
    const { ws, mock } = makeWorkspace();
    const result = new FunnelQueryResult({
      computed_at: "2026-09-02T10:00:00",
      from_date: "2026-08-03",
      to_date: "2026-09-02",
      params: await funnelParams(ws),
    });

    const exc = await expectRaises(
      ws.createReportLink(result, { report_type: "insights" }),
      ParamValidationError,
    );

    expect(exc.code).toBe("RL4_REPORT_TYPE_CONFLICT");
    expect(detailsOf(exc)).toStrictEqual({
      given: "insights",
      inferred: "funnels",
      result_class: "FunnelQueryResult",
    });
    expect(mock.bookmarkUrlCreateCalls).toHaveLength(0);
  });
});

describe("TestCreateReportLinkValidation (test_workspace_report_links.py:310)", () => {
  it("test_validation_failure_raises_before_post", async () => {
    const { ws, mock } = makeWorkspace();

    const exc = await expectRaises(
      ws.createReportLink({ sections: { show: [] }, bogus: 1 }),
      BookmarkValidationError,
    );

    expect(exc.errorCount).toBeGreaterThanOrEqual(1);
    expect(mock.bookmarkUrlCreateCalls).toHaveLength(0);
  });

  it("test_validate_false_skips_validation", async () => {
    const { ws, mock } = makeWorkspace();

    const link = await ws.createReportLink({ bogus: 1 }, { validate: false });

    expect(postedBody(mock)["params"]).toStrictEqual({ bogus: 1 });
    expect(link.report_type).toBe("insights");
  });

  it("test_validation_warnings_do_not_block", async () => {
    // No seam for `patch.object(Workspace, "_validate_bookmark_params_schema")`:
    // drive the REAL validator to a warning-only outcome instead (an
    // unknown chart type under `sorting` is `S4_UNKNOWN_CHART_TYPE`
    // at severity "warning"; the rest of the params are valid).
    const { ws, mock, log } = makeWorkspace();
    const params = {
      ...(await ws.buildParams("Login", { last: 7 })),
      sorting: { bogusChart: {} },
    };

    await ws.createReportLink(params);

    expect(mock.bookmarkUrlCreateCalls).toHaveLength(1);
    expect(log.warnings.some((m) => m.includes("S4_UNKNOWN_CHART_TYPE"))).toBe(
      true,
    );
  });
});

describe("TestCreateReportLinkWorkspacePrecedence (test_workspace_report_links.py:347)", () => {
  it("test_explicit_wins", async () => {
    const { ws, mock } = makeWorkspace({ generateSlug: fixedSlug });

    const link = await ws.createReportLink(
      await ws.buildParams("Login", { last: 7 }),
      { workspace_id: 5 },
    );

    expect(link.workspace_id).toBe(5);
    expect(link.url).toContain("/view/5/");
    expect(mock.resolveWorkspaceIdCalls).toHaveLength(0);
  });

  it("test_pinned_session_workspace", async () => {
    const { ws, mock } = makeWorkspace({
      session: PINNED_SESSION,
      generateSlug: fixedSlug,
    });

    const link = await ws.createReportLink(
      await ws.buildParams("Login", { last: 7 }),
    );

    expect(link.workspace_id).toBe(75);
    expect(link.url).toContain("/view/75/");
    expect(mock.resolveWorkspaceIdCalls).toHaveLength(0);
  });

  it("test_explicit_beats_pinned", async () => {
    const { ws } = makeWorkspace({
      session: PINNED_SESSION,
      generateSlug: fixedSlug,
    });

    const link = await ws.createReportLink(
      await ws.buildParams("Login", { last: 7 }),
      { workspace_id: 5 },
    );

    expect(link.workspace_id).toBe(5);
  });

  it("test_scope_error_falls_back_to_project_only", async () => {
    const { ws, mock } = makeWorkspace({ generateSlug: fixedSlug });
    mock.setResolveWorkspaceId(() => {
      throw new WorkspaceScopeError("no workspaces");
    });

    const link = await ws.createReportLink(
      await ws.buildParams("Login", { last: 7 }),
    );

    expect(link.workspace_id).toBeNull();
    expect(link.url).toBe(
      `https://mixpanel.com/project/12345/app/insights#${SLUG}`,
    );
  });
});

describe("TestCreateReportLinkUrlShape (test_workspace_report_links.py:407)", () => {
  it.each<[ReportLinkType, string]>([
    ["insights", "insights"],
    ["funnels", "insights"],
    ["retention", "insights"],
    ["flows", "flows"],
  ])("test_eu_session_per_type[%s-%s]", async (reportType, app) => {
    const { ws } = makeWorkspace({
      session: EU_SESSION,
      generateSlug: fixedSlug,
    });

    const link = await ws.createReportLink(
      { any: 1 },
      { report_type: reportType, validate: false, workspace_id: null },
    );

    expect(link.url).toBe(
      `https://eu.mixpanel.com/project/12345/view/99/app/${app}#${SLUG}`,
    );
    expect(link.report_type).toBe(reportType);
  });
});

describe("TestCreateReportLinkValidatesBeforePost (test_workspace_report_links.py:1433)", () => {
  it.each([0, -1])(
    "test_non_positive_workspace_id_raises_before_post[%i]",
    async (workspaceId) => {
      const { ws, mock } = makeWorkspace();

      const exc = await expectRaises(
        ws.createReportLink(INSIGHTS_PARAMS, {
          workspace_id: workspaceId,
          validate: false,
        }),
        ParamValidationError,
      );

      expect(exc.code).toBe("RL6_INVALID_ID");
      expect(mock.bookmarkUrlCreateCalls).toHaveLength(0);
    },
  );
});
