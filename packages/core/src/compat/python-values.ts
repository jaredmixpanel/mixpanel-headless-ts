/**
 * Python value-classification and display helpers for the ported value
 * domain: the `isinstance(x, float | int | dict)` analogues, the
 * conformance rig's PyFloat carrier, `type(x).__name__`, `str()` /
 * `repr()` spellings that validators interpolate into messages, and
 * `dict.get` / codepoint comparison.
 *
 * Ported once here because every validation and transform module needs
 * the same discriminations; they used to live in
 * `query/validation-shared.ts`, which sits above the entity models and
 * therefore could not be imported from low-level modules without an
 * evaluation cycle. This module imports only compat leaves.
 *
 * @module compat/python-values
 * @internal
 */

import { codepoints, compareCodepoints } from "./codepoint.js";
import { isPythonDict } from "./python-dict.js";
import { pythonFloat } from "./python-float.js";
import { pythonFloatStr } from "./python-float-str.js";
import { pythonRepr, pythonStr, type PythonValue } from "./python-str.js";

// =============================================================================
// PyFloat carrier
// =============================================================================

/**
 * Duck-type check for the conformance rig's PyFloat carrier — a
 * non-number object with a string `spelling` field, produced when a
 * Python float (integral spelling like `18.0`, or the non-finite
 * spellings `Infinity`/`-Infinity`/`NaN`) rides a decoded kwargs bag.
 *
 * Recognizing the shape lets `isinstance(x, float)` branches (e.g.
 * retention R5_BUCKET_SIZES_INTEGER) classify carriers exactly where
 * Python classifies floats, without any binding-side unwrapping.
 *
 * The rig's carrier is a CLASS instance (`conformance-runner/src/codecs.ts`
 * `PyFloat` — its single construction site), never a plain object, so the
 * duck check additionally rejects {@link isPythonDict} values: a consumer
 * dict `{"spelling": "..."}` is a Python dict, not a float.
 *
 * @param value - Candidate value.
 * @returns True when `value` carries the PyFloat duck-shape.
 */
export function isFloatCarrier(
  value: unknown,
): value is { readonly spelling: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !isPythonDict(value) &&
    "spelling" in value &&
    typeof value.spelling === "string"
  );
}

/**
 * Numeric value of a PyFloat carrier, for the branches that compare a
 * float NUMERICALLY rather than by type.
 *
 * The spelling is CPython `repr(float)` output produced by the rig's
 * codec, so it is parsed with `pythonFloat` — never with
 * `Number()`/`parseFloat`.
 *
 * @param carrier - A value that satisfied {@link isFloatCarrier}.
 * @returns The double the carrier stands for (`Infinity` / `NaN`
 *   included).
 * @throws MixpanelHeadlessError - Code `PY_FLOAT_INVALID_LITERAL` when
 *   the spelling is not a CPython float literal (unreachable for
 *   codec-produced carriers).
 */
export function floatCarrierValue(carrier: {
  readonly spelling: string;
}): number {
  return pythonFloat(carrier.spelling);
}

/**
 * Python `str(value)` for a value that may be a PyFloat carrier — the
 * ONE implementation of the "stringify an operand whose float-ness the
 * rig preserved" pattern.
 *
 * `pythonStr` already matches CPython for strings, bools, `None`,
 * containers and non-integral numbers. The one gap JS cannot close on
 * its own is int-vs-float-ness of an INTEGRAL value; where the
 * conformance rig preserves it ({@link isFloatCarrier}), the carrier's
 * CPython `repr` spelling is used, so `18.0` renders `"18.0"` and not
 * `"18"`.
 *
 * Both ported call sites are `str(x)` landing in OUTPUT, so
 * `String(...)` is forbidden (`String(true)` is `"true"`, Python's is
 * `"True"`):
 *
 * - `mixpanel_headless._internal.query.segfilter` — the number/datetime
 *   operand positions.
 * - `mixpanel_headless._internal.query.user_builders._format_value` —
 *   the non-string branch (the `selector_str` codec compares VERBATIM).
 *
 * @param value - The value to stringify.
 * @returns The CPython `str()` rendering.
 * @throws TypeError - When the value is outside the `pythonStr` domain
 *   (class instances, `undefined`) — out-of-annotation input only.
 */
