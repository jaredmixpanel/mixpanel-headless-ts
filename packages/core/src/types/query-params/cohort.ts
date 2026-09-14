/**
 * Cohort-definition builder types — TS port of the corresponding frozen
 * dataclasses and module helpers in `mixpanel_headless/types.py`
 * (phase2-design C7, packet P2-5b): `CohortCriteria`, `CohortDefinition`,
 * `CohortBreakdown`, and the module-private `_sanitize_raw_cohort` →
 * {@link sanitizeRawCohort}.
 *
 * Porting rules applied here (C7):
 * - Fields are `readonly` under their EXACT Python spellings — the
 *   `CohortCriteria`/`CohortDefinition` privates (`_selector_node`,
 *   `_behavior_key`, `_behavior`, `_criteria`, `_operator`) are
 *   codec-visible (R7.6 wire-spelling exception); Python tuples become
 *   `ReadonlyArray`.
 * - Static factories keep Python's method names mechanically camelized
 *   (`did_event` → `didEvent`) per the D12 naming map.
 * - Guard blocks are transcribed IN PYTHON SOURCE ORDER (Risk #1), one
 *   comment per registry code.
 * - `CohortDefinition` mirrors Python's `init=False` design: variadic
 *   constructor (AND) + `allOf`/`anyOf` statics; its codec decoder
 *   reconstructs through the statics (see `conformance-runner/src/vector-codecs.ts`).
 */

import { pythonStrip } from "../../compat/index.js";
import { ParamValidationError } from "../../errors.js";
import { KeyError } from "../../query/python-builtins.js";
import type { CohortAggregationType } from "../literals.js";
import { CustomPropertyRef, Filter, InlineCustomProperty } from "./filter.js";
import {
  isRealCalendarDate,
  matchesDateFormat,
  validateCohortArgs,
} from "./guards.js";

/**
 * Maps `CohortCriteria.hasProperty()` operator names to selector tree
 * operators — mirror of `types._PROPERTY_OPERATOR_MAP` (entry order =
 * Python source order).
 *
 * @internal Exported for the translated operator-map tests only.
 */
export const PROPERTY_OPERATOR_MAP: ReadonlyMap<string, string> = new Map([
  ["equals", "=="],
  ["not_equals", "!="],
  ["contains", "in"],
  ["not_contains", "not in"],
  ["greater_than", ">"],
  ["less_than", "<"],
  ["is_set", "defined"],
  ["is_not_set", "not defined"],
]);

// The CPython `KeyError` twin for the ONE call site that raises it:
// `has_property`'s `_PROPERTY_OPERATOR_MAP[operator]` lookup
// (types.py ~8959) on an operator outside the map — a real divergence
// found by the P2-9 gate (the pre-fix port silently constructed with an
// `undefined` selector operator). FOLDED into the canonical
// `query/python-builtins.ts` twin at the B6 gate per that module's own
// R10.4 watch note: the former file-local duplicate collided with the
// canonical class in the bundled oracle (esbuild renamed one binding to
// `KeyError2`, and the bridge compares `constructor.name` —
// oracle-protocol.md §4.1), which the B6-gate differential regression
// caught as a live cohort_family divergence. `python-builtins.ts` is
// import-free, so this types-layer import creates no cycle.

/**
 * Set of `Filter._operator` values accepted by {@link buildEventSelector}
 * — mirror of `types._FILTER_TO_SELECTOR_SUPPORTED`.
 *
 * These operators are emitted verbatim in the Insights bookmark filter
 * format (`filterOperator` key) — no mapping is needed because the
 * server's `output_leaf_node` routes `filterOperator` nodes through
 * `filter_to_arb_selector_string`, which understands these names
 * natively.
 *
 * @internal Exported for the translated operator-map tests only.
 */
export const FILTER_TO_SELECTOR_SUPPORTED: ReadonlySet<string> = new Set([
  "equals",
  "does not equal",
  "contains",
  "does not contain",
  "is greater than",
  "is less than",
  "is set",
  "is not set",
  "is between",
]);

