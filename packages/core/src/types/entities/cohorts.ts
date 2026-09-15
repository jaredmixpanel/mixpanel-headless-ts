/**
 * Cohort family + cohort CRUD params.
 *
 * Hand-written ports of the Pydantic models in Python's `types.py`:
 * the Python classes are the source of record and the vendored
 * schema4api types are a compile-time cross-check only. Field names
 * keep their Python spelling; required-ness, defaults, nullability and
 * lax coercion follow each class's `fieldSpecs` (see `model-base.ts`).
 *
 * @see mixpanel_headless.types
 */

import {
  type EntityFieldSpecs,
  EntityModel,
  type ModelDumpOptions,
  prepareInit,
} from "./model-base.js";

/**
 * Pop `definition` out of a dump and, when truthy, merge its keys into
 * the top level.
 *
 * The three cohort param models inherit this override in Python, so it
 * belongs on the models here too rather than in the facade. Falsy
 * definitions (`{}`) are dropped entirely, exactly as `if definition:`
 * does; the merged keys land after the declared fields, mirroring
 * `dict.update()` insertion order.
 *
 * @param dumped - The plain `exclude_none` dump.
 * @returns The dump with `definition` flattened.
 * @see mixpanel_headless.types._DefinitionFlatteningModel.model_dump
 */
function flattenDefinition(
  dumped: Record<string, unknown>,
): Record<string, unknown> {
  if (!Object.hasOwn(dumped, "definition")) {
    return dumped;
  }
  const definition = dumped["definition"];
  delete dumped["definition"];
  if (
    definition !== null &&
    definition !== undefined &&
    typeof definition === "object" &&
    Object.keys(definition).length > 0
  ) {
    Object.assign(dumped, definition as Record<string, unknown>);
  }
  return dumped;
}

/**
 * Constructor input for {@link CohortCreator} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface CohortCreatorInit {
  /** Creator user ID. */
  readonly id?: number | null | undefined;
  /** Creator name. */
  readonly name?: string | null | undefined;
  /** Creator email. */
  readonly email?: string | null | undefined;
}

/**
 * Creator information for a cohort.
 *
 * @remarks Pydantic `extra='allow'`: unknown keys are kept on `__extras`.
 * @example
 * ```ts
 * const cohortCreator = CohortCreator.fromDict({ id: 42 });
 * cohortCreator.id; // 42
 * ```
 * @see mixpanel_headless.types.CohortCreator
 */
export class CohortCreator extends EntityModel<CohortCreatorInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "CohortCreator";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<CohortCreatorInit> = [
    { name: "id", kind: "int", nullable: true },
    { name: "name", kind: "str", nullable: true },
    { name: "email", kind: "str", nullable: true },
  ];

  /** Creator user ID. */
  declare readonly id: number | null;
  /** Creator name. */
  declare readonly name: string | null;
  /** Creator email. */
  declare readonly email: string | null;

  /**
   * Construct a validated CohortCreator (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: CohortCreatorInit) {
    super(CohortCreator, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): CohortCreator {
    return new CohortCreator(prepareInit(CohortCreator, raw));
  }
}

/**
 * Constructor input for {@link Cohort} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface CohortInit {
  /** Unique cohort identifier. */
  readonly id: number;
  /** Cohort name. */
  readonly name: string;
  /** Cohort description. */
  readonly description?: string | null | undefined;
  /** Number of users in the cohort. */
  readonly count?: number | null | undefined;
  /** Whether the cohort is visible. */
  readonly is_visible?: boolean | null | undefined;
  /** Whether the cohort is locked. */
  readonly is_locked?: boolean | null | undefined;
  /** Data group identifier. */
  readonly data_group_id?: string | null | undefined;
  /** Last edited timestamp string. */
  readonly last_edited?: string | null | undefined;
  /** Creator information. */
  readonly created_by?:
    CohortCreator | Readonly<Record<string, unknown>> | null | undefined;
  /** IDs of entities referencing this cohort. */
  readonly referenced_by?: readonly number[] | null | undefined;
  /** Whether the cohort is verified. */
  readonly verified?: boolean | undefined;
  /** Last queried timestamp string. */
  readonly last_queried?: string | null | undefined;
  /** IDs of entities directly referencing this cohort. */
  readonly referenced_directly_by?: readonly number[] | undefined;
  /** Active integration IDs. */
  readonly active_integrations?: readonly number[] | undefined;
}

/**
 * A Mixpanel cohort as returned by the App API.
 *
 * @remarks Pydantic `extra='allow'`: unknown keys are kept on `__extras`.
 * @example
 * ```ts
 * const cohort = Cohort.fromDict({
 *   id: 42,
 *   name: "Power users",
 *   description: "Weekly overview",
 * });
 * cohort.id; // 42
 * ```
 * @see mixpanel_headless.types.Cohort
 */
