/**
 * Dashboard family + blueprint/RCA/report-link params.
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
  oneOf,
  prepareInit,
} from "./model-base.js";

/**
 * Constructor input for {@link Dashboard} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface DashboardInit {
  /** Unique dashboard identifier. */
  readonly id: number;
  /** Dashboard title. */
  readonly title: string;
  /** Dashboard description. */
  readonly description?: string | null | undefined;
  /** Whether the dashboard is private. */
  readonly is_private?: boolean | undefined;
  /** Whether the dashboard has restricted access. */
  readonly is_restricted?: boolean | undefined;
  /** ID of the dashboard creator. */
  readonly creator_id?: number | null | undefined;
  /** Name of the dashboard creator. */
  readonly creator_name?: string | null | undefined;
  /** Email of the dashboard creator. */
  readonly creator_email?: string | null | undefined;
  /** Creation timestamp. */
  readonly created?: string | null | undefined;
  /** Last modification timestamp. */
  readonly modified?: string | null | undefined;
  /** Whether the current user has favorited this dashboard. */
  readonly is_favorited?: boolean | undefined;
  /** Date the dashboard was pinned, if any. */
  readonly pinned_date?: string | null | undefined;
  /** Layout version metadata. */
  readonly layout_version?: unknown;
  /** Number of unique viewers. */
  readonly unique_view_count?: number | null | undefined;
  /** Total view count. */
  readonly total_view_count?: number | null | undefined;
  /** ID of the last modifier. */
  readonly last_modified_by_id?: number | null | undefined;
  /** Name of the last modifier. */
  readonly last_modified_by_name?: string | null | undefined;
  /** Email of the last modifier. */
  readonly last_modified_by_email?: string | null | undefined;
  /** Dashboard-level filters. */
  readonly filters?: readonly unknown[] | null | undefined;
  /** Dashboard-level breakdowns. */
  readonly breakdowns?: readonly unknown[] | null | undefined;
  /** Dashboard-level time filter. */
  readonly time_filter?: unknown;
  /** How the dashboard was generated. */
  readonly generation_type?: string | null | undefined;
  /** Parent dashboard ID for nested dashboards. */
  readonly parent_dashboard_id?: number | null | undefined;
  /** Child dashboard references. */
  readonly child_dashboards?: readonly unknown[] | null | undefined;
  /** Permission: can update basic fields. */
  readonly can_update_basic?: boolean | undefined;
  /** Permission: can share. */
  readonly can_share?: boolean | undefined;
  /** Permission: can view. */
  readonly can_view?: boolean | undefined;
  /** Permission: can update restricted fields. */
  readonly can_update_restricted?: boolean | undefined;
  /** Permission: can update visibility. */
  readonly can_update_visibility?: boolean | undefined;
  /** Whether current user is superadmin. */
  readonly is_superadmin?: boolean | undefined;
  /** Whether staff override is allowed. */
  readonly allow_staff_override?: boolean | undefined;
  /** Whether current user can pin. */
  readonly can_pin?: boolean | undefined;
  /** Whether shared with the project. */
  readonly is_shared_with_project?: boolean | undefined;
  /** Creator identifier string. */
  readonly creator?: string | null | undefined;
  /** Ancestor dashboard references. */
  readonly ancestors?: readonly unknown[] | undefined;
  /** Dashboard layout data. */
  readonly layout?: unknown;
  /** Dashboard contents data. */
  readonly contents?: unknown;
  /** Number of active public links. */
  readonly num_active_public_links?: number | null | undefined;
  /** New content data. */
  readonly new_content?: unknown;
  /** Template type if created from a template. */
  readonly template_type?: string | null | undefined;
}

