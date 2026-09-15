/**
 * Schema-registry, schema-enforcement, data-audit, data-volume-anomaly
 * and event-deletion members of the `Workspace` facade. Each function is
 * the body of one facade method — options-bag mapping, the params dump,
 * the like-named client call and result-model validation with the
 * endpoint name Python passes. Path-segment quoting of entity names, the
 * `results.anomalies` extraction and raw-envelope handling belong to the
 * client, not here.
 *
 * @see mixpanel_headless.workspace.Workspace
 */

import type { MixpanelClient } from "../client/client.js";
import { isPlainRecord } from "../client/internals.js";
import { type JsonValue, toNativeJson } from "../client/json-value.js";
import {
  validateResponseModel,
  validateResponseModels,
} from "../client/response-validation.js";
import { MixpanelHeadlessError } from "../errors.js";
import { pythonTypeNameOf } from "../services/shared.js";
import {
  AuditResponse,
  AuditViolation,
  type BulkCreateSchemasParams,
  BulkCreateSchemasResponse,
  BulkPatchResult,
  type BulkUpdateAnomalyParams,
  type CreateDeletionRequestParams,
  DataVolumeAnomaly,
  DeleteSchemasResponse,
  EventDeletionRequest,
  type InitSchemaEnforcementParams,
  type PreviewDeletionFiltersParams,
  type ReplaceSchemaEnforcementParams,
  SchemaEnforcementConfig,
  SchemaEntry,
  type UpdateAnomalyParams,
  type UpdateSchemaEnforcementParams,
} from "../types/entities/schemas.js";

// --- Options bags (keys keep the Python keyword spelling) ---

/** Options bag of `Workspace.listSchemaRegistry` (keyword-only in Python). */
export interface WorkspaceListSchemaRegistryOptions {
  /**
   * Filter by entity type (`"event"`, `"custom_event"`, `"profile"`).
   *
   * @defaultValue `null` (every schema)
   */
  readonly entity_type?: string | null | undefined;
}

/** Options bag of `Workspace.deleteSchemas` (both keyword-only). */
export interface WorkspaceDeleteSchemasOptions {
  /**
   * Filter by entity type.
   *
   * @defaultValue `null`
   */
  readonly entity_type?: string | null | undefined;
  /**
   * Filter by entity name; requires `entity_type`.
   *
   * @defaultValue `null`
   */
  readonly entity_name?: string | null | undefined;
}

/** Options bag of `Workspace.getSchemaEnforcement` (keyword-only). */
export interface WorkspaceGetSchemaEnforcementOptions {
  /**
   * Comma-separated field names to return (e.g. `"ruleEvent,state"`).
   *
   * @defaultValue `null` (every field)
   */
  readonly fields?: string | null | undefined;
}

/** Options bag of `Workspace.listDataVolumeAnomalies` (keyword-only). */
export interface WorkspaceListDataVolumeAnomaliesOptions {
  /**
   * Query-string filters (`status`, `limit`, `event_id`, …).
   *
   * @defaultValue `null`
   */
  readonly query_params?: Readonly<Record<string, string>> | null | undefined;
}

// --- Schema registry ---

/**
 * List the schema-registry entries.
 *
 * @param client - The wire client.
 * @param options - Optional `entity_type` filter, forwarded as `null`
 *   when absent (the client owns the gate).
 * @returns The `SchemaEntry` models, in response order.
 * @throws {@link ResponseValidationError} - Malformed payload
 *   (`RESPONSE_VALIDATION_ERROR`).
 * @throws {@link AuthenticationError} | {@link RateLimitError} | {@link QueryError} |
 *   {@link ServerError} - Wire failures.
 * @example
 * ```typescript
 * const schemas = await ws.listSchemaRegistry({ entity_type: "event" });
 * ```
 * @see mixpanel_headless.workspace.Workspace.list_schema_registry
 */
