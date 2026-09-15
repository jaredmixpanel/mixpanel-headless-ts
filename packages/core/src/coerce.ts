/**
 * Pydantic-v2-lax coercion module (rulebook R4.12, phase2-design C1).
 *
 * One shared module replicates Pydantic v2's lax coercion at decode/parse
 * boundaries. The NORMATIVE contract is the R4.12 table:
 *
 * - `coerceInt` accepts `42` / `42.0` / `"42"`, rejects `42.5` and booleans;
 * - `coerceInt64` is the same table without the double's 2^53 ceiling:
 *   it also takes a `bigint` or a lossless `JsonNumber` token and yields a
 *   `bigint` only when the exact value is not a safe integer;
 * - `coerceStr` does NOT coerce numbers/booleans to string;
 * - `coerceBool` accepts exactly the `true|t|yes|y|on|1` /
 *   `false|f|no|n|off|0` string sets (case-insensitive) plus `0`/`1`
 *   numerics;
 * - `default_factory` semantics: a default fires only on an ABSENT key —
 *   an explicit `null` flows through to validation (see
 *   {@link resolveWithDefault}).
 *
 * Beyond the table, string parsing follows CPython's `int()`/`float()`
 * acceptance (whitespace trim, sign, digit-group underscores, integral
 * `"42.0"` for int, exponent/`inf`/`nan` for float) — verified against
 * pydantic v2 on 2026-08-15. One documented divergence: pydantic's
 * PYTHON-object lax mode accepts `True → 1` for int/float (bool is an int
 * subclass in Python); its JSON mode and the R4.12 table both REJECT
 * booleans, and JSON is the only cross-language boundary, so booleans are
 * rejected here.
 *
 * Failures throw {@link ParamValidationError} (kind `'param'`) or
 * {@link ResponseValidationError} (kind `'response'`, the default — R4.12
 * is a response-parsing rule) with the generic R5.5 codes; message text is
 * out of contract (R5.4).
 */

import { JsonNumber } from "./client/json-value.js";
import { ParamValidationError, ResponseValidationError } from "./errors.js";

/** Which R5.5 boundary a failed coercion belongs to. */
export type CoerceKind = "param" | "response";

/** Options accepted by every coercion function. */
export interface CoerceOptions {
  /**
   * Error boundary: `'param'` throws {@link ParamValidationError}
   * (`VALIDATION_ERROR`), `'response'` (default) throws
   * {@link ResponseValidationError} (`RESPONSE_VALIDATION_ERROR`).
   */
  readonly kind?: CoerceKind | undefined;
  /** Field name for the error `details` bag (snake_case wire spelling). */
  readonly field?: string | undefined;
}

/**
 * Throw the boundary-appropriate coercion error.
 *
 * @param expected - Human label of the expected type (message only).
 * @param value - The rejected value (repr'd into the message only).
 * @param options - Coercion options (boundary kind + field name).
 * @returns Never returns.
 * @throws ParamValidationError - When `options.kind === 'param'`.
 * @throws ResponseValidationError - Otherwise (default boundary).
 */
function fail(expected: string, value: unknown, options: CoerceOptions): never {
  const details: Record<string, unknown> = { expected };
  if (options.field !== undefined) {
    details["field"] = options.field;
  }
  const message = `Expected ${expected}, got ${describe(value)}`;
  if (options.kind === "param") {
    throw new ParamValidationError(message, "VALIDATION_ERROR", details);
  }
  throw new ResponseValidationError(
    message,
    "RESPONSE_VALIDATION_ERROR",
    details,
  );
}

/**
 * Render a short description of a value for error messages (R5.4:
 * display only, never asserted).
 *
 * @param value - Any value.
 * @returns A short human-readable description.
 */
function describe(value: unknown): string {
  if (value === null) {
    return "null";
  }
  switch (typeof value) {
    case "string": {
      return JSON.stringify(value);
    }
    case "number":
    case "boolean": {
      return String(value);
    }
    case "undefined": {
      return "undefined";
    }
    case "object": {
      return Array.isArray(value) ? "array" : "object";
    }
    case "bigint":
    case "function":
    case "symbol": {
      return typeof value;
    }
    default: {
      // Every `typeof` result is listed; TS cannot subtract them from
      // `unknown`, so it still wants a terminal arm.
      throw new TypeError(`unexpected typeof result: ${typeof value}`);
    }
  }
}

