// Layer-3 translation — Phase-3 packet B4-C3 entity-CRUD edge locks.
// Source: tests/unit/test_api_client_crud_edge.py (ALL classes —
// app_request unwrapping, list-method response handling, response type
// validation, duplicate bookmark/dashboard lookups, 204 voids, error
// propagation, workspace-scoped paths).
//
// TestAppRequestUnwrapping re-locks the B0 `appRequest` envelope through
// the C1 client method (the Python file exercises it via
// `client.app_request`), so it lives here with its siblings rather than
// in the B0 suite (same source file, one home — R10.2).
import { describe, expect, it } from "vitest";
import {
  AuthenticationError,
  MixpanelHeadlessError,
  QueryError,
} from "../../src/errors.js";
import { toNativeJson } from "../../src/client/json-value.js";
import { createMockClient, makeSession } from "./client-test-helpers.js";
import type { Session } from "../../src/auth/session.js";

/** The `oauth_credentials` fixture twin (test_api_client_crud_edge.py:36-38). */
function oauthCredentials(): Session {
  return makeSession({
    projectId: "12345",
    region: "us",
    oauthToken: "test-token",
  });
}

describe("TestAppRequestUnwrapping", () => {
  it("test_unwraps_results_list", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: [1, 2, 3] },
    }));
    const result = toNativeJson(
      await client.appRequest("GET", "/projects/12345/test"),
    );
    expect(result).toEqual([1, 2, 3]);
  });

  it("test_unwraps_results_dict", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: { id: 1 } },
    }));
    const result = toNativeJson(
      await client.appRequest("GET", "/projects/12345/test"),
    );
    expect(result).toEqual({ id: 1 });
  });

  it("test_no_results_key_returns_full_body", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { data: "x" },
    }));
    const result = toNativeJson(
      await client.appRequest("GET", "/projects/12345/test"),
    );
    expect(result).toEqual({ data: "x" });
  });

  it("test_204_returns_status_ok", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 204,
    }));
    const result = toNativeJson(
      await client.appRequest("DELETE", "/projects/12345/test"),
    );
    expect(result).toEqual({ status: "ok" });
  });
});

describe("TestListMethodResponseHandling", () => {
  it("test_list_dashboards_returns_unwrapped_list", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: [{ id: 1 }] },
    }));
    const result = toNativeJson(await client.listDashboards());
    expect(result).toEqual([{ id: 1 }]);
  });

  it("test_list_dashboards_empty", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: [] },
    }));
    const result = await client.listDashboards();
    expect(result).toEqual([]);
  });

  it("test_list_bookmarks_v2_returns_unwrapped_list", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: [{ id: 10, name: "Report" }] },
    }));
    const result = toNativeJson(await client.listBookmarksV2());
    expect(result).toEqual([{ id: 10, name: "Report" }]);
  });

  it("test_list_cohorts_app_returns_unwrapped_list", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: [{ id: 5, name: "Power Users" }] },
    }));
    const result = toNativeJson(await client.listCohortsApp());
    expect(result).toEqual([{ id: 5, name: "Power Users" }]);
  });

  it("test_list_blueprint_templates_returns_unwrapped_list", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: [{ template_type: "company_kpis" }] },
    }));
    const result = toNativeJson(await client.listBlueprintTemplates());
    expect(result).toEqual([{ template_type: "company_kpis" }]);
  });

  it("test_list_blueprint_templates_skips_non_dict_entries", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: {
          templates: {
            valid: { title_key: "OK" },
            invalid_string: "not a dict",
            invalid_none: null,
          },
        },
      },
    }));
    const result = toNativeJson(await client.listBlueprintTemplates()) as Array<
      Record<string, unknown>
    >;
    // Only the valid dict entry should be returned
    expect(result).toHaveLength(1);
    expect(result[0]?.["name"]).toBe("valid");
    expect(result[0]?.["title_key"]).toBe("OK");
  });

  it("test_list_dashboards_non_list_raises", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: "unexpected" },
    }));
    const err: unknown = await client.listDashboards().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MixpanelHeadlessError);
    expect((err as Error).message).toContain("expected list");
  });
});

