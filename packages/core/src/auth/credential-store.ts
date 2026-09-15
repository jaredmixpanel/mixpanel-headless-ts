/**
 * `CredentialStore`, the string-keyed credential persistence seam for
 * browser builds: the interface and its key-name table only; the
 * implementations live in `@mixpanel-headless/browser`. There is no
 * Python twin — Python persists per-account state on disk under
 * `~/.mp/` — and the browser surface has no account axis, so keys are
 * scoped per region, mirroring the region component of the on-disk
 * layout (`client_{region}.json`, `tokens_{region}.json`). Values are
 * opaque JSON text written through the Python-twin datetime formatters
 * and read back strictly; the store only ever reads its own writes.
 *
 * @see mixpanel_headless._internal.auth.storage.OAuthStorage
 */

/**
 * String-keyed credential persistence seam. Keys are namespaced
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
   *   `undefined` — an explicit-null contract at seams, mirroring the
   *   `load_client_info` cache-check shape).
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
 * Key-name table (single source of the namespace).
 *
 * Per-region keying mirrors Python's on-disk layout
 * (`~/.mp/oauth/client_{region}.json`, per-region token files); region
 * is the whole scope in the browser (no account axis).
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
   * the in-process locals of Python's `OAuthFlow.login`).
   *
   * @param region - Mixpanel region.
   * @returns The namespaced key.
   */
  pendingLogin: (region: string): string => `mp.pending_login.${region}`,

  /**
   * Every key family for a region, in table order — the supported
   * logout/wipe enumeration, so a correct logout does not require the
   * caller to know all three builders. Delete each returned key to
   * clear a region completely.
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
