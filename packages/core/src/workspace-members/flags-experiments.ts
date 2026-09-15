/**
 * Feature-flag and experiment members of the `Workspace` facade: CRUD,
 * the archive / restore / duplicate lifecycle, test-user overrides, flag
 * history and limits, and the experiment launch → conclude → decide
 * flow. Each function is the body of one facade method — options-bag
 * mapping, the params dump, the like-named client call and result-model
 * validation with the endpoint name Python passes. No request assembly,
 * header merging, URL building or status branching happens here.
 *
 * @see mixpanel_headless.workspace.Workspace
 */

import type { MixpanelClient } from "../client/client.js";
import { toNativeJson } from "../client/json-value.js";
import {
  validateResponseModel,
  validateResponseModels,
} from "../client/response-validation.js";
import { pythonStr } from "../compat/index.js";
import {
  type CreateExperimentParams,
  type DuplicateExperimentParams,
  Experiment,
  type ExperimentConcludeParams,
  type ExperimentDecideParams,
  type UpdateExperimentParams,
} from "../types/entities/experiments.js";
import {
  type CreateFeatureFlagParams,
  FeatureFlag,
  FlagHistoryResponse,
  FlagLimitsResponse,
  type SetTestUsersParams,
  type UpdateFeatureFlagParams,
} from "../types/entities/feature-flags.js";
import { requireResponse } from "./shared.js";

/** Options bag of `Workspace.listFeatureFlags` (keyword-only in Python). */
export interface WorkspaceListFeatureFlagsOptions {
  /**
   * Include archived flags.
   *
   * @defaultValue `false`
   */
  readonly include_archived?: boolean;
}

/** Options bag of `Workspace.getFlagHistory` (keyword-only tail). */
export interface WorkspaceGetFlagHistoryOptions {
  /**
   * Pagination cursor from a previous page.
   *
   * @defaultValue `null` (first page)
   */
  readonly page?: string | null | undefined;
  /**
   * Results per page.
   *
   * @defaultValue `null` (server default)
   */
  readonly page_size?: number | null | undefined;
}

/** Options bag of `Workspace.listExperiments` (keyword-only in Python). */
export interface WorkspaceListExperimentsOptions {
  /**
   * Include archived experiments.
   *
   * @defaultValue `false`
   */
  readonly include_archived?: boolean;
}

/** Options bag of `Workspace.concludeExperiment` (keyword-only tail). */
export interface WorkspaceConcludeExperimentOptions {
  /**
   * Conclude parameters, e.g. an end-date override.
   *
   * @defaultValue `null` (an empty body is sent)
   */
  readonly params?: ExperimentConcludeParams | null | undefined;
}

// --- Feature-flag CRUD ---

/**
 * List feature flags for the current project/workspace.
 *
 * @param client - The wire client.
 * @param options - `include_archived` (keyword-only in Python).
 * @returns The `FeatureFlag` models, in response order.
 * @throws {@link ResponseValidationError} - Malformed payload
 *   (`RESPONSE_VALIDATION_ERROR`).
 * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
 *   failures.
 * @example
 * ```typescript
 * const flags = await ws.listFeatureFlags({ include_archived: true });
 * ```
 * @see mixpanel_headless.workspace.Workspace.list_feature_flags
 */
export async function listFeatureFlags(
  client: MixpanelClient,
  options: WorkspaceListFeatureFlagsOptions = {},
): Promise<FeatureFlag[]> {
  const raw = await client.listFeatureFlags({
    include_archived: options.include_archived ?? false,
  });
  return validateResponseModels(
    FeatureFlag,
    raw.map((item) => toNativeJson(item)),
    {
      endpoint: "list_feature_flags",
    },
  );
}

/**
 * Create a new feature flag.
 *
 * @param client - The wire client.
 * @param params - Flag creation parameters.
 * @returns The newly created `FeatureFlag`.
 * @throws {@link MixpanelHeadlessError} - Empty response (`UNKNOWN_ERROR`).
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const flag = await ws.createFeatureFlag(
 *   new CreateFeatureFlagParams({ name: "New checkout", key: "new_checkout" }),
 * );
 * ```
 * @see mixpanel_headless.workspace.Workspace.create_feature_flag
 */
