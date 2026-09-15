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
  QueryError,
  ReportLinkNotFoundError,
  ReportLinkParseError,
  ReportLinkScopeMismatchError,
  ResponseValidationError,
  ShortLinkResolutionError,
  UnsupportedReportLinkError,
} from "../../src/errors.js";
import { ResolvedReport } from "../../src/types/report-links.js";
import { QueryResult } from "../../src/types/results/query-engine.js";
import {
  detailsOf,
  expectRaises,
  INSIGHTS_PARAMS,
  makeWorkspace,
  type MockApiClient,
  PINNED_SESSION,
  SLUG,
  slugRecord,
} from "./workspace-report-links-fixtures.js";

const FLOW_PARAMS = { chartType: "paths", steps: [] };
const BOOKMARK_RAW = {
  id: 123,
  name: "Weekly actives",
  type: "funnels",
  params: { steps: [{ event: "Login" }] },
  description: "desc",
};

// =============================================================================
// shortlinks (US3)
// =============================================================================

const SHORT = "https://mixpanel.com/s/AbC123";
const SHORT_TARGET = `https://mixpanel.com/project/12345/view/75/app/insights#${SLUG}`;

describe("TestResolveSlugLinks (test_workspace_report_links.py:476)", () => {
  it("test_bare_slug", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setGetBookmarkUrl(() => slugRecord());

    const resolved = await ws.resolveReportLink(SLUG);

    expect(mock.bookmarkUrlGetCalls).toStrictEqual([SLUG]);
    expect(mock.resolveWorkspaceIdCalls).toHaveLength(0);
    expect(resolved).toBeInstanceOf(ResolvedReport);
    expect(resolved.source).toBe("slug");
    expect(resolved.report_type).toBe("insights");
    expect(resolved.params).toStrictEqual(INSIGHTS_PARAMS);
    expect(resolved.project_id).toBe(12345);
    expect(resolved.workspace_id).toBeNull();
    expect(resolved.region).toBe("us");
    expect(resolved.url).toBe(
      `https://mixpanel.com/project/12345/app/insights#${SLUG}`,
    );
    expect(resolved.input).toBe(SLUG);
    expect(resolved.expanded_url).toBeNull();
    expect(resolved.slug).toBe(SLUG);
    expect(resolved.bookmark_id).toBeNull();
    expect(resolved.bookmark).toBeNull();
    expect(resolved.name).toBe("Logins");
    expect(resolved.description).toBeNull();
    expect(resolved.overrides).toBeNull();
  });

  it("test_full_url_with_workspace", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setGetBookmarkUrl(() => slugRecord({ type: "funnels" }));
    const link = `https://mixpanel.com/project/12345/view/75/app/insights/?utm=x#${SLUG}`;

    const resolved = await ws.resolveReportLink(link);

    expect(resolved.workspace_id).toBe(75);
    expect(resolved.report_type).toBe("funnels");
    expect(resolved.url).toBe(
      `https://mixpanel.com/project/12345/view/75/app/insights#${SLUG}`,
    );
    expect(resolved.input).toBe(link);
  });

  it("test_project_only_url_uses_pinned_workspace", async () => {
    const { ws, mock } = makeWorkspace({ session: PINNED_SESSION });
    mock.setGetBookmarkUrl(() => slugRecord());

    const resolved = await ws.resolveReportLink(
      `https://mixpanel.com/project/12345/app/insights#${SLUG}`,
    );

    expect(resolved.workspace_id).toBe(75);
    expect(resolved.url).toContain("/view/75/");
    expect(mock.resolveWorkspaceIdCalls).toHaveLength(0);
  });

  it("test_project_only_url_without_pin_is_none", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setGetBookmarkUrl(() => slugRecord());

    const resolved = await ws.resolveReportLink(
      `https://mixpanel.com/project/12345/app/insights#${SLUG}`,
    );

    expect(resolved.workspace_id).toBeNull();
    expect(mock.resolveWorkspaceIdCalls).toHaveLength(0);
  });

  it("test_slug_record_with_embedded_bookmark", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setGetBookmarkUrl(() =>
      slugRecord({
        bookmark: BOOKMARK_RAW,
        overrides: { originDashboard: 555 },
      }),
    );

    const resolved = await ws.resolveReportLink(SLUG);

    expect(resolved.source).toBe("slug");
    expect(resolved.bookmark).not.toBeNull();
    expect(resolved.bookmark?.id).toBe(123);
    expect(resolved.bookmark_id).toBe(123);
    expect(resolved.params).toStrictEqual(INSIGHTS_PARAMS);
    expect(resolved.overrides).toStrictEqual({ originDashboard: 555 });
    expect(mock.bookmarkGetCalls).toHaveLength(0);
  });

  it("test_flows_record_rebuilds_under_flows_app", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setGetBookmarkUrl(() =>
      slugRecord({ type: "flows", params: FLOW_PARAMS }),
    );

    const resolved = await ws.resolveReportLink(
      `https://mixpanel.com/project/12345/app/insights#${SLUG}`,
    );

    expect(resolved.report_type).toBe("flows");
    expect(resolved.url).toBe(
      `https://mixpanel.com/project/12345/app/flows#${SLUG}`,
    );
  });

  it("test_unknown_slug_raises_not_found", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setGetBookmarkUrl(() => {
      throw new ReportLinkNotFoundError("nope", {
        code: "REPORT_LINK_SLUG_NOT_FOUND",
        details: { slug: SLUG },
      });
    });

    const exc = await expectRaises(
      ws.resolveReportLink(SLUG),
      ReportLinkNotFoundError,
    );

    expect(exc.code).toBe("REPORT_LINK_SLUG_NOT_FOUND");
  });

  it("test_malformed_slug_record_raises_response_validation_error", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setGetBookmarkUrl(() => slugRecord({ params: "nope" }));

    await expectRaises(ws.resolveReportLink(SLUG), ResponseValidationError);
  });

  it("test_slug_record_without_slug_raises_response_validation_error", async () => {
    const { ws, mock } = makeWorkspace();
    const record = slugRecord();
    delete record["slug"];
    mock.setGetBookmarkUrl(() => record);

    await expectRaises(ws.resolveReportLink(SLUG), ResponseValidationError);
  });

  it("test_dashboard_edited_bookmark_resolves_slug", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setGetBookmarkUrl(() => slugRecord());

    const resolved = await ws.resolveReportLink(
      `https://mixpanel.com/project/12345/app/boards#id=555&edited-bookmark=${SLUG}`,
    );

    expect(resolved.slug).toBe(SLUG);
    expect(mock.bookmarkUrlGetCalls).toStrictEqual([SLUG]);
  });
});

