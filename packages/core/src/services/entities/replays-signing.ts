/**
 * Bulk replay signing on the App API (`/projects/{pid}/replays/sign/bulk`,
 * always project-scoped). A plain `appRequest` POST: the 403
 * `SESSION_RECORDING_SENSITIVE_DATA` → `SessionReplayAccessError` mapping
 * lives in `handleResponse`, and shaping the results into `SignedReplay`
 * belongs to `ReplaysService`.
 *
 * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.sign_replays
 */

import { appRequest } from "../../client/app-request.js";
import type { ClientCore } from "../../client/core.js";
import type { JsonValue } from "../../client/json-value.js";
import { expectListResult } from "./shared.js";

/** Replay environment selector (Python `Literal["prod", "dev"]`). */
export type ReplayEnv = "prod" | "dev";

/** Replay-signing methods mixed into `MixpanelClient`. */
export interface ReplaysSigningMethods {
  /**
   * Bulk-sign replay IDs for CDN access (`sign_replays` — POST
   * `/projects/{pid}/replays/sign/bulk` with
   * `{replays: [{replay_id, replay_env}, ...]}`; returns the server's
   * `results` array verbatim — `ReplaysService` shapes it into
   * `SignedReplay`).
   *
   * @param replayIds - Replay IDs to sign.
   * @param env - `"prod"` (default) or `"dev"`, applied uniformly.
   * @param signal - Optional cancellation signal.
   * @returns `{replay_id, url, query_string}` dicts in input order.
   * @throws SessionReplayAccessError - The sensitive-data 403 (mapped
   *   by `handleResponse`).
   * @throws MixpanelHeadlessError - Non-list response.
   */
  signReplays: (
    replayIds: readonly string[],
    env?: ReplayEnv,
    signal?: AbortSignal,
  ) => Promise<JsonValue[]>;
}

/**
 * Build the replay-signing method over the shared client core.
 *
 * @param core - The shared client internals seam.
 * @returns The method bag.
 */
export function createReplaysSigningMethods(
  core: ClientCore,
): ReplaysSigningMethods {
  return {
    signReplays: async (
      replayIds: readonly string[],
      env: ReplayEnv = "prod",
      signal?: AbortSignal,
    ): Promise<JsonValue[]> => {
      const path = `/projects/${core.projectId()}/replays/sign/bulk`;
      const body = {
        replays: replayIds.map((rid) => ({ replay_id: rid, replay_env: env })),
      };
      const result = await appRequest(core.appDeps(signal), "POST", path, {
        jsonBody: body,
      });
      return expectListResult(result, "sign_replays");
    },
  };
}
