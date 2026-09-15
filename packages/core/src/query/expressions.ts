/**
 * Normalize segmentation property expressions for the live-query
 * segmentation family. Not exported from the package barrel.
 *
 * Escaping is a character-for-character contract: backslashes are
 * escaped before double quotes (the reverse order double-escapes the
 * backslash), and every occurrence is replaced, as Python's
 * `str.replace` does. The rig compares the returned string verbatim.
 *
 * @see mixpanel_headless._internal.expressions
 * @internal
 */

/**
 * Accessor prefixes that mark a string as a full filter expression —
 * the three accessor types of Mixpanel's filter-expression syntax.
 */
const FILTER_EXPR_ACCESSORS: readonly string[] = [
  'properties["',
  'user["',
  'event["',
];

/**
 * Wrap bare property names in `properties[]` accessor syntax.
 *
 * The Mixpanel segmentation API requires property references to use
 * filter expression syntax (e.g. `properties["Source"]`). Bare property
 * names are wrapped (escaping backslashes then double quotes);
 * expressions that already use accessor syntax pass through unchanged.
 *
 * @param on - The segmentation property expression: a bare property
 *   name (`"Source"`) or a full expression (`'properties["Source"]'`).
 * @returns The normalized expression. Bare names are wrapped in
 *   `properties["…"]` with `\` and `"` escaped; existing expressions
 *   are returned as-is.
 * @example
 * ```ts
 * normalizeOnExpression("Source"); // 'properties["Source"]'
 * normalizeOnExpression('properties["Source"]'); // unchanged
 * normalizeOnExpression('my"property'); // 'properties["my\\"property"]'
 * ```
 * @see mixpanel_headless._internal.expressions.normalize_on_expression
 */
export function normalizeOnExpression(on: string): string {
  // Python: `any(accessor in on for accessor in _FILTER_EXPR_ACCESSORS)`
  // — substring containment, not a prefix test.
  if (FILTER_EXPR_ACCESSORS.some((accessor) => on.includes(accessor))) {
    return on;
  }
  // Backslashes first, then double quotes: the other order would
  // double-escape the backslash.
  const escaped = on.replaceAll("\\", "\\\\").replaceAll('"', String.raw`\"`);
  return `properties["${escaped}"]`;
}
