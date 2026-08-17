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

## PKCE-in-browser status (D2 spike, b9-packets.md §4)

**PKCE-in-browser ships ENABLED.** DCR accepts third-party https redirect
URIs (verified 2026-08-16); end-to-end browser consent/exchange verified in
Phase-4 live burn-in.

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

## Credential storage

The default `CredentialStore` is in-memory (`InMemoryCredentialStore`):
nothing persists across a reload; re-login on reload is the recommended
posture. `LocalStorageCredentialStore` is provided as a documented adapter
— **security warning**: localStorage is origin-scoped, synchronous,
readable by ANY script running on the origin (XSS ⇒ token theft), and
survives logout unless explicitly deleted. See the class JSDoc in
`src/credential-store.ts` before opting in.

## Node-only surfaces

- **Export API streaming** (`streamEvents` / `streamProfiles` / raw export
  paths): the export hosts (`data.mixpanel.com` and regional twins) serve
  no CORS headers (plan §4.3), so browser calls are dead on arrival. The
  browser factory refuses them fast with the coded error
  `BROWSER_EXPORT_UNSUPPORTED` instead of an opaque CORS `TypeError`.
- Callback-server / paste-fallback login, env/config/bridge resolution, and
  token refresh live in `@mixpanel-headless/node`.
