---
title: In the browser
description: "The same Workspace facade from a web page — server-minted bearer tokens or a redirect PKCE login with no backend, injectable credential storage, and the guardrails the browser build enforces."
---

# In the browser

`@mixpanel-headless/browser` exposes the same `Workspace` facade as the Node package, constructed through browser-safe factories. The Query and App APIs are CORS-open with bearer auth in every region, so the whole query, discovery, report-link and entity surface runs from a page. Two ways in:

- **A server-minted bearer token** — your backend holds the real credentials and hands the page a short-lived token.
- **The redirect PKCE flow** — full in-browser OAuth, no backend required.

Install it with `npm install @mixpanel-headless/browser` ([Installation](/getting-started/installation)). The package is ESM, has no Node dependencies, and needs a secure context (`https:` or `localhost`) because PKCE uses WebCrypto.

## Server-minted bearer token

The shortest path: a token, a project id and a region.

```ts twoslash
import { createBrowserWorkspace } from "@mixpanel-headless/browser";
declare const token: string; // minted by your backend, short-lived
// ---cut---
const ws = createBrowserWorkspace({
  token,
  projectId: "12345",
  region: "us",
});

const result = await ws.query("Login", { math: "dau", last: 30 });
console.table(result.toRows());
```

[`createBrowserWorkspace`](/reference/browser/functions/createBrowserWorkspace) ([`BrowserWorkspaceOptions`](/reference/browser/interfaces/BrowserWorkspaceOptions)) accepts an optional `workspaceId` pin, an `accountName` (default `"browser"`), a `store`, an injectable `fetch`, and `clientOptions` for the core client (`maxRetries`, `timeoutSeconds`, `endpointOverrides`, …). [`browserSession({ token, projectId, region })`](/reference/browser/functions/browserSession) builds the underlying `Session` on its own when you want to hand it to something else.

## Redirect PKCE flow

Client registration, PKCE challenge, CSRF state and token exchange are all handled for you; you only navigate. Two pages are involved.

The login page starts the flow and sends the browser to Mixpanel:

```ts twoslash
import {
  beginLogin,
  LocalStorageCredentialStore,
} from "@mixpanel-headless/browser";

const store = new LocalStorageCredentialStore(sessionStorage); // must survive the redirect
const { authorizeUrl } = await beginLogin({
  region: "us",
  redirectUri: "https://app.example.com/oauth/callback",
  store,
});
location.assign(authorizeUrl);
```

The callback page finishes it and builds the workspace from the stored tokens:

```ts twoslash
import {
  completeLogin,
  createBrowserWorkspaceFromStore,
  LocalStorageCredentialStore,
} from "@mixpanel-headless/browser";

const store = new LocalStorageCredentialStore(sessionStorage);
await completeLogin({ region: "us", returnUrl: location.href, store });

const ws = await createBrowserWorkspaceFromStore({
  region: "us",
  projectId: "12345",
  store,
});
console.log(await ws.events());
```

[`completeLogin`](/reference/browser/functions/completeLogin) returns the obtained `OAuthTokens` and writes them to the store under `CREDENTIAL_KEYS.tokens(region)`; [`createBrowserWorkspaceFromStore`](/reference/browser/functions/createBrowserWorkspaceFromStore) re-reads the store on every request, so a token that expires mid-session fails the next call rather than the whole page.

Rules for the redirect flow:

- **`redirectUri` must be a compile-time constant of your application.** Never derive it from user input or query parameters: client registration accepts arbitrary `https:` origins, so an attacker-influenced value delivers the authorization code elsewhere. [`beginLogin`](/reference/browser/functions/beginLogin) rejects non-absolute and non-`https:` values (`http:` only on loopback) with `OAUTH_CONFIG_ERROR`, but cannot detect a hostile `https:` origin.
- **The store must survive the redirect.** `completeLogin` runs on a fresh page load; the default in-memory store cannot carry the pending login across it (`BROWSER_NO_PENDING_LOGIN`). Back `LocalStorageCredentialStore` with `sessionStorage` for the login hop — tab-scoped and cleared on close.
- **Pending logins are single-use and expire** — 30 minutes by default (`DEFAULT_MAX_PENDING_AGE_MS`; override with `maxPendingAgeMs` on `completeLogin`). Start a fresh `beginLogin` after that.
- **The provider's refusal is typed.** A user who declines consent comes back as `OAuthError` / `OAUTH_AUTH_DENIED`; a tampered or replayed return URL as `OAUTH_STATE_MISMATCH`; a malformed one as `OAUTH_PASTE_ERROR`.

## Credential storage

Storage is injected through the [`CredentialStore`](/reference/core/interfaces/CredentialStore) interface (`get`, `set`, `delete`, sync or async) and defaults to memory:

- **[`InMemoryCredentialStore`](/reference/browser/classes/InMemoryCredentialStore)** (the default) keeps tokens out of persistent storage entirely — users re-login on reload. This is the recommended posture.
- **[`LocalStorageCredentialStore`](/reference/browser/classes/LocalStorageCredentialStore)** takes any `Storage`-shaped object (`localStorage`, `sessionStorage`, or your own `StorageLike`) and persists across navigations, which the redirect flow requires. Anything kept in Web Storage is readable by any script on your origin — a single XSS hole exfiltrates it, and that is three payload families per region (the tokens, the pending-login record with its PKCE verifier, and the client registration). Treat persistence as a deliberate trade-off and keep token lifetimes short.

