# @mixpanel-headless/browser

## 0.2.0

### Minor Changes

- 6a7ad73: Add `loginInPopup` and `relayPopupReturn`: a popup transport for the PKCE
  login so a page embedded in another site (Mixpanel's authorize page sends
  `frame-ancestors 'none'`, so a framed page cannot redirect) can sign in from a
  top-level window that posts only the return URL back to its opener. Same
  `beginLogin` / `completeLogin` protocol; new codes `BROWSER_POPUP_BLOCKED` and
  `BROWSER_POPUP_CLOSED`, a timeout of `DEFAULT_POPUP_TIMEOUT_MS` as
  `OAUTH_TIMEOUT`, and the `PopupHost` seam for tests.

### Patch Changes

- a7be79c: Stop sending `User-Agent` from the browser package: it is a Fetch forbidden
  request header, and Safari forwards it into the CORS preflight, where Mixpanel
  rejects it and every bearer-authenticated call fails. `MixpanelClientOptions`
  gains `getUserAgent` (`UserAgentSource`; `null` omits the header) — Node keeps
  sending the library value.
- Updated dependencies [a7be79c]
- Updated dependencies [7fa773e]
  - @mixpanel-headless/core@0.2.0

## 0.1.0

Initial release (not yet published; the manifests carry `"private": true`
until the owner flips them — `CONTRIBUTING.md`, "Releasing").

- `createBrowserWorkspace` (server-minted bearer token) and
  `createBrowserWorkspaceFromStore`; redirect PKCE login (`beginLogin` /
  `completeLogin`) over an injectable `CredentialStore`
  (`InMemoryCredentialStore`, `LocalStorageCredentialStore`).
- Typed guardrails: service-account credentials and the Export API are refused
  before any network attempt (`BROWSER_SERVICE_ACCOUNT_REFUSED`,
  `BROWSER_EXPORT_UNSUPPORTED`).
- Re-exports the core query vocabulary and error hierarchy.
