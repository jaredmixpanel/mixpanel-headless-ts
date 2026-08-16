/**
 * B6-W8 member module — the `Workspace` schema-registry, schema-
 * enforcement, data-audit, data-volume-anomaly and event-deletion
 * members (`workspace.py:8651-9331`, all Phase 028: registry
 * :8651-8874, enforcement :8876-9024, auditing :9026-9105, anomalies
 * :9107-9199, deletion requests :9201-9331).
 *
 * Packet contract (`b6-packets.md` §2/§10): the `workspace.ts` B6-W8
 * section holds ONE-LINE delegations into this module; every member
 * here is a THIN facade body — options-bag mapping (R3.3/R3.8), the
 * params dump (W1-D4 {@link EntityModel.modelDumpExcludeNone} /
 * W8-D1 {@link EntityModel.modelDump}), the like-named B4-C5 client
 * method (`services/entities/{schemas,schema-enforcement,audit,
 * anomalies,deletion-requests}.ts`, composed onto the client at
 * `client.ts:1077+`) and result-model construction via
 * `validateResponseModel(s)` with the exact `endpoint=` string Python
 * passes. No request assembly, no header merging, no URL building, no
 * status branching (R10.8 — compose, never re-implement). In
 * particular the `urllib.parse.quote(..., safe="")` path-segment
 * encoding of `entity_type`/`entity_name`, the `results.anomalies`
 * extraction and the `_raw=True` envelope handling all live in the B4
 * client and are NOT re-derived here.
 *
 * Shard-wide observations from the Python re-read (all 20 bodies read
 * line-by-line at HEAD 2026-08-16):
 *
 * - **17 of 20 members are pure forwards.** The composite pair is
 *   {@link runAudit} (`:9050-9067`) and {@link runAuditEventsOnly}
 *   (`:9088-9104`), whose identical bodies unpack the client's
 *   `[violations, metadata]` 2-element array — ported
 *   branch-for-branch below; the third non-forward is
 *   {@link deleteSchemas} and its guard.
 * - **One facade-local guard**: {@link deleteSchemas} raises
 *   `MixpanelHeadlessError` when `entity_name` is given without
 *   `entity_type` (`:8864-8868`), BEFORE `_require_api_client()` and
 *   therefore before any request (the packet Caution #4 ordering
 *   twin). Code is the `exceptions.py` constructor default
 *   `UNKNOWN_ERROR` (packet Caution #8).
 * - **Three dump spellings.** The registry/enforcement/deletion
 *   writers use `model_dump(exclude_none=True, by_alias=True)`
 *   (`:8754`, `:8824`, `:8940`, `:8970`, `:9002`, `:9262`, `:9329`);
 *   the two anomaly writers use a PLAIN `model_dump(by_alias=True)`
 *   (`:9169`, `:9198`) — which KEEPS `None` values; and
 *   `create_schema`/`update_schema` pass their `schema_json` dict
 *   through with no dump at all. The facade mirrors each source
 *   spelling exactly rather than harmonizing them (W8-D1).
 * - **ZERO empty-response guards** (`if raw is None: raise …`) in the
 *   whole 681-line range — verified by grep, matching the W5/W6/W7
 *   precedent. The shared `requireResponse` helper is therefore
 *   deliberately unused; adding it would invent a branch Python does
 *   not have.
 * - **Nine opaque passthroughs**: `create_schema` (`:8720`),
 *   `update_schema` (`:8791`), the four `*_schema_enforcement`
 *   writers (`:8939`, `:8969`, `:9001`, `:9023`), the two anomaly
 *   writers (`:9169`, `:9198`) and `preview_deletion_filters`
 *   (`:9328`) return the client's payload verbatim under
 *   `dict[str, Any]` / `list[dict[str, Any]]` annotations with no
 *   model validation.
 * - **No `int(str)`, no `.strip()`, no date construction** anywhere in
 *   the range, so R11.7 / watchlist #5 have no site to bite. The one
 *   truthiness guard (`if not raw`, `:9053`/`:9090`) ports as an
 *   explicit length check (watchlist #6), and the one
 *   `isinstance(x, dict)` (`:9063`/`:9100`) ports via `isPlainRecord`
 *   (watchlist #13).
 *
 * W8-D2 (recorded divergence, no vector coverage): when the audit
 * metadata carries `{"computed_at": null}`, Python's
 * `metadata.get("computed_at", "")` yields `None` and the
 * `AuditResponse(...)` construction raises a BARE
 * `pydantic.ValidationError` — an out-of-contract leak (Discrepancy
 * #8 territory: the declared `Raises:` list does not include it). The
 * TS twin raises the port's standard wrapper for that same pydantic
 * failure, `ResponseValidationError` / `RESPONSE_VALIDATION_ERROR`.
 * Same trigger, same rejection, different class name; no corpus
 * vector exercises it.
 */

