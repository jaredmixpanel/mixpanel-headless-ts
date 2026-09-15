/**
 * Bookmark (saved report) family + history models.
 *
 * Hand-written ports of the Pydantic entity models (phase2-design C5,
 * packet P2-7): the PYTHON models are the source of record; vendored
 * schema4api types are a compile-time cross-check only. Field names
 * keep their exact Python spelling (R3.6/R7.6); optionality follows
 * R3.9/R4.10 via the model-base materialization rules.
 */

import { isPythonDict } from "../../compat/python-dict.js";
import {
  type EntityFieldSpec,
  EntityModel,
  modelFail,
  oneOf,
  prepareInit,
} from "./model-base.js";

/**
 * Constructor input for {@link BookmarkMetadata} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface BookmarkMetadataInit {
  /** Table display mode setting. */
  readonly table_display_mode?: string | null | undefined;
  /** Whether comparison is enabled. */
  readonly compare_enabled?: boolean | null | undefined;
  /** Comparison filter settings. */
  readonly compare_filters?: readonly unknown[] | null | undefined;
  /** Retention calculation method. */
  readonly retention_calculation_type?: string | null | undefined;
  /** Associated event name. */
  readonly event_name?: string | null | undefined;
  /** Funnel conversion window in days. */
  readonly funnel_conversion_window?: number | null | undefined;
  /** Maximum funnel breakdown count. */
  readonly funnel_breakdown_limit?: number | null | undefined;
}

/**
 * Metadata associated with a bookmark/report.
 *
 * Mirror of Python `mixpanel_headless.types.BookmarkMetadata` (types.py:2372;
 * model_config: frozen=True, extra='allow').
 */
export class BookmarkMetadata extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "BookmarkMetadata";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "table_display_mode", kind: "str", nullable: true },
    { name: "compare_enabled", kind: "bool", nullable: true },
    { name: "compare_filters", nullable: true },
    { name: "retention_calculation_type", kind: "str", nullable: true },
    { name: "event_name", kind: "str", nullable: true },
    { name: "funnel_conversion_window", kind: "int", nullable: true },
    { name: "funnel_breakdown_limit", kind: "int", nullable: true },
  ];

  /** Table display mode setting. */
  declare readonly table_display_mode: string | null;
  /** Whether comparison is enabled. */
  declare readonly compare_enabled: boolean | null;
  /** Comparison filter settings. */
  declare readonly compare_filters: readonly unknown[] | null;
  /** Retention calculation method. */
  declare readonly retention_calculation_type: string | null;
  /** Associated event name. */
  declare readonly event_name: string | null;
  /** Funnel conversion window in days. */
  declare readonly funnel_conversion_window: number | null;
  /** Maximum funnel breakdown count. */
  declare readonly funnel_breakdown_limit: number | null;

  /**
   * Construct a validated BookmarkMetadata (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: BookmarkMetadataInit) {
    super(
      BookmarkMetadata,
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
  static fromDict(raw: unknown): BookmarkMetadata {
    return new BookmarkMetadata(
      prepareInit(BookmarkMetadata, raw) as unknown as BookmarkMetadataInit,
    );
  }
}

/**
 * Constructor input for {@link Bookmark} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface BookmarkInit {
  /** Unique bookmark identifier. */
  readonly id: number;
  /** Parent project identifier. */
  readonly project_id?: number | null | undefined;
  /** Bookmark name. */
  readonly name: string;
  /** Report type (aliased from ``"type"``). */
  readonly bookmark_type: string;
  /** Bookmark description. */
  readonly description?: string | null | undefined;
  /** Bookmark icon. */
  readonly icon?: string | null | undefined;
  /** Query parameters (JSON value defining the report). */
  readonly params?: Readonly<Record<string, unknown>> | null | undefined;
  /** Associated dashboard ID. */
  readonly dashboard_id?: number | null | undefined;
  /** Whether included in dashboard. */
  readonly include_in_dashboard?: boolean | null | undefined;
  /** Whether this is a default bookmark. */
  readonly is_default?: boolean | null | undefined;
  /** ID of the creator. */
  readonly creator_id?: number | null | undefined;
  /** Name of the creator. */
  readonly creator_name?: string | null | undefined;
  /** Email of the creator. */
  readonly creator_email?: string | null | undefined;
  /** Creation timestamp. */
  readonly created?: string | null | undefined;
  /** Last modification timestamp. */
  readonly modified?: string | null | undefined;
  /** ID of the last modifier. */
  readonly last_modified_by_id?: number | null | undefined;
  /** Name of the last modifier. */
  readonly last_modified_by_name?: string | null | undefined;
  /** Email of the last modifier. */
  readonly last_modified_by_email?: string | null | undefined;
  /** Report-specific metadata. */
  readonly metadata?:
    BookmarkMetadata | Readonly<Record<string, unknown>> | null | undefined;
  /** Visibility restriction flag. */
  readonly is_visibility_restricted?: boolean | null | undefined;
  /** Modification restriction flag. */
  readonly is_modification_restricted?: boolean | null | undefined;
  /** Permission: can update basic fields. */
  readonly can_update_basic?: boolean | null | undefined;
  /** Permission: can view. */
  readonly can_view?: boolean | null | undefined;
  /** Permission: can share. */
  readonly can_share?: boolean | null | undefined;
  /** How the bookmark was generated. */
  readonly generation_type?: string | null | undefined;
  /** Original report type before conversion. */
  readonly original_type?: string | null | undefined;
  /** Number of unique viewers. */
  readonly unique_view_count?: number | null | undefined;
  /** Total view count. */
  readonly total_view_count?: number | null | undefined;
}

