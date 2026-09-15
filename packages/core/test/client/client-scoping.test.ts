// Layer-3 translation — Phase-3 packet B4-C1: the CLIENT-SIDE classes of
// tests/unit/test_query_workspace_scoping.py (issue #198 —
// explicit-only workspace-pin injection on Query-host requests):
// TestQueryHostInjectionWhenPinned (:128), TestInjectionOptOut (:191),
// TestNoWorkspacePinned (:224), TestNonQueryHostsUnaffected (:273),
// TestPinLifecycle (:324).
//
// Header exclusions (packet C1 §Layer-3):
// - ::TestWorkspaceFacadeScoping (:379) and ::TestDiscoveryCacheAcrossUse
//   (:401) are facade/service tests → B5/B6.
// - ::TestNonQueryHostsUnaffected::
//   test_export_stream_carries_no_workspace_id_param (:300) exercises
//   `export_events` (a C2-owned method) — DEFERRED to B4-C2 (recorded in
//   B4-C1-notes.md; C2 must land it).
//
// Entry-point substitution (packet C1 boundary): Python drives the thin
// C2 wrappers `get_events()` / `insights_query()` over `_request`; those
// public surfaces land at B4-C2, so the pin-injection assertions here
// drive the SAME `_request` seam (`client.requestQueryHost`) with the
// SAME Query-host URLs — exactly the seam Python's TestInjectionOptOut
// and test_caller_supplied_workspace_id already drive directly. C2
// re-locks the wrappers end-to-end. All assertion content (single
// request, URL host/path, workspace_id presence/absence/value) is
// preserved (R10.2).
import { describe, expect, it } from "vitest";

import { buildUrl } from "../../src/client/url.js";
import {
  type CapturedFetchRequest,
  createMockClient,
  makeSession,
} from "../../test-support/client-test-helpers.js";

const PINNED_WORKSPACE_ID = 777;

/** `pinned_session` fixture (:48-63). */
function pinnedSession(): ReturnType<typeof makeSession> {
  return makeSession({
    username: "test_user",
    secret: "test_secret",
    projectId: "12345",
    region: "us",
    workspaceId: PINNED_WORKSPACE_ID,
  });
}

/** `unpinned_session` fixture (:66-78). */
function unpinnedSession(): ReturnType<typeof makeSession> {
  return makeSession({
    username: "test_user",
    secret: "test_secret",
    projectId: "12345",
    region: "us",
  });
}

/** The Query-host GET url `get_events()` issues (`/events/names`). */
const EVENTS_NAMES_URL = buildUrl("us", "query", "/events/names");

