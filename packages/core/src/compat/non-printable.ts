/**
 * CPython `str.isprintable()` classification, pinned to the port's target
 * CPython Unicode database rather than the JS engine's.
 *
 * The engine's database can lead CPython's: V8 (Unicode 17) treats
 * codepoints newly assigned in Unicode 17 (e.g. U+323B0, CJK Extension J)
 * as printable, while CPython 3.14 (Unicode 16) classifies them `Cn` and
 * escapes them in `repr()`. The differential fuzz surfaced that as a live
 * divergence, so `pythonRepr` consults this generated, CPython-derived
 * range table instead of `\p{Cn}`-style engine lookups.
 */

import { NON_PRINTABLE_RANGES } from "./non-printable.gen.js";

/**
 * Whether CPython `str.isprintable()` reports a codepoint as
 * non-printable (and `repr()` therefore escapes it).
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
