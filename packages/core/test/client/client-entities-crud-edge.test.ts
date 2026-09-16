// Entity-CRUD edge behavior through the assembled client: `appRequest`
// envelope unwrapping, list-method response handling, response type
// validation, the duplicate bookmark-dashboard lookups, 204 voids, error
// propagation and workspace-scoped paths. Mirrors every class of
// tests/unit/test_api_client_crud_edge.py.

import { describe, expect, it } from "vitest";

import type { Session } from "../../src/auth/session.js";
import { toNativeJson } from "../../src/client/json-value.js";
import {
  AuthenticationError,
  MixpanelHeadlessError,
  QueryError,
} from "../../src/errors.js";
import {
  createMockClient,
  makeSession,
} from "../../test-support/client-test-helpers.js";

/** The `oauth_credentials` fixture twin. */
function oauthCredentials(): Session {
  return makeSession({
    projectId: "12345",
    region: "us",
    oauthToken: "test-token",
  });
}

describe("App request unwrapping", () => {
  // python: TestAppRequestUnwrapping
  it("unwraps results list", async () => {
    // python: test_unwraps_results_list
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: [1, 2, 3] },
    }));
    const result = toNativeJson(
      await client.appRequest("GET", "/projects/12345/test"),
    );
    expect(result).toStrictEqual([1, 2, 3]);
  });

  it("unwraps results dict", async () => {
    // python: test_unwraps_results_dict
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: { id: 1 } },
    }));
    const result = toNativeJson(
      await client.appRequest("GET", "/projects/12345/test"),
    );
    expect(result).toStrictEqual({ id: 1 });
  });

  it("no results key returns full body", async () => {
    // python: test_no_results_key_returns_full_body
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { data: "x" },
    }));
    const result = toNativeJson(
      await client.appRequest("GET", "/projects/12345/test"),
    );
    expect(result).toStrictEqual({ data: "x" });
  });

  it("204 returns status ok", async () => {
    // python: test_204_returns_status_ok
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 204,
    }));
    const result = toNativeJson(
      await client.appRequest("DELETE", "/projects/12345/test"),
    );
    expect(result).toStrictEqual({ status: "ok" });
  });
});

describe("List method response handling", () => {
  // python: TestListMethodResponseHandling
  it("list dashboards returns unwrapped list", async () => {
    // python: test_list_dashboards_returns_unwrapped_list
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: [{ id: 1 }] },
    }));
    const result = toNativeJson(await client.listDashboards());
    expect(result).toStrictEqual([{ id: 1 }]);
  });

  it("list dashboards empty", async () => {
    // python: test_list_dashboards_empty
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: [] },
    }));
    const result = await client.listDashboards();
    expect(result).toStrictEqual([]);
  });

  it("list bookmarks V2 returns unwrapped list", async () => {
    // python: test_list_bookmarks_v2_returns_unwrapped_list
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: [{ id: 10, name: "Report" }] },
    }));
    const result = toNativeJson(await client.listBookmarksV2());
    expect(result).toStrictEqual([{ id: 10, name: "Report" }]);
  });

  it("list cohorts app returns unwrapped list", async () => {
    // python: test_list_cohorts_app_returns_unwrapped_list
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: [{ id: 5, name: "Power Users" }] },
    }));
    const result = toNativeJson(await client.listCohortsApp());
    expect(result).toStrictEqual([{ id: 5, name: "Power Users" }]);
  });

  it("list blueprint templates returns unwrapped list", async () => {
    // python: test_list_blueprint_templates_returns_unwrapped_list
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: [{ template_type: "company_kpis" }] },
    }));
    const result = toNativeJson(await client.listBlueprintTemplates());
    expect(result).toStrictEqual([{ template_type: "company_kpis" }]);
  });

  it("list blueprint templates skips non dict entries", async () => {
    // python: test_list_blueprint_templates_skips_non_dict_entries
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

  it("list dashboards non list raises", async () => {
    // python: test_list_dashboards_non_list_raises
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: "unexpected" },
    }));
    const err: unknown = await client
      .listDashboards()
      .catch((error: unknown) => error);
    expect(err).toBeInstanceOf(MixpanelHeadlessError);
    expect((err as Error).message).toContain("expected list");
  });
});

