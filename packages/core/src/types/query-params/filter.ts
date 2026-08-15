/**
 * Filter/property-spec query-param types — TS port of the corresponding
 * frozen dataclasses in `mixpanel_headless/types.py` (phase2-design C7,
 * packet P2-5a): `PropertyInput`, `InlineCustomProperty`,
 * `CustomPropertyRef`, `PropertySpec`, `ListItemGroupMode`, `Filter`.
 *
 * Porting rules applied here (C7):
 * - Fields are `readonly` under their EXACT Python spellings — for
 *   `Filter` that means all 8 declared fields are `_`-prefixed and
 *   codec-visible (R7.6 wire-spelling exception); Python tuples become
 *   `ReadonlyArray`.
 * - Static factories keep Python's method names mechanically camelized
 *   (`in_the_last` → `inTheLast`) per the D12 naming map.
 * - Guard blocks are transcribed IN PYTHON SOURCE ORDER (Risk #1), one
 *   comment per registry code; guards throw
 *   `ParamValidationError`/`ParamTypeError` with the registry code.
 * - R10.12 note for Phase-3 consumers (`build_filter_entry`,
 *   `build_segfilter_entry`, `filter_to_selector`): new-format
 *   `filterValue` payloads built FROM these fields stay JSON numbers —
 *   never stringified.
 */

import { ParamTypeError, ParamValidationError } from "../../errors.js";
import type {
  CustomPropertyType,
  FilterDateUnit,
  FilterOperator,
  FilterPropertyType,
} from "../literals.js";
import type { CohortDefinition } from "./cohort.js";
import {
  isPyInt,
  isRealCalendarDate,
  matchesDateFormat,
  validateCohortArgs,
} from "./guards.js";

/**
 * A raw property reference mapping a formula variable to a named
 * property — TS port of `types.PropertyInput` (Phase 037).
 *
 * Used as an entry in {@link InlineCustomProperty.inputs} to bind a
 * formula variable (A-Z) to a concrete Mixpanel event or user property.
 */
export class PropertyInput {
  /** The raw property name (e.g. `"price"`, `"$browser"`). */
  readonly name: string;

  /** Property data type. Default: `"string"`. */
  readonly type: "string" | "number" | "boolean" | "datetime" | "list";

  /**
   * Property domain — `"event"` or `"user"` (singular form to match
   * Mixpanel's `composedProperties` schema). Default: `"event"`.
   */
  readonly resource_type: "event" | "user";

  /**
   * Create a property input.
   *
   * @param fields - Declared fields; absent optionals take the Python
   *   defaults (`type="string"`, `resource_type="event"`).
   */
  constructor(fields: {
    readonly name: string;
    readonly type?: "string" | "number" | "boolean" | "datetime" | "list";
    readonly resource_type?: "event" | "user";
  }) {
    this.name = fields.name;
    this.type = fields.type === undefined ? "string" : fields.type;
    this.resource_type =
      fields.resource_type === undefined ? "event" : fields.resource_type;
  }
}

/**
 * An ephemeral computed property defined by a formula and input
 * references — TS port of `types.InlineCustomProperty` (Phase 037).
 *
 * Defines a custom property inline at query time without persisting it
 * to Mixpanel; usable in `GroupBy.property`, `Filter` factories, and
 * `Metric.property`.
 */
export class InlineCustomProperty {
  /** Expression in Mixpanel's formula language (max 20,000 chars). */
  readonly formula: string;

  /** Mapping from single uppercase letters (A-Z) to property references. */
  readonly inputs: Readonly<Record<string, PropertyInput>>;

  /**
   * Result type of the formula; `null` defers to the containing type
   * (e.g. `GroupBy.property_type`). Default: `null`.
   */
  readonly property_type: "string" | "number" | "boolean" | "datetime" | null;

  /**
   * Data domain — `"events"` or `"people"` (plural form to match the
   * top-level `customProperty` schema). Default: `"events"`.
   */
  readonly resource_type: "events" | "people";

  /**
   * Create an inline custom property.
   *
   * @param fields - Declared fields; absent optionals take the Python
   *   defaults (`property_type=null`, `resource_type="events"`).
   */
  constructor(fields: {
    readonly formula: string;
    readonly inputs: Readonly<Record<string, PropertyInput>>;
    readonly property_type?:
      "string" | "number" | "boolean" | "datetime" | null;
    readonly resource_type?: "events" | "people";
  }) {
    this.formula = fields.formula;
    this.inputs = fields.inputs;
    this.property_type = fields.property_type ?? null;
    this.resource_type =
      fields.resource_type === undefined ? "events" : fields.resource_type;
  }

  /**
   * Create an all-numeric-input inline custom property — port of
   * `InlineCustomProperty.numeric`.
   *
   * @param formula - Expression in Mixpanel's formula language.
   * @param properties - Mapping of variable letters to property names;
   *   each entry becomes a `type="number"` {@link PropertyInput}.
   * @returns InlineCustomProperty with all-numeric inputs and
   *   `property_type="number"`.
   *
   * @example
   * ```typescript
   * const icp = InlineCustomProperty.numeric("A * B", { A: "price", B: "quantity" });
   * // icp.inputs["A"].type === "number"; icp.property_type === "number"
   * ```
   */
  static numeric(
    formula: string,
    properties: Readonly<Record<string, string>>,
  ): InlineCustomProperty {
    const inputs: Record<string, PropertyInput> = {};
    for (const [key, value] of Object.entries(properties)) {
      inputs[key] = new PropertyInput({ name: value, type: "number" });
    }
    return new InlineCustomProperty({
      formula,
      inputs,
      property_type: "number",
    });
  }
}

