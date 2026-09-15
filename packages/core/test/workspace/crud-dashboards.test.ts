// B6-W2 Layer-3 translation (packet `b6-packets.md` §4) of the
// dashboard classes of `tests/unit/test_workspace_crud.py` (1,861
// lines): `TestWorkspaceDashboardCRUD`,
// `TestWorkspaceBlueprintCohorts`,
// `TestRemoveReportFromDashboard` and
// `TestAddReportToDashboard`. The bookmark/cohort classes of
// the same file are W3's (`crud-bookmarks-cohorts.test.ts`).
//
// Python's `httpx.MockTransport` handler becomes the injected-fetch
// `fakeTransport` seam; `_make_workspace(temp_dir, handler)`
// becomes `makeFacadeWorkspace(handler)` — the client is built over the
// OAuth session (`_make_oauth_credentials`, :67) while the facade
// carries the service-account `_TEST_SESSION`, exactly as
// Python does. `temp_dir` has no TS analog (no config file is ever
// touched) and is dropped.
//
// ADDITIVE sections (clearly headed, never substituting for a
// translated Python assertion — B5 Caution #13 / packet §1): the 10
// zero-vector members (`favorite_dashboard`, `unfavorite_dashboard`,
// `pin_dashboard`, `unpin_dashboard`, `list_blueprint_templates`,
// `create_blueprint`, `get_blueprint_config`,
// `get_bookmark_dashboard_ids`, `get_dashboard_erf`,
// `update_text_card`) get delegation-contract tests, and the
// `by_alias` request-body shapes plus the unreachable-through-the-wire
// empty-response guards get direct member-function tests. The
// `TestRequestBodySerialization`
// class that also covers `finalize_blueprint` /
// `create_rca_dashboard` / `update_report_link` is W3's WHOLE-file
// translation; the additive coverage here is the W2-local lock that
// lands with the code (overlap recorded in `B6-W2-notes.md`).

import { describe, expect, it } from "vitest";

import type { MixpanelClient } from "../../src/client/client.js";
import {
  MixpanelHeadlessError,
  ResponseValidationError,
} from "../../src/errors.js";
import {
  BlueprintCard,
  BlueprintConfig,
  BlueprintFinishParams,
  BlueprintTemplate,
  CreateDashboardParams,
  CreateRcaDashboardParams,
  Dashboard,
  RcaSourceData,
  UpdateDashboardParams,
  UpdateReportLinkParams,
  UpdateTextCardParams,
} from "../../src/types/entities/dashboards.js";
import {
  createBlueprint as createBlueprintMember,
  createDashboard as createDashboardMember,
  createRcaDashboard as createRcaDashboardMember,
  finalizeBlueprint as finalizeBlueprintMember,
  getBlueprintConfig as getBlueprintConfigMember,
  getDashboard as getDashboardMember,
  updateDashboard as updateDashboardMember,
} from "../../src/workspace-members/dashboards.js";
import {
  type FakeTransport,
  ok,
} from "../../test-support/client-test-helpers.js";
import { makeFacadeWorkspace } from "../../test-support/workspace-test-helpers.js";

/**
 * A minimal dashboard dict matching the API shape (`_dashboard_json`,
 * :105-135).
 *
 * @param id - Dashboard ID.
 * @param title - Dashboard title.
 * @returns The payload record.
 */
function dashboardJson(
  id = 1,
  title = "Test Dashboard",
): Record<string, unknown> {
  return {
    id,
    title,
    is_private: false,
    is_restricted: false,
    is_favorited: false,
    can_update_basic: true,
    can_share: true,
    can_view: true,
    can_update_restricted: false,
    can_update_visibility: false,
    is_superadmin: false,
    allow_staff_override: false,
    can_pin: true,
    is_shared_with_project: true,
    ancestors: [],
  };
}

/**
 * The `${METHOD} ${pathname}` capture spelling used in assertions.
 *
 * @param transport - The capture log.
 * @returns One entry per request, in order.
 */
function seenOf(transport: FakeTransport): string[] {
  return transport.captures.map(
    (capture) => `${capture.method} ${new URL(capture.url).pathname}`,
  );
}

