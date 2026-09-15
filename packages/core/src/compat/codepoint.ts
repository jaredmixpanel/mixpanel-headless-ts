/**
 * Codepoint-based string primitives: Python `len`, `list(text)`, slicing
 * and `sorted()` operate on code points, while JS `.length`, `.slice` and
 * the default `Array.prototype.sort` operate on UTF-16 code units. A
 * UTF-16 `slice` can split a surrogate pair (producing a lone surrogate
 * the vector codec rejects), and unit-order sorting inverts e.g. `"｡"`
 * (U+FF61) against `"😀"` (U+1F600). Implemented once here.
 */

/**
 * Python `len(text)` — the number of Unicode code points.
 *
 * @param text - The string to measure.
 * @returns The code-point count (surrogate pairs count once).
 * @example
 * ```typescript
 * cpLength("𝒳"); // 1  ("𝒳".length is 2)
 * ```
 */
export function cpLength(text: string): number {
  let count = 0;
  // The string iterator steps by code point, never splitting surrogate pairs.
  const codePoints = text[Symbol.iterator]();
  while (!codePoints.next().done) {
    count += 1;
  }
  return count;
}

/**
 * Python `list(text)` — the string split into code points (surrogate
 * pairs stay whole). The deliberate spelling of the `[...text]` idiom:
 * the spread is correct for code points too, but reads as ambiguous
 * intent, so every code-point split goes through here.
 *
 * @param text - The string to split.
 * @returns One element per code point, in order.
 * @example
 * ```typescript
 * codepoints("a𝒳b"); // ["a", "𝒳", "b"]  ("a𝒳b".split("") would give 4)
 * ```
 */
export function codepoints(text: string): string[] {
  // eslint-disable-next-line @typescript-eslint/no-misused-spread -- this IS the code-point split (String's iterator yields code points); every other site routes here
  return [...text];
}

/**
 * Normalize one Python slice bound against a length.
 *
 * @param index - The raw bound (may be negative or out of range).
 * @param length - The string's code-point length.
 * @returns The clamped non-negative bound, per CPython slice semantics
 *   (negative bounds count from the end; out-of-range bounds clamp).
 * @throws {@link TypeError} - When `index` is not an integer (Python raises
 *   `TypeError` for non-int slice indices).
 */
function normalizeBound(index: number, length: number): number {
  if (!Number.isInteger(index)) {
    throw new TypeError(`slice indices must be integers, got ${String(index)}`);
  }
  if (index < 0) {
    return Math.max(0, length + index);
  }
  return Math.min(index, length);
}

/**
 * Python `text[start:end]` — codepoint-based slicing.
 *
 * Implements CPython's two-argument slice semantics exactly: `undefined`
 * bounds are open ends, negative bounds count from the end, out-of-range
 * bounds clamp, and `start >= end` yields `""`. Operating on code points
 * means a surrogate pair is never split — the invariant every `text[:N]`
 * truncation (`_error_message`, `_handle_response`, `max_length`
 * validators) relies on.
 *
 * @param text - The string to slice.
 * @param start - Inclusive start; omit (`undefined`) for Python `None`.
 * @param end - Exclusive end; omit (`undefined`) for Python `None`.
 * @returns The sliced string.
 * @throws {@link TypeError} - When a bound is a non-integer number.
 * @example
 * ```typescript
 * cpSlice("a𝒳b", 0, 2); // "a𝒳"  (UTF-16 slice would cut the pair)
 * cpSlice("hello", 0, -1); // "hell"
 * cpSlice("abc", 0, 500); // "abc"
 * ```
 */
export function cpSlice(text: string, start?: number, end?: number): string {
  const points = codepoints(text);
  const from = start === undefined ? 0 : normalizeBound(start, points.length);
  const to =
    end === undefined ? points.length : normalizeBound(end, points.length);
  if (from >= to) {
    return "";
  }
  return points.slice(from, to).join("");
}

/**
 * Compare two strings by code point, exactly like Python `str < str`.
 *
 * Exported alongside {@link sortedByCodepoint} because `sorted()` sites
 * with a non-string key (tuple keys, `len()` keys) need the comparator
 * itself, not the whole-list helper.
 *
 * @param a - Left operand.
 * @param b - Right operand.
 * @returns Negative when `a < b`, positive when `a > b`, `0` when equal.
 * @example
 * ```ts
 * compareCodepoints("｡", "😀"); // -1  (JS "｡" < "😀" is false)
 * [["b", 2], ["a", 1]].sort(([x], [y]) => compareCodepoints(x, y));
 * ```
 */
export function compareCodepoints(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const cpA = a.codePointAt(i) as number;
    const cpB = b.codePointAt(j) as number;
    if (cpA !== cpB) {
      return cpA < cpB ? -1 : 1;
    }
    i += cpA > 0xffff ? 2 : 1;
    j += cpB > 0xffff ? 2 : 1;
  }
  const remainingA = a.length - i;
  const remainingB = b.length - j;
  if (remainingA === remainingB) {
    return 0;
  }
  return remainingA < remainingB ? -1 : 1;
}

/**
 * JS default string order — UTF-16 code units, i.e. what `a < b` does.
 * The counterpart of {@link compareCodepoints} for the sort sites that
 * deliberately keep the engine's native order (`sortedKeys`, the
 * `compareRows` tie-break); they differ only where a surrogate pair
 * meets a BMP character above U+D7FF. Naming the comparator at those
 * sites keeps the choice visible instead of an implicit `.sort()`.
 *
 * @param a - Left operand.
 * @param b - Right operand.
 * @returns Negative when `a < b`, positive when `a > b`, `0` when equal.
 * @example
 * ```ts
 * ["😀", "｡"].sort(compareCodeUnits); // ["😀", "｡"] — the engine's native order
 * ```
 */
export function compareCodeUnits(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

/**
 * Python `sorted(values)` for strings — codepoint order.
 *
 * JS default `<`/`sort()` compare UTF-16 units, which inverts pairs like
 * `"｡"` (U+FF61) vs `"😀"` (U+1F600); Python compares code points. The
 * sort is stable (ES2019 guarantee) and returns a new array.
 *
 * @param values - The strings to sort; not mutated.
 * @returns A new array in Python `sorted()` order.
 * @example
 * ```typescript
 * sortedByCodepoint(["😀", "｡"]); // ["｡", "😀"]  (JS sort inverts this)
 * ```
 */
export function sortedByCodepoint(values: readonly string[]): string[] {
  return [...values].sort(compareCodepoints);
}
