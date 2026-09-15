/**
 * The `login_unified` orchestrator: auth-type detection, the region
 * probe, `/me`-driven project resolution and name derivation, and the
 * re-login state machine, all over the injected {@link AuthEffects} bag.
 * Where Python's browser flow stages PKCE tokens in a hidden
 * `.tmp-{nonce}/` directory and renames it into place after validation,
 * the port keeps them in memory until the region cross-check and name
 * resolution succeed, then persists once — same observable contract (no
 * tokens at the user-visible path on failure; rollback if `add()` fails).
 *
 * @see mixpanel_headless.accounts.login_unified
 */

import type { Account, AccountType, Region } from "../auth/account.js";
import { probeRegionForCredential } from "../auth/region-probe.js";
import type { MeProjectInfo, MeResponse } from "../client/me.js";
import { compareCodepoints } from "../compat/codepoint.js";
import {
  AccountExistsError,
  ConfigError,
  InvalidArgumentError,
  ProjectNotFoundError,
} from "../errors.js";
import { Secret } from "../secret.js";
import { AccountSummary } from "../types/entities/accounts.js";
import {
  accountsAdd,
  accountsLogin,
  accountsShow,
  accountsUse,
  assertProjectRegionMatches,
  FETCH_ME_PROGRESS_MESSAGE,
  fetchMe,
  freshBrowserBearer,
  type ProgressFactory,
  type ProgressHandle,
  type ProjectPicker,
} from "./accounts-ops.js";
import type { AuthEffects } from "./auth-effects.js";
import { defaultAccountName } from "./naming.js";

/** Account-name constraint (the twin of Python's `account_dir` guard). */
const ACCOUNT_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/** Options bag of {@link loginUnified} (Python keyword-only parameters). */
export interface LoginUnifiedOptions {
  /** Explicit local account name (wins over derived names). */
  readonly name?: string | null | undefined;
  /** Explicit region; `null` probes (SA/token) or defaults `us` (browser). */
  readonly region?: Region | null | undefined;
  /** Explicit project ID (must exist in `/me`). */
  readonly project?: string | null | undefined;
  /** Explicit auth-type override (detection priority 1). */
  readonly account_type?: AccountType | null | undefined;
  /** For oauth_browser: print the authorize URL instead of launching. */
  readonly no_browser?: boolean | undefined;
  /** For service_account: read the secret from stdin. */
  readonly secret_stdin?: boolean | undefined;
  /** For oauth_token: env-var name carrying the bearer. */
  readonly token_env?: string | null | undefined;
  /** CLI `--service-account` mirror (forces the SA type). */
  readonly service_account?: boolean | undefined;
  /** Picker callback for the multi-project case (required when `/me` lists several projects). */
  readonly project_picker?: ProjectPicker | null | undefined;
  /** Progress factory wrapped around the `/me` round-trip. */
  readonly progress?: ProgressFactory | null | undefined;
}

/**
 * Resolve which auth flow to drive (Python `_detect_login_type`).
 *
 * Priority: explicit `account_type` → `token_env` → the
 * `MP_USERNAME`+`MP_SECRET` env pair → `MP_OAUTH_TOKEN` env →
 * `oauth_browser`. Env truthiness is Python `os.environ.get(...)` —
 * an empty string counts as absent.
 *
 * @param effects - The effect bag (env reads).
 * @param accountType - Explicit override.
 * @param tokenEnv - When set, forces `oauth_token`.
 * @returns The detected auth type.
 */
function detectLoginType(
  effects: AuthEffects,
  accountType: AccountType | null,
  tokenEnv: string | null,
): AccountType {
  if (accountType !== null) {
    return accountType;
  }
  if (tokenEnv !== null) {
    return "oauth_token";
  }
  const truthy = (name: string): boolean => {
    const value = effects.env.get(name);
    return value !== undefined && value !== "";
  };
  if (truthy("MP_USERNAME") && truthy("MP_SECRET")) {
    return "service_account";
  }
  if (truthy("MP_OAUTH_TOKEN")) {
    return "oauth_token";
  }
  return "oauth_browser";
}

