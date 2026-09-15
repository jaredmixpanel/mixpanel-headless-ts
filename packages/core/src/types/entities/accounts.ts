/**
 * Account-surface models (summaries, test results, targets, OAuth login results).
 *
 * Hand-written ports of the Pydantic entity models (phase2-design C5,
 * packet P2-7): the PYTHON models are the source of record; vendored
 * schema4api types are a compile-time cross-check only. Field names
 * keep their exact Python spelling; optionality follows
 * R3.9/R4.10 via the model-base materialization rules.
 */

import type {
  AccountName,
  ProjectId,
  TargetName,
  WorkspaceId,
} from "../../auth/account.js";
import {
  type EntityFieldSpecs,
  EntityModel,
  modelFail,
  oneOf,
  prepareInit,
} from "./model-base.js";

/**
 * Constructor input for {@link AccountSummary} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface AccountSummaryInit {
  /** Local config name (matches the TOML block key). */
  readonly name: string;
  /** Discriminator value of the underlying `Account` variant. */
  readonly type: "service_account" | "oauth_browser" | "oauth_token";
  /** Mixpanel region — `us`, `eu`, or `in`. */
  readonly region: "us" | "eu" | "in";
  /** Result of the most recent `mp account test` (or `"untested"`). */
  readonly status?:
    "ok" | "needs_login" | "needs_token" | "untested" | undefined;
  /** `True` if `[active].account == name`. */
  readonly is_active?: boolean | undefined;
  /** Names of targets that reference this account. */
  readonly referenced_by_targets?: readonly string[] | undefined;
  /** Authenticated user email, populated by `login_unified()` from `/me`. Persisted in the per-account `MeCache` (not in `config.toml`), so it survives across processes once login has run. `None` when the account was added via `mp account add` (no `/me` round-trip) or when `/me` did not return a `user_email`. */
  readonly user_email?: string | null | undefined;
  /** Project ID resolved at login time. Mirror of the persisted `default_project` for convenience — exposed on `AccountSummary` so the `mp login` success line can render `Logged in as ... → ... · {project_name}` without a second `ConfigManager` round-trip. `None` when no default project is set. */
  readonly project_id?: string | null | undefined;
  /** Human-readable project name from `/me` for the resolved project. Populated alongside `project_id` by `login_unified()`. `None` when no project is configured or the project is not in `/me`. */
  readonly project_name?: string | null | undefined;
}

/**
 * Read-only summary of a configured account for `mp account list`.
 *
 * Mirror of Python `mixpanel_headless.types.AccountSummary` (types.py;
 * model_config: frozen=True, extra='ignore').
 */
export class AccountSummary extends EntityModel<AccountSummaryInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "AccountSummary";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<AccountSummaryInit> = [
    { name: "name", required: true, kind: "str" },
    {
      name: "type",
      required: true,
      check: oneOf(["service_account", "oauth_browser", "oauth_token"]),
    },
    { name: "region", required: true, check: oneOf(["us", "eu", "in"]) },
    {
      name: "status",
      default: () => "untested",
      check: oneOf(["ok", "needs_login", "needs_token", "untested"]),
    },
    { name: "is_active", default: () => false, kind: "bool" },
    { name: "referenced_by_targets", default: () => [] },
    { name: "user_email", kind: "str", nullable: true },
    { name: "project_id", kind: "str", nullable: true },
    { name: "project_name", kind: "str", nullable: true },
  ];

  /** Local config name (matches the TOML block key). */
  declare readonly name: string;
  /** Discriminator value of the underlying `Account` variant. */
  declare readonly type: "service_account" | "oauth_browser" | "oauth_token";
  /** Mixpanel region — `us`, `eu`, or `in`. */
  declare readonly region: "us" | "eu" | "in";
  /** Result of the most recent `mp account test` (or `"untested"`). */
  declare readonly status: "ok" | "needs_login" | "needs_token" | "untested";
  /** `True` if `[active].account == name`. */
  declare readonly is_active: boolean;
  /** Names of targets that reference this account. */
  declare readonly referenced_by_targets: readonly string[];
  /** Authenticated user email, populated by `login_unified()` from `/me`. Persisted in the per-account `MeCache` (not in `config.toml`), so it survives across processes once login has run. `None` when the account was added via `mp account add` (no `/me` round-trip) or when `/me` did not return a `user_email`. */
  declare readonly user_email: string | null;
  /** Project ID resolved at login time. Mirror of the persisted `default_project` for convenience — exposed on `AccountSummary` so the `mp login` success line can render `Logged in as ... → ... · {project_name}` without a second `ConfigManager` round-trip. `None` when no default project is set. */
  declare readonly project_id: string | null;
  /** Human-readable project name from `/me` for the resolved project. Populated alongside `project_id` by `login_unified()`. `None` when no project is configured or the project is not in `/me`. */
  declare readonly project_name: string | null;

  /**
   * Construct a validated AccountSummary (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: AccountSummaryInit) {
    super(AccountSummary, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): AccountSummary {
    return new AccountSummary(prepareInit(AccountSummary, raw));
  }
}

/**
 * Constructor input for {@link AccountTestResult} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface AccountTestResultInit {
  /** Account that was tested. */
  readonly account_name: string;
  /** `True` if the `/me` request succeeded with valid credentials. */
  readonly ok: boolean;
  /** Authenticated principal identity, when `ok` is `True`. */
  readonly user?: Readonly<Record<string, unknown>> | null | undefined;
  /** Number of projects the account can read from `/me`. */
  readonly accessible_project_count?: number | null | undefined;
  /** Human-readable failure reason when `ok` is `False`. */
  readonly error?: string | null | undefined;
  /** Machine-readable error code (only set when the cause was a `MixpanelHeadlessError`). */
  readonly error_code?: string | null | undefined;
  /** Structured `details` payload from the underlying `MixpanelHeadlessError`, if any. */
  readonly error_details?: Readonly<Record<string, unknown>> | null | undefined;
}

