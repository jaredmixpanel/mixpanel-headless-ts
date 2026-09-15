---
title: Configuration
description: Accounts, projects and workspaces — environment variables, the shared ~/.mp/config.toml, the credential resolution chain, saved targets, bridge files and the alternate API host.
---

# Configuration

Mixpanel Headless organizes auth around three independent axes: **Account → Project → Workspace**.

- **Account** — _who_ is authenticating. Three first-class types managed through one surface: `service_account` (Basic Auth), `oauth_browser` (PKCE flow with auto-refreshed tokens), and `oauth_token` (static bearer for CI / agents).
- **Project** — _which_ Mixpanel project the calls run against. Lives on the active account as `default_project`; can be overridden per instance.
- **Workspace** — _which_ workspace inside the project. Optional; lazy-resolves to the project's default workspace on the first workspace-scoped call.

In-session switching is one line: `ws.use({ account, project, workspace, target })`. The underlying HTTP client and the per-account `/me` cache are preserved across switches, so cross-project / cross-account iteration is cheap.

## Quick start: `loginUnified()`

The fastest way to authenticate is `loginUnified` from `@mixpanel-headless/node`. It runs the right auth flow for your environment, derives an account name from `/me`, and pins a default project — all in one call:

```ts twoslash
import { loginUnified } from "@mixpanel-headless/node";

const summary = await loginUnified();
console.log(summary.name, summary.type, summary.region, summary.status);
```

Auth-type detection is env-driven:

1. Explicit `account_type`, `service_account: true` or `token_env: "VAR"` option.
2. `MP_USERNAME` + `MP_SECRET` set → `service_account`.
3. `MP_OAUTH_TOKEN` set → `oauth_token`.
4. Otherwise → `oauth_browser` (PKCE).

Region behaviour depends on the auth type:

- `service_account` and `oauth_token`: probes `us → eu → in` against `/me` and uses the first `200`.
- `oauth_browser`: defaults to `us` when `region` is not passed. EU and India users must pass `region: "eu"` or `region: "in"` explicitly (the PKCE flow commits to a single region before the post-login `/me` probe runs).

Useful options: `region` sets the region explicitly, `project` skips the picker, `name` overrides the derived name, `project_picker` resolves the multi-project case without a terminal, `no_browser` prints the authorize URL instead of opening a browser.

The rest of this page covers the underlying account model, env-var precedence, and the explicit setup paths for callers who want more control than `loginUnified` provides.

## Account types

| Type              | Best for                             | Storage                                              |
| ----------------- | ------------------------------------ | ---------------------------------------------------- |
| `service_account` | CI / scripts / unattended automation | `~/.mp/config.toml` (Basic Auth username + secret)   |
| `oauth_browser`   | Interactive personal use             | `~/.mp/accounts/{name}/tokens.json` (auto-refreshed) |
| `oauth_token`     | CI bots / agents (no browser)        | Inline secret **or** `token_env = "VAR"` indirection |

Service accounts are the right default for unattended automation. OAuth browser is the right default for personal, interactive use. OAuth token (static bearer) is the right default when a managed OAuth client (an agent harness, a CI pipeline) hands you a pre-obtained access token.

## Environment variables

`@mixpanel-headless/node` reads the same names as the Python library, with the same precedence. Every read happens at call time, never at module load, so a variable exported after the workspace exists still takes effect on the next request.

