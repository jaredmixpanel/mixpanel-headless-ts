// Layer-3 translation — Phase-3 packet B4-C3 entity-CRUD locks.
// Source: tests/unit/test_api_client_crud.py (ALL classes —
// dashboards/blueprints/RCA/advanced, bookmarks v2, cohorts App API).
//
// The Python fixture builds an oauth_token session
// (make_session(project_id="12345", region="us",
// oauth_token="test-oauth-token")); `with client:` context blocks are
// plain awaits here (the TS client needs no enter/exit around calls).
import { describe, expect, it } from "vitest";

import type { Session } from "../../src/auth/session.js";
import { toNativeJson } from "../../src/client/json-value.js";
import {
  createMockClient,
  makeSession,
  parseBody,
} from "../../test-support/client-test-helpers.js";

/** The `oauth_credentials` fixture twin. */
function oauthCredentials(): Session {
  return makeSession({
    projectId: "12345",
    region: "us",
    oauthToken: "test-oauth-token",
  });
}

describe("List dashboards", () => {
  // python: TestListDashboards
  it("returns dashboard list", async () => {
    // python: test_returns_dashboard_list
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: [
          { id: 1, title: "Dashboard 1" },
          { id: 2, title: "Dashboard 2" },
        ],
      },
    }));
    const result = toNativeJson(await client.listDashboards()) as Array<
      Record<string, unknown>
    >;
    expect(result).toHaveLength(2);
    expect(result[0]?.["id"]).toBe(1);
    expect(result[1]?.["title"]).toBe("Dashboard 2");
  });

  it("filters by IDs", async () => {
    // python: test_filters_by_ids
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listDashboards({ ids: [1, 2] });
    const url = capturedUrls[0] ?? "";
    expect(url.includes("ids=1%2C2") || url.includes("ids=1,2")).toBe(true);
  });

  it("uses maybe scoped path", async () => {
    // python: test_uses_maybe_scoped_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listDashboards();
    expect(capturedUrls[0]).toContain("/projects/12345/dashboards");
  });

  it("empty result", async () => {
    // python: test_empty_result
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: [] },
    }));
    const result = await client.listDashboards();
    expect(result).toStrictEqual([]);
  });
});

describe("Create dashboard", () => {
  // python: TestCreateDashboard
  it("creates dashboard", async () => {
    // python: test_creates_dashboard
    const captured: Array<[string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, parseBody(request.bodyText)]);
      return {
        status: 200,
        json: { status: "ok", results: { id: 1, title: "New" } },
      };
    });
    const result = toNativeJson(
      await client.createDashboard({ title: "New" }),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("POST");
    expect(captured[0]?.[1]).toStrictEqual({ title: "New" });
    expect(result["id"]).toBe(1);
  });
});

describe("Get dashboard", () => {
  // python: TestGetDashboard
  it("gets dashboard by ID", async () => {
    // python: test_gets_dashboard_by_id
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { status: "ok", results: { id: 42, title: "Test" } },
      };
    });
    const result = toNativeJson(await client.getDashboard(42)) as Record<
      string,
      unknown
    >;
    expect(capturedUrls[0]).toContain("/dashboards/42");
    expect(result["id"]).toBe(42);
  });
});

describe("Update dashboard", () => {
  // python: TestUpdateDashboard
  it("updates dashboard", async () => {
    // python: test_updates_dashboard
    const captured: Array<[string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, parseBody(request.bodyText)]);
      return {
        status: 200,
        json: { status: "ok", results: { id: 1, title: "Updated" } },
      };
    });
    const result = toNativeJson(
      await client.updateDashboard(1, { title: "Updated" }),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("PATCH");
    expect(result["title"]).toBe("Updated");
  });
});

describe("Delete dashboard", () => {
  // python: TestDeleteDashboard
  it("deletes dashboard", async () => {
    // python: test_deletes_dashboard
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 204 };
    });
    await client.deleteDashboard(1);
    expect(capturedMethods[0]).toBe("DELETE");
  });
});

describe("Bulk delete dashboards", () => {
  // python: TestBulkDeleteDashboards
  it("bulk deletes dashboards", async () => {
    // python: test_bulk_deletes_dashboards
    const captured: Array<[string, string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, request.url, parseBody(request.bodyText)]);
      return { status: 204 };
    });
    await client.bulkDeleteDashboards([1, 2, 3]);
    expect(captured[0]?.[0]).toBe("POST");
    expect(captured[0]?.[1]).toContain("/dashboards/bulk-delete");
    expect(captured[0]?.[2]).toStrictEqual({ dashboard_ids: [1, 2, 3] });
  });
});

