/**
 * Dashboard CRUD wire methods — Phase-3 packet B4-C3 port of
 * `MixpanelAPIClient` dashboards + blueprints/RCA + dashboard-adjacent
 * ranges (`api_client.py:3650-4426`).
 *
 * Every method routes through B0 `appRequest` (per-request auth via the
 * C1 `appDeps` seam — R2.9/R10.8) over a `maybe_scoped_path` (B0
 * `scope.ts` against the client's CURRENT pin state). Methods return the
 * envelope product verbatim after the source's isinstance guard — no
 * result pre-shaping (Caution #11; `Dashboard` models are B6 facade
 * work).
 */

import { appRequest } from "../../client/app-request.js";
import type { ClientCore } from "../../client/core.js";
import { bindFirst, isPlainRecord } from "../../client/internals.js";
import type { JsonValue } from "../../client/json-value.js";
import { maybeScopedPath } from "../../client/scope.js";
import { MixpanelHeadlessError } from "../../errors.js";
import {
  expectListResult,
  expectRecordResult,
  joinIds,
  paramsOrNone,
  pythonTypeNameOf,
  truthyList,
} from "./shared.js";

/** Options bag of {@link DashboardMethods.listDashboards}. */
export interface ListDashboardsOptions {
  /** Optional dashboard-ID filter (`,`-joined on the wire). */
  readonly ids?: readonly number[] | null | undefined;
  /** Optional cancellation signal (R6.7). */
  readonly signal?: AbortSignal | undefined;
}

/** Options bag of {@link DashboardMethods.listBlueprintTemplates}. */
export interface ListBlueprintTemplatesOptions {
  /** Include report details in each template (Python default False). */
  readonly include_reports?: boolean | undefined;
  /** Optional cancellation signal (R6.7). */
  readonly signal?: AbortSignal | undefined;
}

/** The C3 dashboard method surface (mixed into `MixpanelClient`). */
export interface DashboardMethods {
  /**
   * List dashboards (`list_dashboards`, `api_client.py:3650-3687`).
   *
   * @param options - Optional `ids` filter + signal.
   * @returns The dashboard list verbatim.
   * @throws MixpanelHeadlessError - Non-list response.
   * @throws AuthenticationError | RateLimitError | QueryError |
   *   ServerError - Per the B0 `appRequest` contract.
   */
  listDashboards: (options?: ListDashboardsOptions) => Promise<JsonValue[]>;

  /**
   * Create a dashboard (`create_dashboard`, `:3689-3722`).
   *
   * @param body - Creation payload (raw dict, verbatim).
   * @param signal - Optional cancellation signal.
   * @returns The created dashboard dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  createDashboard: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Get a dashboard by ID (`get_dashboard`, `:3724-3757`).
   *
   * @param dashboardId - The dashboard identifier.
   * @param signal - Optional cancellation signal.
   * @returns The dashboard dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  getDashboard: (
    dashboardId: number,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Update a dashboard (`update_dashboard`, `:3759-3795`; PATCH).
   *
   * @param dashboardId - The dashboard identifier.
   * @param body - Partial update payload.
   * @param signal - Optional cancellation signal.
   * @returns The updated dashboard dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  updateDashboard: (
    dashboardId: number,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Delete a dashboard (`delete_dashboard`, `:3797-3822`).
   *
   * @param dashboardId - The dashboard identifier.
   * @param signal - Optional cancellation signal.
   * @returns Nothing (the Python method discards the envelope).
   */
  deleteDashboard: (dashboardId: number, signal?: AbortSignal) => Promise<void>;

  /**
   * Bulk-delete dashboards (`bulk_delete_dashboards`, `:3824-3849` —
   * POST `dashboards/bulk-delete` with `{dashboard_ids}`).
   *
   * @param ids - Dashboard IDs to delete.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   */
  bulkDeleteDashboards: (
    ids: readonly number[],
    signal?: AbortSignal,
  ) => Promise<void>;

  /**
   * Favorite a dashboard (`favorite_dashboard`, `:3851-3876`).
   *
   * @param dashboardId - The dashboard identifier.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   */
  favoriteDashboard: (
    dashboardId: number,
    signal?: AbortSignal,
  ) => Promise<void>;

  /**
   * Unfavorite a dashboard (`unfavorite_dashboard`, `:3878-3903`).
   *
   * @param dashboardId - The dashboard identifier.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   */
  unfavoriteDashboard: (
    dashboardId: number,
    signal?: AbortSignal,
  ) => Promise<void>;

  /**
   * Pin a dashboard (`pin_dashboard`, `:3905-3930`).
   *
   * @param dashboardId - The dashboard identifier.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   */
  pinDashboard: (dashboardId: number, signal?: AbortSignal) => Promise<void>;

  /**
   * Unpin a dashboard (`unpin_dashboard`, `:3932-3957`).
   *
   * @param dashboardId - The dashboard identifier.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   */
  unpinDashboard: (dashboardId: number, signal?: AbortSignal) => Promise<void>;

