/**
 * CPython `json.dumps(value)` twin with default arguments.
 *
 * The query/engage/export request builders embed `json.dumps(...)` output
 * inside query parameters and JSON-body string members (`event`,
 * `filter_by_cohort`, `output_properties`, `distinct_ids`, `behaviors`,
 * `segment_by_cohorts`, event/values lists). Those strings are diffed
 * byte-exactly against the recorded requests, so the CPython spelling is
 * the contract:
 *
 * - separators `(", ", ": ")` — a space after every comma and colon
 *   (`json.dumps(["a", "b"])` is `'["a", "b"]'`, not `'["a","b"]'`);
 * - `ensure_ascii=True` — every non-ASCII character escapes to
 *   `\uXXXX` UTF-16 units (lowercase hex; astral chars as surrogate
 *   pairs: `"𝒳"` → `'"𝒳"'`);
 * - `allow_nan=True` — non-finite floats spell `NaN` / `Infinity` /
 *   `-Infinity` (the JSON extension spellings, not Python repr's
 *   `nan`/`inf`);
 * - floats via CPython `repr` ({@link pythonFloatStr}), ints as bare
 *   digit runs.
 *
 * Scope: inputs are decoded vector kwargs / caller
 * data — plain objects, arrays, strings, numbers, bigints, booleans,
 * `null`. Python-only key coercions (`json.dumps({1: "x"})` →
 * `'{"1": "x"}'`) cannot arise because JS object keys are already
 * strings. Anything non-serializable raises the CPython `TypeError`
 * message shape.
 *
 * This module owns the encoder for both argument sets: the default-argument
 * {@link pythonJsonDumps} above and the `sort_keys=True`,
 * `separators=(",", ":")` canonical spelling in
 * `python-json-dumps-canonical.ts`. They differ only by a
 * {@link JsonDumpsStyle}; the recursion, the escape table, the number
 * spelling and the `TypeError` shape are shared so the two cannot drift.
 */

import { compareCodepoints } from "./codepoint.js";
import { pythonFloatStr } from "./python-float-str.js";

/** CPython short escapes for the control characters that have them. */
const SHORT_ESCAPES: ReadonlyMap<number, string> = new Map([
  [0x08, String.raw`\b`],
  [0x09, String.raw`\t`],
  [0x0a, String.raw`\n`],
  [0x0c, String.raw`\f`],
  [0x0d, String.raw`\r`],
  [0x22, String.raw`\"`],
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
      out += text.charAt(i);
    } else {
      out += String.raw`\u${unit.toString(16).padStart(4, "0")}`;
    }
  }
  return `${out}"`;
}

/**
 * Python `type(x).__name__` for the serializer's TypeError message
 * (message text only — not part of the contract).
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
 * The two `json.dumps` argument sets this module supports, reduced to the
 * three knobs that actually change the bytes.
 *
 * Consumed by `python-json-dumps-canonical.ts`; not part of the public
 * surface.
 *
 * @internal
 */
export interface JsonDumpsStyle {
  /** Text between array items / object members (`", "` or `","`). */
  readonly itemSeparator: string;
  /** Text between an object key and its value (`": "` or `":"`). */
  readonly keySeparator: string;
  /** CPython `sort_keys` — sort object keys by Unicode code point. */
  readonly sortKeys: boolean;
  /**
   * Throw for numbers with no stable cross-language identity: non-finite
   * values (no JSON spelling that round-trips) and magnitudes past
   * `Number.MAX_SAFE_INTEGER` (where a JS number no longer names one
   * integer, and `String()` flips to exponent form). Canonical form only —
   * the default-argument twin keeps CPython's `allow_nan=True` spellings.
   */
  readonly rejectUnsafeNumbers: boolean;
}

/** CPython `json.dumps(value)` with every argument left at its default. */
const DEFAULT_STYLE: JsonDumpsStyle = {
  itemSeparator: ", ",
  keySeparator: ": ",
  sortKeys: false,
  rejectUnsafeNumbers: false,
};

/**
 * The shared recursive encoder. Both public spellings route through this
 * one body so the escape table, the number rules and the `TypeError`
 * shape can never diverge between them.
 *
 * @param value - The value to serialize (decoded caller data).
 * @param style - Separator/ordering knobs; see {@link JsonDumpsStyle}.
 * @returns The CPython-spelled JSON text.
 * @throws {@link TypeError} - for values Python's encoder rejects.
 * @example
 * ```ts
 * dumpsStyled({ b: 1, a: 2 }, { itemSeparator: ",", keySeparator: ":", sortKeys: true, rejectUnsafeNumbers: true });
 * // '{"a":2,"b":1}'
 * ```
 * @internal
 */
export function dumpsStyled(value: unknown, style: JsonDumpsStyle): string {
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
    if (style.rejectUnsafeNumbers) {
      if (!Number.isFinite(value)) {
        // CPython's own `allow_nan=False` wording, plus the value.
        throw new TypeError(
          `Out of range float values are not JSON compliant: ${String(value)}`,
        );
      }
      if (Math.abs(value) > Number.MAX_SAFE_INTEGER) {
        throw new TypeError(
          `Number ${String(value)} exceeds Number.MAX_SAFE_INTEGER and has no ` +
            "exact canonical spelling; carry it as a bigint instead",
        );
      }
    }
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
    return `[${value
      .map((item) => dumpsStyled(item, style))
      .join(style.itemSeparator)}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (style.sortKeys) {
      // CPython `sorted(dct.items())` compares str by code point; JS
      // `.sort()` compares UTF-16 code units and inverts e.g. U+FF61 vs
      // U+1F600.
      entries.sort(([a], [b]) => compareCodepoints(a, b));
    }
    const body = entries
      .map(
        ([key, member]) =>
          `${encodeStringAscii(key)}${style.keySeparator}${dumpsStyled(member, style)}`,
      )
      .join(style.itemSeparator);
    return `{${body}}`;
  }
  throw new TypeError(
    `Object of type ${typeNameOf(value)} is not JSON serializable`,
  );
}

/**
 * Serialize a value the way CPython `json.dumps(value)` does with all
 * defaults (see the module header for the exact contract).
 *
 * @param value - The value to serialize (decoded caller data).
 * @returns The CPython-spelled JSON text.
 * @throws {@link TypeError} - For values Python's encoder rejects
 *   (`Object of type X is not JSON serializable`).
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
  return dumpsStyled(value, DEFAULT_STYLE);
}