export async function createFeatureFlag(
  client: MixpanelClient,
  params: CreateFeatureFlagParams,
): Promise<FeatureFlag> {
  const raw: unknown = await client.createFeatureFlag(
    params.modelDumpExcludeNone(),
  );
  return validateResponseModel(
    FeatureFlag,
    toNativeJson(requireResponse(raw, "create_feature_flag")),
    { endpoint: "create_feature_flag" },
  );
}

/**
 * Fetch a single feature flag by id.
 *
 * @param client - The wire client.
 * @param flagId - Feature flag UUID.
 * @returns The `FeatureFlag`.
 * @throws {@link MixpanelHeadlessError} - Empty response (`UNKNOWN_ERROR`).
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const flag = await ws.getFeatureFlag(flagId);
 * ```
 * @see mixpanel_headless.workspace.Workspace.get_feature_flag
 */
export async function getFeatureFlag(
  client: MixpanelClient,
  flagId: string,
): Promise<FeatureFlag> {
  const raw: unknown = await client.getFeatureFlag(flagId);
  return validateResponseModel(
    FeatureFlag,
    toNativeJson(requireResponse(raw, "get_feature_flag")),
    { endpoint: "get_feature_flag" },
  );
}

/**
 * Update a feature flag with full-replacement (PUT) semantics.
 *
 * @param client - The wire client.
 * @param flagId - Feature flag UUID.
 * @param params - Complete flag configuration.
 * @returns The updated `FeatureFlag`.
 * @throws {@link MixpanelHeadlessError} - Empty response (`UNKNOWN_ERROR`).
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * await ws.updateFeatureFlag(
 *   flagId,
 *   new UpdateFeatureFlagParams({ name: flag.name, key: flag.key, ruleset }),
 * );
 * ```
 * @see mixpanel_headless.workspace.Workspace.update_feature_flag
 */
export async function updateFeatureFlag(
  client: MixpanelClient,
  flagId: string,
  params: UpdateFeatureFlagParams,
): Promise<FeatureFlag> {
  const raw: unknown = await client.updateFeatureFlag(
    flagId,
    params.modelDumpExcludeNone(),
  );
  return validateResponseModel(
    FeatureFlag,
    toNativeJson(requireResponse(raw, "update_feature_flag")),
    { endpoint: "update_feature_flag" },
  );
}

/**
 * Delete a feature flag.
 *
 * @param client - The wire client.
 * @param flagId - Feature flag UUID.
 * @returns Nothing.
 * @example
 * ```typescript
 * await ws.deleteFeatureFlag(flagId);
 * ```
 * @see mixpanel_headless.workspace.Workspace.delete_feature_flag
 */
export async function deleteFeatureFlag(
  client: MixpanelClient,
  flagId: string,
): Promise<void> {
  await client.deleteFeatureFlag(flagId);
}

// --- Feature-flag lifecycle ---

/**
 * Archive a feature flag (a soft delete).
 *
 * @param client - The wire client.
 * @param flagId - Feature flag UUID.
 * @returns Nothing.
 * @example
 * ```typescript
 * await ws.archiveFeatureFlag(flagId);
 * ```
 * @see mixpanel_headless.workspace.Workspace.archive_feature_flag
 */
export async function archiveFeatureFlag(
  client: MixpanelClient,
  flagId: string,
): Promise<void> {
  await client.archiveFeatureFlag(flagId);
}

/**
 * Restore an archived feature flag. There is no empty-response guard.
 *
 * @param client - The wire client.
 * @param flagId - Feature flag UUID.
 * @returns The restored `FeatureFlag`.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const flag = await ws.restoreFeatureFlag(flagId);
 * ```
 * @see mixpanel_headless.workspace.Workspace.restore_feature_flag
 */
export async function restoreFeatureFlag(
  client: MixpanelClient,
  flagId: string,
): Promise<FeatureFlag> {
  const raw = await client.restoreFeatureFlag(flagId);
  return validateResponseModel(FeatureFlag, toNativeJson(raw), {
    endpoint: "restore_feature_flag",
  });
}

/**
 * Duplicate a feature flag. There is no empty-response guard.
 *
 * @param client - The wire client.
 * @param flagId - Feature flag UUID.
 * @returns The newly created duplicate `FeatureFlag`.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const copy = await ws.duplicateFeatureFlag(flagId);
 * ```
 * @see mixpanel_headless.workspace.Workspace.duplicate_feature_flag
 */
