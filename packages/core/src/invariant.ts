/**
 * `invariant()` helper — the TS port target for Python `assert`
 * statements (rulebook R6.8).
 *
 * R6.8: Python `assert` → `invariant(cond, msg)`, never a `!` non-null
 * assertion (which erases the runtime check). The rule names the thrown
 * class `MixpanelError`; that R5.1 client-tier base is deferred to
 * Phase-3 B4 (phase2-design C3), so the hierarchy root
 * `MixpanelHeadlessError` is thrown here — every catch-all handler sees
 * the same base either way.
 */

import { MixpanelHeadlessError } from "./errors.js";

/**
 * Assert an invariant that Python enforced with a bare `assert`.
 *
 * NOTE for mechanical translation: JS truthiness differs from Python's
 * for empty collections (`[]`/`{}` are truthy in JS — semantic-trap
 * watchlist #6). Call sites must pass explicit predicates
 * (`steps.length > 0`), never bare collection values.
 *
 * Example:
 * ```ts
 * invariant(pages.length > 0, "paginator yielded no pages");
 * // control flow past this line has `pages.length > 0` proven
 * ```
 *
 * @param condition - The invariant condition; narrowed to truthy for the
 *   remainder of the scope (`asserts condition`).
 * @param message - Human-readable violation message (display only —
 *   never vector-compared, R5.4).
 * @returns Nothing; narrows `condition` on success.
 * @throws MixpanelHeadlessError - When `condition` is falsy (code
 *   `UNKNOWN_ERROR`, matching Python's uncoded `AssertionError` sites).
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
 * merely have lied (R6.8 — the runtime check stays). For indexed reads
 * whose presence a prior length check or loop bound already guarantees.
 *
 * @param value - The value to narrow.
 * @param what - What the value is, for the violation message.
 * @returns `value`, narrowed to exclude `null` / `undefined`.
 * @throws MixpanelHeadlessError - When `value` is `null` or `undefined`.
 */
export function defined<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new MixpanelHeadlessError(`${what} is unexpectedly missing`);
  }
  return value;
}

/**
 * Coerce a caught value to an `Error` so it can be re-thrown or stored
 * where an `Error` is required (Python can only raise `BaseException`;
 * JS can throw anything). Errors pass through untouched; anything else
 * is wrapped with the original value as `cause`.
 *
 * @param value - The caught value.
 * @returns `value` itself when it is an `Error`, else a wrapping `Error`.
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