export function pythonStrValue(value: unknown): string {
  if (isFloatCarrier(value)) {
    return pythonFloatStr(floatCarrierValue(value));
  }
  return pythonStr(value as PythonValue);
}

// =============================================================================
// isinstance analogues
// =============================================================================

/**
 * TS analog of Python `isinstance(value, float)`.
 *
 * A JS number is a Python float when it is non-integral or non-finite
 * (integral finite JS numbers are Python ints in the ported value
 * domain); a PyFloat carrier ({@link isFloatCarrier}) is always a
 * float.
 *
 * @param value - Candidate value.
 * @returns True when Python would classify the value as a `float`.
 */
export function isPythonFloat(value: unknown): boolean {
  if (typeof value === "number") {
    return !Number.isInteger(value);
  }
  return isFloatCarrier(value);
}

/**
 * TS analog of Python `isinstance(value, int) and not isinstance(value,
 * bool)` — the bool-before-int guard order.
 *
 * Not to be confused with `types/query-params/guards.ts` `isPyIntOrBool`,
 * which serves the sites where Python's `isinstance(v, int)` is meant to
 * ADMIT booleans.
 *
 * @param value - Candidate value.
 * @returns True when Python would classify the value as a non-bool int.
 */
export function isPythonInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/**
 * Reproduce CPython's hashing failure for `x in frozenset` membership
 * tests (bug-compatibility, adjudicated at the differential fuzz).
 *
 * Python hashes the candidate: a `list`/`dict` value raises
 * `TypeError: cannot use 'list' as a set element (unhashable type: …)`
 * instead of yielding the enum error. In the ported value domain the
 * unhashable inputs are exactly JSON arrays and plain dicts; every
 * other decoded value (string, number, bool, null, PyFloat carrier —
 * a Python float — and reconstructed core instances, which hash by
 * identity in Python) is hashable and falls through to the membership
 * test. Callers gate on the same condition Python does (the site's
 * `is not None` short-circuit); a `null`/`undefined` value is a no-op
 * here anyway.
 *
 * @param value - The membership-test candidate.
 * @throws TypeError - When Python's `hash(value)` would raise.
 */
export function requireHashable(value: unknown): void {
  if (Array.isArray(value)) {
    throw new TypeError(
      "cannot use 'list' as a set element (unhashable type: 'list')",
    );
  }
  if (isPythonDict(value)) {
    throw new TypeError(
      "cannot use 'dict' as a set element (unhashable type: 'dict')",
    );
  }
}

/**
 * Elements CPython's iteration protocol would yield, or `null` when the
 * value is not iterable.
 *
 * Strings yield CODE POINTS (never UTF-16 units), lists yield their
 * elements and dicts yield their KEYS. Ported once because two modules
 * need it: `segfilter`'s range comprehensions (`[str(v) for v in value]`)
 * and `transforms`' `dict(properties)` copy. Callers decide what a
 * `null` means — CPython's message differs per site — so this helper
 * never throws.
 *
 * @param value - The value being iterated.
 * @returns The drawn elements in order, or `null` for a non-iterable.
 */
export function pythonIterableElements(value: unknown): unknown[] | null {
  if (typeof value === "string") {
    return codepoints(value);
  }
  if (Array.isArray(value)) {
    return [...(value as unknown[])];
  }
  if (isPythonDict(value)) {
    return Object.keys(value);
  }
  return null;
}

/**
 * Python `dict.get(key, default)` over a plain-object dict — an OWN-key
 * lookup, never a prototype member (`"toString" in obj` is true in JS,
 * false in Python).
 *
 * @param source - The dict being read.
 * @param key - Key to look up.
 * @param fallback - Value returned when the key is ABSENT (a present
 *   `null` is returned as `null`, exactly like Python). Defaults to
 *   `undefined`, the local stand-in for `.get(key)`'s `None`.
 * @returns The stored value or the fallback.
 */
