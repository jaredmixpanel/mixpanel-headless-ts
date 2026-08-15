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
