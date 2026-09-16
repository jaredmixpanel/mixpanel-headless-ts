/**
 * Dashboard members of the `Workspace` facade: dashboard CRUD, favorites
 * and pins, report placement, blueprints and RCA dashboards, and the
 * report-link / text-card updates. Each function is the body of one
 * facade method — options-bag mapping, the params dump, the like-named
 * client call and result-model validation with the endpoint name Python
 * passes. No request assembly, header merging, URL building or status
 * branching happens here; the wire client owns those.
 *
 * @see mixpanel_headless.workspace.Workspace
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
  /**
   * Restrict the listing to these dashboard ids.
   *
   * @defaultValue `null` (every dashboard)
   */
  readonly ids?: readonly number[] | null | undefined;
}

/** Options bag of `Workspace.listBlueprintTemplates` (keyword-only). */
export interface WorkspaceListBlueprintTemplatesOptions {
  /**
   * Include each template's report details.
   *
   * @defaultValue `false`
   */
  readonly include_reports?: boolean | undefined;
}

/**
 * List dashboards for the current project/workspace.
 *
 * @param client - The wire client.
 * @param options - Optional `ids` filter.
 * @returns The `Dashboard` models, in response order.
 * @throws {@link ResponseValidationError} - Malformed payload
 *   (`RESPONSE_VALIDATION_ERROR`).
 * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
 *   failures.
 * @example
 * ```typescript
 * const dashboards = await ws.listDashboards({ ids: [12, 34] });
 * ```
 * @see mixpanel_headless.workspace.Workspace.list_dashboards
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
 * Create a new dashboard.
 *
 * @param client - The wire client.
 * @param params - Dashboard creation parameters.
 * @returns The newly created `Dashboard`.
 * @throws {@link MixpanelHeadlessError} - Empty response (`UNKNOWN_ERROR`).
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const dash = await ws.createDashboard(
 *   new CreateDashboardParams({ title: "Activation" }),
 * );
 * ```
 * @see mixpanel_headless.workspace.Workspace.create_dashboard
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
 * Fetch a single dashboard by id.
 *
 * @param client - The wire client.
 * @param dashboardId - Dashboard identifier.
 * @returns The `Dashboard`.
 * @throws {@link MixpanelHeadlessError} - Empty response (`UNKNOWN_ERROR`).
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const dash = await ws.getDashboard(12);
 * ```
 * @see mixpanel_headless.workspace.Workspace.get_dashboard
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
 * Update an existing dashboard.
 *
 * @param client - The wire client.
 * @param dashboardId - Dashboard identifier.
 * @param params - Fields to update.
 * @returns The updated `Dashboard`.
 * @throws {@link MixpanelHeadlessError} - Empty response (`UNKNOWN_ERROR`).
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * await ws.updateDashboard(12, new UpdateDashboardParams({ title: "Renamed" }));
 * ```
 * @see mixpanel_headless.workspace.Workspace.update_dashboard
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
 * Delete a dashboard.
 *
 * @param client - The wire client.
 * @param dashboardId - Dashboard identifier.
 * @returns Nothing.
 * @example
 * ```typescript
 * await ws.deleteDashboard(12);
 * ```
 * @see mixpanel_headless.workspace.Workspace.delete_dashboard
 */
export async function deleteDashboard(
  client: MixpanelClient,
  dashboardId: number,
): Promise<void> {
  await client.deleteDashboard(dashboardId);
}

/**
 * Delete multiple dashboards.
 *
 * @param client - The wire client.
 * @param ids - Dashboard IDs to delete.
 * @returns Nothing.
 * @example
 * ```typescript
 * await ws.bulkDeleteDashboards([12, 34]);
 * ```
 * @see mixpanel_headless.workspace.Workspace.bulk_delete_dashboards
 */
export async function bulkDeleteDashboards(
  client: MixpanelClient,
  ids: readonly number[],
): Promise<void> {
  await client.bulkDeleteDashboards(ids);
}

/**
 * Favorite a dashboard.
 *
 * @param client - The wire client.
 * @param dashboardId - Dashboard identifier.
 * @returns Nothing.
 * @example
 * ```typescript
 * await ws.favoriteDashboard(12);
 * ```
 * @see mixpanel_headless.workspace.Workspace.favorite_dashboard
 */