export async function listSchemaRegistry(
  client: MixpanelClient,
  options: WorkspaceListSchemaRegistryOptions = {},
): Promise<SchemaEntry[]> {
  const rawList = await client.listSchemaRegistry({
    entity_type: options.entity_type ?? null,
  });
  return validateResponseModels(
    SchemaEntry,
    rawList.map((item) => toNativeJson(item)),
    {
      endpoint: "list_schema_registry",
    },
  );
}

/**
 * Create a single schema definition and return the response verbatim.
 *
 * @param client - The wire client.
 * @param entityType - Entity type (`"event"`, `"custom_event"`,
 *   `"profile"`).
 * @param entityName - Entity name (an event name, or `"$user"` for
 *   profiles).
 * @param schemaJson - JSON Schema Draft 7 definition; passed through
 *   without a model dump because it is already a plain mapping.
 * @returns The created schema record.
 * @throws {@link AuthenticationError} | {@link QueryError} | {@link RateLimitError} |
 *   {@link ServerError} - Wire failures.
 * @example
 * ```typescript
 * await ws.createSchema("event", "Signup", {
 *   type: "object",
 *   properties: { plan: { type: "string" } },
 * });
 * ```
 * @see mixpanel_headless.workspace.Workspace.create_schema
 */
export async function createSchema(
  client: MixpanelClient,
  entityType: string,
  entityName: string,
  schemaJson: Readonly<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const raw = await client.createSchema(entityType, entityName, schemaJson);
  return toNativeJson(raw) as Record<string, unknown>;
}

/**
 * Create several schemas in one request.
 *
 * @param client - The wire client.
 * @param params - The entries to create, dumped with `exclude_none` and
 *   `by_alias`.
 * @returns The `added` / `deleted` counts.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const counts = await ws.createSchemasBulk(
 *   new BulkCreateSchemasParams({ entries, truncate: false }),
 * );
 * ```
 * @see mixpanel_headless.workspace.Workspace.create_schemas_bulk
 */
export async function createSchemasBulk(
  client: MixpanelClient,
  params: BulkCreateSchemasParams,
): Promise<BulkCreateSchemasResponse> {
  const raw = await client.createSchemasBulk(
    params.modelDumpExcludeNone({ byAlias: true }),
  );
  return validateResponseModel(BulkCreateSchemasResponse, toNativeJson(raw), {
    endpoint: "create_schemas_bulk",
  });
}

/**
 * Merge a partial schema into an existing definition and return the
 * response verbatim.
 *
 * @param client - The wire client.
 * @param entityType - Entity type.
 * @param entityName - Entity name.
 * @param schemaJson - Partial JSON Schema to merge into the existing one.
 * @returns The updated schema record.
 * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire failures.
 * @example
 * ```typescript
 * await ws.updateSchema("event", "Signup", { required: ["plan"] });
 * ```
 * @see mixpanel_headless.workspace.Workspace.update_schema
 */
export async function updateSchema(
  client: MixpanelClient,
  entityType: string,
  entityName: string,
  schemaJson: Readonly<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const raw = await client.updateSchema(entityType, entityName, schemaJson);
  return toNativeJson(raw) as Record<string, unknown>;
}

/**
 * Merge several partial schemas in one request.
 *
 * @param client - The wire client.
 * @param params - The entries to merge, dumped with `exclude_none` and
 *   `by_alias`.
 * @returns The per-entry results, in response order.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const results = await ws.updateSchemasBulk(
 *   new BulkCreateSchemasParams({ entries }),
 * );
 * ```
 * @see mixpanel_headless.workspace.Workspace.update_schemas_bulk
 */
export async function updateSchemasBulk(
  client: MixpanelClient,
  params: BulkCreateSchemasParams,
): Promise<BulkPatchResult[]> {
  const rawList = await client.updateSchemasBulk(
    params.modelDumpExcludeNone({ byAlias: true }),
  );
  return validateResponseModels(
    BulkPatchResult,
    rawList.map((item) => toNativeJson(item)),
    {
      endpoint: "update_schemas_bulk",
    },
  );
}

