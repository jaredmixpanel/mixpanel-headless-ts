/**
 * Webhook CRUD + connectivity-test wire methods (App API) — Phase-3
 * packet B4-C4 port of the `MixpanelAPIClient` webhooks range
 * (`api_client.py:5920-6072`).
 *
 * All methods route through B0 `appRequest` over `maybe_scoped_path`
 * (R10.8). Webhook IDs are UUID STRINGS (R3-family — unlike the int
 * IDs on annotations/alerts). Results are returned verbatim after the
 * source's isinstance guard (Caution #11).
 */

import { appRequest } from "../../client/app-request.js";
import type { ClientCore } from "../../client/client.js";
import type { JsonValue } from "../../client/json-value.js";
import { maybeScopedPath } from "../../client/scope.js";
import { expectListResult, expectRecordResult } from "./shared.js";

/** The C4 webhook method surface (mixed into `MixpanelClient`). */
export interface WebhookMethods {
  /**
   * List webhooks (`list_webhooks`, `api_client.py:5920-5948` — GET
   * `webhooks/`).
   *
   * @param signal - Optional cancellation signal.
   * @returns The webhook list verbatim.
   * @throws MixpanelHeadlessError - Non-list response.
   * @throws AuthenticationError | RateLimitError | QueryError |
   *   ServerError - Per the B0 `appRequest` contract.
   */
  listWebhooks: (signal?: AbortSignal) => Promise<JsonValue[]>;

  /**
   * Create a webhook (`create_webhook`, `:5950-5981` — POST
   * `webhooks/`).
   *
   * @param body - Webhook creation parameters (name, url, ...).
   * @param signal - Optional cancellation signal.
   * @returns The mutation result dict (id + name).
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  createWebhook: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Update a webhook (`update_webhook`, `:5983-6015` — PATCH
   * `webhooks/{id}/`).
   *
   * @param webhookId - Webhook UUID string.
   * @param body - Fields to update.
   * @param signal - Optional cancellation signal.
   * @returns The mutation result dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  updateWebhook: (
    webhookId: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Delete a webhook (`delete_webhook`, `:6017-6039`).
   *
   * @param webhookId - Webhook UUID string.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   */
  deleteWebhook: (webhookId: string, signal?: AbortSignal) => Promise<void>;

  /**
   * Test webhook connectivity (`test_webhook`, `:6041-6072` — POST
   * `webhooks/test/`).
   *
   * @param body - Webhook test parameters.
   * @param signal - Optional cancellation signal.
   * @returns The test result dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  testWebhook: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;
}

/**
 * Build the C4 webhook methods over the C1 core seam.
 *
 * @param core - The shared client internals seam.
 * @returns The method bag.
 */
export function createWebhookMethods(core: ClientCore): WebhookMethods {
  /** `self.maybe_scoped_path(...)` over the CURRENT pin (call-time). */
  const scopedPath = (domainPath: string): string =>
    maybeScopedPath(domainPath, {
      projectId: core.projectId(),
      workspaceId: core.workspaceId(),
    });

  return {
    listWebhooks: async (signal?: AbortSignal): Promise<JsonValue[]> => {
      const path = scopedPath("webhooks/");
      const result = await appRequest(core.appDeps(signal), "GET", path);
      return expectListResult(result, "list_webhooks");
    },

    createWebhook: async (
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath("webhooks/");
      const result = await appRequest(core.appDeps(signal), "POST", path, {
        jsonBody: body,
      });
      return expectRecordResult(result, "create_webhook");
    },

    updateWebhook: async (
      webhookId: string,
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath(`webhooks/${webhookId}/`);
      const result = await appRequest(core.appDeps(signal), "PATCH", path, {
        jsonBody: body,
      });
      return expectRecordResult(result, "update_webhook");
    },

    deleteWebhook: async (
      webhookId: string,
      signal?: AbortSignal,
    ): Promise<void> => {
      const path = scopedPath(`webhooks/${webhookId}/`);
      await appRequest(core.appDeps(signal), "DELETE", path);
    },

    testWebhook: async (
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath("webhooks/test/");
      const result = await appRequest(core.appDeps(signal), "POST", path, {
        jsonBody: body,
      });
      return expectRecordResult(result, "test_webhook");
    },
  };
}
