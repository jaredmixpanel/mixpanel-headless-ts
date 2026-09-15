/**
 * Shared validation helpers: the module constants, the character /
 * date / finiteness predicates, the error collector, the
 * difflib-faithful fuzzy matcher, `data_group_id` validation and the
 * custom-property scan every Layer-1 validator runs. Not exported from
 * the package barrel.
 *
 * Fidelity rules the helpers encode: `pythonStrip` wherever Python
 * calls `.strip()`; regex `\s` / `\d` classes come from the pinned
 * CPython tables, never the JS shorthands; `len(str)` bounds count
 * codepoints; Python floats arrive either as JS numbers or as the rig's
 * PyFloat carrier and both spellings are classified.
 *
 * @see mixpanel_headless._internal.validation
 * @internal
 */

import { DECIMAL_DIGIT_RUNS } from "../compat/decimal-digits.gen.js";
import {
  codepoints,
  cpLength,
  getCloseMatches,
  isFloatCarrier,
  isPythonInt,
  pythonListRepr,
  pythonRepr,
  pythonStrip,
  pythonTypeName,
  sortedByCodepoint,
} from "../compat/index.js";
import { PYTHON_STR_WHITESPACE } from "../compat/whitespace.gen.js";
import { ValidationError } from "../errors.js";
import {
  CustomPropertyRef,
  Filter,
  InlineCustomProperty,
} from "../types/query-params/filter.js";
import type { FlowStep } from "../types/query-params/flow.js";
import { FrequencyFilter } from "../types/query-params/frequency.js";
import { FunnelStep } from "../types/query-params/funnel.js";
import { GroupBy } from "../types/query-params/group-by.js";
import { Metric } from "../types/query-params/metric.js";
import type { RetentionEvent } from "../types/query-params/retention.js";

// --- Module constants ---

/** Port of `_CP_INPUT_KEY_RE` — ASCII-only class. */
const CP_INPUT_KEY_RE = /^[A-Z]$/;

/** Port of `_CP_MAX_FORMULA_LENGTH`. */
const CP_MAX_FORMULA_LENGTH = 20_000;

/**
 * Port of `_SESSION_MATH`: session-based math
 * types requiring `conversion_window_unit='session'`.
 */
export const SESSION_MATH: ReadonlySet<string> = new Set([
  "conversion_rate_session",
]);

/**
 * Port of `_FORMULA_POSITION_RE` — ASCII-only
 * class, safe as a JS regex.
 */
export const FORMULA_POSITION_RE: RegExp = /[A-Z]/g;

/**
 * Codepoint test for the `_CONTROL_CHAR_RE` class
 * (`[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]`).
 *
 * Ported as an explicit codepoint predicate rather than a JS regex: the
 * character class is ASCII-explicit (no `\s`/`\d` shorthand) so the two
 * spellings are equivalent, and the predicate form avoids embedding raw
 * control characters in a regex literal.
 *
 * @param cp - Codepoint to test.
 * @returns True when the codepoint is in the Python class.
 */
function isControlCodepoint(cp: number): boolean {
  return (
    cp <= 0x08 ||
    cp === 0x0b ||
    cp === 0x0c ||
    (cp >= 0x0e && cp <= 0x1f) ||
    cp === 0x7f
  );
}

/**
 * The literal extras of `_INVISIBLE_RE` beyond
 * the Python `\s` class: U+200B ZWSP, U+200C ZWNJ, U+200D ZWJ,
 * U+FEFF BOM, U+00AD SOFT HYPHEN, U+2060 WORD JOINER.
 */
const INVISIBLE_EXTRAS: ReadonlySet<number> = new Set([
  0x200b, 0x200c, 0x200d, 0xfeff, 0x00ad, 0x2060,
]);

/** Port of `_MAX_LAST_DAYS` — 10 years. */
export const MAX_LAST_DAYS = 3650;

/** Port of `_MAX_ROLLING` — rolling window cap. */
export const MAX_ROLLING = 365;

/**
 * Port of `_MAX_FILTER_VALUES` — the server rejects very large filter
 * value lists. Consumed by the bookmark validators; declared here with
 * the other module constants exactly as in the Python source.
 */
export const MAX_FILTER_VALUES = 1000;

/**
 * Port of `_VALID_RETENTION_MATH_PUBLIC`:
 * public-facing retention math types (Layer 1).
 */
