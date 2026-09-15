/**
 * Shared validation helpers, custom-property scanning, and the
 * difflib-faithful fuzzy matcher.
 *
 * Internal module — not exported from the package barrel.
 *
 * Source: `src/mixpanel_headless/_internal/validation.py` (ranges
 * 91-508: custom-property scan, shared tables/helpers, fuzzy helpers,
 * `_validate_data_group_id`). Python revision:
 * `ts-port/phase2-contract-support` HEAD.
 *
 * Fidelity notes (b2-packets.md Cautions):
 * - §3/§4 (R11.7): `pythonStrip` everywhere Python calls `.strip()`;
 *   `_INVISIBLE_RE` is built from the pinned
 *   `compat/whitespace.gen.ts` table (Python str-pattern `\s` ==
 *   `str.isspace()` set), never a JS `\s` class.
 * - §8: Python `float` values reach TS either as non-integral /
 *   non-finite JS numbers or as the conformance rig's PyFloat carrier
 *   duck-shape `{ spelling: string }`; `compat/python-values.ts`
 *   (`isFloatCarrier`, `isPythonFloat`) and {@link isFiniteNumber}
 *   classify both spellings.
 * - §9 (R11.6): `len(str)` bounds count codepoints via `cpLength`.
 * - §6: {@link suggest} is a faithful `difflib.get_close_matches` port
 *   (`compat/difflib.ts`) — candidates from `sortedByCodepoint(valid)`,
 *   n=3, cutoff=0.5, `heapq.nlargest` tie order.
 *
 * @module validation-shared
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

// =============================================================================
// Module constants (validation.py:91-92, 338-366, 1162-1176, 1484-1495)
// =============================================================================

/** Port of `_CP_INPUT_KEY_RE` (`validation.py:91`) — ASCII-only class. */
const CP_INPUT_KEY_RE = /^[A-Z]$/;

/** Port of `_CP_MAX_FORMULA_LENGTH` (`validation.py:92`). */
const CP_MAX_FORMULA_LENGTH = 20_000;

/**
 * Port of `_SESSION_MATH` (`validation.py:338`): session-based math
 * types requiring `conversion_window_unit='session'`.
 */
export const SESSION_MATH: ReadonlySet<string> = new Set([
  "conversion_rate_session",
]);

/**
 * Port of `_FORMULA_POSITION_RE` (`validation.py:342`) — ASCII-only
 * class, safe as a JS regex.
 */
export const FORMULA_POSITION_RE: RegExp = /[A-Z]/g;

/**
 * Codepoint test for the `_CONTROL_CHAR_RE` class (`validation.py:343`,
 * `[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]`).
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
 * The literal extras of `_INVISIBLE_RE` (`validation.py:363`) beyond
 * the Python `\s` class: U+200B ZWSP, U+200C ZWNJ, U+200D ZWJ,
 * U+FEFF BOM, U+00AD SOFT HYPHEN, U+2060 WORD JOINER.
 */
const INVISIBLE_EXTRAS: ReadonlySet<number> = new Set([
  0x200b, 0x200c, 0x200d, 0xfeff, 0x00ad, 0x2060,
]);

/** Port of `_MAX_LAST_DAYS` (`validation.py:364`) — 10 years. */
export const MAX_LAST_DAYS = 3650;

/** Port of `_MAX_ROLLING` (`validation.py:365`) — rolling window cap. */
export const MAX_ROLLING = 365;

/**
 * Port of `_MAX_FILTER_VALUES` (`validation.py:366`) — server rejects
 * very large filter value lists. Consumed by the V1b bookmark
 * validators (B20B/B21); declared here with the other module
 * constants exactly as in the Python source.
 */
export const MAX_FILTER_VALUES = 1000;

/**
 * Port of `_VALID_RETENTION_MATH_PUBLIC` (`validation.py:1162-1164`):
 * public-facing retention math types (Layer 1).
 */
