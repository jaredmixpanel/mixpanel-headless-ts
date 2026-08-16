// B6-W5 Layer-3 translation (packet `b6-packets.md` §7) of the WHOLE
// of `tests/unit/test_workspace_alerts.py` (447 lines, 2 classes):
// `TestWorkspaceAlertCRUD` (:126) and `TestWorkspaceAlertOperations`
// (:278).
//
// Python's `httpx.MockTransport` handler becomes the injected-fetch
// `fakeTransport` seam; `_make_workspace(temp_dir, handler)` (:68-85)
// becomes `makeWorkspace(handler)` — the client is built over the
// OAuth session (`_make_oauth_credentials`, :52) while the facade
// carries the service-account `_TEST_SESSION` (:37-45), exactly as
// Python does. `temp_dir` has no TS analog and is dropped.
//
// `test_alert` returns an OPAQUE dict in Python (`workspace.py:7119`
// returns `client.test_alert(body)` verbatim — no model validation),
// so the TS twin returns the native-valued record with no model
// construction (the `list_erf_experiments` precedent, W4).
//
// ADDITIVE section (clearly headed, never substituting for a
// translated Python assertion — B5 Caution #13 / packet §0.2): the
// facade-to-client delegation contracts — argument spelling for the
// two option-bag members (`list_alerts` :6870, `get_alert_history`
// :7075) and the `model_dump(exclude_none=True)` bodies (`:6911`,
// `:6970`, `:7118`, `:7180`) — that the wire suite cannot observe.

import { describe, expect, it } from "vitest";
import { Workspace } from "../../src/workspace.js";
import {
  createMockClient,
  makeSession,
  type CannedResponse,
  type CapturedFetchRequest,
  type FakeTransport,
} from "../client/client-test-helpers.js";
import type { MixpanelClient } from "../../src/client/client.js";
import {
  AlertCount,
  AlertHistoryResponse,
  AlertScreenshotResponse,
  CreateAlertParams,
  CustomAlert,
  UpdateAlertParams,
  ValidateAlertsForBookmarkParams,
  ValidateAlertsForBookmarkResponse,
} from "../../src/types/entities/alerts.js";
import {
  bulkDeleteAlerts as bulkDeleteAlertsMember,
  createAlert as createAlertMember,
  deleteAlert as deleteAlertMember,
  getAlert as getAlertMember,
  getAlertCount as getAlertCountMember,
  getAlertHistory as getAlertHistoryMember,
  getAlertScreenshotUrl as getAlertScreenshotUrlMember,
  listAlerts as listAlertsMember,
  testAlert as testAlertMember,
  updateAlert as updateAlertMember,
  validateAlertsForBookmark as validateAlertsForBookmarkMember,
} from "../../src/workspace-members/annotations-webhooks-alerts.js";

/** A canned-response handler (the `httpx.MockTransport` handler twin). */
type Handler = (request: CapturedFetchRequest) => CannedResponse;

/** The OAuth session the mock client is built over (`:52-58`). */
const CLIENT_SESSION = makeSession({
  projectId: "12345",
  region: "us",
  oauthToken: "test-token",
});

/** The canonical service-account facade session (`_TEST_SESSION`, :37-45). */
const FACADE_SESSION = makeSession({
  projectId: "12345",
  region: "us",
  username: "test_user",
  secret: "test_secret",
});

/**
 * Build a Workspace whose client routes through `handler`
 * (`_make_workspace`, :68-85).
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
 * A minimal alert dict matching the API shape (`_alert_json`, :93-114).
 *
 * @param id - Alert ID.
 * @param name - Alert name.
 * @returns The payload record.
 */
function alertJson(id = 1, name = "Test Alert"): Record<string, unknown> {
  return {
    id,
    name,
    condition: { operator: "less_than", value: 100 },
    frequency: 86400,
    paused: false,
    subscriptions: [{ type: "email", value: "test@co.com" }],
    created: "2026-01-01T00:00:00Z",
    modified: "2026-01-01T00:00:00Z",
    valid: true,
  };
}

/**
 * A 200 App-API envelope wrapping `results`.
 *
 * @param results - The `results` payload.
 * @returns The canned response.
 */
function ok(results: unknown): CannedResponse {
  return { status: 200, json: { status: "ok", results } };
}