/**
 * Whether a value is a plain data object (the TS stand-in for a decoded
 * Python `dict` — arrays, class instances, and `null` do not count).
 *
 * @param value - The candidate value.
 * @returns True for prototype-of-`Object.prototype` objects.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * Deep-copy a decoded JSON-ish subtree — the TS twin of the
 * `copy.deepcopy` calls in Python's `CohortDefinition.to_dict` /
 * `_sanitize_raw_cohort`.
 *
 * Plain objects and arrays are copied recursively; primitives, `bigint`,
 * and immutable class instances (e.g. lossless number wrappers riding in
 * decoded payloads) pass through by reference.
 *
 * @param value - The subtree to copy.
 * @returns A structurally independent copy.
 */
function deepCopy<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => deepCopy(item)) as unknown as T;
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = deepCopy(item);
    }
    return out as T;
  }
  return value;
}

/**
 * Validate that a date string is in YYYY-MM-DD format — port of
 * `types._validate_cohort_date`.
 *
 * @param dateStr - Date string to validate.
 * @throws ParamValidationError - `CD6_DATE_FORMAT` when the shape is not
 *   YYYY-MM-DD, `CD6_DATE_INVALID` when the shape matches but the date
 *   does not exist on the calendar.
 */
function validateCohortDate(dateStr: string): void {
  // CD6_DATE_FORMAT: dates must be YYYY-MM-DD.
  if (!matchesDateFormat(dateStr)) {
    throw new ParamValidationError(
      "dates must be YYYY-MM-DD format",
      "CD6_DATE_FORMAT",
    );
  }
  // CD6_DATE_INVALID: correct shape but not a real calendar date.
  if (!isRealCalendarDate(dateStr)) {
    throw new ParamValidationError(
      `date '${dateStr}' has correct format but is not a valid calendar date`,
      "CD6_DATE_INVALID",
    );
  }
}

/**
 * Convert Filter objects to an event selector expression tree — port of
 * `types._build_event_selector`.
 *
 * Each `Filter` is emitted as an Insights bookmark filter node
 * (`filterOperator` / `filterValue` / `filterType` keys) rather than the
 * legacy selector-tree format (`operator` / `operand`). R10.12 note:
 * `filterValue` stays a JSON value — never stringified.
 *
 * @param filters - Single Filter or list of Filters to convert.
 * @returns Expression tree object with `operator` and `children` keys.
 * @throws ParamValidationError - `CD10_UNSUPPORTED_FILTER_OPERATOR` when
 *   a filter uses an operator outside
 *   {@link FILTER_TO_SELECTOR_SUPPORTED}.
 *
 * @internal Exported for the translated tests only.
 */
export function buildEventSelector(
  filters: Filter | readonly Filter[],
): Record<string, unknown> {
  const filterList = filters instanceof Filter ? [filters] : filters;
  const children: Record<string, unknown>[] = [];
  for (const f of filterList) {
    // CD10_UNSUPPORTED_FILTER_OPERATOR: only the natively-understood
    // bookmark filter operators are accepted.
    if (!FILTER_TO_SELECTOR_SUPPORTED.has(f._operator)) {
      const supported = [...FILTER_TO_SELECTOR_SUPPORTED].sort().join(", ");
      throw new ParamValidationError(
        `unsupported filter operator for cohort selector: ` +
          `${JSON.stringify(f._operator)}. Supported operators: ${supported}`,
        "CD10_UNSUPPORTED_FILTER_OPERATOR",
      );
    }
    const prop = f._property;
    const node: Record<string, unknown> = {
      resourceType: f._resource_type,
      filterType: f._property_type,
      defaultType: f._property_type,
      filterOperator: f._operator,
    };
    if (prop instanceof CustomPropertyRef) {
      node["customPropertyId"] = prop.id;
      node["dataset"] = "$mixpanel";
    } else if (prop instanceof InlineCustomProperty) {
      const effectiveType =
        prop.property_type !== null ? prop.property_type : f._property_type;
      const composedProperties: Record<string, unknown> = {};
      for (const [letter, pi] of Object.entries(prop.inputs)) {
        composedProperties[letter] = {
          value: pi.name,
          type: pi.type,
          resourceType: pi.resource_type,
        };
      }
      node["customProperty"] = {
        displayFormula: prop.formula,
        composedProperties,
        name: "",
        description: "",
        propertyType: effectiveType,
        resourceType: prop.resource_type,
      };
      node["filterType"] = effectiveType;
      node["defaultType"] = effectiveType;
      node["dataset"] = "$mixpanel";
      node["resourceType"] = prop.resource_type;
    } else {
      node["value"] = prop;
    }
    if (f._value !== null) {
      node["filterValue"] = f._value;
    }
    children.push(node);
  }
  return { operator: "and", children };
}

