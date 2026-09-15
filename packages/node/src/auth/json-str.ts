/**
 * Python `str()` over JSON-decoded token-file members — the
 * `str(data["scope"])` coercions of the on-disk token readers (token
 * storage and the bridge file), typed through a guard instead of a cast.
 *
 * @see mixpanel_headless._internal.auth.storage.OAuthStorage.load_tokens
 */

import { ParamValidationError, pythonStr } from "@mixpanel-headless/core";
import { isPythonValue } from "@mixpanel-headless/core/internal";

/**
 * Render a JSON-decoded member exactly as Python's `str()` would.
 *
 * @param value - The decoded member (any JSON value is a `PythonValue`).
 * @param field - The member name, for the error message.
 * @returns The `str()` text.
 * @throws {@link ParamValidationError} - When the value is not a JSON
 *   value (a reader handing over something other than parsed JSON).
 * @example
 * ```ts
 * const data = JSON.parse(text) as Record<string, unknown>;
 * const scope = jsonPythonStr(data["scope"], "scope"); // "None" for null
 * ```
 */
export function jsonPythonStr(value: unknown, field: string): string {
  if (!isPythonValue(value)) {
    throw new ParamValidationError(`${field} is not a JSON value`);
  }
  return pythonStr(value);
}
