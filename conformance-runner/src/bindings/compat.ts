/**
 * The `compat.*` bindings — the pythonCompat slice
 * (`zfill`, `python_str`, `python_float_str`, `python_int`,
 * `python_float`, `python_float_coerce`, `python_strip`,
 * `sorted_strings`, `cp_length`, `cp_slice`).
 *
 * Each binding calls the real `packages/core` entry point; the only
 * adaptations are kwarg plumbing, the shared error wrap, and the
 * `pythonFloat` output encoding below.
 */

import {
  cpLength,
  cpSlice,
  pythonFloat,
  pythonFloatCoerce,
  pythonFloatStr,
  pythonInt,
  pythonStr,
  pythonStrip,
  type PythonValue,
  sortedByCodepoint,
  zfill,
} from "@mixpanel-headless/core";

import {
  isArrayOf,
  isNullable,
  isNumber,
  isString,
} from "../internal/guards.js";
import {
  kwarg,
  kwargAs,
  optionalKwarg,
  requireKwarg,
} from "../internal/kwargs.js";
import { JsonNumber, type JsonValue } from "../json-value.js";
import type { ImplementationRegistry } from "../runner.js";
import { type BindingTable, guardCompat, registerTable } from "./shared.js";

/**
 * Encode one `pythonFloat` result exactly as the Python reference wrapper
 * does (the wrapper IS the recorded api, so the binding mirrors its two
 * output translations verbatim):
 *
 * - non-finite results become the `repr` sentinel strings (`"inf"` /
 *   `"-inf"` / `"nan"`; non-finite floats are illegal in vector JSON);
 * - finite results ride as a `JsonNumber` carrying the CPython `repr`
 *   token so canonical float-ness is preserved (`42.0`, not `42`).
 *
 * @param value - The `pythonFloat` return value.
 * @returns The vector-JSON encoding.
 */
function encodePythonFloatResult(value: number): JsonValue {
  if (Number.isNaN(value)) {
    return "nan";
  }
  if (value === Infinity) {
    return "inf";
  }
  if (value === -Infinity) {
    return "-inf";
  }
  return new JsonNumber(pythonFloatStr(value));
}

/** The `compat.*` table (each binder runs under {@link guardCompat}). */
const COMPAT_BINDINGS: BindingTable = [
  [
    "compat.zfill",
    (context) =>
      zfill(
        kwarg(context, "value", isString, "str"),
        kwarg(context, "width", isNumber, "int"),
      ),
  ],
  [
    "compat.python_str",
    (context) => {
      // Python str() branches on float-vs-int; after decoding, 18.0 and 18
      // are the same JS number, so the float branch is recoverable only
      // from the raw token (InvocationContext.rawInput).
      const raw = context.rawInput["value"];
      if (raw instanceof JsonNumber && !raw.isIntegerToken()) {
        return pythonFloatStr(raw.toNumber());
      }
      // Decoded vector JSON is inside the PythonValue domain by
      // construction (scalars, lists, plain dicts).
      return pythonStr(kwargAs<PythonValue>(context, "value"));
    },
  ],
  [
    "compat.python_float_str",
    (context) => pythonFloatStr(kwarg(context, "value", isNumber, "float")),
  ],
  [
    "compat.python_int",
    (context) => pythonInt(kwarg(context, "value", isString, "str")),
  ],
  [
    "compat.python_float",
    (context) =>
      encodePythonFloatResult(
        pythonFloat(kwarg(context, "value", isString, "str")),
      ),
  ],
  // The float(x) coercion ladder: kwarg decode may hand a native number,
  // bool, null, string, list, plain dict, or the runner's PyFloat
  // spelling wrapper — the library twin handles every arm; bare
  // TypeError/OverflowError twins propagate for class-name comparison.
  [
    "compat.python_float_coerce",
    (context) =>
      encodePythonFloatResult(
        pythonFloatCoerce(requireKwarg(context, "value")),
      ),
  ],
  [
    "compat.python_strip",
    (context) => pythonStrip(kwarg(context, "value", isString, "str")),
  ],
  [
    "compat.sorted_strings",
    (context) =>
      sortedByCodepoint(
        kwarg(context, "values", isArrayOf(isString), "list[str]"),
      ),
  ],
  [
    "compat.cp_length",
    (context) => cpLength(kwarg(context, "value", isString, "str")),
  ],
  [
    "compat.cp_slice",
    (context) => {
      // Tri-state note (rig api): `start`/`end` absent and explicit-null
      // both spell Python None (the open slice end) for this reference
      // wrapper — cp_slice(value, start=None) IS the default; `cpSlice`
      // treats `undefined` the same way.
      const bound = (name: string): number | undefined =>
        optionalKwarg(context, name, isNullable(isNumber), "int | None") ??
        undefined;
      return cpSlice(
        kwarg(context, "value", isString, "str"),
        bound("start"),
        bound("end"),
      );
    },
  ],
];

/**
 * Register the `compat.*` bindings.
 *
 * @param implementations - The registry to extend.
 */
export function registerCompatBindings(
  implementations: ImplementationRegistry,
): void {
  registerTable(
    implementations,
    COMPAT_BINDINGS,
    (binder) => (context) => guardCompat(() => binder(context)),
  );
}
