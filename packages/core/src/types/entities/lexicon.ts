/**
 * Lexicon definition family (events, properties, tags, bulk updates).
 *
 * Hand-written ports of the Pydantic entity models (phase2-design C5,
 * packet P2-7): the PYTHON models are the source of record; vendored
 * schema4api types are a compile-time cross-check only. Field names
 * keep their exact Python spelling; optionality follows
 * R3.9/R4.10 via the model-base materialization rules.
 */

import {
  type EntityFieldSpecs,
  EntityModel,
  oneOf,
  prepareInit,
} from "./model-base.js";

/**
 * Constructor input for {@link EventDefinition} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface EventDefinitionInit {
  /** Server-assigned event ID. */
  readonly id: number;
  /** Event name (unique identifier). */
  readonly name: string;
  /** Human-readable name. */
  readonly display_name?: string | null | undefined;
  /** Event description. */
  readonly description?: string | null | undefined;
  /** Whether hidden from UI. */
  readonly hidden?: boolean | null | undefined;
  /** Whether data is dropped at ingestion. */
  readonly dropped?: boolean | null | undefined;
  /** Whether merged into another event. */
  readonly merged?: boolean | null | undefined;
  /** Whether verified by governance team. */
  readonly verified?: boolean | null | undefined;
  /** Assigned tag names. */
  readonly tags?: readonly string[] | null | undefined;
  /** Links to custom event. */
  readonly custom_event_id?: number | null | undefined;
  /** ISO 8601 timestamp. */
  readonly last_modified?: string | null | undefined;
  /** Event status. */
  readonly status?: string | null | undefined;
  /** Tracking platforms. */
  readonly platforms?: readonly string[] | null | undefined;
  /** ISO 8601 creation timestamp. */
  readonly created_utc?: string | null | undefined;
  /** ISO 8601 modification timestamp. */
  readonly modified_utc?: string | null | undefined;
}

/**
 * A Mixpanel event definition from the Lexicon.
 *
 * Mirror of Python `mixpanel_headless.types.EventDefinition` (types.py;
 * model_config: frozen=True, extra='allow', populate_by_name=True, alias_generator=to_camel).
 */
export class EventDefinition extends EntityModel<EventDefinitionInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "EventDefinition";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<EventDefinitionInit> = [
    { name: "id", required: true, kind: "int" },
    { name: "name", required: true, kind: "str" },
    {
      name: "display_name",
      aliases: ["displayName"],
      wire: "displayName",
      kind: "str",
      nullable: true,
    },
    { name: "description", kind: "str", nullable: true },
    { name: "hidden", kind: "bool", nullable: true },
    { name: "dropped", kind: "bool", nullable: true },
    { name: "merged", kind: "bool", nullable: true },
    { name: "verified", kind: "bool", nullable: true },
    { name: "tags", nullable: true },
    {
      name: "custom_event_id",
      aliases: ["customEventId"],
      wire: "customEventId",
      kind: "int",
      nullable: true,
    },
    {
      name: "last_modified",
      aliases: ["lastModified"],
      wire: "lastModified",
      kind: "str",
      nullable: true,
    },
    { name: "status", kind: "str", nullable: true },
    { name: "platforms", nullable: true },
    {
      name: "created_utc",
      aliases: ["createdUtc"],
      wire: "createdUtc",
      kind: "str",
      nullable: true,
    },
    {
      name: "modified_utc",
      aliases: ["modifiedUtc"],
      wire: "modifiedUtc",
      kind: "str",
      nullable: true,
    },
  ];

  /** Server-assigned event ID. */
  declare readonly id: number;
  /** Event name (unique identifier). */
  declare readonly name: string;
  /** Human-readable name. */
  declare readonly display_name: string | null;
  /** Event description. */
  declare readonly description: string | null;
  /** Whether hidden from UI. */
  declare readonly hidden: boolean | null;
  /** Whether data is dropped at ingestion. */
  declare readonly dropped: boolean | null;
  /** Whether merged into another event. */
  declare readonly merged: boolean | null;
  /** Whether verified by governance team. */
  declare readonly verified: boolean | null;
  /** Assigned tag names. */
  declare readonly tags: readonly string[] | null;
  /** Links to custom event. */
  declare readonly custom_event_id: number | null;
  /** ISO 8601 timestamp. */
  declare readonly last_modified: string | null;
  /** Event status. */
  declare readonly status: string | null;
  /** Tracking platforms. */
  declare readonly platforms: readonly string[] | null;
  /** ISO 8601 creation timestamp. */
  declare readonly created_utc: string | null;
  /** ISO 8601 modification timestamp. */
  declare readonly modified_utc: string | null;

  /**
   * Construct a validated EventDefinition (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: EventDefinitionInit) {
    super(EventDefinition, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): EventDefinition {
    return new EventDefinition(prepareInit(EventDefinition, raw));
  }
}

/**
 * Constructor input for {@link PropertyDefinition} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface PropertyDefinitionInit {
  /** Server-assigned property ID (may be absent for custom properties). */
  readonly id?: number | null | undefined;
  /** Property name. */
  readonly name: string;
  /** Property resource type as the API returns it, e.g. `Event` / `User` (capitalized, matching the write contract). */
  readonly resource_type?: string | null | undefined;
  /** Human-readable name (Lexicon `displayName`). */
  readonly display_name?: string | null | undefined;
  /** Property description. */
  readonly description?: string | null | undefined;
  /** Example value shown in the Lexicon (`exampleValue`). */
  readonly example_value?: string | null | undefined;
  /** Whether hidden from UI. */
  readonly hidden?: boolean | null | undefined;
  /** Whether data is dropped. */
  readonly dropped?: boolean | null | undefined;
  /** Whether merged into another property. */
  readonly merged?: boolean | null | undefined;
  /** PII flag. */
  readonly sensitive?: boolean | null | undefined;
  /** Data group identifier. */
  readonly data_group_id?: string | null | undefined;
}

