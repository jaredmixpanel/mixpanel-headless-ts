// B6-W3 Layer-3 translation (packet `b6-packets.md` §5) of
// `tests/unit/test_workspace_crud_edge.py` — the WHOLE file:
// `TestRequestBodySerialization` (:92), `TestEmptyResponseHandling`
// (:247), `TestWorkspaceMethodDelegation` (:298) and
// `TestCodedResponseValidationCodes` (:416).
//
// This is one of the two CROSS-ENTITY suites W3 owns (the reason the
// packet sequences W3 last): its cases are parametrized over members
// belonging to every entity shard.
//
// SHARD-ORDER DEFERRAL (recorded, not dropped): the orchestrator
// dispatched W3 BEFORE W4–W8, so only the W1/W2/W3 members exist on
// the facade today. Every `TestCodedResponseValidationCodes` case whose
// member is owned by W4–W8 is carried as an `it.todo(...)` naming the
// Python case, its line, and the owning shard — the shard that lands
// the member converts its todo into the two-line body the translated
// cases here already show (`_make_results_workspace` + `.code` assert).
// Nothing about the translation is lost; the todo list IS the checklist
// (see `B6-W3-notes.md` §deferrals).
//
// Python's `httpx.MockTransport` handler becomes the injected-fetch
// `fakeTransport` seam; `_make_workspace(temp_dir, handler)` (:73-89)
// and `_make_results_workspace(results, workspace_id=…)` (:389-413)
// become the like-named TS helpers. `temp_dir` has no TS analog and is
// dropped.

import { describe, expect, it } from "vitest";
import { Workspace } from "../../src/workspace.js";
import {
  createMockClient,
  makeSession,
  type CannedResponse,
  type CapturedFetchRequest,
  type FakeTransport,
} from "../client/client-test-helpers.js";
import { ResponseValidationError } from "../../src/errors.js";
import {
  BulkUpdateBookmarkEntry,
  CreateBookmarkParams,
} from "../../src/types/entities/bookmarks.js";
import {
  BulkUpdateCohortEntry,
  CreateCohortParams,
} from "../../src/types/entities/cohorts.js";
import {
  BlueprintCard,
  BlueprintFinishParams,
  CreateDashboardParams,
  CreateRcaDashboardParams,
  RcaSourceData,
  UpdateDashboardParams,
  UpdateReportLinkParams,
} from "../../src/types/entities/dashboards.js";
import { MINIMAL_FUNNEL_PARAMS } from "./bookmark-fixtures.js";

/** A canned-response handler (the `httpx.MockTransport` handler twin). */
type Handler = (request: CapturedFetchRequest) => CannedResponse;

/** The OAuth session the mock client is built over (`_make_creds`, :59). */
const CLIENT_SESSION = makeSession({
  projectId: "12345",
  region: "us",
  oauthToken: "test-token",
});

/** The canonical service-account facade session (`_TEST_SESSION`, :47-56). */
const FACADE_SESSION = makeSession({
  projectId: "12345",
  region: "us",
  username: "test_user",
  secret: "test_secret",
});

/**
 * Build a Workspace with a mock HTTP transport (`_make_workspace`,
 * :73-89).
 *
 * @param handler - The canned-response handler.
 * @returns The facade plus the transport capture log.
 */
function makeWorkspace(handler: Handler): {
  ws: Workspace;
  transport: FakeTransport;
} {
  const { client, transport } = createMockClient(CLIENT_SESSION, handler);
  return { ws: new Workspace({ session: FACADE_SESSION, client }), transport };
}

/**
 * Build a Workspace whose transport always returns `results`
 * (`_make_results_workspace`, :389-413).
 *
 * @param results - The JSON value placed under the `results` envelope
 *   key for every request.
 * @returns The facade.
 */
function makeResultsWorkspace(results: unknown): Workspace {
  const { ws } = makeWorkspace(() => ({
    status: 200,
    json: { status: "ok", results },
  }));
  return ws;
}

