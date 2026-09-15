/**
 * Strict field decoders and row helpers shared by the result classes.
 *
 * Python's result types are frozen dataclasses whose `.df` property
 * builds a `rows: list[dict[str, Any]]` before it enters pandas; the TS
 * contract is that pre-pandas rows list (`toRows()`) plus the
 * empty-frame column constant (`rowColumns()`). pandas itself (NaN
 * fill, dtype coercion, index objects) is outside the TS contract.
 *
 * Dataclasses do not coerce, so `fromDict` is strict: a wrong JSON type
 * raises `ResponseValidationError`. Two duck-typed tolerances exist
 * because the conformance corpus wraps some scalars — `$type: datetime`
 * payloads decode to an iso-carrying object and `$type: float` payloads
 * to a spelling-carrying object (the runner's `PyDatetime` / `PyFloat`),
 * which this module cannot import (the runner depends on core, never the
 * reverse). Only the `Row` alias is part of the public package
 * surface; the decoders and row helpers are not.
 */

import { ResponseValidationError } from "../../errors.js";
import { describeValue } from "../entities/decode-utils.js";

/**
 * One result row as `toRows()` returns it: a plain object keyed by
 * column name, exactly the row Python builds before `pd.DataFrame(rows)`.
 */
export type Row = Record<string, unknown>;

/**
 * Raise the strict-decode error for one field.
 *
 * @param cls - Result class name (used in the message only).
 * @param field - Offending field path.
 * @param expected - Human description of the expected JSON type.
 * @param value - The offending value.
 * @throws {@link ResponseValidationError} - Always.
 * @example
 * ```ts
 * decodeFail("QueryResult", "series", "object", 42);
 * // ResponseValidationError: QueryResult.series: expected object, got number
 * ```
 * @internal
 */
export function decodeFail(
  cls: string,
  field: string,
  expected: string,
  value: unknown,
): never {
  throw new ResponseValidationError(
    `${cls}.${field}: expected ${expected}, got ${describeValue(value)}`,
  );
}

/**
 * Reject payload keys outside the declared dataclass field set.
 *
 * @remarks
 * This is the strict half of `fromDict`: the recorder walks every
 * dataclass field, so an unknown key always means payload/class drift.
 * @param raw - The payload under decode.
 * @param allowed - Declared field names.
 * @param cls - Result class name for error messages.
 * @throws {@link ResponseValidationError} - When unknown keys are present.
 * @example
 * ```ts
 * rejectUnknownKeys({ event: "Signup", extra: 1 }, new Set(["event"]), "TopEvent");
 * // ResponseValidationError: TopEvent: unknown fields ["extra"] in payload
 * ```
 * @internal
 */
export function rejectUnknownKeys(
  raw: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  cls: string,
): void {
  const extra = Object.keys(raw)
    .filter((key) => !allowed.has(key))
    .sort();
  if (extra.length > 0) {
    throw new ResponseValidationError(
      `${cls}: unknown fields ${JSON.stringify(extra)} in payload`,
    );
  }
}

/**
 * Assert the payload is a plain JSON object and hand it back typed.
 *
 * @param raw - The candidate payload.
 * @param cls - Result class name for error messages.
 * @returns The payload as a string-keyed record.
 * @throws {@link ResponseValidationError} - When `raw` is not a plain object.
 * @example
 * ```ts
 * const payload = expectPayload(raw, "TopEvent");
 * const event = expectStr(payload, "event", "TopEvent");
 * ```
 * @internal
 */
export function expectPayload(
  raw: unknown,
  cls: string,
): Readonly<Record<string, unknown>> {
  if (!isPlainRecord(raw)) {
    decodeFail(cls, "<payload>", "object", raw);
  }
  return raw;
}

/**
 * Return whether a value is a plain (non-array, non-class) object.
 *
 * @param value - Any value.
 * @returns `true` for plain records.
 * @example
 * ```ts
 * isPlainRecord({ a: 1 }); // true
 * isPlainRecord([1]); // false
 * ```
 * @internal
 */
export function isPlainRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * Strictly decode a required string field.
 *
 * @param raw - The payload.
 * @param field - Field name.
 * @param cls - Result class name.
 * @returns The string value.
 * @throws {@link ResponseValidationError} - On a wrong JSON type.
 * @example
 * ```ts
 * expectStr({ event: "Signup" }, "event", "TopEvent"); // "Signup"
 * ```
 * @internal
 */
export function expectStr(
  raw: Readonly<Record<string, unknown>>,
  field: string,
  cls: string,
): string {
  const value = raw[field];
  if (typeof value !== "string") {
    decodeFail(cls, field, "string", value);
  }
  return value;
}

/**
 * Strictly decode an integer field (Python `int`).
 *
 * @param raw - The payload.
 * @param field - Field name.
 * @param cls - Result class name.
 * @returns The integer value.
 * @throws {@link ResponseValidationError} - On a wrong JSON type or a
 *   non-integral number.
 * @example
 * ```ts
 * expectInt({ count: 42 }, "count", "TopEvent"); // 42
 * ```
 * @internal
 */
