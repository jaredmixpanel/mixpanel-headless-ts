/**
 * Engage (`query_user`) builder helpers — whole-file TS twin of
 * `src/mixpanel_headless/_internal/query/user_builders.py` (322 LOC;
 * Python revision: `ts-port/phase2-contract-support` HEAD).
 *
 * The file is owned by two batches (R10.8). B2 shard V2
 * (`user_validators.py`) needed exactly ONE symbol —
 * the `_is_cohort_filter` shape predicate (`user_builders.py:69-85`) —
 * so V2 landed {@link isCohortFilter} here under its permanent home.
 * **B3-K4 grew the file with the builders half**
 * (`b3-packets.md` §"Packet K4"): {@link formatValue}, {@link propRef},
 * {@link filterToSelector}, {@link filtersToSelector} and
 * {@link extractCohortFilter}, all importing (never re-declaring) the
 * B2 symbols.
 *
 * Converts `Filter` objects into engage-API selector STRINGS such as
 * `properties["plan"] == "premium"` — the third translation path
 * alongside `bookmark_builders.build_filter_entry()` (bookmark dicts)
 * and `segfilter.build_segfilter_entry()` (flows segfilter entries).
 *
 * **Contract notes a reader must not "clean up":**
 *
 * - **Watchlist #2 — escaping is char-for-char contract, and this is
 *   the highest-risk translation in the port.** Both escaping sites
 *   (`user_builders.py:40` value, `:65` property name) escape
 *   backslashes FIRST and double quotes SECOND, replacing ALL
 *   occurrences. Python's `str.replace` is replace-all; JS
 *   `String.prototype.replace` with a string pattern rewrites only the
 *   FIRST hit, so `replaceAll` is mandatory at every site. Reversing
 *   the two passes would double-escape backslashes. The rig's
 *   `selector_str` codec compares the returned string VERBATIM — there
 *   is no canonicalizer rescue here (contrast R10.11, which covers the
 *   segfilter number-operand positions ONLY).
 * - **`str(value)` renderings** go through `pythonStrValue`
 *   (R11.7/R10.8): `String(true)` is `"true"` but Python's `str(True)`
 *   is `"True"` (watchlist #8), and an integral float preserved by the
 *   rig as a PyFloat carrier must render `18.0`, not `18`.
 * - **Booleans are ints in Python** (b3-packets Caution #11): every
 *   `isinstance(v, (str, int, float))` / `isinstance(v, (int, float))`
 *   guard in this module ACCEPTS `True`/`False` and renders them
 *   `"True"`/`"False"`. In-annotation per ratified Discrepancy #8
 *   (`bool <: int`). Contrast the B2 validators, where bool must be
 *   rejected before int — the direction flips per site.
 * - **Guard order is contract** (`:116-118`): the property reference is
 *   built (and ES1 raised) BEFORE any operator dispatch, so a
 *   non-string property with an unsupported operator yields ES1, never
 *   ES13.
 * - **Laziness is contract** (`:275`): Python's generator expression
 *   means `filters_to_selector` aborts at the FIRST failing element and
 *   never evaluates later ones. Ported as an explicit loop.
 * - **Logging is out of contract** (Caution #15): the `logger.warning`
 *   calls at `:132`, `:161` and `:315` have no ported twin; the VALUE
 *   behavior around them (non-scalars dropped, extra cohorts moved to
 *   `remaining`) IS ported.
 *
 * Python keeps this module `_internal`; the TS twin is likewise NOT
 * exported from the package barrel. Its importers are `workspace.py:89-90`
 * (`extract_cohort_filter`/`filters_to_selector` → `query_user`, B5-S2)
 * and `user_validators.py` (B2, `_is_cohort_filter` only).
 *
 * @module user-builders
 * @internal
 */

import {
  pythonFloatStr,
  pythonRepr,
  type PythonValue,
} from "../compat/index.js";
import { isPythonDict } from "../compat/python-dict.js";
import { ParamValidationError } from "../errors.js";
import type { Filter } from "../types/index.js";
import {
  floatCarrierValue,
  isFloatCarrier,
  pythonStrValue,
  pythonTypeName,
} from "./validation-shared.js";

// R10.8 / B2 arbiter fix F1 (b2-review-resolution.md, 2026-08-15): the
// `isinstance(x, dict)` discrimination now has exactly ONE
// implementation, in `validation-shared.ts` (semantics unchanged for
// this file's consumers: plain object — prototype `Object.prototype`
// or `null`). Re-exported here so `user-validators.ts` and the B3-K4
// grower keep their established import site.

