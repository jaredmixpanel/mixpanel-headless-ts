/**
 * Session-replay signing wire method (App API) — Phase-3 packet B4-C5
 * port of `MixpanelAPIClient.sign_replays`
 * (`api_client.py:8837-8894`).
 *
 * The method itself is a plain `appRequest` POST with a direct
 * project path; the 403 `SESSION_RECORDING_SENSITIVE_DATA` →
 * `SessionReplayAccessError` mapping lives in B0 `handleResponse`
 * (`client/internals.ts`) — nothing re-implemented here, everything
 * locked by the C5 R10.9 harness (incl. the R10.7 bug-compat matrix
 * re-exercised through this method).
 */

import { appRequest } from "../../client/app-request.js";
import type { ClientCore } from "../../client/core.js";
import type { JsonValue } from "../../client/json-value.js";
import { expectListResult } from "./shared.js";

/** Replay environment selector (Python `Literal["prod", "dev"]`). */
export type ReplayEnv = "prod" | "dev";

/** The C5 replay-signing method surface (mixed into `MixpanelClient`). */
export interface ReplaysSigningMethods {
  /**
   * Bulk-sign replay IDs for CDN access (`sign_replays` — POST
   * `/projects/{pid}/replays/sign/bulk` with
   * `{replays: [{replay_id, replay_env}, ...]}`; returns the server's
   * `results` array verbatim — `SignedReplay` shaping is B5's
   * ReplaysService, Caution #11).
   *
   * @param replayIds - Replay IDs to sign.
   * @param env - `"prod"` (default) or `"dev"`, applied uniformly.
   * @param signal - Optional cancellation signal.
   * @returns `{replay_id, url, query_string}` dicts in input order.
   * @throws SessionReplayAccessError - The sensitive-data 403 (mapped
   *   by B0 `handleResponse`).
   * @throws MixpanelHeadlessError - Non-list response.
   */
  signReplays: (
    replayIds: readonly string[],
    env?: ReplayEnv,
    signal?: AbortSignal,
  ) => Promise<JsonValue[]>;
}

/**
 * Build the C5 replay-signing method over the C1 core seam.
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