/**
 * The 200 App-API envelope wrapping `results`.
 *
 * @param results - The `results` payload.
 * @returns The canned response.
 */
function ok(results: unknown): CannedResponse {
  return { status: 200, json: { status: "ok", results } };
}

/**
 * Assert the generic response-validation contract (`_assert_coded`,
 * :423-429) — class + `.code` only, never message text (R5.4).
 *
 * @param call - The awaited facade call.
 * @returns Nothing.
 */
async function assertCoded(call: Promise<unknown>): Promise<void> {
  const error = await call.then(
    () => null,
    (exc: unknown) => exc,
  );
  expect(error).toBeInstanceOf(ResponseValidationError);
  expect((error as ResponseValidationError).code).toBe(
    "RESPONSE_VALIDATION_ERROR",
  );
}

// =============================================================================
// TestRequestBodySerialization (test_workspace_crud_edge.py:92)
// =============================================================================

describe("TestRequestBodySerialization (test_workspace_crud_edge.py:92)", () => {
  it("create_bookmark serializes bookmark_type as 'type' (:95)", async () => {
    const captured: Record<string, unknown> = {};
    const { ws } = makeWorkspace((request) => {
      if (request.method === "POST" && request.url.includes("bookmarks")) {
        captured["body"] = JSON.parse(request.bodyText);
        return ok({ id: 1, name: "X", type: "funnels", params: {} });
      }
      if (request.method === "PATCH") {
        return ok({ id: 99, title: "T" });
      }
      return ok([]);
    });

    await ws.createBookmark(
      new CreateBookmarkParams({
        name: "X",
        bookmark_type: "funnels",
        params: MINIMAL_FUNNEL_PARAMS,
        dashboard_id: 99,
      }),
    );

    const body = captured["body"] as Record<string, unknown>;
    expect(Object.hasOwn(body, "type")).toBe(true);
    expect(Object.hasOwn(body, "bookmark_type")).toBe(false);
    expect(body["type"]).toBe("funnels");
  });

  it("create_cohort flattens definition into the body (:141)", async () => {
    const captured: Record<string, unknown> = {};
    const { ws } = makeWorkspace((request) => {
      if (request.method === "POST" && request.url.includes("cohorts")) {
        captured["body"] = JSON.parse(request.bodyText);
        return ok({ id: 1, name: "X" });
      }
      return ok([]);
    });

    await ws.createCohort(
      new CreateCohortParams({
        name: "X",
        definition: { behavioral_filter: { op: "and" } },
      }),
    );

    const body = captured["body"] as Record<string, unknown>;
    expect(Object.hasOwn(body, "behavioral_filter")).toBe(true);
    expect(Object.hasOwn(body, "definition")).toBe(false);
  });

  it("finalize_blueprint serializes card_type as 'type' (:170)", async () => {
    const captured: Record<string, unknown> = {};
    const { ws } = makeWorkspace((request) => {
      if (request.method === "POST" && request.url.includes("blueprints")) {
        captured["body"] = JSON.parse(request.bodyText);
        return ok({ id: 1, title: "X" });
      }
      return ok([]);
    });

    await ws.finalizeBlueprint(
      new BlueprintFinishParams({
        dashboard_id: 1,
        cards: [new BlueprintCard({ card_type: "report", bookmark_id: 42 })],
      }),
    );

    const body = captured["body"] as { cards: Array<Record<string, unknown>> };
    expect(body.cards[0]?.["type"]).toBe("report");
    expect(Object.hasOwn(body.cards[0] ?? {}, "card_type")).toBe(false);
  });

  it("create_rca_dashboard serializes source_type as 'type' (:199)", async () => {
    const captured: Record<string, unknown> = {};
    const { ws } = makeWorkspace((request) => {
      if (request.method === "POST" && request.url.includes("rca")) {
        captured["body"] = JSON.parse(request.bodyText);
        return ok({ id: 1, title: "RCA" });
      }
      return ok([]);
    });

    await ws.createRcaDashboard(
      new CreateRcaDashboardParams({
        rca_source_id: 42,
        rca_source_data: new RcaSourceData({ source_type: "anomaly" }),
      }),
    );

    const body = captured["body"] as {
      rca_source_data: Record<string, unknown>;
    };
    expect(body.rca_source_data["type"]).toBe("anomaly");
    expect(Object.hasOwn(body.rca_source_data, "source_type")).toBe(false);
  });

  it("update_report_link serializes link_type as 'type' (:228)", async () => {
    const captured: Record<string, unknown> = {};
    const { ws } = makeWorkspace((request) => {
      if (request.method === "PATCH" && request.url.includes("report-links")) {
        captured["body"] = JSON.parse(request.bodyText);
        return { status: 204 };
      }
      return ok([]);
    });

    await ws.updateReportLink(
      1,
      42,
      new UpdateReportLinkParams({ link_type: "embedded" }),
    );

    const body = captured["body"] as Record<string, unknown>;
    expect(body["type"]).toBe("embedded");
    expect(Object.hasOwn(body, "link_type")).toBe(false);
  });
});