  /**
   * Remove a report from a dashboard (`remove_report_from_dashboard`,
   * `:3959-4001` — PATCH with a `delete` content action).
   *
   * @param dashboardId - The dashboard identifier.
   * @param bookmarkId - The report/bookmark to remove.
   * @param signal - Optional cancellation signal.
   * @returns The updated dashboard dict (a 204 envelope surfaces as
   *   `{status: "ok"}` — still a dict, exactly like Python).
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  removeReportFromDashboard: (
    dashboardId: number,
    bookmarkId: number,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Add a report to a dashboard (`add_report_to_dashboard`,
   * `:4003-4045` — PATCH with a `create` content action).
   *
   * @param dashboardId - The dashboard identifier.
   * @param bookmarkId - The source bookmark to clone onto it.
   * @param signal - Optional cancellation signal.
   * @returns The updated dashboard dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  addReportToDashboard: (
    dashboardId: number,
    bookmarkId: number,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * List blueprint templates (`list_blueprint_templates`,
   * `:4047-4105` — GET `dashboards/blueprints-all`; a
   * `{templates: {name: data}}` envelope flattens to a list with each
   * `name` merged in, non-dict entries skipped).
   *
   * @param options - `include_reports` + signal.
   * @returns The template list.
   * @throws MixpanelHeadlessError - Unrecognized response shape.
   */
  listBlueprintTemplates: (
    options?: ListBlueprintTemplatesOptions,
  ) => Promise<JsonValue[]>;

  /**
   * Create a dashboard from a blueprint (`create_blueprint`,
   * `:4107-4143`).
   *
   * @param templateType - The blueprint template type identifier.
   * @param signal - Optional cancellation signal.
   * @returns The created dashboard dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  createBlueprint: (
    templateType: string,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Get a dashboard's blueprint config (`get_blueprint_config`,
   * `:4145-4178`).
   *
   * @param dashboardId - The dashboard identifier.
   * @param signal - Optional cancellation signal.
   * @returns The config dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  getBlueprintConfig: (
    dashboardId: number,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Update blueprint cohort mappings (`update_blueprint_cohorts`,
   * `:4180-4208` — PUT with `{cohorts}`).
   *
   * @param cohorts - Cohort mapping dicts.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   */
  updateBlueprintCohorts: (
    cohorts: ReadonlyArray<Record<string, unknown>>,
    signal?: AbortSignal,
  ) => Promise<void>;

  /**
   * Finalize a blueprint dashboard (`finalize_blueprint`,
   * `:4210-4243`).
   *
   * @param body - Finalization payload.
   * @param signal - Optional cancellation signal.
   * @returns The finalized dashboard dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  finalizeBlueprint: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Create an RCA dashboard (`create_rca_dashboard`, `:4245-4282`).
   *
   * @param body - RCA creation payload.
   * @param signal - Optional cancellation signal.
   * @returns The created dashboard dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  createRcaDashboard: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Dashboard IDs containing a bookmark (`get_bookmark_dashboard_ids`,
   * `:4284-4318` — GET
   * `dashboards/bookmarks/{id}/dashboard-ids`).
   *
   * @param bookmarkId - The bookmark identifier.
   * @param signal - Optional cancellation signal.
   * @returns The ID list verbatim.
   * @throws MixpanelHeadlessError - Non-list response.
   */
  getBookmarkDashboardIds: (
    bookmarkId: number,
    signal?: AbortSignal,
  ) => Promise<JsonValue[]>;

  /**
   * ERF data for a dashboard (`get_dashboard_erf`, `:4320-4353`).
   *
   * @param dashboardId - The dashboard identifier.
   * @param signal - Optional cancellation signal.
   * @returns The ERF dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  getDashboardErf: (
    dashboardId: number,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Update a dashboard report link (`update_report_link`,
   * `:4355-4387` — PATCH
   * `dashboards/{id}/report-links/{report_link_id}`).
   *
   * @param dashboardId - The dashboard identifier.
   * @param reportLinkId - The report link identifier.
   * @param body - Partial update payload.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   */
  updateReportLink: (
    dashboardId: number,
    reportLinkId: number,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<void>;

  /**
   * Update a dashboard text card (`update_text_card`, `:4389-4421` —
   * PATCH `dashboards/{id}/text-cards/{text_card_id}`).
   *
   * @param dashboardId - The dashboard identifier.
   * @param textCardId - The text card identifier.
   * @param body - Partial update payload.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   */
  updateTextCard: (
    dashboardId: number,
    textCardId: number,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<void>;
}
/** `self.maybe_scoped_path(...)` over the CURRENT pin (call-time). */
function scopedPath(core: ClientCore, domainPath: string): string {
  return maybeScopedPath(domainPath, {
    projectId: core.projectId(),
    workspaceId: core.workspaceId(),
  });
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
  // The blueprints-all endpoint returns {"templates": {name: data}}
  // (`api_client.py:4082-4099`).
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
 * Build the C3 dashboard methods over the C1 core seam.
 *
 * @param core - The shared client internals seam.
 * @returns The method bag.
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
