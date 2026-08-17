/**
 * Concrete `TokenResolver` — TS port of
 * `mixpanel_headless/_internal/auth/token_resolver.py` (whole file,
 * `token_resolver.py:1-288`; b8-packets.md §3.1 row 3).
 *
 * `OnDiskTokenResolver` reads OAuth browser tokens from
 * `~/.mp/accounts/{name}/tokens.json` and static tokens from inline
 * `Secret` fields or environment variables. Browser-token refresh
 * delegates to `OAuthFlow.refreshTokens` and persists the new payload
 * back atomically (`token_payload_bytes`, mode 0o600) — refresh-token
 * ROTATION KEEP included (`token_resolver.py:236-241`; packet §7
 * caution 7: dropping it bricks future refreshes).
 *
 * Persistence world note (packet §7 caution 9): this module owns the
 * PER-ACCOUNT `tokens.json`; the DCR client info it consumes is the
 * REGION-SHARED `~/.mp/oauth/client_{region}.json` via `OAuthStorage`.
 * The two worlds are not unified.
 *
 * Async where Python is sync — the core `TokenResolver` interface
 * (`auth/account.ts:74-91`) is Promise-shaped; R2.9 per-request
 * resolution is enforced by the core call sites.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import type {
  OAuthTokenAccount,
  Region,
  TokenResolver,
} from "../../../core/src/auth/account.js";
import { OAuthTokens, parseOAuthTokens } from "../../../core/src/auth/token.js";
import type { OAuthClientInfo } from "../../../core/src/auth/token.js";
import { MixpanelHeadlessError, OAuthError } from "../../../core/src/errors.js";
import {
  atomicWriteBytes,
  readCredentialBytes,
  rejectIfSymlink,
} from "../io-utils.js";
import { OAuthFlow } from "./flow.js";
import { OAuthStorage } from "./storage.js";
import { accountDir } from "./storage.js";
import { tokenPayloadBytes } from "./token-payload.js";

/**
 * `<account-dir>/tokens.json` for the given account name (port of
 * `_account_tokens_path`, `token_resolver.py:40-56`). Routes through
 * {@link accountDir} so `MP_OAUTH_STORAGE_DIR` is honored.
 *
 * @param name - Account name (validated upstream by the Account model;
 *   re-validated by `accountDir` as defense-in-depth).
 * @returns Absolute path to the per-account tokens file.
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
   * `OAuthStorage.load_client_info` (`test_token_resolver.py:237-249`).
   * Default: a fresh `OAuthStorage` per refresh, exactly as
   * `_refresh_and_persist` constructs one (`token_resolver.py:211`).
   */
  readonly loadClientInfo?:
    ((region: Region) => OAuthClientInfo | null) | undefined;
  /**
   * Refresh seam — the Python tests' `monkeypatch` of
   * `OAuthFlow.refresh_tokens`. Default: a real `OAuthFlow` bound to
   * the region (`token_resolver.py:228-234`).
   */
  readonly refresh?:
    ((args: RefreshSeamArgs) => Promise<OAuthTokens>) | undefined;
  /** Injected fetch for the default refresh flow. */
  readonly fetchImpl?: typeof fetch | undefined;
  /** Epoch-ms clock seam (expiry checks + `fromTokenResponse`). */
  readonly now?: (() => number) | undefined;
  /**
   * Env reader for `token_env` indirection (default: call-time
   * `process.env` — `os.environ.get`, `token_resolver.py:273`).
   */
  readonly env?: ((name: string) => string | undefined) | undefined;
}

