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
   * (`VALIDATION_ERROR`); `'response'` (default — the config/vector-decode
   * seam) throws {@link ResponseValidationError}
   * (`RESPONSE_VALIDATION_ERROR`). Mirrors the shared `coerce.ts`
   * convention.
   */
  readonly boundary?: "param" | "response" | undefined;
}

/**
 * Throw the boundary-appropriate parse error (the generic validation
 * codes; no auth-specific codes exist).
 *
 * @param message - Human-readable description (out of contract).
 * @param options - Parse options carrying the boundary kind.
 * @param details - Optional structured error data (snake_case keys).
 * @returns Never returns.
 * @throws ParamValidationError - When `options.boundary === 'param'`.
 * @throws ResponseValidationError - Otherwise (default boundary).
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
