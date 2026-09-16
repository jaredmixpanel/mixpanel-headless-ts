/**
 * Translate `Filter` objects into engage-API selector strings such as
 * `properties["plan"] == "premium"` for `query_user` — the third
 * translation path alongside the bookmark filter dicts and the flows
 * segfilter entries. Not exported from the package barrel.
 *
 * Contract notes a reader must not "clean up": escaping is
 * character-for-character (backslashes before double quotes, every
 * occurrence — the rig compares the selector verbatim); non-string
 * values render with Python `str()` semantics (`True`, `18.0`), never
 * `String(x)`; booleans pass the `int | float` guards because Python's
 * `bool` subclasses `int`; the property reference is built before any
 * operator dispatch, so `ES1` wins over every other code; and a filter
 * list is translated lazily, aborting at the first failing element.
 * Python's warning logs have no twin — the value behavior around them
 * does.
 *
 * @see mixpanel_headless._internal.query.user_builders
 * @internal
 */

import {
  floatCarrierValue,
  isFloatCarrier,
  isPythonDict,
  pythonFloatStr,
  pythonRepr,
  pythonStrValue,
  pythonTypeName,
  type PythonValue,
} from "../compat/index.js";
import { ParamValidationError } from "../errors.js";
import type { Filter } from "../types/query-params/filter.js";

/**
 * Python `isinstance(value, (str, int, float))` for the equals /
 * not-equals element filters.
 *
 * Accepts strings, numbers, booleans (Python `bool` subclasses `int`)
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
 * Python `isinstance(value, (int, float))` for the numeric guards.
 *
 * Accepts numbers, booleans (`bool <: int`) and the PyFloat carrier;
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
 * Python `repr(value)` for the ES3 / ES5 message text (`{value!r}`).
 *
 * Message text is out of contract, but the code that carries it is:
 * this renderer must therefore never throw, or an ES3/ES5 guard
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
 * Format a scalar value for embedding in a selector expression.
 *
 * @remarks
 * Strings are wrapped in double quotes with internal backslashes and
 * quotes escaped (backslash pass first, every occurrence). Everything
 * else renders through Python `str()` semantics: `str(2.0)` is `"2.0"`,
 * `str(True)` is `"True"`, `str(1e16)` is `"1e+16"`. The result is
 * embedded in the selector verbatim, so no `String(...)` may appear
 * here. Module-private in Python; exported for the property-based
 * tests that call it directly. Not in the package barrel.
 * @param value - The scalar value to format.
 * @returns Formatted string suitable for embedding in a selector.
 * @throws {@link TypeError} - When the value is outside the `pythonStr`
 *   domain (out-of-annotation input only).
 * @example
 * ```ts
 * formatValue('say "hi"'); // '"say \\"hi\\""'
 * formatValue(18); // "18"
 * ```
 * @see mixpanel_headless._internal.query.user_builders._format_value
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
 * Build the `properties["name"]` reference for a Filter.
 *
 * The property name is escaped exactly like a value (backslash first,
 * then quote, all occurrences).
 *
 * @param f - Filter whose property name to reference.
 * @returns String of the form `properties["<name>"]`.
 * @throws {@link ParamValidationError} - `ES1_PROPERTY_NOT_STRING` when
 *   the filter's property is not a plain string (a `CustomPropertyRef` /
 *   `InlineCustomProperty` reaches this branch — custom properties are
 *   unsupported in `query_user()` filters).
 * @see mixpanel_headless._internal.query.user_builders._prop_ref
 */