describe("TestResolveBookmarkLinks (test_workspace_report_links.py:631)", () => {
  it("test_bookmark_url_type_from_bookmark_not_hint", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setGetBookmark(() => BOOKMARK_RAW);

    const resolved = await ws.resolveReportLink(
      "https://mixpanel.com/project/12345/app/insights#report/123",
    );

    expect(mock.bookmarkGetCalls).toStrictEqual([123]);
    expect(mock.bookmarkUrlGetCalls).toHaveLength(0);
    expect(resolved.source).toBe("bookmark");
    expect(resolved.report_type).toBe("funnels");
    expect(resolved.params).toStrictEqual({ steps: [{ event: "Login" }] });
    expect(resolved.bookmark_id).toBe(123);
    expect(resolved.bookmark).not.toBeNull();
    expect(resolved.bookmark?.bookmark_type).toBe("funnels");
    expect(resolved.slug).toBeNull();
    expect(resolved.name).toBe("Weekly actives");
    expect(resolved.description).toBe("desc");
    expect(resolved.overrides).toBeNull();
    expect(resolved.url).toBe(
      "https://mixpanel.com/project/12345/app/funnels#view/123",
    );
  });

  it("test_bookmark_url_with_workspace", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setGetBookmark(() => ({ ...BOOKMARK_RAW, type: "insights" }));

    const resolved = await ws.resolveReportLink(
      "https://mixpanel.com/project/12345/view/75/app/insights#report/123/weekly",
    );

    expect(resolved.workspace_id).toBe(75);
    expect(resolved.url).toBe(
      "https://mixpanel.com/project/12345/view/75/app/insights#report/123",
    );
  });

  it("test_overrides_tail_logs_warning_and_returns_base_params", async () => {
    const { ws, mock, log } = makeWorkspace();
    mock.setGetBookmark(() => BOOKMARK_RAW);

    const resolved = await ws.resolveReportLink(
      "https://mixpanel.com/project/12345/app/funnels#view/123/~(a~1)",
    );

    expect(resolved.params).toStrictEqual({ steps: [{ event: "Login" }] });
    expect(
      log.warnings.some(
        (m) =>
          m.includes("ignoring URL overrides '~(a~1)'") &&
          m.includes("base params"),
      ),
    ).toBe(true);
  });

  it("test_unknown_bookmark_raises_not_found", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setGetBookmark(() => {
      throw new QueryError("Resource not found", { statusCode: 404 });
    });

    const exc = await expectRaises(
      ws.resolveReportLink(
        "https://mixpanel.com/project/12345/app/insights#report/123",
      ),
      ReportLinkNotFoundError,
    );

    expect(exc.code).toBe("REPORT_LINK_BOOKMARK_NOT_FOUND");
    const details = detailsOf(exc);
    expect(details["bookmark_id"]).toBe(123);
    expect(details["kind"]).toBe("bookmark");
    expect(Object.hasOwn(details, "session_workspace_id")).toBe(false);
    expect(details["hint"]).toBe(
      "Check the saved report id, or switch to the project and region that " +
        "own it (ws.use(project=...); CLI: mp --project ...) and retry.",
    );
  });

  it("test_unknown_bookmark_under_pinned_workspace_names_the_workspace", async () => {
    const { ws, mock } = makeWorkspace({ session: PINNED_SESSION });
    mock.setGetBookmark(() => {
      throw new QueryError("Resource not found", { statusCode: 404 });
    });

    const exc = await expectRaises(
      ws.resolveReportLink(
        "https://mixpanel.com/project/12345/app/insights#report/123",
      ),
      ReportLinkNotFoundError,
    );

    expect(exc.code).toBe("REPORT_LINK_BOOKMARK_NOT_FOUND");
    const details = detailsOf(exc);
    expect(details["session_workspace_id"]).toBe(75);
    expect(details["hint"]).toBe(
      "The saved report may live in another workspace of this project. " +
        "Switch with ws.use(workspace=<id>) (CLI: mp --workspace <id> ...) " +
        "or unpin the workspace and retry.",
    );
  });

  it.each([
    ["insights", "insights#report/123"],
    ["funnels", "funnels#view/123"],
  ])(
    "test_unknown_bookmark_type_falls_back_to_url_app_with_warning[%s]",
    async (app, expectedTail) => {
      const { ws, mock, log } = makeWorkspace();
      mock.setGetBookmark(() => ({ ...BOOKMARK_RAW, type: "user" }));

      const resolved = await ws.resolveReportLink(
        `https://mixpanel.com/project/12345/app/${app}#report/123`,
      );

      expect(resolved.report_type).toBe("user");
      expect(resolved.url).toBe(
        `https://mixpanel.com/project/12345/app/${expectedTail}`,
      );
      expect(
        log.warnings.some(
          (m) => m.includes("unknown report type 'user'") && m.includes(app),
        ),
      ).toBe(true);
    },
  );

  it("test_other_query_error_passes_through", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setGetBookmark(() => {
      throw new QueryError("Permission denied", { statusCode: 403 });
    });

    const exc = await expectRaises(
      ws.resolveReportLink(
        "https://mixpanel.com/project/12345/app/insights#report/123",
      ),
      QueryError,
    );

    expect(exc.statusCode).toBe(403);
  });

  it("test_bookmark_without_params_yields_empty_dict", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setGetBookmark(() => ({ ...BOOKMARK_RAW, params: null }));

    const resolved = await ws.resolveReportLink(
      "https://mixpanel.com/project/12345/app/insights#report/123",
    );

    expect(resolved.params).toStrictEqual({});
  });
});

