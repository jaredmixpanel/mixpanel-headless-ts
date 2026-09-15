# @mixpanel-headless/browser

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
