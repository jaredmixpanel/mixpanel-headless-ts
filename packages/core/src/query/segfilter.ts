/**
 * Convert `Filter` objects into the legacy segfilter dicts the flows
 * API consumes for step filters. The segfilter format differs from the
 * bookmark filter format in operator names, value encoding (stringified
 * numbers, MM/DD/YYYY dates) and layout (nested `property`/`filter`
 * dicts). Not exported from the package barrel; the flow query builders
 * are its only consumer.
 *
 * Two things a reader must not "clean up": operands are rendered with
 * Python `str()` semantics (`True`, `None`, `18.0`), never `String(x)`
 * — the number builder's two operand positions are the only sites in
 * the port where the conformance canonicalizer normalizes numeric
 * strings, and non-numeric operands get no such rescue; and the guard
 * order follows the Python source exactly (the `SG*` codes are the
 * cross-language contract, the messages are not).
 *
 * @see mixpanel_headless._internal.segfilter
 * @internal
 */

import {
  pythonIterableElements,
  pythonRepr,
  pythonStrValue,
  pythonTypeName,
  sortedByCodepoint,
  zfill,
} from "../compat/index.js";
import { AttributeError, ValueError } from "../compat/python-builtins.js";
import { ParamValidationError } from "../errors.js";
import type { Filter } from "../types/query-params/filter.js";

/** A segfilter JSON fragment — twin of Python's `dict[str, Any]`. */
export type SegfilterFragment = Record<string, unknown>;

// --- Constants ---

/** Maps `Filter._resource_type` to segfilter `property.source`. */
export const RESOURCE_TYPE_MAP: ReadonlyMap<string, string> = new Map([
  ["events", "properties"],
  ["people", "user"],
  ["cohorts", "cohort"],
  ["other", "other"],
]);

/** Maps string-typed Filter operators to segfilter operators. */
const STRING_OPERATOR_MAP: ReadonlyMap<string, string> = new Map([
  ["equals", "=="],
  ["does not equal", "!="],
  ["contains", "in"],
  ["does not contain", "not in"],
  ["is set", "set"],
  ["is not set", "not set"],
]);

/** Maps number-typed Filter operators to segfilter operators. */
const NUMBER_OPERATOR_MAP: ReadonlyMap<string, string> = new Map([
  ["is greater than", ">"],
  ["is less than", "<"],
  ["is equal to", "=="],
  ["equals", "=="],
  ["does not equal", "!="],
  ["is at least", ">="],
  ["is at most", "<="],
  ["is between", "><"],
  ["between", "><"],
  ["not between", "!><"],
  ["is set", "is set"],
  ["is not set", "is not set"],
]);

/** Maps datetime-typed Filter operators to segfilter operators. */
const DATETIME_OPERATOR_MAP: ReadonlyMap<string, string> = new Map([
  ["was on", "=="],
  ["was not on", "!="],
  // Segfilter operators describe the operand's relation to matching
  // values, not the event's relation to the operand. So
  // "was before <date>" becomes ">" because the operand date is greater
  // than the matching event dates.
  ["was before", ">"],
  ["was since", "<"],
  ["was in the", ">"],
  ["was not in the", ">"],
  ["was between", "><"],
  ["was not between", "!><"],
]);

/**
 * Operators that take no value (set/unset checks) — shared across
 * string and number types.
 */
const SETNESS_OPS: ReadonlySet<string> = new Set(["is set", "is not set"]);

/** Number operators that take a two-element list. */
const NUMBER_RANGE_OPS: ReadonlySet<string> = new Set([
  "is between",
  "between",
  "not between",
]);

/** Datetime operators that use relative time (quantity + unit). */
const DATETIME_RELATIVE_OPS: ReadonlySet<string> = new Set([
  "was in the",
  "was not in the",
]);

/** Datetime operators that take a two-date range. */
const DATETIME_RANGE_OPS: ReadonlySet<string> = new Set([
  "was between",
  "was not between",
]);