/**
 * A reference to a persisted custom property by its integer ID — TS
 * port of `types.CustomPropertyRef` (Phase 037).
 */
export class CustomPropertyRef {
  /** The custom property's server-assigned ID (must be positive). */
  readonly id: number;

  /**
   * Create a custom-property reference.
   *
   * @param fields - Declared fields (`id`).
   */
  constructor(fields: { readonly id: number }) {
    this.id = fields.id;
  }
}

/**
 * Union type for property specifications in query parameters — TS port
 * of the `types.PropertySpec` union alias.
 *
 * Accepted wherever a property can be specified: `Metric.property`,
 * `GroupBy.property`, and `Filter` factory `property` parameters.
 */
export type PropertySpec = string | CustomPropertyRef | InlineCustomProperty;

/**
 * Discriminator for `GroupBy.listItem` — sub-property name + scalar
 * type; TS port of `types.ListItemGroupMode`.
 *
 * Pairs the subproperty name with its inferred scalar type so they
 * cannot be set independently; presence of this value on a `GroupBy`
 * marks it as a list-item breakdown.
 */
export class ListItemGroupMode {
  /** Subproperty name as it appears inside each object. */
  readonly sub: string;

  /** Subproperty data type, matching `CustomPropertyType`. */
  readonly sub_type: CustomPropertyType;

  /**
   * Create a list-item group mode (guards fire exactly as Python's
   * `__post_init__`).
   *
   * @param fields - Declared fields (`sub`, `sub_type` — both required
   *   in Python).
   * @throws ParamValidationError - `LG1_EMPTY_SUB` when `sub` is blank,
   *   `LG2_INVALID_SUB_TYPE` when `sub_type` is not one of the four
   *   `CustomPropertyType` values.
   */
  constructor(fields: {
    readonly sub: string;
    readonly sub_type: CustomPropertyType;
  }) {
    this.sub = fields.sub;
    this.sub_type = fields.sub_type;
    // LG1_EMPTY_SUB: sub must be non-empty after stripping.
    if (!this.sub.trim()) {
      throw new ParamValidationError(
        "ListItemGroupMode.sub must be a non-empty string",
        "LG1_EMPTY_SUB",
      );
    }
    // LG2_INVALID_SUB_TYPE: sub_type must be a known scalar type.
    if (
      !["string", "number", "boolean", "datetime"].includes(
        this.sub_type as string,
      )
    ) {
      throw new ParamValidationError(
        "ListItemGroupMode.sub_type must be one of " +
          "'string'/'number'/'boolean'/'datetime', " +
          `got ${JSON.stringify(this.sub_type)}`,
        "LG2_INVALID_SUB_TYPE",
      );
    }
  }
}

/**
 * Value shape of {@link Filter._value} — mirror of the Python union
 * `str | int | float | list[str] | list[int | float] |
 * list[dict[str, Any]] | None` (shape varies by operator).
 */
export type FilterValue =
  | string
  | number
  | readonly string[]
  | readonly number[]
  | ReadonlyArray<Readonly<Record<string, unknown>>>
  | null;

/** Declared constructor fields of {@link Filter} (Python field order). */
export interface FilterFields {
  /** Property to filter on (name, ref, or inline). */
  readonly _property: PropertySpec;
  /** Internal operator string (one of the `FilterOperator` values). */
  readonly _operator: FilterOperator;
  /** Value(s) to compare against. */
  readonly _value: FilterValue;
  /** Data type of the property. Default: `"string"`. */
  readonly _property_type?: FilterPropertyType;
  /** Resource type to filter. Default: `"events"`. */
  readonly _resource_type?: "events" | "people";
  /** Time unit for relative date filters. Default: `null`. */
  readonly _date_unit?: FilterDateUnit | null;
  /** Sub-filters for `list_contains`. Default: `null`. */
  readonly _list_item_filters?: readonly Filter[] | null;
  /** Quantifier for `list_contains`. Default: `null`. */
  readonly _list_item_quantifier?: "any" | "all" | null;
}

/**
 * Represents a typed filter condition on a property — TS port of
 * `types.Filter`.
 *
 * Constructed exclusively via the static factories in the public API —
 * each maps to specific filterType/filterOperator/filterValue formats in
 * the bookmark JSON. The field constructor mirrors the Python dataclass
 * constructor (codec reconstruction reaches it, so the `__post_init__`
 * guards fire on decode too).
 */
export class Filter {
  /**
   * Property to filter on (name, ref, or inline).
   *
   * @internal Codec-visible under its exact Python spelling.
   */
  readonly _property: PropertySpec;

