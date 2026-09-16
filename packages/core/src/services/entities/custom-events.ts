/**
 * Custom-event wire methods on the App API (`custom_events/` and
 * `data-definitions/events/`, workspace-scoped through
 * `maybe_scoped_path`). `create_custom_event` posts a form body and peels
 * the `{custom_event: ...}` inner envelope; `update_custom_event` keeps
 * Python's defense-in-depth `UPDATE_TARGET_MISMATCH` echo check, because
 * the data-definitions endpoint has silently created instead of updated
 * in the past. `list_custom_events` is not corpus-locked.
 *
 * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.create_custom_event
 */

import { appRequest } from "../../client/app-request.js";
import type { ClientCore } from "../../client/core.js";
import { isPlainRecord, jsonValuePythonStr } from "../../client/internals.js";
import type { JsonValue } from "../../client/json-value.js";
import { maybeScopedPath } from "../../client/scope.js";
import { MixpanelHeadlessError } from "../../errors.js";
import { pythonTypeNameOf } from "../shared.js";
import { expectListResult, expectRecordResult, pyIntEquals } from "./shared.js";

/** Custom-event methods mixed into `MixpanelClient`. */
export interface CustomEventMethods {
  /**
   * Create a custom event. Sends POST `custom_events/` with a form-encoded body;
   * unwraps the `{custom_event: ...}` inner envelope after `appRequest`'s
   * `results` unwrap.
   *
   * @param body - Form fields: `name` + JSON-encoded `alternatives`.
   * @param signal - Optional cancellation signal.
   * @returns The created custom-event dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict payload after unwrapping.
   * @throws {@link QueryError} - Validation errors (400/422; the form body rides
   *   in `details.request_body`).
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.create_custom_event
   */
  createCustomEvent: (
    body: Record<string, string>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * List custom events. Sends GET `data-definitions/events/` with
   * `custom_event=true`.
   *
   * @param signal - Optional cancellation signal.
   * @returns The custom-event definition list.
   * @throws {@link MixpanelHeadlessError} - Non-list response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.list_custom_events
   */
  listCustomEvents: (signal?: AbortSignal) => Promise<JsonValue[]>;

  /**
   * Update a custom event's lexicon entry. Sends PATCH `data-definitions/events/`
   * with `{**body, customEventId}`; raises `UPDATE_TARGET_MISMATCH` when the
   * server echoes a different `customEventId`.
   *
   * @param customEventId - Server-assigned custom-event ID (int).
   * @param body - Fields to update.
   * @param signal - Optional cancellation signal.
   * @returns The updated lexicon entry dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response, or the echoed id
   *   differs from the requested one (`UPDATE_TARGET_MISMATCH`).
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.update_custom_event
   */
  updateCustomEvent: (
    customEventId: number,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Delete a custom event. Sends DELETE `data-definitions/events/` with
   * `{customEventId}`; id, not name — a name-only DELETE is ambiguous upstream.
   *
   * @param customEventId - Server-assigned custom-event ID (int).
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.delete_custom_event
   */
  deleteCustomEvent: (
    customEventId: number,
    signal?: AbortSignal,
  ) => Promise<void>;
}

/**
 * Build the custom-event methods over the shared client core.
 *
 * @param core - The shared client internals seam.
 * @returns The method bag.
 * @example
 * ```typescript
 * const customEvents = createCustomEventMethods(core);
 * await customEvents.updateCustomEvent(88, { description: "Any purchase" });
 * // { customEventId: 88, name: "Purchase", description: "Any purchase", ... }
 * ```
 */
export function createCustomEventMethods(core: ClientCore): CustomEventMethods {
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
    createCustomEvent: async (
      body: Record<string, string>,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath("custom_events/");
      let payload = await appRequest(core.appDeps(signal), "POST", path, {
        formBody: body,
      });
      // The /custom_events/ endpoint nests the entity under
      // {custom_event: ...} inside the standard {results: ...}
      // envelope appRequest already unwrapped — peel the inner
      // wrapper here.
      if (isPlainRecord(payload) && Object.hasOwn(payload, "custom_event")) {
        payload = payload["custom_event"] as JsonValue;
      }
      if (!isPlainRecord(payload)) {
        throw new MixpanelHeadlessError(
          `Unexpected response from create_custom_event: ` +
            `expected dict, got ${pythonTypeNameOf(payload)}`,
        );
      }
      return payload;
    },

    listCustomEvents: async (signal?: AbortSignal): Promise<JsonValue[]> => {
      const path = scopedPath("data-definitions/events/");
      const result = await appRequest(core.appDeps(signal), "GET", path, {
        params: { custom_event: "true" },
      });
      return expectListResult(result, "list_custom_events");
    },

    updateCustomEvent: async (
      customEventId: number,
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath("data-definitions/events/");
      const payload = { ...body, customEventId };
      const result = await appRequest(core.appDeps(signal), "PATCH", path, {
        jsonBody: payload,
      });
      const record = expectRecordResult(result, "update_custom_event");
      // Defense in depth: if the server echoes back a different
      // customEventId, the lexicon entry may have been
      // created instead of updated — fail rather than return an
      // unrelated entity. Python `!=` here is numeric cross-type
      // equality ({@link pyIntEquals}).
      const returnedId = Object.hasOwn(record, "customEventId")
        ? (record["customEventId"] as JsonValue)
        : undefined;
      if (
        returnedId !== undefined &&
        returnedId !== null &&
        !pyIntEquals(returnedId, customEventId)
      ) {
        throw new MixpanelHeadlessError(
          `update_custom_event: server returned customEventId=` +
            `${reprOf(returnedId)} but ${customEventId} was requested. ` +
            `The lexicon entry may have been created instead of ` +
            `updated.`,
          "UPDATE_TARGET_MISMATCH",
        );
      }
      return record;
    },

    deleteCustomEvent: async (
      customEventId: number,
      signal?: AbortSignal,
    ): Promise<void> => {
      const path = scopedPath("data-definitions/events/");
      await appRequest(core.appDeps(signal), "DELETE", path, {
        jsonBody: { customEventId },
      });
    },
  };
}

/**
 * Python `{value!r}` over a parsed wire member (message text only, which
 * is out of contract; strings gain quotes, everything else uses the
 * `str()` spelling).
 *
 * @param value - The echoed member.
 * @returns The repr-ish spelling for the mismatch message.
 */
function reprOf(value: JsonValue): string {
  if (typeof value === "string") {
    return `'${value}'`;
  }
  return jsonValuePythonStr(value);
}
