/**
 * B6-W5 member module — the `Workspace` annotation, webhook and alert
 * members (`workspace.py`: Annotations, Webhook CRUD and
 * Alert CRUD, Phase 026).
 *
 * Packet contract (`b6-packets.md` §2/§7): the `workspace.ts` B6-W5
 * section holds ONE-LINE delegations into this module; every member
 * here is a THIN facade body — options-bag mapping, the
 * params dump (W1-D4 {@link EntityModel.modelDumpExcludeNone}), the
 * like-named B4-C4 client method
 * (`services/entities/{annotations,webhooks,alerts}.ts`, composed onto
 * the client at `client.ts:1077+`) and result-model construction via
 * `validateResponseModel(s)` with the exact `endpoint=` string Python
 * passes. No request assembly, no header merging, no URL building, no
 * status branching (R10.8 — compose, never re-implement).
 *
 * Shard-wide observations from the Python re-read (all 23 bodies read
 * line-by-line at HEAD 2026-08-16):
 *
 * - **Every one of the 23 members is a pure forward.** Unlike W2/W4
 *   there is NO composite body in this range: no multi-step
 *   orchestration, no conditional query assembly, no decision-payload
 *   shaping. Each body is `client = self._require_api_client()`, an
 *   optional `body = params.model_dump(exclude_none=True)`, the
 *   like-named client call, and either
 *   `validate_response_model(s)(...)` or a bare return. The packet's
 *   "`test_alert`, `get_alert_screenshot_url`,
 *   `validate_alerts_for_bookmark` have more-than-forward bodies" note
 *   (§7 Scope) did NOT survive re-measurement — recorded in
 *   `B6-W5-notes.md` §2 as the arbiter-visible finding.
 * - **ZERO empty-response guards** (`if raw is None: raise …`) in
 *   `:6462-7196` — verified by grep. So {@link requireResponse} is
 *   deliberately unused here; adding it would invent a branch Python
 *   does not have.
 * - **`test_alert` is the shard's one opaque passthrough**
 *   (`:7118-7119` returns `client.test_alert(body)` verbatim with a
 *   `dict[str, Any]` annotation and no model validation) — the
 *   `list_erf_experiments` precedent from W4.
 * - **Dates are strings end-to-end** (packet Caution #12 / watchlist
 *   #5): `list_annotations`'s `from_date`/`to_date` and
 *   `CreateAnnotationParams.date` are forwarded as the caller's
 *   strings; no `Date` is ever constructed in the request path.
 * - **No `int(str)`, no `.strip()`, no `isinstance(x, dict)`, no
 *   truthiness guard** anywhere in the range, so R11.7 / watchlist
 *   #6 / watchlist #13 have no site to bite in this shard.
 *
 * Two option-bag members take keyword-only tails that the client
 * mirrors 1:1 ({@link listAlerts}'s `bookmark_id`/`skip_user_filter`
 * and {@link getAlertHistory}'s cursor trio); Python passes the raw
 * `None` defaults straight through (`:6871-6872`, `:7076-7080`), and
 * the client owns the `is not None` gating, so the facade forwards
 * `?? null` rather than dropping absent keys (R3.9 — never re-derive
 * the gate).
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

// ---------------------------------------------------------------------------
// Options bags (R3.3/R3.8 — keyword-only tails; keys keep the Python
// spelling per packet Caution #6, since the recorder replays kwargs by
// name).
// ---------------------------------------------------------------------------

/** Options bag of `Workspace.listAnnotations` (keyword-only in Python). */
export interface WorkspaceListAnnotationsOptions {
  /** Start-date filter, ISO `YYYY-MM-DD` STRING (Python default `None`). */
  readonly from_date?: string | null | undefined;
  /** End-date filter, ISO `YYYY-MM-DD` STRING (Python default `None`). */
  readonly to_date?: string | null | undefined;
  /** Tag IDs to filter by (Python default `None`). */
  readonly tags?: readonly number[] | null | undefined;
}

/** Options bag of `Workspace.listAlerts` (keyword-only in Python). */
export interface WorkspaceListAlertsOptions {
  /** Filter alerts by linked bookmark ID (Python default `None`). */
  readonly bookmark_id?: number | null | undefined;
  /** When `true`, list alerts for all users (Python default `None`). */
  readonly skip_user_filter?: boolean | null | undefined;
}

/** Options bag of `Workspace.getAlertCount` (keyword-only in Python). */
export interface WorkspaceGetAlertCountOptions {
  /** Optional alert-type filter (Python default `None`). */
  readonly alert_type?: string | null | undefined;
}