/**
 * A Mixpanel property definition from the Lexicon.
 *
 * Mirror of Python `mixpanel_headless.types.PropertyDefinition` (types.py;
 * model_config: frozen=True, extra='allow', populate_by_name=True, alias_generator=to_camel).
 */
export class PropertyDefinition extends EntityModel<PropertyDefinitionInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "PropertyDefinition";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<PropertyDefinitionInit> = [
    { name: "id", kind: "int", nullable: true },
    { name: "name", required: true, kind: "str" },
    {
      name: "resource_type",
      aliases: ["resourceType"],
      wire: "resourceType",
      kind: "str",
      nullable: true,
    },
    {
      name: "display_name",
      aliases: ["displayName"],
      wire: "displayName",
      kind: "str",
      nullable: true,
    },
    { name: "description", kind: "str", nullable: true },
    {
      name: "example_value",
      aliases: ["exampleValue"],
      wire: "exampleValue",
      kind: "str",
      nullable: true,
    },
    { name: "hidden", kind: "bool", nullable: true },
    { name: "dropped", kind: "bool", nullable: true },
    { name: "merged", kind: "bool", nullable: true },
    { name: "sensitive", kind: "bool", nullable: true },
    {
      name: "data_group_id",
      aliases: ["dataGroupId"],
      wire: "dataGroupId",
      kind: "str",
      nullable: true,
    },
  ];

  /** Server-assigned property ID (may be absent for custom properties). */
  declare readonly id: number | null;
  /** Property name. */
  declare readonly name: string;
  /** Property resource type as the API returns it, e.g. `Event` / `User` (capitalized, matching the write contract). */
  declare readonly resource_type: string | null;
  /** Human-readable name (Lexicon `displayName`). */
  declare readonly display_name: string | null;
  /** Property description. */
  declare readonly description: string | null;
  /** Example value shown in the Lexicon (`exampleValue`). */
  declare readonly example_value: string | null;
  /** Whether hidden from UI. */
  declare readonly hidden: boolean | null;
  /** Whether data is dropped. */
  declare readonly dropped: boolean | null;
  /** Whether merged into another property. */
  declare readonly merged: boolean | null;
  /** PII flag. */
  declare readonly sensitive: boolean | null;
  /** Data group identifier. */
  declare readonly data_group_id: string | null;

  /**
   * Construct a validated PropertyDefinition (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: PropertyDefinitionInit) {
    super(PropertyDefinition, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): PropertyDefinition {
    return new PropertyDefinition(prepareInit(PropertyDefinition, raw));
  }
}

/**
 * Constructor input for {@link UpdateEventDefinitionParams} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface UpdateEventDefinitionParamsInit {
  /** Whether hidden from UI. */
  readonly hidden?: boolean | null | undefined;
  /** Whether data is dropped. */
  readonly dropped?: boolean | null | undefined;
  /** Whether merged. */
  readonly merged?: boolean | null | undefined;
  /** Whether verified. */
  readonly verified?: boolean | null | undefined;
  /** Tag names to assign. */
  readonly tags?: readonly string[] | null | undefined;
  /** Human-readable name (sent as `displayName`). */
  readonly display_name?: string | null | undefined;
  /** Event description. */
  readonly description?: string | null | undefined;
}

