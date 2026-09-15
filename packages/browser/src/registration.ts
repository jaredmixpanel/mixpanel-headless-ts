/**
 * Browser Dynamic Client Registration — the `ensure_client_registered`
 * twin over `CredentialStore` caching (b9-packets.md §3.2 row 3):
 * core `registerClient` (the §3.1 hoisted POST half,
 * `client_registration.py`) + persistence under
 * `CREDENTIAL_KEYS.clientInfo(region)` where node uses `OAuthStorage`.
 * The cache-hit rule is identical to Python: the cached client is
 * returned ONLY when its `redirect_uri` matches
 * (`client_registration.py`), and the cache check runs BEFORE
 * region validation (Python order — the region gate lives inside the
 * core POST half).
 *
 * R11.9 writer shape: the persisted payload renders `created_at` in
 * the pydantic-JSON `Z` shape via `serializeClientInfoPayload`
 * (client_{region}.json twin — §2.1); the read path is STRICT
 * (`parseOAuthClientInfo` — the store only reads its own writes).
 * A cached record that fails the strict parse is treated as a cache
 * MISS and re-registered (twin-less corruption branch — Python's
 * `load_client_info` returns `None` for unreadable cache files,
 * `storage.py` read posture; documented narrowing, R9.3 arbiter).
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
  /** Injected fetch (R2.4 seam); default `globalThis.fetch`. */
  readonly fetch?: typeof fetch | undefined;
  /** Mixpanel data residency region (`us`, `eu`, or `in`). */
  readonly region: string;
  /** The OAuth redirect URI to register (the app's return URL). */
  readonly redirectUri: string;
  /** Credential store caching the registration per region. */
  readonly store: CredentialStore;
  /**
   * Epoch-ms clock for the `created_at` stamp (default ambient —
   * Python reads `datetime.now(timezone.utc)`).
   */
  readonly now?: (() => number) | undefined;
}

/**
 * Ensure a DCR client registration exists for the region (the browser
 * `ensure_client_registered` twin, `client_registration.py`).
 * The cached fast path performs ZERO fetches.
 *
 * @param options - fetch + region + redirect URI + store + clock.
 * @returns The registered (or cached) client info.
 * @throws OAuthError - `OAUTH_REGISTRATION_ERROR` on unknown region,
 *   network failure, 429 rate limit, non-2xx status, or a malformed
 *   response body (all via core `registerClient`).
 * @example
 * ```typescript
 * const info = await ensureBrowserClientRegistered({
 *   region: "us",
 *   redirectUri: "https://app.example.com/oauth/callback",
 *   store,
 * });
 * // info.client_id
 * ```
 */
export async function ensureBrowserClientRegistered(
  options: EnsureBrowserClientRegisteredOptions,
): Promise<OAuthClientInfo> {
  const { region, redirectUri, store } = options;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const key = CREDENTIAL_KEYS.clientInfo(region);

  // Check cache (`client_registration.py` — BEFORE region
  // validation, Python order).
  const raw = await store.get(key);
  if (raw !== null) {
    let cached: OAuthClientInfo | null;
    try {
      cached = parseOAuthClientInfo(JSON.parse(raw));
    } catch {
      // Corrupted cache entry = miss (module header narrowing).
      cached = null;
    }
    if (cached !== null && cached.redirect_uri === redirectUri) {
      return cached;
    }
  }

  // Register new client — the §3.1 hoisted POST half.
  const clientInfo = await registerClient(fetchImpl, region, redirectUri, {
    now: options.now,
  });

  // Cache for future use — persist BEFORE returning (the
  // `storage.save_client_info` twin, `client_registration.py`;
  // R11.9 pydantic-JSON `Z` writer shape).
  await store.set(key, serializeClientInfoPayload(clientInfo));

  return clientInfo;
}