/** Options bag of `Workspace.getAlertHistory` (keyword-only tail). */
export interface WorkspaceGetAlertHistoryOptions {
  /** Number of results per page (Python default `None`). */
  readonly page_size?: number | null | undefined;
  /** Cursor for the next page (Python default `None`). */
  readonly next_cursor?: string | null | undefined;
  /** Cursor for the previous page (Python default `None`). */
  readonly previous_cursor?: string | null | undefined;
}

// ---------------------------------------------------------------------------
// Annotations (Phase 026) — `workspace.py`
// ---------------------------------------------------------------------------

/**
 * List timeline annotations for the project (`list_annotations`,
 * `workspace.py`).
 *
 * @param client - The wire client.
 * @param options - `from_date` / `to_date` / `tags` (keyword-only in
 *   Python; dates stay STRINGS, watchlist #5).
 * @returns The `Annotation` models, in response order.
 * @throws ResponseValidationError - Malformed payload
 *   (`RESPONSE_VALIDATION_ERROR`).
 * @throws AuthenticationError | QueryError | ServerError - Wire
 *   failures per the B0 contract.
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
 * Create a new timeline annotation (`create_annotation`,
 * `workspace.py`).
 *
 * @param client - The wire client.
 * @param params - Annotation creation parameters (date, description
 *   required).
 * @returns The created `Annotation`.
 * @throws ResponseValidationError - Malformed payload.
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
 * Get a single annotation by ID (`get_annotation`,
 * `workspace.py`).
 *
 * @param client - The wire client.
 * @param annotationId - Annotation ID.
 * @returns The `Annotation`.
 * @throws ResponseValidationError - Malformed payload.
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
 * Update an annotation, PATCH semantics (`update_annotation`,
 * `workspace.py`).
 *
 * @param client - The wire client.
 * @param annotationId - Annotation ID.
 * @param params - Fields to update (description, tags).
 * @returns The updated `Annotation`.
 * @throws ResponseValidationError - Malformed payload.
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
 * Delete an annotation (`delete_annotation`,
 * `workspace.py`).
 *
 * @param client - The wire client.
 * @param annotationId - Annotation ID.
 * @returns Nothing.
 * @throws AuthenticationError | QueryError | ServerError - Wire
 *   failures.
 */
export async function deleteAnnotation(
  client: MixpanelClient,
  annotationId: number,
): Promise<void> {
  await client.deleteAnnotation(annotationId);
}

/**
 * List annotation tags for the project (`list_annotation_tags`,
 * `workspace.py`).
 *
 * @param client - The wire client.
 * @returns The `AnnotationTag` models, in response order.
 * @throws ResponseValidationError - Malformed payload.
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
 * Create a new annotation tag (`create_annotation_tag`,
 * `workspace.py`).
 *
 * @param client - The wire client.
 * @param params - Tag creation parameters (name required).
 * @returns The created `AnnotationTag`.
 * @throws ResponseValidationError - Malformed payload.
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

// ---------------------------------------------------------------------------
// Webhook CRUD (Phase 026) — `workspace.py`
// ---------------------------------------------------------------------------

/**
 * List all webhooks for the current project (`list_webhooks`,
 * `workspace.py`).
 *
 * @param client - The wire client.
 * @returns The `ProjectWebhook` models, in response order.
 * @throws ResponseValidationError - Malformed payload.
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
 * Create a new webhook (`create_webhook`,
 * `workspace.py`).
 *
 * @param client - The wire client.
 * @param params - Webhook creation parameters.
 * @returns The `WebhookMutationResult` (new webhook id + name).
 * @throws ResponseValidationError - Malformed payload.
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
 * Update an existing webhook, PATCH semantics (`update_webhook`,
 * `workspace.py`).
 *
 * @param client - The wire client.
 * @param webhookId - Webhook UUID string.
 * @param params - Fields to update.
 * @returns The `WebhookMutationResult` (updated id + name).
 * @throws ResponseValidationError - Malformed payload.
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
 * Delete a webhook (`delete_webhook`, `workspace.py`).
 *
 * @param client - The wire client.
 * @param webhookId - Webhook UUID string.
 * @returns Nothing.
 * @throws AuthenticationError | QueryError | ServerError - Wire
 *   failures.
 */
export async function deleteWebhook(
  client: MixpanelClient,
  webhookId: string,
): Promise<void> {
  await client.deleteWebhook(webhookId);
}