  /**
   * Internal operator string.
   *
   * @internal Codec-visible under its exact Python spelling.
   */
  readonly _operator: FilterOperator;

  /**
   * Value(s) to compare against (shape varies by operator).
   *
   * @internal Codec-visible under its exact Python spelling.
   */
  readonly _value: FilterValue;

  /**
   * Data type of the property.
   *
   * @internal Codec-visible under its exact Python spelling.
   */
  readonly _property_type: FilterPropertyType;

  /**
   * Resource type to filter.
   *
   * @internal Codec-visible under its exact Python spelling.
   */
  readonly _resource_type: "events" | "people";

  /**
   * Time unit for relative date filters (`inTheLast`/`notInTheLast`/
   * `inTheNext`); `null` for non-date and absolute date filters.
   *
   * @internal Codec-visible under its exact Python spelling.
   */
  readonly _date_unit: FilterDateUnit | null;

  /**
   * Sub-filters for `listContains`, evaluated per-item against a
   * list-of-objects property.
   *
   * @internal Codec-visible under its exact Python spelling.
   */
  readonly _list_item_filters: readonly Filter[] | null;

  /**
   * Quantifier for `listContains`: `"any"` (>= 1 item matches) or
   * `"all"` (every item matches).
   *
   * @internal Codec-visible under its exact Python spelling.
   */
  readonly _list_item_quantifier: "any" | "all" | null;

  /**
   * Reconstruct a filter from its declared fields (mirror of the Python
   * dataclass constructor; `__post_init__` guards fire here).
   *
   * @param fields - Declared fields; absent optionals take the Python
   *   defaults.
   * @throws ParamValidationError - `LC1_MISSING_ITEM_FILTERS` /
   *   `LC2_MISSING_QUANTIFIER` when `_operator === "list_contains"` but
   *   the corresponding list-contains field is `null` (construct via
   *   {@link listContains}).
   */
  constructor(fields: FilterFields) {
    this._property = fields._property;
    this._operator = fields._operator;
    this._value = fields._value;
    this._property_type =
      fields._property_type === undefined ? "string" : fields._property_type;
    this._resource_type =
      fields._resource_type === undefined ? "events" : fields._resource_type;
    this._date_unit = fields._date_unit ?? null;
    this._list_item_filters = fields._list_item_filters ?? null;
    this._list_item_quantifier = fields._list_item_quantifier ?? null;
    // __post_init__ (Python source order): only the list_contains mode
    // is validated here; other operator modes rely on factory-only
    // validation.
    if (this._operator === "list_contains") {
      // LC1_MISSING_ITEM_FILTERS: list_contains requires item filters.
      if (this._list_item_filters === null) {
        throw new ParamValidationError(
          "list_contains Filter requires _list_item_filters; " +
            "construct via Filter.listContains(...)",
          "LC1_MISSING_ITEM_FILTERS",
        );
      }
      // LC2_MISSING_QUANTIFIER: list_contains requires a quantifier.
      if (this._list_item_quantifier === null) {
        throw new ParamValidationError(
          "list_contains Filter requires _list_item_quantifier; " +
            "construct via Filter.listContains(...)",
          "LC2_MISSING_QUANTIFIER",
        );
      }
    }
  }

  /**
   * Create an equality filter (`equals`).
   *
   * @param property - Property name, ref, or inline property.
   * @param value - Value or list of values.
   * @param options - Optional bag: `resource_type` (default `"events"`).
   * @returns Filter for string equality.
   */
  static equals(
    property: PropertySpec,
    value: string | readonly string[],
    options?: { readonly resource_type?: "events" | "people" },
  ): Filter {
    const val = typeof value === "string" ? [value] : value;
    return new Filter({
      _property: property,
      _operator: "equals",
      _value: val,
      _property_type: "string",
      _resource_type: options?.resource_type ?? "events",
    });
  }

  /**
   * Create a not-equals filter (`not_equals`).
   *
   * @param property - Property name, ref, or inline property.
   * @param value - Value or list of values.
   * @param options - Optional bag: `resource_type` (default `"events"`).
   * @returns Filter for string inequality.
   */
  static notEquals(
    property: PropertySpec,
    value: string | readonly string[],
    options?: { readonly resource_type?: "events" | "people" },
  ): Filter {
    const val = typeof value === "string" ? [value] : value;
    return new Filter({
      _property: property,
      _operator: "does not equal",
      _value: val,
      _property_type: "string",
      _resource_type: options?.resource_type ?? "events",
    });
  }

  /**
   * Create a contains (substring) filter.
   *
   * @param property - Property name, ref, or inline property.
   * @param value - Substring to match.
   * @param options - Optional bag: `resource_type` (default `"events"`).
   * @returns Filter for substring containment.
   */
  static contains(
    property: PropertySpec,
    value: string,
    options?: { readonly resource_type?: "events" | "people" },
  ): Filter {
    return new Filter({
      _property: property,
      _operator: "contains",
      _value: value,
      _property_type: "string",
      _resource_type: options?.resource_type ?? "events",
    });
  }