/**
 * Parameters for updating an event definition (PATCH semantics).
 *
 * Mirror of Python `mixpanel_headless.types.UpdateEventDefinitionParams` (types.py;
 * model_config: extra='ignore', populate_by_name=True, alias_generator=to_camel).
 */
export class UpdateEventDefinitionParams extends EntityModel<UpdateEventDefinitionParamsInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "UpdateEventDefinitionParams";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<UpdateEventDefinitionParamsInit> =
    [
      { name: "hidden", kind: "bool", nullable: true },
      { name: "dropped", kind: "bool", nullable: true },
      { name: "merged", kind: "bool", nullable: true },
      { name: "verified", kind: "bool", nullable: true },
      { name: "tags", nullable: true },
      {
        name: "display_name",
        aliases: ["displayName"],
        wire: "displayName",
        kind: "str",
        nullable: true,
      },
      { name: "description", kind: "str", nullable: true },
    ];

  /** Whether hidden from UI. */
  declare readonly hidden: boolean | null;
  /** Whether data is dropped. */
  declare readonly dropped: boolean | null;
  /** Whether merged. */
  declare readonly merged: boolean | null;
  /** Whether verified. */
  declare readonly verified: boolean | null;
  /** Tag names to assign. */
  declare readonly tags: readonly string[] | null;
  /** Human-readable name (sent as `displayName`). */
  declare readonly display_name: string | null;
  /** Event description. */
  declare readonly description: string | null;

  /**
   * Construct a validated UpdateEventDefinitionParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: UpdateEventDefinitionParamsInit) {
    super(UpdateEventDefinitionParams, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): UpdateEventDefinitionParams {
    return new UpdateEventDefinitionParams(
      prepareInit(UpdateEventDefinitionParams, raw),
    );
  }
}

/**
 * Constructor input for {@link UpdatePropertyDefinitionParams} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface UpdatePropertyDefinitionParamsInit {
  /** Whether hidden from UI. */
  readonly hidden?: boolean | null | undefined;
  /** Whether data is dropped. */
  readonly dropped?: boolean | null | undefined;
  /** Whether merged. */
  readonly merged?: boolean | null | undefined;
  /** PII flag. */
  readonly sensitive?: boolean | null | undefined;
  /** Human-readable name (sent as `displayName`). */
  readonly display_name?: string | null | undefined;
  /** Property description. */
  readonly description?: string | null | undefined;
  /** Example value (sent as `exampleValue`). */
  readonly example_value?: string | null | undefined;
  /** Resource type, constrained to the capitalized forms the data-definitions API accepts. Sent verbatim as `resourceType` to disambiguate a user property from an event property of the same name. */
  readonly resource_type?: "Event" | "User" | null | undefined;
}

/**
 * Parameters for updating a property definition (PATCH semantics).
 *
 * Mirror of Python `mixpanel_headless.types.UpdatePropertyDefinitionParams` (types.py;
 * model_config: extra='ignore', populate_by_name=True, alias_generator=to_camel).
 */