/**
 * A Mixpanel dashboard as returned by the App API.
 *
 * @remarks Pydantic `extra='allow'`: unknown keys are kept on `__extras`.
 * @example
 * ```ts
 * const dashboard = Dashboard.fromDict({
 *   id: 42,
 *   title: "Weekly KPIs",
 *   description: "Weekly overview",
 * });
 * dashboard.id; // 42
 * ```
 * @see mixpanel_headless.types.Dashboard
 */
export class Dashboard extends EntityModel<DashboardInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "Dashboard";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<DashboardInit> = [
    { name: "id", required: true, kind: "int" },
    { name: "title", required: true, kind: "str" },
    { name: "description", kind: "str", nullable: true },
    { name: "is_private", default: () => false, kind: "bool" },
    { name: "is_restricted", default: () => false, kind: "bool" },
    { name: "creator_id", kind: "int", nullable: true },
    { name: "creator_name", kind: "str", nullable: true },
    { name: "creator_email", kind: "str", nullable: true },
    { name: "created", nullable: true, datetime: true },
    { name: "modified", nullable: true, datetime: true },
    { name: "is_favorited", default: () => false, kind: "bool" },
    { name: "pinned_date", kind: "str", nullable: true },
    { name: "layout_version", nullable: true },
    { name: "unique_view_count", kind: "int", nullable: true },
    { name: "total_view_count", kind: "int", nullable: true },
    { name: "last_modified_by_id", kind: "int", nullable: true },
    { name: "last_modified_by_name", kind: "str", nullable: true },
    { name: "last_modified_by_email", kind: "str", nullable: true },
    { name: "filters", nullable: true },
    { name: "breakdowns", nullable: true },
    { name: "time_filter", nullable: true },
    { name: "generation_type", kind: "str", nullable: true },
    { name: "parent_dashboard_id", kind: "int", nullable: true },
    { name: "child_dashboards", nullable: true },
    { name: "can_update_basic", default: () => false, kind: "bool" },
    { name: "can_share", default: () => false, kind: "bool" },
    { name: "can_view", default: () => false, kind: "bool" },
    { name: "can_update_restricted", default: () => false, kind: "bool" },
    { name: "can_update_visibility", default: () => false, kind: "bool" },
    { name: "is_superadmin", default: () => false, kind: "bool" },
    { name: "allow_staff_override", default: () => false, kind: "bool" },
    { name: "can_pin", default: () => false, kind: "bool" },
    { name: "is_shared_with_project", default: () => false, kind: "bool" },
    { name: "creator", kind: "str", nullable: true },
    { name: "ancestors", default: () => [] },
    { name: "layout", nullable: true },
    { name: "contents", nullable: true },
    { name: "num_active_public_links", kind: "int", nullable: true },
    { name: "new_content", nullable: true },
    { name: "template_type", kind: "str", nullable: true },
  ];

  /** Unique dashboard identifier. */
  declare readonly id: number;
  /** Dashboard title. */
  declare readonly title: string;
  /** Dashboard description. */
  declare readonly description: string | null;
  /** Whether the dashboard is private. */
  declare readonly is_private: boolean;
  /** Whether the dashboard has restricted access. */
  declare readonly is_restricted: boolean;
  /** ID of the dashboard creator. */
  declare readonly creator_id: number | null;
  /** Name of the dashboard creator. */
  declare readonly creator_name: string | null;
  /** Email of the dashboard creator. */
  declare readonly creator_email: string | null;
  /** Creation timestamp. */
  declare readonly created: string | null;
  /** Last modification timestamp. */
  declare readonly modified: string | null;
  /** Whether the current user has favorited this dashboard. */
  declare readonly is_favorited: boolean;
  /** Date the dashboard was pinned, if any. */
  declare readonly pinned_date: string | null;
  /** Layout version metadata. */
  declare readonly layout_version: unknown;
  /** Number of unique viewers. */
  declare readonly unique_view_count: number | null;
  /** Total view count. */
  declare readonly total_view_count: number | null;
  /** ID of the last modifier. */
  declare readonly last_modified_by_id: number | null;
  /** Name of the last modifier. */
  declare readonly last_modified_by_name: string | null;
  /** Email of the last modifier. */
  declare readonly last_modified_by_email: string | null;
  /** Dashboard-level filters. */
  declare readonly filters: readonly unknown[] | null;
  /** Dashboard-level breakdowns. */
  declare readonly breakdowns: readonly unknown[] | null;
  /** Dashboard-level time filter. */
  declare readonly time_filter: unknown;
  /** How the dashboard was generated. */
  declare readonly generation_type: string | null;
  /** Parent dashboard ID for nested dashboards. */
  declare readonly parent_dashboard_id: number | null;
  /** Child dashboard references. */
  declare readonly child_dashboards: readonly unknown[] | null;
  /** Permission: can update basic fields. */
  declare readonly can_update_basic: boolean;
  /** Permission: can share. */
  declare readonly can_share: boolean;
  /** Permission: can view. */
  declare readonly can_view: boolean;
  /** Permission: can update restricted fields. */
  declare readonly can_update_restricted: boolean;
  /** Permission: can update visibility. */
  declare readonly can_update_visibility: boolean;
  /** Whether current user is superadmin. */
  declare readonly is_superadmin: boolean;
  /** Whether staff override is allowed. */
  declare readonly allow_staff_override: boolean;
  /** Whether current user can pin. */
  declare readonly can_pin: boolean;
  /** Whether shared with the project. */
  declare readonly is_shared_with_project: boolean;
  /** Creator identifier string. */
  declare readonly creator: string | null;
  /** Ancestor dashboard references. */
  declare readonly ancestors: readonly unknown[];
  /** Dashboard layout data. */
  declare readonly layout: unknown;
  /** Dashboard contents data. */
  declare readonly contents: unknown;
  /** Number of active public links. */
  declare readonly num_active_public_links: number | null;
  /** New content data. */
  declare readonly new_content: unknown;
  /** Template type if created from a template. */
  declare readonly template_type: string | null;

  /**
   * Construct a validated Dashboard (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: DashboardInit) {
    super(Dashboard, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): Dashboard {
    return new Dashboard(prepareInit(Dashboard, raw));
  }
}

/**
 * Constructor input for {@link DashboardRowContent} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface DashboardRowContentInit {
  /** Type of content: `"text"` for text cards, `"report"` for reports. */
  readonly content_type: "text" | "report";
  /** Content parameters. Shape depends on `content_type`. */
  readonly content_params: Readonly<Record<string, unknown>>;
}

