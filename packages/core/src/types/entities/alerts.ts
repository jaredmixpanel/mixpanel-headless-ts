/**
 * Custom alert family (E4: derived from the Python models + wire vectors; the vendored alerts/custom contract is ADVISORY).
 *
 * Hand-written ports of the Pydantic entity models (phase2-design C5,
 * packet P2-7): the PYTHON models are the source of record; vendored
 * schema4api types are a compile-time cross-check only. Field names
 * keep their exact Python spelling (R3.6/R7.6); optionality follows
 * R3.9/R4.10 via the model-base materialization rules.
 */

import {
  codepointLength,
  type EntityFieldSpec,
  EntityModel,
  modelFail,
  oneOf,
  prepareInit,
} from "./model-base.js";

/**
 * Constructor input for {@link AlertBookmark} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface AlertBookmarkInit {
  /** Bookmark ID. */
  readonly id: number;
  /** Bookmark name. */
  readonly name?: string | null | undefined;
  /** Bookmark type. */
  readonly type?: string | null | undefined;
}

/**
 * Nested bookmark info for an alert.
 *
 * Mirror of Python `mixpanel_headless.types.AlertBookmark` (types.py:4151;
 * model_config: frozen=True, extra='allow').
 */
export class AlertBookmark extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "AlertBookmark";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "id", required: true, kind: "int" },
    { name: "name", kind: "str", nullable: true },
    { name: "type", kind: "str", nullable: true },
  ];

  /** Bookmark ID. */
  declare readonly id: number;
  /** Bookmark name. */
  declare readonly name: string | null;
  /** Bookmark type. */
  declare readonly type: string | null;

  /**
   * Construct a validated AlertBookmark (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: AlertBookmarkInit) {
    super(
      AlertBookmark,
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
  static fromDict(raw: unknown): AlertBookmark {
    return new AlertBookmark(
      prepareInit(AlertBookmark, raw) as unknown as AlertBookmarkInit,
    );
  }
}

/**
 * Constructor input for {@link AlertCreator} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface AlertCreatorInit {
  /** User ID. */
  readonly id: number;
  /** First name. */
  readonly first_name?: string | null | undefined;
  /** Last name. */
  readonly last_name?: string | null | undefined;
  /** Email. */
  readonly email?: string | null | undefined;
}

/**
 * Nested creator info for an alert.
 *
 * Mirror of Python `mixpanel_headless.types.AlertCreator` (types.py:4177;
 * model_config: frozen=True, extra='allow').
 */
export class AlertCreator extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "AlertCreator";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "id", required: true, kind: "int" },
    { name: "first_name", kind: "str", nullable: true },
    { name: "last_name", kind: "str", nullable: true },
    { name: "email", kind: "str", nullable: true },
  ];

  /** User ID. */
  declare readonly id: number;
  /** First name. */
  declare readonly first_name: string | null;
  /** Last name. */
  declare readonly last_name: string | null;
  /** Email. */
  declare readonly email: string | null;

  /**
   * Construct a validated AlertCreator (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: AlertCreatorInit) {
    super(AlertCreator, fields as unknown as Readonly<Record<string, unknown>>);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): AlertCreator {
    return new AlertCreator(
      prepareInit(AlertCreator, raw) as unknown as AlertCreatorInit,
    );
  }
}

/**
 * Constructor input for {@link AlertWorkspace} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface AlertWorkspaceInit {
  /** Workspace ID. */
  readonly id: number;
  /** Workspace name. */
  readonly name?: string | null | undefined;
}

/**
 * Nested workspace info for an alert.
 *
 * Mirror of Python `mixpanel_headless.types.AlertWorkspace` (types.py:4207;
 * model_config: frozen=True, extra='allow').
 */
export class AlertWorkspace extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "AlertWorkspace";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "id", required: true, kind: "int" },
    { name: "name", kind: "str", nullable: true },
  ];

  /** Workspace ID. */
  declare readonly id: number;
  /** Workspace name. */
  declare readonly name: string | null;

  /**
   * Construct a validated AlertWorkspace (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: AlertWorkspaceInit) {
    super(
      AlertWorkspace,
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
  static fromDict(raw: unknown): AlertWorkspace {
    return new AlertWorkspace(
      prepareInit(AlertWorkspace, raw) as unknown as AlertWorkspaceInit,
    );
  }
}

/**
 * Constructor input for {@link AlertProject} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface AlertProjectInit {
  /** Project ID. */
  readonly id: number;
  /** Project name. */
  readonly name?: string | null | undefined;
}