/**
 * Outcome of `mp account test NAME` — captures the `/me` probe.
 *
 * Mirror of Python `mixpanel_headless.types.AccountTestResult` (types.py;
 * model_config: frozen=True, extra='ignore').
 */
export class AccountTestResult extends EntityModel<AccountTestResultInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "AccountTestResult";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<AccountTestResultInit> = [
    { name: "account_name", required: true, kind: "str" },
    { name: "ok", required: true, kind: "bool" },
    { name: "user", nullable: true },
    { name: "accessible_project_count", kind: "int", nullable: true },
    { name: "error", kind: "str", nullable: true },
    { name: "error_code", kind: "str", nullable: true },
    { name: "error_details", nullable: true },
  ];

  /** Account that was tested. */
  declare readonly account_name: string;
  /** `True` if the `/me` request succeeded with valid credentials. */
  declare readonly ok: boolean;
  /** Authenticated principal identity, when `ok` is `True`. */
  declare readonly user: Readonly<Record<string, unknown>> | null;
  /** Number of projects the account can read from `/me`. */
  declare readonly accessible_project_count: number | null;
  /** Human-readable failure reason when `ok` is `False`. */
  declare readonly error: string | null;
  /** Machine-readable error code (only set when the cause was a `MixpanelHeadlessError`). */
  declare readonly error_code: string | null;
  /** Structured `details` payload from the underlying `MixpanelHeadlessError`, if any. */
  declare readonly error_details: Readonly<Record<string, unknown>> | null;

  /**
   * Construct a validated AccountTestResult (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: AccountTestResultInit) {
    super(AccountTestResult, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): AccountTestResult {
    return new AccountTestResult(prepareInit(AccountTestResult, raw));
  }

  /**
   * Port of the Python `model_validator(mode="after")`
   * `_ok_iff_no_error`: enforce `ok=True` ⟺ `error is None`, and
   * confine `error_code`/`error_details` to the failure arm.
   *
   * @throws ResponseValidationError - When `ok`/`error` disagree.
   */
  protected override afterValidate(): void {
    if (this.ok && this.error !== null) {
      modelFail("AccountTestResult", "ok=True implies error is None");
    }
    if (!this.ok && this.error === null) {
      modelFail("AccountTestResult", "ok=False requires a non-empty error");
    }
    if (this.ok && (this.error_code !== null || this.error_details !== null)) {
      modelFail(
        "AccountTestResult",
        "error_code/error_details only meaningful when ok=False",
      );
    }
  }
}

