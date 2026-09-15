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
   * List webhooks. Sends GET `webhooks/`.
   *
   * @param signal - Optional cancellation signal.
   * @returns The webhook list verbatim.
   * @throws {@link MixpanelHeadlessError} - Non-list response.
   * @throws {@link AuthenticationError} - Invalid or expired credentials (401).
   * @throws {@link RateLimitError} - Rate limit still exceeded after the retries
   *   (429).
   * @throws {@link QueryError} - Other 4xx responses (400/403/404/422).
   * @throws {@link ServerError} - Server-side errors (5xx).
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.list_webhooks
   */
  listWebhooks: (signal?: AbortSignal) => Promise<JsonValue[]>;

  /**
   * Create a webhook. Sends POST `webhooks/`.
   *
   * @param body - Webhook creation parameters (name, url, ...).
   * @param signal - Optional cancellation signal.
   * @returns The mutation result dict (id + name).
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.create_webhook
   */
  createWebhook: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Update a webhook. Sends PATCH `webhooks/{id}/`.
   *
   * @param webhookId - Webhook UUID string.
   * @param body - Fields to update.
   * @param signal - Optional cancellation signal.
   * @returns The mutation result dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.update_webhook
   */
  updateWebhook: (
    webhookId: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Delete a webhook.
   *
   * @param webhookId - Webhook UUID string.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.delete_webhook
   */
  deleteWebhook: (webhookId: string, signal?: AbortSignal) => Promise<void>;

  /**
   * Test webhook connectivity. Sends POST `webhooks/test/`.
   *
   * @param body - Webhook test parameters.
   * @param signal - Optional cancellation signal.
   * @returns The test result dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.test_webhook
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
 * @example
 * ```typescript
 * const webhooks = createWebhookMethods(core);
 * await webhooks.testWebhook({ url: "https://example.com/hook" });
 * // { ok: true, status_code: 200, ... }
 * ```
 */
export function createWebhookMethods(core: ClientCore): WebhookMethods {
  /**
   * Scope a domain path to the project and the workspace pinned at call
   * time.
   *
   * @param domainPath - Path relative to the domain root.
   * @returns The `/projects/{pid}[/workspaces/{wid}]/{domainPath}` path.
   */
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
