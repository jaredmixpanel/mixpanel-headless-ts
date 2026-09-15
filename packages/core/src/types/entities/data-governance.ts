/**
 * Data-governance families: custom events/properties, drop filters, lookup tables.
 *
 * Hand-written ports of the Pydantic entity models (phase2-design C5,
 * packet P2-7): the PYTHON models are the source of record; vendored
 * schema4api types are a compile-time cross-check only. Field names
 * keep their exact Python spelling (R3.6/R7.6); optionality follows
 * R3.9/R4.10 via the model-base materialization rules.
 */

import { pythonJsonDumps, pythonStrip } from "../../compat/index.js";
import type { CustomPropertyResourceType } from "../enums.js";
import {
  codepointLength,
  type EntityFieldSpec,
  EntityModel,
  modelFail,
  oneOf,
  prepareInit,
} from "./model-base.js";

/**
 * Constructor input for {@link CustomEventAlternative} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface CustomEventAlternativeInit {
  /** Name of the underlying event being aliased (must be non-empty). */
  readonly event: string;
}

/**
 * An underlying event aliased by a custom event.
 *
 * Mirror of Python `mixpanel_headless.types.CustomEventAlternative` (types.py:4820;
 * model_config: frozen=True, extra='allow').
 */
export class CustomEventAlternative extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "CustomEventAlternative";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    {
      name: "event",
      required: true,
      kind: "str",
      check: (value, path) => {
        if (typeof value === "string" && codepointLength(value) < 1)
          modelFail(path, "min_length 1");
        if (Array.isArray(value) && value.length === 0)
          modelFail(path, "min_length 1");
      },
    },
  ];

  /** Name of the underlying event being aliased (must be non-empty). */
  declare readonly event: string;

  /**
   * Construct a validated CustomEventAlternative (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: CustomEventAlternativeInit) {
    super(
      CustomEventAlternative,
      fields as unknown as Readonly<Record<string, unknown>>,
    );
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): CustomEventAlternative {
    return new CustomEventAlternative(
      prepareInit(
        CustomEventAlternative,
        raw,
      ) as unknown as CustomEventAlternativeInit,
    );
  }
}

/**
 * Constructor input for {@link CustomEvent} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface CustomEventInit {
  /** Server-assigned custom event ID. */
  readonly id: number;
  /** Display name shown in the Mixpanel UI and queries. */
  readonly name: string;
  /** Underlying events aliased by this custom event. */
  readonly alternatives?:
    | ReadonlyArray<CustomEventAlternative | Readonly<Record<string, unknown>>>
    | undefined;
}

/**
 * A Mixpanel custom event composed of one or more underlying events.
 *
 * Mirror of Python `mixpanel_headless.types.CustomEvent` (types.py:4841;
 * model_config: frozen=True, extra='allow').
 */
export class CustomEvent extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "CustomEvent";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "id", required: true, kind: "int" },
    { name: "name", required: true, kind: "str" },
    {
      name: "alternatives",
      default: () => [],
      nested: () => CustomEventAlternative,
      container: "list",
    },
  ];

  /** Server-assigned custom event ID. */
  declare readonly id: number;
  /** Display name shown in the Mixpanel UI and queries. */
  declare readonly name: string;
  /** Underlying events aliased by this custom event. */
  declare readonly alternatives: readonly CustomEventAlternative[];

  /**
   * Construct a validated CustomEvent (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: CustomEventInit) {
    super(CustomEvent, fields as unknown as Readonly<Record<string, unknown>>);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): CustomEvent {
    return new CustomEvent(
      prepareInit(CustomEvent, raw) as unknown as CustomEventInit,
    );
  }
}

/**
 * Constructor input for {@link CreateCustomEventParams} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface CreateCustomEventParamsInit {
  /** Display name for the custom event (must be non-empty). */
  readonly name: string;
  /** Underlying event names to alias (must be non-empty). */
  readonly alternatives: readonly string[];
}

/**
 * Parameters for creating a custom event.
 *
 * Mirror of Python `mixpanel_headless.types.CreateCustomEventParams` (types.py:4876;
 * model_config: frozen=True, extra='ignore').
 */