describe("TestResponseTypeValidation", () => {
  it("test_create_dashboard_returns_dict", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: { id: 1, title: "X" } },
    }));
    const result = toNativeJson(await client.createDashboard({ title: "X" }));
    expect(result).toEqual({ id: 1, title: "X" });
  });

  it("test_get_dashboard_returns_dict", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: { id: 42, title: "My Dash" } },
    }));
    const result = toNativeJson(await client.getDashboard(42));
    expect(result).toEqual({ id: 42, title: "My Dash" });
  });

  it("test_create_bookmark_returns_dict", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: { id: 99, name: "DAU", type: "insights" },
      },
    }));
    const result = toNativeJson(
      await client.createBookmark({
        name: "DAU",
        type: "insights",
        params: {},
      }),
    );
    expect(result).toEqual({ id: 99, name: "DAU", type: "insights" });
  });

  it("test_get_cohort_returns_dict", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: { id: 7, name: "Churned" } },
    }));
    const result = toNativeJson(await client.getCohort(7));
    expect(result).toEqual({ id: 7, name: "Churned" });
  });

  it("test_bookmark_linked_ids_returns_list", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: [1, 2] },
    }));
    const result = toNativeJson(await client.bookmarkLinkedDashboardIds(42));
    expect(result).toEqual([1, 2]);
  });

  it("test_create_dashboard_non_dict_raises", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: [1, 2] },
    }));
    const err: unknown = await client
      .createDashboard({ title: "X" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MixpanelHeadlessError);
    expect((err as Error).message).toContain("expected dict");
  });

  it("test_get_bookmark_non_dict_raises", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: [1, 2] },
    }));
    const err: unknown = await client.getBookmark(42).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MixpanelHeadlessError);
    expect((err as Error).message).toContain("expected dict");
  });

  it("test_bookmark_linked_ids_non_list_raises", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: { id: 1 } },
    }));
    const err: unknown = await client
      .bookmarkLinkedDashboardIds(42)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MixpanelHeadlessError);
    expect((err as Error).message).toContain("expected list");
  });
});

describe("TestDuplicateBookmarkDashboardMethods", () => {
  it("test_get_bookmark_dashboard_ids_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [1] } };
    });
    await client.getBookmarkDashboardIds(42);
    expect(capturedUrls[0]).toContain("/dashboards/bookmarks/42/dashboard-ids");
  });

  it("test_bookmark_linked_dashboard_ids_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [1] } };
    });
    await client.bookmarkLinkedDashboardIds(42);
    expect(capturedUrls[0]).toContain("/bookmarks/42/linked-dashboard-ids");
  });

  it("test_both_return_list_of_ints", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: [1, 2, 3] },
    }));
    const resultA = toNativeJson(await client.getBookmarkDashboardIds(42));
    const resultB = toNativeJson(await client.bookmarkLinkedDashboardIds(42));
    expect(resultA).toEqual([1, 2, 3]);
    expect(resultB).toEqual([1, 2, 3]);
  });

  it("test_both_handle_empty_results", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: [] },
    }));
    const resultA = await client.getBookmarkDashboardIds(42);
    const resultB = await client.bookmarkLinkedDashboardIds(42);
    expect(resultA).toEqual([]);
    expect(resultB).toEqual([]);
  });
});

describe("TestVoidOperationResponses", () => {
  it("test_delete_dashboard_204", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 204,
    }));
    await client.deleteDashboard(1); // Should not raise
  });

  it("test_favorite_dashboard_204", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 204,
    }));
    await client.favoriteDashboard(1); // Should not raise
  });

  it("test_bulk_delete_dashboards_204", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 204,
    }));
    await client.bulkDeleteDashboards([1, 2, 3]); // Should not raise
  });
});

describe("TestErrorPropagation", () => {
  it("test_list_dashboards_401", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 401,
      json: { error: "Unauthorized" },
    }));
    await expect(client.listDashboards()).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });

  it("test_create_bookmark_400", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 400,
      json: { error: "Invalid bookmark type" },
    }));
    await expect(
      client.createBookmark({ name: "Bad", type: "invalid" }),
    ).rejects.toBeInstanceOf(QueryError);
  });

  it("test_get_cohort_404", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 404,
      json: { error: "Not found" },
    }));
    await expect(client.getCohort(999999)).rejects.toBeInstanceOf(QueryError);
  });
});

describe("TestWorkspaceScopedPaths", () => {
  it("test_list_dashboards_project_scoped", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listDashboards();
    expect(capturedUrls[0]).toContain("/projects/12345/dashboards");
  });

  it("test_list_dashboards_workspace_scoped", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    client.setWorkspaceId(789);
    await client.listDashboards();
    expect(capturedUrls[0]).toContain("/workspaces/789/dashboards");
  });

  it("test_list_bookmarks_v2_project_scoped", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listBookmarksV2();
    expect(capturedUrls[0]).toContain("/projects/12345/bookmarks");
  });

  it("test_list_cohorts_app_project_scoped", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listCohortsApp();
    expect(capturedUrls[0]).toContain("/projects/12345/cohorts");
  });
});