/**
 * Delete schemas by entity type and/or name.
 *
 * @remarks
 * `entity_name` without `entity_type` is refused before any request is
 * made, because the server would interpret it as "delete every schema".
 * The code is the constructor default `UNKNOWN_ERROR`, as in Python.
 * @param client - The wire client.
 * @param options - Optional `entity_type` / `entity_name` filters.
 * @returns The `delete_count` response.
 * @throws {@link MixpanelHeadlessError} - `entity_name` given without
 *   `entity_type` (code `UNKNOWN_ERROR`).
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * await ws.deleteSchemas({ entity_type: "event", entity_name: "Signup" });
 * ```
 * @see mixpanel_headless.workspace.Workspace.delete_schemas
 */
export async function deleteSchemas(
  client: MixpanelClient,
  options: WorkspaceDeleteSchemasOptions = {},
): Promise<DeleteSchemasResponse> {
  const entityType = options.entity_type ?? null;
  const entityName = options.entity_name ?? null;
  if (entityName !== null && entityType === null) {
    throw new MixpanelHeadlessError(
      "entity_name requires entity_type: providing entity_name " +
        "without entity_type would delete all schemas",
    );
  }
  const raw = await client.deleteSchemas({
    entity_type: entityType,
    entity_name: entityName,
  });
  return validateResponseModel(DeleteSchemasResponse, toNativeJson(raw), {
    endpoint: "delete_schemas",
  });
}

// --- Schema enforcement ---

/**
 * Fetch the current schema-enforcement configuration.
 *
 * @param client - The wire client.
 * @param options - Optional `fields` filter.
 * @returns The enforcement configuration.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const config = await ws.getSchemaEnforcement({ fields: "ruleEvent,state" });
 * ```
 * @see mixpanel_headless.workspace.Workspace.get_schema_enforcement
 */
export async function getSchemaEnforcement(
  client: MixpanelClient,
  options: WorkspaceGetSchemaEnforcementOptions = {},
): Promise<SchemaEnforcementConfig> {
  const raw = await client.getSchemaEnforcement({
    fields: options.fields ?? null,
  });
  return validateResponseModel(SchemaEnforcementConfig, toNativeJson(raw), {
    endpoint: "get_schema_enforcement",
  });
}

/**
 * Initialize schema enforcement and return the response verbatim.
 *
 * @param client - The wire client.
 * @param params - Init parameters, dumped with `exclude_none` and
 *   `by_alias`.
 * @returns The raw API response.
 * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire failures.
 * @example
 * ```typescript
 * await ws.initSchemaEnforcement(
 *   new InitSchemaEnforcementParams({ rule_event: "Signup" }),
 * );
 * ```
 * @see mixpanel_headless.workspace.Workspace.init_schema_enforcement
 */
export async function initSchemaEnforcement(
  client: MixpanelClient,
  params: InitSchemaEnforcementParams,
): Promise<Record<string, unknown>> {
  const raw = await client.initSchemaEnforcement(
    params.modelDumpExcludeNone({ byAlias: true }),
  );
  return toNativeJson(raw) as Record<string, unknown>;
}

/**
 * Partially update the enforcement configuration and return the
 * response verbatim.
 *
 * @param client - The wire client.
 * @param params - The fields to change, dumped with `exclude_none` and
 *   `by_alias`.
 * @returns The raw API response.
 * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire failures.
 * @example
 * ```typescript
 * await ws.updateSchemaEnforcement(
 *   new UpdateSchemaEnforcementParams({ notification_emails: ["data@example.com"] }),
 * );
 * ```
 * @see mixpanel_headless.workspace.Workspace.update_schema_enforcement
 */
