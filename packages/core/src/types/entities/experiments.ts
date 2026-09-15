/**
 * Experiment family + experiment CRUD params.
 *
 * Hand-written ports of the Pydantic entity models (phase2-design C5,
 * packet P2-7): the PYTHON models are the source of record; vendored
 * schema4api types are a compile-time cross-check only. Field names
 * keep their exact Python spelling (R3.6/R7.6); optionality follows
 * R3.9/R4.10 via the model-base materialization rules.
 */

import type { ExperimentStatus } from "../enums.js";
import {
  type EntityFieldSpecs,
  EntityModel,
  oneOf,
  prepareInit,
} from "./model-base.js";

/**
 * Constructor input for {@link ExperimentCreator} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface ExperimentCreatorInit {
  /** Creator's user ID. */
  readonly id?: number | null | undefined;
  /** Creator's first name. */
  readonly first_name?: string | null | undefined;
  /** Creator's last name. */
  readonly last_name?: string | null | undefined;
}

/**
 * Creator metadata for an experiment.
 *
 * Mirror of Python `mixpanel_headless.types.ExperimentCreator` (types.py:3081;
 * model_config: frozen=True, extra='allow').
 */
export class ExperimentCreator extends EntityModel<ExperimentCreatorInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "ExperimentCreator";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<ExperimentCreatorInit> = [
    { name: "id", kind: "int", nullable: true },
    { name: "first_name", kind: "str", nullable: true },
    { name: "last_name", kind: "str", nullable: true },
  ];

  /** Creator's user ID. */
  declare readonly id: number | null;
  /** Creator's first name. */
  declare readonly first_name: string | null;
  /** Creator's last name. */
  declare readonly last_name: string | null;

  /**
   * Construct a validated ExperimentCreator (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: ExperimentCreatorInit) {
    super(ExperimentCreator, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): ExperimentCreator {
    return new ExperimentCreator(prepareInit(ExperimentCreator, raw));
  }
}

/**
 * Constructor input for {@link Experiment} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface ExperimentInit {
  /** Unique identifier (UUID). */
  readonly id: string;
  /** Human-readable name. */
  readonly name: string;
  /** Optional description. */
  readonly description?: string | null | undefined;
  /** Experiment hypothesis. */
  readonly hypothesis?: string | null | undefined;
  /** Current lifecycle status. */
  readonly status?: ExperimentStatus | null | undefined;
  /** Variant configuration (list from API, may also be dict). */
  readonly variants?:
    readonly unknown[] | Readonly<Record<string, unknown>> | null | undefined;
  /** Success metrics (list from API, may also be dict). */
  readonly metrics?:
    readonly unknown[] | Readonly<Record<string, unknown>> | null | undefined;
  /** Experiment settings. */
  readonly settings?: Readonly<Record<string, unknown>> | null | undefined;
  /** Cached exposure data. */
  readonly exposures_cache?:
    Readonly<Record<string, unknown>> | null | undefined;
  /** Cached result data. */
  readonly results_cache?: Readonly<Record<string, unknown>> | null | undefined;
  /** ISO 8601 start date. */
  readonly start_date?: string | null | undefined;
  /** ISO 8601 end date. */
  readonly end_date?: string | null | undefined;
  /** ISO 8601 creation timestamp. */
  readonly created?: string | null | undefined;
  /** ISO 8601 last-updated timestamp. */
  readonly updated?: string | null | undefined;
  /** Creator metadata. */
  readonly creator?:
    ExperimentCreator | Readonly<Record<string, unknown>> | null | undefined;
  /** Linked feature flag data. */
  readonly feature_flag?: Readonly<Record<string, unknown>> | null | undefined;
  /** Whether current user has favorited. */
  readonly is_favorited?: boolean | null | undefined;
  /** Date experiment was pinned. */
  readonly pinned_date?: string | null | undefined;
  /** Tags for organization. */
  readonly tags?: readonly string[] | null | undefined;
  /** Permission: can current user edit. */
  readonly can_edit?: boolean | null | undefined;
  /** Last modifier's user ID. */
  readonly last_modified_by_id?: number | null | undefined;
  /** Last modifier's display name. */
  readonly last_modified_by_name?: string | null | undefined;
  /** Last modifier's email. */
  readonly last_modified_by_email?: string | null | undefined;
}

