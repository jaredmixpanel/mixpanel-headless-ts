// Layer-3 translation — Phase-3 packet B4-C5 governance locks.
// Source: tests/unit/test_api_client_governance.py (ALL classes —
// schema enforcement :60-350, audit :351-594, anomalies :595-856,
// deletion requests :857-1097).
import { describe, expect, it } from "vitest";

import type { Session } from "../../src/auth/session.js";
import { toNativeJson } from "../../src/client/json-value.js";
import { MixpanelHeadlessError } from "../../src/errors.js";
import {
  createMockClient,
  makeSession,
} from "../../test-support/client-test-helpers.js";

/** The `oauth_credentials` fixture twin. */
function oauthCredentials(): Session {
  return makeSession({
    projectId: "12345",
    region: "us",
    oauthToken: "test-oauth-token",
  });
}

/** Parse a captured JSON request body (json.loads(request.content)). */
function parseBody(bodyText: string): unknown {
  return JSON.parse(bodyText) as unknown;
}

/** The `_anomaly_json` helper twin (:556-592). */
function anomalyJson(
  id = 1,
  eventName = "Signup",
  status = "open",
  anomalyClass = "Event",
): Record<string, unknown> {
  return {
    id,
    timestamp: "2026-01-01T00:00:00Z",
    actualCount: 5000,
    predictedUpper: 3000,
    predictedLower: 1000,
    percentVariance: "66.7%",
    status,
    project: 12345,
    event: 1,
    eventName,
    property: null,
    propertyName: null,
    metric: null,
    metricName: null,
    metricType: null,
    primaryType: null,
    driftTypes: null,
    anomalyClass,
  };
}

/** The `_deletion_request_json` helper twin (:828-854). */
function deletionRequestJson(
  id = 1,
  eventName = "bad_event",
  status = "Submitted",
): Record<string, unknown> {
  return {
    id,
    displayName: null,
    eventName,
    fromDate: "2026-01-01",
    toDate: "2026-01-31",
    filters: null,
    status,
    deletedEventsCount: 0,
    created: "2026-01-15T00:00:00Z",
    requestingUser: { id: 1, email: "admin@example.com" },
  };
}

// ---------------------------------------------------------------------------
// Domain 14 — Schema Enforcement
// ---------------------------------------------------------------------------

describe("TestGetSchemaEnforcement", () => {
  it("test_returns_dict", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: {
          id: 1,
          ruleEvent: "Warn and Accept",
          state: "ingested",
          notificationEmails: ["admin@example.com"],
          events: [],
          commonProperties: [],
          userProperties: [],
        },
      },
    }));
    const result = toNativeJson(await client.getSchemaEnforcement()) as Record<
      string,
      unknown
    >;
    expect(result["ruleEvent"]).toBe("Warn and Accept");
    expect(result["state"]).toBe("ingested");
  });

  it("test_with_fields_param", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: {
          status: "ok",
          results: { ruleEvent: "Warn and Accept", state: "ingested" },
        },
      };
    });
    await client.getSchemaEnforcement({ fields: "ruleEvent,state" });
    const url = capturedUrls[0] ?? "";
    expect(url.includes("fields=ruleEvent") || url.includes("fields=")).toBe(
      true,
    );
  });

  it("test_uses_get_method", async () => {
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 200, json: { status: "ok", results: {} } };
    });
    await client.getSchemaEnforcement();
    expect(capturedMethods[0]).toBe("GET");
  });

  it("test_uses_correct_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: {} } };
    });
    await client.getSchemaEnforcement();
    expect(capturedUrls[0]).toContain("/data-definitions/schema/");
  });
});

