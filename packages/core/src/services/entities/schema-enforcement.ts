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
   * Get enforcement configuration. Sends GET `data-definitions/schema/`.
   *
   * @param options - Optional `fields` filter + signal.
   * @returns The enforcement config dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @internal
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.get_schema_enforcement
   */
  getSchemaEnforcement: (
    options?: GetSchemaEnforcementOptions,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Initialize enforcement. Sends a POST.
   *
   * @param body - Init payload.
   * @param signal - Optional cancellation signal.
   * @returns The raw response dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.init_schema_enforcement
   */
  initSchemaEnforcement: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Partially update enforcement. Sends a PATCH.
   *
   * @param body - Partial update payload.
   * @param signal - Optional cancellation signal.
   * @returns The raw response dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.update_schema_enforcement
   */
  updateSchemaEnforcement: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Fully replace enforcement. Sends a PUT.
   *
   * @param body - Complete replacement payload.
   * @param signal - Optional cancellation signal.
   * @returns The raw response dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.replace_schema_enforcement
   */
  replaceSchemaEnforcement: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Delete enforcement configuration. Sends DELETE, no arguments, dict return.
   *
   * @param signal - Optional cancellation signal.
   * @returns The raw response dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.delete_schema_enforcement
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
 * @example
 * ```typescript
 * const enforcement = createSchemaEnforcementMethods(core);
 * await enforcement.getSchemaEnforcement({ fields: "ruleEvent,state" });
 * // { ruleEvent: "...", state: "enabled" }
 * ```
 */
export function createSchemaEnforcementMethods(
  core: ClientCore,
): SchemaEnforcementMethods {
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
