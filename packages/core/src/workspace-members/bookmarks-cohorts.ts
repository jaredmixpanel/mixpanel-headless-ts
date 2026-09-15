/**
 * Bookmark (saved report) and cohort members of the `Workspace` facade:
 * CRUD, bulk updates, history and dashboard links. Each function is the
 * body of one facade method — options-bag mapping, the params dump, the
 * like-named client call and result-model validation with the endpoint
 * name Python passes; the one member with logic of its own is
 * {@link validateBookmarkParamsSchema}, the network-free schema gate the
 * create and update paths run first. No request assembly, header
 * merging, URL building or status branching happens here.
 *
 * @see mixpanel_headless.workspace.Workspace
 */

import {
  getRootModelForBookmarkType,
  PARTIAL_UPDATE_SUB_MODELS,
} from "../bookmarks/schema.js";
import { validateWithPydantic } from "../bookmarks/schema-sorting.js";
import type { MixpanelClient } from "../client/client.js";
import { toNativeJson } from "../client/json-value.js";
import {
  validateResponseModel,
  validateResponseModels,
} from "../client/response-validation.js";
import { setOwn } from "../compat/python-dict.js";
import {
  BookmarkValidationError,
  MixpanelHeadlessError,
  type ValidationError,
} from "../errors.js";
import { validateSortingBlock } from "../query/validation-bookmark.js";
import {
  Bookmark,
  BookmarkHistoryResponse,
  type BulkUpdateBookmarkEntry,
  type CreateBookmarkParams,
  type UpdateBookmarkParams,
} from "../types/entities/bookmarks.js";
import {
  type BulkUpdateCohortEntry,
  Cohort,
  type CreateCohortParams,
  type UpdateCohortParams,
} from "../types/entities/cohorts.js";
import { requireResponse } from "./shared.js";

/** The `logger.warning(...)` sink the two validating members use. */
export interface BookmarkWarningLogger {
  /**
   * Record a warning message.
   *
   * @param message - The formatted text (never vector-compared).
   */
  warning?: (message: string) => void;
}

/** Options bag of `Workspace.listBookmarksV2` (both keys keyword-only). */
export interface WorkspaceListBookmarksV2Options {
  /**
   * Report-type filter, e.g. `"funnels"`.
   *
   * @defaultValue `null` (every type)
   */
  readonly bookmark_type?: string | null | undefined;
  /**
   * Restrict the listing to these bookmark ids.
   *
   * @defaultValue `null` (every bookmark)
   */
  readonly ids?: readonly number[] | null | undefined;
}

/** Options bag of `Workspace.getBookmarkHistory` (keyword-only tail). */
export interface WorkspaceGetBookmarkHistoryOptions {
  /**
   * Opaque pagination cursor from a previous page.
   *
   * @defaultValue `null` (first page)
   */
  readonly cursor?: string | null | undefined;
  /**
   * Maximum entries per page.
   *
   * @defaultValue `null` (server default)
   */
  readonly page_size?: number | null | undefined;
}

/** Options bag of `Workspace.listCohortsFull` (both keys keyword-only). */
export interface WorkspaceListCohortsFullOptions {
  /**
   * Data-group filter.
   *
   * @defaultValue `null` (every data group)
   */
  readonly data_group_id?: string | null | undefined;
  /**
   * Restrict the listing to these cohort ids.
   *
   * @defaultValue `null` (every cohort)
   */
  readonly ids?: readonly number[] | null | undefined;
}

/** Keyword-only arguments of {@link validateBookmarkParamsSchema}. */
export interface ValidateBookmarkParamsSchemaOptions {
  /**
   * Validate each present top-level key against its sub-model (the
   * update path) instead of the whole payload against the root model.
   *
   * @defaultValue `false`
   */
  readonly partial?: boolean;
}

