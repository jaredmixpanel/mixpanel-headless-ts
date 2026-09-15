/**
 * Annotation, webhook and alert members of the `Workspace` facade. Every
 * one is a pure forward — the body of one facade method: options-bag
 * mapping, the params dump, the like-named client call and result-model
 * validation with the endpoint name Python passes. None of these Python
 * members has an empty-response guard, so `requireResponse` is
 * deliberately unused here; dates travel as the caller's `YYYY-MM-DD`
 * strings end to end. No request assembly, header merging, URL building
 * or status branching happens here.
 *
 * @see mixpanel_headless.workspace.Workspace
 */

import type { MixpanelClient } from "../client/client.js";
import { toNativeJson } from "../client/json-value.js";
import {
  validateResponseModel,
  validateResponseModels,
} from "../client/response-validation.js";
import {
  AlertCount,
  AlertHistoryResponse,
  AlertScreenshotResponse,
  type CreateAlertParams,
  CustomAlert,
  type UpdateAlertParams,
  type ValidateAlertsForBookmarkParams,
  ValidateAlertsForBookmarkResponse,
} from "../types/entities/alerts.js";
import {
  Annotation,
  AnnotationTag,
  type CreateAnnotationParams,
  type CreateAnnotationTagParams,
  type UpdateAnnotationParams,
} from "../types/entities/annotations.js";
import {
  type CreateWebhookParams,
  ProjectWebhook,
  type UpdateWebhookParams,
  WebhookMutationResult,
  type WebhookTestParams,
  WebhookTestResult,
} from "../types/entities/webhooks.js";

// --- Options bags (keyword-only tails; keys keep the Python spelling) ---

/** Options bag of `Workspace.listAnnotations` (keyword-only in Python). */
export interface WorkspaceListAnnotationsOptions {
  /**
   * Start-date filter as an ISO `YYYY-MM-DD` string.
   *
   * @defaultValue `null` (no lower bound)
   */
  readonly from_date?: string | null | undefined;
  /**
   * End-date filter as an ISO `YYYY-MM-DD` string.
   *
   * @defaultValue `null` (no upper bound)
   */
  readonly to_date?: string | null | undefined;
  /**
   * Restrict the listing to annotations carrying these tag ids.
   *
   * @defaultValue `null` (every tag)
   */
  readonly tags?: readonly number[] | null | undefined;
}

/** Options bag of `Workspace.listAlerts` (keyword-only in Python). */
export interface WorkspaceListAlertsOptions {
  /**
   * Restrict the listing to alerts linked to this bookmark.
   *
   * @defaultValue `null` (every bookmark)
   */
  readonly bookmark_id?: number | null | undefined;
  /**
   * List alerts for all users rather than the caller only.
   *
   * @defaultValue `null` (the server's default, caller only)
   */
  readonly skip_user_filter?: boolean | null | undefined;
}

/** Options bag of `Workspace.getAlertCount` (keyword-only in Python). */
export interface WorkspaceGetAlertCountOptions {
  /**
   * Count only alerts of this type.
   *
   * @defaultValue `null` (every type)
   */
  readonly alert_type?: string | null | undefined;
}

/** Options bag of `Workspace.getAlertHistory` (keyword-only tail). */
export interface WorkspaceGetAlertHistoryOptions {
  /**
   * Results per page.
   *
   * @defaultValue `null` (server default)
   */
  readonly page_size?: number | null | undefined;
  /**
   * Cursor for the next page.
   *
   * @defaultValue `null`
   */
  readonly next_cursor?: string | null | undefined;
  /**
   * Cursor for the previous page.
   *
   * @defaultValue `null`
   */
  readonly previous_cursor?: string | null | undefined;
}

// --- Annotations ---

/**
 * List timeline annotations for the project.
 *
 * @param client - The wire client.
 * @param options - `from_date` / `to_date` / `tags` (keyword-only in
 *   Python; dates are strings).
 * @returns The `Annotation` models, in response order.
 * @throws {@link ResponseValidationError} - Malformed payload
 *   (`RESPONSE_VALIDATION_ERROR`).
 * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
 *   failures.
 * @example
 * ```typescript
 * const q1 = await ws.listAnnotations({ from_date: "2026-01-01", to_date: "2026-03-31" });
 * ```
 * @see mixpanel_headless.workspace.Workspace.list_annotations
 */