On logout, delete every key the library wrote for each region you used ([`CREDENTIAL_KEYS`](/reference/core/variables/CREDENTIAL_KEYS)):

```ts twoslash
import {
  CREDENTIAL_KEYS,
  LocalStorageCredentialStore,
} from "@mixpanel-headless/browser";

const store = new LocalStorageCredentialStore(sessionStorage);

async function logout(region: "us" | "eu" | "in"): Promise<void> {
  for (const key of CREDENTIAL_KEYS.all(region)) {
    await store.delete(key);
  }
}
```

## Building queries client-side

The browser entry re-exports the full query vocabulary as runtime values — `Filter`, `Metric`, `Formula`, `GroupBy`, `FunnelStep`, `FlowStep`, `RetentionEvent`, `TimeComparison`, `FrequencyBreakdown`, the inline-cohort classes (`CohortDefinition`, `CohortCriteria`, `CohortBreakdown`, `CohortMetric`) and `validateBookmark` — so a page can build and rebuild queries from its own controls without a second import from `@mixpanel-headless/core`. They are the same pure classes core exports.

```ts twoslash
import {
  createBrowserWorkspace,
  Filter,
  FunnelStep,
} from "@mixpanel-headless/browser";
declare const token: string;
const ws = createBrowserWorkspace({ token, projectId: "12345", region: "us" });
// ---cut---
const funnel = await ws.queryFunnel(
  [
    "Signup",
    new FunnelStep({
      event: "Purchase",
      filters: [Filter.equals("plan", "pro")],
    }),
  ],
  { last: 30 },
);
console.log(funnel.overall_conversion_rate);
```

Two identity helpers ride along for pages that name what they just built: `pythonJsonDumpsCanonical` (the CPython-parity canonical JSON a query-reference hash is taken over) and `inferBookmarkType` (the report type a params object describes, or `null`). `CreateAnnotationParams` is exported too, the one entity write a page can be granted.

`Workspace` itself is exported as a **type only**. A value export would let a page call `new Workspace({ session })` with a service-account session and bypass the guardrails below, so construction goes through the gated factories; annotations such as `let ws: Workspace` keep working.

## Guardrails

The browser build enforces its boundaries with typed errors rather than silent failures — every one is a [`BrowserUnsupportedError`](/reference/browser/classes/BrowserUnsupportedError) (a `MixpanelHeadlessError` subclass) you can `instanceof` and whose `code` you can key on:

| Code                              | When                                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BROWSER_SERVICE_ACCOUNT_REFUSED` | A service-account (Basic auth) credential reached any construction path — project secrets never ship to a page, even though CORS would permit the calls |
| `BROWSER_EXPORT_UNSUPPORTED`      | `streamEvents` / `streamProfiles` were called — the Export API hosts serve no CORS headers, so the call is refused before any network attempt           |
| `BROWSER_NO_PENDING_LOGIN`        | `completeLogin` found no pending login in the store (fresh tab, expired record, replayed return)                                                        |

::: warning Node.js only
Streaming extraction and session-replay fetching are Node-only; use `@mixpanel-headless/node` for those workloads. See [Streaming](/guide/streaming) and [Session replay](/guide/session-replay).
:::

Three more differences from the Node package, all listed among the port's [known divergences](/architecture/porting):

- **No token refresh in the browser.** An expired stored token raises `OAuthError` / `OAUTH_TOKEN_ERROR`; run `beginLogin` again. Refresh lives in `@mixpanel-headless/node`.
- **Header-redirect shortlinks resolve only on Node.** Browser `fetch` hides redirect headers, so a shortlink that answers with a `3xx` cannot be expanded from a page; the long-URL `200` form resolves everywhere. See [Report links](/guide/report-links).
- **No `User-Agent` header.** It is a forbidden request header under the Fetch specification; Safari forwards it into the CORS preflight, where Mixpanel rejects it, so the browser factories omit it (Node sends it).

`OAuthError.details` redacts token material from malformed token responses, but scrub `details` before forwarding errors to telemetry anyway.

## Alternate API host

There is no environment in a browser, so `MP_API_BASE_URL` has no meaning here. The same routing arrives as an option — `clientOptions.endpointOverrides` on either factory, as a static bag or a provider consulted on every request:

```ts twoslash
import { createBrowserWorkspace } from "@mixpanel-headless/browser";
declare const token: string;
// ---cut---
const ws = createBrowserWorkspace({
  token,
  projectId: "12345",
  region: "us",
  clientOptions: {
    endpointOverrides: { apiBaseUrl: "https://mixpanel-proxy.example.com" },
  },
});
```

The Export-API refusal is evaluated per request against the effective table: `apiBaseUrl` re-homes Export at `{apiBaseUrl}/api/2.0`, which the guard admits (the proxy must serve CORS headers), while the live export origins stay refused even under an override. The family table and the `appBaseUrl` variant are described in [Configuration → Alternate API host](/getting-started/configuration#alternate-api-host-mp-api-base-url).

## Next steps

- [Error handling](/guide/error-handling) — the hierarchy the browser errors slot into
- [Unified query system](/guide/unified-query-system) — the vocabulary the page builds queries with
- [Report links](/guide/report-links) — turning a page's query into a shareable Mixpanel URL