/**
 * Nested project info for an alert.
 *
 * Mirror of Python `mixpanel_headless.types.AlertProject` (types.py:4229;
 * model_config: frozen=True, extra='allow').
 */
export class AlertProject extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "AlertProject";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "id", required: true, kind: "int" },
    { name: "name", kind: "str", nullable: true },
  ];

  /** Project ID. */
  declare readonly id: number;
  /** Project name. */
  declare readonly name: string | null;

  /**
   * Construct a validated AlertProject (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: AlertProjectInit) {
    super(AlertProject, fields as unknown as Readonly<Record<string, unknown>>);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): AlertProject {
    return new AlertProject(
      prepareInit(AlertProject, raw) as unknown as AlertProjectInit,
    );
  }
}

/**
 * Constructor input for {@link CustomAlert} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface CustomAlertInit {
  /** Alert ID. */
  readonly id: number;
  /** Alert name. */
  readonly name: string;
  /** Linked saved report. */
  readonly bookmark?:
    AlertBookmark | Readonly<Record<string, unknown>> | null | undefined;
  /** Trigger condition (opaque JSON). */
  readonly condition?: Readonly<Record<string, unknown>> | undefined;
  /** Check frequency in seconds. */
  readonly frequency?: number | undefined;
  /** Whether alert is paused. */
  readonly paused?: boolean | undefined;
  /** Notification targets. */
  readonly subscriptions?:
    ReadonlyArray<Readonly<Record<string, unknown>>> | undefined;
  /** Notification window config. */
  readonly notification_windows?:
    Readonly<Record<string, unknown>> | null | undefined;
  /** Creator user info. */
  readonly creator?:
    AlertCreator | Readonly<Record<string, unknown>> | null | undefined;
  /** Workspace metadata. */
  readonly workspace?:
    AlertWorkspace | Readonly<Record<string, unknown>> | null | undefined;
  /** Project metadata. */
  readonly project?:
    AlertProject | Readonly<Record<string, unknown>> | null | undefined;
  /** Creation timestamp. */
  readonly created?: string | undefined;
  /** Last modified timestamp. */
  readonly modified?: string | undefined;
  /** Last check timestamp. */
  readonly last_checked?: string | null | undefined;
  /** Last trigger timestamp. */
  readonly last_fired?: string | null | undefined;
  /** Whether alert is valid. */
  readonly valid?: boolean | undefined;
  /** Latest evaluation results. */
  readonly results?: Readonly<Record<string, unknown>> | null | undefined;
}

/**
 * Response model for a custom alert.
 *
 * Mirror of Python `mixpanel_headless.types.CustomAlert` (types.py:4251;
 * model_config: frozen=True, extra='allow').
 */
