/**
 * B6-W2 member module — the `Workspace` dashboard members
 * (`workspace.py:4502-5145`: DASHBOARD CRUD + DASHBOARD ADVANCED
 * OPERATIONS, Phase 024).
 *
 * Packet contract (`b6-packets.md` §2/§4): the `workspace.ts` B6-W2
 * section holds ONE-LINE delegations into this module; every member
 * here is a THIN facade body — options-bag mapping (R3.3/R3.8), the
 * params dump (W1-D4 {@link EntityModel.modelDumpExcludeNone}), the
 * like-named B4-C3 client method
 * (`services/entities/dashboards.ts`, composed onto the client at
 * `client.ts:1077+`) and result-model construction via
 * `validateResponseModel(s)` with the exact `endpoint=` string Python
 * passes. No request assembly, no header merging, no URL building, no
 * status branching (R10.8 — compose, never re-implement).
 *
 * Two Python guard shapes are ported verbatim:
 *
 * 1. `if raw is None: raise MixpanelHeadlessError("API returned empty
 *    response for X")` — default code `UNKNOWN_ERROR`
 *    (`exceptions.py` ctor default; packet Caution #8). The B4 client
 *    raises for a non-dict envelope BEFORE `None` can reach the
 *    facade, so this branch is unreachable through the wire in Python
 *    too; it is ported defensively and locked at the member seam
 *    (`crud-dashboards.test.ts`, `B6-W2-notes.md` §3).
 * 2. `add_report_to_dashboard`'s `not isinstance(raw, dict) or "id" not
 *    in raw` (`workspace.py:4832-4837`) — watchlist #13
 *    (`isPlainRecord`, never a `typeof` check) + R4.8
 *    (`Object.hasOwn`).
 */

import type { MixpanelClient } from "../client/client.js";
import { isPlainRecord } from "../client/internals.js";
import { toNativeJson } from "../client/json-value.js";
import {
  validateResponseModel,
  validateResponseModels,
} from "../client/response-validation.js";
import { pythonRepr, type PythonValue } from "../compat/python-str.js";
import { MixpanelHeadlessError } from "../errors.js";
import {
  BlueprintConfig,
  type BlueprintFinishParams,
  BlueprintTemplate,
  type CreateDashboardParams,
  type CreateRcaDashboardParams,
  Dashboard,
  type UpdateDashboardParams,
  type UpdateReportLinkParams,
  type UpdateTextCardParams,
} from "../types/entities/dashboards.js";
import { requireResponse } from "./shared.js";

/** Options bag of `Workspace.listDashboards` (`ids` is keyword-only). */
export interface WorkspaceListDashboardsOptions {
  /** Optional list of dashboard IDs to filter by (Python default `None`). */
  readonly ids?: readonly number[] | null | undefined;
}

/** Options bag of `Workspace.listBlueprintTemplates` (keyword-only). */
export interface WorkspaceListBlueprintTemplatesOptions {
  /** Whether to include report details (Python default `False`). */
  readonly include_reports?: boolean | undefined;
}

// `requireResponse` lives in `./shared.js` so every member module
// consumes ONE implementation; the native view is `toNativeJson` itself.

/**
 * List dashboards for the current project/workspace
 * (`list_dashboards`, `workspace.py:4506-4536`).
 *
 * @param client - The wire client.
 * @param options - Optional `ids` filter.
 * @returns The `Dashboard` models, in response order.
 * @throws ResponseValidationError - Malformed payload
 *   (`RESPONSE_VALIDATION_ERROR`).
 * @throws AuthenticationError | QueryError | ServerError - Wire
 *   failures per the B0 contract.
 */
export async function listDashboards(
  client: MixpanelClient,
  options: WorkspaceListDashboardsOptions = {},
): Promise<Dashboard[]> {
  const raw = await client.listDashboards({ ids: options.ids ?? null });
  return validateResponseModels(
    Dashboard,
    raw.map((item) => toNativeJson(item)),
    {
      endpoint: "list_dashboards",
    },
  );
}

/**
 * Create a new dashboard (`create_dashboard`,
 * `workspace.py:4538-4569`).
 *
 * @param client - The wire client.
 * @param params - Dashboard creation parameters.
 * @returns The newly created `Dashboard`.
 * @throws MixpanelHeadlessError - Empty response (`UNKNOWN_ERROR`).
 * @throws ResponseValidationError - Malformed payload.
 */