/**
 * Apply the project-selection priority chain (Python
 * `_resolve_project`).
 *
 * Priority: explicit `project` → `MP_PROJECT_ID` env (hard-fail when
 * stale) → single-project auto-pick → picker callback (a `ConfigError`
 * when several projects are visible and no picker was supplied). The
 * picker list is sorted by `(org name, project name)`, both lowercased;
 * unknown org IDs sink to the bottom via the `~org {id}` synthetic key.
 *
 * @param effects - The effect bag (the `MP_PROJECT_ID` read).
 * @param me - Parsed `/me` response.
 * @param explicitProject - The `project` argument (priority 1).
 * @param projectPicker - Picker callback for the multi-project case.
 * @returns The resolved project ID, or `null` with zero projects.
 * @throws ProjectNotFoundError - Explicit `project` not in `/me`.
 * @throws ConfigError - Stale `MP_PROJECT_ID`, or several projects with
 *   no picker.
 */
function resolveProjectForLogin(
  effects: AuthEffects,
  me: MeResponse,
  explicitProject: string | null,
  projectPicker: ProjectPicker | null,
): string | null {
  const projects = me.projects;
  // Insertion-order keys (the Python dict iteration) — the ReadonlyMap
  // preserves `/me` source order, so the "Accessible
  // projects:" listings below match Python's line order exactly.
  const projectKeys = [...projects.keys()];

  if (explicitProject !== null) {
    if (projects.has(explicitProject)) {
      return explicitProject;
    }
    throw new ProjectNotFoundError(explicitProject, projectKeys);
  }

  const envProject = effects.env.get("MP_PROJECT_ID");
  if (envProject !== undefined && envProject !== "") {
    if (projects.has(envProject)) {
      return envProject;
    }
    const accessibleLines = projectKeys
      .map((pid) => {
        const info = projects.get(pid) as MeProjectInfo;
        const domain =
          info.domain !== null && info.domain !== ""
            ? info.domain
            : "(no domain)";
        return `  - ${pid} : ${info.name} (${domain})`;
      })
      .join("\n");
    throw new ConfigError(
      `MP_PROJECT_ID=${envProject} is not visible to this account.\n\n` +
        `Accessible projects:\n${accessibleLines}\n\n` +
        `Either unset MP_PROJECT_ID, or pass --project ID with a ` +
        `visible value. (Subsequent \`mp\` calls would otherwise read ` +
        `MP_PROJECT_ID first and silently fail with auth errors.)`,
    );
  }

  if (projectKeys.length === 1) {
    return projectKeys[0] ?? null;
  }
  if (projectKeys.length === 0) {
    return null;
  }

  if (projectPicker === null) {
    const accessibleLines = projectKeys
      .map((pid) => {
        const info = projects.get(pid) as MeProjectInfo;
        const domain =
          info.domain !== null && info.domain !== ""
            ? info.domain
            : "(no domain)";
        return `  - ${pid} : ${info.name} (${domain})`;
      })
      .join("\n");
    throw new ConfigError(
      `Multiple projects accessible to this account; no default could ` +
        `be picked.\n\n` +
        `Accessible projects:\n${accessibleLines}\n\n` +
        `Pass --project ID to select one explicitly, or set MP_PROJECT_ID.`,
    );
  }

  const sortKey = (info: MeProjectInfo): readonly [string, string] => {
    const org = me.organizations.get(String(info.organization_id));
    // Org and project names are required `str` fields of the /me models
    // (the parser rejects null before this runs), so `.toLowerCase()`
    // is total here, as `.lower()` is in Python.
    const orgName =
      org === undefined ? `~org ${String(info.organization_id)}` : org.name;
    return [orgName.toLowerCase(), info.name.toLowerCase()];
  };
  // Stable sort over insertion-order entries: picker-list tie order for
  // case-folded (org, name) collisions matches Python's `sorted(...)`
  // stability over dict order.
  const sortedProjects = [...projects]
    .map(([pid, info]) => [pid, info] as const)
    .sort((a, b) => {
      const [aOrg, aName] = sortKey(a[1]);
      const [bOrg, bName] = sortKey(b[1]);
      return compareCodepoints(aOrg, bOrg) || compareCodepoints(aName, bName);
    });
  return projectPicker(me, sortedProjects);
}

