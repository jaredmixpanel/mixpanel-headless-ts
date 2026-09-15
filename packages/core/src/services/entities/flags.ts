/**
 * Feature-flag CRUD/lifecycle wire methods (App API) — Phase-3 packet
 * B4-C4 port of the `MixpanelAPIClient` feature-flags range
 * (`api_client.py:4938-5271`).
 *
 * All methods route through B0 `appRequest` (R10.8). Flags are the one
 * C4 domain on `require_scoped_path` — every path except
 * `get_flag_limits` is workspace-scoped (auto-discovering via the C1
 * `resolveWorkspaceId` seam); `get_flag_limits` is ALWAYS
 * project-scoped (`api_client.py:5263-5264`). Results are returned
 * verbatim after the source's isinstance guard (Caution #11 — no
 * `FeatureFlag` model shaping).
 */

import { appRequest } from "../../client/app-request.js";
import type { ClientCore } from "../../client/core.js";
import type { JsonValue } from "../../client/json-value.js";
import { expectListResult, expectRecordResult } from "./shared.js";

/** The C1 workspace-scoping seam the flag factory consumes. */
export interface FlagPathDeps {
  /**
   * Build a workspace-scoped API path (`self.require_scoped_path`,
   * `api_client.py:1666-1694` — auto-discovers the workspace when no
   * pin is set).
   *
   * @param domainPath - Domain-relative path.
   * @returns `/projects/{pid}/workspaces/{wid}/{domainPath}`.
   */
  requireScopedPath: (domainPath: string) => Promise<string>;
}

/** Options bag of {@link FlagMethods.listFeatureFlags}. */
export interface ListFeatureFlagsOptions {
  /** When true, include archived flags (`include_archived`). */
  readonly include_archived?: boolean | undefined;
  /** Optional cancellation signal (R6.7). */
  readonly signal?: AbortSignal | undefined;
}

/** Options bag of {@link FlagMethods.getFlagHistory}. */
export interface GetFlagHistoryOptions {
  /** Optional query parameters (page, page_size). */
  readonly params?: Record<string, string> | null | undefined;
  /** Optional cancellation signal (R6.7). */
  readonly signal?: AbortSignal | undefined;
}

/** The C4 feature-flag method surface (mixed into `MixpanelClient`). */
export interface FlagMethods {
  /**
   * List feature flags (`list_feature_flags`,
   * `api_client.py:4938-4973` — GET `feature-flags/`,
   * workspace-scoped).
   *
   * @param options - include_archived + signal.
   * @returns The flag list verbatim.
   * @throws MixpanelHeadlessError - Non-list response.
   * @throws AuthenticationError | RateLimitError | QueryError |
   *   ServerError - Per the B0 `appRequest` contract.
   */
  listFeatureFlags: (options?: ListFeatureFlagsOptions) => Promise<JsonValue[]>;

  /**
   * Create a feature flag (`create_feature_flag`, `:4975-5005` — POST
   * `feature-flags/`).
   *
   * @param body - Flag creation payload (`name` and `key` required).
   * @param signal - Optional cancellation signal.
   * @returns The created flag dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  createFeatureFlag: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Get a feature flag by ID (`get_feature_flag`, `:5007-5037`).
   *
   * @param flagId - Feature flag UUID.
   * @param signal - Optional cancellation signal.
   * @returns The flag dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  getFeatureFlag: (
    flagId: string,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Update a feature flag (`update_feature_flag`, `:5039-5070` — PUT,
   * full replacement).
   *
   * @param flagId - Feature flag UUID.
   * @param body - Complete flag configuration.
   * @param signal - Optional cancellation signal.
   * @returns The updated flag dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  updateFeatureFlag: (
    flagId: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Delete a feature flag (`delete_feature_flag`, `:5072-5093`).
   *
   * @param flagId - Feature flag UUID.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   */
  deleteFeatureFlag: (flagId: string, signal?: AbortSignal) => Promise<void>;

  /**
   * Archive a feature flag (`archive_feature_flag`, `:5095-5116` —
   * POST `feature-flags/{id}/archive/`).
   *
   * @param flagId - Feature flag UUID.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   */
  archiveFeatureFlag: (flagId: string, signal?: AbortSignal) => Promise<void>;