export function expectInt(
  raw: Readonly<Record<string, unknown>>,
  field: string,
  cls: string,
): number {
  const value = raw[field];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    decodeFail(cls, field, "integer", value);
  }
  return value;
}

/**
 * Strictly decode a float field (Python `float`).
 *
 * @remarks
 * Accepts a native number or a `$type: float`-decoded wrapper (an
 * object with a string `spelling`, duck-typed — the runner's
 * `PyFloat`); Python floats with integral values ride the corpus as
 * tagged spellings.
 * @param raw - The payload.
 * @param field - Field name.
 * @param cls - Result class name.
 * @returns The numeric value.
 * @throws {@link ResponseValidationError} - On a wrong JSON type.
 * @example
 * ```ts
 * expectFloat({ rate: 0.25 }, "rate", "FunnelResultStep"); // 0.25
 * expectFloat({ rate: { spelling: "1.0" } }, "rate", "FunnelResultStep"); // 1
 * ```
 * @internal
 */
export function expectFloat(
  raw: Readonly<Record<string, unknown>>,
  field: string,
  cls: string,
): number {
  const value = floatValue(raw[field]);
  if (value === undefined) {
    decodeFail(cls, field, "number", raw[field]);
  }
  return value;
}

/**
 * Unwrap a possibly float-tagged numeric value.
 *
 * @param value - A native number or a spelling-carrying wrapper.
 * @returns The numeric value, or `undefined` when neither shape fits.
 * @example
 * ```ts
 * floatValue({ spelling: "2.5" }); // 2.5
 * floatValue("2.5"); // undefined
 * ```
 * @internal
 */
export function floatValue(value: unknown): number | undefined {
  if (typeof value === "number") {
    return value;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "spelling" in value &&
    typeof value.spelling === "string"
  ) {
    return Number((value as { spelling: string }).spelling);
  }
  return undefined;
}

/**
 * Strictly decode a boolean field.
 *
 * @param raw - The payload.
 * @param field - Field name.
 * @param cls - Result class name.
 * @returns The boolean value.
 * @throws {@link ResponseValidationError} - On a wrong JSON type.
 * @example
 * ```ts
 * expectBool({ is_computed: true }, "is_computed", "FlowTreeNode"); // true
 * ```
 * @internal
 */
export function expectBool(
  raw: Readonly<Record<string, unknown>>,
  field: string,
  cls: string,
): boolean {
  const value = raw[field];
  if (typeof value !== "boolean") {
    decodeFail(cls, field, "boolean", value);
  }
  return value;
}

/**
 * Strictly decode a plain-object field (Python `dict[str, Any]`).
 *
 * @param raw - The payload.
 * @param field - Field name.
 * @param cls - Result class name.
 * @returns The record value.
 * @throws {@link ResponseValidationError} - On a wrong JSON type.
 * @example
 * ```ts
 * expectRecord({ meta: { is_cached: true } }, "meta", "QueryResult");
 * // { is_cached: true }
 * ```
 * @internal
 */
export function expectRecord(
  raw: Readonly<Record<string, unknown>>,
  field: string,
  cls: string,
): Readonly<Record<string, unknown>> {
  const value = raw[field];
  if (!isPlainRecord(value)) {
    decodeFail(cls, field, "object", value);
  }
  return value;
}

/**
 * Strictly decode an array field.
 *
 * @param raw - The payload.
 * @param field - Field name.
 * @param cls - Result class name.
 * @returns The array value.
 * @throws {@link ResponseValidationError} - On a wrong JSON type.
 * @example
 * ```ts
 * expectArray({ steps: [] }, "steps", "FunnelResult"); // []
 * ```
 * @internal
 */
export function expectArray(
  raw: Readonly<Record<string, unknown>>,
  field: string,
  cls: string,
): readonly unknown[] {
  const value = raw[field];
  if (!Array.isArray(value)) {
    decodeFail(cls, field, "array", value);
  }
  return value;
}

/**
 * Strictly decode a `list[str]` field.
 *
 * @param raw - The payload.
 * @param field - Field name.
 * @param cls - Result class name.
 * @returns The string array.
 * @throws {@link ResponseValidationError} - On a wrong JSON type or a
 *   non-string element.
 * @example
 * ```ts
 * expectStrArray({ tags: ["a", "b"] }, "tags", "BookmarkInfo"); // ["a", "b"]
 * ```
 * @internal
 */
export function expectStrArray(
  raw: Readonly<Record<string, unknown>>,
  field: string,
  cls: string,
): readonly string[] {
  const value = expectArray(raw, field, cls);
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string") {
      decodeFail(cls, `${field}[${String(index)}]`, "string", item);
    }
  }
  return value as readonly string[];
}

