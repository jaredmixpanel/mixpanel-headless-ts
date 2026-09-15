/**
 * `AuthEffects` — the B7-defined interface bag for every node effect in
 * `accounts.py` / `session.py` / `targets.py` (B7-A1 packet §3.2,
 * `b7-packets.md`).
 *
 * R9.4 posture: `packages/core` reads NO env vars and does NO disk /
 * browser / stdin I/O. Every such touch in the Python namespaces
 * becomes a member of this bag; B8 (`packages/node`) implements the
 * real thing, and {@link defaultAuthEffects} ships throwing stubs coded
 * `UNPORTED_AUTH_SEAM` (the W1 `unportedSeam` pattern,
 * `workspace-members/lifecycle.ts:111-122`). The committed
 * {@link UNPORTED_AUTH_SEAMS} constant is the named still-stubbed list
 * the B8 packet consumes BY NAME.
 *
 * SECRET SERIALIZATION RULE for implementors (B7-ARB-B CRED-F3,
 * `b7-reviewB-resolution.md`): `Secret.toJSON()` returns the redaction
 * mask, so routing a `Secret`-bearing bag through `JSON.stringify` (or
 * any generic serializer) PERSISTS literal asterisks — silent
 * credential corruption discovered only at next auth. Every on-disk
 * credential writer ({@link ConfigWrites} members taking
 * {@link AddAccountParams} / {@link UpdateAccountFields},
 * {@link TokenStore.writeTokens}, {@link BridgeEffects.export}) MUST
 * call `reveal()` at its designated write site — the in-memory fakes
 * demonstrate the pattern (`test/accounts/fake-auth-effects.ts`
 * `accountToRaw` / `toText`). B8 adds a Layer-3 write→read round-trip
 * lock over a `Secret`-bearing account.
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
 * namespaces drive as ONE transaction.
 *
 * Semantics (`config.py` + `accounts.py`): an absent /
 * `undefined` member leaves that axis untouched; `workspace: null`
 * CLEARS `[active].workspace` (the `accounts.use` account-swap clear —
 * both writes in a single transaction, never two).
 */
export interface SetActiveUpdate {
  /** New active account name (must reference an existing account). */
  readonly account?: string | undefined;
  /** New workspace pin; `null` clears the axis. */
  readonly workspace?: number | null | undefined;
}

/**
 * Atomic per-axis session update — the `ConfigManager.apply_session`
 * keyword surface (`config.py`). All axes land in ONE
 * read-modify-write transaction; `project` writes to the explicit
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
 * The config WRITE surface the namespaces drive — B8's TOML
 * `ConfigManager` implements it (packet §3.2 row 1, owner B8-N1).
 *
 * Transaction contract: every member is ONE `_mutate()` transaction in
 * Python. In particular {@link addAccount} auto-promotes the FIRST
 * account to `[active].account` inside the same transaction (FR-045).
 * Layering note (B7-ARB-B B-E2E-N1, `b7-reviewB-resolution.md`): that
 * promotion belongs to the `accounts.add` NAMESPACE transaction
 * (`accounts.py:472-489` — `_apply_add_account` + first-account
 * `_apply_set_active` under one `_mutate()`), NOT to
 * `ConfigManager.add_account` itself, which does not promote. B8-N1
 * must implement the promotion exactly ONCE — in its `ConfigWrites`
 * adapter transaction — and keep the underlying `ConfigManager` twin
 * non-promoting (`test_config.py`'s `add_account` asserts are the lock
 * for that layer). {@link applyTarget} replaces `[active]` wholesale
 * (a target with no workspace clears any prior pin,
 * `config.py:951-1002`).
 */
export interface ConfigWrites {
  /**
   * Add an account block (validating per-type fields), promoting the
   * first-ever account to `[active].account` in the SAME transaction.
   *
   * @param name - Account name (`^[a-zA-Z0-9_-]{1,64}$`).
   * @param params - Typed credential fields.
   * @throws ConfigError - Duplicate name (PLAIN `ConfigError` /
   *   CONFIG_ERROR, `config.py` — never `AccountExistsError`,
   *   which Python reserves for the login_unified name-collision path,
   *   `accounts.py`; B7-ARB-B B-E2E-F1), missing/incompatible
   *   fields, or validation failure.
   */
  addAccount: (name: string, params: AddAccountParams) => void;

