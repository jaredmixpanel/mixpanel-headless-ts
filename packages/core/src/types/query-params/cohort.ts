/**
 * Cohort-definition builders: `CohortCriteria` (one atomic membership
 * condition), `CohortDefinition` (criteria combined with AND/OR) and
 * `CohortBreakdown` (segment results by cohort membership). Fields keep
 * their Python spellings, including the underscore-prefixed ones, because
 * the conformance codec reads them by name; guards fire in Python source
 * order, one comment per rule code.
 *
 * @see mixpanel_headless.types.CohortDefinition
 */

import { pythonStrip } from "../../compat/index.js";
import { KeyError } from "../../compat/python-builtins.js";
import { ParamValidationError } from "../../errors.js";
import type { CohortAggregationType } from "../literals.js";
import { CustomPropertyRef, Filter, InlineCustomProperty } from "./filter.js";
import {
  deepCopy,
  isRealCalendarDate,
  matchesDateFormat,
  validateCohortArgs,
} from "./guards.js";

/**
 * Maps `CohortCriteria.hasProperty()` operator names to selector-tree
 * operators; entry order is the Python source order. Exported for the
 * translated operator-map tests only.
 *
 * @see mixpanel_headless.types._PROPERTY_OPERATOR_MAP
 * @internal
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

// `KeyError` is imported from the shared compat twin rather than declared
// here: the oracle bridge compares `constructor.name`, and a file-local
// duplicate gets renamed (`KeyError2`) by the bundler and stops matching.
// `python-builtins.ts` is import-free, so the import creates no cycle.

/**
 * The `Filter._operator` values {@link buildEventSelector} accepts.
 *
 * These operators are emitted verbatim in the Insights bookmark filter
 * format (`filterOperator` key) — no mapping is needed because the
 * server's `output_leaf_node` routes `filterOperator` nodes through
 * `filter_to_arb_selector_string`, which understands these names
 * natively. Exported for the translated operator-map tests only.
 *
 * @see mixpanel_headless.types._FILTER_TO_SELECTOR_SUPPORTED
 * @internal
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
 * Reject a cohort date that is not a real `YYYY-MM-DD` calendar date.
 *
 * @param dateStr - Date string to validate.
 * @throws {@link ParamValidationError} - `CD6_DATE_FORMAT` when the shape is
 *   not `YYYY-MM-DD`, `CD6_DATE_INVALID` when the shape matches but the
 *   date does not exist on the calendar.
 * @see mixpanel_headless.types._validate_cohort_date
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
 * Convert `Filter` objects to the event-selector expression tree a
 * behavioural cohort criterion embeds.
 *
 * Each `Filter` is emitted as an Insights bookmark filter node
 * (`filterOperator` / `filterValue` / `filterType` keys) rather than the
 * legacy selector-tree format (`operator` / `operand`); `filterValue`
 * stays a JSON value and is never stringified. Exported for the translated
 * tests only.
 *
 * @param filters - Single `Filter` or list of `Filter`s to convert.
 * @returns Expression tree object with `operator` and `children` keys.
 * @throws {@link ParamValidationError} - `CD10_UNSUPPORTED_FILTER_OPERATOR`
 *   when a filter uses an operator outside
 *   {@link FILTER_TO_SELECTOR_SUPPORTED}.
 * @example
 * ```ts
 * buildEventSelector(Filter.equals("plan", "pro"));
 * // { operator: "and", children: [{ resourceType: "events", filterType: "string",
 * //   defaultType: "string", filterOperator: "equals", value: "plan", filterValue: ["pro"] }] }
 * ```
 * @see mixpanel_headless.types._build_event_selector
 * @internal
 */