/**
 * Parse a captured request body as JSON.
 *
 * @param transport - The capture log.
 * @param index - Which capture to read (default 0).
 * @returns The decoded body.
 */
function bodyOf(transport: FakeTransport, index = 0): unknown {
  return JSON.parse(transport.captures[index]?.bodyText ?? "null");
}

/**
 * A client stub whose single member resolves to `value` — the seam the
 * facade's `raw is None` guards need (the real client raises first, so
 * the branch is unreachable through the wire; see `B6-W2-notes.md`).
 *
 * @param member - The client method name to stub.
 * @param value - The value it resolves to.
 * @returns The stub cast to the client type.
 */
function nullClient(member: string, value: unknown): MixpanelClient {
  return {
    [member]: () => Promise.resolve(value),
  } as unknown as MixpanelClient;
}

// ===========================================================================
// TestWorkspaceDashboardCRUD
// ===========================================================================

describe("Workspace dashboard CRUD", () => {
  // python: TestWorkspaceDashboardCRUD
  it("list_dashboards() returns list of Dashboard objects", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok([dashboardJson(1, "Dash A"), dashboardJson(2, "Dash B")]),
    );

    const dashboards = await ws.listDashboards();

    expect(dashboards).toHaveLength(2);
    expect(dashboards[0]).toBeInstanceOf(Dashboard);
    expect(dashboards[0]?.id).toBe(1);
    expect(dashboards[0]?.title).toBe("Dash A");
    expect(dashboards[1]?.id).toBe(2);
    expect(dashboards[1]?.title).toBe("Dash B");
  });

  it("list_dashboards() returns empty list when no dashboards exist", async () => {
    const { ws } = makeFacadeWorkspace(() => ok([]));

    await expect(ws.listDashboards()).resolves.toStrictEqual([]);
  });

  it("list_dashboards(ids=[1, 2]) passes filter to API", async () => {
    const { ws, transport } = makeFacadeWorkspace(() =>
      ok([dashboardJson(1, "Dash A"), dashboardJson(2, "Dash B")]),
    );

    const dashboards = await ws.listDashboards({ ids: [1, 2] });

    expect(dashboards).toHaveLength(2);
    expect(dashboards[0]).toBeInstanceOf(Dashboard);
    expect(transport.captures[0]?.params["ids"]).toBe("1,2");
  });

  it("create_dashboard() returns the created Dashboard", async () => {
    const { ws, transport } = makeFacadeWorkspace(() =>
      ok(dashboardJson(10, "New Dashboard")),
    );

    const dashboard = await ws.createDashboard(
      new CreateDashboardParams({ title: "New Dashboard" }),
    );

    expect(dashboard).toBeInstanceOf(Dashboard);
    expect(dashboard.id).toBe(10);
    expect(dashboard.title).toBe("New Dashboard");
    // `model_dump(exclude_none=True)`.
    expect(bodyOf(transport)).toStrictEqual({ title: "New Dashboard" });
  });

  it("create_dashboard() sends description when provided", async () => {
    const { ws, transport } = makeFacadeWorkspace(() =>
      ok({
        ...dashboardJson(11, "Described"),
        description: "A test dashboard",
      }),
    );

    const dashboard = await ws.createDashboard(
      new CreateDashboardParams({
        title: "Described",
        description: "A test dashboard",
      }),
    );

    expect(dashboard.description).toBe("A test dashboard");
    expect(bodyOf(transport)).toStrictEqual({
      title: "Described",
      description: "A test dashboard",
    });
  });

  it("create_dashboard() can create a private dashboard", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok({ ...dashboardJson(12, "Private"), is_private: true }),
    );

    const dashboard = await ws.createDashboard(
      new CreateDashboardParams({ title: "Private", is_private: true }),
    );

    expect(dashboard.is_private).toBe(true);
  });

  it("get_dashboard() returns a single Dashboard by ID", async () => {
    const { ws, transport } = makeFacadeWorkspace(() =>
      ok(dashboardJson(1, "My Dashboard")),
    );

    const dashboard = await ws.getDashboard(1);

    expect(dashboard).toBeInstanceOf(Dashboard);
    expect(dashboard.id).toBe(1);
    expect(dashboard.title).toBe("My Dashboard");
    expect(seenOf(transport)).toStrictEqual([
      "GET /api/app/projects/12345/dashboards/1",
    ]);
  });

  it("get_dashboard() preserves extra fields from the API", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok({
        ...dashboardJson(5, "Detailed"),
        description: "Full details",
        creator_name: "Alice",
      }),
    );

    const dashboard = await ws.getDashboard(5);

    expect(dashboard.description).toBe("Full details");
    expect(dashboard.creator_name).toBe("Alice");
  });

  it("update_dashboard() returns the updated Dashboard", async () => {
    const { ws, transport } = makeFacadeWorkspace(() =>
      ok(dashboardJson(1, "Updated Title")),
    );

    const dashboard = await ws.updateDashboard(
      1,
      new UpdateDashboardParams({ title: "Updated Title" }),
    );

    expect(dashboard).toBeInstanceOf(Dashboard);
    expect(dashboard.title).toBe("Updated Title");
    expect(seenOf(transport)).toStrictEqual([
      "PATCH /api/app/projects/12345/dashboards/1",
    ]);
    expect(bodyOf(transport)).toStrictEqual({ title: "Updated Title" });
  });

  it("update_dashboard() can update description", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok({ ...dashboardJson(1, "Same Title"), description: "New description" }),
    );

    const dashboard = await ws.updateDashboard(
      1,
      new UpdateDashboardParams({ description: "New description" }),
    );

    expect(dashboard.description).toBe("New description");
  });

  it("update_dashboard() can toggle privacy", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok({ ...dashboardJson(1, "Toggle"), is_private: true }),
    );

    const dashboard = await ws.updateDashboard(
      1,
      new UpdateDashboardParams({ is_private: true }),
    );

    expect(dashboard.is_private).toBe(true);
  });

  it("delete_dashboard() returns None on success (204)", async () => {
    const { ws, transport } = makeFacadeWorkspace(() => ({ status: 204 }));

    await expect(ws.deleteDashboard(1)).resolves.toBeUndefined();
    expect(seenOf(transport)).toStrictEqual([
      "DELETE /api/app/projects/12345/dashboards/1",
    ]);
  });

  it("delete_dashboard() handles 200 response too", async () => {
    const { ws } = makeFacadeWorkspace(() => ok({}));

    await expect(ws.deleteDashboard(1)).resolves.toBeUndefined();
  });

  it("bulk_delete_dashboards() returns None on success", async () => {
    const { ws, transport } = makeFacadeWorkspace(() => ({ status: 204 }));

    await expect(ws.bulkDeleteDashboards([1, 2])).resolves.toBeUndefined();
    expect(seenOf(transport)).toStrictEqual([
      "POST /api/app/projects/12345/dashboards/bulk-delete",
    ]);
  });

  it("bulk_delete_dashboards() works with a single ID", async () => {
    const { ws } = makeFacadeWorkspace(() => ({ status: 204 }));

    await expect(ws.bulkDeleteDashboards([42])).resolves.toBeUndefined();
  });

  it("list_dashboards() preserves the API response order", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok([
        dashboardJson(3, "Third"),
        dashboardJson(1, "First"),
        dashboardJson(2, "Second"),
      ]),
    );

    const dashboards = await ws.listDashboards();

    expect(dashboards.map((d) => d.id)).toStrictEqual([3, 1, 2]);
  });

  it("create_dashboard() supports duplicate parameter", async () => {
    const { ws, transport } = makeFacadeWorkspace(() =>
      ok(dashboardJson(20, "Copy of Dash")),
    );

    const dashboard = await ws.createDashboard(
      new CreateDashboardParams({ title: "Copy of Dash", duplicate: 5 }),
    );

    expect(dashboard.id).toBe(20);
    expect(bodyOf(transport)).toStrictEqual({
      title: "Copy of Dash",
      duplicate: 5,
    });
  });

  it("get_dashboard() result has correct boolean field types", async () => {
    const { ws } = makeFacadeWorkspace(() => ok(dashboardJson(1, "Booleans")));

    const dashboard = await ws.getDashboard(1);

    expect(typeof dashboard.is_private).toBe("boolean");
    expect(typeof dashboard.is_restricted).toBe("boolean");
    expect(typeof dashboard.can_update_basic).toBe("boolean");
    expect(typeof dashboard.can_share).toBe("boolean");
    expect(typeof dashboard.can_view).toBe("boolean");
  });

  it("bulk_delete_dashboards() sends multiple IDs", async () => {
    const { ws, transport } = makeFacadeWorkspace(() => ({ status: 204 }));

    await ws.bulkDeleteDashboards([10, 20, 30]);

    expect(transport.captures).toHaveLength(1);
    expect(bodyOf(transport)).toStrictEqual({ dashboard_ids: [10, 20, 30] });
  });
});