  /**
   * Update fields on an existing account in place
   * (`config.py`). Type cannot change.
   *
   * @param name - Account to update.
   * @param fields - Fields to rewrite.
   * @throws ConfigError - Missing account, type-incompatible field, or
   *   validation failure.
   */
  updateAccount: (name: string, fields: UpdateAccountFields) => void;

  /**
   * Remove an account (`config.py`), clearing `[active]` when
   * it was the active one.
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
   * List account summaries sorted by name (`config.py`), with
   * `is_active` / `referenced_by_targets` populated.
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
   * Atomically apply per-axis session updates
   * (`config.py`).
   *
   * @param update - The axes to touch.
   * @throws ConfigError - Unknown account, or `project` with no
   *   resolvable account.
   */
  applySession: (update: ApplySessionUpdate) => void;

  /**
   * Apply a target: `[active]` replaced wholesale + the target
   * account's `default_project` updated, one transaction
   * (`config.py`).
   *
   * @param name - Target to apply.
   * @throws ConfigError - Unknown target OR its account is gone.
   */
  applyTarget: (name: string) => void;

  /**
   * Add a target block (`config.py`).
   *
   * @param name - Target name.
   * @param options - account / project / workspace.
   * @returns The constructed {@link Target}.
   * @throws ConfigError - Duplicate name, missing account, or
   *   validation failure (Target model errors are WRAPPED in
   *   ConfigError as `config.py` does).
   */
  addTarget: (name: string, options: AddTargetOptions) => Target;

  /**
   * Remove a target block (`config.py`).
   *
   * @param name - Target to remove.
   * @throws ConfigError - Unknown target.
   */
  removeTarget: (name: string) => void;

  /**
   * List targets sorted by name (`config.py`).
   *
   * @returns The targets.
   */
  listTargets: () => Target[];
}

/**
 * The bridge effect surface (`bridge.py` `load_bridge` /
 * `export_bridge` / `remove_bridge` — packet §3.2, owner B8-N2).
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
 * The per-account token/artifact store (`ensure_account_dir` /
 * `atomic_write_bytes` / `_safe_rmtree_warn` / `_client_info_path`,
 * `accounts.py:878-915`, `:278-303` — packet §3.2, owner B8-N2).
 *
 * Shape note (disclosed, shard notes): the packet's indicative member
 * list spelled `clientInfoExists(region)`; the Python behavior needs
 * the PATHS (for `OAuthLoginResult.tokens_path` / `client_path`) and a
 * `removeTokens` for `logout` — so `writeTokens` returns the written
 * path, `clientInfoPath` replaces the boolean probe, and `removeTokens`
 * is added. B8 implements this exact surface.
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
   * Delete the persisted tokens if present (`logout`,
   * `accounts.py`). Missing file is a no-op.
   *
   * @param name - Account name.
   */
  removeTokens: (name: string) => void;

  /**
   * Remove the whole per-account directory, warning (never raising) on
   * failure (`_safe_rmtree_warn`, `accounts.py`).
   *
   * @param name - Account name.
   */
  removeAccountDir: (name: string) => void;

  /**
   * Where the DCR client info for `region` lives
   * (`_client_info_path`, `accounts.py`).
   *
   * @param region - Mixpanel region.
   * @returns Absolute path (may not exist yet).
   */
  clientInfoPath: (region: Region) => string;

  /**
   * Whether ANY per-account state exists for `name` — the
   * `account_dir(name).exists()` orphan-directory probe guarding the
   * browser new-account flow (`accounts.py`; added by the
   * pair-A arbiter, `b7-reviewA-resolution.md` SEM-F2). B8 checks the
   * on-disk `~/.mp/accounts/{name}/` directory; in-memory fakes report
   * whether they hold state for the name.
   *
   * @param name - Account name.
   * @returns `true` when the per-account directory (or fake state)
   *   exists.
   */
  accountDirExists: (name: string) => boolean;
}