export async function listAnnotations(
  client: MixpanelClient,
  options: WorkspaceListAnnotationsOptions = {},
): Promise<Annotation[]> {
  const raw = await client.listAnnotations({
    from_date: options.from_date ?? null,
    to_date: options.to_date ?? null,
    tags: options.tags ?? null,
  });
  return validateResponseModels(
    Annotation,
    raw.map((item) => toNativeJson(item)),
    {
      endpoint: "list_annotations",
    },
  );
}

/**
 * Create a new timeline annotation.
 *
 * @param client - The wire client.
 * @param params - Annotation creation parameters (date, description
 *   required).
 * @returns The created `Annotation`.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const note = await ws.createAnnotation(
 *   new CreateAnnotationParams({ date: "2026-02-14", description: "v3 launch" }),
 * );
 * ```
 * @see mixpanel_headless.workspace.Workspace.create_annotation
 */
export async function createAnnotation(
  client: MixpanelClient,
  params: CreateAnnotationParams,
): Promise<Annotation> {
  const raw = await client.createAnnotation(params.modelDumpExcludeNone());
  return validateResponseModel(Annotation, toNativeJson(raw), {
    endpoint: "create_annotation",
  });
}

/**
 * Fetch a single annotation by id.
 *
 * @param client - The wire client.
 * @param annotationId - Annotation ID.
 * @returns The `Annotation`.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const note = await ws.getAnnotation(42);
 * ```
 * @see mixpanel_headless.workspace.Workspace.get_annotation
 */
export async function getAnnotation(
  client: MixpanelClient,
  annotationId: number,
): Promise<Annotation> {
  const raw = await client.getAnnotation(annotationId);
  return validateResponseModel(Annotation, toNativeJson(raw), {
    endpoint: "get_annotation",
  });
}

/**
 * Update an annotation with PATCH semantics.
 *
 * @param client - The wire client.
 * @param annotationId - Annotation ID.
 * @param params - Fields to update (description, tags).
 * @returns The updated `Annotation`.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * await ws.updateAnnotation(42, new UpdateAnnotationParams({ description: "v3.1 launch" }));
 * ```
 * @see mixpanel_headless.workspace.Workspace.update_annotation
 */
export async function updateAnnotation(
  client: MixpanelClient,
  annotationId: number,
  params: UpdateAnnotationParams,
): Promise<Annotation> {
  const raw = await client.updateAnnotation(
    annotationId,
    params.modelDumpExcludeNone(),
  );
  return validateResponseModel(Annotation, toNativeJson(raw), {
    endpoint: "update_annotation",
  });
}

/**
 * Delete an annotation.
 *
 * @param client - The wire client.
 * @param annotationId - Annotation ID.
 * @returns Nothing.
 * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
 *   failures.
 * @example
 * ```typescript
 * await ws.deleteAnnotation(42);
 * ```
 * @see mixpanel_headless.workspace.Workspace.delete_annotation
 */
export async function deleteAnnotation(
  client: MixpanelClient,
  annotationId: number,
): Promise<void> {
  await client.deleteAnnotation(annotationId);
}

/**
 * List annotation tags for the project.
 *
 * @param client - The wire client.
 * @returns The `AnnotationTag` models, in response order.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const tags = await ws.listAnnotationTags();
 * ```
 * @see mixpanel_headless.workspace.Workspace.list_annotation_tags
 */
export async function listAnnotationTags(
  client: MixpanelClient,
): Promise<AnnotationTag[]> {
  const raw = await client.listAnnotationTags();
  return validateResponseModels(
    AnnotationTag,
    raw.map((item) => toNativeJson(item)),
    {
      endpoint: "list_annotation_tags",
    },
  );
}