  /**
   * Create a not-contains filter (`not_contains`).
   *
   * @param property - Property name, ref, or inline property.
   * @param value - Substring that must not match.
   * @param options - Optional bag: `resource_type` (default `"events"`).
   * @returns Filter for substring non-containment.
   */
  static notContains(
    property: PropertySpec,
    value: string,
    options?: { readonly resource_type?: "events" | "people" },
  ): Filter {
    return new Filter({
      _property: property,
      _operator: "does not contain",
      _value: value,
      _property_type: "string",
      _resource_type: options?.resource_type ?? "events",
    });
  }

  /**
   * Create a greater-than filter (`greater_than`).
   *
   * @param property - Property name, ref, or inline property.
   * @param value - Numeric threshold.
   * @param options - Optional bag: `resource_type` (default `"events"`).
   * @returns Filter for numeric greater-than.
   */
  static greaterThan(
    property: PropertySpec,
    value: number,
    options?: { readonly resource_type?: "events" | "people" },
  ): Filter {
    return new Filter({
      _property: property,
      _operator: "is greater than",
      _value: value,
      _property_type: "number",
      _resource_type: options?.resource_type ?? "events",
    });
  }

  /**
   * Create a less-than filter (`less_than`).
   *
   * @param property - Property name, ref, or inline property.
   * @param value - Numeric threshold.
   * @param options - Optional bag: `resource_type` (default `"events"`).
   * @returns Filter for numeric less-than.
   */
  static lessThan(
    property: PropertySpec,
    value: number,
    options?: { readonly resource_type?: "events" | "people" },
  ): Filter {
    return new Filter({
      _property: property,
      _operator: "is less than",
      _value: value,
      _property_type: "number",
      _resource_type: options?.resource_type ?? "events",
    });
  }

  /**
   * Create a between (inclusive range) filter.
   *
   * @param property - Property name, ref, or inline property.
   * @param minVal - Minimum value (inclusive).
   * @param maxVal - Maximum value (inclusive).
   * @param options - Optional bag: `resource_type` (default `"events"`).
   * @returns Filter for a numeric range.
   */
  static between(
    property: PropertySpec,
    minVal: number,
    maxVal: number,
    options?: { readonly resource_type?: "events" | "people" },
  ): Filter {
    return new Filter({
      _property: property,
      _operator: "is between",
      _value: [minVal, maxVal],
      _property_type: "number",
      _resource_type: options?.resource_type ?? "events",
    });
  }

  /**
   * Create a not-between (exclusive range) filter (`not_between`).
   *
   * @param property - Property name, ref, or inline property.
   * @param minVal - Minimum value (exclusive).
   * @param maxVal - Maximum value (exclusive).
   * @param options - Optional bag: `resource_type` (default `"events"`).
   * @returns Filter for numeric values outside the range.
   */
  static notBetween(
    property: PropertySpec,
    minVal: number,
    maxVal: number,
    options?: { readonly resource_type?: "events" | "people" },
  ): Filter {
    return new Filter({
      _property: property,
      _operator: "not between",
      _value: [minVal, maxVal],
      _property_type: "number",
      _resource_type: options?.resource_type ?? "events",
    });
  }

  /**
   * Create a greater-than-or-equal filter (`at_least`).
   *
   * @param property - Property name, ref, or inline property.
   * @param value - Numeric threshold (inclusive).
   * @param options - Optional bag: `resource_type` (default `"events"`).
   * @returns Filter for numeric greater-than-or-equal.
   */
  static atLeast(
    property: PropertySpec,
    value: number,
    options?: { readonly resource_type?: "events" | "people" },
  ): Filter {
    return new Filter({
      _property: property,
      _operator: "is at least",
      _value: value,
      _property_type: "number",
      _resource_type: options?.resource_type ?? "events",
    });
  }

  /**
   * Create a less-than-or-equal filter (`at_most`).
   *
   * @param property - Property name, ref, or inline property.
   * @param value - Numeric threshold (inclusive).
   * @param options - Optional bag: `resource_type` (default `"events"`).
   * @returns Filter for numeric less-than-or-equal.
   */
  static atMost(
    property: PropertySpec,
    value: number,
    options?: { readonly resource_type?: "events" | "people" },
  ): Filter {
    return new Filter({
      _property: property,
      _operator: "is at most",
      _value: value,
      _property_type: "number",
      _resource_type: options?.resource_type ?? "events",
    });
  }

  /**
   * Create a property-existence filter (`is_set`).
   *
   * @param property - Property name, ref, or inline property.
   * @param options - Optional bag: `resource_type` (default `"events"`).
   * @returns Filter for property existence.
   */
  static isSet(
    property: PropertySpec,
    options?: { readonly resource_type?: "events" | "people" },
  ): Filter {
    return new Filter({
      _property: property,
      _operator: "is set",
      _value: null,
      _property_type: "string",
      _resource_type: options?.resource_type ?? "events",
    });
  }

  /**
   * Create a property-nonexistence filter (`is_not_set`).
   *
   * @param property - Property name, ref, or inline property.
   * @param options - Optional bag: `resource_type` (default `"events"`).
   * @returns Filter for property non-existence.
   */
  static isNotSet(
    property: PropertySpec,
    options?: { readonly resource_type?: "events" | "people" },
  ): Filter {
    return new Filter({
      _property: property,
      _operator: "is not set",
      _value: null,
      _property_type: "string",
      _resource_type: options?.resource_type ?? "events",
    });
  }

