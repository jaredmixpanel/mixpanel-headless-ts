/**
 * B6 (b′) binding module — the 143 W2–W8 `workspace.<member>` entity
 * api names (b6-packets.md §11.3: sibling of `wire-workspace.ts`,
 * which owns the B5 names + the 11 B6-W1 lifecycle names and the
 * shared `workspaceFromSession` / `runFacade` / `optionsBag` plumbing).
 *
 * Binding honesty (P3-5 rule 3 / §11.4): every registration calls the
 * REAL `Workspace` member the recorder wrapped
 * (`registry.py` targets `workspace:Workspace.<name>`) — never the
 * underlying client method, never a re-derived flatten. The ONLY
 * adaptations are positional pulls (`requireWireKwarg` — the runner's
 * `decodeInputKwargs` has already reconstructed `$type`-tagged params
 * payloads into the real Phase-2 entity-params instances) and kwonly →
 * options-bag plumbing (`optionsBag` — Python kwonly names ARE the TS
 * option keys). Output encoding rides `runFacade` →
 * `encodeFacadeValue`: entity models serialize through their
 * `toVectorPayload()` walk (datetime `$type` tags kept), lossless
 * `JsonNumber` tokens keep their recorded spellings, and
 * `Uint8Array` results (`download_lookup_table`) encode through the
 * codec registry's `$type: bytes` branch.
 *
 * Kinds: all 143 names are **wire_api** (`registry.py:99-104` — the
 * only `_WORKSPACE_STATE_NAMES` entries are `use`/`close`/
 * `clear_discovery_cache`, none of which live here). B6 adds ZERO
 * builder-kind apis, so there is no oracle-strategy registration in
 * this module (b6-packets.md §11.5).
 */

import type {
  BlueprintFinishParams,
  CreateDashboardParams,
  CreateRcaDashboardParams,
  UpdateDashboardParams,
  UpdateReportLinkParams,
  UpdateTextCardParams,
  BulkUpdateBookmarkEntry,
  CreateBookmarkParams,
  UpdateBookmarkParams,
  BulkUpdateCohortEntry,
  CreateCohortParams,
  UpdateCohortParams,
  CreateFeatureFlagParams,
  SetTestUsersParams,
  UpdateFeatureFlagParams,
  CreateExperimentParams,
  DuplicateExperimentParams,
  ExperimentDecideParams,
  UpdateExperimentParams,
  CreateAnnotationParams,
  CreateAnnotationTagParams,
  UpdateAnnotationParams,
  CreateWebhookParams,
  UpdateWebhookParams,
  WebhookTestParams,
  CreateAlertParams,
  UpdateAlertParams,
  ValidateAlertsForBookmarkParams,
  BulkUpdateEventsParams,
  BulkUpdatePropertiesParams,
  CreateTagParams,
  UpdateEventDefinitionParams,
  UpdatePropertyDefinitionParams,
  UpdateTagParams,
  CreateCustomEventParams,
  CreateCustomPropertyParams,
  CreateDropFilterParams,
  MarkLookupTableReadyParams,
  UpdateCustomPropertyParams,
  UpdateDropFilterParams,
  UpdateLookupTableParams,
  UploadLookupTableParams,
  BulkCreateSchemasParams,
  BulkUpdateAnomalyParams,
  CreateDeletionRequestParams,
  InitSchemaEnforcementParams,
  PreviewDeletionFiltersParams,
  ReplaceSchemaEnforcementParams,
  UpdateAnomalyParams,
  UpdateSchemaEnforcementParams,
  Workspace,
  WorkspaceConcludeExperimentOptions,
  WorkspaceDeleteSchemasOptions,
  WorkspaceDownloadLookupTableOptions,
  WorkspaceExportLexiconOptions,
  WorkspaceGetAlertCountOptions,
  WorkspaceGetAlertHistoryOptions,
  WorkspaceGetBookmarkHistoryOptions,
  WorkspaceGetEventDefinitionsOptions,
  WorkspaceGetFlagHistoryOptions,
  WorkspaceGetPropertyDefinitionsOptions,
  WorkspaceGetSchemaEnforcementOptions,
  WorkspaceListAlertsOptions,
  WorkspaceListAnnotationsOptions,
  WorkspaceListBlueprintTemplatesOptions,
  WorkspaceListBookmarksV2Options,
  WorkspaceListCohortsFullOptions,
  WorkspaceListDashboardsOptions,
  WorkspaceListDataVolumeAnomaliesOptions,
  WorkspaceListExperimentsOptions,
  WorkspaceListFeatureFlagsOptions,
  WorkspaceListLookupTablesOptions,
  WorkspaceListSchemaRegistryOptions,
  WorkspaceUploadLookupTableOptions,
} from "@mixpanel-headless/core";
import { EntityModel } from "@mixpanel-headless/core/internal";
import { PyFloat, type CodecRegistry } from "./codecs.js";
import type { JsonValue } from "./json-value.js";
import type { ImplementationRegistry, InvocationContext } from "./runner.js";
import { requireWireKwarg } from "./wire-client.js";
import {
  optionsBag,
  runFacade,
  workspaceFromSession,
} from "./wire-workspace.js";