export async function duplicateFeatureFlag(
  client: MixpanelClient,
  flagId: string,
): Promise<FeatureFlag> {
  const raw = await client.duplicateFeatureFlag(flagId);
  return validateResponseModel(FeatureFlag, toNativeJson(raw), {
    endpoint: "duplicate_feature_flag",
  });
}

// --- Feature-flag operations ---

/**
 * Set test-user variant overrides for a feature flag.
 *
 * @remarks
 * Python's one bare `model_dump()` in this family (no `exclude_none`),
 * so the body is `modelDump()` rather than `modelDumpExcludeNone()`. For
 * `SetTestUsersParams` — one required, alias-free field — the two dumps
 * coincide; the spelling follows the Python call so absent-vs-null stays
 * observable if the model grows.
 * @param client - The wire client.
 * @param flagId - Feature flag UUID.
 * @param params - Test user mapping.
 * @returns Nothing.
 * @example
 * ```typescript
 * await ws.setFlagTestUsers(flagId, new SetTestUsersParams({ users }));
 * ```
 * @see mixpanel_headless.workspace.Workspace.set_flag_test_users
 */
export async function setFlagTestUsers(
  client: MixpanelClient,
  flagId: string,
  params: SetTestUsersParams,
): Promise<void> {
  await client.setFlagTestUsers(flagId, params.modelDump());
}

/**
 * Fetch a page of a feature flag's change history.
 *
 * @param client - The wire client.
 * @param flagId - Feature flag UUID.
 * @param options - `page` / `page_size` (keyword-only in Python).
 * @returns The `FlagHistoryResponse` (events + count).
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const history = await ws.getFlagHistory(flagId, { page_size: 50 });
 * ```
 * @see mixpanel_headless.workspace.Workspace.get_flag_history
 */
export async function getFlagHistory(
  client: MixpanelClient,
  flagId: string,
  options: WorkspaceGetFlagHistoryOptions = {},
): Promise<FlagHistoryResponse> {
  const page = options.page ?? null;
  const pageSize = options.page_size ?? null;
  const queryParams: Record<string, string> = {};
  if (page !== null) {
    queryParams["page"] = page;
  }
  if (pageSize !== null) {
    // Python sends `str(page_size)`.
    queryParams["page_size"] = pythonStr(pageSize);
  }
  // `params=query_params if query_params else None`: an empty dict is
  // falsy in Python, so it collapses to `None`.
  const raw = await client.getFlagHistory(flagId, {
    params: Object.keys(queryParams).length > 0 ? queryParams : null,
  });
  return validateResponseModel(FlagHistoryResponse, toNativeJson(raw), {
    endpoint: "get_flag_history",
  });
}

/**
 * Fetch the account-level feature-flag limits and usage.
 *
 * @param client - The wire client.
 * @returns The `FlagLimitsResponse`.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const limits = await ws.getFlagLimits();
 * ```
 * @see mixpanel_headless.workspace.Workspace.get_flag_limits
 */
export async function getFlagLimits(
  client: MixpanelClient,
): Promise<FlagLimitsResponse> {
  const raw = await client.getFlagLimits();
  return validateResponseModel(FlagLimitsResponse, toNativeJson(raw), {
    endpoint: "get_flag_limits",
  });
}

// --- Experiment CRUD ---

/**
 * List experiments for the current project.
 *
 * @param client - The wire client.
 * @param options - `include_archived` (keyword-only in Python).
 * @returns The `Experiment` models, in response order.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const experiments = await ws.listExperiments({ include_archived: true });
 * ```
 * @see mixpanel_headless.workspace.Workspace.list_experiments
 */
export async function listExperiments(
  client: MixpanelClient,
  options: WorkspaceListExperimentsOptions = {},
): Promise<Experiment[]> {
  const raw = await client.listExperiments({
    include_archived: options.include_archived ?? false,
  });
  return validateResponseModels(
    Experiment,
    raw.map((item) => toNativeJson(item)),
    {
      endpoint: "list_experiments",
    },
  );
}

