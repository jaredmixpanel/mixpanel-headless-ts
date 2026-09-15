/**
 * Filter and property-specification types: `Filter` and its static
 * factories, the `PropertySpec` union (`string` | `CustomPropertyRef` |
 * `InlineCustomProperty` with its `PropertyInput` entries) and
 * `ListItemGroupMode`. `Filter` fields keep their underscore-prefixed
 * Python spellings because the conformance codec reads them by name;
 * guards fire in Python source order, one comment per rule code. The
 * `filterValue` payloads the bookmark builders derive from these fields
 * stay JSON numbers — never stringified.
 *
 * @see mixpanel_headless.types.Filter
 */

import { pythonRepr, pythonStrip } from "../../compat/index.js";
import { ValueError } from "../../compat/python-builtins.js";
import { ParamTypeError, ParamValidationError } from "../../errors.js";
import {
  type CustomPropertyType,
  FILTER_OPERATOR_VALUES,
  type FilterDateUnit,
  type FilterOperator,
  type FilterOperatorInput,
  type FilterPropertyType,
} from "../literals.js";
import {
  isPyIntOrBool,
  isRealCalendarDate,
  matchesDateFormat,
  sanitizeRawCohort,
  validateCohortArgs,
} from "./guards.js";

/**
 * The inline-cohort argument of {@link Filter.inCohort} /
 * {@link Filter.notInCohort}: the `toDict()` half of `CohortDefinition`,
 * stated structurally so this module does not import `cohort.ts`
 * (which imports `Filter` for its `instanceof` checks).
 */
export interface CohortDefinitionLike {
  /** Serialize to the raw cohort definition dict. */
  readonly toDict: () => Record<string, unknown>;
}

/**
 * A raw property reference that binds a formula variable to a named
 * property.
 *
 * Used as an entry in {@link InlineCustomProperty.inputs} to bind a
 * formula variable (`A`–`Z`) to a concrete Mixpanel event or user
 * property.
 *
 * @example
 * ```ts
 * const price = new PropertyInput({ name: "price", type: "number" });
 * const plan = new PropertyInput({ name: "plan", resource_type: "user" });
 * ```
 * @see mixpanel_headless.types.PropertyInput
 */
export class PropertyInput {
  /** The raw property name (e.g. `"price"`, `"$browser"`). */
  readonly name: string;

  /** Property data type. */
  readonly type: "string" | "number" | "boolean" | "datetime" | "list";

  /**
   * Property domain — `"event"` or `"user"` (singular form to match
   * Mixpanel's `composedProperties` schema).
   */
  readonly resource_type: "event" | "user";

  /**
   * Create a property input.
   *
   * @param fields - Bag with `name` (the raw property name, required),
   *   `type` (defaults to `"string"`) and `resource_type` (defaults to
   *   `"event"`).
   * @throws {@link TypeError} - When `name` is absent — Python's dataclass
   *   fails eagerly at construction, and an untyped JS caller (e.g. a
   *   `{ property: "x" }` typo) would otherwise crash lazily inside
   *   `pythonStrip` at first use.
   */
  constructor(fields: {
    readonly name: string;
    readonly type?: "string" | "number" | "boolean" | "datetime" | "list";
    readonly resource_type?: "event" | "user";
  }) {
    // Missing-field check only: Python dataclasses do not type-check
    // values, so neither does this. Widened on purpose (an `as`, since a
    // typed `const` would narrow straight back) — the guard exists for
    // callers outside the type.
    const raw = fields as { readonly name?: string } | undefined;
    if (raw?.name === undefined) {
      throw new TypeError(
        "PropertyInput.__init__() missing 1 required positional argument: 'name'",
      );
    }
    this.name = fields.name;
    this.type = fields.type ?? "string";
    this.resource_type = fields.resource_type ?? "event";
  }
}

/**
 * An ephemeral computed property defined by a formula over input
 * references.
 *
 * Defines a custom property inline at query time without persisting it
 * to Mixpanel; usable as `GroupBy.property`, `Metric.property` and the
 * `property` argument of the `Filter` factories.
 *
 * @example
 * ```ts
 * const total = new InlineCustomProperty({
 *   formula: "A * B",
 *   inputs: {
 *     A: new PropertyInput({ name: "price", type: "number" }),
 *     B: new PropertyInput({ name: "quantity", type: "number" }),
 *   },
 *   property_type: "number",
 * });
 * ```
 * @see mixpanel_headless.types.InlineCustomProperty
 */
export class InlineCustomProperty {
  /** Expression in Mixpanel's formula language (max 20,000 chars). */
  readonly formula: string;

  /** Mapping from single uppercase letters (A-Z) to property references. */
  readonly inputs: Readonly<Record<string, PropertyInput>>;

  /**
   * Result type of the formula; `null` defers to the containing type
   * (e.g. `GroupBy.property_type`).
   */
  readonly property_type: "string" | "number" | "boolean" | "datetime" | null;

  /**
   * Data domain — `"events"` or `"people"` (plural form to match the
   * top-level `customProperty` schema).
   */
  readonly resource_type: "events" | "people";

