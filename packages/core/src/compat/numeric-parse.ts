/**
 * Shared front half of the CPython `int(str)` / `float(str)` parse
 * pipeline; `python-int.ts` and `python-float.ts` are the only consumers.
 *
 * CPython's numeric constructors run
 * `_PyUnicode_TransformDecimalAndSpaceToASCII` before the ASCII-level
 * grammar: every Unicode decimal digit becomes its ASCII digit, every
 * non-ASCII whitespace codepoint becomes a space, any other non-ASCII
 * codepoint poisons the parse. ASCII codepoints pass through — which is
 * why `int("\x1c42")` rejects (U+001C survives the transform and the
 * C-level `Py_ISSPACE` does not strip it) while `int("\u008542")`
 * accepts (U+0085 is non-ASCII whitespace, mapped to a space). Both
 * digit and whitespace membership come from pinned, CPython-generated
 * tables (CPython 3.14.6 / Unicode 16.0.0) so decisions are independent
 * of the JS engine's Unicode database version (V8 tracks Unicode 17; see
 * the `python-str.ts` precedent).
 */
import { DECIMAL_DIGIT_RUNS } from "./decimal-digits.gen.js";
import { PYTHON_NUMERIC_WHITESPACE } from "./whitespace.gen.js";

/** Codepoint → digit value, expanded once from the pinned runs. */
const DIGIT_VALUES: ReadonlyMap<number, number> = (() => {
  const map = new Map<number, number>();
  for (const [startCp, startDigit, length] of DECIMAL_DIGIT_RUNS) {
    for (let i = 0; i < length; i += 1) {
      map.set(startCp + i, startDigit + i);
    }
  }
  return map;
})();

/**
 * Mirror `_PyUnicode_TransformDecimalAndSpaceToASCII` for one string.
 *
 * @param text - The raw input string.
 * @returns The ASCII-folded string, or `null` when a non-ASCII codepoint
 *   is neither a decimal digit nor whitespace (CPython's poisoned parse:
 *   the caller must reject the whole input as an invalid literal).
 * @example
 * ```ts
 * transformDecimalAndSpaceToAscii("٤٢"); // "42"
 * transformDecimalAndSpaceToAscii("\u008542"); // " 42"
 * transformDecimalAndSpaceToAscii("4é2"); // null
 * ```
 */
export function transformDecimalAndSpaceToAscii(text: string): string | null {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    const digit = DIGIT_VALUES.get(cp);
    if (digit !== undefined) {
      out += String.fromCharCode(0x30 + digit);
    } else if (cp < 0x80) {
      out += ch;
    } else if (PYTHON_NUMERIC_WHITESPACE.has(cp)) {
      out += " ";
    } else {
      return null;
    }
  }
  return out;
}

/**
 * The ASCII whitespace CPython's C-level numeric parse strips
 * (`Py_ISSPACE`): space, `\t`, `\n`, `\v`, `\f`, `\r` — and not
 * U+001C..U+001F, which `str.isspace()` reports true for.
 */
export const ASCII_NUMERIC_WHITESPACE = " \t\n\v\f\r";

/**
 * A digit group with underscores strictly between digits (PEP 515 as
 * enforced by CPython's parse: `"1_0"` yes; `"1__0"`, `"_1"`, `"1_"` no).
 */
export const DIGIT_GROUP = "[0-9](?:_?[0-9])*";
