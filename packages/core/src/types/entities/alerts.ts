/**
 * Custom alert family (E4: derived from the Python models + wire vectors; the vendored alerts/custom contract is ADVISORY).
 *
 * Hand-written ports of the Pydantic models in Python's `types.py`:
 * the Python classes are the source of record and the vendored
 * schema4api types are a compile-time cross-check only. Field names
 * keep their Python spelling; required-ness, defaults, nullability and
 * lax coercion follow each class's `fieldSpecs` (see `model-base.ts`).
 *
 * @see mixpanel_headless.types
 */

import { cpLength } from "../../compat/codepoint.js";
import {
  type EntityFieldSpecs,
  EntityModel,
  modelFail,
  oneOf,
  prepareInit,
} from "./model-base.js";

/**
 * Constructor input for {@link AlertBookmark} — absent keys take the Python
 * defaults; `undefined` counts as absent.
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
 * @remarks Pydantic `extra='allow'`: unknown keys are kept on `__extras`.
 * @example
 * ```ts
 * const alertBookmark = AlertBookmark.fromDict({
 *   id: 42,
 *   name: "Signup funnel",
 * });
 * alertBookmark.id; // 42
 * ```
 * @see mixpanel_headless.types.AlertBookmark
 */
export class AlertBookmark extends EntityModel<AlertBookmarkInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "AlertBookmark";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<AlertBookmarkInit> = [
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
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: AlertBookmarkInit) {
    super(AlertBookmark, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): AlertBookmark {
    return new AlertBookmark(prepareInit(AlertBookmark, raw));
  }
}

/**
 * Constructor input for {@link AlertCreator} — absent keys take the Python
 * defaults; `undefined` counts as absent.
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
 * @remarks Pydantic `extra='allow'`: unknown keys are kept on `__extras`.
 * @example
 * ```ts
 * const alertCreator = AlertCreator.fromDict({ id: 42, first_name: "Ana" });
 * alertCreator.id; // 42
 * ```
 * @see mixpanel_headless.types.AlertCreator
 */
export class AlertCreator extends EntityModel<AlertCreatorInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "AlertCreator";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<AlertCreatorInit> = [
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
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: AlertCreatorInit) {
    super(AlertCreator, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): AlertCreator {
    return new AlertCreator(prepareInit(AlertCreator, raw));
  }
}

/**
 * Constructor input for {@link AlertWorkspace} — absent keys take the Python
 * defaults; `undefined` counts as absent.
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
 * @remarks Pydantic `extra='allow'`: unknown keys are kept on `__extras`.
 * @example
 * ```ts
 * const alertWorkspace = AlertWorkspace.fromDict({ id: 42, name: "Growth" });
 * alertWorkspace.id; // 42
 * ```
 * @see mixpanel_headless.types.AlertWorkspace
 */
export class AlertWorkspace extends EntityModel<AlertWorkspaceInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "AlertWorkspace";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<AlertWorkspaceInit> = [
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
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: AlertWorkspaceInit) {
    super(AlertWorkspace, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): AlertWorkspace {
    return new AlertWorkspace(prepareInit(AlertWorkspace, raw));
  }
}

/**
 * Constructor input for {@link AlertProject} — absent keys take the Python
 * defaults; `undefined` counts as absent.
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
 * @remarks Pydantic `extra='allow'`: unknown keys are kept on `__extras`.
 * @example
 * ```ts
 * const alertProject = AlertProject.fromDict({ id: 42, name: "Web app" });
 * alertProject.id; // 42
 * ```
 * @see mixpanel_headless.types.AlertProject
 */
export class AlertProject extends EntityModel<AlertProjectInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "AlertProject";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<AlertProjectInit> = [
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
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: AlertProjectInit) {
    super(AlertProject, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): AlertProject {
    return new AlertProject(prepareInit(AlertProject, raw));
  }
}

/**
 * Constructor input for {@link CustomAlert} — absent keys take the Python
 * defaults; `undefined` counts as absent.
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
 * @remarks Pydantic `extra='allow'`: unknown keys are kept on `__extras`.
 * @example
 * ```ts
 * const customAlert = CustomAlert.fromDict({
 *   id: 42,
 *   name: "Signups dropped",
 *   frequency: 60,
 * });
 * customAlert.id; // 42
 * ```
 * @see mixpanel_headless.types.CustomAlert
 */
export class CustomAlert extends EntityModel<CustomAlertInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "CustomAlert";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<CustomAlertInit> = [
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
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: CustomAlertInit) {
    super(CustomAlert, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): CustomAlert {
    return new CustomAlert(prepareInit(CustomAlert, raw));
  }
}

