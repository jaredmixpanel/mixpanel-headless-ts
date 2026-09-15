/**
 * Python `str.zfill` semantics (rulebook R11.4; semantic-trap watchlist
 * item 9). Part of the `pythonCompat` module (rulebook §11): ported once,
 * first; no other module re-derives these semantics.
 */

/**
 * Zero-fill a string to `width` codepoints with Python `str.zfill` semantics.
 *
 * Differences from a naive `String.prototype.padStart(width, "0")`:
 *
 * - A leading `"+"` or `"-"` stays at the front and the zeros are inserted
 *   AFTER it: `zfill("-1", 3)` is `"-01"`, never `"00-1"`.
 * - Length is counted in Unicode CODEPOINTS, matching Python `len`, not in
 *   UTF-16 units: `zfill("😀", 3)` is `"00😀"` (two zeros — Python
 *   `len("😀")` is 1, while JS `"😀".length` is 2).
 * - Only the FIRST character is treated as a sign: `zfill("--1", 5)` is
 *   `"-00-1"`.
 *
 * @param value - The string to pad; any codepoints, sign optional.
 * @param width - Target width in codepoints. When `width` is less than or
 *   equal to the codepoint length of `value`, the input is returned
 *   unchanged (zero and negative widths are therefore no-ops).
 * @returns `value` left-padded with `"0"` to `width` codepoints, with any
 *   leading sign preserved in front of the padding.
 * @throws TypeError - When `width` is not an integer (CPython raises
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
  const codepoints = [...value];
  if (codepoints.length >= width) {
    return value;
  }
  const padding = "0".repeat(width - codepoints.length);
  const first = codepoints[0];
  if (first === "+" || first === "-") {
    return first + padding + value.slice(first.length);
  }
  return padding + value;
}
