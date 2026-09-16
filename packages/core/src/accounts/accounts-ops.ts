/**
 * Core operations of the `accounts` namespace — account CRUD, the `/me`
 * probe, bridge export and token retrieval — as pure functions over the
 * injected {@link AuthEffects} bag (Python's per-call `ConfigManager()`
 * is `effects.config`, `os.environ` is `effects.env`, disk and browser
 * I/O go through the store / flow / bridge members); `login_unified`
 * lives in `login-unified.ts`. Only two sites reveal a secret —
 * {@link freshBrowserBearer} and `token()`, Python's documented public
 * behavior; secrets never reach thrown messages or error `details`.
 *
 * @see mixpanel_headless.accounts
 */

import type {
  Account,
  AccountType,
  Region,
  TokenResolver,
} from "../auth/account.js";
import type { Session } from "../auth/session.js";
import { createMixpanelClient } from "../client/client.js";
import { toNativeJson } from "../client/json-value.js";
import { type MeProjectInfo, MeResponse } from "../client/me.js";
import { endpointOverridesFromEnv } from "../client/url.js";
import {
  ConfigError,
  MixpanelHeadlessError,
  OAuthError,
  ParamTypeError,
} from "../errors.js";
import { exceptionMessage } from "../invariant.js";
import { Secret } from "../secret.js";
import {
  type AccountSummary,
  AccountTestResult,
  OAuthLoginResult,
} from "../types/entities/accounts.js";
import type { AuthEffects } from "./auth-effects.js";
import { defaultAccountName } from "./naming.js";

/**
 * Choose one project when `/me` lists several. The CLI supplies a
 * TTY-aware implementation; library callers supply their own or pass
 * `null` to fail fast in non-interactive contexts. Receives the parsed
 * `/me` plus the `(projectId, info)` pairs sorted by (org name, project
 * name), both case-folded.
 *
 * @see mixpanel_headless.accounts.ProjectPicker
 */
export type ProjectPicker = (
  me: MeResponse,
  sortedProjects: ReadonlyArray<readonly [string, MeProjectInfo]>,
) => string;

/**
 * Progress handle returned by a {@link ProgressFactory} — the TS
 * spelling of Python's context manager (`__enter__` is the factory
 * call; `__exit__` is {@link ProgressHandle.end}).
 */
export interface ProgressHandle {
  /** Close the progress indicator (the context manager's `__exit__`). */
  end: () => void;
}

/**
 * Open a progress indicator around the slow `/me` round-trips so a CLI
 * can render a spinner. Library callers leave it `null` and the
 * orchestrator substitutes a no-op (the `contextlib.nullcontext` twin).
 *
 * @see mixpanel_headless.accounts.ProgressFactory
 */
export type ProgressFactory = (msg: string) => ProgressHandle;

/**
 * The message shown while awaiting `/me`. Deliberately free of duration
 * estimates: `/me` latency depends on how many projects and orgs the
 * user can see, so it under-promises rather than print a misleading
 * "this may take 30s" line.
 */
export const FETCH_ME_PROGRESS_MESSAGE =
  "Fetching your projects from Mixpanel...";

/**
 * Wrap a freshly minted PKCE bearer as a one-shot {@link TokenResolver}.
 *
 * @remarks
 * Runs the post-PKCE `/me` probe before the access token is persisted,
 * so a region-mismatch failure never leaves wrong-region tokens at the
 * user-visible account path.
 * @param accessToken - The plaintext PKCE bearer just returned from the
 *   flow (one of this module's two reveal sites).
 * @returns The in-memory resolver.
 * @example
 * ```typescript
 * const bearer = freshBrowserBearer(tokens.access_token.reveal());
 * const me = await fetchMe(effects, account, { tokenResolver: bearer });
 * ```
 * @see mixpanel_headless.accounts._FreshBrowserBearer
 */
export function freshBrowserBearer(accessToken: string): TokenResolver {
  return {
    getBrowserToken: (): Promise<string> => Promise.resolve(accessToken),
    getStaticToken: (): Promise<string> => Promise.resolve(accessToken),
  };
}

/**
 * Options of {@link fetchMe}; keys mirror the Python keyword-only
 * parameters.
 */
