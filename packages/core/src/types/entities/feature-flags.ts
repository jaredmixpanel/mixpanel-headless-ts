/**
 * Feature-flag family + flag CRUD/history params.
 *
 * Hand-written ports of the Pydantic entity models (phase2-design C5,
 * packet P2-7): the PYTHON models are the source of record; vendored
 * schema4api types are a compile-time cross-check only. Field names
 * keep their exact Python spelling (R3.6/R7.6); optionality follows
 * R3.9/R4.10 via the model-base materialization rules.
 */

import type {
  FeatureFlagStatus,
  FlagContractStatus,
  ServingMethod,
} from "../enums.js";
import {
  type EntityFieldSpec,
  EntityModel,
  oneOf,
  prepareInit,
} from "./model-base.js";

/**
 * Constructor input for {@link FeatureFlag} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface FeatureFlagInit {
  /** Unique identifier (UUID). */
  readonly id: string;
  /** Project this flag belongs to. */
  readonly project_id: number;
  /** Human-readable name. */
  readonly name: string;
  /** Machine-readable key (unique per project). */
  readonly key: string;
  /** Optional description. */
  readonly description?: string | null | undefined;
  /** Current lifecycle status. */
  readonly status?: FeatureFlagStatus | undefined;
  /** Tags for organization. */
  readonly tags?: readonly string[] | undefined;
  /** Linked experiment ID if flag backs an experiment. */
  readonly experiment_id?: string | null | undefined;
  /** Flag context identifier. */
  readonly context?: string | undefined;
  /** Data group identifier. */
  readonly data_group_id?: string | null | undefined;
  /** How flag values are delivered. */
  readonly serving_method?: ServingMethod | undefined;
  /** Variants, rollout rules, and test overrides. */
  readonly ruleset?: Readonly<Record<string, unknown>> | undefined;
  /** Salt for deterministic variant assignment. */
  readonly hash_salt?: string | null | undefined;
  /** Workspace this flag belongs to. */
  readonly workspace_id?: number | null | undefined;
  /** Content type identifier. */
  readonly content_type?: string | null | undefined;
  /** ISO 8601 creation timestamp. */
  readonly created?: string | undefined;
  /** ISO 8601 last-modified timestamp. */
  readonly modified?: string | undefined;
  /** Timestamp when flag was last enabled. */
  readonly enabled_at?: string | null | undefined;
  /** Timestamp when flag was deleted. */
  readonly deleted?: string | null | undefined;
  /** Creator's user ID. */
  readonly creator_id?: number | null | undefined;
  /** Creator's display name. */
  readonly creator_name?: string | null | undefined;
  /** Creator's email. */
  readonly creator_email?: string | null | undefined;
  /** Last modifier's user ID. */
  readonly last_modified_by_id?: number | null | undefined;
  /** Last modifier's display name. */
  readonly last_modified_by_name?: string | null | undefined;
  /** Last modifier's email. */
  readonly last_modified_by_email?: string | null | undefined;
  /** Whether current user has favorited. */
  readonly is_favorited?: boolean | null | undefined;
  /** Date flag was pinned. */
  readonly pinned_date?: string | null | undefined;
  /** Permission: can current user edit. */
  readonly can_edit?: boolean | undefined;
}

/**
 * A Mixpanel feature flag as returned by the App API.
 *
 * Mirror of Python `mixpanel_headless.types.FeatureFlag` (types.py:3107;
 * model_config: frozen=True, extra='allow', populate_by_name=True).
 */