export const VALID_RETENTION_MATH_PUBLIC: ReadonlySet<string> = new Set([
  "retention_rate",
  "unique",
  "total",
  "average",
]);

/**
 * Port of `_VALID_RETENTION_MODES`: valid
 * display modes for retention queries.
 */
export const VALID_RETENTION_MODES: ReadonlySet<string> = new Set([
  "curve",
  "trends",
  "table",
]);

/** Port of `_MAX_RETENTION_BUCKETS`. */
export const MAX_RETENTION_BUCKETS = 730;

/** Port of `_MAX_FLOW_STEPS_DIRECTION`. */
export const MAX_FLOW_STEPS_DIRECTION = 5;

/** Port of `_MAX_FLOW_CARDINALITY`. */
export const MAX_FLOW_CARDINALITY = 50;

/**
 * Port of `_FLOW_MAX_WINDOW`: maximum conversion window per unit
 * (366-day equivalent for a leap year).
 */
export const FLOW_MAX_WINDOW: ReadonlyMap<string, number> = new Map([
  ["month", 12],
  ["week", 52],
  ["day", 366],
]);

// --- Character / date / finiteness helpers ---

/**
 * Check whether a string contains ASCII control characters
 * (`\x00-\x08`, `\x0b`, `\x0c`, `\x0e-\x1f`, and `\x7f`).
 *
 * @param s - The string to check.
 * @returns True if `s` contains at least one control character.
 * @example
 * ```ts
 * containsControlChars("plain"); // false
 * containsControlChars("tab\tok"); // false — TAB is not in the class
 * containsControlChars("nul\u0000"); // true
 * ```
 * @see mixpanel_headless._internal.validation.contains_control_chars
 */
export function containsControlChars(s: string): boolean {
  for (const ch of s) {
    if (isControlCodepoint(ch.codePointAt(0) as number)) {
      return true;
    }
  }
  return false;
}

/**
 * Report whether every codepoint of `s` is Python-`\s` whitespace (the
 * pinned `str.isspace()` table) or one of the six invisible literals —
 * the truthiness of `_INVISIBLE_RE.match(s)`.
 *
 * @remarks
 * True for the empty string (`[...]*` matches zero chars), exactly as
 * the Python regex. Python's `$`-before-trailing-newline nuance is a
 * no-op here because `\n` is itself in the class.
 * @param s - The string to classify.
 * @returns True when the string is invisible-only.
 * @example
 * ```ts
 * isInvisibleOnly(" \u200b\ufeff"); // true
 * isInvisibleOnly(""); // true
 * isInvisibleOnly(" a "); // false
 * ```
 */
export function isInvisibleOnly(s: string): boolean {
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    if (!PYTHON_STR_WHITESPACE.has(cp) && !INVISIBLE_EXTRAS.has(cp)) {
      return false;
    }
  }
  return true;
}

/**
 * Unicode decimal-digit (category Nd) test from the pinned CPython
 * table — Python str-pattern `\d` matches exactly this set
 * (`Py_UNICODE_ISDECIMAL`), not the ASCII-only JS `\d`.
 *
 * @param cp - Codepoint to test.
 * @returns True when the codepoint is a Unicode decimal digit.
 */
function isDecimalDigit(cp: number): boolean {
  for (const [start, , length] of DECIMAL_DIGIT_RUNS) {
    if (cp >= start && cp < start + length) {
      return true;
    }
  }
  return false;
}

/**
 * Report whether `s` matches `_DATE_RE` (`^\d{4}-\d{2}-\d{2}$`) with
 * Python `re` semantics.
 *
 * @remarks
 * `\d` matches Unicode decimal digits (category Nd), not just ASCII —
 * see {@link isDecimalDigit}; `$` also matches just before one trailing
 * `\n`.
 * @param s - Candidate date string.
 * @returns True when the Python regex would match.
 * @example
 * ```ts
 * matchesDateRe("2026-01-15"); // true
 * matchesDateRe("2026-01-15\n"); // true — Python `$` before a final newline
 * matchesDateRe("٢٠٢٦-٠١-١٥"); // true — Arabic-Indic digits are `\d`
 * matchesDateRe("2026-1-15"); // false
 * ```
 */