export interface FetchMeOptions {
  /**
   * Resolver override for the post-PKCE, pre-persist probe.
   *
   * @defaultValue the bag's `tokenResolver`
   */
  readonly tokenResolver?: TokenResolver | undefined;
  /**
   * Project ID used when `account.default_project` is unset.
   *
   * @defaultValue `"0"`
   */
  readonly placeholderProject?: string | undefined;
}

/**
 * Run a one-shot `/me` probe as `account` and return the parsed response.
 *
 * @remarks
 * Builds a short-lived wire client over the injected fetch (the auth
 * header is resolved per request through the token resolver, never
 * captured) and always closes it.
 * @param effects - The effect bag (fetch and default token resolver).
 * @param account - The account to authenticate as.
 * @param options - Resolver override and placeholder project.
 * @returns The parsed {@link MeResponse}.
 * @throws {@link AuthenticationError} - Propagated from the `/me` call.
 * @throws {@link OAuthError} - Propagated from token resolution.
 * @throws {@link QueryError} - Propagated from the `/me` call.
 * @throws {@link ResponseValidationError} - When the body does not fit
 *   the `MeResponse` model.
 * @example
 * ```typescript
 * const me = await fetchMe(effects, account);
 * me.projects.size; // number of projects the credential can see
 * ```
 * @see mixpanel_headless.accounts._fetch_me
 */
export async function fetchMe(
  effects: AuthEffects,
  account: Account,
  options: FetchMeOptions = {},
): Promise<MeResponse> {
  const projectId =
    account.default_project ?? options.placeholderProject ?? "0";
  const probeSession: Session = {
    account,
    project: { id: projectId },
    workspace: null,
    headers: new Map<string, string>(),
  };
  const client = createMixpanelClient({
    session: probeSession,
    fetch: effects.fetchImpl,
    tokenResolver: options.tokenResolver ?? effects.tokenResolver,
    // `/me` honours the `MP_API_BASE_URL` / `MP_APP_BASE_URL` overrides,
    // read per request through the injected env bag (never `process.env`).
    endpointOverrides: endpointOverridesFromEnv((variable) =>
      effects.env.get(variable),
    ),
  });
  try {
    // Same `toNativeJson` step every model site performs on wire JSON
    // (lossless-number tokens → native values), as `MeService` does.
    const raw = await client.me();
    return MeResponse.fromDict(toNativeJson(raw));
  } finally {
    await client.close();
  }
}

/** Lookup table for {@link domainToRegion}. */
const DOMAIN_TO_REGION: Readonly<Record<string, Region>> = {
  "mixpanel.com": "us",
  "eu.mixpanel.com": "eu",
  "in.mixpanel.com": "in",
};

/**
 * Map a Mixpanel project `domain` string to its region.
 *
 * @param domain - Project domain string (host, optionally with
 *   protocol / path). Export hosts' `data-` / `data.` prefixes are
 *   normalized to the canonical query-host form.
 * @returns `"us"` / `"eu"` / `"in"` for recognized hosts, `null`
 *   otherwise (callers skip the cross-check rather than misclassify).
 * @example
 * ```typescript
 * domainToRegion("eu.mixpanel.com");            // "eu"
 * domainToRegion("https://mixpanel.com/path");  // "us"
 * domainToRegion("data-eu.mixpanel.com");       // "eu"
 * domainToRegion("foo.example.com");            // null
 * ```
 * @see mixpanel_headless.accounts._domain_to_region
 */
function domainToRegion(domain: string): Region | null {
  if (domain === "") {
    return null;
  }
  let host = domain.toLowerCase().trim();
  if (host.includes("://")) {
    host = host.split("://").slice(1).join("://");
  }
  host = host.split("/", 1)[0] ?? host;
  if (host.startsWith("data-")) {
    host = host.slice("data-".length);
  } else if (host === "data.mixpanel.com") {
    host = "mixpanel.com";
  }
  return DOMAIN_TO_REGION[host] ?? null;
}