/**
 * A single content item within a dashboard row.
 *
 * @remarks Pydantic `extra='ignore'`: unknown keys are dropped.
 * @example
 * ```ts
 * const dashboardRowContent = DashboardRowContent.fromDict({
 *   content_type: "text",
 *   content_params: {},
 * });
 * dashboardRowContent.content_type; // "text"
 * ```
 * @see mixpanel_headless.types.DashboardRowContent
 */
export class DashboardRowContent extends EntityModel<DashboardRowContentInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "DashboardRowContent";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<DashboardRowContentInit> = [
    { name: "content_type", required: true, check: oneOf(["text", "report"]) },
    { name: "content_params", required: true },
  ];

  /** Type of content: `"text"` for text cards, `"report"` for reports. */
  declare readonly content_type: "text" | "report";
  /** Content parameters. Shape depends on `content_type`. */
  declare readonly content_params: Readonly<Record<string, unknown>>;

  /**
   * Construct a validated DashboardRowContent (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: DashboardRowContentInit) {
    super(DashboardRowContent, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): DashboardRowContent {
    return new DashboardRowContent(prepareInit(DashboardRowContent, raw));
  }
}

/**
 * Constructor input for {@link DashboardRow} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface DashboardRowInit {
  /** Content items in this row (max 4). */
  readonly contents: ReadonlyArray<
    DashboardRowContent | Readonly<Record<string, unknown>>
  >;
}

