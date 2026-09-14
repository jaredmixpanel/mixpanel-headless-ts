# @mixpanel-headless/browser

Browser build of mixpanel-headless (Tier C, plan §4.3): the Query and App
APIs are CORS-open with bearer auth in all regions, so the full core
`Workspace` runs in a browser origin against those hosts.

## Auth modes (R9.3)

1. **`oauth_token` — first-class and recommended.** A server-minted bearer
   token handed to the browser: `browserSession({ token, projectId, region })`
   / `createBrowserWorkspace(...)`. This is the shortest path in the package.
2. **Redirect-based PKCE (`beginLogin` / `completeLogin`)** — see status
   below.
3. **Service-account Basic auth is REFUSED at runtime** on every path with
   the coded error `BROWSER_SERVICE_ACCOUNT_REFUSED`: Basic credentials are
   long-lived secrets that must not ship to a browser origin (policy holds
   even though CORS would technically permit it — plan §4.3 Tier C note).
   The guard also covers clients derived via `client.withProject(...)`
   (recursively), and the entry point deliberately exports `Workspace` as a
   TYPE only — the gated factories are the only construction paths
   (pair-B review, `b9-reviewB-resolution.md`).

## Entry-point surface

The entry point re-exports the core **query vocabulary** as runtime values —
`Filter`, `Metric`, `Formula`, `GroupBy`, `FunnelStep`, `FlowStep`,
`RetentionEvent`, `TimeComparison`, `FrequencyBreakdown`, the inline-cohort
classes (`CohortDefinition` / `CohortCriteria` / `CohortBreakdown`), and
`validateBookmark`. A bundled browser build exposes only what this barrel
exports, and a page that re-queries when a control moves has to rebuild its
params in the page. These are the pure `types/query-params` dataclasses: they
hold no session and reach no transport, so unlike `Workspace` (TYPE only,
above) exporting them as values cannot bypass the service-account or export
gates. `test/query-vocabulary.test.ts` pins that property and fails if core
grows a builder this barrel does not forward.

Exactly one entity model is forwarded alongside it: `CreateAnnotationParams`,
because annotations is the only write class grantable to a page in v1 and
`createAnnotation` takes an instance. The other ~119 entity models stay off
this barrel; another `Create*Params` is added only when its write class
becomes grantable.

## PKCE-in-browser status (D2 spike, b9-packets.md §4)

**PKCE-in-browser ships ENABLED.** DCR accepts third-party https redirect
URIs (verified 2026-08-16); end-to-end browser consent/exchange to be
verified in Phase-4 live burn-in.

Verified: a live Dynamic Client Registration POST (`mcp/register/`,
RFC 7591, unauthenticated) with
`redirect_uris: ["https://spike-b9.example.com/oauth/callback"]` — a
third-party https origin — returned `201` with a `client_id`, and the
authorize URL built by the shipped `buildAuthorizeUrl` from that client is
well-formed (unauthenticated GET → `302` to the Mixpanel login page with
the authorize URL preserved as `next`).

Not yet verified without a real browser session (tracked as the Phase-4
"browser PKCE e2e" live-auth scenario; these docs claim no end-to-end
verification): (1) authorize-time `redirect_uri_allowed` enforcement for
the registered third-party URI; (2) the consent screen issuing a code to
that redirect; (3) a browser-origin `token/` POST succeeding cross-origin.

Browser v1 has no token-refresh surface (`refresh_token` grant is
Node-only for now; Phase-4 ledger row 8).

### Using the redirect flow safely (pair-B review, `b9-reviewB-resolution.md`)

- **`redirectUri` must be a compile-time constant.** NEVER derive it from
  user input or query parameters (`?returnTo=…`): DCR registers arbitrary
  third-party https origins (verified live), so an attacker-influenced
  value delivers the authorization code to the attacker's origin.
  `beginLogin` rejects non-absolute / non-https values (http is allowed
  only on loopback hosts, RFC 8252 §7.3) with `OAUTH_CONFIG_ERROR`, but
  that gate cannot detect a hostile https origin — the constant-only rule
  is on you.
- **The store must survive the redirect navigation.** `completeLogin` runs
  on a fresh page load; the in-memory default store cannot carry the
  pending login across it (`BROWSER_NO_PENDING_LOGIN`). Use
  `new LocalStorageCredentialStore(sessionStorage)` for the login hop —
  sessionStorage is tab-scoped and clears on tab close, a narrower
  exposure than localStorage.
