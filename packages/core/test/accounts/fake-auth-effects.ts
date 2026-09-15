// B7-A1 test infrastructure — an in-memory `AuthEffects` fake whose
// config member implements the `ConfigManager` transaction semantics
// the interface JSDoc pins (`config.py:494-1002`), so the Python
// suites' tmp-`$HOME` fixtures re-express over injected fakes (packet
// §3.4 header rule; Caution #19: `~/.mp` is NEVER touched by tests).

import type {
  AddAccountParams,
  AddTargetOptions,
  ApplySessionUpdate,
  AuthEffects,
  ConfigWrites,
  SetActiveUpdate,
  UpdateAccountFields,
} from "../../src/accounts/auth-effects.js";
import {
  type Account,
  parseAccount,
  type Region,
  type TokenResolver,
} from "../../src/auth/account.js";
import type {
  BridgeView,
  ResolverConfigSource,
} from "../../src/auth/resolver.js";
import type { ActiveSession, Session } from "../../src/auth/session.js";
import type { OAuthTokens } from "../../src/auth/token.js";
import type { MeResponse } from "../../src/client/me.js";
import {
  AccountInUseError,
  ConfigError,
  OAuthError,
  ParamValidationError,
} from "../../src/errors.js";
import { Secret } from "../../src/secret.js";
import { AccountSummary, Target } from "../../src/types/entities/accounts.js";

/** Mutable state behind a {@link FakeConfig}. */
export interface FakeConfigState {
  /** Account records keyed by name (insertion order preserved). */
  readonly accounts: Map<string, Account>;
  /** The `[active]` block. */
  active: { account?: string; workspace?: number };
  /** Target records keyed by name. */
  readonly targets: Map<
    string,
    { account: string; project: string; workspace: number | null }
  >;
  /** The `[settings].custom_header` entry. */
  customHeader: readonly [string, string] | null;
}

/** The fake config: reads + writes + the exposed state. */
export interface FakeConfig extends ResolverConfigSource, ConfigWrites {
  /** Direct state access for assertions. */
  readonly state: FakeConfigState;
}

/**
 * Render an Account back to the raw record `parseAccount` accepts
 * (the config-file round-trip twin).
 *
 * @param account - The stored account.
 * @returns The raw record with plaintext credential fields.
 */
function accountToRaw(account: Account): Record<string, unknown> {
  const base: Record<string, unknown> = {
    type: account.type,
    name: account.name,
    region: account.region,
  };
  if (
    account.default_project !== undefined &&
    account.default_project !== null
  ) {
    base["default_project"] = account.default_project;
  }
  if (account.type === "service_account") {
    base["username"] = account.username;
    base["secret"] = account.secret.reveal();
  } else if (account.type === "oauth_token") {
    if (account.token !== undefined && account.token !== null) {
      base["token"] = account.token.reveal();
    }
    if (account.token_env !== undefined && account.token_env !== null) {
      base["token_env"] = account.token_env;
    }
  }
  return base;
}

/**
 * Normalize a `Secret | string | null | undefined` to plain text.
 *
 * @param value - The credential input.
 * @returns The plain string, or `null`.
 */
function toText(value: Secret | string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return value instanceof Secret ? value.reveal() : value;
}

/**
 * Build the in-memory config fake.
 *
 * @returns The fake, with `state` exposed for assertions.
 */