/** Kw-only options of {@link CohortCriteria.didEvent} (Python spellings). */
export interface DidEventOptions {
  /** Minimum event count (`>=`). */
  readonly at_least?: number | null;
  /** Maximum event count (`<=`). */
  readonly at_most?: number | null;
  /** Exact event count (`==`). */
  readonly exactly?: number | null;
  /** Rolling window in days. */
  readonly within_days?: number | null;
  /** Rolling window in weeks. */
  readonly within_weeks?: number | null;
  /** Rolling window in months. */
  readonly within_months?: number | null;
  /** Absolute start date (YYYY-MM-DD). */
  readonly from_date?: string | null;
  /** Absolute end date (YYYY-MM-DD). */
  readonly to_date?: string | null;
  /** Event property filter(s). */
  readonly where?: Filter | readonly Filter[] | null;
  /** Aggregation operator for property-based thresholds. */
  readonly aggregation?: CohortAggregationType | null;
  /** Event property to aggregate (paired with `aggregation`). */
  readonly aggregation_property?: string | null;
}

/** Kw-only options of {@link CohortCriteria.didNotDoEvent}. */
export interface DidNotDoEventOptions {
  /** Rolling window in days. */
  readonly within_days?: number | null;
  /** Rolling window in weeks. */
  readonly within_weeks?: number | null;
  /** Rolling window in months. */
  readonly within_months?: number | null;
  /** Absolute start date (YYYY-MM-DD). */
  readonly from_date?: string | null;
  /** Absolute end date (YYYY-MM-DD). */
  readonly to_date?: string | null;
}

/** Comparison operators accepted by {@link CohortCriteria.hasProperty}. */
export type HasPropertyOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "greater_than"
  | "less_than"
  | "is_set"
  | "is_not_set";

/** Property data types accepted by {@link CohortCriteria.hasProperty}. */
export type HasPropertyType =
  "string" | "number" | "boolean" | "datetime" | "list";

/**
 * A single atomic condition for cohort membership — TS port of
 * `types.CohortCriteria`.
 *
 * Constructed exclusively via the static factories in the public API —
 * the field constructor exists for codec reconstruction (mirror of
 * Python's generic `_decode_dataclass` path, which reaches the real
 * dataclass constructor). Produces selector nodes and behavior entries
 * for the Mixpanel cohort definition format (legacy `selector` +
 * `behaviors` JSON).
 */
export class CohortCriteria {
  /**
   * Expression tree leaf node (behavioral, property, or cohort
   * reference).
   *
   * @internal Codec-visible under its exact Python spelling.
   */
  readonly _selector_node: Readonly<Record<string, unknown>>;

  /**
   * Placeholder behavior key (e.g. `"bhvr_0"`); `null` for
   * non-behavioral criteria.
   *
   * @internal Codec-visible under its exact Python spelling.
   */
  readonly _behavior_key: string | null;

  /**
   * Behavior dict entry (event selector + window/dates); `null` for
   * non-behavioral criteria.
   *
   * @internal Codec-visible under its exact Python spelling.
   */
  readonly _behavior: Readonly<Record<string, unknown>> | null;

  /**
   * Reconstruct a criterion from its declared fields.
   *
   * @param fields - The three declared Python dataclass fields.
   */
  constructor(fields: {
    readonly _selector_node: Readonly<Record<string, unknown>>;
    readonly _behavior_key: string | null;
    readonly _behavior: Readonly<Record<string, unknown>> | null;
  }) {
    this._selector_node = fields._selector_node;
    this._behavior_key = fields._behavior_key;
    this._behavior = fields._behavior;
  }

