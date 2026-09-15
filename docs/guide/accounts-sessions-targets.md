---
title: Accounts, sessions and targets
description: The Node.js management namespaces — accounts, session and targets — over the ~/.mp/config.toml shared with the Python mp CLI, plus per-instance axis switching with ws.use().
---

# Accounts, sessions and targets

::: warning Node.js only
The `accounts`, `session` and `targets` namespaces read and write `~/.mp/config.toml` and the token files under `~/.mp`, so they live in `@mixpanel-headless/node`. The browser package has no config file; see [In the browser](/guide/browser).
:::

`@mixpanel-headless/node` ships three ready-made management namespaces backed by `~/.mp/config.toml` — the same file the Python library's `mp` CLI uses, so `mp account list` and `accounts.list()` see the same accounts. They are the twins of Python's `mp.accounts`, `mp.session` and `mp.targets`:

```ts twoslash
import { accounts, session, targets } from "@mixpanel-headless/node";

accounts.list(); // all configured accounts
await accounts.test(); // probe /me for the active account
accounts.use("staging"); // switch the active account
await accounts.token(); // valid bearer token (auto-refreshed)

session.show(); // the persisted [active] block
session.use({ project: "67890" }); // repin the active project

targets.add("prod", { account: "team", project: "12345" });
targets.use("prod"); // apply all three axes atomically
```

Methods that only touch the config file are synchronous. Methods that reach the network (`test`, `login`, `loginUnified`) or the token store (`token`, `exportBridge`) return a `Promise`.

Every call reads `MP_CONFIG_PATH`, `MP_OAUTH_STORAGE_DIR` and `MP_AUTH_FILE` when it happens rather than when the module loads, so switching the config path mid-process takes effect on the next call. Callers who want one pinned configuration build their own effect bag with `createNodeAuthEffects({ configPath })` and the core namespace factories (`createAccountsNamespace`, `createSessionNamespace`, `createTargetsNamespace`).

## The account model

An **account** is _who_ authenticates. Three types, one surface:

| Type              | Credential                           | Where it lives                                                                      |
| ----------------- | ------------------------------------ | ----------------------------------------------------------------------------------- |
| `service_account` | Basic Auth username + secret         | `[accounts.NAME]` in `config.toml`                                                  |
| `oauth_browser`   | PKCE tokens, refreshed automatically | `~/.mp/accounts/NAME/tokens.json`                                                   |
| `oauth_token`     | Static bearer                        | Inline `token = "…"` **or** `token_env = "VAR"` (read from the env at request time) |

