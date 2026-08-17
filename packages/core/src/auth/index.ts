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
// B9-R1 (b9-packets.md §0.3): WebCrypto PKCE primitives (plan §4.1) +
// the browser CredentialStore seam (interface + key table only).
export * from "./pkce.js";
export * from "./credential-store.js";
// B9-R2 (b9-packets.md §3.1): the fetch-pure OAuth hoist — constants,
// parse_qs twin, redirect parsing, and the authorize/token/DCR HTTP
// halves shared by node (re-export/delegate) and browser (import).
export * from "./oauth-constants.js";
export * from "./query-params.js";
export * from "./redirect-parse.js";
export * from "./oauth-http.js";
