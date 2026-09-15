/**
 * Schema-enforcement wire methods on the App API: one endpoint
 * (`data-definitions/schema/`, workspace-scoped through
 * `maybe_scoped_path`), five verbs. Unlike the other deletes in this
 * directory, `delete_schema_enforcement` takes no arguments and still
 * returns a dict.
 *
 * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.get_schema_enforcement
 */

import { appRequest } from "../../client/app-request.js";
import type { ClientCore } from "../../client/core.js";
import type { JsonValue } from "../../client/json-value.js";
import { maybeScopedPath } from "../../client/scope.js";
import { expectRecordResult } from "./shared.js";

/** Options bag of {@link SchemaEnforcementMethods.getSchemaEnforcement}. */
export interface GetSchemaEnforcementOptions {
  /** Comma-separated field names to return (e.g. "ruleEvent,state"). */
  readonly fields?: string | null | undefined;
  /** Optional cancellation signal. */
  readonly signal?: AbortSignal | undefined;
}

/** Schema-enforcement methods mixed into `MixpanelClient`. */
export interface SchemaEnforcementMethods {
  /**
   * Get enforcement configuration (`get_schema_enforcement` — GET
   * `data-definitions/schema/`).
   *
   * @param options - Optional `fields` filter + signal.
   * @returns The enforcement config dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  getSchemaEnforcement: (
    options?: GetSchemaEnforcementOptions,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Initialize enforcement (`init_schema_enforcement` —
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
   * Partially update enforcement (`update_schema_enforcement` — PATCH).
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
   * Fully replace enforcement (`replace_schema_enforcement` — PUT).
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
   * Delete enforcement configuration (`delete_schema_enforcement` — DELETE, no
   * arguments, dict return).
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
 * Build the schema-enforcement methods over the shared client core.
 *
 * @param core - The shared client internals seam.
 * @returns The method bag.
 */
export function createSchemaEnforcementMethods(
  core: ClientCore,
): SchemaEnforcementMethods {
  /** `maybe_scoped_path` over the pin current at call time. */
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
