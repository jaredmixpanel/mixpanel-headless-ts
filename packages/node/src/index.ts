/**
 * @mixpanel-headless/node — Node-specific surface: TOML config,
 * token files, localhost OAuth callback, bridge file, env resolution.
 *
 * B8-N3 (b8-packets.md §4.1 row 5) turns the Phase-1 skeleton into the
 * ready-made public surface: `createNodeAuthEffects` (the real
 * {@link AuthEffects} bag), `createNodeResolverSources` (default
 * `ResolverSources` wiring — PURE bridge load),
 * `createNodeWorkspaceSources` (the `Workspace()` STARTUP wiring with
 * the bridge-token materialization side effect, `workspace.py`
 * — B8-ARB-A SEM-F1), and the `accounts` / `session` /
 * `targets` namespaces + `loginUnified` over the real bag — closing
 * the four Phase-2 `__all__` deferrals at node level (Python's
 * `mp.accounts` / `mp.session` / `mp.targets` /
 * `mp.accounts.login_unified`; the snake_case `login_unified` name
 * maps to `loginUnified` per the standard naming rules).
 *
 * Freshness rule: each namespace call builds a FRESH default bag so
 * `MP_CONFIG_PATH` / `MP_OAUTH_STORAGE_DIR` / `MP_AUTH_FILE` are read
 * at call time (packet §0.5 / §7 caution 16 — module-load env capture
 * would break test isolation). Callers wanting one pinned bag build it
 * themselves via {@link createNodeAuthEffects} and the core factories.
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

/** Package name constant exercised by the skeleton smoke test. */
export const NODE_PACKAGE_NAME = "@mixpanel-headless/node";

export {
  createNodeAuthEffects,
  createNodeResolverSources,
  createNodeWorkspaceSources,
  type NodeAuthEffectsOptions,
  type NodeFlowSeams,
} from "./auth-effects.js";

// QA 2026-08-17: the Python `Workspace()` zero-config twin — sources +
// on-disk token resolver + on-disk MeCache + node:fs read seam in one
// call (see workspace.ts header for why the pieces alone weren't
// enough).
export { createNodeWorkspace, type NodeWorkspaceOptions } from "./workspace.js";

// Python PR #235: `MP_API_BASE_URL` / `MP_APP_BASE_URL` read
// per request from `process.env` — the node half of the alternate-host
// override (the core half is `MixpanelClientOptions.endpointOverrides`).
export {
  createNodeEndpointOverrides,
  createNodeEnv,
  type NodeEnv,
} from "./env.js";

// ── Facade re-export ───────────────────────────────────────────────────
// `import { Workspace } from "@mixpanel-headless/node"` is the documented
// Node entry; the class is core's, re-exported so a Node consumer needs one
// package.
export { Workspace, type WorkspaceOptions } from "@mixpanel-headless/core";

// ── Node platform classes (CLEANUP-PLAN §7.4) ──────────────────────────
// Previously reachable only by deep path: the TOML config manager, the
// callback-server OAuth flow, on-disk token storage, the Cowork bridge
// file trio, the on-disk /me cache and the credential-path error.
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
export { CredentialPathError } from "./io-utils.js";
export {
  createNodeMeCacheEffects,
  MeCache,
  type MeCacheLogger,
  type MeCacheOptions,
} from "./me-cache.js";
export type { MeCacheStore } from "@mixpanel-headless/core";

/**
 * A fresh default bag (call-time env reads — module header).
 *
 * @returns The fully-wired node effects.
 */
function freshEffects(): AuthEffects {
  return createNodeAuthEffects();
}

/**
 * Build a ready-made namespace whose every method builds a FRESH default
 * bag at call time (module header freshness rule) and forwards to the
 * core namespace built over it.
 *
 * @param factory - The core namespace factory.
 * @param methods - Every method name of the namespace (`Record<keyof T,
 *   true>` so a new core member is a compile error here, not a silently
 *   missing wrapper).
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

/** Ready-made `mp.accounts` twin over the real node bag. */
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

/** Ready-made `mp.session` twin over the real node bag. */
export const session: SessionNamespace = lazyNamespace(createSessionNamespace, {
  show: true,
  use: true,
});

/** Ready-made `mp.targets` twin over the real node bag. */
export const targets: TargetsNamespace = lazyNamespace(createTargetsNamespace, {
  list: true,
  add: true,
  remove: true,
  use: true,
  show: true,
});

/**
 * Ready-made `mp.accounts.login_unified` twin over the real node bag
 * (`mp login`'s engine) — the fourth Phase-2 `__all__` deferral.
 *
 * @param options - The orchestrator flags.
 * @returns The new/refreshed account's summary.
 * @throws ConfigError | AccountExistsError | OAuthError |
 *   InvalidArgumentError - Per the core orchestrator's catalog.
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