/**
 * A client stub whose single method returns `value` (the additive
 * delegation probes).
 *
 * @param method - The client method name to stub.
 * @param value - The value the stub resolves to.
 * @param calls - Optional log receiving each argument list.
 * @returns The stub cast to the client type.
 */
function stubClient(
  method: string,
  value: unknown,
  calls: unknown[][] = [],
): MixpanelClient {
  return {
    [method]: (...args: unknown[]): Promise<unknown> => {
      calls.push(args);
      return Promise.resolve(value);
    },
  } as unknown as MixpanelClient;
}

// =============================================================================
// TestWorkspaceAlertCRUD (:126)
// =============================================================================

describe("TestWorkspaceAlertCRUD", () => {
  it("list_alerts() returns list of CustomAlert objects", async () => {
    const { ws } = makeWorkspace(() =>
      ok([alertJson(1, "Alert A"), alertJson(2, "Alert B")]),
    );
    const alerts = await ws.listAlerts();

    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toBeInstanceOf(CustomAlert);
    expect(alerts[0]?.id).toBe(1);
    expect(alerts[0]?.name).toBe("Alert A");
    expect(alerts[1]?.id).toBe(2);
  });

  it("list_alerts() returns empty list when no alerts exist", async () => {
    const { ws } = makeWorkspace(() => ok([]));
    expect(await ws.listAlerts()).toEqual([]);
  });

  it("list_alerts(bookmark_id=42) passes param to API", async () => {
    const { ws, transport } = makeWorkspace(() => ok([alertJson()]));
    const alerts = await ws.listAlerts({ bookmark_id: 42 });

    expect(alerts).toHaveLength(1);
    expect(transport.captures[0]?.url).toContain("bookmark_id=42");
  });

  it("create_alert() returns the created CustomAlert", async () => {
    const { ws } = makeWorkspace(() => ok(alertJson(99, "New Alert")));
    const params = new CreateAlertParams({
      bookmark_id: 123,
      name: "New Alert",
      condition: { operator: "less_than", value: 50 },
      frequency: 86400,
      paused: false,
      subscriptions: [],
    });
    const alert = await ws.createAlert(params);

    expect(alert).toBeInstanceOf(CustomAlert);
    expect(alert.id).toBe(99);
    expect(alert.name).toBe("New Alert");
  });

  it("get_alert() returns a single CustomAlert by ID", async () => {
    const { ws } = makeWorkspace(() => ok(alertJson(42, "My Alert")));
    const alert = await ws.getAlert(42);

    expect(alert).toBeInstanceOf(CustomAlert);
    expect(alert.id).toBe(42);
    expect(alert.name).toBe("My Alert");
  });

  it("update_alert() returns the updated CustomAlert", async () => {
    const { ws } = makeWorkspace(() => ok(alertJson(42, "Renamed")));
    const alert = await ws.updateAlert(
      42,
      new UpdateAlertParams({ name: "Renamed" }),
    );

    expect(alert).toBeInstanceOf(CustomAlert);
    expect(alert.name).toBe("Renamed");
  });

  it("delete_alert() returns None on success", async () => {
    const { ws } = makeWorkspace(() => ({ status: 204 }));
    await expect(ws.deleteAlert(42)).resolves.toBeUndefined();
  });

  it("bulk_delete_alerts() returns None on success", async () => {
    const { ws } = makeWorkspace(() => ok({}));
    await expect(ws.bulkDeleteAlerts([1, 2, 3])).resolves.toBeUndefined();
  });
});

// =============================================================================
// TestWorkspaceAlertOperations (:278)
// =============================================================================