export function matchesDateRe(s: string): boolean {
  const core = s.endsWith("\n") ? s.slice(0, -1) : s;
  const cps = codepoints(core);
  if (cps.length !== 10) {
    return false;
  }
  for (let i = 0; i < 10; i++) {
    const cp = (cps[i] as string).codePointAt(0) as number;
    if (i === 4 || i === 7) {
      if (cp !== 0x2d) {
        return false;
      }
    } else if (!isDecimalDigit(cp)) {
      return false;
    }
  }
  return true;
}

/** Days per month in a non-leap year. */
const DAYS_IN_MONTH: readonly number[] = [
  31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
];

/**
 * Check if a YYYY-MM-DD string is a valid calendar date.
 *
 * @remarks
 * Python defers to `datetime.date.fromisoformat`; this is a pure
 * calendar check (never `new Date(...)`, which would read the local
 * zone): Gregorian leap rule, month 1–12, day vs month length, year
 * 1–9999 (`date.MINYEAR`). Callers only reach this through the
 * {@link matchesDateRe} gate, whose accepted set is wider than ASCII
 * (Unicode Nd digits, one trailing newline). CPython's `fromisoformat`
 * C parser accepts only ASCII digits in exactly `YYYY-MM-DD` here, so
 * any gated-but-non-ASCII spelling returns false — matching Python's
 * `ValueError → False` path. `fromisoformat`'s wider grammar (basic
 * format, week dates) can never pass the gate and is not reproduced.
 * @param dateStr - Date string (regex-gated by the caller).
 * @returns True if the date is a valid calendar date.
 * @example
 * ```ts
 * isValidDate("2024-02-29"); // true — leap year
 * isValidDate("2023-02-29"); // false
 * isValidDate("2026-13-01"); // false
 * ```
 * @see mixpanel_headless._internal.validation._is_valid_date
 */
export function isValidDate(dateStr: string): boolean {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(dateStr)) {
    return false;
  }
  const year = asciiDigitsToInt(dateStr.slice(0, 4));
  const month = asciiDigitsToInt(dateStr.slice(5, 7));
  const day = asciiDigitsToInt(dateStr.slice(8, 10));
  if (year < 1) {
    return false;
  }
  if (month < 1 || month > 12) {
    return false;
  }
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const maxDay =
    month === 2 && isLeap ? 29 : (DAYS_IN_MONTH[month - 1] as number);
  return day >= 1 && day <= maxDay;
}

/**
 * Convert a pre-validated run of ASCII digits to a number.
 *
 * @remarks
 * No `parseInt`/`Number` — those accept spellings Python's `int()`
 * would not; the input is guaranteed `[0-9]+` by the caller's regex.
 * @param digits - ASCII digit string.
 * @returns The base-10 integer value.
 * @example
 * ```ts
 * asciiDigitsToInt("0042"); // 42
 * ```
 */
export function asciiDigitsToInt(digits: string): number {
  let value = 0;
  for (let i = 0; i < digits.length; i++) {
    value = value * 10 + (digits.charCodeAt(i) - 0x30);
  }
  return value;
}

/**
 * Check if a numeric value is finite (not NaN, not Inf).
 *
 * @remarks
 * `None` → true; `float` → `math.isfinite`; anything else (ints
 * included) → true. For PyFloat carriers the non-finite spellings are
 * the only non-finite values.
 * @param value - Numeric value to check (loose input domain).
 * @returns True if finite or not a float at all.
 * @example
 * ```ts
 * isFiniteNumber(1.5); // true
 * isFiniteNumber(Number.POSITIVE_INFINITY); // false
 * isFiniteNumber("not a number"); // true — only floats can be non-finite
 * ```
 * @see mixpanel_headless._internal.validation._is_finite
 */
export function isFiniteNumber(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (isFloatCarrier(value)) {
    return !["Infinity", "-Infinity", "NaN"].includes(value.spelling);
  }
  return true;
}

// --- Error accumulation ---

/**
 * Append one `ValidationError` to a validator's list — the only
 * capability a per-rule helper receives, so a rule can add errors but
 * never reorder or drop earlier ones. Emission order is contract: the
 * corpus checks the error sequence, so helpers are called in Python
 * source order and each pushes in Python source order.
 *
 * The positional form builds a severity-`"error"` entry; the
 * single-argument form appends an already-built error (the
 * {@link enumError} rules).
 */