import { isPlainRecord } from "../client/internals.js";
import type { JsonValue } from "../client/json-value.js";
import type { MixpanelClient } from "../client/client.js";
import {
  validateResponseModel,
  validateResponseModels,
} from "../client/response-validation.js";
import { MixpanelHeadlessError } from "../errors.js";
import { pythonTypeNameOf } from "../services/entities/shared.js";
import {
  AuditResponse,
  AuditViolation,
  BulkCreateSchemasResponse,
  BulkPatchResult,
  DataVolumeAnomaly,
  DeleteSchemasResponse,
  EventDeletionRequest,
  SchemaEntry,
  SchemaEnforcementConfig,
  type BulkCreateSchemasParams,
  type BulkUpdateAnomalyParams,
  type CreateDeletionRequestParams,
  type InitSchemaEnforcementParams,
  type PreviewDeletionFiltersParams,
  type ReplaceSchemaEnforcementParams,
  type UpdateAnomalyParams,
  type UpdateSchemaEnforcementParams,
} from "../types/entities/schemas.js";
import { native } from "./shared.js";

// ---------------------------------------------------------------------------
// Options bags (R3.3/R3.8 — keyword-only tails; keys keep the Python
// spelling per packet Caution #6, since the recorder replays kwargs by
// name).
// ---------------------------------------------------------------------------

/** Options bag of `Workspace.listSchemaRegistry` (keyword-only in Python). */
export interface WorkspaceListSchemaRegistryOptions {
  /**
   * Filter by entity type ("event", "custom_event", "profile");
   * Python default `None`, which returns all schemas.
   */
  readonly entity_type?: string | null | undefined;
}

/** Options bag of `Workspace.deleteSchemas` (both keyword-only). */
export interface WorkspaceDeleteSchemasOptions {
  /** Filter by entity type (Python default `None`). */
  readonly entity_type?: string | null | undefined;
  /** Filter by entity name — REQUIRES `entity_type` (`:8864`). */
  readonly entity_name?: string | null | undefined;
}

/** Options bag of `Workspace.getSchemaEnforcement` (keyword-only). */
export interface WorkspaceGetSchemaEnforcementOptions {
  /**
   * Comma-separated field names to return (e.g. "ruleEvent,state");
   * Python default `None` returns all fields.
   */
  readonly fields?: string | null | undefined;
}

/** Options bag of `Workspace.listDataVolumeAnomalies` (keyword-only). */
export interface WorkspaceListDataVolumeAnomaliesOptions {
  /** Optional filters (status, limit, event_id, …); default `None`. */
  readonly query_params?: Readonly<Record<string, string>> | null | undefined;
}

// ---------------------------------------------------------------------------
// Schema Registry CRUD (`workspace.py:8651-8874`)
// ---------------------------------------------------------------------------

/**
 * List schema-registry entries (`list_schema_registry`,
 * `workspace.py:8654-8687`).
 *
 * @param client - The wire client.
 * @param options - `entity_type` filter (keyword-only in Python;
 *   forwarded as `null` when absent — the client owns the gate).
 * @returns The `SchemaEntry` models, in response order.
 * @throws ResponseValidationError - Malformed payload
 *   (`RESPONSE_VALIDATION_ERROR`).
 * @throws AuthenticationError | RateLimitError | QueryError |
 *   ServerError - Wire failures per the B0 contract.
 */