describe("Dashboard organization", () => {
  // python: TestDashboardOrganization
  it("favorite dashboard", async () => {
    // python: test_favorite_dashboard
    const captured: Array<[string, string]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, request.url]);
      return { status: 204 };
    });
    await client.favoriteDashboard(1);
    expect(captured[0]?.[0]).toBe("POST");
    expect(captured[0]?.[1]).toContain("/dashboards/1/favorites");
  });

  it("unfavorite dashboard", async () => {
    // python: test_unfavorite_dashboard
    const captured: Array<[string, string]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, request.url]);
      return { status: 204 };
    });
    await client.unfavoriteDashboard(1);
    expect(captured[0]?.[0]).toBe("DELETE");
    expect(captured[0]?.[1]).toContain("/dashboards/1/favorites");
  });

  it("pin dashboard", async () => {
    // python: test_pin_dashboard
    const captured: Array<[string, string]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, request.url]);
      return { status: 204 };
    });
    await client.pinDashboard(1);
    expect(captured[0]?.[0]).toBe("POST");
    expect(captured[0]?.[1]).toContain("/dashboards/1/pin");
  });

  it("unpin dashboard", async () => {
    // python: test_unpin_dashboard
    const captured: Array<[string, string]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, request.url]);
      return { status: 204 };
    });
    await client.unpinDashboard(1);
    expect(captured[0]?.[0]).toBe("DELETE");
    expect(captured[0]?.[1]).toContain("/dashboards/1/pin");
  });

  it("remove report from dashboard", async () => {
    // python: test_remove_report_from_dashboard
    const captured: Array<[string, string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, request.url, parseBody(request.bodyText)]);
      return {
        status: 200,
        json: { status: "ok", results: { id: 1, title: "Dash" } },
      };
    });
    const result = toNativeJson(
      await client.removeReportFromDashboard(1, 42),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("PATCH");
    expect(captured[0]?.[1]).toContain("/dashboards/1");
    expect(captured[0]?.[2]).toStrictEqual({
      content: {
        action: "delete",
        content_type: "report",
        content_id: 42,
      },
    });
    expect(result).not.toBeNull();
    expect(result["id"]).toBe(1);
  });

  it("add report to dashboard", async () => {
    // python: test_add_report_to_dashboard
    const captured: Array<[string, string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, request.url, parseBody(request.bodyText)]);
      return {
        status: 200,
        json: { status: "ok", results: { id: 1, title: "Dash" } },
      };
    });
    const result = toNativeJson(
      await client.addReportToDashboard(1, 42),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("PATCH");
    expect(captured[0]?.[1]).toContain("/dashboards/1");
    expect(captured[0]?.[2]).toStrictEqual({
      content: {
        action: "create",
        content_type: "report",
        content_params: { source_bookmark_id: 42 },
      },
    });
    expect(result).not.toBeNull();
    expect(result["id"]).toBe(1);
  });
});