/**
 * Throw when the chosen project lives in a different cluster than the
 * one the credential authenticated against.
 *
 * @remarks
 * A no-op when `chosenProject` is unset, missing from `/me`, or carries
 * no `domain` field (older payloads).
 * @param me - Parsed `/me` response.
 * @param chosenProject - The project ID the orchestrator selected.
 * @param authRegion - The region the credential authenticated against.
 * @throws {@link ConfigError} - When `authRegion` differs from the
 *   project's cluster.
 * @example
 * ```typescript
 * assertProjectRegionMatches(me, "3018488", "us");
 * // throws ConfigError when project 3018488 lives on eu.mixpanel.com
 * ```
 * @see mixpanel_headless.accounts._assert_project_region_matches
 */
export function assertProjectRegionMatches(
  me: MeResponse,
  chosenProject: string | null,
  authRegion: Region,
): void {
  if (chosenProject === null || !me.projects.has(chosenProject)) {
    return;
  }
  const projInfo = me.projects.get(chosenProject);
  if (projInfo === undefined) {
    return;
  }
  const domain = projInfo.domain;
  // Python `if not proj_info.domain` — None and "" both skip.
  if (domain === null || domain === "") {
    return;
  }
  const projectRegion = domainToRegion(domain);
  if (projectRegion === null || projectRegion === authRegion) {
    return;
  }
  throw new ConfigError(
    `Region mismatch.\n\n` +
      `You authenticated against the ${authRegion} cluster, but project ` +
      `${chosenProject} (${projInfo.name}) lives in the ` +
      `${projectRegion} cluster (${domain}).\n\n` +
      `Re-run with the correct region:\n` +
      `    mp login --region ${projectRegion}`,
  );
}

/**
 * Build an `AccountTestResult` for a failed `/me` probe.
 *
 * @remarks
 * Preserves `code` / `details` when the failure was a library error;
 * other exceptions carry only the human-readable `error` string.
 * @param accountName - The account that was tested.
 * @param prefix - Context prefix for the `error` field.
 * @param exc - The exception that was caught.
 * @returns A populated failure result (`ok: false`).
 * @see mixpanel_headless.accounts._build_test_failure_result
 */
function buildTestFailureResult(
  accountName: string,
  prefix: string,
  exc: unknown,
): AccountTestResult {
  let errorCode: string | null = null;
  let errorDetails: Readonly<Record<string, unknown>> | null = null;
  if (exc instanceof MixpanelHeadlessError) {
    errorCode = exc.code;
    const details = exc.details;
    errorDetails = Object.keys(details).length > 0 ? { ...details } : null;
  }
  const rendered = exceptionMessage(exc);
  return new AccountTestResult({
    account_name: accountName,
    ok: false,
    error: `${prefix}: ${rendered}`,
    error_code: errorCode,
    error_details: errorDetails,
  });
}

/**
 * Return every configured account, sorted by name.
 *
 * @param effects - The effect bag.
 * @returns The account summaries.
 * @example
 * ```typescript
 * const names = accountsList(effects).map((summary) => summary.name);
 * ```
 * @see mixpanel_headless.accounts.list
 */
export function accountsList(effects: AuthEffects): AccountSummary[] {
  return effects.config.listAccounts();
}

/**
 * Options bag of {@link AccountsNamespace.add}; keys mirror the
 * Python keyword-only parameters.
 */
export interface AccountsAddOptions {
  /** Account type discriminator. */
  readonly type: AccountType;
  /**
   * Region; may be omitted only for `oauth_browser`, which then defaults
   * to `us`.
   *
   * @defaultValue `null`
   */
  readonly region?: Region | null | undefined;
  /**
   * Home project (digit string).
   *
   * @defaultValue `null`
   */
  readonly default_project?: string | null | undefined;
  /** Service-account username. */
  readonly username?: string | null | undefined;
  /** Service-account secret. */
  readonly secret?: Secret | string | null | undefined;
  /** `oauth_token` inline bearer; exclusive with `token_env`. */
  readonly token?: Secret | string | null | undefined;
  /** `oauth_token` env-var name; exclusive with `token`. */
  readonly token_env?: string | null | undefined;
  /**
   * Derive the name from `/me`; mutually exclusive with `name`.
   *
   * @defaultValue `false`
   */
  readonly derive_name?: boolean | undefined;
}

