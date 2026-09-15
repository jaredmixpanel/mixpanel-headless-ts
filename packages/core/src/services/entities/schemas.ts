/**
 * Lexicon schema + Schema Registry wire methods — Phase-3 packet B4-C5
 * port of the `MixpanelAPIClient` schemas range
 * (`api_client.py:3294-3649`).
 *
 * Two wire paths coexist in this range, ported verbatim:
 * - `get_schemas`/`get_schema` (`:3294-3392`) ride the C1 `_request`
 *   twin (`core.requestQueryHost` with `inject_project_id=False` —
 *   `query_origin` + retry live THERE, R10.8);
 * - the registry CRUD (`:3398-3649`) rides B0 `appRequest` over
 *   `maybe_scoped_path` with `urllib.parse.quote(..., safe="")`
 *   path-segment encoding ({@link pythonQuote}).
 *
 * Results are returned verbatim after the source's isinstance guards
 * (Caution #11 — no result pre-shaping).
 */

import { appRequest } from "../../client/app-request.js";
import type { ClientCore } from "../../client/core.js";
import { isPlainRecord } from "../../client/internals.js";
import type { JsonValue } from "../../client/json-value.js";
import { maybeScopedPath } from "../../client/scope.js";
import { MixpanelHeadlessError } from "../../errors.js";
import {
  expectListResult,
  expectRecordResult,
  pythonQuote,
  pythonTypeNameOf,
} from "./shared.js";

/** Options bag of {@link SchemaMethods.getSchemas}. */
export interface GetSchemasOptions {
  /** Optional entity-type PATH segment ("event", "profile", ...). */
  readonly entity_type?: string | null | undefined;
  /** Optional cancellation signal (R6.7). */
  readonly signal?: AbortSignal | undefined;
}

/** Options bag of {@link SchemaMethods.listSchemaRegistry}. */
export interface ListSchemaRegistryOptions {
  /** Optional entity-type filter ("event", "custom_event", "profile"). */
  readonly entity_type?: string | null | undefined;
  /** Optional cancellation signal (R6.7). */
  readonly signal?: AbortSignal | undefined;
}

/** Options bag of {@link SchemaMethods.deleteSchemas}. */
export interface DeleteSchemasOptions {
  /** Filter by entity type. */
  readonly entity_type?: string | null | undefined;
  /** Filter by entity name (requires `entity_type`). */
  readonly entity_name?: string | null | undefined;
  /** Optional cancellation signal (R6.7). */
  readonly signal?: AbortSignal | undefined;
}

/**
 * The Python `dict.get(key, default)` twin over a `_request` product
 * annotated `dict` (`get_schemas`/`get_schema` — the source calls
 * `.get` without an isinstance guard, so a non-dict body raises
 * AttributeError; the TypeError below is the closest JS analog).
 *
 * @param result - The parsed response body.
 * @param key - The key to read.
 * @param fallback - The Python default.
 * @returns The member (even when `null` — `.get`'s default applies
 *   only to ABSENT keys), or the fallback.
 * @throws TypeError - Non-record body (the AttributeError analog).
 */
function dictGet(
  result: JsonValue,
  key: string,
  fallback: JsonValue,
): JsonValue {
  if (!isPlainRecord(result)) {
    // TODO(port): Python raises AttributeError("'X' object has no
    // attribute 'get'") here; no vector or Layer-3 test locks the
    // non-dict body, so the closest JS error class stands in.
    throw new TypeError(
      `'${pythonTypeNameOf(result)}' object has no attribute 'get'`,
    );
  }
  return Object.hasOwn(result, key) ? (result[key] as JsonValue) : fallback;
}

/** The C5 schema method surface (mixed into `MixpanelClient`). */
export interface SchemaMethods {
  /**
   * List all Lexicon schemas (`get_schemas`, `api_client.py:3294-3343`
   * — GET `/projects/{pid}/schemas[/{entity_type}]` on the App host
   * via the `_request` twin, `inject_project_id=False`).
   *
   * @param options - Optional `entity_type` path segment + signal.
   * @returns `result.get("results", [])` verbatim.
   * @throws AuthenticationError | RateLimitError | QueryError |
   *   ServerError - Per the B0 `executeWithRetry` contract.
   */
  getSchemas: (options?: GetSchemasOptions) => Promise<JsonValue>;