export class CreateCustomEventParams extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "CreateCustomEventParams";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    {
      name: "name",
      required: true,
      kind: "str",
      check: (value, path) => {
        if (typeof value === "string" && codepointLength(value) < 1)
          modelFail(path, "min_length 1");
        if (Array.isArray(value) && value.length === 0)
          modelFail(path, "min_length 1");
      },
    },
    {
      name: "alternatives",
      required: true,
      // Field(min_length=1) + the Python `_validate_alternatives`
      // field validator: no empty/whitespace-only entries, no
      // duplicates.
      check: (value, path) => {
        if (!Array.isArray(value) || value.length === 0) {
          modelFail(path, "min_length 1");
        }
        for (const item of value) {
          if (typeof item !== "string" || pythonStrip(item) === "") {
            modelFail(
              path,
              "alternatives must not contain empty or whitespace-only strings",
            );
          }
        }
        if (new Set(value).size !== value.length) {
          modelFail(path, "alternatives must be unique");
        }
      },
    },
  ];

  /** Display name for the custom event (must be non-empty). */
  declare readonly name: string;
  /** Underlying event names to alias (must be non-empty). */
  declare readonly alternatives: readonly string[];

  /**
   * Construct a validated CreateCustomEventParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: CreateCustomEventParamsInit) {
    super(
      CreateCustomEventParams,
      fields as unknown as Readonly<Record<string, unknown>>,
    );
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): CreateCustomEventParams {
    return new CreateCustomEventParams(
      prepareInit(
        CreateCustomEventParams,
        raw,
      ) as unknown as CreateCustomEventParamsInit,
    );
  }

  /**
   * Serialize to the form-encoded body the Mixpanel API expects
   * (Python `to_form_body`, `types.py:4929-4942` — ported at B6-W7,
   * decision W7-D3: the Python MODEL owns this serializer, so its twin
   * lands here rather than in the facade member module).
   *
   * `alternatives` is a CPython `json.dumps` of `[{"event": name}, …]`
   * — DEFAULT arguments, i.e. a space after every colon/comma and
   * `ensure_ascii=True`. {@link pythonJsonDumps} is that twin (R10.8:
   * never re-derive the dumper, and never `JSON.stringify`, whose
   * separators and non-ASCII handling both differ).
   *
   * @returns A record with two string fields: `name` (the display
   *   name) and `alternatives` (the JSON-encoded event list).
   * @example
   * ```typescript
   * new CreateCustomEventParams({
   *   name: "Page View",
   *   alternatives: ["Home", "Product"],
   * }).toFormBody();
   * // { name: "Page View",
   * //   alternatives: '[{"event": "Home"}, {"event": "Product"}]' }
   * ```
   */
  toFormBody(): Record<string, string> {
    return {
      name: this.name,
      alternatives: pythonJsonDumps(
        this.alternatives.map((event) => ({ event })),
      ),
    };
  }
}

/**
 * Constructor input for {@link DropFilter} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface DropFilterInit {
  /** Server-assigned filter ID. */
  readonly id: number;
  /** Event name to filter. */
  readonly event_name: string;
  /** Filter condition JSON. */
  readonly filters?: readonly unknown[] | null | undefined;
  /** Whether the filter is active. */
  readonly active?: boolean | null | undefined;
  /** Human-readable name. */
  readonly display_name?: string | null | undefined;
  /** ISO 8601 creation timestamp. */
  readonly created?: string | null | undefined;
}

/**
 * A drop filter for discarding events at ingestion.
 *
 * Mirror of Python `mixpanel_headless.types.DropFilter` (types.py:5217;
 * model_config: frozen=True, extra='allow', populate_by_name=True, alias_generator=to_camel).
 */
export class DropFilter extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "DropFilter";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "id", required: true, kind: "int" },
    {
      name: "event_name",
      required: true,
      aliases: ["eventName"],
      wire: "eventName",
      kind: "str",
    },
    { name: "filters", nullable: true },
    { name: "active", kind: "bool", nullable: true },
    {
      name: "display_name",
      aliases: ["displayName"],
      wire: "displayName",
      kind: "str",
      nullable: true,
    },
    { name: "created", kind: "str", nullable: true },
  ];

  /** Server-assigned filter ID. */
  declare readonly id: number;
  /** Event name to filter. */
  declare readonly event_name: string;
  /** Filter condition JSON. */
  declare readonly filters: readonly unknown[] | null;
  /** Whether the filter is active. */
  declare readonly active: boolean | null;
  /** Human-readable name. */
  declare readonly display_name: string | null;
  /** ISO 8601 creation timestamp. */
  declare readonly created: string | null;

  /**
   * Construct a validated DropFilter (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: DropFilterInit) {
    super(DropFilter, fields as unknown as Readonly<Record<string, unknown>>);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): DropFilter {
    return new DropFilter(
      prepareInit(DropFilter, raw) as unknown as DropFilterInit,
    );
  }
}

/**
 * Constructor input for {@link CreateDropFilterParams} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface CreateDropFilterParamsInit {
  /** Event name to filter. */
  readonly event_name: string;
  /** Filter condition JSON. */
  readonly filters: unknown;
}

/**
 * Parameters for creating a drop filter.
 *
 * Mirror of Python `mixpanel_headless.types.CreateDropFilterParams` (types.py:5257;
 * model_config: extra='ignore').
 */