export class FeatureFlag extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "FeatureFlag";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "id", required: true, kind: "str" },
    { name: "project_id", required: true, kind: "int" },
    { name: "name", required: true, kind: "str" },
    { name: "key", required: true, kind: "str" },
    { name: "description", kind: "str", nullable: true },
    {
      name: "status",
      default: () => "disabled",
      check: oneOf(["enabled", "disabled", "archived"]),
    },
    { name: "tags", default: () => [] },
    { name: "experiment_id", kind: "str", nullable: true },
    { name: "context", default: () => "", kind: "str" },
    { name: "data_group_id", kind: "str", nullable: true },
    {
      name: "serving_method",
      default: () => "client",
      check: oneOf(["client", "server", "remote_or_local", "remote_only"]),
    },
    { name: "ruleset", default: () => ({}) },
    { name: "hash_salt", kind: "str", nullable: true },
    { name: "workspace_id", kind: "int", nullable: true },
    { name: "content_type", kind: "str", nullable: true },
    { name: "created", default: () => "", kind: "str" },
    { name: "modified", default: () => "", kind: "str" },
    { name: "enabled_at", kind: "str", nullable: true },
    { name: "deleted", kind: "str", nullable: true },
    { name: "creator_id", kind: "int", nullable: true },
    { name: "creator_name", kind: "str", nullable: true },
    { name: "creator_email", kind: "str", nullable: true },
    { name: "last_modified_by_id", kind: "int", nullable: true },
    { name: "last_modified_by_name", kind: "str", nullable: true },
    { name: "last_modified_by_email", kind: "str", nullable: true },
    { name: "is_favorited", kind: "bool", nullable: true },
    { name: "pinned_date", kind: "str", nullable: true },
    { name: "can_edit", default: () => false, kind: "bool" },
  ];

  /** Unique identifier (UUID). */
  declare readonly id: string;
  /** Project this flag belongs to. */
  declare readonly project_id: number;
  /** Human-readable name. */
  declare readonly name: string;
  /** Machine-readable key (unique per project). */
  declare readonly key: string;
  /** Optional description. */
  declare readonly description: string | null;
  /** Current lifecycle status. */
  declare readonly status: FeatureFlagStatus;
  /** Tags for organization. */
  declare readonly tags: readonly string[];
  /** Linked experiment ID if flag backs an experiment. */
  declare readonly experiment_id: string | null;
  /** Flag context identifier. */
  declare readonly context: string;
  /** Data group identifier. */
  declare readonly data_group_id: string | null;
  /** How flag values are delivered. */
  declare readonly serving_method: ServingMethod;
  /** Variants, rollout rules, and test overrides. */
  declare readonly ruleset: Readonly<Record<string, unknown>>;
  /** Salt for deterministic variant assignment. */
  declare readonly hash_salt: string | null;
  /** Workspace this flag belongs to. */
  declare readonly workspace_id: number | null;
  /** Content type identifier. */
  declare readonly content_type: string | null;
  /** ISO 8601 creation timestamp. */
  declare readonly created: string;
  /** ISO 8601 last-modified timestamp. */
  declare readonly modified: string;
  /** Timestamp when flag was last enabled. */
  declare readonly enabled_at: string | null;
  /** Timestamp when flag was deleted. */
  declare readonly deleted: string | null;
  /** Creator's user ID. */
  declare readonly creator_id: number | null;
  /** Creator's display name. */
  declare readonly creator_name: string | null;
  /** Creator's email. */
  declare readonly creator_email: string | null;
  /** Last modifier's user ID. */
  declare readonly last_modified_by_id: number | null;
  /** Last modifier's display name. */
  declare readonly last_modified_by_name: string | null;
  /** Last modifier's email. */
  declare readonly last_modified_by_email: string | null;
  /** Whether current user has favorited. */
  declare readonly is_favorited: boolean | null;
  /** Date flag was pinned. */
  declare readonly pinned_date: string | null;
  /** Permission: can current user edit. */
  declare readonly can_edit: boolean;

  /**
   * Construct a validated FeatureFlag (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: FeatureFlagInit) {
    super(FeatureFlag, fields as unknown as Readonly<Record<string, unknown>>);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): FeatureFlag {
    return new FeatureFlag(
      prepareInit(FeatureFlag, raw) as unknown as FeatureFlagInit,
    );
  }
}

/**
 * Constructor input for {@link CreateFeatureFlagParams} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface CreateFeatureFlagParamsInit {
  /** Flag name (required). */
  readonly name: string;
  /** Unique machine-readable key (required). */
  readonly key: string;
  /** Optional description. */
  readonly description?: string | null | undefined;
  /** Initial status (defaults to disabled). */
  readonly status?: FeatureFlagStatus | null | undefined;
  /** Tags for organization (required by API, defaults to empty list). */
  readonly tags?: readonly string[] | undefined;
  /** Flag context identifier (required by API). */
  readonly context?: string | undefined;
  /** How flag values are delivered (required by API). */
  readonly serving_method?: ServingMethod | undefined;
  /** Ruleset with variants and rollout (required by API). */
  readonly ruleset?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * Parameters for creating a new feature flag.
 *
 * Mirror of Python `mixpanel_headless.types.CreateFeatureFlagParams` (types.py:3249;
 * model_config: extra='ignore').
 */