/**
 * Return a copy of `summary` with `/me`-derived fields filled in
 * (Python `_summary_with_me`).
 *
 * @param summary - The base summary from `add` / `show`.
 * @param me - Parsed `/me` response.
 * @param projectId - Resolved project ID (or `null`).
 * @returns A new summary carrying `user_email` / `project_id` /
 *   `project_name`.
 */
function summaryWithMe(
  summary: AccountSummary,
  me: MeResponse,
  projectId: string | null,
): AccountSummary {
  let projectName: string | null = null;
  if (projectId !== null && me.projects.has(projectId)) {
    projectName = (me.projects.get(projectId) as MeProjectInfo).name;
  }
  return new AccountSummary({
    name: summary.name,
    type: summary.type,
    region: summary.region,
    status: summary.status,
    is_active: summary.is_active,
    referenced_by_targets: summary.referenced_by_targets,
    user_email: me.user_email,
    project_id: projectId,
    project_name: projectName,
  });
}

/**
 * Run `fn` inside a progress handle (the Python `with progress(msg):`
 * twin — enter = factory call, exit = `end()` in a `finally`).
 *
 * @param progress - The factory.
 * @param msg - The progress message.
 * @param fn - The wrapped work.
 * @returns The work's result.
 * @internal
 */
async function withProgress<T>(
  progress: ProgressFactory,
  msg: string,
  fn: () => Promise<T>,
): Promise<T> {
  const handle: ProgressHandle = progress(msg);
  try {
    return await fn();
  } finally {
    handle.end();
  }
}

/**
 * Add and activate a Mixpanel account in one orchestrated call (Python
 * `login_unified`).
 *
 * See the Python docstring for the full state machine.
 *
 * @param effects - The effect bag.
 * @param options - The orchestrator flags.
 * @returns The new/refreshed account's summary with `user_email` /
 *   `project_id` / `project_name` populated from `/me`.
 * @throws InvalidArgumentError - Mutually-incompatible flags
 *   (`violation` + `detected_auth_type` in details; CLI exit 3).
 * @throws ConfigError - Region mismatch, auth-type or region change on
 *   re-login, stale `MP_PROJECT_ID`, several projects with no picker,
 *   or missing env credentials.
 * @throws AccountExistsError - Derived name collides (browser flow).
 * @throws ProjectNotFoundError - Explicit `project` not in `/me`.
 * @throws OAuthError - PKCE failure; `RegionProbeError` /
 *   `RegionProbeNetworkError` propagate from the probe.
 */