// ===========================================================================
// TestWorkspaceBlueprintCohorts
// ===========================================================================

describe("Workspace blueprint cohorts", () => {
  // python: TestWorkspaceBlueprintCohorts
  it("update_blueprint_cohorts() delegates to API client", async () => {
    const { ws, transport } = makeFacadeWorkspace(() => ({ status: 204 }));

    await ws.updateBlueprintCohorts([
      { placeholder: "new_users", cohort_id: 42 },
    ]);

    expect(bodyOf(transport)).toStrictEqual({
      cohorts: [{ placeholder: "new_users", cohort_id: 42 }],
    });
  });
});

// ===========================================================================
// TestRemoveReportFromDashboard
// ===========================================================================

describe("Remove report from dashboard", () => {
  // python: TestRemoveReportFromDashboard
  it("remove_report_from_dashboard() sends PATCH and returns updated dashboard", async () => {
    const { ws, transport } = makeFacadeWorkspace(() =>
      ok({ id: 1, title: "Updated Dashboard" }),
    );

    const result = await ws.removeReportFromDashboard(1, 42);

    expect(result).toBeInstanceOf(Dashboard);
    expect(result.title).toBe("Updated Dashboard");
    expect(transport.captures).toHaveLength(1); // Single PATCH request
    expect(bodyOf(transport)).toStrictEqual({
      content: { action: "delete", content_type: "report", content_id: 42 },
    });
  });
});

