/**
 * Business-context wire methods on the App API. Paths are built directly
 * rather than through `maybe_scoped_path`: the endpoint is
 * project-scoped, never workspace-scoped, and the organization arm swaps
 * in `/organizations/{org_id}/`. None of the three calls is in the
 * conformance corpus; the unit tests are their only lock.
 *
 * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.get_business_context
 */

import { appRequest } from "../../client/app-request.js";
import type { ClientCore } from "../../client/core.js";
import type { JsonValue } from "../../client/json-value.js";
import { expectRecordResult } from "./shared.js";

/** Options bag of the scope-selecting business-context methods. */
export interface BusinessContextScopeOptions {
  /** Org-level scope; omitted → the session project's scope. */
  readonly organization_id?: number | null | undefined;
  /** Optional cancellation signal. */
  readonly signal?: AbortSignal | undefined;
}

/** Business-context methods mixed into `MixpanelClient`. */
export interface BusinessContextMethods {
  /**
   * Fetch business context (`get_business_context` — GET
   * `/projects/{pid}/business-context` or
   * `/organizations/{org}/business-context`).
   *
   * @param options - Optional `organization_id` scope + signal.
   * @returns `{content: "<markdown>"}` (empty string when unset).
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  getBusinessContext: (
    options?: BusinessContextScopeOptions,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Replace business context (`set_business_context` —
   * PUT with `{content}`; full replace, empty string clears).
   *
   * @param content - New markdown content.
   * @param options - Optional `organization_id` scope + signal.
   * @returns `{content: "<saved markdown>"}` echoed by the server.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  setBusinessContext: (
    content: string,
    options?: BusinessContextScopeOptions,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Fetch org + project context together (`get_business_context_chain` — GET
   * `/projects/{pid}/business-context/chain`).
   *
   * @param signal - Optional cancellation signal.
   * @returns `{org_context, project_context}`.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  getBusinessContextChain: (
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;
}

/**
 * Build the business-context methods over the shared client core.
 *
 * @param core - The shared client internals seam.
 * @returns The method bag.
 */
export function createBusinessContextMethods(
  core: ClientCore,
): BusinessContextMethods {
  /** The org-vs-project path selector. */
  const scopePath = (organizationId: number | null | undefined): string =>
    organizationId !== undefined && organizationId !== null
      ? `/organizations/${organizationId}/business-context`
      : `/projects/${core.projectId()}/business-context`;

  return {
    getBusinessContext: async (
      options: BusinessContextScopeOptions = {},
    ): Promise<Record<string, JsonValue>> => {
      const path = scopePath(options.organization_id);
      const result = await appRequest(
        core.appDeps(options.signal),
        "GET",
        path,
      );
      return expectRecordResult(result, "get_business_context");
    },

    setBusinessContext: async (
      content: string,
      options: BusinessContextScopeOptions = {},
    ): Promise<Record<string, JsonValue>> => {
      const path = scopePath(options.organization_id);
      const result = await appRequest(
        core.appDeps(options.signal),
        "PUT",
        path,
        {
          jsonBody: { content },
        },
      );
      return expectRecordResult(result, "set_business_context");
    },

    getBusinessContextChain: async (
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = `/projects/${core.projectId()}/business-context/chain`;
      const result = await appRequest(core.appDeps(signal), "GET", path);
      return expectRecordResult(result, "get_business_context_chain");
    },
  };
}
