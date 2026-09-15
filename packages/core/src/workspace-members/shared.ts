/**
 * Helpers shared by the `workspace-members/*` modules: the empty-response
 * guard and the positional-id guards a member applies before it touches
 * the client. Nothing here assembles a request, merges a header, builds a
 * URL or branches on status — the wire client owns all of that.
 */

import { MixpanelHeadlessError, ParamValidationError } from "../errors.js";

/**
 * Reject an empty client payload the way Python's
 * `if raw is None: raise MixpanelHeadlessError(...)` does.
 *
 * @remarks
 * The client already raises for a non-dict envelope before `None` could
 * reach the facade, so through the wire this branch is unreachable in
 * both languages. It is kept so the facade's contract does not depend
 * on the client's.
 * @param raw - The client's return value.
 * @param member - The Python member name used in the message.
 * @returns The payload, narrowed to non-nullish.
 * @throws {@link MixpanelHeadlessError} - Code `UNKNOWN_ERROR` (the
 *   constructor default) when the payload is `null` or `undefined`.
 * @example
 * ```typescript
 * const raw = requireResponse(await client.getDashboard(id), "get_dashboard");
 * ```
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
 * Render an untrusted value for an error message without echoing it:
 * primitives as `typeof` + a 40-char slice, objects by constructor name
 * only (a caller's whole params bag never lands in a log line).
 *
 * @param value - The received value.
 * @returns A short, deterministic description.
 * @throws {@link TypeError} - Never in practice: the terminal arm exists
 *   because TypeScript cannot subtract the listed `typeof` results from
 *   `unknown`.
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
    case "function": {
      return "function";
    }
    case "string": {
      return `string "${value.slice(0, 40)}"`;
    }
    case "bigint":
    case "boolean":
    case "number":
    case "symbol":
    case "undefined": {
      return `${typeof value} ${String(value).slice(0, 40)}`;
    }
    default: {
      // Every `typeof` result is listed; TS cannot subtract them from
      // `unknown`, so it still wants a terminal arm.
      throw new TypeError(`unexpected typeof result: ${typeof value}`);
    }
  }
}

/**
 * Reject a positional entity id that is not a positive safe integer
 * before any request is assembled — the facade-level twin of the
 * report-link builders' `_require_positive_id`.
 *
 * @remarks
 * A caller passing `{ annotation_id: 2078447 }` where
 * `deleteAnnotation(annotationId: number)` expects the bare number would
 * otherwise have `/annotations/[object Object]/` interpolated into the
 * path and see the server's 404 as `QUERY_FAILED`. Python does not guard
 * these arguments (its signatures are `int`-typed and the same call
 * fails the same way server-side), so this is additive hardening: it
 * rejects only calls the server would reject anyway and changes no
 * conformance verdict. The code is Python's own `RL6_INVALID_ID` ("An id
 * is a positive integer") rather than a new one, because the code
 * registry is generated from the Python contract and cannot grow here.
 * @param field - The Python parameter name (`annotation_id`), used in the
 *   message and `details.field`.
 * @param value - The received value, untrusted.
 * @returns `value`, narrowed to `number`.
 * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `value` is
 *   not a finite positive integer (`0`, negatives, fractions, `NaN`,
 *   `Infinity`, numeric strings, objects, `null`, `undefined`).
 * @example
 * ```typescript
 * requireEntityId("dashboard_id", dashboardId); // throws on 0, "12", {…}
 * ```
 * @see mixpanel_headless.report_links._require_positive_id
 */
export function requireEntityId(field: string, value: unknown): number {
  // Divergence: Python sends the request and surfaces the server's 404.
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

/**
 * Reject a lookup-table `data_group_id` that is not a non-zero integer —
 * the int64 twin of {@link requireEntityId}.
 *
 * @remarks
 * Mixpanel assigns negative ids such as `-8644926364725811123`, beyond
 * 2^53, so the guard accepts a `number | bigint` integer of either sign
 * and any magnitude but rejects a `number` outside the safe-integer
 * range: such a value has already been rounded by the time it reaches
 * the facade and would address the wrong table. The message tells the
 * caller to pass a `bigint` (or the decimal string through
 * `BigInt(...)`). Same code as {@link requireEntityId}, for the same
 * reason.
 * @param field - The Python parameter name (`data_group_id`).
 * @param value - The received value, untrusted.
 * @returns `value`, narrowed to `number | bigint`.
 * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `value` is
 *   `0`, `0n`, a fraction, `NaN`, `Infinity`, a `number` beyond
 *   `Number.MAX_SAFE_INTEGER`, a string, an object, `null` or
 *   `undefined`.
 * @example
 * ```typescript
 * requireInt64Id("data_group_id", -8644926364725811123n);
 * ```
 */
export function requireInt64Id(field: string, value: unknown): number | bigint {
  if (typeof value === "bigint" && value !== 0n) {
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value !== 0) {
    return value;
  }
  const received = describeReceived(value);
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    !Number.isSafeInteger(value)
  ) {
    // Integral but unsafe: `2 ** 60`, or a JSON.parse'd int64 — already
    // rounded, so the exact id is unrecoverable from here.
    throw new ParamValidationError(
      `Invalid ${field}: received ${received}, which is beyond ` +
        `Number.MAX_SAFE_INTEGER and already rounded; pass the id as a ` +
        `bigint (e.g. -8644926364725811123n or BigInt("<digits>")).`,
      "RL6_INVALID_ID",
      { field, received },
    );
  }
  throw new ParamValidationError(
    `Invalid ${field}: expected a non-zero integer id (number or bigint), ` +
      `received ${received}.`,
    "RL6_INVALID_ID",
    { field, received },
  );
}