/**
 * Validate a bookmark `params` dict against the canonical schema without
 * touching the network.
 *
 * @remarks
 * Two modes, as in Python: `partial: false` (the create path) validates
 * the whole payload minus `sorting` against the root model of
 * `bookmarkType` when one exists; `partial: true` (the update path)
 * validates each present top-level key against its canonical sub-model,
 * so legitimate partial updates are not falsely rejected. `sorting`
 * always routes through `validateSortingBlock` so `S4_UNKNOWN_CHART_TYPE`
 * surfaces as a warning rather than a hard `S3_UNKNOWN_FIELD`. The
 * function composes the bookmark validators and adds no rules of its
 * own, so every code it returns is theirs unchanged.
 * @param raw - The bookmark `params` dict to validate.
 * @param bookmarkType - The bookmark type, or `null` when unknown
 *   (e.g. on update calls).
 * @param options - `partial` (keyword-only in Python).
 * @returns Validation errors and warnings; empty when the payload
 *   validates cleanly.
 * @example
 * ```typescript
 * const issues = validateBookmarkParamsSchema(draft.params, "insights");
 * const blocking = issues.filter((issue) => issue.severity === "error");
 * ```
 * @see mixpanel_headless.workspace.Workspace._validate_bookmark_params_schema
 */
export function validateBookmarkParamsSchema(
  raw: Readonly<Record<string, unknown>>,
  bookmarkType: string | null,
  options: ValidateBookmarkParamsSchemaOptions = {},
): ValidationError[] {
  const partial = options.partial ?? false;
  const errors: ValidationError[] = [];

  // Sorting is always validated through the wrapper so unknown chart
  // types surface as warnings, not errors; it is stripped from `raw` so
  // root/sub-model validation does not validate it twice.
  const sorting = Object.hasOwn(raw, "sorting") ? raw["sorting"] : undefined;
  if (sorting !== undefined && sorting !== null) {
    errors.push(...validateSortingBlock(sorting));
  }
  const rawNoSorting: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key !== "sorting") {
      setOwn(rawNoSorting, key, value);
    }
  }

  if (!partial && bookmarkType !== null) {
    const root = getRootModelForBookmarkType(bookmarkType);
    if (root !== null) {
      errors.push(...validateWithPydantic(root.validate, rawNoSorting));
      return errors;
    }
  }

  // Partial mode (or unknown root): per-key sub-model validation.
  for (const [key, model] of PARTIAL_UPDATE_SUB_MODELS) {
    if (Object.hasOwn(rawNoSorting, key)) {
      errors.push(
        ...validateWithPydantic(model.validate, rawNoSorting[key], {
          path_prefix: key,
        }),
      );
    }
  }
  return errors;
}

/**
 * Raise on the first blocking schema issue and log the rest, the
 * `any(e.severity == "error" …)` gate the two validating members share.
 *
 * @param schemaErrors - The validator output.
 * @param member - Python member name used in the log line.
 * @param logger - The `logger.warning` sink.
 * @throws {@link BookmarkValidationError} - Any entry has severity `"error"`.
 */
function gateSchemaErrors(
  schemaErrors: readonly ValidationError[],
  member: string,
  logger: BookmarkWarningLogger | undefined,
): void {
  if (schemaErrors.some((e) => e.severity === "error")) {
    throw new BookmarkValidationError(schemaErrors);
  }
  for (const warning of schemaErrors) {
    if (warning.severity === "warning") {
      logger?.warning?.(
        `${member} validation warning: ${warning.message} [${warning.code}]`,
      );
    }
  }
}

/**
 * List bookmarks/reports via the App API v2 endpoint.
 *
 * @param client - The wire client.
 * @param options - Optional `bookmark_type` / `ids` filters.
 * @returns The `Bookmark` models, in response order.
 * @throws {@link ResponseValidationError} - Malformed payload
 *   (`RESPONSE_VALIDATION_ERROR`).
 * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
 *   failures.
 * @example
 * ```typescript
 * const funnels = await ws.listBookmarksV2({ bookmark_type: "funnels" });
 * ```
 * @see mixpanel_headless.workspace.Workspace.list_bookmarks_v2
 */
export async function listBookmarksV2(
  client: MixpanelClient,
  options: WorkspaceListBookmarksV2Options = {},
): Promise<Bookmark[]> {
  const raw = await client.listBookmarksV2({
    bookmark_type: options.bookmark_type ?? null,
    ids: options.ids ?? null,
  });
  return validateResponseModels(
    Bookmark,
    raw.map((item) => toNativeJson(item)),
    {
      endpoint: "list_bookmarks_v2",
    },
  );
}