export class CustomAlert extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "CustomAlert";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "id", required: true, kind: "int" },
    { name: "name", required: true, kind: "str" },
    { name: "bookmark", nullable: true, nested: () => AlertBookmark },
    { name: "condition", default: () => ({}) },
    { name: "frequency", default: () => 0, kind: "int" },
    { name: "paused", default: () => false, kind: "bool" },
    { name: "subscriptions", default: () => [] },
    { name: "notification_windows", nullable: true },
    { name: "creator", nullable: true, nested: () => AlertCreator },
    { name: "workspace", nullable: true, nested: () => AlertWorkspace },
    { name: "project", nullable: true, nested: () => AlertProject },
    { name: "created", default: () => "", kind: "str" },
    { name: "modified", default: () => "", kind: "str" },
    { name: "last_checked", kind: "str", nullable: true },
    { name: "last_fired", kind: "str", nullable: true },
    { name: "valid", default: () => true, kind: "bool" },
    { name: "results", nullable: true },
  ];

  /** Alert ID. */
  declare readonly id: number;
  /** Alert name. */
  declare readonly name: string;
  /** Linked saved report. */
  declare readonly bookmark: AlertBookmark | null;
  /** Trigger condition (opaque JSON). */
  declare readonly condition: Readonly<Record<string, unknown>>;
  /** Check frequency in seconds. */
  declare readonly frequency: number;
  /** Whether alert is paused. */
  declare readonly paused: boolean;
  /** Notification targets. */
  declare readonly subscriptions: ReadonlyArray<
    Readonly<Record<string, unknown>>
  >;
  /** Notification window config. */
  declare readonly notification_windows: Readonly<
    Record<string, unknown>
  > | null;
  /** Creator user info. */
  declare readonly creator: AlertCreator | null;
  /** Workspace metadata. */
  declare readonly workspace: AlertWorkspace | null;
  /** Project metadata. */
  declare readonly project: AlertProject | null;
  /** Creation timestamp. */
  declare readonly created: string;
  /** Last modified timestamp. */
  declare readonly modified: string;
  /** Last check timestamp. */
  declare readonly last_checked: string | null;
  /** Last trigger timestamp. */
  declare readonly last_fired: string | null;
  /** Whether alert is valid. */
  declare readonly valid: boolean;
  /** Latest evaluation results. */
  declare readonly results: Readonly<Record<string, unknown>> | null;

  /**
   * Construct a validated CustomAlert (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: CustomAlertInit) {
    super(CustomAlert, fields as unknown as Readonly<Record<string, unknown>>);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): CustomAlert {
    return new CustomAlert(
      prepareInit(CustomAlert, raw) as unknown as CustomAlertInit,
    );
  }
}

/**
 * Constructor input for {@link CreateAlertParams} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface CreateAlertParamsInit {
  /** ID of linked bookmark. */
  readonly bookmark_id: number;
  /** Alert name (max 50 characters). */
  readonly name: string;
  /** Trigger condition JSON. */
  readonly condition: Readonly<Record<string, unknown>>;
  /** Check frequency in seconds. See ``AlertFrequencyPreset`` for common values. */
  readonly frequency: number;
  /** Start paused or active. */
  readonly paused: boolean;
  /** Notification targets. */
  readonly subscriptions: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /** Notification window config. */
  readonly notification_windows?:
    Readonly<Record<string, unknown>> | null | undefined;
}

/**
 * Parameters for creating a new alert.
 *
 * Mirror of Python `mixpanel_headless.types.CreateAlertParams` (types.py:4333;
 * model_config: extra='ignore').
 */
export class CreateAlertParams extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "CreateAlertParams";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "bookmark_id", required: true, kind: "int" },
    {
      name: "name",
      required: true,
      kind: "str",
      // Python: Field(max_length=50) — codepoint-counted (R11.6).
      check: (value: unknown, path: string): void => {
        if (typeof value === "string" && codepointLength(value) > 50) {
          modelFail(path, "max_length 50");
        }
      },
    },
    { name: "condition", required: true },
    { name: "frequency", required: true, kind: "int" },
    { name: "paused", required: true, kind: "bool" },
    { name: "subscriptions", required: true },
    { name: "notification_windows", nullable: true },
  ];

  /** ID of linked bookmark. */
  declare readonly bookmark_id: number;
  /** Alert name (max 50 characters). */
  declare readonly name: string;
  /** Trigger condition JSON. */
  declare readonly condition: Readonly<Record<string, unknown>>;
  /** Check frequency in seconds. See ``AlertFrequencyPreset`` for common values. */
  declare readonly frequency: number;
  /** Start paused or active. */
  declare readonly paused: boolean;
  /** Notification targets. */
  declare readonly subscriptions: ReadonlyArray<
    Readonly<Record<string, unknown>>
  >;
  /** Notification window config. */
  declare readonly notification_windows: Readonly<
    Record<string, unknown>
  > | null;

  /**
   * Construct a validated CreateAlertParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: CreateAlertParamsInit) {
    super(
      CreateAlertParams,
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
  static fromDict(raw: unknown): CreateAlertParams {
    return new CreateAlertParams(
      prepareInit(CreateAlertParams, raw) as unknown as CreateAlertParamsInit,
    );
  }
}

/**
 * Constructor input for {@link UpdateAlertParams} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface UpdateAlertParamsInit {
  /** New name. */
  readonly name?: string | null | undefined;
  /** New bookmark ID. */
  readonly bookmark_id?: number | null | undefined;
  /** New condition. */
  readonly condition?: Readonly<Record<string, unknown>> | null | undefined;
  /** New frequency. */
  readonly frequency?: number | null | undefined;
  /** New pause state. */
  readonly paused?: boolean | null | undefined;
  /** New subscriptions. */
  readonly subscriptions?:
    ReadonlyArray<Readonly<Record<string, unknown>>> | null | undefined;
  /** New notification windows. */
  readonly notification_windows?:
    Readonly<Record<string, unknown>> | null | undefined;
}

