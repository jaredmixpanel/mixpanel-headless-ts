/**
 * Dashboard CRUD wire methods on the App API, plus blueprints, RCA
 * dashboards and the dashboard-adjacent calls (`dashboards`,
 * workspace-scoped through `maybe_scoped_path` against the pin current
 * at call time). Every method returns the envelope product verbatim
 * after Python's isinstance guard; `Dashboard` model shaping belongs to
 * the `Workspace` facade.
 *
 * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.list_dashboards
 */

import { appRequest } from "../../client/app-request.js";
import type { ClientCore } from "../../client/core.js";
import { bindFirst, isPlainRecord } from "../../client/internals.js";
import type { JsonValue } from "../../client/json-value.js";
import { MixpanelHeadlessError } from "../../errors.js";
import { pythonTypeNameOf, scopedPath, truthyList } from "../shared.js";
import {
  expectListResult,
  expectRecordResult,
  joinIds,
  paramsOrNone,
} from "./shared.js";

/** Options bag of {@link DashboardMethods.listDashboards}. */
export interface ListDashboardsOptions {
  /** Optional dashboard-ID filter (`,`-joined on the wire). */
  readonly ids?: readonly number[] | null | undefined;
  /** Optional cancellation signal. */
  readonly signal?: AbortSignal | undefined;
}

/** Options bag of {@link DashboardMethods.listBlueprintTemplates}. */
export interface ListBlueprintTemplatesOptions {
  /**
   * Include report details in each template.
   *
   * @defaultValue `false`
   */
  readonly include_reports?: boolean | undefined;
  /** Optional cancellation signal. */
  readonly signal?: AbortSignal | undefined;
}

/** Dashboard methods mixed into `MixpanelClient`. */
export interface DashboardMethods {
  /**
   * List dashboards.
   *
   * @param options - Optional `ids` filter + signal.
   * @returns The dashboard list verbatim.
   * @throws {@link MixpanelHeadlessError} - Non-list response.
   * @throws {@link AuthenticationError} - Invalid or expired credentials (401).
   * @throws {@link RateLimitError} - Rate limit still exceeded after the retries
   *   (429).
   * @throws {@link QueryError} - Other 4xx responses (400/403/404/422).
   * @throws {@link ServerError} - Server-side errors (5xx).
   * @internal
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.list_dashboards
   */
  listDashboards: (options?: ListDashboardsOptions) => Promise<JsonValue[]>;

