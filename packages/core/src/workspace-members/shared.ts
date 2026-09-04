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
import { MixpanelHeadlessError, ParamValidationError } from "../errors.js";

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

/**
 * Render an untrusted value for an error message without echoing it:
 * primitives as `typeof` + a 40-char slice, objects by constructor name
 * only (a caller's whole params bag never lands in a log line).
 *
 * @param value - The received value.
 * @returns A short, deterministic description.
 */
function describeReceived(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  switch (typeof value) {
    case "object": {
      const proto: unknown = Object.getPrototypeOf(value);
      const ctor =
        proto !== null && typeof proto === "object"
          ? (proto as { constructor?: { name?: string } }).constructor?.name
          : undefined;
      return `object (${ctor ?? "null prototype"})`;
    }
    case "function":
      return "function";
    case "string":
      return `string "${value.slice(0, 40)}"`;
    default:
      return `${typeof value} ${String(value).slice(0, 40)}`;
  }
}

/**
 * Reject a positional entity id that is not a positive safe integer
 * BEFORE any request is assembled — the facade-level twin of the
 * report-link builders' `_require_positive_id` (`RL6_INVALID_ID`).
 *
 * Motivation: a caller passing `{ annotation_id: 2078447 }` where
 * `deleteAnnotation(annotationId: number)` expects the bare number had
 * the port interpolate `/annotations/[object Object]/` into the path and
 * surface the server's 404 as `QUERY_FAILED`. Python does not guard
 * these arguments (its signatures are `int`-typed and the same call
 * fails the same way server-side), so this is additive hardening: it
 * rejects only calls the server would reject anyway and changes no
 * conformance verdict (every vector carries a valid id).
 *
 * The code is Python's own `RL6_INVALID_ID` ("An id is a positive
 * integer") rather than a new registry entry: the registry is generated
 * from the Python-side contract artifact and cannot grow on the TS side.
 *
 * @param field - The Python parameter name (`annotation_id`), used in the
 *   message and `details.field`.
 * @param value - The received value, untrusted.
 * @returns `value`, narrowed to `number`.
 * @throws ParamValidationError - `RL6_INVALID_ID` when `value` is not a
 *   finite positive integer (`0`, negatives, fractions, `NaN`,
 *   `Infinity`, numeric strings, objects, `null`, `undefined`).
 */
export function requireEntityId(field: string, value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value;
  }
  const received = describeReceived(value);
  throw new ParamValidationError(
    `Invalid ${field}: expected a positive integer id, received ${received}.`,
    "RL6_INVALID_ID",
    { field, received },
  );
}
