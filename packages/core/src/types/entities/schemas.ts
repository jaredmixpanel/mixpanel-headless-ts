/**
 * Schema registry family: entries, enforcement, audits, anomalies, deletion requests.
 *
 * Hand-written ports of the Pydantic entity models (phase2-design C5,
 * packet P2-7): the PYTHON models are the source of record; vendored
 * schema4api types are a compile-time cross-check only. Field names
 * keep their exact Python spelling (R3.6/R7.6); optionality follows
 * R3.9/R4.10 via the model-base materialization rules.
 */

import {
  type EntityFieldSpec,
  EntityModel,
  prepareInit,
} from "./model-base.js";

/**
 * Constructor input for {@link SchemaEntry} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface SchemaEntryInit {
  /** Entity type: "event", "custom_event", or "profile". */
  readonly entity_type: string;
  /** Entity name (event name or "$user" for profile). */
  readonly name: string;
  /** Schema version in YYYY-MM-DD format. */
  readonly version?: string | null | undefined;
  /** JSON Schema Draft 7 definition (API field: schemaJson). */
  readonly schema_definition: Readonly<Record<string, unknown>>;
}

/**
 * A schema registry entry for an event, custom event, or profile.
 *
 * Mirror of Python `mixpanel_headless.types.SchemaEntry` (types.py:5757;
 * model_config: frozen=True, extra='allow', populate_by_name=True, alias_generator=to_camel).
 */
export class SchemaEntry extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "SchemaEntry";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    {
      name: "entity_type",
      required: true,
      aliases: ["entityType"],
      wire: "entityType",
      kind: "str",
    },
    { name: "name", required: true, kind: "str" },
    { name: "version", kind: "str", nullable: true },
    {
      name: "schema_definition",
      required: true,
      aliases: ["schemaJson"],
      wire: "schemaJson",
    },
  ];

  /** Entity type: "event", "custom_event", or "profile". */
  declare readonly entity_type: string;
  /** Entity name (event name or "$user" for profile). */
  declare readonly name: string;
  /** Schema version in YYYY-MM-DD format. */
  declare readonly version: string | null;
  /** JSON Schema Draft 7 definition (API field: schemaJson). */
  declare readonly schema_definition: Readonly<Record<string, unknown>>;

  /**
   * Construct a validated SchemaEntry (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: SchemaEntryInit) {
    super(SchemaEntry, fields as unknown as Readonly<Record<string, unknown>>);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): SchemaEntry {
    return new SchemaEntry(
      prepareInit(SchemaEntry, raw) as unknown as SchemaEntryInit,
    );
  }
}

/**
 * Constructor input for {@link BulkCreateSchemasParams} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface BulkCreateSchemasParamsInit {
  /** Schema entries to create. */
  readonly entries: ReadonlyArray<
    SchemaEntry | Readonly<Record<string, unknown>>
  >;
  /** If true, delete all existing schemas of entity_type before inserting. */
  readonly truncate?: boolean | null | undefined;
  /** Entity type for all entries (only "event" supported for batch). */
  readonly entity_type?: string | null | undefined;
}

/**
 * Parameters for bulk-creating schemas in the registry.
 *
 * Mirror of Python `mixpanel_headless.types.BulkCreateSchemasParams` (types.py:5802;
 * model_config: extra='ignore', populate_by_name=True, alias_generator=to_camel).
 */
export class BulkCreateSchemasParams extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "BulkCreateSchemasParams";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    {
      name: "entries",
      required: true,
      nested: () => SchemaEntry,
      container: "list",
    },
    { name: "truncate", kind: "bool", nullable: true },
    {
      name: "entity_type",
      aliases: ["entityType"],
      wire: "entityType",
      kind: "str",
      nullable: true,
    },
  ];

  /** Schema entries to create. */
  declare readonly entries: readonly SchemaEntry[];
  /** If true, delete all existing schemas of entity_type before inserting. */
  declare readonly truncate: boolean | null;
  /** Entity type for all entries (only "event" supported for batch). */
  declare readonly entity_type: string | null;

  /**
   * Construct a validated BulkCreateSchemasParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: BulkCreateSchemasParamsInit) {
    super(
      BulkCreateSchemasParams,
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
  static fromDict(raw: unknown): BulkCreateSchemasParams {
    return new BulkCreateSchemasParams(
      prepareInit(
        BulkCreateSchemasParams,
        raw,
      ) as unknown as BulkCreateSchemasParamsInit,
    );
  }
}

/**
 * Constructor input for {@link BulkCreateSchemasResponse} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface BulkCreateSchemasResponseInit {
  /** Number of schemas added. */
  readonly added: number;
  /** Number of schemas deleted (from truncate). */
  readonly deleted: number;
}

/**
 * Response from a bulk schema creation operation.
 *
 * Mirror of Python `mixpanel_headless.types.BulkCreateSchemasResponse` (types.py:5836;
 * model_config: frozen=True, extra='allow').
 */