export class CreateDropFilterParams extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "CreateDropFilterParams";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "event_name", required: true, kind: "str" },
    // Python `filters: Any` (`types.py:5276`) — REQUIRED but nullable:
    // a bare `Any` annotation admits `None` in pydantic v2 (probe
    // 2026-08-16: `CreateDropFilterParams(event_name="e",
    // filters=None)` validates and `exclude_none` then drops the key,
    // while omitting the key raises). `nullable: true` added at B6-W7,
    // the field's first consumer; it is the ONLY bare required `Any`
    // in the Python model set (grep-verified).
    { name: "filters", required: true, nullable: true },
  ];

  /** Event name to filter. */
  declare readonly event_name: string;
  /** Filter condition JSON. */
  declare readonly filters: unknown;

  /**
   * Construct a validated CreateDropFilterParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: CreateDropFilterParamsInit) {
    super(
      CreateDropFilterParams,
      fields as unknown as Readonly<Record<string, unknown>>,
    );
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): CreateDropFilterParams {
    return new CreateDropFilterParams(
      prepareInit(
        CreateDropFilterParams,
        raw,
      ) as unknown as CreateDropFilterParamsInit,
    );
  }
}

/**
 * Constructor input for {@link UpdateDropFilterParams} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface UpdateDropFilterParamsInit {
  /** Drop filter ID. */
  readonly id: number;
  /** New event name. */
  readonly event_name?: string | null | undefined;
  /** New filter condition JSON. */
  readonly filters?: unknown | null | undefined;
  /** Whether the filter is active. */
  readonly active?: boolean | null | undefined;
}

/**
 * Parameters for updating a drop filter.
 *
 * Mirror of Python `mixpanel_headless.types.UpdateDropFilterParams` (types.py:5280;
 * model_config: extra='ignore').
 */
export class UpdateDropFilterParams extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "UpdateDropFilterParams";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "id", required: true, kind: "int" },
    { name: "event_name", kind: "str", nullable: true },
    { name: "filters", nullable: true },
    { name: "active", kind: "bool", nullable: true },
  ];

  /** Drop filter ID. */
  declare readonly id: number;
  /** New event name. */
  declare readonly event_name: string | null;
  /** New filter condition JSON. */
  declare readonly filters: unknown | null;
  /** Whether the filter is active. */
  declare readonly active: boolean | null;

  /**
   * Construct a validated UpdateDropFilterParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: UpdateDropFilterParamsInit) {
    super(
      UpdateDropFilterParams,
      fields as unknown as Readonly<Record<string, unknown>>,
    );
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): UpdateDropFilterParams {
    return new UpdateDropFilterParams(
      prepareInit(
        UpdateDropFilterParams,
        raw,
      ) as unknown as UpdateDropFilterParamsInit,
    );
  }
}

/**
 * Constructor input for {@link DropFilterLimitsResponse} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface DropFilterLimitsResponseInit {
  /** Maximum allowed filters. */
  readonly filter_limit: number;
}

/**
 * Response model for drop filter limits.
 *
 * Mirror of Python `mixpanel_headless.types.DropFilterLimitsResponse` (types.py:5308;
 * model_config: frozen=True, extra='allow', populate_by_name=True, alias_generator=to_camel).
 */
export class DropFilterLimitsResponse extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "DropFilterLimitsResponse";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    {
      name: "filter_limit",
      required: true,
      aliases: ["filterLimit"],
      wire: "filterLimit",
      kind: "int",
    },
  ];

  /** Maximum allowed filters. */
  declare readonly filter_limit: number;

  /**
   * Construct a validated DropFilterLimitsResponse (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: DropFilterLimitsResponseInit) {
    super(
      DropFilterLimitsResponse,
      fields as unknown as Readonly<Record<string, unknown>>,
    );
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): DropFilterLimitsResponse {
    return new DropFilterLimitsResponse(
      prepareInit(
        DropFilterLimitsResponse,
        raw,
      ) as unknown as DropFilterLimitsResponseInit,
    );
  }
}

/**
 * Constructor input for {@link ComposedPropertyValue} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface ComposedPropertyValueInit {
  /** Property type. */
  readonly type?: string | null | undefined;
  /** Type cast instruction. */
  readonly type_cast?: string | null | undefined;
  /** Resource type. Uses singular form (event, user, groupprofile) from the Mixpanel API composed property schema — distinct from ``CustomPropertyResourceType`` which uses plural form. */
  readonly resource_type: string;
  /** Property name in the project (e.g. ``"deal_name"``). */
  readonly value?: string | null | undefined;
  /** Human-readable label for the property (e.g. ``"Deal Name"``). */
  readonly label?: string | null | undefined;
  /** Default property type hint (e.g. ``"string"``, ``"number"``). */
  readonly property_default_type?:
    "string" | "number" | "boolean" | "datetime" | null | undefined;
  /** Behavior specification. */
  readonly behavior?: unknown | null | undefined;
  /** Join property type. */
  readonly join_property_type?: string | null | undefined;
}