  /**
   * Create a starts-with (prefix match) filter (`starts_with`).
   *
   * @param property - Property name, ref, or inline property.
   * @param prefix - String prefix to match.
   * @param options - Optional bag: `resource_type` (default `"events"`).
   * @returns Filter for string prefix matching.
   */
  static startsWith(
    property: PropertySpec,
    prefix: string,
    options?: { readonly resource_type?: "events" | "people" },
  ): Filter {
    return new Filter({
      _property: property,
      _operator: "starts with",
      _value: prefix,
      _property_type: "string",
      _resource_type: options?.resource_type ?? "events",
    });
  }

  /**
   * Create an ends-with (suffix match) filter (`ends_with`).
   *
   * @param property - Property name, ref, or inline property.
   * @param suffix - String suffix to match.
   * @param options - Optional bag: `resource_type` (default `"events"`).
   * @returns Filter for string suffix matching.
   */
  static endsWith(
    property: PropertySpec,
    suffix: string,
    options?: { readonly resource_type?: "events" | "people" },
  ): Filter {
    return new Filter({
      _property: property,
      _operator: "ends with",
      _value: suffix,
      _property_type: "string",
      _resource_type: options?.resource_type ?? "events",
    });
  }

  /**
   * Create a boolean true filter (`is_true`).
   *
   * @param property - Property name, ref, or inline property.
   * @param options - Optional bag: `resource_type` (default `"events"`).
   * @returns Filter for boolean true.
   */
  static isTrue(
    property: PropertySpec,
    options?: { readonly resource_type?: "events" | "people" },
  ): Filter {
    return new Filter({
      _property: property,
      _operator: "true",
      _value: null,
      _property_type: "boolean",
      _resource_type: options?.resource_type ?? "events",
    });
  }

  /**
   * Create a boolean false filter (`is_false`).
   *
   * @param property - Property name, ref, or inline property.
   * @param options - Optional bag: `resource_type` (default `"events"`).
   * @returns Filter for boolean false.
   */
  static isFalse(
    property: PropertySpec,
    options?: { readonly resource_type?: "events" | "people" },
  ): Filter {
    return new Filter({
      _property: property,
      _operator: "false",
      _value: null,
      _property_type: "boolean",
      _resource_type: options?.resource_type ?? "events",
    });
  }

  // --- Cohort filters ---

  /**
   * Create a filter restricting to users in a cohort (`in_cohort`).
   *
   * @param cohort - Saved cohort ID (positive integer) or inline
   *   `CohortDefinition`.
   * @param name - Display name for the cohort (optional for saved
   *   cohorts; recommended for inline definitions).
   * @returns Filter for cohort membership (contains).
   * @throws ParamValidationError - `CF1_COHORT_ID_NOT_POSITIVE` when the
   *   cohort ID is not positive, `CF2_COHORT_NAME_EMPTY` when the name
   *   is empty while provided.
   */
  static inCohort(
    cohort: number | CohortDefinition,
    name?: string | null,
  ): Filter {
    return Filter.buildCohortFilter(cohort, name ?? null, false);
  }

  /**
   * Create a filter excluding users in a cohort (`not_in_cohort`).
   *
   * @param cohort - Saved cohort ID (positive integer) or inline
   *   `CohortDefinition`.
   * @param name - Display name for the cohort.
   * @returns Filter for cohort exclusion (does not contain).
   * @throws ParamValidationError - `CF1_COHORT_ID_NOT_POSITIVE` when the
   *   cohort ID is not positive, `CF2_COHORT_NAME_EMPTY` when the name
   *   is empty while provided.
   */
  static notInCohort(
    cohort: number | CohortDefinition,
    name?: string | null,
  ): Filter {
    return Filter.buildCohortFilter(cohort, name ?? null, true);
  }

  /**
   * Build a cohort filter (shared by `inCohort`/`notInCohort` — port of
   * `Filter._build_cohort_filter`).
   *
   * @param cohort - Saved cohort ID or inline definition.
   * @param name - Display name (`null` when not provided).
   * @param negated - Whether this is a "does not contain" filter.
   * @returns Constructed Filter with cohort-specific internal fields.
   * @throws ParamValidationError - On CF1/CF2 violations.
   * @throws Error - TODO(port, P2-5b): the inline-`CohortDefinition`
   *   branch needs `CohortDefinition.toDict` + `sanitizeRawCohort`,
   *   which land with the cohort-family packet (no recorded vector
   *   reaches it today).
   */
  private static buildCohortFilter(
    cohort: number | CohortDefinition,
    name: string | null,
    negated: boolean,
  ): Filter {
    validateCohortArgs(cohort, name, "CF");

    const operator: FilterOperator = negated ? "does not contain" : "contains";

    // Build the cohort value structure (key insertion order mirrors the
    // Python dict literal: negated, name, then id/raw_cohort).
    const cohortEntry: Record<string, unknown> = {
      negated,
      name: name ?? "",
    };
    if (isPyInt(cohort)) {
      cohortEntry["id"] = cohort;
    } else {
      throw new Error(
        "TODO(port, P2-5b): inline CohortDefinition cohort filters need " +
          "CohortDefinition.toDict + sanitizeRawCohort (cohort-family packet)",
      );
    }

    const value: ReadonlyArray<Readonly<Record<string, unknown>>> = [
      { cohort: cohortEntry },
    ];

    return new Filter({
      _property: "$cohorts",
      _operator: operator,
      _value: value,
      _property_type: "list",
      _resource_type: "events",
    });
  }