export class BulkCreateSchemasResponse extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "BulkCreateSchemasResponse";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "added", required: true, kind: "int" },
    { name: "deleted", required: true, kind: "int" },
  ];

  /** Number of schemas added. */
  declare readonly added: number;
  /** Number of schemas deleted (from truncate). */
  declare readonly deleted: number;

  /**
   * Construct a validated BulkCreateSchemasResponse (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: BulkCreateSchemasResponseInit) {
    super(
      BulkCreateSchemasResponse,
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
  static fromDict(raw: unknown): BulkCreateSchemasResponse {
    return new BulkCreateSchemasResponse(
      prepareInit(
        BulkCreateSchemasResponse,
        raw,
      ) as unknown as BulkCreateSchemasResponseInit,
    );
  }
}

/**
 * Constructor input for {@link BulkPatchResult} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface BulkPatchResultInit {
  /** Entity type processed. */
  readonly entity_type: string;
  /** Entity name processed. */
  readonly name: string;
  /** Result status ("ok" or "error"). */
  readonly status: string;
  /** Error message if status is "error". */
  readonly error?: string | null | undefined;
}

/**
 * Per-entry result from a bulk schema update operation.
 *
 * Mirror of Python `mixpanel_headless.types.BulkPatchResult` (types.py:5858;
 * model_config: frozen=True, extra='allow', populate_by_name=True, alias_generator=to_camel).
 */
export class BulkPatchResult extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "BulkPatchResult";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    {
      name: "entity_type",
      required: true,
      aliases: ["entityType"],
      wire: "entityType",
      kind: "str",
    },
    { name: "name", required: true, kind: "str" },
    { name: "status", required: true, kind: "str" },
    { name: "error", kind: "str", nullable: true },
  ];

  /** Entity type processed. */
  declare readonly entity_type: string;
  /** Entity name processed. */
  declare readonly name: string;
  /** Result status ("ok" or "error"). */
  declare readonly status: string;
  /** Error message if status is "error". */
  declare readonly error: string | null;

  /**
   * Construct a validated BulkPatchResult (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: BulkPatchResultInit) {
    super(
      BulkPatchResult,
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
  static fromDict(raw: unknown): BulkPatchResult {
    return new BulkPatchResult(
      prepareInit(BulkPatchResult, raw) as unknown as BulkPatchResultInit,
    );
  }
}

/**
 * Constructor input for {@link DeleteSchemasResponse} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface DeleteSchemasResponseInit {
  /** Number of schemas deleted. */
  readonly delete_count: number;
}

/**
 * Response from a schema deletion operation.
 *
 * Mirror of Python `mixpanel_headless.types.DeleteSchemasResponse` (types.py:5892;
 * model_config: frozen=True, extra='allow', populate_by_name=True, alias_generator=to_camel).
 */
export class DeleteSchemasResponse extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "DeleteSchemasResponse";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    {
      name: "delete_count",
      required: true,
      aliases: ["deleteCount"],
      wire: "deleteCount",
      kind: "int",
    },
  ];

  /** Number of schemas deleted. */
  declare readonly delete_count: number;

  /**
   * Construct a validated DeleteSchemasResponse (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: DeleteSchemasResponseInit) {
    super(
      DeleteSchemasResponse,
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
  static fromDict(raw: unknown): DeleteSchemasResponse {
    return new DeleteSchemasResponse(
      prepareInit(
        DeleteSchemasResponse,
        raw,
      ) as unknown as DeleteSchemasResponseInit,
    );
  }
}

/**
 * Constructor input for {@link SchemaEnforcementConfig} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface SchemaEnforcementConfigInit {
  /** Config ID. */
  readonly id?: number | null | undefined;
  /** Last modification timestamp. */
  readonly last_modified?: string | null | undefined;
  /** User who last modified. */
  readonly last_modified_by?:
    Readonly<Record<string, unknown>> | null | undefined;
  /** Enforcement action: "Warn and Accept", "Warn and Hide", "Warn and Drop". */
  readonly rule_event?: string | null | undefined;
  /** Notification recipients. */
  readonly notification_emails?: readonly string[] | null | undefined;
  /** Event enforcement rules. */
  readonly events?:
    ReadonlyArray<Readonly<Record<string, unknown>>> | null | undefined;
  /** Common property rules. */
  readonly common_properties?:
    ReadonlyArray<Readonly<Record<string, unknown>>> | null | undefined;
  /** User property rules. */
  readonly user_properties?:
    ReadonlyArray<Readonly<Record<string, unknown>>> | null | undefined;
  /** User who initialized. */
  readonly initialized_by?:
    Readonly<Record<string, unknown>> | null | undefined;
  /** Initialization start date. */
  readonly initialized_from?: string | null | undefined;
  /** Initialization end date. */
  readonly initialized_to?: string | null | undefined;
  /** Enforcement state ("planned" or "ingested"). */
  readonly state?: string | null | undefined;
}

