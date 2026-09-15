/**
 * Error-text helpers shared by the node surface: every on-disk boundary
 * (config file, bridge file, token files, `/me` cache) wraps the
 * underlying failure into a coded library error whose message carries
 * the original text — `f"...: {exc}"` in Python.
 */

import { ConfigError } from "@mixpanel-headless/core";

/**
 * The Python `str(exc)` twin for a caught value: an `Error`'s message,
 * anything else stringified.
 *
 * @param exc - The caught value.
 * @returns Its message text.
 */
export function errorMessage(exc: unknown): string {
  return exc instanceof Error ? exc.message : String(exc);
}

/**
 * Wrap a caught failure into a `ConfigError` reading `${prefix}: ${str(exc)}`
 * with the original as `cause`.
 *
 * @param prefix - The boundary-specific lead-in (no trailing colon).
 * @param exc - The caught value.
 * @param details - Optional structured error data (snake_case keys).
 * @returns The error, ready to throw.
 */
export function wrapAsConfigError(
  prefix: string,
  exc: unknown,
  details: Readonly<Record<string, unknown>> | null = null,
): ConfigError {
  return new ConfigError(`${prefix}: ${errorMessage(exc)}`, details, {
    cause: exc,
  });
}