/**
 * A composed property reference within a custom property formula.
 *
 * Mirror of Python `mixpanel_headless.types.ComposedPropertyValue` (types.py:5347;
 * model_config: frozen=True, extra='allow', populate_by_name=True, alias_generator=to_camel).
 */
export class ComposedPropertyValue extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "ComposedPropertyValue";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "type", kind: "str", nullable: true },
    {
      name: "type_cast",
      aliases: ["typeCast"],
      wire: "typeCast",
      kind: "str",
      nullable: true,
    },
    {
      name: "resource_type",
      required: true,
      aliases: ["resourceType"],
      wire: "resourceType",
      kind: "str",
    },
    { name: "value", kind: "str", nullable: true },
    { name: "label", kind: "str", nullable: true },
    {
      name: "property_default_type",
      aliases: ["propertyDefaultType"],
      wire: "propertyDefaultType",
      nullable: true,
      check: oneOf(["string", "number", "boolean", "datetime"]),
    },
    { name: "behavior", nullable: true },
    {
      name: "join_property_type",
      aliases: ["joinPropertyType"],
      wire: "joinPropertyType",
      kind: "str",
      nullable: true,
    },
  ];

  /** Property type. */
  declare readonly type: string | null;
  /** Type cast instruction. */
  declare readonly type_cast: string | null;
  /** Resource type. Uses singular form (event, user, groupprofile) from the Mixpanel API composed property schema — distinct from ``CustomPropertyResourceType`` which uses plural form. */
  declare readonly resource_type: string;
  /** Property name in the project (e.g. ``"deal_name"``). */
  declare readonly value: string | null;
  /** Human-readable label for the property (e.g. ``"Deal Name"``). */
  declare readonly label: string | null;
  /** Default property type hint (e.g. ``"string"``, ``"number"``). */
  declare readonly property_default_type:
    "string" | "number" | "boolean" | "datetime" | null;
  /** Behavior specification. */
  declare readonly behavior: unknown | null;
  /** Join property type. */
  declare readonly join_property_type: string | null;

  /**
   * Construct a validated ComposedPropertyValue (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: ComposedPropertyValueInit) {
    super(
      ComposedPropertyValue,
      fields as unknown as Readonly<Record<string, unknown>>,
    );
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): ComposedPropertyValue {
    return new ComposedPropertyValue(
      prepareInit(
        ComposedPropertyValue,
        raw,
      ) as unknown as ComposedPropertyValueInit,
    );
  }
}

/**
 * Constructor input for {@link CustomProperty} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface CustomPropertyInit {
  /** Server-assigned property ID. */
  readonly custom_property_id: number;
  /** Property name. */
  readonly name: string;
  /** Property description. */
  readonly description?: string | null | undefined;
  /** Resource type (events, people, group_profiles). */
  readonly resource_type: CustomPropertyResourceType;
  /** Property type. */
  readonly property_type?: string | null | undefined;
  /** Formula expression. */
  readonly display_formula?: string | null | undefined;
  /** Referenced properties in formula. */
  readonly composed_properties?:
    | Readonly<
        Record<
          string,
          ComposedPropertyValue | Readonly<Record<string, unknown>>
        >
      >
    | null
    | undefined;
  /** Whether the property is locked. */
  readonly is_locked?: boolean | null | undefined;
  /** Whether the property is visible. */
  readonly is_visible?: boolean | null | undefined;
  /** Data group identifier. */
  readonly data_group_id?: string | null | undefined;
  /** ISO 8601 creation timestamp. */
  readonly created?: string | null | undefined;
  /** ISO 8601 modification timestamp. */
  readonly modified?: string | null | undefined;
  /** Example value. */
  readonly example_value?: string | null | undefined;
}

/**
 * A Mixpanel custom property (computed/formula property).
 *
 * Mirror of Python `mixpanel_headless.types.CustomProperty` (types.py:5396;
 * model_config: frozen=True, extra='allow', populate_by_name=True, alias_generator=to_camel).
 */
