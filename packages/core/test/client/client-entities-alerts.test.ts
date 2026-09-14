// Layer-3 translation — Phase-3 packet B4-C4 alert locks.
// Source: tests/unit/test_api_client_alerts.py (ALL classes — alert
// CRUD list/create/get/update/delete/bulk_delete + operations
// count/history/test/screenshot/validate).
import { describe, expect, it } from "vitest";
import { toNativeJson } from "../../src/client/json-value.js";
import {
  createMockClient,
  makeSession,
} from "../../test-support/client-test-helpers.js";
import type { Session } from "../../src/auth/session.js";

/** The `oauth_credentials` fixture twin (test_api_client_alerts.py:27-30). */
function oauthCredentials(): Session {
  return makeSession({
    projectId: "12345",
    region: "us",
    oauthToken: "test-oauth-token",
  });
}

/** The `_alert_result` helper twin (:52-75). */
function alertResult(id = 1, name = "Test Alert"): Record<string, unknown> {
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

/** Parse a captured JSON request body (json.loads(request.content)). */
function parseBody(bodyText: string): unknown {
  return JSON.parse(bodyText) as unknown;
}

describe("TestListAlerts", () => {
  it("test_returns_alert_list", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: [alertResult(1, "Alert A"), alertResult(2, "Alert B")],
      },
    }));
    const result = toNativeJson(await client.listAlerts()) as Array<
      Record<string, unknown>
    >;
    expect(result).toHaveLength(2);
    expect(result[0]?.["id"]).toBe(1);
    expect(result[1]?.["name"]).toBe("Alert B");
  });

  it("test_uses_maybe_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listAlerts();
    expect(capturedUrls[0]).toContain("/alerts/custom/");
  });

  it("test_bookmark_id_param", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listAlerts({ bookmark_id: 42 });
    expect(capturedUrls[0]).toContain("bookmark_id=42");
  });

  it("test_skip_user_filter_param", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listAlerts({ skip_user_filter: true });
    expect(capturedUrls[0]).toContain("skip_user_filter=true");
  });

  it("test_empty_result", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: [] },
    }));
    const result = await client.listAlerts();
    expect(result).toEqual([]);
  });

  it("test_uses_get_method", async () => {
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listAlerts();
    expect(capturedMethods[0]).toBe("GET");
  });
});

describe("TestCreateAlert", () => {
  it("test_creates_alert", async () => {
    const captured: Array<[string, Record<string, unknown>]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([
        request.method,
        parseBody(request.bodyText) as Record<string, unknown>,
      ]);
      return {
        status: 200,
        json: { status: "ok", results: alertResult(99, "New Alert") },
      };
    });
    const result = toNativeJson(
      await client.createAlert({ name: "New Alert", frequency: 86400 }),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("POST");
    expect(captured[0]?.[1]["name"]).toBe("New Alert");
    expect(result["id"]).toBe(99);
  });

  it("test_url_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: alertResult() } };
    });
    await client.createAlert({ name: "X" });
    expect(capturedUrls[0]).toContain("/alerts/custom/");
  });
});

describe("TestGetAlert", () => {
  it("test_gets_alert_by_id", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { status: "ok", results: alertResult(42, "My Alert") },
      };
    });
    const result = toNativeJson(await client.getAlert(42)) as Record<
      string,
      unknown
    >;
    expect(capturedUrls[0]).toContain("/alerts/custom/42/");
    expect(result["id"]).toBe(42);
  });

  it("test_uses_get_method", async () => {
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 200, json: { status: "ok", results: alertResult() } };
    });
    await client.getAlert(1);
    expect(capturedMethods[0]).toBe("GET");
  });
});

describe("TestUpdateAlert", () => {
  it("test_updates_alert", async () => {
    const captured: Array<[string, Record<string, unknown>]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([
        request.method,
        parseBody(request.bodyText) as Record<string, unknown>,
      ]);
      return {
        status: 200,
        json: { status: "ok", results: alertResult(42, "Updated") },
      };
    });
    const result = toNativeJson(
      await client.updateAlert(42, { name: "Updated" }),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("PATCH");
    expect(captured[0]?.[1]["name"]).toBe("Updated");
    expect(result["name"]).toBe("Updated");
  });

  it("test_url_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: alertResult() } };
    });
    await client.updateAlert(42, { name: "X" });
    expect(capturedUrls[0]).toContain("/alerts/custom/42/");
  });
});

describe("TestDeleteAlert", () => {
  it("test_deletes_alert", async () => {
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 204 };
    });
    await client.deleteAlert(42);
    expect(capturedMethods[0]).toBe("DELETE");
  });

  it("test_url_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 204 };
    });
    await client.deleteAlert(42);
    expect(capturedUrls[0]).toContain("/alerts/custom/42/");
  });
});

