/**
 * B6-W4 member module — the `Workspace` feature-flag and experiment
 * members (`workspace.py:5751-6461`: FEATURE FLAG CRUD / LIFECYCLE /
 * OPERATIONS and EXPERIMENT CRUD / LIFECYCLE / MANAGEMENT, Phase 025).
 *
 * Packet contract (`b6-packets.md` §2/§6): the `workspace.ts` B6-W4
 * section holds ONE-LINE delegations into this module; every member
 * here is a THIN facade body — options-bag mapping (R3.3/R3.8), the
 * params dump (W1-D4 {@link EntityModel.modelDumpExcludeNone}), the
 * like-named B4-C4 client method
 * (`services/entities/{flags,experiments}.ts`, composed onto the
 * client at `client.ts:1077+`) and result-model construction via
 * `validateResponseModel(s)` with the exact `endpoint=` string Python
 * passes. No request assembly, no header merging, no URL building, no
 * status branching (R10.8 — compose, never re-implement).
 *
 * Two bodies do more than forward, and both are ported
 * branch-for-branch:
 *
 * - {@link getFlagHistory} assembles the optional `page` / `page_size`
 *   query dict exactly as `workspace.py:6053-6060` does — each key is
 *   added only when the kwarg `is not None`, `page_size` is
 *   stringified (`str(page_size)` → `pythonStr`, R11.7), and the whole
 *   dict collapses to `None` when empty (`params=query_params if
 *   query_params else None`).
 * - {@link concludeExperiment} sends `{}` when no params are supplied
 *   (`body = params.model_dump(exclude_none=True) if params else {}`,
 *   `:6300`). A pydantic `BaseModel` defines neither `__bool__` nor
 *   `__len__`, so Python's `if params` is an identity test against
 *   `None` — ported as an explicit null check, never `if (!params)`
 *   (watchlist #6).
 *
 * `set_flag_test_users` is the shard's ONE bare `model_dump()`
 * (`:6021` — no `exclude_none`), so it uses `toJSON()`
 * (`model-base.ts:508`), the dump twin that keeps `None` as `null`.
 * `SetTestUsersParams` declares a single required non-nullable field,
 * so the two dumps coincide on every reachable input; the spelling
 * still follows the Python call (R3.5 absent-vs-null is
 * vector-observable).
 *
 * Empty-response guards (`if raw is None`, packet Caution #8) exist on
 * SIX members only — `create_feature_flag` (`:5810`),
 * `get_feature_flag` (`:5842`), `update_feature_flag` (`:5878`),
 * `create_experiment` (`:6151`), `get_experiment` (`:6183`) and
 * `update_experiment` (`:6221`). The lifecycle/management members
 * (`restore_*`, `duplicate_*`, `launch_*`, `conclude_*`, `decide_*`,
 * `get_flag_history`, `get_flag_limits`) carry NO guard in Python and
 * carry none here.
 */

import type { MixpanelClient } from "../client/client.js";
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
import { native, requireResponse } from "./shared.js";

/** Options bag of `Workspace.listFeatureFlags` (keyword-only in Python). */
export interface WorkspaceListFeatureFlagsOptions {
  /** When `true`, include archived flags (Python default `False`). */
  readonly include_archived?: boolean;
}

/** Options bag of `Workspace.getFlagHistory` (keyword-only tail). */
export interface WorkspaceGetFlagHistoryOptions {
  /** Pagination cursor (Python default `None`). */
  readonly page?: string | null | undefined;
  /** Results per page (Python default `None`). */
  readonly page_size?: number | null | undefined;
}

/** Options bag of `Workspace.listExperiments` (keyword-only in Python). */
export interface WorkspaceListExperimentsOptions {
  /** When `true`, include archived experiments (Python default `False`). */
  readonly include_archived?: boolean;
}

/** Options bag of `Workspace.concludeExperiment` (keyword-only tail). */
export interface WorkspaceConcludeExperimentOptions {
  /** Optional conclude parameters, e.g. an end-date override. */
  readonly params?: ExperimentConcludeParams | null | undefined;
}

// ---------------------------------------------------------------------------
// FEATURE FLAG CRUD (Phase 025) — `workspace.py:5753-5911`
// ---------------------------------------------------------------------------

/**
 * List feature flags for the current project/workspace
 * (`list_feature_flags`, `workspace.py:5753-5782`).
 *
 * @param client - The wire client.
 * @param options - `include_archived` (keyword-only in Python).
 * @returns The `FeatureFlag` models, in response order.
 * @throws ResponseValidationError - Malformed payload
 *   (`RESPONSE_VALIDATION_ERROR`).
 * @throws AuthenticationError | QueryError | ServerError - Wire
 *   failures per the B0 contract.
 */