  // --- Date/datetime filters ---

  /**
   * Validate a date string is YYYY-MM-DD and a real calendar date —
   * port of `Filter._validate_date`. Returns the string itself: the
   * fixed-width zero-padded ISO shape makes lexicographic comparison
   * equivalent to Python's `date` object comparison (used by the FD2
   * order guard).
   *
   * @param dateStr - Date string to validate.
   * @returns The validated date string.
   * @throws ParamValidationError - `V8_DATE_FORMAT` when the shape is
   *   wrong, `V8_DATE_INVALID` when the date does not exist.
   */
  private static validateDate(dateStr: string): string {
    // V8_DATE_FORMAT: must match YYYY-MM-DD.
    if (!matchesDateFormat(dateStr)) {
      throw new ParamValidationError(
        `Date must be YYYY-MM-DD format (got '${dateStr}')`,
        "V8_DATE_FORMAT",
      );
    }
    // V8_DATE_INVALID: must be a real calendar date.
    if (!isRealCalendarDate(dateStr)) {
      throw new ParamValidationError(
        `'${dateStr}' is not a valid calendar date`,
        "V8_DATE_INVALID",
      );
    }
    return dateStr;
  }

  /**
   * Create a date equality filter (`on` — exact date match).
   *
   * @param property - Property name, ref, or inline property.
   * @param date - Date in YYYY-MM-DD format.
   * @param options - Optional bag: `resource_type` (default `"events"`).
   * @returns Filter for an exact date match.
   * @throws ParamValidationError - `V8_DATE_FORMAT` / `V8_DATE_INVALID`.
   */
  static on(
    property: PropertySpec,
    date: string,
    options?: { readonly resource_type?: "events" | "people" },
  ): Filter {
    Filter.validateDate(date);
    return new Filter({
      _property: property,
      _operator: "was on",
      _value: date,
      _property_type: "datetime",
      _resource_type: options?.resource_type ?? "events",
    });
  }

  /**
   * Create a date inequality filter (`not_on`).
   *
   * @param property - Property name, ref, or inline property.
   * @param date - Date in YYYY-MM-DD format.
   * @param options - Optional bag: `resource_type` (default `"events"`).
   * @returns Filter for date inequality.
   * @throws ParamValidationError - `V8_DATE_FORMAT` / `V8_DATE_INVALID`.
   */
  static notOn(
    property: PropertySpec,
    date: string,
    options?: { readonly resource_type?: "events" | "people" },
  ): Filter {
    Filter.validateDate(date);
    return new Filter({
      _property: property,
      _operator: "was not on",
      _value: date,
      _property_type: "datetime",
      _resource_type: options?.resource_type ?? "events",
    });
  }

  /**
   * Create a date before filter (`before`).
   *
   * @param property - Property name, ref, or inline property.
   * @param date - Date in YYYY-MM-DD format.
   * @param options - Optional bag: `resource_type` (default `"events"`).
   * @returns Filter for dates before the specified date.
   * @throws ParamValidationError - `V8_DATE_FORMAT` / `V8_DATE_INVALID`.
   */
  static before(
    property: PropertySpec,
    date: string,
    options?: { readonly resource_type?: "events" | "people" },
  ): Filter {
    Filter.validateDate(date);
    return new Filter({
      _property: property,
      _operator: "was before",
      _value: date,
      _property_type: "datetime",
      _resource_type: options?.resource_type ?? "events",
    });
  }

  /**
   * Create a date since filter (`since` — from date onward).
   *
   * @param property - Property name, ref, or inline property.
   * @param date - Date in YYYY-MM-DD format.
   * @param options - Optional bag: `resource_type` (default `"events"`).
   * @returns Filter for dates on or after the specified date.
   * @throws ParamValidationError - `V8_DATE_FORMAT` / `V8_DATE_INVALID`.
   */
  static since(
    property: PropertySpec,
    date: string,
    options?: { readonly resource_type?: "events" | "people" },
  ): Filter {
    Filter.validateDate(date);
    return new Filter({
      _property: property,
      _operator: "was since",
      _value: date,
      _property_type: "datetime",
      _resource_type: options?.resource_type ?? "events",
    });
  }