/**
 * Create a new annotation tag.
 *
 * @param client - The wire client.
 * @param params - Tag creation parameters (name required).
 * @returns The created `AnnotationTag`.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const tag = await ws.createAnnotationTag(new CreateAnnotationTagParams({ name: "release" }));
 * ```
 * @see mixpanel_headless.workspace.Workspace.create_annotation_tag
 */
export async function createAnnotationTag(
  client: MixpanelClient,
  params: CreateAnnotationTagParams,
): Promise<AnnotationTag> {
  const raw = await client.createAnnotationTag(params.modelDumpExcludeNone());
  return validateResponseModel(AnnotationTag, toNativeJson(raw), {
    endpoint: "create_annotation_tag",
  });
}

// --- Webhooks ---

/**
 * List all webhooks for the current project.
 *
 * @param client - The wire client.
 * @returns The `ProjectWebhook` models, in response order.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const webhooks = await ws.listWebhooks();
 * ```
 * @see mixpanel_headless.workspace.Workspace.list_webhooks
 */
export async function listWebhooks(
  client: MixpanelClient,
): Promise<ProjectWebhook[]> {
  const raw = await client.listWebhooks();
  return validateResponseModels(
    ProjectWebhook,
    raw.map((item) => toNativeJson(item)),
    {
      endpoint: "list_webhooks",
    },
  );
}

/**
 * Create a new webhook.
 *
 * @param client - The wire client.
 * @param params - Webhook creation parameters.
 * @returns The `WebhookMutationResult` (new webhook id + name).
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const created = await ws.createWebhook(
 *   new CreateWebhookParams({ name: "Ops", url: "https://hooks.example.com/mixpanel" }),
 * );
 * ```
 * @see mixpanel_headless.workspace.Workspace.create_webhook
 */
export async function createWebhook(
  client: MixpanelClient,
  params: CreateWebhookParams,
): Promise<WebhookMutationResult> {
  const raw = await client.createWebhook(params.modelDumpExcludeNone());
  return validateResponseModel(WebhookMutationResult, toNativeJson(raw), {
    endpoint: "create_webhook",
  });
}

/**
 * Update an existing webhook with PATCH semantics.
 *
 * @param client - The wire client.
 * @param webhookId - Webhook UUID string.
 * @param params - Fields to update.
 * @returns The `WebhookMutationResult` (updated id + name).
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * await ws.updateWebhook(webhookId, new UpdateWebhookParams({ is_enabled: false }));
 * ```
 * @see mixpanel_headless.workspace.Workspace.update_webhook
 */
export async function updateWebhook(
  client: MixpanelClient,
  webhookId: string,
  params: UpdateWebhookParams,
): Promise<WebhookMutationResult> {
  const raw = await client.updateWebhook(
    webhookId,
    params.modelDumpExcludeNone(),
  );
  return validateResponseModel(WebhookMutationResult, toNativeJson(raw), {
    endpoint: "update_webhook",
  });
}

/**
 * Delete a webhook.
 *
 * @param client - The wire client.
 * @param webhookId - Webhook UUID string.
 * @returns Nothing.
 * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
 *   failures.
 * @example
 * ```typescript
 * await ws.deleteWebhook(webhookId);
 * ```
 * @see mixpanel_headless.workspace.Workspace.delete_webhook
 */
export async function deleteWebhook(
  client: MixpanelClient,
  webhookId: string,
): Promise<void> {
  await client.deleteWebhook(webhookId);
}

/**
 * Send a test delivery to a webhook URL and report the outcome.
 *
 * @param client - The wire client.
 * @param params - Webhook test parameters (`url` required).
 * @returns The `WebhookTestResult` (success, status_code, message).
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const result = await ws.testWebhook(
 *   new WebhookTestParams({ url: "https://hooks.example.com/mixpanel" }),
 * );
 * ```
 * @see mixpanel_headless.workspace.Workspace.test_webhook
 */
export async function testWebhook(
  client: MixpanelClient,
  params: WebhookTestParams,
): Promise<WebhookTestResult> {
  const raw = await client.testWebhook(params.modelDumpExcludeNone());
  return validateResponseModel(WebhookTestResult, toNativeJson(raw), {
    endpoint: "test_webhook",
  });
}