/**
 * Add a new account and return its summary.
 *
 * @remarks
 * `default_project` is optional for every type; the first account added
 * is promoted to `[active].account` inside the config effect's single
 * transaction.
 * @param effects - The effect bag.
 * @param name - Account name; required unless `derive_name` is set.
 * @param options - Typed credential fields plus `derive_name`.
 * @returns The new account's summary.
 * @throws {@link ParamTypeError} - When `derive_name` is combined with an
 *   explicit `name`, or neither is given (the Python `TypeError` twin).
 * @throws {@link ConfigError} - When validation fails, the name is taken,
 *   `region` is omitted for a non-browser type, or `derive_name` is
 *   requested for `oauth_browser`.
 * @example
 * ```typescript
 * const summary = await accountsAdd(effects, "team", {
 *   type: "service_account",
 *   region: "us",
 *   username: "svc.user",
 *   secret: "hunter2",
 * });
 * // summary.name === "team"; summary.is_active is true for a first account
 * ```
 * @see mixpanel_headless.accounts.add
 */
// eslint-disable-next-line complexity -- branch-for-branch port of one Python function (see the docblock); splitting it would scatter the guard order the corpus pins
export async function accountsAdd(
  effects: AuthEffects,
  name: string | null | undefined,
  options: AccountsAddOptions,
): Promise<AccountSummary> {
  const deriveName = options.derive_name ?? false;
  let resolvedName = name ?? null;
  if (deriveName && resolvedName !== null) {
    throw new ParamTypeError(
      "`derive_name=True` and explicit `name=` are mutually exclusive.",
    );
  }
  if (!deriveName && resolvedName === null) {
    throw new ParamTypeError("`name` is required unless `derive_name=True`.");
  }
  const region = options.region ?? null;
  // Region probing lives in the CLI layer; the library API refuses to
  // invent a region.
  if (region === null && options.type !== "oauth_browser") {
    throw new ConfigError(
      `Account type '${options.type}' requires \`region\`. Pass region= ` +
        "explicitly, or use `mp login` for the guided probing flow.",
    );
  }
  const resolvedRegion: Region = region ?? "us";

  if (deriveName) {
    if (options.type === "oauth_browser") {
      throw new ConfigError(
        "`derive_name=True` is not supported for oauth_browser. " +
          "Use `mp login` (or `accounts.login_unified`) — the " +
          "browser flow needs PKCE before /me can be reached.",
      );
    }
    resolvedName = await deriveAccountNameForCredential(effects, {
      account_type: options.type,
      region: resolvedRegion,
      username: options.username ?? null,
      secret: options.secret ?? null,
      token: options.token ?? null,
      token_env: options.token_env ?? null,
    });
  }
  if (resolvedName === null) {
    // Unreachable — both branches above leave the name populated
    // (Python's `assert name is not None`).
    throw new ParamTypeError("`name` is required unless `derive_name=True`.");
  }

  // First-account promotion happens inside the config effect's single
  // transaction — never two effect calls where Python makes one
  // `_mutate()` block.
  effects.config.addAccount(resolvedName, {
    type: options.type,
    region: resolvedRegion,
    default_project: options.default_project ?? null,
    username: options.username ?? null,
    secret: options.secret ?? null,
    token: options.token ?? null,
    token_env: options.token_env ?? null,
  });
  return accountsShow(effects, resolvedName);
}

/**
 * Arguments of {@link deriveAccountNameForCredential}; keys mirror the
 * Python keyword-only parameters.
 */
interface DeriveNameArgs {
  /** `"service_account"` or `"oauth_token"`. */
  readonly account_type: AccountType;
  /** Resolved region. */
  readonly region: Region;
  /** SA username. */
  readonly username: string | null;
  /** SA secret. */
  readonly secret: Secret | string | null;
  /** oauth_token inline bearer. */
  readonly token: Secret | string | null;
  /** oauth_token env-var name. */
  readonly token_env: string | null;
}

/**
 * Derive a unique account name by probing `/me` with a temporary
 * account built from the credential.
 *
 * @param effects - The effect bag.
 * @param args - Credential material.
 * @returns A unique account name suitable for persistence.
 * @throws {@link ConfigError} - When credential material is missing for
 *   the type.
 * @throws {@link AuthenticationError} - Propagated from the `/me` call.
 * @throws {@link OAuthError} - Propagated from token resolution.
 * @throws {@link QueryError} - Propagated from the `/me` call.
 * @see mixpanel_headless.accounts._derive_account_name_for_credential
 */
