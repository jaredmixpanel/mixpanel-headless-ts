# @mixpanel-headless/node

## 0.1.0

Initial release (not yet published; the manifests carry `"private": true`
until the owner flips them — `CONTRIBUTING.md`, "Releasing").

- `createNodeWorkspace()` and the resolver sources that read `~/.mp/config.toml`
  (shared with the Python `mp` CLI), the `MP_*` environment variables and the
  bridge file.
- OAuth (PKCE) login with a loopback callback and a paste fallback, on-disk
  token storage and refresh, the `/me` cache.
- `accounts` / `session` / `targets` management namespaces and `loginUnified`.
- Streaming Export API (`streamEvents`, `streamProfiles`).
