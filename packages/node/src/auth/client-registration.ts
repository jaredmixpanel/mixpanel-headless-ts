/**
 * Dynamic Client Registration for Mixpanel OAuth — TS port of
 * `mixpanel_headless/_internal/auth/client_registration.py` (whole
 * file, b8-packets.md §4.1 row 2).
 *
 * Implements RFC 7591 DCR to obtain a `client_id` from the Mixpanel
 * authorization server. Registrations are cached per-region via
 * {@link OAuthStorage} (`~/.mp/oauth/client_{region}.json`, 0o600 —
 * THE DCR persistence duty) to avoid redundant network calls; the
 * cached fast path performs ZERO fetches.
 *
 * B9-R2 HOIST (b9-packets.md §3.1 row 6, second R10.8 ruling): the
 * fetch-pure POST half (`client_registration.py:96-170`) moved to core
 * `oauth-http.ts` as `registerClient`; this module KEEPS the
 * `OAuthStorage` cache wrapper (`storage.save_client_info` write,
 * `:168` — outside the hoist) and delegates the POST. `DEFAULT_SCOPE`
 * and `OAUTH_BASE_URLS` moved to core `oauth-constants.ts`
 * (re-exported here / via `./oauth-constants.js`). The untouched B8
 * suite (`client-registration.test.ts`) is the zero-behavior-change
 * proof.
 */

import { registerClient, DEFAULT_SCOPE } from "@mixpanel-headless/core";
import type { OAuthClientInfo } from "@mixpanel-headless/core";
import type { OAuthStorage } from "./storage.js";

// Re-export preserving the B8 import path (`DEFAULT_SCOPE`'s TS home
// until the B9-R2 hoist).
export { DEFAULT_SCOPE };

/** Options bag of {@link ensureClientRegistered} (the Python params). */
export interface EnsureClientRegisteredOptions {
  /** Injected fetch (the `http_client` seam). */
  readonly fetchImpl: typeof fetch;
  /** Mixpanel data residency region (`us`, `eu`, or `in`). */
  readonly region: string;
  /** The OAuth redirect URI to register. */
  readonly redirectUri: string;
  /** Storage for caching client info. */
  readonly storage: OAuthStorage;
  /**
   * Epoch-ms clock for the `created_at` stamp (Python reads the
   * ambient `datetime.now(timezone.utc)`; the optional seam only adds
   * determinism for tests/harness — default ambient).
   */
  readonly now?: (() => number) | undefined;
}

/**
 * Ensure a Dynamic Client Registration exists for the given region
 * (port of `ensure_client_registered`, `client_registration.py:54-170`).
 *
 * Checks the local cache first (BEFORE region validation — Python
 * order); a cached client with a matching `redirect_uri` returns
 * immediately with zero fetches. Otherwise POSTs to the Mixpanel
 * `mcp/register/` endpoint and persists the result BEFORE returning
 * (a crash between register and persist re-registers next time —
 * ported, not "improved"; packet §4.2).
 *
 * @param options - fetch + region + redirect URI + storage.
 * @returns The registered (or cached) client info.
 * @throws OAuthError - `OAUTH_REGISTRATION_ERROR` on unknown region,
 *   network failure, 429 rate limit, non-2xx status, or a malformed
 *   response body.
 *
 * @example
 * ```typescript
 * const info = await ensureClientRegistered({
 *   fetchImpl: fetch,
 *   region: "us",
 *   redirectUri: "http://localhost:19284/callback",
 *   storage: new OAuthStorage(),
 * });
 * // info.client_id
 * ```
 */
export async function ensureClientRegistered(
  options: EnsureClientRegisteredOptions,
): Promise<OAuthClientInfo> {
  const { region, redirectUri, storage } = options;

  // Check cache (`client_registration.py:91-94`).
  const cached = storage.loadClientInfo(region);
  if (cached !== null && cached.redirect_uri === redirectUri) {
    return cached;
  }

  // Register new client (`client_registration.py:96-165`) — the POST
  // half delegates to the B9-R2 core hoist (module header).
  const clientInfo: OAuthClientInfo = await registerClient(
    options.fetchImpl,
    region,
    redirectUri,
    { now: options.now },
  );

  // Cache for future use — persist BEFORE returning
  // (`client_registration.py:168`; stays node-homed, outside the hoist).
  storage.saveClientInfo(clientInfo);

  return clientInfo;
}
