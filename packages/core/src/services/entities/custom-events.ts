/**
 * Custom-event wire methods on the App API (`custom_events/` and
 * `data-definitions/events/`, workspace-scoped through
 * `maybe_scoped_path`). `create_custom_event` posts a form body and peels
 * the `{custom_event: ...}` inner envelope; `update_custom_event` keeps
 * Python's defence-in-depth `UPDATE_TARGET_MISMATCH` echo check, because
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
   * Create a custom event (`create_custom_event` — POST `custom_events/` with a
   * form-encoded body; unwraps the `{custom_event: ...}` inner
   * envelope after `appRequest`'s `results` unwrap).
   *
   * @param body - Form fields: `name` + JSON-encoded `alternatives`.
   * @param signal - Optional cancellation signal.
   * @returns The created custom-event dict.
   * @throws MixpanelHeadlessError - Non-dict payload after unwrapping.
   * @throws QueryError - Validation errors (400/422; the form body
   *   rides in `details.request_body`).
   */
  createCustomEvent: (
    body: Record<string, string>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * List custom events (`list_custom_events` — GET
   * `data-definitions/events/` with `custom_event=true`).
   *
   * @param signal - Optional cancellation signal.
   * @returns The custom-event definition list.
   * @throws MixpanelHeadlessError - Non-list response.
   */
  listCustomEvents: (signal?: AbortSignal) => Promise<JsonValue[]>;

  /**
   * Update a custom event's lexicon entry (`update_custom_event` — PATCH
   * `data-definitions/events/` with `{**body, customEventId}`; raises
   * `UPDATE_TARGET_MISMATCH` when the server echoes a different
   * `customEventId`).
   *
   * @param customEventId - Server-assigned custom-event ID (int).
   * @param body - Fields to update.
   * @param signal - Optional cancellation signal.
   * @returns The updated lexicon entry dict.
   * @throws MixpanelHeadlessError - Non-dict response, or the echoed
   *   id differs from the requested one (`UPDATE_TARGET_MISMATCH`).
   */
  updateCustomEvent: (
    customEventId: number,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Delete a custom event (`delete_custom_event` —
   * DELETE `data-definitions/events/` with `{customEventId}`; id, not
   * name — a name-only DELETE is ambiguous upstream).
   *
   * @param customEventId - Server-assigned custom-event ID (int).
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
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
 */
export function createCustomEventMethods(core: ClientCore): CustomEventMethods {
  /** `maybe_scoped_path` over the pin current at call time. */
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
      // Defence in depth: if the server echoes back a different
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