// eslint-disable-next-line complexity -- branch-for-branch port of one Python function (see the docblock); splitting it would scatter the guard order the corpus pins
export async function loginUnified(
  effects: AuthEffects,
  options: LoginUnifiedOptions = {},
): Promise<AccountSummary> {
  const name = options.name ?? null;
  const region = options.region ?? null;
  const project = options.project ?? null;
  let accountType = options.account_type ?? null;
  const noBrowser = options.no_browser ?? false;
  const secretStdin = options.secret_stdin ?? false;
  const tokenEnv = options.token_env ?? null;
  const serviceAccount = options.service_account ?? false;
  const projectPicker = options.project_picker ?? null;

  // Fold the CLI's --service-account flag into `account_type`.
  if (serviceAccount) {
    if (accountType !== null && accountType !== "service_account") {
      throw new InvalidArgumentError(
        `--service-account conflicts with explicit account_type=` +
          `'${accountType}'.`,
        { violation: "mutually_exclusive", detectedAuthType: accountType },
      );
    }
    if (tokenEnv !== null) {
      throw new InvalidArgumentError(
        "--service-account and --token-env are mutually exclusive.\n\n" +
          "Pick one auth type:\n" +
          "    mp login --service-account\n" +
          "    mp login --token-env MY_OAUTH_TOKEN_VAR",
        {
          violation: "mutually_exclusive",
          detectedAuthType: "service_account",
        },
      );
    }
    accountType = "service_account";
  }

  const detectedType = detectLoginType(effects, accountType, tokenEnv);

  // Per-flag misuse — fail fast before any I/O.
  if (noBrowser && detectedType !== "oauth_browser") {
    throw new InvalidArgumentError(
      `--no-browser is only meaningful for the oauth_browser auth ` +
        `type.\n\nDetected auth type: ${detectedType}.`,
      { violation: "no_browser_misuse", detectedAuthType: detectedType },
    );
  }
  if (secretStdin && detectedType !== "service_account") {
    throw new InvalidArgumentError(
      `--secret-stdin is only meaningful for the service_account ` +
        `auth type.\n\nDetected auth type: ${detectedType}.`,
      { violation: "secret_stdin_misuse", detectedAuthType: detectedType },
    );
  }

  // Default progress to the `contextlib.nullcontext` twin.
  const progress: ProgressFactory =
    options.progress ??
    ((): ProgressHandle => ({
      end: (): void => {
        // no-op (contextlib.nullcontext twin)
      },
    }));

  let summary: AccountSummary;
  let existing: Account | null = null;
  if (name !== null) {
    try {
      existing = effects.config.getAccount(name);
    } catch (error) {
      if (!(error instanceof ConfigError)) {
        throw error;
      }
      existing = null;
    }
  }
  if (existing !== null && name !== null) {
    summary = await loginUnifiedRelogin(effects, {
      existing,
      requested_type: detectedType,
      requested_region: region,
      project,
      no_browser: noBrowser,
      secret_stdin: secretStdin,
      token_env: tokenEnv,
      progress,
    });
  } else if (detectedType === "oauth_browser") {
    summary = await loginUnifiedNewBrowser(effects, {
      name,
      region,
      project,
      no_browser: noBrowser,
      project_picker: projectPicker,
      progress,
    });
  } else {
    summary = await loginUnifiedNewCredential(effects, {
      name,
      detected_type: detectedType,
      region,
      project,
      secret_stdin: secretStdin,
      token_env: tokenEnv,
      project_picker: projectPicker,
      progress,
    });
  }

  // Activate (new or refreshed) so library callers see the documented
  // "Add and activate" semantics.
  accountsUse(effects, summary.name);
  return summary;
}

/** Arguments of {@link loginUnifiedRelogin} (Python keyword-only parameters). */
interface ReloginArgs {
  readonly existing: Account;
  readonly requested_type: AccountType;
  readonly requested_region: Region | null;
  readonly project: string | null;
  readonly no_browser: boolean;
  readonly secret_stdin: boolean;
  readonly token_env: string | null;
  readonly progress: ProgressFactory;
}

/**
 * Refresh an existing account's credentials per the re-login state
 * machine (Python `_login_unified_relogin`).
 *
 * @param effects - The effect bag.
 * @param args - The re-login inputs.
 * @returns The refreshed account's summary.
 * @throws ConfigError - Region change, auth-type change, or missing
 *   env/stdin credentials.
 */