  /**
   * Create a relative date filter (`in_the_last` — in the last N units).
   *
   * @param property - Property name, ref, or inline property.
   * @param quantity - Number of time units (must be positive).
   * @param dateUnit - Time unit (`"hour"`/`"day"`/`"week"`/`"month"`).
   * @param options - Optional bag: `resource_type` (default `"events"`).
   * @returns Filter for events within the last N units.
   * @throws ParamValidationError - `FD1_QUANTITY_NOT_POSITIVE` when the
   *   quantity is not positive.
   */
  static inTheLast(
    property: PropertySpec,
    quantity: number,
    dateUnit: FilterDateUnit,
    options?: { readonly resource_type?: "events" | "people" },
  ): Filter {
    // FD1_QUANTITY_NOT_POSITIVE: quantity must be positive.
    if (quantity <= 0) {
      throw new ParamValidationError(
        `quantity must be a positive integer (got ${String(quantity)})`,
        "FD1_QUANTITY_NOT_POSITIVE",
      );
    }
    return new Filter({
      _property: property,
      _operator: "was in the",
      _value: quantity,
      _property_type: "datetime",
      _resource_type: options?.resource_type ?? "events",
      _date_unit: dateUnit,
    });
  }

  /**
   * Create a relative date exclusion filter (`not_in_the_last`).
   *
   * @param property - Property name, ref, or inline property.
   * @param quantity - Number of time units (must be positive).
   * @param dateUnit - Time unit (`"hour"`/`"day"`/`"week"`/`"month"`).
   * @param options - Optional bag: `resource_type` (default `"events"`).
   * @returns Filter for events NOT within the last N units.
   * @throws ParamValidationError - `FD1_QUANTITY_NOT_POSITIVE` when the
   *   quantity is not positive.
   */
  static notInTheLast(
    property: PropertySpec,
    quantity: number,
    dateUnit: FilterDateUnit,
    options?: { readonly resource_type?: "events" | "people" },
  ): Filter {
    // FD1_QUANTITY_NOT_POSITIVE: quantity must be positive.
    if (quantity <= 0) {
      throw new ParamValidationError(
        `quantity must be a positive integer (got ${String(quantity)})`,
        "FD1_QUANTITY_NOT_POSITIVE",
      );
    }
    return new Filter({
      _property: property,
      _operator: "was not in the",
      _value: quantity,
      _property_type: "datetime",
      _resource_type: options?.resource_type ?? "events",
      _date_unit: dateUnit,
    });
  }

  /**
   * Create a date range filter (`date_between` — inclusive).
   *
   * @param property - Property name, ref, or inline property.
   * @param fromDate - Start date in YYYY-MM-DD format.
   * @param toDate - End date in YYYY-MM-DD format.
   * @param options - Optional bag: `resource_type` (default `"events"`).
   * @returns Filter for dates within the range.
   * @throws ParamValidationError - `V8_DATE_FORMAT` / `V8_DATE_INVALID`
   *   per date (from first), `FD2_DATE_ORDER` when from > to.
   */
  static dateBetween(
    property: PropertySpec,
    fromDate: string,
    toDate: string,
    options?: { readonly resource_type?: "events" | "people" },
  ): Filter {
    const fromParsed = Filter.validateDate(fromDate);
    const toParsed = Filter.validateDate(toDate);
    // FD2_DATE_ORDER: from_date must not be after to_date.
    if (fromParsed > toParsed) {
      throw new ParamValidationError(
        `from_date must be before to_date (got '${fromDate}' > '${toDate}')`,
        "FD2_DATE_ORDER",
      );
    }
    return new Filter({
      _property: property,
      _operator: "was between",
      _value: [fromDate, toDate],
      _property_type: "datetime",
      _resource_type: options?.resource_type ?? "events",
    });
  }

  /**
   * Create a date exclusion range filter (`date_not_between`).
   *
   * @param property - Property name, ref, or inline property.
   * @param fromDate - Start date in YYYY-MM-DD format.
   * @param toDate - End date in YYYY-MM-DD format.
   * @param options - Optional bag: `resource_type` (default `"events"`).
   * @returns Filter for dates outside the range.
   * @throws ParamValidationError - `V8_DATE_FORMAT` / `V8_DATE_INVALID`
   *   per date (from first), `FD2_DATE_ORDER` when from > to.
   */
  static dateNotBetween(
    property: PropertySpec,
    fromDate: string,
    toDate: string,
    options?: { readonly resource_type?: "events" | "people" },
  ): Filter {
    const fromParsed = Filter.validateDate(fromDate);
    const toParsed = Filter.validateDate(toDate);
    // FD2_DATE_ORDER: from_date must not be after to_date.
    if (fromParsed > toParsed) {
      throw new ParamValidationError(
        `from_date must be before to_date (got '${fromDate}' > '${toDate}')`,
        "FD2_DATE_ORDER",
      );
    }
    return new Filter({
      _property: property,
      _operator: "was not between",
      _value: [fromDate, toDate],
      _property_type: "datetime",
      _resource_type: options?.resource_type ?? "events",
    });
  }