export async function listSchemaRegistry(
  client: MixpanelClient,
  options: WorkspaceListSchemaRegistryOptions = {},
): Promise<SchemaEntry[]> {
  const rawList = await client.listSchemaRegistry({
    entity_type: options.entity_type ?? null,
  });
  return validateResponseModels(SchemaEntry, rawList.map(native), {
    endpoint: "list_schema_registry",
  });
}

/**
 * Create a single schema definition (`create_schema`,
 * `workspace.py:8689-8720`) — the response is returned VERBATIM.
 *
 * @param client - The wire client.
 * @param entityType - Entity type ("event", "custom_event", "profile").
 * @param entityName - Entity name (event name or "$user" for profile).
 * @param schemaJson - JSON Schema Draft 7 definition (no dump: the
 *   parameter is already a plain mapping).
 * @returns The created schema dict.
 * @throws AuthenticationError | QueryError | RateLimitError |
 *   ServerError - Wire failures.
 */
export async function createSchema(
  client: MixpanelClient,
  entityType: string,
  entityName: string,
  schemaJson: Readonly<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const raw = await client.createSchema(entityType, entityName, schemaJson);
  return native(raw) as Record<string, unknown>;
}

/**
 * Bulk-create schemas (`create_schemas_bulk`,
 * `workspace.py:8722-8758`).
 *
 * @param client - The wire client.
 * @param params - Bulk creation parameters (dumped with
 *   `exclude_none=True, by_alias=True`, `:8754`).
 * @returns The `added`/`deleted` counts.
 * @throws ResponseValidationError - Malformed payload.
 */
export async function createSchemasBulk(
  client: MixpanelClient,
  params: BulkCreateSchemasParams,
): Promise<BulkCreateSchemasResponse> {
  const raw = await client.createSchemasBulk(
    params.modelDumpExcludeNone({ byAlias: true }),
  );
  return validateResponseModel(BulkCreateSchemasResponse, native(raw), {
    endpoint: "create_schemas_bulk",
  });
}

/**
 * Update a single schema definition with merge semantics
 * (`update_schema`, `workspace.py:8760-8791`) — response VERBATIM.
 *
 * @param client - The wire client.
 * @param entityType - Entity type.
 * @param entityName - Entity name.
 * @param schemaJson - Partial JSON Schema to merge with the existing one.
 * @returns The updated schema dict.
 * @throws AuthenticationError | QueryError | ServerError - Wire failures.
 */
export async function updateSchema(
  client: MixpanelClient,
  entityType: string,
  entityName: string,
  schemaJson: Readonly<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const raw = await client.updateSchema(entityType, entityName, schemaJson);
  return native(raw) as Record<string, unknown>;
}

/**
 * Bulk-update schemas, merge semantics per entry
 * (`update_schemas_bulk`, `workspace.py:8793-8828`).
 *
 * @param client - The wire client.
 * @param params - Bulk update parameters (dumped with
 *   `exclude_none=True, by_alias=True`, `:8824`).
 * @returns The per-entry results, in response order.
 * @throws ResponseValidationError - Malformed payload.
 */
export async function updateSchemasBulk(
  client: MixpanelClient,
  params: BulkCreateSchemasParams,
): Promise<BulkPatchResult[]> {
  const rawList = await client.updateSchemasBulk(
    params.modelDumpExcludeNone({ byAlias: true }),
  );
  return validateResponseModels(BulkPatchResult, rawList.map(native), {
    endpoint: "update_schemas_bulk",
  });
}

