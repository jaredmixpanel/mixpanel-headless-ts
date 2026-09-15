/**
 * CPython `str.isprintable()` classification, pinned to the port's target
 * CPython Unicode database (rulebook R11.1; semantic-trap watchlist
 * item 8's "Cn follows the JS engine" caveat, closed).
 *
 * The TS-7 differential run surfaced the caveat as a live divergence:
 * V8's Unicode 17 database treats codepoints newly assigned in
 * Unicode 17 (e.g. U+323B0, CJK Extension J) as printable, while the
 * target CPython (3.14 / Unicode 16) classifies them `Cn` and escapes
 * them in `repr()`. `pythonRepr` therefore consults this generated,
 * CPython-derived range table instead of `\p{Cn}`-style engine lookups,
 * making escape decisions engine-independent.
 */

import { NON_PRINTABLE_RANGES } from "./non-printable.gen.js";

/**
 * Whether CPython `str.isprintable()` reports a codepoint as
 * NON-printable (and `repr()` therefore escapes it).
 *
 * Binary search over the generated inclusive range table (categories
 * Cc, Cf, Cs, Co, Cn, Zl, Zp, Zs per the pinned Unicode database, with
 * U+0020 SPACE printable per CPython's special case).
 *
 * @param codepoint - The Unicode codepoint (0 to 0x10FFFF; lone
 *   surrogates are valid inputs and classify as `Cs`, non-printable).
 * @returns `true` when CPython would escape the codepoint in `repr()`.
 * @example
 * ```typescript
 * isPythonNonPrintable(0x41); // false ("A")
 * isPythonNonPrintable(0x20); // false (space is printable)
 * isPythonNonPrintable(0xd800); // true (lone surrogate, Cs)
 * ```
 */
export function isPythonNonPrintable(codepoint: number): boolean {
  let low = 0;
  let high = NON_PRINTABLE_RANGES.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const range = NON_PRINTABLE_RANGES[mid] as readonly [number, number];
    if (codepoint < range[0]) {
      high = mid - 1;
    } else if (codepoint > range[1]) {
      low = mid + 1;
    } else {
      return true;
    }
  }
  return false;
}