export class CreateFeatureFlagParams extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "CreateFeatureFlagParams";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "name", required: true, kind: "str" },
    { name: "key", required: true, kind: "str" },
    { name: "description", kind: "str", nullable: true },
    {
      name: "status",
      nullable: true,
      check: oneOf(["enabled", "disabled", "archived"]),
    },
    { name: "tags", default: () => [] },
    { name: "context", default: () => "distinct_id", kind: "str" },
    {
      name: "serving_method",
      default: () => "client",
      check: oneOf(["client", "server", "remote_or_local", "remote_only"]),
    },
    {
      name: "ruleset",
      default: () => ({
        variants: [
          {
            key: "On",
            value: true,
            is_control: false,
            split: 1.0,
            is_sticky: false,
          },
          {
            key: "Off",
            value: false,
            is_control: true,
            split: 0.0,
            is_sticky: false,
          },
        ],
        rollout: [],
      }),
    },
  ];

  /** Flag name (required). */
  declare readonly name: string;
  /** Unique machine-readable key (required). */
  declare readonly key: string;
  /** Optional description. */
  declare readonly description: string | null;
  /** Initial status (defaults to disabled). */
  declare readonly status: FeatureFlagStatus | null;
  /** Tags for organization (required by API, defaults to empty list). */
  declare readonly tags: readonly string[];
  /** Flag context identifier (required by API). */
  declare readonly context: string;
  /** How flag values are delivered (required by API). */
  declare readonly serving_method: ServingMethod;
  /** Ruleset with variants and rollout (required by API). */
  declare readonly ruleset: Readonly<Record<string, unknown>>;

  /**
   * Construct a validated CreateFeatureFlagParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: CreateFeatureFlagParamsInit) {
    super(
      CreateFeatureFlagParams,
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
  static fromDict(raw: unknown): CreateFeatureFlagParams {
    return new CreateFeatureFlagParams(
      prepareInit(
        CreateFeatureFlagParams,
        raw,
      ) as unknown as CreateFeatureFlagParamsInit,
    );
  }
}

/**
 * Constructor input for {@link UpdateFeatureFlagParams} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface UpdateFeatureFlagParamsInit {
  /** Flag name (required). */
  readonly name: string;
  /** Unique key (required). */
  readonly key: string;
  /** Target status (required). */
  readonly status: FeatureFlagStatus;
  /** Complete ruleset — replaces existing (required). */
  readonly ruleset: Readonly<Record<string, unknown>>;
  /** Optional description. */
  readonly description?: string | null | undefined;
  /** Tags for organization (required by API, defaults to empty list). */
  readonly tags?: readonly string[] | undefined;
  /** Flag context identifier (required by API). */
  readonly context?: string | undefined;
  /** How flag values are delivered (required by API). */
  readonly serving_method?: ServingMethod | undefined;
}

/**
 * Parameters for updating an existing feature flag (PUT semantics).
 *
 * Mirror of Python `mixpanel_headless.types.UpdateFeatureFlagParams` (types.py:3324;
 * model_config: extra='ignore').
 */
export class UpdateFeatureFlagParams extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "UpdateFeatureFlagParams";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "name", required: true, kind: "str" },
    { name: "key", required: true, kind: "str" },
    {
      name: "status",
      required: true,
      check: oneOf(["enabled", "disabled", "archived"]),
    },
    { name: "ruleset", required: true },
    { name: "description", kind: "str", nullable: true },
    { name: "tags", default: () => [] },
    { name: "context", default: () => "distinct_id", kind: "str" },
    {
      name: "serving_method",
      default: () => "client",
      check: oneOf(["client", "server", "remote_or_local", "remote_only"]),
    },
  ];

  /** Flag name (required). */
  declare readonly name: string;
  /** Unique key (required). */
  declare readonly key: string;
  /** Target status (required). */
  declare readonly status: FeatureFlagStatus;
  /** Complete ruleset — replaces existing (required). */
  declare readonly ruleset: Readonly<Record<string, unknown>>;
  /** Optional description. */
  declare readonly description: string | null;
  /** Tags for organization (required by API, defaults to empty list). */
  declare readonly tags: readonly string[];
  /** Flag context identifier (required by API). */
  declare readonly context: string;
  /** How flag values are delivered (required by API). */
  declare readonly serving_method: ServingMethod;

  /**
   * Construct a validated UpdateFeatureFlagParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: UpdateFeatureFlagParamsInit) {
    super(
      UpdateFeatureFlagParams,
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
  static fromDict(raw: unknown): UpdateFeatureFlagParams {
    return new UpdateFeatureFlagParams(
      prepareInit(
        UpdateFeatureFlagParams,
        raw,
      ) as unknown as UpdateFeatureFlagParamsInit,
    );
  }
}

/**
 * Constructor input for {@link SetTestUsersParams} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface SetTestUsersParamsInit {
  /** Mapping of variant keys to user distinct IDs. */
  readonly users: Readonly<Record<string, string>>;
}