/**
 * Create a new experiment in Draft status.
 *
 * @param client - The wire client.
 * @param params - Experiment creation parameters.
 * @returns The newly created `Experiment`.
 * @throws {@link MixpanelHeadlessError} - Empty response (`UNKNOWN_ERROR`).
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const experiment = await ws.createExperiment(
 *   new CreateExperimentParams({ name: "Checkout copy test" }),
 * );
 * ```
 * @see mixpanel_headless.workspace.Workspace.create_experiment
 */
export async function createExperiment(
  client: MixpanelClient,
  params: CreateExperimentParams,
): Promise<Experiment> {
  const raw: unknown = await client.createExperiment(
    params.modelDumpExcludeNone(),
  );
  return validateResponseModel(
    Experiment,
    toNativeJson(requireResponse(raw, "create_experiment")),
    { endpoint: "create_experiment" },
  );
}

/**
 * Fetch a single experiment by id.
 *
 * @param client - The wire client.
 * @param experimentId - Experiment UUID.
 * @returns The `Experiment`.
 * @throws {@link MixpanelHeadlessError} - Empty response (`UNKNOWN_ERROR`).
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const experiment = await ws.getExperiment(experimentId);
 * ```
 * @see mixpanel_headless.workspace.Workspace.get_experiment
 */
export async function getExperiment(
  client: MixpanelClient,
  experimentId: string,
): Promise<Experiment> {
  const raw: unknown = await client.getExperiment(experimentId);
  return validateResponseModel(
    Experiment,
    toNativeJson(requireResponse(raw, "get_experiment")),
    { endpoint: "get_experiment" },
  );
}

/**
 * Update an experiment with PATCH semantics.
 *
 * @param client - The wire client.
 * @param experimentId - Experiment UUID.
 * @param params - Fields to update.
 * @returns The updated `Experiment`.
 * @throws {@link MixpanelHeadlessError} - Empty response (`UNKNOWN_ERROR`).
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * await ws.updateExperiment(
 *   experimentId,
 *   new UpdateExperimentParams({ hypothesis: "Shorter copy converts better" }),
 * );
 * ```
 * @see mixpanel_headless.workspace.Workspace.update_experiment
 */
export async function updateExperiment(
  client: MixpanelClient,
  experimentId: string,
  params: UpdateExperimentParams,
): Promise<Experiment> {
  const raw: unknown = await client.updateExperiment(
    experimentId,
    params.modelDumpExcludeNone(),
  );
  return validateResponseModel(
    Experiment,
    toNativeJson(requireResponse(raw, "update_experiment")),
    { endpoint: "update_experiment" },
  );
}

/**
 * Delete an experiment.
 *
 * @param client - The wire client.
 * @param experimentId - Experiment UUID.
 * @returns Nothing.
 * @example
 * ```typescript
 * await ws.deleteExperiment(experimentId);
 * ```
 * @see mixpanel_headless.workspace.Workspace.delete_experiment
 */
export async function deleteExperiment(
  client: MixpanelClient,
  experimentId: string,
): Promise<void> {
  await client.deleteExperiment(experimentId);
}

// --- Experiment lifecycle ---

/**
 * Launch an experiment (Draft → Active). There is no empty-response
 * guard.
 *
 * @param client - The wire client.
 * @param experimentId - Experiment UUID.
 * @returns The launched `Experiment` with updated status.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const active = await ws.launchExperiment(experimentId);
 * ```
 * @see mixpanel_headless.workspace.Workspace.launch_experiment
 */
export async function launchExperiment(
  client: MixpanelClient,
  experimentId: string,
): Promise<Experiment> {
  const raw = await client.launchExperiment(experimentId);
  return validateResponseModel(Experiment, toNativeJson(raw), {
    endpoint: "launch_experiment",
  });
}

/**
 * Conclude an experiment (Active → Concluded). A JSON body is always
 * sent, `{}` when no params are supplied.
 *
 * @remarks
 * Python's `body = params.model_dump(exclude_none=True) if params else {}`
 * is an identity test against `None` — a pydantic model defines neither
 * `__bool__` nor `__len__` — so it is ported as an explicit null check.
 * @param client - The wire client.
 * @param experimentId - Experiment UUID.
 * @param options - `params` (keyword-only in Python).
 * @returns The concluded `Experiment`.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const concluded = await ws.concludeExperiment(experimentId, {
 *   params: new ExperimentConcludeParams({ end_date: "2026-09-30" }),
 * });
 * ```
 * @see mixpanel_headless.workspace.Workspace.conclude_experiment
 */
