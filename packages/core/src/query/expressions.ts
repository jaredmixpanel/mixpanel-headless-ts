/**
 * Expression normalization utilities for Mixpanel filter expressions —
 * whole-file TS twin of
 * `src/mixpanel_headless/_internal/expressions.py` (52 LOC; Python
 * revision: `ts-port/phase2-contract-support` HEAD). Batch B3, shard K3
 * (`context/phase3/design/b3-packets.md` §"Packet K3").
 *
 * **Watchlist #2 — escaping is char-for-char contract.** The escape
 * order is backslash FIRST, then double quote (`expressions.py:51`);
 * reversing it double-escapes the backslash. Python `str.replace`
 * replaces ALL occurrences, so both passes use `replaceAll` — a
 * `String.prototype.replace` with a string pattern would rewrite only
 * the first hit and is a review finding. The rig compares the returned
 * string VERBATIM (`selector_str`-style codec; no canonicalizer
 * rescue).
 *
 * Python keeps this module `_internal`; the TS twin is likewise NOT
 * exported from the package barrel. Its only importer is
 * `services/live_query.py`'s segmentation family (B5-S2).
 *
 * @module query/expressions
 * @internal
 */

/**
 * Accessor patterns that indicate a full filter expression
 * (`expressions.py:12`).
 *
 * These are the three accessor types supported by Mixpanel's filter
 * expression syntax. `readonly [...]` mirrors the Python tuple (R4.8).
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
 *
 * @example
 * ```typescript
 * normalizeOnExpression("Source"); // 'properties["Source"]'
 * normalizeOnExpression('properties["Source"]'); // unchanged
 * normalizeOnExpression('my"property'); // 'properties["my\\"property"]'
 * ```
 */
export function normalizeOnExpression(on: string): string {
  // Python: `any(accessor in on for accessor in _FILTER_EXPR_ACCESSORS)`
  // — substring containment, not a prefix test.
  if (FILTER_EXPR_ACCESSORS.some((accessor) => on.includes(accessor))) {
    return on;
  }
  // Escape backslashes first, then double quotes, to produce valid
  // syntax. Order matters: escaping quotes first would double-escape
  // the backslash (`expressions.py:49-51`).
  const escaped = on.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `properties["${escaped}"]`;
}
