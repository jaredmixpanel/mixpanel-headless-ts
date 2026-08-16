/**
 * Barrel for the `auth` module of @mixpanel-headless/core (D11 layout,
 * phase2-design C1/C4 — packet P2-4).
 *
 * Ports the public `auth_types` surface that is a Phase-2 type concern:
 * the `Account` discriminated union (+ variants, `TokenResolver`, id
 * aliases), the session shapes (`Session`/`Project`/`WorkspaceRef`/
 * `ActiveSession`), and the OAuth token models (`OAuthTokens`/
 * `OAuthClientInfo`). `BridgeFile`/`load_bridge`/`OnDiskTokenResolver`
 * are node-side file I/O and ship with Phase 3 B8 (C8 deferral table).
 */
export * from "./account.js";
export * from "./session.js";
export * from "./token.js";
export * from "./resolver.js";
export * from "./region-probe.js";
