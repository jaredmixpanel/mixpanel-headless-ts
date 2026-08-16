/**
 * Core operations of the `mp.accounts` namespace — TS port of
 * `mixpanel_headless/accounts.py` module helpers + the CRUD / probe /
 * bridge functions (`accounts.py:64-1029`; B7-A1 packet §3.1,
 * `b7-packets.md`). The `login_unified` orchestrator (`:1030-2013`)
 * lives in `login-unified.ts` (R7 file conventions — the packet's
 * ~800-line split rule).
 *
 * Every function is pure over the injected {@link AuthEffects} bag
 * (R9.4): Python's fresh `ConfigManager()` per call becomes
 * `effects.config`; `os.environ` becomes `effects.env`; disk and
 * browser I/O route through `effects.tokenStore` / `effects.oauthFlow`
 * / `effects.bridge`.
 *
 * Secret discipline (packet §3.3, pair-B lens): the ONLY reveal sites
 * in this module are (a) {@link freshBrowserBearer} handing the
 * in-memory PKCE bearer to the per-request `TokenResolver` protocol
 * and (b) `token()` returning the plaintext bearer — Python's
 * documented public behavior. Secrets never reach thrown messages or
 * error `details`.
 */

import type {
  Account,
  AccountType,
  Region,
  TokenResolver,
} from "../auth/account.js";
import type { Session } from "../auth/session.js";
import { createMixpanelClient } from "../client/client.js";
import { toNativeJson, type JsonValue } from "../client/json-value.js";
import { MeResponse, type MeProjectInfo } from "../client/me.js";
import {
  ConfigError,
  MixpanelHeadlessError,
  OAuthError,
  ParamTypeError,
} from "../errors.js";
import { Secret } from "../secret.js";
import {
  AccountSummary,
  AccountTestResult,
  OAuthLoginResult,
} from "../types/entities/accounts.js";
import type { AuthEffects } from "./auth-effects.js";
import { defaultAccountName } from "./naming.js";

/**
 * Picker callback contract (`ProjectPicker`, `accounts.py:64-70`). The
 * CLI supplies a TTY-aware implementation; library callers supply
 * their own or pass `null` to fail fast in non-interactive contexts
 * (E-8). Receives the parsed `/me` plus the `(projectId, info)` pairs
 * sorted by (org name, project name), both case-folded.
 */
export type ProjectPicker = (
  me: MeResponse,
  sortedProjects: ReadonlyArray<readonly [string, MeProjectInfo]>,
) => string;

/**
 * Progress handle returned by a {@link ProgressFactory} — the TS
 * spelling of Python's context manager (`__enter__` = the factory
 * call; `__exit__` = {@link end}; packet §3.3 "port as a
 * Disposable-style callback, JSDoc the mapping").
 */
export interface ProgressHandle {
  /** Close the progress indicator (the CM `__exit__` twin). */
  end(): void;
}

/**
 * Progress factory contract (`ProgressFactory`, `accounts.py:71`).
 * Wrapped around the slow `/me` round-trips so a CLI can render a
 * spinner; library callers leave it `null` and the orchestrator
 * substitutes a no-op (the `contextlib.nullcontext` twin).
 */
export type ProgressFactory = (msg: string) => ProgressHandle;

/**
 * The message shown while awaiting `/me`
 * (`_FETCH_ME_PROGRESS_MESSAGE`, `accounts.py:73-81`). Intentionally
 * free of duration estimates (and therefore of digits — the Layer-3
 * suite pins that).
 */
export const FETCH_ME_PROGRESS_MESSAGE =
  "Fetching your projects from Mixpanel...";

/**
 * One-shot {@link TokenResolver} returning a freshly minted PKCE
 * bearer (`_FreshBrowserBearer`, `accounts.py:91-128`).
 *
 * Used to run the post-PKCE `/me` probe BEFORE the access token is
 * persisted, so a region-mismatch failure never leaves wrong-region
 * tokens at the user-visible account path.
 *
 * @param accessToken - The plaintext PKCE bearer just returned from
 *   the flow (reveal site — allowed list, packet §3.3).
 * @returns The in-memory resolver.
 */