export function fakeConfig(): FakeConfig {
  const state: FakeConfigState = {
    accounts: new Map<string, Account>(),
    active: {},
    targets: new Map(),
    customHeader: null,
  };

  const referencedBy = (name: string): string[] =>
    [...state.targets]
      .filter(([, block]) => block.account === name)
      .map(([tname]) => tname)
      .sort();

  const getAccount = (name: string): Account => {
    const account = state.accounts.get(name);
    if (account === undefined) {
      throw new ConfigError(`Account '${name}' not found.`);
    }
    return account;
  };

  const setActive = (update: SetActiveUpdate): void => {
    if (update.account !== undefined) {
      if (!state.accounts.has(update.account)) {
        throw new ConfigError(`Account '${update.account}' not found.`);
      }
      state.active.account = update.account;
    }
    if (update.workspace === null) {
      delete state.active.workspace;
    } else if (update.workspace !== undefined) {
      state.active.workspace = update.workspace;
    }
  };

  return {
    state,
    getAccount,
    getActive: (): ActiveSession => ({
      account: state.active.account ?? null,
      workspace: state.active.workspace ?? null,
    }),
    getTarget: (name: string): Target => {
      const block = state.targets.get(name);
      if (block === undefined) {
        throw new ConfigError(`Target '${name}' not found.`);
      }
      return new Target({
        name,
        account: block.account,
        project: block.project,
        workspace: block.workspace,
      });
    },
    getCustomHeader: (): readonly [string, string] | null => state.customHeader,
    addAccount: (name: string, params: AddAccountParams): void => {
      if (state.accounts.has(name)) {
        // PLAIN ConfigError, matching `ConfigManager._apply_add_account`
        // (`config.py:446`). `AccountExistsError` is reserved for the
        // login_unified name-collision path (`accounts.py:1689`) —
        // B7-ARB-B fix, `b7-reviewB-resolution.md` B-E2E-F1.
        throw new ConfigError(`Account '${name}' already exists.`);
      }
      const raw: Record<string, unknown> = {
        type: params.type,
        name,
        region: params.region,
      };
      if (
        params.default_project !== undefined &&
        params.default_project !== null
      ) {
        raw["default_project"] = params.default_project;
      }
      const username = params.username ?? null;
      const secret = toText(params.secret);
      const token = toText(params.token);
      const tokenEnv = params.token_env ?? null;
      if (params.type === "service_account") {
        if (username !== null) {
          raw["username"] = username;
        }
        if (secret !== null) {
          raw["secret"] = secret;
        }
      } else if (params.type === "oauth_token") {
        if (token !== null) {
          raw["token"] = token;
        }
        if (tokenEnv !== null) {
          raw["token_env"] = tokenEnv;
        }
      }
      let account: Account;
      try {
        account = parseAccount(raw);
      } catch (error) {
        // ConfigManager wraps ValidationError in ConfigError.
        const rendered = error instanceof Error ? error.message : String(error);
        throw new ConfigError(
          `Invalid account fields for '${name}': ${rendered}`,
          null,
          {
            cause: error,
          },
        );
      }
      const isFirst = state.accounts.size === 0;
      state.accounts.set(name, account);
      if (isFirst) {
        // FR-045 first-account promotion — same transaction
        // (`accounts.py:472-489` / interface JSDoc).
        state.active.account = name;
      }
    },
    updateAccount: (name: string, fields: UpdateAccountFields): void => {
      const existing = getAccount(name);
      const raw = accountToRaw(existing);
      if (fields.region !== undefined && fields.region !== null) {
        raw["region"] = fields.region;
      }
      if (
        fields.default_project !== undefined &&
        fields.default_project !== null
      ) {
        raw["default_project"] = fields.default_project;
      }
      const username = fields.username ?? null;
      const secret = toText(fields.secret);
      const token = toText(fields.token);
      const tokenEnv = fields.token_env ?? null;
      if (username !== null || secret !== null) {
        if (existing.type !== "service_account") {
          throw new ConfigError(
            `Account '${name}' is type '${existing.type}'; ` +
              `username/secret apply to service_account only.`,
          );
        }
        if (username !== null) {
          raw["username"] = username;
        }
        if (secret !== null) {
          raw["secret"] = secret;
        }
      }
      if (token !== null || tokenEnv !== null) {
        if (existing.type !== "oauth_token") {
          throw new ConfigError(
            `Account '${name}' is type '${existing.type}'; ` +
              `token/token_env apply to oauth_token only.`,
          );
        }
        if (token !== null) {
          raw["token"] = token;
          delete raw["token_env"];
        }
        if (tokenEnv !== null) {
          raw["token_env"] = tokenEnv;
          delete raw["token"];
        }
      }
      let account: Account;
      try {
        account = parseAccount(raw);
      } catch (error) {
        const rendered = error instanceof Error ? error.message : String(error);
        throw new ConfigError(
          `Invalid account fields for '${name}': ${rendered}`,
          null,
          {
            cause: error,
          },
        );
      }
      state.accounts.set(name, account);
    },
    removeAccount: (
      name: string,
      options: { readonly force?: boolean } = {},
    ): string[] => {
      if (!state.accounts.has(name)) {
        throw new ConfigError(`Account '${name}' not found.`);
      }
      const referenced = referencedBy(name);
      if (referenced.length > 0 && options.force !== true) {
        throw new AccountInUseError(name, referenced);
      }
      state.accounts.delete(name);
      if (state.active.account === name) {
        delete state.active.account;
        delete state.active.workspace;
      }
      return referenced;
    },
    listAccounts: (): AccountSummary[] =>
      [...state.accounts.keys()].sort().map((name) => {
        const account = state.accounts.get(name) as Account;
        return new AccountSummary({
          name: account.name,
          type: account.type,
          region: account.region,
          is_active: state.active.account === account.name,
          referenced_by_targets: referencedBy(account.name),
        });
      }),
    setActive,
    applySession: (update: ApplySessionUpdate): void => {
      const account = update.account ?? null;
      const project = update.project ?? null;
      const workspace = update.workspace ?? null;
      const clearWorkspace = update.clear_workspace ?? false;
      if (workspace !== null && clearWorkspace) {
        // Python raises bare ValueError (`config.py:826-829`).
        throw new ParamValidationError(
          "`workspace=` and `clear_workspace=True` are mutually exclusive.",
        );
      }
      if (account !== null || workspace !== null) {
        setActive({
          ...(account === null ? {} : { account }),
          ...(workspace === null ? {} : { workspace }),
        });
      }
      if (clearWorkspace) {
        delete state.active.workspace;
      }
      if (project !== null) {
        const targetAccount = account ?? state.active.account ?? null;
        if (targetAccount === null) {
          throw new ConfigError(
            "Cannot set project: no active account. " +
              "Run `mp account use NAME` first, or pass `account=NAME` " +
              "together with `project=`.",
          );
        }
        const existing = getAccount(targetAccount);
        const raw = accountToRaw(existing);
        raw["default_project"] = project;
        state.accounts.set(targetAccount, parseAccount(raw));
      }
    },
    applyTarget: (name: string): void => {
      const block = state.targets.get(name);
      if (block === undefined) {
        throw new ConfigError(`Target '${name}' not found.`);
      }
      if (!state.accounts.has(block.account)) {
        throw new ConfigError(
          `Cannot apply target '${name}': ` +
            `account '${block.account}' is not configured.`,
        );
      }
      const existing = getAccount(block.account);
      const raw = accountToRaw(existing);
      raw["default_project"] = block.project;
      state.accounts.set(block.account, parseAccount(raw));
      // Replace [active] wholesale — a target with no workspace clears
      // any prior pin (`config.py:995-999`).
      state.active = { account: block.account };
      if (block.workspace !== null) {
        state.active.workspace = block.workspace;
      }
    },
    addTarget: (name: string, options: AddTargetOptions): Target => {
      if (!state.accounts.has(options.account)) {
        throw new ConfigError(
          `Cannot create target '${name}': ` +
            `account '${options.account}' is not configured.`,
        );
      }
      if (state.targets.has(name)) {
        throw new ConfigError(`Target '${name}' already exists.`);
      }
      let target: Target;
      try {
        target = new Target({
          name,
          account: options.account,
          project: options.project,
          workspace: options.workspace ?? null,
        });
      } catch (error) {
        const rendered = error instanceof Error ? error.message : String(error);
        throw new ConfigError(
          `Invalid target fields for '${name}': ${rendered}`,
          null,
          {
            cause: error,
          },
        );
      }
      state.targets.set(name, {
        account: options.account,
        project: options.project,
        workspace: options.workspace ?? null,
      });
      return target;
    },
    removeTarget: (name: string): void => {
      if (!state.targets.has(name)) {
        throw new ConfigError(`Target '${name}' not found.`);
      }
      state.targets.delete(name);
    },
    listTargets: (): Target[] =>
      [...state.targets.keys()].sort().map((name) => {
        const block = state.targets.get(name) as {
          account: string;
          project: string;
          workspace: number | null;
        };
        return new Target({
          name,
          account: block.account,
          project: block.project,
          workspace: block.workspace,
        });
      }),
  };
}