  /**
   * Create a dashboard.
   *
   * @param body - Creation payload (raw dict, verbatim).
   * @param signal - Optional cancellation signal.
   * @returns The created dashboard dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.create_dashboard
   */
  createDashboard: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Get a dashboard by ID.
   *
   * @param dashboardId - The dashboard identifier.
   * @param signal - Optional cancellation signal.
   * @returns The dashboard dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.get_dashboard
   */
  getDashboard: (
    dashboardId: number,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Update a dashboard (`update_dashboard`; PATCH).
   *
   * @param dashboardId - The dashboard identifier.
   * @param body - Partial update payload.
   * @param signal - Optional cancellation signal.
   * @returns The updated dashboard dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   */
  updateDashboard: (
    dashboardId: number,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Delete a dashboard.
   *
   * @param dashboardId - The dashboard identifier.
   * @param signal - Optional cancellation signal.
   * @returns Nothing (the Python method discards the envelope).
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.delete_dashboard
   */
  deleteDashboard: (dashboardId: number, signal?: AbortSignal) => Promise<void>;

  /**
   * Bulk-delete dashboards. Sends POST `dashboards/bulk-delete` with
   * `{dashboard_ids}`.
   *
   * @param ids - Dashboard IDs to delete.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.bulk_delete_dashboards
   */
  bulkDeleteDashboards: (
    ids: readonly number[],
    signal?: AbortSignal,
  ) => Promise<void>;

  /**
   * Favorite a dashboard.
   *
   * @param dashboardId - The dashboard identifier.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.favorite_dashboard
   */
  favoriteDashboard: (
    dashboardId: number,
    signal?: AbortSignal,
  ) => Promise<void>;

  /**
   * Unfavorite a dashboard.
   *
   * @param dashboardId - The dashboard identifier.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.unfavorite_dashboard
   */
  unfavoriteDashboard: (
    dashboardId: number,
    signal?: AbortSignal,
  ) => Promise<void>;

  /**
   * Pin a dashboard.
   *
   * @param dashboardId - The dashboard identifier.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.pin_dashboard
   */
  pinDashboard: (dashboardId: number, signal?: AbortSignal) => Promise<void>;

  /**
   * Unpin a dashboard.
   *
   * @param dashboardId - The dashboard identifier.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.unpin_dashboard
   */
  unpinDashboard: (dashboardId: number, signal?: AbortSignal) => Promise<void>;

  /**
   * Remove a report from a dashboard. Sends PATCH with a `delete` content action.
   *
   * @param dashboardId - The dashboard identifier.
   * @param bookmarkId - The report/bookmark to remove.
   * @param signal - Optional cancellation signal.
   * @returns The updated dashboard dict (a 204 envelope surfaces as
   *   `{status: "ok"}` — still a dict, exactly like Python).
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.remove_report_from_dashboard
   */
  removeReportFromDashboard: (
    dashboardId: number,
    bookmarkId: number,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Add a report to a dashboard. Sends PATCH with a `create` content action.
   *
   * @param dashboardId - The dashboard identifier.
   * @param bookmarkId - The source bookmark to clone onto it.
   * @param signal - Optional cancellation signal.
   * @returns The updated dashboard dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.add_report_to_dashboard
   */
  addReportToDashboard: (
    dashboardId: number,
    bookmarkId: number,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * List blueprint templates. Sends GET `dashboards/blueprints-all`; a
   * `{templates: {name: data}}` envelope flattens to a list with each `name`
   * merged in, non-dict entries skipped.
   *
   * @param options - `include_reports` + signal.
   * @returns The template list.
   * @throws {@link MixpanelHeadlessError} - Unrecognized response shape.
   * @internal
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.list_blueprint_templates
   */
  listBlueprintTemplates: (
    options?: ListBlueprintTemplatesOptions,
  ) => Promise<JsonValue[]>;

  /**
   * Create a dashboard from a blueprint.
   *
   * @param templateType - The blueprint template type identifier.
   * @param signal - Optional cancellation signal.
   * @returns The created dashboard dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.create_blueprint
   */
  createBlueprint: (
    templateType: string,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Get a dashboard's blueprint config.
   *
   * @param dashboardId - The dashboard identifier.
   * @param signal - Optional cancellation signal.
   * @returns The config dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.get_blueprint_config
   */
  getBlueprintConfig: (
    dashboardId: number,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Update blueprint cohort mappings. Sends PUT with `{cohorts}`.
   *
   * @param cohorts - Cohort mapping dicts.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.update_blueprint_cohorts
   */
  updateBlueprintCohorts: (
    cohorts: ReadonlyArray<Record<string, unknown>>,
    signal?: AbortSignal,
  ) => Promise<void>;

  /**
   * Finalize a blueprint dashboard.
   *
   * @param body - Finalization payload.
   * @param signal - Optional cancellation signal.
   * @returns The finalized dashboard dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.finalize_blueprint
   */
  finalizeBlueprint: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Create an RCA dashboard.
   *
   * @param body - RCA creation payload.
   * @param signal - Optional cancellation signal.
   * @returns The created dashboard dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.create_rca_dashboard
   */
  createRcaDashboard: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * List the dashboard IDs that contain a bookmark. Sends GET
   * `dashboards/bookmarks/{id}/dashboard-ids`.
   *
   * @param bookmarkId - The bookmark identifier.
   * @param signal - Optional cancellation signal.
   * @returns The ID list verbatim.
   * @throws {@link MixpanelHeadlessError} - Non-list response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.get_bookmark_dashboard_ids
   */
  getBookmarkDashboardIds: (
    bookmarkId: number,
    signal?: AbortSignal,
  ) => Promise<JsonValue[]>;

  /**
   * Get the ERF data for a dashboard.
   *
   * @param dashboardId - The dashboard identifier.
   * @param signal - Optional cancellation signal.
   * @returns The ERF dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.get_dashboard_erf
   */
  getDashboardErf: (
    dashboardId: number,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Update a dashboard report link. Sends PATCH
   * `dashboards/{id}/report-links/{report_link_id}`.
   *
   * @param dashboardId - The dashboard identifier.
   * @param reportLinkId - The report link identifier.
   * @param body - Partial update payload.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.update_report_link
   */
  updateReportLink: (
    dashboardId: number,
    reportLinkId: number,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<void>;

  /**
   * Update a dashboard text card. Sends PATCH
   * `dashboards/{id}/text-cards/{text_card_id}`.
   *
   * @param dashboardId - The dashboard identifier.
   * @param textCardId - The text card identifier.
   * @param body - Partial update payload.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.update_text_card
   */
  updateTextCard: (
    dashboardId: number,
    textCardId: number,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<void>;
}
async function listDashboards(
  core: ClientCore,
  options: ListDashboardsOptions = {},
): Promise<JsonValue[]> {
  const path = scopedPath(core, "dashboards");
  const params: Record<string, string> = {};
  if (truthyList(options.ids)) {
    params["ids"] = joinIds(options.ids as readonly number[]);
  }
  const result = await appRequest(core.appDeps(options.signal), "GET", path, {
    params: paramsOrNone(params),
  });
  return expectListResult(result, "list_dashboards");
}

async function createDashboard(
  core: ClientCore,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, JsonValue>> {
  const path = scopedPath(core, "dashboards");
  const result = await appRequest(core.appDeps(signal), "POST", path, {
    jsonBody: body,
  });
  return expectRecordResult(result, "create_dashboard");
}

async function getDashboard(
  core: ClientCore,
  dashboardId: number,
  signal?: AbortSignal,
): Promise<Record<string, JsonValue>> {
  const path = scopedPath(core, `dashboards/${dashboardId}`);
  const result = await appRequest(core.appDeps(signal), "GET", path);
  return expectRecordResult(result, "get_dashboard");
}

async function updateDashboard(
  core: ClientCore,
  dashboardId: number,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, JsonValue>> {
  const path = scopedPath(core, `dashboards/${dashboardId}`);
  const result = await appRequest(core.appDeps(signal), "PATCH", path, {
    jsonBody: body,
  });
  return expectRecordResult(result, "update_dashboard");
}

async function deleteDashboard(
  core: ClientCore,
  dashboardId: number,
  signal?: AbortSignal,
): Promise<void> {
  const path = scopedPath(core, `dashboards/${dashboardId}`);
  await appRequest(core.appDeps(signal), "DELETE", path);
}

async function bulkDeleteDashboards(
  core: ClientCore,
  ids: readonly number[],
  signal?: AbortSignal,
): Promise<void> {
  const path = scopedPath(core, "dashboards/bulk-delete");
  await appRequest(core.appDeps(signal), "POST", path, {
    jsonBody: { dashboard_ids: ids },
  });
}

async function favoriteDashboard(
  core: ClientCore,
  dashboardId: number,
  signal?: AbortSignal,
): Promise<void> {
  const path = scopedPath(core, `dashboards/${dashboardId}/favorites`);
  await appRequest(core.appDeps(signal), "POST", path);
}

async function unfavoriteDashboard(
  core: ClientCore,
  dashboardId: number,
  signal?: AbortSignal,
): Promise<void> {
  const path = scopedPath(core, `dashboards/${dashboardId}/favorites`);
  await appRequest(core.appDeps(signal), "DELETE", path);
}

async function pinDashboard(
  core: ClientCore,
  dashboardId: number,
  signal?: AbortSignal,
): Promise<void> {
  const path = scopedPath(core, `dashboards/${dashboardId}/pin`);
  await appRequest(core.appDeps(signal), "POST", path);
}

async function unpinDashboard(
  core: ClientCore,
  dashboardId: number,
  signal?: AbortSignal,
): Promise<void> {
  const path = scopedPath(core, `dashboards/${dashboardId}/pin`);
  await appRequest(core.appDeps(signal), "DELETE", path);
}

async function removeReportFromDashboard(
  core: ClientCore,
  dashboardId: number,
  bookmarkId: number,
  signal?: AbortSignal,
): Promise<Record<string, JsonValue>> {
  const path = scopedPath(core, `dashboards/${dashboardId}`);
  const body = {
    content: {
      action: "delete",
      content_type: "report",
      content_id: bookmarkId,
    },
  };
  const result = await appRequest(core.appDeps(signal), "PATCH", path, {
    jsonBody: body,
  });
  return expectRecordResult(result, "remove_report_from_dashboard");
}

async function addReportToDashboard(
  core: ClientCore,
  dashboardId: number,
  bookmarkId: number,
  signal?: AbortSignal,
): Promise<Record<string, JsonValue>> {
  const path = scopedPath(core, `dashboards/${dashboardId}`);
  const body = {
    content: {
      action: "create",
      content_type: "report",
      content_params: { source_bookmark_id: bookmarkId },
    },
  };
  const result = await appRequest(core.appDeps(signal), "PATCH", path, {
    jsonBody: body,
  });
  return expectRecordResult(result, "add_report_to_dashboard");
}

async function listBlueprintTemplates(
  core: ClientCore,
  options: ListBlueprintTemplatesOptions = {},
): Promise<JsonValue[]> {
  const path = scopedPath(core, "dashboards/blueprints-all");
  const params: Record<string, string> = {};
  if (options.include_reports === true) {
    params["include_reports"] = "true";
  }
  const result = await appRequest(core.appDeps(options.signal), "GET", path, {
    params: paramsOrNone(params),
  });
  // The blueprints-all endpoint returns {"templates": {name: data}}.
  if (isPlainRecord(result) && Object.hasOwn(result, "templates")) {
    const templates = result["templates"] as JsonValue;
    if (isPlainRecord(templates)) {
      // Convert {name: data} to [{...data, "name": name}, ...];
      // Python logs a warning for non-dict entries and skips them
      // (the warning is not observable — skip silently here).
      const results: JsonValue[] = [];
      for (const [name, data] of Object.entries(templates)) {
        if (isPlainRecord(data)) {
          results.push({ ...data, name });
        }
      }
      return results;
    }
    if (Array.isArray(templates)) {
      return templates;
    }
  }
  if (Array.isArray(result)) {
    return result;
  }
  throw new MixpanelHeadlessError(
    `Unexpected response from list_blueprint_templates: ` +
      `expected templates dict, got ${pythonTypeNameOf(result)}`,
  );
}

async function createBlueprint(
  core: ClientCore,
  templateType: string,
  signal?: AbortSignal,
): Promise<Record<string, JsonValue>> {
  const path = scopedPath(core, "dashboards/blueprints");
  const result = await appRequest(core.appDeps(signal), "POST", path, {
    jsonBody: { template_type: templateType },
  });
  return expectRecordResult(result, "create_blueprint");
}

async function getBlueprintConfig(
  core: ClientCore,
  dashboardId: number,
  signal?: AbortSignal,
): Promise<Record<string, JsonValue>> {
  const path = scopedPath(core, `dashboards/${dashboardId}/blueprint-config`);
  const result = await appRequest(core.appDeps(signal), "GET", path);
  return expectRecordResult(result, "get_blueprint_config");
}

async function updateBlueprintCohorts(
  core: ClientCore,
  cohorts: ReadonlyArray<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<void> {
  const path = scopedPath(core, "dashboards/blueprints/cohorts");
  await appRequest(core.appDeps(signal), "PUT", path, {
    jsonBody: { cohorts },
  });
}

async function finalizeBlueprint(
  core: ClientCore,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, JsonValue>> {
  const path = scopedPath(core, "dashboards/blueprints/finish");
  const result = await appRequest(core.appDeps(signal), "POST", path, {
    jsonBody: body,
  });
  return expectRecordResult(result, "finalize_blueprint");
}

async function createRcaDashboard(
  core: ClientCore,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, JsonValue>> {
  const path = scopedPath(core, "dashboards/rca");
  const result = await appRequest(core.appDeps(signal), "POST", path, {
    jsonBody: body,
  });
  return expectRecordResult(result, "create_rca_dashboard");
}

async function getBookmarkDashboardIds(
  core: ClientCore,
  bookmarkId: number,
  signal?: AbortSignal,
): Promise<JsonValue[]> {
  const path = scopedPath(
    core,
    `dashboards/bookmarks/${bookmarkId}/dashboard-ids`,
  );
  const result = await appRequest(core.appDeps(signal), "GET", path);
  return expectListResult(result, "get_bookmark_dashboard_ids");
}

async function getDashboardErf(
  core: ClientCore,
  dashboardId: number,
  signal?: AbortSignal,
): Promise<Record<string, JsonValue>> {
  const path = scopedPath(core, `dashboards/${dashboardId}/erf`);
  const result = await appRequest(core.appDeps(signal), "GET", path);
  return expectRecordResult(result, "get_dashboard_erf");
}

async function updateReportLink(
  core: ClientCore,
  dashboardId: number,
  reportLinkId: number,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<void> {
  const path = scopedPath(
    core,
    `dashboards/${dashboardId}/report-links/${reportLinkId}`,
  );
  await appRequest(core.appDeps(signal), "PATCH", path, {
    jsonBody: body,
  });
}

async function updateTextCard(
  core: ClientCore,
  dashboardId: number,
  textCardId: number,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<void> {
  const path = scopedPath(
    core,
    `dashboards/${dashboardId}/text-cards/${textCardId}`,
  );
  await appRequest(core.appDeps(signal), "PATCH", path, {
    jsonBody: body,
  });
}

/**
 * Build the dashboard methods over the shared client core.
 *
 * @param core - The shared client internals seam.
 * @returns The method bag.
 * @example
 * ```typescript
 * const dashboards = createDashboardMethods(core);
 * const two = await dashboards.listDashboards({ ids: [1, 2] });
 * // [{ id: 1, title: "KPIs", ... }, { id: 2, ... }]
 * ```
 */
export function createDashboardMethods(core: ClientCore): DashboardMethods {
  return {
    listDashboards: bindFirst(core, listDashboards),
    createDashboard: bindFirst(core, createDashboard),
    getDashboard: bindFirst(core, getDashboard),
    updateDashboard: bindFirst(core, updateDashboard),
    deleteDashboard: bindFirst(core, deleteDashboard),
    bulkDeleteDashboards: bindFirst(core, bulkDeleteDashboards),
    favoriteDashboard: bindFirst(core, favoriteDashboard),
    unfavoriteDashboard: bindFirst(core, unfavoriteDashboard),
    pinDashboard: bindFirst(core, pinDashboard),
    unpinDashboard: bindFirst(core, unpinDashboard),
    removeReportFromDashboard: bindFirst(core, removeReportFromDashboard),
    addReportToDashboard: bindFirst(core, addReportToDashboard),
    listBlueprintTemplates: bindFirst(core, listBlueprintTemplates),
    createBlueprint: bindFirst(core, createBlueprint),
    getBlueprintConfig: bindFirst(core, getBlueprintConfig),
    updateBlueprintCohorts: bindFirst(core, updateBlueprintCohorts),
    finalizeBlueprint: bindFirst(core, finalizeBlueprint),
    createRcaDashboard: bindFirst(core, createRcaDashboard),
    getBookmarkDashboardIds: bindFirst(core, getBookmarkDashboardIds),
    getDashboardErf: bindFirst(core, getDashboardErf),
    updateReportLink: bindFirst(core, updateReportLink),
    updateTextCard: bindFirst(core, updateTextCard),
  };
}
