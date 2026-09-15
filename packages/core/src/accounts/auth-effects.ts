/**
 * The effect bag behind the `accounts` / `session` / `targets`
 * namespaces: one member for every place the Python modules touch the
 * environment, the config file, the token store, the browser or stdin.
 * `core` performs none of that I/O itself — `@mixpanel-headless/node`
 * supplies the real bag, tests inject in-memory fakes, and
 * {@link defaultAuthEffects} ships throwing stand-ins coded
 * `UNPORTED_AUTH_SEAM` so an unwired member fails loudly.
 *
 * @see mixpanel_headless.accounts
 */

import type {
  Account,
  AccountType,
  Region,
  TokenResolver,
} from "../auth/account.js";
import type {
  BridgeView,
  ResolverConfigSource,
  ResolverEnv,
} from "../auth/resolver.js";
import type { Session } from "../auth/session.js";
import type { OAuthTokens } from "../auth/token.js";
import type { MeResponse } from "../client/me.js";
import { MixpanelHeadlessError } from "../errors.js";
import type { Secret } from "../secret.js";
import type { AccountSummary, Target } from "../types/entities/accounts.js";

/**
 * Fields accepted by {@link ConfigWrites.addAccount} — the
 * `ConfigManager.add_account` keyword surface.
 */
export interface AddAccountParams {
  /** Account discriminator (`service_account` / `oauth_browser` / `oauth_token`). */
  readonly type: AccountType;
  /** Mixpanel region. */
  readonly region: Region;
  /** Optional home project (digit string). */
  readonly default_project?: string | null | undefined;
  /** SA username (service_account only). */
  readonly username?: string | null | undefined;
  /** SA secret (service_account only). */
  readonly secret?: Secret | string | null | undefined;
  /** Inline bearer (oauth_token only; XOR with `token_env`). */
  readonly token?: Secret | string | null | undefined;
  /** Env-var name carrying the bearer (oauth_token only). */
  readonly token_env?: string | null | undefined;
}

/**
 * Fields accepted by {@link ConfigWrites.updateAccount} — the
 * `ConfigManager.update_account` keyword surface.
 * Absent/`undefined` members leave the field untouched.
 */
export interface UpdateAccountFields {
  /** New region. */
  readonly region?: Region | null | undefined;
  /** New home project (digit string). */
  readonly default_project?: string | null | undefined;
  /** New username (service_account only). */
  readonly username?: string | null | undefined;
  /** New secret (service_account only). */
  readonly secret?: Secret | string | null | undefined;
  /** New inline token (oauth_token only). */
  readonly token?: Secret | string | null | undefined;
  /** New env-var pointer (oauth_token only). */
  readonly token_env?: string | null | undefined;
}

/**
 * Per-axis update of the persisted `[active]` block — the
 * `ConfigManager.set_active` / `clear_active` composition the
 * namespaces drive as one transaction.
 *
 * An absent / `undefined` member leaves that axis untouched;
 * `workspace: null` clears `[active].workspace` (the account-swap clear
 * in `accounts.use` — both writes in a single transaction, never two).
 */
export interface SetActiveUpdate {
  /** New active account name (must reference an existing account). */
  readonly account?: string | undefined;
  /** New workspace pin; `null` clears the axis. */
  readonly workspace?: number | null | undefined;
}

/**
 * Atomic per-axis session update — the `ConfigManager.apply_session`
 * keyword surface. All axes land in one read-modify-write
 * transaction; `project` writes to the explicit
 * `account` (if given) else the persisted active account and raises a
 * coded `ConfigError` when neither resolves.
 */
export interface ApplySessionUpdate {
  /** New active account name. */
  readonly account?: string | null | undefined;
  /** New `default_project` for the target account. */
  readonly project?: string | null | undefined;
  /** New active workspace ID (mutually exclusive with `clear_workspace`). */
  readonly workspace?: number | null | undefined;
  /** When `true`, drop `[active].workspace`. */
  readonly clear_workspace?: boolean | undefined;
}