export async function createDashboard(
  client: MixpanelClient,
  params: CreateDashboardParams,
): Promise<Dashboard> {
  const raw: unknown = await client.createDashboard(
    params.modelDumpExcludeNone(),
  );
  return validateResponseModel(
    Dashboard,
    toNativeJson(requireResponse(raw, "create_dashboard")),
    { endpoint: "create_dashboard" },
  );
}

/**
 * Get a single dashboard by ID (`get_dashboard`,
 * `workspace.py:4571-4600`).
 *
 * @param client - The wire client.
 * @param dashboardId - Dashboard identifier.
 * @returns The `Dashboard`.
 * @throws MixpanelHeadlessError - Empty response (`UNKNOWN_ERROR`).
 * @throws ResponseValidationError - Malformed payload.
 */
export async function getDashboard(
  client: MixpanelClient,
  dashboardId: number,
): Promise<Dashboard> {
  const raw: unknown = await client.getDashboard(dashboardId);
  return validateResponseModel(
    Dashboard,
    toNativeJson(requireResponse(raw, "get_dashboard")),
    { endpoint: "get_dashboard" },
  );
}

/**
 * Update an existing dashboard (`update_dashboard`,
 * `workspace.py:4602-4638`).
 *
 * @param client - The wire client.
 * @param dashboardId - Dashboard identifier.
 * @param params - Fields to update.
 * @returns The updated `Dashboard`.
 * @throws MixpanelHeadlessError - Empty response (`UNKNOWN_ERROR`).
 * @throws ResponseValidationError - Malformed payload.
 */
export async function updateDashboard(
  client: MixpanelClient,
  dashboardId: number,
  params: UpdateDashboardParams,
): Promise<Dashboard> {
  const raw: unknown = await client.updateDashboard(
    dashboardId,
    params.modelDumpExcludeNone(),
  );
  return validateResponseModel(
    Dashboard,
    toNativeJson(requireResponse(raw, "update_dashboard")),
    { endpoint: "update_dashboard" },
  );
}

/**
 * Delete a dashboard (`delete_dashboard`, `workspace.py:4640-4659`).
 *
 * @param client - The wire client.
 * @param dashboardId - Dashboard identifier.
 * @returns Nothing.
 */
export async function deleteDashboard(
  client: MixpanelClient,
  dashboardId: number,
): Promise<void> {
  await client.deleteDashboard(dashboardId);
}

/**
 * Delete multiple dashboards (`bulk_delete_dashboards`,
 * `workspace.py:4661-4680`).
 *
 * @param client - The wire client.
 * @param ids - Dashboard IDs to delete.
 * @returns Nothing.
 */
export async function bulkDeleteDashboards(
  client: MixpanelClient,
  ids: readonly number[],
): Promise<void> {
  await client.bulkDeleteDashboards(ids);
}

/**
 * Favorite a dashboard (`favorite_dashboard`,
 * `workspace.py:4686-4705`).
 *
 * @param client - The wire client.
 * @param dashboardId - Dashboard identifier.
 * @returns Nothing.
 */
export async function favoriteDashboard(
  client: MixpanelClient,
  dashboardId: number,
): Promise<void> {
  await client.favoriteDashboard(dashboardId);
}

/**
 * Unfavorite a dashboard (`unfavorite_dashboard`,
 * `workspace.py:4707-4726`).
 *
 * @param client - The wire client.
 * @param dashboardId - Dashboard identifier.
 * @returns Nothing.
 */
export async function unfavoriteDashboard(
  client: MixpanelClient,
  dashboardId: number,
): Promise<void> {
  await client.unfavoriteDashboard(dashboardId);
}

/**
 * Pin a dashboard (`pin_dashboard`, `workspace.py:4728-4747`).
 *
 * @param client - The wire client.
 * @param dashboardId - Dashboard identifier.
 * @returns Nothing.
 */
export async function pinDashboard(
  client: MixpanelClient,
  dashboardId: number,
): Promise<void> {
  await client.pinDashboard(dashboardId);
}

/**
 * Unpin a dashboard (`unpin_dashboard`, `workspace.py:4749-4768`).
 *
 * @param client - The wire client.
 * @param dashboardId - Dashboard identifier.
 * @returns Nothing.
 */
export async function unpinDashboard(
  client: MixpanelClient,
  dashboardId: number,
): Promise<void> {
  await client.unpinDashboard(dashboardId);
}

