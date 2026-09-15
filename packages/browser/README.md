# @mixpanel-headless/browser

The browser surface of Mixpanel Headless: the same `Workspace` facade as
[`@mixpanel-headless/core`](../core/README.md), constructed through
browser-safe factories — a server-minted bearer token, or a full redirect
PKCE login with no backend — over an injectable credential store. The Query
and App APIs are CORS-open with bearer auth in every region, so the whole
query, discovery, report-link and entity surface runs from a page.

## Install

```bash
npm i @mixpanel-headless/browser
```

ESM only; any evergreen browser (WebCrypto `SubtleCrypto` is required for
PKCE, so the page must be served from a secure context — `https:` or
`localhost`). `@mixpanel-headless/core` is a dependency; the query vocabulary
is re-exported so a page needs one import.

## Usage

```ts
import {
  beginLogin,
  completeLogin,
  createBrowserWorkspace,
  createBrowserWorkspaceFromStore,
  Filter,
  LocalStorageCredentialStore,
} from "@mixpanel-headless/browser";

// 1. Server-minted bearer token.
const ws = createBrowserWorkspace({
  token: "eyJ…",
  projectId: "12345",
  region: "us",
});
const result = await ws.query("Login", {
  math: "dau",
  last: 30,
  where: Filter.equals("plan", "pro"),
});
console.log(result.toRows());

// 2. Redirect PKCE — login page …
const store = new LocalStorageCredentialStore(sessionStorage);
const { authorizeUrl } = await beginLogin({
  region: "us",
  redirectUri: "https://app.example.com/oauth/callback",
  store,
});
location.assign(authorizeUrl);

// … and callback page.
await completeLogin({ region: "us", returnUrl: location.href, store });
const ws2 = await createBrowserWorkspaceFromStore({
  region: "us",
  projectId: "12345",
  store,
});
console.log(await ws2.events());
```

Rules for the redirect flow:

- **`redirectUri` must be a compile-time constant of your application.** Never
  derive it from user input or query parameters: client registration accepts
  arbitrary `https:` origins, so an attacker-influenced value delivers the
  authorization code elsewhere. `beginLogin` rejects non-absolute and
  non-`https:` values (`http:` only on loopback) with `OAUTH_CONFIG_ERROR`, but
  cannot detect a hostile `https:` origin.
- **The store must survive the redirect.** `completeLogin` runs on a fresh
  page load; the default in-memory store cannot carry the pending login
  across it (`BROWSER_NO_PENDING_LOGIN`). Back `LocalStorageCredentialStore`
  with `sessionStorage` for the login hop — tab-scoped and cleared on close.
- **Pending logins are single-use and expire** (30 minutes by default,
  `maxPendingAgeMs`); start a fresh `beginLogin` after that.

## Entry point

- Factories: `browserSession`, `createBrowserWorkspace`,
  `createBrowserWorkspaceFromStore`; redirect flow: `beginLogin`,
  `completeLogin`.
- Stores: `InMemoryCredentialStore` (default), `LocalStorageCredentialStore`
  (takes any `Storage`-shaped object), the `CredentialStore` interface and
  `CREDENTIAL_KEYS` (delete every key in `CREDENTIAL_KEYS.all(region)` on
  logout).
- The core query vocabulary as runtime values — `Filter`, `Metric`, `Formula`,
  `GroupBy`, `FunnelStep`, `FlowStep`, `RetentionEvent`, `TimeComparison`,
  `FrequencyBreakdown`, the inline-cohort classes, `validateBookmark`,
  `inferBookmarkType`, `pythonJsonDumpsCanonical` — plus `CreateAnnotationParams`
  and the full error hierarchy. `Workspace` itself is exported as a **type
  only**: construction goes through the gated factories above.

## Platform notes

- **No Node globals.** The package (like core) never touches `process`,
  `Buffer` or `node:*`; environment-style configuration arrives as options —
  e.g. an alternate API host is `clientOptions.endpointOverrides` on the
  factories rather than `MP_API_BASE_URL`.
- **Storage is injected.** The default store is in-memory (re-login on
  reload). Anything kept in Web Storage is readable by any script on the
  origin and survives logout unless deleted; treat persistence as a deliberate
  trade-off and keep token lifetimes short.
- **Guardrails are typed errors, not silent failures.** Service-account
  (Basic) credentials are refused on every construction path
  (`BROWSER_SERVICE_ACCOUNT_REFUSED`); the Export/streaming API hosts serve no
  CORS headers and are refused before any network attempt
  (`BROWSER_EXPORT_UNSUPPORTED`) unless `endpointOverrides.apiBaseUrl`
  re-homes export at a CORS-capable proxy.
- **No token refresh in the browser.** An expired stored token raises
  `OAuthError` / `OAUTH_TOKEN_ERROR`; run `beginLogin` again. Refresh lives in
  `@mixpanel-headless/node`.
- `OAuthError.details` redacts token material from malformed token responses,
  but scrub `details` before forwarding errors to telemetry anyway.

## Status

Published as `"private": true` until the release process lands; flipping that
flag is the owner's one-line change. Licence: MIT.