/** Options of {@link ConfigWrites.addTarget}. */
export interface AddTargetOptions {
  /** Referenced account name (must exist). */
  readonly account: string;
  /** Project ID (digit string). */
  readonly project: string;
  /** Optional workspace ID (positive int). */
  readonly workspace?: number | null | undefined;
}

/**
 * The config write surface the namespaces drive; the TOML
 * `ConfigManager` in `@mixpanel-headless/node` implements it.
 *
 * Every member is one `_mutate()` transaction in Python. In particular
 * {@link ConfigWrites.addAccount} promotes the first account to
 * `[active].account` inside the same transaction. In Python that
 * promotion belongs to the `accounts.add` namespace function
 * (`_apply_add_account` plus `_apply_set_active` under one `_mutate()`),
 * not to `ConfigManager.add_account`, which does not promote — an
 * implementor promotes exactly once, in its adapter transaction, and
 * keeps the underlying `ConfigManager` twin non-promoting.
 * {@link ConfigWrites.applyTarget} replaces `[active]` wholesale (a
 * target with no workspace clears any prior pin).
 *
 * @see mixpanel_headless._internal.config.ConfigManager
 */
export interface ConfigWrites {
  /**
   * Add an account block (validating per-type fields), promoting the
   * first-ever account to `[active].account` in the same transaction.
   *
   * @param name - Account name (`^[a-zA-Z0-9_-]{1,64}$`).
   * @param params - Typed credential fields.
   * @throws ConfigError - Duplicate name (a plain `ConfigError` /
   *   `CONFIG_ERROR` — never `AccountExistsError`, which Python reserves
   *   for the `login_unified` name collision), missing or incompatible
   *   fields, or validation failure.
   */
  addAccount: (name: string, params: AddAccountParams) => void;

  /**
   * Update fields on an existing account in place. Type cannot change.
   *
   * @param name - Account to update.
   * @param fields - Fields to rewrite.
   * @throws ConfigError - Missing account, type-incompatible field, or
   *   validation failure.
   */
  updateAccount: (name: string, fields: UpdateAccountFields) => void;

  /**
   * Remove an account, clearing `[active]` when it was the active one.
   *
   * @param name - Account to remove.
   * @param options - `force` removes even when targets reference it.
   * @returns Sorted names of targets that referenced the account.
   * @throws ConfigError - Missing account.
   * @throws AccountInUseError - Referenced and `force` not set.
   */
  removeAccount: (
    name: string,
    options?: { readonly force?: boolean },
  ) => string[];

  /**
   * List account summaries sorted by name, with `is_active` /
   * `referenced_by_targets` populated.
   *
   * @returns The summaries.
   */
  listAccounts: () => AccountSummary[];

  /**
   * Update `[active]` axes in one transaction (see
   * {@link SetActiveUpdate} for the per-axis semantics).
   *
   * @param update - The axes to touch.
   * @throws ConfigError - Unknown account or validation failure.
   */
  setActive: (update: SetActiveUpdate) => void;

  /**
   * Atomically apply per-axis session updates.
   *
   * @param update - The axes to touch.
   * @throws ConfigError - Unknown account, or `project` with no
   *   resolvable account.
   */
  applySession: (update: ApplySessionUpdate) => void;

  /**
   * Apply a target: `[active]` replaced wholesale and the target
   * account's `default_project` updated, in one transaction.
   *
   * @param name - Target to apply.
   * @throws ConfigError - Unknown target, or its account is gone.
   */
  applyTarget: (name: string) => void;

  /**
   * Add a target block.
   *
   * @param name - Target name.
   * @param options - account / project / workspace.
   * @returns The constructed {@link Target}.
   * @throws ConfigError - Duplicate name, missing account, or
   *   validation failure (Target model errors are wrapped in
   *   `ConfigError`, as Python does).
   */
  addTarget: (name: string, options: AddTargetOptions) => Target;

  /**
   * Remove a target block.
   *
   * @param name - Target to remove.
   * @throws ConfigError - Unknown target.
   */
  removeTarget: (name: string) => void;