describe("TestWorkspaceAlertOperations", () => {
  it("get_alert_count() returns AlertCount", async () => {
    const { ws } = makeWorkspace(() =>
      ok({ anomaly_alerts_count: 5, alert_limit: 100, is_below_limit: true }),
    );
    const count = await ws.getAlertCount();

    expect(count).toBeInstanceOf(AlertCount);
    expect(count.anomaly_alerts_count).toBe(5);
    expect(count.alert_limit).toBe(100);
    expect(count.is_below_limit).toBe(true);
  });

  it("get_alert_count(alert_type='anomaly') passes param", async () => {
    const { ws, transport } = makeWorkspace(() =>
      ok({ anomaly_alerts_count: 2, alert_limit: 50, is_below_limit: true }),
    );
    await ws.getAlertCount({ alert_type: "anomaly" });

    expect(transport.captures[0]?.url).toContain("type=anomaly");
  });

  it("get_alert_history() returns AlertHistoryResponse", async () => {
    const { ws } = makeWorkspace(() =>
      ok({ results: [{ fired: true }], pagination: { page_size: 20 } }),
    );
    const history = await ws.getAlertHistory(42);

    expect(history).toBeInstanceOf(AlertHistoryResponse);
    expect(history.results).toHaveLength(1);
    expect(history.pagination).not.toBeNull();
    expect(history.pagination?.page_size).toBe(20);
  });

  it("get_alert_history() handles empty history", async () => {
    const { ws } = makeWorkspace(() =>
      ok({ results: [], pagination: { page_size: 20 } }),
    );
    const history = await ws.getAlertHistory(42);

    expect(history).toBeInstanceOf(AlertHistoryResponse);
    expect(history.results).toEqual([]);
  });

  it("test_alert() returns opaque dict", async () => {
    const { ws } = makeWorkspace(() => ok({ status: "sent" }));
    const params = new CreateAlertParams({
      bookmark_id: 123,
      name: "Test",
      condition: {},
      frequency: 86400,
      paused: false,
      subscriptions: [],
    });
    const result = await ws.testAlert(params);

    // `isinstance(result, dict)` — a plain record, NOT a model.
    expect(result).toBeInstanceOf(Object);
    expect(result["status"]).toBe("sent");
  });

  it("get_alert_screenshot_url() returns AlertScreenshotResponse", async () => {
    const { ws } = makeWorkspace(() =>
      ok({ signed_url: "https://storage.googleapis.com/abc.png" }),
    );
    const resp = await ws.getAlertScreenshotUrl("screenshots/abc.png");

    expect(resp).toBeInstanceOf(AlertScreenshotResponse);
    expect(resp.signed_url).toBe("https://storage.googleapis.com/abc.png");
  });

  it("validate_alerts_for_bookmark() returns ValidateAlertsForBookmarkResponse", async () => {
    const { ws } = makeWorkspace(() =>
      ok({
        alert_validations: [{ alert_id: 1, alert_name: "X", valid: true }],
        invalid_count: 0,
      }),
    );
    const params = new ValidateAlertsForBookmarkParams({
      alert_ids: [1],
      bookmark_type: "insights",
      bookmark_params: { event: "Signup" },
    });
    const resp = await ws.validateAlertsForBookmark(params);

    expect(resp).toBeInstanceOf(ValidateAlertsForBookmarkResponse);
    expect(resp.alert_validations).toHaveLength(1);
    expect(resp.invalid_count).toBe(0);
  });
});

// =============================================================================
// ADDITIVE — delegation contracts (packet §0.2 / B5 Caution #13).
// =============================================================================

