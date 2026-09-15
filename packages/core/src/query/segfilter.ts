/**
 * Filter-to-segfilter conversion for flows step filters — whole-file TS
 * twin of `src/mixpanel_headless/_internal/segfilter.py` (323 LOC;
 * Python revision: `ts-port/phase2-contract-support` HEAD). Batch B3,
 * shard K3 (`docs/history/phase3/design/b3-packets.md` §"Packet K3").
 *
 * Converts `Filter` objects into the legacy segfilter dict format
 * consumed by the Mixpanel flows API. The segfilter format differs from
 * the bookmark filter format in operator names, value encoding
 * (stringified numbers, MM/DD/YYYY dates) and structural layout
 * (nested `property`/`filter` dicts).
 *
 * **Contract notes a reader must not "clean up":**
 *
 * - **R10.11** — `_build_number_filter`'s two `str(...)` positions
 *   (`segfilter.py:187,189`) are the ONLY sites in the whole port where
 *   the conformance canonicalizer normalizes numeric strings
 *   (`canonical.ts:21,52-73`, rule 4). NON-numeric operands reaching the
 *   same positions (`str(True)` → `"True"`, `str(None)` → `"None"`) get
 *   no such rescue, so rendering goes through {@link operandStr}:
 *   `pythonStr` semantics for everything, with a PyFloat carrier
 *   rendered from its CPython `repr` spelling (`18.0` stays `"18.0"`).
 *   `String(x)` is never used — `String(true)` is `"true"`, Python's is
 *   `"True"` (watchlist #8).
 * - **Watchlist #1 (tuple-unpack arity)** —
 *   {@link convertDateFormat}'s `year, month, day = date_str.split("-")`
 *   raises `ValueError` in Python when the split does not yield exactly
 *   three parts. TS destructuring would silently bind `undefined`, so
 *   the length is checked explicitly and the {@link ValueError} twin is
 *   thrown (b3-packets.md §K3 Cautions #9).
 * - **R4.8** — every lookup table is a `ReadonlyMap` / `ReadonlySet`.
 * - Guard order follows Python source order exactly; the SG* codes are
 *   the cross-language contract, messages are not.
 *
 * Python keeps this module `_internal`; the TS twin is likewise NOT
 * exported from the package barrel. Its only importer is
 * `workspace.py` → flow step filters (B5-S2
 * `build_flow_params`/`query_flow`).
 *
 * @module query/segfilter
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

// =============================================================================
// Constants (segfilter.py)
// =============================================================================

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
  // than the matching event dates (`segfilter.py:76-79`).
  ["was before", ">"],
  ["was since", "<"],
  ["was in the", ">"],
  ["was not in the", ">"],
  ["was between", "><"],
  ["was not between", "!><"],
]);

/**
 * Operators that take no value (set/unset checks) — shared across
 * string and number types (`segfilter.py`).
 */
const SETNESS_OPS: ReadonlySet<string> = new Set(["is set", "is not set"]);

/** Number operators that take a two-element list (`segfilter.py`). */
const NUMBER_RANGE_OPS: ReadonlySet<string> = new Set([
  "is between",
  "between",
  "not between",
]);

/**
 * Datetime operators that use relative time (quantity + unit)
 * (`segfilter.py`).
 */
const DATETIME_RELATIVE_OPS: ReadonlySet<string> = new Set([
  "was in the",
  "was not in the",
]);

/** Datetime operators that take a two-date range (`segfilter.py`). */
const DATETIME_RANGE_OPS: ReadonlySet<string> = new Set([
  "was between",
  "was not between",
]);

// =============================================================================
// Helpers
// =============================================================================

/**
 * Render an operand the way Python's `str(value)` would
 * (`segfilter.py:187,189,249`).
 *
 * `pythonStr` already matches CPython for strings, bools, `None`,
 * containers and non-integral numbers. The one gap JS cannot close on
 * its own is int-vs-float-ness of an integral value; where the
 * conformance rig preserves it (a PyFloat carrier), the carrier's
 * CPython `repr` spelling is used so `18.0` renders as `"18.0"` rather
 * than `"18"` (R10.11's canonicalizer rescue then becomes unnecessary
 * for carried values, and the differential oracle compares byte-exact).
 *
 * @param value - The operand value (`Filter._value` or one of its
 *   elements).
 * @returns The Python `str()` rendering.
 * @throws TypeError - When the value is outside the `pythonStr` domain
 *   (class instances, `undefined`) — out-of-annotation input only.
 */
function operandStr(value: unknown): string {
  // R10.8 (extracted at B3-K4, the pattern's second ported site —
  // `user_builders.py` `_format_value`): the carrier-aware
  // `str(value)` body lives once in `validation-shared.ts`. Behavior is
  // unchanged; this wrapper keeps the R10.11 documentation attached to
  // the positions it governs.
  return pythonStrValue(value);
}

