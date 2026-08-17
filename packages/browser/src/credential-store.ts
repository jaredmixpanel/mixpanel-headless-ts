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
 *   Bearer tokens stored there are readable by any script running on
 *   the origin (a single XSS hole exfiltrates them), and the data
 *   survives logout and browser restarts unless `delete`d explicitly.
 *   Prefer the in-memory default and re-login on reload; opt into
 *   localStorage only when the origin's script-injection surface is
 *   controlled and token lifetimes are short.
 */

import type { CredentialStore } from "../../core/src/auth/credential-store.js";
import { OAuthError } from "../../core/src/errors.js";

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
  getItem(key: string): string | null;

  /**
   * Write an item.
   *
   * @param key - Storage key.
   * @param value - Value to store.
   */
  setItem(key: string, value: string): void;

  /**
   * Remove an item.
   *
   * @param key - Storage key.
   */
  removeItem(key: string): void;
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
 * every bearer token kept here. Data also survives logout and browser
 * restarts unless `delete`d explicitly (call `delete` for every
 * `CREDENTIAL_KEYS` entry on logout). The in-memory default
 * ({@link InMemoryCredentialStore}) is the recommended posture, with
 * re-login on reload; use this adapter only as a deliberate,
 * documented trade-off.
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
   * Read the value stored under `key`.
   *
   * @param key - Namespaced key.
   * @returns The stored string, or `null` when absent.
   */
  get(key: string): string | null {
    return this.#storage.getItem(key);
  }

  /**
   * Store `value` under `key`, overwriting any prior value.
   *
   * @param key - Namespaced key.
   * @param value - Opaque serialized payload.
   */
  set(key: string, value: string): void {
    this.#storage.setItem(key, value);
  }

  /**
   * Remove the value stored under `key` (no-op when absent).
   *
   * @param key - Namespaced key.
   */
  delete(key: string): void {
    this.#storage.removeItem(key);
  }
}