/**
 * A Mixpanel bookmark (saved report) as returned by the App API.
 *
 * Mirror of Python `mixpanel_headless.types.Bookmark` (types.py:2420;
 * model_config: frozen=True, extra='allow', populate_by_name=True).
 */
export class Bookmark extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "Bookmark";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "id", required: true, kind: "int" },
    { name: "project_id", kind: "int", nullable: true },
    { name: "name", required: true, kind: "str" },
    {
      name: "bookmark_type",
      required: true,
      aliases: ["type"],
      wire: "type",
      kind: "str",
    },
    { name: "description", kind: "str", nullable: true },
    { name: "icon", kind: "str", nullable: true },
    { name: "params", nullable: true },
    { name: "dashboard_id", kind: "int", nullable: true },
    { name: "include_in_dashboard", kind: "bool", nullable: true },
    { name: "is_default", kind: "bool", nullable: true },
    { name: "creator_id", kind: "int", nullable: true },
    { name: "creator_name", kind: "str", nullable: true },
    { name: "creator_email", kind: "str", nullable: true },
    { name: "created", nullable: true, datetime: true },
    { name: "modified", nullable: true, datetime: true },
    { name: "last_modified_by_id", kind: "int", nullable: true },
    { name: "last_modified_by_name", kind: "str", nullable: true },
    { name: "last_modified_by_email", kind: "str", nullable: true },
    { name: "metadata", nullable: true, nested: () => BookmarkMetadata },
    { name: "is_visibility_restricted", kind: "bool", nullable: true },
    { name: "is_modification_restricted", kind: "bool", nullable: true },
    { name: "can_update_basic", kind: "bool", nullable: true },
    { name: "can_view", kind: "bool", nullable: true },
    { name: "can_share", kind: "bool", nullable: true },
    { name: "generation_type", kind: "str", nullable: true },
    { name: "original_type", kind: "str", nullable: true },
    { name: "unique_view_count", kind: "int", nullable: true },
    { name: "total_view_count", kind: "int", nullable: true },
  ];

  /** Unique bookmark identifier. */
  declare readonly id: number;
  /** Parent project identifier. */
  declare readonly project_id: number | null;
  /** Bookmark name. */
  declare readonly name: string;
  /** Report type (aliased from ``"type"``). */
  declare readonly bookmark_type: string;
  /** Bookmark description. */
  declare readonly description: string | null;
  /** Bookmark icon. */
  declare readonly icon: string | null;
  /** Query parameters (JSON value defining the report). */
  declare readonly params: Readonly<Record<string, unknown>> | null;
  /** Associated dashboard ID. */
  declare readonly dashboard_id: number | null;
  /** Whether included in dashboard. */
  declare readonly include_in_dashboard: boolean | null;
  /** Whether this is a default bookmark. */
  declare readonly is_default: boolean | null;
  /** ID of the creator. */
  declare readonly creator_id: number | null;
  /** Name of the creator. */
  declare readonly creator_name: string | null;
  /** Email of the creator. */
  declare readonly creator_email: string | null;
  /** Creation timestamp. */
  declare readonly created: string | null;
  /** Last modification timestamp. */
  declare readonly modified: string | null;
  /** ID of the last modifier. */
  declare readonly last_modified_by_id: number | null;
  /** Name of the last modifier. */
  declare readonly last_modified_by_name: string | null;
  /** Email of the last modifier. */
  declare readonly last_modified_by_email: string | null;
  /** Report-specific metadata. */
  declare readonly metadata: BookmarkMetadata | null;
  /** Visibility restriction flag. */
  declare readonly is_visibility_restricted: boolean | null;
  /** Modification restriction flag. */
  declare readonly is_modification_restricted: boolean | null;
  /** Permission: can update basic fields. */
  declare readonly can_update_basic: boolean | null;
  /** Permission: can view. */
  declare readonly can_view: boolean | null;
  /** Permission: can share. */
  declare readonly can_share: boolean | null;
  /** How the bookmark was generated. */
  declare readonly generation_type: string | null;
  /** Original report type before conversion. */
  declare readonly original_type: string | null;
  /** Number of unique viewers. */
  declare readonly unique_view_count: number | null;
  /** Total view count. */
  declare readonly total_view_count: number | null;

  /**
   * Construct a validated Bookmark (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: BookmarkInit) {
    super(Bookmark, fields as unknown as Readonly<Record<string, unknown>>);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): Bookmark {
    return new Bookmark(prepareInit(Bookmark, raw) as unknown as BookmarkInit);
  }
}

/**
 * Constructor input for {@link CreateBookmarkParams} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface CreateBookmarkParamsInit {
  /** Bookmark name (required). */
  readonly name: string;
  /** Report type (required, serialized as ``"type"``). Pydantic-validated against the canonical set on construction — typos like ``"insightz"`` are rejected before any API call. */
  readonly bookmark_type:
    "insights" | "funnels" | "retention" | "flows" | "user";
  /** Query parameters (required). */
  readonly params: Readonly<Record<string, unknown>>;
  /** Bookmark description. */
  readonly description?: string | null | undefined;
  /** Bookmark icon. */
  readonly icon?: string | null | undefined;
  /** Dashboard to associate with. */
  readonly dashboard_id?: number | null | undefined;
  /** Visibility restriction flag. */
  readonly is_visibility_restricted?: boolean | null | undefined;
  /** Modification restriction flag. */
  readonly is_modification_restricted?: boolean | null | undefined;
}