/**
 * A Mixpanel A/B experiment as returned by the App API.
 *
 * Mirror of Python `mixpanel_headless.types.Experiment` (types.py:3473;
 * model_config: frozen=True, extra='allow', populate_by_name=True).
 */
export class Experiment extends EntityModel<ExperimentInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "Experiment";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<ExperimentInit> = [
    { name: "id", required: true, kind: "str" },
    { name: "name", required: true, kind: "str" },
    { name: "description", kind: "str", nullable: true },
    { name: "hypothesis", kind: "str", nullable: true },
    {
      name: "status",
      nullable: true,
      check: oneOf(["draft", "active", "concluded", "success", "fail"]),
    },
    { name: "variants", nullable: true },
    { name: "metrics", nullable: true },
    { name: "settings", nullable: true },
    { name: "exposures_cache", nullable: true },
    { name: "results_cache", nullable: true },
    { name: "start_date", kind: "str", nullable: true },
    { name: "end_date", kind: "str", nullable: true },
    { name: "created", kind: "str", nullable: true },
    { name: "updated", kind: "str", nullable: true },
    { name: "creator", nullable: true, nested: () => ExperimentCreator },
    { name: "feature_flag", nullable: true },
    { name: "is_favorited", kind: "bool", nullable: true },
    { name: "pinned_date", kind: "str", nullable: true },
    { name: "tags", nullable: true },
    { name: "can_edit", kind: "bool", nullable: true },
    { name: "last_modified_by_id", kind: "int", nullable: true },
    { name: "last_modified_by_name", kind: "str", nullable: true },
    { name: "last_modified_by_email", kind: "str", nullable: true },
  ];

  /** Unique identifier (UUID). */
  declare readonly id: string;
  /** Human-readable name. */
  declare readonly name: string;
  /** Optional description. */
  declare readonly description: string | null;
  /** Experiment hypothesis. */
  declare readonly hypothesis: string | null;
  /** Current lifecycle status. */
  declare readonly status: ExperimentStatus | null;
  /** Variant configuration (list from API, may also be dict). */
  declare readonly variants:
    readonly unknown[] | Readonly<Record<string, unknown>> | null;
  /** Success metrics (list from API, may also be dict). */
  declare readonly metrics:
    readonly unknown[] | Readonly<Record<string, unknown>> | null;
  /** Experiment settings. */
  declare readonly settings: Readonly<Record<string, unknown>> | null;
  /** Cached exposure data. */
  declare readonly exposures_cache: Readonly<Record<string, unknown>> | null;
  /** Cached result data. */
  declare readonly results_cache: Readonly<Record<string, unknown>> | null;
  /** ISO 8601 start date. */
  declare readonly start_date: string | null;
  /** ISO 8601 end date. */
  declare readonly end_date: string | null;
  /** ISO 8601 creation timestamp. */
  declare readonly created: string | null;
  /** ISO 8601 last-updated timestamp. */
  declare readonly updated: string | null;
  /** Creator metadata. */
  declare readonly creator: ExperimentCreator | null;
  /** Linked feature flag data. */
  declare readonly feature_flag: Readonly<Record<string, unknown>> | null;
  /** Whether current user has favorited. */
  declare readonly is_favorited: boolean | null;
  /** Date experiment was pinned. */
  declare readonly pinned_date: string | null;
  /** Tags for organization. */
  declare readonly tags: readonly string[] | null;
  /** Permission: can current user edit. */
  declare readonly can_edit: boolean | null;
  /** Last modifier's user ID. */
  declare readonly last_modified_by_id: number | null;
  /** Last modifier's display name. */
  declare readonly last_modified_by_name: string | null;
  /** Last modifier's email. */
  declare readonly last_modified_by_email: string | null;

  /**
   * Construct a validated Experiment (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: ExperimentInit) {
    super(Experiment, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): Experiment {
    return new Experiment(prepareInit(Experiment, raw));
  }
}

/**
 * Constructor input for {@link CreateExperimentParams} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface CreateExperimentParamsInit {
  /** Experiment name (required). */
  readonly name: string;
  /** Optional description. */
  readonly description?: string | null | undefined;
  /** Experiment hypothesis. */
  readonly hypothesis?: string | null | undefined;
  /** Experiment settings. */
  readonly settings?: Readonly<Record<string, unknown>> | null | undefined;
  /** Access control type. */
  readonly access_type?: string | null | undefined;
  /** Edit permission. */
  readonly can_edit?: boolean | null | undefined;
}