// ===========================================================================
// TestAddReportToDashboard
// ===========================================================================

describe("Add report to dashboard", () => {
  // python: TestAddReportToDashboard
  it("add_report_to_dashboard() sends PATCH and returns updated dashboard", async () => {
    const { ws, transport } = makeFacadeWorkspace(() =>
      ok({ id: 1, title: "Updated Dashboard" }),
    );

    const result = await ws.addReportToDashboard(1, 42);

    expect(result).toBeInstanceOf(Dashboard);
    expect(result.title).toBe("Updated Dashboard");
    expect(transport.captures).toHaveLength(1); // Single PATCH request
    expect(bodyOf(transport)).toStrictEqual({
      content: {
        action: "create",
        content_type: "report",
        content_params: { source_bookmark_id: 42 },
      },
    });
  });

  it("add_report_to_dashboard() raises for a non-dashboard response", async () => {
    // 204 → the client's `{status: "ok"}` envelope, which carries no
    // `id`, so the FACADE guard fires.
    const { ws } = makeFacadeWorkspace(() => ({ status: 204 }));

    await expect(ws.addReportToDashboard(1, 42)).rejects.toMatchObject({
      name: "MixpanelHeadlessError",
      code: "UNKNOWN_ERROR",
      message: expect.stringContaining("Unexpected response") as unknown,
    });
  });

  it("add_report_to_dashboard() raises when the response dict lacks 'id'", async () => {
    const { ws } = makeFacadeWorkspace(() => ok({ title: "No ID Dashboard" }));

    await expect(ws.addReportToDashboard(1, 42)).rejects.toMatchObject({
      name: "MixpanelHeadlessError",
      code: "UNKNOWN_ERROR",
      message: expect.stringContaining("Unexpected response") as unknown,
    });
  });
});

// ===========================================================================
// ADDITIVE (packet §1 / B5 Caution #13) — delegation contracts for the
// 10 zero-vector members. These do NOT substitute for a translated
// Python assertion; no Python test exercises these members.
// ===========================================================================