/**
 * Python `isinstance(value, (str, int, float))` for the equals /
 * not-equals element filters (`user_builders.py:129,157`).
 *
 * Accepts strings, numbers, BOOLEANS (Python `bool` subclasses `int`)
 * and the rig's PyFloat carrier (a Python `float`). Everything else —
 * `None`, lists, dicts, reconstructed core instances — is a non-scalar
 * and gets dropped from the emitted terms.
 *
 * @param value - A candidate element of the filter's value list.
 * @returns True when Python would keep the element.
 */
function isSelectorScalar(value: unknown): boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    isFloatCarrier(value)
  );
}

/**
 * Python `isinstance(value, (int, float))` for the numeric guards
 * (`user_builders.py:193,201,215,220`).
 *
 * Accepts numbers, BOOLEANS (`bool <: int`) and the PyFloat carrier;
 * rejects strings, `None`, lists and dicts.
 *
 * @param value - A candidate operand.
 * @returns True when Python would classify the value as `int | float`.
 */
function isSelectorNumber(value: unknown): boolean {
  return (
    typeof value === "number" ||
    typeof value === "boolean" ||
    isFloatCarrier(value)
  );
}

/**
 * Python `repr(value)` for the ES3 / ES5 message text
 * (`user_builders.py:141,169` — `{value!r}`).
 *
 * Message text is out of contract (R5.4), but the CODE that carries it
 * is not: this renderer must therefore never throw, or an ES3/ES5 guard
 * would surface as a `TypeError` instead. `pythonRepr` rejects values
 * outside its domain (class instances, the PyFloat carrier), so
 * carriers, lists and dicts are walked here and anything still
 * unrenderable degrades to a type-name placeholder.
 *
 * @param value - The value to render (only non-scalar-bearing lists
 *   reach the two call sites).
 * @returns A CPython-`repr`-shaped, never-throwing rendering.
 */
function selectorRepr(value: unknown): string {
  if (isFloatCarrier(value)) {
    // CPython's `repr(float)` and `str(float)` are the same function.
    return pythonFloatStr(floatCarrierValue(value));
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => selectorRepr(item)).join(", ")}]`;
  }
  if (isPythonDict(value)) {
    const entries = Object.entries(value).map(
      ([key, item]) => `${pythonRepr(key)}: ${selectorRepr(item)}`,
    );
    return `{${entries.join(", ")}}`;
  }
  try {
    return pythonRepr(value as PythonValue);
  } catch {
    return `<${pythonTypeName(value)}>`;
  }
}

/**
 * Format a scalar value for use in a selector expression — port of
 * `_format_value` (`user_builders.py:27-42`).
 *
 * Strings are wrapped in double quotes with internal backslashes and
 * quotes escaped (backslash pass FIRST, `replaceAll` at both passes —
 * watchlist #2). Everything else renders through Python `str()`
 * semantics: `str(2.0)` is `"2.0"`, `str(True)` is `"True"`,
 * `str(1e16)` is `"1e+16"` (R11.1/R11.2). The result is embedded in the
 * selector VERBATIM, so no `String(...)` may appear here.
 *
 * Module-private in Python; exported for intra-package use and the
 * Layer-3 twin of `TestPbtFormatValueSpecialChars` (which calls
 * `_format_value` directly). Not in the package barrel.
 *
 * @param value - The scalar value to format.
 * @returns Formatted string suitable for embedding in a selector.
 * @throws TypeError - When the value is outside the `pythonStr` domain
 *   (out-of-annotation input only).
 * @example
 * ```typescript
 * formatValue('say "hi"'); // '"say \\"hi\\""'
 * formatValue(18); // "18"
 * ```
 * @internal
 */
export function formatValue(value: unknown): string {
  if (typeof value === "string") {
    const escaped = value
      .replaceAll("\\", "\\\\")
      .replaceAll('"', String.raw`\"`);
    return `"${escaped}"`;
  }
  return pythonStrValue(value);
}

/**
 * Build the `properties["name"]` reference for a Filter — port of
 * `_prop_ref` (`user_builders.py:45-66`).
 *
 * The property name is escaped exactly like a value (backslash first,
 * then quote, all occurrences).
 *
 * Module-private in Python; exported for intra-package use only.
 *
 * @param f - Filter whose property name to reference.
 * @returns String of the form `properties["<name>"]`.
 * @throws ParamValidationError - `ES1_PROPERTY_NOT_STRING` when the
 *   filter's property is not a plain string (a `CustomPropertyRef` /
 *   `InlineCustomProperty` reaches this branch — custom properties are
 *   unsupported in `query_user()` filters).
 * @internal
 */