export interface PushError {
  /**
   * Append a new error.
   *
   * @param path - JSONPath-like location.
   * @param message - Human-readable description (display-only).
   * @param code - Machine-readable error code.
   * @param suggestion - Fuzzy-matched alternatives, when the rule has any.
   */
  (
    path: string,
    message: string,
    code: string,
    suggestion?: readonly string[] | null,
  ): void;
  /**
   * Append a built error.
   *
   * @param error - The error to append.
   */
  (error: ValidationError): void;
}

/** A validator's error list paired with its {@link PushError} sink. */
export interface ErrorCollector {
  /** The accumulated errors, in emission order. */
  readonly errors: ValidationError[];
  /** Appends one error with severity `"error"`. */
  readonly push: PushError;
}

/**
 * Create the error list a Layer-1 validator returns, seeded with any
 * errors a delegated check already produced (the `DG1` data_group_id
 * check runs first in every validator).
 *
 * @param initial - Errors to start from.
 * @returns The list and its sink.
 * @example
 * ```ts
 * const { errors, push } = errorCollector(validateDataGroupId(dataGroupId));
 * push("last", "last must be positive", "V3_LAST_POSITIVE");
 * return errors;
 * ```
 */
export function errorCollector(
  initial: readonly ValidationError[] = [],
): ErrorCollector {
  const errors = [...initial];
  const push: PushError = (
    pathOrError: string | ValidationError,
    message: string = "",
    code: string = "",
    suggestion: readonly string[] | null = null,
  ): void => {
    errors.push(
      typeof pathOrError === "string"
        ? new ValidationError(pathOrError, message, code, "error", suggestion)
        : pathOrError,
    );
  };
  return { errors, push };
}

// --- Fuzzy matching helpers ---

/**
 * Find the closest matches for a mistyped enum value.
 *
 * @remarks
 * A faithful `difflib.get_close_matches` port: candidates are
 * `sorted(valid)` (codepoint order), `heapq.nlargest` tie order; `null`
 * when nothing clears the cutoff.
 * @param value - The invalid value to match against.
 * @param valid - Set of valid values.
 * @param n - Maximum number of suggestions.
 * @param cutoff - Minimum similarity ratio.
 * @returns Frozen array of closest matches, or null if none.
 * @example
 * ```ts
 * suggest("totl", new Set(["total", "unique", "average"])); // ["total"]
 * suggest("zzz", new Set(["total", "unique"])); // null
 * ```
 * @see mixpanel_headless._internal.validation._suggest
 */
export function suggest(
  value: string,
  valid: ReadonlySet<string>,
  n = 3,
  cutoff = 0.5,
): readonly string[] | null {
  const matches = getCloseMatches(
    value,
    sortedByCodepoint([...valid]),
    n,
    cutoff,
  );
  return matches.length > 0 ? matches : null;
}

/** Arguments of {@link enumError} (the Python positional parameters, named). */
export interface EnumErrorArgs {
  /** JSONPath-like location. */
  readonly path: string;
  /** Human-readable field name. */
  readonly field: string;
  /** The invalid value. */
  readonly value: string;
  /** Set of valid values. */
  readonly valid: ReadonlySet<string>;
  /** Machine-readable error code. */
  readonly code: string;
  /**
   * Error severity level.
   *
   * @defaultValue `"error"`
   */
  readonly severity?: "error" | "warning" | undefined;
}

/**
 * Build a validation error for an invalid enum value with suggestions.
 *
 * @remarks
 * Message text is display-only but ported faithfully, including the
 * `sorted(valid)[:5]` sample list repr in the no-suggestion branch.
 * @param args - The finding: `path` (JSONPath-like location), `field`
 *   (human-readable name), `value` (the invalid text), `valid` (the
 *   accepted set), `code` and the optional `severity`.
 * @returns ValidationError with fuzzy-matched suggestions.
 * @example
 * ```ts
 * enumError({
 *   path: "events[0].math",
 *   field: "math type",
 *   value: "totl",
 *   valid: VALID_MATH_INSIGHTS,
 *   code: "V4_INVALID_MATH",
 * });
 * // ValidationError { message: "Invalid math type 'totl'", suggestion: ["total"], … }
 * ```
 * @see mixpanel_headless._internal.validation._enum_error
 */