describe("ADDITIVE: zero-vector dashboard members (delegation contract)", () => {
  it("favorite_dashboard() POSTs the favorites path and returns undefined", async () => {
    const { ws, transport } = makeFacadeWorkspace(() => ({ status: 204 }));

    await expect(ws.favoriteDashboard(7)).resolves.toBeUndefined();
    expect(seenOf(transport)).toStrictEqual([
      "POST /api/app/projects/12345/dashboards/7/favorites",
    ]);
  });

  it("unfavorite_dashboard() DELETEs the favorites path", async () => {
    const { ws, transport } = makeFacadeWorkspace(() => ({ status: 204 }));

    await expect(ws.unfavoriteDashboard(7)).resolves.toBeUndefined();
    expect(seenOf(transport)).toStrictEqual([
      "DELETE /api/app/projects/12345/dashboards/7/favorites",
    ]);
  });

  it("pin_dashboard() POSTs the pin path", async () => {
    const { ws, transport } = makeFacadeWorkspace(() => ({ status: 204 }));

    await expect(ws.pinDashboard(7)).resolves.toBeUndefined();
    expect(seenOf(transport)).toStrictEqual([
      "POST /api/app/projects/12345/dashboards/7/pin",
    ]);
  });

  it("unpin_dashboard() DELETEs the pin path", async () => {
    const { ws, transport } = makeFacadeWorkspace(() => ({ status: 204 }));

    await expect(ws.unpinDashboard(7)).resolves.toBeUndefined();
    expect(seenOf(transport)).toStrictEqual([
      "DELETE /api/app/projects/12345/dashboards/7/pin",
    ]);
  });

  it("list_blueprint_templates() flattens the templates envelope into models", async () => {
    const { ws, transport } = makeFacadeWorkspace(() =>
      ok({
        templates: {
          company_kpis: {
            title_key: "company_kpis.title",
            description_key: "company_kpis.description",
            number_of_reports: 4,
          },
        },
      }),
    );

    const templates = await ws.listBlueprintTemplates();

    expect(templates).toHaveLength(1);
    expect(templates[0]).toBeInstanceOf(BlueprintTemplate);
    expect(templates[0]?.title_key).toBe("company_kpis.title");
    expect(templates[0]?.number_of_reports).toBe(4);
    // The client merges the envelope key in as `name`; `extra='allow'`
    // keeps it (`api_client.py`).
    expect(templates[0]?.__extras["name"]).toBe("company_kpis");
    // Python default `include_reports=False` sends no query param
    // (`api_client.py`).
    expect(transport.captures[0]?.params["include_reports"]).toBeUndefined();
  });

  it("list_blueprint_templates(include_reports=True) forwards the flag", async () => {
    const { ws, transport } = makeFacadeWorkspace(() => ok({ templates: {} }));

    await expect(
      ws.listBlueprintTemplates({ include_reports: true }),
    ).resolves.toStrictEqual([]);
    expect(transport.captures[0]?.params["include_reports"]).toBe("true");
  });

  it("create_blueprint() POSTs the template type and returns a Dashboard", async () => {
    const { ws, transport } = makeFacadeWorkspace(() =>
      ok(dashboardJson(31, "From blueprint")),
    );

    const dashboard = await ws.createBlueprint("company_kpis");

    expect(dashboard).toBeInstanceOf(Dashboard);
    expect(dashboard.id).toBe(31);
    expect(seenOf(transport)).toStrictEqual([
      "POST /api/app/projects/12345/dashboards/blueprints",
    ]);
    expect(bodyOf(transport)).toStrictEqual({ template_type: "company_kpis" });
  });

  it("get_blueprint_config() returns a BlueprintConfig", async () => {
    const { ws, transport } = makeFacadeWorkspace(() =>
      ok({ variables: { metric: "signups" } }),
    );

    const config = await ws.getBlueprintConfig(12345);

    expect(config).toBeInstanceOf(BlueprintConfig);
    expect(config.variables).toStrictEqual({ metric: "signups" });
    expect(seenOf(transport)).toStrictEqual([
      "GET /api/app/projects/12345/dashboards/12345/blueprint-config",
    ]);
  });

  it("get_bookmark_dashboard_ids() returns the ID list verbatim", async () => {
    const { ws, transport } = makeFacadeWorkspace(() => ok([4, 5, 6]));

    await expect(ws.getBookmarkDashboardIds(42)).resolves.toStrictEqual([
      4, 5, 6,
    ]);
    expect(seenOf(transport)).toStrictEqual([
      "GET /api/app/projects/12345/dashboards/bookmarks/42/dashboard-ids",
    ]);
  });

  it("get_dashboard_erf() returns the ERF dict verbatim", async () => {
    const { ws, transport } = makeFacadeWorkspace(() =>
      ok({ metrics: { views: 3 } }),
    );

    await expect(ws.getDashboardErf(12345)).resolves.toStrictEqual({
      metrics: { views: 3 },
    });
    expect(seenOf(transport)).toStrictEqual([
      "GET /api/app/projects/12345/dashboards/12345/erf",
    ]);
  });

  it("update_text_card() PATCHes the exclude-none body", async () => {
    const { ws, transport } = makeFacadeWorkspace(() => ({ status: 204 }));

    await expect(
      ws.updateTextCard(
        12345,
        99,
        new UpdateTextCardParams({ markdown: "# Hello" }),
      ),
    ).resolves.toBeUndefined();
    expect(seenOf(transport)).toStrictEqual([
      "PATCH /api/app/projects/12345/dashboards/12345/text-cards/99",
    ]);
    expect(bodyOf(transport)).toStrictEqual({ markdown: "# Hello" });
    // `exclude_none=True` — an unset `markdown` sends `{}`.
    const empty = makeFacadeWorkspace(() => ({ status: 204 }));
    await empty.ws.updateTextCard(1, 2, new UpdateTextCardParams({}));
    expect(bodyOf(empty.transport)).toStrictEqual({});
  });
});