  /**
   * Create a relative date filter (`in_the_next` — in the next N units).
   *
   * @param property - Property name, ref, or inline property.
   * @param quantity - Number of time units (must be positive).
   * @param dateUnit - Time unit (`"hour"`/`"day"`/`"week"`/`"month"`).
   * @param options - Optional bag: `resource_type` (default `"events"`).
   * @returns Filter for events within the next N units.
   * @throws ParamValidationError - `FD1_QUANTITY_NOT_POSITIVE` when the
   *   quantity is not positive.
   */
  static inTheNext(
    property: PropertySpec,
    quantity: number,
    dateUnit: FilterDateUnit,
    options?: { readonly resource_type?: "events" | "people" },
  ): Filter {
    // FD1_QUANTITY_NOT_POSITIVE: quantity must be positive.
    if (quantity <= 0) {
      throw new ParamValidationError(
        `quantity must be a positive integer (got ${String(quantity)})`,
        "FD1_QUANTITY_NOT_POSITIVE",
      );
    }
    return new Filter({
      _property: property,
      _operator: "was in the next",
      _value: quantity,
      _property_type: "datetime",
      _resource_type: options?.resource_type ?? "events",
      _date_unit: dateUnit,
    });
  }

  // --- List-of-object subproperty filters ---

  /**
   * Match events whose list-of-object property contains items
   * satisfying inner conditions (`list_contains`).
   *
   * Python's `*item_filters`/`**equals` calling convention maps to an
   * explicit array plus an `equals` record in the options bag; entry
   * insertion order of `equals` is preserved (it mirrors Python kwarg
   * order). Mixing the two shapes in one call raises `LC3_MIXED_ARGS`.
   *
   * @param property - Name of the list-of-object property to filter on.
   * @param itemFilters - Inner Filter instances applied per list item
   *   (mutually exclusive with `options.equals`).
   * @param options - Optional bag: `quantifier` (`"any"` default /
   *   `"all"`), `resource_type` (default `"events"`), and `equals` —
   *   the keyword-shorthand record (each entry becomes
   *   `Filter.equals(key, value, {resource_type})`).
   * @returns Filter that emits the `listItemFilters` bookmark structure
   *   on serialization.
   * @throws ParamValidationError - `LC3_MIXED_ARGS`,
   *   `LC4_INVALID_QUANTIFIER`, `LC5_EMPTY_KWARG_KEY`,
   *   `LC7_NO_CONDITIONS`, `LC8_NESTED_LIST_CONTAINS` (transcribed in
   *   Python source order).
   * @throws ParamTypeError - `LC6_KWARG_VALUE_TYPE` when an `equals`
   *   value is not a string or array.
   */
  static listContains(
    property: string,
    itemFilters: readonly Filter[] = [],
    options?: {
      readonly quantifier?: "any" | "all";
      readonly resource_type?: "events" | "people";
      readonly equals?: Readonly<
        Record<string, string | readonly string[]>
      > | null;
    },
  ): Filter {
    const quantifier = options?.quantifier ?? "any";
    const resourceType = options?.resource_type ?? "events";
    const equalsEntries = Object.entries(options?.equals ?? {});
    // LC3_MIXED_ARGS: positional inner filters XOR keyword shorthand.
    if (itemFilters.length > 0 && equalsEntries.length > 0) {
      throw new ParamValidationError(
        "Filter.list_contains: pass either positional Filter instances " +
          "OR keyword equals shorthand, not both",
        "LC3_MIXED_ARGS",
      );
    }
    // LC4_INVALID_QUANTIFIER: quantifier must be 'any' or 'all'.
    if (quantifier !== "any" && quantifier !== "all") {
      throw new ParamValidationError(
        "Filter.list_contains quantifier must be 'any' or 'all', " +
          `got ${JSON.stringify(quantifier)}`,
        "LC4_INVALID_QUANTIFIER",
      );
    }
    for (const [key, value] of equalsEntries) {
      // LC5_EMPTY_KWARG_KEY: kwarg keys must be non-empty strings.
      if (!key.trim()) {
        throw new ParamValidationError(
          "Filter.list_contains: kwarg keys must be non-empty strings",
          "LC5_EMPTY_KWARG_KEY",
        );
      }
      // LC6_KWARG_VALUE_TYPE: values must be str or list (the wire
      // format only supports string equality here).
      if (typeof value !== "string" && !Array.isArray(value)) {
        throw new ParamTypeError(
          `Filter.list_contains kwarg ${JSON.stringify(key)}: value must ` +
            `be str or list[str], got ${typeof value}`,
          "LC6_KWARG_VALUE_TYPE",
        );
      }
    }
    const subFilters: readonly Filter[] =
      itemFilters.length > 0
        ? [...itemFilters]
        : equalsEntries.map(([key, value]) =>
            Filter.equals(key, value, { resource_type: resourceType }),
          );
    // LC7_NO_CONDITIONS: at least one inner condition is required.
    if (subFilters.length === 0) {
      throw new ParamValidationError(
        "Filter.list_contains requires at least one inner condition",
        "LC7_NO_CONDITIONS",
      );
    }
    for (const sub of subFilters) {
      // LC8_NESTED_LIST_CONTAINS: nesting is not supported.
      if (sub._operator === "list_contains") {
        throw new ParamValidationError(
          "Filter.list_contains does not support nested list_contains filters",
          "LC8_NESTED_LIST_CONTAINS",
        );
      }
    }
    return new Filter({
      _property: property,
      _operator: "list_contains",
      _value: null,
      _property_type: "object",
      _resource_type: resourceType,
      _list_item_filters: subFilters,
      _list_item_quantifier: quantifier,
    });
  }
}
