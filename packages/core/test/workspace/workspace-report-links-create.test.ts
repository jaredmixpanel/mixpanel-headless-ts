// Workspace.createReportLink from dicts and result objects: validation,
// workspace precedence, URL shape and validate-before-POST ordering. Mirrors
// the TestCreateReportLink* classes of tests/unit/test_workspace_report_links.py.
// The `_validate_bookmark_params_schema` patch has no seam, so the real validator
// is driven to a warning-only outcome; error messages are not asserted, codes are.

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

// --- createReportLink ---

describe("Create report link from dict", () => {
  // python: TestCreateReportLinkFromDict
  it("dict defaults to insights", async () => {
    // python: test_dict_defaults_to_insights
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

  it("explicit type on dict", async () => {
    // python: test_explicit_type_on_dict
    const { ws, mock } = makeWorkspace();
    const params = await funnelParams(ws);

    const link = await ws.createReportLink(params, { report_type: "funnels" });

    expect(postedBody(mock)["type"]).toBe("funnels");
    expect(link.report_type).toBe("funnels");
  });

  it("URL uses resolved workspace", async () => {
    // python: test_url_uses_resolved_workspace
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

  it("created at name description bookmark ID", async () => {
    // python: test_created_at_name_description_bookmark_id
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

  it("body omits empty optionals and workspace ID", async () => {
    // python: test_body_omits_empty_optionals_and_workspace_id
    const { ws, mock } = makeWorkspace();

    await ws.createReportLink(await ws.buildParams("Login", { last: 7 }), {
      workspace_id: 5,
    });

    const body = postedBody(mock);
    expect(Object.keys(body).sort()).toStrictEqual(["params", "slug", "type"]);
  });

  it("missing created at is null", async () => {
    // python: test_missing_created_at_is_none
    const { ws, mock } = makeWorkspace();
    mock.setCreateBookmarkUrl((body) => ({ ...body }));

    const link = await ws.createReportLink(
      await ws.buildParams("Login", { last: 7 }),
    );

    expect(link.created_at).toBeNull();
  });
});

describe("Create report link from results", () => {
  // python: TestCreateReportLinkFromResults
  it("query result is insights", async () => {
    // python: test_query_result_is_insights
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

  it("funnel result is funnels", async () => {
    // python: test_funnel_result_is_funnels
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

  it("retention result is retention", async () => {
    // python: test_retention_result_is_retention
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

  it("flow result is flows", async () => {
    // python: test_flow_result_is_flows
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

  it("matching explicit type is accepted", async () => {
    // python: test_matching_explicit_type_is_accepted
    const { ws } = makeWorkspace();
    const result = new FlowQueryResult({
      computed_at: "2026-09-02T10:00:00",
      params: await ws.buildFlowParams("Login", { last: 30 }),
    });

    const link = await ws.createReportLink(result, { report_type: "flows" });

    expect(link.report_type).toBe("flows");
  });

  it("contradicting type raises RL4 before post", async () => {
    // python: test_contradicting_type_raises_rl4_before_post
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

describe("Create report link validation", () => {
  // python: TestCreateReportLinkValidation
  it("validation failure raises before post", async () => {
    // python: test_validation_failure_raises_before_post
    const { ws, mock } = makeWorkspace();

    const exc = await expectRaises(
      ws.createReportLink({ sections: { show: [] }, bogus: 1 }),
      BookmarkValidationError,
    );

    expect(exc.errorCount).toBeGreaterThanOrEqual(1);
    expect(mock.bookmarkUrlCreateCalls).toHaveLength(0);
  });

  it("validate false skips validation", async () => {
    // python: test_validate_false_skips_validation
    const { ws, mock } = makeWorkspace();

    const link = await ws.createReportLink({ bogus: 1 }, { validate: false });

    expect(postedBody(mock)["params"]).toStrictEqual({ bogus: 1 });
    expect(link.report_type).toBe("insights");
  });

  it("validation warnings do not block", async () => {
    // python: test_validation_warnings_do_not_block
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

describe("Create report link workspace precedence", () => {
  // python: TestCreateReportLinkWorkspacePrecedence
  it("explicit wins", async () => {
    // python: test_explicit_wins
    const { ws, mock } = makeWorkspace({ generateSlug: fixedSlug });

    const link = await ws.createReportLink(
      await ws.buildParams("Login", { last: 7 }),
      { workspace_id: 5 },
    );

    expect(link.workspace_id).toBe(5);
    expect(link.url).toContain("/view/5/");
    expect(mock.resolveWorkspaceIdCalls).toHaveLength(0);
  });

  it("pinned session workspace", async () => {
    // python: test_pinned_session_workspace
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

  it("explicit beats pinned", async () => {
    // python: test_explicit_beats_pinned
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

  it("scope error falls back to project only", async () => {
    // python: test_scope_error_falls_back_to_project_only
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

describe("Create report link URL shape", () => {
  // python: TestCreateReportLinkUrlShape
  it.each<[ReportLinkType, string]>([
    ["insights", "insights"],
    ["funnels", "insights"],
    ["retention", "insights"],
    ["flows", "flows"],
  ])("EU session per type[%s-%s]", async (reportType, app) => {
    // python: test_eu_session_per_type
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

describe("Create report link validates before post", () => {
  // python: TestCreateReportLinkValidatesBeforePost
  it.each([0, -1])(
    "non positive workspace ID raises before post[%i]", // python: test_non_positive_workspace_id_raises_before_post
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