describe("TestInitSchemaEnforcement", () => {
  it("test_returns_dict", async () => {
    const captured: Array<[string, Record<string, unknown>]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([
        request.method,
        parseBody(request.bodyText) as Record<string, unknown>,
      ]);
      return {
        status: 200,
        json: {
          status: "ok",
          results: { id: 1, ruleEvent: "Warn and Drop", state: "planned" },
        },
      };
    });
    const result = toNativeJson(
      await client.initSchemaEnforcement({ ruleEvent: "Warn and Drop" }),
    ) as Record<string, unknown>;
    expect(result["ruleEvent"]).toBe("Warn and Drop");
    expect(captured[0]?.[0]).toBe("POST");
    expect(captured[0]?.[1]["ruleEvent"]).toBe("Warn and Drop");
  });

  it("test_uses_correct_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: {} } };
    });
    await client.initSchemaEnforcement({ ruleEvent: "Warn and Accept" });
    expect(capturedUrls[0]).toContain("/data-definitions/schema/");
  });
});

describe("TestUpdateSchemaEnforcement", () => {
  it("test_returns_dict", async () => {
    const captured: Array<[string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, parseBody(request.bodyText)]);
      return {
        status: 200,
        json: {
          status: "ok",
          results: {
            ruleEvent: "Warn and Hide",
            notificationEmails: ["new@example.com"],
          },
        },
      };
    });
    const result = toNativeJson(
      await client.updateSchemaEnforcement({
        ruleEvent: "Warn and Hide",
        notificationEmails: ["new@example.com"],
      }),
    ) as Record<string, unknown>;
    expect(result["ruleEvent"]).toBe("Warn and Hide");
    expect(captured[0]?.[0]).toBe("PATCH");
  });

  it("test_partial_body", async () => {
    const capturedBodies: unknown[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedBodies.push(parseBody(request.bodyText));
      return { status: 200, json: { status: "ok", results: {} } };
    });
    await client.updateSchemaEnforcement({
      notificationEmails: ["only@example.com"],
    });
    expect(capturedBodies[0]).toStrictEqual({
      notificationEmails: ["only@example.com"],
    });
  });
});

describe("TestReplaceSchemaEnforcement", () => {
  it("test_returns_dict", async () => {
    const captured: Array<[string, unknown]> = [];
    const fullBody = {
      ruleEvent: "Warn and Drop",
      notificationEmails: ["admin@example.com"],
      events: [{ name: "Signup" }],
      commonProperties: [{ name: "utm_source" }],
      userProperties: [{ name: "$email" }],
    };
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, parseBody(request.bodyText)]);
      return { status: 200, json: { status: "ok", results: fullBody } };
    });
    const result = toNativeJson(
      await client.replaceSchemaEnforcement(fullBody),
    ) as Record<string, unknown>;
    expect(result["ruleEvent"]).toBe("Warn and Drop");
    expect(captured[0]?.[0]).toBe("PUT");
    expect(captured[0]?.[1]).toStrictEqual(fullBody);
  });

  it("test_uses_correct_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: {} } };
    });
    await client.replaceSchemaEnforcement({ ruleEvent: "Warn and Accept" });
    expect(capturedUrls[0]).toContain("/data-definitions/schema/");
  });
});

describe("TestDeleteSchemaEnforcement", () => {
  it("test_returns_dict", async () => {
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return {
        status: 200,
        json: { status: "ok", results: { deleted: true } },
      };
    });
    const result = toNativeJson(
      await client.deleteSchemaEnforcement(),
    ) as Record<string, unknown>;
    expect(result["deleted"]).toBe(true);
    expect(capturedMethods[0]).toBe("DELETE");
  });

  it("test_uses_correct_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: {} } };
    });
    await client.deleteSchemaEnforcement();
    expect(capturedUrls[0]).toContain("/data-definitions/schema/");
  });
});

// ---------------------------------------------------------------------------
// Domain 15 — Data Auditing
// ---------------------------------------------------------------------------