describe("Blueprint operations", () => {
  // python: TestBlueprintOperations
  it("list blueprint templates", async () => {
    // python: test_list_blueprint_templates
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: [{ title_key: "onboarding", description_key: "Get started" }],
      },
    }));
    const result = toNativeJson(await client.listBlueprintTemplates()) as Array<
      Record<string, unknown>
    >;
    expect(result).toHaveLength(1);
    expect(result[0]?.["title_key"]).toBe("onboarding");
  });

  it("list blueprint templates with reports", async () => {
    // python: test_list_blueprint_templates_with_reports
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listBlueprintTemplates({ include_reports: true });
    expect(capturedUrls[0]).toContain("include_reports=true");
  });

  it("list blueprint templates dict of dicts", async () => {
    // python: test_list_blueprint_templates_dict_of_dicts
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: {
          templates: {
            onboarding: { title_key: "Get Started", reports: [] },
            marketing: { title_key: "Marketing KPIs" },
          },
        },
      },
    }));
    const result = toNativeJson(await client.listBlueprintTemplates()) as Array<
      Record<string, unknown>
    >;
    expect(result).toHaveLength(2);
    const names = new Set(result.map((t) => t["name"]));
    expect(names).toStrictEqual(new Set(["onboarding", "marketing"]));
    const onboarding = result.find((t) => t["name"] === "onboarding");
    expect(onboarding?.["title_key"]).toBe("Get Started");
  });

  it("update blueprint cohorts", async () => {
    // python: test_update_blueprint_cohorts
    const captured: unknown[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push(parseBody(request.bodyText));
      return { status: 204 };
    });
    await client.updateBlueprintCohorts([
      { placeholder: "new_users", cohort_id: 42 },
    ]);
    expect(captured[0]).toStrictEqual({
      cohorts: [{ placeholder: "new_users", cohort_id: 42 }],
    });
  });

  it("create blueprint", async () => {
    // python: test_create_blueprint
    const captured: unknown[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push(parseBody(request.bodyText));
      return {
        status: 200,
        json: { status: "ok", results: { id: 1, title: "Blueprint" } },
      };
    });
    const result = toNativeJson(
      await client.createBlueprint("onboarding"),
    ) as Record<string, unknown>;
    expect(captured[0]).toStrictEqual({ template_type: "onboarding" });
    expect(result["id"]).toBe(1);
  });

  it("get blueprint config", async () => {
    // python: test_get_blueprint_config
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: { variables: { event: "Signup" } } },
    }));
    const result = toNativeJson(await client.getBlueprintConfig(1)) as Record<
      string,
      Record<string, unknown>
    >;
    expect(result["variables"]?.["event"]).toBe("Signup");
  });

  it("finalize blueprint", async () => {
    // python: test_finalize_blueprint
    const captured: Array<Record<string, unknown>> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push(parseBody(request.bodyText) as Record<string, unknown>);
      return {
        status: 200,
        json: { status: "ok", results: { id: 1, title: "Finalized" } },
      };
    });
    const result = toNativeJson(
      await client.finalizeBlueprint({
        dashboard_id: 1,
        cards: [{ type: "report" }],
      }),
    ) as Record<string, unknown>;
    expect(captured[0]?.["dashboard_id"]).toBe(1);
    expect(result["title"]).toBe("Finalized");
  });
});

describe("Dashboard advanced", () => {
  // python: TestDashboardAdvanced
  it("create rca dashboard", async () => {
    // python: test_create_rca_dashboard
    const captured: Array<Record<string, unknown>> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push(parseBody(request.bodyText) as Record<string, unknown>);
      return {
        status: 200,
        json: { status: "ok", results: { id: 99, title: "RCA" } },
      };
    });
    const result = toNativeJson(
      await client.createRcaDashboard({
        rca_source_id: 42,
        rca_source_data: { type: "anomaly" },
      }),
    ) as Record<string, unknown>;
    expect(captured[0]?.["rca_source_id"]).toBe(42);
    expect(result["id"]).toBe(99);
  });

  it("get bookmark dashboard IDs", async () => {
    // python: test_get_bookmark_dashboard_ids
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: [1, 2, 3] },
    }));
    const result = toNativeJson(await client.getBookmarkDashboardIds(42));
    expect(result).toStrictEqual([1, 2, 3]);
  });

  it("get dashboard erf", async () => {
    // python: test_get_dashboard_erf
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: { metrics: [] } },
    }));
    const result = toNativeJson(await client.getDashboardErf(1)) as Record<
      string,
      unknown
    >;
    expect(Object.hasOwn(result, "metrics")).toBe(true);
  });

  it("update report link", async () => {
    // python: test_update_report_link
    const captured: Array<[string, string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, request.url, parseBody(request.bodyText)]);
      return { status: 204 };
    });
    await client.updateReportLink(1, 42, { type: "embedded" });
    expect(captured[0]?.[0]).toBe("PATCH");
    expect(captured[0]?.[1]).toContain("/dashboards/1/report-links/42");
    expect(captured[0]?.[2]).toStrictEqual({ type: "embedded" });
  });

  it("update text card", async () => {
    // python: test_update_text_card
    const captured: Array<[string, string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, request.url, parseBody(request.bodyText)]);
      return { status: 204 };
    });
    await client.updateTextCard(1, 99, { markdown: "# Hello" });
    expect(captured[0]?.[0]).toBe("PATCH");
    expect(captured[0]?.[1]).toContain("/dashboards/1/text-cards/99");
    expect(captured[0]?.[2]).toStrictEqual({ markdown: "# Hello" });
  });
});

