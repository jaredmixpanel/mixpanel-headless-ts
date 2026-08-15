/**
 * Python `float(str)` parse grammar (rulebook R11.3). Part of the
 * `pythonCompat` module (rulebook §11): ported once, first; consumed by
 * `Retry-After` handling (B0-2) and R4.12 lax coercion. No other module
 * re-derives this grammar.
 *
 * The traps this closes: JS `Number()` accepts `""` (as 0), `"0x5"`, and
 * `"Infinity"` but rejects `"inf"`/`"nan"`; `parseFloat` accepts trailing
 * junk. CPython `float()` accepts `"inf"`/`"infinity"`/`"nan"`
 * case-insensitive with sign, dangling-dot forms (`"5."`/`".5"`),
 * underscores between digits, non-ASCII decimal digits, and a Unicode
 * whitespace surround — and silently overflows to ±Infinity (`"1e400"`),
 * never erroring on magnitude.
 */
import { MixpanelHeadlessError } from "../errors.js";
import {
  ASCII_NUMERIC_WHITESPACE,
  DIGIT_GROUP,
  transformDecimalAndSpaceToAscii,
} from "./numeric-parse.js";

/**
 * ASCII-level grammar after the Unicode fold. Mantissa alternatives per
 * the CPython probes (B0-notes): `DIGITS ['.' [DIGITS]]` or `'.' DIGITS`
 * — `"1."`, `".5"`, `"1.e1"` accept; `"."`, `".e1"` reject. Exponent
 * digits follow the same underscore rule.
 */
const FLOAT_GRAMMAR = new RegExp(
  `^[${ASCII_NUMERIC_WHITESPACE}]*[+-]?` +
    `(?:${DIGIT_GROUP}(?:\\.(?:${DIGIT_GROUP})?)?|\\.${DIGIT_GROUP})` +
    `(?:[eE][+-]?${DIGIT_GROUP})?` +
    `[${ASCII_NUMERIC_WHITESPACE}]*$`,
);

/** The special-value grammar: sign + inf/infinity/nan, case-insensitive. */
const SPECIAL_GRAMMAR = new RegExp(
  `^[${ASCII_NUMERIC_WHITESPACE}]*([+-]?)(inf(?:inity)?|nan)[${ASCII_NUMERIC_WHITESPACE}]*$`,
  "i",
);

/**
 * Parse a string exactly as CPython `float(str)` does (rulebook R11.3).
 *
 * @param text - The string to parse.
 * @returns The parsed double — including `Infinity`/`-Infinity`/`NaN`
 *   for the special spellings and for overflowing finite literals
 *   (`"1e400"` -> `Infinity`, exactly like CPython). Negative zero is
 *   preserved (`"-0.0"` -> `-0`).
 * @throws MixpanelHeadlessError - Code `PY_FLOAT_INVALID_LITERAL` when
 *   the input is not a valid CPython float literal.
 * @throws TypeError - When `text` is not a string.
 *
 * @example
 * ```typescript
 * pythonFloat("1_0.5"); // 10.5
 * pythonFloat("-iNf"); // -Infinity
 * pythonFloat("5."); // 5
 * pythonFloat(""); // throws PY_FLOAT_INVALID_LITERAL
 * ```
 */
export function pythonFloat(text: string): number {
  if (typeof text !== "string") {
    throw new TypeError(`pythonFloat expects a string, got ${typeof text}`);
  }
  const folded = transformDecimalAndSpaceToAscii(text);
  if (folded !== null) {
    const special = SPECIAL_GRAMMAR.exec(folded);
    if (special !== null) {
      const sign = special[1] === "-" ? -1 : 1;
      if ((special[2] as string).toLowerCase() === "nan") {
        return NaN;
      }
      return sign * Infinity;
    }
    if (FLOAT_GRAMMAR.test(folded)) {
      // Grammar-validated: ECMAScript Number() is IEEE-754
      // correctly-rounded over this sublanguage, same as CPython's
      // string-to-double. Underscores are grammar-only — strip them.
      return Number(folded.replaceAll("_", "").trim());
    }
  }
  throw new MixpanelHeadlessError(
    `could not convert string to float: ${JSON.stringify(text)}`,
    "PY_FLOAT_INVALID_LITERAL",
  );
}