export async function listFeatureFlags(
  client: MixpanelClient,
  options: WorkspaceListFeatureFlagsOptions = {},
): Promise<FeatureFlag[]> {
  const raw = await client.listFeatureFlags({
    include_archived: options.include_archived ?? false,
  });
  return validateResponseModels(FeatureFlag, raw.map(native), {
    endpoint: "list_feature_flags",
  });
}

/**
 * Create a new feature flag (`create_feature_flag`,
 * `workspace.py:5784-5815`).
 *
 * @param client - The wire client.
 * @param params - Flag creation parameters.
 * @returns The newly created `FeatureFlag`.
 * @throws MixpanelHeadlessError - Empty response (`UNKNOWN_ERROR`).
 * @throws ResponseValidationError - Malformed payload.
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
    native(requireResponse(raw, "create_feature_flag")),
    { endpoint: "create_feature_flag" },
  );
}

/**
 * Get a single feature flag by ID (`get_feature_flag`,
 * `workspace.py:5817-5846`).
 *
 * @param client - The wire client.
 * @param flagId - Feature flag UUID.
 * @returns The `FeatureFlag`.
 * @throws MixpanelHeadlessError - Empty response (`UNKNOWN_ERROR`).
 * @throws ResponseValidationError - Malformed payload.
 */
export async function getFeatureFlag(
  client: MixpanelClient,
  flagId: string,
): Promise<FeatureFlag> {
  const raw: unknown = await client.getFeatureFlag(flagId);
  return validateResponseModel(
    FeatureFlag,
    native(requireResponse(raw, "get_feature_flag")),
    { endpoint: "get_feature_flag" },
  );
}

/**
 * Update a feature flag, full replacement / PUT semantics
 * (`update_feature_flag`, `workspace.py:5848-5886`).
 *
 * @param client - The wire client.
 * @param flagId - Feature flag UUID.
 * @param params - Complete flag configuration.
 * @returns The updated `FeatureFlag`.
 * @throws MixpanelHeadlessError - Empty response (`UNKNOWN_ERROR`).
 * @throws ResponseValidationError - Malformed payload.
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
    native(requireResponse(raw, "update_feature_flag")),
    { endpoint: "update_feature_flag" },
  );
}

/**
 * Delete a feature flag (`delete_feature_flag`,
 * `workspace.py:5888-5907`).
 *
 * @param client - The wire client.
 * @param flagId - Feature flag UUID.
 * @returns Nothing.
 */
export async function deleteFeatureFlag(
  client: MixpanelClient,
  flagId: string,
): Promise<void> {
  await client.deleteFeatureFlag(flagId);
}

// ---------------------------------------------------------------------------
// FEATURE FLAG LIFECYCLE (Phase 025) — `workspace.py:5913-5991`
// ---------------------------------------------------------------------------

/**
 * Archive a feature flag, a soft delete (`archive_feature_flag`,
 * `workspace.py:5913-5932`).
 *
 * @param client - The wire client.
 * @param flagId - Feature flag UUID.
 * @returns Nothing.
 */
export async function archiveFeatureFlag(
  client: MixpanelClient,
  flagId: string,
): Promise<void> {
  await client.archiveFeatureFlag(flagId);
}

/**
 * Restore an archived feature flag (`restore_feature_flag`,
 * `workspace.py:5934-5961`) — no empty-response guard in Python.
 *
 * @param client - The wire client.
 * @param flagId - Feature flag UUID.
 * @returns The restored `FeatureFlag`.
 * @throws ResponseValidationError - Malformed payload.
 */
export async function restoreFeatureFlag(
  client: MixpanelClient,
  flagId: string,
): Promise<FeatureFlag> {
  const raw = await client.restoreFeatureFlag(flagId);
  return validateResponseModel(FeatureFlag, native(raw), {
    endpoint: "restore_feature_flag",
  });
}

/**
 * Duplicate a feature flag (`duplicate_feature_flag`,
 * `workspace.py:5963-5991`) — no empty-response guard in Python.
 *
 * @param client - The wire client.
 * @param flagId - Feature flag UUID.
 * @returns The newly created duplicate `FeatureFlag`.
 * @throws ResponseValidationError - Malformed payload.
 */
export async function duplicateFeatureFlag(
  client: MixpanelClient,
  flagId: string,
): Promise<FeatureFlag> {
  const raw = await client.duplicateFeatureFlag(flagId);
  return validateResponseModel(FeatureFlag, native(raw), {
    endpoint: "duplicate_feature_flag",
  });
}

// ---------------------------------------------------------------------------
// FEATURE FLAG OPERATIONS (Phase 025) — `workspace.py:5996-6091`
// ---------------------------------------------------------------------------