/**
 * Parameters for creating a new bookmark/report.
 *
 * Mirror of Python `mixpanel_headless.types.CreateBookmarkParams` (types.py:2554;
 * model_config: extra='ignore', populate_by_name=True).
 */
export class CreateBookmarkParams extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "CreateBookmarkParams";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "name", required: true, kind: "str" },
    {
      name: "bookmark_type",
      required: true,
      aliases: ["type"],
      wire: "type",
      check: oneOf(["insights", "funnels", "retention", "flows", "user"]),
    },
    { name: "params", required: true },
    { name: "description", kind: "str", nullable: true },
    { name: "icon", kind: "str", nullable: true },
    { name: "dashboard_id", kind: "int", nullable: true },
    { name: "is_visibility_restricted", kind: "bool", nullable: true },
    { name: "is_modification_restricted", kind: "bool", nullable: true },
  ];

  /** Bookmark name (required). */
  declare readonly name: string;
  /** Report type (required, serialized as ``"type"``). Pydantic-validated against the canonical set on construction — typos like ``"insightz"`` are rejected before any API call. */
  declare readonly bookmark_type:
    "insights" | "funnels" | "retention" | "flows" | "user";
  /** Query parameters (required). */
  declare readonly params: Readonly<Record<string, unknown>>;
  /** Bookmark description. */
  declare readonly description: string | null;
  /** Bookmark icon. */
  declare readonly icon: string | null;
  /** Dashboard to associate with. */
  declare readonly dashboard_id: number | null;
  /** Visibility restriction flag. */
  declare readonly is_visibility_restricted: boolean | null;
  /** Modification restriction flag. */
  declare readonly is_modification_restricted: boolean | null;

  /**
   * Construct a validated CreateBookmarkParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: CreateBookmarkParamsInit) {
    super(
      CreateBookmarkParams,
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
  static fromDict(raw: unknown): CreateBookmarkParams {
    return new CreateBookmarkParams(
      prepareInit(
        CreateBookmarkParams,
        raw,
      ) as unknown as CreateBookmarkParamsInit,
    );
  }
}

/**
 * Constructor input for {@link UpdateBookmarkParams} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface UpdateBookmarkParamsInit {
  /** New bookmark name. */
  readonly name?: string | null | undefined;
  /** New query parameters. */
  readonly params?: Readonly<Record<string, unknown>> | null | undefined;
  /** New bookmark description. */
  readonly description?: string | null | undefined;
  /** New bookmark icon. */
  readonly icon?: string | null | undefined;
  /** New associated dashboard ID. */
  readonly dashboard_id?: number | null | undefined;
  /** New visibility restriction. */
  readonly is_visibility_restricted?: boolean | null | undefined;
  /** New modification restriction. */
  readonly is_modification_restricted?: boolean | null | undefined;
  /** Soft-delete flag. */
  readonly deleted?: boolean | null | undefined;
}

