/**
 * Experiment CRUD and lifecycle wire methods on the App API
 * (`experiments/`, workspace-scoped through `maybe_scoped_path`). Path
 * shapes are mirrored exactly: collection endpoints keep their trailing
 * slash (`experiments/`, `experiments/erf/`), item and lifecycle
 * endpoints do not (`experiments/{id}`, `.../launch`,
 * `.../force_conclude`, `.../decide`, `.../archive`, `.../duplicate`).
 * Results come back verbatim after Python's isinstance guard.
 *
 * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.list_experiments
 */

import { appRequest } from "../../client/app-request.js";
import type { ClientCore } from "../../client/core.js";
import type { JsonValue } from "../../client/json-value.js";
import { maybeScopedPath } from "../../client/scope.js";
import {
  expectListResult,
  expectRecordResult,
  truthyRecord,
} from "./shared.js";

/** Options bag of {@link ExperimentMethods.listExperiments}. */
export interface ListExperimentsOptions {
  /**
   * Include archived experiments (`include_archived` on the wire).
   *
   * @defaultValue `false`
   */
  readonly include_archived?: boolean | undefined;
  /** Optional cancellation signal. */
  readonly signal?: AbortSignal | undefined;
}

/** Experiment methods mixed into `MixpanelClient`. */
export interface ExperimentMethods {
  /**
   * List experiments. Sends GET `experiments/`.
   *
   * @param options - include_archived + signal.
   * @returns The experiment list verbatim.
   * @throws {@link MixpanelHeadlessError} - Non-list response.
   * @throws {@link AuthenticationError} - Invalid or expired credentials (401).
   * @throws {@link RateLimitError} - Rate limit still exceeded after the retries
   *   (429).
   * @throws {@link QueryError} - Other 4xx responses (400/403/404/422).
   * @throws {@link ServerError} - Server-side errors (5xx).
   * @internal
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.list_experiments
   */
  listExperiments: (options?: ListExperimentsOptions) => Promise<JsonValue[]>;