export async function updateSchemaEnforcement(
  client: MixpanelClient,
  params: UpdateSchemaEnforcementParams,
): Promise<Record<string, unknown>> {
  const raw = await client.updateSchemaEnforcement(
    params.modelDumpExcludeNone({ byAlias: true }),
  );
  return toNativeJson(raw) as Record<string, unknown>;
}

/**
 * Replace the whole enforcement configuration and return the response
 * verbatim.
 *
 * @param client - The wire client.
 * @param params - The complete replacement, dumped with `exclude_none`
 *   and `by_alias`.
 * @returns The raw API response.
 * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire failures.
 * @example
 * ```typescript
 * await ws.replaceSchemaEnforcement(
 *   new ReplaceSchemaEnforcementParams({ events: [], common_properties: [] }),
 * );
 * ```
 * @see mixpanel_headless.workspace.Workspace.replace_schema_enforcement
 */
export async function replaceSchemaEnforcement(
  client: MixpanelClient,
  params: ReplaceSchemaEnforcementParams,
): Promise<Record<string, unknown>> {
  const raw = await client.replaceSchemaEnforcement(
    params.modelDumpExcludeNone({ byAlias: true }),
  );
  return toNativeJson(raw) as Record<string, unknown>;
}

/**
 * Delete the enforcement configuration and return the response
 * verbatim.
 *
 * @param client - The wire client.
 * @returns The raw API response.
 * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire failures.
 * @example
 * ```typescript
 * await ws.deleteSchemaEnforcement();
 * ```
 * @see mixpanel_headless.workspace.Workspace.delete_schema_enforcement
 */
export async function deleteSchemaEnforcement(
  client: MixpanelClient,
): Promise<Record<string, unknown>> {
  const raw = await client.deleteSchemaEnforcement();
  return toNativeJson(raw) as Record<string, unknown>;
}

// --- Data auditing ---

/**
 * Assemble an `AuditResponse` from the `[violations, metadata]` array
 * both audit members receive.
 *
 * @remarks
 * Branch order mirrors Python: an empty list yields an empty
 * `AuditResponse`; a non-list first element raises; otherwise every
 * violation is validated and `computed_at` is read off the metadata
 * (absent or non-dict metadata reads as `{}`, hence `""`).
 * @param raw - The client's raw two-element array.
 * @param endpoint - The Python member name passed as `endpoint=`.
 * @returns The assembled `AuditResponse`.
 * @throws {@link MixpanelHeadlessError} - Non-list first element (code
 *   `UNKNOWN_ERROR`).
 * @throws {@link ResponseValidationError} - A malformed violation entry,
 *   or a `computed_at` that is present but `null`.
 */
function auditResponseFrom(
  raw: readonly JsonValue[],
  endpoint: string,
): AuditResponse {
  // Python's `if not raw:` over a list — an explicit emptiness check,
  // never `if (!raw)` (an empty array is truthy in JS).
  if (raw.length === 0) {
    return new AuditResponse({ violations: [], computed_at: "" });
  }
  const head = raw[0] as JsonValue;
  if (!Array.isArray(head)) {
    throw new MixpanelHeadlessError(
      `Unexpected audit response: expected list of violations, ` +
        `got ${pythonTypeNameOf(head)}`,
    );
  }
  const violations = validateResponseModels(
    AuditViolation,
    head.map((item) => toNativeJson(item)),
    {
      endpoint,
    },
  );
  // `raw[1] if len(raw) > 1 and isinstance(raw[1], dict) else {}` —
  // prototype discrimination, never `typeof`.
  const second = raw[1];
  const metadata = isPlainRecord(second)
    ? (toNativeJson(second) as Record<string, unknown>)
    : {};
  // `metadata.get("computed_at", "")` — the default fires on absence
  // only, so a recorded `null` reaches the model.
  // Divergence: on `{"computed_at": null}` Python leaks a bare
  // `pydantic.ValidationError`; the port raises the standard
  // `ResponseValidationError` / `RESPONSE_VALIDATION_ERROR` (PORTING.md).
  return new AuditResponse({
    violations,
    computed_at: (Object.hasOwn(metadata, "computed_at")
      ? metadata["computed_at"]
      : "") as string,
  });
}

