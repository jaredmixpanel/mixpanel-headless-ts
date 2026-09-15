/**
 * Helpers shared by the entity wire factories: the response-shape guards
 * every `MixpanelAPIClient` CRUD method applies
 * (`if not isinstance(result, dict/list): raise MixpanelHeadlessError`),
 * Python-truthiness twins for optional params and bodies, `",".join(...)`
 * id spelling, and `urllib.parse.quote` path-segment encoding.
 * `isPlainRecord` is the right dict test here — parsed wire values carry
 * no class instances or float carriers — so `isPythonDict` is not used.
 *
 * @see mixpanel_headless._internal.api_client.MixpanelAPIClient
 */

import { isPlainRecord } from "../../client/internals.js";
import { JsonNumber, type JsonValue } from "../../client/json-value.js";
import { pythonStr, type PythonValue } from "../../compat/python-str.js";
import { MixpanelHeadlessError } from "../../errors.js";
import { pythonTypeNameOf } from "../shared.js";

/**
 * Enforce the `isinstance(result, dict)` guard shared by every
 * dict-returning CRUD method.
 *
 * @param result - The `app_request` product.
 * @param methodName - The Python method name for the message.
 * @returns The narrowed record.
 * @throws {@link MixpanelHeadlessError} - Non-dict result (`UNKNOWN_ERROR` code,
 *   the bare-constructor Python twin).
 * @example
 * ```typescript
 * expectRecordResult({ id: 1 }, "get_alert"); // { id: 1 }
 * expectRecordResult([1], "get_alert"); // throws MixpanelHeadlessError
 * ```
 */
export function expectRecordResult(
  result: JsonValue,
  methodName: string,
): Record<string, JsonValue> {
  if (!isPlainRecord(result)) {
    throw new MixpanelHeadlessError(
      `Unexpected response from ${methodName}: ` +
        `expected dict, got ${pythonTypeNameOf(result)}`,
    );
  }
  return result;
}

/**
 * Enforce the `isinstance(result, list)` guard shared by every
 * list-returning CRUD method.
 *
 * @param result - The `app_request` product.
 * @param methodName - The Python method name for the message.
 * @returns The narrowed array.
 * @throws {@link MixpanelHeadlessError} - Non-list result.
 * @example
 * ```typescript
 * expectListResult([{ id: 1 }], "list_alerts"); // [{ id: 1 }]
 * expectListResult({}, "list_alerts"); // throws MixpanelHeadlessError
 * ```
 */
export function expectListResult(
  result: JsonValue,
  methodName: string,
): JsonValue[] {
  if (!Array.isArray(result)) {
    throw new MixpanelHeadlessError(
      `Unexpected response from ${methodName}: ` +
        `expected list, got ${pythonTypeNameOf(result)}`,
    );
  }
  return result;
}

/**
 * Apply Python truthiness to an optional dict (`if body:` in
 * `duplicate_experiment`): `None` and `{}` are both falsy.
 *
 * @param value - The optional dict.
 * @returns Whether Python would take the branch.
 * @example
 * ```typescript
 * truthyRecord({ a: 1 }); // true
 * truthyRecord({}); // false, like Python `if body:`
 * ```
 */
export function truthyRecord(
  value: Record<string, unknown> | null | undefined,
): value is Record<string, unknown> {
  return value !== undefined && value !== null && Object.keys(value).length > 0;
}

/**
 * Join ids with commas the way `",".join(str(i) for i in ids)` does. Spelled
 * with `pythonStr`, never `String(...)`: `str(True)` is `"True"` and
 * `str(1.5)` is `"1.5"`.
 *
 * @param ids - The id list.
 * @returns The comma-joined spelling.
 * @example
 * ```typescript
 * joinIds([1, 2, 3]); // "1,2,3"
 * ```
 */
export function joinIds(ids: ReadonlyArray<number | bigint>): string {
  return ids.map((id) => pythonStr(id as PythonValue)).join(",");
}