// =============================================================================
// TestEmptyResponseHandling (test_workspace_crud_edge.py:247)
// =============================================================================

describe("TestEmptyResponseHandling (test_workspace_crud_edge.py:247)", () => {
  it("create_dashboard raises ResponseValidationError on {} (:250)", async () => {
    const { ws } = makeWorkspace(() => ok({}));
    await assertCoded(
      ws.createDashboard(new CreateDashboardParams({ title: "X" })),
    );
  });

  it("get_bookmark raises ResponseValidationError on {} (:268)", async () => {
    const { ws } = makeWorkspace(() => ok({}));
    await assertCoded(ws.getBookmark(1));
  });

  it("list_dashboards returns [] on an empty results list (:286)", async () => {
    const { ws } = makeWorkspace(() => ok([]));
    expect(await ws.listDashboards()).toEqual([]);
  });
});

// =============================================================================
// TestWorkspaceMethodDelegation (test_workspace_crud_edge.py:298)
// =============================================================================

describe("TestWorkspaceMethodDelegation (test_workspace_crud_edge.py:298)", () => {
  it("bulk_update_bookmarks sends entries with no None fields (:301)", async () => {
    const captured: Record<string, unknown> = {};
    const { ws } = makeWorkspace((request) => {
      if (
        request.method === "POST" &&
        request.url.includes("bookmarks/bulk-update")
      ) {
        captured["body"] = JSON.parse(request.bodyText);
        return { status: 204 };
      }
      return ok([]);
    });

    await ws.bulkUpdateBookmarks([
      new BulkUpdateBookmarkEntry({ id: 1, name: "Renamed" }),
    ]);

    expect(captured["body"]).toEqual({
      bookmarks: [{ id: 1, name: "Renamed" }],
    });
  });

  it("bulk_update_cohorts flattens definition into each entry (:318)", async () => {
    const captured: Record<string, unknown> = {};
    const { ws } = makeWorkspace((request) => {
      if (
        request.method === "POST" &&
        request.url.includes("cohorts/bulk-update")
      ) {
        captured["body"] = JSON.parse(request.bodyText);
        return { status: 204 };
      }
      return ok([]);
    });

    await ws.bulkUpdateCohorts([
      new BulkUpdateCohortEntry({ id: 1, definition: { filter: "x" } }),
    ]);

    const body = captured["body"] as {
      cohorts: Array<Record<string, unknown>>;
    };
    const entry = body.cohorts[0] ?? {};
    expect(entry["id"]).toBe(1);
    expect(entry["filter"]).toBe("x");
    expect(Object.hasOwn(entry, "definition")).toBe(false);
  });

  it("update_dashboard sends only non-None fields (:342)", async () => {
    const captured: Record<string, unknown> = {};
    const { ws } = makeWorkspace((request) => {
      if (request.method === "PATCH" && request.url.includes("dashboards")) {
        captured["body"] = JSON.parse(request.bodyText);
        return ok({ id: 1, title: "New" });
      }
      return ok([]);
    });

    await ws.updateDashboard(1, new UpdateDashboardParams({ title: "New" }));

    expect(captured["body"]).toEqual({ title: "New" });
  });

  it("list_bookmarks_v2 with no args sends no type/ids params (:365)", async () => {
    const captured: Record<string, unknown> = {};
    const { ws } = makeWorkspace((request) => {
      if (request.url.includes("/bookmarks")) {
        captured["url"] = request.url;
      }
      return ok([]);
    });

    await ws.listBookmarksV2();

    const url = captured["url"] as string;
    expect(url.includes("type=")).toBe(false);
    expect(url.includes("ids=")).toBe(false);
  });
});

