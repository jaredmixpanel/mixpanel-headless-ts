/**
 * Helpers shared by the B6 `workspace-members/*` modules.
 *
 * Extracted at B6-W3 from the W2 dashboards module (which had the
 * first two copies) so no shard re-derives them — R10.8's
 * single-implementation rule applied inside the facade layer itself.
 * Nothing here assembles a request, merges a header, builds a URL or
 * branches on status: the wire client owns all of that.
 */

import { toNativeJson, type JsonValue } from "../client/json-value.js";
import { MixpanelHeadlessError } from "../errors.js";

/**
 * `if raw is None: raise MixpanelHeadlessError(...)` — the facade's
 * empty-response guard (e.g. `workspace.py:4565-4568`,
 * `:5312-5315`, `:5644-5647`).
 *
 * The B4 client raises for a non-dict envelope BEFORE `None` can reach
 * the facade, so the branch is unreachable through the wire in Python
 * too; it is ported defensively and locked at the member seam.
 *
 * @param raw - The client's return value.
 * @param member - The Python member name used in the message.
 * @returns The payload, narrowed to non-nullish.
 * @throws MixpanelHeadlessError - Code `UNKNOWN_ERROR` when the payload
 *   is `None` (the `exceptions.py` constructor default).
 */
export function requireResponse(raw: unknown, member: string): unknown {
  if (raw === null || raw === undefined) {
    throw new MixpanelHeadlessError(
      `API returned empty response for ${member}`,
    );
  }
  return raw;
}

/**
 * `json.loads`-native view of a client payload — the Phase-2 models
 * validate against native values, not the lossless `JsonValue` tree
 * (the `client.ts:878` `list_workspaces` precedent).
 *
 * @param raw - The lossless payload.
 * @returns The native-valued tree.
 */
export function native(raw: unknown): unknown {
  return toNativeJson(raw as JsonValue);
}