describe("TestRunAudit", () => {
  it("test_returns_parsed_response", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: [
          [
            { violation: "Unexpected Event", name: "bad_event", count: 42 },
            {
              violation: "Missing Property",
              name: "utm_source",
              event: "Signup",
              count: 10,
            },
          ],
          { computed_at: "2026-01-01T00:00:00Z" },
        ],
      },
    }));
    const result = toNativeJson(await client.runAudit()) as [
      Array<Record<string, unknown>>,
      Record<string, unknown>,
    ];
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveLength(2);
    expect(result[0][0]?.["violation"]).toBe("Unexpected Event");
    expect(result[1]["computed_at"]).toBe("2026-01-01T00:00:00Z");
  });

  it("test_uses_get_method", async () => {
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return {
        status: 200,
        json: { status: "ok", results: [[], { computed_at: "2026-01-01" }] },
      };
    });
    await client.runAudit();
    expect(capturedMethods[0]).toBe("GET");
  });

  it("test_uses_correct_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { status: "ok", results: [[], { computed_at: "2026-01-01" }] },
      };
    });
    await client.runAudit();
    expect(capturedUrls[0]).toContain("/data-definitions/audit/");
  });

  it("test_empty_violations", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: [[], { computed_at: "2026-01-01T12:00:00Z" }],
      },
    }));
    const result = toNativeJson(await client.runAudit()) as [
      unknown[],
      Record<string, unknown>,
    ];
    expect(result[0]).toStrictEqual([]);
    expect(result[1]["computed_at"]).toBe("2026-01-01T12:00:00Z");
  });

  it("test_non_list_results_raises", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: { unexpected: "dict" } },
    }));
    await expect(client.runAudit()).rejects.toBeInstanceOf(
      MixpanelHeadlessError,
    );
    await expect(client.runAudit()).rejects.toThrow("expected list");
  });
});

describe("TestRunAuditEventsOnly", () => {
  it("test_returns_parsed_response", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: [
          [{ violation: "Unexpected Event", name: "rogue_event", count: 100 }],
          { computed_at: "2026-01-02T00:00:00Z" },
        ],
      },
    }));
    const result = toNativeJson(await client.runAuditEventsOnly()) as [
      Array<Record<string, unknown>>,
      Record<string, unknown>,
    ];
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0][0]?.["violation"]).toBe("Unexpected Event");
    expect(result[1]["computed_at"]).toBe("2026-01-02T00:00:00Z");
  });

  it("test_uses_correct_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { status: "ok", results: [[], { computed_at: "2026-01-01" }] },
      };
    });
    await client.runAuditEventsOnly();
    expect(capturedUrls[0]).toContain("/data-definitions/audit-events-only/");
  });

  it("test_uses_get_method", async () => {
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return {
        status: 200,
        json: { status: "ok", results: [[], { computed_at: "2026-01-01" }] },
      };
    });
    await client.runAuditEventsOnly();
    expect(capturedMethods[0]).toBe("GET");
  });

  it("test_non_list_results_raises", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: { unexpected: "dict" } },
    }));
    await expect(client.runAuditEventsOnly()).rejects.toBeInstanceOf(
      MixpanelHeadlessError,
    );
    await expect(client.runAuditEventsOnly()).rejects.toThrow("expected list");
  });
});

// ---------------------------------------------------------------------------
// Domain 15 — Data Volume Anomalies
// ---------------------------------------------------------------------------