export class CustomProperty extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "CustomProperty";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    {
      name: "custom_property_id",
      required: true,
      aliases: ["customPropertyId"],
      wire: "customPropertyId",
      kind: "int",
    },
    { name: "name", required: true, kind: "str" },
    { name: "description", kind: "str", nullable: true },
    {
      name: "resource_type",
      required: true,
      aliases: ["resourceType"],
      wire: "resourceType",
      check: oneOf(["events", "people", "group_profiles"]),
    },
    {
      name: "property_type",
      aliases: ["propertyType"],
      wire: "propertyType",
      kind: "str",
      nullable: true,
    },
    {
      name: "display_formula",
      aliases: ["displayFormula"],
      wire: "displayFormula",
      kind: "str",
      nullable: true,
    },
    {
      name: "composed_properties",
      aliases: ["composedProperties"],
      wire: "composedProperties",
      nullable: true,
      nested: () => ComposedPropertyValue,
      container: "dict",
    },
    {
      name: "is_locked",
      aliases: ["isLocked"],
      wire: "isLocked",
      kind: "bool",
      nullable: true,
    },
    {
      name: "is_visible",
      aliases: ["isVisible"],
      wire: "isVisible",
      kind: "bool",
      nullable: true,
    },
    {
      name: "data_group_id",
      aliases: ["dataGroupId"],
      wire: "dataGroupId",
      kind: "str",
      nullable: true,
    },
    { name: "created", kind: "str", nullable: true },
    { name: "modified", kind: "str", nullable: true },
    {
      name: "example_value",
      aliases: ["exampleValue"],
      wire: "exampleValue",
      kind: "str",
      nullable: true,
    },
  ];

  /** Server-assigned property ID. */
  declare readonly custom_property_id: number;
  /** Property name. */
  declare readonly name: string;
  /** Property description. */
  declare readonly description: string | null;
  /** Resource type (events, people, group_profiles). */
  declare readonly resource_type: CustomPropertyResourceType;
  /** Property type. */
  declare readonly property_type: string | null;
  /** Formula expression. */
  declare readonly display_formula: string | null;
  /** Referenced properties in formula. */
  declare readonly composed_properties: Readonly<
    Record<string, ComposedPropertyValue>
  > | null;
  /** Whether the property is locked. */
  declare readonly is_locked: boolean | null;
  /** Whether the property is visible. */
  declare readonly is_visible: boolean | null;
  /** Data group identifier. */
  declare readonly data_group_id: string | null;
  /** ISO 8601 creation timestamp. */
  declare readonly created: string | null;
  /** ISO 8601 modification timestamp. */
  declare readonly modified: string | null;
  /** Example value. */
  declare readonly example_value: string | null;

  /**
   * Construct a validated CustomProperty (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: CustomPropertyInit) {
    super(
      CustomProperty,
      fields as unknown as Readonly<Record<string, unknown>>,
    );
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): CustomProperty {
    return new CustomProperty(
      prepareInit(CustomProperty, raw) as unknown as CustomPropertyInit,
    );
  }
}

/**
 * Constructor input for {@link CreateCustomPropertyParams} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface CreateCustomPropertyParamsInit {
  /** Property name. */
  readonly name: string;
  /** Resource type (events, people, group_profiles). */
  readonly resource_type: CustomPropertyResourceType;
  /** Property description. */
  readonly description?: string | null | undefined;
  /** Formula expression (mutually exclusive with behavior). */
  readonly display_formula?: string | null | undefined;
  /** Referenced properties (required if display_formula set). */
  readonly composed_properties?:
    | Readonly<
        Record<
          string,
          ComposedPropertyValue | Readonly<Record<string, unknown>>
        >
      >
    | null
    | undefined;
  /** Whether the property is locked. */
  readonly is_locked?: boolean | null | undefined;
  /** Whether the property is visible. */
  readonly is_visible?: boolean | null | undefined;
  /** Output type of the custom property (string, number, boolean, datetime). Auto-inferred by the API from the formula if not set. */
  readonly property_type?:
    "string" | "number" | "boolean" | "datetime" | null | undefined;
  /** Example output value for documentation purposes. */
  readonly example_value?: string | null | undefined;
  /** Data group identifier. */
  readonly data_group_id?: string | null | undefined;
  /** Behavior specification (mutually exclusive with display_formula). */
  readonly behavior?: unknown | null | undefined;
}

/**
 * Parameters for creating a custom property.
 *
 * Mirror of Python `mixpanel_headless.types.CreateCustomPropertyParams` (types.py:5466;
 * model_config: extra='ignore', populate_by_name=True, alias_generator=to_camel).
 */
