/**
 * Value guards shared across the conformance rig and the differential
 * oracle: plain-object detection, the `expect.error` duck type, the
 * JSON-object/string field readers, and the guard combinators the binding
 * modules decode kwargs with.
 *
 * Every reader takes a `fail` factory rather than throwing a fixed
 * class: the loader raises `CorpusIntegrityError`, the interaction
 * parser `MalformedInteractionError` — same check, different boundary.
 */

import { JsonNumber, type JsonValue } from "../json-value.js";

/** Builds the boundary-specific error a failed reader throws. */
export type FailFactory = (message: string) => Error;

/** A runtime type guard. */
export type Guard<T> = (value: unknown) => value is T;

/**
 * Whether a value is a plain object (JSON object shape).
 *
 * Class instances (`Date`, `Map`, `JsonNumber`, reconstructed core
 * models, ...) are not plain objects: their data does not live in
 * enumerable own properties, so treating them as JSON objects would
 * silently drop it.
 *
 * @param value - The candidate value.
 * @returns `true` for non-null, non-array objects whose prototype is
 *   `Object.prototype` or `null`.
 */
export function isPlainObject(
  value: JsonValue | undefined,
): value is Record<string, JsonValue>;
export function isPlainObject(value: unknown): value is Record<string, unknown>;
export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Thrown values that carry their own vector `expect.error` encoding. */
export interface ExpectErrorConvertible {
  /**
   * Encode this error as a vector `expect.error` value.
   *
   * @returns An object with `class` (Python exception class name) and
   *   optionally `code`, `errors[]`, `details_contain`.
   */
  toExpectError: () => JsonValue;
}

/**
 * Whether a thrown value implements {@link ExpectErrorConvertible}.
 *
 * @param value - The thrown value.
 * @returns `true` when `toExpectError` is callable.
 */
export function isExpectErrorConvertible(
  value: unknown,
): value is ExpectErrorConvertible {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { toExpectError?: unknown }).toExpectError === "function"
  );
}

/**
 * Narrow a loaded JSON value to a plain JSON object.
 *
 * @param value - The candidate value.
 * @param context - Location for the error message.
 * @param fail - Error factory of the calling boundary.
 * @returns The object.
 * @throws Error - `fail(...)` when the value is not a plain object.
 * @example
 * ```ts
 * const fail = (message: string) => new CorpusIntegrityError(message);
 * asJsonObject(record["call"], "vector call", fail); // the object
 * asJsonObject("nope", "vector call", fail);
 * // throws CorpusIntegrityError: vector call: expected a JSON object
 * ```
 */
export function asJsonObject(
  value: JsonValue | undefined,
  context: string,
  fail: FailFactory,
): Record<string, JsonValue> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    value instanceof JsonNumber
  ) {
    throw fail(`${context}: expected a JSON object`);
  }
  return value;
}

/**
 * Read a required non-empty string field.
 *
 * @param record - The containing object.
 * @param key - The field name.
 * @param context - Location for the error message.
 * @param fail - Error factory of the calling boundary.
 * @returns The string value.
 * @throws Error - `fail(...)` when absent, empty or not a string.
 * @example
 * ```ts
 * requireString({ api: "workspace.me" }, "api", "call", fail); // "workspace.me"
 * requireString({ api: "" }, "api", "call", fail);
 * // throws fail("call: missing string field \"api\"")
 * ```
 */
export function requireString(
  record: Readonly<Record<string, JsonValue>>,
  key: string,
  context: string,
  fail: FailFactory,
): string {
  const value = record[key];
  if (typeof value !== "string" || value === "") {
    throw fail(`${context}: missing string field ${JSON.stringify(key)}`);
  }
  return value;
}

/**
 * Read an optional string field.
 *
 * @param record - The containing object.
 * @param key - The field name.
 * @param context - Location for the error message.
 * @param fail - Error factory of the calling boundary.
 * @param options - Acceptance options; `nonEmpty` additionally rejects
 *   `""` (the corpus manifest fields), while interaction fields accept any
 *   string.
 * @returns The string, or `undefined` when the field is absent.
 * @throws Error - `fail(...)` when present but not an acceptable string.
 * @example
 * ```ts
 * optionalString({}, "body_text", "response", fail); // undefined
 * optionalString({ body_text: "" }, "body_text", "response", fail); // ""
 * optionalString({ body_text: "" }, "body_text", "response", fail, {
 *   nonEmpty: true,
 * }); // throws fail("response: field \"body_text\" must be a non-empty string")
 * ```
 */