async function deriveAccountNameForCredential(
  effects: AuthEffects,
  args: DeriveNameArgs,
): Promise<string> {
  const placeholderName = "_tmp_naming_";
  const placeholderProject = "0";

  let tempAccount: Account;
  if (args.account_type === "service_account") {
    if (args.username === null || args.secret === null) {
      throw new ConfigError(
        "service_account requires `username` and `secret` to derive a name.",
      );
    }
    tempAccount = {
      type: "service_account",
      name: placeholderName,
      region: args.region,
      username: args.username,
      secret:
        args.secret instanceof Secret ? args.secret : new Secret(args.secret),
      default_project: placeholderProject,
    };
  } else if (args.account_type === "oauth_token") {
    if (args.token !== null) {
      tempAccount = {
        type: "oauth_token",
        name: placeholderName,
        region: args.region,
        token:
          args.token instanceof Secret ? args.token : new Secret(args.token),
        default_project: placeholderProject,
      };
    } else if (args.token_env === null) {
      throw new ConfigError(
        "oauth_token requires `token` or `token_env` to derive a name.",
      );
    } else {
      tempAccount = {
        type: "oauth_token",
        name: placeholderName,
        region: args.region,
        token_env: args.token_env,
        default_project: placeholderProject,
      };
    }
  } else {
    // Control-flow invariant (Python marks it `pragma: no cover`):
    // `accountsAdd` rejects oauth_browser before reaching here.
    throw new ConfigError(
      `derive_name not supported for account type '${args.account_type}'.`,
    );
  }

  const meResp = await fetchMe(effects, tempAccount);
  const existing = new Set(
    effects.config.listAccounts().map((summary) => summary.name),
  );
  return defaultAccountName(meResp, existing);
}

/**
 * Options bag of {@link AccountsNamespace.update}; keys mirror the Python
 * keyword-only parameters. An absent field stays untouched.
 */
export interface AccountsUpdateOptions {
  /** New region. */
  readonly region?: Region | null | undefined;
  /** New home project (digit string). */
  readonly default_project?: string | null | undefined;
  /** New username; `service_account` only. */
  readonly username?: string | null | undefined;
  /** New secret; `service_account` only. */
  readonly secret?: Secret | string | null | undefined;
  /** New inline token; `oauth_token` only. */
  readonly token?: Secret | string | null | undefined;
  /** New env-var name; `oauth_token` only. */
  readonly token_env?: string | null | undefined;
}

/**
 * Update fields on an existing account in place; the type cannot change.
 *
 * @param effects - The effect bag.
 * @param name - Account to update.
 * @param options - Fields to rewrite.
 * @returns The updated summary.
 * @throws {@link ConfigError} - When the account is missing, a field
 *   does not fit its type, or validation fails.
 * @example
 * ```typescript
 * const summary = accountsUpdate(effects, "team", {
 *   default_project: "3018488",
 * });
 * ```
 * @see mixpanel_headless.accounts.update
 */
export function accountsUpdate(
  effects: AuthEffects,
  name: string,
  options: AccountsUpdateOptions = {},
): AccountSummary {
  effects.config.updateAccount(name, {
    region: options.region ?? null,
    default_project: options.default_project ?? null,
    username: options.username ?? null,
    secret: options.secret ?? null,
    token: options.token ?? null,
    token_env: options.token_env ?? null,
  });
  return accountsShow(effects, name);
}

/**
 * Remove an account and report the targets that referenced it.
 *
 * @param effects - The effect bag.
 * @param name - Account name.
 * @param options - `force` (default `false`) removes the account even
 *   when targets reference it.
 * @returns Names of the targets left pointing at the removed account;
 *   empty unless `force` overrode references.
 * @throws {@link ConfigError} - When the account is missing.
 * @throws {@link AccountInUseError} - When targets reference the account
 *   and `force` is not set.
 * @example
 * ```typescript
 * const orphaned = accountsRemove(effects, "team", { force: true });
 * // e.g. ["ecom"] when the target "ecom" pointed at "team"
 * ```
 * @see mixpanel_headless.accounts.remove
 */