/**
 * Constructor input for {@link CreateAlertParams} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface CreateAlertParamsInit {
  /** ID of linked bookmark. */
  readonly bookmark_id: number;
  /** Alert name (max 50 characters). */
  readonly name: string;
  /** Trigger condition JSON. */
  readonly condition: Readonly<Record<string, unknown>>;
  /** Check frequency in seconds. See `AlertFrequencyPreset` for common values. */
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
 * @remarks Pydantic `extra='ignore'`: unknown keys are dropped.
 * @example
 * ```ts
 * const params = new CreateAlertParams({
 *   bookmark_id: 7,
 *   name: "Signups dropped",
 *   condition: { operator: "less_than", threshold: 100 },
 *   frequency: 60,
 *   paused: false,
 *   subscriptions: [],
 * });
 * params.bookmark_id; // 7
 * ```
 * @see mixpanel_headless.types.CreateAlertParams
 */
export class CreateAlertParams extends EntityModel<CreateAlertParamsInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "CreateAlertParams";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<CreateAlertParamsInit> = [
    { name: "bookmark_id", required: true, kind: "int" },
    {
      name: "name",
      required: true,
      kind: "str",
      // Python: Field(max_length=50) — codepoint-counted.
      check: (value: unknown, path: string): void => {
        if (typeof value === "string" && cpLength(value) > 50) {
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
  /** Check frequency in seconds. See `AlertFrequencyPreset` for common values. */
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
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: CreateAlertParamsInit) {
    super(CreateAlertParams, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): CreateAlertParams {
    return new CreateAlertParams(prepareInit(CreateAlertParams, raw));
  }
}

/**
 * Constructor input for {@link UpdateAlertParams} — absent keys take the Python
 * defaults; `undefined` counts as absent.
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
 * @remarks Pydantic `extra='ignore'`: unknown keys are dropped.
 * @example
 * ```ts
 * const params = new UpdateAlertParams({ name: "Example" });
 * params.name; // "Example"
 * ```
 * @see mixpanel_headless.types.UpdateAlertParams
 */
export class UpdateAlertParams extends EntityModel<UpdateAlertParamsInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "UpdateAlertParams";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<UpdateAlertParamsInit> = [
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
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: UpdateAlertParamsInit) {
    super(UpdateAlertParams, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): UpdateAlertParams {
    return new UpdateAlertParams(prepareInit(UpdateAlertParams, raw));
  }
}

/**
 * Constructor input for {@link AlertCount} — absent keys take the Python
 * defaults; `undefined` counts as absent.
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
 * @remarks Pydantic `extra='allow'`: unknown keys are kept on `__extras`.
 * @example
 * ```ts
 * const alertCount = AlertCount.fromDict({
 *   anomaly_alerts_count: 3,
 *   alert_limit: 25,
 *   is_below_limit: true,
 * });
 * alertCount.anomaly_alerts_count; // 3
 * ```
 * @see mixpanel_headless.types.AlertCount
 */
export class AlertCount extends EntityModel<AlertCountInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "AlertCount";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<AlertCountInit> = [
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
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: AlertCountInit) {
    super(AlertCount, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): AlertCount {
    return new AlertCount(prepareInit(AlertCount, raw));
  }
}

/**
 * Constructor input for {@link AlertHistoryPagination} — absent keys take the Python
 * defaults; `undefined` counts as absent.
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
 * @remarks Pydantic `extra='allow'`: unknown keys are kept on `__extras`.
 * @example
 * ```ts
 * const alertHistoryPagination = AlertHistoryPagination.fromDict({
 *   next_cursor: "example",
 * });
 * alertHistoryPagination.next_cursor; // "example"
 * ```
 * @see mixpanel_headless.types.AlertHistoryPagination
 */
export class AlertHistoryPagination extends EntityModel<AlertHistoryPaginationInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "AlertHistoryPagination";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<AlertHistoryPaginationInit> = [
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
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: AlertHistoryPaginationInit) {
    super(AlertHistoryPagination, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): AlertHistoryPagination {
    return new AlertHistoryPagination(prepareInit(AlertHistoryPagination, raw));
  }
}

/**
 * Constructor input for {@link AlertHistoryResponse} — absent keys take the Python
 * defaults; `undefined` counts as absent.
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
 * @remarks Pydantic `extra='allow'`: unknown keys are kept on `__extras`.
 * @example
 * ```ts
 * const alertHistoryResponse = AlertHistoryResponse.fromDict({ results: [] });
 * alertHistoryResponse.results; // []
 * ```
 * @see mixpanel_headless.types.AlertHistoryResponse
 */
export class AlertHistoryResponse extends EntityModel<AlertHistoryResponseInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "AlertHistoryResponse";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<AlertHistoryResponseInit> = [
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
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: AlertHistoryResponseInit) {
    super(AlertHistoryResponse, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): AlertHistoryResponse {
    return new AlertHistoryResponse(prepareInit(AlertHistoryResponse, raw));
  }
}

/**
 * Constructor input for {@link AlertScreenshotResponse} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface AlertScreenshotResponseInit {
  /** Signed GCS URL for screenshot. */
  readonly signed_url: string;
}

/**
 * Response model for alert screenshot URL.
 *
 * @remarks Pydantic `extra='allow'`: unknown keys are kept on `__extras`.
 * @example
 * ```ts
 * const alertScreenshotResponse = AlertScreenshotResponse.fromDict({
 *   signed_url: "example",
 * });
 * alertScreenshotResponse.signed_url; // "example"
 * ```
 * @see mixpanel_headless.types.AlertScreenshotResponse
 */
export class AlertScreenshotResponse extends EntityModel<AlertScreenshotResponseInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "AlertScreenshotResponse";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<AlertScreenshotResponseInit> = [
    { name: "signed_url", required: true, kind: "str" },
  ];

  /** Signed GCS URL for screenshot. */
  declare readonly signed_url: string;

  /**
   * Construct a validated AlertScreenshotResponse (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: AlertScreenshotResponseInit) {
    super(AlertScreenshotResponse, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): AlertScreenshotResponse {
    return new AlertScreenshotResponse(
      prepareInit(AlertScreenshotResponse, raw),
    );
  }
}

/**
 * Constructor input for {@link AlertValidation} — absent keys take the Python
 * defaults; `undefined` counts as absent.
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
 * @remarks Pydantic `extra='allow'`: unknown keys are kept on `__extras`.
 * @example
 * ```ts
 * const alertValidation = AlertValidation.fromDict({
 *   alert_id: 1,
 *   alert_name: "example",
 *   valid: true,
 *   reason: "example",
 * });
 * alertValidation.alert_id; // 1
 * ```
 * @see mixpanel_headless.types.AlertValidation
 */
export class AlertValidation extends EntityModel<AlertValidationInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "AlertValidation";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<AlertValidationInit> = [
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
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: AlertValidationInit) {
    super(AlertValidation, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): AlertValidation {
    return new AlertValidation(prepareInit(AlertValidation, raw));
  }
}

/**
 * Constructor input for {@link ValidateAlertsForBookmarkParams} — absent keys take the Python
 * defaults; `undefined` counts as absent.
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
 * @remarks Pydantic `extra='ignore'`: unknown keys are dropped.
 * @example
 * ```ts
 * const params = new ValidateAlertsForBookmarkParams({
 *   alert_ids: [7, 8],
 *   bookmark_type: "insights",
 *   bookmark_params: { sections: {} },
 * });
 * params.alert_ids; // [7, 8]
 * ```
 * @see mixpanel_headless.types.ValidateAlertsForBookmarkParams
 */
export class ValidateAlertsForBookmarkParams extends EntityModel<ValidateAlertsForBookmarkParamsInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "ValidateAlertsForBookmarkParams";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<ValidateAlertsForBookmarkParamsInit> =
    [
      {
        name: "alert_ids",
        required: true,
        check: (value: unknown, path: string): void => {
          if (typeof value === "string" && cpLength(value) < 1)
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
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: ValidateAlertsForBookmarkParamsInit) {
    super(ValidateAlertsForBookmarkParams, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): ValidateAlertsForBookmarkParams {
    return new ValidateAlertsForBookmarkParams(
      prepareInit(ValidateAlertsForBookmarkParams, raw),
    );
  }
}

/**
 * Constructor input for {@link ValidateAlertsForBookmarkResponse} — absent keys take the Python
 * defaults; `undefined` counts as absent.
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
 * @remarks Pydantic `extra='allow'`: unknown keys are kept on `__extras`.
 * @example
 * ```ts
 * const validateAlertsForBookmarkResponse = ValidateAlertsForBookmarkResponse.fromDict({
 *   alert_validations: [{ alert_id: 1, alert_name: "example", valid: true }],
 * });
 * validateAlertsForBookmarkResponse.alert_validations; // [{ alert_id: 1, … }]
 * ```
 * @see mixpanel_headless.types.ValidateAlertsForBookmarkResponse
 */
export class ValidateAlertsForBookmarkResponse extends EntityModel<ValidateAlertsForBookmarkResponseInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "ValidateAlertsForBookmarkResponse";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<ValidateAlertsForBookmarkResponseInit> =
    [
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
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: ValidateAlertsForBookmarkResponseInit) {
    super(ValidateAlertsForBookmarkResponse, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): ValidateAlertsForBookmarkResponse {
    return new ValidateAlertsForBookmarkResponse(
      prepareInit(ValidateAlertsForBookmarkResponse, raw),
    );
  }
}
