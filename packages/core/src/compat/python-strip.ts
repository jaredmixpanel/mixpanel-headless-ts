/**
 * Python `str.strip()` semantics (rulebook R11.3 enabling dependency).
 * Part of the `pythonCompat` module (rulebook §11): ported once, first;
 * no other module re-derives these semantics.
 *
 * The trap this closes: the CPython whitespace table is NOT the JS
 * `String.prototype.trim()` table — Python strips the U+001C..U+001F
 * file/group/record/unit separators (JS keeps them) and keeps U+FEFF
 * (JS trims it). Membership comes from the pinned, CPython-generated
 * table (`whitespace.gen.ts` — CPython 3.14.6 / Unicode 16.0.0), keeping
 * decisions independent of the JS engine's Unicode database version
 * (V8 tracks Unicode 17; see the `python-str.ts` precedent).
 */
import { codepoints } from "./codepoint.js";
import { PYTHON_STR_WHITESPACE } from "./whitespace.gen.js";

/**
 * Strip leading and trailing Python whitespace, exactly like
 * `text.strip()` with no arguments.
 *
 * @param text - The string to strip.
 * @returns The substring with every leading/trailing codepoint in the
 *   pinned `str.isspace()` table removed. Never splits a surrogate pair
 *   (whitespace is BMP-only, and scanning is codepoint-based).
 * @example
 * ```typescript
 * pythonStrip("\u001chi\u001f"); // "hi"  (JS trim() keeps U+001C/U+001F)
 * pythonStrip("\ufeffhi"); // "\ufeffhi"  (JS trim() would strip the BOM)
 * ```
 */
export function pythonStrip(text: string): string {
  const points = codepoints(text);
  let start = 0;
  let end = points.length;
  while (
    start < end &&
    PYTHON_STR_WHITESPACE.has(
      (points[start] as string).codePointAt(0) as number,
    )
  ) {
    start += 1;
  }
  while (
    end > start &&
    PYTHON_STR_WHITESPACE.has(
      (points[end - 1] as string).codePointAt(0) as number,
    )
  ) {
    end -= 1;
  }
  return points.slice(start, end).join("");
}