// ===========================================================================
// ADDITIVE — `by_alias=True` request bodies (`workspace.py:4985`, `:5022`,
// `:5109`). `test_workspace_crud_edge.py::TestRequestBodySerialization`
// is W3's WHOLE-file translation; this is the W2-local lock.
// ===========================================================================

describe("ADDITIVE: by_alias request bodies", () => {
  it("finalize_blueprint() serializes card_type as 'type' (nested)", async () => {
    const { ws, transport } = makeFacadeWorkspace(() =>
      ok(dashboardJson(1, "X")),
    );

    const dashboard = await ws.finalizeBlueprint(
      new BlueprintFinishParams({
        dashboard_id: 1,
        cards: [new BlueprintCard({ card_type: "report", bookmark_id: 42 })],
      }),
    );

    expect(dashboard).toBeInstanceOf(Dashboard);
    expect(seenOf(transport)).toStrictEqual([
      "POST /api/app/projects/12345/dashboards/blueprints/finish",
    ]);
    expect(bodyOf(transport)).toStrictEqual({
      dashboard_id: 1,
      cards: [{ type: "report", bookmark_id: 42 }],
    });
  });

  it("create_rca_dashboard() serializes source_type as 'type'", async () => {
    const { ws, transport } = makeFacadeWorkspace(() =>
      ok(dashboardJson(1, "RCA")),
    );

    const dashboard = await ws.createRcaDashboard(
      new CreateRcaDashboardParams({
        rca_source_id: 42,
        rca_source_data: new RcaSourceData({ source_type: "anomaly" }),
      }),
    );

    expect(dashboard).toBeInstanceOf(Dashboard);
    expect(seenOf(transport)).toStrictEqual([
      "POST /api/app/projects/12345/dashboards/rca",
    ]);
    expect(bodyOf(transport)).toStrictEqual({
      rca_source_id: 42,
      rca_source_data: { type: "anomaly" },
    });
  });

  it("update_report_link() serializes link_type as 'type'", async () => {
    const { ws, transport } = makeFacadeWorkspace(() => ({ status: 204 }));

    await expect(
      ws.updateReportLink(
        1,
        42,
        new UpdateReportLinkParams({ link_type: "embedded" }),
      ),
    ).resolves.toBeUndefined();
    expect(seenOf(transport)).toStrictEqual([
      "PATCH /api/app/projects/12345/dashboards/1/report-links/42",
    ]);
    expect(bodyOf(transport)).toStrictEqual({ type: "embedded" });
  });
});