export function accountsRemove(
  effects: AuthEffects,
  name: string,
  options: { readonly force?: boolean | undefined } = {},
): string[] {
  return effects.config.removeAccount(name, {
    force: options.force ?? false,
  });
}

/**
 * Make an account active and clear any prior workspace pin.
 *
 * @remarks
 * Both writes land in the config effect's single transaction
 * (`workspace: null` clears the pin).
 * @param effects - The effect bag.
 * @param name - Account to make active.
 * @throws {@link ConfigError} - When the account does not exist.
 * @example
 * ```typescript
 * accountsUse(effects, "team");
 * ```
 * @see mixpanel_headless.accounts.use
 */
export function accountsUse(effects: AuthEffects, name: string): void {
  effects.config.setActive({ account: name, workspace: null });
}

/**
 * Return the named account's summary, or the active account's.
 *
 * @param effects - The effect bag.
 * @param name - Account name; `null` means the active account.
 * @returns The summary.
 * @throws {@link ConfigError} - When the account is not found, or no
 *   account is active.
 * @example
 * ```typescript
 * const active = accountsShow(effects);
 * // active.is_active === true
 * ```
 * @see mixpanel_headless.accounts.show
 */
export function accountsShow(
  effects: AuthEffects,
  name: string | null = null,
): AccountSummary {
  let resolved = name;
  if (resolved === null) {
    const active = effects.config.getActive().account ?? null;
    // Python `if not active` — None and "" both reject.
    if (active === null || active === "") {
      throw new ConfigError("No active account configured.");
    }
    resolved = active;
  }
  const summaries = effects.config.listAccounts();
  const match = summaries.find((summary) => summary.name === resolved);
  if (match === undefined) {
    throw new ConfigError(`Account '${resolved}' not found.`);
  }
  return match;
}

/**
 * Probe `/me` for an account and report the outcome without throwing.
 *
 * @param effects - The effect bag.
 * @param name - Account to test; `null` means the active account.
 * @returns `ok: true` with `user` populated on success; `ok: false` with
 *   `error` (and coded fields for library errors) on any failure.
 * @example
 * ```typescript
 * const result = await accountsTest(effects, "team");
 * // result.ok === true; result.accessible_project_count === 3
 * ```
 * @see mixpanel_headless.accounts.test
 */
export async function accountsTest(
  effects: AuthEffects,
  name: string | null = null,
): Promise<AccountTestResult> {
  let summary: AccountSummary;
  try {
    summary = accountsShow(effects, name);
  } catch (error) {
    if (error instanceof ConfigError) {
      return new AccountTestResult({
        // Python `name or "(none)"`: the empty string also defaults
        // (falsy `or`, not nullish).
        account_name: name !== null && name !== "" ? name : "(none)",
        ok: false,
        error: error.message,
      });
    }
    throw error;
  }

  let account: Account;
  try {
    account = effects.config.getAccount(summary.name);
  } catch (error) {
    // Unreachable in practice (Python marks it `pragma: no cover`):
    // `show()` already validated existence.
    if (error instanceof ConfigError) {
      return new AccountTestResult({
        account_name: summary.name,
        ok: false,
        error: error.message,
      });
    }
    throw error;
  }

  const placeholderProject = account.default_project ?? "0";
  const probeSession: Session = {
    account,
    project: { id: placeholderProject },
    workspace: null,
    headers: new Map<string, string>(),
  };
  const client = createMixpanelClient({
    session: probeSession,
    fetch: effects.fetchImpl,
    tokenResolver: effects.tokenResolver,
    endpointOverrides: endpointOverridesFromEnv((variable) =>
      effects.env.get(variable),
    ),
  });
  try {
    let meRaw: unknown;
    try {
      meRaw = await client.me();
    } catch (error) {
      // Broad catch — capture every failure mode, as Python does.
      return buildTestFailureResult(summary.name, "/me probe failed", error);
    }
    let meResp: MeResponse;
    try {
      meResp = MeResponse.fromDict(toNativeJson(meRaw));
    } catch (error) {
      return buildTestFailureResult(
        summary.name,
        "/me response could not be parsed",
        error,
      );
    }
    let user: Readonly<Record<string, unknown>> | null = null;
    if (meResp.user_id !== null && meResp.user_email !== null) {
      user = { id: meResp.user_id, email: meResp.user_email };
    }
    const projectCount = meResp.projects.size;
    return new AccountTestResult({
      account_name: summary.name,
      ok: true,
      user,
      accessible_project_count: projectCount,
    });
  } finally {
    await client.close();
  }
}