- **Secure context required.** PKCE uses WebCrypto's `SubtleCrypto`, which
  browsers expose only on https or localhost origins; elsewhere the flow
  fails with `OAUTH_CONFIG_ERROR`.
- **Pending logins expire.** The `beginLogin` record is single-use AND
  time-bounded (default 30 minutes, `maxPendingAgeMs`); an expired record
  is discarded and `completeLogin` fails with `BROWSER_NO_PENDING_LOGIN` —
  start a fresh `beginLogin`.
- **Error details redact token material.** On a malformed 200 token
  response, `OAuthError.details.response_data` keeps field names but
  redacts every value except the primitive values of the safe RFC 6749
  metadata keys (`token_type`, `expires_in`, `scope`, `error`,
  `error_description`) — any other value, under any key at any nesting,
  renders as `<redacted>`; non-object 200 bodies render as a fixed
  placeholder and 200 bodies that fail JSON parsing are never embedded
  at all (Python parity — the FIX-2 redaction hardened by the ARB-B
  pair-B review, fix-of-record
  `context/phase3/bug-reports/python-oauth-error-details-token-payload.md`).
  Still scrub `error.details` before forwarding to logging/telemetry
  pipelines (Sentry etc.): non-200 responses embed the raw IdP ERROR
  body in `details.response_body` (an error document, not a token
  grant, but its contents are IdP-controlled), and defense in depth
  costs one line.

## Credential storage

The default `CredentialStore` is in-memory (`InMemoryCredentialStore`):
nothing persists across a reload; re-login on reload is the recommended
posture (note: the redirect PKCE flow itself needs a navigation-surviving
store — see "Using the redirect flow safely" above).
`LocalStorageCredentialStore` is provided as a documented adapter —
**security warning**: localStorage is origin-scoped, synchronous, readable
by ANY script running on the origin, and survives logout unless explicitly
deleted. It holds THREE payload families per region — bearer/refresh
tokens, the pending-login record (PKCE verifier + CSRF state), and the DCR
client registration — all XSS-exfiltratable. On logout delete every key in
`CREDENTIAL_KEYS.all(region)` for each region used. Backend failures
(quota, private browsing) re-throw as coded `OAUTH_CONFIG_ERROR`. See the
class JSDoc in `src/credential-store.ts` before opting in.

## Alternate API host (`endpointOverrides`)

There is no environment in a browser build, so the Python library's
`MP_API_BASE_URL` / `MP_APP_BASE_URL` override arrives as plain config:
`clientOptions.endpointOverrides` on `createBrowserWorkspace` /
`createBrowserWorkspaceFromStore` (a static `{ apiBaseUrl, appBaseUrl }`
bag, or a provider consulted on every request). `apiBaseUrl` routes every
API family at one base (`/api/query`, `/api/2.0`, `/api/query/engage`,
`/api/app`); `appBaseUrl` re-homes only the App API. See the root README's
"Alternate API host" section for the full semantics.

`apiBaseUrl` also **re-homes Export in the browser**: the Export-API refusal
guard is evaluated per request against the effective endpoint table, so an
export request to `{apiBaseUrl}/api/2.0/...` is admitted, while the live
export origins (`data.mixpanel.com` and regional twins) stay refused even
with an override active. The override host is user-controlled and must
serve CORS headers for the browser origin for export to actually work — a
CORS-capable proxy in front of the Export API is the intended shape.
`appBaseUrl` alone does not move Export (it stays on the live host and stays
refused). A provider-form override is consulted on every request, so
flipping it between calls changes the verdict without rebuilding the
workspace.

## Node-only surfaces

- **Export API streaming** (`streamEvents` / `streamProfiles` / raw export
  paths): the export hosts (`data.mixpanel.com` and regional twins) serve
  no CORS headers (plan §4.3), so browser calls are dead on arrival. The
  browser factory refuses them fast with the coded error
  `BROWSER_EXPORT_UNSUPPORTED` instead of an opaque CORS `TypeError`. The
  refusal is about those live hosts, not the API family: setting
  `clientOptions.endpointOverrides.apiBaseUrl` re-homes Export at
  `{apiBaseUrl}/api/2.0`, which the guard admits — provided that host
  serves CORS headers (see "Alternate API host" above).
- Callback-server / paste-fallback login, env/config/bridge resolution, and
  token refresh live in `@mixpanel-headless/node`.

## Publishing status

Published as `"private": true` until the release process lands; flipping
that flag is the owner's one-line change.