// --- Alerts ---

/**
 * List custom alerts for the current project.
 *
 * @param client - The wire client.
 * @param options - `bookmark_id` / `skip_user_filter` (keyword-only in
 *   Python; forwarded as `null` when absent — the client owns the
 *   `is not None` gate).
 * @returns The `CustomAlert` models, in response order.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const alerts = await ws.listAlerts({ bookmark_id: 987 });
 * ```
 * @see mixpanel_headless.workspace.Workspace.list_alerts
 */
export async function listAlerts(
  client: MixpanelClient,
  options: WorkspaceListAlertsOptions = {},
): Promise<CustomAlert[]> {
  const raw = await client.listAlerts({
    bookmark_id: options.bookmark_id ?? null,
    skip_user_filter: options.skip_user_filter ?? null,
  });
  return validateResponseModels(
    CustomAlert,
    raw.map((item) => toNativeJson(item)),
    {
      endpoint: "list_alerts",
    },
  );
}

/**
 * Create a new custom alert.
 *
 * @param client - The wire client.
 * @param params - Alert creation parameters.
 * @returns The created `CustomAlert`.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const alert = await ws.createAlert(
 *   new CreateAlertParams({ bookmark_id: 987, condition, frequency, paused: false, subscriptions }),
 * );
 * ```
 * @see mixpanel_headless.workspace.Workspace.create_alert
 */
export async function createAlert(
  client: MixpanelClient,
  params: CreateAlertParams,
): Promise<CustomAlert> {
  const raw = await client.createAlert(params.modelDumpExcludeNone());
  return validateResponseModel(CustomAlert, toNativeJson(raw), {
    endpoint: "create_alert",
  });
}

/**
 * Fetch a single custom alert by id.
 *
 * @param client - The wire client.
 * @param alertId - Alert ID (integer).
 * @returns The `CustomAlert`.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const alert = await ws.getAlert(7);
 * ```
 * @see mixpanel_headless.workspace.Workspace.get_alert
 */
export async function getAlert(
  client: MixpanelClient,
  alertId: number,
): Promise<CustomAlert> {
  const raw = await client.getAlert(alertId);
  return validateResponseModel(CustomAlert, toNativeJson(raw), {
    endpoint: "get_alert",
  });
}

/**
 * Update a custom alert with PATCH semantics.
 *
 * @param client - The wire client.
 * @param alertId - Alert ID (integer).
 * @param params - Fields to update.
 * @returns The updated `CustomAlert`.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * await ws.updateAlert(7, new UpdateAlertParams({ paused: true }));
 * ```
 * @see mixpanel_headless.workspace.Workspace.update_alert
 */
export async function updateAlert(
  client: MixpanelClient,
  alertId: number,
  params: UpdateAlertParams,
): Promise<CustomAlert> {
  const raw = await client.updateAlert(alertId, params.modelDumpExcludeNone());
  return validateResponseModel(CustomAlert, toNativeJson(raw), {
    endpoint: "update_alert",
  });
}

/**
 * Delete a custom alert.
 *
 * @param client - The wire client.
 * @param alertId - Alert ID (integer).
 * @returns Nothing.
 * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
 *   failures.
 * @example
 * ```typescript
 * await ws.deleteAlert(7);
 * ```
 * @see mixpanel_headless.workspace.Workspace.delete_alert
 */
export async function deleteAlert(
  client: MixpanelClient,
  alertId: number,
): Promise<void> {
  await client.deleteAlert(alertId);
}

/**
 * Bulk-delete custom alerts.
 *
 * @param client - The wire client.
 * @param ids - Alert IDs to delete.
 * @returns Nothing.
 * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
 *   failures.
 * @example
 * ```typescript
 * await ws.bulkDeleteAlerts([7, 8]);
 * ```
 * @see mixpanel_headless.workspace.Workspace.bulk_delete_alerts
 */
export async function bulkDeleteAlerts(
  client: MixpanelClient,
  ids: readonly number[],
): Promise<void> {
  await client.bulkDeleteAlerts(ids);
}

