/**
 * Project webhook family + webhook CRUD/test params.
 *
 * Hand-written ports of the Pydantic models in Python's `types.py`:
 * the Python classes are the source of record and the vendored
 * schema4api types are a compile-time cross-check only. Field names
 * keep their Python spelling; required-ness, defaults, nullability and
 * lax coercion follow each class's `fieldSpecs` (see `model-base.ts`).
 *
 * @see mixpanel_headless.types
 */

import type { WebhookAuthType } from "../enums.js";
import {
  type EntityFieldSpecs,
  EntityModel,
  oneOf,
  prepareInit,
} from "./model-base.js";

/**
 * Constructor input for {@link ProjectWebhook} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface ProjectWebhookInit {
  /** Webhook ID (UUID string). */
  readonly id: string;
  /** Webhook name. */
  readonly name: string;
  /** Webhook URL. */
  readonly url: string;
  /** Whether enabled. */
  readonly is_enabled: boolean;
  /** Authentication type. */
  readonly auth_type?: WebhookAuthType | null | undefined;
  /** Creation timestamp. */
  readonly created?: string | null | undefined;
  /** Last modified timestamp. */
  readonly modified?: string | null | undefined;
  /** Creator user ID. */
  readonly creator_id?: number | null | undefined;
  /** Creator name. */
  readonly creator_name?: string | null | undefined;
}

/**
 * Response model for a project webhook.
 *
 * @remarks Pydantic `extra='allow'`: unknown keys are kept on `__extras`.
 * @example
 * ```ts
 * const projectWebhook = ProjectWebhook.fromDict({
 *   id: "f1a2b3c4",
 *   name: "Slack alerts",
 *   url: "https://example.com/hooks/mixpanel",
 *   is_enabled: true,
 * });
 * projectWebhook.id; // "f1a2b3c4"
 * ```
 * @see mixpanel_headless.types.ProjectWebhook
 */
export class ProjectWebhook extends EntityModel<ProjectWebhookInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "ProjectWebhook";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<ProjectWebhookInit> = [
    { name: "id", required: true, kind: "str" },
    { name: "name", required: true, kind: "str" },
    { name: "url", required: true, kind: "str" },
    { name: "is_enabled", required: true, kind: "bool" },
    { name: "auth_type", nullable: true, check: oneOf(["basic"]) },
    { name: "created", kind: "str", nullable: true },
    { name: "modified", kind: "str", nullable: true },
    { name: "creator_id", kind: "int", nullable: true },
    { name: "creator_name", kind: "str", nullable: true },
  ];

  /** Webhook ID (UUID string). */
  declare readonly id: string;
  /** Webhook name. */
  declare readonly name: string;
  /** Webhook URL. */
  declare readonly url: string;
  /** Whether enabled. */
  declare readonly is_enabled: boolean;
  /** Authentication type. */
  declare readonly auth_type: WebhookAuthType | null;
  /** Creation timestamp. */
  declare readonly created: string | null;
  /** Last modified timestamp. */
  declare readonly modified: string | null;
  /** Creator user ID. */
  declare readonly creator_id: number | null;
  /** Creator name. */
  declare readonly creator_name: string | null;

  /**
   * Construct a validated ProjectWebhook (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: ProjectWebhookInit) {
    super(ProjectWebhook, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): ProjectWebhook {
    return new ProjectWebhook(prepareInit(ProjectWebhook, raw));
  }
}

/**
 * Constructor input for {@link CreateWebhookParams} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface CreateWebhookParamsInit {
  /** Webhook name. */
  readonly name: string;
  /** Webhook URL. */
  readonly url: string;
  /** Auth type (e.g. WebhookAuthType.BASIC). */
  readonly auth_type?: WebhookAuthType | null | undefined;
  /** Basic auth username. */
  readonly username?: string | null | undefined;
  /** Basic auth password. */
  readonly password?: string | null | undefined;
}