export class Cohort extends EntityModel<CohortInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "Cohort";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<CohortInit> = [
    { name: "id", required: true, kind: "int" },
    { name: "name", required: true, kind: "str" },
    { name: "description", kind: "str", nullable: true },
    { name: "count", kind: "int", nullable: true },
    { name: "is_visible", kind: "bool", nullable: true },
    { name: "is_locked", kind: "bool", nullable: true },
    { name: "data_group_id", kind: "str", nullable: true },
    { name: "last_edited", kind: "str", nullable: true },
    { name: "created_by", nullable: true, nested: () => CohortCreator },
    { name: "referenced_by", nullable: true },
    { name: "verified", default: () => false, kind: "bool" },
    { name: "last_queried", kind: "str", nullable: true },
    { name: "referenced_directly_by", default: () => [] },
    { name: "active_integrations", default: () => [] },
  ];

  /** Unique cohort identifier. */
  declare readonly id: number;
  /** Cohort name. */
  declare readonly name: string;
  /** Cohort description. */
  declare readonly description: string | null;
  /** Number of users in the cohort. */
  declare readonly count: number | null;
  /** Whether the cohort is visible. */
  declare readonly is_visible: boolean | null;
  /** Whether the cohort is locked. */
  declare readonly is_locked: boolean | null;
  /** Data group identifier. */
  declare readonly data_group_id: string | null;
  /** Last edited timestamp string. */
  declare readonly last_edited: string | null;
  /** Creator information. */
  declare readonly created_by: CohortCreator | null;
  /** IDs of entities referencing this cohort. */
  declare readonly referenced_by: readonly number[] | null;
  /** Whether the cohort is verified. */
  declare readonly verified: boolean;
  /** Last queried timestamp string. */
  declare readonly last_queried: string | null;
  /** IDs of entities directly referencing this cohort. */
  declare readonly referenced_directly_by: readonly number[];
  /** Active integration IDs. */
  declare readonly active_integrations: readonly number[];

  /**
   * Construct a validated Cohort (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: CohortInit) {
    super(Cohort, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): Cohort {
    return new Cohort(prepareInit(Cohort, raw));
  }
}

/**
 * Constructor input for {@link CreateCohortParams} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface CreateCohortParamsInit {
  /** Python field `definition`. */
  readonly definition?: Readonly<Record<string, unknown>> | null | undefined;
  /** Cohort name (required). */
  readonly name: string;
  /** Cohort description. */
  readonly description?: string | null | undefined;
  /** Data group identifier. */
  readonly data_group_id?: string | null | undefined;
  /** Whether the cohort should be locked. */
  readonly is_locked?: boolean | null | undefined;
  /** Whether the cohort should be visible. */
  readonly is_visible?: boolean | null | undefined;
  /** Soft-delete flag. */
  readonly deleted?: boolean | null | undefined;
}

/**
 * Parameters for creating a new cohort.
 *
 * @remarks Pydantic `extra='ignore'`: unknown keys are dropped.
 * @example
 * ```ts
 * const params = new CreateCohortParams({
 *   name: "Power users",
 *   description: "Weekly overview",
 * });
 * params.name; // "Power users"
 * ```
 * @see mixpanel_headless.types.CreateCohortParams
 */
export class CreateCohortParams extends EntityModel<CreateCohortParamsInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "CreateCohortParams";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<CreateCohortParamsInit> = [
    { name: "definition", nullable: true },
    { name: "name", required: true, kind: "str" },
    { name: "description", kind: "str", nullable: true },
    { name: "data_group_id", kind: "str", nullable: true },
    { name: "is_locked", kind: "bool", nullable: true },
    { name: "is_visible", kind: "bool", nullable: true },
    { name: "deleted", kind: "bool", nullable: true },
  ];

  /** Python field `definition`. */
  declare readonly definition: Readonly<Record<string, unknown>> | null;
  /** Cohort name (required). */
  declare readonly name: string;
  /** Cohort description. */
  declare readonly description: string | null;
  /** Data group identifier. */
  declare readonly data_group_id: string | null;
  /** Whether the cohort should be locked. */
  declare readonly is_locked: boolean | null;
  /** Whether the cohort should be visible. */
  declare readonly is_visible: boolean | null;
  /** Soft-delete flag. */
  declare readonly deleted: boolean | null;

  /**
   * Construct a validated CreateCohortParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: CreateCohortParamsInit) {
    super(CreateCohortParams, fields);
  }

  /**
   * `model_dump(exclude_none=True)` with `definition` flattened into
   * the top level, as Python's `_DefinitionFlatteningModel` does.
   *
   * @param options - Pydantic dump flags (`by_alias`).
   * @returns The flattened payload.
   */
  override modelDumpExcludeNone(
    options: ModelDumpOptions = {},
  ): Record<string, unknown> {
    return flattenDefinition(super.modelDumpExcludeNone(options));
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): CreateCohortParams {
    return new CreateCohortParams(prepareInit(CreateCohortParams, raw));
  }
}