  /**
   * Create a behavioral criterion based on event frequency — port of
   * `CohortCriteria.did_event` (guards transcribed in Python source
   * order).
   *
   * @param event - Event name (must be non-empty).
   * @param options - Kw-only frequency/time/filter/aggregation options.
   * @returns CohortCriteria with behavioral selector node and behavior
   *   entry.
   * @throws ParamValidationError - `CD4_EMPTY_EVENT`,
   *   `CA1_AGGREGATION_PAIR`, `CA2_EMPTY_AGGREGATION_PROPERTY`,
   *   `CD1_FREQUENCY_PARAM_REQUIRED`, `CD2_FREQUENCY_NEGATIVE`,
   *   `CD3_TIME_CONSTRAINT_REQUIRED`, `CD10_UNSUPPORTED_FILTER_OPERATOR`
   *   (via {@link buildEventSelector}), `CD3_WINDOW_NOT_POSITIVE`,
   *   `CD5_FROM_REQUIRES_TO`, `CD5_TO_REQUIRES_FROM`, `CD6_DATE_FORMAT`,
   *   `CD6_DATE_INVALID`, `CD6_DATE_ORDER` — first failing guard wins.
   */
  static didEvent(event: string, options?: DidEventOptions): CohortCriteria {
    const opts = options ?? {};
    const atLeast = opts.at_least ?? null;
    const atMost = opts.at_most ?? null;
    const exactly = opts.exactly ?? null;
    const withinDays = opts.within_days ?? null;
    const withinWeeks = opts.within_weeks ?? null;
    const withinMonths = opts.within_months ?? null;
    const fromDate = opts.from_date ?? null;
    const toDate = opts.to_date ?? null;
    const where = opts.where ?? null;
    const aggregation = opts.aggregation ?? null;
    const aggregationProperty = opts.aggregation_property ?? null;

    // CD4_EMPTY_EVENT: event name must be non-empty.
    if (!event || !pythonStrip(event)) {
      throw new ParamValidationError(
        "event name must be non-empty",
        "CD4_EMPTY_EVENT",
      );
    }

    // CA1_AGGREGATION_PAIR: aggregation and aggregation_property must
    // both be set or both be None.
    if ((aggregation === null) !== (aggregationProperty === null)) {
      throw new ParamValidationError(
        "aggregation and aggregation_property must both be set or both be None",
        "CA1_AGGREGATION_PAIR",
      );
    }

    // CA2_EMPTY_AGGREGATION_PROPERTY: a provided aggregation_property
    // must be non-blank.
    if (aggregationProperty !== null && !pythonStrip(aggregationProperty)) {
      throw new ParamValidationError(
        "aggregation_property must be a non-empty string",
        "CA2_EMPTY_AGGREGATION_PROPERTY",
      );
    }

    // CD1_FREQUENCY_PARAM_REQUIRED: exactly one frequency param required
    // (iteration order mirrors the Python dict literal: at_least,
    // at_most, exactly).
    const freqParams: ReadonlyArray<readonly [string, number | null]> = [
      ["at_least", atLeast],
      ["at_most", atMost],
      ["exactly", exactly],
    ];
    const setFreqs = freqParams.filter(
      ([, value]) => value !== null,
    ) as readonly (readonly [string, number])[];
    if (setFreqs.length !== 1) {
      throw new ParamValidationError(
        "exactly one of at_least, at_most, exactly must be set",
        "CD1_FREQUENCY_PARAM_REQUIRED",
      );
    }
    const [freqName, freqValue] = setFreqs[0] as readonly [string, number];

    // CD2_FREQUENCY_NEGATIVE: frequency param must be non-negative.
    if (freqValue < 0) {
      throw new ParamValidationError(
        "frequency value must be >= 0",
        "CD2_FREQUENCY_NEGATIVE",
      );
    }

    // Map frequency param to selector operator.
    const freqOperatorMap: Readonly<Record<string, string>> = {
      at_least: ">=",
      at_most: "<=",
      exactly: "==",
    };
    const selectorOperator = freqOperatorMap[freqName] as string;

    // CD3_TIME_CONSTRAINT_REQUIRED: exactly one time constraint required
    // (rolling-window iteration order mirrors the Python dict literal).
    const rollingParams: ReadonlyArray<readonly [string, number | null]> = [
      ["within_days", withinDays],
      ["within_weeks", withinWeeks],
      ["within_months", withinMonths],
    ];
    const setRolling = rollingParams.filter(
      ([, value]) => value !== null,
    ) as readonly (readonly [string, number])[];
    const hasDateRange = fromDate !== null || toDate !== null;

    if (setRolling.length === 0 && !hasDateRange) {
      throw new ParamValidationError(
        "exactly one time constraint required " +
          "(within_days/weeks/months or from_date+to_date)",
        "CD3_TIME_CONSTRAINT_REQUIRED",
      );
    }
    if (setRolling.length > 0 && hasDateRange) {
      throw new ParamValidationError(
        "exactly one time constraint required " +
          "(within_days/weeks/months or from_date+to_date)",
        "CD3_TIME_CONSTRAINT_REQUIRED",
      );
    }
    if (setRolling.length > 1) {
      throw new ParamValidationError(
        "exactly one time constraint required " +
          "(within_days/weeks/months or from_date+to_date)",
        "CD3_TIME_CONSTRAINT_REQUIRED",
      );
    }

    // Build behavior entry — placeholder key, re-indexed by toDict().
    const behaviorKey = "bhvr_0";

    const eventSelector: Record<string, unknown> = {
      event,
      selector: null,
    };
    if (where !== null) {
      // CD10_UNSUPPORTED_FILTER_OPERATOR fires here, BEFORE the window/
      // date guards below — exactly Python's evaluation order.
      const whereList = where instanceof Filter ? [where] : where;
      if (whereList.length > 0) {
        eventSelector["selector"] = buildEventSelector(whereList);
      }
    }

    const countDict: Record<string, unknown> = {
      event_selector: eventSelector,
      type: "absolute",
    };

    // Add aggregation fields when set.
    if (aggregation !== null && aggregationProperty !== null) {
      countDict["aggregationOperator"] = aggregation;
      countDict["property"] = aggregationProperty;
    }

    const behavior: Record<string, unknown> = {
      count: countDict,
    };

    if (setRolling.length > 0) {
      const [rollingName, rollingValue] = setRolling[0] as readonly [
        string,
        number,
      ];
      // CD3_WINDOW_NOT_POSITIVE: time window value must be positive.
      if (rollingValue <= 0) {
        throw new ParamValidationError(
          "time window value must be positive",
          "CD3_WINDOW_NOT_POSITIVE",
        );
      }
      const unitMap: Readonly<Record<string, string>> = {
        within_days: "day",
        within_weeks: "week",
        within_months: "month",
      };
      behavior["window"] = {
        unit: unitMap[rollingName] as string,
        value: rollingValue,
      };
    } else {
      // Absolute date range.
      // CD5_FROM_REQUIRES_TO: from_date requires to_date.
      if (fromDate !== null && toDate === null) {
        throw new ParamValidationError(
          "from_date requires to_date",
          "CD5_FROM_REQUIRES_TO",
        );
      }
      // CD5_TO_REQUIRES_FROM: to_date requires from_date.
      if (toDate !== null && fromDate === null) {
        throw new ParamValidationError(
          "to_date requires from_date",
          "CD5_TO_REQUIRES_FROM",
        );
      }
      // Unreachable defensive twin of Python's `pragma: no cover`
      // branch: hasDateRange is true and the CD5 guards above rejected
      // mismatched pairs, so both dates are non-null here.
      if (fromDate === null || toDate === null) {
        throw new ParamValidationError(
          "exactly one time constraint required " +
            "(within_days/weeks/months or from_date+to_date)",
          "CD3_TIME_CONSTRAINT_REQUIRED",
        );
      }
      // CD6_DATE_FORMAT / CD6_DATE_INVALID: from_date first, then
      // to_date (Python call order).
      validateCohortDate(fromDate);
      validateCohortDate(toDate);
      // CD6_DATE_ORDER: from_date must be before or equal to to_date
      // (YYYY-MM-DD strings compare correctly lexicographically).
      if (fromDate > toDate) {
        throw new ParamValidationError(
          "from_date must be before or equal to to_date",
          "CD6_DATE_ORDER",
        );
      }

      behavior["from_date"] = fromDate;
      behavior["to_date"] = toDate;
    }

    const selectorNode: Record<string, unknown> = {
      property: "behaviors",
      value: behaviorKey,
      operator: selectorOperator,
      operand: freqValue,
    };

    return new CohortCriteria({
      _selector_node: selectorNode,
      _behavior_key: behaviorKey,
      _behavior: behavior,
    });
  }

