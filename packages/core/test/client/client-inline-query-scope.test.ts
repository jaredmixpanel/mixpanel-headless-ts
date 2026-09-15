// Layer-3 translation — 045-report-links (Python PR #223 review). Source:
// tests/unit/test_query_workspace_scoping.py — ONLY the two classes added
// by the report-links work: TestExplicitWorkspaceOnInlineQueries and
// TestInlineQueriesCanOptOutOfThePin. The older classes of that module
// are twinned in `client-scoping.test.ts`, whose fixtures this
// file mirrors.
//
// Translation notes:
// - `make_capture_client(session, captured, response_json=...)` → the
//   `createMockClient` httpx.MockTransport analog with a handler that
//   pushes the captured request view and returns the canned JSON.
// - Python kw-only `workspace_id=` / `inject_workspace_id=` → the
//   second-argument options bag of `insightsQuery` / `arbFunnelsQuery`
//   (same snake_case keys, R3.8).
// - `request.url.params.get("workspace_id")` → `request.params["workspace_id"]`
//   (string-valued, like httpx `QueryParams`).
import { describe, expect, it } from "vitest";

import {
  type CapturedFetchRequest,
  createMockClient,
  makeSession,
} from "../../test-support/client-test-helpers.js";

const PINNED_WORKSPACE_ID = 777;

/** `pinned_session` fixture. */
function pinnedSession(): ReturnType<typeof makeSession> {
  return makeSession({
    username: "test_user",
    secret: "test_secret",
    projectId: "12345",
    region: "us",
    workspaceId: PINNED_WORKSPACE_ID,
  });
}

/** `unpinned_session` fixture. */
function unpinnedSession(): ReturnType<typeof makeSession> {
  return makeSession({
    username: "test_user",
    secret: "test_secret",
    projectId: "12345",
    region: "us",
  });
}

/** Canned Query-host bodies (`response_json=` values). */
const INSIGHTS_JSON = { headers: [], series: {} };
const ARB_FUNNELS_JSON = { computed_at: "t" };

/**
 * `make_capture_client` twin: a client whose transport records every
 * request into `captured` and answers with `responseJson`.
 *
 * @param session - The session to bind.
 * @param captured - The capture log to append to.
 * @param responseJson - The canned 200 JSON body.
 * @returns The client.
 */
function makeCaptureClient(
  session: ReturnType<typeof makeSession>,
  captured: CapturedFetchRequest[],
  responseJson: unknown,
): ReturnType<typeof createMockClient>["client"] {
  const { client } = createMockClient(session, (request) => {
    captured.push(request);
    return { status: 200, json: responseJson };
  });
  return client;
}

describe("Explicit workspace on inline queries", () => {
  // python: TestExplicitWorkspaceOnInlineQueries
  it("insights query explicit workspace on unpinned session", async () => {
    // python: test_insights_query_explicit_workspace_on_unpinned_session
    const captured: CapturedFetchRequest[] = [];
    const client = makeCaptureClient(
      unpinnedSession(),
      captured,
      INSIGHTS_JSON,
    );
    await client.insightsQuery(
      { bookmark: {}, project_id: 12345 },
      { workspace_id: 75 },
    );

    expect(captured[0]?.params["workspace_id"]).toBe("75");
  });

  it("insights query explicit workspace wins over pin", async () => {
    // python: test_insights_query_explicit_workspace_wins_over_pin
    const captured: CapturedFetchRequest[] = [];
    const client = makeCaptureClient(pinnedSession(), captured, INSIGHTS_JSON);
    await client.insightsQuery(
      { bookmark: {}, project_id: 12345 },
      { workspace_id: 75 },
    );

    expect(captured[0]?.params["workspace_id"]).toBe("75");
  });

  it("insights query without workspace keeps pin behavior", async () => {
    // python: test_insights_query_without_workspace_keeps_pin_behavior
    const captured: CapturedFetchRequest[] = [];
    const client = makeCaptureClient(
      unpinnedSession(),
      captured,
      INSIGHTS_JSON,
    );
    await client.insightsQuery(
      { bookmark: {}, project_id: 12345 },
      { workspace_id: null },
    );

    expect(Object.hasOwn(captured[0]?.params ?? {}, "workspace_id")).toBe(
      false,
    );
  });

  it("arb funnels query explicit workspace", async () => {
    // python: test_arb_funnels_query_explicit_workspace
    const captured: CapturedFetchRequest[] = [];
    const client = makeCaptureClient(
      unpinnedSession(),
      captured,
      ARB_FUNNELS_JSON,
    );
    await client.arbFunnelsQuery(
      { bookmark: {}, project_id: 12345, query_type: "flows_sankey" },
      { workspace_id: 75 },
    );

    expect(captured[0]?.url.includes("/api/query/arb_funnels")).toBe(true);
    expect(captured[0]?.params["workspace_id"]).toBe("75");
  });
});

describe("Inline queries can opt out of the pin", () => {
  // python: TestInlineQueriesCanOptOutOfThePin
  it("insights query opt out omits pin", async () => {
    // python: test_insights_query_opt_out_omits_pin
    const captured: CapturedFetchRequest[] = [];
    const client = makeCaptureClient(pinnedSession(), captured, INSIGHTS_JSON);
    await client.insightsQuery(
      { bookmark: {}, project_id: 12345 },
      { inject_workspace_id: false },
    );

    expect(Object.hasOwn(captured[0]?.params ?? {}, "workspace_id")).toBe(
      false,
    );
  });

  it("insights query explicit workspace survives opt out", async () => {
    // python: test_insights_query_explicit_workspace_survives_opt_out
    const captured: CapturedFetchRequest[] = [];
    const client = makeCaptureClient(pinnedSession(), captured, INSIGHTS_JSON);
    await client.insightsQuery(
      { bookmark: {}, project_id: 12345 },
      { workspace_id: 75, inject_workspace_id: false },
    );

    expect(captured[0]?.params["workspace_id"]).toBe("75");
  });

  it("arb funnels query opt out omits pin", async () => {
    // python: test_arb_funnels_query_opt_out_omits_pin
    const captured: CapturedFetchRequest[] = [];
    const client = makeCaptureClient(
      pinnedSession(),
      captured,
      ARB_FUNNELS_JSON,
    );
    await client.arbFunnelsQuery(
      { bookmark: {}, project_id: 12345, query_type: "flows_sankey" },
      { inject_workspace_id: false },
    );

    expect(Object.hasOwn(captured[0]?.params ?? {}, "workspace_id")).toBe(
      false,
    );
  });
});
