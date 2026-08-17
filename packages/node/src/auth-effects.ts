/**
 * The real node {@link AuthEffects} bag — B8-N3 assembly
 * (b8-packets.md §4.1 row 5 / §4.4 seam-closure checklist): every
 * member of core's `UNPORTED_AUTH_SEAMS` gets its real node
 * implementation here, composed from the N1 (config / env / io-utils /
 * readFile), N2 (storage / token store / resolver / bridge / MeCache)
 * and N3 (PKCE login flow) modules. After this module, calling ANY
 * member of the node bag never throws `UNPORTED_AUTH_SEAM` /
 * `UNPORTED_RESOLVER_SEAM` (the `unportedAuthSeam` defaults STAY in
 * core — they document the core-alone posture).
 *
 * Owner map (packet §4.4): `config.*`/`env`/`readSecretStdin` — N1;
 * `tokenStore.*`/`tokenResolver`/`bridge.*`/`meCache` — N2;
 * `oauthFlow.login`/`persistActive`/`narrate` — N3 (this file).
 *
 * Env-read timing (packet §0.5 / §7 caution 16): every underlying
 * module reads `process.env` at CALL time; the bag itself pins nothing
 * except the `ConfigManager` path, which Python also resolves at
 * construction (`config.py:141-153`) — build a fresh bag per logical
 * operation when env changes must be observed (the ready-made
 * namespace exports in `index.ts` do exactly that).
 */

import type { AuthEffects } from "../../core/src/accounts/auth-effects.js";
import { persistActiveToConfig } from "../../core/src/accounts/resolver-seams.js";
import { resolverSourcesFromEffects } from "../../core/src/accounts/resolver-seams.js";
import type { Region } from "../../core/src/auth/account.js";
import type { ResolverSources } from "../../core/src/auth/resolver.js";
import type { Session } from "../../core/src/auth/session.js";
import type { OAuthTokens } from "../../core/src/auth/token.js";
import {
  bridgeViewFromFile,
  createNodeBridgeEffects,
  loadBridgeForStartup,
} from "./auth/bridge.js";
import { OAuthFlow, type OAuthFlowOptions } from "./auth/flow.js";
import type { StorageLogger } from "./auth/storage.js";
import { createNodeTokenStore } from "./auth/token-store.js";
import { OnDiskTokenResolver } from "./auth/token-resolver.js";
import { createNodeConfigSource } from "./config-writes.js";
import { createNodeEnv } from "./env.js";
import { readCappedSecretFromStdin, type StdinReadSync } from "./io-utils.js";
import { createNodeMeCacheEffects } from "./me-cache.js";

/**
 * The injectable login seams threaded into the {@link OAuthFlow} the
 * bag's `oauthFlow.login` builds (tests/harness drive a full fake
 * login through the REAL bag with these — packet §4.5 item 5).
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
   * Config file path override (else `$MP_CONFIG_PATH` at bag
   * construction, else `~/.mp/config.toml`).
   */
  readonly configPath?: string | undefined;
  /** Injected fetch (default: global fetch — R2.4). */
  readonly fetchImpl?: typeof fetch | undefined;
  /** Epoch-ms clock seam (default: ambient — D1.4). */
  readonly now?: (() => number) | undefined;
  /** Log sink for the warn-only storage paths (default silent, R9.5). */
  readonly logger?: StorageLogger | undefined;
  /** Login-flow seam overrides (tests/harness only). */
  readonly flowSeams?: NodeFlowSeams | undefined;
  /**
   * Injected stdin chunk reader for `readSecretStdin` (tests/harness
   * only — a REAL fd-0 read blocks forever on a quiet pipe; default:
   * the io-utils `fs.readSync` reader).
   */
  readonly stdinReadSync?: StdinReadSync | undefined;
}