/**
 * A row of content items for a dashboard.
 *
 * @remarks Pydantic `extra='ignore'`: unknown keys are dropped.
 * @example
 * ```ts
 * const dashboardRow = DashboardRow.fromDict({
 *   contents: [{ content_type: "text", content_params: {} }],
 * });
 * dashboardRow.contents; // [{ content_type: "text", … }]
 * ```
 * @see mixpanel_headless.types.DashboardRow
 */
export class DashboardRow extends EntityModel<DashboardRowInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "DashboardRow";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<DashboardRowInit> = [
    {
      name: "contents",
      required: true,
      nested: () => DashboardRowContent,
      container: "list",
    },
  ];

  /** Content items in this row (max 4). */
  declare readonly contents: readonly DashboardRowContent[];

  /**
   * Construct a validated DashboardRow (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: DashboardRowInit) {
    super(DashboardRow, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): DashboardRow {
    return new DashboardRow(prepareInit(DashboardRow, raw));
  }
}

/**
 * Constructor input for {@link CreateDashboardParams} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface CreateDashboardParamsInit {
  /** Dashboard title (required). */
  readonly title: string;
  /** Dashboard description. */
  readonly description?: string | null | undefined;
  /** Whether the dashboard should be private. */
  readonly is_private?: boolean | null | undefined;
  /** Whether the dashboard should have restricted access. */
  readonly is_restricted?: boolean | null | undefined;
  /** Dashboard-level filters. */
  readonly filters?: readonly unknown[] | null | undefined;
  /** Dashboard-level breakdowns. */
  readonly breakdowns?: readonly unknown[] | null | undefined;
  /** Dashboard-level time filter. */
  readonly time_filter?: unknown;
  /** ID of dashboard to duplicate. */
  readonly duplicate?: number | null | undefined;
  /** Initial content rows with layout. Each row has 1-4 content items. */
  readonly rows?:
    | ReadonlyArray<DashboardRow | Readonly<Record<string, unknown>>>
    | null
    | undefined;
}

/**
 * Parameters for creating a new dashboard.
 *
 * @remarks Pydantic `extra='ignore'`: unknown keys are dropped.
 * @example
 * ```ts
 * const params = new CreateDashboardParams({
 *   title: "Weekly KPIs",
 *   description: "Weekly overview",
 * });
 * params.title; // "Weekly KPIs"
 * ```
 * @see mixpanel_headless.types.CreateDashboardParams
 */
export class CreateDashboardParams extends EntityModel<CreateDashboardParamsInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "CreateDashboardParams";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<CreateDashboardParamsInit> = [
    { name: "title", required: true, kind: "str" },
    { name: "description", kind: "str", nullable: true },
    { name: "is_private", kind: "bool", nullable: true },
    { name: "is_restricted", kind: "bool", nullable: true },
    { name: "filters", nullable: true },
    { name: "breakdowns", nullable: true },
    { name: "time_filter", nullable: true },
    { name: "duplicate", kind: "int", nullable: true },
    {
      name: "rows",
      nullable: true,
      nested: () => DashboardRow,
      container: "list",
    },
  ];

  /** Dashboard title (required). */
  declare readonly title: string;
  /** Dashboard description. */
  declare readonly description: string | null;
  /** Whether the dashboard should be private. */
  declare readonly is_private: boolean | null;
  /** Whether the dashboard should have restricted access. */
  declare readonly is_restricted: boolean | null;
  /** Dashboard-level filters. */
  declare readonly filters: readonly unknown[] | null;
  /** Dashboard-level breakdowns. */
  declare readonly breakdowns: readonly unknown[] | null;
  /** Dashboard-level time filter. */
  declare readonly time_filter: unknown;
  /** ID of dashboard to duplicate. */
  declare readonly duplicate: number | null;
  /** Initial content rows with layout. Each row has 1-4 content items. */
  declare readonly rows: readonly DashboardRow[] | null;

  /**
   * Construct a validated CreateDashboardParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: CreateDashboardParamsInit) {
    super(CreateDashboardParams, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): CreateDashboardParams {
    return new CreateDashboardParams(prepareInit(CreateDashboardParams, raw));
  }
}

/**
 * Constructor input for {@link UpdateDashboardParams} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface UpdateDashboardParamsInit {
  /** New dashboard title. */
  readonly title?: string | null | undefined;
  /** New dashboard description. */
  readonly description?: string | null | undefined;
  /** New privacy setting. */
  readonly is_private?: boolean | null | undefined;
  /** New restriction setting. */
  readonly is_restricted?: boolean | null | undefined;
  /** New dashboard-level filters. */
  readonly filters?: readonly unknown[] | null | undefined;
  /** New dashboard-level breakdowns. */
  readonly breakdowns?: readonly unknown[] | null | undefined;
  /** New dashboard-level time filter. */
  readonly time_filter?: unknown;
  /** New dashboard layout data. */
  readonly layout?: unknown;
  /** New dashboard content data. */
  readonly content?: unknown;
}