/**
 * Schema enforcement configuration for a project.
 *
 * Mirror of Python `mixpanel_headless.types.SchemaEnforcementConfig` (types.py:5917;
 * model_config: frozen=True, extra='allow', populate_by_name=True, alias_generator=to_camel).
 */
export class SchemaEnforcementConfig extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "SchemaEnforcementConfig";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "id", kind: "int", nullable: true },
    {
      name: "last_modified",
      aliases: ["lastModified"],
      wire: "lastModified",
      kind: "str",
      nullable: true,
    },
    {
      name: "last_modified_by",
      aliases: ["lastModifiedBy"],
      wire: "lastModifiedBy",
      nullable: true,
    },
    {
      name: "rule_event",
      aliases: ["ruleEvent"],
      wire: "ruleEvent",
      kind: "str",
      nullable: true,
    },
    {
      name: "notification_emails",
      aliases: ["notificationEmails"],
      wire: "notificationEmails",
      nullable: true,
    },
    { name: "events", nullable: true },
    {
      name: "common_properties",
      aliases: ["commonProperties"],
      wire: "commonProperties",
      nullable: true,
    },
    {
      name: "user_properties",
      aliases: ["userProperties"],
      wire: "userProperties",
      nullable: true,
    },
    {
      name: "initialized_by",
      aliases: ["initializedBy"],
      wire: "initializedBy",
      nullable: true,
    },
    {
      name: "initialized_from",
      aliases: ["initializedFrom"],
      wire: "initializedFrom",
      kind: "str",
      nullable: true,
    },
    {
      name: "initialized_to",
      aliases: ["initializedTo"],
      wire: "initializedTo",
      kind: "str",
      nullable: true,
    },
    { name: "state", kind: "str", nullable: true },
  ];

  /** Config ID. */
  declare readonly id: number | null;
  /** Last modification timestamp. */
  declare readonly last_modified: string | null;
  /** User who last modified. */
  declare readonly last_modified_by: Readonly<Record<string, unknown>> | null;
  /** Enforcement action: "Warn and Accept", "Warn and Hide", "Warn and Drop". */
  declare readonly rule_event: string | null;
  /** Notification recipients. */
  declare readonly notification_emails: readonly string[] | null;
  /** Event enforcement rules. */
  declare readonly events: ReadonlyArray<
    Readonly<Record<string, unknown>>
  > | null;
  /** Common property rules. */
  declare readonly common_properties: ReadonlyArray<
    Readonly<Record<string, unknown>>
  > | null;
  /** User property rules. */
  declare readonly user_properties: ReadonlyArray<
    Readonly<Record<string, unknown>>
  > | null;
  /** User who initialized. */
  declare readonly initialized_by: Readonly<Record<string, unknown>> | null;
  /** Initialization start date. */
  declare readonly initialized_from: string | null;
  /** Initialization end date. */
  declare readonly initialized_to: string | null;
  /** Enforcement state ("planned" or "ingested"). */
  declare readonly state: string | null;

  /**
   * Construct a validated SchemaEnforcementConfig (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: SchemaEnforcementConfigInit) {
    super(
      SchemaEnforcementConfig,
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
  static fromDict(raw: unknown): SchemaEnforcementConfig {
    return new SchemaEnforcementConfig(
      prepareInit(
        SchemaEnforcementConfig,
        raw,
      ) as unknown as SchemaEnforcementConfigInit,
    );
  }
}

/**
 * Constructor input for {@link InitSchemaEnforcementParams} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface InitSchemaEnforcementParamsInit {
  /** Enforcement action. */
  readonly rule_event: string;
}

/**
 * Parameters for initializing schema enforcement.
 *
 * Mirror of Python `mixpanel_headless.types.InitSchemaEnforcementParams` (types.py:5986;
 * model_config: extra='ignore', populate_by_name=True, alias_generator=to_camel).
 */
export class InitSchemaEnforcementParams extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "InitSchemaEnforcementParams";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    {
      name: "rule_event",
      required: true,
      aliases: ["ruleEvent"],
      wire: "ruleEvent",
      kind: "str",
    },
  ];

  /** Enforcement action. */
  declare readonly rule_event: string;

  /**
   * Construct a validated InitSchemaEnforcementParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: InitSchemaEnforcementParamsInit) {
    super(
      InitSchemaEnforcementParams,
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
  static fromDict(raw: unknown): InitSchemaEnforcementParams {
    return new InitSchemaEnforcementParams(
      prepareInit(
        InitSchemaEnforcementParams,
        raw,
      ) as unknown as InitSchemaEnforcementParamsInit,
    );
  }
}

/**
 * Constructor input for {@link UpdateSchemaEnforcementParams} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface UpdateSchemaEnforcementParamsInit {
  /** Updated notification recipients. */
  readonly notification_emails?: readonly string[] | null | undefined;
  /** Updated enforcement action. */
  readonly rule_event?: string | null | undefined;
  /** Updated event list. */
  readonly events?: readonly string[] | null | undefined;
  /** Updated property map. */
  readonly properties?:
    Readonly<Record<string, readonly string[]>> | null | undefined;
}

