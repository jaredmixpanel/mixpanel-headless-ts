/**
 * Browser `CredentialStore` implementations (b9-packets.md §2.1;
 * contract arbiter R9.3 — the core interface lives in
 * `packages/core/src/auth/credential-store.ts`).
 *
 * - {@link InMemoryCredentialStore} is the DEFAULT (R9.3 "default
 *   in-memory"): credentials live for the page's lifetime and vanish
 *   on reload — the recommended posture (re-login on reload).
 * - {@link LocalStorageCredentialStore} is the documented opt-in
 *   adapter. SECURITY WARNING (R9.3 REQUIREMENT — read before using):
 *   `localStorage` is synchronous, ORIGIN-scoped, and XSS-readable.
 *   The store persists THREE payload families per region (pair-B FB-9
 *   breadth fix): the bearer/refresh tokens, the PENDING-LOGIN record
 *   (PKCE code verifier + CSRF state), and the DCR client
 *   registration. Every one of them is readable by any script running
 *   on the origin (a single XSS hole exfiltrates them), and the data
 *   survives logout and browser restarts unless `delete`d explicitly —
 *   on logout delete every key in `CREDENTIAL_KEYS.all(region)` for
 *   each region used. Prefer the in-memory default and re-login on
 *   reload; opt into localStorage only when the origin's
 *   script-injection surface is controlled and token lifetimes are
 *   short.
 */

import { type CredentialStore, OAuthError } from "@mixpanel-headless/core";

/**
 * Structural view of the Web `Storage` API — the injection seam of
 * {@link LocalStorageCredentialStore} (§0.4: the adapter touches
 * storage ONLY via this injected parameter, so the module graph stays
 * jsdom-free and testable under plain vitest/node).
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
 * The default in-memory {@link CredentialStore} (R9.3 "default
 * in-memory"): a `Map<string, string>` scoped to this object.
 * Credentials never touch durable storage; a page reload drops them
 * (the caller re-runs login).
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
   * Drop every stored value (convenience extra allowed by §2.1 —
   * e.g. a logout that wipes all regions at once).
   */
  clear(): void {
    this.#values.clear();
  }
}

/**
 * The documented `localStorage` adapter (R9.3 "documented localStorage
 * adapter with security warning").
 *
 * SECURITY WARNING (R9.3 REQUIREMENT): `localStorage` is a
 * synchronous, origin-scoped store that is READABLE BY ANY SCRIPT on
 * the origin — an XSS vulnerability anywhere on the page exfiltrates
 * EVERYTHING kept here: the bearer/refresh tokens, the pending-login
 * record (PKCE code VERIFIER + CSRF state — live login material until
 * its FB-5 lifetime expires it), and the DCR client registration
 * (pair-B FB-9: all three payload families, not just tokens). Data
 * also survives logout and browser restarts unless `delete`d
 * explicitly — on logout, delete every key in
 * `CREDENTIAL_KEYS.all(region)` for each region used. The in-memory
 * default ({@link InMemoryCredentialStore}) is the recommended
 * posture, with re-login on reload; use this adapter only as a
 * deliberate, documented trade-off.
 *
 * Backend failures (quota exhaustion, Safari-private storage, …)
 * re-throw as coded `OAUTH_CONFIG_ERROR` with the original exception
 * as `cause` (pair-B FB-11 — R5: coded, never a bare `DOMException`).
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
   * @throws OAuthError - `OAUTH_CONFIG_ERROR` when no storage was
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
   * `OAUTH_CONFIG_ERROR` (pair-B FB-11: quota exhaustion / private
   * mode escaped as uncoded `DOMException`s; R5 demands a code, and
   * the constructor already codes storage-unavailability the same
   * way).
   *
   * @param operation - Human label for the message (out of contract).
   * @param run - The raw storage call.
   * @returns The operation result.
   * @throws OAuthError - `OAUTH_CONFIG_ERROR` with the backend
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
   * @throws OAuthError - `OAUTH_CONFIG_ERROR` on backend failure.
   */
  get(key: string): string | null {
    return this.#guarded("read", () => this.#storage.getItem(key));
  }

  /**
   * Store `value` under `key`, overwriting any prior value.
   *
   * @param key - Namespaced key.
   * @param value - Opaque serialized payload.
   * @throws OAuthError - `OAUTH_CONFIG_ERROR` on backend failure.
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
   * @throws OAuthError - `OAUTH_CONFIG_ERROR` on backend failure.
   */
  delete(key: string): void {
    this.#guarded("delete", () => {
      this.#storage.removeItem(key);
    });
  }
}