/**
 * Constructor input for {@link Target} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface TargetInit {
  /** Local target name (matches the TOML block key). */
  readonly name: TargetName;
  /** Local config name of the referenced account (must exist). */
  readonly account: AccountName;
  /** Numeric project ID (Mixpanel's wire format). */
  readonly project: ProjectId;
  /** Optional workspace ID (must be a positive integer when set); `None` defers to lazy resolution. Mirrors `WorkspaceRef.id`'s `PositiveInt` constraint so bad values fail at construction rather than corrupting downstream config. */
  readonly workspace?: WorkspaceId | null | undefined;
}

/**
 * A saved (account, project, workspace?) triple persisted in `[targets.NAME]`.
 *
 * Mirror of Python `mixpanel_headless.types.Target` (types.py;
 * model_config: frozen=True, extra='forbid').
 */
export class Target extends EntityModel<TargetInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "Target";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "forbid" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<TargetInit> = [
    { name: "name", required: true, kind: "str" },
    { name: "account", required: true, kind: "str" },
    {
      name: "project",
      required: true,
      kind: "str",
      // Python: Annotated[ProjectId, Field(min_length=1, pattern=r"^\d+$")]
      check: (value: unknown, path: string): void => {
        if (typeof value !== "string" || !/^\d+$/.test(value)) {
          modelFail(path, "project must be a digits-only string");
        }
      },
    },
    {
      name: "workspace",
      kind: "int",
      nullable: true,
      // Python: Annotated[WorkspaceId, Field(gt=0)] | None
      check: (value: unknown, path: string): void => {
        if (typeof value === "number" && !(value > 0)) {
          modelFail(path, "workspace must be > 0");
        }
      },
    },
  ];

  /** Local target name (matches the TOML block key). */
  declare readonly name: TargetName;
  /** Local config name of the referenced account (must exist). */
  declare readonly account: AccountName;
  /** Numeric project ID (Mixpanel's wire format). */
  declare readonly project: ProjectId;
  /** Optional workspace ID (must be a positive integer when set); `None` defers to lazy resolution. Mirrors `WorkspaceRef.id`'s `PositiveInt` constraint so bad values fail at construction rather than corrupting downstream config. */
  declare readonly workspace: WorkspaceId | null;

  /**
   * Construct a validated Target (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: TargetInit) {
    super(Target, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): Target {
    return new Target(prepareInit(Target, raw));
  }
}

/**
 * Constructor input for {@link OAuthLoginResult} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface OAuthLoginResultInit {
  /** Account that was authenticated. */
  readonly account_name: string;
  /** Authenticated principal identity from the post-login `/me` probe. */
  readonly user?: Readonly<Record<string, unknown>> | null | undefined;
  /** Access-token expiry (UTC) from the token endpoint response. */
  readonly expires_at?: string | null | undefined;
  /** Where the tokens were persisted (`~/.mp/accounts/{name}/tokens.json`). */
  readonly tokens_path: string;
  /** Where the DCR client info was persisted (`~/.mp/accounts/{name}/client.json`). */
  readonly client_path: string;
}

/**
 * Outcome of `mp.accounts.login(name)` — captures the PKCE flow result.
 *
 * Mirror of Python `mixpanel_headless.types.OAuthLoginResult` (types.py;
 * model_config: frozen=True, extra='ignore').
 */
export class OAuthLoginResult extends EntityModel<OAuthLoginResultInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "OAuthLoginResult";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<OAuthLoginResultInit> = [
    { name: "account_name", required: true, kind: "str" },
    { name: "user", nullable: true },
    { name: "expires_at", nullable: true, datetime: true },
    { name: "tokens_path", required: true, kind: "str" },
    { name: "client_path", required: true, kind: "str" },
  ];

  /** Account that was authenticated. */
  declare readonly account_name: string;
  /** Authenticated principal identity from the post-login `/me` probe. */
  declare readonly user: Readonly<Record<string, unknown>> | null;
  /** Access-token expiry (UTC) from the token endpoint response. */
  declare readonly expires_at: string | null;
  /** Where the tokens were persisted (`~/.mp/accounts/{name}/tokens.json`). */
  declare readonly tokens_path: string;
  /** Where the DCR client info was persisted (`~/.mp/accounts/{name}/client.json`). */
  declare readonly client_path: string;

  /**
   * Construct a validated OAuthLoginResult (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: OAuthLoginResultInit) {
    super(OAuthLoginResult, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): OAuthLoginResult {
    return new OAuthLoginResult(prepareInit(OAuthLoginResult, raw));
  }
}