/**
 * Parameters for partially updating schema enforcement.
 *
 * Mirror of Python `mixpanel_headless.types.UpdateSchemaEnforcementParams` (types.py:6005;
 * model_config: extra='ignore', populate_by_name=True, alias_generator=to_camel).
 */
export class UpdateSchemaEnforcementParams extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "UpdateSchemaEnforcementParams";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    {
      name: "notification_emails",
      aliases: ["notificationEmails"],
      wire: "notificationEmails",
      nullable: true,
    },
    {
      name: "rule_event",
      aliases: ["ruleEvent"],
      wire: "ruleEvent",
      kind: "str",
      nullable: true,
    },
    { name: "events", nullable: true },
    { name: "properties", nullable: true },
  ];

  /** Updated notification recipients. */
  declare readonly notification_emails: readonly string[] | null;
  /** Updated enforcement action. */
  declare readonly rule_event: string | null;
  /** Updated event list. */
  declare readonly events: readonly string[] | null;
  /** Updated property map. */
  declare readonly properties: Readonly<
    Record<string, readonly string[]>
  > | null;

  /**
   * Construct a validated UpdateSchemaEnforcementParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: UpdateSchemaEnforcementParamsInit) {
    super(
      UpdateSchemaEnforcementParams,
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
  static fromDict(raw: unknown): UpdateSchemaEnforcementParams {
    return new UpdateSchemaEnforcementParams(
      prepareInit(
        UpdateSchemaEnforcementParams,
        raw,
      ) as unknown as UpdateSchemaEnforcementParamsInit,
    );
  }
}

/**
 * Constructor input for {@link ReplaceSchemaEnforcementParams} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface ReplaceSchemaEnforcementParamsInit {
  /** Full common property rules. */
  readonly common_properties: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /** Full user property rules. */
  readonly user_properties: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /** Full event rules. */
  readonly events: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /** Enforcement action. */
  readonly rule_event: string;
  /** Notification recipients. */
  readonly notification_emails: readonly string[];
  /** Schema definition ID. */
  readonly schema_id?: number | null | undefined;
}

/**
 * Parameters for fully replacing schema enforcement configuration.
 *
 * Mirror of Python `mixpanel_headless.types.ReplaceSchemaEnforcementParams` (types.py:6038;
 * model_config: extra='ignore', populate_by_name=True, alias_generator=to_camel).
 */
export class ReplaceSchemaEnforcementParams extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "ReplaceSchemaEnforcementParams";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    {
      name: "common_properties",
      required: true,
      aliases: ["commonProperties"],
      wire: "commonProperties",
    },
    {
      name: "user_properties",
      required: true,
      aliases: ["userProperties"],
      wire: "userProperties",
    },
    { name: "events", required: true },
    {
      name: "rule_event",
      required: true,
      aliases: ["ruleEvent"],
      wire: "ruleEvent",
      kind: "str",
    },
    {
      name: "notification_emails",
      required: true,
      aliases: ["notificationEmails"],
      wire: "notificationEmails",
    },
    {
      name: "schema_id",
      aliases: ["schemaId"],
      wire: "schemaId",
      kind: "int",
      nullable: true,
    },
  ];

  /** Full common property rules. */
  declare readonly common_properties: ReadonlyArray<
    Readonly<Record<string, unknown>>
  >;
  /** Full user property rules. */
  declare readonly user_properties: ReadonlyArray<
    Readonly<Record<string, unknown>>
  >;
  /** Full event rules. */
  declare readonly events: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /** Enforcement action. */
  declare readonly rule_event: string;
  /** Notification recipients. */
  declare readonly notification_emails: readonly string[];
  /** Schema definition ID. */
  declare readonly schema_id: number | null;

  /**
   * Construct a validated ReplaceSchemaEnforcementParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: ReplaceSchemaEnforcementParamsInit) {
    super(
      ReplaceSchemaEnforcementParams,
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
  static fromDict(raw: unknown): ReplaceSchemaEnforcementParams {
    return new ReplaceSchemaEnforcementParams(
      prepareInit(
        ReplaceSchemaEnforcementParams,
        raw,
      ) as unknown as ReplaceSchemaEnforcementParamsInit,
    );
  }
}

/**
 * Constructor input for {@link AuditViolation} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface AuditViolationInit {
  /** Violation type. */
  readonly violation: string;
  /** Property or event name. */
  readonly name: string;
  /** Platform: "iOS", "Android", "Web". */
  readonly platform?: string | null | undefined;
  /** Version string. */
  readonly version?: string | null | undefined;
  /** Number of occurrences. */
  readonly count: number;
  /** Event name (for property violations). */
  readonly event?: string | null | undefined;
  /** Whether property is marked sensitive. */
  readonly sensitive?: boolean | null | undefined;
  /** Type mismatch description. */
  readonly property_type_error?: string | null | undefined;
}

