/**
 * Custom-property wire methods on the App API (`custom_properties/`,
 * workspace-scoped through `maybe_scoped_path`). Ids are strings, and
 * update is a PUT (full replacement), not a PATCH; results come back
 * verbatim after Python's isinstance guards.
 *
 * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.list_custom_properties
 */

import { appRequest } from "../../client/app-request.js";
import type { ClientCore } from "../../client/core.js";
import type { JsonValue } from "../../client/json-value.js";
import { maybeScopedPath } from "../../client/scope.js";
import { expectListResult, expectRecordResult } from "./shared.js";

/** Custom-property methods mixed into `MixpanelClient`. */
export interface CustomPropertyMethods {
  /**
   * List custom properties. Sends GET `custom_properties/`.
   *
   * @param signal - Optional cancellation signal.
   * @returns The property list verbatim.
   * @throws {@link MixpanelHeadlessError} - Non-list response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.list_custom_properties
   */
  listCustomProperties: (signal?: AbortSignal) => Promise<JsonValue[]>;

  /**
   * Create a custom property. Sends POST `custom_properties/`.
   *
   * @param body - Custom-property definition.
   * @param signal - Optional cancellation signal.
   * @returns The created property dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.create_custom_property
   */
  createCustomProperty: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Get a custom property. Sends GET `custom_properties/{id}/`.
   *
   * @param propertyId - Custom-property ID (string).
   * @param signal - Optional cancellation signal.
   * @returns The property dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.get_custom_property
   */
  getCustomProperty: (
    propertyId: string,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Replace a custom property. Sends PUT `custom_properties/{id}/`, full
   * replacement.
   *
   * @param propertyId - Custom-property ID (string).
   * @param body - Full replacement definition.
   * @param signal - Optional cancellation signal.
   * @returns The updated property dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.update_custom_property
   */
  updateCustomProperty: (
    propertyId: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Delete a custom property.
   *
   * @param propertyId - Custom-property ID (string).
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.delete_custom_property
   */
  deleteCustomProperty: (
    propertyId: string,
    signal?: AbortSignal,
  ) => Promise<void>;

  /**
   * Validate a custom-property expression. Sends POST
   * `custom_properties/validate/`.
   *
   * @param body - Definition to validate.
   * @param signal - Optional cancellation signal.
   * @returns The validation result dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.validate_custom_property
   */
  validateCustomProperty: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;
}

/**
 * Build the custom-property methods over the shared client core.
 *
 * @param core - The shared client internals seam.
 * @returns The method bag.
 * @example
 * ```typescript
 * const props = createCustomPropertyMethods(core);
 * await props.validateCustomProperty({ name: "Revenue (USD)", formula: "..." });
 * // { valid: true, ... }
 * ```
 */
export function createCustomPropertyMethods(
  core: ClientCore,
): CustomPropertyMethods {
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
    listCustomProperties: async (
      signal?: AbortSignal,
    ): Promise<JsonValue[]> => {
      const path = scopedPath("custom_properties/");
      const result = await appRequest(core.appDeps(signal), "GET", path);
      return expectListResult(result, "list_custom_properties");
    },

    createCustomProperty: async (
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath("custom_properties/");
      const result = await appRequest(core.appDeps(signal), "POST", path, {
        jsonBody: body,
      });
      return expectRecordResult(result, "create_custom_property");
    },

    getCustomProperty: async (
      propertyId: string,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath(`custom_properties/${propertyId}/`);
      const result = await appRequest(core.appDeps(signal), "GET", path);
      return expectRecordResult(result, "get_custom_property");
    },

    updateCustomProperty: async (
      propertyId: string,
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath(`custom_properties/${propertyId}/`);
      const result = await appRequest(core.appDeps(signal), "PUT", path, {
        jsonBody: body,
      });
      return expectRecordResult(result, "update_custom_property");
    },

    deleteCustomProperty: async (
      propertyId: string,
      signal?: AbortSignal,
    ): Promise<void> => {
      const path = scopedPath(`custom_properties/${propertyId}/`);
      await appRequest(core.appDeps(signal), "DELETE", path);
    },

    validateCustomProperty: async (
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath("custom_properties/validate/");
      const result = await appRequest(core.appDeps(signal), "POST", path, {
        jsonBody: body,
      });
      return expectRecordResult(result, "validate_custom_property");
    },
  };
}
