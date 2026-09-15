/**
 * Webhook CRUD and connectivity-test wire methods on the App API
 * (`webhooks/`, workspace-scoped through `maybe_scoped_path`). Webhook
 * ids are UUID strings, unlike the integer ids on annotations and
 * alerts; results come back verbatim after Python's isinstance guard.
 *
 * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.list_webhooks
 */

import { appRequest } from "../../client/app-request.js";
import type { ClientCore } from "../../client/core.js";
import type { JsonValue } from "../../client/json-value.js";
import { maybeScopedPath } from "../../client/scope.js";
import { expectListResult, expectRecordResult } from "./shared.js";

/** Webhook methods mixed into `MixpanelClient`. */
export interface WebhookMethods {
  /**
   * List webhooks (`list_webhooks` — GET
   * `webhooks/`).
   *
   * @param signal - Optional cancellation signal.
   * @returns The webhook list verbatim.
   * @throws MixpanelHeadlessError - Non-list response.
   * @throws AuthenticationError | RateLimitError | QueryError |
   *   ServerError - Per the `appRequest` contract.
   */
  listWebhooks: (signal?: AbortSignal) => Promise<JsonValue[]>;

  /**
   * Create a webhook (`create_webhook` — POST
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
   * Update a webhook (`update_webhook` — PATCH
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
   * Delete a webhook (`delete_webhook`).
   *
   * @param webhookId - Webhook UUID string.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   */
  deleteWebhook: (webhookId: string, signal?: AbortSignal) => Promise<void>;

  /**
   * Test webhook connectivity (`test_webhook` — POST
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
 * Build the webhook methods over the shared client core.
 *
 * @param core - The shared client internals seam.
 * @returns The method bag.
 */
export function createWebhookMethods(core: ClientCore): WebhookMethods {
  /** `maybe_scoped_path` over the pin current at call time. */
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