// =============================================================================
// TestCodedResponseValidationCodes (test_workspace_crud_edge.py:416)
// =============================================================================

describe("TestCodedResponseValidationCodes (test_workspace_crud_edge.py:416)", () => {
  it("dashboards family (list member): invalid item is wrapped (:431)", async () => {
    await assertCoded(makeResultsWorkspace([{}]).listDashboards());
  });

  it("bookmarks family (list member): invalid item is wrapped (:438)", async () => {
    await assertCoded(makeResultsWorkspace([{}]).listBookmarksV2());
  });

  it("cohorts family (single member): {} response is wrapped (:445)", async () => {
    await assertCoded(makeResultsWorkspace({}).getCohort(1));
  });

  it("cohorts family (list member): invalid item is wrapped (:452)", async () => {
    await assertCoded(makeResultsWorkspace([{}]).listCohortsFull());
  });

  // ---- Shard-order deferrals: members owned by W4–W8 (see header) ----
  it.todo("flags family (single member) :459 — W4 `get_feature_flag`");
  it.todo("flags family (list member) :466 — W4 `list_feature_flags`");
  it.todo("experiments family (single member) :473 — W4 `get_experiment`");
  it.todo("experiments family (list member) :480 — W4 `list_experiments`");
  it.todo("annotations family (single member) :487 — W5 `get_annotation`");
  it.todo("annotations family (list member) :494 — W5 `list_annotations`");
  it.todo("webhooks family (single member) :501 — W5 `create_webhook`");
  it.todo("webhooks family (list member) :508 — W5 `list_webhooks`");
  it.todo("alerts family (single member) :515 — W5 `get_alert`");
  it.todo("alerts family (list member) :522 — W5 `list_alerts`");
  it.todo("lexicon definitions (events) :529 — W6 `get_event_definitions`");
  it.todo(
    "lexicon definitions (properties) :536 — W6 `get_property_definitions`",
  );
  it.todo("lexicon tags (single member) :543 — W6 `create_lexicon_tag`");
  it.todo("lexicon tags (list member) :550 — W6 `list_lexicon_tags`");
  it.todo("drop filters (single member) :557 — W7 `get_drop_filter_limits`");
  it.todo("drop filters (list member) :564 — W7 `list_drop_filters`");
  it.todo("custom properties (single member) :571 — W7 `get_custom_property`");
  it.todo("custom properties (list member) :578 — W7 `list_custom_properties`");
  it.todo("lookup tables (single member) :585 — W7 `get_lookup_upload_url`");
  it.todo("lookup tables (list member) :592 — W7 `list_lookup_tables`");
  it.todo("custom events (single member) :599 — W7 `create_custom_event`");
  it.todo("custom events (list member) :608 — W7 `list_custom_events`");
  it.todo("schemas family (single member) :615 — W8 `delete_schemas`");
  it.todo("schemas family (list member) :622 — W8 `list_schema_registry`");
  it.todo("governance monitoring (cancel) :629 — W8 `cancel_deletion_request`");
  it.todo("governance monitoring (list) :636 — W8 `list_deletion_requests`");
});
