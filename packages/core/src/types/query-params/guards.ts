/**
 * Shared constructor guards for the query-parameter types: event-name and
 * cohort-argument validation, calendar-date checks, Python `int`
 * predicates and the raw-cohort deep-copy/sanitise helpers. Guards throw
 * in Python source order — the first failing rule wins, and the corpus
 * records one `{class, code}` per input. This module is the cycle-free
 * leaf below `filter.ts` and `cohort.ts`, which need each other's types.
 *
 * @see mixpanel_headless.types
 * @internal
 */

import { pythonStrip } from "../../compat/index.js";
import { isPythonDict, setOwn } from "../../compat/python-dict.js";
import { ParamValidationError } from "../../errors.js";

/**
 * Control characters rejected in event names
 * (`[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]`); Python duplicates the pattern
 * from its validation module to avoid a circular import.
 *
 * @see mixpanel_headless.types._CONTROL_CHAR_RE
 * @internal
 */
// eslint-disable-next-line no-control-regex -- the class exists to match control characters (Python `_CONTROL_CHAR_RE`)
const CONTROL_CHAR_RE: RegExp = /[\x00-\x08\v\f\x0E-\x1F\x7F]/;

/**
 * Math types that require a measurement property; member order is the
 * Python source order.
 *
 * @see mixpanel_headless.types._MATH_REQUIRING_PROPERTY
 * @internal
 */
export const MATH_REQUIRING_PROPERTY: ReadonlySet<string> = new Set([
  "average",
  "median",
  "min",
  "max",
  "p25",
  "p75",
  "p90",
  "p99",
  "percentile",
  "histogram",
  // Advanced property-requiring types
  "unique_values",
  "most_frequent",
  "first_value",
  "multi_attribution",
  "numeric_summary",
]);

/**
 * Report whether a value is Python-`int`-like: an integral `number` or a
 * `bigint`, mirroring `isinstance(v, int)` over codec-decoded JSON values.
 * A fractional `number` is a Python `float` and does not match; neither
 * does a boolean.
 *
 * @param value - The candidate value.
 * @returns True when the Python twin would see an `int`.
 * @example
 * ```ts
 * isPyInt(3); // true
 * isPyInt(3.5); // false
 * isPyInt(true); // false — see isPyIntOrBool
 * ```
 * @internal
 */
export function isPyInt(value: unknown): value is number | bigint {
  return (
    (typeof value === "number" && Number.isInteger(value)) ||
    typeof value === "bigint"
  );
}

/**
 * Mirror `isinstance(v, int)` including booleans. Python's `bool` is a
 * subclass of `int`, so every `isinstance(cohort, int)` saved-vs-inline
 * split accepts `True`/`False`, and a boolean cohort id is therefore
 * in-annotation for those sites.
 *
 * @remarks
 * Contrast {@link isPyInt} (bool-exclusive) and `isPythonInt` in
 * `query/validation-shared.ts` (also bool-exclusive): those serve sites
 * where Python checks `isinstance(v, bool)` separately first. The
 * direction flips per site, so read each Python guard before choosing.
 * @param value - The candidate value.
 * @returns True when Python's `isinstance(value, int)` would hold.
 * @example
 * ```ts
 * isPyIntOrBool(true); // true
 * isPyIntOrBool(7n); // true
 * isPyIntOrBool(1.5); // false
 * ```
 * @internal
 */
export function isPyIntOrBool(
  value: unknown,
): value is number | bigint | boolean {
  return isPyInt(value) || typeof value === "boolean";
}

/**
 * Reject an event name that is blank or contains control characters.
 *
 * @param event - The event name to validate.
 * @param className - Name of the containing class, used in the message.
 * @throws {@link ParamValidationError} - `EV1_EMPTY_EVENT` when the name is
 *   empty or blank, `EV2_CONTROL_CHAR_EVENT` when it contains control
 *   characters.
 * @example
 * ```ts
 * validateEventName("Signup", "FunnelStep"); // returns
 * validateEventName("  ", "FunnelStep"); // throws EV1_EMPTY_EVENT
 * ```
 * @see mixpanel_headless.types._validate_event_name
 * @internal
 */
export function validateEventName(event: string, className: string): void {
  // EV1_EMPTY_EVENT: event must be a non-empty, non-blank string. Blankness
  // is CPython `str.strip()` (pythonStrip), not JS `.trim()`: the whitespace
  // sets differ on U+001C..U+001F, U+0085 and U+FEFF. This check runs before
  // the control-char guard, so a U+001C-only input raises EV1, as in Python.
  if (!event || !pythonStrip(event)) {
    throw new ParamValidationError(
      `${className}.event must be a non-empty string`,
      "EV1_EMPTY_EVENT",
    );
  }
  // EV2_CONTROL_CHAR_EVENT: no control characters.
  if (CONTROL_CHAR_RE.test(event)) {
    throw new ParamValidationError(
      `${className}.event contains control characters: ${JSON.stringify(event)}`,
      "EV2_CONTROL_CHAR_EVENT",
    );
  }
}

/**
 * Validate the cohort id and display name shared by `CohortBreakdown`,
 * `CohortMetric` and the cohort `Filter` factories.
 *
 * @param cohort - Saved cohort id or inline definition. Any non-int value
 *   skips the id guard, exactly like Python's `isinstance(cohort, int)` —
 *   which includes booleans: `CohortBreakdown(False)` fires the guard,
 *   `True` passes.
 * @param name - Display name for the cohort (`null` when not provided).
 * @param family - Error-code family of the caller: `"CF"` for
 *   `Filter.inCohort` / `notInCohort`, `"CB"` for `CohortBreakdown`,
 *   `"CM"` for `CohortMetric`.
 * @throws {@link ParamValidationError} - `<family>1_COHORT_ID_NOT_POSITIVE`
 *   when the cohort id is not positive, `<family>2_COHORT_NAME_EMPTY` when
 *   a provided name is blank.
 * @example
 * ```ts
 * validateCohortArgs(42, null, "CB"); // returns
 * validateCohortArgs(0, null, "CB"); // throws CB1_COHORT_ID_NOT_POSITIVE
 * ```
 * @see mixpanel_headless.types._validate_cohort_args
 * @internal
 */