  /**
   * Create an inline custom property.
   *
   * @param fields - Bag with `formula` and `inputs` (required),
   *   `property_type` (defaults to `null`) and `resource_type` (defaults
   *   to `"events"`).
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
    this.resource_type = fields.resource_type ?? "events";
  }

  /**
   * Create an inline custom property whose inputs are all numeric.
   *
   * @param formula - Expression in Mixpanel's formula language.
   * @param properties - Mapping of variable letters to property names;
   *   each entry becomes a `type="number"` {@link PropertyInput}.
   * @returns An `InlineCustomProperty` with all-numeric inputs and
   *   `property_type="number"`.
   * @example
   * ```ts
   * const icp = InlineCustomProperty.numeric("A * B", { A: "price", B: "quantity" });
   * // icp.inputs["A"].type === "number"; icp.property_type === "number"
   * ```
   * @see mixpanel_headless.types.InlineCustomProperty.numeric
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
 * A reference to a persisted custom property by its integer id.
 *
 * @example
 * ```ts
 * const ltv = new CustomPropertyRef({ id: 4821 });
 * const highValue = Filter.greaterThan(ltv, 1000);
 * ```
 * @see mixpanel_headless.types.CustomPropertyRef
 */
export class CustomPropertyRef {
  /** The custom property's server-assigned ID (must be positive). */
  readonly id: number;

  /**
   * Create a custom-property reference.
   *
   * @param fields - Bag with `id`, the server-assigned custom property
   *   id.
   */
  constructor(fields: { readonly id: number }) {
    this.id = fields.id;
  }
}

/**
 * Every way a property can be named in a query parameter: a plain name,
 * a persisted custom property, or an inline one.
 *
 * Accepted by `Metric.property`, `GroupBy.property` and the `property`
 * argument of the `Filter` factories.
 *
 * @see mixpanel_headless.types.PropertySpec
 */
export type PropertySpec = string | CustomPropertyRef | InlineCustomProperty;

/**
 * The sub-property name and scalar type behind a `GroupBy.listItem`
 * breakdown.
 *
 * Pairs the two so they cannot be set independently; its presence on a
 * `GroupBy` marks that breakdown as a list-item one.
 *
 * @example
 * ```ts
 * const mode = new ListItemGroupMode({ sub: "Brand", sub_type: "string" });
 * ```
 * @see mixpanel_headless.types.ListItemGroupMode
 */
export class ListItemGroupMode {
  /** Subproperty name as it appears inside each object. */
  readonly sub: string;

  /** Subproperty data type, matching `CustomPropertyType`. */
  readonly sub_type: CustomPropertyType;