export async function favoriteDashboard(
  client: MixpanelClient,
  dashboardId: number,
): Promise<void> {
  await client.favoriteDashboard(dashboardId);
}

/**
 * Unfavorite a dashboard.
 *
 * @param client - The wire client.
 * @param dashboardId - Dashboard identifier.
 * @returns Nothing.
 * @example
 * ```typescript
 * await ws.unfavoriteDashboard(12);
 * ```
 * @see mixpanel_headless.workspace.Workspace.unfavorite_dashboard
 */
export async function unfavoriteDashboard(
  client: MixpanelClient,
  dashboardId: number,
): Promise<void> {
  await client.unfavoriteDashboard(dashboardId);
}

/**
 * Pin a dashboard.
 *
 * @param client - The wire client.
 * @param dashboardId - Dashboard identifier.
 * @returns Nothing.
 * @example
 * ```typescript
 * await ws.pinDashboard(12);
 * ```
 * @see mixpanel_headless.workspace.Workspace.pin_dashboard
 */
export async function pinDashboard(
  client: MixpanelClient,
  dashboardId: number,
): Promise<void> {
  await client.pinDashboard(dashboardId);
}

/**
 * Unpin a dashboard.
 *
 * @param client - The wire client.
 * @param dashboardId - Dashboard identifier.
 * @returns Nothing.
 * @example
 * ```typescript
 * await ws.unpinDashboard(12);
 * ```
 * @see mixpanel_headless.workspace.Workspace.unpin_dashboard
 */
export async function unpinDashboard(
  client: MixpanelClient,
  dashboardId: number,
): Promise<void> {
  await client.unpinDashboard(dashboardId);
}

/**
 * Remove a report from a dashboard. Unlike its siblings there is no
 * empty-response guard: the payload goes straight into validation.
 *
 * @param client - The wire client.
 * @param dashboardId - Dashboard identifier.
 * @param bookmarkId - Bookmark/report identifier to remove.
 * @returns The updated `Dashboard`.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const dash = await ws.removeReportFromDashboard(12, 987);
 * ```
 * @see mixpanel_headless.workspace.Workspace.remove_report_from_dashboard
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
 * Add a report to a dashboard.
 *
 * @param client - The wire client.
 * @param dashboardId - Dashboard identifier.
 * @param bookmarkId - Bookmark/report identifier to add.
 * @returns The updated `Dashboard`.
 * @throws {@link MixpanelHeadlessError} - The response is not a dashboard
 *   dict carrying `id` (`UNKNOWN_ERROR`).
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const dash = await ws.addReportToDashboard(12, 987);
 * ```
 * @see mixpanel_headless.workspace.Workspace.add_report_to_dashboard
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
  // Python: `not isinstance(raw, dict) or "id" not in raw`.
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
 * List the available dashboard blueprint templates.
 *
 * @param client - The wire client.
 * @param options - `include_reports` (Python default `False`).
 * @returns The `BlueprintTemplate` models.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const templates = await ws.listBlueprintTemplates({ include_reports: true });
 * ```
 * @see mixpanel_headless.workspace.Workspace.list_blueprint_templates
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
 * Create a dashboard from a blueprint template.
 *
 * @param client - The wire client.
 * @param templateType - Blueprint template type identifier.
 * @returns The newly created `Dashboard`.
 * @throws {@link MixpanelHeadlessError} - Empty response (`UNKNOWN_ERROR`).
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const dash = await ws.createBlueprint(templates[0].template_type);
 * ```
 * @see mixpanel_headless.workspace.Workspace.create_blueprint
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
 * Fetch the blueprint configuration of a dashboard.
 *
 * @param client - The wire client.
 * @param dashboardId - Dashboard identifier.
 * @returns The `BlueprintConfig`.
 * @throws {@link MixpanelHeadlessError} - Empty response (`UNKNOWN_ERROR`).
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const config = await ws.getBlueprintConfig(12);
 * ```
 * @see mixpanel_headless.workspace.Workspace.get_blueprint_config
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
 * Replace the cohorts of a blueprint configuration.
 *
 * @param client - The wire client.
 * @param cohorts - Cohort configuration dicts.
 * @returns Nothing.
 * @example
 * ```typescript
 * await ws.updateBlueprintCohorts([{ id: 5, name: "Power users" }]);
 * ```
 * @see mixpanel_headless.workspace.Workspace.update_blueprint_cohorts
 */