/**
 * Parameters for updating an existing dashboard.
 *
 * @remarks Pydantic `extra='ignore'`: unknown keys are dropped.
 * @example
 * ```ts
 * const params = new UpdateDashboardParams({ title: "Weekly KPIs" });
 * params.title; // "Weekly KPIs"
 * ```
 * @see mixpanel_headless.types.UpdateDashboardParams
 */
export class UpdateDashboardParams extends EntityModel<UpdateDashboardParamsInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "UpdateDashboardParams";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<UpdateDashboardParamsInit> = [
    { name: "title", kind: "str", nullable: true },
    { name: "description", kind: "str", nullable: true },
    { name: "is_private", kind: "bool", nullable: true },
    { name: "is_restricted", kind: "bool", nullable: true },
    { name: "filters", nullable: true },
    { name: "breakdowns", nullable: true },
    { name: "time_filter", nullable: true },
    { name: "layout", nullable: true },
    { name: "content", nullable: true },
  ];

  /** New dashboard title. */
  declare readonly title: string | null;
  /** New dashboard description. */
  declare readonly description: string | null;
  /** New privacy setting. */
  declare readonly is_private: boolean | null;
  /** New restriction setting. */
  declare readonly is_restricted: boolean | null;
  /** New dashboard-level filters. */
  declare readonly filters: readonly unknown[] | null;
  /** New dashboard-level breakdowns. */
  declare readonly breakdowns: readonly unknown[] | null;
  /** New dashboard-level time filter. */
  declare readonly time_filter: unknown;
  /** New dashboard layout data. */
  declare readonly layout: unknown;
  /** New dashboard content data. */
  declare readonly content: unknown;

  /**
   * Construct a validated UpdateDashboardParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: UpdateDashboardParamsInit) {
    super(UpdateDashboardParams, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): UpdateDashboardParams {
    return new UpdateDashboardParams(prepareInit(UpdateDashboardParams, raw));
  }
}

/**
 * Constructor input for {@link BlueprintTemplate} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface BlueprintTemplateInit {
  /** Template title key. */
  readonly title_key: string;
  /** Template description key. */
  readonly description_key: string;
  /** Alternative description key. */
  readonly alternative_description_key?: string | null | undefined;
  /** Number of reports in the template. */
  readonly number_of_reports?: number | null | undefined;
}

/**
 * A dashboard blueprint template.
 *
 * @remarks Pydantic `extra='allow'`: unknown keys are kept on `__extras`.
 * @example
 * ```ts
 * const blueprintTemplate = BlueprintTemplate.fromDict({
 *   title_key: "onboarding.title",
 *   description_key: "onboarding.description",
 *   alternative_description_key: "example",
 * });
 * blueprintTemplate.title_key; // "onboarding.title"
 * ```
 * @see mixpanel_headless.types.BlueprintTemplate
 */