/**
 * Parameters for updating an alert (PATCH semantics).
 *
 * Mirror of Python `mixpanel_headless.types.UpdateAlertParams` (types.py:4385;
 * model_config: extra='ignore').
 */
export class UpdateAlertParams extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "UpdateAlertParams";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "name", kind: "str", nullable: true },
    { name: "bookmark_id", kind: "int", nullable: true },
    { name: "condition", nullable: true },
    { name: "frequency", kind: "int", nullable: true },
    { name: "paused", kind: "bool", nullable: true },
    { name: "subscriptions", nullable: true },
    { name: "notification_windows", nullable: true },
  ];

  /** New name. */
  declare readonly name: string | null;
  /** New bookmark ID. */
  declare readonly bookmark_id: number | null;
  /** New condition. */
  declare readonly condition: Readonly<Record<string, unknown>> | null;
  /** New frequency. */
  declare readonly frequency: number | null;
  /** New pause state. */
  declare readonly paused: boolean | null;
  /** New subscriptions. */
  declare readonly subscriptions: ReadonlyArray<
    Readonly<Record<string, unknown>>
  > | null;
  /** New notification windows. */
  declare readonly notification_windows: Readonly<
    Record<string, unknown>
  > | null;

  /**
   * Construct a validated UpdateAlertParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: UpdateAlertParamsInit) {
    super(
      UpdateAlertParams,
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
  static fromDict(raw: unknown): UpdateAlertParams {
    return new UpdateAlertParams(
      prepareInit(UpdateAlertParams, raw) as unknown as UpdateAlertParamsInit,
    );
  }
}

/**
 * Constructor input for {@link AlertCount} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface AlertCountInit {
  /** Current alert count. */
  readonly anomaly_alerts_count: number;
  /** Account limit. */
  readonly alert_limit: number;
  /** Whether below limit. */
  readonly is_below_limit: boolean;
}

/**
 * Response model for alert count and limits.
 *
 * Mirror of Python `mixpanel_headless.types.AlertCount` (types.py:4425;
 * model_config: frozen=True, extra='allow').
 */
export class AlertCount extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "AlertCount";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "anomaly_alerts_count", required: true, kind: "int" },
    { name: "alert_limit", required: true, kind: "int" },
    { name: "is_below_limit", required: true, kind: "bool" },
  ];

  /** Current alert count. */
  declare readonly anomaly_alerts_count: number;
  /** Account limit. */
  declare readonly alert_limit: number;
  /** Whether below limit. */
  declare readonly is_below_limit: boolean;

  /**
   * Construct a validated AlertCount (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: AlertCountInit) {
    super(AlertCount, fields as unknown as Readonly<Record<string, unknown>>);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): AlertCount {
    return new AlertCount(
      prepareInit(AlertCount, raw) as unknown as AlertCountInit,
    );
  }
}

/**
 * Constructor input for {@link AlertHistoryPagination} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface AlertHistoryPaginationInit {
  /** Next page cursor. */
  readonly next_cursor?: string | null | undefined;
  /** Previous page cursor. */
  readonly previous_cursor?: string | null | undefined;
  /** Page size. */
  readonly page_size?: number | undefined;
}

/**
 * Pagination metadata for alert history.
 *
 * Mirror of Python `mixpanel_headless.types.AlertHistoryPagination` (types.py:4453;
 * model_config: frozen=True, extra='allow').
 */