export function dictGet(
  source: Readonly<Record<string, unknown>>,
  key: string,
  fallback?: unknown,
): unknown {
  return Object.hasOwn(source, key) ? source[key] : fallback;
}

// =============================================================================
// Display helpers (message text only — out of contract)
// =============================================================================

/**
 * Display-only `type(x).__name__` analog for ported message text.
 *
 * Plain objects (including null-prototype ones) are Python dicts and
 * report `dict`. Class instances report `value.constructor.name`, which
 * is the Python class name because the port keeps Python's class names
 * verbatim (`Filter`, `Metric`, `CohortBreakdown`, …). That relies on the class
 * name surviving to runtime: a minifying bundler must keep function
 * names (esbuild `keepNames: true`) or these messages degrade to
 * single-letter type names. The message text itself is never contract.
 *
 * @param value - The value whose Python type name to approximate.
 * @returns The Python type name Python would print for the
 *   equivalent value.
 */
export function pythonTypeName(value: unknown): string {
  if (value === null || value === undefined) {
    return "NoneType";
  }
  if (typeof value === "boolean") {
    return "bool";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? "int" : "float";
  }
  if (isFloatCarrier(value)) {
    return "float";
  }
  if (typeof value === "string") {
    return "str";
  }
  if (Array.isArray(value)) {
    return "list";
  }
  if (isPythonDict(value)) {
    return "dict";
  }
  if (typeof value === "object") {
    return value.constructor.name;
  }
  return typeof value;
}

/**
 * Render a list of strings as a Python `list` repr (display-only
 * message helper for the `{sorted(...)}` f-string interpolations).
 *
 * @param items - The (already ordered) list members.
 * @returns Python-style list repr, e.g. `['birth', 'interval_start']`.
 */
export function pythonListRepr(items: readonly string[]): string {
  return `[${items.map((item) => pythonRepr(item)).join(", ")}]`;
}

/**
 * Render a number the way a Python f-string would (display-only).
 *
 * JS cannot distinguish `18` from `18.0`, so this delegates to
 * {@link pythonRepr}'s documented number caveat: safe integers render
 * as Python `int`, everything else (including `nan` / `inf`) via
 * `pythonFloatStr`. `null` renders as `None`.
 *
 * @param value - The number (or `null`) to render.
 * @returns The Python `str()` rendering.
 */
export function pythonNumberStr(value: number | null): string {
  if (value === null) {
    return "None";
  }
  return pythonRepr(value);
}

/**
 * `str(value)` for the loosely-typed enum arguments that Python passes
 * through `str(...)` before fuzzy matching (`str(mode)`, `str(unit)` in
 * `mixpanel_headless._internal.validation.validate_retention_args`).
 *
 * Only the shapes those call sites can actually receive are modelled:
 * strings pass through, `None` renders `"None"`, and anything else
 * falls back to {@link pythonTypeName} (a display-only approximation).
 *
 * @param value - Candidate enum value.
 * @returns The Python `str()` rendering.
 */
export function pythonStrLoose(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "None";
  }
  if (typeof value === "boolean") {
    return value ? "True" : "False";
  }
  if (typeof value === "number") {
    return pythonRepr(value);
  }
  return `<${pythonTypeName(value)}>`;
}

// =============================================================================
// Ordering
// =============================================================================

/**
 * Python-`str` codepoint-wise `a > b` comparison — JS `>` on strings
 * compares UTF-16 units, which diverges for non-BMP vs U+E000..U+FFFF
 * mixes.
 *
 * @param a - Left operand.
 * @param b - Right operand.
 * @returns True when Python would evaluate `a > b`.
 */
export function codepointGreater(a: string, b: string): boolean {
  return compareCodepoints(a, b) > 0;
}