/**
 * The PKCE browser-flow effect (`OAuthFlow.login`, `flow.py` — packet
 * §3.2, owner B8-N3). Always called with `persist=False` semantics: the
 * returned tokens stay in memory until the orchestrator validates and
 * persists them via {@link TokenStore.writeTokens}.
 */
export interface OAuthFlowEffects {
  /**
   * Run the PKCE login dance for a region.
   *
   * @param region - The region the flow commits to.
   * @param options - `openBrowser` mirrors Python's `open_browser`.
   * @returns The freshly minted tokens (NOT persisted).
   * @throws OAuthError - Any leg of the flow fails.
   */
  login: (
    region: Region,
    options: { readonly openBrowser: boolean },
  ) => Promise<OAuthTokens>;
}

/**
 * The per-account `/me` cache write (`_persist_me_cache`,
 * `accounts.py` — packet §3.2, owner B8-N2 for the on-disk
 * twin).
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
 * The complete effect bag. B8 exports a fully-wired instance; B7 tests
 * inject in-memory fakes; {@link defaultAuthEffects} stubs the
 * B8-owned members.
 */
export interface AuthEffects {
  /** Config reads + writes (B8-N1: the TOML `ConfigManager`). */
  readonly config: ResolverConfigSource & ConfigWrites;
  /**
   * Env reads: the resolver's `MP_*` bag plus the generic `get` used by
   * `token_env` indirection and the `login_unified` auth-type detection
   * (`accounts.py`, `region_probe.py`). B8 wires `process.env`.
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
  /** Per-account `/me` cache writes (B8-N2 on disk). */
  readonly meCache: MeCacheEffects;
  /**
   * Persist a session's axes to `[active]` in one transaction — the
   * `ConfigManager.apply_session` twin behind the W1-D1
   * `ResolverSeams.persistActive` seam. B7
   * ships the ROUTING ({@link resolverSeamsFromEffects}); the real
   * write is B8's (`b6-packets.md:1026`).
   *
   * @param session - The post-swap session.
   * @returns Nothing (a promise for asynchronous stores).
   */
  persistActive: (session: Session) => void | Promise<void>;
  /**
   * Read a secret from stdin (`read_capped_secret_from_stdin`,
   * `io_utils.py` — the `secret_stdin=True` paths,
   * `accounts.py:1513-1518`, `:1797-1802`). Packet-gap ADDITION to the
   * §3.2 table (disclosed in the shard notes): stdin is a node effect
   * the table missed; owner B8.
   *
   * @returns The secret text.
   */
  readSecretStdin: () => string;
  /**
   * Single-line progress narration (`_narrate`, `accounts.py`
   * — a stderr write in Python). Packet-gap ADDITION (disclosed):
   * stderr is a node effect; the CORE default is a silent no-op (the
   * messages are out of contract, R5.4), so this member is NOT in
   * {@link UNPORTED_AUTH_SEAMS}. B8 wires `process.stderr`.
   *
   * @param msg - Single-line message (no trailing newline).
   */
  narrate: (msg: string) => void;
  /** The injected fetch every probe/client runs over (R2.4 — CORE, no stub). */
  readonly fetchImpl: typeof fetch;
  /**
   * Clock seam in epoch milliseconds (R2.4/D1.4 — CORE, no stub).
   *
   * @returns The current time.
   */
  now: () => number;
}

/**
 * The named still-stubbed list after B7 (packet §3.2, verbatim + the
 * two disclosed additions) — the B8 packet consumes it BY NAME.
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
  "readSecretStdin", // packet-gap addition (stdin; disclosed)
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
    // Core-alone posture: the real implementation of every
    // `UNPORTED_AUTH_SEAMS` member SHIPS in `packages/node`
    // (`createNodeAuthEffects()`); this default stays so core without a
    // wired bag still throws the coded error.
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
 * A bag whose every METHOD throws `UNPORTED_AUTH_SEAM` for
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
 * no-op; `fetchImpl` / `now` are the ambient web-standard globals (CORE
 * members — no stub).
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
    // `env.get` is a method; the `MP_*` members are property READS in the
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