declare global {
  interface JSON {
    /**
     * TC39 raw-JSON proposal (Node ≥ 21; present on this repo's Node 24
     * toolchain) — absent from the pinned `ES2022` lib, declared here
     * for the rig only.
     *
     * @param text - A valid JSON scalar token.
     * @returns The branded raw-JSON marker `JSON.stringify` emits
     *   verbatim.
     */
    rawJSON(text: string): unknown;
  }
}

/**
 * Input-codec float twin for entity-params payloads (the request-side
 * counterpart of the B5 output float twins; Discrepancy #12 mechanics).
 *
 * The recorder tags INTEGRAL floats inside rich (`$type`-tagged model)
 * payloads as `{$type: "float", value: repr}` (`codecs.py:185-207`), and
 * the runner decodes those tags to {@link PyFloat} carriers. Python's
 * replay passes a real `float` whose `json.dumps` spelling is exactly
 * that repr (`1.0`, not `1`); a native JS number cannot carry the
 * spelling through `JSON.stringify`, so a leaked carrier would either
 * serialize as `{"spelling":"1.0"}` (the raw class) or collapse to `1`
 * (native) — both diverge from the recorded request bytes under the
 * D6 rule-3 raw-token comparison (`request-diff.ts:19-20`; the corpus
 * carries exactly two such vectors, both `workspace.create_feature_flag`
 * ruleset splits). Instances of this wrapper travel OPAQUELY through
 * the real facade/model-dump/transport path (class instances pass
 * `dumpValue` by reference) and re-emit the recorded token at the one
 * legal place — `JSON.stringify` inside the core transport — via the
 * TC39 raw-JSON hook.
 */
class WireRawFloat {
  /** The canonical Python `repr` spelling (a valid JSON number token). */
  readonly spelling: string;

  /**
   * Wrap one finite integral-float spelling.
   *
   * @param spelling - The canonical repr (e.g. `"1.0"`).
   */
  constructor(spelling: string) {
    this.spelling = spelling;
  }

  /**
   * Emit the raw token for `JSON.stringify` (the transport's body
   * serialization honors raw-JSON markers returned from `toJSON`).
   *
   * @returns The branded raw-JSON marker for the spelling.
   */
  toJSON(): unknown {
    return JSON.rawJSON(this.spelling);
  }
}

/**
 * Whether a value is a plain record (`Object.prototype` / null proto) —
 * the walkable dict shape (class instances other than models stay
 * opaque).
 *
 * @param value - The candidate.
 * @returns True for plain records.
 */
function isWalkableRecord(value: object): value is Record<string, unknown> {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Deep-replace finite {@link PyFloat} carriers with {@link WireRawFloat}
 * wrappers, IN PLACE, across arrays, plain records, and entity-model
 * instances (own enumerable fields incl. the `__extras` spillover bag).
 * Non-finite carriers (`NaN`/`Infinity`) stay untouched — they are not
 * valid JSON tokens and no corpus vector routes one into a request
 * body (a leak would fail loudly at the request diff).
 *
 * @param value - The decoded kwarg value to walk.
 * @param seen - Cycle guard.
 */
function twinPyFloatsInPlace(value: unknown, seen: Set<object>): void {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return;
  }
  seen.add(value);
  const twin = (member: unknown): unknown =>
    member instanceof PyFloat && Number.isFinite(Number(member.spelling))
      ? new WireRawFloat(member.spelling)
      : member;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const replaced = twin(value[index]);
      if (replaced !== value[index]) {
        value[index] = replaced;
      } else {
        twinPyFloatsInPlace(value[index], seen);
      }
    }
    return;
  }
  if (isWalkableRecord(value) || value instanceof EntityModel) {
    const record = value as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const member: unknown = record[key];
      const replaced = twin(member);
      if (replaced !== member) {
        record[key] = replaced;
      } else {
        twinPyFloatsInPlace(member, seen);
      }
    }
  }
}

/**
 * One facade-member invocation: receives the vector's memoized facade
 * and its context, performs the REAL member call, and returns the raw
 * library value (encoding is `runFacade`'s job).
 */
type FacadeCall = (
  ws: Workspace,
  context: InvocationContext,
) => Promise<unknown>;

/**
 * Register one `workspace.<member>` api name over the shared
 * memoized-facade + expect-encoding pipeline.
 *
 * @param implementations - The registry to extend.
 * @param codecs - The codec registry (output encoding).
 * @param api - The recorder api name.
 * @param call - The real facade-member invocation.
 */