  /**
   * Create a criterion for users who did NOT perform an event — port of
   * `CohortCriteria.did_not_do_event` (shorthand for
   * `didEvent(event, {exactly: 0, ...})`).
   *
   * @param event - Event name.
   * @param options - Kw-only time-constraint options.
   * @returns CohortCriteria equivalent to
   *   `didEvent(event, {exactly: 0, ...})`.
   * @throws ParamValidationError - On constraint violations (same codes
   *   as {@link didEvent}).
   */
  static didNotDoEvent(
    event: string,
    options?: DidNotDoEventOptions,
  ): CohortCriteria {
    const opts = options ?? {};
    return CohortCriteria.didEvent(event, {
      exactly: 0,
      within_days: opts.within_days ?? null,
      within_weeks: opts.within_weeks ?? null,
      within_months: opts.within_months ?? null,
      from_date: opts.from_date ?? null,
      to_date: opts.to_date ?? null,
    });
  }

  /**
   * Create a property-based criterion — port of
   * `CohortCriteria.has_property`.
   *
   * @param property - Property name (must be non-empty).
   * @param value - Value to compare against.
   * @param options - Kw-only `operator` (default `"equals"`) and
   *   `property_type` (default `"string"`).
   * @returns CohortCriteria with property selector node.
   * @throws ParamValidationError - `CD7_EMPTY_PROPERTY` when the property
   *   name is empty/blank.
   */
  static hasProperty(
    property: string,
    value: string | number | boolean | readonly string[],
    options?: {
      readonly operator?: HasPropertyOperator;
      readonly property_type?: HasPropertyType;
    },
  ): CohortCriteria {
    const operator = options?.operator ?? "equals";
    const propertyType = options?.property_type ?? "string";

    // CD7_EMPTY_PROPERTY: property name must be non-empty.
    if (!property || !pythonStrip(property)) {
      throw new ParamValidationError(
        "property name must be non-empty",
        "CD7_EMPTY_PROPERTY",
      );
    }

    const selectorOperator = PROPERTY_OPERATOR_MAP.get(operator);
    if (selectorOperator === undefined) {
      // Python: `_PROPERTY_OPERATOR_MAP[operator]` raises KeyError for
      // operators outside the map (uncoded builtin raise, R5.5) — the
      // typed signature makes this unreachable from TS call sites, but
      // vector/bridge replay can carry any recorded string.
      throw new KeyError(operator);
    }

    const selectorNode: Record<string, unknown> = {
      property: "user",
      value: property,
      operator: selectorOperator,
      operand: value,
      type: propertyType,
    };

    return new CohortCriteria({
      _selector_node: selectorNode,
      _behavior_key: null,
      _behavior: null,
    });
  }

