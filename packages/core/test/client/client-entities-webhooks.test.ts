// Layer-3 translation — Phase-3 packet B4-C4 webhook locks.
// Source: tests/unit/test_api_client_webhooks.py (ALL classes — webhook
// CRUD list/create/update/delete + test connectivity).
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

/** The `_webhook_result` helper twin. */
function webhookResult(
  id = "wh-uuid-123",
  name = "Test Webhook",
  url = "https://example.com/webhook",
): Record<string, unknown> {
  return {
    id,
    name,
    url,
    is_enabled: true,
    auth_type: null,
    created: "2026-01-01T00:00:00Z",
    modified: "2026-01-01T00:00:00Z",
  };
}

/** The `_mutation_result` helper twin. */
function mutationResult(
  id = "wh-uuid-123",
  name = "Test Webhook",
): Record<string, unknown> {
  return { id, name };
}

describe("List webhooks", () => {
  // python: TestListWebhooks
  it("returns webhook list", async () => {
    // python: test_returns_webhook_list
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: [
          webhookResult("id-1", "Hook A"),
          webhookResult("id-2", "Hook B"),
        ],
      },
    }));
    const result = toNativeJson(await client.listWebhooks()) as Array<
      Record<string, unknown>
    >;
    expect(result).toHaveLength(2);
    expect(result[0]?.["id"]).toBe("id-1");
    expect(result[1]?.["name"]).toBe("Hook B");
  });

  it("URL path", async () => {
    // python: test_url_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listWebhooks();
    expect(capturedUrls[0]).toContain("/webhooks/");
  });

  it("empty result", async () => {
    // python: test_empty_result
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: [] },
    }));
    const result = await client.listWebhooks();
    expect(result).toStrictEqual([]);
  });

  it("uses get method", async () => {
    // python: test_uses_get_method
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listWebhooks();
    expect(capturedMethods[0]).toBe("GET");
  });
});

describe("Create webhook", () => {
  // python: TestCreateWebhook
  it("creates webhook", async () => {
    // python: test_creates_webhook
    const captured: Array<[string, Record<string, unknown>]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([
        request.method,
        parseBody(request.bodyText) as Record<string, unknown>,
      ]);
      return {
        status: 200,
        json: { status: "ok", results: mutationResult("new-id", "New Hook") },
      };
    });
    const result = toNativeJson(
      await client.createWebhook({
        name: "New Hook",
        url: "https://example.com",
      }),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("POST");
    expect(captured[0]?.[1]["name"]).toBe("New Hook");
    expect(result["id"]).toBe("new-id");
  });

  it("URL path", async () => {
    // python: test_url_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { status: "ok", results: mutationResult() },
      };
    });
    await client.createWebhook({ name: "X", url: "https://x.com" });
    expect(capturedUrls[0]).toContain("/webhooks/");
  });
});

describe("Update webhook", () => {
  // python: TestUpdateWebhook
  it("updates webhook", async () => {
    // python: test_updates_webhook
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
          results: mutationResult("wh-uuid-123", "Updated"),
        },
      };
    });
    const result = toNativeJson(
      await client.updateWebhook("wh-uuid-123", { name: "Updated" }),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("PATCH");
    expect(captured[0]?.[1]["name"]).toBe("Updated");
    expect(result["name"]).toBe("Updated");
  });

  it("URL path", async () => {
    // python: test_url_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { status: "ok", results: mutationResult() },
      };
    });
    await client.updateWebhook("wh-uuid-123", { name: "X" });
    expect(capturedUrls[0]).toContain("/webhooks/wh-uuid-123/");
  });
});

describe("Delete webhook", () => {
  // python: TestDeleteWebhook
  it("deletes webhook", async () => {
    // python: test_deletes_webhook
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 204 };
    });
    await client.deleteWebhook("wh-uuid-123");
    expect(capturedMethods[0]).toBe("DELETE");
  });

  it("URL path", async () => {
    // python: test_url_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 204 };
    });
    await client.deleteWebhook("wh-uuid-123");
    expect(capturedUrls[0]).toContain("/webhooks/wh-uuid-123/");
  });
});

describe("Test webhook", () => {
  // python: TestTestWebhook
  it("sends post", async () => {
    // python: test_sends_post
    const captured: Array<[string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, parseBody(request.bodyText)]);
      return {
        status: 200,
        json: {
          status: "ok",
          results: { success: true, status_code: 200, message: "OK" },
        },
      };
    });
    const result = toNativeJson(
      await client.testWebhook({ url: "https://example.com/hook" }),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("POST");
    expect(result["success"]).toBe(true);
    expect(result["status_code"]).toBe(200);
  });

  it("URL path", async () => {
    // python: test_url_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: {
          status: "ok",
          results: { success: true, status_code: 200, message: "OK" },
        },
      };
    });
    await client.testWebhook({ url: "https://example.com" });
    expect(capturedUrls[0]).toContain("/webhooks/test/");
  });

  it("failure result", async () => {
    // python: test_failure_result
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: {
          success: false,
          status_code: 500,
          message: "Connection refused",
        },
      },
    }));
    const result = toNativeJson(
      await client.testWebhook({ url: "https://bad.example.com" }),
    ) as Record<string, unknown>;
    expect(result["success"]).toBe(false);
    expect(result["status_code"]).toBe(500);
  });
});