describe("ADDITIVE: alert member delegation contracts", () => {
  it("listAlerts forwards bookmark_id/skip_user_filter, defaulting to null", async () => {
    const calls: unknown[][] = [];
    const client = stubClient("listAlerts", [], calls);

    await listAlertsMember(client);
    expect(calls[0]?.[0]).toEqual({
      bookmark_id: null,
      skip_user_filter: null,
    });

    // An explicit `false` is NOT None and must be forwarded (the
    // client's `is not None` gate sends it as `"false"`).
    await listAlertsMember(client, {
      bookmark_id: 42,
      skip_user_filter: false,
    });
    expect(calls[1]?.[0]).toEqual({ bookmark_id: 42, skip_user_filter: false });
  });

  it("getAlertCount forwards alert_type, defaulting to null", async () => {
    const calls: unknown[][] = [];
    const client = stubClient(
      "getAlertCount",
      { anomaly_alerts_count: 0, alert_limit: 1, is_below_limit: true },
      calls,
    );

    await getAlertCountMember(client);
    expect(calls[0]?.[0]).toEqual({ alert_type: null });

    await getAlertCountMember(client, { alert_type: "anomaly" });
    expect(calls[1]?.[0]).toEqual({ alert_type: "anomaly" });
  });

  it("getAlertHistory forwards (alert_id, {page_size, next_cursor, previous_cursor})", async () => {
    const calls: unknown[][] = [];
    const client = stubClient("getAlertHistory", { results: [] }, calls);

    await getAlertHistoryMember(client, 42);
    expect(calls[0]?.[0]).toBe(42);
    expect(calls[0]?.[1]).toEqual({
      page_size: null,
      next_cursor: null,
      previous_cursor: null,
    });

    await getAlertHistoryMember(client, 42, {
      page_size: 20,
      next_cursor: "n",
      previous_cursor: "p",
    });
    expect(calls[1]?.[1]).toEqual({
      page_size: 20,
      next_cursor: "n",
      previous_cursor: "p",
    });
  });

  it("createAlert / updateAlert send the exclude_none dump", async () => {
    const createCalls: unknown[][] = [];
    await createAlertMember(
      stubClient("createAlert", alertJson(), createCalls),
      new CreateAlertParams({
        bookmark_id: 1,
        name: "A",
        condition: {},
        frequency: 60,
        paused: false,
        subscriptions: [],
      }),
    );
    // `notification_windows` is None → ABSENT, not null (R3.5).
    expect(createCalls[0]?.[0]).toEqual({
      bookmark_id: 1,
      name: "A",
      condition: {},
      frequency: 60,
      paused: false,
      subscriptions: [],
    });

    const updateCalls: unknown[][] = [];
    await updateAlertMember(
      stubClient("updateAlert", alertJson(), updateCalls),
      42,
      new UpdateAlertParams({ name: "R" }),
    );
    expect(updateCalls[0]?.[0]).toBe(42);
    expect(updateCalls[0]?.[1]).toEqual({ name: "R" });
  });

  it("testAlert returns the client payload verbatim — no model construction", async () => {
    const calls: unknown[][] = [];
    const client = stubClient("testAlert", { status: "sent", extra: 1 }, calls);
    const result = await testAlertMember(
      client,
      new CreateAlertParams({
        bookmark_id: 1,
        name: "A",
        condition: {},
        frequency: 60,
        paused: false,
        subscriptions: [],
      }),
    );

    expect(result).toEqual({ status: "sent", extra: 1 });
    expect(calls[0]?.[0]).toEqual({
      bookmark_id: 1,
      name: "A",
      condition: {},
      frequency: 60,
      paused: false,
      subscriptions: [],
    });
  });

  it("validateAlertsForBookmark sends the exclude_none dump (`workspace.py:7180`)", async () => {
    const calls: unknown[][] = [];
    const client = stubClient(
      "validateAlertsForBookmark",
      { alert_validations: [], invalid_count: 0 },
      calls,
    );
    await validateAlertsForBookmarkMember(
      client,
      new ValidateAlertsForBookmarkParams({
        alert_ids: [1],
        bookmark_type: "insights",
        bookmark_params: { event: "Signup" },
      }),
    );

    expect(calls[0]?.[0]).toEqual({
      alert_ids: [1],
      bookmark_type: "insights",
      bookmark_params: { event: "Signup" },
    });
  });

  it("getAlert / deleteAlert / bulkDeleteAlerts / getAlertScreenshotUrl forward positionally", async () => {
    const getCalls: unknown[][] = [];
    await getAlertMember(stubClient("getAlert", alertJson(), getCalls), 7);
    expect(getCalls[0]?.[0]).toBe(7);

    const delCalls: unknown[][] = [];
    await deleteAlertMember(stubClient("deleteAlert", undefined, delCalls), 9);
    expect(delCalls[0]?.[0]).toBe(9);

    const bulkCalls: unknown[][] = [];
    await bulkDeleteAlertsMember(
      stubClient("bulkDeleteAlerts", undefined, bulkCalls),
      [1, 2, 3],
    );
    expect(bulkCalls[0]?.[0]).toEqual([1, 2, 3]);

    const shotCalls: unknown[][] = [];
    await getAlertScreenshotUrlMember(
      stubClient("getAlertScreenshotUrl", { signed_url: "u" }, shotCalls),
      "k/1.png",
    );
    expect(shotCalls[0]?.[0]).toBe("k/1.png");
  });
});