/**
 * Options bag of {@link AccountsNamespace.login}; keys mirror the
 * Python keyword-only parameters.
 */
export interface AccountsLoginOptions {
  /**
   * Launch the system browser; when `false` the authorize URL is printed
   * instead.
   *
   * @defaultValue `true`
   */
  readonly open_browser?: boolean | undefined;
}

/**
 * Run the OAuth browser flow for an `oauth_browser` account and persist
 * its tokens.
 *
 * @remarks
 * The `/me` probe runs on the in-memory bearer
 * ({@link freshBrowserBearer}) and tokens persist only after the region
 * cross-check passes, so a cross-check failure never leaves wrong-region
 * tokens at the user-visible path.
 * @param effects - The effect bag.
 * @param name - Account name; must be an `oauth_browser` account.
 * @param options - `open_browser` (default `true`).
 * @returns The persistence paths, token expiry and user identity.
 * @throws {@link ConfigError} - When the account is unknown, of another
 *   type, or its project lives in a different region.
 * @throws {@link OAuthError} - When the flow fails, or the `/me` probe
 *   fails (`OAUTH_TOKEN_ERROR`).
 * @example
 * ```typescript
 * const result = await accountsLogin(effects, "me", { open_browser: false });
 * // result.tokens_path — where the tokens were written
 * ```
 * @see mixpanel_headless.accounts.login
 */
export async function accountsLogin(
  effects: AuthEffects,
  name: string,
  options: AccountsLoginOptions = {},
): Promise<OAuthLoginResult> {
  const account = effects.config.getAccount(name);
  if (account.type !== "oauth_browser") {
    throw new ConfigError(
      `\`mp account login\` is only valid for oauth_browser accounts; ` +
        `'${name}' is type '${account.type}'.`,
    );
  }

  const tokens = await effects.oauthFlow.login(account.region, {
    openBrowser: options.open_browser ?? true,
  });

  let user: Readonly<Record<string, unknown>> | null = null;
  let chosenProject: string | null = account.default_project ?? null;
  const bearer = freshBrowserBearer(tokens.access_token.reveal());
  let meResp: MeResponse;
  try {
    meResp = await fetchMe(effects, account, { tokenResolver: bearer });
  } catch (error) {
    const rendered = exceptionMessage(error);
    throw new OAuthError(
      `Login succeeded but \`/me\` probe failed: ${rendered}`,
      "OAUTH_TOKEN_ERROR",
      { account_name: name, region: account.region },
      { cause: error },
    );
  }
  if (meResp.user_id !== null && meResp.user_email !== null) {
    user = { id: meResp.user_id, email: meResp.user_email };
  }
  const projectKeys = [...meResp.projects.keys()];
  if (chosenProject === null && projectKeys.length > 0) {
    // `next(iter(sorted(me_resp.projects)))` — the default Array.sort
    // is UTF-16 code-unit order, which coincides with Python's
    // codepoint sort for these all-ASCII digit-string project IDs.
    chosenProject = [...projectKeys].sort()[0] ?? null;
  }
  assertProjectRegionMatches(meResp, chosenProject, account.region);

  // Validation passed — safe to persist.
  const tokensPath = effects.tokenStore.writeTokens(name, tokens);
  if (chosenProject !== null && chosenProject !== account.default_project) {
    effects.config.updateAccount(name, { default_project: chosenProject });
  }

  return new OAuthLoginResult({
    account_name: name,
    user,
    expires_at: tokens.expires_at,
    tokens_path: tokensPath,
    client_path: effects.tokenStore.clientInfoPath(account.region),
  });
}

/**
 * Delete the persisted OAuth tokens for an account.
 *
 * @param effects - The effect bag.
 * @param name - Account name.
 * @throws {@link ConfigError} - When the account is not found.
 * @example
 * ```typescript
 * accountsLogout(effects, "me");
 * ```
 * @see mixpanel_headless.accounts.logout
 */