export class BlueprintTemplate extends EntityModel<BlueprintTemplateInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "BlueprintTemplate";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<BlueprintTemplateInit> = [
    { name: "title_key", required: true, kind: "str" },
    { name: "description_key", required: true, kind: "str" },
    { name: "alternative_description_key", kind: "str", nullable: true },
    { name: "number_of_reports", kind: "int", nullable: true },
  ];

  /** Template title key. */
  declare readonly title_key: string;
  /** Template description key. */
  declare readonly description_key: string;
  /** Alternative description key. */
  declare readonly alternative_description_key: string | null;
  /** Number of reports in the template. */
  declare readonly number_of_reports: number | null;

  /**
   * Construct a validated BlueprintTemplate (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: BlueprintTemplateInit) {
    super(BlueprintTemplate, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): BlueprintTemplate {
    return new BlueprintTemplate(prepareInit(BlueprintTemplate, raw));
  }
}

/**
 * Constructor input for {@link BlueprintConfig} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface BlueprintConfigInit {
  /** Template variable mappings. */
  readonly variables: Readonly<Record<string, string>>;
}

/**
 * Configuration for a dashboard blueprint.
 *
 * @remarks Pydantic `extra='allow'`: unknown keys are kept on `__extras`.
 * @example
 * ```ts
 * const blueprintConfig = BlueprintConfig.fromDict({
 *   variables: { signup_event: "Signup" },
 * });
 * blueprintConfig.variables; // { signup_event: "Signup" }
 * ```
 * @see mixpanel_headless.types.BlueprintConfig
 */
export class BlueprintConfig extends EntityModel<BlueprintConfigInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "BlueprintConfig";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<BlueprintConfigInit> = [
    { name: "variables", required: true },
  ];

  /** Template variable mappings. */
  declare readonly variables: Readonly<Record<string, string>>;

  /**
   * Construct a validated BlueprintConfig (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: BlueprintConfigInit) {
    super(BlueprintConfig, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): BlueprintConfig {
    return new BlueprintConfig(prepareInit(BlueprintConfig, raw));
  }
}

/**
 * Constructor input for {@link BlueprintCard} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface BlueprintCardInit {
  /** Card type (serialized as `"type"`). */
  readonly card_type: string;
  /** Text card ID, if applicable. */
  readonly text_card_id?: number | null | undefined;
  /** Bookmark ID, if applicable. */
  readonly bookmark_id?: number | null | undefined;
  /** Markdown content for text cards. */
  readonly markdown?: string | null | undefined;
  /** Card name. */
  readonly name?: string | null | undefined;
  /** Card parameters. */
  readonly params?: Readonly<Record<string, unknown>> | null | undefined;
}

/**
 * A card in a blueprint dashboard.
 *
 * @remarks Pydantic `extra='allow'`: unknown keys are kept on `__extras`.
 * @example
 * ```ts
 * const blueprintCard = BlueprintCard.fromDict({
 *   card_type: "report",
 *   markdown: "# Notes",
 * });
 * blueprintCard.card_type; // "report"
 * ```
 * @see mixpanel_headless.types.BlueprintCard
 */
