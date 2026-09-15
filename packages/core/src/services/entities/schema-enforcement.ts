/**
 * Schema-enforcement wire methods (App API) — Phase-3 packet B4-C5
 * port of the `MixpanelAPIClient` enforcement range
 * (`api_client.py:8170-8339`).
 *
 * One endpoint (`data-definitions/schema/`), five verbs, all through
 * B0 `appRequest` over `maybe_scoped_path` (R10.8); NOTE
 * `delete_schema_enforcement` takes NO arguments and still returns a
 * dict (unlike C5's void deletes — Behavior spine, "watch
 * delete_schemas vs delete_schema_enforcement").
 */

import { appRequest } from "../../client/app-request.js";
import type { ClientCore } from "../../client/client.js";
import type { JsonValue } from "../../client/json-value.js";
import { maybeScopedPath } from "../../client/scope.js";
import { expectRecordResult } from "./shared.js";

/** Options bag of {@link SchemaEnforcementMethods.getSchemaEnforcement}. */
export interface GetSchemaEnforcementOptions {
  /** Comma-separated field names to return (e.g. "ruleEvent,state"). */
  readonly fields?: string | null | undefined;
  /** Optional cancellation signal (R6.7). */
  readonly signal?: AbortSignal | undefined;
}

/** The C5 schema-enforcement method surface (mixed into `MixpanelClient`). */
export interface SchemaEnforcementMethods {
  /**
   * Get enforcement configuration (`get_schema_enforcement`,
   * `api_client.py:8170-8206` — GET `data-definitions/schema/`).
   *
   * @param options - Optional `fields` filter + signal.
   * @returns The enforcement config dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  getSchemaEnforcement: (
    options?: GetSchemaEnforcementOptions,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Initialize enforcement (`init_schema_enforcement`, `:8208-8242` —
   * POST).
   *
   * @param body - Init payload.
   * @param signal - Optional cancellation signal.
   * @returns The raw response dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  initSchemaEnforcement: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Partially update enforcement (`update_schema_enforcement`,
   * `:8244-8278` — PATCH).
   *
   * @param body - Partial update payload.
   * @param signal - Optional cancellation signal.
   * @returns The raw response dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  updateSchemaEnforcement: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Fully replace enforcement (`replace_schema_enforcement`,
   * `:8280-8312` — PUT).
   *
   * @param body - Complete replacement payload.
   * @param signal - Optional cancellation signal.
   * @returns The raw response dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  replaceSchemaEnforcement: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Delete enforcement configuration (`delete_schema_enforcement`,
   * `:8314-8339` — DELETE, no arguments, dict return).
   *
   * @param signal - Optional cancellation signal.
   * @returns The raw response dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  deleteSchemaEnforcement: (
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;
}

/**
 * Build the C5 schema-enforcement methods over the C1 core seam.
 *
 * @param core - The shared client internals seam.
 * @returns The method bag.
 */
export function createSchemaEnforcementMethods(
  core: ClientCore,
): SchemaEnforcementMethods {
  /** `self.maybe_scoped_path(...)` over the CURRENT pin (call-time). */
  const scopedPath = (domainPath: string): string =>
    maybeScopedPath(domainPath, {
      projectId: core.projectId(),
      workspaceId: core.workspaceId(),
    });

  return {
    getSchemaEnforcement: async (
      options: GetSchemaEnforcementOptions = {},
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath("data-definitions/schema/");
      const params =
        options.fields !== undefined && options.fields !== null
          ? { fields: options.fields }
          : null;
      const result = await appRequest(
        core.appDeps(options.signal),
        "GET",
        path,
        {
          params,
        },
      );
      return expectRecordResult(result, "get_schema_enforcement");
    },

    initSchemaEnforcement: async (
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath("data-definitions/schema/");
      const result = await appRequest(core.appDeps(signal), "POST", path, {
        jsonBody: body,
      });
      return expectRecordResult(result, "init_schema_enforcement");
    },

    updateSchemaEnforcement: async (
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath("data-definitions/schema/");
      const result = await appRequest(core.appDeps(signal), "PATCH", path, {
        jsonBody: body,
      });
      return expectRecordResult(result, "update_schema_enforcement");
    },

    replaceSchemaEnforcement: async (
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath("data-definitions/schema/");
      const result = await appRequest(core.appDeps(signal), "PUT", path, {
        jsonBody: body,
      });
      return expectRecordResult(result, "replace_schema_enforcement");
    },

    deleteSchemaEnforcement: async (
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath("data-definitions/schema/");
      const result = await appRequest(core.appDeps(signal), "DELETE", path);
      return expectRecordResult(result, "delete_schema_enforcement");
    },
  };
}