/**
 * A single violation found during a data audit.
 *
 * Mirror of Python `mixpanel_headless.types.AuditViolation` (types.py:6089;
 * model_config: frozen=True, extra='allow', populate_by_name=True, alias_generator=to_camel).
 */
export class AuditViolation extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "AuditViolation";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "violation", required: true, kind: "str" },
    { name: "name", required: true, kind: "str" },
    { name: "platform", kind: "str", nullable: true },
    { name: "version", kind: "str", nullable: true },
    { name: "count", required: true, kind: "int" },
    { name: "event", kind: "str", nullable: true },
    { name: "sensitive", kind: "bool", nullable: true },
    {
      name: "property_type_error",
      aliases: ["propertyTypeError"],
      wire: "propertyTypeError",
      kind: "str",
      nullable: true,
    },
  ];

  /** Violation type. */
  declare readonly violation: string;
  /** Property or event name. */
  declare readonly name: string;
  /** Platform: "iOS", "Android", "Web". */
  declare readonly platform: string | null;
  /** Version string. */
  declare readonly version: string | null;
  /** Number of occurrences. */
  declare readonly count: number;
  /** Event name (for property violations). */
  declare readonly event: string | null;
  /** Whether property is marked sensitive. */
  declare readonly sensitive: boolean | null;
  /** Type mismatch description. */
  declare readonly property_type_error: string | null;

  /**
   * Construct a validated AuditViolation (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: AuditViolationInit) {
    super(
      AuditViolation,
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
  static fromDict(raw: unknown): AuditViolation {
    return new AuditViolation(
      prepareInit(AuditViolation, raw) as unknown as AuditViolationInit,
    );
  }
}

/**
 * Constructor input for {@link AuditResponse} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface AuditResponseInit {
  /** List of audit violations. */
  readonly violations: ReadonlyArray<
    AuditViolation | Readonly<Record<string, unknown>>
  >;
  /** Timestamp of audit computation. */
  readonly computed_at: string;
}

/**
 * Response from a data audit operation.
 *
 * Mirror of Python `mixpanel_headless.types.AuditResponse` (types.py:6140;
 * model_config: frozen=True, extra='allow').
 */
export class AuditResponse extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "AuditResponse";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    {
      name: "violations",
      required: true,
      nested: () => AuditViolation,
      container: "list",
    },
    { name: "computed_at", required: true, kind: "str" },
  ];

  /** List of audit violations. */
  declare readonly violations: readonly AuditViolation[];
  /** Timestamp of audit computation. */
  declare readonly computed_at: string;

  /**
   * Construct a validated AuditResponse (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: AuditResponseInit) {
    super(
      AuditResponse,
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
  static fromDict(raw: unknown): AuditResponse {
    return new AuditResponse(
      prepareInit(AuditResponse, raw) as unknown as AuditResponseInit,
    );
  }
}

/**
 * Constructor input for {@link DataVolumeAnomaly} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface DataVolumeAnomalyInit {
  /** Anomaly ID. */
  readonly id: number;
  /** Detection timestamp. */
  readonly timestamp?: string | null | undefined;
  /** Actual observed count. */
  readonly actual_count: number;
  /** Upper bound of prediction. */
  readonly predicted_upper: number;
  /** Lower bound of prediction. */
  readonly predicted_lower: number;
  /** Variance percentage. */
  readonly percent_variance: string;
  /** Anomaly status ("open" or "dismissed"). */
  readonly status: string;
  /** Project ID. */
  readonly project: number;
  /** Event ID. */
  readonly event?: number | null | undefined;
  /** Event name. */
  readonly event_name?: string | null | undefined;
  /** Property ID. */
  readonly property?: number | null | undefined;
  /** Property name. */
  readonly property_name?: string | null | undefined;
  /** Metric ID. */
  readonly metric?: number | null | undefined;
  /** Metric name. */
  readonly metric_name?: string | null | undefined;
  /** Metric type. */
  readonly metric_type?: string | null | undefined;
  /** Primary anomaly type. */
  readonly primary_type?: string | null | undefined;
  /** Drift type details. */
  readonly drift_types?: Readonly<Record<string, unknown>> | null | undefined;
  /** Anomaly class: "Event", "Property", "PropertyTypeDrift", "Metric". */
  readonly anomaly_class: string;
}

/**
 * A detected data volume anomaly.
 *
 * Mirror of Python `mixpanel_headless.types.DataVolumeAnomaly` (types.py:6175;
 * model_config: frozen=True, extra='allow', populate_by_name=True, alias_generator=to_camel).
 */