/**
 * Parameters for updating an existing bookmark/report.
 *
 * Mirror of Python `mixpanel_headless.types.UpdateBookmarkParams` (types.py:2612;
 * model_config: extra='ignore').
 */
export class UpdateBookmarkParams extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "UpdateBookmarkParams";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "name", kind: "str", nullable: true },
    { name: "params", nullable: true },
    { name: "description", kind: "str", nullable: true },
    { name: "icon", kind: "str", nullable: true },
    { name: "dashboard_id", kind: "int", nullable: true },
    { name: "is_visibility_restricted", kind: "bool", nullable: true },
    { name: "is_modification_restricted", kind: "bool", nullable: true },
    { name: "deleted", kind: "bool", nullable: true },
  ];

  /** New bookmark name. */
  declare readonly name: string | null;
  /** New query parameters. */
  declare readonly params: Readonly<Record<string, unknown>> | null;
  /** New bookmark description. */
  declare readonly description: string | null;
  /** New bookmark icon. */
  declare readonly icon: string | null;
  /** New associated dashboard ID. */
  declare readonly dashboard_id: number | null;
  /** New visibility restriction. */
  declare readonly is_visibility_restricted: boolean | null;
  /** New modification restriction. */
  declare readonly is_modification_restricted: boolean | null;
  /** Soft-delete flag. */
  declare readonly deleted: boolean | null;

  /**
   * Construct a validated UpdateBookmarkParams (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: UpdateBookmarkParamsInit) {
    super(
      UpdateBookmarkParams,
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
  static fromDict(raw: unknown): UpdateBookmarkParams {
    return new UpdateBookmarkParams(
      prepareInit(
        UpdateBookmarkParams,
        raw,
      ) as unknown as UpdateBookmarkParamsInit,
    );
  }
}

/**
 * Constructor input for {@link BulkUpdateBookmarkEntry} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface BulkUpdateBookmarkEntryInit {
  /** Bookmark ID to update (required). */
  readonly id: number;
  /** New bookmark name. */
  readonly name?: string | null | undefined;
  /** New query parameters. */
  readonly params?: Readonly<Record<string, unknown>> | null | undefined;
  /** New bookmark description. */
  readonly description?: string | null | undefined;
  /** New bookmark icon. */
  readonly icon?: string | null | undefined;
  /** New visibility restriction. */
  readonly is_visibility_restricted?: boolean | null | undefined;
  /** New modification restriction. */
  readonly is_modification_restricted?: boolean | null | undefined;
}

/**
 * Entry for bulk-updating bookmarks.
 *
 * Mirror of Python `mixpanel_headless.types.BulkUpdateBookmarkEntry` (types.py:2660;
 * model_config: extra='ignore').
 */