/** The in-memory token store plus its captured state. */
export interface FakeTokenStore {
  /** Tokens written per account name. */
  readonly written: Map<string, OAuthTokens>;
  /** Account dirs removed (rollback calls). */
  readonly removedDirs: string[];
  /** The effect surface. */
  readonly store: AuthEffects["tokenStore"];
}

/**
 * Build the in-memory token store.
 *
 * @returns The fake plus its capture maps.
 */
export function fakeTokenStore(): FakeTokenStore {
  const written = new Map<string, OAuthTokens>();
  const removedDirs: string[] = [];
  return {
    written,
    removedDirs,
    store: {
      readTokens: (name: string): OAuthTokens | null =>
        written.get(name) ?? null,
      writeTokens: (name: string, tokens: OAuthTokens): string => {
        written.set(name, tokens);
        return `/fake/.mp/accounts/${name}/tokens.json`;
      },
      removeTokens: (name: string): void => {
        written.delete(name);
      },
      removeAccountDir: (name: string): void => {
        written.delete(name);
        removedDirs.push(name);
      },
      clientInfoPath: (region: Region): string =>
        `/fake/.mp/oauth/client_${region}.json`,
      // In-memory dual of `account_dir(name).exists()`: any held
      // token state counts as the per-account directory.
      accountDirExists: (name: string): boolean => written.has(name),
    },
  };
}

