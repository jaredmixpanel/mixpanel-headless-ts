/**
 * JS default string order (UTF-16 code units) as a comparator — the
 * `Array#sort` argument for stable, locale-independent ordering of
 * identifiers and paths in the generator/audit scripts.
 *
 * @param {string} a - Left operand.
 * @param {string} b - Right operand.
 * @returns {number} Negative when `a < b`, positive when `a > b`, else 0.
 */
export function compareStrings(a, b) {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}