/**
 * Remove a report from a dashboard (`remove_report_from_dashboard`,
 * `workspace.py:4770-4800`) — no empty-response guard in Python: the
 * payload goes straight into validation.
 *
 * @param client - The wire client.
 * @param dashboardId - Dashboard identifier.
 * @param bookmarkId - Bookmark/report identifier to remove.
 * @returns The updated `Dashboard`.
 * @throws ResponseValidationError - Malformed payload.
 */
export async function removeReportFromDashboard(
  client: MixpanelClient,
  dashboardId: number,
  bookmarkId: number,
): Promise<Dashboard> {
  const raw = await client.removeReportFromDashboard(dashboardId, bookmarkId);
  return validateResponseModel(Dashboard, toNativeJson(raw), {
    endpoint: "remove_report_from_dashboard",
  });
}

/**
 * Add a report to a dashboard (`add_report_to_dashboard`,
 * `workspace.py:4802-4841`).
 *
 * @param client - The wire client.
 * @param dashboardId - Dashboard identifier.
 * @param bookmarkId - Bookmark/report identifier to add.
 * @returns The updated `Dashboard`.
 * @throws MixpanelHeadlessError - The response is not a dashboard dict
 *   carrying `id` (`UNKNOWN_ERROR`).
 * @throws ResponseValidationError - Malformed payload.
 */
export async function addReportToDashboard(
  client: MixpanelClient,
  dashboardId: number,
  bookmarkId: number,
): Promise<Dashboard> {
  const raw: unknown = await client.addReportToDashboard(
    dashboardId,
    bookmarkId,
  );
  if (!isPlainRecord(raw) || !Object.hasOwn(raw, "id")) {
    throw new MixpanelHeadlessError(
      `Unexpected response from add_report_to_dashboard: ` +
        `expected dashboard dict with 'id', got ${pythonRepr(
          toNativeJson(raw) as PythonValue,
        )}`,
    );
  }
  return validateResponseModel(Dashboard, toNativeJson(raw), {
    endpoint: "add_report_to_dashboard",
  });
}

/**
 * List available dashboard blueprint templates
 * (`list_blueprint_templates`, `workspace.py:4841-4869`).
 *
 * @param client - The wire client.
 * @param options - `include_reports` (Python default `False`).
 * @returns The `BlueprintTemplate` models.
 * @throws ResponseValidationError - Malformed payload.
 */
export async function listBlueprintTemplates(
  client: MixpanelClient,
  options: WorkspaceListBlueprintTemplatesOptions = {},
): Promise<BlueprintTemplate[]> {
  const raw = await client.listBlueprintTemplates({
    include_reports: options.include_reports ?? false,
  });
  return validateResponseModels(
    BlueprintTemplate,
    raw.map((item) => toNativeJson(item)),
    {
      endpoint: "list_blueprint_templates",
    },
  );
}

/**
 * Create a dashboard from a blueprint template (`create_blueprint`,
 * `workspace.py:4871-4900`).
 *
 * @param client - The wire client.
 * @param templateType - Blueprint template type identifier.
 * @returns The newly created `Dashboard`.
 * @throws MixpanelHeadlessError - Empty response (`UNKNOWN_ERROR`).
 * @throws ResponseValidationError - Malformed payload.
 */
export async function createBlueprint(
  client: MixpanelClient,
  templateType: string,
): Promise<Dashboard> {
  const raw: unknown = await client.createBlueprint(templateType);
  return validateResponseModel(
    Dashboard,
    toNativeJson(requireResponse(raw, "create_blueprint")),
    { endpoint: "create_blueprint" },
  );
}

/**
 * Get the blueprint configuration for a dashboard
 * (`get_blueprint_config`, `workspace.py:4902-4933`).
 *
 * @param client - The wire client.
 * @param dashboardId - Dashboard identifier.
 * @returns The `BlueprintConfig`.
 * @throws MixpanelHeadlessError - Empty response (`UNKNOWN_ERROR`).
 * @throws ResponseValidationError - Malformed payload.
 */
export async function getBlueprintConfig(
  client: MixpanelClient,
  dashboardId: number,
): Promise<BlueprintConfig> {
  const raw: unknown = await client.getBlueprintConfig(dashboardId);
  return validateResponseModel(
    BlueprintConfig,
    toNativeJson(requireResponse(raw, "get_blueprint_config")),
    { endpoint: "get_blueprint_config" },
  );
}

/**
 * Update cohorts for blueprint configuration
 * (`update_blueprint_cohorts`, `workspace.py:4935-4954`).
 *
 * @param client - The wire client.
 * @param cohorts - Cohort configuration dicts.
 * @returns Nothing.
 */
