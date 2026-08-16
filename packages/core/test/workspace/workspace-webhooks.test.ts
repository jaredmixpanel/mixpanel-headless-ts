// B6-W5 Layer-3 translation (packet `b6-packets.md` §7) of the WHOLE
// of `tests/unit/test_workspace_webhooks.py` (326 lines, 2 classes):
// `TestWorkspaceWebhookCRUD` (:141) and `TestWorkspaceWebhookTest`
// (:274).
//
// Python's `httpx.MockTransport` handler becomes the injected-fetch
// `fakeTransport` seam; `_make_workspace(temp_dir, handler)` becomes
// `makeWorkspace(handler)` — the client is built over the OAuth
// session while the facade carries the service-account `_TEST_SESSION`,
// exactly as Python does. `temp_dir` has no TS analog and is dropped.
//
// ADDITIVE section (clearly headed, never substituting for a
// translated Python assertion — B5 Caution #13 / packet §0.2): the
// facade-to-client delegation contracts (argument spelling + the
// `model_dump(exclude_none=True)` body at `workspace.py:6738`, `:6774`,
// `:6830`) that the wire suite above cannot observe.

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

/** A canned-response handler (the `httpx.MockTransport` handler twin). */
type Handler = (request: CapturedFetchRequest) => CannedResponse;

/** The OAuth session the mock client is built over. */
const CLIENT_SESSION = makeSession({
  projectId: "12345",
  region: "us",
  oauthToken: "test-token",
});

/** The canonical service-account facade session (`_TEST_SESSION`). */
const FACADE_SESSION = makeSession({
  projectId: "12345",
  region: "us",
  username: "test_user",
  secret: "test_secret",
});

/**
 * Build a Workspace whose client routes through `handler`
 * (`_make_workspace`).
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
 * A minimal webhook dict matching the API shape (`_webhook_json`,
 * :92-116).
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
 * A webhook mutation-result dict (`_mutation_json`, :119-132).
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
// TestWorkspaceWebhookCRUD (:141)
// =============================================================================

describe("TestWorkspaceWebhookCRUD", () => {
  it("list_webhooks() returns list of ProjectWebhook objects", async () => {
    const { ws } = makeWorkspace(() =>
      ok([webhookJson("id-1", "Hook A"), webhookJson("id-2", "Hook B")]),
    );
    const webhooks = await ws.listWebhooks();

    expect(webhooks).toHaveLength(2);
    expect(webhooks[0]).toBeInstanceOf(ProjectWebhook);
    expect(webhooks[0]?.id).toBe("id-1");
    expect(webhooks[0]?.name).toBe("Hook A");
    expect(webhooks[1]?.id).toBe("id-2");
  });

  it("list_webhooks() returns empty list when no webhooks exist", async () => {
    const { ws } = makeWorkspace(() => ok([]));
    expect(await ws.listWebhooks()).toEqual([]);
  });

  it("create_webhook() returns WebhookMutationResult", async () => {
    const { ws } = makeWorkspace(() => ok(mutationJson("new-id", "New Hook")));
    const params = new CreateWebhookParams({
      name: "New Hook",
      url: "https://example.com",
    });
    const result = await ws.createWebhook(params);

    expect(result).toBeInstanceOf(WebhookMutationResult);
    expect(result.id).toBe("new-id");
    expect(result.name).toBe("New Hook");
  });

  it("create_webhook() sends auth fields when provided", async () => {
    const { ws } = makeWorkspace(() => ok(mutationJson("new-id", "Secured")));
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

  it("update_webhook() returns WebhookMutationResult", async () => {
    const { ws } = makeWorkspace(() =>
      ok(mutationJson("wh-uuid-123", "Renamed")),
    );
    const params = new UpdateWebhookParams({ name: "Renamed" });
    const result = await ws.updateWebhook("wh-uuid-123", params);

    expect(result).toBeInstanceOf(WebhookMutationResult);
    expect(result.name).toBe("Renamed");
  });

  it("delete_webhook() returns None on success", async () => {
    const { ws } = makeWorkspace(() => ({ status: 204 }));
    await expect(ws.deleteWebhook("wh-uuid-123")).resolves.toBeUndefined();
  });

  it("delete_webhook() handles 200 response too", async () => {
    const { ws } = makeWorkspace(() => ok({}));
    await expect(ws.deleteWebhook("wh-uuid-123")).resolves.toBeUndefined();
  });
});

// =============================================================================
// TestWorkspaceWebhookTest (:274)
// =============================================================================

describe("TestWorkspaceWebhookTest", () => {
  it("test_webhook() returns WebhookTestResult on success", async () => {
    const { ws } = makeWorkspace(() =>
      ok({ success: true, status_code: 200, message: "OK" }),
    );
    const params = new WebhookTestParams({ url: "https://example.com/hook" });
    const result = await ws.testWebhook(params);

    expect(result).toBeInstanceOf(WebhookTestResult);
    expect(result.success).toBe(true);
    expect(result.status_code).toBe(200);
    expect(result.message).toBe("OK");
  });

  it("test_webhook() returns failure result when test fails", async () => {
    const { ws } = makeWorkspace(() =>
      ok({ success: false, status_code: 500, message: "Connection refused" }),
    );
    const params = new WebhookTestParams({ url: "https://bad.example.com" });
    const result = await ws.testWebhook(params);

    expect(result).toBeInstanceOf(WebhookTestResult);
    expect(result.success).toBe(false);
    expect(result.status_code).toBe(500);
  });
});

// =============================================================================
// ADDITIVE — delegation contracts (packet §0.2 / B5 Caution #13).
// =============================================================================

describe("ADDITIVE: webhook member delegation contracts", () => {
  it("listWebhooks / deleteWebhook forward positionally with no options bag", async () => {
    const listCalls: unknown[][] = [];
    await listWebhooksMember(stubClient("listWebhooks", [], listCalls));
    expect(listCalls[0]).toEqual([]);

    const delCalls: unknown[][] = [];
    await deleteWebhookMember(
      stubClient("deleteWebhook", undefined, delCalls),
      "wh-1",
    );
    expect(delCalls[0]?.[0]).toBe("wh-1");
  });

  it("createWebhook sends the exclude_none dump (`workspace.py:6738`)", async () => {
    const calls: unknown[][] = [];
    const client = stubClient("createWebhook", mutationJson(), calls);
    await createWebhookMember(
      client,
      new CreateWebhookParams({ name: "H", url: "https://e.co" }),
    );

    // auth_type/username/password are None and MUST be absent (R3.5).
    expect(calls[0]?.[0]).toEqual({ name: "H", url: "https://e.co" });
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
    expect(calls[0]?.[1]).toEqual({ name: "Renamed", is_enabled: false });
  });

  it("testWebhook sends the exclude_none dump (`workspace.py:6830`)", async () => {
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

    expect(calls[0]?.[0]).toEqual({ url: "https://e.co" });
  });
});