export function validateCohortArgs(
  cohort: unknown,
  name: string | null,
  family: "CF" | "CB" | "CM",
): void {
  // {family}1_COHORT_ID_NOT_POSITIVE: integer cohort ids must be positive.
  // Python's `isinstance(cohort, int) and cohort <= 0` includes booleans
  // (`bool <: int`): `False <= 0` is True and fires the guard, `True <= 0`
  // is False and passes — `cohort === false` is the exact boolean residue.
  if ((isPyInt(cohort) && cohort <= 0) || cohort === false) {
    throw new ParamValidationError(
      "cohort must be a positive integer",
      `${family}1_COHORT_ID_NOT_POSITIVE`,
    );
  }
  // {family}2_COHORT_NAME_EMPTY: a provided name must be non-blank
  // (pythonStrip = CPython str.strip() blankness, not JS .trim()).
  if (name !== null && !pythonStrip(name)) {
    throw new ParamValidationError(
      "cohort name must be non-empty when provided",
      `${family}2_COHORT_NAME_EMPTY`,
    );
  }
}

/** The `YYYY-MM-DD` shape check shared by the date guards. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Report whether a `YYYY-MM-DD` string names a real proleptic-Gregorian
 * calendar date, mirroring what Python's `datetime.date.fromisoformat`
 * accepts (years 1–9999, real month/day ranges, Gregorian leap rules).
 *
 * @param dateStr - A string already matching `YYYY-MM-DD`.
 * @returns True when the date exists on the calendar.
 * @example
 * ```ts
 * isRealCalendarDate("2024-02-29"); // true
 * isRealCalendarDate("2023-02-29"); // false
 * ```
 * @internal
 */
export function isRealCalendarDate(dateStr: string): boolean {
  const year = Number(dateStr.slice(0, 4));
  const month = Number(dateStr.slice(5, 7));
  const day = Number(dateStr.slice(8, 10));
  if (year < 1 || month < 1 || month > 12 || day < 1) {
    return false;
  }
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [
    31,
    leap ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1] as number;
  return day <= daysInMonth;
}

/**
 * Report whether a string matches the `YYYY-MM-DD` shape; format only —
 * see {@link isRealCalendarDate} for calendar validity.
 *
 * @param dateStr - The candidate string.
 * @returns True on a format match.
 * @example
 * ```ts
 * matchesDateFormat("2026-01-15"); // true
 * matchesDateFormat("2026-1-15"); // false
 * ```
 * @internal
 */
export function matchesDateFormat(dateStr: string): boolean {
  return DATE_RE.test(dateStr);
}

/**
 * Deep-copy a decoded JSON-ish subtree, as the `copy.deepcopy` calls in
 * Python's `CohortDefinition.to_dict` and `_sanitize_raw_cohort` do.
 *
 * Plain objects and arrays are copied recursively; primitives, `bigint`
 * and immutable class instances (such as the lossless number wrappers
 * riding in decoded payloads) pass through by reference.
 *
 * @param value - The subtree to copy.
 * @returns A structurally independent copy.
 * @example
 * ```ts
 * const copy = deepCopy({ selector: { children: [1, 2] } });
 * // copy.selector.children !== original.selector.children
 * ```
 * @internal
 */
export function deepCopy<T>(value: T): T {
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    return items.map((item) => deepCopy(item)) as unknown as T;
  }
  if (isPythonDict(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      setOwn(out, key, deepCopy(item));
    }
    return out as T;
  }
  return value;
}

/**
 * Remove `selector: null` entries from the behavioral `event_selector`
 * blocks of a raw cohort definition, on a deep copy.
 *
 * @remarks
 * The Mixpanel API runs `postorder_traverse` over nested `selector`
 * fields inside `event_selector` blocks and crashes on a `null` root.
 * Python's body runs `del es["selector"]` whenever
 * `es.get("selector") is None`, which would raise `KeyError` on an absent
 * key; every constructible `CohortDefinition.to_dict()` output carries
 * the key, so the reachable behaviour is exactly "delete when present and
 * null", and a JS `delete` on an absent key is a silent no-op anyway.
 * Exported for the conformance binding and translated tests only.
 * @param raw - Output of `CohortDefinition.toDict()`.
 * @returns Sanitized deep copy safe for API submission.
 * @example
 * ```ts
 * const clean = sanitizeRawCohort(definition.toDict());
 * // clean.behaviors.bhvr_0.count.event_selector has no `selector` key
 * // when the criterion carried no `where` filters.
 * ```
 * @see mixpanel_headless.types._sanitize_raw_cohort
 */
export function sanitizeRawCohort(
  raw: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const result = deepCopy(raw) as Record<string, unknown>;
  const behaviors = result["behaviors"];
  if (isPythonDict(behaviors)) {
    for (const bval of Object.values(behaviors)) {
      if (!isPythonDict(bval)) {
        continue;
      }
      const count = bval["count"];
      if (isPythonDict(count)) {
        const es = count["event_selector"];
        if (isPythonDict(es) && es["selector"] === null) {
          delete es["selector"];
        }
      }
    }
  }
  return result;
}