describe("TestQueryHostInjectionWhenPinned", () => {
  it("test_pinned_workspace_get_includes_workspace_id", async () => {
    const captured: CapturedFetchRequest[] = [];
    const { client } = createMockClient(pinnedSession(), (incoming) => {
      captured.push(incoming);
      return { status: 200, json: [] };
    });
    await client.requestQueryHost("GET", EVENTS_NAMES_URL, {
      params: { type: "general" },
    });
    expect(captured).toHaveLength(1);
    const request = captured[0] as CapturedFetchRequest;
    expect(request.url.includes("/api/query/events/names")).toBe(true);
    expect(request.params["workspace_id"]).toBe(String(PINNED_WORKSPACE_ID));
  });

  it("test_pinned_workspace_post_includes_workspace_id", async () => {
    const captured: CapturedFetchRequest[] = [];
    const { client } = createMockClient(pinnedSession(), (incoming) => {
      captured.push(incoming);
      return { status: 200, json: { headers: [], series: {} } };
    });
    // insights_query POSTs to the Query host with the payload as the
    // JSON body (the C2 wrapper's exact `_request` call shape).
    await client.requestQueryHost(
      "POST",
      buildUrl("us", "query", "/insights"),
      {
        data: { bookmark: {}, project_id: 12345 },
      },
    );
    expect(captured).toHaveLength(1);
    const request = captured[0] as CapturedFetchRequest;
    expect(request.method).toBe("POST");
    expect(request.url.includes("/api/query/insights")).toBe(true);
    expect(request.params["workspace_id"]).toBe(String(PINNED_WORKSPACE_ID));
  });

  it("test_set_workspace_id_pin_scopes_subsequent_queries", async () => {
    const captured: CapturedFetchRequest[] = [];
    const { client } = createMockClient(unpinnedSession(), (incoming) => {
      captured.push(incoming);
      return { status: 200, json: [] };
    });
    client.setWorkspaceId(PINNED_WORKSPACE_ID);
    await client.requestQueryHost("GET", EVENTS_NAMES_URL, {
      params: { type: "general" },
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.params["workspace_id"]).toBe(
      String(PINNED_WORKSPACE_ID),
    );
  });
});

describe("TestInjectionOptOut", () => {
  it("test_inject_workspace_id_false_omits_param_even_when_pinned", async () => {
    const captured: CapturedFetchRequest[] = [];
    const { client } = createMockClient(pinnedSession(), (incoming) => {
      captured.push(incoming);
      return { status: 200, json: [] };
    });
    await client.requestQueryHost("GET", EVENTS_NAMES_URL, {
      params: { type: "general" },
      injectWorkspaceId: false,
    });
    expect(captured).toHaveLength(1);
    expect(Object.hasOwn(captured[0]?.params ?? {}, "workspace_id")).toBe(
      false,
    );
  });
});

describe("TestNoWorkspacePinned", () => {
  it("test_unpinned_query_has_no_workspace_id_and_no_discovery", async () => {
    const captured: CapturedFetchRequest[] = [];
    const { client } = createMockClient(unpinnedSession(), (incoming) => {
      captured.push(incoming);
      return { status: 200, json: [] };
    });
    await client.requestQueryHost("GET", EVENTS_NAMES_URL, {
      params: { type: "general" },
    });
    // EXPLICIT-ONLY gating: exactly one request goes out and none
    // touches a /workspaces discovery endpoint.
    expect(captured).toHaveLength(1);
    const request = captured[0] as CapturedFetchRequest;
    expect(Object.hasOwn(request.params, "workspace_id")).toBe(false);
    expect(request.url.includes("/workspaces")).toBe(false);
  });

  it("test_caller_supplied_workspace_id_is_preserved", async () => {
    const captured: CapturedFetchRequest[] = [];
    const { client } = createMockClient(pinnedSession(), (incoming) => {
      captured.push(incoming);
      return { status: 200, json: [] };
    });
    await client.requestQueryHost("GET", EVENTS_NAMES_URL, {
      params: { type: "general", workspace_id: 111 },
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.params["workspace_id"]).toBe("111");
  });
});

describe("TestNonQueryHostsUnaffected", () => {
  it("test_app_request_carries_no_workspace_id_param", async () => {
    const captured: CapturedFetchRequest[] = [];
    const { client } = createMockClient(pinnedSession(), (incoming) => {
      captured.push(incoming);
      return { status: 200, json: { results: [] } };
    });
    const path = client.maybeScopedPath("dashboards");
    expect(path).toBe(`/workspaces/${PINNED_WORKSPACE_ID}/dashboards`);
    await client.appRequest("GET", path);
    expect(captured).toHaveLength(1);
    const request = captured[0] as CapturedFetchRequest;
    expect(
      request.url.includes(
        `/api/app/workspaces/${PINNED_WORKSPACE_ID}/dashboards`,
      ),
    ).toBe(true);
    expect(Object.hasOwn(request.params, "workspace_id")).toBe(false);
  });

  // test_export_stream_carries_no_workspace_id_param → B4-C2 (see the
  // file header — export_events is C2-owned).
});

describe("TestPinLifecycle", () => {
  it("test_use_project_clears_pin_from_query_params", async () => {
    const captured: CapturedFetchRequest[] = [];
    const { client } = createMockClient(pinnedSession(), (incoming) => {
      captured.push(incoming);
      return { status: 200, json: [] };
    });
    expect(client.workspaceId).toBe(PINNED_WORKSPACE_ID);
    await client.use({ project: "99999" });
    await client.requestQueryHost("GET", EVENTS_NAMES_URL, {
      params: { type: "general" },
    });
    expect(captured).toHaveLength(1);
    expect(Object.hasOwn(captured[0]?.params ?? {}, "workspace_id")).toBe(
      false,
    );
  });

  it("test_zero_axis_use_clears_pin_from_query_params", async () => {
    const captured: CapturedFetchRequest[] = [];
    const { client } = createMockClient(pinnedSession(), (incoming) => {
      captured.push(incoming);
      return { status: 200, json: [] };
    });
    expect(client.workspaceId).toBe(PINNED_WORKSPACE_ID);
    await client.use();
    expect(client.session.workspace ?? null).toBeNull();
    expect(client.workspaceId).toBeNull();
    await client.requestQueryHost("GET", EVENTS_NAMES_URL, {
      params: { type: "general" },
    });
    expect(captured).toHaveLength(1);
    expect(Object.hasOwn(captured[0]?.params ?? {}, "workspace_id")).toBe(
      false,
    );
  });
});
