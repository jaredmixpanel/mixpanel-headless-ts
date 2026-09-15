/**
 * Codepoint-based string primitives (rulebook R11.5 / R11.6). Part of the
 * `pythonCompat` module (rulebook §11): ported once, first; no other
 * module re-derives these semantics.
 *
 * The traps these close (semantic-trap watchlist item 9): JS `.length`,
 * `.slice`, and default `Array.prototype.sort` all operate on UTF-16 code
 * UNITS, while Python `len`, slicing, and `sorted()` operate on code
 * POINTS. A UTF-16 `slice` can split a surrogate pair (producing a lone
 * surrogate the vector codec rejects), and unit-order sorting inverts
 * e.g. `"｡"` (U+FF61) vs `"😀"` (U+1F600).
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
  // for..of iterates by code point, never splitting surrogate pairs.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for (const _ch of text) {
    count += 1;
  }
  return count;
}

/**
 * Normalize one Python slice bound against a length.
 *
 * @param index - The raw bound (may be negative or out of range).
 * @param length - The string's code-point length.
 * @returns The clamped non-negative bound, per CPython slice semantics
 *   (negative bounds count from the end; out-of-range bounds clamp).
 * @throws TypeError - When `index` is not an integer (Python raises
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
 * Python `text[start:end]` — codepoint-based slicing (rulebook R11.6).
 *
 * Implements CPython's two-argument slice semantics exactly: `undefined`
 * bounds are open ends, negative bounds count from the end, out-of-range
 * bounds clamp, and `start >= end` yields `""`. Operating on code points
 * means a surrogate pair is never split — the invariant every `text[:N]`
 * truncation (`_error_message`, `_handle_response`, `max_length`
 * validators) relies on.
 *
 * @param text - The string to slice.
 * @param start - Inclusive start (Python `None` -> omit / `undefined`).
 * @param end - Exclusive end (Python `None` -> omit / `undefined`).
 * @returns The sliced string.
 * @throws TypeError - When a bound is a non-integer number.
 * @example
 * ```typescript
 * cpSlice("a𝒳b", 0, 2); // "a𝒳"  (UTF-16 slice would cut the pair)
 * cpSlice("hello", 0, -1); // "hell"
 * cpSlice("abc", 0, 500); // "abc"
 * ```
 */
export function cpSlice(text: string, start?: number, end?: number): string {
  const points = Array.from(text);
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
 * @param a - Left operand.
 * @param b - Right operand.
 * @returns Negative when `a < b`, positive when `a > b`, `0` when equal.
 *
 * Exported since B5-S1: `sorted(items, key=...)` sites with a non-string
 * key (tuple keys, `len()` keys) need the comparator itself, not the
 * whole-list helper — and R10.8 forbids re-deriving it locally.
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
 * Python `sorted(values)` for strings — codepoint order (rulebook R11.5).
 *
 * JS default `<`/`sort()` compare UTF-16 units, which inverts pairs like
 * `"｡"` (U+FF61) vs `"😀"` (U+1F600); Python compares code points. The
 * sort is stable (ES2019 guarantee) and returns a NEW array.
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