// --- Helpers ---

/**
 * Render an operand the way Python's `str(value)` would.
 *
 * @remarks
 * `pythonStr` already matches CPython for strings, bools, `None`,
 * containers and non-integral numbers. The one gap JS cannot close on
 * its own is the int-vs-float-ness of an integral value; where the
 * conformance rig preserves it (a PyFloat carrier), the carrier's
 * CPython `repr` spelling is used so `18.0` renders as `"18.0"` rather
 * than `"18"`, and the differential oracle compares byte-exact.
 * @param value - The operand value (`Filter._value` or one of its
 *   elements).
 * @returns The Python `str()` rendering.
 * @throws {@link TypeError} - When the value is outside the `pythonStr`
 *   domain (class instances, `undefined`) — out-of-annotation input only.
 */
function operandStr(value: unknown): string {
  // The carrier-aware `str(value)` body lives once in
  // `validation-shared.ts`; this wrapper keeps the rendering rationale
  // attached to the positions it governs.
  return pythonStrValue(value);
}

/**
 * Iterate a value the way a Python `for v in value` comprehension
 * would — the throwing wrapper around the shared
 * {@link pythonIterableElements}.
 *
 * @param value - The value being iterated.
 * @returns The drawn elements, in order.
 * @throws {@link TypeError} - When Python would raise
 *   `'X' object is not iterable`.
 */
function pythonIterate(value: unknown): unknown[] {
  const elements = pythonIterableElements(value);
  if (elements === null) {
    throw new TypeError(`'${pythonTypeName(value)}' object is not iterable`);
  }
  return elements;
}

/**
 * Convert a date string from YYYY-MM-DD to MM/DD/YYYY format.
 *
 * @param dateStr - Date in YYYY-MM-DD format (e.g. `"2026-01-15"`).
 * @returns Date in MM/DD/YYYY format (e.g. `"01/15/2026"`).
 * @throws {@link ValueError} - When the string does not split into
 *   exactly three `-`-separated parts (Python's tuple-unpack failure).
 * @example
 * ```ts
 * convertDateFormat("2026-01-15"); // "01/15/2026"
 * ```
 * @see mixpanel_headless._internal.segfilter._convert_date_format
 */
export function convertDateFormat(dateStr: string): string {
  const parts = dateStr.split("-");
  // Python's `year, month, day = ...` raises ValueError for any arity
  // but 3; TS destructuring would silently bind `undefined`.
  if (parts.length !== 3) {
    throw new ValueError(
      parts.length < 3
        ? `not enough values to unpack (expected 3, got ${String(parts.length)})`
        : "too many values to unpack (expected 3)",
    );
  }
  const [year, month, day] = parts as [string, string, string];
  return `${zfill(month, 2)}/${zfill(day, 2)}/${year}`;
}

// --- Type-specific filter builders ---

/**
 * Build the `filter` dict for a string-typed property.
 *
 * @param operator - The `Filter._operator` value (e.g. `"equals"`).
 * @param value - The `Filter._value` (list, str, or `null`).
 * @returns Dict with `operator` and `operand` keys.
 * @throws {@link ParamValidationError} - `SG1_UNKNOWN_STRING_OPERATOR`
 *   when `operator` is not in {@link STRING_OPERATOR_MAP}.
 * @example
 * ```ts
 * buildStringFilter("equals", ["US"]); // { operator: "==", operand: ["US"] }
 * buildStringFilter("is set", null); // { operator: "set", operand: "" }
 * ```
 * @see mixpanel_headless._internal.segfilter._build_string_filter
 */
export function buildStringFilter(
  operator: string,
  value: unknown,
): SegfilterFragment {
  if (!STRING_OPERATOR_MAP.has(operator)) {
    throw new ParamValidationError(
      `Unknown string operator '${operator}'. ` +
        `Valid operators: ${pythonRepr(sortedByCodepoint([...STRING_OPERATOR_MAP.keys()]))}`,
      "SG1_UNKNOWN_STRING_OPERATOR",
    );
  }

  const segOp = STRING_OPERATOR_MAP.get(operator);

  let operand: unknown;
  if (SETNESS_OPS.has(operator)) {
    operand = "";
  } else {
    operand = value;
  }

  return { operator: segOp, operand };
}