export class AlertHistoryPagination extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "AlertHistoryPagination";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "next_cursor", kind: "str", nullable: true },
    { name: "previous_cursor", kind: "str", nullable: true },
    { name: "page_size", default: () => 20, kind: "int" },
  ];

  /** Next page cursor. */
  declare readonly next_cursor: string | null;
  /** Previous page cursor. */
  declare readonly previous_cursor: string | null;
  /** Page size. */
  declare readonly page_size: number;

  /**
   * Construct a validated AlertHistoryPagination (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: AlertHistoryPaginationInit) {
    super(
      AlertHistoryPagination,
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
  static fromDict(raw: unknown): AlertHistoryPagination {
    return new AlertHistoryPagination(
      prepareInit(
        AlertHistoryPagination,
        raw,
      ) as unknown as AlertHistoryPaginationInit,
    );
  }
}

/**
 * Constructor input for {@link AlertHistoryResponse} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface AlertHistoryResponseInit {
  /** History entries. */
  readonly results?:
    ReadonlyArray<Readonly<Record<string, unknown>>> | undefined;
  /** Pagination metadata. */
  readonly pagination?:
    | AlertHistoryPagination
    | Readonly<Record<string, unknown>>
    | null
    | undefined;
}

/**
 * Response model for alert history (paginated).
 *
 * Mirror of Python `mixpanel_headless.types.AlertHistoryResponse` (types.py:4479;
 * model_config: frozen=True, extra='allow').
 */
export class AlertHistoryResponse extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "AlertHistoryResponse";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "results", default: () => [] },
    {
      name: "pagination",
      nullable: true,
      nested: () => AlertHistoryPagination,
    },
  ];

  /** History entries. */
  declare readonly results: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /** Pagination metadata. */
  declare readonly pagination: AlertHistoryPagination | null;

  /**
   * Construct a validated AlertHistoryResponse (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: AlertHistoryResponseInit) {
    super(
      AlertHistoryResponse,
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
  static fromDict(raw: unknown): AlertHistoryResponse {
    return new AlertHistoryResponse(
      prepareInit(
        AlertHistoryResponse,
        raw,
      ) as unknown as AlertHistoryResponseInit,
    );
  }
}

/**
 * Constructor input for {@link AlertScreenshotResponse} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface AlertScreenshotResponseInit {
  /** Signed GCS URL for screenshot. */
  readonly signed_url: string;
}

/**
 * Response model for alert screenshot URL.
 *
 * Mirror of Python `mixpanel_headless.types.AlertScreenshotResponse` (types.py:4503;
 * model_config: frozen=True, extra='allow').
 */
export class AlertScreenshotResponse extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "AlertScreenshotResponse";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "signed_url", required: true, kind: "str" },
  ];

  /** Signed GCS URL for screenshot. */
  declare readonly signed_url: string;

  /**
   * Construct a validated AlertScreenshotResponse (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: AlertScreenshotResponseInit) {
    super(
      AlertScreenshotResponse,
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
  static fromDict(raw: unknown): AlertScreenshotResponse {
    return new AlertScreenshotResponse(
      prepareInit(
        AlertScreenshotResponse,
        raw,
      ) as unknown as AlertScreenshotResponseInit,
    );
  }
}

/**
 * Constructor input for {@link AlertValidation} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface AlertValidationInit {
  /** Alert ID. */
  readonly alert_id: number;
  /** Alert name. */
  readonly alert_name: string;
  /** Whether valid. */
  readonly valid: boolean;
  /** Reason if invalid. */
  readonly reason?: string | null | undefined;
}

/**
 * Per-alert validation result.
 *
 * Mirror of Python `mixpanel_headless.types.AlertValidation` (types.py:4522;
 * model_config: frozen=True, extra='allow').
 */
