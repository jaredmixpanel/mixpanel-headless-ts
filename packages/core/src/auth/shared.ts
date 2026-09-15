/**
 * The parse-boundary contract shared by every auth parse factory
 * (`account.ts`, `session.ts`, `token.ts`): one options bag naming the
 * boundary, one thrower picking the coded error class for it.
 */

import { ParamValidationError, ResponseValidationError } from "../errors.js";

/** Options accepted by every auth parse factory. */
export interface ParseAccountOptions {
  /**
   * Error boundary: `'param'` throws {@link ParamValidationError}
   * (`VALIDATION_ERROR`) for caller-supplied input; `'response'` — the
   * config / vector-decode seam — throws {@link ResponseValidationError}
   * (`RESPONSE_VALIDATION_ERROR`). Mirrors the shared `coerce.ts`
   * convention.
   *
   * @defaultValue `"response"`
   */
  readonly boundary?: "param" | "response" | undefined;
}

/**
 * Throw the parse error for the boundary named in `options` (the generic
 * validation codes; no auth-specific codes exist).
 *
 * @param message - Human-readable description (out of contract).
 * @param options - Parse options carrying the boundary kind.
 * @param details - Optional structured error data (snake_case keys).
 * @throws {@link ParamValidationError} - When `options.boundary` is
 *   `'param'`.
 * @throws {@link ResponseValidationError} - Otherwise (the default
 *   boundary).
 * @example
 * ```typescript
 * parseFail("Account.name must be a string", { boundary: "param" }, {
 *   field: "name",
 * });
 * // throws ParamValidationError with code VALIDATION_ERROR
 * ```
 */
export function parseFail(
  message: string,
  options: ParseAccountOptions,
  details?: Readonly<Record<string, unknown>>,
): never {
  if (options.boundary === "param") {
    throw new ParamValidationError(message, "VALIDATION_ERROR", details);
  }
  throw new ResponseValidationError(
    message,
    "RESPONSE_VALIDATION_ERROR",
    details,
  );
}
