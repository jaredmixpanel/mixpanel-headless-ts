/**
 * @mixpanel-headless/browser — browser-specific surface (rulebook
 * R9.3): injectable `CredentialStore` (in-memory default; documented
 * localStorage adapter with security warning), first-class
 * `oauth_token` mode, service-account runtime refusal, Export-API
 * exclusion (plan §4.3: Export is Node-only), and — landing in B9-R2 —
 * the redirect-based PKCE flow over the core WebCrypto primitives.
 *
 * One entry point (R7-consistent): browser implementations plus
 * re-exports of the core surface a browser consumer needs.
 */

/** Package name constant exercised by the skeleton smoke test. */
export const BROWSER_PACKAGE_NAME = "@mixpanel-headless/browser";

// ── Browser implementations (B9-R1) ────────────────────────────────────
export {
  InMemoryCredentialStore,
  LocalStorageCredentialStore,
  type StorageLike,
} from "./credential-store.js";
export {
  browserSession,
  createBrowserWorkspace,
  createBrowserWorkspaceFromStore,
  type BrowserSessionOptions,
  type BrowserWorkspaceFromStoreOptions,
  type BrowserWorkspaceOptions,
} from "./client.js";
export {
  BROWSER_EXPORT_UNSUPPORTED,
  BROWSER_SERVICE_ACCOUNT_REFUSED,
  BrowserUnsupportedError,
} from "./errors.js";
export {
  serializeClientInfoPayload,
  serializeTokensPayload,
} from "./token-serialization.js";

// ── Core re-exports (the surface a browser consumer needs — §2.5) ─────
export {
  CREDENTIAL_KEYS,
  type CredentialStore,
} from "../../core/src/auth/credential-store.js";
export { PkceChallenge } from "../../core/src/auth/pkce.js";
export type { Account, Region } from "../../core/src/auth/account.js";
export type { Session } from "../../core/src/auth/session.js";
export {
  OAuthTokens,
  parseOAuthClientInfo,
  parseOAuthTokens,
  type OAuthClientInfo,
} from "../../core/src/auth/token.js";
export { Workspace } from "../../core/src/workspace.js";
// The error hierarchy (coded errors; programs key on `.code` — R5).
export * from "../../core/src/errors.js";