export async function updateBlueprintCohorts(
  client: MixpanelClient,
  cohorts: ReadonlyArray<Record<string, unknown>>,
): Promise<void> {
  await client.updateBlueprintCohorts(cohorts);
}

/**
 * Finalize a blueprint dashboard with cards (`finalize_blueprint`,
 * `workspace.py:4956-4991`; `by_alias=True` dump at :4985).
 *
 * @param client - The wire client.
 * @param params - Blueprint finalization parameters.
 * @returns The finalized `Dashboard`.
 * @throws MixpanelHeadlessError - Empty response (`UNKNOWN_ERROR`).
 * @throws ResponseValidationError - Malformed payload.
 */
export async function finalizeBlueprint(
  client: MixpanelClient,
  params: BlueprintFinishParams,
): Promise<Dashboard> {
  const body = params.modelDumpExcludeNone({ byAlias: true });
  const raw: unknown = await client.finalizeBlueprint(body);
  return validateResponseModel(
    Dashboard,
    toNativeJson(requireResponse(raw, "finalize_blueprint")),
    { endpoint: "finalize_blueprint" },
  );
}

/**
 * Create an RCA (Root Cause Analysis) dashboard
 * (`create_rca_dashboard`, `workspace.py:4993-5028`; `by_alias=True`
 * dump at :5022).
 *
 * @param client - The wire client.
 * @param params - RCA dashboard parameters.
 * @returns The newly created `Dashboard`.
 * @throws MixpanelHeadlessError - Empty response (`UNKNOWN_ERROR`).
 * @throws ResponseValidationError - Malformed payload.
 */
export async function createRcaDashboard(
  client: MixpanelClient,
  params: CreateRcaDashboardParams,
): Promise<Dashboard> {
  const body = params.modelDumpExcludeNone({ byAlias: true });
  const raw: unknown = await client.createRcaDashboard(body);
  return validateResponseModel(
    Dashboard,
    toNativeJson(requireResponse(raw, "create_rca_dashboard")),
    { endpoint: "create_rca_dashboard" },
  );
}

/**
 * Dashboard IDs containing a bookmark/report
 * (`get_bookmark_dashboard_ids`, `workspace.py:5030-5052`) — returned
 * verbatim (Python performs no model validation here).
 *
 * @param client - The wire client.
 * @param bookmarkId - Bookmark identifier.
 * @returns The dashboard IDs.
 */
export async function getBookmarkDashboardIds(
  client: MixpanelClient,
  bookmarkId: number,
): Promise<number[]> {
  const raw = await client.getBookmarkDashboardIds(bookmarkId);
  return raw.map((item) => toNativeJson(item)) as number[];
}

/**
 * ERF data for a dashboard (`get_dashboard_erf`,
 * `workspace.py:5054-5076`) — returned verbatim.
 *
 * @param client - The wire client.
 * @param dashboardId - Dashboard identifier.
 * @returns The ERF mapping.
 */
export async function getDashboardErf(
  client: MixpanelClient,
  dashboardId: number,
): Promise<Record<string, unknown>> {
  const raw = await client.getDashboardErf(dashboardId);
  return toNativeJson(raw) as Record<string, unknown>;
}

/**
 * Update a report link on a dashboard (`update_report_link`,
 * `workspace.py:5078-5110`; `by_alias=True` dump at :5109).
 *
 * @param client - The wire client.
 * @param dashboardId - Dashboard identifier.
 * @param reportLinkId - Report link identifier.
 * @param params - Update parameters.
 * @returns Nothing.
 */
export async function updateReportLink(
  client: MixpanelClient,
  dashboardId: number,
  reportLinkId: number,
  params: UpdateReportLinkParams,
): Promise<void> {
  await client.updateReportLink(
    dashboardId,
    reportLinkId,
    params.modelDumpExcludeNone({ byAlias: true }),
  );
}

/**
 * Update a text card on a dashboard (`update_text_card`,
 * `workspace.py:5112-5145`) — plain `exclude_none` dump (NO
 * `by_alias`, unlike its report-link sibling).
 *
 * @param client - The wire client.
 * @param dashboardId - Dashboard identifier.
 * @param textCardId - Text card identifier.
 * @param params - Update parameters.
 * @returns Nothing.
 */
export async function updateTextCard(
  client: MixpanelClient,
  dashboardId: number,
  textCardId: number,
  params: UpdateTextCardParams,
): Promise<void> {
  await client.updateTextCard(
    dashboardId,
    textCardId,
    params.modelDumpExcludeNone(),
  );
}