// eslint-disable-next-line complexity -- branch-for-branch port of one Python function (see the docblock); splitting it would scatter the guard order the corpus pins
async function loginUnifiedRelogin(
  effects: AuthEffects,
  args: ReloginArgs,
): Promise<AccountSummary> {
  const existingAccount = args.existing;
  const name = existingAccount.name;

  // Refuse an auth-type change on re-login.
  if (args.requested_type !== existingAccount.type) {
    const flagMap: Readonly<Record<string, string>> = {
      service_account: "--service-account",
      oauth_browser: "(no flag)",
      oauth_token: "--token-env MP_OAUTH_TOKEN",
    };
    throw new ConfigError(
      (
        `Account '${name}' is type '${existingAccount.type}'; cannot ` +
        `re-login as type '${args.requested_type}'.\n\n` +
        `To change the auth type, remove the existing account first:\n` +
        `    mp account remove ${name}\n` +
        `    mp login ${flagMap[args.requested_type] ?? ""}`
      ).trimEnd(),
    );
  }

  // Refuse a region change on re-login.
  if (
    args.requested_region !== null &&
    args.requested_region !== existingAccount.region
  ) {
    throw new ConfigError(
      `Account '${name}' is bound to region '${existingAccount.region}'; ` +
        `cannot change to '${args.requested_region}' on re-login.\n\n` +
        `To switch regions, remove the existing account first:\n` +
        `    mp account remove ${name}\n` +
        `    mp login --region ${args.requested_region}`,
    );
  }

  // Informational note when --project is passed but ignored.
  if (args.project !== null) {
    effects.narrate(
      `note: --project ignored on re-login; use 'mp project use ` +
        `${args.project}' to change the active project (currently ` +
        `${String(existingAccount.default_project ?? null)}).`,
    );
  }

  if (args.requested_type === "oauth_browser") {
    await accountsLogin(effects, name, { open_browser: !args.no_browser });
  } else if (args.requested_type === "service_account") {
    const username = effects.env.get("MP_USERNAME");
    if (username === undefined || username === "") {
      throw new ConfigError(
        "MP_USERNAME is not set. Re-login for service_account requires " +
          "MP_USERNAME in the environment.",
      );
    }
    const secretRaw = args.secret_stdin
      ? effects.readSecretStdin()
      : (effects.env.get("MP_SECRET") ?? "");
    if (secretRaw === "") {
      throw new ConfigError(
        "MP_SECRET is not set (or stdin is empty). Pipe the secret " +
          "via --secret-stdin or set MP_SECRET in the environment.",
      );
    }
    effects.config.updateAccount(name, {
      username,
      secret: new Secret(secretRaw),
    });
  } else {
    // oauth_token: preserve the persisted storage mode (inline token vs
    // env pointer) unless the caller explicitly re-points it.
    const existingTokenEnv =
      existingAccount.type === "oauth_token"
        ? (existingAccount.token_env ?? null)
        : null;
    let envName: string;
    if (args.token_env !== null) {
      envName = args.token_env;
    } else if (existingTokenEnv === null) {
      envName = "MP_OAUTH_TOKEN";
    } else {
      envName = existingTokenEnv;
    }
    const bearer = effects.env.get(envName);
    if (bearer === undefined || bearer === "") {
      throw new ConfigError(
        `Env var '${envName}' is unset. Pass --token-env NAME with ` +
          `the bearer in NAME, or set ${envName} in the environment.`,
      );
    }
    if (args.token_env !== null) {
      effects.config.updateAccount(name, { token_env: args.token_env });
    } else if (existingTokenEnv === null) {
      effects.config.updateAccount(name, { token: new Secret(bearer) });
    } else {
      effects.config.updateAccount(name, { token_env: existingTokenEnv });
    }
  }

  // /me refresh + cache write.
  const refreshed = effects.config.getAccount(name);
  const meResp = await withProgress(
    args.progress,
    FETCH_ME_PROGRESS_MESSAGE,
    () => fetchMe(effects, refreshed),
  );
  await effects.meCache.put(name, meResp);
  const projectId = refreshed.default_project ?? null;
  return summaryWithMe(accountsShow(effects, name), meResp, projectId);
}

/** Arguments of {@link loginUnifiedNewBrowser} (Python keyword-only parameters). */
interface NewBrowserArgs {
  readonly name: string | null;
  readonly region: Region | null;
  readonly project: string | null;
  readonly no_browser: boolean;
  readonly project_picker: ProjectPicker | null;
  readonly progress: ProgressFactory;
}

/**
 * The oauth_browser new-account flow (Python
 * `_login_unified_new_browser`; see the module header for why the
 * tokens are staged in memory rather than in a placeholder directory).
 *
 * @param effects - The effect bag.
 * @param args - The flow inputs.
 * @returns The new account's summary.
 * @throws AccountExistsError - Resolved name collides.
 * @throws ConfigError - Invalid derived name, orphaned account state,
 *   or region mismatch.
 */