  /**
   * Check if a user property exists — port of
   * `CohortCriteria.property_is_set` (shorthand for
   * `hasProperty(property, "", {operator: "is_set"})`).
   *
   * @param property - Property name.
   * @returns CohortCriteria checking property existence.
   * @throws ParamValidationError - `CD7_EMPTY_PROPERTY` when the property
   *   name is empty/blank.
   */
  static propertyIsSet(property: string): CohortCriteria {
    return CohortCriteria.hasProperty(property, "", { operator: "is_set" });
  }

  /**
   * Check if a user property does not exist — port of
   * `CohortCriteria.property_is_not_set` (shorthand for
   * `hasProperty(property, "", {operator: "is_not_set"})`).
   *
   * @param property - Property name.
   * @returns CohortCriteria checking property non-existence.
   * @throws ParamValidationError - `CD7_EMPTY_PROPERTY` when the property
   *   name is empty/blank.
   */
  static propertyIsNotSet(property: string): CohortCriteria {
    return CohortCriteria.hasProperty(property, "", {
      operator: "is_not_set",
    });
  }

  /**
   * Create a criterion for membership in a saved cohort — port of
   * `CohortCriteria.in_cohort`.
   *
   * @param cohortId - Cohort ID (must be a positive integer).
   * @returns CohortCriteria with cohort reference selector node.
   * @throws ParamValidationError - `CD8_COHORT_ID_NOT_POSITIVE` when the
   *   cohort ID is not positive.
   */
  static inCohort(cohortId: number): CohortCriteria {
    // CD8_COHORT_ID_NOT_POSITIVE: cohort_id must be a positive integer.
    if (cohortId <= 0) {
      throw new ParamValidationError(
        "cohort_id must be a positive integer",
        "CD8_COHORT_ID_NOT_POSITIVE",
      );
    }

    const selectorNode: Record<string, unknown> = {
      property: "cohort",
      value: cohortId,
      operator: "in",
    };

    return new CohortCriteria({
      _selector_node: selectorNode,
      _behavior_key: null,
      _behavior: null,
    });
  }

