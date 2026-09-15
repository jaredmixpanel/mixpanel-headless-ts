/**
 * Layer-2 bookmark validation — TS port of the bookmark half of
 * `src/mixpanel_headless/_internal/validation.py` (B2 shard V1b).
 *
 * Python ranges ported here (re-read before touching anything):
 * `validation.py:1772-1877` (`validate_flow_bookmark`, FLB1–FLB6),
 * `:2288-2415` (`validate_bookmark`, B1–B26 dispatch), `:2423-3018`
 * (the six clause sub-validators) and `:3036-3090`
 * (`validate_sorting_block`). The pydantic mirror the sorting wrapper
 * delegates to lives in `../bookmarks/schema-sorting.ts` (R10.8: one
 * home, grown by B3-K1).
 *
 * Porting invariants that this module is built on:
 *
 * - **Emission order is contract** (Caution §11): every
 *   `errors.append` / `errors.extend` is ported in Python source order.
 * - **Dict membership** uses `Object.hasOwn`, never the `in` operator
 *   (watchlist #7: `'toString' in obj` is true in JS, `False` in
 *   Python) — see {@link dictGet} / {@link hasKey}.
 * - **Truthiness** is Python's, not JS's (watchlist #6): `[]`, `{}`,
 *   `""` and `0` are falsy — see {@link pythonTruthy}, used by B18.
 * - **`bool` IS `int` in Python** (Caution §8) and the two int guards
 *   in this file differ on purpose: B18B rejects bools explicitly
 *   (`validation.py:2834`), B22 does NOT (`:2515`), so `id: true`
 *   passes B22 exactly as it does in CPython.
 * - Blank checks go through `pythonStrip` (R11.7) — never `.trim()`.
 *
 * R10.7 note (resolved at B2-BIND, 2026-08-15): Python's `value not in
 * FROZENSET` guards raise `TypeError: unhashable type` when the dict
 * carries a `list`/`dict` at the checked key, because `x in frozenset`
 * hashes `x`. B2-M2 originally shipped the total-function spelling and
 * flagged the deviation (M2 notes finding 2); the B2-BIND differential
 * fuzz then surfaced it as a real divergence (repro
 * `2026-08-15-validation-validate_bookmark.json`), so bug-compatibility
 * won: every membership site now calls the shared
 * `requireHashable(...)` guard (validation-shared.ts) at exactly the
 * position CPython hashes — 16 probe-verified sites (validation.py
 * :1832/:1845/:2483/:2549/:2618/:2647/:2662/:2674/:2712/:2754/:2767/
 * :2846/:2860/:2873/:2981/:2995), locked by
 * `test/query/validation-unhashable.test.ts`.
 *
 * @module query/validation-bookmark
 * @internal
 */

import {
  MATH_REQUIRING_PROPERTY,
  VALID_CHART_TYPES,
  VALID_FILTER_OPERATORS,
  VALID_FILTERS_DETERMINER,
  VALID_FLOWS_CHART_TYPES,
  VALID_FLOWS_COUNT_TYPES,
  VALID_MATH_FUNNELS,
  VALID_MATH_INSIGHTS,
  VALID_MATH_RETENTION,
  VALID_METRIC_TYPES,
  VALID_PER_USER_AGGREGATIONS,
  VALID_PROPERTY_TYPES,
  VALID_RESOURCE_TYPES,
  VALID_TIME_UNITS,
} from "../bookmarks/enums.js";
import {
  sortingCodeMapper,
  validateInsightsBookmarkSortConfig,
  validateWithPydantic,
} from "../bookmarks/schema-sorting.js";
import {
  dictGet,
  floatCarrierValue,
  isFloatCarrier,
  isPythonDict,
  isPythonFloat,
  isPythonInt,
  pythonStrip,
  pythonStrLoose,
  requireHashable,
} from "../compat/index.js";
import { ValidationError } from "../errors.js";
import {
  enumError,
  isFiniteNumber,
  MAX_FILTER_VALUES,
} from "./validation-shared.js";

// =============================================================================
// Python-dict / Python-truthiness helpers
// =============================================================================

/** Loose dict, the TS analogue of Python's `dict[str, Any]`. */
type Dict = Record<string, unknown>;

/**
 * TS analogue of `isinstance(value, dict)`.
 *
 * Delegates to the shared {@link isPythonDict} discrimination (B2
 * arbiter fix F1): PyFloat carriers (Python floats) and reconstructed
 * class instances are NOT dicts, exactly as in Python.
 *
 * @param value - Candidate value.
 * @returns True when Python's `isinstance(value, dict)` would hold.
 */
function isDict(value: unknown): value is Dict {
  return isPythonDict(value);
}

/**
 * TS analogue of `key in mapping` for a Python dict — own keys only
 * (watchlist #7).
 *
 * @param obj - The dict.
 * @param key - The key to test.
 * @returns True when the dict carries the key itself.
 */
