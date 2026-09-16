---
title: In the browser
description: "The same Workspace facade from a web page — server-minted bearer tokens or a redirect PKCE login with no backend, a popup variant for embedded pages, injectable credential storage, and the guardrails the browser build enforces."
---

# In the browser

`@mixpanel-headless/browser` exposes the same `Workspace` facade as the Node package, constructed through browser-safe factories. The Query and App APIs are CORS-open with bearer auth in every region, so the whole query, discovery, report-link and entity surface runs from a page. Two ways in:

- **A server-minted bearer token** — your backend holds the real credentials and hands the page a short-lived token.
- **The redirect PKCE flow** — full in-browser OAuth, no backend required. A page that is itself embedded in another site uses the same login through a popup ([below](#popup-flow-embedded-pages)).

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

## Popup flow (embedded pages)

A page that is itself inside an `<iframe>` — a Notion or Confluence embed, a Salesforce or intranet panel — cannot run the redirect flow. Mixpanel's authorize page sends `frame-ancestors 'none'`, so navigating the frame to it draws a blank, and navigating the top window is not the framed page's to do. The login has to happen in a top-level window of its own: [`loginInPopup`](/reference/browser/functions/loginInPopup) opens one, sends it to Mixpanel, and waits for it to come back. Because Mixpanel sends no `Cross-Origin-Opener-Policy`, the popup keeps `window.opener` across the round trip, so when it lands on your redirect URI it can hand the return URL back to the frame with `postMessage`. The frame then finishes the exchange itself with the verifier it never let out of memory.

Nothing about the token protocol changes: `loginInPopup` composes [`beginLogin`](/reference/browser/functions/beginLogin) and [`completeLogin`](/reference/browser/functions/completeLogin), and the popup is only a different transport for the one string that crosses windows.

The framed page starts the flow and, when the promise settles, builds the workspace from the same store:

```ts twoslash
import {
  createBrowserWorkspaceFromStore,
  InMemoryCredentialStore,
  loginInPopup,
} from "@mixpanel-headless/browser";

const store = new InMemoryCredentialStore(); // the page never navigates
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
console.log(await ws.events());
```

The callback page serves both flows. [`relayPopupReturn`](/reference/browser/functions/relayPopupReturn) returns `true` only when the document is the popup this library opened (its `window.name` is [`POPUP_WINDOW_NAME`](/reference/browser/variables/POPUP_WINDOW_NAME) and its opener is still there); it then posts the return and the page has nothing left to do but close. Otherwise the page is a top-level redirect return and completes it as before:

```ts twoslash
import {
  BROWSER_NO_PENDING_LOGIN,
  BrowserUnsupportedError,
  completeLogin,
  LocalStorageCredentialStore,
  relayPopupReturn,
} from "@mixpanel-headless/browser";

if (relayPopupReturn()) {
  window.close(); // the opener has the return; nothing else to do here
} else {
  const store = new LocalStorageCredentialStore(sessionStorage);
  try {
    await completeLogin({ region: "us", returnUrl: location.href, store });
  } catch (error) {
    if (
      error instanceof BrowserUnsupportedError &&
      error.code === BROWSER_NO_PENDING_LOGIN
    ) {
      // No opener and no pending record: the login started somewhere this
      // window cannot reach. Show the URL so the user can paste it there.
      document.body.textContent = `Copy this address back into the page you signed in from: ${location.href}`;
    } else {
      throw error;
    }
  }
}
```

Rules for the popup flow:

- **`redirectUri` must be same-origin with the page, and still a compile-time constant.** The popup posts the return URL to exactly that origin and the frame accepts messages from exactly that origin and exactly that window; a `redirectUri` on any other origin is refused with `OAUTH_CONFIG_ERROR` before any network. Everything the redirect flow says about deriving it from user input applies unchanged.
- **The in-memory store is enough.** The framed page never navigates, so the pending record, the PKCE verifier and the tokens can all stay in the default [`InMemoryCredentialStore`](/reference/browser/classes/InMemoryCredentialStore) — and inside a third-party iframe they should (see below).
- **Only the return URL crosses windows.** The message is `{ type: POPUP_RETURN_MESSAGE_TYPE, v: 1, url }` and nothing else: no tokens, no verifier, no client id. A compromised relay page holds a one-time code that is useless without the verifier in the frame's memory. The frame ignores messages from other origins, other windows, other shapes and other `state` values, and keeps waiting for the real one.
- **The outcomes are typed.** `BrowserUnsupportedError` / `BROWSER_POPUP_BLOCKED` with `error.details.reason === "blocked"` means `window.open` returned nothing. The pending record is kept and the error carries `error.details.authorize_url` (and `error.details.state`): render that URL as a link or anchor the user can click — a real click on an anchor is rarely blocked — and offer a paste box for the return URL that calls `completeLogin` on the same store. No fresh `beginLogin` is needed; the record stays bounded by the pending-age gate. The same code with `reason: "in_flight"` is a second `loginInPopup` over the same store and region while one is still running: it is refused without touching the first call's record, and there is no link to offer, so the page should simply wait for the first call — the named window means a repeat click has already focused the existing popup. `BROWSER_POPUP_CLOSED` means the user shut the popup before it came back — a quiet "sign-in canceled" is the right copy. No return within `timeoutMs` ([`DEFAULT_POPUP_TIMEOUT_MS`](/reference/browser/variables/DEFAULT_POPUP_TIMEOUT_MS), five minutes) is `OAuthError` / `OAUTH_TIMEOUT`; pass a `signal` to cancel sooner, and the promise rejects with the signal's reason. Closed, timeout and abort all delete the pending record, so recovery from those is a fresh `loginInPopup`. The provider's refusal is still `OAUTH_AUTH_DENIED`, and a tampered return still `OAUTH_STATE_MISMATCH`, exactly as in the redirect flow.
- **When the opener is gone, fall back to paste.** Electron shells such as the Notion desktop app hand `window.open` to the system browser, which has no opener; the same happens if Mixpanel ever adds a `Cross-Origin-Opener-Policy`. `relayPopupReturn()` then returns `false`, and the callback page above ends up showing its own URL for the user to paste into the framed page's box. `completeLogin` accepts that pasted URL with the same grammar and the same codes, so there is no second protocol to maintain.

The window APIs the flow needs (`open`, the `message` listener, the close poll and the timer) sit behind [`PopupHost`](/reference/browser/interfaces/PopupHost), which defaults to the page's `window`; tests inject one and run under Node.

### Embedding the page in Notion, Confluence, or an intranet

- **Use the host's URL or iframe embed, not an HTML block.** Notion's HTML block runs your markup under a Content Security Policy whose `connect-src` does not include `mixpanel.com`, so no query can leave it; nothing on the library's side changes that. The classic Embed block — an iframe of a URL you host — has no such limit, allows `window.open` from the framed page, and is where the popup flow was designed to run.
- **Keep tokens in memory.** Chrome and Safari partition storage inside third-party iframes: `localStorage`, `sessionStorage` and `BroadcastChannel` in the frame are not the ones the top-level popup sees, which is why the flow uses `window.opener` rather than a storage event, and why nothing you persist from the frame reaches a later visit anyway. The default `InMemoryCredentialStore` is the right store here; the user signs in again on reload.
- **Let the page decide which flow it is in.** `window.self !== window.top` is true when framed: use `loginInPopup` there and the redirect flow at the top level, with one redirect URI and one callback page serving both. Keep the paste box reachable in the framed signed-out state, collapsed, so the Electron and popup-blocked cases have somewhere to land.

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

| Code                              | When                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BROWSER_SERVICE_ACCOUNT_REFUSED` | A service-account (Basic auth) credential reached any construction path — project secrets never ship to a page, even though CORS would permit the calls                                                                                                                                                                                                   |
| `BROWSER_EXPORT_UNSUPPORTED`      | `streamEvents` / `streamProfiles` were called — the Export API hosts serve no CORS headers, so the call is refused before any network attempt                                                                                                                                                                                                             |
| `BROWSER_NO_PENDING_LOGIN`        | `completeLogin` found no pending login in the store (fresh tab, expired record, replayed return)                                                                                                                                                                                                                                                          |
| `BROWSER_POPUP_BLOCKED`           | `loginInPopup` could not open its window (`details.reason` `"blocked"`: the pending record is kept, render `details.authorize_url` as a link and offer a paste box that calls `completeLogin` on the same store) or a popup login is already running over the same store and region (`"in_flight"`: refused without touching it; wait for the first call) |
| `BROWSER_POPUP_CLOSED`            | The user closed the popup before it returned; the pending login is discarded and a fresh `loginInPopup` starts over                                                                                                                                                                                                                                       |

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