export function propRef(f: Filter): string {
  const property: unknown = f._property;
  if (typeof property !== "string") {
    throw new ParamValidationError(
      `Engage selector requires a string property name, ` +
        `got ${pythonTypeName(property)}. Custom properties ` +
        `are not supported in query_user() filters.`,
      "ES1_PROPERTY_NOT_STRING",
    );
  }
  const escaped = property
    .replaceAll("\\", "\\\\")
    .replaceAll('"', String.raw`\"`);
  return `properties["${escaped}"]`;
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

/**
 * Convert a single Filter to an engage-API selector string — port of
 * `filter_to_selector` (`user_builders.py:88-242`).
 *
 * Translates the Filter's internal operator to the equivalent engage
 * selector syntax. Each operator maps to a specific selector pattern;
 * the dispatch order, the emitted spacing and the parenthesization are
 * all byte-level contract.
 *
 * @param f - A Filter (constructed via a factory such as
 *   `Filter.equals()` / `Filter.greaterThan()`).
 * @returns Selector string for the engage API `where` parameter.
 * @throws ParamValidationError - `ES1_PROPERTY_NOT_STRING` when the
 *   property is not a string; `ES2`–`ES12` when the value has the wrong
 *   shape for the operator; `ES13_UNSUPPORTED_OPERATOR` for any
 *   operator this translation does not handle.
 * @example
 * ```typescript
 * filterToSelector(Filter.equals("plan", "premium"));
 * // 'properties["plan"] == "premium"'
 * ```
 */
export function filterToSelector(f: Filter): string {
  const op: string = f._operator;
  // `_prop_ref` runs BEFORE the operator dispatch (`:117`) — ES1 wins
  // over every other code for a non-string property.
  const prop = propRef(f);
  const value: unknown = f._value;

  if (op === "equals") {
    if (!Array.isArray(value)) {
      throw new ParamValidationError(
        `Expected list for 'equals' operator, got ${pythonTypeName(value)}`,
        "ES2_EQUALS_EXPECTS_LIST",
      );
    }
    // Python also materializes a `dropped` list, but ONLY to feed
    // `logger.warning` (`:131-137`) — logging is out of contract
    // (Caution #15), so the TS twin keeps just the value behavior.
    const parts: string[] = [];
    for (const v of value) {
      if (isSelectorScalar(v)) {
        parts.push(`${prop} == ${formatValue(v)}`);
      }
    }
    if (parts.length === 0) {
      throw new ParamValidationError(
        `Filter.equals() produced no valid selector terms. ` +
          `All values were non-scalar: ${selectorRepr(value)}`,
        "ES3_EQUALS_NO_TERMS",
      );
    }
    if (parts.length > 1) {
      return `(${parts.join(" or ")})`;
    }
    return parts[0] as string;
  }

  if (op === "does not equal") {
    if (!Array.isArray(value)) {
      throw new ParamValidationError(
        `Expected list for 'does not equal' operator, got ${pythonTypeName(value)}`,
        "ES4_NOT_EQUALS_EXPECTS_LIST",
      );
    }
    const parts: string[] = [];
    for (const v of value) {
      if (isSelectorScalar(v)) {
        parts.push(`${prop} != ${formatValue(v)}`);
      }
    }
    if (parts.length === 0) {
      throw new ParamValidationError(
        `Filter.not_equals() produced no valid selector terms. ` +
          `All values were non-scalar: ${selectorRepr(value)}`,
        "ES5_NOT_EQUALS_NO_TERMS",
      );
    }
    // AND-combine: "!= a AND != b" means "not in [a, b]"
    // (contrast: equals uses OR — "== a OR == b" means "in [a, b]").
    // No parentheses here — the asymmetry is deliberate (`:172-174`).
    return parts.join(" and ");
  }

  if (op === "contains") {
    if (typeof value !== "string") {
      throw new ParamValidationError(
        `Expected str for 'contains' operator, got ${pythonTypeName(value)}`,
        "ES6_CONTAINS_EXPECTS_STR",
      );
    }
    // Value FIRST, then the property (`:182`).
    return `${formatValue(value)} in ${prop}`;
  }

  if (op === "does not contain") {
    if (typeof value !== "string") {
      throw new ParamValidationError(
        `Expected str for 'does not contain' operator, got ${pythonTypeName(value)}`,
        "ES7_NOT_CONTAINS_EXPECTS_STR",
      );
    }
    return `not ${formatValue(value)} in ${prop}`;
  }

  if (op === "is greater than") {
    if (!isSelectorNumber(value)) {
      throw new ParamValidationError(
        `Expected int or float for 'is greater than' operator, got ${pythonTypeName(value)}`,
        "ES8_GT_EXPECTS_NUMBER",
      );
    }
    return `${prop} > ${formatValue(value)}`;
  }

  if (op === "is less than") {
    if (!isSelectorNumber(value)) {
      throw new ParamValidationError(
        `Expected int or float for 'is less than' operator, got ${pythonTypeName(value)}`,
        "ES9_LT_EXPECTS_NUMBER",
      );
    }
    return `${prop} < ${formatValue(value)}`;
  }

  if (op === "is between") {
    if (!Array.isArray(value) || value.length !== 2) {
      throw new ParamValidationError(
        `Expected list of length 2 for 'is between' operator, got ${pythonTypeName(value)}`,
        "ES10_BETWEEN_EXPECTS_PAIR",
      );
    }
    // Indexed access, not destructuring — the arity is already checked
    // above and watchlist #1 forbids silent `undefined` binding.
    const lo: unknown = value[0];
    const hi: unknown = value[1];
    if (!isSelectorNumber(lo)) {
      throw new ParamValidationError(
        `Expected int or float for lower bound, got ${pythonTypeName(lo)}`,
        "ES11_BETWEEN_LOWER_NOT_NUMBER",
      );
    }
    if (!isSelectorNumber(hi)) {
      throw new ParamValidationError(
        `Expected int or float for upper bound, got ${pythonTypeName(hi)}`,
        "ES12_BETWEEN_UPPER_NOT_NUMBER",
      );
    }
    return `${prop} >= ${formatValue(lo)} and ${prop} <= ${formatValue(hi)}`;
  }

  if (op === "is set") {
    return `defined(${prop})`;
  }

  if (op === "is not set") {
    return `not defined(${prop})`;
  }

  // Selector-language keywords — LOWERCASE, and unrelated to Python's
  // `str(True)` capitalization (`:233-237`).
  if (op === "true") {
    return `${prop} == true`;
  }

  if (op === "false") {
    return `${prop} == false`;
  }

  throw new ParamValidationError(
    `Unsupported filter operator: ${pythonRepr(op)}`,
    "ES13_UNSUPPORTED_OPERATOR",
  );
}

/**
 * Convert multiple Filters to an AND-combined selector string — port of
 * `filters_to_selector` (`user_builders.py:245-275`).
 *
 * Each Filter is translated individually via {@link filterToSelector},
 * then joined with `" and "`.
 *
 * @param filters - Filters to AND-combine.
 * @returns AND-combined selector string; the EMPTY STRING (never
 *   `null`) for an empty list.
 * @throws ParamValidationError - Propagated from
 *   {@link filterToSelector} for the FIRST invalid Filter in list order
 *   (`ES1`–`ES13`).
 * @example
 * ```typescript
 * filtersToSelector([Filter.equals("plan", "premium"), Filter.isSet("email")]);
 * // 'properties["plan"] == "premium" and defined(properties["email"])'
 * ```
 */
export function filtersToSelector(filters: readonly Filter[]): string {
  // Watchlist #6: Python's `if not filters` on a list is an emptiness
  // test, never a truthiness test on the container object.
  if (filters.length === 0) {
    return "";
  }
  // Python joins a GENERATOR (`:275`), so evaluation stops at the first
  // raise and later elements are never translated. A `.map().join()`
  // would translate every element before joining and could surface a
  // LATER element's error first — the loop preserves error order.
  const parts: string[] = Array.from(filters, (f) => filterToSelector(f));
  return parts.join(" and ");
}

/**
 * Extract a cohort filter from a list of Filters — port of
 * `extract_cohort_filter` (`user_builders.py:278-322`).
 *
 * Separates `Filter.inCohort()` entries from regular property filters.
 * At most one cohort filter is expected (validated by U13); the FIRST
 * one wins and any extras stay in `remaining` as a defensive measure
 * (Python logs a warning there — out of contract; the placement of the
 * extras is not).
 *
 * The SAME Filter instances flow through to the outputs (identity is
 * locked by `test_cohort_filter_identity_preserved`), and the input
 * array is never mutated.
 *
 * @param filters - Filters, possibly containing a cohort filter.
 * @returns A 2-tuple `[remaining, cohortOrNull]` — Python's
 *   `tuple[list[Filter], Filter | None]`.
 * @example
 * ```typescript
 * const [remaining, cohort] = extractCohortFilter([
 *   Filter.equals("plan", "premium"),
 *   Filter.inCohort(123),
 * ]);
 * ```
 */
export function extractCohortFilter(
  filters: readonly Filter[],
): [Filter[], Filter | null] {
  const remaining: Filter[] = [];
  let cohort: Filter | null = null;
  for (const f of filters) {
    if (isCohortFilter(f)) {
      if (cohort === null) {
        cohort = f;
      } else {
        // U13 guarantees at most one cohort filter; extra cohorts stay
        // in `remaining` as a defensive measure (`:313-319`).
        remaining.push(f);
      }
    } else {
      remaining.push(f);
    }
  }
  return [remaining, cohort];
}

export { isPythonDict } from "../compat/python-dict.js";