/**
 * Create a new bookmark (saved report) and place it on its dashboard.
 *
 * @remarks
 * Three steps, in Python's order: the `dashboard_id` guard, the full
 * client-side schema gate, then the create call followed by the separate
 * `add_report_to_dashboard` PATCH — the v2 create endpoint associates the
 * bookmark with the dashboard but does not add it to the visual layout.
 * @param client - The wire client.
 * @param params - Bookmark creation parameters.
 * @param addReportToDashboard - The facade's own
 *   `addReportToDashboard` member (Python dispatches through `self`).
 * @param logger - The `logger.warning` sink.
 * @returns The newly created `Bookmark`.
 * @throws {@link MixpanelHeadlessError} - `dashboard_id` missing, or an
 *   empty response (`UNKNOWN_ERROR`).
 * @throws {@link BookmarkValidationError} - `params.params` fails the
 *   client-side schema mirror (raised before any API call).
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const bookmark = await ws.createBookmark(
 *   new CreateBookmarkParams({
 *     name: "Signups",
 *     bookmark_type: "insights",
 *     params,
 *     dashboard_id: 12,
 *   }),
 * );
 * ```
 * @see mixpanel_headless.workspace.Workspace.create_bookmark
 */
export async function createBookmark(
  client: MixpanelClient,
  params: CreateBookmarkParams,
  addReportToDashboard: (
    dashboardId: number,
    bookmarkId: number,
  ) => Promise<unknown>,
  logger?: BookmarkWarningLogger,
): Promise<Bookmark> {
  const dashboardId = params.dashboard_id;
  if (dashboardId === null) {
    throw new MixpanelHeadlessError(
      "dashboard_id is required when creating a bookmark. " +
        "The Mixpanel v2 API requires every bookmark to be " +
        "associated with a dashboard. Create a dashboard first " +
        "with create_dashboard(), then pass its ID here.",
    );
  }

  gateSchemaErrors(
    validateBookmarkParamsSchema(params.params, params.bookmark_type),
    "create_bookmark",
    logger,
  );

  const raw: unknown = await client.createBookmark(
    params.modelDumpExcludeNone({ byAlias: true }),
  );
  const bookmark = validateResponseModel(
    Bookmark,
    toNativeJson(requireResponse(raw, "create_bookmark")),
    { endpoint: "create_bookmark" },
  );

  // The v2 create endpoint associates the bookmark with the dashboard
  // in the database but does not add it to the dashboard's visual
  // layout; that takes a separate PATCH.
  await addReportToDashboard(dashboardId, bookmark.id);

  return bookmark;
}

/**
 * Fetch a single bookmark by id.
 *
 * @param client - The wire client.
 * @param bookmarkId - Bookmark identifier.
 * @returns The `Bookmark`.
 * @throws {@link MixpanelHeadlessError} - Empty response (`UNKNOWN_ERROR`).
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const bookmark = await ws.getBookmark(987);
 * ```
 * @see mixpanel_headless.workspace.Workspace.get_bookmark
 */
export async function getBookmark(
  client: MixpanelClient,
  bookmarkId: number,
): Promise<Bookmark> {
  const raw: unknown = await client.getBookmark(bookmarkId);
  return validateResponseModel(
    Bookmark,
    toNativeJson(requireResponse(raw, "get_bookmark")),
    { endpoint: "get_bookmark" },
  );
}

/**
 * Update an existing bookmark: the partial-mode schema gate first, then
 * a plain `exclude_none` dump (no `by_alias`, unlike the create path).
 *
 * @param client - The wire client.
 * @param bookmarkId - Bookmark identifier.
 * @param params - Fields to update.
 * @param logger - The `logger.warning` sink.
 * @returns The updated `Bookmark`.
 * @throws {@link MixpanelHeadlessError} - Empty response (`UNKNOWN_ERROR`).
 * @throws {@link BookmarkValidationError} - `params.params` (when
 *   supplied) fails partial-mode validation (raised before any API call).
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * await ws.updateBookmark(987, new UpdateBookmarkParams({ name: "Renamed" }));
 * ```
 * @see mixpanel_headless.workspace.Workspace.update_bookmark
 */
export async function updateBookmark(
  client: MixpanelClient,
  bookmarkId: number,
  params: UpdateBookmarkParams,
  logger?: BookmarkWarningLogger,
): Promise<Bookmark> {
  if (params.params !== null) {
    gateSchemaErrors(
      validateBookmarkParamsSchema(params.params, null, { partial: true }),
      "update_bookmark",
      logger,
    );
  }

  const raw: unknown = await client.updateBookmark(
    bookmarkId,
    params.modelDumpExcludeNone(),
  );
  return validateResponseModel(
    Bookmark,
    toNativeJson(requireResponse(raw, "update_bookmark")),
    { endpoint: "update_bookmark" },
  );
}