export class BulkUpdateBookmarkEntry extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "BulkUpdateBookmarkEntry";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "id", required: true, kind: "int" },
    { name: "name", kind: "str", nullable: true },
    { name: "params", nullable: true },
    { name: "description", kind: "str", nullable: true },
    { name: "icon", kind: "str", nullable: true },
    { name: "is_visibility_restricted", kind: "bool", nullable: true },
    { name: "is_modification_restricted", kind: "bool", nullable: true },
  ];

  /** Bookmark ID to update (required). */
  declare readonly id: number;
  /** New bookmark name. */
  declare readonly name: string | null;
  /** New query parameters. */
  declare readonly params: Readonly<Record<string, unknown>> | null;
  /** New bookmark description. */
  declare readonly description: string | null;
  /** New bookmark icon. */
  declare readonly icon: string | null;
  /** New visibility restriction. */
  declare readonly is_visibility_restricted: boolean | null;
  /** New modification restriction. */
  declare readonly is_modification_restricted: boolean | null;

  /**
   * Construct a validated BulkUpdateBookmarkEntry (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: BulkUpdateBookmarkEntryInit) {
    super(
      BulkUpdateBookmarkEntry,
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
  static fromDict(raw: unknown): BulkUpdateBookmarkEntry {
    return new BulkUpdateBookmarkEntry(
      prepareInit(
        BulkUpdateBookmarkEntry,
        raw,
      ) as unknown as BulkUpdateBookmarkEntryInit,
    );
  }
}

/**
 * Constructor input for {@link BookmarkHistoryPagination} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface BookmarkHistoryPaginationInit {
  /** Cursor for next page. */
  readonly next_cursor?: string | null | undefined;
  /** Cursor for previous page. */
  readonly previous_cursor?: string | null | undefined;
  /** Number of items per page. */
  readonly page_size?: number | undefined;
}

/**
 * Pagination metadata for bookmark history responses.
 *
 * Mirror of Python `mixpanel_headless.types.BookmarkHistoryPagination` (types.py:2700;
 * model_config: frozen=True, extra='allow').
 */
export class BookmarkHistoryPagination extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "BookmarkHistoryPagination";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "next_cursor", kind: "str", nullable: true },
    { name: "previous_cursor", kind: "str", nullable: true },
    { name: "page_size", default: () => 0, kind: "int" },
  ];

  /** Cursor for next page. */
  declare readonly next_cursor: string | null;
  /** Cursor for previous page. */
  declare readonly previous_cursor: string | null;
  /** Number of items per page. */
  declare readonly page_size: number;

  /**
   * Construct a validated BookmarkHistoryPagination (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: BookmarkHistoryPaginationInit) {
    super(
      BookmarkHistoryPagination,
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
  static fromDict(raw: unknown): BookmarkHistoryPagination {
    return new BookmarkHistoryPagination(
      prepareInit(
        BookmarkHistoryPagination,
        raw,
      ) as unknown as BookmarkHistoryPaginationInit,
    );
  }
}

/**
 * Constructor input for {@link BookmarkHistoryResponse} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
 */
export interface BookmarkHistoryResponseInit {
  /** List of history entries. */
  readonly results?: readonly unknown[] | undefined;
  /** Pagination metadata. */
  readonly pagination?:
    | BookmarkHistoryPagination
    | Readonly<Record<string, unknown>>
    | null
    | undefined;
}

/**
 * Response from the bookmark history endpoint.
 *
 * Mirror of Python `mixpanel_headless.types.BookmarkHistoryResponse` (types.py:2726;
 * model_config: frozen=True, extra='allow').
 */
export class BookmarkHistoryResponse extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "BookmarkHistoryResponse";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "results", default: () => [] },
    {
      name: "pagination",
      nullable: true,
      nested: () => BookmarkHistoryPagination,
    },
  ];

  /** List of history entries. */
  declare readonly results: readonly unknown[];
  /** Pagination metadata. */
  declare readonly pagination: BookmarkHistoryPagination | null;

  /**
   * Construct a validated BookmarkHistoryResponse (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: BookmarkHistoryResponseInit) {
    super(
      BookmarkHistoryResponse,
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
  static fromDict(raw: unknown): BookmarkHistoryResponse {
    return new BookmarkHistoryResponse(
      prepareInit(
        BookmarkHistoryResponse,
        raw,
      ) as unknown as BookmarkHistoryResponseInit,
    );
  }
}

/**
 * Constructor input for {@link BookmarkUrl} — absent keys take the
 * Python defaults; `undefined` counts as absent (R4.10).
 */