export class DataVolumeAnomaly extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "DataVolumeAnomaly";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "id", required: true, kind: "int" },
    { name: "timestamp", kind: "str", nullable: true },
    {
      name: "actual_count",
      required: true,
      aliases: ["actualCount"],
      wire: "actualCount",
      kind: "int",
    },
    {
      name: "predicted_upper",
      required: true,
      aliases: ["predictedUpper"],
      wire: "predictedUpper",
      kind: "int",
    },
    {
      name: "predicted_lower",
      required: true,
      aliases: ["predictedLower"],
      wire: "predictedLower",
      kind: "int",
    },
    {
      name: "percent_variance",
      required: true,
      aliases: ["percentVariance"],
      wire: "percentVariance",
      kind: "str",
    },
    { name: "status", required: true, kind: "str" },
    { name: "project", required: true, kind: "int" },
    { name: "event", kind: "int", nullable: true },
    {
      name: "event_name",
      aliases: ["eventName"],
      wire: "eventName",
      kind: "str",
      nullable: true,
    },
    { name: "property", kind: "int", nullable: true },
    {
      name: "property_name",
      aliases: ["propertyName"],
      wire: "propertyName",
      kind: "str",
      nullable: true,
    },
    { name: "metric", kind: "int", nullable: true },
    {
      name: "metric_name",
      aliases: ["metricName"],
      wire: "metricName",
      kind: "str",
      nullable: true,
    },
    {
      name: "metric_type",
      aliases: ["metricType"],
      wire: "metricType",
      kind: "str",
      nullable: true,
    },
    {
      name: "primary_type",
      aliases: ["primaryType"],
      wire: "primaryType",
      kind: "str",
      nullable: true,
    },
    {
      name: "drift_types",
      aliases: ["driftTypes"],
      wire: "driftTypes",
      nullable: true,
    },
    {
      name: "anomaly_class",
      required: true,
      aliases: ["anomalyClass"],
      wire: "anomalyClass",
      kind: "str",
    },
  ];

  /** Anomaly ID. */
  declare readonly id: number;
  /** Detection timestamp. */
  declare readonly timestamp: string | null;
  /** Actual observed count. */
  declare readonly actual_count: number;
  /** Upper bound of prediction. */
  declare readonly predicted_upper: number;
  /** Lower bound of prediction. */
  declare readonly predicted_lower: number;
  /** Variance percentage. */
  declare readonly percent_variance: string;
  /** Anomaly status ("open" or "dismissed"). */
  declare readonly status: string;
  /** Project ID. */
  declare readonly project: number;
  /** Event ID. */
  declare readonly event: number | null;
  /** Event name. */
  declare readonly event_name: string | null;
  /** Property ID. */
  declare readonly property: number | null;
  /** Property name. */
  declare readonly property_name: string | null;
  /** Metric ID. */
  declare readonly metric: number | null;
  /** Metric name. */
  declare readonly metric_name: string | null;
  /** Metric type. */
  declare readonly metric_type: string | null;
  /** Primary anomaly type. */
  declare readonly primary_type: string | null;
  /** Drift type details. */
  declare readonly drift_types: Readonly<Record<string, unknown>> | null;
  /** Anomaly class: "Event", "Property", "PropertyTypeDrift", "Metric". */
  declare readonly anomaly_class: string;

  /**
   * Construct a validated DataVolumeAnomaly (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: DataVolumeAnomalyInit) {
    super(
      DataVolumeAnomaly,
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
  static fromDict(raw: unknown): DataVolumeAnomaly {
    return new DataVolumeAnomaly(
      prepareInit(DataVolumeAnomaly, raw) as unknown as DataVolumeAnomalyInit,
    );
  }
}

/**
 * Constructor input for {@link UpdateAnomalyParams} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface UpdateAnomalyParamsInit {
  /** Anomaly ID. */
  readonly id: number;
  /** New status: "open" or "dismissed". */
  readonly status: string;
  /** Anomaly class. */
  readonly anomaly_class: string;
}

/**
 * Parameters for updating a single anomaly status.
 *
 * Mirror of Python `mixpanel_headless.types.UpdateAnomalyParams` (types.py:6268;
 * model_config: extra='ignore', populate_by_name=True, alias_generator=to_camel).
 */
export class UpdateAnomalyParams extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "UpdateAnomalyParams";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "id", required: true, kind: "int" },
    { name: "status", required: true, kind: "str" },
    {
      name: "anomaly_class",
      required: true,
      aliases: ["anomalyClass"],
      wire: "anomalyClass",
      kind: "str",
    },
  ];

  /** Anomaly ID. */
  declare readonly id: number;
  /** New status: "open" or "dismissed". */
  declare readonly status: string;
  /** Anomaly class. */
  declare readonly anomaly_class: string;

  /**
   * Construct a validated UpdateAnomalyParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: UpdateAnomalyParamsInit) {
    super(
      UpdateAnomalyParams,
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
  static fromDict(raw: unknown): UpdateAnomalyParams {
    return new UpdateAnomalyParams(
      prepareInit(
        UpdateAnomalyParams,
        raw,
      ) as unknown as UpdateAnomalyParamsInit,
    );
  }
}

/**
 * Constructor input for {@link BulkAnomalyEntry} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface BulkAnomalyEntryInit {
  /** Anomaly ID. */
  readonly id: number;
  /** Anomaly class. */
  readonly anomaly_class: string;
}