export class CreateCustomPropertyParams extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "CreateCustomPropertyParams";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "name", required: true, kind: "str" },
    {
      name: "resource_type",
      required: true,
      aliases: ["resourceType"],
      wire: "resourceType",
      check: oneOf(["events", "people", "group_profiles"]),
    },
    { name: "description", kind: "str", nullable: true },
    {
      name: "display_formula",
      aliases: ["displayFormula"],
      wire: "displayFormula",
      kind: "str",
      nullable: true,
    },
    {
      name: "composed_properties",
      aliases: ["composedProperties"],
      wire: "composedProperties",
      nullable: true,
      nested: () => ComposedPropertyValue,
      container: "dict",
    },
    {
      name: "is_locked",
      aliases: ["isLocked"],
      wire: "isLocked",
      kind: "bool",
      nullable: true,
    },
    {
      name: "is_visible",
      aliases: ["isVisible"],
      wire: "isVisible",
      kind: "bool",
      nullable: true,
    },
    {
      name: "property_type",
      aliases: ["propertyType"],
      wire: "propertyType",
      nullable: true,
      check: oneOf(["string", "number", "boolean", "datetime"]),
    },
    {
      name: "example_value",
      aliases: ["exampleValue"],
      wire: "exampleValue",
      kind: "str",
      nullable: true,
    },
    {
      name: "data_group_id",
      aliases: ["dataGroupId"],
      wire: "dataGroupId",
      kind: "str",
      nullable: true,
    },
    { name: "behavior", nullable: true },
  ];

  /** Property name. */
  declare readonly name: string;
  /** Resource type (events, people, group_profiles). */
  declare readonly resource_type: CustomPropertyResourceType;
  /** Property description. */
  declare readonly description: string | null;
  /** Formula expression (mutually exclusive with behavior). */
  declare readonly display_formula: string | null;
  /** Referenced properties (required if display_formula set). */
  declare readonly composed_properties: Readonly<
    Record<string, ComposedPropertyValue>
  > | null;
  /** Whether the property is locked. */
  declare readonly is_locked: boolean | null;
  /** Whether the property is visible. */
  declare readonly is_visible: boolean | null;
  /** Output type of the custom property (string, number, boolean, datetime). Auto-inferred by the API from the formula if not set. */
  declare readonly property_type:
    "string" | "number" | "boolean" | "datetime" | null;
  /** Example output value for documentation purposes. */
  declare readonly example_value: string | null;
  /** Data group identifier. */
  declare readonly data_group_id: string | null;
  /** Behavior specification (mutually exclusive with display_formula). */
  declare readonly behavior: unknown | null;

  /**
   * Construct a validated CreateCustomPropertyParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: CreateCustomPropertyParamsInit) {
    super(
      CreateCustomPropertyParams,
      fields as unknown as Readonly<Record<string, unknown>>,
    );
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): CreateCustomPropertyParams {
    return new CreateCustomPropertyParams(
      prepareInit(
        CreateCustomPropertyParams,
        raw,
      ) as unknown as CreateCustomPropertyParamsInit,
    );
  }

  /**
   * Port of the Python `model_validator(mode="after")`
   * `_validate_formula_behavior`: mutual exclusion of
   * `display_formula`/`behavior`, `behavior`/`composed_properties`,
   * `display_formula` requires `composed_properties`, and one of
   * `display_formula`/`behavior` must be set — in Python's check
   * order.
   *
   * @throws ResponseValidationError - On any violated rule.
   */
  protected override afterValidate(): void {
    if (this.display_formula !== null && this.behavior !== null) {
      modelFail(
        "CreateCustomPropertyParams",
        "display_formula and behavior are mutually exclusive",
      );
    }
    if (this.behavior !== null && this.composed_properties !== null) {
      modelFail(
        "CreateCustomPropertyParams",
        "behavior and composed_properties are mutually exclusive",
      );
    }
    if (this.display_formula !== null && this.composed_properties === null) {
      modelFail(
        "CreateCustomPropertyParams",
        "display_formula requires composed_properties",
      );
    }
    if (this.display_formula === null && this.behavior === null) {
      modelFail(
        "CreateCustomPropertyParams",
        "one of display_formula or behavior must be set",
      );
    }
  }
}

/**
 * Constructor input for {@link UpdateCustomPropertyParams} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface UpdateCustomPropertyParamsInit {
  /** Property name. */
  readonly name?: string | null | undefined;
  /** Property description. */
  readonly description?: string | null | undefined;
  /** Formula expression. */
  readonly display_formula?: string | null | undefined;
  /** Referenced properties. */
  readonly composed_properties?:
    | Readonly<
        Record<
          string,
          ComposedPropertyValue | Readonly<Record<string, unknown>>
        >
      >
    | null
    | undefined;
  /** Whether the property is locked. */
  readonly is_locked?: boolean | null | undefined;
  /** Whether the property is visible. */
  readonly is_visible?: boolean | null | undefined;
}

/**
 * Parameters for updating a custom property (PUT — full replacement).
 *
 * Mirror of Python `mixpanel_headless.types.UpdateCustomPropertyParams` (types.py:5564;
 * model_config: extra='ignore', populate_by_name=True, alias_generator=to_camel).
 */