  /**
   * List targets sorted by name.
   *
   * @returns The targets.
   */
  listTargets: () => Target[];
}

/**
 * The bridge-file effect surface (`load_bridge` / `export_bridge` /
 * `remove_bridge`).
 *
 * @see mixpanel_headless._internal.auth.bridge
 */
export interface BridgeEffects {
  /**
   * Load the v2 bridge file, if any.
   *
   * @returns The resolver view of the bridge, or `null`.
   */
  load: () => BridgeView | null;

  /**
   * Write a v2 bridge file (0o600) for the given account.
   *
   * @param options - Account + destination + optional pins.
   * @returns The path written (same as `options.to`).
   * @throws ConfigError - `BridgeFile` validation failure.
   * @throws OAuthError - `oauth_browser` account with no tokens.
   */
  export: (options: {
    readonly account: Account;
    readonly to: string;
    readonly project: string | null;
    readonly workspace: number | null;
    readonly headers: Readonly<Record<string, string>> | null;
    readonly tokenResolver: TokenResolver;
  }) => string | Promise<string>;

  /**
   * Remove the bridge file at `at` (or the default search paths).
   *
   * @param at - Explicit path, or `null` for the default chain.
   * @returns `true` if a file was deleted.
   */
  remove: (at: string | null) => boolean;
}

/**
 * The per-account token and artifact store (`ensure_account_dir` /
 * `atomic_write_bytes` / `_safe_rmtree_warn` / `_client_info_path`).
 * `writeTokens` returns the written path and `clientInfoPath` returns a
 * path rather than an existence flag because `OAuthLoginResult` reports
 * both; `removeTokens` backs `logout`.
 *
 * @see mixpanel_headless.accounts
 */
export interface TokenStore {
  /**
   * Read the persisted tokens for an account.
   *
   * @param name - Account name.
   * @returns The tokens, or `null` when none exist.
   */
  readTokens: (name: string) => OAuthTokens | null;

  /**
   * Persist tokens atomically at the per-account path (mode 0o600).
   *
   * @param name - Account name.
   * @param tokens - The tokens to write.
   * @returns The path written.
   */
  writeTokens: (name: string, tokens: OAuthTokens) => string;

  /**
   * Delete the persisted tokens if present (Python `logout`). A missing
   * file is a no-op.
   *
   * @param name - Account name.
   */
  removeTokens: (name: string) => void;

  /**
   * Remove the whole per-account directory, warning (never raising) on
   * failure (Python `_safe_rmtree_warn`).
   *
   * @param name - Account name.
   */
  removeAccountDir: (name: string) => void;

  /**
   * Where the DCR client info for `region` lives (Python
   * `_client_info_path`).
   *
   * @param region - Mixpanel region.
   * @returns Absolute path (may not exist yet).
   */
  clientInfoPath: (region: Region) => string;

  /**
   * Whether any per-account state exists for `name` — the
   * `account_dir(name).exists()` probe that guards the browser
   * new-account flow against an orphaned directory. The node store
   * checks `~/.mp/accounts/{name}/`; in-memory fakes report whether they
   * hold state for the name.
   *
   * @param name - Account name.
   * @returns `true` when the per-account directory (or fake state)
   *   exists.
   */
  accountDirExists: (name: string) => boolean;
}

/**
 * The PKCE browser-flow effect. Always called with `persist=False`
 * semantics: the returned tokens stay in memory until the orchestrator
 * validates and persists them via {@link TokenStore.writeTokens}.
 *
 * @see mixpanel_headless._internal.auth.flow.OAuthFlow.login
 */
export interface OAuthFlowEffects {
  /**
   * Run the PKCE login dance for a region.
   *
   * @param region - The region the flow commits to.
   * @param options - `openBrowser` mirrors Python's `open_browser`.
   * @returns The freshly minted tokens (not persisted).
   * @throws OAuthError - Any leg of the flow fails.
   */
  login: (
    region: Region,
    options: { readonly openBrowser: boolean },
  ) => Promise<OAuthTokens>;
}

