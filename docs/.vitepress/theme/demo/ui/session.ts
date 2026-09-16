// The live session as a module singleton: the in-memory credential store
// the callback page fills and the live `Workspace` reads, plus what the
// playground needs to resume after the client-side hop from
// `/demo/callback` to `/demo`. Module state survives VitePress's
// client-side navigation and dies with the document, which is the
// memory-only token posture the page advertises — a hard reload means a
// fresh sign-in. This is the one place (with the callback page) that
// touches `sessionStorage`, and only for two non-secrets: the region of
// the sign-in in progress and the "this tab held a live session" flag
// behind the reload notice.

import {
  InMemoryCredentialStore,
  LocalStorageCredentialStore,
  type Workspace,
} from "@mixpanel-headless/browser";

import {
  asRegion,
  type ErrorRetry,
  LIVE_FLAG_STORAGE_KEY,
  type Me,
  type Region,
  REGION_STORAGE_KEY,
} from "../model/session-state.js";

/** What lives across the callback → playground hop. */
export interface LiveSession {
  /** The region the tokens belong to; `null` when signed out. */
  region: Region | null;
  /** `OAuthTokens.expires_at` of the tokens in `memory`. */
  expiresAt: string | null;
  /** The live facade once the picker built it. */
  ws: Workspace | null;
  /** The `/me` response the picker showed (kept for "Switch project"). */
  me: Me | null;
  /** Where the playground should land after a callback-page error. */
  resume: ErrorRetry | null;
}

/** The store the live `Workspace` reads; never written to storage. */
export const memory = new InMemoryCredentialStore();

/** The singleton. */
export const session: LiveSession = {
  region: null,
  expiresAt: null,
  ws: null,
  me: null,
  resume: null,
};

/**
 * The store that survives the redirect: `sessionStorage`, tab-scoped and
 * gone when the tab closes. Built per use so a storage failure surfaces
 * as the library's coded error at the call that needs it.
 *
 * @returns The hop store.
 */
export function hopStore(): LocalStorageCredentialStore {
  return new LocalStorageCredentialStore(sessionStorage);
}

/**
 * Remember the region before leaving for Mixpanel.
 *
 * @param region - The picked region.
 */
export function rememberRegion(region: Region): void {
  sessionStorage.setItem(REGION_STORAGE_KEY, region);
}

/**
 * The region of the sign-in in progress, if any.
 *
 * @returns The region or `null`.
 */
export function pendingRegion(): Region | null {
  return asRegion(sessionStorage.getItem(REGION_STORAGE_KEY));
}

/** Forget the region of the sign-in in progress. */
export function forgetRegion(): void {
  sessionStorage.removeItem(REGION_STORAGE_KEY);
}

/** Mark that this tab holds a live session (behind the reload notice). */
export function markLive(): void {
  sessionStorage.setItem(LIVE_FLAG_STORAGE_KEY, "1");
}

/**
 * Whether this tab held a live session before the current document.
 *
 * @returns `true` when the flag is set.
 */
export function wasLive(): boolean {
  return sessionStorage.getItem(LIVE_FLAG_STORAGE_KEY) !== null;
}

/** Drop the live-session flag and every in-memory reference. */
export function clearSession(): void {
  sessionStorage.removeItem(LIVE_FLAG_STORAGE_KEY);
  session.region = null;
  session.expiresAt = null;
  session.ws = null;
  session.me = null;
}