/**
 * Delete schemas by entity type and/or name (`delete_schemas`,
 * `workspace.py:8830-8874`).
 *
 * @param client - The wire client.
 * @param options - `entity_type` / `entity_name` filters (both
 *   keyword-only in Python).
 * @returns The `delete_count` response.
 * @throws MixpanelHeadlessError - `entity_name` without `entity_type`
 *   (code `UNKNOWN_ERROR`; raised BEFORE any request, `:8864-8868`).
 * @throws ResponseValidationError - Malformed payload.
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
  return validateResponseModel(DeleteSchemasResponse, native(raw), {
    endpoint: "delete_schemas",
  });
}

// ---------------------------------------------------------------------------
// Schema Enforcement (`workspace.py:8876-9024`)
// ---------------------------------------------------------------------------

/**
 * Get the current schema-enforcement configuration
 * (`get_schema_enforcement`, `workspace.py:8879-8911`).
 *
 * @param client - The wire client.
 * @param options - `fields` filter (keyword-only in Python).
 * @returns The enforcement configuration.
 * @throws ResponseValidationError - Malformed payload.
 */
export async function getSchemaEnforcement(
  client: MixpanelClient,
  options: WorkspaceGetSchemaEnforcementOptions = {},
): Promise<SchemaEnforcementConfig> {
  const raw = await client.getSchemaEnforcement({
    fields: options.fields ?? null,
  });
  return validateResponseModel(SchemaEnforcementConfig, native(raw), {
    endpoint: "get_schema_enforcement",
  });
}

/**
 * Initialize schema enforcement (`init_schema_enforcement`,
 * `workspace.py:8913-8941`) — response VERBATIM.
 *
 * @param client - The wire client.
 * @param params - Init parameters (dumped with `exclude_none=True,
 *   by_alias=True`, `:8940`).
 * @returns The raw API response.
 * @throws AuthenticationError | QueryError | ServerError - Wire failures.
 */
export async function initSchemaEnforcement(
  client: MixpanelClient,
  params: InitSchemaEnforcementParams,
): Promise<Record<string, unknown>> {
  const raw = await client.initSchemaEnforcement(
    params.modelDumpExcludeNone({ byAlias: true }),
  );
  return native(raw) as Record<string, unknown>;
}

/**
 * Partially update the enforcement configuration
 * (`update_schema_enforcement`, `workspace.py:8943-8971`) — response
 * VERBATIM.
 *
 * @param client - The wire client.
 * @param params - Partial update parameters (dumped with
 *   `exclude_none=True, by_alias=True`, `:8970`).
 * @returns The raw API response.
 * @throws AuthenticationError | QueryError | ServerError - Wire failures.
 */
export async function updateSchemaEnforcement(
  client: MixpanelClient,
  params: UpdateSchemaEnforcementParams,
): Promise<Record<string, unknown>> {
  const raw = await client.updateSchemaEnforcement(
    params.modelDumpExcludeNone({ byAlias: true }),
  );
  return native(raw) as Record<string, unknown>;
}

/**
 * Fully replace the enforcement configuration
 * (`replace_schema_enforcement`, `workspace.py:8973-9003`) — response
 * VERBATIM.
 *
 * @param client - The wire client.
 * @param params - Complete replacement parameters (dumped with
 *   `exclude_none=True, by_alias=True`, `:9002`).
 * @returns The raw API response.
 * @throws AuthenticationError | QueryError | ServerError - Wire failures.
 */
export async function replaceSchemaEnforcement(
  client: MixpanelClient,
  params: ReplaceSchemaEnforcementParams,
): Promise<Record<string, unknown>> {
  const raw = await client.replaceSchemaEnforcement(
    params.modelDumpExcludeNone({ byAlias: true }),
  );
  return native(raw) as Record<string, unknown>;
}

/**
 * Delete the enforcement configuration (`delete_schema_enforcement`,
 * `workspace.py:9005-9021`) — response VERBATIM.
 *
 * @param client - The wire client.
 * @returns The raw API response.
 * @throws AuthenticationError | QueryError | ServerError - Wire failures.
 */
