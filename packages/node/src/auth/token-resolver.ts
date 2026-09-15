/**
 * The on-disk `TokenResolver`: OAuth browser tokens are read from
 * `~/.mp/accounts/{name}/tokens.json`, static tokens from inline
 * `Secret` fields or environment variables. Browser-token refresh
 * delegates to `OAuthFlow.refreshTokens` and persists the new payload
 * back atomically (mode 0o600), keeping the previous refresh token when
 * the IdP does not rotate it (dropping it would brick future refreshes).
 *
 * This module owns the per-account `tokens.json`; the DCR client info it
 * consumes is the region-shared `~/.mp/oauth/client_{region}.json` via
 * `OAuthStorage`, and the two layouts are not unified. The methods are
 * async where Python is sync because core's `TokenResolver` interface is
 * Promise-shaped.
 *
 * @see mixpanel_headless._internal.auth.token_resolver
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  isPythonDict,
  MixpanelHeadlessError,
  type OAuthClientInfo,
  OAuthError,
  type OAuthTokenAccount,
  OAuthTokens,
  parseOAuthTokens,
  type Region,
  type TokenResolver,
} from "@mixpanel-headless/core";
import { exceptionMessage } from "@mixpanel-headless/core/internal";

import {
  atomicWriteBytes,
  isErrnoError,
  readCredentialBytes,
  rejectIfSymlink,
} from "../io-utils.js";
import { OAuthFlow } from "./flow.js";
import { coerceLaxExpiresAt } from "./pydantic-datetime.js";
import { accountDir, OAuthStorage } from "./storage.js";
import { tokenPayloadBytes } from "./token-payload.js";

/**
 * Return `{accountDir}/tokens.json` for the given account name. Routes
 * through {@link accountDir} so `MP_OAUTH_STORAGE_DIR` is honoured.
 *
 * @param name - Account name (validated upstream by the Account model;
 *   re-validated by `accountDir` as defense-in-depth).
 * @returns Absolute path to the per-account tokens file.
 * @example
 * ```ts
 * if (existsSync(accountTokensPath("team"))) { ... }
 * ```
 * @see mixpanel_headless._internal.auth.token_resolver._account_tokens_path
 */
export function accountTokensPath(name: string): string {
  return join(accountDir(name), "tokens.json");
}

/** Arguments of the injectable refresh seam. */
export interface RefreshSeamArgs {
  /** The still-on-disk (expired) tokens whose refresh token is spent. */
  readonly tokens: OAuthTokens;
  /** DCR client id for the region. */
  readonly clientId: string;
  /** Account name (threaded into error hints). */
  readonly accountName: string;
  /** Mixpanel region. */
  readonly region: Region;
}

/** Options bag of {@link OnDiskTokenResolver} (test seams). */
export interface OnDiskTokenResolverOptions {
  /**
   * DCR client-info loader seam — the Python tests' `monkeypatch` of
   * `OAuthStorage.load_client_info`.
   *
   * @defaultValue a fresh `OAuthStorage` per refresh, as `_refresh_and_persist` constructs one
   */
  readonly loadClientInfo?:
    ((region: Region) => OAuthClientInfo | null) | undefined;
  /**
   * Refresh seam — the Python tests' `monkeypatch` of
   * `OAuthFlow.refresh_tokens`.
   *
   * @defaultValue a real `OAuthFlow` bound to the region
   */
  readonly refresh?:
    ((args: RefreshSeamArgs) => Promise<OAuthTokens>) | undefined;
  /** Injected fetch for the default refresh flow. */
  readonly fetchImpl?: typeof fetch | undefined;
  /** Epoch-ms clock seam (expiry checks and `fromTokenResponse`). */
  readonly now?: (() => number) | undefined;
  /**
   * Env reader for `token_env` indirection (Python's `os.environ.get`).
   *
   * @defaultValue call-time `process.env`
   */
  readonly env?: ((name: string) => string | undefined) | undefined;
}

/**
 * The default resolver: tokens live on disk per account.
 *
 * @example
 * ```ts
 * const resolver = new OnDiskTokenResolver({ fetchImpl: fetch });
 * const bearer = await resolver.getBrowserToken("team", "us");
 * ```
 * @see mixpanel_headless._internal.auth.token_resolver.OnDiskTokenResolver
 */