export class AlertValidation extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "AlertValidation";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "alert_id", required: true, kind: "int" },
    { name: "alert_name", required: true, kind: "str" },
    { name: "valid", required: true, kind: "bool" },
    { name: "reason", kind: "str", nullable: true },
  ];

  /** Alert ID. */
  declare readonly alert_id: number;
  /** Alert name. */
  declare readonly alert_name: string;
  /** Whether valid. */
  declare readonly valid: boolean;
  /** Reason if invalid. */
  declare readonly reason: string | null;

  /**
   * Construct a validated AlertValidation (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: AlertValidationInit) {
    super(
      AlertValidation,
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
  static fromDict(raw: unknown): AlertValidation {
    return new AlertValidation(
      prepareInit(AlertValidation, raw) as unknown as AlertValidationInit,
    );
  }
}

/**
 * Constructor input for {@link ValidateAlertsForBookmarkParams} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface ValidateAlertsForBookmarkParamsInit {
  /** Alert IDs to validate (must not be empty). */
  readonly alert_ids: readonly number[];
  /** Bookmark type to validate against. */
  readonly bookmark_type: "insights" | "funnels";
  /** Bookmark params JSON. */
  readonly bookmark_params: Readonly<Record<string, unknown>>;
}

/**
 * Parameters for validating alerts against a bookmark.
 *
 * Mirror of Python `mixpanel_headless.types.ValidateAlertsForBookmarkParams` (types.py:4552;
 * model_config: extra='ignore').
 */
export class ValidateAlertsForBookmarkParams extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "ValidateAlertsForBookmarkParams";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    {
      name: "alert_ids",
      required: true,
      check: (value: unknown, path: string): void => {
        if (typeof value === "string" && codepointLength(value) < 1)
          modelFail(path, "min_length 1");
        if (Array.isArray(value) && value.length === 0)
          modelFail(path, "min_length 1");
      },
    },
    {
      name: "bookmark_type",
      required: true,
      check: oneOf(["insights", "funnels"]),
    },
    { name: "bookmark_params", required: true },
  ];

  /** Alert IDs to validate (must not be empty). */
  declare readonly alert_ids: readonly number[];
  /** Bookmark type to validate against. */
  declare readonly bookmark_type: "insights" | "funnels";
  /** Bookmark params JSON. */
  declare readonly bookmark_params: Readonly<Record<string, unknown>>;

  /**
   * Construct a validated ValidateAlertsForBookmarkParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: ValidateAlertsForBookmarkParamsInit) {
    super(
      ValidateAlertsForBookmarkParams,
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
  static fromDict(raw: unknown): ValidateAlertsForBookmarkParams {
    return new ValidateAlertsForBookmarkParams(
      prepareInit(
        ValidateAlertsForBookmarkParams,
        raw,
      ) as unknown as ValidateAlertsForBookmarkParamsInit,
    );
  }
}

/**
 * Constructor input for {@link ValidateAlertsForBookmarkResponse} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface ValidateAlertsForBookmarkResponseInit {
  /** Per-alert validation results. */
  readonly alert_validations?:
    | ReadonlyArray<AlertValidation | Readonly<Record<string, unknown>>>
    | undefined;
  /** Count of invalid alerts. */
  readonly invalid_count?: number | undefined;
}

/**
 * Response model for alert-bookmark validation.
 *
 * Mirror of Python `mixpanel_headless.types.ValidateAlertsForBookmarkResponse` (types.py:4580;
 * model_config: frozen=True, extra='allow').
 */
export class ValidateAlertsForBookmarkResponse extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "ValidateAlertsForBookmarkResponse";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    {
      name: "alert_validations",
      default: () => [],
      nested: () => AlertValidation,
      container: "list",
    },
    { name: "invalid_count", default: () => 0, kind: "int" },
  ];

  /** Per-alert validation results. */
  declare readonly alert_validations: readonly AlertValidation[];
  /** Count of invalid alerts. */
  declare readonly invalid_count: number;

  /**
   * Construct a validated ValidateAlertsForBookmarkResponse (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: ValidateAlertsForBookmarkResponseInit) {
    super(
      ValidateAlertsForBookmarkResponse,
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
  static fromDict(raw: unknown): ValidateAlertsForBookmarkResponse {
    return new ValidateAlertsForBookmarkResponse(
      prepareInit(
        ValidateAlertsForBookmarkResponse,
        raw,
      ) as unknown as ValidateAlertsForBookmarkResponseInit,
    );
  }
}