describe("TestListDataVolumeAnomalies", () => {
  it("test_returns_list", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: {
          anomalies: [anomalyJson(1, "Signup"), anomalyJson(2, "Login")],
        },
      },
    }));
    const result = toNativeJson(
      await client.listDataVolumeAnomalies(),
    ) as Array<Record<string, unknown>>;
    expect(result).toHaveLength(2);
    expect(result[0]?.["eventName"]).toBe("Signup");
    expect(result[1]?.["eventName"]).toBe("Login");
  });

  it("test_with_query_params", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { status: "ok", results: { anomalies: [anomalyJson(1)] } },
      };
    });
    await client.listDataVolumeAnomalies({ query_params: { status: "open" } });
    expect(capturedUrls[0]).toContain("status=open");
  });

  it("test_empty_list", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: { anomalies: [] } },
    }));
    const result = await client.listDataVolumeAnomalies();
    expect(result).toStrictEqual([]);
  });

  it("test_uses_get_method", async () => {
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return {
        status: 200,
        json: { status: "ok", results: { anomalies: [] } },
      };
    });
    await client.listDataVolumeAnomalies();
    expect(capturedMethods[0]).toBe("GET");
  });

  it("test_uses_correct_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { status: "ok", results: { anomalies: [] } },
      };
    });
    await client.listDataVolumeAnomalies();
    expect(capturedUrls[0]).toContain(
      "/data-definitions/data-volume-anomalies/",
    );
  });

  it("test_missing_anomalies_key_raises", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: { items: [] } },
    }));
    await expect(client.listDataVolumeAnomalies()).rejects.toBeInstanceOf(
      MixpanelHeadlessError,
    );
    await expect(client.listDataVolumeAnomalies()).rejects.toThrow(
      "missing 'anomalies' key",
    );
  });
});

describe("TestUpdateAnomaly", () => {
  it("test_returns_dict", async () => {
    const captured: Array<[string, Record<string, unknown>]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([
        request.method,
        parseBody(request.bodyText) as Record<string, unknown>,
      ]);
      return {
        status: 200,
        json: { status: "ok", results: { updated: true } },
      };
    });
    const result = toNativeJson(
      await client.updateAnomaly({
        id: 123,
        status: "dismissed",
        anomalyClass: "Event",
      }),
    ) as Record<string, unknown>;
    expect(result["updated"]).toBe(true);
    expect(captured[0]?.[0]).toBe("PATCH");
    expect(captured[0]?.[1]["id"]).toBe(123);
    expect(captured[0]?.[1]["status"]).toBe("dismissed");
    expect(captured[0]?.[1]["anomalyClass"]).toBe("Event");
  });

  it("test_uses_correct_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: {} } };
    });
    await client.updateAnomaly({
      id: 1,
      status: "dismissed",
      anomalyClass: "Event",
    });
    const url = capturedUrls[0] ?? "";
    expect(url).toContain("/data-definitions/data-volume-anomalies/");
    expect(url).not.toContain("/bulk/");
  });
});

describe("TestBulkUpdateAnomalies", () => {
  it("test_returns_dict", async () => {
    const captured: Array<[string, Record<string, unknown>]> = [];
    const body = {
      anomalies: [
        { id: 1, anomalyClass: "Event" },
        { id: 2, anomalyClass: "Property" },
      ],
      status: "dismissed",
    };
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([
        request.method,
        parseBody(request.bodyText) as Record<string, unknown>,
      ]);
      return { status: 200, json: { status: "ok", results: { updated: 2 } } };
    });
    const result = toNativeJson(
      await client.bulkUpdateAnomalies(body),
    ) as Record<string, unknown>;
    expect(result["updated"]).toBe(2);
    expect(captured[0]?.[0]).toBe("PATCH");
    expect(captured[0]?.[1]["anomalies"]).toHaveLength(2);
  });

  it("test_uses_correct_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: {} } };
    });
    await client.bulkUpdateAnomalies({
      anomalies: [{ id: 1, anomalyClass: "Event" }],
      status: "dismissed",
    });
    expect(capturedUrls[0]).toContain(
      "/data-definitions/data-volume-anomalies/bulk/",
    );
  });
});

// ---------------------------------------------------------------------------
// Domain 15 — Event Deletion Requests
// ---------------------------------------------------------------------------

