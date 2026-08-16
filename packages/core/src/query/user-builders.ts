/**
 * Engage (`query_user`) builder helpers.
 *
 * Source: `src/mixpanel_headless/_internal/query/user_builders.py`
 * (Python revision: `ts-port/phase2-contract-support` HEAD, 322 LOC).
 *
 * **This file is deliberately a stub owned by two batches (R10.8).**
 * B2 shard V2 (`user_validators.py`) needs exactly ONE symbol from
 * `user_builders.py` — the `_is_cohort_filter` shape predicate
 * (`user_builders.py:69-85`) — so V2 lands that single function here
 * under its permanent home. **B3-K4 grows this file**
 * (`filter_to_selector`, `_engage_selector`, the rest of the module)
 * and MUST import {@link isCohortFilter} rather than re-declaring it:
 * single implementation by name (b2-packets.md §V2 "Cross-batch
 * dependency (R10.8 decision)").
 *
 * @module user-builders
 * @internal
 */

import type { Filter } from "../types/index.js";

// R10.8 / B2 arbiter fix F1 (b2-review-resolution.md, 2026-08-15): the
// `isinstance(x, dict)` discrimination now has exactly ONE
// implementation, in `validation-shared.ts` (semantics unchanged for
// this file's consumers: plain object — prototype `Object.prototype`
// or `null`). Re-exported here so `user-validators.ts` and the B3-K4
// grower keep their established import site.
import { isPythonDict } from "./validation-shared.js";

export { isPythonDict };

/**
 * Return true if *f* is a cohort filter (`in_cohort` / `not_in_cohort`).
 *
 * Port of `_is_cohort_filter` (`user_builders.py:69-85`). Cohort
 * filters store their value as a list of dicts (from
 * `CohortDefinition.to_dict()`), unlike regular filters which use
 * `str`, number, list-of-str, or `None`. This shape heuristic is safe
 * because `Filter` only produces list-of-dict values for
 * `in_cohort()` / `not_in_cohort()`.
 *
 * Watchlist #6 (empty-collection truthiness): Python's guard is
 * `isinstance(val, list) and len(val) > 0 and isinstance(val[0], dict)`
 * — an EXPLICIT length test, ported as `.length > 0`, never `if (val)`.
 *
 * @param f - Filter to test.
 * @returns True when the filter's `_value` is a non-empty list of dicts.
 *
 * @example
 * ```typescript
 * isCohortFilter(Filter.inCohort(123)); // true
 * isCohortFilter(Filter.equals("plan", "pro")); // false
 * ```
 */
export function isCohortFilter(f: Filter): boolean {
  const val: unknown = f._value;
  return Array.isArray(val) && val.length > 0 && isPythonDict(val[0]);
}
