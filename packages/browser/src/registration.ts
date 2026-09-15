/**
 * Browser Dynamic Client Registration — the `ensure_client_registered`
 * twin over `CredentialStore` caching: core `registerClient` (the
 * shared POST half) plus persistence under
 * `CREDENTIAL_KEYS.clientInfo(region)` where node uses `OAuthStorage`.
 * The cache-hit rule is identical to Python: the cached client is
 * returned only when its `redirect_uri` matches, and the cache check
 * runs before region validation (the region gate lives inside the core
 * POST half). The persisted payload renders `created_at` in the
 * pydantic-JSON `Z` shape; the read path is strict, and a cached record
 * that fails the strict parse counts as a cache miss and is
 * re-registered, mirroring Python's `load_client_info` returning `None`
 * for an unreadable cache file.
 *
 * @see mixpanel_headless._internal.auth.client_registration
 */

import {
  CREDENTIAL_KEYS,
  type CredentialStore,
  type OAuthClientInfo,
  parseOAuthClientInfo,
  registerClient,
} from "@mixpanel-headless/core";

import { serializeClientInfoPayload } from "./token-serialization.js";

/** Options bag of {@link ensureBrowserClientRegistered}. */
export interface EnsureBrowserClientRegisteredOptions {
  /**
   * Injected fetch.
   *
   * @defaultValue `globalThis.fetch`
   */
  readonly fetch?: typeof fetch | undefined;
  /** Mixpanel data residency region (`us`, `eu`, or `in`). */
  readonly region: string;
  /** The OAuth redirect URI to register (the app's return URL). */
  readonly redirectUri: string;
  /** Credential store caching the registration per region. */
  readonly store: CredentialStore;
  /**
   * Epoch-ms clock for the `created_at` stamp (Python reads
   * `datetime.now(timezone.utc)`).
   *
   * @defaultValue `Date.now`
   */
  readonly now?: (() => number) | undefined;
}

/**
 * Ensure a DCR client registration exists for the region, registering
 * one when the store holds no usable cached record. The cached fast
 * path performs no fetch at all.
 *
 * @param options - Region, redirect URI, store, and the optional fetch
 *   and clock seams.
 * @returns The registered (or cached) client info.
 * @throws {@link OAuthError} `OAUTH_REGISTRATION_ERROR` on unknown
 *   region, network failure, 429 rate limit, non-2xx status, or a
 *   malformed response body (all via core `registerClient`).
 * @example
 * ```typescript
 * const info = await ensureBrowserClientRegistered({
 *   region: "us",
 *   redirectUri: "https://app.example.com/oauth/callback",
 *   store,
 * });
 * // info.client_id
 * ```
 * @see mixpanel_headless._internal.auth.client_registration.ensure_client_registered
 */
export async function ensureBrowserClientRegistered(
  options: EnsureBrowserClientRegisteredOptions,
): Promise<OAuthClientInfo> {
  const { region, redirectUri, store } = options;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const key = CREDENTIAL_KEYS.clientInfo(region);

  // Cache check first, before region validation (Python order).
  const raw = await store.get(key);
  if (raw !== null) {
    let cached: OAuthClientInfo | null;
    try {
      cached = parseOAuthClientInfo(JSON.parse(raw));
    } catch {
      // A corrupted cache entry counts as a miss (module header).
      cached = null;
    }
    if (cached !== null && cached.redirect_uri === redirectUri) {
      return cached;
    }
  }

  const clientInfo = await registerClient(fetchImpl, region, redirectUri, {
    now: options.now,
  });

  // Persist before returning, like Python's `storage.save_client_info`.
  await store.set(key, serializeClientInfoPayload(clientInfo));

  return clientInfo;
}