/**
 * Iterate a value the way a Python `for v in value` comprehension
 * would (`segfilter.py:187,247`) — the throwing wrapper around the
 * shared {@link pythonIterableElements} (R10.8: one iteration model,
 * shared with `transforms.pythonDictCopy`).
 *
 * @param value - The value being iterated.
 * @returns The drawn elements, in order.
 * @throws TypeError - When Python would raise
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
 * Convert a date string from YYYY-MM-DD to MM/DD/YYYY format
 * (`segfilter.py`).
 *
 * @param dateStr - Date in YYYY-MM-DD format (e.g. `"2026-01-15"`).
 * @returns Date in MM/DD/YYYY format (e.g. `"01/15/2026"`).
 * @throws ValueError - When the string does not split into exactly
 *   three `-`-separated parts (Python's tuple-unpack failure;
 *   watchlist #1).
 * @example
 * ```typescript
 * convertDateFormat("2026-01-15"); // "01/15/2026"
 * ```
 */
export function convertDateFormat(dateStr: string): string {
  const parts = dateStr.split("-");
  // Watchlist #1: Python's `year, month, day = ...` raises ValueError
  // for any arity but 3; TS destructuring would bind `undefined`.
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

// =============================================================================
// Type-specific filter builders
// =============================================================================

/**
 * Build the `filter` dict for a string-typed property
 * (`segfilter.py`).
 *
 * @param operator - The `Filter._operator` value (e.g. `"equals"`).
 * @param value - The `Filter._value` (list, str, or `null`).
 * @returns Dict with `operator` and `operand` keys.
 * @throws ParamValidationError - `SG1_UNKNOWN_STRING_OPERATOR` when
 *   `operator` is not in {@link STRING_OPERATOR_MAP}.
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
 * Build the `filter` dict for a number-typed property
 * (`segfilter.py`).
 *
 * The two operand-rendering positions here are the R10.11 sites (see
 * the module header).
 *
 * @param operator - The `Filter._operator` value (e.g.
 *   `"is greater than"`).
 * @param value - The `Filter._value` (numeric, list, or `null`).
 * @returns Dict with `operator` and `operand` keys.
 * @throws ParamValidationError - `SG2_UNKNOWN_NUMBER_OPERATOR` when
 *   `operator` is not in {@link NUMBER_OPERATOR_MAP}.
 * @throws TypeError - When a range operator's value is not iterable
 *   (CPython's `'int' object is not iterable`).
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
 * Build the `filter` dict for a boolean-typed property
 * (`segfilter.py`).
 *
 * Boolean segfilters have NO `operator` key — only `operand`, carrying
 * the operator string itself (`"true"` / `"false"`).
 *
 * @param operator - The `Filter._operator` value.
 * @returns Dict with only an `operand` key.
 */
function buildBooleanFilter(operator: string): SegfilterFragment {
  return { operand: operator };
}

/**
 * Build the `filter` dict for a datetime-typed property
 * (`segfilter.py`).
 *
 * Handles three date sub-types: absolute single date (MM/DD/YYYY
 * string), absolute range (two MM/DD/YYYY strings) and relative date
 * (verbatim quantity plus a pluralized `unit`).
 *
 * @param operator - The `Filter._operator` value (e.g. `"was on"`).
 * @param value - The `Filter._value` (date string, list of date
 *   strings, or a quantity for relative dates).
 * @param dateUnit - The `Filter._date_unit` (e.g. `"day"`), or `null`
 *   for absolute date filters.
 * @returns Dict with `operator`, `operand` and optionally `unit`.
 * @throws ParamValidationError - `SG3_UNKNOWN_DATETIME_OPERATOR` when
 *   `operator` is not in {@link DATETIME_OPERATOR_MAP}.
 * @throws ValueError - When a date string is not `YYYY-MM-DD`-shaped
 *   (see {@link convertDateFormat}).
 * @throws AttributeError - When a range element is not a string
 *   (CPython: `'int' object has no attribute 'split'`).
 * @throws TypeError - When a range operator's value is not iterable.
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
    // empty-string unit still emits `unit: "s"` (watchlist #6).
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

// =============================================================================
// Public API
// =============================================================================

/**
 * Convert a Filter to segfilter format for flows step filters
 * (`segfilter.py`).
 *
 * @param f - A `Filter` instance created via one of its factories
 *   (e.g. `Filter.equals()`, `Filter.greaterThan()`).
 * @returns A dict with the segfilter structure: `property`
 *   (`name`/`source`/`type`), `type`, `selected_property_type` and
 *   `filter` (`operator`/`operand`, plus `unit` for relative dates).
 * @throws ParamValidationError - `SG4_UNSUPPORTED_PROPERTY_TYPE` when
 *   the filter's property type is not recognized, or `SG1`/`SG2`/`SG3`
 *   from the type-specific builders.
 * @example
 * ```typescript
 * const entry = buildSegfilterEntry(Filter.equals("country", "US"));
 * // entry.filter -> { operator: "==", operand: ["US"] }
 * ```
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
