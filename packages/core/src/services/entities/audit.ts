/**
 * Data-audit wire methods on the App API (`data-definitions/audit/` and
 * `audit-events-only/`, workspace-scoped through `maybe_scoped_path`).
 * Both calls are raw-envelope requests whose product is a two-element
 * `[violations, metadata]` array, reached through one shared branch
 * ladder: dict with `results` → the inner value must be a list; bare
 * list → passed through; anything else → error.
 *
 * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.run_audit
 */

import { appRequest } from "../../client/app-request.js";
import type { ClientCore } from "../../client/core.js";
import { isPlainRecord } from "../../client/internals.js";
import type { JsonValue } from "../../client/json-value.js";
import { maybeScopedPath } from "../../client/scope.js";
import { MixpanelHeadlessError } from "../../errors.js";
import { pythonTypeNameOf } from "../shared.js";

/** Audit methods mixed into `MixpanelClient`. */
export interface AuditMethods {
  /**
   * Run a full data audit (`run_audit` —
   * GET `data-definitions/audit/` with `_raw=True`).
   *
   * @param signal - Optional cancellation signal.
   * @returns The raw 2-element `[violations, metadata]` array.
   * @throws MixpanelHeadlessError - Non-list `results` member, or an
   *   unexpected response format.
   */
  runAudit: (signal?: AbortSignal) => Promise<JsonValue[]>;

  /**
   * Run an events-only audit (`run_audit_events_only` —
   * GET `data-definitions/audit-events-only/`, same format).
   *
   * @param signal - Optional cancellation signal.
   * @returns The raw 2-element `[violations, metadata]` array.
   * @throws MixpanelHeadlessError - Non-list `results` member, or an
   *   unexpected response format.
   */
  runAuditEventsOnly: (signal?: AbortSignal) => Promise<JsonValue[]>;
}

/**
 * Build the audit methods over the shared client core.
 *
 * @param core - The shared client internals seam.
 * @returns The method bag.
 */
export function createAuditMethods(core: ClientCore): AuditMethods {
  /** `maybe_scoped_path` over the pin current at call time. */
  const scopedPath = (domainPath: string): string =>
    maybeScopedPath(domainPath, {
      projectId: core.projectId(),
      workspaceId: core.workspaceId(),
    });

  /**
   * The shared `_raw=True` branch ladder.
   *
   * @param result - The raw envelope product.
   * @returns The audit array.
   * @throws MixpanelHeadlessError - Non-list `results` member, or an
   *   unexpected response format.
   */
  const auditShape = (result: JsonValue): JsonValue[] => {
    if (isPlainRecord(result) && Object.hasOwn(result, "results")) {
      const inner = result["results"] as JsonValue;
      if (!Array.isArray(inner)) {
        throw new MixpanelHeadlessError(
          `Unexpected audit results type: expected list, ` +
            `got ${pythonTypeNameOf(inner)}`,
        );
      }
      return inner;
    }
    if (Array.isArray(result)) {
      return result;
    }
    throw new MixpanelHeadlessError(
      `Unexpected audit response format: ${pythonTypeNameOf(result)}`,
    );
  };

  return {
    runAudit: async (signal?: AbortSignal): Promise<JsonValue[]> => {
      const path = scopedPath("data-definitions/audit/");
      const result = await appRequest(core.appDeps(signal), "GET", path, {
        raw: true,
      });
      return auditShape(result);
    },

    runAuditEventsOnly: async (signal?: AbortSignal): Promise<JsonValue[]> => {
      const path = scopedPath("data-definitions/audit-events-only/");
      const result = await appRequest(core.appDeps(signal), "GET", path, {
        raw: true,
      });
      return auditShape(result);
    },
  };
}