export async function updateBlueprintCohorts(
  client: MixpanelClient,
  cohorts: ReadonlyArray<Record<string, unknown>>,
): Promise<void> {
  await client.updateBlueprintCohorts(cohorts);
}

/**
 * Finalize a blueprint dashboard with cards.
 *
 * @param client - The wire client.
 * @param params - Blueprint finalization parameters.
 * @returns The finalized `Dashboard`.
 * @throws {@link MixpanelHeadlessError} - Empty response (`UNKNOWN_ERROR`).
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const dash = await ws.finalizeBlueprint(
 *   new BlueprintFinishParams({ dashboard_id: 12, cards }),
 * );
 * ```
 * @see mixpanel_headless.workspace.Workspace.finalize_blueprint
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
 * Create an RCA (Root Cause Analysis) dashboard.
 *
 * @param client - The wire client.
 * @param params - RCA dashboard parameters.
 * @returns The newly created `Dashboard`.
 * @throws {@link MixpanelHeadlessError} - Empty response (`UNKNOWN_ERROR`).
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const dash = await ws.createRcaDashboard(
 *   new CreateRcaDashboardParams({ rca_source_id: 987, rca_source_data }),
 * );
 * ```
 * @see mixpanel_headless.workspace.Workspace.create_rca_dashboard
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
 * List the ids of the dashboards that contain a bookmark, verbatim
 * (Python performs no model validation here).
 *
 * @param client - The wire client.
 * @param bookmarkId - Bookmark identifier.
 * @returns The dashboard IDs.
 * @example
 * ```typescript
 * const ids = await ws.getBookmarkDashboardIds(987);
 * ```
 * @see mixpanel_headless.workspace.Workspace.get_bookmark_dashboard_ids
 */
export async function getBookmarkDashboardIds(
  client: MixpanelClient,
  bookmarkId: number,
): Promise<number[]> {
  const raw = await client.getBookmarkDashboardIds(bookmarkId);
  return raw.map((item) => toNativeJson(item)) as number[];
}

/**
 * Fetch the ERF data of a dashboard, verbatim.
 *
 * @param client - The wire client.
 * @param dashboardId - Dashboard identifier.
 * @returns The ERF mapping.
 * @example
 * ```typescript
 * const erf = await ws.getDashboardErf(12);
 * ```
 * @see mixpanel_headless.workspace.Workspace.get_dashboard_erf
 */
export async function getDashboardErf(
  client: MixpanelClient,
  dashboardId: number,
): Promise<Record<string, unknown>> {
  const raw = await client.getDashboardErf(dashboardId);
  return toNativeJson(raw) as Record<string, unknown>;
}

/**
 * Update a report link on a dashboard.
 *
 * @param client - The wire client.
 * @param dashboardId - Dashboard identifier.
 * @param reportLinkId - Report link identifier.
 * @param params - Update parameters.
 * @returns Nothing.
 * @example
 * ```typescript
 * await ws.updateReportLink(12, 456, new UpdateReportLinkParams({ link_type: "embedded" }));
 * ```
 * @see mixpanel_headless.workspace.Workspace.update_report_link
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
 * Update a text card on a dashboard. The body is a plain `exclude_none`
 * dump — no `by_alias`, unlike its report-link sibling.
 *
 * @param client - The wire client.
 * @param dashboardId - Dashboard identifier.
 * @param textCardId - Text card identifier.
 * @param params - Update parameters.
 * @returns Nothing.
 * @example
 * ```typescript
 * await ws.updateTextCard(12, 789, new UpdateTextCardParams({ markdown: "## Notes" }));
 * ```
 * @see mixpanel_headless.workspace.Workspace.update_text_card
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