export class OnDiskTokenResolver implements TokenResolver {
  /** Client-info loader seam. */
  readonly #loadClientInfo: (region: Region) => OAuthClientInfo | null;

  /** Refresh seam. */
  readonly #refresh: (args: RefreshSeamArgs) => Promise<OAuthTokens>;

  /** Clock seam. */
  readonly #now: () => number;

  /** Env reader. */
  readonly #env: (name: string) => string | undefined;

  /**
   * Build the resolver.
   *
   * @param options - Optional test seams (defaults are the real on-disk
   *   and network paths).
   */
  constructor(options: OnDiskTokenResolverOptions = {}) {
    this.#loadClientInfo =
      options.loadClientInfo ??
      ((region: Region): OAuthClientInfo | null =>
        new OAuthStorage().loadClientInfo(region));
    this.#now = options.now ?? Date.now;
    const fetchImpl = options.fetchImpl;
    this.#refresh =
      options.refresh ??
      (async (args: RefreshSeamArgs): Promise<OAuthTokens> => {
        const flow = new OAuthFlow({
          region: args.region,
          storage: new OAuthStorage(),
          ...(fetchImpl === undefined ? {} : { fetchImpl }),
          now: this.#now,
        });
        return flow.refreshTokens(args.tokens, args.clientId, {
          accountName: args.accountName,
        });
      });
    this.#env =
      options.env ?? ((name: string): string | undefined => process.env[name]);
  }

  /**
   * Return a fresh access token for an oauth_browser account.
   *
   * @param name - Account name (locates the tokens file).
   * @param region - Mixpanel region (selects the DCR client).
   * @returns The current access token (no `Bearer` prefix).
   * @throws {@link OAuthError} - Missing, malformed or symlinked tokens
   *   file, expired without refresh token, or refresh failure.
   * @see mixpanel_headless._internal.auth.token_resolver.OnDiskTokenResolver.get_browser_token
   */
  async getBrowserToken(name: string, region: Region): Promise<string> {
    const path = accountTokensPath(name);
    // Probe for a symlink before the existence check: a dangling symlink
    // must surface the attack signal, not masquerade as ENOENT.
    try {
      rejectIfSymlink(path);
    } catch (error) {
      // Python wraps any OSError from the probe (`except OSError`),
      // errno-bearing lstat failures included.
      if (!(error instanceof MixpanelHeadlessError) && !isErrnoError(error)) {
        throw error;
      }
      throw new OAuthError(
        `OAuth tokens path is a symlink at ${path}: ${exceptionMessage(error)}. ` +
          `Remove the symlink and re-run \`mp account login ${name}\`.`,
        "OAUTH_TOKEN_ERROR",
        { account_name: name, path },
        { cause: error },
      );
    }
    if (!existsSync(path)) {
      throw new OAuthError(
        `No OAuth tokens found for account '${name}'. ` +
          `Run \`mp account login ${name}\` to authenticate.`,
        "OAUTH_TOKEN_ERROR",
        { account_name: name, path },
      );
    }
    let raw: Uint8Array;
    try {
      raw = readCredentialBytes(path);
    } catch (error) {
      throw new OAuthError(
        `Could not read OAuth tokens for account '${name}' from ${path}: ${exceptionMessage(error)}`,
        "OAUTH_TOKEN_ERROR",
        { account_name: name, path },
        { cause: error },
      );
    }

    // The OAuthTokens model is the single source of truth for parsing:
    // it enforces the tz-aware expiry invariant and the secret wrapping
    // in one place. Python's read is pydantic-lax, so a numeric epoch
    // `expires_at` is coerced first through the shared helper.
    let tokens: OAuthTokens;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
      let parsed: unknown = JSON.parse(text);
      if (isPythonDict(parsed) && Object.hasOwn(parsed, "expires_at")) {
        parsed = {
          ...parsed,
          expires_at: coerceLaxExpiresAt(parsed["expires_at"]),
        };
      }
      tokens = parseOAuthTokens(parsed, { boundary: "param" });
      if (Number.isNaN(Date.parse(tokens.expires_at))) {
        throw new MixpanelHeadlessError(
          "expires_at is not a parseable instant",
          "VALIDATION_ERROR",
        );
      }
    } catch (error) {
      throw new OAuthError(
        `OAuth tokens for account '${name}' at ${path} are malformed ` +
          `or missing required fields. Re-run \`mp account login ${name}\`.`,
        "OAUTH_TOKEN_ERROR",
        {
          account_name: name,
          path,
          validation_error: exceptionMessage(error),
        },
        { cause: error },
      );
    }

