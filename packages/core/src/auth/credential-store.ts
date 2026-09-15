/**
 * `CredentialStore` — the string-keyed credential persistence seam for
 * browser builds (rulebook R9.3: "injectable `CredentialStore`").
 * Interface + key-name table ONLY — plan §4.1 places the interface in
 * core ("`core` defines `TokenResolver` / `CredentialStore`
 * interfaces; `node` and `browser` provide implementations"); the
 * implementations live in `packages/browser/src/credential-store.ts`
 * (b9-packets.md §2.1 — the pasted R10.10 contract, verbatim).
 *
 * NO Python twin exists for this seam: Python persists per-account
 * state on disk (`~/.mp/accounts/{name}/…`, `~/.mp/oauth/…`); the
 * browser has no filesystem, so R9.3 is the contract arbiter.
 * Documented narrowing: browser v1 has no account axis (`oauth_token`
 * + PKCE only), so keys are scoped per REGION — mirroring the region
 * component of Python's on-disk layout (`client_{region}.json`,
 * `tokens_{region}.json`) with the account component dropped.
 *
 * Value payloads are opaque JSON text. Datetime fields inside them
 * follow R11.9: every writer renders through the Python-twin formatter
 * (tokens payload → `datetime.isoformat()` `+00:00` shape; client-info
 * payload → pydantic-JSON `Z` shape — see
 * `packages/browser/src/token-serialization.ts`); read paths are
 * STRICT (`parseOAuthTokens` / `parseOAuthClientInfo` — the store only
 * ever reads its own writes).
 */

/**
 * String-keyed credential persistence seam (R9.3). Keys are namespaced
 * by the library (see {@link CREDENTIAL_KEYS}); values are opaque
 * serialized strings. All methods may be sync or async on the
 * implementor side — consumers always `await` (`Promise<...>` | direct
 * value both satisfy the types).
 */
export interface CredentialStore {
  /**
   * Read the value stored under `key`.
   *
   * @param key - Namespaced key (see {@link CREDENTIAL_KEYS}).
   * @returns The stored string, or `null` when absent (never
   *   `undefined` — R3.9: an explicit-null contract at seams; mirrors
   *   the `load_client_info` cache-check shape,
   *   `client_registration.py:92-93`).
   */
  get: (key: string) => Promise<string | null> | string | null;

  /**
   * Store `value` under `key`, overwriting any prior value.
   *
   * @param key - Namespaced key.
   * @param value - Opaque serialized payload.
   */
  set: (key: string, value: string) => Promise<void> | void;

  /**
   * Remove the value stored under `key` (no-op when absent).
   *
   * @param key - Namespaced key.
   */
  delete: (key: string) => Promise<void> | void;
}

/**
 * Key-name table (exported const; single source of the namespace).
 *
 * Per-region keying mirrors Python's on-disk layout (CLAUDE.md config
 * table: `~/.mp/oauth/client_{region}.json`, per-region token files);
 * region is the WHOLE scope in browser v1 (no account axis — R9.3
 * arbiter, documented narrowing in the module header).
 */
export const CREDENTIAL_KEYS = {
  /**
   * Key for the persisted OAuth tokens of a region (the
   * `tokens_{region}.json` twin).
   *
   * @param region - Mixpanel region (`us` / `eu` / `in`).
   * @returns The namespaced key.
   */
  tokens: (region: string): string => `mp.tokens.${region}`,

  /**
   * Key for the cached DCR client registration of a region (the
   * `client_{region}.json` twin).
   *
   * @param region - Mixpanel region.
   * @returns The namespaced key.
   */
  clientInfo: (region: string): string => `mp.oauth_client.${region}`,

  /**
   * Key for the in-flight redirect-login state of a region (state +
   * verifier + client_id + redirect_uri + created_at — substitutes for
   * Python's in-process locals, `flow.py:268-306`; B9-R2 consumer).
   *
   * @param region - Mixpanel region.
   * @returns The namespaced key.
   */
  pendingLogin: (region: string): string => `mp.pending_login.${region}`,

  /**
   * EVERY key family for a region, in table order — the supported
   * logout/wipe enumeration (pair-B FB-9, `b9-reviewB-resolution.md`:
   * correct logout previously required the caller to know all three
   * builders × every region used). Delete each returned key to clear
   * a region completely.
   *
   * @param region - Mixpanel region.
   * @returns The three namespaced keys (tokens, client info, pending
   *   login).
   */
  all: (region: string): readonly string[] => [
    CREDENTIAL_KEYS.tokens(region),
    CREDENTIAL_KEYS.clientInfo(region),
    CREDENTIAL_KEYS.pendingLogin(region),
  ],
} as const;