/**
 * Strictly decode a `list[dict[str, Any]]` field.
 *
 * @param raw - The payload.
 * @param field - Field name.
 * @param cls - Result class name.
 * @returns The record array.
 * @throws {@link ResponseValidationError} - On a wrong JSON type or a
 *   non-object element.
 * @example
 * ```ts
 * expectRecordArray({ steps: [{ event: "Signup" }] }, "steps", "FunnelResult");
 * // [{ event: "Signup" }]
 * ```
 * @internal
 */
export function expectRecordArray(
  raw: Readonly<Record<string, unknown>>,
  field: string,
  cls: string,
): ReadonlyArray<Readonly<Record<string, unknown>>> {
  const value = expectArray(raw, field, cls);
  for (const [index, item] of value.entries()) {
    if (!isPlainRecord(item)) {
      decodeFail(cls, `${field}[${String(index)}]`, "object", item);
    }
  }
  return value as ReadonlyArray<Readonly<Record<string, unknown>>>;
}

/**
 * Require a field to be present in the payload.
 *
 * @param raw - The payload.
 * @param field - Field name.
 * @param cls - Result class name.
 * @throws {@link ResponseValidationError} - When the key is absent.
 * @example
 * ```ts
 * requirePresent(payload, "series", "QueryResult");
 * ```
 * @internal
 */
export function requirePresent(
  raw: Readonly<Record<string, unknown>>,
  field: string,
  cls: string,
): void {
  if (!Object.hasOwn(raw, field)) {
    throw new ResponseValidationError(
      `${cls}: missing required field ${JSON.stringify(field)} in payload`,
    );
  }
}

/**
 * Validate a codec-visible `_*_cache` slot.
 *
 * @remarks
 * Recorded vectors always carry these DataFrame caches as `null`
 * (pandas frames are not encodable), so decode accepts only `null` or
 * an absent key.
 * @param raw - The payload.
 * @param field - Cache field name.
 * @param cls - Result class name.
 * @throws {@link ResponseValidationError} - On any present non-null value.
 * @example
 * ```ts
 * expectNullCache(payload, "_df_cache", "QueryResult");
 * ```
 * @internal
 */
export function expectNullCache(
  raw: Readonly<Record<string, unknown>>,
  field: string,
  cls: string,
): void {
  if (Object.hasOwn(raw, field) && raw[field] !== null) {
    decodeFail(cls, field, "null (DataFrame caches never encode)", raw[field]);
  }
}

/**
 * Extract the ISO text from a `$type: datetime`-decoded child.
 *
 * @remarks
 * The runner decodes datetime payloads to an iso-carrying wrapper (its
 * `PyDatetime`); a raw string passes through for already-decoded
 * callers.
 * @param value - The decoded child value.
 * @param field - Field path for error messages.
 * @param cls - Result class name.
 * @returns The ISO-8601 text.
 * @throws {@link ResponseValidationError} - When the value is neither shape.
 * @example
 * ```ts
 * expectIsoText({ iso: "2026-01-15T12:00:00" }, "time", "UserEvent");
 * // "2026-01-15T12:00:00"
 * ```
 * @internal
 */
export function expectIsoText(
  value: unknown,
  field: string,
  cls: string,
): string {
  if (typeof value === "string") {
    return value;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "iso" in value &&
    typeof value.iso === "string"
  ) {
    return (value as { iso: string }).iso;
  }
  decodeFail(cls, field, "datetime (iso text)", value);
}

/**
 * Return Python's `bool(x)` for a JSON-shaped value: `null`/`undefined`,
 * `false`, numeric zero, empty strings and empty containers are falsy.
 *
 * @remarks
 * Used where a Python `.df` / `__post_init__` body branches on bare
 * truthiness of payload data (e.g. `if not prop.get("name")`).
 * @param value - A JSON-shaped value.
 * @returns Python's `bool(value)`.
 * @example
 * ```ts
 * pyTruthy([]); // false
 * pyTruthy({ a: 1 }); // true
 * ```
 * @internal
 */
export function pyTruthy(value: unknown): boolean {
  if (value === null || value === undefined || value === false) {
    return false;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    return value.length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (isPlainRecord(value)) {
    return Object.keys(value).length > 0;
  }
  return true;
}

/**
 * Return the column list pandas would infer for `pd.DataFrame(rows)`
 * without an explicit `columns=` argument: every key in first-occurrence
 * order across the rows.
 *
 * @param rows - The pre-pandas rows list.
 * @returns Inferred column names.
 * @example
 * ```ts
 * firstOccurrenceColumns([{ a: 1 }, { b: 2, a: 3 }]); // ["a", "b"]
 * ```
 * @internal
 */
export function firstOccurrenceColumns(
  rows: ReadonlyArray<Readonly<Row>>,
): readonly string[] {
  const seen = new Set<string>();
  const columns: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      columns.push(key);
    }
  }
  return columns;
}