/**
 * Test webhook connectivity (`test_webhook`,
 * `workspace.py`).
 *
 * @param client - The wire client.
 * @param params - Webhook test parameters (`url` required).
 * @returns The `WebhookTestResult` (success, status_code, message).
 * @throws ResponseValidationError - Malformed payload.
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

// ---------------------------------------------------------------------------
// Alert CRUD (Phase 026) — `workspace.py`
// ---------------------------------------------------------------------------

/**
 * List custom alerts for the current project (`list_alerts`,
 * `workspace.py`).
 *
 * @param client - The wire client.
 * @param options - `bookmark_id` / `skip_user_filter` (keyword-only in
 *   Python; both default `None` and are forwarded as-is — the client
 *   owns the `is not None` gate).
 * @returns The `CustomAlert` models, in response order.
 * @throws ResponseValidationError - Malformed payload.
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
 * Create a new custom alert (`create_alert`,
 * `workspace.py`).
 *
 * @param client - The wire client.
 * @param params - Alert creation parameters.
 * @returns The created `CustomAlert`.
 * @throws ResponseValidationError - Malformed payload.
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
 * Get a single custom alert by ID (`get_alert`,
 * `workspace.py`).
 *
 * @param client - The wire client.
 * @param alertId - Alert ID (integer).
 * @returns The `CustomAlert`.
 * @throws ResponseValidationError - Malformed payload.
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
 * Update a custom alert, PATCH semantics (`update_alert`,
 * `workspace.py`).
 *
 * @param client - The wire client.
 * @param alertId - Alert ID (integer).
 * @param params - Fields to update.
 * @returns The updated `CustomAlert`.
 * @throws ResponseValidationError - Malformed payload.
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
 * Delete a custom alert (`delete_alert`, `workspace.py`).
 *
 * @param client - The wire client.
 * @param alertId - Alert ID (integer).
 * @returns Nothing.
 * @throws AuthenticationError | QueryError | ServerError - Wire
 *   failures.
 */
export async function deleteAlert(
  client: MixpanelClient,
  alertId: number,
): Promise<void> {
  await client.deleteAlert(alertId);
}

/**
 * Bulk-delete custom alerts (`bulk_delete_alerts`,
 * `workspace.py`).
 *
 * @param client - The wire client.
 * @param ids - Alert IDs to delete.
 * @returns Nothing.
 * @throws AuthenticationError | QueryError | ServerError - Wire
 *   failures.
 */
export async function bulkDeleteAlerts(
  client: MixpanelClient,
  ids: readonly number[],
): Promise<void> {
  await client.bulkDeleteAlerts(ids);
}

/**
 * Get the project's alert count against its limit
 * (`get_alert_count`, `workspace.py`).
 *
 * @param client - The wire client.
 * @param options - `alert_type` (keyword-only in Python).
 * @returns The `AlertCount`.
 * @throws ResponseValidationError - Malformed payload.
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
 * Get paginated alert trigger history (`get_alert_history`,
 * `workspace.py`).
 *
 * @param client - The wire client.
 * @param alertId - Alert ID (integer).
 * @param options - `page_size` / `next_cursor` / `previous_cursor`
 *   (keyword-only in Python).
 * @returns The `AlertHistoryResponse`.
 * @throws ResponseValidationError - Malformed payload.
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
 * Send a test alert notification (`test_alert`,
 * `workspace.py`) — returned VERBATIM; Python performs no
 * model validation (`return client.test_alert(body)`, `:7119`).
 *
 * @param client - The wire client.
 * @param params - Alert parameters for the test (same shape as
 *   create).
 * @returns The opaque result record.
 * @throws AuthenticationError | QueryError | ServerError - Wire
 *   failures.
 */
export async function testAlert(
  client: MixpanelClient,
  params: CreateAlertParams,
): Promise<Record<string, unknown>> {
  const raw = await client.testAlert(params.modelDumpExcludeNone());
  return toNativeJson(raw) as Record<string, unknown>;
}

/**
 * Get a signed URL for an alert screenshot
 * (`get_alert_screenshot_url`, `workspace.py`).
 *
 * @param client - The wire client.
 * @param gcsKey - GCS object key from the alert payload.
 * @returns The `AlertScreenshotResponse`.
 * @throws ResponseValidationError - Malformed payload.
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
 * Validate alerts against a bookmark definition
 * (`validate_alerts_for_bookmark`, `workspace.py`).
 *
 * @param client - The wire client.
 * @param params - Alert IDs plus the bookmark type and params.
 * @returns The `ValidateAlertsForBookmarkResponse`.
 * @throws ResponseValidationError - Malformed payload.
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
