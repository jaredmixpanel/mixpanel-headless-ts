/**
 * Shared helpers for the B4-C3..C5 entity-CRUD wire factories — the
 * response-shape guards every `MixpanelAPIClient` CRUD method applies
 * (`if not isinstance(result, dict/list): raise MixpanelHeadlessError`)
 * plus the Python-truthiness and `",".join(str(i) ...)` twins.
 *
 * R10.8: nothing here re-implements a B0 internal — `isPlainRecord` is
 * the B0 "JSON object body" predicate (the right twin for
 * `isinstance(parsed_wire_value, dict)` — watchlist #13 note: the wire
 * domain carries no PyFloat carriers or class instances, so the
 * client-internal predicate applies, not `isPythonDict`).
 */

import { pythonStr, type PythonValue } from "../../compat/python-str.js";
import { MixpanelHeadlessError } from "../../errors.js";
import { isPlainRecord } from "../../client/internals.js";
import { JsonNumber, type JsonValue } from "../../client/json-value.js";

/**
 * Python `type(x).__name__` over a parsed wire value (message text
 * only — out of contract per R5.4; B4-C2 `engage.ts` twin).
 *
 * @param value - The parsed value.
 * @returns The CPython type name of the `json.loads` product.
 */
export function pythonTypeNameOf(value: JsonValue): string {
  if (value === null) {
    return "NoneType";
  }
  if (typeof value === "boolean") {
    return "bool";
  }
  if (typeof value === "string") {
    return "str";
  }
  if (typeof value === "bigint") {
    return "int";
  }
  if (value instanceof JsonNumber) {
    return value.isIntegerToken() ? "int" : "float";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? "int" : "float";
  }
  if (Array.isArray(value)) {
    return "list";
  }
  return "dict";
}

/**
 * Enforce the `isinstance(result, dict)` guard shared by every
 * dict-returning CRUD method (e.g. `api_client.py:3717-3722`).
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
 * list-returning CRUD method (e.g. `api_client.py:3682-3687`).
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
 * Python truthiness for optional strings (`if bookmark_type:`).
 *
 * @param value - The optional string.
 * @returns Whether Python would take the branch.
 */
export function truthyStr(value: string | null | undefined): value is string {
  return value !== undefined && value !== null && value !== "";
}

/**
 * Python truthiness for optional lists (`if ids:`).
 *
 * @param value - The optional list.
 * @returns Whether Python would take the branch.
 */
export function truthyList(
  value: readonly unknown[] | null | undefined,
): boolean {
  return value !== undefined && value !== null && value.length > 0;
}

/**
 * The `",".join(str(i) for i in ids)` twin (R11.7: `pythonStr`, never
 * `String(...)` — `str(True)` is `"True"`, `str(1.5)` is `"1.5"`).
 *
 * @param ids - The id list.
 * @returns The comma-joined spelling.
 */
export function joinIds(ids: readonly (number | bigint)[]): string {
  return ids.map((id) => pythonStr(id as PythonValue)).join(",");
}

/**
 * Pass a params dict only when non-empty (`params=params if params
 * else None` — every C3 list method).
 *
 * @param params - The accumulated params.
 * @returns The params, or `undefined` for the Python `None`.
 */
export function paramsOrNone(
  params: Record<string, string>,
): Record<string, string> | undefined {
  return Object.keys(params).length > 0 ? params : undefined;
}
