/**
 * Python `str()` / `repr()` semantics (rulebook R11.1; semantic-trap
 * watchlist item 8). Part of the `pythonCompat` module (rulebook §11):
 * ported once, first; no other module re-derives these semantics.
 *
 * The trap this closes: `String(true)` is `"true"` and `String(null)` is
 * `"null"`, while Python stringifies the same operands as `"True"` and
 * `"None"` — and Python container reprs (`"[1, 2]"`, `"{'a': 1}"`) have no
 * JS equivalent at all.
 */
import { isPythonNonPrintable } from "./non-printable.js";
import { pythonFloatStr } from "./python-float-str.js";

/**
 * The JSON-like value domain `pythonStr` / `pythonRepr` accept.
 *
 * `null` maps to Python `None`. `undefined` is deliberately EXCLUDED:
 * per the tri-state rule (semantic-trap watchlist item 4) `undefined`
 * means "absent", and stringifying an absent value is a caller bug —
 * both functions throw `TypeError` rather than silently blessing it as
 * `None`. `bigint` maps to Python `int` (arbitrary precision).
 */
export type PythonValue =
  | string
  | number
  | bigint
  | boolean
  | null
  | readonly PythonValue[]
  | { readonly [key: string]: PythonValue };

// Printability is classified by the generated, CPython-derived range
// table (non-printable.ts) rather than `\p{Cn}`-style engine property
// escapes: the JS engine's Unicode database version can lead CPython's
// (V8 Unicode 17 vs CPython 3.14's Unicode 16), and the TS-7 differential
// run proved the skew produces live repr() divergences on codepoints
// newly assigned in the engine's database.

/**
 * Render a value exactly as Python `str()` would.
 *
 * Strings pass through verbatim (Python `str` of a `str` adds no quotes);
 * every other value renders via {@link pythonRepr}, matching Python where
 * `str` and `repr` coincide for non-string builtins.
 *
 * @param value - The value to stringify; see {@link PythonValue}.
 * @returns The CPython `str()` rendering.
 * @throws TypeError - When the value (or a nested member) is `undefined`
 *   or otherwise outside the {@link PythonValue} domain.
 * @example
 * ```typescript
 * pythonStr(true); // "True"
 * pythonStr(null); // "None"
 * pythonStr([true, null, 1.5]); // "[True, None, 1.5]"
 * pythonStr("it's"); // "it's"  (no quotes added)
 * ```
 */
export function pythonStr(value: PythonValue): string {
  if (typeof value === "string") {
    return value;
  }
  return pythonRepr(value);
}

/**
 * Render a value exactly as Python `repr()` would.
 *
 * Strings gain Python quoting: single quotes by default, double quotes
 * when the string contains `'` but not `"`; backslash and the active
 * quote are escaped; `\t`, `\n`, `\r` use their short escapes; other
 * non-printable codepoints escape as `\xXX` / `\uXXXX` / `\UXXXXXXXX` by
 * magnitude. Containers recurse with CPython's `[...]` / `{...}`
 * self-reference markers.
 *
 * Number caveat (JS cannot distinguish `18` from `18.0`): safe integers
 * render as Python `int` (`"18"`); everything else renders via
 * {@link pythonFloatStr}. Call sites whose contract is Python
 * `str(float)` of an integral value must use `pythonFloatStr` directly.
 *
 * @param value - The value to repr; see {@link PythonValue}.
 * @returns The CPython `repr()` rendering.
 * @throws TypeError - When the value (or a nested member) is `undefined`
 *   or otherwise outside the {@link PythonValue} domain.
 * @example
 * ```typescript
 * pythonRepr("it's"); // "\"it's\""
 * pythonRepr("tab\tend"); // "'tab\\tend'"
 * pythonRepr({ a: 1 }); // "{'a': 1}"
 * ```
 */
export function pythonRepr(value: PythonValue): string {
  return reprValue(value, new Set());
}

/**
 * Type guard for the {@link PythonValue} domain: `true` exactly when
 * {@link pythonStr} / {@link pythonRepr} render `value` without throwing —
 * JSON primitives, `null`, `bigint`, arrays and plain objects (members
 * checked recursively; a self-referencing container still qualifies,
 * since the renderers emit CPython's `[...]` / `{...}` markers for it).
 *
 * @param value - The value to classify.
 * @returns Whether `value` lies in the {@link PythonValue} domain.
 * @example
 * ```typescript
 * isPythonValue({ a: [1, null] }); // true
 * isPythonValue(new Map()); // false (not a plain object)
 * isPythonValue(undefined); // false (undefined means ABSENT)
 * ```
 */
export function isPythonValue(value: unknown): value is PythonValue {
  return inPythonDomain(value, new Set());
}

/**
 * Recursive worker for {@link isPythonValue}.
 *
 * @param value - Current value to classify.
 * @param active - Containers on the recursion stack (a revisit is fine:
 *   the renderers handle self-reference).
 * @returns Whether `value` lies in the {@link PythonValue} domain.
 */
function inPythonDomain(value: unknown, active: Set<object>): boolean {
  switch (typeof value) {
    case "string":
    case "number":
    case "bigint":
    case "boolean": {
      return true;
    }
    case "object": {
      if (value === null) {
        return true;
      }
      if (active.has(value)) {
        return true;
      }
      const proto: unknown = Object.getPrototypeOf(value);
      if (
        !Array.isArray(value) &&
        proto !== Object.prototype &&
        proto !== null
      ) {
        return false;
      }
      active.add(value);
      const members: unknown[] = Array.isArray(value)
        ? value
        : Object.values(value);
      const ok = members.every((member) => inPythonDomain(member, active));
      active.delete(value);
      return ok;
    }
    default: {
      return false;
    }
  }
}