describe("TestResolveScopeAndUnsupported (test_workspace_report_links.py:812)", () => {
  /**
   * `_assert_no_client_calls`: neither record reader nor the
   * workspace resolver was called.
   *
   * @param mock - The mocked client.
   */
  function assertNoClientCalls(mock: MockApiClient): void {
    expect(mock.bookmarkUrlGetCalls).toHaveLength(0);
    expect(mock.bookmarkGetCalls).toHaveLength(0);
    expect(mock.resolveWorkspaceIdCalls).toHaveLength(0);
  }

  it("test_project_mismatch", async () => {
    const { ws, mock } = makeWorkspace();

    const exc = await expectRaises(
      ws.resolveReportLink(
        `https://mixpanel.com/project/3/app/insights#${SLUG}`,
      ),
      ReportLinkScopeMismatchError,
    );

    expect(exc.code).toBe("REPORT_LINK_PROJECT_MISMATCH");
    const details = detailsOf(exc);
    expect(details["hint"]).toBe(
      'Switch with ws.use(project="3") (CLI: mp --project 3 ...) and retry.',
    );
    expect(details["link_project_id"]).toBe(3);
    expect(details["session_project_id"]).toBe(12345);
    expect(details["slug"]).toBe(SLUG);
    assertNoClientCalls(mock);
  });

  it("test_region_mismatch", async () => {
    const { ws, mock } = makeWorkspace();

    const exc = await expectRaises(
      ws.resolveReportLink(
        `https://eu.mixpanel.com/project/12345/app/insights#${SLUG}`,
      ),
      ReportLinkScopeMismatchError,
    );

    expect(exc.code).toBe("REPORT_LINK_REGION_MISMATCH");
    const details = detailsOf(exc);
    expect(details["hint"]).toBe(
      "Switch to an account on the eu region with " +
        'ws.use(account="<name>") (CLI: mp --account <name> ...) and retry.',
    );
    expect(details["link_region"]).toBe("eu");
    expect(details["session_region"]).toBe("us");
    assertNoClientCalls(mock);
  });

  it("test_region_checked_before_project", async () => {
    const { ws } = makeWorkspace();

    const exc = await expectRaises(
      ws.resolveReportLink(
        `https://eu.mixpanel.com/project/3/app/insights#${SLUG}`,
      ),
      ReportLinkScopeMismatchError,
    );

    expect(exc.code).toBe("REPORT_LINK_REGION_MISMATCH");
  });

  it("test_dashboard_link_unsupported", async () => {
    const { ws, mock } = makeWorkspace();

    const exc = await expectRaises(
      ws.resolveReportLink(
        "https://mixpanel.com/project/12345/app/boards#id=555",
      ),
      UnsupportedReportLinkError,
    );

    expect(exc.code).toBe("UNSUPPORTED_DASHBOARD_LINK");
    const details = detailsOf(exc);
    expect(details["hint"]).toBe(
      "Use ws.get_dashboard(555) (CLI: mp dashboards get 555) to list its " +
        "reports, then resolve one report link.",
    );
    expect(details["dashboard_id"]).toBe(555);
    assertNoClientCalls(mock);
  });

  it("test_legacy_hash_unsupported", async () => {
    const { ws, mock } = makeWorkspace();

    const exc = await expectRaises(
      ws.resolveReportLink(
        "https://mixpanel.com/project/12345/app/insights#~(sections~())",
      ),
      UnsupportedReportLinkError,
    );

    expect(exc.code).toBe("UNSUPPORTED_LEGACY_HASH");
    expect(detailsOf(exc)["hint"]).toBe(
      "Open it in a browser (the app re-mints a shareable link on load) " +
        "and copy the new URL.",
    );
    assertNoClientCalls(mock);
  });

  it("test_unsupported_kinds_win_over_scope_checks", async () => {
    const { ws } = makeWorkspace();

    await expectRaises(
      ws.resolveReportLink("https://mixpanel.com/project/3/app/boards#id=555"),
      UnsupportedReportLinkError,
    );
  });

  it("test_parse_error_propagates", async () => {
    const { ws, mock } = makeWorkspace();

    await expectRaises(
      ws.resolveReportLink("not a link"),
      ReportLinkParseError,
    );

    assertNoClientCalls(mock);
  });
});