/**
 * Constructor input for {@link UpdateCohortParams} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface UpdateCohortParamsInit {
  /** Python field `definition`. */
  readonly definition?: Readonly<Record<string, unknown>> | null | undefined;
  /** New cohort name. */
  readonly name?: string | null | undefined;
  /** New cohort description. */
  readonly description?: string | null | undefined;
  /** New data group identifier. */
  readonly data_group_id?: string | null | undefined;
  /** New lock setting. */
  readonly is_locked?: boolean | null | undefined;
  /** New visibility setting. */
  readonly is_visible?: boolean | null | undefined;
  /** Soft-delete flag. */
  readonly deleted?: boolean | null | undefined;
}

/**
 * Parameters for updating an existing cohort.
 *
 * @remarks Pydantic `extra='ignore'`: unknown keys are dropped.
 * @example
 * ```ts
 * const params = new UpdateCohortParams({ name: "Example" });
 * params.name; // "Example"
 * ```
 * @see mixpanel_headless.types.UpdateCohortParams
 */
export class UpdateCohortParams extends EntityModel<UpdateCohortParamsInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "UpdateCohortParams";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<UpdateCohortParamsInit> = [
    { name: "definition", nullable: true },
    { name: "name", kind: "str", nullable: true },
    { name: "description", kind: "str", nullable: true },
    { name: "data_group_id", kind: "str", nullable: true },
    { name: "is_locked", kind: "bool", nullable: true },
    { name: "is_visible", kind: "bool", nullable: true },
    { name: "deleted", kind: "bool", nullable: true },
  ];

  /** Python field `definition`. */
  declare readonly definition: Readonly<Record<string, unknown>> | null;
  /** New cohort name. */
  declare readonly name: string | null;
  /** New cohort description. */
  declare readonly description: string | null;
  /** New data group identifier. */
  declare readonly data_group_id: string | null;
  /** New lock setting. */
  declare readonly is_locked: boolean | null;
  /** New visibility setting. */
  declare readonly is_visible: boolean | null;
  /** Soft-delete flag. */
  declare readonly deleted: boolean | null;

  /**
   * Construct a validated UpdateCohortParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: UpdateCohortParamsInit) {
    super(UpdateCohortParams, fields);
  }

  /**
   * `model_dump(exclude_none=True)` with `definition` flattened into
   * the top level, as Python's `_DefinitionFlatteningModel` does.
   *
   * @param options - Pydantic dump flags (`by_alias`).
   * @returns The flattened payload.
   */
  override modelDumpExcludeNone(
    options: ModelDumpOptions = {},
  ): Record<string, unknown> {
    return flattenDefinition(super.modelDumpExcludeNone(options));
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): UpdateCohortParams {
    return new UpdateCohortParams(prepareInit(UpdateCohortParams, raw));
  }
}

/**
 * Constructor input for {@link BulkUpdateCohortEntry} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface BulkUpdateCohortEntryInit {
  /** Python field `definition`. */
  readonly definition?: Readonly<Record<string, unknown>> | null | undefined;
  /** Cohort ID to update (required). */
  readonly id: number;
  /** New cohort name. */
  readonly name?: string | null | undefined;
  /** New cohort description. */
  readonly description?: string | null | undefined;
}

/**
 * Entry for bulk-updating cohorts.
 *
 * @remarks Pydantic `extra='ignore'`: unknown keys are dropped.
 * @example
 * ```ts
 * const params = new BulkUpdateCohortEntry({ id: 42, name: "Example" });
 * params.id; // 42
 * ```
 * @see mixpanel_headless.types.BulkUpdateCohortEntry
 */
export class BulkUpdateCohortEntry extends EntityModel<BulkUpdateCohortEntryInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "BulkUpdateCohortEntry";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<BulkUpdateCohortEntryInit> = [
    { name: "definition", nullable: true },
    { name: "id", required: true, kind: "int" },
    { name: "name", kind: "str", nullable: true },
    { name: "description", kind: "str", nullable: true },
  ];

  /** Python field `definition`. */
  declare readonly definition: Readonly<Record<string, unknown>> | null;
  /** Cohort ID to update (required). */
  declare readonly id: number;
  /** New cohort name. */
  declare readonly name: string | null;
  /** New cohort description. */
  declare readonly description: string | null;

  /**
   * Construct a validated BulkUpdateCohortEntry (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: BulkUpdateCohortEntryInit) {
    super(BulkUpdateCohortEntry, fields);
  }

  /**
   * `model_dump(exclude_none=True)` with `definition` flattened into
   * the top level, as Python's `_DefinitionFlatteningModel` does.
   *
   * @param options - Pydantic dump flags (`by_alias`).
   * @returns The flattened payload.
   */
  override modelDumpExcludeNone(
    options: ModelDumpOptions = {},
  ): Record<string, unknown> {
    return flattenDefinition(super.modelDumpExcludeNone(options));
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): BulkUpdateCohortEntry {
    return new BulkUpdateCohortEntry(prepareInit(BulkUpdateCohortEntry, raw));
  }
}