/**
 * Parameters for creating a webhook.
 *
 * @remarks Pydantic `extra='ignore'`: unknown keys are dropped.
 * @example
 * ```ts
 * const params = new CreateWebhookParams({
 *   name: "Slack alerts",
 *   url: "https://example.com/hooks/mixpanel",
 *   username: "example",
 * });
 * params.name; // "Slack alerts"
 * ```
 * @see mixpanel_headless.types.CreateWebhookParams
 */
export class CreateWebhookParams extends EntityModel<CreateWebhookParamsInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "CreateWebhookParams";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<CreateWebhookParamsInit> = [
    { name: "name", required: true, kind: "str" },
    { name: "url", required: true, kind: "str" },
    { name: "auth_type", nullable: true, check: oneOf(["basic"]) },
    { name: "username", kind: "str", nullable: true },
    { name: "password", kind: "str", nullable: true },
  ];

  /** Webhook name. */
  declare readonly name: string;
  /** Webhook URL. */
  declare readonly url: string;
  /** Auth type (e.g. WebhookAuthType.BASIC). */
  declare readonly auth_type: WebhookAuthType | null;
  /** Basic auth username. */
  declare readonly username: string | null;
  /** Basic auth password. */
  declare readonly password: string | null;

  /**
   * Construct a validated CreateWebhookParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: CreateWebhookParamsInit) {
    super(CreateWebhookParams, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): CreateWebhookParams {
    return new CreateWebhookParams(prepareInit(CreateWebhookParams, raw));
  }
}

/**
 * Constructor input for {@link UpdateWebhookParams} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface UpdateWebhookParamsInit {
  /** New name. */
  readonly name?: string | null | undefined;
  /** New URL. */
  readonly url?: string | null | undefined;
  /** New auth type. */
  readonly auth_type?: WebhookAuthType | null | undefined;
  /** New username. */
  readonly username?: string | null | undefined;
  /** New password. */
  readonly password?: string | null | undefined;
  /** New enabled state. */
  readonly is_enabled?: boolean | null | undefined;
}

/**
 * Parameters for updating a webhook (PATCH semantics).
 *
 * @remarks Pydantic `extra='ignore'`: unknown keys are dropped.
 * @example
 * ```ts
 * const params = new UpdateWebhookParams({ name: "Example" });
 * params.name; // "Example"
 * ```
 * @see mixpanel_headless.types.UpdateWebhookParams
 */
export class UpdateWebhookParams extends EntityModel<UpdateWebhookParamsInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "UpdateWebhookParams";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<UpdateWebhookParamsInit> = [
    { name: "name", kind: "str", nullable: true },
    { name: "url", kind: "str", nullable: true },
    { name: "auth_type", nullable: true, check: oneOf(["basic"]) },
    { name: "username", kind: "str", nullable: true },
    { name: "password", kind: "str", nullable: true },
    { name: "is_enabled", kind: "bool", nullable: true },
  ];

  /** New name. */
  declare readonly name: string | null;
  /** New URL. */
  declare readonly url: string | null;
  /** New auth type. */
  declare readonly auth_type: WebhookAuthType | null;
  /** New username. */
  declare readonly username: string | null;
  /** New password. */
  declare readonly password: string | null;
  /** New enabled state. */
  declare readonly is_enabled: boolean | null;

  /**
   * Construct a validated UpdateWebhookParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: UpdateWebhookParamsInit) {
    super(UpdateWebhookParams, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): UpdateWebhookParams {
    return new UpdateWebhookParams(prepareInit(UpdateWebhookParams, raw));
  }
}

/**
 * Constructor input for {@link WebhookTestParams} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface WebhookTestParamsInit {
  /** URL to test. */
  readonly url: string;
  /** Webhook name. */
  readonly name?: string | null | undefined;
  /** Auth type. */
  readonly auth_type?: WebhookAuthType | null | undefined;
  /** Username for auth. */
  readonly username?: string | null | undefined;
  /** Password for auth. */
  readonly password?: string | null | undefined;
}