export function freshBrowserBearer(accessToken: string): TokenResolver {
  return {
    getBrowserToken: (): Promise<string> => Promise.resolve(accessToken),
    getStaticToken: (): Promise<string> => Promise.resolve(accessToken),
  };
}

/** Options of {@link fetchMe} (Python kwonly params, R3.8). */
export interface FetchMeOptions {
  /** Override the resolver (the post-PKCE pre-persist case). */
  readonly tokenResolver?: TokenResolver | undefined;
  /** Fallback project ID when `account.default_project` is unset. */
  readonly placeholderProject?: string | undefined;
}

/**
 * Run a one-shot `/me` probe against `account` (`_fetch_me`,
 * `accounts.py:150-199`).
 *
 * Builds a short-lived REAL wire client (Caution #15: auth header
 * resolved PER REQUEST through the token resolver, never captured)
 * over the injected fetch, always closing it.
 *
 * @param effects - The effect bag (fetch + default token resolver).
 * @param account - The account to authenticate as.
 * @param options - Resolver override + placeholder project.
 * @returns The parsed {@link MeResponse}.
 * @throws AuthenticationError | OAuthError | QueryError - Propagated
 *   from the underlying `me()` call.
 * @throws ResponseValidationError - Propagated from the model parse.
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
  });
  try {
    // Same `toNativeJson` step every model site performs on wire JSON
    // (lossless-number tokens → native values; `services/me.ts:283`).
    const raw = await client.me();
    return MeResponse.fromDict(toNativeJson(raw as JsonValue));
  } finally {
    await client.close();
  }
}

/**
 * Lookup table for {@link domainToRegion} (`_DOMAIN_TO_REGION`,
 * `accounts.py:304-311`).
 */
const DOMAIN_TO_REGION: Readonly<Record<string, Region>> = {
  "mixpanel.com": "us",
  "eu.mixpanel.com": "eu",
  "in.mixpanel.com": "in",
};

/**
 * Map a Mixpanel project `domain` string to its region
 * (`_domain_to_region`, `accounts.py:314-349`).
 *
 * @param domain - Project domain string (host, optionally with
 *   protocol / path). Export hosts' `data-` / `data.` prefixes are
 *   normalized to the canonical query-host form.
 * @returns `"us"` / `"eu"` / `"in"` for recognized hosts, `null`
 *   otherwise (callers skip the cross-check rather than misclassify).
 *
 * @example
 * ```typescript
 * domainToRegion("eu.mixpanel.com");            // "eu"
 * domainToRegion("https://mixpanel.com/path");  // "us"
 * domainToRegion("data-eu.mixpanel.com");       // "eu"
 * domainToRegion("foo.example.com");            // null
 * ```
 */
export function domainToRegion(domain: string): Region | null {
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
 * Raise `ConfigError` E-2 when a picked project lives in a different
 * cluster (`_assert_project_region_matches`, `accounts.py:201-239`).
 *
 * No-op when `chosenProject` is unset, missing from `/me`, or carries
 * no `domain` field (older payloads).
 *
 * @param me - Parsed `/me` response.
 * @param chosenProject - The project ID the orchestrator selected.
 * @param authRegion - The region the credential authenticated against.
 * @throws ConfigError - Mismatch between `authRegion` and the
 *   project's cluster (E-2 catalog wording).
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
      `${chosenProject} (${String(projInfo.name)}) lives in the ` +
      `${projectRegion} cluster (${domain}).\n\n` +
      `Re-run with the correct region:\n` +
      `    mp login --region ${projectRegion}`,
  );
}

/**
 * Build an `AccountTestResult` for a failed `/me` probe
 * (`_build_test_failure_result`, `accounts.py:242-275`).
 *
 * Preserves `code` / `details` when the failure was a library error;
 * non-library exceptions carry only the human-readable `error` string.
 *
 * @param accountName - The account that was tested.
 * @param prefix - Context prefix for the `error` field.
 * @param exc - The exception that was caught.
 * @returns A populated failure result (`ok=false`).
 */