export class UpdatePropertyDefinitionParams extends EntityModel<UpdatePropertyDefinitionParamsInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "UpdatePropertyDefinitionParams";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<UpdatePropertyDefinitionParamsInit> =
    [
      { name: "hidden", kind: "bool", nullable: true },
      { name: "dropped", kind: "bool", nullable: true },
      { name: "merged", kind: "bool", nullable: true },
      { name: "sensitive", kind: "bool", nullable: true },
      {
        name: "display_name",
        aliases: ["displayName"],
        wire: "displayName",
        kind: "str",
        nullable: true,
      },
      { name: "description", kind: "str", nullable: true },
      {
        name: "example_value",
        aliases: ["exampleValue"],
        wire: "exampleValue",
        kind: "str",
        nullable: true,
      },
      {
        name: "resource_type",
        aliases: ["resourceType"],
        wire: "resourceType",
        nullable: true,
        check: oneOf(["Event", "User"]),
      },
    ];

  /** Whether hidden from UI. */
  declare readonly hidden: boolean | null;
  /** Whether data is dropped. */
  declare readonly dropped: boolean | null;
  /** Whether merged. */
  declare readonly merged: boolean | null;
  /** PII flag. */
  declare readonly sensitive: boolean | null;
  /** Human-readable name (sent as `displayName`). */
  declare readonly display_name: string | null;
  /** Property description. */
  declare readonly description: string | null;
  /** Example value (sent as `exampleValue`). */
  declare readonly example_value: string | null;
  /** Resource type, constrained to the capitalized forms the data-definitions API accepts. Sent verbatim as `resourceType` to disambiguate a user property from an event property of the same name. */
  declare readonly resource_type: "Event" | "User" | null;

  /**
   * Construct a validated UpdatePropertyDefinitionParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: UpdatePropertyDefinitionParamsInit) {
    super(UpdatePropertyDefinitionParams, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): UpdatePropertyDefinitionParams {
    return new UpdatePropertyDefinitionParams(
      prepareInit(UpdatePropertyDefinitionParams, raw),
    );
  }
}

/**
 * Constructor input for {@link BulkEventUpdate} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface BulkEventUpdateInit {
  /** Event name (identifier). */
  readonly name?: string | null | undefined;
  /** Alternative identifier. */
  readonly id?: number | null | undefined;
  /** Whether hidden from UI. */
  readonly hidden?: boolean | null | undefined;
  /** Whether data is dropped. */
  readonly dropped?: boolean | null | undefined;
  /** Whether merged. */
  readonly merged?: boolean | null | undefined;
  /** Whether verified. */
  readonly verified?: boolean | null | undefined;
  /** Tag names. */
  readonly tags?: readonly string[] | null | undefined;
  /** Human-readable name. Always emitted as `displayName` via an explicit serialization alias (rather than a model-wide `alias_generator`) so the established `team_contacts` wire shape stays snake_case. Accepts either `display_name` or `displayName` on input, so a camelCase payload echoed by `lexicon events get` round-trips instead of silently dropping the field. (`contacts` / `team_contacts` remain snake_case on input and the wire by design.) */
  readonly display_name?: string | null | undefined;
  /** Contact emails. */
  readonly contacts?: readonly string[] | null | undefined;
  /** Team contact emails. */
  readonly team_contacts?: readonly string[] | null | undefined;
}

/**
 * A single event update entry for bulk operations.
 *
 * Mirror of Python `mixpanel_headless.types.BulkEventUpdate` (types.py;
 * model_config: extra='ignore').
 */
export class BulkEventUpdate extends EntityModel<BulkEventUpdateInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "BulkEventUpdate";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<BulkEventUpdateInit> = [
    { name: "name", kind: "str", nullable: true },
    { name: "id", kind: "int", nullable: true },
    { name: "hidden", kind: "bool", nullable: true },
    { name: "dropped", kind: "bool", nullable: true },
    { name: "merged", kind: "bool", nullable: true },
    { name: "verified", kind: "bool", nullable: true },
    { name: "tags", nullable: true },
    {
      name: "display_name",
      aliases: ["displayName"],
      wire: "displayName",
      kind: "str",
      nullable: true,
    },
    { name: "contacts", nullable: true },
    { name: "team_contacts", nullable: true },
  ];

  /** Event name (identifier). */
  declare readonly name: string | null;
  /** Alternative identifier. */
  declare readonly id: number | null;
  /** Whether hidden from UI. */
  declare readonly hidden: boolean | null;
  /** Whether data is dropped. */
  declare readonly dropped: boolean | null;
  /** Whether merged. */
  declare readonly merged: boolean | null;
  /** Whether verified. */
  declare readonly verified: boolean | null;
  /** Tag names. */
  declare readonly tags: readonly string[] | null;
  /** Human-readable name. Always emitted as `displayName` via an explicit serialization alias (rather than a model-wide `alias_generator`) so the established `team_contacts` wire shape stays snake_case. Accepts either `display_name` or `displayName` on input, so a camelCase payload echoed by `lexicon events get` round-trips instead of silently dropping the field. (`contacts` / `team_contacts` remain snake_case on input and the wire by design.) */
  declare readonly display_name: string | null;
  /** Contact emails. */
  declare readonly contacts: readonly string[] | null;
  /** Team contact emails. */
  declare readonly team_contacts: readonly string[] | null;

  /**
   * Construct a validated BulkEventUpdate (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: BulkEventUpdateInit) {
    super(BulkEventUpdate, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): BulkEventUpdate {
    return new BulkEventUpdate(prepareInit(BulkEventUpdate, raw));
  }
}

/**
 * Constructor input for {@link BulkUpdateEventsParams} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface BulkUpdateEventsParamsInit {
  /** List of event update entries. */
  readonly events: ReadonlyArray<
    BulkEventUpdate | Readonly<Record<string, unknown>>
  >;
}

