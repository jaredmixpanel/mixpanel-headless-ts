# @mixpanel-headless/node

The Node.js surface of Mixpanel Headless: everything in
[`@mixpanel-headless/core`](../core/README.md) plus the credential sources a
server, script or CI job needs — `~/.mp/config.toml` accounts (shared with the
Python library's `mp` CLI), environment-variable auth, programmatic OAuth
(PKCE) login with a localhost callback, on-disk token refresh, the bridge
file, and the ready-made `accounts` / `session` / `targets` management
namespaces. Start here unless you are in a browser.

## Install

```bash
npm i @mixpanel-headless/node
```

ESM only. Node ≥ 22.12. `@mixpanel-headless/core` is a dependency and is
re-exported, so one import suffices.

## Usage

```ts
import {
  accounts,
  createNodeWorkspace,
  session,
} from "@mixpanel-headless/node";

// Resolves env (MP_USERNAME/MP_SECRET or MP_OAUTH_TOKEN), then ~/.mp/config.toml.
const ws = createNodeWorkspace();

const result = await ws.query("Purchase", { math: "unique", last: 30 });
console.log(result.toRows());

for await (const event of ws.streamEvents({
  from_date: "2026-01-01",
  to_date: "2026-01-31",
})) {
  console.log(event);
}

console.log(accounts.list(), session.show());
```

`createNodeWorkspace()` is the twin of Python's bare `Workspace()`: it wires
the resolver sources (env → config file → bridge), the on-disk OAuth token
refresh and the `/me` cache in one call. Pass `{ account, project, workspace }`
or `{ target }` to pick a different axis than the config's `[active]` block.

Interactive login is one call and persists to the config file:

```ts
import { loginUnified } from "@mixpanel-headless/node";

const summary = await loginUnified({ region: "us" });
```

`loginUnified` reads the environment first: `MP_USERNAME` + `MP_SECRET` →
service account; `MP_OAUTH_TOKEN` → static bearer; neither → browser PKCE flow
with a loopback callback (and a paste fallback when the callback is blocked).

## Entry point

`@mixpanel-headless/node` re-exports the core public API and adds:

- `createNodeWorkspace`, `createNodeAuthEffects`, `createNodeResolverSources`,
  `createNodeWorkspaceSources`, `createNodeEnv`, `createNodeEndpointOverrides`
  — the factories that bind core's injected seams to `process.env` and the
  file system.
- `accounts`, `session`, `targets`, `loginUnified` — the management
  namespaces (`accounts.add` / `list` / `remove` / …, `session.show` / `use`,
  `targets.add` / `use` / …).
- `ConfigManager`, `OAuthFlow`, `OAuthStorage`, `MeCache`, the bridge-file
  functions and `CredentialPathError` for callers that compose their own
  wiring.

## Platform notes

- **Node ≥ 22.12** is the runtime floor (the request-side float twin uses
  `JSON.rawJSON`).
- Environment variables read: `MP_USERNAME`, `MP_SECRET`, `MP_OAUTH_TOKEN`,
  `MP_PROJECT_ID`, `MP_WORKSPACE_ID`, `MP_REGION`, `MP_CONFIG_PATH`,
  `MP_OAUTH_STORAGE_DIR`, `MP_AUTH_FILE`, `MP_API_BASE_URL`, `MP_APP_BASE_URL`
  — the same names as the Python library, with the same precedence (env
  first, then config file, then bridge).
- Config and token files are written with owner-only permissions; symlinked
  credential paths are refused. The default `~/.mp` directory is tightened to
  `0o700` on write; a custom `configPath` parent is left alone (see
  [`PORTING.md`](../../PORTING.md) for this and the other deliberate
  differences from Python).
- The Export/streaming API (`streamEvents`, `streamProfiles`) is Node-only;
  the browser package refuses it.

## Status

Published as `"private": true` until the release process lands; flipping that
flag is the owner's one-line change. Licence: MIT.