function bindFacade(
  implementations: ImplementationRegistry,
  codecs: CodecRegistry,
  api: string,
  call: FacadeCall,
): void {
  implementations.register(api, async (context): Promise<JsonValue> => {
    const ws = workspaceFromSession(context);
    // Request-side float twin (see {@link WireRawFloat}): applied to
    // the decoded kwargs BEFORE the real member call so tagged
    // integral floats inside entity-params payloads keep their
    // recorded wire spelling.
    const seen = new Set<object>();
    for (const kwarg of Object.values(context.kwargs)) {
      twinPyFloatsInPlace(kwarg, seen);
    }
    return runFacade(codecs, () => call(ws, context));
  });
}

/**
 * Register the 143 W2–W8 `workspace.<member>` entity bindings
 * (b6-packets.md §11.1 minus the 11 W1 names registered in
 * `wire-workspace.ts`).
 *
 * @param implementations - The registry to extend.
 * @param codecs - The codec registry (output encoding + rich inputs).
 */
export function registerWorkspaceEntityBindings(
  implementations: ImplementationRegistry,
  codecs: CodecRegistry,
): void {
  /**
   * Shard-local shorthand over {@link bindFacade}.
   *
   * @param api - The recorder api name.
   * @param call - The real facade-member invocation.
   */
  const bind = (api: string, call: FacadeCall): void => {
    bindFacade(implementations, codecs, api, call);
  };

  // -------------------------------------------------------------------
  // W2 — dashboards: CRUD + advanced operations (22)
  // -------------------------------------------------------------------

  bind("workspace.list_dashboards", (ws, c) =>
    ws.listDashboards(optionsBag<WorkspaceListDashboardsOptions>(c, [])),
  );
  bind("workspace.create_dashboard", (ws, c) =>
    ws.createDashboard(requireWireKwarg(c, "params") as CreateDashboardParams),
  );
  bind("workspace.get_dashboard", (ws, c) =>
    ws.getDashboard(requireWireKwarg(c, "dashboard_id") as number),
  );
  bind("workspace.update_dashboard", (ws, c) =>
    ws.updateDashboard(
      requireWireKwarg(c, "dashboard_id") as number,
      requireWireKwarg(c, "params") as UpdateDashboardParams,
    ),
  );
  bind("workspace.delete_dashboard", (ws, c) =>
    ws.deleteDashboard(requireWireKwarg(c, "dashboard_id") as number),
  );
  bind("workspace.bulk_delete_dashboards", (ws, c) =>
    ws.bulkDeleteDashboards(requireWireKwarg(c, "ids") as readonly number[]),
  );
  bind("workspace.favorite_dashboard", (ws, c) =>
    ws.favoriteDashboard(requireWireKwarg(c, "dashboard_id") as number),
  );
  bind("workspace.unfavorite_dashboard", (ws, c) =>
    ws.unfavoriteDashboard(requireWireKwarg(c, "dashboard_id") as number),
  );
  bind("workspace.pin_dashboard", (ws, c) =>
    ws.pinDashboard(requireWireKwarg(c, "dashboard_id") as number),
  );
  bind("workspace.unpin_dashboard", (ws, c) =>
    ws.unpinDashboard(requireWireKwarg(c, "dashboard_id") as number),
  );
  bind("workspace.remove_report_from_dashboard", (ws, c) =>
    ws.removeReportFromDashboard(
      requireWireKwarg(c, "dashboard_id") as number,
      requireWireKwarg(c, "bookmark_id") as number,
    ),
  );
  bind("workspace.add_report_to_dashboard", (ws, c) =>
    ws.addReportToDashboard(
      requireWireKwarg(c, "dashboard_id") as number,
      requireWireKwarg(c, "bookmark_id") as number,
    ),
  );
  bind("workspace.list_blueprint_templates", (ws, c) =>
    ws.listBlueprintTemplates(
      optionsBag<WorkspaceListBlueprintTemplatesOptions>(c, []),
    ),
  );
  bind("workspace.create_blueprint", (ws, c) =>
    ws.createBlueprint(requireWireKwarg(c, "template_type") as string),
  );
  bind("workspace.get_blueprint_config", (ws, c) =>
    ws.getBlueprintConfig(requireWireKwarg(c, "dashboard_id") as number),
  );
  bind("workspace.update_blueprint_cohorts", (ws, c) =>
    ws.updateBlueprintCohorts(
      requireWireKwarg(c, "cohorts") as ReadonlyArray<Record<string, unknown>>,
    ),
  );
  bind("workspace.finalize_blueprint", (ws, c) =>
    ws.finalizeBlueprint(
      requireWireKwarg(c, "params") as BlueprintFinishParams,
    ),
  );
  bind("workspace.create_rca_dashboard", (ws, c) =>
    ws.createRcaDashboard(
      requireWireKwarg(c, "params") as CreateRcaDashboardParams,
    ),
  );
  bind("workspace.get_bookmark_dashboard_ids", (ws, c) =>
    ws.getBookmarkDashboardIds(requireWireKwarg(c, "bookmark_id") as number),
  );
  bind("workspace.get_dashboard_erf", (ws, c) =>
    ws.getDashboardErf(requireWireKwarg(c, "dashboard_id") as number),
  );
  bind("workspace.update_report_link", (ws, c) =>
    ws.updateReportLink(
      requireWireKwarg(c, "dashboard_id") as number,
      requireWireKwarg(c, "report_link_id") as number,
      requireWireKwarg(c, "params") as UpdateReportLinkParams,
    ),
  );
  bind("workspace.update_text_card", (ws, c) =>
    ws.updateTextCard(
      requireWireKwarg(c, "dashboard_id") as number,
      requireWireKwarg(c, "text_card_id") as number,
      requireWireKwarg(c, "params") as UpdateTextCardParams,
    ),
  );

  // -------------------------------------------------------------------
  // W3 — bookmarks/reports + cohorts (16)
  // -------------------------------------------------------------------

  bind("workspace.list_bookmarks_v2", (ws, c) =>
    ws.listBookmarksV2(optionsBag<WorkspaceListBookmarksV2Options>(c, [])),
  );
  bind("workspace.create_bookmark", (ws, c) =>
    ws.createBookmark(requireWireKwarg(c, "params") as CreateBookmarkParams),
  );
  bind("workspace.get_bookmark", (ws, c) =>
    ws.getBookmark(requireWireKwarg(c, "bookmark_id") as number),
  );
  bind("workspace.update_bookmark", (ws, c) =>
    ws.updateBookmark(
      requireWireKwarg(c, "bookmark_id") as number,
      requireWireKwarg(c, "params") as UpdateBookmarkParams,
    ),
  );
  bind("workspace.delete_bookmark", (ws, c) =>
    ws.deleteBookmark(requireWireKwarg(c, "bookmark_id") as number),
  );
  bind("workspace.bulk_delete_bookmarks", (ws, c) =>
    ws.bulkDeleteBookmarks(requireWireKwarg(c, "ids") as readonly number[]),
  );
  bind("workspace.bulk_update_bookmarks", (ws, c) =>
    ws.bulkUpdateBookmarks(
      requireWireKwarg(c, "entries") as readonly BulkUpdateBookmarkEntry[],
    ),
  );
  bind("workspace.bookmark_linked_dashboard_ids", (ws, c) =>
    ws.bookmarkLinkedDashboardIds(requireWireKwarg(c, "bookmark_id") as number),
  );
  bind("workspace.get_bookmark_history", (ws, c) =>
    ws.getBookmarkHistory(
      requireWireKwarg(c, "bookmark_id") as number,
      optionsBag<WorkspaceGetBookmarkHistoryOptions>(c, ["bookmark_id"]),
    ),
  );
  bind("workspace.list_cohorts_full", (ws, c) =>
    ws.listCohortsFull(optionsBag<WorkspaceListCohortsFullOptions>(c, [])),
  );
  bind("workspace.get_cohort", (ws, c) =>
    ws.getCohort(requireWireKwarg(c, "cohort_id") as number),
  );
  bind("workspace.create_cohort", (ws, c) =>
    ws.createCohort(requireWireKwarg(c, "params") as CreateCohortParams),
  );
  bind("workspace.update_cohort", (ws, c) =>
    ws.updateCohort(
      requireWireKwarg(c, "cohort_id") as number,
      requireWireKwarg(c, "params") as UpdateCohortParams,
    ),
  );
  bind("workspace.delete_cohort", (ws, c) =>
    ws.deleteCohort(requireWireKwarg(c, "cohort_id") as number),
  );
  bind("workspace.bulk_delete_cohorts", (ws, c) =>
    ws.bulkDeleteCohorts(requireWireKwarg(c, "ids") as readonly number[]),
  );
  bind("workspace.bulk_update_cohorts", (ws, c) =>
    ws.bulkUpdateCohorts(
      requireWireKwarg(c, "entries") as readonly BulkUpdateCohortEntry[],
    ),
  );

  // -------------------------------------------------------------------
  // W4 — feature flags + experiments (23)
  // -------------------------------------------------------------------

  bind("workspace.list_feature_flags", (ws, c) =>
    ws.listFeatureFlags(optionsBag<WorkspaceListFeatureFlagsOptions>(c, [])),
  );
  bind("workspace.create_feature_flag", (ws, c) =>
    ws.createFeatureFlag(
      requireWireKwarg(c, "params") as CreateFeatureFlagParams,
    ),
  );
  bind("workspace.get_feature_flag", (ws, c) =>
    ws.getFeatureFlag(requireWireKwarg(c, "flag_id") as string),
  );
  bind("workspace.update_feature_flag", (ws, c) =>
    ws.updateFeatureFlag(
      requireWireKwarg(c, "flag_id") as string,
      requireWireKwarg(c, "params") as UpdateFeatureFlagParams,
    ),
  );
  bind("workspace.delete_feature_flag", (ws, c) =>
    ws.deleteFeatureFlag(requireWireKwarg(c, "flag_id") as string),
  );
  bind("workspace.archive_feature_flag", (ws, c) =>
    ws.archiveFeatureFlag(requireWireKwarg(c, "flag_id") as string),
  );
  bind("workspace.restore_feature_flag", (ws, c) =>
    ws.restoreFeatureFlag(requireWireKwarg(c, "flag_id") as string),
  );
  bind("workspace.duplicate_feature_flag", (ws, c) =>
    ws.duplicateFeatureFlag(requireWireKwarg(c, "flag_id") as string),
  );
  bind("workspace.set_flag_test_users", (ws, c) =>
    ws.setFlagTestUsers(
      requireWireKwarg(c, "flag_id") as string,
      requireWireKwarg(c, "params") as SetTestUsersParams,
    ),
  );
  bind("workspace.get_flag_history", (ws, c) =>
    ws.getFlagHistory(
      requireWireKwarg(c, "flag_id") as string,
      optionsBag<WorkspaceGetFlagHistoryOptions>(c, ["flag_id"]),
    ),
  );
  bind("workspace.get_flag_limits", (ws) => ws.getFlagLimits());
  bind("workspace.list_experiments", (ws, c) =>
    ws.listExperiments(optionsBag<WorkspaceListExperimentsOptions>(c, [])),
  );
  bind("workspace.create_experiment", (ws, c) =>
    ws.createExperiment(
      requireWireKwarg(c, "params") as CreateExperimentParams,
    ),
  );
  bind("workspace.get_experiment", (ws, c) =>
    ws.getExperiment(requireWireKwarg(c, "experiment_id") as string),
  );
  bind("workspace.update_experiment", (ws, c) =>
    ws.updateExperiment(
      requireWireKwarg(c, "experiment_id") as string,
      requireWireKwarg(c, "params") as UpdateExperimentParams,
    ),
  );
  bind("workspace.delete_experiment", (ws, c) =>
    ws.deleteExperiment(requireWireKwarg(c, "experiment_id") as string),
  );
  bind("workspace.launch_experiment", (ws, c) =>
    ws.launchExperiment(requireWireKwarg(c, "experiment_id") as string),
  );
  bind("workspace.conclude_experiment", (ws, c) =>
    ws.concludeExperiment(
      requireWireKwarg(c, "experiment_id") as string,
      optionsBag<WorkspaceConcludeExperimentOptions>(c, ["experiment_id"]),
    ),
  );
  bind("workspace.decide_experiment", (ws, c) =>
    ws.decideExperiment(
      requireWireKwarg(c, "experiment_id") as string,
      requireWireKwarg(c, "params") as ExperimentDecideParams,
    ),
  );
  bind("workspace.archive_experiment", (ws, c) =>
    ws.archiveExperiment(requireWireKwarg(c, "experiment_id") as string),
  );
  bind("workspace.restore_experiment", (ws, c) =>
    ws.restoreExperiment(requireWireKwarg(c, "experiment_id") as string),
  );
  bind("workspace.duplicate_experiment", (ws, c) =>
    ws.duplicateExperiment(
      requireWireKwarg(c, "experiment_id") as string,
      requireWireKwarg(c, "params") as DuplicateExperimentParams,
    ),
  );
  bind("workspace.list_erf_experiments", (ws) => ws.listErfExperiments());

  // -------------------------------------------------------------------
  // W5 — annotations + webhooks + alerts (23)
  // -------------------------------------------------------------------

  bind("workspace.list_annotations", (ws, c) =>
    ws.listAnnotations(optionsBag<WorkspaceListAnnotationsOptions>(c, [])),
  );
  bind("workspace.create_annotation", (ws, c) =>
    ws.createAnnotation(
      requireWireKwarg(c, "params") as CreateAnnotationParams,
    ),
  );
  bind("workspace.get_annotation", (ws, c) =>
    ws.getAnnotation(requireWireKwarg(c, "annotation_id") as number),
  );
  bind("workspace.update_annotation", (ws, c) =>
    ws.updateAnnotation(
      requireWireKwarg(c, "annotation_id") as number,
      requireWireKwarg(c, "params") as UpdateAnnotationParams,
    ),
  );
  bind("workspace.delete_annotation", (ws, c) =>
    ws.deleteAnnotation(requireWireKwarg(c, "annotation_id") as number),
  );
  bind("workspace.list_annotation_tags", (ws) => ws.listAnnotationTags());
  bind("workspace.create_annotation_tag", (ws, c) =>
    ws.createAnnotationTag(
      requireWireKwarg(c, "params") as CreateAnnotationTagParams,
    ),
  );
  bind("workspace.list_webhooks", (ws) => ws.listWebhooks());
  bind("workspace.create_webhook", (ws, c) =>
    ws.createWebhook(requireWireKwarg(c, "params") as CreateWebhookParams),
  );
  bind("workspace.update_webhook", (ws, c) =>
    ws.updateWebhook(
      requireWireKwarg(c, "webhook_id") as string,
      requireWireKwarg(c, "params") as UpdateWebhookParams,
    ),
  );
  bind("workspace.delete_webhook", (ws, c) =>
    ws.deleteWebhook(requireWireKwarg(c, "webhook_id") as string),
  );
  bind("workspace.test_webhook", (ws, c) =>
    ws.testWebhook(requireWireKwarg(c, "params") as WebhookTestParams),
  );
  bind("workspace.list_alerts", (ws, c) =>
    ws.listAlerts(optionsBag<WorkspaceListAlertsOptions>(c, [])),
  );
  bind("workspace.create_alert", (ws, c) =>
    ws.createAlert(requireWireKwarg(c, "params") as CreateAlertParams),
  );
  bind("workspace.get_alert", (ws, c) =>
    ws.getAlert(requireWireKwarg(c, "alert_id") as number),
  );
  bind("workspace.update_alert", (ws, c) =>
    ws.updateAlert(
      requireWireKwarg(c, "alert_id") as number,
      requireWireKwarg(c, "params") as UpdateAlertParams,
    ),
  );
  bind("workspace.delete_alert", (ws, c) =>
    ws.deleteAlert(requireWireKwarg(c, "alert_id") as number),
  );
  bind("workspace.bulk_delete_alerts", (ws, c) =>
    ws.bulkDeleteAlerts(requireWireKwarg(c, "ids") as readonly number[]),
  );
  bind("workspace.get_alert_count", (ws, c) =>
    ws.getAlertCount(optionsBag<WorkspaceGetAlertCountOptions>(c, [])),
  );
  bind("workspace.get_alert_history", (ws, c) =>
    ws.getAlertHistory(
      requireWireKwarg(c, "alert_id") as number,
      optionsBag<WorkspaceGetAlertHistoryOptions>(c, ["alert_id"]),
    ),
  );
  bind("workspace.test_alert", (ws, c) =>
    ws.testAlert(requireWireKwarg(c, "params") as CreateAlertParams),
  );
  bind("workspace.get_alert_screenshot_url", (ws, c) =>
    ws.getAlertScreenshotUrl(requireWireKwarg(c, "gcs_key") as string),
  );
  bind("workspace.validate_alerts_for_bookmark", (ws, c) =>
    ws.validateAlertsForBookmark(
      requireWireKwarg(c, "params") as ValidateAlertsForBookmarkParams,
    ),
  );

  // -------------------------------------------------------------------
  // W6 — lexicon data definitions + tracking & history (15)
  // -------------------------------------------------------------------

  bind("workspace.get_event_definitions", (ws, c) =>
    ws.getEventDefinitions(
      optionsBag<WorkspaceGetEventDefinitionsOptions>(c, []),
    ),
  );
  bind("workspace.update_event_definition", (ws, c) =>
    ws.updateEventDefinition(
      requireWireKwarg(c, "event_name") as string,
      requireWireKwarg(c, "params") as UpdateEventDefinitionParams,
    ),
  );
  bind("workspace.delete_event_definition", (ws, c) =>
    ws.deleteEventDefinition(requireWireKwarg(c, "event_name") as string),
  );
  bind("workspace.bulk_update_event_definitions", (ws, c) =>
    ws.bulkUpdateEventDefinitions(
      requireWireKwarg(c, "params") as BulkUpdateEventsParams,
    ),
  );
  bind("workspace.get_property_definitions", (ws, c) =>
    ws.getPropertyDefinitions(
      optionsBag<WorkspaceGetPropertyDefinitionsOptions>(c, []),
    ),
  );
  bind("workspace.update_property_definition", (ws, c) =>
    ws.updatePropertyDefinition(
      requireWireKwarg(c, "property_name") as string,
      requireWireKwarg(c, "params") as UpdatePropertyDefinitionParams,
    ),
  );
  bind("workspace.bulk_update_property_definitions", (ws, c) =>
    ws.bulkUpdatePropertyDefinitions(
      requireWireKwarg(c, "params") as BulkUpdatePropertiesParams,
    ),
  );
  bind("workspace.list_lexicon_tags", (ws) => ws.listLexiconTags());
  bind("workspace.create_lexicon_tag", (ws, c) =>
    ws.createLexiconTag(requireWireKwarg(c, "params") as CreateTagParams),
  );
  bind("workspace.update_lexicon_tag", (ws, c) =>
    ws.updateLexiconTag(
      requireWireKwarg(c, "tag_id") as number,
      requireWireKwarg(c, "params") as UpdateTagParams,
    ),
  );
  bind("workspace.delete_lexicon_tag", (ws, c) =>
    ws.deleteLexiconTag(requireWireKwarg(c, "tag_name") as string),
  );
  bind("workspace.get_tracking_metadata", (ws, c) =>
    ws.getTrackingMetadata(requireWireKwarg(c, "event_name") as string),
  );
  bind("workspace.get_event_history", (ws, c) =>
    ws.getEventHistory(requireWireKwarg(c, "event_name") as string),
  );
  bind("workspace.get_property_history", (ws, c) =>
    ws.getPropertyHistory(
      requireWireKwarg(c, "property_name") as string,
      requireWireKwarg(c, "entity_type") as string,
    ),
  );
  bind("workspace.export_lexicon", (ws, c) =>
    ws.exportLexicon(optionsBag<WorkspaceExportLexiconOptions>(c, [])),
  );

  // -------------------------------------------------------------------
  // W7 — drop filters + custom properties + lookup tables +
  //      custom events (24)
  // -------------------------------------------------------------------

  bind("workspace.list_drop_filters", (ws) => ws.listDropFilters());
  bind("workspace.create_drop_filter", (ws, c) =>
    ws.createDropFilter(
      requireWireKwarg(c, "params") as CreateDropFilterParams,
    ),
  );
  bind("workspace.update_drop_filter", (ws, c) =>
    ws.updateDropFilter(
      requireWireKwarg(c, "params") as UpdateDropFilterParams,
    ),
  );
  bind("workspace.delete_drop_filter", (ws, c) =>
    ws.deleteDropFilter(requireWireKwarg(c, "drop_filter_id") as number),
  );
  bind("workspace.get_drop_filter_limits", (ws) => ws.getDropFilterLimits());
  bind("workspace.list_custom_properties", (ws) => ws.listCustomProperties());
  bind("workspace.create_custom_property", (ws, c) =>
    ws.createCustomProperty(
      requireWireKwarg(c, "params") as CreateCustomPropertyParams,
    ),
  );
  bind("workspace.get_custom_property", (ws, c) =>
    ws.getCustomProperty(requireWireKwarg(c, "property_id") as string),
  );
  bind("workspace.update_custom_property", (ws, c) =>
    ws.updateCustomProperty(
      requireWireKwarg(c, "property_id") as string,
      requireWireKwarg(c, "params") as UpdateCustomPropertyParams,
    ),
  );
  bind("workspace.delete_custom_property", (ws, c) =>
    ws.deleteCustomProperty(requireWireKwarg(c, "property_id") as string),
  );
  bind("workspace.validate_custom_property", (ws, c) =>
    ws.validateCustomProperty(
      requireWireKwarg(c, "params") as CreateCustomPropertyParams,
    ),
  );
  bind("workspace.list_lookup_tables", (ws, c) =>
    ws.listLookupTables(optionsBag<WorkspaceListLookupTablesOptions>(c, [])),
  );
  bind("workspace.upload_lookup_table", (ws, c) =>
    ws.uploadLookupTable(
      requireWireKwarg(c, "params") as UploadLookupTableParams,
      optionsBag<WorkspaceUploadLookupTableOptions>(c, ["params"]),
    ),
  );
  bind("workspace.mark_lookup_table_ready", (ws, c) =>
    ws.markLookupTableReady(
      requireWireKwarg(c, "params") as MarkLookupTableReadyParams,
    ),
  );
  bind("workspace.get_lookup_upload_url", (ws, c) => {
    // `content_type` is positional-with-default in Python
    // (`"text/csv"`) — some vectors omit it entirely.
    const contentType = c.kwargs["content_type"];
    return contentType === undefined
      ? ws.getLookupUploadUrl()
      : ws.getLookupUploadUrl(contentType as string);
  });
  bind("workspace.get_lookup_upload_status", (ws, c) =>
    ws.getLookupUploadStatus(requireWireKwarg(c, "upload_id") as string),
  );
  bind("workspace.update_lookup_table", (ws, c) =>
    ws.updateLookupTable(
      requireWireKwarg(c, "data_group_id") as number,
      requireWireKwarg(c, "params") as UpdateLookupTableParams,
    ),
  );
  bind("workspace.delete_lookup_tables", (ws, c) =>
    ws.deleteLookupTables(
      requireWireKwarg(c, "data_group_ids") as readonly number[],
    ),
  );
  bind("workspace.download_lookup_table", (ws, c) =>
    ws.downloadLookupTable(
      requireWireKwarg(c, "data_group_id") as number,
      optionsBag<WorkspaceDownloadLookupTableOptions>(c, ["data_group_id"]),
    ),
  );
  bind("workspace.get_lookup_download_url", (ws, c) =>
    ws.getLookupDownloadUrl(requireWireKwarg(c, "data_group_id") as number),
  );
  bind("workspace.create_custom_event", (ws, c) =>
    ws.createCustomEvent(
      requireWireKwarg(c, "params") as CreateCustomEventParams,
    ),
  );
  bind("workspace.list_custom_events", (ws) => ws.listCustomEvents());
  bind("workspace.update_custom_event", (ws, c) =>
    ws.updateCustomEvent(
      requireWireKwarg(c, "custom_event_id") as number,
      requireWireKwarg(c, "params") as UpdateEventDefinitionParams,
    ),
  );
  bind("workspace.delete_custom_event", (ws, c) =>
    ws.deleteCustomEvent(requireWireKwarg(c, "custom_event_id") as number),
  );

  // -------------------------------------------------------------------
  // W8 — schema registry + enforcement + audit + anomalies +
  //      deletion requests (20)
  // -------------------------------------------------------------------

  bind("workspace.list_schema_registry", (ws, c) =>
    ws.listSchemaRegistry(
      optionsBag<WorkspaceListSchemaRegistryOptions>(c, []),
    ),
  );
  bind("workspace.create_schema", (ws, c) =>
    ws.createSchema(
      requireWireKwarg(c, "entity_type") as string,
      requireWireKwarg(c, "entity_name") as string,
      requireWireKwarg(c, "schema_json") as Readonly<Record<string, unknown>>,
    ),
  );
  bind("workspace.create_schemas_bulk", (ws, c) =>
    ws.createSchemasBulk(
      requireWireKwarg(c, "params") as BulkCreateSchemasParams,
    ),
  );
  bind("workspace.update_schema", (ws, c) =>
    ws.updateSchema(
      requireWireKwarg(c, "entity_type") as string,
      requireWireKwarg(c, "entity_name") as string,
      requireWireKwarg(c, "schema_json") as Readonly<Record<string, unknown>>,
    ),
  );
  bind("workspace.update_schemas_bulk", (ws, c) =>
    ws.updateSchemasBulk(
      requireWireKwarg(c, "params") as BulkCreateSchemasParams,
    ),
  );
  bind("workspace.delete_schemas", (ws, c) =>
    ws.deleteSchemas(optionsBag<WorkspaceDeleteSchemasOptions>(c, [])),
  );
  bind("workspace.get_schema_enforcement", (ws, c) =>
    ws.getSchemaEnforcement(
      optionsBag<WorkspaceGetSchemaEnforcementOptions>(c, []),
    ),
  );
  bind("workspace.init_schema_enforcement", (ws, c) =>
    ws.initSchemaEnforcement(
      requireWireKwarg(c, "params") as InitSchemaEnforcementParams,
    ),
  );
  bind("workspace.update_schema_enforcement", (ws, c) =>
    ws.updateSchemaEnforcement(
      requireWireKwarg(c, "params") as UpdateSchemaEnforcementParams,
    ),
  );
  bind("workspace.replace_schema_enforcement", (ws, c) =>
    ws.replaceSchemaEnforcement(
      requireWireKwarg(c, "params") as ReplaceSchemaEnforcementParams,
    ),
  );
  bind("workspace.delete_schema_enforcement", (ws) =>
    ws.deleteSchemaEnforcement(),
  );
  bind("workspace.run_audit", (ws) => ws.runAudit());
  bind("workspace.run_audit_events_only", (ws) => ws.runAuditEventsOnly());
  bind("workspace.list_data_volume_anomalies", (ws, c) =>
    ws.listDataVolumeAnomalies(
      optionsBag<WorkspaceListDataVolumeAnomaliesOptions>(c, []),
    ),
  );
  bind("workspace.update_anomaly", (ws, c) =>
    ws.updateAnomaly(requireWireKwarg(c, "params") as UpdateAnomalyParams),
  );
  bind("workspace.bulk_update_anomalies", (ws, c) =>
    ws.bulkUpdateAnomalies(
      requireWireKwarg(c, "params") as BulkUpdateAnomalyParams,
    ),
  );
  bind("workspace.list_deletion_requests", (ws) => ws.listDeletionRequests());
  bind("workspace.create_deletion_request", (ws, c) =>
    ws.createDeletionRequest(
      requireWireKwarg(c, "params") as CreateDeletionRequestParams,
    ),
  );
  bind("workspace.cancel_deletion_request", (ws, c) =>
    ws.cancelDeletionRequest(requireWireKwarg(c, "request_id") as number),
  );
  bind("workspace.preview_deletion_filters", (ws, c) =>
    ws.previewDeletionFilters(
      requireWireKwarg(c, "params") as PreviewDeletionFiltersParams,
    ),
  );
}