/** CPython int-literal shape: sign + digit groups, optional `.0…` tail. */
const INT_STRING = /^[+-]?\d(?:_?\d)*(?:\.0*)?$/;

/** CPython float-literal shape (digits required somewhere). */
const FLOAT_STRING =
  /^[+-]?(?:\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?$/;

/** CPython special float names, matched case-insensitively after sign. */
const FLOAT_SPECIAL = /^[+-]?(?:inf|infinity|nan)$/i;

/**
 * Coerce a JSON value to an integer with Pydantic-v2-lax semantics.
 *
 * Accepts integral numbers (`42`, `42.0` — indistinguishable in JS),
 * and integer strings (`"42"`, `" 42 "`, `"+42"`, `"1_000"`, `"42.0"`).
 * Rejects fractional numbers, booleans (R4.12), and everything else.
 *
 * @param value - The raw value to coerce.
 * @param options - Boundary kind + field name for errors.
 * @returns The coerced integer.
 * @throws ParamValidationError - Invalid input at the `'param'` boundary.
 * @throws ResponseValidationError - Invalid input at the `'response'`
 *   boundary (default).
 */
export function coerceInt(value: unknown, options: CoerceOptions = {}): number {
  if (typeof value === "boolean") {
    fail("int", value, options);
  }
  if (typeof value === "number") {
    if (Number.isInteger(value)) {
      return value;
    }
    fail("int", value, options);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (INT_STRING.test(trimmed)) {
      const integerPart = trimmed.split(".", 1)[0] ?? trimmed;
      return Number(integerPart.replaceAll("_", ""));
    }
  }
  fail("int", value, options);
}

/**
 * Narrow an exact integer to the `number | bigint` int64 carrier: a
 * `number` when it is a safe integer, the `bigint` otherwise.
 *
 * @param exact - The exact integer.
 * @returns The narrowed carrier.
 */
function narrowInt64(exact: bigint): number | bigint {
  if (
    exact >= BigInt(Number.MIN_SAFE_INTEGER) &&
    exact <= BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    return Number(exact);
  }
  return exact;
}

/**
 * Coerce a JSON value to an integer WITHOUT the double's 2^53 ceiling —
 * the carrier for Python `int` fields whose live values exceed
 * `Number.MAX_SAFE_INTEGER` (lookup-table `data_group_id`s are negative
 * int64s such as `-8644926364725811123`).
 *
 * Same acceptance as {@link coerceInt} (integral numbers, CPython int
 * strings, no booleans) plus two exact carriers: a `bigint`, and a
 * {@link JsonNumber} token as the lossless parser captured it. The
 * result is a `number` whenever the exact value is a safe integer and a
 * `bigint` otherwise, so callers pay the `bigint` only when a `number`
 * would round. An unsafe-magnitude `number` INPUT is returned unchanged
 * — it was already rounded upstream and no exact value exists to
 * recover; feed the token or a `bigint` to keep the digits.
 *
 * @param value - The raw value to coerce.
 * @param options - Boundary kind + field name for errors.
 * @returns The coerced integer (`number` when safe, else `bigint`).
 * @throws ParamValidationError - Invalid input at the `'param'` boundary.
 * @throws ResponseValidationError - Invalid input at the `'response'`
 *   boundary (default).
 */
export function coerceInt64(
  value: unknown,
  options: CoerceOptions = {},
): number | bigint {
  if (typeof value === "bigint") {
    return narrowInt64(value);
  }
  if (value instanceof JsonNumber) {
    if (value.isIntegerToken()) {
      return narrowInt64(BigInt(value.raw));
    }
    return coerceInt(value.toNumber(), options);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (INT_STRING.test(trimmed)) {
      const integerPart = trimmed.split(".", 1)[0] ?? trimmed;
      return narrowInt64(BigInt(integerPart.replaceAll("_", "")));
    }
    fail("int", value, options);
  }
  return coerceInt(value, options);
}

/**
 * Coerce a JSON value to a float with Pydantic-v2-lax semantics.
 *
 * Accepts any finite/parsed number and CPython float strings (`"1.5"`,
 * `"1e3"`, `"inf"`, `"nan"`, `" 2.5 "`, `"1_000.5"`). Rejects booleans
 * (JSON-mode posture — see module docs) and everything else.
 *
 * @param value - The raw value to coerce.
 * @param options - Boundary kind + field name for errors.
 * @returns The coerced number.
 * @throws ParamValidationError - Invalid input at the `'param'` boundary.
 * @throws ResponseValidationError - Invalid input at the `'response'`
 *   boundary (default).
 */
export function coerceFloat(
  value: unknown,
  options: CoerceOptions = {},
): number {
  if (typeof value === "boolean") {
    fail("float", value, options);
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (FLOAT_SPECIAL.test(trimmed)) {
      const negative = trimmed.startsWith("-");
      if (/nan$/i.test(trimmed)) {
        return Number.NaN;
      }
      return negative ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    }
    if (FLOAT_STRING.test(trimmed)) {
      return Number(trimmed.replaceAll("_", ""));
    }
  }
  fail("float", value, options);
}

/**
 * Coerce a JSON value to a string with Pydantic-v2-lax semantics.
 *
 * Pydantic v2 does NOT lax-coerce int/float/bool/None to `str` (R4.12);
 * only actual strings pass.
 *
 * @param value - The raw value to coerce.
 * @param options - Boundary kind + field name for errors.
 * @returns The string unchanged.
 * @throws ParamValidationError - Invalid input at the `'param'` boundary.
 * @throws ResponseValidationError - Invalid input at the `'response'`
 *   boundary (default).
 */
export function coerceStr(value: unknown, options: CoerceOptions = {}): string {
  if (typeof value === "string") {
    return value;
  }
  fail("str", value, options);
}

/** Lowercased string spellings pydantic v2 accepts as `true`. */
const TRUE_STRINGS: ReadonlySet<string> = new Set([
  "true",
  "t",
  "yes",
  "y",
  "on",
  "1",
]);

/** Lowercased string spellings pydantic v2 accepts as `false`. */
const FALSE_STRINGS: ReadonlySet<string> = new Set([
  "false",
  "f",
  "no",
  "n",
  "off",
  "0",
]);

/**
 * Coerce a JSON value to a boolean with Pydantic-v2-lax semantics.
 *
 * Accepts booleans, the numerics `0`/`1` (incl. `0.0`/`1.0`), and exactly
 * the case-insensitive string sets `true|t|yes|y|on|1` and
 * `false|f|no|n|off|0` (R4.12). Everything else is rejected.
 *
 * @param value - The raw value to coerce.
 * @param options - Boundary kind + field name for errors.
 * @returns The coerced boolean.
 * @throws ParamValidationError - Invalid input at the `'param'` boundary.
 * @throws ResponseValidationError - Invalid input at the `'response'`
 *   boundary (default).
 */
export function coerceBool(
  value: unknown,
  options: CoerceOptions = {},
): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
    fail("bool", value, options);
  }
  if (typeof value === "string") {
    const lowered = value.toLowerCase();
    if (TRUE_STRINGS.has(lowered)) {
      return true;
    }
    if (FALSE_STRINGS.has(lowered)) {
      return false;
    }
  }
  fail("bool", value, options);
}

/**
 * Pydantic `default_factory` semantics: the default fires ONLY when the
 * key is ABSENT from the raw object (R4.12). An explicit `null` (or any
 * present value, including an explicit `undefined`, which JSON decoding
 * never produces) is returned as-is for the caller's coercer/validator to
 * accept or reject — Pydantic treats explicit `None` on a non-optional
 * field as a validation error, never as "use the default".
 *
 * Example:
 * ```ts
 * resolveWithDefault({}, "tags", () => []);            // [] (factory fired)
 * resolveWithDefault({ tags: null }, "tags", () => []); // null (no default)
 * ```
 *
 * @param raw - The raw decoded object.
 * @param key - The field key to look up.
 * @param defaultFactory - Factory producing the default value.
 * @returns The present value (verbatim) or the factory product when the
 *   key is absent.
 */
export function resolveWithDefault<T>(
  raw: Readonly<Record<string, unknown>>,
  key: string,
  defaultFactory: () => T,
): unknown | T {
  if (!Object.hasOwn(raw, key)) {
    return defaultFactory();
  }
  return raw[key];
}