describe("TestResolveShortLinks (test_workspace_report_links.py:1118)", () => {
  it("test_short_link_resolves_like_its_target", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setResolveShortLink(() => SHORT_TARGET);
    mock.setGetBookmarkUrl(() => slugRecord());

    const direct = await ws.resolveReportLink(SHORT_TARGET);
    const viaShort = await ws.resolveReportLink(SHORT);

    expect(mock.resolveShortLinkCalls).toStrictEqual(["AbC123"]);
    expect(viaShort.expanded_url).toBe(SHORT_TARGET);
    expect(viaShort.input).toBe(SHORT);
    // `dataclasses.replace(via_short, expanded_url=None, input=_SHORT_TARGET) == direct`
    expect({
      ...viaShort.toDict(),
      expanded_url: null,
      input: SHORT_TARGET,
    }).toStrictEqual(direct.toDict());
  });

  it("test_short_link_to_bookmark", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setResolveShortLink(
      () => "https://mixpanel.com/project/12345/app/insights#report/123",
    );
    mock.setGetBookmark(() => BOOKMARK_RAW);

    const resolved = await ws.resolveReportLink(SHORT);

    expect(resolved.source).toBe("bookmark");
    expect(resolved.bookmark_id).toBe(123);
    expect(resolved.expanded_url).toBe(
      "https://mixpanel.com/project/12345/app/insights#report/123",
    );
  });

  it("test_short_link_chain_raises", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setResolveShortLink(() => "https://mixpanel.com/s/XyZ");

    const exc = await expectRaises(
      ws.resolveReportLink(SHORT),
      ShortLinkResolutionError,
    );

    expect(exc.code).toBe("SHORT_LINK_CHAIN");
    const details = detailsOf(exc);
    expect(details["hint"]).toBe("Resolve the target shortlink directly.");
    expect(details["target"]).toBe("https://mixpanel.com/s/XyZ");
    expect(mock.resolveShortLinkCalls).toHaveLength(1);
    expect(mock.bookmarkUrlGetCalls).toHaveLength(0);
  });

  it("test_short_link_to_dashboard_unsupported", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setResolveShortLink(
      () => "https://mixpanel.com/project/12345/app/boards#id=555",
    );

    const exc = await expectRaises(
      ws.resolveReportLink(SHORT),
      UnsupportedReportLinkError,
    );

    expect(exc.code).toBe("UNSUPPORTED_DASHBOARD_LINK");
    expect(mock.bookmarkUrlGetCalls).toHaveLength(0);
  });

  it("test_short_link_target_in_other_project", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setResolveShortLink(
      () => `https://mixpanel.com/project/3/app/insights#${SLUG}`,
    );

    const exc = await expectRaises(
      ws.resolveReportLink(SHORT),
      ReportLinkScopeMismatchError,
    );

    expect(exc.code).toBe("REPORT_LINK_PROJECT_MISMATCH");
    expect(mock.bookmarkUrlGetCalls).toHaveLength(0);
    expect(mock.bookmarkGetCalls).toHaveLength(0);
  });

  it("test_short_link_region_mismatch_before_network", async () => {
    const { ws, mock } = makeWorkspace();

    const exc = await expectRaises(
      ws.resolveReportLink("https://eu.mixpanel.com/s/AbC123"),
      ReportLinkScopeMismatchError,
    );

    expect(exc.code).toBe("REPORT_LINK_REGION_MISMATCH");
    expect(mock.resolveShortLinkCalls).toHaveLength(0);
  });

  it("test_short_link_errors_propagate", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setResolveShortLink(() => {
      throw new ReportLinkNotFoundError("gone", {
        code: "SHORT_LINK_NOT_FOUND",
      });
    });

    const exc = await expectRaises(
      ws.resolveReportLink(SHORT),
      ReportLinkNotFoundError,
    );

    expect(exc.code).toBe("SHORT_LINK_NOT_FOUND");
  });

  it("test_query_report_link_through_short_link", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setResolveShortLink(() => SHORT_TARGET);
    mock.setGetBookmarkUrl(() => slugRecord());

    const result = await ws.queryReportLink(SHORT);

    expect(result).toBeInstanceOf(QueryResult);
    // The expanded target names /view/75/, so the report runs under 75.
    expect(mock.insightsCalls).toHaveLength(1);
    const call = mock.insightsCalls[0]!;
    expect(call.body["bookmark"]).toStrictEqual(INSIGHTS_PARAMS);
    expect(call.body["project_id"]).toBe(12345);
    expect(call.scope).toStrictEqual({
      workspace_id: 75,
      inject_workspace_id: false,
    });
  });
});