describe("List bookmarks V2", () => {
  // python: TestListBookmarksV2
  it("returns bookmark list", async () => {
    // python: test_returns_bookmark_list
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: [
          { id: 1, name: "Report 1", type: "insights" },
          { id: 2, name: "Report 2", type: "funnels" },
        ],
      },
    }));
    const result = toNativeJson(await client.listBookmarksV2()) as Array<
      Record<string, unknown>
    >;
    expect(result).toHaveLength(2);
    expect(result[0]?.["name"]).toBe("Report 1");
  });

  it("filters by type", async () => {
    // python: test_filters_by_type
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listBookmarksV2({ bookmark_type: "funnels" });
    expect(capturedUrls[0]).toContain("type=funnels");
  });

  it("filters by IDs", async () => {
    // python: test_filters_by_ids
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listBookmarksV2({ ids: [10, 20] });
    expect(capturedUrls[0]).toContain("ids=");
  });
});

describe("Bookmark CRUD", () => {
  // python: TestBookmarkCRUD
  it("create bookmark", async () => {
    // python: test_create_bookmark
    const captured: Array<Record<string, unknown>> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push(parseBody(request.bodyText) as Record<string, unknown>);
      return {
        status: 200,
        json: {
          status: "ok",
          results: { id: 1, name: "New Report", type: "insights" },
        },
      };
    });
    const result = toNativeJson(
      await client.createBookmark({
        name: "New Report",
        type: "insights",
        params: {},
      }),
    ) as Record<string, unknown>;
    expect(result["id"]).toBe(1);
    expect(captured[0]?.["name"]).toBe("New Report");
  });

  it("get bookmark", async () => {
    // python: test_get_bookmark
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { status: "ok", results: { id: 42, name: "Test" } },
      };
    });
    const result = toNativeJson(await client.getBookmark(42)) as Record<
      string,
      unknown
    >;
    expect(capturedUrls[0]).toContain("/bookmarks/42");
    expect(result["id"]).toBe(42);
  });

  it("update bookmark", async () => {
    // python: test_update_bookmark
    const captured: Array<[string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, parseBody(request.bodyText)]);
      return {
        status: 200,
        json: { status: "ok", results: { id: 1, name: "Updated" } },
      };
    });
    const result = toNativeJson(
      await client.updateBookmark(1, { name: "Updated" }),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("PATCH");
    expect(result["name"]).toBe("Updated");
  });

  it("delete bookmark", async () => {
    // python: test_delete_bookmark
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 204 };
    });
    await client.deleteBookmark(1);
    expect(capturedMethods[0]).toBe("DELETE");
  });

  it("bulk delete bookmarks", async () => {
    // python: test_bulk_delete_bookmarks
    const captured: Array<[string, string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, request.url, parseBody(request.bodyText)]);
      return { status: 204 };
    });
    await client.bulkDeleteBookmarks([1, 2]);
    expect(captured[0]?.[0]).toBe("POST");
    expect(captured[0]?.[1]).toContain("/bookmarks/bulk-delete");
    expect(captured[0]?.[2]).toStrictEqual({ bookmark_ids: [1, 2] });
  });

  it("bulk update bookmarks", async () => {
    // python: test_bulk_update_bookmarks
    const captured: unknown[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push(parseBody(request.bodyText));
      return { status: 204 };
    });
    await client.bulkUpdateBookmarks([{ id: 1, name: "Renamed" }]);
    expect(captured[0]).toStrictEqual({
      bookmarks: [{ id: 1, name: "Renamed" }],
    });
  });

  it("bookmark linked dashboard IDs", async () => {
    // python: test_bookmark_linked_dashboard_ids
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: [10, 20, 30] },
    }));
    const result = toNativeJson(await client.bookmarkLinkedDashboardIds(1));
    expect(result).toStrictEqual([10, 20, 30]);
  });

  it("get bookmark history", async () => {
    // python: test_get_bookmark_history
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: {
          results: [{ action: "created" }],
          pagination: { page_size: 20 },
        },
      },
    }));
    const result = toNativeJson(await client.getBookmarkHistory(1)) as Record<
      string,
      unknown
    >;
    expect(Object.hasOwn(result, "results")).toBe(true);
  });

  it("get bookmark history with pagination", async () => {
    // python: test_get_bookmark_history_with_pagination
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: {
          status: "ok",
          results: { results: [], pagination: { page_size: 10 } },
        },
      };
    });
    await client.getBookmarkHistory(1, { cursor: "abc", page_size: 10 });
    expect(capturedUrls[0]).toContain("cursor=abc");
    expect(capturedUrls[0]).toContain("page_size=10");
  });

  it("get bookmark history preserves pagination", async () => {
    // python: test_get_bookmark_history_preserves_pagination
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: {
          results: [{ action: "created" }],
          pagination: {
            page_size: 10,
            next_cursor: "cursor_abc",
            previous_cursor: null,
          },
        },
      },
    }));
    const result = toNativeJson(await client.getBookmarkHistory(1)) as Record<
      string,
      unknown
    >;
    expect(result["pagination"]).not.toBeNull();
    const pagination = result["pagination"] as Record<string, unknown>;
    expect(pagination["next_cursor"]).toBe("cursor_abc");
    expect(pagination["page_size"]).toBe(10);
  });
});