/**
 * Run a full data audit — events plus properties.
 *
 * @param client - The wire client.
 * @returns The audit response (violations plus `computed_at`).
 * @throws {@link MixpanelHeadlessError} - Unexpected audit-response shape.
 * @throws {@link ResponseValidationError} - A malformed violation entry.
 * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire failures.
 * @example
 * ```typescript
 * const audit = await ws.runAudit();
 * console.log(audit.violations.length, audit.computed_at);
 * ```
 * @see mixpanel_headless.workspace.Workspace.run_audit
 */
export async function runAudit(client: MixpanelClient): Promise<AuditResponse> {
  const raw = await client.runAudit();
  return auditResponseFrom(raw, "run_audit");
}

/**
 * Run an events-only data audit.
 *
 * @param client - The wire client.
 * @returns The audit response (event violations only).
 * @throws {@link MixpanelHeadlessError} - Unexpected audit-response shape.
 * @throws {@link ResponseValidationError} - A malformed violation entry.
 * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire failures.
 * @example
 * ```typescript
 * const audit = await ws.runAuditEventsOnly();
 * ```
 * @see mixpanel_headless.workspace.Workspace.run_audit_events_only
 */
export async function runAuditEventsOnly(
  client: MixpanelClient,
): Promise<AuditResponse> {
  const raw = await client.runAuditEventsOnly();
  return auditResponseFrom(raw, "run_audit_events_only");
}

// --- Data-volume anomalies ---

/**
 * List the detected data-volume anomalies.
 *
 * @param client - The wire client.
 * @param options - Optional `query_params` filters.
 * @returns The `DataVolumeAnomaly` models, in response order.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const anomalies = await ws.listDataVolumeAnomalies({
 *   query_params: { status: "open" },
 * });
 * ```
 * @see mixpanel_headless.workspace.Workspace.list_data_volume_anomalies
 */
export async function listDataVolumeAnomalies(
  client: MixpanelClient,
  options: WorkspaceListDataVolumeAnomaliesOptions = {},
): Promise<DataVolumeAnomaly[]> {
  const rawList = await client.listDataVolumeAnomalies({
    query_params: options.query_params ?? null,
  });
  return validateResponseModels(
    DataVolumeAnomaly,
    rawList.map((item) => toNativeJson(item)),
    {
      endpoint: "list_data_volume_anomalies",
    },
  );
}

/**
 * Update the status of a single anomaly and return the response
 * verbatim.
 *
 * @param client - The wire client.
 * @param params - Update parameters, dumped with `by_alias` but without
 *   `exclude_none` — Python keeps the `None` values here.
 * @returns The raw API response.
 * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire failures.
 * @example
 * ```typescript
 * await ws.updateAnomaly(new UpdateAnomalyParams({ id: 17, status: "resolved" }));
 * ```
 * @see mixpanel_headless.workspace.Workspace.update_anomaly
 */
export async function updateAnomaly(
  client: MixpanelClient,
  params: UpdateAnomalyParams,
): Promise<Record<string, unknown>> {
  const raw = await client.updateAnomaly(params.modelDump({ byAlias: true }));
  return toNativeJson(raw) as Record<string, unknown>;
}

/**
 * Update the status of several anomalies and return the response
 * verbatim.
 *
 * @param client - The wire client.
 * @param params - Bulk update parameters, dumped with `by_alias` but
 *   without `exclude_none` — Python keeps the `None` values here.
 * @returns The raw API response.
 * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire failures.
 * @example
 * ```typescript
 * await ws.bulkUpdateAnomalies(
 *   new BulkUpdateAnomalyParams({ anomalies: [{ id: 17 }], status: "resolved" }),
 * );
 * ```
 * @see mixpanel_headless.workspace.Workspace.bulk_update_anomalies
 */