  /**
   * Create an experiment. Sends POST `experiments/`.
   *
   * @param body - Experiment creation payload (`name` required).
   * @param signal - Optional cancellation signal.
   * @returns The created experiment dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.create_experiment
   */
  createExperiment: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Get an experiment by ID. Sends GET `experiments/{id}` (no trailing slash).
   *
   * @param experimentId - Experiment UUID.
   * @param signal - Optional cancellation signal.
   * @returns The experiment dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.get_experiment
   */
  getExperiment: (
    experimentId: string,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Update an experiment. Sends PATCH `experiments/{id}` (no trailing slash).
   *
   * @param experimentId - Experiment UUID.
   * @param body - Partial update payload.
   * @param signal - Optional cancellation signal.
   * @returns The updated experiment dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.update_experiment
   */
  updateExperiment: (
    experimentId: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Delete an experiment.
   *
   * @param experimentId - Experiment UUID.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.delete_experiment
   */
  deleteExperiment: (
    experimentId: string,
    signal?: AbortSignal,
  ) => Promise<void>;

  /**
   * Launch an experiment. Sends PUT `experiments/{id}/launch`, no body.
   *
   * @param experimentId - Experiment UUID.
   * @param signal - Optional cancellation signal.
   * @returns The launched experiment dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.launch_experiment
   */
  launchExperiment: (
    experimentId: string,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Conclude an experiment. Sends PUT `experiments/{id}/force_conclude`; always
   * sends a JSON body, `body or {}`.
   *
   * @param experimentId - Experiment UUID.
   * @param body - Optional conclude parameters (defaults to `{}`).
   * @param signal - Optional cancellation signal.
   * @returns The concluded experiment dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.conclude_experiment
   */
  concludeExperiment: (
    experimentId: string,
    body?: Record<string, unknown> | null,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Record an experiment decision. Sends PATCH `experiments/{id}/decide`.
   *
   * @param experimentId - Experiment UUID.
   * @param body - Decision payload (`success` required).
   * @param signal - Optional cancellation signal.
   * @returns The decided experiment dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.decide_experiment
   */
  decideExperiment: (
    experimentId: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Archive an experiment. Sends POST `experiments/{id}/archive`.
   *
   * @param experimentId - Experiment UUID.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.archive_experiment
   */
  archiveExperiment: (
    experimentId: string,
    signal?: AbortSignal,
  ) => Promise<void>;

  /**
   * Restore an archived experiment. Sends DELETE `experiments/{id}/archive`.
   *
   * @param experimentId - Experiment UUID.
   * @param signal - Optional cancellation signal.
   * @returns The restored experiment dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.restore_experiment
   */
  restoreExperiment: (
    experimentId: string,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Duplicate an experiment. Sends POST `experiments/{id}/duplicate`; body sent
   * only when truthy, `json_body=body if body else None`.
   *
   * @param experimentId - Experiment UUID.
   * @param body - Optional duplication parameters.
   * @param signal - Optional cancellation signal.
   * @returns The duplicated experiment dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.duplicate_experiment
   */
  duplicateExperiment: (
    experimentId: string,
    body?: Record<string, unknown> | null,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * List experiments in ERF format. Sends GET `experiments/erf/`.
   *
   * @param signal - Optional cancellation signal.
   * @returns The ERF experiment list verbatim.
   * @throws {@link MixpanelHeadlessError} - Non-list response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.list_erf_experiments
   */
  listErfExperiments: (signal?: AbortSignal) => Promise<JsonValue[]>;
}

/**
 * Build the experiment methods over the shared client core.
 *
 * @param core - The shared client internals seam.
 * @returns The method bag.
 * @example
 * ```typescript
 * const experiments = createExperimentMethods(core);
 * await experiments.concludeExperiment("7a1c...", { winner: "variant_b" });
 * // { id: "7a1c...", status: "concluded", ... }
 * ```
 */
// eslint-disable-next-line max-lines-per-function -- branch-for-branch port of one Python function (see the docblock); splitting it would scatter the guard order the corpus pins
export function createExperimentMethods(core: ClientCore): ExperimentMethods {
  /**
   * Scope a domain path to the project and the workspace pinned at call
   * time.
   *
   * @param domainPath - Path relative to the domain root.
   * @returns The `/projects/{pid}[/workspaces/{wid}]/{domainPath}` path.
   */
  const scopedPath = (domainPath: string): string =>
    maybeScopedPath(domainPath, {
      projectId: core.projectId(),
      workspaceId: core.workspaceId(),
    });

  return {
    listExperiments: async (
      options: ListExperimentsOptions = {},
    ): Promise<JsonValue[]> => {
      const path = scopedPath("experiments/");
      const params: Record<string, string> = {};
      if (options.include_archived) {
        params["include_archived"] = "true";
      }
      const result = await appRequest(
        core.appDeps(options.signal),
        "GET",
        path,
        { params: Object.keys(params).length > 0 ? params : undefined },
      );
      return expectListResult(result, "list_experiments");
    },

    createExperiment: async (
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath("experiments/");
      const result = await appRequest(core.appDeps(signal), "POST", path, {
        jsonBody: body,
      });
      return expectRecordResult(result, "create_experiment");
    },

    getExperiment: async (
      experimentId: string,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath(`experiments/${experimentId}`);
      const result = await appRequest(core.appDeps(signal), "GET", path);
      return expectRecordResult(result, "get_experiment");
    },

    updateExperiment: async (
      experimentId: string,
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath(`experiments/${experimentId}`);
      const result = await appRequest(core.appDeps(signal), "PATCH", path, {
        jsonBody: body,
      });
      return expectRecordResult(result, "update_experiment");
    },

    deleteExperiment: async (
      experimentId: string,
      signal?: AbortSignal,
    ): Promise<void> => {
      const path = scopedPath(`experiments/${experimentId}`);
      await appRequest(core.appDeps(signal), "DELETE", path);
    },

    launchExperiment: async (
      experimentId: string,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath(`experiments/${experimentId}/launch`);
      const result = await appRequest(core.appDeps(signal), "PUT", path);
      return expectRecordResult(result, "launch_experiment");
    },

    concludeExperiment: async (
      experimentId: string,
      body?: Record<string, unknown> | null,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath(`experiments/${experimentId}/force_conclude`);
      // `json_body=body or {}` — falsy (None/empty) becomes `{}`.
      const result = await appRequest(core.appDeps(signal), "PUT", path, {
        jsonBody: truthyRecord(body) ? body : {},
      });
      return expectRecordResult(result, "conclude_experiment");
    },

    decideExperiment: async (
      experimentId: string,
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath(`experiments/${experimentId}/decide`);
      const result = await appRequest(core.appDeps(signal), "PATCH", path, {
        jsonBody: body,
      });
      return expectRecordResult(result, "decide_experiment");
    },

    archiveExperiment: async (
      experimentId: string,
      signal?: AbortSignal,
    ): Promise<void> => {
      const path = scopedPath(`experiments/${experimentId}/archive`);
      await appRequest(core.appDeps(signal), "POST", path);
    },

    restoreExperiment: async (
      experimentId: string,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath(`experiments/${experimentId}/archive`);
      const result = await appRequest(core.appDeps(signal), "DELETE", path);
      return expectRecordResult(result, "restore_experiment");
    },

    duplicateExperiment: async (
      experimentId: string,
      body?: Record<string, unknown> | null,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath(`experiments/${experimentId}/duplicate`);
      // `json_body=body if body else None` — Python truthiness: None
      // and `{}` both send no body.
      const result = await appRequest(core.appDeps(signal), "POST", path, {
        jsonBody: truthyRecord(body) ? body : null,
      });
      return expectRecordResult(result, "duplicate_experiment");
    },

    listErfExperiments: async (signal?: AbortSignal): Promise<JsonValue[]> => {
      const path = scopedPath("experiments/erf/");
      const result = await appRequest(core.appDeps(signal), "GET", path);
      return expectListResult(result, "list_erf_experiments");
    },
  };
}