| Variable                    | Purpose                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `MP_USERNAME` / `MP_SECRET` | Service-account credentials (both required together; the quad also needs `MP_PROJECT_ID` + `MP_REGION`)      |
| `MP_PROJECT_ID`             | Project to query (digit string)                                                                              |
| `MP_REGION`                 | Data residency: `us`, `eu`, or `in`                                                                          |
| `MP_OAUTH_TOKEN`            | Pre-obtained static bearer token (the env-var path also needs `MP_PROJECT_ID` + `MP_REGION`)                 |
| `MP_WORKSPACE_ID`           | Optional workspace pin (positive integer)                                                                    |
| `MP_CONFIG_PATH`            | Override the config file location (default `~/.mp/config.toml`)                                              |
| `MP_OAUTH_STORAGE_DIR`      | Override the token storage root (default `~/.mp`)                                                            |
| `MP_AUTH_FILE`              | Path to a bridge credentials file — see [Bridge files](#bridge-files)                                        |
| `MP_API_BASE_URL`           | Route every API family at one alternate host — see [Alternate API host](#alternate-api-host-mp-api-base-url) |
| `MP_APP_BASE_URL`           | Optional: re-home only the App API family (`{app_base}/api/app`)                                             |

These map onto the [credential resolution chain](#credential-resolution-chain) below.

::: info Service-account env quad takes precedence over `MP_OAUTH_TOKEN`
If `MP_USERNAME` + `MP_SECRET` + `MP_PROJECT_ID` + `MP_REGION` are all set, the service-account quad wins even when `MP_OAUTH_TOKEN` is also present. This is safe to add to a shell that already exports the service-account variables.
:::

::: info Differences from the Python CLI's variable list
`MP_ACCOUNT` and `MP_TARGET` are CLI flag defaults, not library inputs — pass `createNodeWorkspace({ account })` / `{ target }` instead. The port reads the storage-root override as `MP_OAUTH_STORAGE_DIR`; if you share `~/.mp` with a newer Python CLI that spells it `MP_STORAGE_DIR`, export both.
:::

`@mixpanel-headless/core` never reads `process.env`; the environment is one of the injected resolver sources that `createNodeWorkspace()` wires. The browser package has no environment at all — every setting is an option.

## Alternate API host (`MP_API_BASE_URL`)

By default the client picks its hosts per region (`mixpanel.com`, `eu.mixpanel.com`, `in.mixpanel.com`, plus the `data*.mixpanel.com` export hosts). Set `MP_API_BASE_URL` to point **every** API family at one alternate host instead — a headless Mixpanel pod behind a single nginx front door, a local proxy, or an in-sandbox fake server:

```bash
export MP_API_BASE_URL=http://devbox:8080
export MP_USERNAME=... MP_SECRET=... MP_PROJECT_ID=... MP_REGION=us
```

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace();
await ws.events(); // → GET http://devbox:8080/api/query/events/names
```

When set (a trailing slash is tolerated), the region lookup is bypassed and the families resolve to fixed path prefixes on that base:

| API family                                               | URL under the override    | Live `us` equivalent                    |
| -------------------------------------------------------- | ------------------------- | --------------------------------------- |
| Query (`/insights`, `/segmentation`, `/events/names`, …) | `{base}/api/query`        | `https://mixpanel.com/api/query`        |
| Export (`streamEvents`)                                  | `{base}/api/2.0`          | `https://data.mixpanel.com/api/2.0`     |
| Engage (`queryUser`, `streamProfiles`)                   | `{base}/api/query/engage` | `https://mixpanel.com/api/query/engage` |
| App API (dashboards, cohorts, Lexicon, `/me`, …)         | `{base}/api/app`          | `https://mixpanel.com/api/app`          |

Details:

- **Read per request, not at construction.** `createNodeWorkspace()` wires a `process.env` reader that is consulted on every request, so `ws.use({ account })` swaps, long-lived processes, and test env patching all see the current value — the Python library's `os.environ` semantics. When you build a core client by hand, pass `clientOptions.endpointOverrides` yourself: a static `{ apiBaseUrl, appBaseUrl }` bag, or a provider such as `createNodeEndpointOverrides()` from `@mixpanel-headless/node`.
- **Route-aware behaviour is preserved.** The App-vs-Query read-timeout choice and the pinned `workspace_id` injection key off the API family, not the hostname.
- **`MP_REGION` is still required** and still meaningful for everything that is not a URL (account records, `/me` domain cross-checks, report-link hostnames). Report links keep producing real `*.mixpanel.com` URLs.
- **Login region probe.** Probing `us → eu → in` against one host is pointless, so under the override `loginUnified` probes once against the base and labels the account with `MP_REGION` (when it is `us`/`eu`/`in`) or `us`.
- **Plain `http://` bases are accepted** with no extra flag. They are intended for local or headless deployments only — never send real credentials over cleartext to a remote host.
- **`MP_APP_BASE_URL`** (optional) re-homes just the App API family at `{app_base}/api/app`. It works on its own (the other three families stay live) or on top of `MP_API_BASE_URL` (App API moves to the second host). With only `MP_APP_BASE_URL` set, the login probe still walks `us → eu → in` (each `/me` probe hits the App override base) because the region it persists still decides which live cluster the other families use.
- **Family detection is longest-prefix**, so split configs where one base sits under the other (for example `MP_API_BASE_URL=https://proxy` with `MP_APP_BASE_URL=https://proxy/api/query`) still classify every request correctly.
- **Browser builds** take the same setting through `clientOptions.endpointOverrides` on the factories (config only — there is no env). See [In the browser](/guide/browser#alternate-api-host).

With neither variable set, behaviour is byte-identical to the per-region defaults.

## Setting up an account

The `accounts` namespace from `@mixpanel-headless/node` is the programmatic twin of the CLI's `mp account …` commands; the [Accounts, sessions and targets](/guide/accounts-sessions-targets) guide covers the whole namespace.

### Service account (Basic Auth)

```ts twoslash
import { accounts } from "@mixpanel-headless/node";
declare const secret: string; // from your secret manager, never a literal
// ---cut---
await accounts.add("team", {
  type: "service_account",
  region: "us",
  default_project: "3018488",
  username: "team-mp.292e7c.mp-service-account",
  secret,
});

const probe = await accounts.test("team");
console.log(probe.ok, probe.accessible_project_count);
```

The first account added auto-promotes to active.

### OAuth (browser, PKCE)

The recommended path is `loginUnified` (see [above](#quick-start-loginunified)), which derives a name from `/me`. The browser path defaults to `us`; pass `region: "eu"` or `"in"` for other clusters:

```ts twoslash
import { loginUnified } from "@mixpanel-headless/node";

const summary = await loginUnified({ name: "personal", region: "us" });
```

Tokens land at `~/.mp/accounts/personal/tokens.json` (mode `0o600`) and refresh automatically before each call. The `default_project` is set from the post-login `/me` probe.

For full control over the account name and region at registration time, register first and run the PKCE flow second:

```ts twoslash
import { accounts } from "@mixpanel-headless/node";

await accounts.add("personal", { type: "oauth_browser", region: "us" });
const result = await accounts.login("personal"); // opens the browser
console.log(result.user?.["email"], result.expires_at);
```

### OAuth (static bearer / CI)

Pure env-var path — no persistent state:

```bash
export MP_OAUTH_TOKEN="ey..."
export MP_REGION=us
export MP_PROJECT_ID=3713224
```

Or register a named account that pulls the token from an env var at request time:

```ts twoslash
import { accounts } from "@mixpanel-headless/node";

await accounts.add("ci", {
  type: "oauth_token",
  token_env: "MP_CI_TOKEN",
  default_project: "3713224",
  region: "us",
});
accounts.use("ci");
```

Static bearers are never refreshed — pass a fresh token when the previous one expires.

## Config file

Persistent state lives in `~/.mp/config.toml` (mode `0o600`), with a single schema and four section types. The file is shared with the Python library's `mp` CLI, byte for byte:

```toml
[active]
account = "personal"
workspace = 3448414       # optional

[accounts.personal]
type = "oauth_browser"
region = "us"
default_project = "3713224"

[accounts.team]
type = "service_account"
region = "us"
default_project = "3018488"
username = "team-mp..."
secret = "..."

[accounts.ci]
type = "oauth_token"
region = "us"
default_project = "3713224"
token_env = "MP_CI_TOKEN"  # XOR with `token = "..."`

[targets.ecom]
account = "team"
project = "3018488"
workspace = 3448414
```

The `[active]` block stores only `account` and (optionally) `workspace` — the project lives on the active account as `default_project`. Targets are saved cursor positions (see [Saved targets](#saved-targets) below).

Config and token files are written atomically with owner-only permissions, and symlinked credential paths are refused (`CredentialPathError`). The default `~/.mp` directory is tightened to `0o700` on write; the parent of a custom `configPath` is left alone.

## OAuth (browser) — token storage

OAuth browser tokens are stored per account; OAuth client metadata (Dynamic Client Registration) is shared per region:

```
~/.mp/
├── config.toml                        # accounts, targets, [active]
├── accounts/
│   ├── personal/
│   │   ├── tokens.json                # access + refresh tokens (0o600)
│   │   └── me.json                    # cached /me response (0o600)
│   └── team/
│       └── me.json
└── oauth/
    ├── client_us.json                 # shared DCR client per region
    ├── client_eu.json
    └── client_in.json
```

Tokens auto-refresh on expiry. If the refresh token is rejected (for example revoked at the identity provider), the next call raises `OAuthError` with code `OAUTH_REFRESH_REVOKED` — re-run `loginUnified({ name })` to recover.

`accounts.token()` returns the current bearer for the active account (refreshing it if needed), for piping into another tool:

```ts twoslash
import { accounts } from "@mixpanel-headless/node";

const bearer = await accounts.token("personal");
const me = await fetch("https://mixpanel.com/api/app/me", {
  headers: { Authorization: `Bearer ${bearer}` },
});
```

## Credential resolution chain

When constructing a `Workspace`, each axis is resolved independently. The general chain is:

1. **Environment variables** — direct env reads inside the resolver.
2. **Constructor option** — `createNodeWorkspace({ account: "..." })`.
3. **Saved target** — `createNodeWorkspace({ target: "ecom" })`.
4. **Bridge file** — `MP_AUTH_FILE` or `~/.claude/mixpanel/auth.json`.
5. **Persisted active session** — the `[active]` block in `config.toml`.
6. **Account default** — `account.default_project` for the project axis.

Per-axis details:

- **Account** — the resolver reads the **service-account env quad** (`MP_USERNAME` + `MP_SECRET` + `MP_PROJECT_ID` + `MP_REGION`) and the **OAuth-token env triple** (`MP_OAUTH_TOKEN` + `MP_PROJECT_ID` + `MP_REGION`) directly. The quad wins over the triple. An explicit `account` option names a config-file account.
- **Project** — `MP_PROJECT_ID` is read directly (env layer), then the `project` option, then target, bridge, and finally the active account's `default_project`.
- **Workspace** — `MP_WORKSPACE_ID` is read directly (env layer), then the `workspace` option, then target, bridge, and `[active].workspace`.

There is **no silent cross-axis fallback**: switching the active account clears the workspace (workspaces are project-scoped), and a project does not carry forward to a new account. If an axis cannot be resolved, the resolver throws `ConfigError` listing every fix path rather than silently falling back to a default.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

// Default — resolve everything from env + config
const ws = createNodeWorkspace();

// Explicit per-axis overrides
const team = createNodeWorkspace({ account: "team", project: "3713224" });
const ecom = createNodeWorkspace({ target: "ecom" });
```

`target` is mutually exclusive with `account` / `project` / `workspace`; combining them throws `ParamValidationError` with code `WS1_TARGET_MUTUALLY_EXCLUSIVE`.

## Workspace axis (in-session switching)

Workspaces are project-scoped. Set the workspace via env var, constructor option, or `ws.use()`:

```bash
export MP_WORKSPACE_ID=3448414            # env-var override
```

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace({ workspace: 3448414 }); // at construction
await ws.use({ workspace: 3448414 }); // in-session switch (returns `this`)
await ws.use({ workspace: 3448414, persist: true }); // also write to [active]
```

If no workspace is specified, workspace-scoped endpoints lazy-resolve to the project's default workspace on first use.

## Saved targets

A **target** is a saved (account, project, optional workspace) bundle — a named cursor position you can apply in one call:

```ts twoslash
import { createNodeWorkspace, targets } from "@mixpanel-headless/node";

targets.add("ecom", {
  account: "team",
  project: "3018488",
  workspace: 3448414,
});
targets.list();

targets.use("ecom"); // writes [active] atomically

const ws = createNodeWorkspace({ target: "ecom" }); // apply at construction
await ws.use({ target: "ecom" }); // apply in-session
```

## Bridge files

The bridge is a v2 JSON file that lets a remote VM (or any environment without your `~/.mp/config.toml`) authenticate against Mixpanel using your host machine's account and tokens. It embeds the full account record (with secrets), optional OAuth tokens (for `oauth_browser` accounts), and optional pinned project / workspace / headers.

Default search order: `MP_AUTH_FILE` → `~/.claude/mixpanel/auth.json` → `./mixpanel_auth.json`. `createNodeWorkspace()` loads it at startup and, for `oauth_browser` bridges, materializes the tokens into the per-account `tokens.json` so the on-disk refresh keeps working.

```ts twoslash
import { accounts } from "@mixpanel-headless/node";

// On the host — write the bridge for the active account
const path = await accounts.exportBridge({
  to: "/home/me/.claude/mixpanel/auth.json",
});

// On the host — tear down
accounts.removeBridge();
```

In the VM, the bridge is auto-discovered, or point at it explicitly:

```bash
export MP_AUTH_FILE=/host/.claude/mixpanel/auth.json
```

## Data residency regions

Mixpanel stores data in regional data centers. Use the correct region for your project:

| Region         | Code | API endpoint      |
| -------------- | ---- | ----------------- |
| United States  | `us` | `mixpanel.com`    |
| European Union | `eu` | `eu.mixpanel.com` |
| India          | `in` | `in.mixpanel.com` |

::: warning Region mismatch
Using the wrong region results in authentication errors or empty data. The region lives on the account (`account.region`); change it with `accounts.update("team", { region: "eu" })`.
:::

## The `mp` command line

The TypeScript packages ship no CLI. Because the config file, token storage and environment variables are identical, the Python library's `mp` command (`pip install mixpanel-headless`) manages the same accounts, targets and sessions this port reads — `mp login`, `mp account list`, `mp target use`, `mp session`, and the rest are documented in the [Python CLI reference](https://mixpanel.github.io/mixpanel-headless/cli/).

## Next steps

- [Quick start](/getting-started/quickstart) — run your first queries
- [Accounts, sessions and targets](/guide/accounts-sessions-targets) — the full management namespaces
- [Error handling](/guide/error-handling) — `ConfigError`, `OAuthError` and their codes