/**
 * Delete a bookmark.
 *
 * @param client - The wire client.
 * @param bookmarkId - Bookmark identifier.
 * @returns Nothing.
 * @example
 * ```typescript
 * await ws.deleteBookmark(987);
 * ```
 * @see mixpanel_headless.workspace.Workspace.delete_bookmark
 */
export async function deleteBookmark(
  client: MixpanelClient,
  bookmarkId: number,
): Promise<void> {
  await client.deleteBookmark(bookmarkId);
}

/**
 * Delete multiple bookmarks.
 *
 * @param client - The wire client.
 * @param ids - Bookmark IDs to delete.
 * @returns Nothing.
 * @example
 * ```typescript
 * await ws.bulkDeleteBookmarks([987, 988]);
 * ```
 * @see mixpanel_headless.workspace.Workspace.bulk_delete_bookmarks
 */
export async function bulkDeleteBookmarks(
  client: MixpanelClient,
  ids: readonly number[],
): Promise<void> {
  await client.bulkDeleteBookmarks(ids);
}

/**
 * Update multiple bookmarks in one call; each entry is dumped with
 * `exclude_none`.
 *
 * @param client - The wire client.
 * @param entries - Bookmark update entries.
 * @returns Nothing.
 * @example
 * ```typescript
 * await ws.bulkUpdateBookmarks([
 *   new BulkUpdateBookmarkEntry({ id: 987, name: "Renamed" }),
 * ]);
 * ```
 * @see mixpanel_headless.workspace.Workspace.bulk_update_bookmarks
 */
export async function bulkUpdateBookmarks(
  client: MixpanelClient,
  entries: readonly BulkUpdateBookmarkEntry[],
): Promise<void> {
  await client.bulkUpdateBookmarks(
    entries.map((entry) => entry.modelDumpExcludeNone()),
  );
}

/**
 * List the ids of the dashboards linked to a bookmark, verbatim (Python
 * performs no model validation here).
 *
 * @param client - The wire client.
 * @param bookmarkId - Bookmark identifier.
 * @returns The dashboard IDs.
 * @example
 * ```typescript
 * const dashboardIds = await ws.bookmarkLinkedDashboardIds(987);
 * ```
 * @see mixpanel_headless.workspace.Workspace.bookmark_linked_dashboard_ids
 */
export async function bookmarkLinkedDashboardIds(
  client: MixpanelClient,
  bookmarkId: number,
): Promise<number[]> {
  const raw = await client.bookmarkLinkedDashboardIds(bookmarkId);
  return raw.map((item) => toNativeJson(item)) as number[];
}

/**
 * Fetch a page of a bookmark's change history. There is no
 * empty-response guard: the client's re-shaped envelope goes straight
 * into validation.
 *
 * @param client - The wire client.
 * @param bookmarkId - Bookmark identifier.
 * @param options - `cursor` / `page_size` (keyword-only in Python).
 * @returns The `BookmarkHistoryResponse`.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const page = await ws.getBookmarkHistory(987, { page_size: 20 });
 * ```
 * @see mixpanel_headless.workspace.Workspace.get_bookmark_history
 */
export async function getBookmarkHistory(
  client: MixpanelClient,
  bookmarkId: number,
  options: WorkspaceGetBookmarkHistoryOptions = {},
): Promise<BookmarkHistoryResponse> {
  const raw = await client.getBookmarkHistory(bookmarkId, {
    cursor: options.cursor ?? null,
    page_size: options.page_size ?? null,
  });
  return validateResponseModel(BookmarkHistoryResponse, toNativeJson(raw), {
    endpoint: "get_bookmark_history",
  });
}

/**
 * List cohorts through the App API with full detail. The client method
 * is `listCohortsApp`, not a like-named twin.
 *
 * @param client - The wire client.
 * @param options - Optional `data_group_id` / `ids` filters.
 * @returns The `Cohort` models, in response order.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const cohorts = await ws.listCohortsFull({ ids: [5, 6] });
 * ```
 * @see mixpanel_headless.workspace.Workspace.list_cohorts_full
 */
export async function listCohortsFull(
  client: MixpanelClient,
  options: WorkspaceListCohortsFullOptions = {},
): Promise<Cohort[]> {
  const raw = await client.listCohortsApp({
    data_group_id: options.data_group_id ?? null,
    ids: options.ids ?? null,
  });
  return validateResponseModels(
    Cohort,
    raw.map((item) => toNativeJson(item)),
    {
      endpoint: "list_cohorts_full",
    },
  );
}