async function loginUnifiedNewBrowser(
  effects: AuthEffects,
  args: NewBrowserArgs,
): Promise<AccountSummary> {
  const authRegion: Region = args.region ?? "us";

  const tokens = await effects.oauthFlow.login(authRegion, {
    openBrowser: !args.no_browser,
  });

  // /me probe via a temporary account + the in-memory bearer.
  const tempAccount: Account = {
    type: "oauth_browser",
    name: "_tmp_login_unified_",
    region: authRegion,
    default_project: "0",
  };
  const meResp = await withProgress(
    args.progress,
    FETCH_ME_PROGRESS_MESSAGE,
    () =>
      fetchMe(effects, tempAccount, {
        tokenResolver: freshBrowserBearer(tokens.access_token.reveal()),
      }),
  );

  const chosenProject = resolveProjectForLogin(
    effects,
    meResp,
    args.project,
    args.project_picker,
  );

  // Region cross-check before any persistence.
  assertProjectRegionMatches(meResp, chosenProject, authRegion);

  // Resolve the account name (--name wins; otherwise derive).
  const existingNames = new Set(
    effects.config.listAccounts().map((summary) => summary.name),
  );
  const finalName = args.name ?? defaultAccountName(meResp, existingNames);
  if (existingNames.has(finalName)) {
    throw new AccountExistsError(finalName);
  }
  // Path-safety twin of Python's `account_dir()` validation — reject
  // before any persistence.
  if (!ACCOUNT_NAME_PATTERN.test(finalName)) {
    throw new ConfigError(
      `Invalid account name '${finalName}': must match ` +
        "`^[a-zA-Z0-9_-]{1,64}$`.",
    );
  }

  // Orphan-state guard: per-account state exists without a config record
  // (the config collision already raised AccountExistsError above), so
  // refuse rather than silently overwrite.
  // Divergence: the message names the account where Python prints the
  // directory path — the in-memory seam has no path. Same ConfigError
  // class and code.
  if (effects.tokenStore.accountDirExists(finalName)) {
    throw new ConfigError(
      `Final account directory for '${finalName}' already exists. Run ` +
        `\`mp account remove ${finalName}\` first or pass --name.`,
    );
  }

  // Validation passed — persist tokens, then the account record; a
  // failure inside add()/cache rolls the published dir back.
  effects.tokenStore.writeTokens(finalName, tokens);
  try {
    const summary = await accountsAdd(effects, finalName, {
      type: "oauth_browser",
      region: authRegion,
      default_project: chosenProject,
    });
    await effects.meCache.put(finalName, meResp);
    return summaryWithMe(summary, meResp, chosenProject);
  } catch (error) {
    effects.tokenStore.removeAccountDir(finalName);
    throw error;
  }
}

/** Arguments of {@link loginUnifiedNewCredential} (Python keyword-only parameters). */
interface NewCredentialArgs {
  readonly name: string | null;
  readonly detected_type: AccountType;
  readonly region: Region | null;
  readonly project: string | null;
  readonly secret_stdin: boolean;
  readonly token_env: string | null;
  readonly project_picker: ProjectPicker | null;
  readonly progress: ProgressFactory;
}

/**
 * The service-account / oauth_token new-account flow (Python
 * `_login_unified_new_credential`).
 *
 * @param effects - The effect bag.
 * @param args - The flow inputs.
 * @returns The new account's summary.
 * @throws ConfigError - Missing env credentials, or picker failures.
 * @throws RegionProbeError - No region accepted the credential.
 */