describe("List cohorts app", () => {
  // python: TestListCohortsApp
  it("returns cohort list", async () => {
    // python: test_returns_cohort_list
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: [
          { id: 1, name: "Power Users" },
          { id: 2, name: "Churned" },
        ],
      },
    }));
    const result = toNativeJson(await client.listCohortsApp()) as Array<
      Record<string, unknown>
    >;
    expect(result).toHaveLength(2);
    expect(result[0]?.["name"]).toBe("Power Users");
  });

  it("filters by data group ID", async () => {
    // python: test_filters_by_data_group_id
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listCohortsApp({ data_group_id: "abc" });
    expect(capturedUrls[0]).toContain("data_group_id=abc");
  });

  it("filters by IDs", async () => {
    // python: test_filters_by_ids
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listCohortsApp({ ids: [1, 2] });
    expect(capturedUrls[0]).toContain("ids=");
  });
});

describe("Cohort CRUD", () => {
  // python: TestCohortCRUD
  it("get cohort", async () => {
    // python: test_get_cohort
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { status: "ok", results: { id: 42, name: "Test" } },
      };
    });
    const result = toNativeJson(await client.getCohort(42)) as Record<
      string,
      unknown
    >;
    expect(capturedUrls[0]).toContain("/cohorts/42");
    expect(result["id"]).toBe(42);
  });

  it("create cohort", async () => {
    // python: test_create_cohort
    const captured: Array<Record<string, unknown>> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push(parseBody(request.bodyText) as Record<string, unknown>);
      return {
        status: 200,
        json: { status: "ok", results: { id: 1, name: "New Cohort" } },
      };
    });
    const result = toNativeJson(
      await client.createCohort({ name: "New Cohort" }),
    ) as Record<string, unknown>;
    expect(result["id"]).toBe(1);
    expect(captured[0]?.["name"]).toBe("New Cohort");
  });

  it("update cohort", async () => {
    // python: test_update_cohort
    const captured: Array<[string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, parseBody(request.bodyText)]);
      return {
        status: 200,
        json: { status: "ok", results: { id: 1, name: "Updated" } },
      };
    });
    const result = toNativeJson(
      await client.updateCohort(1, { name: "Updated" }),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("PATCH");
    expect(result["name"]).toBe("Updated");
  });

  it("delete cohort", async () => {
    // python: test_delete_cohort
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 204 };
    });
    await client.deleteCohort(1);
    expect(capturedMethods[0]).toBe("DELETE");
  });

  it("bulk delete cohorts", async () => {
    // python: test_bulk_delete_cohorts
    const captured: Array<[string, string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, request.url, parseBody(request.bodyText)]);
      return { status: 204 };
    });
    await client.bulkDeleteCohorts([1, 2]);
    expect(captured[0]?.[0]).toBe("POST");
    expect(captured[0]?.[1]).toContain("/cohorts/bulk-delete");
    expect(captured[0]?.[2]).toStrictEqual({ cohort_ids: [1, 2] });
  });

  it("bulk update cohorts", async () => {
    // python: test_bulk_update_cohorts
    const captured: unknown[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push(parseBody(request.bodyText));
      return { status: 204 };
    });
    await client.bulkUpdateCohorts([{ id: 1, name: "Renamed" }]);
    expect(captured[0]).toStrictEqual({
      cohorts: [{ id: 1, name: "Renamed" }],
    });
  });
});
