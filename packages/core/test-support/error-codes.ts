// Error-code projections for the validator suites: `[e.code for e in errors]`
// over a validator's result list, and the same over the `errors` a
// `BookmarkValidationError` carries.
import type {
  BookmarkValidationError,
  ValidationError,
} from "../src/errors.js";

/**
 * The codes of a validator result list, in order.
 *
 * @param errors - The validator's output.
 * @returns One code per error.
 */
export function codes(errors: readonly ValidationError[]): string[] {
  return errors.map((e) => e.code);
}

/**
 * The codes carried by a thrown `BookmarkValidationError`, in order.
 *
 * @param exc - The caught value (asserted `BookmarkValidationError` by the caller).
 * @returns One code per carried error.
 */
export function codesOf(exc: unknown): string[] {
  return (exc as BookmarkValidationError).errors.map((e) => e.code);
}