  /**
   * Create a list-item group mode; the guards fire in Python
   * `__post_init__` order.
   *
   * @param fields - Bag with `sub` (the sub-property name) and `sub_type`
   *   (its scalar type); both are required.
   * @throws {@link ParamValidationError} - `LG1_EMPTY_SUB` when `sub` is blank,
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
    if (!pythonStrip(this.sub)) {
      throw new ParamValidationError(
        "ListItemGroupMode.sub must be a non-empty string",
        "LG1_EMPTY_SUB",
      );
    }
    // LG2_INVALID_SUB_TYPE: sub_type must be a known scalar type.
    if (!["string", "number", "boolean", "datetime"].includes(this.sub_type)) {
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
 * Value shape of {@link Filter._value}, which varies by operator; mirrors
 * the Python union `str | int | float | list[str] | list[int | float]`
 * `| list[dict[str, Any]] | None`.
 */
export type FilterValue =
  | string
  | number
  | readonly string[]
  | readonly number[]
  | ReadonlyArray<Readonly<Record<string, unknown>>>
  | null;

/**
 * Value shapes the {@link Filter} constructor accepts for `_value` — the
 * stored {@link FilterValue} union plus the bare / singly-wrapped booleans
 * that the boolean-equality collapse (`equals` + `true` on a `boolean`
 * property → `true` / `null`) consumes. Python's dataclass is untyped at
 * runtime, so `Filter("flag", "equals", True, "boolean")` is legal there;
 * this alias is the typed TS spelling of that call.
 */
type FilterValueInput = FilterValue | boolean | readonly boolean[];

/** Declared constructor fields of {@link Filter} (Python field order). */
export interface FilterFields {
  /** Property to filter on (name, ref, or inline). */
  readonly _property: PropertySpec;
  /**
   * Operator string: a `FilterOperator` wire spelling or a factory-method
   * alias (`"greater_than"`, `"is_set"`, ...); aliases are normalized to
   * the wire spelling at construction.
   */
  readonly _operator: FilterOperatorInput;
  /** Value(s) to compare against. */
  readonly _value: FilterValueInput;
  /**
   * Data type of the property.
   *
   * @defaultValue `"string"`
   */
  readonly _property_type?: FilterPropertyType;
  /**
   * Resource type to filter.
   *
   * @defaultValue `"events"`
   */
  readonly _resource_type?: "events" | "people";
  /**
   * Time unit for relative date filters.
   *
   * @defaultValue `null`
   */
  readonly _date_unit?: FilterDateUnit | null;
  /**
   * Sub-filters for `list_contains`.
   *
   * @defaultValue `null`
   */
  readonly _list_item_filters?: readonly Filter[] | null;
  /**
   * Quantifier for `list_contains`.
   *
   * @defaultValue `null`
   */
  readonly _list_item_quantifier?: "any" | "all" | null;
}

/** Runtime view of `FilterOperator` for construction-time validation. */
const FILTER_WIRE_OPERATORS: ReadonlySet<string> = new Set<string>(
  FILTER_OPERATOR_VALUES,
);

/**
 * Spellings accepted as `_operator` on direct construction and normalized
 * to the wire operator.
 *
 * Each key is the Python name of a public `Filter` factory whose spelling
 * differs from the wire operator it emits; the value is that wire
 * operator. `equals`, `contains` and `list_contains` are absent because
 * their names already *are* the wire spelling. The constructor rewrites
 * an alias to its wire operator so
 * `new Filter({ _property: "gold", _operator: "greater_than", _value: 10, _property_type: "number" })`
 * serializes exactly like `Filter.greaterThan("gold", 10)`.
 *
 * Two entries also keep the segmentation `where` builder's wider operator
 * map constructible: `"between"` (a factory name) and `"is equal to"`
 * (not a factory name) are `NUMBER_OPERATOR_MAP` rows outside the
 * literal; their targets map to the same segfilter operators (`><` and
 * `==`), so normalizing them changes nothing on the wire.
 *
 * The key type is `Exclude<FilterOperatorInput, FilterOperator>`, so the
 * compiler holds this table and the `FilterOperatorInput` literal in
 * lockstep (a missing or extra key is a type error). Exported for the
 * factory-name lockstep unit test only.
 *
 * @see mixpanel_headless.types._FILTER_OPERATOR_ALIASES
 * @internal
 */
export const FILTER_OPERATOR_ALIASES: Readonly<
  Record<Exclude<FilterOperatorInput, FilterOperator>, FilterOperator>
> = Object.freeze({
  not_equals: "does not equal",
  not_contains: "does not contain",
  greater_than: "is greater than",
  less_than: "is less than",
  between: "is between",
  not_between: "not between",
  at_least: "is at least",
  at_most: "is at most",
  is_set: "is set",
  is_not_set: "is not set",
  starts_with: "starts with",
  ends_with: "ends with",
  is_true: "true",
  is_false: "false",
  in_cohort: "contains",
  not_in_cohort: "does not contain",
  on: "was on",
  not_on: "was not on",
  before: "was before",
  since: "was since",
  in_the_last: "was in the",
  not_in_the_last: "was not in the",
  date_between: "was between",
  date_not_between: "was not between",
  in_the_next: "was in the next",
  // Segfilter-compat spelling: a NUMBER_OPERATOR_MAP row in
  // query/segfilter.ts that pre-dates the FilterOperator literal.
  // `equals` maps to the same `==` there, so output is unchanged.
  "is equal to": "equals",
});

/** The only operators the platform accepts for `filterType == "boolean"`. */
const BOOLEAN_FILTER_OPERATORS: ReadonlySet<string> = new Set([
  "true",
  "false",
]);

/**
 * Python-`repr` a rejected operator or value for an error message, falling
 * back to `String()` for shapes outside the `PythonValue` domain (class
 * instances, `undefined`, functions) so the guard itself never throws
 * anything but its own `ValueError`.
 *
 * @param value - The rejected value.
 * @returns Its Python-style repr, or `String(value)` when un-repr-able.
 */
function safeRepr(value: unknown): string {
  try {
    return pythonRepr(value as never);
  } catch {
    return String(value);
  }
}

/**
 * Build the `ValueError` text for an operator `Filter` cannot accept.
 * Shared by the non-string guard and the literal-membership guard so both
 * failure modes read identically.
 *
 * @param operator - The rejected `_operator` value (any type).
 * @returns A message naming the operator, listing the valid wire
 *   operators, and pointing at the factory methods and the accepted
 *   alias spellings.
 * @see mixpanel_headless.types._unknown_filter_operator_message
 */
function unknownFilterOperatorMessage(operator: unknown): string {
  const wire = [...FILTER_WIRE_OPERATORS].sort();
  const aliases = Object.keys(FILTER_OPERATOR_ALIASES).sort();
  return (
    `Unknown Filter operator ${safeRepr(operator)}. Valid operators: ` +
    `${pythonRepr(wire)}. Prefer the factory methods ` +
    "(Filter.equals(), Filter.greater_than(), Filter.is_set(), " +
    "Filter.is_true(), ...); their names are also accepted as " +
    `operator aliases: ${pythonRepr(aliases)}.`
  );
}

/**
 * Extract the bool a directly-constructed boolean-equality `Filter`
 * carries.
 *
 * @param value - Raw `_value` payload: `true` / `false` or a one-element
 *   array wrapping one (the `Filter.equals` list convention).
 * @returns The bool, or `null` when `value` is not a bare or singly-wrapped
 *   bool (`1` / `0` and strings deliberately do not qualify).
 * @see mixpanel_headless.types._boolean_filter_value
 */
function booleanFilterValue(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (Array.isArray(value) && value.length === 1) {
    const first: unknown = value[0];
    if (typeof first === "boolean") return first;
  }
  return null;
}

/**
 * A typed filter condition on a property.
 *
 * The static factories (`Filter.equals`, `Filter.greaterThan`,
 * `Filter.isSet`, ...) are the recommended way to build one: each maps
 * to a specific `filterType` / `filterOperator` / `filterValue` shape in
 * the bookmark JSON. Direct construction is supported and validated:
 * `_operator` must be a `FilterOperator` member or a factory-method name
 * in its Python spelling (`"greater_than"`, `"is_set"`, ...), which the
 * constructor normalizes to the wire spelling so both paths serialize
 * identically. Anything else throws `ValueError` at construction instead
 * of surfacing as an HTTP 400 from the query API. The conformance codec
 * bypasses the constructor via {@link filterUnchecked}, exactly as
 * Python's `_filter_unchecked` does.
 *
 * @example
 * ```ts
 * const adults = Filter.greaterThan("age", 18);
 * const usOrCa = Filter.equals("country", ["US", "CA"]);
 * const recent = Filter.inTheLast("last_seen", 7, "day", { resource_type: "people" });
 * // Direct construction accepts the factory-method spelling as an alias:
 * new Filter({ _property: "age", _operator: "greater_than", _value: 18, _property_type: "number" });
 * // same fields as `adults`
 * ```
 * @see mixpanel_headless.types.Filter
 */
export class Filter {
  /**
   * Property to filter on (name, ref, or inline).
   * Kept under its Python spelling because the conformance codec reads it
   * by name.
   *
   * @internal
   */
  readonly _property: PropertySpec;