export function enumError(args: EnumErrorArgs): ValidationError {
  const { path, field, value, valid, code, severity = "error" } = args;
  const suggestion = suggest(value, valid);
  let msg: string;
  if (suggestion !== null && suggestion.length > 0) {
    msg = `Invalid ${field} '${value}'`;
  } else {
    const sample = sortedByCodepoint([...valid]).slice(0, 5);
    msg = `Invalid ${field} '${value}'. Valid (${String(valid.size)} total): ${pythonListRepr(sample)}`;
  }
  return new ValidationError(path, msg, code, severity, suggestion);
}

// --- data_group_id validation ---

/**
 * Validate the `data_group_id` parameter if provided.
 *
 * @remarks
 * Guard order matters: the bool reject fires before the int check
 * because Python's `bool` is an `int`.
 * @param dataGroupId - Data group ID to validate (loose input);
 *   `null`/absent skips validation.
 * @returns List with one `ValidationError` if invalid, empty otherwise.
 * @example
 * ```ts
 * validateDataGroupId(42); // []
 * validateDataGroupId(0); // [ValidationError { code: "DG1_INVALID_DATA_GROUP_ID", … }]
 * validateDataGroupId(null); // []
 * ```
 * @see mixpanel_headless._internal.validation._validate_data_group_id
 */
export function validateDataGroupId(dataGroupId: unknown): ValidationError[] {
  if (dataGroupId !== null && dataGroupId !== undefined) {
    if (typeof dataGroupId === "boolean" || !isPythonInt(dataGroupId)) {
      return [
        new ValidationError(
          "data_group_id",
          `data_group_id must be a positive integer, got ${pythonTypeName(dataGroupId)}`,
          "DG1_INVALID_DATA_GROUP_ID",
        ),
      ];
    }
    if (dataGroupId <= 0) {
      return [
        new ValidationError(
          "data_group_id",
          `data_group_id must be a positive integer (got ${String(dataGroupId)})`,
          "DG1_INVALID_DATA_GROUP_ID",
        ),
      ];
    }
  }
  return [];
}

// --- Custom property validation + scanning ---

/**
 * Validate a custom property specification (rules CP1–CP6).
 *
 * @remarks
 * CP5's formula length bound counts codepoints (`cpLength`), as
 * Python's `len(str)` does.
 * @param prop - A `CustomPropertyRef` or `InlineCustomProperty`.
 * @param path - JSONPath-like location for error reporting.
 * @returns List of validation errors; empty means valid.
 * @example
 * ```ts
 * validateCustomProperty(new CustomPropertyRef({ id: 0 }), "where[0]");
 * // [ValidationError { path: "where[0]", code: "CP1_INVALID_ID", … }]
 * ```
 * @see mixpanel_headless._internal.validation._validate_custom_property
 */
export function validateCustomProperty(
  prop: CustomPropertyRef | InlineCustomProperty,
  path: string,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (prop instanceof CustomPropertyRef) {
    // CP1: id must be a positive integer
    if (prop.id <= 0) {
      errors.push(
        new ValidationError(
          path,
          `custom property ID must be a positive integer (got ${String(prop.id)})`,
          "CP1_INVALID_ID",
        ),
      );
    }
  } else if (prop instanceof InlineCustomProperty) {
    // CP2: formula must be non-empty
    if (pythonStrip(prop.formula) === "") {
      errors.push(
        new ValidationError(
          path,
          "inline custom property formula must be non-empty",
          "CP2_EMPTY_FORMULA",
        ),
      );
    }

    // CP3: inputs must have at least one entry
    if (Object.keys(prop.inputs).length === 0) {
      errors.push(
        new ValidationError(
          path,
          "inline custom property must have at least one input",
          "CP3_EMPTY_INPUTS",
        ),
      );
    }

    // CP4: input keys must be single uppercase letters A-Z
    for (const key of Object.keys(prop.inputs)) {
      if (!CP_INPUT_KEY_RE.test(key)) {
        errors.push(
          new ValidationError(
            path,
            `inline custom property input keys must be ` +
              `single uppercase letters (A-Z), got ${pythonRepr(key)}`,
            "CP4_INVALID_INPUT_KEY",
          ),
        );
      }
    }

    // CP5: formula must not exceed max length
    if (cpLength(prop.formula) > CP_MAX_FORMULA_LENGTH) {
      errors.push(
        new ValidationError(
          path,
          `inline custom property formula exceeds maximum ` +
            `length of 20,000 characters (got ${String(cpLength(prop.formula))})`,
          "CP5_FORMULA_TOO_LONG",
        ),
      );
    }

    // CP6: each PropertyInput.name must be non-empty
    for (const [key, pi] of Object.entries(prop.inputs)) {
      if (pythonStrip(pi.name) === "") {
        errors.push(
          new ValidationError(
            path,
            `inline custom property input ${pythonRepr(key)} has an ` +
              `empty property name`,
            "CP6_EMPTY_INPUT_NAME",
          ),
        );
      }
    }
  }

  return errors;
}