describe("TestListDeletionRequests", () => {
  it("test_returns_list", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: [
          deletionRequestJson(1, "event_a"),
          deletionRequestJson(2, "event_b"),
        ],
      },
    }));
    const result = toNativeJson(await client.listDeletionRequests()) as Array<
      Record<string, unknown>
    >;
    expect(result).toHaveLength(2);
    expect(result[0]?.["eventName"]).toBe("event_a");
    expect(result[1]?.["eventName"]).toBe("event_b");
  });

  it("test_uses_get_method", async () => {
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listDeletionRequests();
    expect(capturedMethods[0]).toBe("GET");
  });

  it("test_uses_correct_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listDeletionRequests();
    expect(capturedUrls[0]).toContain(
      "/data-definitions/events/deletion-requests/",
    );
  });
});

describe("TestCreateDeletionRequest", () => {
  it("test_returns_list", async () => {
    const captured: Array<[string, Record<string, unknown>]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([
        request.method,
        parseBody(request.bodyText) as Record<string, unknown>,
      ]);
      return {
        status: 200,
        json: {
          status: "ok",
          results: [
            deletionRequestJson(1, "existing_event"),
            deletionRequestJson(2, "new_event"),
          ],
        },
      };
    });
    const result = toNativeJson(
      await client.createDeletionRequest({
        eventName: "new_event",
        fromDate: "2026-01-01",
        toDate: "2026-01-31",
      }),
    ) as unknown[];
    expect(result).toHaveLength(2);
    expect(captured[0]?.[0]).toBe("POST");
    expect(captured[0]?.[1]["eventName"]).toBe("new_event");
  });

  it("test_uses_correct_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.createDeletionRequest({
      eventName: "e",
      fromDate: "2026-01-01",
      toDate: "2026-01-31",
    });
    expect(capturedUrls[0]).toContain(
      "/data-definitions/events/deletion-requests/",
    );
  });
});

describe("TestCancelDeletionRequest", () => {
  it("test_returns_list", async () => {
    const captured: Array<[string, Record<string, unknown>]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([
        request.method,
        parseBody(request.bodyText) as Record<string, unknown>,
      ]);
      return {
        status: 200,
        json: { status: "ok", results: [deletionRequestJson(1, "remaining")] },
      };
    });
    const result = toNativeJson(
      await client.cancelDeletionRequest(42),
    ) as unknown[];
    expect(result).toHaveLength(1);
    expect(captured[0]?.[0]).toBe("DELETE");
    expect(captured[0]?.[1]["id"]).toBe(42);
  });

  it("test_sends_json_body_with_id", async () => {
    const capturedBodies: unknown[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedBodies.push(parseBody(request.bodyText));
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.cancelDeletionRequest(99);
    expect(capturedBodies[0]).toStrictEqual({ id: 99 });
  });

  it("test_uses_correct_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.cancelDeletionRequest(1);
    expect(capturedUrls[0]).toContain(
      "/data-definitions/events/deletion-requests/",
    );
  });
});

describe("TestPreviewDeletionFilters", () => {
  it("test_returns_list", async () => {
    const captured: Array<[string, Record<string, unknown>]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([
        request.method,
        parseBody(request.bodyText) as Record<string, unknown>,
      ]);
      return {
        status: 200,
        json: {
          status: "ok",
          results: [
            { property: "country", op: "equals", value: "US" },
            { property: "platform", op: "equals", value: "iOS" },
          ],
        },
      };
    });
    const result = toNativeJson(
      await client.previewDeletionFilters({
        eventName: "Signup",
        fromDate: "2026-01-01",
        toDate: "2026-01-31",
        filters: { country: "US" },
      }),
    ) as unknown[];
    expect(result).toHaveLength(2);
    expect(captured[0]?.[0]).toBe("POST");
    expect(captured[0]?.[1]["eventName"]).toBe("Signup");
  });

  it("test_uses_correct_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.previewDeletionFilters({
      eventName: "e",
      fromDate: "2026-01-01",
      toDate: "2026-01-31",
    });
    expect(capturedUrls[0]).toContain(
      "/data-definitions/events/deletion-requests/preview-filters/",
    );
  });
});