  /**
   * Create a criterion for non-membership in a saved cohort — port of
   * `CohortCriteria.not_in_cohort`.
   *
   * @param cohortId - Cohort ID (must be a positive integer).
   * @returns CohortCriteria with cohort exclusion selector node.
   * @throws ParamValidationError - `CD8_COHORT_ID_NOT_POSITIVE` when the
   *   cohort ID is not positive.
   */
  static notInCohort(cohortId: number): CohortCriteria {
    // CD8_COHORT_ID_NOT_POSITIVE: cohort_id must be a positive integer.
    if (cohortId <= 0) {
      throw new ParamValidationError(
        "cohort_id must be a positive integer",
        "CD8_COHORT_ID_NOT_POSITIVE",
      );
    }

    const selectorNode: Record<string, unknown> = {
      property: "cohort",
      value: cohortId,
      operator: "not in",
    };

    return new CohortCriteria({
      _selector_node: selectorNode,
      _behavior_key: null,
      _behavior: null,
    });
  }
}

/**
 * Remove null `selector` keys from behavioral event_selector entries —
 * port of the module-private `types._sanitize_raw_cohort` (exported
 * `@internal` for its conformance vectors).
 *
 * The Mixpanel API calls `postorder_traverse` on nested `selector`
 * fields within `event_selector` blocks; a `None` root causes a crash.
 * This function deep-copies the raw cohort dict and removes any
 * `selector: null` entries from behavioral event_selectors.
 *
 * Python-parity note: the Python body runs `del es["selector"]` whenever
 * `es.get("selector") is None`, which would raise `KeyError` on an
 * absent key — but every constructible `CohortDefinition.to_dict()`
 * output always carries the key, so the reachable behavior is exactly
 * "delete when present and null" (mirrored here; a JS `delete` on an
 * absent key is a silent no-op).
 *
 * @param raw - Output of `CohortDefinition.toDict()`.
 * @returns Sanitized deep copy safe for API submission.
 *
 * @remarks Not part of the public package surface — exported from this
 * module for the conformance binding and translated tests only.
 */
export function sanitizeRawCohort(
  raw: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const result = deepCopy(raw) as Record<string, unknown>;
  const behaviors = result["behaviors"];
  if (isPlainObject(behaviors)) {
    for (const bval of Object.values(behaviors)) {
      if (!isPlainObject(bval)) {
        continue;
      }
      const count = bval["count"];
      if (isPlainObject(count)) {
        const es = count["event_selector"];
        if (isPlainObject(es) && es["selector"] === null) {
          delete es["selector"];
        }
      }
    }
  }
  return result;
}

/**
 * A composed set of criteria combined with AND/OR logic — TS port of
 * `types.CohortDefinition`.
 *
 * Mirrors Python's `init=False` design: the stored `_operator` literals
 * are `"and"` (from the constructor / {@link allOf}) and `"or"` (from
 * {@link anyOf}) — there is no other operator value. Produces valid
 * Mixpanel cohort definition JSON (legacy `selector` + `behaviors`
 * format) via {@link toDict}; behavior keys are globally re-indexed to
 * ensure uniqueness across arbitrary nesting.
 */
export class CohortDefinition {
  /**
   * One or more criteria or nested definitions.
   *
   * @internal Codec-visible under its exact Python spelling.
   */
  readonly _criteria: ReadonlyArray<CohortCriteria | CohortDefinition>;

  /**
   * Boolean combinator (`"and"` | `"or"`).
   *
   * @internal Codec-visible under its exact Python spelling.
   */
  readonly _operator: "and" | "or";

  /**
   * Create a definition combining criteria with AND logic (equivalent
   * to {@link allOf}).
   *
   * @param criteria - One or more criteria or nested definitions.
   * @throws ParamValidationError - `CD9_EMPTY_CRITERIA` when no criteria
   *   are provided.
   */
  constructor(...criteria: ReadonlyArray<CohortCriteria | CohortDefinition>) {
    // CD9_EMPTY_CRITERIA: at least one criterion is required.
    if (criteria.length === 0) {
      throw new ParamValidationError(
        "CohortDefinition requires at least one criterion",
        "CD9_EMPTY_CRITERIA",
      );
    }
    this._criteria = criteria;
    this._operator = "and";
  }

  /**
   * Combine criteria and/or definitions with AND logic.
   *
   * @param criteria - One or more criteria or nested definitions.
   * @returns CohortDefinition with the AND combinator.
   * @throws ParamValidationError - `CD9_EMPTY_CRITERIA` when no criteria
   *   are provided.
   */
  static allOf(
    ...criteria: ReadonlyArray<CohortCriteria | CohortDefinition>
  ): CohortDefinition {
    return new CohortDefinition(...criteria);
  }

