# @mixpanel-headless/browser

The browser surface of Mixpanel Headless: the same `Workspace` facade as
[`@mixpanel-headless/core`](../core/README.md), constructed through
browser-safe factories — a server-minted bearer token, or a full PKCE login
with no backend, by redirect or, for embedded pages, in a popup — over an
injectable credential store. The Query
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

### Popup flow (embedded pages)

A page that is itself inside an `<iframe>` (a Notion or Confluence embed, an
intranet panel) cannot run the redirect flow: Mixpanel's authorize page sends
`frame-ancestors 'none'`. `loginInPopup` opens a top-level window instead,
and because Mixpanel sends no `Cross-Origin-Opener-Policy` the popup keeps
`window.opener`, so on landing at the redirect URI it posts the return URL
back to the frame, which completes the exchange itself. Same `beginLogin` /
`completeLogin` protocol, a different transport for one string.

```ts
import {
  completeLogin,
  createBrowserWorkspaceFromStore,
  InMemoryCredentialStore,
  loginInPopup,
  relayPopupReturn,
} from "@mixpanel-headless/browser";

// Framed page: memory is enough, the page never navigates.
const store = new InMemoryCredentialStore();
await loginInPopup({
  region: "us",
  redirectUri: "https://app.example.com/oauth/callback",
  store,
});
const ws = await createBrowserWorkspaceFromStore({
  region: "us",
  projectId: "12345",
  store,
});

// Callback page, dual-mode: relay when this window is the popup,
// otherwise finish a top-level redirect login as above.
if (!relayPopupReturn()) {
  await completeLogin({ region: "us", returnUrl: location.href, store });
}
```

Rules for the popup flow:

- **`redirectUri` must be same-origin with the page** (`OAUTH_CONFIG_ERROR`
  otherwise) and still a compile-time constant: the popup posts to exactly
  that origin and the frame accepts messages from exactly that origin and
  exactly that window.
- **Only the return URL crosses windows** — never tokens or the PKCE
  verifier. The message is `{ type: POPUP_RETURN_MESSAGE_TYPE, v: 1, url }`;
  anything else, from anywhere else, is ignored.
- **The outcomes are typed.** `BROWSER_POPUP_BLOCKED` with `details.reason`
  `"blocked"` (`window.open` returned nothing) keeps the pending record and
  carries `error.details.authorize_url`: render it as a link or anchor and
  offer a paste box that calls `completeLogin` on the same store; no fresh
  `beginLogin` needed, and the record stays bounded by the pending-age gate.
  The same code with `"in_flight"` is a second `loginInPopup` over the same
  store and region while one is running: refused without touching the first
  call's record, no link to offer — wait for the first call (a repeat click
  already focused the existing named popup). `BROWSER_POPUP_CLOSED`:
  the user shut the popup. `OAuthError` / `OAUTH_TIMEOUT` after `timeoutMs`
  (`DEFAULT_POPUP_TIMEOUT_MS`, five minutes); a `signal` cancels sooner.
  Closed, timeout and abort discard the pending record; recover with a fresh
  `loginInPopup`. The provider's refusal is still `OAUTH_AUTH_DENIED`.
- **When the opener is gone, fall back to paste.** Electron shells such as the
  Notion desktop app open the system browser; `relayPopupReturn()` returns
  `false` there, so the callback page should show its own URL for the user to
  paste into the frame. `completeLogin` accepts it with the same grammar.
- **Inside a third-party iframe, keep tokens in memory.** Storage is
  partitioned there, and use the host's URL/iframe embed rather than an HTML
  block whose CSP blocks `connect-src` to `mixpanel.com`. Decide the flow with
  `window.self !== window.top`.

## Entry point

- Factories: `browserSession`, `createBrowserWorkspace`,
  `createBrowserWorkspaceFromStore`; redirect flow: `beginLogin`,
  `completeLogin`; popup flow: `loginInPopup`, `relayPopupReturn`,
  `POPUP_WINDOW_NAME`, `POPUP_RETURN_MESSAGE_TYPE`,
  `DEFAULT_POPUP_TIMEOUT_MS` and the `PopupHost` seam.
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
- **No `User-Agent` header.** It is a forbidden request header under the
  Fetch specification; Safari forwards it into the CORS preflight, where
  Mixpanel rejects it, so the factories omit it (Node sends it).
- `OAuthError.details` redacts token material from malformed token responses,
  but scrub `details` before forwarding errors to telemetry anyway.

## Status

Carries `"private": true` until the owner flips it; versions and release notes
are managed by Changesets and published through `release.yml` (see the
repository's `CONTRIBUTING.md`, "Releasing"). License: MIT.