export class UpdateCustomPropertyParams extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "UpdateCustomPropertyParams";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "name", kind: "str", nullable: true },
    { name: "description", kind: "str", nullable: true },
    {
      name: "display_formula",
      aliases: ["displayFormula"],
      wire: "displayFormula",
      kind: "str",
      nullable: true,
    },
    {
      name: "composed_properties",
      aliases: ["composedProperties"],
      wire: "composedProperties",
      nullable: true,
      nested: () => ComposedPropertyValue,
      container: "dict",
    },
    {
      name: "is_locked",
      aliases: ["isLocked"],
      wire: "isLocked",
      kind: "bool",
      nullable: true,
    },
    {
      name: "is_visible",
      aliases: ["isVisible"],
      wire: "isVisible",
      kind: "bool",
      nullable: true,
    },
  ];

  /** Property name. */
  declare readonly name: string | null;
  /** Property description. */
  declare readonly description: string | null;
  /** Formula expression. */
  declare readonly display_formula: string | null;
  /** Referenced properties. */
  declare readonly composed_properties: Readonly<
    Record<string, ComposedPropertyValue>
  > | null;
  /** Whether the property is locked. */
  declare readonly is_locked: boolean | null;
  /** Whether the property is visible. */
  declare readonly is_visible: boolean | null;

  /**
   * Construct a validated UpdateCustomPropertyParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: UpdateCustomPropertyParamsInit) {
    super(
      UpdateCustomPropertyParams,
      fields as unknown as Readonly<Record<string, unknown>>,
    );
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): UpdateCustomPropertyParams {
    return new UpdateCustomPropertyParams(
      prepareInit(
        UpdateCustomPropertyParams,
        raw,
      ) as unknown as UpdateCustomPropertyParamsInit,
    );
  }
}

/**
 * Constructor input for {@link LookupTable} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface LookupTableInit {
  /**
   * Server-assigned table ID — a signed int64 (Mixpanel assigns negative
   * ids such as `-8644926364725811123`). A `number` when the value is a
   * safe integer, a `bigint` beyond 2^53 (the pydantic-lax decode also
   * narrows a decimal string or a lossless `JsonNumber` token the same
   * way).
   */
  readonly id: number | bigint;
  /** Table name. */
  readonly name: string;
  /** Table token. */
  readonly token?: string | null | undefined;
  /** ISO 8601 creation timestamp. */
  readonly created_at?: string | null | undefined;
  /** ISO 8601 modification timestamp. */
  readonly last_modified_at?: string | null | undefined;
  /** Whether the table has mapped properties. */
  readonly has_mapped_properties?: boolean | null | undefined;
}

/**
 * A Mixpanel lookup table.
 *
 * Mirror of Python `mixpanel_headless.types.LookupTable` (types.py:5609;
 * model_config: frozen=True, extra='allow', populate_by_name=True, alias_generator=to_camel).
 */
export class LookupTable extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "LookupTable";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    // int64, not int: live ids exceed 2^53 (see `LookupTableInit.id`).
    { name: "id", required: true, kind: "int64" },
    { name: "name", required: true, kind: "str" },
    { name: "token", kind: "str", nullable: true },
    {
      name: "created_at",
      aliases: ["createdAt"],
      wire: "createdAt",
      kind: "str",
      nullable: true,
    },
    {
      name: "last_modified_at",
      aliases: ["lastModifiedAt"],
      wire: "lastModifiedAt",
      kind: "str",
      nullable: true,
    },
    {
      name: "has_mapped_properties",
      aliases: ["hasMappedProperties"],
      wire: "hasMappedProperties",
      kind: "bool",
      nullable: true,
    },
  ];

  /**
   * Server-assigned table ID: a `number` when it is a safe integer,
   * else the exact `bigint` (signed int64 — never rounded). `toJSON()`
   * emits the `bigint` unchanged; render it with a bigint-aware
   * serializer (plain `JSON.stringify` throws on `bigint`).
   */
  declare readonly id: number | bigint;
  /** Table name. */
  declare readonly name: string;
  /** Table token. */
  declare readonly token: string | null;
  /** ISO 8601 creation timestamp. */
  declare readonly created_at: string | null;
  /** ISO 8601 modification timestamp. */
  declare readonly last_modified_at: string | null;
  /** Whether the table has mapped properties. */
  declare readonly has_mapped_properties: boolean | null;

  /**
   * Construct a validated LookupTable (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: LookupTableInit) {
    super(LookupTable, fields as unknown as Readonly<Record<string, unknown>>);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): LookupTable {
    return new LookupTable(
      prepareInit(LookupTable, raw) as unknown as LookupTableInit,
    );
  }
}

/**
 * Constructor input for {@link UploadLookupTableParams} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface UploadLookupTableParamsInit {
  /** Table name (1-255 characters). */
  readonly name: string;
  /** Path to local CSV file. */
  readonly file_path: string;
  /**
   * For replacing an existing table — a signed int64; pass a `bigint`
   * for ids beyond 2^53.
   */
  readonly data_group_id?: number | bigint | null | undefined;
}

/**
 * Parameters for uploading a lookup table CSV.
 *
 * Mirror of Python `mixpanel_headless.types.UploadLookupTableParams` (types.py:5649;
 * model_config: extra='ignore').
 */