/**
 * Python `isinstance(x, (CustomPropertyRef, InlineCustomProperty))` —
 * the gate every scan position applies before validating a property.
 *
 * @param value - A property position's value.
 * @returns True for either custom-property shape.
 */
function isCustomProperty(
  value: unknown,
): value is CustomPropertyRef | InlineCustomProperty {
  return (
    value instanceof CustomPropertyRef || value instanceof InlineCustomProperty
  );
}

/**
 * Scan a list of Filter objects for custom property references.
 *
 * @param filters - Filter objects to scan.
 * @param basePath - JSONPath prefix for error reporting (e.g.
 *   `"events[0]"` or `"steps[1]"`).
 * @returns List of validation errors for invalid custom properties.
 */
function scanFiltersForCustomProperties(
  filters: readonly Filter[],
  basePath: string,
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const [i, f] of filters.entries()) {
    if (!isCustomProperty(f._property)) {
      continue;
    }

    const fpath = `${basePath}.filters[${String(i)}]`;
    errors.push(...validateCustomProperty(f._property, fpath));
  }
  return errors;
}

/**
 * Options bag for {@link scanCustomProperties} — mirrors the all-kwonly,
 * all-default-`None` Python signature (absent and `null` are
 * equivalent).
 */
export interface ScanCustomPropertiesOptions {
  /** Breakdown specification (may contain custom properties). */
  readonly group_by?: unknown;
  /** Filter specification (may contain custom properties). */
  readonly where?: unknown;
  /** Event specifications (Metric property/filters scanned). */
  readonly events?: readonly unknown[] | null;
  /** Funnel step specifications (FunnelStep.filters scanned). */
  readonly funnel_steps?: readonly unknown[] | null;
  /** Flow step specifications (FlowStep.filters scanned). */
  readonly flow_steps?: readonly FlowStep[] | null;
  /** Retention event pair `[born_event, return_event]`. */
  readonly retention_events?: readonly RetentionEvent[] | null;
}

/**
 * The `group_by` position: every `GroupBy` whose property is custom.
 *
 * @param groupBy - Breakdown specification (non-null).
 * @returns Errors in source order.
 */
function scanGroupBy(groupBy: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  const groups: readonly unknown[] = Array.isArray(groupBy)
    ? groupBy
    : [groupBy];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (g instanceof GroupBy && isCustomProperty(g.property)) {
      const gpath = groups.length > 1 ? `group_by[${String(i)}]` : "group_by";
      errors.push(...validateCustomProperty(g.property, gpath));
    }
  }
  return errors;
}

/**
 * A `FrequencyFilter` in `where`: its nested `event_filters` are
 * scanned in place of the (absent) `_property`.
 *
 * @param f - The frequency filter.
 * @param index - Its position in `where`.
 * @returns Errors in source order.
 */
function scanFrequencyFilter(
  f: FrequencyFilter,
  index: number,
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (f.event_filters === null || f.event_filters.length === 0) {
    return errors;
  }
  for (let fi = 0; fi < f.event_filters.length; fi++) {
    const ef = f.event_filters[fi] as Filter;
    if (isCustomProperty(ef._property)) {
      const fpath = `where[${String(index)}].event_filters[${String(fi)}]`;
      errors.push(...validateCustomProperty(ef._property, fpath));
    }
  }
  return errors;
}

/**
 * The `where` position: `Filter` properties, with `FrequencyFilter`
 * entries descended into instead.
 *
 * @param where - Filter specification (non-null).
 * @returns Errors in source order.
 */