export const VALID_RETENTION_MATH_PUBLIC: ReadonlySet<string> = new Set([
  "retention_rate",
  "unique",
  "total",
  "average",
]);

/**
 * Port of `_VALID_RETENTION_MODES` (`validation.py:1172`): valid
 * display modes for retention queries.
 */
export const VALID_RETENTION_MODES: ReadonlySet<string> = new Set([
  "curve",
  "trends",
  "table",
]);

/** Port of `_MAX_RETENTION_BUCKETS` (`validation.py:1175`). */
export const MAX_RETENTION_BUCKETS = 730;

/** Port of `_MAX_FLOW_STEPS_DIRECTION` (`validation.py:1484`). */
export const MAX_FLOW_STEPS_DIRECTION = 5;

/** Port of `_MAX_FLOW_CARDINALITY` (`validation.py:1487`). */
export const MAX_FLOW_CARDINALITY = 50;

/**
 * Port of `_FLOW_MAX_WINDOW` (`validation.py:1490-1494`): maximum
 * conversion window per unit (366-day equivalent for a leap year).
 * ReadonlyMap per R4.8.
 */
export const FLOW_MAX_WINDOW: ReadonlyMap<string, number> = new Map([
  ["month", 12],
  ["week", 52],
  ["day", 366],
]);

// =============================================================================
// Character / date / finiteness helpers (validation.py:346-402)
// =============================================================================

/**
 * Check whether a string contains ASCII control characters.
 *
 * Port of `contains_control_chars` (`validation.py:346-360`): detects
 * `\x00-\x08`, `\x0b`, `\x0c`, `\x0e-\x1f`, and `\x7f` (DEL).
 *
 * @param s - The string to check.
 * @returns True if `s` contains at least one control character.
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
 * Port of `_INVISIBLE_RE.match(s)` truthiness (`validation.py:363`):
 * true when EVERY codepoint of `s` is Python-`\s` whitespace (the
 * pinned `str.isspace()` table) or one of the six invisible literals.
 * True for the empty string (`[...]*` matches zero chars), exactly as
 * the Python regex. Python's `$`-before-trailing-newline nuance is a
 * no-op here because `\n` is itself in the class.
 *
 * @param s - The string to classify.
 * @returns True when the string is invisible-only.
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
 * (`Py_UNICODE_ISDECIMAL`), NOT the ASCII-only JS `\d`.
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
 * Port of `_DATE_RE.match(s)` truthiness (`validation.py:341`,
 * pattern `^\d{4}-\d{2}-\d{2}$`) with Python `re` semantics:
 *
 * - `\d` matches Unicode decimal digits (category Nd), not just
 *   ASCII — see {@link isDecimalDigit};
 * - `$` also matches just before ONE trailing `\n`.
 *
 * @param s - Candidate date string.
 * @returns True when the Python regex would match.
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

/** Days per month in a non-leap year (calendar table, watchlist #5). */
const DAYS_IN_MONTH: readonly number[] = [
  31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
];

