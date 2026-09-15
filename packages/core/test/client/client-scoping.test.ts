// Explicit-only workspace-pin injection on Query-host requests: pinned
// GET/POST carry `workspace_id`, `injectWorkspaceId: false` opts out, unpinned
// sessions trigger no discovery, App API requests are unaffected, `use()`
// clears the pin. Mirrors the client-side classes of
// tests/unit/test_query_workspace_scoping.py, driven through `requestQueryHost`.

import { describe, expect, it } from "vitest";

import { buildUrl } from "../../src/client/url.js";
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

/** The Query-host GET url `get_events()` issues (`/events/names`). */
const EVENTS_NAMES_URL = buildUrl("us", "query", "/events/names");

describe("Query host injection when pinned", () => {
  // python: TestQueryHostInjectionWhenPinned
  it("pinned workspace get includes workspace ID", async () => {
    // python: test_pinned_workspace_get_includes_workspace_id
    const captured: CapturedFetchRequest[] = [];
    const { client } = createMockClient(pinnedSession(), (incoming) => {
      captured.push(incoming);
      return { status: 200, json: [] };
    });
    await client.requestQueryHost("GET", EVENTS_NAMES_URL, {
      params: { type: "general" },
    });
    expect(captured).toHaveLength(1);
    const request = captured[0]!;
    expect(request.url.includes("/api/query/events/names")).toBe(true);
    expect(request.params["workspace_id"]).toBe(String(PINNED_WORKSPACE_ID));
  });

  it("pinned workspace post includes workspace ID", async () => {
    // python: test_pinned_workspace_post_includes_workspace_id
    const captured: CapturedFetchRequest[] = [];
    const { client } = createMockClient(pinnedSession(), (incoming) => {
      captured.push(incoming);
      return { status: 200, json: { headers: [], series: {} } };
    });
    // insights_query POSTs to the Query host with the payload as the
    // JSON body (the wrapper's exact `_request` call shape).
    await client.requestQueryHost(
      "POST",
      buildUrl("us", "query", "/insights"),
      {
        data: { bookmark: {}, project_id: 12345 },
      },
    );
    expect(captured).toHaveLength(1);
    const request = captured[0]!;
    expect(request.method).toBe("POST");
    expect(request.url.includes("/api/query/insights")).toBe(true);
    expect(request.params["workspace_id"]).toBe(String(PINNED_WORKSPACE_ID));
  });

  it("set workspace ID pin scopes subsequent queries", async () => {
    // python: test_set_workspace_id_pin_scopes_subsequent_queries
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

describe("Injection opt out", () => {
  // python: TestInjectionOptOut
  it("inject workspace ID false omits param even when pinned", async () => {
    // python: test_inject_workspace_id_false_omits_param_even_when_pinned
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

describe("No workspace pinned", () => {
  // python: TestNoWorkspacePinned
  it("unpinned query has no workspace ID and no discovery", async () => {
    // python: test_unpinned_query_has_no_workspace_id_and_no_discovery
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
    const request = captured[0]!;
    expect(Object.hasOwn(request.params, "workspace_id")).toBe(false);
    expect(request.url.includes("/workspaces")).toBe(false);
  });

  it("caller supplied workspace ID is preserved", async () => {
    // python: test_caller_supplied_workspace_id_is_preserved
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

describe("Non query hosts unaffected", () => {
  // python: TestNonQueryHostsUnaffected
  it("app request carries no workspace ID param", async () => {
    // python: test_app_request_carries_no_workspace_id_param
    const captured: CapturedFetchRequest[] = [];
    const { client } = createMockClient(pinnedSession(), (incoming) => {
      captured.push(incoming);
      return { status: 200, json: { results: [] } };
    });
    const path = client.maybeScopedPath("dashboards");
    expect(path).toBe(`/workspaces/${PINNED_WORKSPACE_ID}/dashboards`);
    await client.appRequest("GET", path);
    expect(captured).toHaveLength(1);
    const request = captured[0]!;
    expect(
      request.url.includes(
        `/api/app/workspaces/${PINNED_WORKSPACE_ID}/dashboards`,
      ),
    ).toBe(true);
    expect(Object.hasOwn(request.params, "workspace_id")).toBe(false);
  });

  // test_export_stream_carries_no_workspace_id_param drives `exportEvents`
  // and lives in client-export.test.ts.
});

describe("Pin lifecycle", () => {
  // python: TestPinLifecycle
  it("use project clears pin from query params", async () => {
    // python: test_use_project_clears_pin_from_query_params
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

  it("zero axis use clears pin from query params", async () => {
    // python: test_zero_axis_use_clears_pin_from_query_params
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
