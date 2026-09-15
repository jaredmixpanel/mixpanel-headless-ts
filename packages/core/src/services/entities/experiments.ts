/**
 * Experiment CRUD/lifecycle wire methods (App API) — Phase-3 packet
 * B4-C4 port of the `MixpanelAPIClient` experiments range
 * (`api_client.py:5277-5668`).
 *
 * All methods route through B0 `appRequest` over `maybe_scoped_path`
 * (R10.8). Path subtleties locked by Layer-3 + the recorded vectors:
 * collection endpoints keep their trailing slash (`experiments/`,
 * `experiments/erf/`), item/lifecycle endpoints do NOT
 * (`experiments/{id}`, `.../launch`, `.../force_conclude`,
 * `.../decide`, `.../archive`, `.../duplicate`). Results are returned
 * verbatim after the source's isinstance guard (Caution #11).
 */

import { appRequest } from "../../client/app-request.js";
import type { ClientCore } from "../../client/client.js";
import type { JsonValue } from "../../client/json-value.js";
import { maybeScopedPath } from "../../client/scope.js";
import {
  expectListResult,
  expectRecordResult,
  truthyRecord,
} from "./shared.js";

/** Options bag of {@link ExperimentMethods.listExperiments}. */
export interface ListExperimentsOptions {
  /** When true, include archived experiments (`include_archived`). */
  readonly include_archived?: boolean | undefined;
  /** Optional cancellation signal (R6.7). */
  readonly signal?: AbortSignal | undefined;
}

/** The C4 experiment method surface (mixed into `MixpanelClient`). */
export interface ExperimentMethods {
  /**
   * List experiments (`list_experiments`, `api_client.py:5277-5313` —
   * GET `experiments/`).
   *
   * @param options - include_archived + signal.
   * @returns The experiment list verbatim.
   * @throws MixpanelHeadlessError - Non-list response.
   * @throws AuthenticationError | RateLimitError | QueryError |
   *   ServerError - Per the B0 `appRequest` contract.
   */
  listExperiments: (options?: ListExperimentsOptions) => Promise<JsonValue[]>;

  /**
   * Create an experiment (`create_experiment`, `:5315-5346` — POST
   * `experiments/`).
   *
   * @param body - Experiment creation payload (`name` required).
   * @param signal - Optional cancellation signal.
   * @returns The created experiment dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  createExperiment: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Get an experiment by ID (`get_experiment`, `:5348-5379` — no
   * trailing slash).
   *
   * @param experimentId - Experiment UUID.
   * @param signal - Optional cancellation signal.
   * @returns The experiment dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  getExperiment: (
    experimentId: string,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Update an experiment (`update_experiment`, `:5381-5415` — PATCH,
   * no trailing slash).
   *
   * @param experimentId - Experiment UUID.
   * @param body - Partial update payload.
   * @param signal - Optional cancellation signal.
   * @returns The updated experiment dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  updateExperiment: (
    experimentId: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Delete an experiment (`delete_experiment`, `:5417-5439`).
   *
   * @param experimentId - Experiment UUID.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   */
  deleteExperiment: (
    experimentId: string,
    signal?: AbortSignal,
  ) => Promise<void>;

  /**
   * Launch an experiment (`launch_experiment`, `:5441-5472` — PUT
   * `experiments/{id}/launch`, NO body).
   *
   * @param experimentId - Experiment UUID.
   * @param signal - Optional cancellation signal.
   * @returns The launched experiment dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  launchExperiment: (
    experimentId: string,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Conclude an experiment (`conclude_experiment`, `:5474-5509` — PUT
   * `experiments/{id}/force_conclude`; ALWAYS sends a JSON body,
   * `body or {}`).
   *
   * @param experimentId - Experiment UUID.
   * @param body - Optional conclude parameters (defaults to `{}`).
   * @param signal - Optional cancellation signal.
   * @returns The concluded experiment dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  concludeExperiment: (
    experimentId: string,
    body?: Record<string, unknown> | null,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Record an experiment decision (`decide_experiment`, `:5511-5545`
   * — PATCH `experiments/{id}/decide`).
   *
   * @param experimentId - Experiment UUID.
   * @param body - Decision payload (`success` required).
   * @param signal - Optional cancellation signal.
   * @returns The decided experiment dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  decideExperiment: (
    experimentId: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Archive an experiment (`archive_experiment`, `:5547-5569` — POST
   * `experiments/{id}/archive`).
   *
   * @param experimentId - Experiment UUID.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   */
  archiveExperiment: (
    experimentId: string,
    signal?: AbortSignal,
  ) => Promise<void>;

  /**
   * Restore an archived experiment (`restore_experiment`,
   * `:5571-5602` — DELETE `experiments/{id}/archive`).
   *
   * @param experimentId - Experiment UUID.
   * @param signal - Optional cancellation signal.
   * @returns The restored experiment dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  restoreExperiment: (
    experimentId: string,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Duplicate an experiment (`duplicate_experiment`, `:5604-5638` —
   * POST `experiments/{id}/duplicate`; body sent ONLY when truthy,
   * `json_body=body if body else None`).
   *
   * @param experimentId - Experiment UUID.
   * @param body - Optional duplication parameters.
   * @param signal - Optional cancellation signal.
   * @returns The duplicated experiment dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  duplicateExperiment: (
    experimentId: string,
    body?: Record<string, unknown> | null,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * List experiments in ERF format (`list_erf_experiments`,
   * `:5640-5668` — GET `experiments/erf/`).
   *
   * @param signal - Optional cancellation signal.
   * @returns The ERF experiment list verbatim.
   * @throws MixpanelHeadlessError - Non-list response.
   */
  listErfExperiments: (signal?: AbortSignal) => Promise<JsonValue[]>;
}

/**
 * Build the C4 experiment methods over the C1 core seam.
 *
 * @param core - The shared client internals seam.
 * @returns The method bag.
 */
export function createExperimentMethods(core: ClientCore): ExperimentMethods {
  /** `self.maybe_scoped_path(...)` over the CURRENT pin (call-time). */
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
      // AND `{}` both send NO body.
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