export function buildTestFailureResult(
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
  const rendered = exc instanceof Error ? exc.message : String(exc);
  return new AccountTestResult({
    account_name: accountName,
    ok: false,
    error: `${prefix}: ${rendered}`,
    error_code: errorCode,
    error_details: errorDetails,
  });
}

/**
 * List all configured accounts (`list`, `accounts.py:352-358`).
 *
 * @param effects - The effect bag.
 * @returns Sorted-by-name summaries.
 */
export function accountsList(effects: AuthEffects): AccountSummary[] {
  return effects.config.listAccounts();
}

/** Options bag of {@link accountsAdd} (Python kwonly, R3.8). */
export interface AccountsAddOptions {
  /** Account type discriminator. */
  readonly type: AccountType;
  /** Region; may be omitted only for `oauth_browser`. */
  readonly region?: Region | null | undefined;
  /** Optional home project (digit string). */
  readonly default_project?: string | null | undefined;
  /** SA username. */
  readonly username?: string | null | undefined;
  /** SA secret. */
  readonly secret?: Secret | string | null | undefined;
  /** oauth_token inline bearer (XOR `token_env`). */
  readonly token?: Secret | string | null | undefined;
  /** oauth_token env-var name (XOR `token`). */
  readonly token_env?: string | null | undefined;
  /** Derive the name from `/me` (mutually exclusive with `name`). */
  readonly derive_name?: boolean | undefined;
}

/**
 * Add a new account (`add`, `accounts.py:361-490`).
 *
 * Per 043 FR-001 `default_project` is optional for every type; per
 * FR-045 the first account auto-promotes to `[active].account` (inside
 * the config effect's single transaction).
 *
 * @param effects - The effect bag.
 * @param name - Account name; required unless `derive_name` is set.
 * @param options - Typed credential fields + `derive_name`.
 * @returns The new account's summary.
 * @throws ParamTypeError - `derive_name` with explicit `name`, or
 *   neither (the Python `TypeError` twin, R5.5).
 * @throws ConfigError - Validation failure, duplicate name,
 *   `region` omitted for a non-browser type, or `derive_name` for
 *   `oauth_browser`.
 */
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
  // Per 043 plan §"Library-First": probing lives in the CLI layer; the
  // library API refuses to invent a region (`accounts.py:435-441`).
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
    // (the Python `assert name is not None`, `accounts.py:470`).
    throw new ParamTypeError("`name` is required unless `derive_name=True`.");
  }

  // First-account promotion happens INSIDE the config effect's single
  // transaction (packet §3.3: never two effect calls where Python
  // makes one `_mutate()` block — `accounts.py:472-489`).
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