/**
 * Parameters for testing webhook connectivity.
 *
 * @remarks Pydantic `extra='ignore'`: unknown keys are dropped.
 * @example
 * ```ts
 * const params = new WebhookTestParams({
 *   url: "https://example.com/hooks/mixpanel",
 *   name: "Example",
 * });
 * params.url; // "https://example.com/hooks/mixpanel"
 * ```
 * @see mixpanel_headless.types.WebhookTestParams
 */
export class WebhookTestParams extends EntityModel<WebhookTestParamsInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "WebhookTestParams";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<WebhookTestParamsInit> = [
    { name: "url", required: true, kind: "str" },
    { name: "name", kind: "str", nullable: true },
    { name: "auth_type", nullable: true, check: oneOf(["basic"]) },
    { name: "username", kind: "str", nullable: true },
    { name: "password", kind: "str", nullable: true },
  ];

  /** URL to test. */
  declare readonly url: string;
  /** Webhook name. */
  declare readonly name: string | null;
  /** Auth type. */
  declare readonly auth_type: WebhookAuthType | null;
  /** Username for auth. */
  declare readonly username: string | null;
  /** Password for auth. */
  declare readonly password: string | null;

  /**
   * Construct a validated WebhookTestParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: WebhookTestParamsInit) {
    super(WebhookTestParams, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): WebhookTestParams {
    return new WebhookTestParams(prepareInit(WebhookTestParams, raw));
  }
}

/**
 * Constructor input for {@link WebhookTestResult} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface WebhookTestResultInit {
  /** Whether test succeeded. */
  readonly success: boolean;
  /** HTTP status code. */
  readonly status_code: number;
  /** Descriptive message. */
  readonly message: string;
}

/**
 * Response model for webhook connectivity test.
 *
 * @remarks Pydantic `extra='allow'`: unknown keys are kept on `__extras`.
 * @example
 * ```ts
 * const webhookTestResult = WebhookTestResult.fromDict({
 *   success: true,
 *   status_code: 200,
 *   message: "OK",
 * });
 * webhookTestResult.success; // true
 * ```
 * @see mixpanel_headless.types.WebhookTestResult
 */
export class WebhookTestResult extends EntityModel<WebhookTestResultInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "WebhookTestResult";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<WebhookTestResultInit> = [
    { name: "success", required: true, kind: "bool" },
    { name: "status_code", required: true, kind: "int" },
    { name: "message", required: true, kind: "str" },
  ];

  /** Whether test succeeded. */
  declare readonly success: boolean;
  /** HTTP status code. */
  declare readonly status_code: number;
  /** Descriptive message. */
  declare readonly message: string;

  /**
   * Construct a validated WebhookTestResult (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: WebhookTestResultInit) {
    super(WebhookTestResult, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): WebhookTestResult {
    return new WebhookTestResult(prepareInit(WebhookTestResult, raw));
  }
}

/**
 * Constructor input for {@link WebhookMutationResult} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface WebhookMutationResultInit {
  /** Webhook ID. */
  readonly id: string;
  /** Webhook name. */
  readonly name: string;
}

/**
 * Response model for webhook create/update (returns id + name only).
 *
 * @remarks Pydantic `extra='allow'`: unknown keys are kept on `__extras`.
 * @example
 * ```ts
 * const webhookMutationResult = WebhookMutationResult.fromDict({
 *   id: "f1a2b3c4",
 *   name: "Slack alerts",
 * });
 * webhookMutationResult.id; // "f1a2b3c4"
 * ```
 * @see mixpanel_headless.types.WebhookMutationResult
 */
export class WebhookMutationResult extends EntityModel<WebhookMutationResultInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "WebhookMutationResult";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<WebhookMutationResultInit> = [
    { name: "id", required: true, kind: "str" },
    { name: "name", required: true, kind: "str" },
  ];

  /** Webhook ID. */
  declare readonly id: string;
  /** Webhook name. */
  declare readonly name: string;

  /**
   * Construct a validated WebhookMutationResult (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: WebhookMutationResultInit) {
    super(WebhookMutationResult, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): WebhookMutationResult {
    return new WebhookMutationResult(prepareInit(WebhookMutationResult, raw));
  }
}