  /**
   * Restore an archived feature flag (`restore_feature_flag`,
   * `:5118-5148` — DELETE `feature-flags/{id}/archive/`).
   *
   * @param flagId - Feature flag UUID.
   * @param signal - Optional cancellation signal.
   * @returns The restored flag dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  restoreFeatureFlag: (
    flagId: string,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Duplicate a feature flag (`duplicate_feature_flag`, `:5150-5180` —
   * POST `feature-flags/{id}/duplicate/`).
   *
   * @param flagId - Feature flag UUID.
   * @param signal - Optional cancellation signal.
   * @returns The duplicate flag dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  duplicateFeatureFlag: (
    flagId: string,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Set test-user variant overrides (`set_flag_test_users`,
   * `:5182-5204` — PUT `feature-flags/{id}/test-users/`).
   *
   * @param flagId - Feature flag UUID.
   * @param body - Test user mapping.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   */
  setFlagTestUsers: (
    flagId: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<void>;

  /**
   * Get flag change history (`get_flag_history`, `:5206-5239` — GET
   * `feature-flags/{id}/history/`; `params` passed through verbatim).
   *
   * @param flagId - Feature flag UUID.
   * @param options - params + signal.
   * @returns The history dict (`events` + `count`).
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  getFlagHistory: (
    flagId: string,
    options?: GetFlagHistoryOptions,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Get account-level flag limits (`get_flag_limits`, `:5241-5271` —
   * GET `/projects/{pid}/feature-flags/limits/`, ALWAYS
   * project-scoped even with a workspace pinned).
   *
   * @param signal - Optional cancellation signal.
   * @returns The limits dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  getFlagLimits: (signal?: AbortSignal) => Promise<Record<string, JsonValue>>;
}

/**
 * Build the C4 feature-flag methods over the C1 core seam.
 *
 * @param core - The shared client internals seam.
 * @param paths - The workspace-scoping seam (`require_scoped_path`).
 * @returns The method bag.
 */
export function createFlagMethods(
  core: ClientCore,
  paths: FlagPathDeps,
): FlagMethods {
  return {
    listFeatureFlags: async (
      options: ListFeatureFlagsOptions = {},
    ): Promise<JsonValue[]> => {
      const path = await paths.requireScopedPath("feature-flags/");
      const params: Record<string, string> = {};
      // `if include_archived:` — Python truthiness on the bool kwarg.
      if (options.include_archived) {
        params["include_archived"] = "true";
      }
      const result = await appRequest(
        core.appDeps(options.signal),
        "GET",
        path,
        { params: Object.keys(params).length > 0 ? params : undefined },
      );
      return expectListResult(result, "list_feature_flags");
    },

    createFeatureFlag: async (
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = await paths.requireScopedPath("feature-flags/");
      const result = await appRequest(core.appDeps(signal), "POST", path, {
        jsonBody: body,
      });
      return expectRecordResult(result, "create_feature_flag");
    },

    getFeatureFlag: async (
      flagId: string,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = await paths.requireScopedPath(`feature-flags/${flagId}/`);
      const result = await appRequest(core.appDeps(signal), "GET", path);
      return expectRecordResult(result, "get_feature_flag");
    },

    updateFeatureFlag: async (
      flagId: string,
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = await paths.requireScopedPath(`feature-flags/${flagId}/`);
      const result = await appRequest(core.appDeps(signal), "PUT", path, {
        jsonBody: body,
      });
      return expectRecordResult(result, "update_feature_flag");
    },

    deleteFeatureFlag: async (
      flagId: string,
      signal?: AbortSignal,
    ): Promise<void> => {
      const path = await paths.requireScopedPath(`feature-flags/${flagId}/`);
      await appRequest(core.appDeps(signal), "DELETE", path);
    },

    archiveFeatureFlag: async (
      flagId: string,
      signal?: AbortSignal,
    ): Promise<void> => {
      const path = await paths.requireScopedPath(
        `feature-flags/${flagId}/archive/`,
      );
      await appRequest(core.appDeps(signal), "POST", path);
    },

    restoreFeatureFlag: async (
      flagId: string,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = await paths.requireScopedPath(
        `feature-flags/${flagId}/archive/`,
      );
      const result = await appRequest(core.appDeps(signal), "DELETE", path);
      return expectRecordResult(result, "restore_feature_flag");
    },

    duplicateFeatureFlag: async (
      flagId: string,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = await paths.requireScopedPath(
        `feature-flags/${flagId}/duplicate/`,
      );
      const result = await appRequest(core.appDeps(signal), "POST", path);
      return expectRecordResult(result, "duplicate_feature_flag");
    },

    setFlagTestUsers: async (
      flagId: string,
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<void> => {
      const path = await paths.requireScopedPath(
        `feature-flags/${flagId}/test-users/`,
      );
      await appRequest(core.appDeps(signal), "PUT", path, { jsonBody: body });
    },

    getFlagHistory: async (
      flagId: string,
      options: GetFlagHistoryOptions = {},
    ): Promise<Record<string, JsonValue>> => {
      const path = await paths.requireScopedPath(
        `feature-flags/${flagId}/history/`,
      );
      // `params=params` — the kwarg is threaded through verbatim
      // (None stays None; no empty-dict elision here).
      const result = await appRequest(
        core.appDeps(options.signal),
        "GET",
        path,
        { params: options.params },
      );
      return expectRecordResult(result, "get_flag_history");
    },

    getFlagLimits: async (
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = `/projects/${core.projectId()}/feature-flags/limits/`;
      const result = await appRequest(core.appDeps(signal), "GET", path);
      return expectRecordResult(result, "get_flag_limits");
    },
  };
}