export interface BookmarkUrlInit {
  /** The 12-character slug. */
  readonly slug: string;
  /** Report type (aliased from ``"type"``). */
  readonly bookmark_type: string;
  /** The raw query parameters stored under the slug (default `{}`). */
  readonly params?: Readonly<Record<string, unknown>> | undefined;
  /** Optional report name. */
  readonly name?: string | null | undefined;
  /** Optional report description. */
  readonly description?: string | null | undefined;
  /** Stored overrides (for example `originDashboard`). Never merged. */
  readonly overrides?: Readonly<Record<string, unknown>> | null | undefined;
  /** Project the record belongs to. */
  readonly project_id?: number | null | undefined;
  /** Creator id. */
  readonly user_id?: number | null | undefined;
  /** ISO timestamp from the server. */
  readonly created_at?: string | null | undefined;
  /** Saved-report reference, present only when the server did not expand it. */
  readonly bookmark_id?: number | null | undefined;
  /** The embedded saved report when one exists. */
  readonly bookmark?:
    Bookmark | Readonly<Record<string, unknown>> | null | undefined;
}

/**
 * The server record for an unsaved report, keyed by a 12-character slug
 * (045-report-links, Python PR #223).
 *
 * Returned by `GET /api/app/projects/{pid}/bookmark-urls/{slug}/`. The
 * `bookmark_type` field is aliased from `"type"` in the API response,
 * the same as {@link Bookmark}. When the record references a saved
 * report, the server replaces `bookmark_id` with the full `bookmark`.
 *
 * Mirror of Python `mixpanel_headless.types.BookmarkUrl` (model_config:
 * frozen=True, extra='allow', populate_by_name=True).
 */
export class BookmarkUrl extends EntityModel {
  /** @internal The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "BookmarkUrl";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "slug", required: true, kind: "str" },
    {
      name: "bookmark_type",
      required: true,
      aliases: ["type"],
      wire: "type",
      kind: "str",
    },
    { name: "params", default: (): Record<string, unknown> => ({}) },
    { name: "name", kind: "str", nullable: true },
    { name: "description", kind: "str", nullable: true },
    { name: "overrides", nullable: true },
    { name: "project_id", kind: "int", nullable: true },
    { name: "user_id", kind: "int", nullable: true },
    { name: "created_at", kind: "str", nullable: true },
    { name: "bookmark_id", kind: "int", nullable: true },
    { name: "bookmark", nullable: true, nested: () => Bookmark },
  ];

  /** The 12-character slug. */
  declare readonly slug: string;
  /** Report type (aliased from ``"type"``). */
  declare readonly bookmark_type: string;
  /** The raw query parameters stored under the slug. */
  declare readonly params: Readonly<Record<string, unknown>>;
  /** Optional report name. */
  declare readonly name: string | null;
  /** Optional report description. */
  declare readonly description: string | null;
  /** Stored overrides (for example `originDashboard`). Never merged. */
  declare readonly overrides: Readonly<Record<string, unknown>> | null;
  /** Project the record belongs to. */
  declare readonly project_id: number | null;
  /** Creator id. */
  declare readonly user_id: number | null;
  /** ISO timestamp from the server. */
  declare readonly created_at: string | null;
  /** Saved-report reference, present only when the server did not expand it. */
  declare readonly bookmark_id: number | null;
  /** The embedded saved report when one exists. */
  declare readonly bookmark: Bookmark | null;

  /**
   * Construct a validated BookmarkUrl (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws ResponseValidationError - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: BookmarkUrlInit) {
    super(BookmarkUrl, fields as unknown as Readonly<Record<string, unknown>>);
  }

  /**
   * Pydantic's `dict[str, Any]` annotation on `params` (and
   * `dict[str, Any] | None` on `overrides`) rejects non-mapping values;
   * the field-spec vocabulary has no bare dict guard, so the shape check
   * lives here (the `model_validator(mode="after")` slot).
   *
   * @throws ResponseValidationError - `params` / `overrides` is not a
   *   plain mapping.
   */
  protected override afterValidate(): void {
    if (!isPythonDict(this.params)) {
      modelFail("BookmarkUrl.params", "expected an object");
    }
    if (this.overrides !== null && !isPythonDict(this.overrides)) {
      modelFail("BookmarkUrl.overrides", "expected an object");
    }
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): BookmarkUrl {
    return new BookmarkUrl(
      prepareInit(BookmarkUrl, raw) as unknown as BookmarkUrlInit,
    );
  }
}
