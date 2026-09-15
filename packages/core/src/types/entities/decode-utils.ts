/**
 * Decode-path primitives shared by the entity-model base and the result
 * models: the model-boundary failure, the value-kind describer its
 * messages use, and the datetime-text extractor. A leaf module (it
 * imports only `errors.ts`) so `types/entities/model-base.ts` and
 * `types/results/result-base.ts` can both depend on it without a cycle.
 */

import { ResponseValidationError } from "../../errors.js";

/**
 * Raise the model-boundary validation error.
 *
 * @param path - `Model.field` style location.
 * @param message - What was violated (message text out of contract,
 *   R5.4).
 * @returns Never returns.
 * @throws ResponseValidationError - Always.
 * @internal
 */
export function modelFail(path: string, message: string): never {
  throw new ResponseValidationError(`${path}: ${message}`);
}

/**
 * Describe a value's JSON kind for error messages.
 *
 * @param value - Any value.
 * @returns A short kind label (`"null"`, `"array"`, or the `typeof`).
 * @internal
 */
export function describeValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

/**
 * Extract preserved iso text from a datetime-valued input: raw string,
 * or the runner's duck-typed `PyDatetime` wrapper (an object carrying a
 * string `iso` field — core cannot import the runner class; dependency
 * direction is runner -> core).
 *
 * @param value - The decoded child value.
 * @param path - `Model.field` location for errors.
 * @returns The iso-8601 text.
 * @throws ResponseValidationError - When neither shape matches.
 * @internal
 */
export function requireIsoText(value: unknown, path: string): string {
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
  return modelFail(path, `expected a datetime, got ${describeValue(value)}`);
}