/**
 * Check if a YYYY-MM-DD string is a valid calendar date.
 *
 * Port of `_is_valid_date` (`validation.py:369-384`), which defers to
 * `datetime.date.fromisoformat`. Implemented as a PURE calendar check
 * (watchlist #5 — never `new Date(...)`): Gregorian leap rule, month
 * 1-12, day vs month length, year 1-9999 (`date.MINYEAR`).
 *
 * Contract note: callers only reach this through the
 * {@link matchesDateRe} gate, whose accepted set is wider than ASCII
 * (Unicode Nd digits, one trailing newline). CPython's
 * `fromisoformat` C parser accepts ONLY ASCII digits in exactly
 * `YYYY-MM-DD` here, so any gated-but-non-ASCII spelling returns
 * false — matching Python's `ValueError → False` path
 * (`fromisoformat`'s wider grammar — basic format, week dates — can
 * never pass the gate, so it is intentionally not reproduced).
 *
 * @param dateStr - Date string (regex-gated by the caller).
 * @returns True if the date is a valid calendar date.
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
 * Convert a pre-validated run of ASCII digits to a number (no
 * `parseInt`/`Number` per R11.7; input is guaranteed `[0-9]+` by the
 * caller's regex).
 *
 * @param digits - ASCII digit string.
 * @returns The base-10 integer value.
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
 * Port of `_is_finite` (`validation.py:387-402`): `None` → true;
 * `float` → `math.isfinite`; anything else (ints included) → true.
 * PyFloat carriers are classified per Caution §8: the non-finite
 * spellings are the only non-finite carriers.
 *
 * @param value - Numeric value to check (loose input domain, R4.9).
 * @returns True if finite or not a float at all.
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

// =============================================================================
// Error accumulation
// =============================================================================

/**
 * Append one `ValidationError` to a validator's list — the only
 * capability a per-rule helper receives, so a rule can ADD errors but
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

// =============================================================================
// Fuzzy matching helpers (validation.py:410-464)
// =============================================================================

/**
 * Find closest matches for a mistyped enum value.
 *
 * Port of `_suggest` (`validation.py:410-428`): candidates are
 * `sorted(valid)` (codepoint sort, R11.5), n=3, cutoff=0.5; `None`
 * when nothing clears the cutoff.
 *
 * @param value - The invalid value to match against.
 * @param valid - Set of valid values.
 * @param n - Maximum number of suggestions (default 3).
 * @param cutoff - Minimum similarity ratio (default 0.5).
 * @returns Frozen array of closest matches, or null if none.
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

/**
 * Build a validation error for an invalid enum value with suggestions.
 *
 * Port of `_enum_error` (`validation.py:431-464`). Message text is
 * display-only (R5.4) but ported faithfully, including the
 * `sorted(valid)[:5]` sample list repr in the no-suggestion branch.
 *
 * @param path - JSONPath-like location.
 * @param field - Human-readable field name.
 * @param value - The invalid value.
 * @param valid - Set of valid values.
 * @param code - Machine-readable error code.
 * @param severity - Error severity level (default `"error"`).
 * @returns ValidationError with fuzzy-matched suggestions.
 */
export function enumError(
  path: string,
  field: string,
  value: string,
  valid: ReadonlySet<string>,
  code: string,
  severity: "error" | "warning" = "error",
): ValidationError {
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

// =============================================================================
// data_group_id validation (validation.py:472-508)
// =============================================================================

/**
 * Validate the `data_group_id` parameter if provided.
 *
 * Port of `_validate_data_group_id` (`validation.py:472-508`). Guard
 * order matters (Caution §8): the bool reject fires BEFORE the int
 * check because Python `bool` IS `int`.
 *
 * @param dataGroupId - Data group ID to validate (loose input, R4.9);
 *   `null`/absent skips validation.
 * @returns List with one `ValidationError` if invalid, empty otherwise.
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

// =============================================================================
// Custom property validation + scanning (validation.py:95-335)
// =============================================================================

/**
 * Validate a custom property specification (rules CP1-CP6).
 *
 * Port of `_validate_custom_property` (`validation.py:95-188`).
 * CP5's formula length bound counts CODEPOINTS (`cpLength`, R11.6).
 *
 * @param prop - A `CustomPropertyRef` or `InlineCustomProperty`.
 * @param path - JSONPath-like location for error reporting.
 * @returns List of validation errors; empty means valid.
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
 * Port of `_scan_filters_for_custom_properties`
 * (`validation.py:191-215`).
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
 * all-default-`None` Python signature (R3.9: absent and `null` are
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
 * Scan all query positions for custom properties and validate.
 *
 * Port of `_scan_custom_properties` (`validation.py:218-335`):
 * collects `CustomPropertyRef`/`InlineCustomProperty` values from
 * group_by, where, events, funnel/flow steps and retention events,
 * and runs {@link validateCustomProperty} on each, in source order.
 *
 * @param options - The scan positions (all optional).
 * @returns List of validation errors; empty means all valid.
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