/**
 * A fetch stub answering EVERY request with the given JSON payload —
 * the `monkeypatch.setattr(MixpanelAPIClient, "me", …)` twin (packet
 * §3.4 header rule; only `/me` is ever requested by these paths).
 *
 * @param payload - The `/me` payload (or a thunk for per-call bodies).
 * @param status - HTTP status (default 200).
 * @returns The injected fetch.
 */
export function meFetch(
  payload: Record<string, unknown> | (() => Record<string, unknown>),
  status = 200,
): typeof fetch {
  return (async (): Promise<Response> => {
    const body = typeof payload === "function" ? payload() : payload;
    // The app-API envelope: `appRequest` unwraps `results` (matching
    // Python's `api_client.me()`, which the monkeypatched `_fake_me`
    // stubs BELOW the unwrap — so the canned payload goes inside it).
    const wrapped =
      status === 200 && !Object.hasOwn(body, "results")
        ? { results: body }
        : body;
    return new Response(JSON.stringify(wrapped), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

/** Options of {@link makeEffects}. */
export interface MakeEffectsOptions {
  /** Env-var bag read by `env.get` AND the `MP_*` fields. */
  readonly env?: Readonly<Record<string, string>> | undefined;
  /** The injected fetch (default: a rejecting stub). */
  readonly fetchImpl?: typeof fetch | undefined;
  /** Token resolver (default: rejects with OAuthError). */
  readonly tokenResolver?: TokenResolver | undefined;
  /** PKCE flow (default: rejects). */
  readonly oauthFlow?: AuthEffects["oauthFlow"] | undefined;
  /** Bridge (default: `load()` → null, others throw). */
  readonly bridge?: AuthEffects["bridge"] | undefined;
  /** persistActive sink (default: records into `persisted`). */
  readonly persistActive?: ((session: Session) => void) | undefined;
  /** Stdin secret (default: throws ConfigError). */
  readonly readSecretStdin?: (() => string) | undefined;
}

/** The bundle {@link makeEffects} returns. */
export interface EffectsBundle {
  /** The complete effect bag. */
  readonly effects: AuthEffects;
  /** The config fake (state exposed). */
  readonly config: FakeConfig;
  /** The token store fake. */
  readonly tokenStore: FakeTokenStore;
  /** `/me` cache writes captured per account. */
  readonly meCachePuts: Map<string, MeResponse>;
  /** Narration lines captured. */
  readonly narrations: string[];
  /** Sessions passed to `persistActive`. */
  readonly persisted: Session[];
  /** The mutable env record `effects.env` reads through. */
  readonly envBag: Record<string, string>;
}

/**
 * Build a complete in-memory {@link AuthEffects} bundle for tests.
 *
 * @param options - Per-member overrides.
 * @returns The bag plus every capture surface.
 */
export function makeEffects(options: MakeEffectsOptions = {}): EffectsBundle {
  const config = fakeConfig();
  const tokenStore = fakeTokenStore();
  const meCachePuts = new Map<string, MeResponse>();
  const narrations: string[] = [];
  const persisted: Session[] = [];
  const envBag: Record<string, string> = { ...options.env };

  const envRead = (name: string): string | undefined => envBag[name];

  const effects: AuthEffects = {
    config,
    env: {
      get: envRead,
      get MP_USERNAME(): string | undefined {
        return envRead("MP_USERNAME");
      },
      get MP_SECRET(): string | undefined {
        return envRead("MP_SECRET");
      },
      get MP_PROJECT_ID(): string | undefined {
        return envRead("MP_PROJECT_ID");
      },
      get MP_REGION(): string | undefined {
        return envRead("MP_REGION");
      },
      get MP_OAUTH_TOKEN(): string | undefined {
        return envRead("MP_OAUTH_TOKEN");
      },
      get MP_WORKSPACE_ID(): string | undefined {
        return envRead("MP_WORKSPACE_ID");
      },
    },
    tokenStore: tokenStore.store,
    tokenResolver:
      options.tokenResolver ??
      ({
        getBrowserToken: (name: string): Promise<string> => {
          // Mirror OnDiskTokenResolver.get_browser_token: serve the
          // persisted per-account tokens (the fake store here), else
          // the actionable missing-tokens error.
          const persisted = tokenStore.written.get(name);
          if (persisted !== undefined) {
            return Promise.resolve(persisted.access_token.reveal());
          }
          return Promise.reject(
            new OAuthError(
              `No tokens on disk. Run \`mp account login ${name}\` first.`,
            ),
          );
        },
        getStaticToken: (account): Promise<string> => {
          // Mirror OnDiskTokenResolver.get_static_token: inline token
          // first, then the env-var indirection (read from the same
          // env bag the effects expose).
          const token = account.token;
          if (token !== undefined && token !== null) {
            return Promise.resolve(token.reveal());
          }
          const envName = account.token_env;
          if (envName !== undefined && envName !== null) {
            const bearer = envRead(envName);
            if (bearer !== undefined && bearer !== "") {
              return Promise.resolve(bearer);
            }
            return Promise.reject(
              new OAuthError(`Env var '${envName}' is unset.`),
            );
          }
          return Promise.reject(new OAuthError("no static token"));
        },
      } satisfies TokenResolver),
    oauthFlow:
      options.oauthFlow ??
      ({
        login: (): Promise<OAuthTokens> =>
          Promise.reject(new OAuthError("oauthFlow.login not stubbed")),
      } satisfies AuthEffects["oauthFlow"]),
    bridge:
      options.bridge ??
      ({
        load: (): BridgeView | null => null,
        export: (): string => {
          throw new OAuthError("bridge.export not stubbed");
        },
        remove: (): boolean => false,
      } satisfies AuthEffects["bridge"]),
    meCache: {
      put: (accountName: string, me: MeResponse): void => {
        meCachePuts.set(accountName, me);
      },
    },
    persistActive:
      options.persistActive ??
      ((session: Session): void => {
        persisted.push(session);
      }),
    readSecretStdin:
      options.readSecretStdin ??
      ((): string => {
        throw new ConfigError("stdin not stubbed");
      }),
    narrate: (msg: string): void => {
      narrations.push(msg);
    },
    fetchImpl:
      options.fetchImpl ??
      ((async (): Promise<Response> => {
        throw new TypeError("fetch failed (no fetchImpl stubbed)");
      }) as typeof fetch),
    now: (): number => Date.now(),
  };

  return {
    effects,
    config,
    tokenStore,
    meCachePuts,
    narrations,
    persisted,
    envBag,
  };
}

/**
 * Mutate the env bag of an existing bundle (the `monkeypatch.setenv`
 * twin) — the effect bag's getters read through to the same record.
 *
 * @param bundle - The bundle whose env to mutate.
 * @param name - Variable name.
 * @param value - New value, or `undefined` to unset.
 */
export function setEnv(
  bundle: EffectsBundle,
  name: string,
  value: string | undefined,
): void {
  if (value === undefined) {
    delete bundle.envBag[name];
    return;
  }
  bundle.envBag[name] = value;
}