/**
 * Parameters for creating a new experiment.
 *
 * Mirror of Python `mixpanel_headless.types.CreateExperimentParams` (types.py:3584;
 * model_config: extra='ignore').
 */
export class CreateExperimentParams extends EntityModel<CreateExperimentParamsInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "CreateExperimentParams";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<CreateExperimentParamsInit> = [
    { name: "name", required: true, kind: "str" },
    { name: "description", kind: "str", nullable: true },
    { name: "hypothesis", kind: "str", nullable: true },
    { name: "settings", nullable: true },
    { name: "access_type", kind: "str", nullable: true },
    { name: "can_edit", kind: "bool", nullable: true },
  ];

  /** Experiment name (required). */
  declare readonly name: string;
  /** Optional description. */
  declare readonly description: string | null;
  /** Experiment hypothesis. */
  declare readonly hypothesis: string | null;
  /** Experiment settings. */
  declare readonly settings: Readonly<Record<string, unknown>> | null;
  /** Access control type. */
  declare readonly access_type: string | null;
  /** Edit permission. */
  declare readonly can_edit: boolean | null;

  /**
   * Construct a validated CreateExperimentParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: CreateExperimentParamsInit) {
    super(CreateExperimentParams, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): CreateExperimentParams {
    return new CreateExperimentParams(prepareInit(CreateExperimentParams, raw));
  }
}

/**
 * Constructor input for {@link UpdateExperimentParams} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface UpdateExperimentParamsInit {
  /** Updated name. */
  readonly name?: string | null | undefined;
  /** Updated description. */
  readonly description?: string | null | undefined;
  /** Updated hypothesis. */
  readonly hypothesis?: string | null | undefined;
  /** Updated variant config (list or dict). */
  readonly variants?:
    readonly unknown[] | Readonly<Record<string, unknown>> | null | undefined;
  /** Updated metrics (list or dict). */
  readonly metrics?:
    readonly unknown[] | Readonly<Record<string, unknown>> | null | undefined;
  /** Updated settings. */
  readonly settings?: Readonly<Record<string, unknown>> | null | undefined;
  /** Updated start date. */
  readonly start_date?: string | null | undefined;
  /** Updated end date. */
  readonly end_date?: string | null | undefined;
  /** Updated tags. */
  readonly tags?: readonly string[] | null | undefined;
  /** Updated exposures cache. */
  readonly exposures_cache?:
    Readonly<Record<string, unknown>> | null | undefined;
  /** Updated results cache. */
  readonly results_cache?: Readonly<Record<string, unknown>> | null | undefined;
  /** Updated status. */
  readonly status?: ExperimentStatus | null | undefined;
  /** Updated access type. */
  readonly global_access_type?: string | null | undefined;
}

/**
 * Parameters for updating an existing experiment (PATCH semantics).
 *
 * Mirror of Python `mixpanel_headless.types.UpdateExperimentParams` (types.py:3622;
 * model_config: extra='ignore').
 */
export class UpdateExperimentParams extends EntityModel<UpdateExperimentParamsInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "UpdateExperimentParams";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<UpdateExperimentParamsInit> = [
    { name: "name", kind: "str", nullable: true },
    { name: "description", kind: "str", nullable: true },
    { name: "hypothesis", kind: "str", nullable: true },
    { name: "variants", nullable: true },
    { name: "metrics", nullable: true },
    { name: "settings", nullable: true },
    { name: "start_date", kind: "str", nullable: true },
    { name: "end_date", kind: "str", nullable: true },
    { name: "tags", nullable: true },
    { name: "exposures_cache", nullable: true },
    { name: "results_cache", nullable: true },
    {
      name: "status",
      nullable: true,
      check: oneOf(["draft", "active", "concluded", "success", "fail"]),
    },
    { name: "global_access_type", kind: "str", nullable: true },
  ];

  /** Updated name. */
  declare readonly name: string | null;
  /** Updated description. */
  declare readonly description: string | null;
  /** Updated hypothesis. */
  declare readonly hypothesis: string | null;
  /** Updated variant config (list or dict). */
  declare readonly variants:
    readonly unknown[] | Readonly<Record<string, unknown>> | null;
  /** Updated metrics (list or dict). */
  declare readonly metrics:
    readonly unknown[] | Readonly<Record<string, unknown>> | null;
  /** Updated settings. */
  declare readonly settings: Readonly<Record<string, unknown>> | null;
  /** Updated start date. */
  declare readonly start_date: string | null;
  /** Updated end date. */
  declare readonly end_date: string | null;
  /** Updated tags. */
  declare readonly tags: readonly string[] | null;
  /** Updated exposures cache. */
  declare readonly exposures_cache: Readonly<Record<string, unknown>> | null;
  /** Updated results cache. */
  declare readonly results_cache: Readonly<Record<string, unknown>> | null;
  /** Updated status. */
  declare readonly status: ExperimentStatus | null;
  /** Updated access type. */
  declare readonly global_access_type: string | null;

  /**
   * Construct a validated UpdateExperimentParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: UpdateExperimentParamsInit) {
    super(UpdateExperimentParams, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): UpdateExperimentParams {
    return new UpdateExperimentParams(prepareInit(UpdateExperimentParams, raw));
  }
}

/**
 * Constructor input for {@link ExperimentConcludeParams} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface ExperimentConcludeParamsInit {
  /** Override end date (ISO 8601). */
  readonly end_date?: string | null | undefined;
}

