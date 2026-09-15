/**
 * Feature-flag CRUD and lifecycle wire methods on the App API. Flags are
 * the one domain here on `require_scoped_path`: every path except
 * `get_flag_limits` is workspace-scoped, auto-discovering the workspace
 * through the injected {@link FlagPathDeps} seam when nothing is pinned,
 * while `get_flag_limits` is always project-scoped. Results come back
 * verbatim after Python's isinstance guard — no `FeatureFlag` model
 * shaping here.
 *
 * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.list_feature_flags
 */

import { appRequest } from "../../client/app-request.js";
import type { ClientCore } from "../../client/core.js";
import type { JsonValue } from "../../client/json-value.js";
import { expectListResult, expectRecordResult } from "./shared.js";

/** The workspace-scoping seam the flag factory consumes. */
export interface FlagPathDeps {
  /**
   * Build a workspace-scoped API path. Auto-discovers the workspace when no pin is
   * set.
   *
   * @param domainPath - Domain-relative path.
   * @returns `/projects/{pid}/workspaces/{wid}/{domainPath}`.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.require_scoped_path
   */
  requireScopedPath: (domainPath: string) => Promise<string>;
}

/** Options bag of {@link FlagMethods.listFeatureFlags}. */
export interface ListFeatureFlagsOptions {
  /**
   * Include archived flags (`include_archived` on the wire).
   *
   * @defaultValue `false`
   */
  readonly include_archived?: boolean | undefined;
  /** Optional cancellation signal. */
  readonly signal?: AbortSignal | undefined;
}

/** Options bag of {@link FlagMethods.getFlagHistory}. */
export interface GetFlagHistoryOptions {
  /** Optional query parameters (page, page_size). */
  readonly params?: Record<string, string> | null | undefined;
  /** Optional cancellation signal. */
  readonly signal?: AbortSignal | undefined;
}

/** Feature-flag methods mixed into `MixpanelClient`. */
export interface FlagMethods {
  /**
   * List feature flags. Sends GET `feature-flags/`, workspace-scoped.
   *
   * @param options - include_archived + signal.
   * @returns The flag list verbatim.
   * @throws {@link MixpanelHeadlessError} - Non-list response.
   * @throws {@link AuthenticationError} - Invalid or expired credentials (401).
   * @throws {@link RateLimitError} - Rate limit still exceeded after the retries
   *   (429).
   * @throws {@link QueryError} - Other 4xx responses (400/403/404/422).
   * @throws {@link ServerError} - Server-side errors (5xx).
   * @internal
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.list_feature_flags
   */
  listFeatureFlags: (options?: ListFeatureFlagsOptions) => Promise<JsonValue[]>;

  /**
   * Create a feature flag. Sends POST `feature-flags/`.
   *
   * @param body - Flag creation payload (`name` and `key` required).
   * @param signal - Optional cancellation signal.
   * @returns The created flag dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.create_feature_flag
   */
  createFeatureFlag: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Get a feature flag by ID.
   *
   * @param flagId - Feature flag UUID.
   * @param signal - Optional cancellation signal.
   * @returns The flag dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.get_feature_flag
   */
  getFeatureFlag: (
    flagId: string,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Update a feature flag. Sends PUT, full replacement.
   *
   * @param flagId - Feature flag UUID.
   * @param body - Complete flag configuration.
   * @param signal - Optional cancellation signal.
   * @returns The updated flag dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.update_feature_flag
   */
  updateFeatureFlag: (
    flagId: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Delete a feature flag.
   *
   * @param flagId - Feature flag UUID.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.delete_feature_flag
   */
  deleteFeatureFlag: (flagId: string, signal?: AbortSignal) => Promise<void>;

  /**
   * Archive a feature flag. Sends POST `feature-flags/{id}/archive/`.
   *
   * @param flagId - Feature flag UUID.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.archive_feature_flag
   */
  archiveFeatureFlag: (flagId: string, signal?: AbortSignal) => Promise<void>;

  /**
   * Restore an archived feature flag. Sends DELETE `feature-flags/{id}/archive/`.
   *
   * @param flagId - Feature flag UUID.
   * @param signal - Optional cancellation signal.
   * @returns The restored flag dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.restore_feature_flag
   */
  restoreFeatureFlag: (
    flagId: string,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Duplicate a feature flag. Sends POST `feature-flags/{id}/duplicate/`.
   *
   * @param flagId - Feature flag UUID.
   * @param signal - Optional cancellation signal.
   * @returns The duplicate flag dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.duplicate_feature_flag
   */
  duplicateFeatureFlag: (
    flagId: string,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Set test-user variant overrides. Sends PUT `feature-flags/{id}/test-users/`.
   *
   * @param flagId - Feature flag UUID.
   * @param body - Test user mapping.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.set_flag_test_users
   */
  setFlagTestUsers: (
    flagId: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<void>;

  /**
   * Get flag change history. Sends GET `feature-flags/{id}/history/`; `params`
   * passed through verbatim.
   *
   * @param flagId - Feature flag UUID.
   * @param options - params + signal.
   * @returns The history dict (`events` + `count`).
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @internal
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.get_flag_history
   */
  getFlagHistory: (
    flagId: string,
    options?: GetFlagHistoryOptions,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Get account-level flag limits. Sends GET
   * `/projects/{pid}/feature-flags/limits/`.
   *
   * @remarks
   * Always project-scoped, even with a workspace pinned — the one flag
   * path that never goes through `require_scoped_path`.
   * @param signal - Optional cancellation signal.
   * @returns The limits dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.get_flag_limits
   */
  getFlagLimits: (signal?: AbortSignal) => Promise<Record<string, JsonValue>>;
}

/**
 * Build the feature-flag methods over the shared client core.
 *
 * @param core - The shared client internals seam.
 * @param paths - The workspace-scoping seam (`require_scoped_path`).
 * @returns The method bag.
 * @example
 * ```typescript
 * const flags = createFlagMethods(core, {
 *   requireScopedPath: (path) => client.requireScopedPath(path),
 * });
 * await flags.listFeatureFlags({ include_archived: true });
 * // [{ id: "f1...", key: "new-checkout", ... }, ...]
 * ```
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
