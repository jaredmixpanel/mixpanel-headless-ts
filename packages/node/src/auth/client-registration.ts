/**
 * Dynamic Client Registration (RFC 7591) for Mixpanel OAuth: obtain a
 * `client_id` from the authorization server and cache it per region via
 * {@link OAuthStorage} (`~/.mp/oauth/client_{region}.json`, mode 0o600)
 * so the cached fast path performs no fetches. The fetch-pure POST half
 * lives in core as `registerClient`; this module owns only the cache
 * wrapper around it.
 *
 * @see mixpanel_headless._internal.auth.client_registration
 */

import { type OAuthClientInfo, registerClient } from "@mixpanel-headless/core";

import type { OAuthStorage } from "./storage.js";

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
   * Epoch-ms clock for the `created_at` stamp; Python reads the ambient
   * `datetime.now(timezone.utc)`, the seam only adds determinism.
   *
   * @defaultValue the ambient clock
   */
  readonly now?: (() => number) | undefined;
}

/**
 * Ensure a Dynamic Client Registration exists for the given region.
 *
 * @remarks
 * Checks the local cache first, before region validation (Python's
 * order); a cached client with a matching `redirect_uri` returns
 * immediately with no fetch. Otherwise POSTs to the Mixpanel
 * `mcp/register/` endpoint and persists the result before returning; a
 * crash between register and persist simply re-registers next time.
 * @param options - fetch, region, redirect URI and storage.
 * @returns The registered (or cached) client info.
 * @throws {@link OAuthError} - `OAUTH_REGISTRATION_ERROR` on unknown
 *   region, network failure, 429 rate limit, non-2xx status, or a
 *   malformed response body.
 * @example
 * ```ts
 * const info = await ensureClientRegistered({
 *   fetchImpl: fetch,
 *   region: "us",
 *   redirectUri: "http://localhost:19284/callback",
 *   storage: new OAuthStorage(),
 * });
 * // info.client_id
 * ```
 * @see mixpanel_headless._internal.auth.client_registration.ensure_client_registered
 */
export async function ensureClientRegistered(
  options: EnsureClientRegisteredOptions,
): Promise<OAuthClientInfo> {
  const { region, redirectUri, storage } = options;

  const cached = storage.loadClientInfo(region);
  if (cached !== null && cached.redirect_uri === redirectUri) {
    return cached;
  }

  const clientInfo: OAuthClientInfo = await registerClient(
    options.fetchImpl,
    region,
    redirectUri,
    { now: options.now },
  );

  // Persist before returning so the next call takes the cached path.
  storage.saveClientInfo(clientInfo);

  return clientInfo;
}