/**
 * The per-account `/me` cache write.
 *
 * @see mixpanel_headless.accounts._persist_me_cache
 */
export interface MeCacheEffects {
  /**
   * Persist a `/me` response for the named account.
   *
   * @param accountName - Account whose cache to populate.
   * @param me - The parsed response.
   * @returns Nothing (a promise for asynchronous stores).
   */
  put: (accountName: string, me: MeResponse) => void | Promise<void>;
}

/**
 * The complete effect bag. `@mixpanel-headless/node` exports a fully
 * wired instance, tests inject in-memory fakes, and
 * {@link defaultAuthEffects} stubs every node-owned member.
 *
 * @remarks
 * Secret serialization: `Secret.toJSON()` returns the redaction mask, so
 * routing a `Secret`-bearing bag through `JSON.stringify` (or any
 * generic serializer) persists literal asterisks — credential corruption
 * discovered only at the next auth. Every credential writer
 * ({@link ConfigWrites.addAccount} / {@link ConfigWrites.updateAccount},
 * {@link TokenStore.writeTokens}, {@link BridgeEffects.export}) must call
 * `reveal()` at its write site.
 */
export interface AuthEffects {
  /** Config reads and writes (the TOML `ConfigManager` on node). */
  readonly config: ResolverConfigSource & ConfigWrites;
  /**
   * Env reads: the resolver's `MP_*` bag plus the generic `get` used by
   * `token_env` indirection, the `login_unified` auth-type detection and
   * the region probe. Node wires `process.env`.
   */
  readonly env: ResolverEnv & {
    /**
     * Read one environment variable.
     *
     * @param name - Variable name.
     * @returns The raw value, or `undefined` when unset.
     */
    get: (name: string) => string | undefined;
  };
  /** Per-account token/artifact store. */
  readonly tokenStore: TokenStore;
  /** On-disk token resolver twin; tests inject fakes. */
  readonly tokenResolver: TokenResolver;
  /** PKCE flow. */
  readonly oauthFlow: OAuthFlowEffects;
  /** Bridge load/export/remove. */
  readonly bridge: BridgeEffects;
  /** Per-account `/me` cache writes (on disk under node). */
  readonly meCache: MeCacheEffects;
  /**
   * Persist a session's axes to `[active]` in one transaction — the
   * `ConfigManager.apply_session` twin behind
   * `ResolverSeams.persistActive`. Core ships the routing
   * (`resolverSeamsFromEffects` in `resolver-seams.ts`); the write itself
   * belongs to the host package.
   *
   * @param session - The post-swap session.
   * @returns Nothing (a promise for asynchronous stores).
   */
  persistActive: (session: Session) => void | Promise<void>;
  /**
   * Read a secret from stdin — the `secret_stdin=True` paths of
   * `login_unified`
   * (`mixpanel_headless._internal.io_utils.read_capped_secret_from_stdin`).
   *
   * @returns The secret text.
   */
  readSecretStdin: () => string;
  /**
   * Single-line progress narration (Python `_narrate`, a stderr write).
   * The core default is a silent no-op — the messages are out of
   * contract — so this member is not in {@link UNPORTED_AUTH_SEAMS};
   * node wires `process.stderr`.
   *
   * @param msg - Single-line message (no trailing newline).
   */
  narrate: (msg: string) => void;
  /** The injected fetch every probe/client runs over (a core member, no stub). */
  readonly fetchImpl: typeof fetch;
  /**
   * Clock seam in epoch milliseconds (a core member, no stub).
   *
   * @returns The current time.
   */
  now: () => number;
}

/**
 * The members {@link defaultAuthEffects} stubs. `@mixpanel-headless/node`
 * implements every entry, and its test suite checks this list against
 * the real bag.
 */
export const UNPORTED_AUTH_SEAMS: readonly string[] = [
  "persistActive", // via config.applySession
  "config.*", // on-disk TOML writes/reads
  "env", // process.env wiring
  "tokenStore.*",
  "tokenResolver", // on-disk twin
  "oauthFlow.login", // PKCE
  "bridge.*",
  "meCache", // on-disk MeCache
  "readSecretStdin", // stdin read
];