export async function concludeExperiment(
  client: MixpanelClient,
  experimentId: string,
  options: WorkspaceConcludeExperimentOptions = {},
): Promise<Experiment> {
  const params = options.params ?? null;
  const body: Record<string, unknown> =
    params === null ? {} : params.modelDumpExcludeNone();
  const raw = await client.concludeExperiment(experimentId, body);
  return validateResponseModel(Experiment, toNativeJson(raw), {
    endpoint: "conclude_experiment",
  });
}

/**
 * Record the experiment decision (Concluded → Success / Fail). There is
 * no empty-response guard.
 *
 * @param client - The wire client.
 * @param experimentId - Experiment UUID.
 * @param params - Decision parameters (success, variant, message).
 * @returns The decided `Experiment` with terminal status.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const decided = await ws.decideExperiment(
 *   experimentId,
 *   new ExperimentDecideParams({ success: true, variant: "treatment" }),
 * );
 * ```
 * @see mixpanel_headless.workspace.Workspace.decide_experiment
 */
export async function decideExperiment(
  client: MixpanelClient,
  experimentId: string,
  params: ExperimentDecideParams,
): Promise<Experiment> {
  const raw = await client.decideExperiment(
    experimentId,
    params.modelDumpExcludeNone(),
  );
  return validateResponseModel(Experiment, toNativeJson(raw), {
    endpoint: "decide_experiment",
  });
}

// --- Experiment management ---

/**
 * Archive an experiment.
 *
 * @param client - The wire client.
 * @param experimentId - Experiment UUID.
 * @returns Nothing.
 * @example
 * ```typescript
 * await ws.archiveExperiment(experimentId);
 * ```
 * @see mixpanel_headless.workspace.Workspace.archive_experiment
 */
export async function archiveExperiment(
  client: MixpanelClient,
  experimentId: string,
): Promise<void> {
  await client.archiveExperiment(experimentId);
}

/**
 * Restore an archived experiment. There is no empty-response guard.
 *
 * @param client - The wire client.
 * @param experimentId - Experiment UUID.
 * @returns The restored `Experiment`.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const experiment = await ws.restoreExperiment(experimentId);
 * ```
 * @see mixpanel_headless.workspace.Workspace.restore_experiment
 */
export async function restoreExperiment(
  client: MixpanelClient,
  experimentId: string,
): Promise<Experiment> {
  const raw = await client.restoreExperiment(experimentId);
  return validateResponseModel(Experiment, toNativeJson(raw), {
    endpoint: "restore_experiment",
  });
}

/**
 * Duplicate an experiment under a new name. `params` is positional and
 * required because the API returns an empty body when duplicating
 * without a name.
 *
 * @param client - The wire client.
 * @param experimentId - Experiment UUID.
 * @param params - Duplication parameters (`name` is required).
 * @returns The newly created duplicate `Experiment`.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const copy = await ws.duplicateExperiment(
 *   experimentId,
 *   new DuplicateExperimentParams({ name: "Checkout copy test (v2)" }),
 * );
 * ```
 * @see mixpanel_headless.workspace.Workspace.duplicate_experiment
 */
export async function duplicateExperiment(
  client: MixpanelClient,
  experimentId: string,
  params: DuplicateExperimentParams,
): Promise<Experiment> {
  const body = params.modelDumpExcludeNone();
  const raw = await client.duplicateExperiment(experimentId, body);
  return validateResponseModel(Experiment, toNativeJson(raw), {
    endpoint: "duplicate_experiment",
  });
}

/**
 * List experiments in ERF (Experiment Results Framework) format,
 * verbatim (Python performs no model validation here).
 *
 * @param client - The wire client.
 * @returns The ERF experiment dicts.
 * @example
 * ```typescript
 * const erf = await ws.listErfExperiments();
 * ```
 * @see mixpanel_headless.workspace.Workspace.list_erf_experiments
 */
export async function listErfExperiments(
  client: MixpanelClient,
): Promise<Array<Record<string, unknown>>> {
  const raw = await client.listErfExperiments();
  return raw.map((item) => toNativeJson(item)) as Array<
    Record<string, unknown>
  >;
}
