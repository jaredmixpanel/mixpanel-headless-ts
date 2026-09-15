/**
 * Browser `CredentialStore` implementations over the core interface
 * (`packages/core/src/auth/credential-store.ts`) — the browser
 * counterpart of Python's on-disk `OAuthStorage`.
 *
 * {@link InMemoryCredentialStore} is the default: credentials live for
 * the page's lifetime and vanish on reload, so the recommended posture
 * is re-login on reload. {@link LocalStorageCredentialStore} is the
 * opt-in adapter; read its security warning before using it.
 *
 * @see mixpanel_headless._internal.auth.storage
 */

import { type CredentialStore, OAuthError } from "@mixpanel-headless/core";

/**
 * Structural view of the Web `Storage` API — the injection seam of
 * {@link LocalStorageCredentialStore}. The adapter touches storage only
 * through this injected parameter, so the module graph stays jsdom-free
 * and testable under plain vitest/node.
 */
export interface StorageLike {
  /**
   * Read an item.
   *
   * @param key - Storage key.
   * @returns The stored string, or `null` when absent.
   */
  getItem: (key: string) => string | null;

  /**
   * Write an item.
   *
   * @param key - Storage key.
   * @param value - Value to store.
   */
  setItem: (key: string, value: string) => void;

  /**
   * Remove an item.
   *
   * @param key - Storage key.
   */
  removeItem: (key: string) => void;
}

/**
 * The default in-memory {@link CredentialStore}: a `Map<string, string>`
 * scoped to this object. Credentials never touch durable storage; a
 * page reload drops them (the caller re-runs login).
 *
 * @example
 * ```typescript
 * const store = new InMemoryCredentialStore();
 * store.set("mp.tokens.us", payload);
 * store.get("mp.tokens.us"); // payload
 * ```
 */
export class InMemoryCredentialStore implements CredentialStore {
  /** The backing map. */
  readonly #values = new Map<string, string>();

  /**
   * Read the value stored under `key`.
   *
   * @param key - Namespaced key.
   * @returns The stored string, or `null` when absent.
   */
  get(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  /**
   * Store `value` under `key`, overwriting any prior value.
   *
   * @param key - Namespaced key.
   * @param value - Opaque serialized payload.
   */
  set(key: string, value: string): void {
    this.#values.set(key, value);
  }

  /**
   * Remove the value stored under `key` (no-op when absent).
   *
   * @param key - Namespaced key.
   */
  delete(key: string): void {
    this.#values.delete(key);
  }

  /**
   * Drop every stored value — a convenience beyond the core interface,
   * e.g. for a logout that wipes all regions at once.
   */
  clear(): void {
    this.#values.clear();
  }
}

/**
 * The opt-in `localStorage` adapter.
 *
 * Security warning: `localStorage` is a synchronous, origin-scoped
 * store that is readable by any script on the origin — an XSS
 * vulnerability anywhere on the page exfiltrates everything kept here.
 * That is three payload families per region, not just tokens: the
 * bearer/refresh tokens, the pending-login record (PKCE code verifier
 * plus CSRF state — live login material until its lifetime expires
 * it), and the DCR client registration. Data also survives logout and
 * browser restarts unless deleted explicitly — on logout, delete every
 * key in `CREDENTIAL_KEYS.all(region)` for each region used. The
 * in-memory default ({@link InMemoryCredentialStore}) is the
 * recommended posture, with re-login on reload; use this adapter only
 * when the origin's script-injection surface is controlled and token
 * lifetimes are short.
 *
 * Backend failures (quota exhaustion, Safari private-mode storage, …)
 * re-throw as coded `OAUTH_CONFIG_ERROR` with the original exception as
 * `cause`, so callers key on a code and never see a bare `DOMException`.
 *
 * @example
 * ```typescript
 * // Browser: uses globalThis.localStorage.
 * const store = new LocalStorageCredentialStore();
 * // Tests / non-browser runtimes: inject a Storage-shaped object.
 * const injected = new LocalStorageCredentialStore(fakeStorage);
 * ```
 */
export class LocalStorageCredentialStore implements CredentialStore {
  /** The injected Storage-shaped backend. */
  readonly #storage: StorageLike;

  /**
   * Construct the adapter over an injected storage object.
   *
   * @param storage - `Storage`-shaped backend; defaults to
   *   `globalThis.localStorage`.
   * @throws {@link OAuthError} `OAUTH_CONFIG_ERROR` when no storage was
   *   injected and `globalThis.localStorage` does not exist (running
   *   under a non-browser runtime without injection).
   */
  constructor(storage?: StorageLike) {
    const resolved =
      storage ?? (globalThis as { localStorage?: StorageLike }).localStorage;
    if (resolved === undefined) {
      throw new OAuthError(
        "LocalStorageCredentialStore requires a browser localStorage " +
          "(globalThis.localStorage is not available in this runtime) — " +
          "inject a Storage-shaped object or use InMemoryCredentialStore.",
        "OAUTH_CONFIG_ERROR",
        { seam: "localStorage" },
      );
    }
    this.#storage = resolved;
  }

  /**
   * Run a storage operation, re-throwing backend failures as the coded
   * `OAUTH_CONFIG_ERROR`. Quota exhaustion and private-mode storage
   * surface as uncoded `DOMException`s; every library error carries a
   * code, and the constructor already codes storage-unavailability the
   * same way.
   *
   * @param operation - Human label for the message (out of contract).
   * @param run - The raw storage call.
   * @returns The operation result.
   * @throws {@link OAuthError} `OAUTH_CONFIG_ERROR` with the backend
   *   exception as `cause`.
   */
  #guarded<T>(operation: string, run: () => T): T {
    try {
      return run();
    } catch (error) {
      throw new OAuthError(
        `localStorage ${operation} failed (quota exhausted or storage ` +
          "unavailable — e.g. private browsing). The credential was NOT " +
          "persisted; choose a different CredentialStore or free space.",
        "OAUTH_CONFIG_ERROR",
        { seam: "localStorage", operation },
        { cause: error },
      );
    }
  }

  /**
   * Read the value stored under `key`.
   *
   * @param key - Namespaced key.
   * @returns The stored string, or `null` when absent.
   * @throws {@link OAuthError} `OAUTH_CONFIG_ERROR` on backend failure.
   */
  get(key: string): string | null {
    return this.#guarded("read", () => this.#storage.getItem(key));
  }

  /**
   * Store `value` under `key`, overwriting any prior value.
   *
   * @param key - Namespaced key.
   * @param value - Opaque serialized payload.
   * @throws {@link OAuthError} `OAUTH_CONFIG_ERROR` on backend failure.
   */
  set(key: string, value: string): void {
    this.#guarded("write", () => {
      this.#storage.setItem(key, value);
    });
  }

  /**
   * Remove the value stored under `key` (no-op when absent).
   *
   * @param key - Namespaced key.
   * @throws {@link OAuthError} `OAUTH_CONFIG_ERROR` on backend failure.
   */
  delete(key: string): void {
    this.#guarded("delete", () => {
      this.#storage.removeItem(key);
    });
  }
}
