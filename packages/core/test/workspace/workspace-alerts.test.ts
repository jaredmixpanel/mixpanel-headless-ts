// Workspace alert members (list/create/get/update/delete/bulk-delete, count,
// history, testAlert, screenshot URL, bookmark validation) over the injected
// fetch seam. Mirrors tests/unit/test_workspace_alerts.py (both classes);
// testAlert returns the raw record because Python returns the client dict as-is.
// Additive: facade-to-client delegation contracts the wire suite cannot observe.

import { describe, expect, it } from "vitest";

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
import { ok } from "../../test-support/client-test-helpers.js";
import {
  makeFacadeWorkspace,
  stubClient,
} from "../../test-support/workspace-test-helpers.js";

/**
 * A minimal alert dict matching the API shape (`_alert_json`).
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

// --- Workspace alert CRUD ---

describe("Workspace alert CRUD", () => {
  // python: TestWorkspaceAlertCRUD
  it("listAlerts() returns list of CustomAlert objects", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok([alertJson(1, "Alert A"), alertJson(2, "Alert B")]),
    );
    const alerts = await ws.listAlerts();

    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toBeInstanceOf(CustomAlert);
    expect(alerts[0]?.id).toBe(1);
    expect(alerts[0]?.name).toBe("Alert A");
    expect(alerts[1]?.id).toBe(2);
  });

  it("listAlerts() returns empty list when no alerts exist", async () => {
    const { ws } = makeFacadeWorkspace(() => ok([]));
    await expect(ws.listAlerts()).resolves.toStrictEqual([]);
  });

  it("list_alerts(bookmark_id=42) passes param to API", async () => {
    const { ws, transport } = makeFacadeWorkspace(() => ok([alertJson()]));
    const alerts = await ws.listAlerts({ bookmark_id: 42 });

    expect(alerts).toHaveLength(1);
    expect(transport.captures[0]?.url).toContain("bookmark_id=42");
  });

  it("createAlert() returns the created CustomAlert", async () => {
    const { ws } = makeFacadeWorkspace(() => ok(alertJson(99, "New Alert")));
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

  it("getAlert() returns a single CustomAlert by ID", async () => {
    const { ws } = makeFacadeWorkspace(() => ok(alertJson(42, "My Alert")));
    const alert = await ws.getAlert(42);

    expect(alert).toBeInstanceOf(CustomAlert);
    expect(alert.id).toBe(42);
    expect(alert.name).toBe("My Alert");
  });

  it("updateAlert() returns the updated CustomAlert", async () => {
    const { ws } = makeFacadeWorkspace(() => ok(alertJson(42, "Renamed")));
    const alert = await ws.updateAlert(
      42,
      new UpdateAlertParams({ name: "Renamed" }),
    );

    expect(alert).toBeInstanceOf(CustomAlert);
    expect(alert.name).toBe("Renamed");
  });

  it("deleteAlert() resolves to undefined on success", async () => {
    const { ws } = makeFacadeWorkspace(() => ({ status: 204 }));
    await expect(ws.deleteAlert(42)).resolves.toBeUndefined();
  });

  it("bulkDeleteAlerts() resolves to undefined on success", async () => {
    const { ws } = makeFacadeWorkspace(() => ok({}));
    await expect(ws.bulkDeleteAlerts([1, 2, 3])).resolves.toBeUndefined();
  });
});

// --- Workspace alert operations ---

describe("Workspace alert operations", () => {
  // python: TestWorkspaceAlertOperations
  it("getAlertCount() returns AlertCount", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok({ anomaly_alerts_count: 5, alert_limit: 100, is_below_limit: true }),
    );
    const count = await ws.getAlertCount();

    expect(count).toBeInstanceOf(AlertCount);
    expect(count.anomaly_alerts_count).toBe(5);
    expect(count.alert_limit).toBe(100);
    expect(count.is_below_limit).toBe(true);
  });

  it("get_alert_count(alert_type='anomaly') passes param", async () => {
    const { ws, transport } = makeFacadeWorkspace(() =>
      ok({ anomaly_alerts_count: 2, alert_limit: 50, is_below_limit: true }),
    );
    await ws.getAlertCount({ alert_type: "anomaly" });

    expect(transport.captures[0]?.url).toContain("type=anomaly");
  });

  it("getAlertHistory() returns AlertHistoryResponse", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok({ results: [{ fired: true }], pagination: { page_size: 20 } }),
    );
    const history = await ws.getAlertHistory(42);

    expect(history).toBeInstanceOf(AlertHistoryResponse);
    expect(history.results).toHaveLength(1);
    expect(history.pagination).not.toBeNull();
    expect(history.pagination?.page_size).toBe(20);
  });

  it("getAlertHistory() handles empty history", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok({ results: [], pagination: { page_size: 20 } }),
    );
    const history = await ws.getAlertHistory(42);

    expect(history).toBeInstanceOf(AlertHistoryResponse);
    expect(history.results).toStrictEqual([]);
  });

  it("testAlert() returns a plain record, not a model", async () => {
    const { ws } = makeFacadeWorkspace(() => ok({ status: "sent" }));
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

  it("getAlertScreenshotUrl() returns AlertScreenshotResponse", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok({ signed_url: "https://storage.googleapis.com/abc.png" }),
    );
    const resp = await ws.getAlertScreenshotUrl("screenshots/abc.png");

    expect(resp).toBeInstanceOf(AlertScreenshotResponse);
    expect(resp.signed_url).toBe("https://storage.googleapis.com/abc.png");
  });

  it("validateAlertsForBookmark() returns ValidateAlertsForBookmarkResponse", async () => {
    const { ws } = makeFacadeWorkspace(() =>
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

// --- Additive: delegation contracts the wire suite cannot observe ---

describe("ADDITIVE: alert member delegation contracts", () => {
  it("listAlerts forwards bookmark_id/skip_user_filter, defaulting to null", async () => {
    const calls: unknown[][] = [];
    const client = stubClient("listAlerts", [], calls);

    await listAlertsMember(client);
    expect(calls[0]?.[0]).toStrictEqual({
      bookmark_id: null,
      skip_user_filter: null,
    });

    // An explicit `false` is NOT None and must be forwarded (the
    // client's `is not None` gate sends it as `"false"`).
    await listAlertsMember(client, {
      bookmark_id: 42,
      skip_user_filter: false,
    });
    expect(calls[1]?.[0]).toStrictEqual({
      bookmark_id: 42,
      skip_user_filter: false,
    });
  });

  it("getAlertCount forwards alert_type, defaulting to null", async () => {
    const calls: unknown[][] = [];
    const client = stubClient(
      "getAlertCount",
      { anomaly_alerts_count: 0, alert_limit: 1, is_below_limit: true },
      calls,
    );

    await getAlertCountMember(client);
    expect(calls[0]?.[0]).toStrictEqual({ alert_type: null });

    await getAlertCountMember(client, { alert_type: "anomaly" });
    expect(calls[1]?.[0]).toStrictEqual({ alert_type: "anomaly" });
  });

  it("getAlertHistory forwards (alert_id, {page_size, next_cursor, previous_cursor})", async () => {
    const calls: unknown[][] = [];
    const client = stubClient("getAlertHistory", { results: [] }, calls);

    await getAlertHistoryMember(client, 42);
    expect(calls[0]?.[0]).toBe(42);
    expect(calls[0]?.[1]).toStrictEqual({
      page_size: null,
      next_cursor: null,
      previous_cursor: null,
    });

    await getAlertHistoryMember(client, 42, {
      page_size: 20,
      next_cursor: "n",
      previous_cursor: "p",
    });
    expect(calls[1]?.[1]).toStrictEqual({
      page_size: 20,
      next_cursor: "n",
      previous_cursor: "p",
    });
  });

  it("createAlert / updateAlert send the exclude_none dump", async () => {
    const alertCreateCalls: unknown[][] = [];
    await createAlertMember(
      stubClient("createAlert", alertJson(), alertCreateCalls),
      new CreateAlertParams({
        bookmark_id: 1,
        name: "A",
        condition: {},
        frequency: 60,
        paused: false,
        subscriptions: [],
      }),
    );
    // `notification_windows` is None → ABSENT, not null.
    expect(alertCreateCalls[0]?.[0]).toStrictEqual({
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
    expect(updateCalls[0]?.[1]).toStrictEqual({ name: "R" });
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

    expect(result).toStrictEqual({ status: "sent", extra: 1 });
    expect(calls[0]?.[0]).toStrictEqual({
      bookmark_id: 1,
      name: "A",
      condition: {},
      frequency: 60,
      paused: false,
      subscriptions: [],
    });
  });

  it("validateAlertsForBookmark sends the exclude_none dump", async () => {
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

    expect(calls[0]?.[0]).toStrictEqual({
      alert_ids: [1],
      bookmark_type: "insights",
      bookmark_params: { event: "Signup" },
    });
  });

  it("getAlert / deleteAlert / bulkDeleteAlerts / getAlertScreenshotUrl forward positionally", async () => {
    const alertGetCalls: unknown[][] = [];
    await getAlertMember(stubClient("getAlert", alertJson(), alertGetCalls), 7);
    expect(alertGetCalls[0]?.[0]).toBe(7);

    const delCalls: unknown[][] = [];
    await deleteAlertMember(stubClient("deleteAlert", undefined, delCalls), 9);
    expect(delCalls[0]?.[0]).toBe(9);

    const bulkCalls: unknown[][] = [];
    await bulkDeleteAlertsMember(
      stubClient("bulkDeleteAlerts", undefined, bulkCalls),
      [1, 2, 3],
    );
    expect(bulkCalls[0]?.[0]).toStrictEqual([1, 2, 3]);

    const shotCalls: unknown[][] = [];
    await getAlertScreenshotUrlMember(
      stubClient("getAlertScreenshotUrl", { signed_url: "u" }, shotCalls),
      "k/1.png",
    );
    expect(shotCalls[0]?.[0]).toBe("k/1.png");
  });
});