  /**
   * Combine criteria and/or definitions with OR logic.
   *
   * @param criteria - One or more criteria or nested definitions.
   * @returns CohortDefinition with the OR combinator.
   * @throws ParamValidationError - `CD9_EMPTY_CRITERIA` when no criteria
   *   are provided.
   */
  static anyOf(
    ...criteria: ReadonlyArray<CohortCriteria | CohortDefinition>
  ): CohortDefinition {
    const instance = new CohortDefinition(...criteria);
    // Mirror of Python's object.__setattr__ any_of construction: same
    // criteria, OR combinator. The field is declared readonly for
    // consumers; this is the one sanctioned mutation site.
    (instance as { _operator: "and" | "or" })._operator = "or";
    return instance;
  }

  /**
   * Serialize to Mixpanel cohort definition format — port of
   * `CohortDefinition.to_dict`.
   *
   * Produces `{selector: {...}, behaviors: {...}}` with globally
   * re-indexed behavior keys (`bhvr_0`, `bhvr_1`, ...) ensuring
   * uniqueness across arbitrary nesting depth (rule CD10's uniqueness
   * half — enforced structurally by the sequential re-indexing below).
   *
   * @returns Object with `selector` expression tree and `behaviors` map
   *   (deep copies — mutating the output never corrupts the criteria).
   *
   * @example
   * ```typescript
   * const cohort = CohortDefinition.allOf(
   *   CohortCriteria.hasProperty("plan", "premium"),
   *   CohortCriteria.didEvent("Purchase", { at_least: 3, within_days: 30 }),
   * );
   * const data = cohort.toDict();
   * // {selector: {operator: "and", children: [...]},
   * //  behaviors: {bhvr_0: {...}}}
   * ```
   */
  toDict(): Record<string, unknown> {
    const behaviors: Record<string, unknown> = {};
    const counter = { value: 0 };

    const collectAndBuild = (
      item: CohortCriteria | CohortDefinition,
    ): Record<string, unknown> => {
      if (item instanceof CohortCriteria) {
        // Deep copy: operand may be a mutable array (e.g. hasProperty
        // with a list value), so a shallow spread is not sufficient.
        const node = deepCopy(item._selector_node) as Record<string, unknown>;
        if (item._behavior_key !== null && item._behavior !== null) {
          const newKey = `bhvr_${String(counter.value)}`;
          counter.value += 1;
          behaviors[newKey] = deepCopy(item._behavior);
          node["value"] = newKey;
        }
        return node;
      }
      // CohortDefinition: recurse into children.
      const children = item._criteria.map((child) => collectAndBuild(child));
      return {
        operator: item._operator,
        children,
      };
    };

    const selector = collectAndBuild(this);
    return { selector, behaviors };
  }
}

/**
 * Break down query results by cohort membership — TS port of
 * `types.CohortBreakdown`.
 *
 * Accepts either a saved cohort ID (positive integer) or an inline
 * {@link CohortDefinition}. When `include_negated` is true (the
 * default), both "In Cohort" and "Not In Cohort" segments are shown.
 */
export class CohortBreakdown {
  /** Saved cohort ID or inline definition. */
  readonly cohort: number | CohortDefinition;

  /** Display name for the cohort. */
  readonly name: string | null;

  /** Whether to include a "Not In" segment. */
  readonly include_negated: boolean;

  /**
   * Create a cohort breakdown (guards fire exactly as Python's
   * `__post_init__`).
   *
   * @param fields - Declared fields; `name` defaults to `null`,
   *   `include_negated` to `true`.
   * @throws ParamValidationError - `CB1_COHORT_ID_NOT_POSITIVE` /
   *   `CB2_COHORT_NAME_EMPTY` (via the shared cohort-args guard).
   */
  constructor(fields: {
    readonly cohort: number | CohortDefinition;
    readonly name?: string | null;
    readonly include_negated?: boolean;
  }) {
    this.cohort = fields.cohort;
    this.name = fields.name ?? null;
    this.include_negated =
      fields.include_negated === undefined ? true : fields.include_negated;
    // CB1_COHORT_ID_NOT_POSITIVE / CB2_COHORT_NAME_EMPTY: shared guard.
    validateCohortArgs(this.cohort, this.name, "CB");
  }
}