function propRef(f: Filter): string {
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
 * Return true if `f` is a cohort filter (`in_cohort` / `not_in_cohort`).
 *
 * @remarks
 * Cohort filters store their value as a list of dicts (from
 * `CohortDefinition.to_dict()`), unlike regular filters which use
 * `str`, number, list-of-str, or `None`. This shape heuristic is safe
 * because `Filter` only produces list-of-dict values for
 * `in_cohort()` / `not_in_cohort()`. Python's guard is an explicit
 * length test, ported as `.length > 0`.
 * @param f - Filter to test.
 * @returns True when the filter's `_value` is a non-empty list of dicts.
 * @example
 * ```ts
 * isCohortFilter(Filter.inCohort(123)); // true
 * isCohortFilter(Filter.equals("plan", "pro")); // false
 * ```
 * @see mixpanel_headless._internal.query.user_builders._is_cohort_filter
 */
export function isCohortFilter(f: Filter): boolean {
  const val: unknown = f._value;
  return Array.isArray(val) && val.length > 0 && isPythonDict(val[0]);
}

/**
 * Convert a single Filter to an engage-API selector string.
 *
 * @remarks
 * Each operator maps to a specific selector pattern; the dispatch
 * order, the emitted spacing and the parenthesization are all
 * byte-level contract.
 * @param f - A Filter (constructed via a factory such as
 *   `Filter.equals()` / `Filter.greaterThan()`).
 * @returns Selector string for the engage API `where` parameter.
 * @throws {@link ParamValidationError} - `ES1_PROPERTY_NOT_STRING` when
 *   the property is not a string; `ES2`–`ES12` when the value has the
 *   wrong shape for the operator; `ES13_UNSUPPORTED_OPERATOR` for any
 *   operator this translation does not handle.
 * @example
 * ```ts
 * filterToSelector(Filter.equals("plan", "premium"));
 * // 'properties["plan"] == "premium"'
 * ```
 * @see mixpanel_headless._internal.query.user_builders.filter_to_selector
 */
// eslint-disable-next-line complexity, max-lines-per-function -- branch-for-branch port of one Python function (see the docblock); splitting it would scatter the guard order the corpus pins
export function filterToSelector(f: Filter): string {
  const op: string = f._operator;
  // `_prop_ref` runs before the operator dispatch — ES1 wins over every
  // other code for a non-string property.
  const prop = propRef(f);
  const value: unknown = f._value;

  if (op === "equals") {
    if (!Array.isArray(value)) {
      throw new ParamValidationError(
        `Expected list for 'equals' operator, got ${pythonTypeName(value)}`,
        "ES2_EQUALS_EXPECTS_LIST",
      );
    }
    // Python also materializes a `dropped` list, but only to feed
    // `logger.warning` — logging is out of contract, so the TS twin
    // keeps just the value behavior.
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
    // No parentheses here — the asymmetry is deliberate.
    return parts.join(" and ");
  }

  if (op === "contains") {
    if (typeof value !== "string") {
      throw new ParamValidationError(
        `Expected str for 'contains' operator, got ${pythonTypeName(value)}`,
        "ES6_CONTAINS_EXPECTS_STR",
      );
    }
    // Value first, then the property.
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
    // above, and destructuring would silently bind `undefined`.
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

  // Selector-language keywords — lowercase, and unrelated to Python's
  // `str(True)` capitalization.
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
 * Convert multiple Filters to an AND-combined selector string.
 *
 * Each Filter is translated individually via {@link filterToSelector},
 * then joined with `" and "`.
 *
 * @param filters - Filters to AND-combine.
 * @returns AND-combined selector string; the empty string (never
 *   `null`) for an empty list.
 * @throws {@link ParamValidationError} - Propagated from
 *   {@link filterToSelector} for the first invalid Filter in list order
 *   (`ES1`–`ES13`).
 * @example
 * ```ts
 * filtersToSelector([Filter.equals("plan", "premium"), Filter.isSet("email")]);
 * // 'properties["plan"] == "premium" and defined(properties["email"])'
 * ```
 * @see mixpanel_headless._internal.query.user_builders.filters_to_selector
 */
export function filtersToSelector(filters: readonly Filter[]): string {
  // Python's `if not filters` on a list is an emptiness test.
  if (filters.length === 0) {
    return "";
  }
  // Python joins a generator, so evaluation stops at the first raise
  // and later elements are never translated; `Array.from` with a
  // mapper preserves that error order.
  const parts: string[] = Array.from(filters, (f) => filterToSelector(f));
  return parts.join(" and ");
}

/**
 * Separate the cohort filter from a list of Filters.
 *
 * @remarks
 * At most one cohort filter is expected (validated by `U13`); the first
 * one wins and any extras stay in `remaining` as a defensive measure
 * (Python logs a warning there — out of contract; the placement of the
 * extras is not). The same Filter instances flow through to the
 * outputs and the input array is never mutated.
 * @param filters - Filters, possibly containing a cohort filter.
 * @returns A 2-tuple `[remaining, cohortOrNull]` — Python's
 *   `tuple[list[Filter], Filter | None]`.
 * @example
 * ```ts
 * const [remaining, cohort] = extractCohortFilter([
 *   Filter.equals("plan", "premium"),
 *   Filter.inCohort(123),
 * ]);
 * ```
 * @see mixpanel_headless._internal.query.user_builders.extract_cohort_filter
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
        // in `remaining` as a defensive measure.
        remaining.push(f);
      }
    } else {
      remaining.push(f);
    }
  }
  return [remaining, cohort];
}