describe("TestResolveSlugWithUnknownServerType (test_workspace_report_links.py:1450)", () => {
  it("test_unknown_type_falls_back_to_parsed_app", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setGetBookmarkUrl(() => slugRecord({ type: "user" }));

    const resolved = await ws.resolveReportLink(
      `https://mixpanel.com/project/12345/app/insights#${SLUG}`,
    );

    expect(resolved.report_type).toBe("user");
    expect(resolved.url).toBe(
      `https://mixpanel.com/project/12345/app/insights#${SLUG}`,
    );
  });

  it("test_unknown_type_on_bare_slug_defaults_to_insights_app", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setGetBookmarkUrl(() => slugRecord({ type: "user" }));

    const resolved = await ws.resolveReportLink(SLUG);

    expect(resolved.url).toBe(
      `https://mixpanel.com/project/12345/app/insights#${SLUG}`,
    );
  });

  it("test_unknown_type_logs_a_warning", async () => {
    const { ws, mock, log } = makeWorkspace();
    mock.setGetBookmarkUrl(() => slugRecord({ type: "user" }));

    await ws.resolveReportLink(SLUG);

    expect(
      log.warnings.some(
        (m) =>
          m.includes("unknown report type 'user'") && m.includes("insights"),
      ),
    ).toBe(true);
  });

  it("test_unknown_type_cannot_run", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setGetBookmarkUrl(() => slugRecord({ type: "user" }));

    const exc = await expectRaises(
      ws.queryReportLink(SLUG),
      UnsupportedReportLinkError,
    );

    expect(exc.code).toBe("UNSUPPORTED_REPORT_TYPE");
  });
});
