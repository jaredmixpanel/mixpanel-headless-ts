/**
 * Custom-property wire methods (App API) — Phase-3 packet B4-C5 port
 * of the `MixpanelAPIClient` custom-properties range
 * (`api_client.py:7345-7541`).
 *
 * All methods route through B0 `appRequest` over `maybe_scoped_path`
 * (R10.8). Custom-property IDs are STRINGS (R3-family). `update` is a
 * PUT (full replacement), not PATCH. Results are returned verbatim
 * after the source's isinstance guards (Caution #11).
 */

import { appRequest } from "../../client/app-request.js";
import type { ClientCore } from "../../client/client.js";
import type { JsonValue } from "../../client/json-value.js";
import { maybeScopedPath } from "../../client/scope.js";
import { expectListResult, expectRecordResult } from "./shared.js";

/** The C5 custom-property method surface (mixed into `MixpanelClient`). */
export interface CustomPropertyMethods {
  /**
   * List custom properties (`list_custom_properties`,
   * `api_client.py:7345-7373` — GET `custom_properties/`).
   *
   * @param signal - Optional cancellation signal.
   * @returns The property list verbatim.
   * @throws MixpanelHeadlessError - Non-list response.
   */
  listCustomProperties: (signal?: AbortSignal) => Promise<JsonValue[]>;

  /**
   * Create a custom property (`create_custom_property`, `:7375-7409`
   * — POST `custom_properties/`).
   *
   * @param body - Custom-property definition.
   * @param signal - Optional cancellation signal.
   * @returns The created property dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  createCustomProperty: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Get a custom property (`get_custom_property`, `:7411-7442` — GET
   * `custom_properties/{id}/`).
   *
   * @param propertyId - Custom-property ID (string).
   * @param signal - Optional cancellation signal.
   * @returns The property dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  getCustomProperty: (
    propertyId: string,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Replace a custom property (`update_custom_property`, `:7444-7480`
   * — PUT `custom_properties/{id}/`, full replacement).
   *
   * @param propertyId - Custom-property ID (string).
   * @param body - Full replacement definition.
   * @param signal - Optional cancellation signal.
   * @returns The updated property dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  updateCustomProperty: (
    propertyId: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Delete a custom property (`delete_custom_property`, `:7482-7504`).
   *
   * @param propertyId - Custom-property ID (string).
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   */
  deleteCustomProperty: (
    propertyId: string,
    signal?: AbortSignal,
  ) => Promise<void>;

  /**
   * Validate a custom-property expression (`validate_custom_property`,
   * `:7506-7540` — POST `custom_properties/validate/`).
   *
   * @param body - Definition to validate.
   * @param signal - Optional cancellation signal.
   * @returns The validation result dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  validateCustomProperty: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;
}

/**
 * Build the C5 custom-property methods over the C1 core seam.
 *
 * @param core - The shared client internals seam.
 * @returns The method bag.
 */
export function createCustomPropertyMethods(
  core: ClientCore,
): CustomPropertyMethods {
  /** `self.maybe_scoped_path(...)` over the CURRENT pin (call-time). */
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