/**
 * Python `str()` of a value typed `unknown` — the f-string / `str(x)` twin
 * for sites that receive JSON-decoded data through an `unknown`
 * annotation (token responses, query rows, rrweb attributes).
 *
 * In-domain values render exactly like {@link pythonStr}. Anything outside
 * the {@link PythonValue} domain — `undefined`, class instances, `Map`s,
 * functions, symbols: shapes JSON cannot produce, so the Python twin never
 * met them — renders as a `<TypeName>` placeholder instead of JS's
 * `[object Object]`, and never throws.
 *
 * @param value - The value to stringify.
 * @returns The CPython `str()` rendering, or a `<TypeName>` placeholder.
 * @example
 * ```typescript
 * pythonStrOf("scope"); // "scope"
 * pythonStrOf({ x: 1 }); // "{'x': 1}"
 * pythonStrOf(true); // "True"
 * pythonStrOf(new Map()); // "<Map>"
 * pythonStrOf(undefined); // "<undefined>"
 * ```
 */
export function pythonStrOf(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (isPythonValue(value)) {
    return reprValue(value, new Set());
  }
  return `<${looseTypeName(value)}>`;
}

/**
 * Placeholder type name for {@link pythonStrOf}'s out-of-domain branch:
 * the constructor name for objects, `typeof` for everything else.
 *
 * @param value - An out-of-domain value.
 * @returns A short type label.
 */
function looseTypeName(value: unknown): string {
  if (typeof value !== "object" || value === null) {
    return typeof value;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  const name =
    proto !== null && typeof proto === "object"
      ? (proto as { constructor?: { name?: unknown } }).constructor?.name
      : undefined;
  return typeof name === "string" && name !== "" ? name : "object";
}

/**
 * Recursive worker for {@link pythonRepr} carrying the active-container
 * set used to detect self-reference.
 *
 * @param value - Current value to render.
 * @param active - Containers currently on the recursion stack; a revisit
 *   renders as CPython's `[...]` / `{...}` marker.
 * @returns The CPython `repr()` rendering of `value`.
 * @throws TypeError - When `value` is outside the {@link PythonValue}
 *   domain (`undefined`, functions, symbols, class instances are all
 *   rejected).
 */
function reprValue(value: PythonValue, active: Set<object>): string {
  if (typeof value === "string") {
    return reprString(value);
  }
  if (typeof value === "boolean") {
    return value ? "True" : "False";
  }
  if (value === null) {
    return "None";
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "number") {
    if (Number.isSafeInteger(value) && !Object.is(value, -0)) {
      return String(value);
    }
    return pythonFloatStr(value);
  }
  if (Array.isArray(value)) {
    if (active.has(value)) {
      return "[...]";
    }
    active.add(value);
    const items = value.map((item) => reprValue(item, active));
    active.delete(value);
    return `[${items.join(", ")}]`;
  }
  if (typeof value === "object") {
    if (active.has(value)) {
      return "{...}";
    }
    active.add(value);
    const entries = Object.entries(value).map(
      ([key, member]) => `${reprString(key)}: ${reprValue(member, active)}`,
    );
    active.delete(value);
    return `{${entries.join(", ")}}`;
  }
  throw new TypeError(
    `pythonStr/pythonRepr cannot render ${typeof value}: ` +
      "only string, number, bigint, boolean, null, array and plain-object " +
      "values map onto Python semantics (undefined means ABSENT, not None)",
  );
}

/**
 * Render a string exactly as CPython `repr(str)` would.
 *
 * @param value - The string to quote and escape (any codepoints,
 *   including lone surrogates, which escape as `\uXXXX`).
 * @returns The quoted, escaped Python string literal.
 */
function reprString(value: string): string {
  const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
  let body = "";
  for (const character of value) {
    switch (character) {
      case "\\":
      case quote: {
        body += `\\${character}`;

        break;
      }
      case "\t": {
        body += String.raw`\t`;

        break;
      }
      case "\n": {
        body += String.raw`\n`;

        break;
      }
      case "\r": {
        body += String.raw`\r`;

        break;
      }
      default: {
        if (isPythonNonPrintable(character.codePointAt(0) ?? 0)) {
          body += escapeCodepoint(character.codePointAt(0) ?? 0);
        } else {
          body += character;
        }
      }
    }
  }
  return quote + body + quote;
}

/**
 * Escape a non-printable codepoint the way CPython `repr` does.
 *
 * @param codepoint - The Unicode codepoint to escape.
 * @returns `\xXX` for codepoints below U+0100, `\uXXXX` below U+10000,
 *   `\UXXXXXXXX` otherwise (lowercase hex, zero-padded).
 */
function escapeCodepoint(codepoint: number): string {
  if (codepoint < 0x100) {
    return String.raw`\x${codepoint.toString(16).padStart(2, "0")}`;
  }
  if (codepoint < 0x10000) {
    return String.raw`\u${codepoint.toString(16).padStart(4, "0")}`;
  }
  return String.raw`\U${codepoint.toString(16).padStart(8, "0")}`;
}