export class BlueprintCard extends EntityModel<BlueprintCardInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "BlueprintCard";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<BlueprintCardInit> = [
    {
      name: "card_type",
      required: true,
      aliases: ["type"],
      wire: "type",
      kind: "str",
    },
    { name: "text_card_id", kind: "int", nullable: true },
    { name: "bookmark_id", kind: "int", nullable: true },
    { name: "markdown", kind: "str", nullable: true },
    { name: "name", kind: "str", nullable: true },
    { name: "params", nullable: true },
  ];

  /** Card type (serialized as `"type"`). */
  declare readonly card_type: string;
  /** Text card ID, if applicable. */
  declare readonly text_card_id: number | null;
  /** Bookmark ID, if applicable. */
  declare readonly bookmark_id: number | null;
  /** Markdown content for text cards. */
  declare readonly markdown: string | null;
  /** Card name. */
  declare readonly name: string | null;
  /** Card parameters. */
  declare readonly params: Readonly<Record<string, unknown>> | null;

  /**
   * Construct a validated BlueprintCard (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: BlueprintCardInit) {
    super(BlueprintCard, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): BlueprintCard {
    return new BlueprintCard(prepareInit(BlueprintCard, raw));
  }
}

/**
 * Constructor input for {@link BlueprintFinishParams} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface BlueprintFinishParamsInit {
  /** ID of the blueprint dashboard to finalize. */
  readonly dashboard_id: number;
  /** List of cards to include. */
  readonly cards: ReadonlyArray<
    BlueprintCard | Readonly<Record<string, unknown>>
  >;
}

/**
 * Parameters for finalizing a blueprint dashboard.
 *
 * @remarks Pydantic `extra='ignore'`: unknown keys are dropped.
 * @example
 * ```ts
 * const params = new BlueprintFinishParams({
 *   dashboard_id: 9,
 *   cards: [{ card_type: "report" }],
 * });
 * params.dashboard_id; // 9
 * ```
 * @see mixpanel_headless.types.BlueprintFinishParams
 */
export class BlueprintFinishParams extends EntityModel<BlueprintFinishParamsInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "BlueprintFinishParams";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<BlueprintFinishParamsInit> = [
    { name: "dashboard_id", required: true, kind: "int" },
    {
      name: "cards",
      required: true,
      nested: () => BlueprintCard,
      container: "list",
    },
  ];

  /** ID of the blueprint dashboard to finalize. */
  declare readonly dashboard_id: number;
  /** List of cards to include. */
  declare readonly cards: readonly BlueprintCard[];

  /**
   * Construct a validated BlueprintFinishParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: BlueprintFinishParamsInit) {
    super(BlueprintFinishParams, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): BlueprintFinishParams {
    return new BlueprintFinishParams(prepareInit(BlueprintFinishParams, raw));
  }
}

/**
 * Constructor input for {@link RcaSourceData} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface RcaSourceDataInit {
  /** Source type (serialized as `"type"`). */
  readonly source_type: string;
  /** Date string. */
  readonly date?: string | null | undefined;
  /** Whether this is a metric source. */
  readonly metric_source?: boolean | null | undefined;
}

/**
 * Source data for RCA dashboard creation.
 *
 * @remarks Pydantic `extra='allow'`: unknown keys are kept on `__extras`.
 * @example
 * ```ts
 * const rcaSourceData = RcaSourceData.fromDict({
 *   source_type: "bookmark",
 *   metric_source: true,
 * });
 * rcaSourceData.source_type; // "bookmark"
 * ```
 * @see mixpanel_headless.types.RcaSourceData
 */
export class RcaSourceData extends EntityModel<RcaSourceDataInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "RcaSourceData";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<RcaSourceDataInit> = [
    {
      name: "source_type",
      required: true,
      aliases: ["type"],
      wire: "type",
      kind: "str",
    },
    { name: "date", kind: "str", nullable: true },
    { name: "metric_source", kind: "bool", nullable: true },
  ];

  /** Source type (serialized as `"type"`). */
  declare readonly source_type: string;
  /** Date string. */
  declare readonly date: string | null;
  /** Whether this is a metric source. */
  declare readonly metric_source: boolean | null;

  /**
   * Construct a validated RcaSourceData (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: RcaSourceDataInit) {
    super(RcaSourceData, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): RcaSourceData {
    return new RcaSourceData(prepareInit(RcaSourceData, raw));
  }
}

/**
 * Constructor input for {@link CreateRcaDashboardParams} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface CreateRcaDashboardParamsInit {
  /** Source ID for RCA analysis. */
  readonly rca_source_id: number;
  /** Source data configuration. */
  readonly rca_source_data: RcaSourceData | Readonly<Record<string, unknown>>;
}