Each account carries a `region` and a `default_project`. The `[active]` block names the current account and an optional workspace; the project comes from the active account. The full file format is in [Configuration → Config file](/getting-started/configuration#config-file).

## `accounts`

### Adding accounts

```ts twoslash
import { accounts } from "@mixpanel-headless/node";
declare const secret: string; // from your secret manager, never a literal
// ---cut---
// Service account
await accounts.add("team", {
  type: "service_account",
  region: "us",
  default_project: "3018488",
  username: "team-mp.292e7c.mp-service-account",
  secret,
});

// OAuth browser account — register, then run the PKCE flow
await accounts.add("personal", { type: "oauth_browser", region: "us" });
const login = await accounts.login("personal"); // OAuthLoginResult
console.log(login.user?.["email"], login.expires_at);

// Static bearer read from an env var at request time
await accounts.add("ci", {
  type: "oauth_token",
  token_env: "MP_CI_TOKEN",
  default_project: "3713224",
  region: "us",
});
```

`add` returns the new account's `AccountSummary`. The first account added auto-promotes to active. `region` is required for non-browser types; pass `derive_name: true` with `name: null` to have the name derived from `/me` instead of choosing one. Adding a name that already exists throws `AccountExistsError` (`ACCOUNT_EXISTS`).

The one-call alternative for interactive use is `loginUnified`, which detects the auth type from the environment, probes the region, derives the name and pins a project — see [Configuration → Quick start](/getting-started/configuration#quick-start-loginunified). It is also reachable as `accounts.loginUnified()`.

### Listing, inspecting and switching

```ts twoslash
import { accounts } from "@mixpanel-headless/node";

for (const s of accounts.list()) {
  // AccountSummary[]
  console.log(s.name, s.type, s.region, s.status, s.is_active ? "*" : "");
}

const active = accounts.show(); // the active account (or pass a name)
accounts.use("team"); // switch; clears the active workspace
```

`AccountSummary` carries `name`, `type`, `region`, `status` (`"ok"`, `"needs_login"`, `"needs_token"` or `"untested"`), `is_active`, `referenced_by_targets` and `user_email`. Switching accounts clears the workspace axis because workspaces are project-scoped; the project follows the new account's `default_project`. Naming an unknown account throws `AccountNotFoundError` (`ACCOUNT_NOT_FOUND`) listing the `availableAccounts`.

### Probing and tokens

```ts twoslash
import { accounts } from "@mixpanel-headless/node";

const probe = await accounts.test("team"); // AccountTestResult — never throws
if (probe.ok) {
  console.log(probe.user?.["email"], probe.accessible_project_count);
} else {
  console.log(probe.error_code, probe.error);
}

const bearer = await accounts.token("personal"); // string | null
```

`test` hits `/me` and reports rather than throws: `ok`, `user`, `accessible_project_count`, and on failure `error`, `error_code` and `error_details` — the same shape as a serialized library error. `token` returns a valid bearer for OAuth accounts (refreshing an `oauth_browser` token first when it is about to expire) and `null` for a service account, which has no bearer.

### Updating, logging out and removing

```ts twoslash
import { accounts } from "@mixpanel-headless/node";

accounts.update("team", { region: "eu", default_project: "4400012" });
accounts.logout("personal"); // delete the on-disk tokens (oauth_browser only)
const orphaned = accounts.remove("ci", { force: true }); // targets that referenced it
```

`update` rewrites the given fields in place; the type cannot change. `remove` refuses to delete an account that saved targets still reference (`AccountInUseError`, `ACCOUNT_IN_USE`, with `referencedBy`) unless `force` is set, in which case it returns the names of the now-orphaned targets.

### Token refresh and revocation

`oauth_browser` tokens refresh automatically before each call. If the refresh token is rejected upstream, the next call throws `OAuthError` with code `OAUTH_REFRESH_REVOKED`; run `loginUnified({ name })` or `accounts.login(name)` again to recover. `oauth_token` accounts are never refreshed — rotate the value behind `token_env` yourself.

## `session`

The session namespace is the persisted `[active]` block:

```ts twoslash
import { session } from "@mixpanel-headless/node";

const active = session.show(); // { account, workspace }
session.use({ account: "team", project: "3018488" });
session.use({ workspace: 3448414 });
session.use({ target: "ecom" }); // all three axes from [targets.ecom]
```

`show()` returns `account` and `workspace`; the project lives on the active account as `default_project`, which `use({ project })` rewrites. All updates land in one atomic write. `target` is mutually exclusive with the other keys — combining them throws `ParamValidationError` with code `WS1_TARGET_MUTUALLY_EXCLUSIVE`; an unknown account or target, or `project` with no active account, throws `ConfigError`.

## `targets`

A **target** is a saved (account, project, optional workspace) triple — a named cursor position you can apply in one call:

```ts twoslash
import { targets } from "@mixpanel-headless/node";

const ecom = targets.add("ecom", {
  account: "team",
  project: "3018488",
  workspace: 3448414,
});

for (const t of targets.list()) {
  // Target[], sorted by name
  console.log(t.name, t.account, t.project, t.workspace);
}

targets.show("ecom");
targets.use("ecom"); // writes all three axes to [active] atomically
targets.remove("ecom");
```

`add` requires an existing account; `use` fails with `ConfigError` if the target or its account is gone. Targets can also be applied without persisting anything: `createNodeWorkspace({ target: "ecom" })` at construction, or `ws.use({ target: "ecom" })` in-session.

## Per-instance axes: `ws.use()`

Workspaces pin axes per instance, without touching the persisted session. `ws.use()` swaps any axis in place, keeps the HTTP client (and its connection pool), and returns `this` for chaining:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace({ account: "team", project: "12345" });

await ws.use({ project: "67890" }); // repoint this instance
await ws.use({ workspace: 3448414 }); // pin App-API and Query-host scoping
await ws.use({ target: "ecom" }); // all three axes at once
await ws.use({ account: "other", persist: true }); // …or persist the switch

// Iterate across every project the account can see
for (const project of await ws.projects()) {
  await ws.use({ project: project.id });
  console.log(project.name, (await ws.events()).length);
}
```

`persist: true` writes the new state to `[active]` (and `default_project`) exactly as `session.use()` would. An `account` swap that resolves no project throws `ConfigError`. The current axes are readable as `ws.account`, `ws.project` and `ws.workspace`; `ws.session` is the resolved whole.

## Bridge files

A bridge is a JSON file that carries an account (with secrets), its OAuth tokens and optional pinned axes to an environment that has no `~/.mp` of its own — a remote VM or a sandbox. Write it on the host, point the guest at it with `MP_AUTH_FILE`, and `createNodeWorkspace()` resolves through it:

```ts twoslash
import { accounts } from "@mixpanel-headless/node";

// Host: export the active account (or name one) with a pinned project
const path = await accounts.exportBridge({
  to: "/home/me/.claude/mixpanel/auth.json",
  account: "personal",
  project: "3713224",
});

// Host: tear it down (the path defaults to $MP_AUTH_FILE, then the search paths)
const removed = accounts.removeBridge();
```

Default discovery order on the guest is `MP_AUTH_FILE` → `~/.claude/mixpanel/auth.json` → `./mixpanel_auth.json`. For `oauth_browser` bridges the tokens are materialized into the guest's per-account `tokens.json` at startup so refresh keeps working there. The lower-level pieces — `loadBridge`, `parseBridgeFile`, `exportBridge`, `removeBridge`, `defaultBridgeSearchPaths` — are exported from `@mixpanel-headless/node` for custom wiring.

## Composing your own wiring

The namespaces are thin: each builds a fresh `AuthEffects` bag with `createNodeAuthEffects()` and forwards to the core factory. When you need a pinned config path, a custom logger, an injected `fetch` or a frozen clock, build the bag once and construct the namespaces and the workspace over it:

```ts twoslash
import {
  createAccountsNamespace,
  createSessionNamespace,
  createTargetsNamespace,
} from "@mixpanel-headless/core";
import {
  createNodeAuthEffects,
  createNodeWorkspace,
} from "@mixpanel-headless/node";

const effects = createNodeAuthEffects({
  configPath: "/srv/app/mp/config.toml",
});
const accounts = createAccountsNamespace(effects);
const session = createSessionNamespace(effects);
const targets = createTargetsNamespace(effects);

const ws = createNodeWorkspace({ configPath: "/srv/app/mp/config.toml" });
```

`ConfigManager` (the TOML file), `OAuthFlow` (the loopback-callback PKCE flow), `OAuthStorage` (per-account token files) and `MeCache` (the on-disk `/me` cache) are exported too, for callers who assemble the pieces themselves.

## Next steps

- [Configuration](/getting-started/configuration) — environment variables, the resolution chain and the file layout
- [Error handling](/guide/error-handling) — `ConfigError` and `OAuthError` codes
- [Coming from the Python library?](/guide/coming-from-python) — `mp.accounts` → `accounts`