export function buildEventSelector(
  filters: Filter | readonly Filter[],
): Record<string, unknown> {
  const filterList = filters instanceof Filter ? [filters] : filters;
  const children: Array<Record<string, unknown>> = [];
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
      const effectiveType = prop.property_type ?? f._property_type;
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
 * A single atomic condition for cohort membership.
 *
 * Build criteria through the static factories; the field constructor
 * exists for codec reconstruction only. Each criterion contributes a
 * selector node and, for behavioural criteria, a behavior entry to the
 * Mixpanel cohort-definition format (legacy `selector` + `behaviors`
 * JSON).
 *
 * @example
 * ```ts
 * const active = CohortCriteria.didEvent("Purchase", { at_least: 3, within_days: 30 });
 * const premium = CohortCriteria.hasProperty("plan", "premium");
 * const churnRisk = CohortCriteria.didNotDoEvent("Login", { within_weeks: 2 });
 * ```
 * @see mixpanel_headless.types.CohortCriteria
 */
export class CohortCriteria {
  /**
   * Expression-tree leaf node (behavioral, property, or cohort
   * reference). Kept under its Python spelling because the conformance
   * codec reads it by name.
   *
   * @internal
   */
  readonly _selector_node: Readonly<Record<string, unknown>>;

  /**
   * Placeholder behavior key (e.g. `"bhvr_0"`); `null` for
   * non-behavioral criteria. Kept under its Python spelling because the
   * conformance codec reads it by name.
   *
   * @internal
   */
  readonly _behavior_key: string | null;

  /**
   * Behavior dict entry (event selector + window/dates); `null` for
   * non-behavioral criteria. Kept under its Python spelling because the
   * conformance codec reads it by name.
   *
   * @internal
   */
  readonly _behavior: Readonly<Record<string, unknown>> | null;

  /**
   * Reconstruct a criterion from its declared fields.
   *
   * @param fields - Bag with the three declared fields: `_selector_node`
   *   (the expression-tree leaf), `_behavior_key` (placeholder key or
   *   `null`) and `_behavior` (behavior entry or `null`).
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
   * Create a behavioral criterion based on event frequency; the guards
   * fire in Python source order.
   *
   * @param event - Event name (must be non-empty).
   * @param options - Frequency / time-window / filter / aggregation
   *   options; see {@link DidEventOptions}.
   * @returns A `CohortCriteria` with a behavioral selector node and
   *   behavior entry.
   * @throws {@link ParamValidationError} - `CD4_EMPTY_EVENT`,
   *   `CA1_AGGREGATION_PAIR`, `CA2_EMPTY_AGGREGATION_PROPERTY`,
   *   `CD1_FREQUENCY_PARAM_REQUIRED`, `CD2_FREQUENCY_NEGATIVE`,
   *   `CD3_TIME_CONSTRAINT_REQUIRED`, `CD10_UNSUPPORTED_FILTER_OPERATOR`
   *   (via {@link buildEventSelector}), `CD3_WINDOW_NOT_POSITIVE`,
   *   `CD5_FROM_REQUIRES_TO`, `CD5_TO_REQUIRES_FROM`, `CD6_DATE_FORMAT`,
   *   `CD6_DATE_INVALID`, `CD6_DATE_ORDER` — first failing guard wins.
   * @see mixpanel_headless.types.CohortCriteria.did_event
   */
  // eslint-disable-next-line complexity, max-lines-per-function -- branch-for-branch port of one Python function (see the docblock); splitting it would scatter the guard order the corpus pins
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
    const chosenFreqs = freqParams.filter(
      ([, value]) => value !== null,
    ) as ReadonlyArray<readonly [string, number]>;
    if (chosenFreqs.length !== 1) {
      throw new ParamValidationError(
        "exactly one of at_least, at_most, exactly must be set",
        "CD1_FREQUENCY_PARAM_REQUIRED",
      );
    }
    const [freqName, freqValue] = chosenFreqs[0] as readonly [string, number];

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
    const chosenRolling = rollingParams.filter(
      ([, value]) => value !== null,
    ) as ReadonlyArray<readonly [string, number]>;
    const hasDateRange = fromDate !== null || toDate !== null;

    if (chosenRolling.length === 0 && !hasDateRange) {
      throw new ParamValidationError(
        "exactly one time constraint required " +
          "(within_days/weeks/months or from_date+to_date)",
        "CD3_TIME_CONSTRAINT_REQUIRED",
      );
    }
    if (chosenRolling.length > 0 && hasDateRange) {
      throw new ParamValidationError(
        "exactly one time constraint required " +
          "(within_days/weeks/months or from_date+to_date)",
        "CD3_TIME_CONSTRAINT_REQUIRED",
      );
    }
    if (chosenRolling.length > 1) {
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
      // CD10_UNSUPPORTED_FILTER_OPERATOR fires here, before the window/
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

    if (chosenRolling.length > 0) {
      const [rollingName, rollingValue] = chosenRolling[0] as readonly [
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
   * Create a criterion for users who did not perform an event; shorthand
   * for `didEvent(event, { exactly: 0, ...options })`.
   *
   * @param event - Event name.
   * @param options - Time-constraint options; see
   *   {@link DidNotDoEventOptions}.
   * @returns A `CohortCriteria` equivalent to
   *   `didEvent(event, { exactly: 0, ...options })`.
   * @throws {@link ParamValidationError} - On constraint violations (same
   *   codes as {@link didEvent}).
   * @see mixpanel_headless.types.CohortCriteria.did_not_do_event
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
   * Create a criterion on a user-profile property value.
   *
   * @param property - Property name (must be non-empty).
   * @param value - Value to compare against.
   * @param options - Bag with `operator` (defaults to `"equals"`) and
   *   `property_type` (defaults to `"string"`).
   * @returns A `CohortCriteria` with a property selector node.
   * @throws {@link ParamValidationError} - `CD7_EMPTY_PROPERTY` when the
   *   property name is empty or blank.
   * @throws {@link KeyError} - When an untyped caller passes an operator
   *   outside {@link PROPERTY_OPERATOR_MAP}, as Python's dict lookup does.
   * @see mixpanel_headless.types.CohortCriteria.has_property
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
      // Python's `_PROPERTY_OPERATOR_MAP[operator]` raises an uncoded
      // KeyError for operators outside the map. The typed signature makes
      // this unreachable from TS call sites, but vector/bridge replay can
      // carry any recorded string.
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
   * Create a criterion requiring a user property to be set; shorthand for
   * `hasProperty(property, "", { operator: "is_set" })`.
   *
   * @param property - Property name.
   * @returns A `CohortCriteria` checking property existence.
   * @throws {@link ParamValidationError} - `CD7_EMPTY_PROPERTY` when the
   *   property name is empty or blank.
   * @see mixpanel_headless.types.CohortCriteria.property_is_set
   */
  static propertyIsSet(property: string): CohortCriteria {
    return CohortCriteria.hasProperty(property, "", { operator: "is_set" });
  }

  /**
   * Create a criterion requiring a user property to be unset; shorthand
   * for `hasProperty(property, "", { operator: "is_not_set" })`.
   *
   * @param property - Property name.
   * @returns A `CohortCriteria` checking property non-existence.
   * @throws {@link ParamValidationError} - `CD7_EMPTY_PROPERTY` when the
   *   property name is empty or blank.
   * @see mixpanel_headless.types.CohortCriteria.property_is_not_set
   */
  static propertyIsNotSet(property: string): CohortCriteria {
    return CohortCriteria.hasProperty(property, "", {
      operator: "is_not_set",
    });
  }

  /**
   * Create a criterion for membership in a saved cohort.
   *
   * @param cohortId - Cohort id (must be a positive integer).
   * @returns A `CohortCriteria` with a cohort-reference selector node.
   * @throws {@link ParamValidationError} - `CD8_COHORT_ID_NOT_POSITIVE` when
   *   the cohort id is not positive.
   * @see mixpanel_headless.types.CohortCriteria.in_cohort
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
   * Create a criterion for non-membership in a saved cohort.
   *
   * @param cohortId - Cohort id (must be a positive integer).
   * @returns A `CohortCriteria` with a cohort-exclusion selector node.
   * @throws {@link ParamValidationError} - `CD8_COHORT_ID_NOT_POSITIVE` when
   *   the cohort id is not positive.
   * @see mixpanel_headless.types.CohortCriteria.not_in_cohort
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
 * A set of criteria combined with AND or OR logic, nestable to any depth.
 *
 * The stored `_operator` is `"and"` (constructor and {@link allOf}) or
 * `"or"` ({@link anyOf}); there is no other value. {@link toDict}
 * produces Mixpanel cohort-definition JSON (legacy `selector` +
 * `behaviors` format) with behavior keys re-indexed globally so they stay
 * unique across nesting.
 *
 * @example
 * ```ts
 * const cohort = CohortDefinition.allOf(
 *   CohortCriteria.hasProperty("plan", "premium"),
 *   CohortDefinition.anyOf(
 *     CohortCriteria.didEvent("Purchase", { at_least: 1, within_days: 30 }),
 *     CohortCriteria.inCohort(12345),
 *   ),
 * );
 * ```
 * @see mixpanel_headless.types.CohortDefinition
 */
export class CohortDefinition {
  /**
   * One or more criteria or nested definitions. Kept under its Python
   * spelling because the conformance codec reads it by name.
   *
   * @internal
   */
  readonly _criteria: ReadonlyArray<CohortCriteria | CohortDefinition>;

  /**
   * Boolean combinator (`"and"` | `"or"`). Kept under its Python
   * spelling because the conformance codec reads it by name.
   *
   * @internal
   */
  readonly _operator: "and" | "or";

  /**
   * Create a definition combining criteria with AND logic (equivalent
   * to {@link allOf}).
   *
   * @param criteria - One or more criteria or nested definitions.
   * @throws {@link ParamValidationError} - `CD9_EMPTY_CRITERIA` when no criteria
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
   * @returns A `CohortDefinition` with the AND combinator.
   * @throws {@link ParamValidationError} - `CD9_EMPTY_CRITERIA` when no
   *   criteria are provided.
   * @see mixpanel_headless.types.CohortDefinition.all_of
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
   * @returns A `CohortDefinition` with the OR combinator.
   * @throws {@link ParamValidationError} - `CD9_EMPTY_CRITERIA` when no
   *   criteria are provided.
   * @see mixpanel_headless.types.CohortDefinition.any_of
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
   * Serialize to the Mixpanel cohort-definition format.
   *
   * Produces `{selector: {...}, behaviors: {...}}` with globally
   * re-indexed behavior keys (`bhvr_0`, `bhvr_1`, ...) so they stay
   * unique across arbitrary nesting depth (rule CD10's uniqueness half,
   * enforced structurally by the sequential re-indexing).
   *
   * @returns Object with `selector` expression tree and `behaviors` map
   *   (deep copies — mutating the output never corrupts the criteria).
   * @example
   * ```ts
   * const cohort = CohortDefinition.allOf(
   *   CohortCriteria.hasProperty("plan", "premium"),
   *   CohortCriteria.didEvent("Purchase", { at_least: 3, within_days: 30 }),
   * );
   * const data = cohort.toDict();
   * // {selector: {operator: "and", children: [...]},
   * //  behaviors: {bhvr_0: {...}}}
   * ```
   * @see mixpanel_headless.types.CohortDefinition.to_dict
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
 * Break down query results by cohort membership.
 *
 * Accepts either a saved cohort id (positive integer) or an inline
 * {@link CohortDefinition}. When `include_negated` is true (the
 * default), both "In Cohort" and "Not In Cohort" segments are shown.
 *
 * @example
 * ```ts
 * const byPaying = new CohortBreakdown({ cohort: 12345, name: "Paying" });
 * const byInline = new CohortBreakdown({
 *   cohort: CohortDefinition.allOf(CohortCriteria.hasProperty("plan", "pro")),
 *   include_negated: false,
 * });
 * ```
 * @see mixpanel_headless.types.CohortBreakdown
 */
export class CohortBreakdown {
  /** Saved cohort ID or inline definition. */
  readonly cohort: number | CohortDefinition;

  /** Display name for the cohort. */
  readonly name: string | null;

  /** Whether to include a "Not In" segment. */
  readonly include_negated: boolean;

  /**
   * Create a cohort breakdown; the guards fire in Python `__post_init__`
   * order.
   *
   * @param fields - Bag with `cohort` (saved cohort id or inline
   *   definition, required), `name` (display name, defaults to `null`)
   *   and `include_negated` (defaults to `true`).
   * @throws {@link ParamValidationError} - `CB1_COHORT_ID_NOT_POSITIVE` /
   *   `CB2_COHORT_NAME_EMPTY` (via the shared cohort-args guard).
   */
  constructor(fields: {
    readonly cohort: number | CohortDefinition;
    readonly name?: string | null;
    readonly include_negated?: boolean;
  }) {
    this.cohort = fields.cohort;
    this.name = fields.name ?? null;
    this.include_negated = fields.include_negated ?? true;
    // CB1_COHORT_ID_NOT_POSITIVE / CB2_COHORT_NAME_EMPTY: shared guard.
    validateCohortArgs(this.cohort, this.name, "CB");
  }
}