describe("TestBulkDeleteAlerts", () => {
  it("test_bulk_deletes", async () => {
    const captured: Array<[string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, parseBody(request.bodyText)]);
      return { status: 200, json: { status: "ok", results: {} } };
    });
    await client.bulkDeleteAlerts([1, 2, 3]);
    expect(captured[0]?.[0]).toBe("POST");
    expect(captured[0]?.[1]).toEqual({ alert_ids: [1, 2, 3] });
  });

  it("test_url_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: {} } };
    });
    await client.bulkDeleteAlerts([1]);
    expect(capturedUrls[0]).toContain("/alerts/custom/bulk-delete/");
  });
});

describe("TestGetAlertCount", () => {
  it("test_gets_count", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: {
          anomaly_alerts_count: 5,
          alert_limit: 100,
          is_below_limit: true,
        },
      },
    }));
    const result = toNativeJson(await client.getAlertCount()) as Record<
      string,
      unknown
    >;
    expect(result["anomaly_alerts_count"]).toBe(5);
    expect(result["alert_limit"]).toBe(100);
  });

  it("test_url_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: {
          status: "ok",
          results: {
            anomaly_alerts_count: 0,
            alert_limit: 10,
            is_below_limit: true,
          },
        },
      };
    });
    await client.getAlertCount();
    expect(capturedUrls[0]).toContain("/alerts/custom/alert-count/");
  });

  it("test_with_type_param", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: {
          status: "ok",
          results: {
            anomaly_alerts_count: 2,
            alert_limit: 50,
            is_below_limit: true,
          },
        },
      };
    });
    await client.getAlertCount({ alert_type: "anomaly" });
    expect(capturedUrls[0]).toContain("type=anomaly");
  });
});

describe("TestGetAlertHistory", () => {
  it("test_gets_history", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: {
          results: [{ fired: true, timestamp: "2026-01-01" }],
          pagination: { page_size: 20 },
        },
      },
    }));
    const result = toNativeJson(await client.getAlertHistory(42)) as Record<
      string,
      unknown
    >;
    expect(result["results"]).toHaveLength(1);
    expect((result["pagination"] as Record<string, unknown>)["page_size"]).toBe(
      20,
    );
  });

  it("test_url_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: {
          status: "ok",
          results: { results: [], pagination: { page_size: 20 } },
        },
      };
    });
    await client.getAlertHistory(42);
    expect(capturedUrls[0]).toContain("/alerts/custom/42/history/");
  });

  it("test_with_pagination_params", async () => {
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
    await client.getAlertHistory(42, { page_size: 10, next_cursor: "abc" });
    const url = capturedUrls[0] ?? "";
    expect(url).toContain("page_size=10");
    expect(url).toContain("next_cursor=abc");
  });
});

describe("TestTestAlert", () => {
  it("test_sends_test", async () => {
    const captured: Array<[string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, parseBody(request.bodyText)]);
      return {
        status: 200,
        json: { status: "ok", results: { status: "sent" } },
      };
    });
    const result = toNativeJson(
      await client.testAlert({ name: "Test", frequency: 86400 }),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("POST");
    expect(result["status"]).toBe("sent");
  });

  it("test_url_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: {} } };
    });
    await client.testAlert({ name: "X" });
    expect(capturedUrls[0]).toContain("/alerts/custom/test/");
  });
});

describe("TestGetAlertScreenshotUrl", () => {
  it("test_gets_url", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: { signed_url: "https://storage.googleapis.com/abc.png" },
      },
    }));
    const result = toNativeJson(
      await client.getAlertScreenshotUrl("screenshots/abc.png"),
    ) as Record<string, unknown>;
    expect(result["signed_url"]).toBe("https://storage.googleapis.com/abc.png");
  });

  it("test_url_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { status: "ok", results: { signed_url: "https://example.com" } },
      };
    });
    await client.getAlertScreenshotUrl("key");
    expect(capturedUrls[0]).toContain("/alerts/custom/screenshot/");
    expect(capturedUrls[0]).toContain("gcs_key=key");
  });
});

describe("TestValidateAlertsForBookmark", () => {
  it("test_validates", async () => {
    const captured: Array<[string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, parseBody(request.bodyText)]);
      return {
        status: 200,
        json: {
          status: "ok",
          results: { alert_validations: [], invalid_count: 0 },
        },
      };
    });
    const result = toNativeJson(
      await client.validateAlertsForBookmark({
        alert_ids: [1, 2],
        bookmark_type: "insights",
        bookmark_params: { event: "Signup" },
      }),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("POST");
    expect(result["invalid_count"]).toBe(0);
  });

  it("test_url_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: {
          status: "ok",
          results: { alert_validations: [], invalid_count: 0 },
        },
      };
    });
    await client.validateAlertsForBookmark({ alert_ids: [1] });
    expect(capturedUrls[0]).toContain(
      "/alerts/custom/validate-alerts-for-bookmark/",
    );
  });
});
