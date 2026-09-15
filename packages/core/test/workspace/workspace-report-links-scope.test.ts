// Workspace scope for report links: a URL or resolved-report workspace that
// differs from the pinned one is rejected before any fetch, unpinned sessions
// adopt the link's workspace, and reports without a workspace run project-wide.
// Mirrors TestWorkspaceScope of tests/unit/test_workspace_report_links.py; the
// scope bag `{workspace_id, inject_workspace_id}` is read off the recorded call.

import { describe, expect, it } from "vitest";

import { ReportLinkScopeMismatchError } from "../../src/errors.js";
import { QueryResult } from "../../src/types/results/query-engine.js";
import { TEST_SESSION } from "../../test-support/workspace-test-helpers.js";
import {
  detailsOf,
  expectRaises,
  INSIGHTS_PARAMS,
  makeWorkspace,
  PINNED_SESSION,
  PROJECT_WIDE_SCOPE,
  resolvedReport,
  SLUG,
  slugRecord,
} from "./workspace-report-links-fixtures.js";

describe("Workspace scope", () => {
  // python: TestWorkspaceScope
  it("URL workspace differs from pinned raises before fetch", async () => {
    // python: test_url_workspace_differs_from_pinned_raises_before_fetch
    const { ws, mock } = makeWorkspace({ session: PINNED_SESSION });

    const exc = await expectRaises(
      ws.resolveReportLink(
        `https://mixpanel.com/project/12345/view/9/app/insights#${SLUG}`,
      ),
      ReportLinkScopeMismatchError,
    );

    expect(exc.code).toBe("REPORT_LINK_WORKSPACE_MISMATCH");
    const details = detailsOf(exc);
    expect(details["link_workspace_id"]).toBe(9);
    expect(details["session_workspace_id"]).toBe(75);
    expect(details["hint"]).toBe(
      "Switch with ws.use(workspace=9) (CLI: mp --workspace 9 ...) and retry.",
    );
    expect(mock.bookmarkUrlGetCalls).toHaveLength(0);
  });

  it("URL workspace equal to pinned is fine", async () => {
    // python: test_url_workspace_equal_to_pinned_is_fine
    const { ws, mock } = makeWorkspace({ session: PINNED_SESSION });
    mock.setGetBookmarkUrl(() => slugRecord());

    const resolved = await ws.resolveReportLink(
      `https://mixpanel.com/project/12345/view/75/app/insights#${SLUG}`,
    );

    expect(resolved.workspace_id).toBe(75);
  });

  it("unpinned session accepts any URL workspace", async () => {
    // python: test_unpinned_session_accepts_any_url_workspace
    const { ws, mock } = makeWorkspace();
    mock.setGetBookmarkUrl(() => slugRecord());

    const resolved = await ws.resolveReportLink(
      `https://mixpanel.com/project/12345/view/9/app/insights#${SLUG}`,
    );

    expect(resolved.workspace_id).toBe(9);
  });

  it("resolved report workspace differs from pinned raises", async () => {
    // python: test_resolved_report_workspace_differs_from_pinned_raises
    const { ws, mock } = makeWorkspace({ session: PINNED_SESSION });
    const resolved = resolvedReport("insights", INSIGHTS_PARAMS, {
      workspace_id: 9,
    });

    const exc = await expectRaises(
      ws.queryReportLink(resolved),
      ReportLinkScopeMismatchError,
    );

    expect(exc.code).toBe("REPORT_LINK_WORKSPACE_MISMATCH");
    expect(mock.insightsCalls).toHaveLength(0);
  });

  it("resolved report without workspace runs project wide on pinned session", async () => {
    // python: test_resolved_report_without_workspace_runs_project_wide_on_pinned_session
    // Greptile P1 on PR #223: a later `use(workspace=...)` must not leak
    // its data view into a report that was resolved without one.
    const { ws, mock } = makeWorkspace({ session: PINNED_SESSION });

    const result = await ws.queryReportLink(
      resolvedReport("insights", INSIGHTS_PARAMS),
    );

    expect(result).toBeInstanceOf(QueryResult);
    expect(mock.insightsCalls).toHaveLength(1);
    const call = mock.insightsCalls[0]!;
    expect(call.body["bookmark"]).toStrictEqual(INSIGHTS_PARAMS);
    expect(call.body["project_id"]).toBe(12345);
    expect(call.scope).toStrictEqual(PROJECT_WIDE_SCOPE);
  });

  it("resolve unpinned then pin then run stays project wide", async () => {
    // python: test_resolve_unpinned_then_pin_then_run_stays_project_wide
    const { ws: wsA, mock } = makeWorkspace({ session: TEST_SESSION });
    mock.setGetBookmarkUrl(() => slugRecord());
    const resolved = await wsA.resolveReportLink(SLUG);
    expect(resolved.workspace_id).toBeNull();

    const { ws: wsB } = makeWorkspace({ session: PINNED_SESSION }, mock);

    await wsB.queryReportLink(resolved);

    expect(mock.insightsCalls).toHaveLength(1);
    const call = mock.insightsCalls[0]!;
    expect(call.body["bookmark"]).toStrictEqual(INSIGHTS_PARAMS);
    expect(call.body["project_id"]).toBe(12345);
    expect(call.scope).toStrictEqual(PROJECT_WIDE_SCOPE);
  });

  it("resolved workspace is applied when session is unpinned", async () => {
    // python: test_resolved_workspace_is_applied_when_session_is_unpinned
    // Greptile P1 on PR #223: a pin-clearing `use(project=...)` must not
    // silently turn a data-view report into a project-wide one.
    const { ws: wsA, mock } = makeWorkspace({ session: PINNED_SESSION });
    mock.setGetBookmarkUrl(() => slugRecord());
    const resolved = await wsA.resolveReportLink(SLUG);
    expect(resolved.workspace_id).toBe(75);

    const { ws: wsB } = makeWorkspace({ session: TEST_SESSION }, mock);

    const result = await wsB.queryReportLink(resolved);

    expect(result).toBeInstanceOf(QueryResult);
    expect(mock.insightsCalls).toHaveLength(1);
    const call = mock.insightsCalls[0]!;
    expect(call.body["bookmark"]).toStrictEqual(INSIGHTS_PARAMS);
    expect(call.body["project_id"]).toBe(12345);
    expect(call.scope).toStrictEqual({
      workspace_id: 75,
      inject_workspace_id: false,
    });
  });

  it("URL workspace is applied when session is unpinned", async () => {
    // python: test_url_workspace_is_applied_when_session_is_unpinned
    const { ws, mock } = makeWorkspace();
    mock.setGetBookmarkUrl(() => slugRecord());

    await ws.queryReportLink(
      `https://mixpanel.com/project/12345/view/9/app/insights#${SLUG}`,
    );

    expect(mock.insightsCalls).toHaveLength(1);
    const call = mock.insightsCalls[0]!;
    expect(call.body["bookmark"]).toStrictEqual(INSIGHTS_PARAMS);
    expect(call.body["project_id"]).toBe(12345);
    expect(call.scope).toStrictEqual({
      workspace_id: 9,
      inject_workspace_id: false,
    });
  });

  it("pinned workspace is recorded and applied", async () => {
    // python: test_pinned_workspace_is_recorded_and_applied
    const { ws, mock } = makeWorkspace({ session: PINNED_SESSION });
    mock.setGetBookmarkUrl(() => slugRecord());

    await ws.queryReportLink(SLUG);

    expect(mock.insightsCalls).toHaveLength(1);
    const call = mock.insightsCalls[0]!;
    expect(call.body["bookmark"]).toStrictEqual(INSIGHTS_PARAMS);
    expect(call.body["project_id"]).toBe(12345);
    expect(call.scope).toStrictEqual({
      workspace_id: 75,
      inject_workspace_id: false,
    });
  });

  it("scope checked after use workspace switch", async () => {
    // python: test_scope_checked_after_use_workspace_switch
    const { ws: wsA, mock } = makeWorkspace({ session: PINNED_SESSION });
    mock.setGetBookmarkUrl(() => slugRecord());
    const resolved = await wsA.resolveReportLink(SLUG);
    expect(resolved.workspace_id).toBe(75);

    const { ws: wsB } = makeWorkspace(
      { session: { ...TEST_SESSION, workspace: { id: 9 } } },
      mock,
    );

    await expectRaises(
      wsB.queryReportLink(resolved),
      ReportLinkScopeMismatchError,
    );

    expect(mock.insightsCalls).toHaveLength(0);
  });
});