/**
 * Pass a params dict only when non-empty, as every list method does
 * (`params=params if params else None`).
 *
 * @param params - The accumulated params.
 * @returns The params, or `undefined` for the Python `None`.
 * @example
 * ```typescript
 * paramsOrNone({ ids: "1,2" }); // { ids: "1,2" }
 * paramsOrNone({}); // undefined
 * ```
 */
export function paramsOrNone(
  params: Record<string, string>,
): Record<string, string> | undefined {
  return Object.keys(params).length > 0 ? params : undefined;
}

/** Characters `urllib.parse.quote` never escapes (CPython's `_ALWAYS_SAFE`). */
const QUOTE_SAFE = new Set(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.-~",
);

/**
 * Percent-encode a path segment exactly like Python's
 * `urllib.parse.quote(s, safe="")`: letters, digits and `_.-~` pass; everything
 * else — including `/` (the default safe character, suppressed here) and
 * space (`%20`, unlike `quote_plus`'s `+`) — becomes uppercase-hex `%XX`
 * over the UTF-8 bytes. Used for the schema and Lexicon path segments.
 *
 * `encodeURIComponent` is not equivalent: it passes `!'()*`, which
 * Python escapes. The same reasoning gives `client/transport.ts` its own
 * `quotePlus`.
 *
 * @param text - The path segment to encode.
 * @returns The encoded segment.
 * @example
 * ```typescript
 * pythonQuote("Sign Up/EU"); // "Sign%20Up%2FEU"
 * encodeURIComponent("a!b"); // "a!b" — pythonQuote gives "a%21b"
 * ```
 */
export function pythonQuote(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let out = "";
  for (const byte of bytes) {
    const char = String.fromCharCode(byte);
    if (QUOTE_SAFE.has(char)) {
      out += char;
    } else {
      out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
}

/**
 * Apply Python truthiness to a parsed wire value (`if url:` on a `dict.get`
 * product in `get_lookup_download_url`): `None`/`False`/`0`/`0.0`/`""`/
 * `[]`/`{}` are falsy; every other JSON product is truthy.
 *
 * @param value - The parsed value (or `undefined` for an absent key,
 *   the Python `dict.get` default-`None` arm).
 * @returns Whether Python would take the branch.
 * @example
 * ```typescript
 * jsonTruthy(""); // false
 * jsonTruthy([0]); // true
 * ```
 */
export function jsonTruthy(value: JsonValue | undefined): boolean {
  if (value === undefined || value === null || value === false) {
    return false;
  }
  if (value === true) {
    return true;
  }
  if (typeof value === "string") {
    return value !== "";
  }
  if (typeof value === "bigint") {
    return value !== 0n;
  }
  if (value instanceof JsonNumber) {
    return value.toNumber() !== 0;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return Object.keys(value).length > 0;
}

/**
 * Compare a parsed wire value to an integer the way CPython `==` does, for
 * the `update_custom_event` echo check: numeric cross-type equality
 * (`42 == 42.0` is True, `True == 1` is True), never string/int coercion
 * (`"42" != 42`).
 *
 * @param value - The parsed wire member (`result.get("customEventId")`).
 * @param expected - The caller's integer id.
 * @returns Whether Python `value == expected` holds.
 * @example
 * ```typescript
 * pyIntEquals(42, 42); // true
 * pyIntEquals(true, 1); // true, like Python `True == 1`
 * pyIntEquals("42", 42); // false
 * ```
 */
export function pyIntEquals(
  value: JsonValue | undefined,
  expected: number,
): boolean {
  if (typeof value === "boolean") {
    return (value ? 1 : 0) === expected;
  }
  if (typeof value === "bigint") {
    return value === BigInt(expected);
  }
  if (value instanceof JsonNumber) {
    return value.toNumber() === expected;
  }
  if (typeof value === "number") {
    return value === expected;
  }
  return false;
}