/**
 * Default resolver: tokens live on disk per account (port of
 * `OnDiskTokenResolver`, `token_resolver.py:57-288`).
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
   * @param options - Optional test seams (defaults are the real
   *   on-disk / network paths).
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
          ...(fetchImpl !== undefined ? { fetchImpl } : {}),
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
   * Return a fresh access token for an oauth_browser account (port of
   * `get_browser_token`, `token_resolver.py:74-172`).
   *
   * @param name - Account name (locates the tokens file).
   * @param region - Mixpanel region (selects the DCR client).
   * @returns The current access token (no `Bearer` prefix).
   * @throws OAuthError - Missing/malformed/symlinked tokens file,
   *   expired without refresh token, or refresh failure.
   */
  async getBrowserToken(name: string, region: Region): Promise<string> {
    const path = accountTokensPath(name);
    // Probe for symlink BEFORE the existence check
    // (`token_resolver.py:97-111` — a dangling symlink must surface
    // the attack signal, not masquerade as ENOENT).
    try {
      rejectIfSymlink(path);
    } catch (exc) {
      if (!(exc instanceof MixpanelHeadlessError)) {
        throw exc;
      }
      throw new OAuthError(
        `OAuth tokens path is a symlink at ${path}: ${exc.message}. ` +
          `Remove the symlink and re-run \`mp account login ${name}\`.`,
        "OAUTH_TOKEN_ERROR",
        { account_name: name, path },
        { cause: exc },
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
    } catch (exc) {
      throw new OAuthError(
        `Could not read OAuth tokens for account '${name}' from ${path}: ` +
          `${exc instanceof Error ? exc.message : String(exc)}`,
        "OAUTH_TOKEN_ERROR",
        { account_name: name, path },
        { cause: exc },
      );
    }

    // Single source of truth for parsing (`token_resolver.py:134-148`)
    // — the OAuthTokens model enforces the tz-aware expiry invariant
    // and the secret wrapping in one place.
    let tokens: OAuthTokens;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
      const parsed: unknown = JSON.parse(text);
      tokens = parseOAuthTokens(parsed, { boundary: "param" });
      if (Number.isNaN(Date.parse(tokens.expires_at))) {
        throw new MixpanelHeadlessError(
          "expires_at is not a parseable instant",
          "VALIDATION_ERROR",
        );
      }
    } catch (exc) {
      throw new OAuthError(
        `OAuth tokens for account '${name}' at ${path} are malformed ` +
          `or missing required fields. Re-run \`mp account login ${name}\`.`,
        "OAUTH_TOKEN_ERROR",
        {
          account_name: name,
          path,
          validation_error: exc instanceof Error ? exc.message : String(exc),
        },
        { cause: exc },
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
   * atomically (port of `_refresh_and_persist`,
   * `token_resolver.py:174-243`).
   *
   * @param args - Account name, region, tokens path, parsed tokens.
   * @returns The freshly minted access token.
   * @throws OAuthError - `OAUTH_REFRESH_ERROR` for missing-client
   *   cases; `OAUTH_REFRESH_REVOKED` on `invalid_grant`.
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
    // token we KEEP the existing one (`token_resolver.py:236-241`).
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
   * Return the static bearer for an oauth_token account (port of
   * `get_static_token`, `token_resolver.py:244-283`).
   *
   * @param account - The account whose `token` / `token_env` resolves.
   * @returns The bearer token (no `Bearer` prefix).
   * @throws OAuthError - `token_env` set but the env var is unset or
   *   empty (R11.7 falsiness on strings: empty = absent).
   */
  async getStaticToken(account: OAuthTokenAccount): Promise<string> {
    if (account.token !== null && account.token !== undefined) {
      return Promise.resolve(account.token.reveal());
    }
    const envName = account.token_env;
    if (envName === null || envName === undefined) {
      // Model invariant (`token XOR token_env`) — explicit raise so it
      // survives without assertions (`token_resolver.py:267-272`).
      throw new OAuthError(
        `OAuth account '${account.name}' has neither \`token\` nor ` +
          "`token_env`.",
        "OAUTH_TOKEN_ERROR",
        { account_name: account.name },
      );
    }
    const value = this.#env(envName);
    if (value === undefined || value === "") {
      throw new OAuthError(
        `OAuth account '${account.name}' references env var ` +
          `\`${envName}\`, but it is not set or is empty.`,
        "OAUTH_TOKEN_ERROR",
        { account_name: account.name, env_var: envName },
      );
    }
    return Promise.resolve(value);
  }
}