    if (tokens.isExpired({ now: this.#now })) {
      if (tokens.refresh_token === null) {
        throw new OAuthError(
          `OAuth access token for account '${name}' has expired and no ` +
            `refresh token is available. Re-run \`mp account login ${name}\`.`,
          "OAUTH_TOKEN_ERROR",
          { account_name: name, region, path },
        );
      }
      return this.#refreshAndPersist({ name, region, path, tokens });
    }

    return tokens.access_token.reveal();
  }

  /**
   * Refresh an expired browser token and rewrite the per-account file
   * atomically.
   *
   * @param args - Account `name`, Mixpanel `region`, the per-account
   *   tokens `path` to rewrite, and the parsed (expired) `tokens`.
   * @returns The freshly minted access token.
   * @throws {@link OAuthError} - `OAUTH_REFRESH_ERROR` when the DCR
   *   client info is missing; `OAUTH_REFRESH_REVOKED` on `invalid_grant`.
   * @see mixpanel_headless._internal.auth.token_resolver.OnDiskTokenResolver._refresh_and_persist
   */
  async #refreshAndPersist(args: {
    name: string;
    region: Region;
    path: string;
    tokens: OAuthTokens;
  }): Promise<string> {
    const { name, region, path, tokens } = args;
    const clientInfo = this.#loadClientInfo(region);
    if (clientInfo === null) {
      throw new OAuthError(
        `OAuth client info for region '${region}' is missing; cannot ` +
          `refresh tokens for account '${name}'. ` +
          `Re-run \`mp account login ${name}\`.`,
        "OAUTH_REFRESH_ERROR",
        { account_name: name, region, path },
      );
    }
    let newTokens = await this.#refresh({
      tokens,
      clientId: clientInfo.client_id,
      accountName: name,
      region,
    });
    // Refresh tokens may rotate; if the IdP returns no new refresh
    // token, keep the existing one.
    if (newTokens.refresh_token === null) {
      newTokens = new OAuthTokens({
        access_token: newTokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: newTokens.expires_at,
        scope: newTokens.scope,
        token_type: newTokens.token_type,
      });
    }
    atomicWriteBytes(path, tokenPayloadBytes(newTokens));
    return newTokens.access_token.reveal();
  }

  /**
   * Return the static bearer for an oauth_token account.
   *
   * @param account - The account whose `token` / `token_env` resolves.
   * @returns The bearer token (no `Bearer` prefix).
   * @throws {@link OAuthError} - `token_env` set but the env var is
   *   unset or empty (Python string falsiness: empty means absent).
   * @see mixpanel_headless._internal.auth.token_resolver.OnDiskTokenResolver.get_static_token
   */
  getStaticToken(account: OAuthTokenAccount): Promise<string> {
    if (account.token !== null && account.token !== undefined) {
      return Promise.resolve(account.token.reveal());
    }
    const envName = account.token_env;
    if (envName === null || envName === undefined) {
      // Model invariant (`token` xor `token_env`): an explicit raise so
      // it survives without assertions.
      return Promise.reject(
        new OAuthError(
          `OAuth account '${account.name}' has neither \`token\` nor ` +
            "`token_env`.",
          "OAUTH_TOKEN_ERROR",
          { account_name: account.name },
        ),
      );
    }
    const value = this.#env(envName);
    if (value === undefined || value === "") {
      return Promise.reject(
        new OAuthError(
          `OAuth account '${account.name}' references env var ` +
            `\`${envName}\`, but it is not set or is empty.`,
          "OAUTH_TOKEN_ERROR",
          { account_name: account.name, env_var: envName },
        ),
      );
    }
    return Promise.resolve(value);
  }
}