// ===========================================================================
// ADDITIVE — the facade's `raw is None` guards (`workspace.py`,
// `:4596`, `:4629`, `:4897`, `:4928`, `:4983`, `:5020`). The real client
// raises `MixpanelHeadlessError` for a non-dict envelope BEFORE the
// facade sees `None`, so these branches are unreachable through the
// wire in Python too — they are ported defensively and locked here at
// the member-function seam.
// ===========================================================================

describe("ADDITIVE: empty-response guards (member seam)", () => {
  const cases: ReadonlyArray<[string, string, () => Promise<unknown>]> = [
    [
      "create_dashboard",
      "createDashboard",
      () =>
        createDashboardMember(
          nullClient("createDashboard", null),
          new CreateDashboardParams({ title: "X" }),
        ),
    ],
    [
      "get_dashboard",
      "getDashboard",
      () => getDashboardMember(nullClient("getDashboard", null), 1),
    ],
    [
      "update_dashboard",
      "updateDashboard",
      () =>
        updateDashboardMember(
          nullClient("updateDashboard", null),
          1,
          new UpdateDashboardParams({ title: "X" }),
        ),
    ],
    [
      "create_blueprint",
      "createBlueprint",
      () => createBlueprintMember(nullClient("createBlueprint", null), "kpis"),
    ],
    [
      "get_blueprint_config",
      "getBlueprintConfig",
      () => getBlueprintConfigMember(nullClient("getBlueprintConfig", null), 1),
    ],
    [
      "finalize_blueprint",
      "finalizeBlueprint",
      () =>
        finalizeBlueprintMember(
          nullClient("finalizeBlueprint", null),
          new BlueprintFinishParams({ dashboard_id: 1, cards: [] }),
        ),
    ],
    [
      "create_rca_dashboard",
      "createRcaDashboard",
      () =>
        createRcaDashboardMember(
          nullClient("createRcaDashboard", null),
          new CreateRcaDashboardParams({
            rca_source_id: 1,
            rca_source_data: new RcaSourceData({ source_type: "anomaly" }),
          }),
        ),
    ],
  ];

  it.each(cases)(
    "%s raises MixpanelHeadlessError(UNKNOWN_ERROR) on an empty response",
    async (pythonName, _member, call) => {
      await expect(call()).rejects.toMatchObject({
        name: "MixpanelHeadlessError",
        code: "UNKNOWN_ERROR",
        message: `API returned empty response for ${pythonName}`,
      });
    },
  );
});

// ===========================================================================
// ADDITIVE — response-validation codes (`RESPONSE_VALIDATION_ERROR`),
// the corpus-locked branch of `list_dashboards` / `create_dashboard`.
// ===========================================================================

describe("ADDITIVE: response-validation codes", () => {
  it("list_dashboards() raises a coded ResponseValidationError for an invalid item", async () => {
    const { ws } = makeFacadeWorkspace(() => ok([{}]));

    await expect(ws.listDashboards()).rejects.toMatchObject({
      name: "ResponseValidationError",
      code: "RESPONSE_VALIDATION_ERROR",
      details: { model: "Dashboard" },
    });
  });

  it("create_dashboard() raises for an empty `{}` results payload", async () => {
    const { ws } = makeFacadeWorkspace(() => ok({}));

    const error = await ws
      .createDashboard(new CreateDashboardParams({ title: "X" }))
      .then(
        () => null,
        (error_: unknown) => error_,
      );

    expect(error).toBeInstanceOf(ResponseValidationError);
    expect((error as ResponseValidationError).details["errors"]).toStrictEqual([
      { type: "missing", loc: ["id"], msg: "Field required", input: {} },
      { type: "missing", loc: ["title"], msg: "Field required", input: {} },
    ]);
  });

  it("the guards keep MixpanelHeadlessError distinct from validation errors", () => {
    expect(new MixpanelHeadlessError("x").code).toBe("UNKNOWN_ERROR");
  });
});