export function accountsLogout(effects: AuthEffects, name: string): void {
  const summary = accountsShow(effects, name); // raises if missing
  effects.tokenStore.removeTokens(summary.name);
}

/**
 * Return the current bearer token for an OAuth account.
 *
 * @remarks
 * Resolution is per call through the injected {@link TokenResolver},
 * never captured at construction. This is the module's second reveal
 * site.
 * @param effects - The effect bag.
 * @param name - Account name; `null` means the active account.
 * @returns `null` for a `service_account`; the plaintext bearer for the
 *   OAuth types.
 * @throws {@link ConfigError} - When the account is not found.
 * @throws {@link OAuthError} - When the token cannot be resolved.
 * @example
 * ```typescript
 * const bearer = await accountsToken(effects, "me");
 * // "eyJ…" for an OAuth account, null for a service account
 * ```
 * @see mixpanel_headless.accounts.token
 */
export async function accountsToken(
  effects: AuthEffects,
  name: string | null = null,
): Promise<string | null> {
  const summary = accountsShow(effects, name);
  const account = effects.config.getAccount(summary.name);
  if (account.type === "service_account") {
    return null;
  }
  if (account.type === "oauth_browser") {
    return effects.tokenResolver.getBrowserToken(account.name, account.region);
  }
  return effects.tokenResolver.getStaticToken(account);
}

/**
 * Options bag of {@link AccountsNamespace.exportBridge}; keys mirror the
 * Python keyword-only parameters.
 */
export interface ExportBridgeOptions {
  /** Destination path for the bridge file. */
  readonly to: string;
  /**
   * Account to export; `null` means the active account.
   *
   * @defaultValue `null`
   */
  readonly account?: string | null | undefined;
  /**
   * Project ID pinned in the bridge.
   *
   * @defaultValue `null`
   */
  readonly project?: string | null | undefined;
  /**
   * Workspace ID pinned in the bridge.
   *
   * @defaultValue `null`
   */
  readonly workspace?: number | null | undefined;
}

/**
 * Export the named (or active) account as a v2 bridge file.
 *
 * @param effects - The effect bag.
 * @param options - The destination `to`, optional `account`, and
 *   optional `project` / `workspace` pins.
 * @returns The path written (same as `options.to`).
 * @throws {@link ConfigError} - When the account is not found, or no
 *   account is active.
 * @throws {@link OAuthError} - When an `oauth_browser` account has no
 *   tokens.
 * @example
 * ```typescript
 * const path = await accountsExportBridge(effects, {
 *   to: "/tmp/mixpanel-bridge.json",
 *   account: "team",
 * });
 * ```
 * @see mixpanel_headless.accounts.export_bridge
 */
export async function accountsExportBridge(
  effects: AuthEffects,
  options: ExportBridgeOptions,
): Promise<string> {
  // Python `account or cm.get_active().account`: an empty-string account
  // also falls through to the active account (falsy `or`, not nullish).
  const explicitAccount = options.account ?? null;
  const name =
    explicitAccount !== null && explicitAccount !== ""
      ? explicitAccount
      : (effects.config.getActive().account ?? null);
  if (name === null) {
    throw new ConfigError(
      "No account specified and no active account configured.",
    );
  }
  const account = effects.config.getAccount(name);
  const header = effects.config.getCustomHeader();
  const headers = header === null ? null : { [header[0]]: header[1] };
  return effects.bridge.export({
    account,
    to: options.to,
    project: options.project ?? null,
    workspace: options.workspace ?? null,
    headers,
    tokenResolver: effects.tokenResolver,
  });
}

/**
 * Remove the v2 bridge file.
 *
 * @param effects - The effect bag.
 * @param options - `at` (default `null`, the default search paths) names
 *   the file to delete.
 * @returns `true` when a file was deleted.
 * @example
 * ```typescript
 * const removed = accountsRemoveBridge(effects, { at: "/tmp/bridge.json" });
 * ```
 * @see mixpanel_headless.accounts.remove_bridge
 */
export function accountsRemoveBridge(
  effects: AuthEffects,
  options: { readonly at?: string | null | undefined } = {},
): boolean {
  return effects.bridge.remove(options.at ?? null);
}