/** Arguments of {@link deriveAccountNameForCredential} (kwonly, R3.8). */
export interface DeriveNameArgs {
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
 * Build a temporary account, fetch `/me`, derive a unique name
 * (`_derive_account_name_for_credential`, `accounts.py:493-587`).
 *
 * @param effects - The effect bag.
 * @param args - Credential material.
 * @returns A unique account name suitable for persistence.
 * @throws ConfigError - Missing credential material for the type.
 * @throws AuthenticationError | OAuthError | QueryError - Propagated
 *   from the `/me` call.
 */
export async function deriveAccountNameForCredential(
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
    } else if (args.token_env !== null) {
      tempAccount = {
        type: "oauth_token",
        name: placeholderName,
        region: args.region,
        token_env: args.token_env,
        default_project: placeholderProject,
      };
    } else {
      throw new ConfigError(
        "oauth_token requires `token` or `token_env` to derive a name.",
      );
    }
  } else {
    // Control-flow invariant (`accounts.py:580-583`, pragma no cover):
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

/** Options bag of {@link accountsUpdate} (Python kwonly, R3.8). */
export interface AccountsUpdateOptions {
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
  /** New env-var name (oauth_token only). */
  readonly token_env?: string | null | undefined;
}

/**
 * Update fields on an existing account in place (`update`,
 * `accounts.py:590-630`). Type cannot change.
 *
 * @param effects - The effect bag.
 * @param name - Account to update.
 * @param options - Fields to rewrite.
 * @returns The updated summary.
 * @throws ConfigError - Missing account, type-incompatible field, or
 *   validation failure.
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
 * Remove an account (`remove`, `accounts.py:633-648`).
 *
 * @param effects - The effect bag.
 * @param name - Account name.
 * @param options - `force` removes even when targets reference it.
 * @returns Orphaned target names (empty unless forced with refs).
 * @throws ConfigError - Missing account.
 * @throws AccountInUseError - Referenced and not forced.
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
 * Switch the active account, clearing any prior workspace pin (`use`,
 * `accounts.py:651-675`).
 *
 * Both writes land in the config effect's SINGLE transaction
 * (`workspace: null` clears — packet §3.3 atomicity rule).
 *
 * @param effects - The effect bag.
 * @param name - Account to make active.
 * @throws ConfigError - Account does not exist.
 */
export function accountsUse(effects: AuthEffects, name: string): void {
  effects.config.setActive({ account: name, workspace: null });
}

/**
 * Return the named account summary, or the active one (`show`,
 * `accounts.py:677-698`).
 *
 * @param effects - The effect bag.
 * @param name - Account name; `null` means the active account.
 * @returns The summary.
 * @throws ConfigError - Account not found OR no active account.
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
 * Probe `/me` for the named account, never raising (`test`,
 * `accounts.py:701-779`).
 *
 * @param effects - The effect bag.
 * @param name - Account to test; `null` means the active account.
 * @returns `ok=true` with `user` populated on success; `ok=false` with
 *   `error` (and coded fields for library errors) on any failure.
 */
export async function accountsTest(
  effects: AuthEffects,
  name: string | null = null,
): Promise<AccountTestResult> {
  let summary: AccountSummary;
  try {
    summary = accountsShow(effects, name);
  } catch (exc) {
    if (exc instanceof ConfigError) {
      return new AccountTestResult({
        // Python `name or "(none)"` (`accounts.py:727`) — the empty
        // string ALSO defaults (falsy-`or`, not nullish;
        // `b7-reviewA-resolution.md` SEM-F1).
        account_name: name !== null && name !== "" ? name : "(none)",
        ok: false,
        error: exc.message,
      });
    }
    throw exc;
  }

  let account: Account;
  try {
    account = effects.config.getAccount(summary.name);
  } catch (exc) {
    // Pragma-no-cover twin (`accounts.py:733`) — show() already
    // validated existence.
    if (exc instanceof ConfigError) {
      return new AccountTestResult({
        account_name: summary.name,
        ok: false,
        error: exc.message,
      });
    }
    throw exc;
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
  });
  try {
    let meRaw: unknown;
    try {
      meRaw = await client.me();
    } catch (exc) {
      // Broad catch — capture every failure mode (`accounts.py:755`).
      return buildTestFailureResult(summary.name, "/me probe failed", exc);
    }
    let meResp: MeResponse;
    try {
      meResp = MeResponse.fromDict(toNativeJson(meRaw as JsonValue));
    } catch (exc) {
      return buildTestFailureResult(
        summary.name,
        "/me response could not be parsed",
        exc,
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

/** Options bag of {@link accountsLogin} (Python kwonly, R3.8). */
export interface AccountsLoginOptions {
  /** Launch the system browser (default `true`). */
  readonly open_browser?: boolean | undefined;
}

/**
 * Run the OAuth browser flow for an `oauth_browser` account (`login`,
 * `accounts.py:782-875`).
 *
 * Ordering is the atomic-publish discipline: the `/me` probe runs on
 * the IN-MEMORY bearer ({@link freshBrowserBearer}) and tokens persist
 * only after the E-2 cross-check passes — a cross-check failure never
 * leaves wrong-region tokens at the user-visible path
 * (`test_login_region_check.py:111-138`).
 *
 * @param effects - The effect bag.
 * @param name - Account name (must be `oauth_browser`).
 * @param options - `open_browser` toggle.
 * @returns The persistence paths, token expiry, and user identity.
 * @throws ConfigError - Unknown account, wrong type, or E-2 mismatch.
 * @throws OAuthError - Flow failure, or `/me` probe failure
 *   (`OAUTH_TOKEN_ERROR`).
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
  } catch (exc) {
    const rendered = exc instanceof Error ? exc.message : String(exc);
    throw new OAuthError(
      `Login succeeded but \`/me\` probe failed: ${rendered}`,
      "OAUTH_TOKEN_ERROR",
      { account_name: name, region: account.region },
      { cause: exc },
    );
  }
  if (meResp.user_id !== null && meResp.user_email !== null) {
    user = { id: meResp.user_id, email: meResp.user_email };
  }
  const projectKeys = [...meResp.projects.keys()];
  if (chosenProject === null && projectKeys.length > 0) {
    // `next(iter(sorted(me_resp.projects)))` (`accounts.py:856`) —
    // default Array.sort is UTF-16 code-UNIT order, which coincides
    // with Python's codepoint sort for these all-ASCII digit-string
    // project IDs (`b7-reviewA-resolution.md` SEM-N3).
    chosenProject = [...projectKeys].sort()[0] ?? null;
  }
  assertProjectRegionMatches(meResp, chosenProject, account.region);

  // Validation passed — safe to persist (`accounts.py:863-867`).
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
 * Remove the on-disk OAuth tokens for an account (`logout`,
 * `accounts.py:916-928`).
 *
 * @param effects - The effect bag.
 * @param name - Account name.
 * @throws ConfigError - Account not found.
 */
export function accountsLogout(effects: AuthEffects, name: string): void {
  const summary = accountsShow(effects, name); // raises if missing
  effects.tokenStore.removeTokens(summary.name);
}

/**
 * Return the current bearer token for an OAuth account (`token`,
 * `accounts.py:931-959`).
 *
 * Resolution is PER CALL through the injected {@link TokenResolver}
 * (R2.9 — never captured at construction).
 *
 * @param effects - The effect bag.
 * @param name - Account name; `null` means the active account.
 * @returns `null` for `service_account`; the plaintext bearer for the
 *   OAuth types (a documented reveal site, packet §3.3).
 * @throws ConfigError - Account not found.
 * @throws OAuthError - Token cannot be resolved.
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

/** Options bag of {@link accountsExportBridge} (Python kwonly, R3.8). */
export interface ExportBridgeOptions {
  /** Destination path for the bridge file. */
  readonly to: string;
  /** Account to export; `null` means the active account. */
  readonly account?: string | null | undefined;
  /** Optional pinned project ID. */
  readonly project?: string | null | undefined;
  /** Optional pinned workspace ID. */
  readonly workspace?: number | null | undefined;
}

/**
 * Export the named (or active) account as a v2 bridge file
 * (`export_bridge`, `accounts.py:963-1010`).
 *
 * @param effects - The effect bag.
 * @param options - Destination + optional account / pins.
 * @returns The path written (same as `options.to`).
 * @throws ConfigError - Account not found, or no active account.
 * @throws OAuthError - `oauth_browser` account with no tokens.
 */
export async function accountsExportBridge(
  effects: AuthEffects,
  options: ExportBridgeOptions,
): Promise<string> {
  // Python `account or cm.get_active().account` (`accounts.py:997`) —
  // an EMPTY-string account also falls through to the active account
  // (falsy-`or`, not nullish; `b7-reviewA-resolution.md` SEM-F1).
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
  const headers = header !== null ? { [header[0]]: header[1] } : null;
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
 * Remove the v2 bridge file (`remove_bridge`, `accounts.py:1013-1027`).
 *
 * @param effects - The effect bag.
 * @param options - `at` overrides the default search paths.
 * @returns `true` if a file was deleted.
 */
export function accountsRemoveBridge(
  effects: AuthEffects,
  options: { readonly at?: string | null | undefined } = {},
): boolean {
  return effects.bridge.remove(options.at ?? null);
}