/**
 * Build the `filter` dict for a number-typed property.
 *
 * @remarks
 * Operands are stringified with Python `str()` semantics; these two
 * positions are the ones the module header describes.
 * @param operator - The `Filter._operator` value (e.g.
 *   `"is greater than"`).
 * @param value - The `Filter._value` (numeric, list, or `null`).
 * @returns Dict with `operator` and `operand` keys.
 * @throws {@link ParamValidationError} - `SG2_UNKNOWN_NUMBER_OPERATOR`
 *   when `operator` is not in {@link NUMBER_OPERATOR_MAP}.
 * @throws {@link TypeError} - When a range operator's value is not
 *   iterable (CPython's `'int' object is not iterable`).
 * @example
 * ```ts
 * buildNumberFilter("is greater than", 18); // { operator: ">", operand: "18" }
 * buildNumberFilter("is between", [1, 5]); // { operator: "><", operand: ["1", "5"] }
 * ```
 * @see mixpanel_headless._internal.segfilter._build_number_filter
 */
export function buildNumberFilter(
  operator: string,
  value: unknown,
): SegfilterFragment {
  if (!NUMBER_OPERATOR_MAP.has(operator)) {
    throw new ParamValidationError(
      `Unknown number operator '${operator}'. ` +
        `Valid operators: ${pythonRepr(sortedByCodepoint([...NUMBER_OPERATOR_MAP.keys()]))}`,
      "SG2_UNKNOWN_NUMBER_OPERATOR",
    );
  }

  const segOp = NUMBER_OPERATOR_MAP.get(operator);

  let operand: unknown;
  if (SETNESS_OPS.has(operator)) {
    operand = "";
  } else if (NUMBER_RANGE_OPS.has(operator)) {
    operand = pythonIterate(value).map((v) => operandStr(v));
  } else {
    operand = operandStr(value);
  }

  return { operator: segOp, operand };
}

/**
 * Build the `filter` dict for a boolean-typed property.
 *
 * @remarks
 * Boolean segfilters have no `operator` key — only `operand`, carrying
 * the operator string itself (`"true"` / `"false"`).
 * @param operator - The `Filter._operator` value.
 * @returns Dict with only an `operand` key.
 * @see mixpanel_headless._internal.segfilter._build_boolean_filter
 */
function buildBooleanFilter(operator: string): SegfilterFragment {
  return { operand: operator };
}

/**
 * Build the `filter` dict for a datetime-typed property.
 *
 * @remarks
 * Handles three date sub-types: absolute single date (MM/DD/YYYY
 * string), absolute range (two MM/DD/YYYY strings) and relative date
 * (verbatim quantity plus a pluralized `unit`).
 * @param operator - The `Filter._operator` value (e.g. `"was on"`).
 * @param value - The `Filter._value` (date string, list of date
 *   strings, or a quantity for relative dates).
 * @param dateUnit - The `Filter._date_unit` (e.g. `"day"`), or `null`
 *   for absolute date filters.
 * @returns Dict with `operator`, `operand` and optionally `unit`.
 * @throws {@link ParamValidationError} - `SG3_UNKNOWN_DATETIME_OPERATOR`
 *   when `operator` is not in {@link DATETIME_OPERATOR_MAP}.
 * @throws {@link ValueError} - When a date string is not
 *   `YYYY-MM-DD`-shaped (see {@link convertDateFormat}).
 * @throws {@link AttributeError} - When a range element is not a string
 *   (CPython: `'int' object has no attribute 'split'`).
 * @throws {@link TypeError} - When a range operator's value is not
 *   iterable.
 * @example
 * ```ts
 * buildDatetimeFilter("was on", "2026-01-15", null);
 * // { operator: "==", operand: "01/15/2026" }
 * buildDatetimeFilter("was in the", 7, "day");
 * // { operator: ">", operand: 7, unit: "days" }
 * ```
 * @see mixpanel_headless._internal.segfilter._build_datetime_filter
 */
