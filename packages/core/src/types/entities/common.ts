/**
 * Shared entity envelope models (PublicWorkspace, cursor pagination).
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
  prepareInit,
} from "./model-base.js";

/**
 * Constructor input for {@link PublicWorkspace} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface PublicWorkspaceInit {
  /** Workspace identifier. */
  readonly id: number;
  /** Human-readable workspace name. */
  readonly name: string;
  /** Parent project identifier. */
  readonly project_id: number;
  /** Whether this is the default workspace. */
  readonly is_default: boolean;
  /** Workspace description, if set. */
  readonly description?: string | null | undefined;
  /** Whether workspace is global. */
  readonly is_global?: boolean | null | undefined;
  /** Whether workspace has restrictions. */
  readonly is_restricted?: boolean | null | undefined;
  /** Whether workspace is visible. */
  readonly is_visible?: boolean | null | undefined;
  /** ISO 8601 creation timestamp. */
  readonly created_iso?: string | null | undefined;
  /** Name of workspace creator. */
  readonly creator_name?: string | null | undefined;
}

/**
 * A workspace within a Mixpanel project.
 *
 * @remarks Pydantic `extra='allow'`: unknown keys are kept on `__extras`.
 * @example
 * ```ts
 * const publicWorkspace = PublicWorkspace.fromDict({
 *   id: 42,
 *   name: "Growth",
 *   project_id: 123456,
 *   is_default: true,
 * });
 * publicWorkspace.id; // 42
 * ```
 * @see mixpanel_headless.types.PublicWorkspace
 */
export class PublicWorkspace extends EntityModel<PublicWorkspaceInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "PublicWorkspace";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<PublicWorkspaceInit> = [
    { name: "id", required: true, kind: "int" },
    { name: "name", required: true, kind: "str" },
    { name: "project_id", required: true, kind: "int" },
    { name: "is_default", required: true, kind: "bool" },
    { name: "description", kind: "str", nullable: true },
    { name: "is_global", kind: "bool", nullable: true },
    { name: "is_restricted", kind: "bool", nullable: true },
    { name: "is_visible", kind: "bool", nullable: true },
    { name: "created_iso", kind: "str", nullable: true },
    { name: "creator_name", kind: "str", nullable: true },
  ];

  /** Workspace identifier. */
  declare readonly id: number;
  /** Human-readable workspace name. */
  declare readonly name: string;
  /** Parent project identifier. */
  declare readonly project_id: number;
  /** Whether this is the default workspace. */
  declare readonly is_default: boolean;
  /** Workspace description, if set. */
  declare readonly description: string | null;
  /** Whether workspace is global. */
  declare readonly is_global: boolean | null;
  /** Whether workspace has restrictions. */
  declare readonly is_restricted: boolean | null;
  /** Whether workspace is visible. */
  declare readonly is_visible: boolean | null;
  /** ISO 8601 creation timestamp. */
  declare readonly created_iso: string | null;
  /** Name of workspace creator. */
  declare readonly creator_name: string | null;

  /**
   * Construct a validated PublicWorkspace (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: PublicWorkspaceInit) {
    super(PublicWorkspace, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): PublicWorkspace {
    return new PublicWorkspace(prepareInit(PublicWorkspace, raw));
  }
}

/**
 * Constructor input for {@link CursorPagination} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface CursorPaginationInit {
  /** Number of items per page. */
  readonly page_size: number;
  /** Cursor for next page (None = last page). */
  readonly next_cursor?: string | null | undefined;
  /** Cursor for previous page. */
  readonly previous_cursor?: string | null | undefined;
}

/**
 * Cursor-based pagination metadata from App API responses.
 *
 * @remarks Pydantic `extra='ignore'`: unknown keys are dropped.
 * @example
 * ```ts
 * const cursorPagination = CursorPagination.fromDict({
 *   page_size: 50,
 *   next_cursor: "example",
 * });
 * cursorPagination.page_size; // 50
 * ```
 * @see mixpanel_headless.types.CursorPagination
 */
export class CursorPagination extends EntityModel<CursorPaginationInit> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "CursorPagination";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<CursorPaginationInit> = [
    { name: "page_size", required: true, kind: "int" },
    { name: "next_cursor", kind: "str", nullable: true },
    { name: "previous_cursor", kind: "str", nullable: true },
  ];

  /** Number of items per page. */
  declare readonly page_size: number;
  /** Cursor for next page (None = last page). */
  declare readonly next_cursor: string | null;
  /** Cursor for previous page. */
  declare readonly previous_cursor: string | null;

  /**
   * Construct a validated CursorPagination (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: CursorPaginationInit) {
    super(CursorPagination, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): CursorPagination {
    return new CursorPagination(prepareInit(CursorPagination, raw));
  }
}

/**
 * Constructor input for {@link PaginatedResponse} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface PaginatedResponseInit<T> {
  /** Response status (typically "ok"). */
  readonly status: string;
  /** Page of results. */
  readonly results: readonly T[];
  /** Pagination metadata, or `null` for single-page responses. */
  readonly pagination?:
    CursorPagination | Readonly<Record<string, unknown>> | null | undefined;
}

/**
 * Paginated App API response wrapper.
 *
 * Generic over the item type exactly as Python's
 * `PaginatedResponse(BaseModel, Generic[T])`; items are not
 * reconstructed here (Python's `list[T]` erases at runtime too) — the
 * `paginateAll<T>` binding supplies typed items.
 *
 * @remarks Pydantic `extra='ignore'`: unknown keys are dropped.
 * @example
 * ```ts
 * const page = PaginatedResponse.fromDict({
 *   status: "ok",
 *   results: [{ id: 1 }, { id: 2 }],
 * });
 * page.results.length; // 2
 * ```
 * @see mixpanel_headless.types.PaginatedResponse
 */
export class PaginatedResponse<T = unknown> extends EntityModel<
  PaginatedResponseInit<T>
> {
  /** The Python model name (and `$type` tag where recorded). */
  static readonly modelName = "PaginatedResponse";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "ignore" as const;

  /** Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: EntityFieldSpecs<PaginatedResponseInit<unknown>> =
    [
      { name: "status", required: true, kind: "str" },
      { name: "results", required: true },
      { name: "pagination", nullable: true, nested: () => CursorPagination },
    ];

  /** Response status (typically "ok"). */
  declare readonly status: string;
  /** Page of results. */
  declare readonly results: readonly T[];
  /** Pagination metadata, or `null` for single-page responses. */
  declare readonly pagination: CursorPagination | null;

  /**
   * Construct a validated PaginatedResponse (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws {@link ResponseValidationError} - On missing/invalid fields per
   *   the Python model's validation.
   */
  constructor(fields: PaginatedResponseInit<T>) {
    super(PaginatedResponse, fields);
  }

  /**
   * Strict decode from a raw mapping (accepts the Pydantic
   * validation-alias set; `$type`/computed keys are dropped).
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance (items stay `unknown` — see
   *   the class doc).
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): PaginatedResponse {
    return new PaginatedResponse(prepareInit(PaginatedResponse, raw));
  }
}