export function optionalString(
  record: Readonly<Record<string, JsonValue>>,
  key: string,
  context: string,
  fail: FailFactory,
  options: { readonly nonEmpty?: boolean } = {},
): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== "string" ||
    (options.nonEmpty === true && value === "")
  ) {
    throw fail(
      `${context}: field ${JSON.stringify(key)} must be a ` +
        `${options.nonEmpty === true ? "non-empty " : ""}string`,
    );
  }
  return value;
}

// --- Guard combinators (kwarg decoding in the binding modules) ------------

/**
 * `typeof value === "string"` as a guard.
 *
 * @param value - The candidate.
 * @returns Whether it is a string.
 */
export function isString(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * `typeof value === "number"` as a guard.
 *
 * @param value - The candidate.
 * @returns Whether it is a number.
 */
export function isNumber(value: unknown): value is number {
  return typeof value === "number";
}

/**
 * `typeof value === "boolean"` as a guard.
 *
 * @param value - The candidate.
 * @returns Whether it is a boolean.
 */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/**
 * Guard for instances of one class.
 *
 * @param cls - The constructor.
 * @returns A guard accepting `instanceof cls` values.
 */
export function isInstanceOf<T>(
  cls: abstract new (...args: never[]) => T,
): Guard<T> {
  return (value: unknown): value is T => value instanceof cls;
}

/**
 * Guard for arrays whose every element satisfies `element`.
 *
 * @param element - The element guard.
 * @returns A guard accepting such arrays.
 */
export function isArrayOf<T>(element: Guard<T>): Guard<readonly T[]> {
  return (value: unknown): value is readonly T[] =>
    Array.isArray(value) && value.every((item) => element(item));
}

/**
 * Guard for a value satisfying any of the given guards.
 *
 * @param guards - The alternatives.
 * @returns A guard accepting the union.
 */
export function isAnyOf<T extends ReadonlyArray<Guard<unknown>>>(
  ...guards: T
): Guard<T[number] extends Guard<infer U> ? U : never> {
  return (
    value: unknown,
  ): value is T[number] extends Guard<infer U> ? U : never =>
    guards.some((guard) => guard(value));
}

/**
 * Guard for `null` or a value satisfying `inner`.
 *
 * @param inner - The non-null guard.
 * @returns A guard accepting `T | null`.
 */
export function isNullable<T>(inner: Guard<T>): Guard<T | null> {
  return (value: unknown): value is T | null => value === null || inner(value);
}

/**
 * Guard for one of a fixed set of literals.
 *
 * @param literals - The accepted values.
 * @returns A guard accepting exactly those values.
 */
export function isOneOf<const T extends ReadonlyArray<string | number>>(
  ...literals: T
): Guard<T[number]> {
  return (value: unknown): value is T[number] =>
    (literals as readonly unknown[]).includes(value);
}

/** The JSON-object readers bound to one boundary's error class. */
export interface BoundJsonReaders {
  /** {@link asJsonObject} with the boundary's `fail`. */
  readonly asObject: (
    value: JsonValue | undefined,
    context: string,
  ) => Record<string, JsonValue>;
  /** {@link requireString} with the boundary's `fail`. */
  readonly requireString: (
    record: Readonly<Record<string, JsonValue>>,
    key: string,
    context: string,
  ) => string;
  /** {@link optionalString} with the boundary's `fail` and options. */
  readonly optionalString: (
    record: Readonly<Record<string, JsonValue>>,
    key: string,
    context: string,
  ) => string | undefined;
}

/**
 * Bind the JSON-object readers to one boundary's error class so call
 * sites read `asObject(value, context)` without repeating the factory.
 *
 * @param fail - Error factory of the calling boundary.
 * @param options - Forwarded to {@link optionalString}; `nonEmpty` makes
 *   it reject `""`.
 * @returns The bound readers.
 * @example
 * ```ts
 * const { asObject, requireString } = boundJsonReaders(
 *   (message) => new MalformedInteractionError(message),
 * );
 * const request = asObject(raw["request"], "interactions[0]");
 * const method = requireString(request, "method", "interactions[0].request");
 * ```
 */
export function boundJsonReaders(
  fail: FailFactory,
  options: { readonly nonEmpty?: boolean } = {},
): BoundJsonReaders {
  return {
    asObject: (value, context) => asJsonObject(value, context, fail),
    requireString: (record, key, context) =>
      requireString(record, key, context, fail),
    optionalString: (record, key, context) =>
      optionalString(record, key, context, fail, options),
  };
}
