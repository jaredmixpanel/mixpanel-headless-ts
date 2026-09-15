// B6-W3 Layer-3 translation (packet `b6-packets.md` §5) of
// `tests/unit/test_workspace_crud_edge.py` — the WHOLE file:
// `TestRequestBodySerialization`, `TestEmptyResponseHandling`
// (:247), `TestWorkspaceMethodDelegation` (:298) and
// `TestCodedResponseValidationCodes`.
//
// This is one of the two CROSS-ENTITY suites W3 owns (the reason the
// packet sequences W3 last): its cases are parametrized over members
// belonging to every entity shard.
//
// SHARD-ORDER DEFERRAL — RESOLVED AT B6-ARB: the orchestrator
// dispatched W3 BEFORE W4–W8, so W3 carried the 26 W4–W8-owned
// `TestCodedResponseValidationCodes` cases as `it.todo(...)` stubs with
// a per-shard conversion protocol. None of W4–W8 executed it (the B6
// review pair's shared MAJOR finding), so the arbiter fix task
// converted ALL 26 into the two-line bodies below
// (`b6-review-resolution.md` Finding A; charged to the owning shards
// per P3-3). Zero todos remain.
//
// Python's `httpx.MockTransport` handler becomes the injected-fetch
// `fakeTransport` seam; `_make_workspace(temp_dir, handler)`
// and `_make_results_workspace(results, workspace_id=…)`
// become the like-named TS helpers. `temp_dir` has no TS analog and is
// dropped.

import { describe, expect, it } from "vitest";

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
import { CreateCustomEventParams } from "../../src/types/entities/data-governance.js";
import { CreateTagParams } from "../../src/types/entities/lexicon.js";
import { CreateWebhookParams } from "../../src/types/entities/webhooks.js";
import { Workspace } from "../../src/workspace.js";
import {
  CLIENT_SESSION,
  createMockClient,
  FACADE_SESSION,
  ok,
} from "../../test-support/client-test-helpers.js";
import { makeFacadeWorkspace } from "../../test-support/workspace-test-helpers.js";
import { MINIMAL_FUNNEL_PARAMS } from "./bookmark-fixtures.js";

/**
 * Build a Workspace whose transport always returns `results`
 * (`_make_results_workspace`, :389-413).
 *
 * @param results - The JSON value placed under the `results` envelope
 *   key for every request.
 * @param options - `workspaceId` pins a workspace ID on the client so
 *   workspace-scoped methods skip workspace resolution (the Python
 *   helper's `workspace_id=` keyword, :390).
 * @returns The facade.
 */
function makeResultsWorkspace(
  results: unknown,
  options: { readonly workspaceId?: number } = {},
): Workspace {
  const { client } = createMockClient(CLIENT_SESSION, () => ({
    status: 200,
    json: { status: "ok", results },
  }));
  if (options.workspaceId !== undefined) {
    client.setWorkspaceId(options.workspaceId);
  }
  return new Workspace({ session: FACADE_SESSION, client });
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
    (error_: unknown) => error_,
  );
  expect(error).toBeInstanceOf(ResponseValidationError);
  expect((error as ResponseValidationError).code).toBe(
    "RESPONSE_VALIDATION_ERROR",
  );
}

// =============================================================================
// TestRequestBodySerialization (test_workspace_crud_edge.py)
// =============================================================================