  /**
   * Internal operator string.
   * Kept under its Python spelling because the conformance codec reads it
   * by name.
   *
   * @internal
   */
  readonly _operator: FilterOperator;

  /**
   * Value(s) to compare against (shape varies by operator).
   * Kept under its Python spelling because the conformance codec reads it
   * by name.
   *
   * @internal
   */
  readonly _value: FilterValue;

  /**
   * Data type of the property.
   * Kept under its Python spelling because the conformance codec reads it
   * by name.
   *
   * @internal
   */
  readonly _property_type: FilterPropertyType;

  /**
   * Resource type to filter.
   * Kept under its Python spelling because the conformance codec reads it
   * by name.
   *
   * @internal
   */
  readonly _resource_type: "events" | "people";

  /**
   * Time unit for relative date filters (`inTheLast`/`notInTheLast`/
   * `inTheNext`); `null` for non-date and absolute date filters.
   * Kept under its Python spelling because the conformance codec reads it
   * by name.
   *
   * @internal
   */
  readonly _date_unit: FilterDateUnit | null;

  /**
   * Sub-filters for `listContains`, evaluated per-item against a
   * list-of-objects property.
   * Kept under its Python spelling because the conformance codec reads it
   * by name.
   *
   * @internal
   */
  readonly _list_item_filters: readonly Filter[] | null;

  /**
   * Quantifier for `listContains`: `"any"` (at least one item matches)
   * or `"all"` (every item matches).
   * Kept under its Python spelling because the conformance codec reads it
   * by name.
   *
   * @internal
   */
  readonly _list_item_quantifier: "any" | "all" | null;