export async function bulkUpdateAnomalies(
  client: MixpanelClient,
  params: BulkUpdateAnomalyParams,
): Promise<Record<string, unknown>> {
  const raw = await client.bulkUpdateAnomalies(
    params.modelDump({ byAlias: true }),
  );
  return toNativeJson(raw) as Record<string, unknown>;
}

// --- Event deletion requests ---

/**
 * List every event deletion request.
 *
 * @param client - The wire client.
 * @returns The `EventDeletionRequest` models, in response order.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const requests = await ws.listDeletionRequests();
 * ```
 * @see mixpanel_headless.workspace.Workspace.list_deletion_requests
 */
export async function listDeletionRequests(
  client: MixpanelClient,
): Promise<EventDeletionRequest[]> {
  const rawList = await client.listDeletionRequests();
  return validateResponseModels(
    EventDeletionRequest,
    rawList.map((item) => toNativeJson(item)),
    {
      endpoint: "list_deletion_requests",
    },
  );
}

/**
 * Create an event deletion request. The API answers with the full,
 * updated list of requests.
 *
 * @param client - The wire client.
 * @param params - Deletion parameters, dumped with `exclude_none` and
 *   `by_alias`.
 * @returns Every deletion request after creation.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const requests = await ws.createDeletionRequest(
 *   new CreateDeletionRequestParams({
 *     event_name: "Legacy Signup",
 *     from_date: "2025-01-01",
 *     to_date: "2025-01-31",
 *   }),
 * );
 * ```
 * @see mixpanel_headless.workspace.Workspace.create_deletion_request
 */
export async function createDeletionRequest(
  client: MixpanelClient,
  params: CreateDeletionRequestParams,
): Promise<EventDeletionRequest[]> {
  const rawList = await client.createDeletionRequest(
    params.modelDumpExcludeNone({ byAlias: true }),
  );
  return validateResponseModels(
    EventDeletionRequest,
    rawList.map((item) => toNativeJson(item)),
    {
      endpoint: "create_deletion_request",
    },
  );
}

/**
 * Cancel a pending deletion request. The API answers with the full,
 * updated list of requests.
 *
 * @param client - The wire client.
 * @param requestId - Id of the deletion request to cancel.
 * @returns Every deletion request after cancellation.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const requests = await ws.cancelDeletionRequest(310);
 * ```
 * @see mixpanel_headless.workspace.Workspace.cancel_deletion_request
 */
export async function cancelDeletionRequest(
  client: MixpanelClient,
  requestId: number,
): Promise<EventDeletionRequest[]> {
  const rawList = await client.cancelDeletionRequest(requestId);
  return validateResponseModels(
    EventDeletionRequest,
    rawList.map((item) => toNativeJson(item)),
    {
      endpoint: "cancel_deletion_request",
    },
  );
}

/**
 * Preview which events a deletion filter would match. Read-only; the
 * list is returned verbatim without model validation.
 *
 * @param client - The wire client.
 * @param params - Preview parameters, dumped with `exclude_none` and
 *   `by_alias`.
 * @returns The expanded, normalized filters.
 * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire failures.
 * @example
 * ```typescript
 * const preview = await ws.previewDeletionFilters(
 *   new PreviewDeletionFiltersParams({ event_name: "Legacy Signup" }),
 * );
 * ```
 * @see mixpanel_headless.workspace.Workspace.preview_deletion_filters
 */
export async function previewDeletionFilters(
  client: MixpanelClient,
  params: PreviewDeletionFiltersParams,
): Promise<Array<Record<string, unknown>>> {
  const rawList = await client.previewDeletionFilters(
    params.modelDumpExcludeNone({ byAlias: true }),
  );
  return rawList.map((item) => toNativeJson(item)) as Array<
    Record<string, unknown>
  >;
}
