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

/**
 * Test whether a value is a Python `dict` in the ported value domain.
 *
 * Python `isinstance(x, dict)` is true only for mappings; class
 * instances (`Filter`, `JsonNumber`, …) and lists are NOT dicts. The
 * TS analog is "plain object": prototype is `Object.prototype` or
 * `null` (the `Object.create(null)` shape a decoder can produce).
 *
 * This is a language primitive, not a port of a named Python function —
 * it lives here (rather than being duplicated) because both
 * `_is_cohort_filter` below and `user_validators.validate_user_params`
 * spell `isinstance(..., dict)`.
 *
 * @param value - Candidate value.
 * @returns True when Python would classify the value as a `dict`.
 */
export function isPythonDict(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

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
