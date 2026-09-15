/**
 * B6-W3 member module — the `Workspace` bookmark/report and cohort
 * members (`workspace.py:5146-5748`: BOOKMARK/REPORT CRUD +
 * COHORT CRUD, Phase 024).
 *
 * Packet contract (`b6-packets.md` §2/§5): the `workspace.ts` B6-W3
 * section holds ONE-LINE delegations into this module; every member
 * here is a THIN facade body — options-bag mapping (R3.3/R3.8), the
 * params dump (W1-D4 {@link EntityModel.modelDumpExcludeNone}), the
 * like-named B4-C3 client method
 * (`services/entities/{bookmarks,cohorts}.ts`, composed onto the
 * client at `client.ts:1077+`) and result-model construction via
 * `validateResponseModel(s)` with the exact `endpoint=` string Python
 * passes. No request assembly, no header merging, no URL building, no
 * status branching (R10.8 — compose, never re-implement).
 *
 * The one more-than-forward body is the private
 * `_validate_bookmark_params_schema` (`workspace.py:5185-5245`),
 * ported here as {@link validateBookmarkParamsSchema}: it composes the
 * ALREADY-LIVE B2/B3 surfaces (`validateSortingBlock`,
 * `getRootModelForBookmarkType`, `PARTIAL_UPDATE_SUB_MODELS`,
 * `validateWithPydantic`) and adds no validation logic of its own.
 * `create_bookmark` / `update_bookmark` gate on it exactly as Python
 * does: raise {@link BookmarkValidationError} when any entry has
 * severity `"error"`, otherwise log each warning through the injected
 * logger seam (R9.5) and continue.
 *
 * Codes, not messages (R5): every code the gate can surface
 * (`S2_MISSING_COL_SORT_ATTRS`, `S3_UNKNOWN_FIELD`,
 * `S4_UNKNOWN_CHART_TYPE`, `B0_MISSING_FIELD`, …) comes from the B2/B3
 * validators unchanged.
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

/** The `logger.warning(...)` sink the two validating members use (R9.5). */
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
  /** Optional report-type filter, e.g. `"funnels"` (Python default `None`). */
  readonly bookmark_type?: string | null | undefined;
  /** Optional bookmark-ID filter (Python default `None`). */
  readonly ids?: readonly number[] | null | undefined;
}

/** Options bag of `Workspace.getBookmarkHistory` (keyword-only tail). */
export interface WorkspaceGetBookmarkHistoryOptions {
  /** Opaque pagination cursor (Python default `None`). */
  readonly cursor?: string | null | undefined;
  /** Maximum entries per page (Python default `None`). */
  readonly page_size?: number | null | undefined;
}

/** Options bag of `Workspace.listCohortsFull` (both keys keyword-only). */
export interface WorkspaceListCohortsFullOptions {
  /** Optional data-group filter (Python default `None`). */
  readonly data_group_id?: string | null | undefined;
  /** Optional cohort-ID filter (Python default `None`). */
  readonly ids?: readonly number[] | null | undefined;
}

/** Keyword-only arguments of {@link validateBookmarkParamsSchema}. */
export interface ValidateBookmarkParamsSchemaOptions {
  /**
   * Python `partial`: when `true` run per-key sub-model validation;
   * when `false` (default) run full root-model validation.
   */
  readonly partial?: boolean;
}

/**
 * Validate a bookmark `params` dict against the canonical schema
 * (`Workspace._validate_bookmark_params_schema`,
 * `workspace.py:5185-5245`).
 *
 * Two modes, exactly as Python: `partial=false` (create path)
 * validates the whole payload (minus `sorting`) against the root model
 * for `bookmarkType` when one exists; `partial=true` (update path)
 * validates each PRESENT top-level key against its canonical
 * sub-model, so legitimate partial updates are not false-rejected.
 * `sorting` always routes through `validateSortingBlock` so
 * `S4_UNKNOWN_CHART_TYPE` surfaces as a warning rather than a hard
 * `S3_UNKNOWN_FIELD`.
 *
 * @param raw - The bookmark `params` dict to validate.
 * @param bookmarkType - The bookmark type, or `null` when unknown
 *   (e.g. on update calls).
 * @param options - `partial` (keyword-only in Python).
 * @returns Validation errors AND warnings; empty when the payload
 *   validates cleanly.
 */
