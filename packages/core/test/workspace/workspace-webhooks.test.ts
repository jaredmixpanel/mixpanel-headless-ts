// Workspace webhook members (list/create/update/delete, testWebhook) over the
// injected fetch seam. Mirrors tests/unit/test_workspace_webhooks.py (both
// classes); the client is built over the OAuth session while the facade
// carries the service-account session, as Python does. Additive: the
// facade-to-client delegation contracts the wire suite cannot observe.

import { describe, expect, it } from "vitest";

import {
  CreateWebhookParams,
  ProjectWebhook,
  UpdateWebhookParams,
  WebhookMutationResult,
  WebhookTestParams,
  WebhookTestResult,
} from "../../src/types/entities/webhooks.js";
import { WebhookAuthType } from "../../src/types/enums.js";
import {
  createWebhook as createWebhookMember,
  deleteWebhook as deleteWebhookMember,
  listWebhooks as listWebhooksMember,
  testWebhook as testWebhookMember,
  updateWebhook as updateWebhookMember,
} from "../../src/workspace-members/annotations-webhooks-alerts.js";
import { ok } from "../../test-support/client-test-helpers.js";
import {
  makeFacadeWorkspace,
  stubClient,
} from "../../test-support/workspace-test-helpers.js";

/**
 * A minimal webhook dict matching the API shape (`_webhook_json`).
 *
 * @param id - Webhook UUID.
 * @param name - Webhook name.
 * @param url - Webhook URL.
 * @returns The payload record.
 */
function webhookJson(
  id = "wh-uuid-123",
  name = "Test Webhook",
  url = "https://example.com/hook",
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

/**
 * A webhook mutation-result dict (`_mutation_json`).
 *
 * @param id - Webhook UUID.
 * @param name - Webhook name.
 * @returns The payload record.
 */
function mutationJson(
  id = "wh-uuid-123",
  name = "Test Webhook",
): Record<string, unknown> {
  return { id, name };
}

// --- Workspace webhook CRUD ---

describe("Workspace webhook CRUD", () => {
  // python: TestWorkspaceWebhookCRUD
  it("listWebhooks() returns list of ProjectWebhook objects", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok([webhookJson("id-1", "Hook A"), webhookJson("id-2", "Hook B")]),
    );
    const webhooks = await ws.listWebhooks();

    expect(webhooks).toHaveLength(2);
    expect(webhooks[0]).toBeInstanceOf(ProjectWebhook);
    expect(webhooks[0]?.id).toBe("id-1");
    expect(webhooks[0]?.name).toBe("Hook A");
    expect(webhooks[1]?.id).toBe("id-2");
  });

  it("listWebhooks() returns empty list when no webhooks exist", async () => {
    const { ws } = makeFacadeWorkspace(() => ok([]));
    await expect(ws.listWebhooks()).resolves.toStrictEqual([]);
  });

  it("createWebhook() returns WebhookMutationResult", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok(mutationJson("new-id", "New Hook")),
    );
    const params = new CreateWebhookParams({
      name: "New Hook",
      url: "https://example.com",
    });
    const result = await ws.createWebhook(params);

    expect(result).toBeInstanceOf(WebhookMutationResult);
    expect(result.id).toBe("new-id");
    expect(result.name).toBe("New Hook");
  });

  it("createWebhook() sends auth fields when provided", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok(mutationJson("new-id", "Secured")),
    );
    const params = new CreateWebhookParams({
      name: "Secured",
      url: "https://example.com",
      auth_type: WebhookAuthType.BASIC,
      username: "user",
      password: "pass",
    });
    const result = await ws.createWebhook(params);

    expect(result).toBeInstanceOf(WebhookMutationResult);
    expect(result.name).toBe("Secured");
  });

  it("updateWebhook() returns WebhookMutationResult", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok(mutationJson("wh-uuid-123", "Renamed")),
    );
    const params = new UpdateWebhookParams({ name: "Renamed" });
    const result = await ws.updateWebhook("wh-uuid-123", params);

    expect(result).toBeInstanceOf(WebhookMutationResult);
    expect(result.name).toBe("Renamed");
  });

  it("deleteWebhook() resolves to undefined on success", async () => {
    const { ws } = makeFacadeWorkspace(() => ({ status: 204 }));
    await expect(ws.deleteWebhook("wh-uuid-123")).resolves.toBeUndefined();
  });

  it("deleteWebhook() handles 200 response too", async () => {
    const { ws } = makeFacadeWorkspace(() => ok({}));
    await expect(ws.deleteWebhook("wh-uuid-123")).resolves.toBeUndefined();
  });
});

// --- Workspace webhook test ---

describe("Workspace webhook test", () => {
  // python: TestWorkspaceWebhookTest
  it("testWebhook() returns WebhookTestResult on success", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok({ success: true, status_code: 200, message: "OK" }),
    );
    const params = new WebhookTestParams({ url: "https://example.com/hook" });
    const result = await ws.testWebhook(params);

    expect(result).toBeInstanceOf(WebhookTestResult);
    expect(result.success).toBe(true);
    expect(result.status_code).toBe(200);
    expect(result.message).toBe("OK");
  });

  it("testWebhook() returns failure result when test fails", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok({ success: false, status_code: 500, message: "Connection refused" }),
    );
    const params = new WebhookTestParams({ url: "https://bad.example.com" });
    const result = await ws.testWebhook(params);

    expect(result).toBeInstanceOf(WebhookTestResult);
    expect(result.success).toBe(false);
    expect(result.status_code).toBe(500);
  });
});

// --- Additive: delegation contracts the wire suite cannot observe ---

describe("ADDITIVE: webhook member delegation contracts", () => {
  it("listWebhooks / deleteWebhook forward positionally with no options bag", async () => {
    const listCalls: unknown[][] = [];
    await listWebhooksMember(stubClient("listWebhooks", [], listCalls));
    expect(listCalls[0]).toStrictEqual([]);

    const delCalls: unknown[][] = [];
    await deleteWebhookMember(
      stubClient("deleteWebhook", undefined, delCalls),
      "wh-1",
    );
    expect(delCalls[0]?.[0]).toBe("wh-1");
  });

  it("createWebhook sends the exclude_none dump", async () => {
    const calls: unknown[][] = [];
    const client = stubClient("createWebhook", mutationJson(), calls);
    await createWebhookMember(
      client,
      new CreateWebhookParams({ name: "H", url: "https://e.co" }),
    );

    // auth_type/username/password are None and must be absent.
    expect(calls[0]?.[0]).toStrictEqual({ name: "H", url: "https://e.co" });
  });

  it("updateWebhook forwards (webhook_id, exclude_none dump)", async () => {
    const calls: unknown[][] = [];
    const client = stubClient("updateWebhook", mutationJson(), calls);
    await updateWebhookMember(
      client,
      "wh-1",
      new UpdateWebhookParams({ name: "Renamed", is_enabled: false }),
    );

    expect(calls[0]?.[0]).toBe("wh-1");
    expect(calls[0]?.[1]).toStrictEqual({ name: "Renamed", is_enabled: false });
  });

  it("testWebhook sends the exclude_none dump", async () => {
    const calls: unknown[][] = [];
    const client = stubClient(
      "testWebhook",
      { success: true, status_code: 200, message: "OK" },
      calls,
    );
    await testWebhookMember(
      client,
      new WebhookTestParams({ url: "https://e.co" }),
    );

    expect(calls[0]?.[0]).toStrictEqual({ url: "https://e.co" });
  });
});