/**
 * Set test-user variant overrides for a feature flag
 * (`set_flag_test_users`, `workspace.py:5996-6019`).
 *
 * The one bare `model_dump()` in the shard (`:6019`) — `modelDump()`
 * is its exact pydantic twin (W8's `modelDump` JSDoc: `toJSON` is NOT
 * a substitute — no extras, no serialization aliases; harmonized at
 * B6-ARB, fidelity F4. For `SetTestUsersParams` the two dumps coincide
 * TODAY — one required alias-free field, `extra='ignore'` — so this is
 * a future-proofing swap with no observable behavior change).
 *
 * @param client - The wire client.
 * @param flagId - Feature flag UUID.
 * @param params - Test user mapping.
 * @returns Nothing.
 */
export async function setFlagTestUsers(
  client: MixpanelClient,
  flagId: string,
  params: SetTestUsersParams,
): Promise<void> {
  await client.setFlagTestUsers(flagId, params.modelDump());
}

/**
 * Get paginated change history for a feature flag
 * (`get_flag_history`, `workspace.py:6021-6063`).
 *
 * @param client - The wire client.
 * @param flagId - Feature flag UUID.
 * @param options - `page` / `page_size` (keyword-only in Python).
 * @returns The `FlagHistoryResponse` (events + count).
 * @throws ResponseValidationError - Malformed payload.
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
    // `str(page_size)` (`:6058`) — R11.7 forbids bare `String()`.
    queryParams["page_size"] = pythonStr(pageSize);
  }
  // `params=query_params if query_params else None` (`:6060`) — an
  // EMPTY dict is falsy in Python, so it collapses to `None`.
  const raw = await client.getFlagHistory(flagId, {
    params: Object.keys(queryParams).length > 0 ? queryParams : null,
  });
  return validateResponseModel(FlagHistoryResponse, native(raw), {
    endpoint: "get_flag_history",
  });
}

/**
 * Get account-level feature flag limits and usage
 * (`get_flag_limits`, `workspace.py:6065-6091`).
 *
 * @param client - The wire client.
 * @returns The `FlagLimitsResponse`.
 * @throws ResponseValidationError - Malformed payload.
 */
export async function getFlagLimits(
  client: MixpanelClient,
): Promise<FlagLimitsResponse> {
  const raw = await client.getFlagLimits();
  return validateResponseModel(FlagLimitsResponse, native(raw), {
    endpoint: "get_flag_limits",
  });
}

// ---------------------------------------------------------------------------
// EXPERIMENT CRUD (Phase 025) — `workspace.py:6096-6248`
// ---------------------------------------------------------------------------

/**
 * List experiments for the current project (`list_experiments`,
 * `workspace.py:6096-6123`).
 *
 * @param client - The wire client.
 * @param options - `include_archived` (keyword-only in Python).
 * @returns The `Experiment` models, in response order.
 * @throws ResponseValidationError - Malformed payload.
 */
export async function listExperiments(
  client: MixpanelClient,
  options: WorkspaceListExperimentsOptions = {},
): Promise<Experiment[]> {
  const raw = await client.listExperiments({
    include_archived: options.include_archived ?? false,
  });
  return validateResponseModels(Experiment, raw.map(native), {
    endpoint: "list_experiments",
  });
}

/**
 * Create a new experiment in Draft status (`create_experiment`,
 * `workspace.py:6125-6156`).
 *
 * @param client - The wire client.
 * @param params - Experiment creation parameters.
 * @returns The newly created `Experiment`.
 * @throws MixpanelHeadlessError - Empty response (`UNKNOWN_ERROR`).
 * @throws ResponseValidationError - Malformed payload.
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
    native(requireResponse(raw, "create_experiment")),
    { endpoint: "create_experiment" },
  );
}

/**
 * Get a single experiment by ID (`get_experiment`,
 * `workspace.py:6158-6187`).
 *
 * @param client - The wire client.
 * @param experimentId - Experiment UUID.
 * @returns The `Experiment`.
 * @throws MixpanelHeadlessError - Empty response (`UNKNOWN_ERROR`).
 * @throws ResponseValidationError - Malformed payload.
 */
export async function getExperiment(
  client: MixpanelClient,
  experimentId: string,
): Promise<Experiment> {
  const raw: unknown = await client.getExperiment(experimentId);
  return validateResponseModel(
    Experiment,
    native(requireResponse(raw, "get_experiment")),
    { endpoint: "get_experiment" },
  );
}

/**
 * Update an experiment, PATCH semantics (`update_experiment`,
 * `workspace.py:6189-6225`).
 *
 * @param client - The wire client.
 * @param experimentId - Experiment UUID.
 * @param params - Fields to update.
 * @returns The updated `Experiment`.
 * @throws MixpanelHeadlessError - Empty response (`UNKNOWN_ERROR`).
 * @throws ResponseValidationError - Malformed payload.
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
    native(requireResponse(raw, "update_experiment")),
    { endpoint: "update_experiment" },
  );
}

/**
 * Delete an experiment (`delete_experiment`,
 * `workspace.py:6227-6246`).
 *
 * @param client - The wire client.
 * @param experimentId - Experiment UUID.
 * @returns Nothing.
 */
