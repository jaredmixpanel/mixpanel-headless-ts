/**
 * Python `str()` over JSON-decoded token-file members — the
 * `str(data["scope"])` coercions of the on-disk token readers
 * (`storage.py`, the bridge file), typed through a guard instead of a
 * cast.
 */

import { ParamValidationError, pythonStr } from "@mixpanel-headless/core";
import { isPythonValue } from "@mixpanel-headless/core/internal";

/**
 * Render a JSON-decoded member exactly as Python's `str()` would.
 *
 * @param value - The decoded member (any JSON value is a `PythonValue`).
 * @param field - The member name, for the error message.
 * @returns The `str()` text.
 * @throws ParamValidationError - When the value is not a JSON value (a
 *   reader handing over something other than parsed JSON).
 */
export function jsonPythonStr(value: unknown, field: string): string {
  if (!isPythonValue(value)) {
    throw new ParamValidationError(`${field} is not a JSON value`);
  }
  return pythonStr(value);
}