describe("Response type validation", () => {
  // python: TestResponseTypeValidation
  it("create dashboard returns dict", async () => {
    // python: test_create_dashboard_returns_dict
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: { id: 1, title: "X" } },
    }));
    const result = toNativeJson(await client.createDashboard({ title: "X" }));
    expect(result).toStrictEqual({ id: 1, title: "X" });
  });

  it("get dashboard returns dict", async () => {
    // python: test_get_dashboard_returns_dict
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: { id: 42, title: "My Dash" } },
    }));
    const result = toNativeJson(await client.getDashboard(42));
    expect(result).toStrictEqual({ id: 42, title: "My Dash" });
  });

  it("create bookmark returns dict", async () => {
    // python: test_create_bookmark_returns_dict
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
    expect(result).toStrictEqual({ id: 99, name: "DAU", type: "insights" });
  });

  it("get cohort returns dict", async () => {
    // python: test_get_cohort_returns_dict
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: { id: 7, name: "Churned" } },
    }));
    const result = toNativeJson(await client.getCohort(7));
    expect(result).toStrictEqual({ id: 7, name: "Churned" });
  });

  it("bookmark linked IDs returns list", async () => {
    // python: test_bookmark_linked_ids_returns_list
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: [1, 2] },
    }));
    const result = toNativeJson(await client.bookmarkLinkedDashboardIds(42));
    expect(result).toStrictEqual([1, 2]);
  });

  it("create dashboard non dict raises", async () => {
    // python: test_create_dashboard_non_dict_raises
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: [1, 2] },
    }));
    const err: unknown = await client
      .createDashboard({ title: "X" })
      .catch((error: unknown) => error);
    expect(err).toBeInstanceOf(MixpanelHeadlessError);
    expect((err as Error).message).toContain("expected dict");
  });

  it("get bookmark non dict raises", async () => {
    // python: test_get_bookmark_non_dict_raises
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: [1, 2] },
    }));
    const err: unknown = await client
      .getBookmark(42)
      .catch((error: unknown) => error);
    expect(err).toBeInstanceOf(MixpanelHeadlessError);
    expect((err as Error).message).toContain("expected dict");
  });

  it("bookmark linked IDs non list raises", async () => {
    // python: test_bookmark_linked_ids_non_list_raises
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: { id: 1 } },
    }));
    const err: unknown = await client
      .bookmarkLinkedDashboardIds(42)
      .catch((error: unknown) => error);
    expect(err).toBeInstanceOf(MixpanelHeadlessError);
    expect((err as Error).message).toContain("expected list");
  });
});

describe("Duplicate bookmark dashboard methods", () => {
  // python: TestDuplicateBookmarkDashboardMethods
  it("get bookmark dashboard IDs path", async () => {
    // python: test_get_bookmark_dashboard_ids_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [1] } };
    });
    await client.getBookmarkDashboardIds(42);
    expect(capturedUrls[0]).toContain("/dashboards/bookmarks/42/dashboard-ids");
  });

  it("bookmark linked dashboard IDs path", async () => {
    // python: test_bookmark_linked_dashboard_ids_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [1] } };
    });
    await client.bookmarkLinkedDashboardIds(42);
    expect(capturedUrls[0]).toContain("/bookmarks/42/linked-dashboard-ids");
  });

  it("both return list of ints", async () => {
    // python: test_both_return_list_of_ints
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: [1, 2, 3] },
    }));
    const resultA = toNativeJson(await client.getBookmarkDashboardIds(42));
    const resultB = toNativeJson(await client.bookmarkLinkedDashboardIds(42));
    expect(resultA).toStrictEqual([1, 2, 3]);
    expect(resultB).toStrictEqual([1, 2, 3]);
  });

  it("both handle empty results", async () => {
    // python: test_both_handle_empty_results
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: [] },
    }));
    const resultA = await client.getBookmarkDashboardIds(42);
    const resultB = await client.bookmarkLinkedDashboardIds(42);
    expect(resultA).toStrictEqual([]);
    expect(resultB).toStrictEqual([]);
  });
});

describe("Void operation responses", () => {
  // python: TestVoidOperationResponses
  it("delete dashboard 204", async () => {
    // python: test_delete_dashboard_204
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 204,
    }));
    await expect(client.deleteDashboard(1)).resolves.toBeUndefined();
  });

  it("favorite dashboard 204", async () => {
    // python: test_favorite_dashboard_204
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 204,
    }));
    await expect(client.favoriteDashboard(1)).resolves.toBeUndefined();
  });

  it("bulk delete dashboards 204", async () => {
    // python: test_bulk_delete_dashboards_204
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 204,
    }));
    await expect(
      client.bulkDeleteDashboards([1, 2, 3]),
    ).resolves.toBeUndefined();
  });
});

describe("Error propagation", () => {
  // python: TestErrorPropagation
  it("list dashboards 401", async () => {
    // python: test_list_dashboards_401
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 401,
      json: { error: "Unauthorized" },
    }));
    await expect(client.listDashboards()).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });

  it("create bookmark 400", async () => {
    // python: test_create_bookmark_400
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 400,
      json: { error: "Invalid bookmark type" },
    }));
    await expect(
      client.createBookmark({ name: "Bad", type: "invalid" }),
    ).rejects.toBeInstanceOf(QueryError);
  });

  it("get cohort 404", async () => {
    // python: test_get_cohort_404
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 404,
      json: { error: "Not found" },
    }));
    await expect(client.getCohort(999999)).rejects.toBeInstanceOf(QueryError);
  });
});

describe("Workspace scoped paths", () => {
  // python: TestWorkspaceScopedPaths
  it("list dashboards project scoped", async () => {
    // python: test_list_dashboards_project_scoped
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listDashboards();
    expect(capturedUrls[0]).toContain("/projects/12345/dashboards");
  });

  it("list dashboards workspace scoped", async () => {
    // python: test_list_dashboards_workspace_scoped
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    client.setWorkspaceId(789);
    await client.listDashboards();
    expect(capturedUrls[0]).toContain("/workspaces/789/dashboards");
  });

  it("list bookmarks V2 project scoped", async () => {
    // python: test_list_bookmarks_v2_project_scoped
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listBookmarksV2();
    expect(capturedUrls[0]).toContain("/projects/12345/bookmarks");
  });

  it("list cohorts app project scoped", async () => {
    // python: test_list_cohorts_app_project_scoped
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listCohortsApp();
    expect(capturedUrls[0]).toContain("/projects/12345/cohorts");
  });
});