function scanWhere(where: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  const filters: readonly unknown[] = Array.isArray(where) ? where : [where];
  for (let i = 0; i < filters.length; i++) {
    const f = filters[i];
    if (f instanceof FrequencyFilter) {
      errors.push(...scanFrequencyFilter(f, i));
      continue;
    }
    if (f instanceof Filter && isCustomProperty(f._property)) {
      const fpath = filters.length > 1 ? `where[${String(i)}]` : "where";
      errors.push(...validateCustomProperty(f._property, fpath));
    }
  }
  return errors;
}

/**
 * The `events` position: each `Metric`'s own property, then its filters.
 *
 * @param events - Event specifications.
 * @returns Errors in source order.
 */
function scanEvents(events: readonly unknown[]): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const [idx, item] of events.entries()) {
    if (!(item instanceof Metric)) {
      continue;
    }
    if (isCustomProperty(item.property)) {
      errors.push(
        ...validateCustomProperty(item.property, `events[${String(idx)}]`),
      );
    }
    if (item.filters !== null && item.filters.length > 0) {
      errors.push(
        ...scanFiltersForCustomProperties(
          item.filters,
          `events[${String(idx)}]`,
        ),
      );
    }
  }
  return errors;
}

/**
 * The funnel `steps` position: `FunnelStep.filters` (instanceof-gated
 * in source — a bare event name has no filters).
 *
 * @param steps - Funnel step specifications.
 * @returns Errors in source order.
 */
function scanFunnelSteps(steps: readonly unknown[]): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const [idx, step] of steps.entries()) {
    if (
      step instanceof FunnelStep &&
      step.filters !== null &&
      step.filters.length > 0
    ) {
      errors.push(
        ...scanFiltersForCustomProperties(
          step.filters,
          `steps[${String(idx)}]`,
        ),
      );
    }
  }
  return errors;
}

/**
 * The flow `steps` position: `FlowStep.filters`.
 *
 * @param steps - Flow step specifications.
 * @returns Errors in source order.
 */
function scanFlowSteps(steps: readonly FlowStep[]): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const [idx, step] of steps.entries()) {
    if (step.filters !== null && step.filters.length > 0) {
      errors.push(
        ...scanFiltersForCustomProperties(
          step.filters,
          `steps[${String(idx)}]`,
        ),
      );
    }
  }
  return errors;
}

/**
 * The retention pair `[born_event, return_event]`: each event's filters,
 * labelled by role rather than index.
 *
 * @param events - The two retention events.
 * @returns Errors in source order.
 */
function scanRetentionEvents(
  events: readonly RetentionEvent[],
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const [idx, rev] of events.entries()) {
    if (rev.filters === null || rev.filters.length === 0) {
      continue;
    }

    const label = idx === 0 ? "born_event" : "return_event";
    errors.push(...scanFiltersForCustomProperties(rev.filters, label));
  }
  return errors;
}

/**
 * Scan all query positions for custom properties and validate each.
 *
 * @remarks
 * Collects `CustomPropertyRef`/`InlineCustomProperty` values from
 * `group_by`, `where`, `events`, funnel/flow steps and retention
 * events, and runs {@link validateCustomProperty} on each, in source
 * order.
 * @param options - The scan positions (all optional).
 * @returns List of validation errors; empty means all valid.
 * @example
 * ```ts
 * const errors = scanCustomProperties({
 *   where: [Filter.equals(new CustomPropertyRef({ id: 0 }), "x")],
 *   group_by: null,
 * });
 * // [ValidationError { path: "where", code: "CP1_INVALID_ID", … }]
 * ```
 * @see mixpanel_headless._internal.validation._scan_custom_properties
 */
export function scanCustomProperties(
  options: ScanCustomPropertiesOptions,
): ValidationError[] {
  const {
    group_by = null,
    where = null,
    events = null,
    funnel_steps = null,
    flow_steps = null,
    retention_events = null,
  } = options;
  const errors: ValidationError[] = [];

  if (group_by !== null && group_by !== undefined) {
    errors.push(...scanGroupBy(group_by));
  }
  if (where !== null && where !== undefined) {
    errors.push(...scanWhere(where));
  }
  if (events !== null) {
    errors.push(...scanEvents(events));
  }
  if (funnel_steps !== null) {
    errors.push(...scanFunnelSteps(funnel_steps));
  }
  if (flow_steps !== null) {
    errors.push(...scanFlowSteps(flow_steps));
  }
  if (retention_events !== null) {
    errors.push(...scanRetentionEvents(retention_events));
  }

  return errors;
}