/**
 * Fetch a single cohort by id.
 *
 * @param client - The wire client.
 * @param cohortId - Cohort identifier.
 * @returns The `Cohort`.
 * @throws {@link MixpanelHeadlessError} - Empty response (`UNKNOWN_ERROR`).
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const cohort = await ws.getCohort(5);
 * ```
 * @see mixpanel_headless.workspace.Workspace.get_cohort
 */
export async function getCohort(
  client: MixpanelClient,
  cohortId: number,
): Promise<Cohort> {
  const raw: unknown = await client.getCohort(cohortId);
  return validateResponseModel(
    Cohort,
    toNativeJson(requireResponse(raw, "get_cohort")),
    { endpoint: "get_cohort" },
  );
}

/**
 * Create a new cohort. The `definition` dict flattens into the top level
 * of the body at dump time.
 *
 * @param client - The wire client.
 * @param params - Cohort creation parameters.
 * @returns The newly created `Cohort`.
 * @throws {@link MixpanelHeadlessError} - Empty response (`UNKNOWN_ERROR`).
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const cohort = await ws.createCohort(
 *   new CreateCohortParams({ name: "Power users", definition }),
 * );
 * ```
 * @see mixpanel_headless.workspace.Workspace.create_cohort
 */
export async function createCohort(
  client: MixpanelClient,
  params: CreateCohortParams,
): Promise<Cohort> {
  const raw: unknown = await client.createCohort(params.modelDumpExcludeNone());
  return validateResponseModel(
    Cohort,
    toNativeJson(requireResponse(raw, "create_cohort")),
    { endpoint: "create_cohort" },
  );
}

/**
 * Update an existing cohort.
 *
 * @param client - The wire client.
 * @param cohortId - Cohort identifier.
 * @param params - Fields to update.
 * @returns The updated `Cohort`.
 * @throws {@link MixpanelHeadlessError} - Empty response (`UNKNOWN_ERROR`).
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * await ws.updateCohort(5, new UpdateCohortParams({ description: "Weekly actives" }));
 * ```
 * @see mixpanel_headless.workspace.Workspace.update_cohort
 */
export async function updateCohort(
  client: MixpanelClient,
  cohortId: number,
  params: UpdateCohortParams,
): Promise<Cohort> {
  const raw: unknown = await client.updateCohort(
    cohortId,
    params.modelDumpExcludeNone(),
  );
  return validateResponseModel(
    Cohort,
    toNativeJson(requireResponse(raw, "update_cohort")),
    { endpoint: "update_cohort" },
  );
}

/**
 * Delete a cohort.
 *
 * @param client - The wire client.
 * @param cohortId - Cohort identifier.
 * @returns Nothing.
 * @example
 * ```typescript
 * await ws.deleteCohort(5);
 * ```
 * @see mixpanel_headless.workspace.Workspace.delete_cohort
 */
export async function deleteCohort(
  client: MixpanelClient,
  cohortId: number,
): Promise<void> {
  await client.deleteCohort(cohortId);
}

/**
 * Delete multiple cohorts.
 *
 * @param client - The wire client.
 * @param ids - Cohort IDs to delete.
 * @returns Nothing.
 * @example
 * ```typescript
 * await ws.bulkDeleteCohorts([5, 6]);
 * ```
 * @see mixpanel_headless.workspace.Workspace.bulk_delete_cohorts
 */
export async function bulkDeleteCohorts(
  client: MixpanelClient,
  ids: readonly number[],
): Promise<void> {
  await client.bulkDeleteCohorts(ids);
}

/**
 * Update multiple cohorts in one call; each entry is dumped with
 * `exclude_none` and its definition flattened.
 *
 * @param client - The wire client.
 * @param entries - Cohort update entries.
 * @returns Nothing.
 * @example
 * ```typescript
 * await ws.bulkUpdateCohorts([
 *   new BulkUpdateCohortEntry({ id: 5, name: "Renamed" }),
 * ]);
 * ```
 * @see mixpanel_headless.workspace.Workspace.bulk_update_cohorts
 */
export async function bulkUpdateCohorts(
  client: MixpanelClient,
  entries: readonly BulkUpdateCohortEntry[],
): Promise<void> {
  await client.bulkUpdateCohorts(
    entries.map((entry) => entry.modelDumpExcludeNone()),
  );
}