/**
 * Fetch the project's alert count against its limit.
 *
 * @param client - The wire client.
 * @param options - `alert_type` (keyword-only in Python).
 * @returns The `AlertCount`.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const count = await ws.getAlertCount({ alert_type: "anomaly" });
 * ```
 * @see mixpanel_headless.workspace.Workspace.get_alert_count
 */
export async function getAlertCount(
  client: MixpanelClient,
  options: WorkspaceGetAlertCountOptions = {},
): Promise<AlertCount> {
  const raw = await client.getAlertCount({
    alert_type: options.alert_type ?? null,
  });
  return validateResponseModel(AlertCount, toNativeJson(raw), {
    endpoint: "get_alert_count",
  });
}

/**
 * Fetch a page of an alert's trigger history.
 *
 * @param client - The wire client.
 * @param alertId - Alert ID (integer).
 * @param options - `page_size` / `next_cursor` / `previous_cursor`
 *   (keyword-only in Python).
 * @returns The `AlertHistoryResponse`.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const page = await ws.getAlertHistory(7, { page_size: 20 });
 * ```
 * @see mixpanel_headless.workspace.Workspace.get_alert_history
 */
export async function getAlertHistory(
  client: MixpanelClient,
  alertId: number,
  options: WorkspaceGetAlertHistoryOptions = {},
): Promise<AlertHistoryResponse> {
  const raw = await client.getAlertHistory(alertId, {
    page_size: options.page_size ?? null,
    next_cursor: options.next_cursor ?? null,
    previous_cursor: options.previous_cursor ?? null,
  });
  return validateResponseModel(AlertHistoryResponse, toNativeJson(raw), {
    endpoint: "get_alert_history",
  });
}

/**
 * Send a test alert notification and return the response verbatim
 * (Python performs no model validation here).
 *
 * @param client - The wire client.
 * @param params - Alert parameters for the test (same shape as
 *   create).
 * @returns The opaque result record.
 * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
 *   failures.
 * @example
 * ```typescript
 * const outcome = await ws.testAlert(alertParams);
 * ```
 * @see mixpanel_headless.workspace.Workspace.test_alert
 */
export async function testAlert(
  client: MixpanelClient,
  params: CreateAlertParams,
): Promise<Record<string, unknown>> {
  const raw = await client.testAlert(params.modelDumpExcludeNone());
  return toNativeJson(raw) as Record<string, unknown>;
}

/**
 * Fetch a signed URL for an alert screenshot.
 *
 * @param client - The wire client.
 * @param gcsKey - GCS object key from the alert payload.
 * @returns The `AlertScreenshotResponse`.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const signed = await ws.getAlertScreenshotUrl("alerts/7/2026-02-14.png");
 * ```
 * @see mixpanel_headless.workspace.Workspace.get_alert_screenshot_url
 */
export async function getAlertScreenshotUrl(
  client: MixpanelClient,
  gcsKey: string,
): Promise<AlertScreenshotResponse> {
  const raw = await client.getAlertScreenshotUrl(gcsKey);
  return validateResponseModel(AlertScreenshotResponse, toNativeJson(raw), {
    endpoint: "get_alert_screenshot_url",
  });
}

/**
 * Validate alerts against a bookmark definition.
 *
 * @param client - The wire client.
 * @param params - Alert IDs plus the bookmark type and params.
 * @returns The `ValidateAlertsForBookmarkResponse`.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const report = await ws.validateAlertsForBookmark(
 *   new ValidateAlertsForBookmarkParams({ alert_ids: [7], bookmark_params: params }),
 * );
 * ```
 * @see mixpanel_headless.workspace.Workspace.validate_alerts_for_bookmark
 */
export async function validateAlertsForBookmark(
  client: MixpanelClient,
  params: ValidateAlertsForBookmarkParams,
): Promise<ValidateAlertsForBookmarkResponse> {
  const raw = await client.validateAlertsForBookmark(
    params.modelDumpExcludeNone(),
  );
  return validateResponseModel(
    ValidateAlertsForBookmarkResponse,
    toNativeJson(raw),
    {
      endpoint: "validate_alerts_for_bookmark",
    },
  );
}
