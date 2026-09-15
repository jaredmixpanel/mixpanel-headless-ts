/**
 * Runtime invariants — the port's replacement for Python `assert` and for
 * `!` non-null assertions, which would erase the check — plus the two
 * small twins every caught-exception path needs: `str(exc)` and "coerce a
 * thrown value to an `Error`". Violations throw the hierarchy root so
 * every catch-all handler sees the same base class.
 *
 * @see mixpanel_headless.exceptions.MixpanelHeadlessError
 */

import { MixpanelHeadlessError } from "./errors.js";

/**
 * Assert an invariant that Python enforced with a bare `assert`.
 *
 * @remarks
 * JS truthiness differs from Python's for empty collections (`[]` and
 * `{}` are truthy in JS), so call sites pass explicit predicates
 * (`steps.length > 0`), never bare collection values.
 * @param condition - The invariant; narrowed to truthy for the rest of
 *   the scope (`asserts condition`).
 * @param message - Human-readable violation message (display only; never
 *   part of the conformance contract).
 * @throws {@link MixpanelHeadlessError} - When `condition` is falsy (code
 *   `UNKNOWN_ERROR`, matching Python's uncoded `AssertionError` sites).
 * @example
 * ```typescript
 * invariant(pages.length > 0, "paginator yielded no pages");
 * // `pages.length > 0` is proven from here on
 * ```
 */
export function invariant(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new MixpanelHeadlessError(message);
  }
}

/**
 * Narrow a possibly-missing value, throwing where a `!` assertion would
 * merely have lied. For indexed reads whose presence a prior length
 * check or loop bound already guarantees.
 *
 * @param value - The value to narrow.
 * @param what - What the value is, for the violation message.
 * @returns `value`, narrowed to exclude `null` / `undefined`.
 * @throws {@link MixpanelHeadlessError} - When `value` is `null` or
 *   `undefined`.
 * @example
 * ```typescript
 * const first = defined(steps[0], "first funnel step");
 * ```
 */
export function defined<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new MixpanelHeadlessError(`${what} is unexpectedly missing`);
  }
  return value;
}

/**
 * Return the Python `str(exc)` twin of a caught value: an `Error`'s
 * message, anything else stringified — the text every `f"...: {exc}"`
 * port interpolates.
 *
 * @param exc - The caught value.
 * @returns Its message text.
 * @example
 * ```typescript
 * throw new ConfigError(`Failed to load config: ${exceptionMessage(exc)}`);
 * ```
 */
export function exceptionMessage(exc: unknown): string {
  return exc instanceof Error ? exc.message : String(exc);
}

/**
 * Coerce a caught value to an `Error` so it can be re-thrown or stored
 * where an `Error` is required (Python can only raise `BaseException`;
 * JS can throw anything). Errors pass through untouched; anything else is
 * wrapped with the original value as `cause`.
 *
 * @param value - The caught value.
 * @returns `value` itself when it is an `Error`, else a wrapping `Error`.
 * @example
 * ```typescript
 * const failure = toError(caught); // always an Error, `cause` preserved
 * ```
 */
export function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  const message =
    typeof value === "string"
      ? value
      : `non-Error value thrown: ${typeof value}`;
  return new Error(message, { cause: value });
}