/**
 * A single entry in a bulk anomaly update.
 *
 * Mirror of Python `mixpanel_headless.types.BulkAnomalyEntry` (types.py:6296;
 * model_config: extra='ignore', populate_by_name=True, alias_generator=to_camel).
 */
export class BulkAnomalyEntry extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "BulkAnomalyEntry";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "id", required: true, kind: "int" },
    {
      name: "anomaly_class",
      required: true,
      aliases: ["anomalyClass"],
      wire: "anomalyClass",
      kind: "str",
    },
  ];

  /** Anomaly ID. */
  declare readonly id: number;
  /** Anomaly class. */
  declare readonly anomaly_class: string;

  /**
   * Construct a validated BulkAnomalyEntry (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: BulkAnomalyEntryInit) {
    super(
      BulkAnomalyEntry,
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
  static fromDict(raw: unknown): BulkAnomalyEntry {
    return new BulkAnomalyEntry(
      prepareInit(BulkAnomalyEntry, raw) as unknown as BulkAnomalyEntryInit,
    );
  }
}

/**
 * Constructor input for {@link BulkUpdateAnomalyParams} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface BulkUpdateAnomalyParamsInit {
  /** Anomalies to update. */
  readonly anomalies: ReadonlyArray<
    BulkAnomalyEntry | Readonly<Record<string, unknown>>
  >;
  /** New status for all. */
  readonly status: string;
}

/**
 * Parameters for bulk-updating anomaly statuses.
 *
 * Mirror of Python `mixpanel_headless.types.BulkUpdateAnomalyParams` (types.py:6318;
 * model_config: extra='ignore', populate_by_name=True, alias_generator=to_camel).
 */
export class BulkUpdateAnomalyParams extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "BulkUpdateAnomalyParams";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    {
      name: "anomalies",
      required: true,
      nested: () => BulkAnomalyEntry,
      container: "list",
    },
    { name: "status", required: true, kind: "str" },
  ];

  /** Anomalies to update. */
  declare readonly anomalies: readonly BulkAnomalyEntry[];
  /** New status for all. */
  declare readonly status: string;

  /**
   * Construct a validated BulkUpdateAnomalyParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: BulkUpdateAnomalyParamsInit) {
    super(
      BulkUpdateAnomalyParams,
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
  static fromDict(raw: unknown): BulkUpdateAnomalyParams {
    return new BulkUpdateAnomalyParams(
      prepareInit(
        BulkUpdateAnomalyParams,
        raw,
      ) as unknown as BulkUpdateAnomalyParamsInit,
    );
  }
}

/**
 * Constructor input for {@link EventDeletionRequest} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface EventDeletionRequestInit {
  /** Request ID. */
  readonly id: number;
  /** Display name. */
  readonly display_name?: string | null | undefined;
  /** Event to delete. */
  readonly event_name: string;
  /** Start date. */
  readonly from_date: string;
  /** End date. */
  readonly to_date: string;
  /** Deletion filters (dict when populated, None when absent). */
  readonly filters?: Readonly<Record<string, unknown>> | null | undefined;
  /** Request status: "Submitted", "Processing", "Completed", "Failed". */
  readonly status: string;
  /** Count of deleted events. */
  readonly deleted_events_count: number;
  /** Creation timestamp. */
  readonly created: string;
  /** User who requested. */
  readonly requesting_user: Readonly<Record<string, unknown>>;
}

/**
 * An event deletion request with lifecycle status.
 *
 * Mirror of Python `mixpanel_headless.types.EventDeletionRequest` (types.py:6348;
 * model_config: frozen=True, extra='allow', populate_by_name=True, alias_generator=to_camel).
 */
