/**
 * CPython `json.dumps(value)` twin with DEFAULT arguments — Phase-3
 * packet B4-C2 (R11.7 enabling dependency for wire-param spelling).
 *
 * The C2 query/engage/export methods embed `json.dumps(...)` output
 * INSIDE query parameters and JSON-body string members
 * (`api_client.py:1855` `event`, `:2075` `filter_by_cohort`, `:2077`
 * `output_properties`, `:2081` `distinct_ids`, `:2085` `behaviors`,
 * `:2321` `segment_by_cohorts`, `:2578` / `:2632` event/values lists).
 * Those strings are diffed byte-exactly against the recorded requests,
 * so the CPython spelling is the contract:
 *
 * - separators `(", ", ": ")` — a SPACE after every comma and colon
 *   (`json.dumps(["a", "b"])` is `'["a", "b"]'`, not `'["a","b"]'`);
 * - `ensure_ascii=True` — every non-ASCII character escapes to
 *   `\uXXXX` UTF-16 units (lowercase hex; astral chars as surrogate
 *   pairs: `"𝒳"` → `'"𝒳"'`);
 * - `allow_nan=True` — non-finite floats spell `NaN` / `Infinity` /
 *   `-Infinity` (the JSON extension spellings, NOT Python repr's
 *   `nan`/`inf`);
 * - floats via CPython `repr` ({@link pythonFloatStr}), ints as bare
 *   digit runs.
 *
 * Scope note (R4.5/R10.3): inputs are decoded vector kwargs / caller
 * data — plain objects, arrays, strings, numbers, bigints, booleans,
 * `null`. Python-only key coercions (`json.dumps({1: "x"})` →
 * `'{"1": "x"}'`) cannot arise because JS object keys are already
 * strings. Anything non-serializable raises the CPython `TypeError`
 * message shape.
 */

import { pythonFloatStr } from "./python-float-str.js";

/** CPython short escapes for the control characters that have them. */
const SHORT_ESCAPES: ReadonlyMap<number, string> = new Map([
  [0x08, "\\b"],
  [0x09, "\\t"],
  [0x0a, "\\n"],
  [0x0c, "\\f"],
  [0x0d, "\\r"],
  [0x22, '\\"'],
  [0x5c, "\\\\"],
]);

/**
 * Escape one string exactly as CPython's `json.encoder.py_encode_basestring_ascii`
 * does (`ensure_ascii=True`): printable ASCII passes through, everything
 * else becomes a short escape or a lowercase `\uXXXX` UTF-16 unit.
 *
 * @param text - The string to encode.
 * @returns The quoted, escaped JSON string literal.
 */
function encodeStringAscii(text: string): string {
  let out = '"';
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    const short = SHORT_ESCAPES.get(unit);
    if (short !== undefined) {
      out += short;
    } else if (unit >= 0x20 && unit <= 0x7e) {
      out += text[i];
    } else {
      out += `\\u${unit.toString(16).padStart(4, "0")}`;
    }
  }
  return `${out}"`;
}

/**
 * Python `type(x).__name__` for the serializer's TypeError message
 * (message text only — out of contract per R5.4).
 *
 * @param value - The unserializable value.
 * @returns A best-effort Python-style type name.
 */
function typeNameOf(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }
  if (typeof value === "function") {
    return "function";
  }
  return typeof value;
}

/**
 * Serialize a value the way CPython `json.dumps(value)` does with all
 * defaults (see the module header for the exact contract).
 *
 * @param value - The value to serialize (decoded caller data).
 * @returns The CPython-spelled JSON text.
 * @throws TypeError - For values Python's encoder rejects
 *   (`Object of type X is not JSON serializable`).
 *
 * @example
 * ```typescript
 * pythonJsonDumps(["Purchase", "View"]);
 * // '["Purchase", "View"]'
 * pythonJsonDumps({ id: "12345" });
 * // '{"id": "12345"}'
 * pythonJsonDumps("𝒳");
 * // '"\\ud835\\udcb3"'
 * ```
 */
export function pythonJsonDumps(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (value === true) {
    return "true";
  }
  if (value === false) {
    return "false";
  }
  if (typeof value === "string") {
    return encodeStringAscii(value);
  }
  if (typeof value === "bigint") {
    return value.toString(10);
  }
  if (typeof value === "number") {
    if (Number.isNaN(value)) {
      return "NaN";
    }
    if (value === Number.POSITIVE_INFINITY) {
      return "Infinity";
    }
    if (value === Number.NEGATIVE_INFINITY) {
      return "-Infinity";
    }
    if (Number.isInteger(value)) {
      // A JS integral number is a Python int here (decoded vector kwargs
      // carry float-ness only via carriers, none of which reach C2 —
      // measured 2026-08-15: zero $type:float inputs across the 317).
      return String(value);
    }
    return pythonFloatStr(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => pythonJsonDumps(item)).join(", ")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const body = entries
      .map(
        ([key, member]) =>
          `${encodeStringAscii(key)}: ${pythonJsonDumps(member)}`,
      )
      .join(", ");
    return `{${body}}`;
  }
  throw new TypeError(
    `Object of type ${typeNameOf(value)} is not JSON serializable`,
  );
}