export async function deleteSchemaEnforcement(
  client: MixpanelClient,
): Promise<Record<string, unknown>> {
  const raw = await client.deleteSchemaEnforcement();
  return native(raw) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Data Auditing (`workspace.py:9026-9105`) — the shard's two composite
// bodies, ported branch-for-branch.
// ---------------------------------------------------------------------------

/**
 * Unpack the `[violations, metadata]` array both audit members receive
 * (`workspace.py:9050-9067` and the identical `:9088-9104`).
 *
 * Branch order mirrors Python exactly: empty list → an empty
 * `AuditResponse`; non-list first element → `MixpanelHeadlessError`;
 * otherwise validate each violation and read `computed_at` off the
 * metadata (absent / non-dict metadata → `{}` → `""`).
 *
 * @param raw - The client's raw 2-element array.
 * @param endpoint - The Python member name passed as `endpoint=`.
 * @returns The assembled `AuditResponse`.
 * @throws MixpanelHeadlessError - Non-list first element (code
 *   `UNKNOWN_ERROR`).
 * @throws ResponseValidationError - A malformed violation entry.
 */
function auditResponseFrom(
  raw: readonly JsonValue[],
  endpoint: string,
): AuditResponse {
  // `if not raw:` over a list — an explicit emptiness check, never
  // `if (!raw)` (watchlist #6).
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
  const violations = validateResponseModels(AuditViolation, head.map(native), {
    endpoint,
  });
  // `raw[1] if len(raw) > 1 and isinstance(raw[1], dict) else {}` —
  // prototype discrimination, never `typeof` (watchlist #13).
  const second = raw.length > 1 ? raw[1] : undefined;
  const metadata = isPlainRecord(second)
    ? (native(second) as Record<string, unknown>)
    : {};
  return new AuditResponse({
    violations,
    // `metadata.get("computed_at", "")` — the default fires on ABSENCE
    // only (a recorded `null` reaches the model; see W8-D2).
    computed_at: (Object.hasOwn(metadata, "computed_at")
      ? metadata["computed_at"]
      : "") as string,
  });
}

/**
 * Run a full data audit — events plus properties (`run_audit`,
 * `workspace.py:9029-9067`).
 *
 * @param client - The wire client.
 * @returns The audit response (violations + `computed_at`).
 * @throws MixpanelHeadlessError - Unexpected audit-response shape.
 * @throws ResponseValidationError - A malformed violation entry.
 * @throws AuthenticationError | QueryError | ServerError - Wire failures.
 */
export async function runAudit(client: MixpanelClient): Promise<AuditResponse> {
  const raw = await client.runAudit();
  return auditResponseFrom(raw, "run_audit");
}

/**
 * Run an events-only data audit (`run_audit_events_only`,
 * `workspace.py:9069-9103`).
 *
 * @param client - The wire client.
 * @returns The audit response (event violations only).
 * @throws MixpanelHeadlessError - Unexpected audit-response shape.
 * @throws ResponseValidationError - A malformed violation entry.
 * @throws AuthenticationError | QueryError | ServerError - Wire failures.
 */
export async function runAuditEventsOnly(
  client: MixpanelClient,
): Promise<AuditResponse> {
  const raw = await client.runAuditEventsOnly();
  return auditResponseFrom(raw, "run_audit_events_only");
}

// ---------------------------------------------------------------------------
// Data Volume Anomalies (`workspace.py:9107-9199`)
// ---------------------------------------------------------------------------

/**
 * List detected data-volume anomalies (`list_data_volume_anomalies`,
 * `workspace.py:9110-9141`).
 *
 * @param client - The wire client.
 * @param options - `query_params` filters (keyword-only in Python).
 * @returns The `DataVolumeAnomaly` models, in response order.
 * @throws ResponseValidationError - Malformed payload.
 */
export async function listDataVolumeAnomalies(
  client: MixpanelClient,
  options: WorkspaceListDataVolumeAnomaliesOptions = {},
): Promise<DataVolumeAnomaly[]> {
  const rawList = await client.listDataVolumeAnomalies({
    query_params: options.query_params ?? null,
  });
  return validateResponseModels(DataVolumeAnomaly, rawList.map(native), {
    endpoint: "list_data_volume_anomalies",
  });
}

/**
 * Update the status of a single anomaly (`update_anomaly`,
 * `workspace.py:9143-9169`) — response VERBATIM.
 *
 * @param client - The wire client.
 * @param params - Update parameters (the PLAIN `model_dump(
 *   by_alias=True)` at `:9169` — `None`s are KEPT, W8-D1).
 * @returns The raw API response.
 * @throws AuthenticationError | QueryError | ServerError - Wire failures.
 */
export async function updateAnomaly(
  client: MixpanelClient,
  params: UpdateAnomalyParams,
): Promise<Record<string, unknown>> {
  const raw = await client.updateAnomaly(params.modelDump({ byAlias: true }));
  return native(raw) as Record<string, unknown>;
}

/**
 * Bulk-update anomaly statuses (`bulk_update_anomalies`,
 * `workspace.py:9171-9198`) — response VERBATIM.
 *
 * @param client - The wire client.
 * @param params - Bulk update parameters (the PLAIN `model_dump(
 *   by_alias=True)` at `:9198` — `None`s are KEPT, W8-D1).
 * @returns The raw API response.
 * @throws AuthenticationError | QueryError | ServerError - Wire failures.
 */
export async function bulkUpdateAnomalies(
  client: MixpanelClient,
  params: BulkUpdateAnomalyParams,
): Promise<Record<string, unknown>> {
  const raw = await client.bulkUpdateAnomalies(
    params.modelDump({ byAlias: true }),
  );
  return native(raw) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Event Deletion Requests (`workspace.py:9201-9331`)
// ---------------------------------------------------------------------------

/**
 * List all event deletion requests (`list_deletion_requests`,
 * `workspace.py:9204-9227`).
 *
 * @param client - The wire client.
 * @returns The `EventDeletionRequest` models, in response order.
 * @throws ResponseValidationError - Malformed payload.
 */
export async function listDeletionRequests(
  client: MixpanelClient,
): Promise<EventDeletionRequest[]> {
  const rawList = await client.listDeletionRequests();
  return validateResponseModels(EventDeletionRequest, rawList.map(native), {
    endpoint: "list_deletion_requests",
  });
}

/**
 * Create a new event deletion request (`create_deletion_request`,
 * `workspace.py:9229-9266`) — the API returns the updated FULL list.
 *
 * @param client - The wire client.
 * @param params - Deletion parameters (dumped with
 *   `exclude_none=True, by_alias=True`, `:9262`).
 * @returns Every deletion request after creation.
 * @throws ResponseValidationError - Malformed payload.
 */
export async function createDeletionRequest(
  client: MixpanelClient,
  params: CreateDeletionRequestParams,
): Promise<EventDeletionRequest[]> {
  const rawList = await client.createDeletionRequest(
    params.modelDumpExcludeNone({ byAlias: true }),
  );
  return validateResponseModels(EventDeletionRequest, rawList.map(native), {
    endpoint: "create_deletion_request",
  });
}

/**
 * Cancel a pending deletion request (`cancel_deletion_request`,
 * `workspace.py:9268-9294`) — the API returns the updated FULL list.
 *
 * @param client - The wire client.
 * @param requestId - Deletion request ID to cancel (positional in
 *   Python).
 * @returns Every deletion request after cancellation.
 * @throws ResponseValidationError - Malformed payload.
 */
export async function cancelDeletionRequest(
  client: MixpanelClient,
  requestId: number,
): Promise<EventDeletionRequest[]> {
  const rawList = await client.cancelDeletionRequest(requestId);
  return validateResponseModels(EventDeletionRequest, rawList.map(native), {
    endpoint: "cancel_deletion_request",
  });
}

/**
 * Preview what events a deletion filter would match
 * (`preview_deletion_filters`, `workspace.py:9296-9331`) — read-only,
 * and the list is returned VERBATIM (no model validation).
 *
 * @param client - The wire client.
 * @param params - Preview parameters (dumped with
 *   `exclude_none=True, by_alias=True`, `:9329`).
 * @returns The expanded/normalized filters.
 * @throws AuthenticationError | QueryError | ServerError - Wire failures.
 */
export async function previewDeletionFilters(
  client: MixpanelClient,
  params: PreviewDeletionFiltersParams,
): Promise<Array<Record<string, unknown>>> {
  const rawList = await client.previewDeletionFilters(
    params.modelDumpExcludeNone({ byAlias: true }),
  );
  return rawList.map(native) as Array<Record<string, unknown>>;
}