function hasKey(obj: Dict, key: string): boolean {
  return Object.hasOwn(obj, key);
}

/**
 * TS analogue of `value is None` — covers both a JSON `null` and an
 * absent key (Python cannot distinguish them through `.get()`).
 *
 * @param value - Candidate value.
 * @returns True when Python would see `None`.
 */
function isNone(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

/**
 * TS analogue of Python `bool(value)` (watchlist #6).
 *
 * Differences from JS truthiness that matter here: empty list, empty
 * dict and `0.0` are falsy; `float('nan')` is TRUTHY in Python.
 *
 * @param value - Candidate value.
 * @returns Python's truth value.
 */
function pythonTruthy(value: unknown): boolean {
  if (isNone(value) || value === false) {
    return false;
  }
  if (value === true) {
    return true;
  }
  if (typeof value === "number") {
    // Python: `bool(0.0) is False`, `bool(float('nan')) is True`.
    return Number.isNaN(value) || value !== 0;
  }
  if (typeof value === "string") {
    return value.length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (isFloatCarrier(value)) {
    const n = floatCarrierValue(value);
    return Number.isNaN(n) || n !== 0;
  }
  if (isDict(value)) {
    return Object.keys(value).length > 0;
  }
  return true;
}

/**
 * TS analogue of Python `value == target` for a numeric literal target.
 *
 * Python's `==` crosses the int/float boundary (`2.0 == 2` is true) but
 * not the bool/int-value boundary in the way JS `==` would
 * (`True == 2` is false because `True` equals `1`).
 *
 * @param value - Candidate value.
 * @param target - The numeric literal compared against.
 * @returns True when Python would consider them equal.
 */
function pythonEqualsNumber(value: unknown, target: number): boolean {
  if (typeof value === "number") {
    return value === target;
  }
  if (typeof value === "boolean") {
    return (value ? 1 : 0) === target;
  }
  if (isFloatCarrier(value)) {
    return floatCarrierValue(value) === target;
  }
  return false;
}

/**
 * TS analogue of `isinstance(value, int)` WITHOUT the bool exclusion —
 * Python's `bool` is a subclass of `int`, and `validation.py:2515`
 * (B22) relies on that.
 *
 * @param value - Candidate value.
 * @returns True when Python's `isinstance(value, int)` holds.
 */
function isPythonIntWithBools(value: unknown): boolean {
  return typeof value === "boolean" || isPythonInt(value);
}

/**
 * Numeric value of an `isinstance(x, int)`-passing value, for the
 * ordering comparisons that follow such a guard.
 *
 * @param value - An int-like value.
 * @returns Its numeric value (`True` → 1, `False` → 0).
 */
function pythonIntValue(value: unknown): number {
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  return value as number;
}

// =============================================================================
// Flow bookmark validation (FLB1-FLB6) — validation.py:1772-1877
// =============================================================================

/**
 * Validate a flat flow bookmark params dict after construction (Layer 2).
 *
 * Port of `validate_flow_bookmark` (`validation.py:1772-1877`). Flows
 * use a flat structure without `sections`/`displayOptions`, so this is
 * a separate function from {@link validateBookmark}.
 *
 * @param params - The flow bookmark params dict (flat structure with
 *   `steps`, `date_range`, `chartType`, `count_type` and `version`
 *   keys). Loosely typed on purpose (R4.9/R10.10): the B5 facade
 *   forwards raw user input here.
 * @returns List of validation errors. Empty means the bookmark is valid.
 * @example
 * ```ts
 * const errors = validateFlowBookmark({
 *   steps: [{ event: "Purchase", forward: 3, reverse: 0 }],
 *   date_range: {
 *     type: "in the last",
 *     from_date: { unit: "day", value: 30 },
 *     to_date: "$now",
 *   },
 *   chartType: "sankey",
 *   count_type: "unique",
 *   version: 2,
 * });
 * // []
 * ```
 */
export function validateFlowBookmark(params: Dict): ValidationError[] {
  const errors: ValidationError[] = [];

  // FLB1: steps must be present and non-empty
  const steps = dictGet(params, "steps");
  if (!Array.isArray(steps) || steps.length === 0) {
    errors.push(
      new ValidationError(
        "steps",
        "Flow bookmark must have at least one step",
        "FLB1_EMPTY_STEPS",
      ),
    );
  } else {
    // FLB2: Each step event must be non-empty
    for (const [i, step] of steps.entries()) {
      if (!isDict(step)) {
        continue;
      }

      const event = dictGet(step, "event");
      if (typeof event !== "string" || pythonStrip(event).length === 0) {
        errors.push(
          new ValidationError(
            `steps[${String(i)}].event`,
            "Step event name must be a non-empty string",
            "FLB2_EMPTY_STEP_EVENT",
          ),
        );
      }
    }
  }

  // FLB3: count_type validation
  const countType = dictGet(params, "count_type");
  requireHashable(countType); // R10.7: Python hashes in `not in` (:1832)
  if (
    !isNone(countType) &&
    !(typeof countType === "string" && VALID_FLOWS_COUNT_TYPES.has(countType))
  ) {
    errors.push(
      enumError(
        "count_type",
        "count_type",
        pythonStrLoose(countType),
        VALID_FLOWS_COUNT_TYPES,
        "FLB3_INVALID_COUNT_TYPE",
      ),
    );
  }

  // FLB4: chartType validation
  const chartType = dictGet(params, "chartType");
  requireHashable(chartType); // R10.7: Python hashes in `not in` (:1845)
  if (
    !isNone(chartType) &&
    !(typeof chartType === "string" && VALID_FLOWS_CHART_TYPES.has(chartType))
  ) {
    errors.push(
      enumError(
        "chartType",
        "chartType",
        pythonStrLoose(chartType),
        VALID_FLOWS_CHART_TYPES,
        "FLB4_INVALID_CHART_TYPE",
      ),
    );
  }

  // FLB5: date_range must be present
  if (!hasKey(params, "date_range")) {
    errors.push(
      new ValidationError(
        "date_range",
        "Flow bookmark requires a date_range",
        "FLB5_MISSING_DATE_RANGE",
      ),
    );
  }

  // FLB6: version must be 2
  const version = dictGet(params, "version");
  if (!pythonEqualsNumber(version, 2)) {
    errors.push(
      new ValidationError(
        "version",
        `Flow bookmark version must be 2 (got ${pythonStrLoose(version)})`,
        "FLB6_INVALID_VERSION",
      ),
    );
  }

  return errors;
}

// =============================================================================
// Layer 2: Bookmark structure validation (B1-B26) — validation.py:2288-2415
// =============================================================================

/**
 * Options for {@link validateBookmark} (Python kwonly args, R3.9/R4.10).
 */
export interface ValidateBookmarkOptions {
  /**
   * The bookmark type context. Default `"insights"`. Affects which math
   * types are considered valid.
   */
  readonly bookmark_type?: string;
}

/**
 * Validate bookmark params dict after construction (Layer 2).
 *
 * Port of `validate_bookmark` (`validation.py:2288-2415`). Validates
 * the structural integrity and enum values of a built bookmark params
 * dict before it is sent to the Mixpanel API. Returns all errors found
 * so callers can fix multiple issues at once.
 *
 * The sorting subset is a thin wrapper over the pydantic mirror in
 * `bookmarks/schema-sorting.ts` (single source of truth — Layer 1 and
 * Layer 2 cannot drift on sorting).
 *
 * @param params - The bookmark params dict (with `sections` and
 *   `displayOptions` keys).
 * @param options - `bookmark_type` context (kwonly in Python).
 * @returns List of validation errors. Empty means the bookmark is
 *   valid. Callers decide whether to raise `BookmarkValidationError`.
 * @example
 * ```ts
 * const errors = validateBookmark(myParams);
 * for (const e of errors) {
 *   console.log(String(e));
 * }
 * ```
 */
export function validateBookmark(
  params: Dict,
  options: ValidateBookmarkOptions = {},
): ValidationError[] {
  const bookmarkType = options.bookmark_type ?? "insights";
  const errors: ValidationError[] = [];

  // B1: Required top-level field: sections
  if (!hasKey(params, "sections")) {
    errors.push(
      new ValidationError(
        "params",
        "Missing required field 'sections'",
        "B1_MISSING_SECTIONS",
      ),
    );
  }

  // B2: Required top-level field: displayOptions
  if (!hasKey(params, "displayOptions")) {
    errors.push(
      new ValidationError(
        "params",
        "Missing required field 'displayOptions'",
        "B2_MISSING_DISPLAY_OPTIONS",
      ),
    );
  }

  // Can't validate further without sections
  if (!hasKey(params, "sections")) {
    return errors;
  }

  const sections = params["sections"];
  if (!isDict(sections)) {
    errors.push(
      new ValidationError(
        "sections",
        "'sections' must be a dict",
        "B1_MISSING_SECTIONS",
      ),
    );
    return errors;
  }

  // B3: Required sections field: show
  const show = dictGet(sections, "show");
  if (isNone(show)) {
    errors.push(
      new ValidationError(
        "sections",
        "Missing required field 'show'",
        "B3_MISSING_SHOW",
      ),
    );
  } else if (!Array.isArray(show) || show.length === 0) {
    // B4: show must be non-empty list
    errors.push(
      new ValidationError(
        "sections.show",
        "'show' must be a non-empty list",
        "B4_SHOW_EMPTY",
      ),
    );
  } else {
    for (const [i, clause] of show.entries()) {
      errors.push(...validateShowClause(clause, i, bookmarkType));
    }
  }

  // Validate displayOptions
  const display = dictGet(params, "displayOptions");
  if (isDict(display)) {
    errors.push(...validateDisplayOptions(display));
  }

  // Validate time section
  const timeSection = dictGet(sections, "time");
  if (Array.isArray(timeSection)) {
    for (const [i, t] of timeSection.entries()) {
      errors.push(...validateTimeClause(t, i));
    }
  }

  // Validate filter section
  const filterSection = dictGet(sections, "filter");
  if (Array.isArray(filterSection)) {
    for (const [i, f] of filterSection.entries()) {
      errors.push(...validateFilterClause(f, `sections.filter[${String(i)}]`));
    }
  }

  // Validate group section
  const groupSection = dictGet(sections, "group");
  if (Array.isArray(groupSection)) {
    for (const [i, g] of groupSection.entries()) {
      errors.push(...validateGroupClause(g, i));
    }
  }

  // Validate optional top-level sorting block
  if (hasKey(params, "sorting")) {
    errors.push(...validateSortingBlock(params["sorting"]));
  }

  return errors;
}

// =============================================================================
// Layer 2: Sub-validators — validation.py:2423-3018
// =============================================================================

/**
 * Validate a single `sections.show[]` entry.
 *
 * Port of `_validate_show_clause` (`validation.py:2423-2586`). Handles
 * both multi-metric (behavior+measurement) and formula show clauses.
 *
 * @param clause - The show clause (expected to be a dict).
 * @param index - Index in the show array.
 * @param bookmarkType - Context for math type validation.
 * @returns List of validation errors for this clause.
 */
function validateShowClause(
  clause: unknown,
  index: number,
  bookmarkType: string,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const path = `sections.show[${String(index)}]`;

  if (!isDict(clause)) {
    errors.push(
      new ValidationError(
        path,
        "Show clause must be a dict",
        "B6_MISSING_BEHAVIOR",
      ),
    );
    return errors;
  }

  // Formula show clause — minimal validation (only for pure formula clauses)
  const isFormula =
    hasKey(clause, "formula") || dictGet(clause, "type") === "formula";
  if (isFormula && !hasKey(clause, "behavior")) {
    return errors;
  }

  // Multi-metric show clause: requires behavior
  const behavior = dictGet(clause, "behavior");
  if (isNone(behavior)) {
    // B6: Missing behavior
    errors.push(
      new ValidationError(
        path,
        "Show clause missing 'behavior'",
        "B6_MISSING_BEHAVIOR",
      ),
    );
    return errors;
  }

  if (!isDict(behavior)) {
    errors.push(
      new ValidationError(
        `${path}.behavior`,
        "'behavior' must be a dict",
        "B6_MISSING_BEHAVIOR",
      ),
    );
    return errors;
  }

  // B7: Validate behavior.type
  const btype = dictGet(behavior, "type");
  requireHashable(btype); // R10.7: Python hashes in `not in` (:2483)
  if (
    !isNone(btype) &&
    !(typeof btype === "string" && VALID_METRIC_TYPES.has(btype))
  ) {
    errors.push(
      enumError(
        `${path}.behavior.type`,
        "behavior type",
        pythonStrLoose(btype),
        VALID_METRIC_TYPES,
        "B7_INVALID_BEHAVIOR_TYPE",
        "warning",
      ),
    );
  }

  // B8: Event behaviors need a name
  if (btype === "event" || btype === "simple" || btype === "custom-event") {
    const value = hasKey(behavior, "value") ? behavior["value"] : {};
    const hasName =
      (isDict(value) && !isNone(dictGet(value, "name"))) ||
      !isNone(dictGet(behavior, "name"));
    if (!hasName) {
      errors.push(
        new ValidationError(
          `${path}.behavior`,
          "Event behavior requires a 'name'",
          "B8_MISSING_EVENT_NAME",
          "error",
          null,
          { value: { name: "<EVENT_NAME>" } },
        ),
      );
    }
  } else if (btype === "cohort") {
    // B22-B23: Cohort behavior validation
    // B22: Cohort behavior requires positive int id (for saved cohorts)
    const cohortId = dictGet(behavior, "id");
    if (
      !isNone(cohortId) &&
      (!isPythonIntWithBools(cohortId) || pythonIntValue(cohortId) <= 0)
    ) {
      errors.push(
        new ValidationError(
          `${path}.behavior.id`,
          "Cohort behavior id must be a positive integer",
          "B22_COHORT_BEHAVIOR_ID",
        ),
      );
    }
    // B22b: Cohort behavior must have either id or raw_cohort
    if (isNone(cohortId) && isNone(dictGet(behavior, "raw_cohort"))) {
      errors.push(
        new ValidationError(
          `${path}.behavior`,
          "Cohort behavior must have either 'id' (saved cohort) " +
            "or 'raw_cohort' (inline definition)",
          "B22_COHORT_MISSING_IDENTIFIER",
        ),
      );
    }
    // B23: Cohort behavior resourceType must be "cohorts"
    const cohortRt = dictGet(behavior, "resourceType");
    if (!isNone(cohortRt) && cohortRt !== "cohorts") {
      errors.push(
        new ValidationError(
          `${path}.behavior.resourceType`,
          `Cohort behavior resourceType must be 'cohorts' ` +
            `(got '${pythonStrLoose(cohortRt)}')`,
          "B23_COHORT_RESOURCE_TYPE",
        ),
      );
    }
  }

  // B19: Validate filtersDeterminer
  const fd = dictGet(behavior, "filtersDeterminer");
  requireHashable(fd); // R10.7: Python hashes in `not in` (:2549)
  if (
    !isNone(fd) &&
    !(typeof fd === "string" && VALID_FILTERS_DETERMINER.has(fd))
  ) {
    errors.push(
      enumError(
        `${path}.behavior.filtersDeterminer`,
        "filtersDeterminer",
        pythonStrLoose(fd),
        VALID_FILTERS_DETERMINER,
        "B19_INVALID_FILTERS_DETERMINER",
        "warning",
      ),
    );
  }

  // Validate per-metric behavior.filters[]
  const bfilters = dictGet(behavior, "filters");
  if (Array.isArray(bfilters)) {
    for (const [fi, bf] of bfilters.entries()) {
      errors.push(
        ...validateFilterClause(bf, `${path}.behavior.filters[${String(fi)}]`),
      );
    }
  }

  // Validate measurement
  const measurement = dictGet(clause, "measurement");
  if (isDict(measurement)) {
    errors.push(...validateMeasurement(measurement, path, bookmarkType));

    // B24: Cohort behavior math must be "unique"
    if (btype === "cohort") {
      const mMath = dictGet(measurement, "math");
      if (!isNone(mMath) && mMath !== "unique") {
        errors.push(
          new ValidationError(
            `${path}.measurement.math`,
            `Cohort behavior math must be 'unique' (got '${pythonStrLoose(mMath)}')`,
            "B24_COHORT_MATH",
          ),
        );
      }
    }
  }

  return errors;
}

/**
 * Validate a measurement block within a show clause.
 *
 * Port of `_validate_measurement` (`validation.py:2589-2686`).
 *
 * @param measurement - The measurement dict.
 * @param showPath - Parent show clause path for error reporting.
 * @param bookmarkType - Context for math type validation. When
 *   `"funnels"`, validates against funnel-specific math types;
 *   defaults to insights math types otherwise.
 * @returns List of validation errors for this measurement.
 */
function validateMeasurement(
  measurement: Dict,
  showPath: string,
  bookmarkType = "insights",
): ValidationError[] {
  const errors: ValidationError[] = [];
  const path = `${showPath}.measurement`;

  // B9: Validate math type (context-dependent for funnel/retention)
  const math = dictGet(measurement, "math");
  requireHashable(math); // R10.7: Python hashes in `not in` (:2618)
  if (!isNone(math)) {
    let validMath: ReadonlySet<string>;
    if (bookmarkType === "funnels") {
      validMath = VALID_MATH_FUNNELS;
    } else if (bookmarkType === "retention") {
      validMath = VALID_MATH_RETENTION;
    } else {
      validMath = VALID_MATH_INSIGHTS;
    }
    if (!(typeof math === "string" && validMath.has(math))) {
      errors.push(
        enumError(
          `${path}.math`,
          "math",
          pythonStrLoose(math),
          validMath,
          "B9_INVALID_MATH",
        ),
      );
    }

    // B10: Math requiring property
    if (
      typeof math === "string" &&
      MATH_REQUIRING_PROPERTY.has(math) &&
      isNone(dictGet(measurement, "property"))
    ) {
      errors.push(
        new ValidationError(
          `${path}.property`,
          `Math type '${math}' requires 'measurement.property'`,
          "B10_MATH_MISSING_PROPERTY",
          "warning",
          null,
          {
            name: "<PROPERTY_NAME>",
            type: "number",
            resourceType: "events",
          },
        ),
      );
    }
  }

  // B11: Validate perUserAggregation
  const perUser = dictGet(measurement, "perUserAggregation");
  requireHashable(perUser); // R10.7: Python hashes in `not in` (:2647)
  if (
    !isNone(perUser) &&
    !(typeof perUser === "string" && VALID_PER_USER_AGGREGATIONS.has(perUser))
  ) {
    errors.push(
      enumError(
        `${path}.perUserAggregation`,
        "perUserAggregation",
        pythonStrLoose(perUser),
        VALID_PER_USER_AGGREGATIONS,
        "B11_INVALID_PER_USER",
      ),
    );
  }

  // Validate measurement.property if present
  const prop = dictGet(measurement, "property");
  if (isDict(prop)) {
    const propType = dictGet(prop, "type");
    requireHashable(propType); // R10.7: Python hashes in `not in` (:2662)
    if (
      !isNone(propType) &&
      !(typeof propType === "string" && VALID_PROPERTY_TYPES.has(propType))
    ) {
      errors.push(
        enumError(
          `${path}.property.type`,
          "property type",
          pythonStrLoose(propType),
          VALID_PROPERTY_TYPES,
          "B17_INVALID_PROPERTY_TYPE",
          "warning",
        ),
      );
    }
    const propRt = dictGet(prop, "resourceType");
    requireHashable(propRt); // R10.7: Python hashes in `not in` (:2674)
    if (
      !isNone(propRt) &&
      !(typeof propRt === "string" && VALID_RESOURCE_TYPES.has(propRt))
    ) {
      errors.push(
        enumError(
          `${path}.property.resourceType`,
          "resourceType",
          pythonStrLoose(propRt),
          VALID_RESOURCE_TYPES,
          "B16_INVALID_RESOURCE_TYPE",
          "warning",
        ),
      );
    }
  }

  return errors;
}

/**
 * Validate the displayOptions block.
 *
 * Port of `_validate_display_options` (`validation.py:2689-2723`).
 *
 * @param display - The displayOptions dict.
 * @returns List of validation errors.
 */
function validateDisplayOptions(display: Dict): ValidationError[] {
  const errors: ValidationError[] = [];

  // B5: chartType is required and must be valid
  const chartType = dictGet(display, "chartType");
  requireHashable(chartType); // R10.7: Python hashes in `not in` (:2712)
  if (isNone(chartType)) {
    errors.push(
      new ValidationError(
        "displayOptions",
        "Missing required 'chartType'",
        "B5_INVALID_CHART_TYPE",
      ),
    );
  } else if (!(
    typeof chartType === "string" && VALID_CHART_TYPES.has(chartType)
  )) {
    errors.push(
      enumError(
        "displayOptions.chartType",
        "chartType",
        pythonStrLoose(chartType),
        VALID_CHART_TYPES,
        "B5_INVALID_CHART_TYPE",
      ),
    );
  }

  return errors;
}

/** Valid `dateRangeType` values (inline frozenset, `validation.py:2767-2773`). */
const VALID_DATE_RANGE_TYPES: ReadonlySet<string> = new Set([
  "in the last",
  "between",
  "since",
  "on",
  "relative_after",
]);

/**
 * Validate a single `sections.time[]` entry.
 *
 * Port of `_validate_time_clause` (`validation.py:2726-2783`).
 *
 * @param clause - The time clause (expected to be a dict).
 * @param index - Index in the time array.
 * @returns List of validation errors for this clause.
 */
function validateTimeClause(clause: unknown, index: number): ValidationError[] {
  const errors: ValidationError[] = [];
  const path = `sections.time[${String(index)}]`;

  if (!isDict(clause)) {
    errors.push(
      new ValidationError(
        path,
        "Time clause must be a dict",
        "B12_INVALID_TIME_UNIT",
      ),
    );
    return errors;
  }

  // B12: Validate unit
  const unit = dictGet(clause, "unit");
  requireHashable(unit); // R10.7: Python hashes in `not in` (:2754)
  if (
    !isNone(unit) &&
    !(typeof unit === "string" && VALID_TIME_UNITS.has(unit))
  ) {
    errors.push(
      enumError(
        `${path}.unit`,
        "time unit",
        pythonStrLoose(unit),
        VALID_TIME_UNITS,
        "B12_INVALID_TIME_UNIT",
      ),
    );
  }

  // B13: Validate dateRangeType
  const drt = dictGet(clause, "dateRangeType");
  requireHashable(drt); // R10.7: Python hashes in `not in` (:2767)
  if (
    !isNone(drt) &&
    !(typeof drt === "string" && VALID_DATE_RANGE_TYPES.has(drt))
  ) {
    errors.push(
      new ValidationError(
        `${path}.dateRangeType`,
        `Invalid dateRangeType '${pythonStrLoose(drt)}'`,
        "B13_INVALID_DATE_RANGE_TYPE",
        "warning",
      ),
    );
  }

  return errors;
}

/**
 * Validate a single filter clause.
 *
 * Port of `_validate_filter_clause` (`validation.py:2786-2950`).
 *
 * @param clause - The filter clause (expected to be a dict).
 * @param path - JSONPath-like location for error reporting.
 * @returns List of validation errors for this clause.
 */
function validateFilterClause(
  clause: unknown,
  path: string,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!isDict(clause)) {
    errors.push(
      new ValidationError(
        path,
        "Filter clause must be a dict",
        "B14_INVALID_FILTER_TYPE",
      ),
    );
    return errors;
  }

  // B18: Must have property identification (value/propertyName or custom property)
  // Python `or` chain over truthiness (watchlist #6).
  const hasPropertyId =
    pythonTruthy(dictGet(clause, "value")) ||
    pythonTruthy(dictGet(clause, "propertyName")) ||
    !isNone(dictGet(clause, "customPropertyId")) ||
    !isNone(dictGet(clause, "customProperty"));
  if (!hasPropertyId) {
    errors.push(
      new ValidationError(
        path,
        "Filter missing property identifier " +
          "('value', 'propertyName', 'customPropertyId', " +
          "or 'customProperty')",
        "B18_MISSING_FILTER_PROPERTY",
      ),
    );
  }

  // B18B: customPropertyId must be a positive integer (defense-in-depth)
  const cpId = dictGet(clause, "customPropertyId");
  if (
    !isNone(cpId) &&
    (typeof cpId === "boolean" || !isPythonInt(cpId) || cpId <= 0)
  ) {
    errors.push(
      new ValidationError(
        `${path}.customPropertyId`,
        `customPropertyId must be a positive integer (got ${pythonStrLoose(cpId)})`,
        "B18B_INVALID_CP_ID",
      ),
    );
  }

  // B16: Validate resourceType
  const rt = dictGet(clause, "resourceType");
  requireHashable(rt); // R10.7: Python hashes in `not in` (:2846)
  if (
    !isNone(rt) &&
    !(typeof rt === "string" && VALID_RESOURCE_TYPES.has(rt))
  ) {
    errors.push(
      enumError(
        `${path}.resourceType`,
        "resourceType",
        pythonStrLoose(rt),
        VALID_RESOURCE_TYPES,
        "B16_INVALID_RESOURCE_TYPE",
        "warning",
      ),
    );
  }

  // B14: Validate filterType
  const ft = dictGet(clause, "filterType");
  requireHashable(ft); // R10.7: Python hashes in `not in` (:2860)
  if (
    !isNone(ft) &&
    !(typeof ft === "string" && VALID_PROPERTY_TYPES.has(ft))
  ) {
    errors.push(
      enumError(
        `${path}.filterType`,
        "filterType",
        pythonStrLoose(ft),
        VALID_PROPERTY_TYPES,
        "B14_INVALID_FILTER_TYPE",
      ),
    );
  }

  // B15: Validate filterOperator
  const fo = dictGet(clause, "filterOperator");
  requireHashable(fo); // R10.7: Python hashes in `not in` (:2873)
  if (
    !isNone(fo) &&
    !(typeof fo === "string" && VALID_FILTER_OPERATORS.has(fo))
  ) {
    errors.push(
      enumError(
        `${path}.filterOperator`,
        "filterOperator",
        pythonStrLoose(fo),
        VALID_FILTER_OPERATORS,
        "B15_INVALID_FILTER_OPERATOR",
        "warning",
      ),
    );
  }

  // B25: Cohort filter must have value == "$cohorts"
  const filterOperator = dictGet(clause, "filterOperator");
  if (
    dictGet(clause, "filterType") === "list" &&
    (filterOperator === "contains" || filterOperator === "does not contain")
  ) {
    const fvCohort = dictGet(clause, "filterValue");
    if (Array.isArray(fvCohort) && fvCohort.length > 0) {
      const first: unknown = fvCohort[0];
      if (
        isDict(first) &&
        hasKey(first, "cohort") &&
        dictGet(clause, "value") !== "$cohorts"
      ) {
        errors.push(
          new ValidationError(
            `${path}.value`,
            "Cohort filter value must be '$cohorts'",
            "B25_COHORT_FILTER_VALUE",
          ),
        );
      }
    }
  }

  // B20: Validate filterValue is non-empty when present
  const fv = dictGet(clause, "filterValue");
  if (Array.isArray(fv) && fv.length === 0) {
    errors.push(
      new ValidationError(
        `${path}.filterValue`,
        "filterValue must not be an empty list",
        "B20_EMPTY_FILTER_VALUE",
      ),
    );
  }

  // B21: Validate filterValue list length
  if (Array.isArray(fv) && fv.length > MAX_FILTER_VALUES) {
    errors.push(
      new ValidationError(
        `${path}.filterValue`,
        `filterValue has ${String(fv.length)} entries, ` +
          `maximum is ${String(MAX_FILTER_VALUES)}`,
        "B21_FILTER_VALUE_TOO_MANY",
      ),
    );
  }

  // B20B: Numeric filter values must be finite (not NaN/Inf)
  if (isPythonFloat(fv) && !isFiniteNumber(fv)) {
    errors.push(
      new ValidationError(
        `${path}.filterValue`,
        `filterValue must be a finite number (got ${pythonStrLoose(fv)})`,
        "B20B_FILTER_VALUE_NOT_FINITE",
      ),
    );
  } else if (Array.isArray(fv)) {
    for (const [vi, v] of fv.entries()) {
      if (isPythonFloat(v) && !isFiniteNumber(v)) {
        errors.push(
          new ValidationError(
            `${path}.filterValue[${String(vi)}]`,
            `filterValue must be a finite number (got ${pythonStrLoose(v)})`,
            "B20B_FILTER_VALUE_NOT_FINITE",
          ),
        );
      }
    }
  }

  return errors;
}

/**
 * Validate a single `sections.group[]` entry.
 *
 * Port of `_validate_group_clause` (`validation.py:2953-3018`).
 *
 * @param clause - The group clause (expected to be a dict).
 * @param index - Index in the group array.
 * @returns List of validation errors for this clause.
 */
function validateGroupClause(
  clause: unknown,
  index: number,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const path = `sections.group[${String(index)}]`;

  if (!isDict(clause)) {
    errors.push(
      new ValidationError(
        path,
        "Group clause must be a dict",
        "B17_INVALID_PROPERTY_TYPE",
      ),
    );
    return errors;
  }

  // B17: Validate propertyType
  const pt = dictGet(clause, "propertyType");
  requireHashable(pt); // R10.7: Python hashes in `not in` (:2981)
  if (
    !isNone(pt) &&
    !(typeof pt === "string" && VALID_PROPERTY_TYPES.has(pt))
  ) {
    errors.push(
      enumError(
        `${path}.propertyType`,
        "propertyType",
        pythonStrLoose(pt),
        VALID_PROPERTY_TYPES,
        "B17_INVALID_PROPERTY_TYPE",
        "warning",
      ),
    );
  }

  // B16: Validate resourceType
  const rt = dictGet(clause, "resourceType");
  requireHashable(rt); // R10.7: Python hashes in `not in` (:2995)
  if (
    !isNone(rt) &&
    !(typeof rt === "string" && VALID_RESOURCE_TYPES.has(rt))
  ) {
    errors.push(
      enumError(
        `${path}.resourceType`,
        "resourceType",
        pythonStrLoose(rt),
        VALID_RESOURCE_TYPES,
        "B16_INVALID_RESOURCE_TYPE",
        "warning",
      ),
    );
  }

  // B26: Cohort group entry must have non-empty cohorts array
  const cohorts = dictGet(clause, "cohorts");
  if (!isNone(cohorts) && (!Array.isArray(cohorts) || cohorts.length === 0)) {
    errors.push(
      new ValidationError(
        `${path}.cohorts`,
        "Cohort group entry must have non-empty cohorts array",
        "B26_EMPTY_COHORTS",
      ),
    );
  }

  return errors;
}

// =============================================================================
// Layer 2: sorting block validator — validation.py:3036-3090
//
// A thin wrapper over the pydantic mirror in bookmarks/schema-sorting.ts:
// the FlatOrColumnSortConfig discriminator + extra="forbid" do all the
// structural work. The wrapper adds two things on top:
//
//   1. S4_UNKNOWN_CHART_TYPE warnings (pydantic would emit an error for
//      unknown chart-type keys; we want a warning + suggestion instead).
//   2. The S* code translation (via sortingCodeMapper).
// =============================================================================

/**
 * Validate the optional `params['sorting']` block.
 *
 * Port of `validate_sorting_block` (`validation.py:3036-3090`). Wraps
 * the `InsightsBookmarkSortConfig` mirror with a sorting-aware code
 * mapper that recovers the package's stable `S*` codes. Unknown
 * chart-type keys are filtered out and reported as
 * `S4_UNKNOWN_CHART_TYPE` warnings (rather than `extra_forbidden`
 * errors) so callers can keep producing best-effort output for partial
 * chart-type coverage.
 *
 * @param sorting - The raw value at `params['sorting']`. May be any
 *   type; this function reports a structural error if it is not a dict.
 * @returns List of validation errors. Empty when the block is
 *   well-formed (or omitted at the call site — callers gate on key
 *   presence).
 */
export function validateSortingBlock(sorting: unknown): ValidationError[] {
  if (!isDict(sorting)) {
    return [
      new ValidationError(
        "sorting",
        "'sorting' must be a dict",
        "S5_NOT_A_DICT",
      ),
    ];
  }

  const errors: ValidationError[] = [];
  const known: Dict = {};
  for (const [chartType, config] of Object.entries(sorting)) {
    if (VALID_CHART_TYPES.has(chartType)) {
      known[chartType] = config;
    } else {
      errors.push(
        enumError(
          `sorting.${chartType}`,
          "chart type",
          chartType,
          VALID_CHART_TYPES,
          "S4_UNKNOWN_CHART_TYPE",
          "warning",
        ),
      );
    }
  }

  // Python `if known:` — empty dict is falsy (watchlist #6).
  if (Object.keys(known).length > 0) {
    errors.push(
      ...validateWithPydantic(validateInsightsBookmarkSortConfig, known, {
        path_prefix: "sorting",
        code_mapper: sortingCodeMapper,
      }),
    );
  }

  return errors;
}