  /**
   * Get a single Lexicon schema (`get_schema`, `:3345-3392` — GET
   * `/projects/{pid}/schemas/{entity_type}?entity_name={name}`),
   * normalized to `{entityType, name, schemaJson}`.
   *
   * @param entityType - Entity type ("event", "profile", ...).
   * @param name - Entity name.
   * @param signal - Optional cancellation signal.
   * @returns The normalized schema record.
   * @throws QueryError - Schema not found (404 → QueryError mapping).
   */
  getSchema: (
    entityType: string,
    name: string,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * List schema-registry entries (`list_schema_registry`,
   * `:3398-3435` — GET `schemas[/{quoted entity_type}]`).
   *
   * @param options - Optional `entity_type` filter + signal.
   * @returns The entry list verbatim.
   * @throws MixpanelHeadlessError - Non-list response.
   */
  listSchemaRegistry: (
    options?: ListSchemaRegistryOptions,
  ) => Promise<JsonValue[]>;

  /**
   * Create one schema (`create_schema`, `:3437-3478` — POST
   * `schemas/{et}/{en}` with quoted segments).
   *
   * @param entityType - Entity type.
   * @param entityName - Entity name.
   * @param schemaJson - JSON Schema Draft 7 definition (the body).
   * @param signal - Optional cancellation signal.
   * @returns The created schema dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  createSchema: (
    entityType: string,
    entityName: string,
    schemaJson: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Bulk-create schemas (`create_schemas_bulk`, `:3480-3515` — POST
   * `schemas`).
   *
   * @param body - Bulk creation payload.
   * @param signal - Optional cancellation signal.
   * @returns Dict with `added`/`deleted` counts.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  createSchemasBulk: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Update one schema (`update_schema`, `:3517-3558` — PATCH
   * `schemas/{et}/{en}`, merge semantics).
   *
   * @param entityType - Entity type.
   * @param entityName - Entity name.
   * @param schemaJson - Partial JSON Schema to merge.
   * @param signal - Optional cancellation signal.
   * @returns The updated schema dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  updateSchema: (
    entityType: string,
    entityName: string,
    schemaJson: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Bulk-update schemas (`update_schemas_bulk`, `:3560-3592` — PATCH
   * `schemas`).
   *
   * @param body - Bulk update payload.
   * @param signal - Optional cancellation signal.
   * @returns Per-entry result list.
   * @throws MixpanelHeadlessError - Non-list response.
   */
  updateSchemasBulk: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<JsonValue[]>;

  /**
   * Delete schemas by type and/or name (`delete_schemas`,
   * `:3594-3649` — DELETE `schemas[/{et}[/{en}]]`).
   *
   * @param options - Optional `entity_type`/`entity_name` + signal.
   * @returns Dict with the `deleteCount` field.
   * @throws MixpanelHeadlessError - `entity_name` without
   *   `entity_type` (guard raised before any request), or a non-dict
   *   response.
   */
  deleteSchemas: (
    options?: DeleteSchemasOptions,
  ) => Promise<Record<string, JsonValue>>;
}

/**
 * Build the C5 schema methods over the C1 core seam.
 *
 * @param core - The shared client internals seam.
 * @returns The method bag.
 */
export function createSchemaMethods(core: ClientCore): SchemaMethods {
  /** `self.maybe_scoped_path(...)` over the CURRENT pin (call-time). */
  const scopedPath = (domainPath: string): string =>
    maybeScopedPath(domainPath, {
      projectId: core.projectId(),
      workspaceId: core.workspaceId(),
    });

  return {
    getSchemas: async (options: GetSchemasOptions = {}): Promise<JsonValue> => {
      const entityType = options.entity_type;
      // entity_type is a PATH parameter, not a query parameter
      // (`api_client.py:3319-3323` — interpolated raw, no quote()).
      const path =
        entityType !== undefined && entityType !== null
          ? `/projects/${core.projectId()}/schemas/${entityType}`
          : `/projects/${core.projectId()}/schemas`;
      const url = core.buildUrl("app", path);
      const result = await core.requestQueryHost("GET", url, {
        injectProjectId: false,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
      // `result.get("results", [])` — note the source's debug-log set
      // comprehension iterates the product; its failure modes on
      // non-list results are not replicated (R9.5 — log-only effect).
      return dictGet(result, "results", []);
    },

    getSchema: async (
      entityType: string,
      name: string,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const url = core.buildUrl(
        "app",
        `/projects/${core.projectId()}/schemas/${entityType}`,
      );
      const result = await core.requestQueryHost("GET", url, {
        params: { entity_name: name },
        injectProjectId: false,
        ...(signal === undefined ? {} : { signal }),
      });
      // Single-schema format is {status: "ok", results: <schemaJson>};
      // normalize to the list-response shape (`:3386-3392`).
      const schemaJson = dictGet(result, "results", result);
      return { entityType, name, schemaJson };
    },

    listSchemaRegistry: async (
      options: ListSchemaRegistryOptions = {},
    ): Promise<JsonValue[]> => {
      const entityType = options.entity_type;
      const path = scopedPath(
        entityType !== undefined && entityType !== null
          ? `schemas/${pythonQuote(entityType)}`
          : "schemas",
      );
      const result = await appRequest(
        core.appDeps(options.signal),
        "GET",
        path,
      );
      return expectListResult(result, "list_schema_registry");
    },

    createSchema: async (
      entityType: string,
      entityName: string,
      schemaJson: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const et = pythonQuote(entityType);
      const en = pythonQuote(entityName);
      const path = scopedPath(`schemas/${et}/${en}`);
      const result = await appRequest(core.appDeps(signal), "POST", path, {
        jsonBody: schemaJson,
      });
      return expectRecordResult(result, "create_schema");
    },

    createSchemasBulk: async (
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath("schemas");
      const result = await appRequest(core.appDeps(signal), "POST", path, {
        jsonBody: body,
      });
      return expectRecordResult(result, "create_schemas_bulk");
    },

    updateSchema: async (
      entityType: string,
      entityName: string,
      schemaJson: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const et = pythonQuote(entityType);
      const en = pythonQuote(entityName);
      const path = scopedPath(`schemas/${et}/${en}`);
      const result = await appRequest(core.appDeps(signal), "PATCH", path, {
        jsonBody: schemaJson,
      });
      return expectRecordResult(result, "update_schema");
    },

    updateSchemasBulk: async (
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<JsonValue[]> => {
      const path = scopedPath("schemas");
      const result = await appRequest(core.appDeps(signal), "PATCH", path, {
        jsonBody: body,
      });
      return expectListResult(result, "update_schemas_bulk");
    },

    deleteSchemas: async (
      options: DeleteSchemasOptions = {},
    ): Promise<Record<string, JsonValue>> => {
      const entityType = options.entity_type;
      const entityName = options.entity_name;
      if (
        entityName !== undefined &&
        entityName !== null &&
        (entityType === undefined || entityType === null)
      ) {
        throw new MixpanelHeadlessError(
          "entity_name requires entity_type: providing entity_name " +
            "without entity_type would delete all schemas",
        );
      }
      let base = "schemas";
      if (entityType !== undefined && entityType !== null) {
        base = `schemas/${pythonQuote(entityType)}`;
        if (entityName !== undefined && entityName !== null) {
          base += `/${pythonQuote(entityName)}`;
        }
      }
      const path = scopedPath(base);
      const result = await appRequest(
        core.appDeps(options.signal),
        "DELETE",
        path,
      );
      return expectRecordResult(result, "delete_schemas");
    },
  };
}