  /**
   * Construct a filter from its declared fields; the `__post_init__`
   * guards fire here.
   *
   * Runs on every construction, including the static factories (whose
   * output is already canonical and passes through untouched). In Python
   * source order:
   *
   * 1. `_operator` must be a string; a factory-method spelling in
   *    {@link FILTER_OPERATOR_ALIASES} (`"greater_than"`, `"is_set"`, ...)
   *    is rewritten to the wire operator that factory emits, and the
   *    result must be a `FilterOperator` member.
   * 2. The effective property type is derived the same way
   *    `buildFilterEntry` derives `filterType`: an `InlineCustomProperty`
   *    with a declared `property_type` wins over `_property_type`.
   * 3. On a `boolean` property, `equals` / `does not equal` with a bool
   *    value collapse to `true` / `false` with `_value = null`, matching
   *    {@link isTrue} / {@link isFalse}; any other operator on a boolean
   *    property is rejected.
   * 4. `true` / `false` (however spelled) take no value: a non-`null`
   *    `_value` is rejected on every property type, because the platform
   *    serializes boolean filters with `filterValue: null`.
   * 5. The pre-existing `list_contains` shape guards run last.
   *
   * Already-valid input is never rewritten: a wire operator and its value
   * serialize exactly as given.
   *
   * @param fields - Declared fields; absent optionals take the Python
   *   defaults.
   * @throws {@link ValueError} - If `_operator` is not a string, is neither
   *   a `FilterOperator` member nor a known alias, is an operator other
   *   than `true` / `false` on a boolean property, or is `true` / `false`
   *   with a non-`null` value. Plain (uncoded) `ValueError`, as in Python:
   *   the contract pins the coded-guard registry, so no code was
   *   registered.
   * @throws {@link ParamValidationError} - `LC1_MISSING_ITEM_FILTERS` /
   *   `LC2_MISSING_QUANTIFIER` when `_operator === "list_contains"` but
   *   the corresponding list-contains field is `null` (construct via
   *   {@link listContains}).
   */
  // eslint-disable-next-line complexity -- branch-for-branch port of one Python function (see the docblock); splitting it would scatter the guard order the corpus pins
  constructor(fields: FilterFields) {
    this._property = fields._property;
    this._property_type = fields._property_type ?? "string";
    this._resource_type = fields._resource_type ?? "events";
    this._date_unit = fields._date_unit ?? null;
    this._list_item_filters = fields._list_item_filters ?? null;
    this._list_item_quantifier = fields._list_item_quantifier ?? null;
    // __post_init__ (Python source order).
    const raw: unknown = fields._operator;
    // typeof first: a list/dict/null operator must not reach the set
    // lookup (Python: TypeError unhashable) — it gets the same ValueError.
    if (typeof raw !== "string") {
      throw new ValueError(unknownFilterOperatorMessage(raw));
    }
    const aliases: Readonly<Record<string, FilterOperator | undefined>> =
      FILTER_OPERATOR_ALIASES;
    let operator: string = Object.hasOwn(aliases, raw)
      ? (aliases[raw] as FilterOperator)
      : raw;
    if (!FILTER_WIRE_OPERATORS.has(operator)) {
      throw new ValueError(unknownFilterOperatorMessage(operator));
    }
    // Mirror buildFilterEntry: an inline custom property's declared type
    // overrides _property_type for filterType / defaultType.
    const prop = this._property;
    let effectiveType: string = this._property_type;
    if (prop instanceof InlineCustomProperty && prop.property_type !== null) {
      effectiveType = prop.property_type;
    }
    let value: unknown = fields._value;
    if (
      effectiveType === "boolean" &&
      (operator === "equals" || operator === "does not equal")
    ) {
      const truth = booleanFilterValue(value);
      if (truth !== null) {
        operator = truth === (operator === "equals") ? "true" : "false";
        value = null;
      }
    }
    if (
      effectiveType === "boolean" &&
      !BOOLEAN_FILTER_OPERATORS.has(operator)
    ) {
      throw new ValueError(
        `Filter operator ${pythonRepr(operator)} is not valid for a boolean property ` +
          `(${safeRepr(prop)}); boolean filters only support 'true' and 'false' ` +
          "with no value. Use Filter.is_true() / Filter.is_false(), or pass " +
          "value True / False with operator 'equals'.",
      );
    }
    if (BOOLEAN_FILTER_OPERATORS.has(operator) && value !== null) {
      throw new ValueError(
        `Filter operator ${pythonRepr(operator)} takes no value (got ` +
          `${safeRepr(value)}); the platform serializes boolean filters with ` +
          "filterValue null. Use Filter.is_true() / Filter.is_false(), or " +
          "pass value True / False with operator 'equals' on a boolean " +
          "property.",
      );
    }
    this._operator = operator as FilterOperator;
    // A bare bool that did not collapse (non-boolean property type) is
    // stored as given, exactly as Python's untyped dataclass does.
    this._value = value as FilterValue;
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
   * Create an equality filter.
   *
   * @param property - Property name, ref, or inline property.
   * @param value - Value or list of values.
   * @param options - Bag with `resource_type`, the entity the property
   *   belongs to: `"events"` (default) or `"people"`.
   * @returns Filter for string equality.
   * @see mixpanel_headless.types.Filter.equals
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
   * Create a not-equals filter.
   *
   * @param property - Property name, ref, or inline property.
   * @param value - Value or list of values.
   * @param options - Bag with `resource_type`, the entity the property
   *   belongs to: `"events"` (default) or `"people"`.
   * @returns Filter for string inequality.
   * @see mixpanel_headless.types.Filter.not_equals
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
   * @param options - Bag with `resource_type`, the entity the property
   *   belongs to: `"events"` (default) or `"people"`.
   * @returns Filter for substring containment.
   * @see mixpanel_headless.types.Filter.contains
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
   * Create a not-contains filter.
   *
   * @param property - Property name, ref, or inline property.
   * @param value - Substring that must not match.
   * @param options - Bag with `resource_type`, the entity the property
   *   belongs to: `"events"` (default) or `"people"`.
   * @returns Filter for substring non-containment.
   * @see mixpanel_headless.types.Filter.not_contains
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
   * Create a greater-than filter.
   *
   * @param property - Property name, ref, or inline property.
   * @param value - Numeric threshold.
   * @param options - Bag with `resource_type`, the entity the property
   *   belongs to: `"events"` (default) or `"people"`.
   * @returns Filter for numeric greater-than.
   * @see mixpanel_headless.types.Filter.greater_than
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
   * Create a less-than filter.
   *
   * @param property - Property name, ref, or inline property.
   * @param value - Numeric threshold.
   * @param options - Bag with `resource_type`, the entity the property
   *   belongs to: `"events"` (default) or `"people"`.
   * @returns Filter for numeric less-than.
   * @see mixpanel_headless.types.Filter.less_than
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
   * @param options - Bag with `resource_type`, the entity the property
   *   belongs to: `"events"` (default) or `"people"`.
   * @returns Filter for a numeric range.
   * @see mixpanel_headless.types.Filter.between
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
   * Create a not-between (exclusive range) filter.
   *
   * @param property - Property name, ref, or inline property.
   * @param minVal - Minimum value (exclusive).
   * @param maxVal - Maximum value (exclusive).
   * @param options - Bag with `resource_type`, the entity the property
   *   belongs to: `"events"` (default) or `"people"`.
   * @returns Filter for numeric values outside the range.
   * @see mixpanel_headless.types.Filter.not_between
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
   * Create a greater-than-or-equal filter.
   *
   * @param property - Property name, ref, or inline property.
   * @param value - Numeric threshold (inclusive).
   * @param options - Bag with `resource_type`, the entity the property
   *   belongs to: `"events"` (default) or `"people"`.
   * @returns Filter for numeric greater-than-or-equal.
   * @see mixpanel_headless.types.Filter.at_least
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
   * Create a less-than-or-equal filter.
   *
   * @param property - Property name, ref, or inline property.
   * @param value - Numeric threshold (inclusive).
   * @param options - Bag with `resource_type`, the entity the property
   *   belongs to: `"events"` (default) or `"people"`.
   * @returns Filter for numeric less-than-or-equal.
   * @see mixpanel_headless.types.Filter.at_most
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
   * Create a property-existence filter.
   *
   * @param property - Property name, ref, or inline property.
   * @param options - Bag with `resource_type`, the entity the property
   *   belongs to: `"events"` (default) or `"people"`.
   * @returns Filter for property existence.
   * @see mixpanel_headless.types.Filter.is_set
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
   * Create a property-nonexistence filter.
   *
   * @param property - Property name, ref, or inline property.
   * @param options - Bag with `resource_type`, the entity the property
   *   belongs to: `"events"` (default) or `"people"`.
   * @returns Filter for property non-existence.
   * @see mixpanel_headless.types.Filter.is_not_set
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
   * Create a starts-with (prefix match) filter.
   *
   * @param property - Property name, ref, or inline property.
   * @param prefix - String prefix to match.
   * @param options - Bag with `resource_type`, the entity the property
   *   belongs to: `"events"` (default) or `"people"`.
   * @returns Filter for string prefix matching.
   * @see mixpanel_headless.types.Filter.starts_with
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
   * Create an ends-with (suffix match) filter.
   *
   * @param property - Property name, ref, or inline property.
   * @param suffix - String suffix to match.
   * @param options - Bag with `resource_type`, the entity the property
   *   belongs to: `"events"` (default) or `"people"`.
   * @returns Filter for string suffix matching.
   * @see mixpanel_headless.types.Filter.ends_with
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
   * Create a boolean true filter.
   *
   * @param property - Property name, ref, or inline property.
   * @param options - Bag with `resource_type`, the entity the property
   *   belongs to: `"events"` (default) or `"people"`.
   * @returns Filter for boolean true.
   * @see mixpanel_headless.types.Filter.is_true
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
   * Create a boolean false filter.
   *
   * @param property - Property name, ref, or inline property.
   * @param options - Bag with `resource_type`, the entity the property
   *   belongs to: `"events"` (default) or `"people"`.
   * @returns Filter for boolean false.
   * @see mixpanel_headless.types.Filter.is_false
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
   * Create a filter restricting to users in a cohort.
   *
   * @param cohort - Saved cohort ID (positive integer) or inline
   *   `CohortDefinition`.
   * @param name - Display name for the cohort (optional for saved
   *   cohorts; recommended for inline definitions).
   * @returns Filter for cohort membership (contains).
   * @throws {@link ParamValidationError} - `CF1_COHORT_ID_NOT_POSITIVE` when the
   *   cohort ID is not positive, `CF2_COHORT_NAME_EMPTY` when the name
   *   is empty while provided.
   * @see mixpanel_headless.types.Filter.in_cohort
   */
  static inCohort(
    cohort: number | CohortDefinitionLike,
    name?: string | null,
  ): Filter {
    return Filter.buildCohortFilter(cohort, name ?? null, false);
  }

  /**
   * Create a filter excluding users in a cohort.
   *
   * @param cohort - Saved cohort ID (positive integer) or inline
   *   `CohortDefinition`.
   * @param name - Display name for the cohort.
   * @returns Filter for cohort exclusion (does not contain).
   * @throws {@link ParamValidationError} - `CF1_COHORT_ID_NOT_POSITIVE` when the
   *   cohort ID is not positive, `CF2_COHORT_NAME_EMPTY` when the name
   *   is empty while provided.
   * @see mixpanel_headless.types.Filter.not_in_cohort
   */
  static notInCohort(
    cohort: number | CohortDefinitionLike,
    name?: string | null,
  ): Filter {
    return Filter.buildCohortFilter(cohort, name ?? null, true);
  }

  /**
   * Build the cohort filter shared by `inCohort` and `notInCohort`.
   *
   * @param cohort - Saved cohort id or inline definition.
   * @param name - Display name (`null` when not provided).
   * @param negated - Whether this is a "does not contain" filter.
   * @returns A `Filter` with the cohort-specific internal fields.
   * @throws {@link ParamValidationError} - `CF1_COHORT_ID_NOT_POSITIVE` /
   *   `CF2_COHORT_NAME_EMPTY` from the shared cohort-args guard.
   * @see mixpanel_headless.types.Filter._build_cohort_filter
   */
  private static buildCohortFilter(
    cohort: number | CohortDefinitionLike,
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
    // `isinstance(cohort, int)` includes booleans (`bool <: int`):
    // `Filter.in_cohort(True)` emits `{id: true}`.
    if (isPyIntOrBool(cohort)) {
      cohortEntry["id"] = cohort;
    } else {
      // Inline definition: embed the sanitized to-dict payload exactly
      // as Python does (`_sanitize_raw_cohort(cohort.to_dict())`).
      cohortEntry["raw_cohort"] = sanitizeRawCohort(cohort.toDict());
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
   * Validate that a date string is `YYYY-MM-DD` and a real calendar date.
   * Returns the string itself: the fixed-width zero-padded ISO shape makes
   * lexicographic comparison equivalent to Python's `date` comparison
   * (used by the FD2 order guard).
   *
   * @param dateStr - Date string to validate.
   * @returns The validated date string.
   * @throws {@link ParamValidationError} - `V8_DATE_FORMAT` when the shape is
   *   wrong, `V8_DATE_INVALID` when the date does not exist.
   * @see mixpanel_headless.types.Filter._validate_date
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
   * Create a date equality filter (exact date match).
   *
   * @param property - Property name, ref, or inline property.
   * @param date - Date in YYYY-MM-DD format.
   * @param options - Bag with `resource_type`, the entity the property
   *   belongs to: `"events"` (default) or `"people"`.
   * @returns Filter for an exact date match.
   * @throws {@link ParamValidationError} - `V8_DATE_FORMAT` / `V8_DATE_INVALID`.
   * @see mixpanel_headless.types.Filter.on
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
   * Create a date inequality filter.
   *
   * @param property - Property name, ref, or inline property.
   * @param date - Date in YYYY-MM-DD format.
   * @param options - Bag with `resource_type`, the entity the property
   *   belongs to: `"events"` (default) or `"people"`.
   * @returns Filter for date inequality.
   * @throws {@link ParamValidationError} - `V8_DATE_FORMAT` / `V8_DATE_INVALID`.
   * @see mixpanel_headless.types.Filter.not_on
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
   * Create a date before filter.
   *
   * @param property - Property name, ref, or inline property.
   * @param date - Date in YYYY-MM-DD format.
   * @param options - Bag with `resource_type`, the entity the property
   *   belongs to: `"events"` (default) or `"people"`.
   * @returns Filter for dates before the specified date.
   * @throws {@link ParamValidationError} - `V8_DATE_FORMAT` / `V8_DATE_INVALID`.
   * @see mixpanel_headless.types.Filter.before
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
   * Create a date since filter (from date onward).
   *
   * @param property - Property name, ref, or inline property.
   * @param date - Date in YYYY-MM-DD format.
   * @param options - Bag with `resource_type`, the entity the property
   *   belongs to: `"events"` (default) or `"people"`.
   * @returns Filter for dates on or after the specified date.
   * @throws {@link ParamValidationError} - `V8_DATE_FORMAT` / `V8_DATE_INVALID`.
   * @see mixpanel_headless.types.Filter.since
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
   * Create a relative date filter (in the last N units).
   *
   * @param property - Property name, ref, or inline property.
   * @param quantity - Number of time units (must be positive).
   * @param dateUnit - Time unit (`"hour"`/`"day"`/`"week"`/`"month"`).
   * @param options - Bag with `resource_type`, the entity the property
   *   belongs to: `"events"` (default) or `"people"`.
   * @returns Filter for events within the last N units.
   * @throws {@link ParamValidationError} - `FD1_QUANTITY_NOT_POSITIVE` when the
   *   quantity is not positive.
   * @see mixpanel_headless.types.Filter.in_the_last
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
   * Create a relative date exclusion filter.
   *
   * @param property - Property name, ref, or inline property.
   * @param quantity - Number of time units (must be positive).
   * @param dateUnit - Time unit (`"hour"`/`"day"`/`"week"`/`"month"`).
   * @param options - Bag with `resource_type`, the entity the property
   *   belongs to: `"events"` (default) or `"people"`.
   * @returns Filter for events not within the last N units.
   * @throws {@link ParamValidationError} - `FD1_QUANTITY_NOT_POSITIVE` when the
   *   quantity is not positive.
   * @see mixpanel_headless.types.Filter.not_in_the_last
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
   * Create a date range filter (inclusive).
   *
   * @param property - Property name, ref, or inline property.
   * @param fromDate - Start date in YYYY-MM-DD format.
   * @param toDate - End date in YYYY-MM-DD format.
   * @param options - Bag with `resource_type`, the entity the property
   *   belongs to: `"events"` (default) or `"people"`.
   * @returns Filter for dates within the range.
   * @throws {@link ParamValidationError} - `V8_DATE_FORMAT` / `V8_DATE_INVALID`
   *   per date (from first), `FD2_DATE_ORDER` when `fromDate` is after
   *   `toDate`.
   * @see mixpanel_headless.types.Filter.date_between
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
   * Create a date exclusion range filter.
   *
   * @param property - Property name, ref, or inline property.
   * @param fromDate - Start date in YYYY-MM-DD format.
   * @param toDate - End date in YYYY-MM-DD format.
   * @param options - Bag with `resource_type`, the entity the property
   *   belongs to: `"events"` (default) or `"people"`.
   * @returns Filter for dates outside the range.
   * @throws {@link ParamValidationError} - `V8_DATE_FORMAT` / `V8_DATE_INVALID`
   *   per date (from first), `FD2_DATE_ORDER` when `fromDate` is after
   *   `toDate`.
   * @see mixpanel_headless.types.Filter.date_not_between
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
   * Create a relative date filter (in the next N units).
   *
   * @param property - Property name, ref, or inline property.
   * @param quantity - Number of time units (must be positive).
   * @param dateUnit - Time unit (`"hour"`/`"day"`/`"week"`/`"month"`).
   * @param options - Bag with `resource_type`, the entity the property
   *   belongs to: `"events"` (default) or `"people"`.
   * @returns Filter for events within the next N units.
   * @throws {@link ParamValidationError} - `FD1_QUANTITY_NOT_POSITIVE` when the
   *   quantity is not positive.
   * @see mixpanel_headless.types.Filter.in_the_next
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
   * @param options - Bag with `quantifier` (`"any"`, the default, or
   *   `"all"`), `resource_type` (defaults to `"events"`) and `equals`,
   *   the keyword-shorthand record whose every entry becomes
   *   `Filter.equals(key, value, { resource_type })`.
   * @returns Filter that emits the `listItemFilters` bookmark structure
   *   on serialization.
   * @throws {@link ParamValidationError} - `LC3_MIXED_ARGS`,
   *   `LC4_INVALID_QUANTIFIER`, `LC5_EMPTY_KWARG_KEY`,
   *   `LC7_NO_CONDITIONS`, `LC8_NESTED_LIST_CONTAINS` (transcribed in
   *   Python source order).
   * @throws {@link ParamTypeError} - `LC6_KWARG_VALUE_TYPE` when an `equals`
   *   value is not a string or array.
   * @see mixpanel_headless.types.Filter.list_contains
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
    // `string` on purpose: LC4 below is a runtime guard for untyped callers.
    const quantifier: string = options?.quantifier ?? "any";
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
      if (!pythonStrip(key)) {
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

/**
 * Rebuild a {@link Filter} field-for-field without running the constructor
 * guards.
 *
 * `new Filter(...)` validates `_operator` against `FilterOperator` and
 * normalizes alias spellings. Two callers legitimately need the
 * pre-validation object instead:
 *
 * - the conformance codec (`conformance-runner/src/vector-codecs.ts`), which must rehydrate
 *   a *recorded* Filter faithfully — pinned vectors capture the downstream
 *   builders' own guard behaviour (engage `ES13`, segfilter `SG1` / `SG2`
 *   / `SG3`) on an already-constructed Filter, so re-validating or
 *   rewriting the fields on the way in would change what the builder
 *   under test sees;
 * - tests and the differential harness that drive those same builder
 *   guards with operators the constructor now rejects.
 *
 * Library code never calls it.
 *
 * @param values - Dataclass field values keyed by field name. Fields with
 *   a dataclass default may be omitted; `_property`, `_operator` and
 *   `_value` are required.
 * @returns A Filter whose fields hold exactly the given values, with no
 *   alias normalization, operator validation, or `list_contains` shape
 *   check applied.
 * @throws {@link TypeError} - If a required field is missing or an unknown
 *   field name is supplied.
 * @example
 * ```ts
 * // A recorded Filter whose operator the constructor would now reject:
 * const legacy = filterUnchecked({ _property: "gold", _operator: "is equal to", _value: 10 });
 * ```
 * @see mixpanel_headless.types._filter_unchecked
 */
export function filterUnchecked(
  values: Readonly<Record<string, unknown>>,
): Filter {
  const remaining: Record<string, unknown> = { ...values };
  const take = (name: string, fallback?: () => unknown): unknown => {
    if (Object.hasOwn(remaining, name)) {
      const v = remaining[name];
      Reflect.deleteProperty(remaining, name);
      return v;
    }
    if (fallback === undefined) {
      throw new TypeError(
        `_filter_unchecked() missing required field ${pythonRepr(name)}`,
      );
    }
    return fallback();
  };
  const instance = Object.create(Filter.prototype) as Record<string, unknown>;
  // Python `dataclasses.fields(Filter)` order.
  instance["_property"] = take("_property");
  instance["_operator"] = take("_operator");
  instance["_value"] = take("_value");
  instance["_property_type"] = take("_property_type", () => "string");
  instance["_resource_type"] = take("_resource_type", () => "events");
  instance["_date_unit"] = take("_date_unit", () => null);
  instance["_list_item_filters"] = take("_list_item_filters", () => null);
  instance["_list_item_quantifier"] = take("_list_item_quantifier", () => null);
  const unknown = Object.keys(remaining).sort();
  if (unknown.length > 0) {
    throw new TypeError(
      `_filter_unchecked() got unknown Filter field(s): ${pythonRepr(unknown)}`,
    );
  }
  return instance as unknown as Filter;
}