/**
 * Parameters for concluding an experiment.
 *
 * Mirror of Python `mixpanel_headless.types.ExperimentConcludeParams` (types.py:3690;
 * model_config: extra='ignore').
 */
export class ExperimentConcludeParams extends EntityModel<ExperimentConcludeParamsInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "ExperimentConcludeParams";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<ExperimentConcludeParamsInit> = [
    { name: "end_date", kind: "str", nullable: true },
  ];

  /** Override end date (ISO 8601). */
  declare readonly end_date: string | null;

  /**
   * Construct a validated ExperimentConcludeParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: ExperimentConcludeParamsInit) {
    super(ExperimentConcludeParams, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): ExperimentConcludeParams {
    return new ExperimentConcludeParams(
      prepareInit(ExperimentConcludeParams, raw),
    );
  }
}

/**
 * Constructor input for {@link ExperimentDecideParams} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface ExperimentDecideParamsInit {
  /** Whether the experiment succeeded (required). */
  readonly success: boolean;
  /** Winning variant key. */
  readonly variant?: string | null | undefined;
  /** Decision summary message. */
  readonly message?: string | null | undefined;
}

/**
 * Parameters for recording an experiment decision.
 *
 * Mirror of Python `mixpanel_headless.types.ExperimentDecideParams` (types.py:3706;
 * model_config: extra='ignore').
 */
export class ExperimentDecideParams extends EntityModel<ExperimentDecideParamsInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "ExperimentDecideParams";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<ExperimentDecideParamsInit> = [
    { name: "success", required: true, kind: "bool" },
    { name: "variant", kind: "str", nullable: true },
    { name: "message", kind: "str", nullable: true },
  ];

  /** Whether the experiment succeeded (required). */
  declare readonly success: boolean;
  /** Winning variant key. */
  declare readonly variant: string | null;
  /** Decision summary message. */
  declare readonly message: string | null;

  /**
   * Construct a validated ExperimentDecideParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: ExperimentDecideParamsInit) {
    super(ExperimentDecideParams, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): ExperimentDecideParams {
    return new ExperimentDecideParams(prepareInit(ExperimentDecideParams, raw));
  }
}

/**
 * Constructor input for {@link DuplicateExperimentParams} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface DuplicateExperimentParamsInit {
  /** Name for the duplicated experiment (required). */
  readonly name: string;
}

/**
 * Parameters for duplicating an experiment.
 *
 * Mirror of Python `mixpanel_headless.types.DuplicateExperimentParams` (types.py:3730;
 * model_config: extra='ignore').
 */
export class DuplicateExperimentParams extends EntityModel<DuplicateExperimentParamsInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "DuplicateExperimentParams";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<DuplicateExperimentParamsInit> =
    [{ name: "name", required: true, kind: "str" }];

  /** Name for the duplicated experiment (required). */
  declare readonly name: string;

  /**
   * Construct a validated DuplicateExperimentParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: DuplicateExperimentParamsInit) {
    super(DuplicateExperimentParams, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): DuplicateExperimentParams {
    return new DuplicateExperimentParams(
      prepareInit(DuplicateExperimentParams, raw),
    );
  }
}