/**
 * Parameters for setting test user variant overrides on a flag.
 *
 * Mirror of Python `mixpanel_headless.types.SetTestUsersParams` (types.py:3380;
 * model_config: extra='ignore').
 */
export class SetTestUsersParams extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "SetTestUsersParams";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "users", required: true },
  ];

  /** Mapping of variant keys to user distinct IDs. */
  declare readonly users: Readonly<Record<string, string>>;

  /**
   * Construct a validated SetTestUsersParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: SetTestUsersParamsInit) {
    super(
      SetTestUsersParams,
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
  static fromDict(raw: unknown): SetTestUsersParams {
    return new SetTestUsersParams(
      prepareInit(SetTestUsersParams, raw) as unknown as SetTestUsersParamsInit,
    );
  }
}

/**
 * Constructor input for {@link FlagHistoryParams} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface FlagHistoryParamsInit {
  /** Pagination cursor. */
  readonly page?: string | null | undefined;
  /** Results per page. */
  readonly page_size?: number | null | undefined;
}

/**
 * Parameters for querying feature flag change history.
 *
 * Mirror of Python `mixpanel_headless.types.FlagHistoryParams` (types.py:3396;
 * model_config: extra='ignore').
 */
export class FlagHistoryParams extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "FlagHistoryParams";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "page", kind: "str", nullable: true },
    { name: "page_size", kind: "int", nullable: true },
  ];

  /** Pagination cursor. */
  declare readonly page: string | null;
  /** Results per page. */
  declare readonly page_size: number | null;

  /**
   * Construct a validated FlagHistoryParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: FlagHistoryParamsInit) {
    super(
      FlagHistoryParams,
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
  static fromDict(raw: unknown): FlagHistoryParams {
    return new FlagHistoryParams(prepareInit(FlagHistoryParams, raw));
  }
}

/**
 * Constructor input for {@link FlagHistoryResponse} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface FlagHistoryResponseInit {
  /** Array of event arrays. */
  readonly events: ReadonlyArray<readonly unknown[]>;
  /** Total number of events. */
  readonly count: number;
}

/**
 * Paginated change history for a feature flag.
 *
 * Mirror of Python `mixpanel_headless.types.FlagHistoryResponse` (types.py:3416;
 * model_config: frozen=True, extra='allow').
 */
export class FlagHistoryResponse extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "FlagHistoryResponse";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "events", required: true },
    { name: "count", required: true, kind: "int" },
  ];

  /** Array of event arrays. */
  declare readonly events: ReadonlyArray<readonly unknown[]>;
  /** Total number of events. */
  declare readonly count: number;

  /**
   * Construct a validated FlagHistoryResponse (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: FlagHistoryResponseInit) {
    super(
      FlagHistoryResponse,
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
  static fromDict(raw: unknown): FlagHistoryResponse {
    return new FlagHistoryResponse(
      prepareInit(
        FlagHistoryResponse,
        raw,
      ) as unknown as FlagHistoryResponseInit,
    );
  }
}

/**
 * Constructor input for {@link FlagLimitsResponse} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface FlagLimitsResponseInit {
  /** Maximum allowed flags. */
  readonly limit: number;
  /** Whether account is on trial. */
  readonly is_trial: boolean;
  /** Current number of flags. */
  readonly current_usage: number;
  /** Contract status. */
  readonly contract_status: FlagContractStatus;
}

/**
 * Account-level feature flag usage and limits.
 *
 * Mirror of Python `mixpanel_headless.types.FlagLimitsResponse` (types.py:3439;
 * model_config: frozen=True, extra='allow').
 */
export class FlagLimitsResponse extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "FlagLimitsResponse";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "limit", required: true, kind: "int" },
    { name: "is_trial", required: true, kind: "bool" },
    { name: "current_usage", required: true, kind: "int" },
    {
      name: "contract_status",
      required: true,
      check: oneOf(["active", "grace_period", "expired"]),
    },
  ];

  /** Maximum allowed flags. */
  declare readonly limit: number;
  /** Whether account is on trial. */
  declare readonly is_trial: boolean;
  /** Current number of flags. */
  declare readonly current_usage: number;
  /** Contract status. */
  declare readonly contract_status: FlagContractStatus;

  /**
   * Construct a validated FlagLimitsResponse (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: FlagLimitsResponseInit) {
    super(
      FlagLimitsResponse,
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
  static fromDict(raw: unknown): FlagLimitsResponse {
    return new FlagLimitsResponse(
      prepareInit(FlagLimitsResponse, raw) as unknown as FlagLimitsResponseInit,
    );
  }
}
