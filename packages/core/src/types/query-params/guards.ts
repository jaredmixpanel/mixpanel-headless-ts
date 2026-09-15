/**
 * Shared constructor-guard helpers for the query-param dataclass family —
 * TS port of the module-level private helpers in
 * `mixpanel_headless/types.py` (phase2-design C7).
 *
 * Guard blocks everywhere in this directory are transcribed from the
 * Python source IN SOURCE ORDER (Risk #1: the first failing guard wins,
 * and vectors record one `{class, code}` per input), with one comment
 * per registry code.
 *
 * @internal Not part of the public package surface — consumed by
 * `filter.ts` / `metric.ts` (and, in P2-5b, `cohort.ts`).
 */

import { pythonStrip } from "../../compat/index.js";
import { ParamValidationError } from "../../errors.js";

/**
 * Control characters rejected in event names — mirror of
 * `types._CONTROL_CHAR_RE` (`[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]`;
 * duplicated from `validation.py` in Python to avoid circular imports).
 *
 * @internal
 */
// eslint-disable-next-line no-control-regex
export const CONTROL_CHAR_RE: RegExp = /[\x00-\x08\v\f\x0E-\x1F\x7F]/;

/**
 * Math types that require a measurement property — mirror of
 * `types._MATH_REQUIRING_PROPERTY` (member order = Python source order).
 *
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
 * Whether a value is Python-`int`-like (mirror of `isinstance(v, int)`
 * over codec-decoded JSON values: integral `number` or `bigint`; a
 * fractional `number` is a Python `float` and does NOT match).
 *
 * @param value - The candidate value.
 * @returns True when the Python twin would see an `int`.
 * @internal
 */
export function isPyInt(value: unknown): value is number | bigint {
  return (
    (typeof value === "number" && Number.isInteger(value)) ||
    typeof value === "bigint"
  );
}

/**
 * Full `isinstance(v, int)` mirror INCLUDING booleans — Python's
 * `bool` is a subclass of `int`, so every `isinstance(cohort, int)`
 * saved-vs-inline split accepts `True`/`False` (B3 arbiter fix F1,
 * `b3-review-resolution.md` 2026-08-15; ratified Discrepancy #8 makes
 * a boolean cohort id in-annotation, b3-packets Caution #11).
 *
 * Contrast {@link isPyInt} (bool-EXCLUSIVE) and the B2 validators'
 * `isPythonInt` (`validation-shared.ts`, also bool-EXCLUSIVE): those
 * serve sites where Python checks `isinstance(v, bool)` separately
 * FIRST — the direction flips per site; read each Python guard.
 *
 * @param value - The candidate value.
 * @returns True when Python's `isinstance(value, int)` would hold.
 * @internal
 */
export function isPyIntOrBool(
  value: unknown,
): value is number | bigint | boolean {
  return isPyInt(value) || typeof value === "boolean";
}

/**
 * Validate that an event name is non-empty and has no control chars —
 * port of `types._validate_event_name`.
 *
 * @param event - The event name to validate.
 * @param className - Name of the containing class (for error messages).
 * @throws ParamValidationError - `EV1_EMPTY_EVENT` when empty/blank,
 *   `EV2_CONTROL_CHAR_EVENT` when control characters are present.
 * @internal
 */
export function validateEventName(event: string, className: string): void {
  // EV1_EMPTY_EVENT: event must be a non-empty, non-blank string.
  // Blankness is CPython str.strip() (pythonStrip), NOT JS .trim() — the
  // sets diverge on U+001C..1F/U+0085 vs U+FEFF (B0-gate RUN.md
  // 2026-08-15 divergence; this check runs BEFORE the control-char
  // guard, so U+001C-only inputs raise EV1, matching Python order).
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
 * Validate cohort ID and name shared by `CohortBreakdown`, `CohortMetric`,
 * and `Filter` — port of `types._validate_cohort_args`.
 *
 * @param cohort - Saved cohort ID or inline definition (any non-int
 *   value skips the ID guard, exactly like Python's
 *   `isinstance(cohort, int)` — which INCLUDES booleans:
 *   `CohortBreakdown(False)` fires the guard, `True` passes).
 * @param name - Display name for the cohort (`null` when not provided).
 * @param family - Error-code family of the caller — `"CF"` for
 *   `Filter.inCohort`/`notInCohort`, `"CB"` for `CohortBreakdown`, `"CM"`
 *   for `CohortMetric`.
 * @throws ParamValidationError - `{family}1_COHORT_ID_NOT_POSITIVE` when
 *   the cohort ID is not positive, `{family}2_COHORT_NAME_EMPTY` when the
 *   name is empty/blank while provided.
 * @internal
 */
export function validateCohortArgs(
  cohort: unknown,
  name: string | null,
  family: "CF" | "CB" | "CM",
): void {
  // {family}1_COHORT_ID_NOT_POSITIVE: integer cohort IDs must be
  // positive. Python's `isinstance(cohort, int) and cohort <= 0`
  // includes booleans (`bool <: int`): `False <= 0` is True and fires
  // the guard, `True <= 0` is False and passes — `cohort === false` is
  // the exact boolean residue (B3 arbiter fix F1,
  // `b3-review-resolution.md` 2026-08-15).
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

/** Regex for YYYY-MM-DD date format validation (`types._DATE_RE`). */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether a `YYYY-MM-DD` string names a real proleptic-Gregorian
 * calendar date — mirror of Python `datetime.date.fromisoformat`
 * acceptance (years 1–9999, real month/day ranges, Gregorian leap
 * rules).
 *
 * @param dateStr - A string already matching `YYYY-MM-DD`.
 * @returns True when the date exists on the calendar.
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
 * Whether a string matches the `YYYY-MM-DD` shape (format only — see
 * {@link isRealCalendarDate} for calendar validity).
 *
 * @param dateStr - The candidate string.
 * @returns True on a format match.
 * @internal
 */
export function matchesDateFormat(dateStr: string): boolean {
  return DATE_RE.test(dateStr);
}
