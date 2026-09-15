/**
 * Python `str.zfill` semantics, implemented once here.
 */

import { codepoints } from "./codepoint.js";

/**
 * Zero-fill a string to `width` codepoints with Python `str.zfill` semantics.
 *
 * Differences from a naive `String.prototype.padStart(width, "0")`:
 *
 * - A leading `"+"` or `"-"` stays at the front and the zeros are inserted
 *   after it: `zfill("-1", 3)` is `"-01"`, never `"00-1"`.
 * - Length is counted in Unicode codepoints, matching Python `len`, not in
 *   UTF-16 units: `zfill("😀", 3)` is `"00😀"` (two zeros — Python
 *   `len("😀")` is 1, while JS `"😀".length` is 2).
 * - Only the first character is treated as a sign: `zfill("--1", 5)` is
 *   `"-00-1"`.
 *
 * @param value - The string to pad; any codepoints, sign optional.
 * @param width - Target width in codepoints. When `width` is less than or
 *   equal to the codepoint length of `value`, the input is returned
 *   unchanged (zero and negative widths are therefore no-ops).
 * @returns `value` left-padded with `"0"` to `width` codepoints, with any
 *   leading sign preserved in front of the padding.
 * @throws {@link TypeError} - When `width` is not an integer (CPython raises
 *   `TypeError` for non-`int` widths).
 * @example
 * ```typescript
 * zfill("-1", 3); // "-01"
 * zfill("5", 3); // "005"
 * zfill("+7", 3); // "+07"
 * zfill("", 2); // "00"
 * ```
 */
export function zfill(value: string, width: number): string {
  if (!Number.isInteger(width)) {
    throw new TypeError(`zfill width must be an integer, got ${String(width)}`);
  }
  const points = codepoints(value);
  if (points.length >= width) {
    return value;
  }
  const padding = "0".repeat(width - points.length);
  const first = points[0];
  if (first === "+" || first === "-") {
    return first + padding + value.slice(first.length);
  }
  return padding + value;
}
