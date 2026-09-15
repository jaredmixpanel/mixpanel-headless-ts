/**
 * The node {@link AuthEffects} bag: every member of core's
 * `UNPORTED_AUTH_SEAMS` gets its real implementation here, composed
 * from the config, env, io-utils, storage, token-store, resolver,
 * bridge, MeCache and PKCE login-flow modules. Core's throwing defaults
 * stay in core; they document the core-alone posture.
 *
 * Every underlying module reads `process.env` at call time; the bag
 * itself pins nothing except the `ConfigManager` path, which Python also
 * resolves at construction. Build a fresh bag per logical operation when
 * env changes must be observed (the namespace exports in `index.ts` do).
 *
 * @see mixpanel_headless.accounts
 */

import type {
  AuthEffects,
  OAuthTokens,
  Region,
  ResolverSources,
  Session,
} from "@mixpanel-headless/core";
import {
  persistActiveToConfig,
  resolverSourcesFromEffects,
} from "@mixpanel-headless/core/internal";

import {
  bridgeViewFromFile,
  createNodeBridgeEffects,
  loadBridgeForStartup,
} from "./auth/bridge.js";
import { OAuthFlow, type OAuthFlowOptions } from "./auth/flow.js";
import type { StorageLogger } from "./auth/storage.js";
import { OnDiskTokenResolver } from "./auth/token-resolver.js";
import { createNodeTokenStore } from "./auth/token-store.js";
import { createNodeConfigSource } from "./config-writes.js";
import { createNodeEnv } from "./env.js";
import { readCappedSecretFromStdin, type StdinReadSync } from "./io-utils.js";
import { createNodeMeCacheEffects } from "./me-cache.js";

/**
 * The injectable login seams threaded into the {@link OAuthFlow} the
 * bag's `oauthFlow.login` builds; tests and the harness drive a full
 * fake login through the real bag with these.
 */
export type NodeFlowSeams = Pick<
  OAuthFlowOptions,
  | "openBrowser"
  | "startCallbackServer"
  | "registerClient"
  | "findAvailablePort"
  | "readStdinLine"
  | "stderr"
>;

/** Options bag of {@link createNodeAuthEffects}. */
export interface NodeAuthEffectsOptions {
  /**
   * Config file path override.
   *
   * @defaultValue `$MP_CONFIG_PATH` at bag construction, else `~/.mp/config.toml`
   */
  readonly configPath?: string | undefined;
  /**
   * Injected fetch.
   *
   * @defaultValue the global `fetch`
   */
  readonly fetchImpl?: typeof fetch | undefined;
  /**
   * Epoch-ms clock seam.
   *
   * @defaultValue the ambient clock
   */
  readonly now?: (() => number) | undefined;
  /**
   * Log sink for the warn-only storage paths.
   *
   * @defaultValue silent
   */
  readonly logger?: StorageLogger | undefined;
  /** Login-flow seam overrides (tests and the harness only). */
  readonly flowSeams?: NodeFlowSeams | undefined;
  /**
   * Injected stdin chunk reader for `readSecretStdin` (tests and the
   * harness only: a real fd-0 read blocks forever on a quiet pipe).
   *
   * @defaultValue the io-utils `fs.readSync` reader
   */
  readonly stdinReadSync?: StdinReadSync | undefined;
}

/**
 * Build the fully-wired node {@link AuthEffects} bag.
 *
 * @param options - Optional config path, fetch, clock and log seams.
 * @returns The bag, with every `UNPORTED_AUTH_SEAMS` member implemented.
 * @example
 * ```ts
 * const effects = createNodeAuthEffects();
 * const accounts = createAccountsNamespace(effects);
 * accounts.list();
 * ```
 */