describe("Request body serialization", () => {
  // python: TestRequestBodySerialization
  it("create_bookmark serializes bookmark_type as 'type'", async () => {
    const captured: Record<string, unknown> = {};
    const { ws } = makeFacadeWorkspace((request) => {
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

  it("create_cohort flattens definition into the body", async () => {
    const captured: Record<string, unknown> = {};
    const { ws } = makeFacadeWorkspace((request) => {
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

  it("finalize_blueprint serializes card_type as 'type'", async () => {
    const captured: Record<string, unknown> = {};
    const { ws } = makeFacadeWorkspace((request) => {
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

  it("create_rca_dashboard serializes source_type as 'type'", async () => {
    const captured: Record<string, unknown> = {};
    const { ws } = makeFacadeWorkspace((request) => {
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

  it("update_report_link serializes link_type as 'type'", async () => {
    const captured: Record<string, unknown> = {};
    const { ws } = makeFacadeWorkspace((request) => {
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
// TestEmptyResponseHandling (test_workspace_crud_edge.py)
// =============================================================================

describe("Empty response handling", () => {
  // python: TestEmptyResponseHandling
  it("create_dashboard raises ResponseValidationError on {}", async () => {
    const { ws } = makeFacadeWorkspace(() => ok({}));
    await assertCoded(
      ws.createDashboard(new CreateDashboardParams({ title: "X" })),
    );
  });

  it("get_bookmark raises ResponseValidationError on {}", async () => {
    const { ws } = makeFacadeWorkspace(() => ok({}));
    await assertCoded(ws.getBookmark(1));
  });

  it("list_dashboards returns [] on an empty results list", async () => {
    const { ws } = makeFacadeWorkspace(() => ok([]));
    await expect(ws.listDashboards()).resolves.toStrictEqual([]);
  });
});

// =============================================================================
// TestWorkspaceMethodDelegation (test_workspace_crud_edge.py)
// =============================================================================

describe("Workspace method delegation", () => {
  // python: TestWorkspaceMethodDelegation
  it("bulk_update_bookmarks sends entries with no None fields", async () => {
    const captured: Record<string, unknown> = {};
    const { ws } = makeFacadeWorkspace((request) => {
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

    expect(captured["body"]).toStrictEqual({
      bookmarks: [{ id: 1, name: "Renamed" }],
    });
  });

  it("bulk_update_cohorts flattens definition into each entry", async () => {
    const captured: Record<string, unknown> = {};
    const { ws } = makeFacadeWorkspace((request) => {
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

  it("update_dashboard sends only non-None fields", async () => {
    const captured: Record<string, unknown> = {};
    const { ws } = makeFacadeWorkspace((request) => {
      if (request.method === "PATCH" && request.url.includes("dashboards")) {
        captured["body"] = JSON.parse(request.bodyText);
        return ok({ id: 1, title: "New" });
      }
      return ok([]);
    });

    await ws.updateDashboard(1, new UpdateDashboardParams({ title: "New" }));

    expect(captured["body"]).toStrictEqual({ title: "New" });
  });

  it("list_bookmarks_v2 with no args sends no type/ids params", async () => {
    const captured: Record<string, unknown> = {};
    const { ws } = makeFacadeWorkspace((request) => {
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
// TestCodedResponseValidationCodes (test_workspace_crud_edge.py)
// =============================================================================

describe("Coded response validation codes", () => {
  // python: TestCodedResponseValidationCodes
  it("dashboards family (list member): invalid item is wrapped", async () => {
    await assertCoded(makeResultsWorkspace([{}]).listDashboards());
  });

  it("bookmarks family (list member): invalid item is wrapped", async () => {
    await assertCoded(makeResultsWorkspace([{}]).listBookmarksV2());
  });

  it("cohorts family (single member): {} response is wrapped", async () => {
    await assertCoded(makeResultsWorkspace({}).getCohort(1));
  });

  it("cohorts family (list member): invalid item is wrapped", async () => {
    await assertCoded(makeResultsWorkspace([{}]).listCohortsFull());
  });

  // ---- W4–W8 members (todo conversion executed at B6-ARB, Finding A) ----
  // The two flags cases pin `workspace_id=777` exactly as Python does
  // (:461, :468) — feature flags are workspace-scoped.
  it("flags family (single member): {} response is wrapped", async () => {
    await assertCoded(
      makeResultsWorkspace({}, { workspaceId: 777 }).getFeatureFlag("f1"),
    );
  });

  it("flags family (list member): invalid item is wrapped", async () => {
    await assertCoded(
      makeResultsWorkspace([{}], { workspaceId: 777 }).listFeatureFlags(),
    );
  });

  it("experiments family (single member): {} response is wrapped", async () => {
    await assertCoded(makeResultsWorkspace({}).getExperiment("e1"));
  });

  it("experiments family (list member): invalid item is wrapped", async () => {
    await assertCoded(makeResultsWorkspace([{}]).listExperiments());
  });

  it("annotations family (single member): {} response is wrapped", async () => {
    await assertCoded(makeResultsWorkspace({}).getAnnotation(1));
  });

  it("annotations family (list member): invalid item is wrapped", async () => {
    await assertCoded(makeResultsWorkspace([{}]).listAnnotations());
  });

  it("webhooks family (single member): {} response is wrapped", async () => {
    await assertCoded(
      makeResultsWorkspace({}).createWebhook(
        new CreateWebhookParams({ name: "W", url: "https://x.test/h" }),
      ),
    );
  });

  it("webhooks family (list member): invalid item is wrapped", async () => {
    await assertCoded(makeResultsWorkspace([{}]).listWebhooks());
  });

  it("alerts family (single member): {} response is wrapped", async () => {
    await assertCoded(makeResultsWorkspace({}).getAlert(1));
  });

  it("alerts family (list member): invalid item is wrapped", async () => {
    await assertCoded(makeResultsWorkspace([{}]).listAlerts());
  });

  it("lexicon definitions (events): invalid item is wrapped", async () => {
    await assertCoded(
      makeResultsWorkspace([{}]).getEventDefinitions({ names: ["x"] }),
    );
  });

  it("lexicon definitions (properties): invalid item is wrapped", async () => {
    await assertCoded(
      makeResultsWorkspace([{}]).getPropertyDefinitions({ names: ["p"] }),
    );
  });

  it("lexicon tags (single member): {} response is wrapped", async () => {
    await assertCoded(
      makeResultsWorkspace({}).createLexiconTag(
        new CreateTagParams({ name: "T" }),
      ),
    );
  });

  it("lexicon tags (list member): invalid item is wrapped", async () => {
    await assertCoded(makeResultsWorkspace([{}]).listLexiconTags());
  });

  it("drop filters (single member): {} response is wrapped", async () => {
    await assertCoded(makeResultsWorkspace({}).getDropFilterLimits());
  });

  it("drop filters (list member): invalid item is wrapped", async () => {
    await assertCoded(makeResultsWorkspace([{}]).listDropFilters());
  });

  it("custom properties (single member): {} response is wrapped", async () => {
    await assertCoded(makeResultsWorkspace({}).getCustomProperty("cp1"));
  });

  it("custom properties (list member): invalid item is wrapped", async () => {
    await assertCoded(makeResultsWorkspace([{}]).listCustomProperties());
  });

  it("lookup tables (single member): type-invalid url is wrapped", async () => {
    await assertCoded(
      makeResultsWorkspace({
        url: 123,
        path: "p",
        key: "k",
      }).getLookupUploadUrl(),
    );
  });

  it("lookup tables (list member): invalid item is wrapped", async () => {
    await assertCoded(makeResultsWorkspace([{}]).listLookupTables());
  });

  it("custom events (single member): {} response is wrapped", async () => {
    await assertCoded(
      makeResultsWorkspace({}).createCustomEvent(
        new CreateCustomEventParams({ name: "CE", alternatives: ["A"] }),
      ),
    );
  });

  it("custom events (list member): invalid item is wrapped", async () => {
    await assertCoded(makeResultsWorkspace([{}]).listCustomEvents());
  });

  it("schemas family (single member): {} response is wrapped", async () => {
    await assertCoded(makeResultsWorkspace({}).deleteSchemas());
  });

  it("schemas family (list member): invalid item is wrapped", async () => {
    await assertCoded(makeResultsWorkspace([{}]).listSchemaRegistry());
  });

  it("governance monitoring (cancel): invalid entry is wrapped", async () => {
    await assertCoded(makeResultsWorkspace([{}]).cancelDeletionRequest(42));
  });

  it("governance monitoring (list): invalid item is wrapped", async () => {
    await assertCoded(makeResultsWorkspace([{}]).listDeletionRequests());
  });
});
