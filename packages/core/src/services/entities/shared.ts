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
 * @throws MixpanelHeadlessError - Non-dict result (`UNKNOWN_ERROR`
 *   code, the bare-constructor Python twin).
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
 * @throws MixpanelHeadlessError - Non-list result.
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
 * Python truthiness for optional dicts (`if body:` in
 * `duplicate_experiment`): `None` and `{}` are both falsy.
 *
 * @param value - The optional dict.
 * @returns Whether Python would take the branch.
 */
export function truthyRecord(
  value: Record<string, unknown> | null | undefined,
): value is Record<string, unknown> {
  return value !== undefined && value !== null && Object.keys(value).length > 0;
}

/**
 * The `",".join(str(i) for i in ids)` twin. Spelled with `pythonStr`,
 * never `String(...)`: `str(True)` is `"True"` and `str(1.5)` is `"1.5"`.
 *
 * @param ids - The id list.
 * @returns The comma-joined spelling.
 */
export function joinIds(ids: ReadonlyArray<number | bigint>): string {
  return ids.map((id) => pythonStr(id as PythonValue)).join(",");
}

/**
 * Pass a params dict only when non-empty (`params=params if params
 * else None`, as every list method does).
 *
 * @param params - The accumulated params.
 * @returns The params, or `undefined` for the Python `None`.
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
 * Percent-encode a path segment exactly like `urllib.parse.quote(s,
 * safe="")`: ASCII letters, digits and `_.-~` pass through; everything
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
 * Python truthiness over a parsed wire value (`if url:` on a `dict.get`
 * product in `get_lookup_download_url`): `None`/`False`/`0`/`0.0`/`""`/
 * `[]`/`{}` are falsy; every other JSON product is truthy.
 *
 * @param value - The parsed value (or `undefined` for an absent key,
 *   the Python `dict.get` default-`None` arm).
 * @returns Whether Python would take the branch.
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
 * The CPython `int == <parsed wire value>` twin for the
 * `update_custom_event` echo check:
 * numeric cross-type equality (`42 == 42.0` is True, `True == 1` is
 * True), never string/int coercion (`"42" != 42`).
 *
 * @param value - The parsed wire member (`result.get("customEventId")`).
 * @param expected - The caller's integer id.
 * @returns Whether Python `value == expected` holds.
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