/**
 * Parameters for bulk-updating event definitions.
 *
 * Mirror of Python `mixpanel_headless.types.BulkUpdateEventsParams` (types.py;
 * model_config: extra='ignore').
 */
export class BulkUpdateEventsParams extends EntityModel<BulkUpdateEventsParamsInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "BulkUpdateEventsParams";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<BulkUpdateEventsParamsInit> = [
    {
      name: "events",
      required: true,
      nested: () => BulkEventUpdate,
      container: "list",
    },
  ];

  /** List of event update entries. */
  declare readonly events: readonly BulkEventUpdate[];

  /**
   * Construct a validated BulkUpdateEventsParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: BulkUpdateEventsParamsInit) {
    super(BulkUpdateEventsParams, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): BulkUpdateEventsParams {
    return new BulkUpdateEventsParams(prepareInit(BulkUpdateEventsParams, raw));
  }
}

/**
 * Constructor input for {@link BulkPropertyUpdate} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface BulkPropertyUpdateInit {
  /** Property name. */
  readonly name: string;
  /** Resource type (`Event` / `User`); sent verbatim as `resourceType` to disambiguate a user property from an event property of the same name. Constrained to the capitalized forms the data-definitions API accepts. */
  readonly resource_type: "Event" | "User";
  /** Property ID. */
  readonly id?: number | null | undefined;
  /** Whether hidden from UI. */
  readonly hidden?: boolean | null | undefined;
  /** Whether data is dropped. */
  readonly dropped?: boolean | null | undefined;
  /** PII flag. */
  readonly sensitive?: boolean | null | undefined;
  /** Human-readable name (sent as `displayName`). */
  readonly display_name?: string | null | undefined;
  /** Example value (sent as `exampleValue`). */
  readonly example_value?: string | null | undefined;
  /** Data group identifier. */
  readonly data_group_id?: string | null | undefined;
}

/**
 * A single property update entry for bulk operations.
 *
 * Mirror of Python `mixpanel_headless.types.BulkPropertyUpdate` (types.py;
 * model_config: extra='ignore', populate_by_name=True, alias_generator=to_camel).
 */
export class BulkPropertyUpdate extends EntityModel<BulkPropertyUpdateInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "BulkPropertyUpdate";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<BulkPropertyUpdateInit> = [
    { name: "name", required: true, kind: "str" },
    {
      name: "resource_type",
      required: true,
      aliases: ["resourceType"],
      wire: "resourceType",
      check: oneOf(["Event", "User"]),
    },
    { name: "id", kind: "int", nullable: true },
    { name: "hidden", kind: "bool", nullable: true },
    { name: "dropped", kind: "bool", nullable: true },
    { name: "sensitive", kind: "bool", nullable: true },
    {
      name: "display_name",
      aliases: ["displayName"],
      wire: "displayName",
      kind: "str",
      nullable: true,
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
  ];

  /** Property name. */
  declare readonly name: string;
  /** Resource type (`Event` / `User`); sent verbatim as `resourceType` to disambiguate a user property from an event property of the same name. Constrained to the capitalized forms the data-definitions API accepts. */
  declare readonly resource_type: "Event" | "User";
  /** Property ID. */
  declare readonly id: number | null;
  /** Whether hidden from UI. */
  declare readonly hidden: boolean | null;
  /** Whether data is dropped. */
  declare readonly dropped: boolean | null;
  /** PII flag. */
  declare readonly sensitive: boolean | null;
  /** Human-readable name (sent as `displayName`). */
  declare readonly display_name: string | null;
  /** Example value (sent as `exampleValue`). */
  declare readonly example_value: string | null;
  /** Data group identifier. */
  declare readonly data_group_id: string | null;

  /**
   * Construct a validated BulkPropertyUpdate (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: BulkPropertyUpdateInit) {
    super(BulkPropertyUpdate, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): BulkPropertyUpdate {
    return new BulkPropertyUpdate(prepareInit(BulkPropertyUpdate, raw));
  }
}

/**
 * Constructor input for {@link BulkUpdatePropertiesParams} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface BulkUpdatePropertiesParamsInit {
  /** List of property update entries. */
  readonly properties: ReadonlyArray<
    BulkPropertyUpdate | Readonly<Record<string, unknown>>
  >;
}