/**
 * Build a member that throws the placeholder error for an unwired seam.
 *
 * @param name - The seam name (recorded in `details.seam`).
 * @returns A thunk that always throws.
 * @internal
 */
function unportedAuthSeam(name: string): (...args: unknown[]) => never {
  return (): never => {
    // Every `UNPORTED_AUTH_SEAMS` member is implemented in
    // `@mixpanel-headless/node` (`createNodeAuthEffects()`); this default
    // keeps core-alone use failing with a coded error rather than a bare
    // TypeError.
    throw new MixpanelHeadlessError(
      `Auth effect '${name}' has no implementation in @mixpanel-headless/core ` +
        "alone — pass a wired effect bag (packages/node: createNodeAuthEffects())",
      "UNPORTED_AUTH_SEAM",
      { seam: name },
    );
  };
}

/**
 * Property names a generic inspection touches on any object (thenable
 * probes, `util.inspect`, JSON) — never seams, so the throwing bags
 * answer `undefined` for them exactly like a plain object would.
 */
const NON_SEAM_PROPERTIES: ReadonlySet<string> = new Set([
  "then",
  "toJSON",
  "constructor",
]);

/**
 * A bag whose every method throws `UNPORTED_AUTH_SEAM` for
 * `${prefix}.${name}` when called.
 *
 * @param prefix - The seam-name prefix (`config`, `tokenStore`, ...).
 * @returns The throwing bag, typed as the seam interface it stands in for.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T is the seam interface the call site names; one Proxy handler stands in for every member (see doc)
function unportedMethodBag<T extends object>(prefix: string): T {
  // The Proxy answers every member name the interface declares (and only
  // string keys), so the cast is the whole point: one handler stands in
  // for each seam interface instead of a hand-enumerated stub per member.
  return new Proxy(Object.freeze({}), {
    get: (_target, property): unknown =>
      typeof property === "string" && !NON_SEAM_PROPERTIES.has(property)
        ? unportedAuthSeam(`${prefix}.${property}`)
        : undefined,
  }) as T;
}

/**
 * The default {@link AuthEffects} — every node-owned member throws
 * `UNPORTED_AUTH_SEAM` with `{seam: name}`; `narrate` is a silent
 * no-op; `fetchImpl` / `now` are the ambient web-standard globals (core
 * members, no stub).
 *
 * @returns The stubbed bag.
 * @example
 * ```typescript
 * const effects = { ...defaultAuthEffects(), config: myFakeConfig };
 * ```
 */
export function defaultAuthEffects(): AuthEffects {
  return {
    config: unportedMethodBag<AuthEffects["config"]>("config"),
    // `env.get` is a method; the `MP_*` members are property reads in the
    // resolver, so they throw on access rather than on call.
    env: new Proxy(Object.freeze({}), {
      get: (_target, property): unknown => {
        if (property === "get") {
          return unportedAuthSeam("env.get");
        }
        if (typeof property === "string" && property.startsWith("MP_")) {
          return unportedAuthSeam(`env.${property}`)();
        }
        return undefined;
      },
    }) as AuthEffects["env"],
    tokenStore: unportedMethodBag<AuthEffects["tokenStore"]>("tokenStore"),
    tokenResolver:
      unportedMethodBag<AuthEffects["tokenResolver"]>("tokenResolver"),
    oauthFlow: unportedMethodBag<AuthEffects["oauthFlow"]>("oauthFlow"),
    bridge: unportedMethodBag<AuthEffects["bridge"]>("bridge"),
    meCache: unportedMethodBag<AuthEffects["meCache"]>("meCache"),
    persistActive: unportedAuthSeam("persistActive"),
    readSecretStdin: unportedAuthSeam("readSecretStdin"),
    narrate: (): void => {
      // Out-of-contract stderr narration — silent in core.
    },
    fetchImpl: globalThis.fetch,
    now: (): number => Date.now(),
  };
}