export class UploadLookupTableParams extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "UploadLookupTableParams";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    {
      name: "name",
      required: true,
      kind: "str",
      // Python: Field(min_length=1, max_length=255) — codepoint-counted.
      check: (value, path) => {
        if (typeof value === "string" && codepointLength(value) < 1) {
          modelFail(path, "min_length 1");
        }
        if (typeof value === "string" && codepointLength(value) > 255) {
          modelFail(path, "max_length 255");
        }
      },
    },
    { name: "file_path", required: true, kind: "str" },
    { name: "data_group_id", kind: "int64", nullable: true },
  ];

  /** Table name (1-255 characters). */
  declare readonly name: string;
  /** Path to local CSV file. */
  declare readonly file_path: string;
  /** For replacing an existing table (`bigint` beyond 2^53). */
  declare readonly data_group_id: number | bigint | null;

  /**
   * Construct a validated UploadLookupTableParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: UploadLookupTableParamsInit) {
    super(
      UploadLookupTableParams,
      fields as unknown as Readonly<Record<string, unknown>>,
    );
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): UploadLookupTableParams {
    return new UploadLookupTableParams(
      prepareInit(
        UploadLookupTableParams,
        raw,
      ) as unknown as UploadLookupTableParamsInit,
    );
  }
}

/**
 * Constructor input for {@link MarkLookupTableReadyParams} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface MarkLookupTableReadyParamsInit {
  /** Table name. */
  readonly name: string;
  /** Primary key column name. */
  readonly key: string;
  /**
   * For replacing an existing table — a signed int64; pass a `bigint`
   * for ids beyond 2^53.
   */
  readonly data_group_id?: number | bigint | null | undefined;
}

/**
 * Parameters for marking a lookup table as ready.
 *
 * Mirror of Python `mixpanel_headless.types.MarkLookupTableReadyParams` (types.py:5680;
 * model_config: extra='ignore').
 */
export class MarkLookupTableReadyParams extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "MarkLookupTableReadyParams";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "name", required: true, kind: "str" },
    { name: "key", required: true, kind: "str" },
    { name: "data_group_id", kind: "int64", nullable: true },
  ];

  /** Table name. */
  declare readonly name: string;
  /** Primary key column name. */
  declare readonly key: string;
  /** For replacing an existing table (`bigint` beyond 2^53). */
  declare readonly data_group_id: number | bigint | null;

  /**
   * Construct a validated MarkLookupTableReadyParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: MarkLookupTableReadyParamsInit) {
    super(
      MarkLookupTableReadyParams,
      fields as unknown as Readonly<Record<string, unknown>>,
    );
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): MarkLookupTableReadyParams {
    return new MarkLookupTableReadyParams(
      prepareInit(
        MarkLookupTableReadyParams,
        raw,
      ) as unknown as MarkLookupTableReadyParamsInit,
    );
  }
}

/**
 * Constructor input for {@link LookupTableUploadUrl} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface LookupTableUploadUrlInit {
  /** Signed GCS upload URL. */
  readonly url: string;
  /** GCS path for registration. */
  readonly path: string;
  /** Primary key column name. */
  readonly key: string;
}

/**
 * Response model for lookup table upload URL request.
 *
 * Mirror of Python `mixpanel_headless.types.LookupTableUploadUrl` (types.py:5704;
 * model_config: frozen=True, extra='allow', populate_by_name=True, alias_generator=to_camel).
 */
export class LookupTableUploadUrl extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "LookupTableUploadUrl";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "url", required: true, kind: "str" },
    { name: "path", required: true, kind: "str" },
    { name: "key", required: true, kind: "str" },
  ];

  /** Signed GCS upload URL. */
  declare readonly url: string;
  /** GCS path for registration. */
  declare readonly path: string;
  /** Primary key column name. */
  declare readonly key: string;

  /**
   * Construct a validated LookupTableUploadUrl (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: LookupTableUploadUrlInit) {
    super(
      LookupTableUploadUrl,
      fields as unknown as Readonly<Record<string, unknown>>,
    );
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): LookupTableUploadUrl {
    return new LookupTableUploadUrl(
      prepareInit(
        LookupTableUploadUrl,
        raw,
      ) as unknown as LookupTableUploadUrlInit,
    );
  }
}

/**
 * Constructor input for {@link UpdateLookupTableParams} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface UpdateLookupTableParamsInit {
  /** New table name. */
  readonly name?: string | null | undefined;
}

/**
 * Parameters for updating a lookup table.
 *
 * Mirror of Python `mixpanel_headless.types.UpdateLookupTableParams` (types.py:5736;
 * model_config: extra='ignore').
 */
export class UpdateLookupTableParams extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "UpdateLookupTableParams";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "name", kind: "str", nullable: true },
  ];

  /** New table name. */
  declare readonly name: string | null;

  /**
   * Construct a validated UpdateLookupTableParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: UpdateLookupTableParamsInit) {
    super(
      UpdateLookupTableParams,
      fields as unknown as Readonly<Record<string, unknown>>,
    );
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): UpdateLookupTableParams {
    return new UpdateLookupTableParams(
      prepareInit(
        UpdateLookupTableParams,
        raw,
      ) as unknown as UpdateLookupTableParamsInit,
    );
  }
}
