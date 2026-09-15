/**
 * `@mixpanel-headless/node` — what the Node runtime adds on top of
 * `@mixpanel-headless/core`: the TOML config file, per-account token
 * files, the localhost OAuth callback server, the Cowork bridge file
 * and `process.env` resolution.
 *
 * Core's auth surface is written against an injected {@link AuthEffects}
 * bag; this package supplies the real one ({@link createNodeAuthEffects})
 * and the ready-made `accounts` / `session` / `targets` namespaces plus
 * {@link loginUnified} over it (Python's `mp.accounts`, `mp.session`,
 * `mp.targets` and `mp.accounts.login_unified`).
 *
 * Freshness rule: every namespace method builds a fresh default bag at
 * call time, so `MP_CONFIG_PATH`, `MP_OAUTH_STORAGE_DIR` and
 * `MP_AUTH_FILE` are read when the call happens rather than when the
 * module loads (a load-time capture would defeat per-test env
 * isolation). Callers who want one pinned bag build it themselves with
 * {@link createNodeAuthEffects} and the core factories.
 *
 * @packageDocumentation
 */

import {
  type AccountsNamespace,
  type AccountSummary,
  type AuthEffects,
  createAccountsNamespace,
  createSessionNamespace,
  createTargetsNamespace,
  loginUnified as coreLoginUnified,
  type LoginUnifiedOptions,
  type SessionNamespace,
  type TargetsNamespace,
} from "@mixpanel-headless/core";

import { createNodeAuthEffects } from "./auth-effects.js";

export {
  createNodeAuthEffects,
  createNodeResolverSources,
  createNodeWorkspaceSources,
  type NodeAuthEffectsOptions,
  type NodeFlowSeams,
} from "./auth-effects.js";

// The zero-config `Workspace()` twin: sources, on-disk token resolver,
// on-disk MeCache and the `node:fs` read seam in one call.
export { createNodeWorkspace, type NodeWorkspaceOptions } from "./workspace.js";

// `MP_API_BASE_URL` / `MP_APP_BASE_URL` read per request from
// `process.env` — the node half of the alternate-host override (the core
// half is `MixpanelClientOptions.endpointOverrides`).
export {
  createNodeEndpointOverrides,
  createNodeEnv,
  type NodeEnv,
} from "./env.js";

// --- Facade re-export ---
// `import { Workspace } from "@mixpanel-headless/node"` is the documented
// Node entry; the class is core's, re-exported so a Node consumer needs one
// package.
export { Workspace, type WorkspaceOptions } from "@mixpanel-headless/core";

// --- Node platform classes ---
// The TOML config manager, the callback-server OAuth flow, on-disk token
// storage, the Cowork bridge file trio, the on-disk /me cache and the
// credential-path error.
export {
  type BridgeFile,
  defaultBridgeSearchPaths,
  exportBridge,
  type ExportBridgeOptions,
  loadBridge,
  parseBridgeFile,
  removeBridge,
  type RemoveBridgeOptions,
} from "./auth/bridge.js";
export type { StartCallbackServerOptions } from "./auth/callback-server.js";
export type { EnsureClientRegisteredOptions } from "./auth/client-registration.js";
export {
  findAvailablePort,
  type LoginOptions,
  OAuthFlow,
  type OAuthFlowOptions,
  type RefreshTokensOptions,
} from "./auth/flow.js";
export {
  accountDir,
  accountsRoot,
  ensureAccountDir,
  OAuthStorage,
  type OAuthStorageOptions,
  type StorageLogger,
  storageRoot,
} from "./auth/storage.js";
export {
  ConfigManager,
  type ConfigManagerOptions,
  type ConfigWriteBytes,
  type CustomHeaderParams,
  type ManagerClearActive,
  type ManagerSetActive,
  type RawConfig,
} from "./config.js";
export {
  type AtomicWriteFsOps,
  type AtomicWriteOptions,
  CredentialPathError,
  type StdinReadSync,
} from "./io-utils.js";
export {
  createNodeMeCacheEffects,
  MeCache,
  type MeCacheLogger,
  type MeCacheOptions,
} from "./me-cache.js";
export type { MeCacheStore } from "@mixpanel-headless/core";

/**
 * Build a fresh default bag (the call-time env read of the freshness rule).
 *
 * @returns The fully-wired node effects.
 */
function freshEffects(): AuthEffects {
  return createNodeAuthEffects();
}

/**
 * Build a ready-made namespace whose every method builds a fresh default
 * bag at call time and forwards to the core namespace built over it.
 *
 * @param factory - The core namespace factory.
 * @param methods - Every method name of the namespace, as a
 *   `Record<keyof T, true>` so a new core member is a compile error here
 *   rather than a silently missing wrapper.
 * @returns The namespace of call-time forwarders.
 */
function lazyNamespace<T extends object>(
  factory: (effects: AuthEffects) => T,
  methods: Record<keyof T, true>,
): T {
  const out: Record<string, unknown> = {};
  for (const name of Object.keys(methods)) {
    out[name] = (...args: unknown[]): unknown => {
      const namespace = factory(freshEffects());
      const member = Reflect.get(namespace, name) as (
        ...forwarded: unknown[]
      ) => unknown;
      return Reflect.apply(member, namespace, args);
    };
  }
  return out as T;
}

/** Ready-made `mp.accounts` twin over the default node bag. */
export const accounts: AccountsNamespace = lazyNamespace(
  createAccountsNamespace,
  {
    list: true,
    add: true,
    update: true,
    remove: true,
    use: true,
    show: true,
    test: true,
    login: true,
    logout: true,
    token: true,
    exportBridge: true,
    removeBridge: true,
    loginUnified: true,
  },
);

/** Ready-made `mp.session` twin over the default node bag. */
export const session: SessionNamespace = lazyNamespace(createSessionNamespace, {
  show: true,
  use: true,
});

/** Ready-made `mp.targets` twin over the default node bag. */
export const targets: TargetsNamespace = lazyNamespace(createTargetsNamespace, {
  list: true,
  add: true,
  remove: true,
  use: true,
  show: true,
});

/**
 * Log in (or refresh) an account over the default node bag — the engine
 * behind `mp login`.
 *
 * @param options - The login flags (region, credential kind, account
 *   name, browser opening); defaults mirror `mp login` with no flags.
 * @returns The new or refreshed account's summary.
 * @throws {@link ConfigError} | {@link AccountExistsError} |
 *   {@link OAuthError} | {@link InvalidArgumentError} - Per the core
 *   orchestrator's catalog.
 * @see mixpanel_headless.accounts.login_unified
 * @example
 * ```typescript
 * import { loginUnified } from "@mixpanel-headless/node";
 * const summary = await loginUnified({ region: "us" });
 * ```
 */
export function loginUnified(
  options: LoginUnifiedOptions = {},
): Promise<AccountSummary> {
  return coreLoginUnified(freshEffects(), options);
}