export function validateBookmarkParamsSchema(
  raw: Readonly<Record<string, unknown>>,
  bookmarkType: string | null,
  options: ValidateBookmarkParamsSchemaOptions = {},
): ValidationError[] {
  const partial = options.partial ?? false;
  const errors: ValidationError[] = [];

  // Sorting is always validated via the wrapper so unknown chart types
  // surface as S4 warnings, not S3 errors. Strip from raw so
  // root/sub-model validation doesn't double-validate it.
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
 * The `any(e.severity == "error" …)` gate the two validating members
 * share (`workspace.py:5299-5306`, `:5399-5406`).
 *
 * @param schemaErrors - The validator output.
 * @param member - Python member name used in the log line.
 * @param logger - The `logger.warning` sink (R9.5).
 * @throws BookmarkValidationError - Any entry has severity `"error"`.
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
 * List bookmarks/reports via the App API v2 endpoint
 * (`list_bookmarks_v2`, `workspace.py:5150-5183`).
 *
 * @param client - The wire client.
 * @param options - Optional `bookmark_type` / `ids` filters.
 * @returns The `Bookmark` models, in response order.
 * @throws ResponseValidationError - Malformed payload
 *   (`RESPONSE_VALIDATION_ERROR`).
 * @throws AuthenticationError | QueryError | ServerError - Wire
 *   failures per the B0 contract.
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
 * Create a new bookmark (saved report) (`create_bookmark`,
 * `workspace.py:5247-5324`).
 *
 * Three Python steps, in order: the `dashboard_id is None` guard, the
 * full client-side schema gate, then the create call followed by the
 * separate `add_report_to_dashboard` PATCH that puts the new report on
 * the dashboard's visual layout.
 *
 * @param client - The wire client.
 * @param params - Bookmark creation parameters.
 * @param addReportToDashboard - The facade's own
 *   `add_report_to_dashboard` member (`self.` dispatch preserved).
 * @param logger - The `logger.warning` sink (R9.5).
 * @returns The newly created `Bookmark`.
 * @throws MixpanelHeadlessError - `dashboard_id` missing, or an empty
 *   response (`UNKNOWN_ERROR`).
 * @throws BookmarkValidationError - `params.params` fails the
 *   client-side schema mirror (raised before any API call).
 * @throws ResponseValidationError - Malformed payload.
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
  // in the database, but does NOT add it to the dashboard's visual
  // layout — that requires a separate PATCH call.
  await addReportToDashboard(dashboardId, bookmark.id);

  return bookmark;
}

/**
 * Get a single bookmark by ID (`get_bookmark`,
 * `workspace.py:5326-5355`).
 *
 * @param client - The wire client.
 * @param bookmarkId - Bookmark identifier.
 * @returns The `Bookmark`.
 * @throws MixpanelHeadlessError - Empty response (`UNKNOWN_ERROR`).
 * @throws ResponseValidationError - Malformed payload.
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
 * Update an existing bookmark (`update_bookmark`,
 * `workspace.py:5357-5414`) — partial-aware schema gate first, then a
 * plain `exclude_none` dump (NO `by_alias`, unlike the create path).
 *
 * @param client - The wire client.
 * @param bookmarkId - Bookmark identifier.
 * @param params - Fields to update.
 * @param logger - The `logger.warning` sink (R9.5).
 * @returns The updated `Bookmark`.
 * @throws MixpanelHeadlessError - Empty response (`UNKNOWN_ERROR`).
 * @throws BookmarkValidationError - `params.params` (when supplied)
 *   fails partial-mode validation (raised before any API call).
 * @throws ResponseValidationError - Malformed payload.
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
 * Delete a bookmark (`delete_bookmark`, `workspace.py:5416-5435`).
 *
 * @param client - The wire client.
 * @param bookmarkId - Bookmark identifier.
 * @returns Nothing.
 */
export async function deleteBookmark(
  client: MixpanelClient,
  bookmarkId: number,
): Promise<void> {
  await client.deleteBookmark(bookmarkId);
}

/**
 * Delete multiple bookmarks (`bulk_delete_bookmarks`,
 * `workspace.py:5437-5456`).
 *
 * @param client - The wire client.
 * @param ids - Bookmark IDs to delete.
 * @returns Nothing.
 */
export async function bulkDeleteBookmarks(
  client: MixpanelClient,
  ids: readonly number[],
): Promise<void> {
  await client.bulkDeleteBookmarks(ids);
}