export function createNodeAuthEffects(
  options: NodeAuthEffectsOptions = {},
): AuthEffects {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now;
  const logger = options.logger;
  const flowSeams = options.flowSeams ?? {};

  const config = createNodeConfigSource(
    options.configPath === undefined ? {} : { configPath: options.configPath },
  );

  return {
    config,
    env: createNodeEnv(),
    tokenStore: createNodeTokenStore(logger === undefined ? {} : { logger }),
    tokenResolver: new OnDiskTokenResolver({
      fetchImpl,
      ...(now === undefined ? {} : { now }),
    }),
    oauthFlow: {
      /**
       * Run the PKCE dance over the real {@link OAuthFlow}, always with
       * `persist: false`: the core orchestrator persists through
       * `TokenStore.writeTokens`. The flow (and therefore its default
       * `OAuthStorage`) is built per call so `MP_OAUTH_STORAGE_DIR` is
       * honoured at call time.
       *
       * @param region - The region the flow commits to.
       * @param loginOptions - Login flags; `openBrowser` decides whether
       *   the system browser is opened (Python's `open_browser` kwarg).
       * @returns The freshly minted tokens, not persisted.
       * @throws {@link OAuthError} - Any leg of the flow fails.
       */
      login: (
        region: Region,
        loginOptions: { readonly openBrowser: boolean },
      ): Promise<OAuthTokens> =>
        new OAuthFlow({
          region,
          fetchImpl,
          ...(now === undefined ? {} : { now }),
          ...flowSeams,
        }).login({ persist: false, openBrowser: loginOptions.openBrowser }),
    },
    bridge: createNodeBridgeEffects(),
    meCache: createNodeMeCacheEffects({
      ...(now === undefined ? {} : { now }),
      ...(logger === undefined ? {} : { logger }),
    }),
    /**
     * Persist a session's axes to `[active]` in one `applySession`
     * transaction — core's routing ({@link persistActiveToConfig})
     * bound to the on-disk config.
     *
     * @param session - The post-swap session.
     */
    persistActive: (session: Session): void => {
      persistActiveToConfig(config, session);
    },
    /**
     * Read a secret from stdin.
     *
     * @returns The stripped secret text.
     * @see mixpanel_headless._internal.io_utils.read_capped_secret_from_stdin
     */
    readSecretStdin: (): string =>
      readCappedSecretFromStdin(
        options.stdinReadSync === undefined
          ? {}
          : { readSync: options.stdinReadSync },
      ),
    /**
     * Write one line of progress narration to stderr; messages are out
     * of contract.
     *
     * @param msg - Single-line message (no trailing newline).
     * @see mixpanel_headless.accounts._narrate
     */
    narrate: (msg: string): void => {
      process.stderr.write(`${msg}\n`);
    },
    fetchImpl,
    now: now ?? ((): number => Date.now()),
  };
}

/**
 * Build the default node {@link ResolverSources} bag (env, on-disk
 * config and bridge file) — Python's `resolve_session(...)` defaults
 * (`config=ConfigManager()`, `bridge=load_bridge()`) made explicit. The
 * bridge is loaded at call time, so call this next to each
 * `resolveSession` use.
 *
 * @param options - Optional bag seams (see {@link NodeAuthEffectsOptions}).
 * @returns The injected-source bag for `resolveSession(...)`.
 * @example
 * ```ts
 * const session = resolveSession({}, createNodeResolverSources());
 * ```
 * @see mixpanel_headless._internal.auth.resolver.resolve_session
 */
export function createNodeResolverSources(
  options: NodeAuthEffectsOptions = {},
): ResolverSources {
  return resolverSourcesFromEffects(createNodeAuthEffects(options));
}

/**
 * Build the `Workspace()` startup sources: `load_bridge()` plus the
 * bridge-token materialization side effect (oauth_browser bridge tokens
 * are written to the per-account `tokens.json` so the
 * `OnDiskTokenResolver` can serve them downstream — the Cowork
 * credential-courier contract).
 *
 * @remarks
 * Python materializes only in the `Workspace()` constructor; every other
 * resolution (`use()` re-reads, the accounts/session/targets namespaces)
 * goes through the pure loader so a stale bridge payload never clobbers
 * tokens refreshed mid-session. Use this at facade construction and
 * {@link createNodeResolverSources} everywhere else. Sources alone do
 * not wire OAuth token refresh: an oauth_browser account constructed
 * this way fails its first query with `TokenResolver is required`.
 * Prefer `createNodeWorkspace()`, which composes sources, token
 * resolver, MeCache and `readFile`; use this factory directly only when
 * injecting a custom resolver via `clientOptions`.
 * @param options - Optional bag seams (see {@link NodeAuthEffectsOptions}).
 * @returns The injected-source bag for `new Workspace({ sources })`.
 * @throws {@link ConfigError} - Malformed bridge file.
 * @example
 * ```ts
 * const ws = new Workspace({
 *   sources: createNodeWorkspaceSources(),
 *   clientOptions: { tokenResolver: createNodeAuthEffects().tokenResolver },
 * });
 * ```
 * @see mixpanel_headless.workspace.Workspace.__init__
 */
export function createNodeWorkspaceSources(
  options: NodeAuthEffectsOptions = {},
): ResolverSources {
  const effects = createNodeAuthEffects(options);
  const bridge = loadBridgeForStartup();
  return {
    env: effects.env,
    config: effects.config,
    bridge: bridge === null ? null : bridgeViewFromFile(bridge),
  };
}