/**
 * Parameters for bulk-updating property definitions.
 *
 * Mirror of Python `mixpanel_headless.types.BulkUpdatePropertiesParams` (types.py;
 * model_config: extra='ignore').
 */
export class BulkUpdatePropertiesParams extends EntityModel<BulkUpdatePropertiesParamsInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "BulkUpdatePropertiesParams";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<BulkUpdatePropertiesParamsInit> =
    [
      {
        name: "properties",
        required: true,
        nested: () => BulkPropertyUpdate,
        container: "list",
      },
    ];

  /** List of property update entries. */
  declare readonly properties: readonly BulkPropertyUpdate[];

  /**
   * Construct a validated BulkUpdatePropertiesParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: BulkUpdatePropertiesParamsInit) {
    super(BulkUpdatePropertiesParams, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): BulkUpdatePropertiesParams {
    return new BulkUpdatePropertiesParams(
      prepareInit(BulkUpdatePropertiesParams, raw),
    );
  }
}

/**
 * Constructor input for {@link LexiconTag} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface LexiconTagInit {
  /** Server-assigned tag ID. */
  readonly id: number;
  /** Tag name. */
  readonly name: string;
}

/**
 * A Lexicon tag for categorizing event/property definitions.
 *
 * Mirror of Python `mixpanel_headless.types.LexiconTag` (types.py;
 * model_config: frozen=True, extra='allow', populate_by_name=True, alias_generator=to_camel).
 */
export class LexiconTag extends EntityModel<LexiconTagInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "LexiconTag";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<LexiconTagInit> = [
    { name: "id", required: true, kind: "int" },
    { name: "name", required: true, kind: "str" },
  ];

  /** Server-assigned tag ID. */
  declare readonly id: number;
  /** Tag name. */
  declare readonly name: string;

  /**
   * Construct a validated LexiconTag (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: LexiconTagInit) {
    super(LexiconTag, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): LexiconTag {
    return new LexiconTag(prepareInit(LexiconTag, raw));
  }
}

/**
 * Constructor input for {@link CreateTagParams} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface CreateTagParamsInit {
  /** Tag name. */
  readonly name: string;
}

/**
 * Parameters for creating a Lexicon tag.
 *
 * Mirror of Python `mixpanel_headless.types.CreateTagParams` (types.py;
 * model_config: extra='ignore').
 */
export class CreateTagParams extends EntityModel<CreateTagParamsInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "CreateTagParams";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<CreateTagParamsInit> = [
    { name: "name", required: true, kind: "str" },
  ];

  /** Tag name. */
  declare readonly name: string;

  /**
   * Construct a validated CreateTagParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: CreateTagParamsInit) {
    super(CreateTagParams, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): CreateTagParams {
    return new CreateTagParams(prepareInit(CreateTagParams, raw));
  }
}

/**
 * Constructor input for {@link UpdateTagParams} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface UpdateTagParamsInit {
  /** New tag name. */
  readonly name?: string | null | undefined;
}

/**
 * Parameters for updating a Lexicon tag.
 *
 * Mirror of Python `mixpanel_headless.types.UpdateTagParams` (types.py;
 * model_config: extra='ignore').
 */
export class UpdateTagParams extends EntityModel<UpdateTagParamsInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "UpdateTagParams";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<UpdateTagParamsInit> = [
    { name: "name", kind: "str", nullable: true },
  ];

  /** New tag name. */
  declare readonly name: string | null;

  /**
   * Construct a validated UpdateTagParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: UpdateTagParamsInit) {
    super(UpdateTagParams, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): UpdateTagParams {
    return new UpdateTagParams(prepareInit(UpdateTagParams, raw));
  }
}