// eslint-disable-next-line max-lines-per-function -- branch-for-branch port of one Python function (see the docblock); splitting it would scatter the guard order the corpus pins
async function loginUnifiedNewCredential(
  effects: AuthEffects,
  args: NewCredentialArgs,
): Promise<AccountSummary> {
  // Credential collection.
  let username: string | null = null;
  let secret: Secret | null = null;
  let token: Secret | null = null;
  let resolvedTokenEnv: string | null = null;
  if (args.detected_type === "service_account") {
    const envUsername = effects.env.get("MP_USERNAME");
    if (envUsername === undefined || envUsername === "") {
      throw new ConfigError(
        "MP_USERNAME is not set. Pass --service-account with " +
          "MP_USERNAME=... in the environment, or use " +
          "`mp account add NAME --type service_account --username U` " +
          "to supply explicit credentials.",
      );
    }
    username = envUsername;
    const secretRaw = args.secret_stdin
      ? effects.readSecretStdin()
      : (effects.env.get("MP_SECRET") ?? "");
    if (secretRaw === "") {
      throw new ConfigError(
        "MP_SECRET is not set (or stdin is empty). Pipe the secret " +
          "via --secret-stdin or set MP_SECRET in the environment.",
      );
    }
    secret = new Secret(secretRaw);
  } else {
    // Python `token_env or "MP_OAUTH_TOKEN"`: the empty string also
    // falls back (falsy `or`, not nullish). `resolvedTokenEnv` below
    // keeps the `is not None` check: `token_env=""` still records the
    // empty pointer, exactly like Python.
    const envName =
      args.token_env !== null && args.token_env !== ""
        ? args.token_env
        : "MP_OAUTH_TOKEN";
    const bearer = effects.env.get(envName);
    if (bearer === undefined || bearer === "") {
      throw new ConfigError(
        `Env var '${envName}' is unset. Pass --token-env NAME with the ` +
          `bearer in NAME, or set ${envName} in the environment.`,
      );
    }
    if (args.token_env === null) {
      token = new Secret(bearer);
    } else {
      resolvedTokenEnv = args.token_env;
    }
  }

  // Region resolution — probe when omitted.
  let resolvedRegion: Region;
  if (args.region === null) {
    resolvedRegion = await probeRegionForCredential({
      account_type: args.detected_type,
      username,
      secret,
      token,
      token_env: resolvedTokenEnv,
      narrate: (msg: string): void => {
        effects.narrate(msg);
      },
      getEnv: (envVar: string): string | undefined => effects.env.get(envVar),
      fetchImpl: effects.fetchImpl,
    });
  } else {
    resolvedRegion = args.region;
  }

  // /me lookup via a temporary credentialed account.
  const placeholderName = "_tmp_login_unified_";
  let tempAccount: Account;
  if (args.detected_type === "service_account") {
    tempAccount = {
      type: "service_account",
      name: placeholderName,
      region: resolvedRegion,
      username: username ?? "",
      secret: secret ?? new Secret(""),
      default_project: "0",
    };
  } else if (token === null) {
    tempAccount = {
      type: "oauth_token",
      name: placeholderName,
      region: resolvedRegion,
      token_env: resolvedTokenEnv ?? "MP_OAUTH_TOKEN",
      default_project: "0",
    };
  } else {
    tempAccount = {
      type: "oauth_token",
      name: placeholderName,
      region: resolvedRegion,
      token,
      default_project: "0",
    };
  }

  const meResp = await withProgress(
    args.progress,
    FETCH_ME_PROGRESS_MESSAGE,
    () => fetchMe(effects, tempAccount),
  );

  const chosenProject = resolveProjectForLogin(
    effects,
    meResp,
    args.project,
    args.project_picker,
  );

  // Resolve the final name.
  let finalName: string;
  if (args.name === null) {
    const existingNames = new Set(
      effects.config.listAccounts().map((account) => account.name),
    );
    finalName = defaultAccountName(meResp, existingNames);
  } else {
    finalName = args.name;
  }

  const summary = await accountsAdd(effects, finalName, {
    type: args.detected_type,
    region: resolvedRegion,
    default_project: chosenProject,
    username,
    secret,
    token,
    token_env: resolvedTokenEnv,
  });
  await effects.meCache.put(finalName, meResp);
  return summaryWithMe(summary, meResp, chosenProject);
}
