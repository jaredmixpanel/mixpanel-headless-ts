/**
 * Shared plumbing for the result dataclass ports (phase2-design C6,
 * packet P2-6).
 *
 * Python's result types are frozen dataclasses whose `.df` property
 * builds a `rows: list[dict[str, Any]]` before it enters pandas; the TS
 * contract is that pre-pandas rows list (`toRows()`) plus the
 * empty-frame column constant (`rowColumns()`). pandas itself (NaN
 * fill, dtype coercion, index objects) is explicitly OUT of the TS
 * contract — see phase2-design C6 and Risk #6.
 *
 * The strict `fromDict` decoders here mirror the design rule
 * "dataclasses don't coerce — so `fromDict` for dataclass results is
 * strict: wrong JSON type → ResponseValidationError" (C6). Two
 * duck-typed tolerances exist because the conformance corpus wraps
 * some scalars: `$type: datetime` payloads decode to an iso-carrying
 * object and `$type: float` payloads to a spelling-carrying object
 * (the runner's `PyDatetime`/`PyFloat`), which this module cannot
 * import (dependency direction: runner -> core, never the reverse).
 *
 * @internal Everything in this module is `@internal` plumbing for the
 * result classes, the C8(b) golden tests, and the conformance codecs —
 * none of it is part of the public package surface.
 */

import { ResponseValidationError } from "../../errors.js";

/**
 * One pre-pandas row exactly as Python builds it before
 * `pd.DataFrame(rows)`.
 *
 * @internal
 */
export type Row = Record<string, unknown>;

/**
 * Raise the strict-decode error for one field.
 *
 * @param cls - Result class name (for the message only, R5.4).
 * @param field - Offending field path.
 * @param expected - Human description of the expected JSON type.
 * @param value - The offending value.
 * @returns Never returns.
 * @throws ResponseValidationError - Always.
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

// TODO(Ω): `describeValue` duplicates `types/entities/model-base.ts`; fold
// both into Lane D's `types/entities/decode-utils.ts` once it lands.
/**
 * Describe a value's JSON kind for strict-decode error messages.
 *
 * @param value - Any value.
 * @returns A short human-readable kind label.
 * @internal
 */
function describeValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

/**
 * Reject payload keys outside the declared dataclass field set (the
 * strict half of `fromDict` — mirrors the recorder's exhaustive field
 * walk, so an unknown key always means payload/class drift).
 *
 * @param raw - The payload under decode.
 * @param allowed - Declared field names.
 * @param cls - Result class name for error messages.
 * @throws ResponseValidationError - When unknown keys are present.
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
 * @throws ResponseValidationError - When `raw` is not a plain object.
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
 * Whether a value is a plain (non-array, non-class) object.
 *
 * @param value - Any value.
 * @returns True for plain records.
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
 * @throws ResponseValidationError - On wrong JSON type.
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
 * @throws ResponseValidationError - On wrong JSON type or a
 *   non-integral number.
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
 * Accepts a native number or a `$type: float`-decoded wrapper (an
 * object with a string `spelling`, duck-typed — the runner's
 * `PyFloat`); Python floats with integral values ride the corpus as
 * tagged spellings.
 *
 * @param raw - The payload.
 * @param field - Field name.
 * @param cls - Result class name.
 * @returns The numeric value.
 * @throws ResponseValidationError - On wrong JSON type.
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
 * @throws ResponseValidationError - On wrong JSON type.
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
 * @throws ResponseValidationError - On wrong JSON type.
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
 * @throws ResponseValidationError - On wrong JSON type.
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
 * @throws ResponseValidationError - On wrong JSON type or a non-string
 *   element.
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
 * @throws ResponseValidationError - On wrong JSON type or a non-object
 *   element.
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
 * @throws ResponseValidationError - When the key is absent.
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
 * Validate a codec-visible `_*_cache` slot: recorded vectors always
 * carry these DataFrame caches as `null` (pandas frames are not
 * encodable), so decode accepts only `null` or an absent key.
 *
 * @param raw - The payload.
 * @param field - Cache field name.
 * @param cls - Result class name.
 * @throws ResponseValidationError - On any non-null present value.
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
 * The runner decodes datetime payloads to an iso-carrying wrapper (its
 * `PyDatetime`); a raw string passes through for already-decoded
 * callers.
 *
 * @param value - The decoded child value.
 * @param field - Field path for error messages.
 * @param cls - Result class name.
 * @returns The ISO-8601 text.
 * @throws ResponseValidationError - When the value is neither shape.
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
 * Python truthiness for JSON-shaped values (`bool(x)`): `None`/`False`,
 * numeric zero, empty strings, and empty containers are falsy.
 *
 * Used where a Python `.df`/`__post_init__` body branches on bare
 * truthiness of payload data (e.g. `if not prop.get("name")`).
 *
 * @param value - A JSON-shaped value.
 * @returns Python's `bool(value)`.
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
 * Column list pandas would infer for `pd.DataFrame(rows)` without an
 * explicit `columns=` argument: every key in first-occurrence order
 * across the rows.
 *
 * @param rows - The pre-pandas rows list.
 * @returns Inferred column names.
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