export async function deleteExperiment(
  client: MixpanelClient,
  experimentId: string,
): Promise<void> {
  await client.deleteExperiment(experimentId);
}

// ---------------------------------------------------------------------------
// EXPERIMENT LIFECYCLE (Phase 025) — `workspace.py:6252-6348`
// ---------------------------------------------------------------------------

/**
 * Launch an experiment, Draft → Active (`launch_experiment`,
 * `workspace.py:6252-6277`) — no empty-response guard in Python.
 *
 * @param client - The wire client.
 * @param experimentId - Experiment UUID.
 * @returns The launched `Experiment` with updated status.
 * @throws ResponseValidationError - Malformed payload.
 */
export async function launchExperiment(
  client: MixpanelClient,
  experimentId: string,
): Promise<Experiment> {
  const raw = await client.launchExperiment(experimentId);
  return validateResponseModel(Experiment, native(raw), {
    endpoint: "launch_experiment",
  });
}

/**
 * Conclude an experiment, Active → Concluded (`conclude_experiment`,
 * `workspace.py:6279-6302`) — ALWAYS sends a JSON body, `{}` when no
 * params are supplied (module header).
 *
 * @param client - The wire client.
 * @param experimentId - Experiment UUID.
 * @param options - `params` (keyword-only in Python).
 * @returns The concluded `Experiment`.
 * @throws ResponseValidationError - Malformed payload.
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
  return validateResponseModel(Experiment, native(raw), {
    endpoint: "conclude_experiment",
  });
}

/**
 * Record the experiment decision, Concluded → Success/Fail
 * (`decide_experiment`, `workspace.py:6304-6337`) — no
 * empty-response guard in Python.
 *
 * @param client - The wire client.
 * @param experimentId - Experiment UUID.
 * @param params - Decision parameters (success, variant, message).
 * @returns The decided `Experiment` with terminal status.
 * @throws ResponseValidationError - Malformed payload.
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
  return validateResponseModel(Experiment, native(raw), {
    endpoint: "decide_experiment",
  });
}

// ---------------------------------------------------------------------------
// EXPERIMENT MANAGEMENT (Phase 025) — `workspace.py:6354-6461`
// ---------------------------------------------------------------------------

/**
 * Archive an experiment (`archive_experiment`,
 * `workspace.py:6354-6373`).
 *
 * @param client - The wire client.
 * @param experimentId - Experiment UUID.
 * @returns Nothing.
 */
export async function archiveExperiment(
  client: MixpanelClient,
  experimentId: string,
): Promise<void> {
  await client.archiveExperiment(experimentId);
}

/**
 * Restore an archived experiment (`restore_experiment`,
 * `workspace.py:6375-6400`) — no empty-response guard in Python.
 *
 * @param client - The wire client.
 * @param experimentId - Experiment UUID.
 * @returns The restored `Experiment`.
 * @throws ResponseValidationError - Malformed payload.
 */
export async function restoreExperiment(
  client: MixpanelClient,
  experimentId: string,
): Promise<Experiment> {
  const raw = await client.restoreExperiment(experimentId);
  return validateResponseModel(Experiment, native(raw), {
    endpoint: "restore_experiment",
  });
}

/**
 * Duplicate an experiment (`duplicate_experiment`,
 * `workspace.py:6402-6439`) — `params` is POSITIONAL and REQUIRED
 * (the API returns an empty body when duplicating without a name).
 *
 * @param client - The wire client.
 * @param experimentId - Experiment UUID.
 * @param params - Duplication parameters (`name` is required).
 * @returns The newly created duplicate `Experiment`.
 * @throws ResponseValidationError - Malformed payload.
 */
export async function duplicateExperiment(
  client: MixpanelClient,
  experimentId: string,
  params: DuplicateExperimentParams,
): Promise<Experiment> {
  const body = params.modelDumpExcludeNone();
  const raw = await client.duplicateExperiment(experimentId, body);
  return validateResponseModel(Experiment, native(raw), {
    endpoint: "duplicate_experiment",
  });
}

/**
 * List experiments in ERF (Experiment Results Framework) format
 * (`list_erf_experiments`, `workspace.py:6441-6461`) — returned
 * verbatim; Python performs NO model validation here.
 *
 * @param client - The wire client.
 * @returns The ERF experiment dicts.
 */
export async function listErfExperiments(
  client: MixpanelClient,
): Promise<Array<Record<string, unknown>>> {
  const raw = await client.listErfExperiments();
  return raw.map((item) => native(item)) as Array<Record<string, unknown>>;
}