/**
 * Parameters for creating an RCA dashboard.
 *
 * @remarks Pydantic `extra='ignore'`: unknown keys are dropped.
 * @example
 * ```ts
 * const params = new CreateRcaDashboardParams({
 *   rca_source_id: 7,
 *   rca_source_data: { source_type: "bookmark" },
 * });
 * params.rca_source_id; // 7
 * ```
 * @see mixpanel_headless.types.CreateRcaDashboardParams
 */
export class CreateRcaDashboardParams extends EntityModel<CreateRcaDashboardParamsInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "CreateRcaDashboardParams";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<CreateRcaDashboardParamsInit> = [
    { name: "rca_source_id", required: true, kind: "int" },
    { name: "rca_source_data", required: true, nested: () => RcaSourceData },
  ];

  /** Source ID for RCA analysis. */
  declare readonly rca_source_id: number;
  /** Source data configuration. */
  declare readonly rca_source_data: RcaSourceData;

  /**
   * Construct a validated CreateRcaDashboardParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: CreateRcaDashboardParamsInit) {
    super(CreateRcaDashboardParams, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): CreateRcaDashboardParams {
    return new CreateRcaDashboardParams(
      prepareInit(CreateRcaDashboardParams, raw),
    );
  }
}

/**
 * Constructor input for {@link UpdateReportLinkParams} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface UpdateReportLinkParamsInit {
  /** Link type (serialized as `"type"`). */
  readonly link_type: string;
}

/**
 * Parameters for updating a report link on a dashboard.
 *
 * @remarks Pydantic `extra='allow'`: unknown keys are kept on `__extras`.
 * @example
 * ```ts
 * const params = new UpdateReportLinkParams({ link_type: "report" });
 * params.link_type; // "report"
 * ```
 * @see mixpanel_headless.types.UpdateReportLinkParams
 */
export class UpdateReportLinkParams extends EntityModel<UpdateReportLinkParamsInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "UpdateReportLinkParams";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<UpdateReportLinkParamsInit> = [
    {
      name: "link_type",
      required: true,
      aliases: ["type"],
      wire: "type",
      kind: "str",
    },
  ];

  /** Link type (serialized as `"type"`). */
  declare readonly link_type: string;

  /**
   * Construct a validated UpdateReportLinkParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: UpdateReportLinkParamsInit) {
    super(UpdateReportLinkParams, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): UpdateReportLinkParams {
    return new UpdateReportLinkParams(prepareInit(UpdateReportLinkParams, raw));
  }
}

/**
 * Constructor input for {@link UpdateTextCardParams} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface UpdateTextCardParamsInit {
  /** Markdown content for the text card. */
  readonly markdown?: string | null | undefined;
}

/**
 * Parameters for updating a text card on a dashboard.
 *
 * @remarks Pydantic `extra='allow'`: unknown keys are kept on `__extras`.
 * @example
 * ```ts
 * const params = new UpdateTextCardParams({ markdown: "# Notes" });
 * params.markdown; // "# Notes"
 * ```
 * @see mixpanel_headless.types.UpdateTextCardParams
 */
export class UpdateTextCardParams extends EntityModel<UpdateTextCardParamsInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "UpdateTextCardParams";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<UpdateTextCardParamsInit> = [
    { name: "markdown", kind: "str", nullable: true },
  ];

  /** Markdown content for the text card. */
  declare readonly markdown: string | null;

  /**
   * Construct a validated UpdateTextCardParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: UpdateTextCardParamsInit) {
    super(UpdateTextCardParams, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): UpdateTextCardParams {
    return new UpdateTextCardParams(prepareInit(UpdateTextCardParams, raw));
  }
}
