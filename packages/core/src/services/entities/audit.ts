/**
 * Data-audit wire methods (App API) — Phase-3 packet B4-C5 port of the
 * `MixpanelAPIClient` audit range (`api_client.py:8345-8416`).
 *
 * Both methods use `_raw=True` (the response is a 2-element
 * `[violations, metadata]` array inside the envelope) and share the
 * exact branch ladder: dict-with-`results` → inner must be a list;
 * bare list → pass through; anything else → error. Port exactly —
 * `run_audit`/`run_audit_events_only` return `list[Any]` (Behavior
 * spine).
 */

import { appRequest } from "../../client/app-request.js";
import type { ClientCore } from "../../client/core.js";
import { isPlainRecord } from "../../client/internals.js";
import type { JsonValue } from "../../client/json-value.js";
import { maybeScopedPath } from "../../client/scope.js";
import { MixpanelHeadlessError } from "../../errors.js";
import { pythonTypeNameOf } from "../shared.js";

/** The C5 audit method surface (mixed into `MixpanelClient`). */
export interface AuditMethods {
  /**
   * Run a full data audit (`run_audit`, `api_client.py:8345-8381` —
   * GET `data-definitions/audit/` with `_raw=True`).
   *
   * @param signal - Optional cancellation signal.
   * @returns The raw 2-element `[violations, metadata]` array.
   * @throws MixpanelHeadlessError - Non-list `results` member, or an
   *   unexpected response format.
   */
  runAudit: (signal?: AbortSignal) => Promise<JsonValue[]>;

  /**
   * Run an events-only audit (`run_audit_events_only`, `:8383-8416` —
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
 * Build the C5 audit methods over the C1 core seam.
 *
 * @param core - The shared client internals seam.
 * @returns The method bag.
 */
export function createAuditMethods(core: ClientCore): AuditMethods {
  /** `self.maybe_scoped_path(...)` over the CURRENT pin (call-time). */
  const scopedPath = (domainPath: string): string =>
    maybeScopedPath(domainPath, {
      projectId: core.projectId(),
      workspaceId: core.workspaceId(),
    });

  /**
   * The shared `_raw=True` branch ladder (`:8368-8381`/`:8404-8416`).
   *
   * @param result - The raw envelope product.
   * @returns The audit array.
   * @throws MixpanelHeadlessError - Per the source's two raise sites.
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