export class EventDeletionRequest extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "EventDeletionRequest";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "id", required: true, kind: "int" },
    {
      name: "display_name",
      aliases: ["displayName"],
      wire: "displayName",
      kind: "str",
      nullable: true,
    },
    {
      name: "event_name",
      required: true,
      aliases: ["eventName"],
      wire: "eventName",
      kind: "str",
    },
    {
      name: "from_date",
      required: true,
      aliases: ["fromDate"],
      wire: "fromDate",
      kind: "str",
    },
    {
      name: "to_date",
      required: true,
      aliases: ["toDate"],
      wire: "toDate",
      kind: "str",
    },
    {
      name: "filters",
      nullable: true,
      // Python `_normalize_filters` (mode="before"): `[]` from the API
      // coerces to None; a non-empty list wraps as {"items": [...]}.
      before: (value: unknown): unknown => {
        if (!Array.isArray(value)) {
          return value;
        }
        return value.length === 0 ? null : { items: value };
      },
    },
    { name: "status", required: true, kind: "str" },
    {
      name: "deleted_events_count",
      required: true,
      aliases: ["deletedEventsCount"],
      wire: "deletedEventsCount",
      kind: "int",
    },
    { name: "created", required: true, kind: "str" },
    {
      name: "requesting_user",
      required: true,
      aliases: ["requestingUser"],
      wire: "requestingUser",
    },
  ];

  /** Request ID. */
  declare readonly id: number;
  /** Display name. */
  declare readonly display_name: string | null;
  /** Event to delete. */
  declare readonly event_name: string;
  /** Start date. */
  declare readonly from_date: string;
  /** End date. */
  declare readonly to_date: string;
  /** Deletion filters (dict when populated, None when absent). */
  declare readonly filters: Readonly<Record<string, unknown>> | null;
  /** Request status: "Submitted", "Processing", "Completed", "Failed". */
  declare readonly status: string;
  /** Count of deleted events. */
  declare readonly deleted_events_count: number;
  /** Creation timestamp. */
  declare readonly created: string;
  /** User who requested. */
  declare readonly requesting_user: Readonly<Record<string, unknown>>;

  /**
   * Construct a validated EventDeletionRequest (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: EventDeletionRequestInit) {
    super(
      EventDeletionRequest,
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
  static fromDict(raw: unknown): EventDeletionRequest {
    return new EventDeletionRequest(
      prepareInit(
        EventDeletionRequest,
        raw,
      ) as unknown as EventDeletionRequestInit,
    );
  }
}

/**
 * Constructor input for {@link CreateDeletionRequestParams} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface CreateDeletionRequestParamsInit {
  /** Start date (YYYY-MM-DD or datetime). */
  readonly from_date: string;
  /** End date. */
  readonly to_date: string;
  /** Event name to delete. */
  readonly event_name: string;
  /** Optional deletion filters. */
  readonly filters?: Readonly<Record<string, unknown>> | null | undefined;
}

/**
 * Parameters for creating an event deletion request.
 *
 * Mirror of Python `mixpanel_headless.types.CreateDeletionRequestParams` (types.py:6423;
 * model_config: extra='ignore', populate_by_name=True, alias_generator=to_camel).
 */
export class CreateDeletionRequestParams extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "CreateDeletionRequestParams";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    {
      name: "from_date",
      required: true,
      aliases: ["fromDate"],
      wire: "fromDate",
      kind: "str",
    },
    {
      name: "to_date",
      required: true,
      aliases: ["toDate"],
      wire: "toDate",
      kind: "str",
    },
    {
      name: "event_name",
      required: true,
      aliases: ["eventName"],
      wire: "eventName",
      kind: "str",
    },
    { name: "filters", nullable: true },
  ];

  /** Start date (YYYY-MM-DD or datetime). */
  declare readonly from_date: string;
  /** End date. */
  declare readonly to_date: string;
  /** Event name to delete. */
  declare readonly event_name: string;
  /** Optional deletion filters. */
  declare readonly filters: Readonly<Record<string, unknown>> | null;

  /**
   * Construct a validated CreateDeletionRequestParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: CreateDeletionRequestParamsInit) {
    super(
      CreateDeletionRequestParams,
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
  static fromDict(raw: unknown): CreateDeletionRequestParams {
    return new CreateDeletionRequestParams(
      prepareInit(
        CreateDeletionRequestParams,
        raw,
      ) as unknown as CreateDeletionRequestParamsInit,
    );
  }
}

/**
 * Constructor input for {@link PreviewDeletionFiltersParams} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface PreviewDeletionFiltersParamsInit {
  /** Event name. */
  readonly event_name: string;
  /** Start date. */
  readonly from_date: string;
  /** End date. */
  readonly to_date: string;
  /** Optional filters. */
  readonly filters?: Readonly<Record<string, unknown>> | null | undefined;
}

/**
 * Parameters for previewing event deletion filters.
 *
 * Mirror of Python `mixpanel_headless.types.PreviewDeletionFiltersParams` (types.py:6457;
 * model_config: extra='ignore', populate_by_name=True, alias_generator=to_camel).
 */
export class PreviewDeletionFiltersParams extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "PreviewDeletionFiltersParams";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    {
      name: "event_name",
      required: true,
      aliases: ["eventName"],
      wire: "eventName",
      kind: "str",
    },
    {
      name: "from_date",
      required: true,
      aliases: ["fromDate"],
      wire: "fromDate",
      kind: "str",
    },
    {
      name: "to_date",
      required: true,
      aliases: ["toDate"],
      wire: "toDate",
      kind: "str",
    },
    { name: "filters", nullable: true },
  ];

  /** Event name. */
  declare readonly event_name: string;
  /** Start date. */
  declare readonly from_date: string;
  /** End date. */
  declare readonly to_date: string;
  /** Optional filters. */
  declare readonly filters: Readonly<Record<string, unknown>> | null;

  /**
   * Construct a validated PreviewDeletionFiltersParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: PreviewDeletionFiltersParamsInit) {
    super(
      PreviewDeletionFiltersParams,
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
  static fromDict(raw: unknown): PreviewDeletionFiltersParams {
    return new PreviewDeletionFiltersParams(
      prepareInit(
        PreviewDeletionFiltersParams,
        raw,
      ) as unknown as PreviewDeletionFiltersParamsInit,
    );
  }
}