/**
 * Update multiple bookmarks (`bulk_update_bookmarks`,
 * `workspace.py:5458-5479`) — each entry dumped with `exclude_none`.
 *
 * @param client - The wire client.
 * @param entries - Bookmark update entries.
 * @returns Nothing.
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
 * Dashboard IDs linked to a bookmark (`bookmark_linked_dashboard_ids`,
 * `workspace.py:5481-5503`) — returned verbatim (Python performs no
 * model validation here).
 *
 * @param client - The wire client.
 * @param bookmarkId - Bookmark identifier.
 * @returns The dashboard IDs.
 */
export async function bookmarkLinkedDashboardIds(
  client: MixpanelClient,
  bookmarkId: number,
): Promise<number[]> {
  const raw = await client.bookmarkLinkedDashboardIds(bookmarkId);
  return raw.map((item) => toNativeJson(item)) as number[];
}

/**
 * Change history for a bookmark (`get_bookmark_history`,
 * `workspace.py:5505-5542`) — no empty-response guard in Python: the
 * client's re-shaped envelope goes straight into validation.
 *
 * @param client - The wire client.
 * @param bookmarkId - Bookmark identifier.
 * @param options - `cursor` / `page_size` (keyword-only in Python).
 * @returns The `BookmarkHistoryResponse`.
 * @throws ResponseValidationError - Malformed payload.
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
 * List cohorts via the App API, full detail (`list_cohorts_full`,
 * `workspace.py:5548-5584`) — note the client method is
 * `list_cohorts_app`, not a like-named twin.
 *
 * @param client - The wire client.
 * @param options - Optional `data_group_id` / `ids` filters.
 * @returns The `Cohort` models, in response order.
 * @throws ResponseValidationError - Malformed payload.
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
 * Get a single cohort by ID (`get_cohort`,
 * `workspace.py:5586-5615`).
 *
 * @param client - The wire client.
 * @param cohortId - Cohort identifier.
 * @returns The `Cohort`.
 * @throws MixpanelHeadlessError - Empty response (`UNKNOWN_ERROR`).
 * @throws ResponseValidationError - Malformed payload.
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
 * Create a new cohort (`create_cohort`, `workspace.py:5617-5648`) —
 * the `definition` dict flattens into the top level at dump time
 * (`_DefinitionFlatteningModel.model_dump`, `types.py:2865-2878`).
 *
 * @param client - The wire client.
 * @param params - Cohort creation parameters.
 * @returns The newly created `Cohort`.
 * @throws MixpanelHeadlessError - Empty response (`UNKNOWN_ERROR`).
 * @throws ResponseValidationError - Malformed payload.
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
 * Update an existing cohort (`update_cohort`,
 * `workspace.py:5650-5682`).
 *
 * @param client - The wire client.
 * @param cohortId - Cohort identifier.
 * @param params - Fields to update.
 * @returns The updated `Cohort`.
 * @throws MixpanelHeadlessError - Empty response (`UNKNOWN_ERROR`).
 * @throws ResponseValidationError - Malformed payload.
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
 * Delete a cohort (`delete_cohort`, `workspace.py:5684-5703`).
 *
 * @param client - The wire client.
 * @param cohortId - Cohort identifier.
 * @returns Nothing.
 */
export async function deleteCohort(
  client: MixpanelClient,
  cohortId: number,
): Promise<void> {
  await client.deleteCohort(cohortId);
}

/**
 * Delete multiple cohorts (`bulk_delete_cohorts`,
 * `workspace.py:5705-5724`).
 *
 * @param client - The wire client.
 * @param ids - Cohort IDs to delete.
 * @returns Nothing.
 */
export async function bulkDeleteCohorts(
  client: MixpanelClient,
  ids: readonly number[],
): Promise<void> {
  await client.bulkDeleteCohorts(ids);
}

/**
 * Update multiple cohorts (`bulk_update_cohorts`,
 * `workspace.py:5726-5747`) — each entry dumped with `exclude_none`
 * (definition flattened per entry).
 *
 * @param client - The wire client.
 * @param entries - Cohort update entries.
 * @returns Nothing.
 */
export async function bulkUpdateCohorts(
  client: MixpanelClient,
  entries: readonly BulkUpdateCohortEntry[],
): Promise<void> {
  await client.bulkUpdateCohorts(
    entries.map((entry) => entry.modelDumpExcludeNone()),
  );
}