export function buildDatetimeFilter(
  operator: string,
  value: unknown,
  dateUnit: string | null,
): SegfilterFragment {
  if (!DATETIME_OPERATOR_MAP.has(operator)) {
    throw new ParamValidationError(
      `Unknown datetime operator '${operator}'. ` +
        `Valid operators: ${pythonRepr(sortedByCodepoint([...DATETIME_OPERATOR_MAP.keys()]))}`,
      "SG3_UNKNOWN_DATETIME_OPERATOR",
    );
  }

  const segOp = DATETIME_OPERATOR_MAP.get(operator);
  const result: SegfilterFragment = { operator: segOp };

  if (DATETIME_RELATIVE_OPS.has(operator)) {
    result["operand"] = value;
    // Python: `if date_unit is not None` — an explicit None test, so an
    // empty-string unit still emits `unit: "s"`.
    if (dateUnit !== null) {
      result["unit"] = `${dateUnit}s`;
    }
  } else if (DATETIME_RANGE_OPS.has(operator)) {
    const converted: string[] = [];
    for (const element of pythonIterate(value)) {
      if (typeof element !== "string") {
        // Python evaluates `date_str.split("-")` on the element.
        throw new AttributeError(
          `'${pythonTypeName(element)}' object has no attribute 'split'`,
        );
      }
      converted.push(convertDateFormat(element));
    }
    result["operand"] = converted;
  } else {
    result["operand"] = convertDateFormat(operandStr(value));
  }

  return result;
}

// --- Public API ---

/**
 * Convert a Filter to segfilter format for flows step filters.
 *
 * @param f - A `Filter` instance created via one of its factories
 *   (e.g. `Filter.equals()`, `Filter.greaterThan()`).
 * @returns A dict with the segfilter structure: `property`
 *   (`name`/`source`/`type`), `type`, `selected_property_type` and
 *   `filter` (`operator`/`operand`, plus `unit` for relative dates).
 * @throws {@link ParamValidationError} - `SG4_UNSUPPORTED_PROPERTY_TYPE`
 *   when the filter's property type is not recognized, or
 *   `SG1`/`SG2`/`SG3` from the type-specific builders.
 * @example
 * ```ts
 * const entry = buildSegfilterEntry(Filter.equals("country", "US"));
 * // entry.filter is { operator: "==", operand: ["US"] }
 * ```
 * @see mixpanel_headless._internal.segfilter.build_segfilter_entry
 */
export function buildSegfilterEntry(f: Filter): SegfilterFragment {
  const propType: string = f._property_type;
  // Python: `RESOURCE_TYPE_MAP.get(f._resource_type, f._resource_type)`
  // — unknown resource types fall back to themselves.
  const source = RESOURCE_TYPE_MAP.get(f._resource_type) ?? f._resource_type;

  let filterDict: SegfilterFragment;
  switch (propType) {
    case "string": {
      filterDict = buildStringFilter(f._operator, f._value);

      break;
    }
    case "number": {
      filterDict = buildNumberFilter(f._operator, f._value);

      break;
    }
    case "boolean": {
      filterDict = buildBooleanFilter(f._operator);

      break;
    }
    case "datetime": {
      filterDict = buildDatetimeFilter(f._operator, f._value, f._date_unit);

      break;
    }
    default: {
      throw new ParamValidationError(
        `Unsupported property type '${propType}'. ` +
          `Supported types: string, number, boolean, datetime`,
        "SG4_UNSUPPORTED_PROPERTY_TYPE",
      );
    }
  }

  return {
    property: {
      name: f._property,
      source,
      type: propType,
    },
    type: propType,
    selected_property_type: propType,
    filter: filterDict,
  };
}