/**
 * Build the fully-wired node {@link AuthEffects} bag.
 *
 * @param options - Optional config path / fetch / clock / log seams.
 * @returns The bag — every `UNPORTED_AUTH_SEAMS` member real.
 *
 * @example
 * ```typescript
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
    options.configPath !== undefined ? { configPath: options.configPath } : {},
  );

  return {
    config,
    env: createNodeEnv(),
    tokenStore: createNodeTokenStore(logger !== undefined ? { logger } : {}),
    tokenResolver: new OnDiskTokenResolver({
      fetchImpl,
      ...(now !== undefined ? { now } : {}),
    }),
    oauthFlow: {
      /**
       * The PKCE dance over the real {@link OAuthFlow} — ALWAYS
       * `persist: false` (the orchestrator persists via
       * `TokenStore.writeTokens`; B7 contract,
       * `auth-effects.ts:369-388`). The flow (and therefore its
       * default `OAuthStorage`) is built per call so env overrides
       * (`MP_OAUTH_STORAGE_DIR`) are honored at call time.
       *
       * @param region - The region the flow commits to.
       * @param loginOptions - `openBrowser` mirrors Python's kwarg.
       * @returns The freshly minted tokens (NOT persisted).
       * @throws OAuthError - Any leg of the flow fails.
       */
      login: (
        region: Region,
        loginOptions: { readonly openBrowser: boolean },
      ): Promise<OAuthTokens> =>
        new OAuthFlow({
          region,
          fetchImpl,
          ...(now !== undefined ? { now } : {}),
          ...flowSeams,
        }).login({ persist: false, openBrowser: loginOptions.openBrowser }),
    },
    bridge: createNodeBridgeEffects(),
    meCache: createNodeMeCacheEffects({
      ...(now !== undefined ? { now } : {}),
      ...(logger !== undefined ? { logger } : {}),
    }),
    /**
     * Persist a session's axes to `[active]` in ONE `applySession`
     * transaction — the core-shipped routing
     * ({@link persistActiveToConfig}) bound to the on-disk config
     * (`b6-packets.md:1026` closure; the `UNPORTED_RESOLVER_SEAM`
     * residue of `lifecycle.ts` is closed by this member).
     *
     * @param session - The post-swap session.
     */
    persistActive: (session: Session): void => {
      persistActiveToConfig(config, session);
    },
    /**
     * Read a secret from stdin (`read_capped_secret_from_stdin` — the
     * N1 io-utils twin).
     *
     * @returns The stripped secret text.
     */
    readSecretStdin: (): string =>
      readCappedSecretFromStdin(
        options.stdinReadSync !== undefined
          ? { readSync: options.stdinReadSync }
          : {},
      ),
    /**
     * Single-line progress narration (`_narrate`,
     * `accounts.py:132-148`) — a stderr write; messages are out of
     * contract (R5.4).
     *
     * @param msg - Single-line message (no trailing newline).
     */
    narrate: (msg: string): void => {
      process.stderr.write(`${msg}\n`);
    },
    fetchImpl,
    now: now ?? ((): number => Date.now()),
  };
}

/**
 * Build the default node {@link ResolverSources} bag (env + on-disk
 * config + bridge file) — the Python `resolve_session(...)` defaults
 * (`config=ConfigManager()` / `bridge=load_bridge()`,
 * `resolver.py:407-408`) made explicit for node (packet §4.1 row 5:
 * closes the Phase-2 `__all__` default-wiring deferral). The bridge is
 * loaded AT CALL TIME — call this next to each `resolveSession` use.
 *
 * @param options - Optional bag seams (see
 *   {@link NodeAuthEffectsOptions}).
 * @returns The injected-source bag for `resolveSession(...)`.
 *
 * @example
 * ```typescript
 * const session = resolveSession({}, createNodeResolverSources());
 * ```
 */
export function createNodeResolverSources(
  options: NodeAuthEffectsOptions = {},
): ResolverSources {
  return resolverSourcesFromEffects(createNodeAuthEffects(options));
}

/**
 * Build the `Workspace()` STARTUP sources — the `workspace.py:476-513`
 * constructor sequence: `load_bridge()` PLUS the bridge-token
 * materialization side effect (oauth_browser bridge tokens are written
 * to the per-account `tokens.json` so the `OnDiskTokenResolver` can
 * serve them downstream — the Cowork credential-courier contract).
 *
 * Split rationale (B8-N2-notes.md disclosure #1 / B8-ARB-A SEM-F1,
 * `b8-reviewA-resolution.md`): Python materializes ONLY in the
 * `Workspace()` constructor; every other resolution (`use()` re-reads,
 * the accounts/session/targets namespaces) goes through the PURE
 * loader so a stale bridge payload never clobbers tokens refreshed
 * mid-session. Use THIS at facade construction and
 * {@link createNodeResolverSources} everywhere else.
 *
 * @param options - Optional bag seams (see
 *   {@link NodeAuthEffectsOptions}).
 * @returns The injected-source bag for `new Workspace({ sources })`.
 * @throws ConfigError - Malformed bridge file.
 *
 * @example
 * ```typescript
 * const ws = new Workspace({ sources: createNodeWorkspaceSources() });
 * ```
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
