/**
 * Pure-functional {@link Session} resolution. Three independent axes each
 * consult `env → param → target → bridge → config` (account ends at
 * `[active].account`, project at `account.default_project`, workspace at
 * `[active].workspace`); perturbing one axis never affects another, and
 * an unresolvable axis raises a {@link ConfigError} listing every fix
 * path. Python reads `os.environ` inline and defaults its config and
 * bridge sources; this module takes them all injected ({@link ResolverSources})
 * and does no I/O of its own — `@mixpanel-headless/node` supplies
 * `process.env`, the TOML `ConfigManager` and the bridge loader.
 *
 * @see mixpanel_headless._internal.auth.resolver
 */

import { pythonInt } from "../compat/python-int.js";
import { pythonRepr } from "../compat/python-str.js";
import { ConfigError, ParamValidationError } from "../errors.js";
import type { Target } from "../types/entities/accounts.js";
import {
  type Account,
  parseAccount,
  type Region,
  REGION_VALUES,
} from "./account.js";
import {
  type ActiveSession,
  parseProject,
  parseWorkspaceRef,
  type Project,
  type Session,
  type WorkspaceRef,
} from "./session.js";

// --- Injected-source interfaces ---

/** The six `MP_*` reads, as a plain readonly bag (`process.env` on Node). */
export interface ResolverEnv {
  /** Service-account username (SA quad member). */
  readonly MP_USERNAME?: string | undefined;
  /** Service-account secret (SA quad member). */
  readonly MP_SECRET?: string | undefined;
  /** Project ID (digit string; also an SA quad member). */
  readonly MP_PROJECT_ID?: string | undefined;
  /** Data residency (`us` / `eu` / `in`; also an SA quad member). */
  readonly MP_REGION?: string | undefined;
  /** Static bearer token (`oauth_token` env synthesis). */
  readonly MP_OAUTH_TOKEN?: string | undefined;
  /** Workspace ID (positive-integer string). */
  readonly MP_WORKSPACE_ID?: string | undefined;
}

/**
 * Config reads the resolver consults. The Node `ConfigManager` satisfies
 * it; the on-disk TOML handling stays in `@mixpanel-headless/node`.
 */
export interface ResolverConfigSource {
  /**
   * Load a named account.
   *
   * @param name - Account name.
   * @returns The account record.
   * @throws {@link ConfigError} - Coded error on an unknown name
   *   (`AccountNotFoundError` in the ConfigManager implementation).
   */
  getAccount: (name: string) => Account;

  /**
   * Read the persisted `[active]` block.
   *
   * @returns The active session (may be empty).
   */
  getActive: () => ActiveSession;

  /**
   * Load a named target.
   *
   * @param name - Target name.
   * @returns The target record.
   * @throws {@link ConfigError} - Coded error on an unknown name.
   */
  getTarget: (name: string) => Target;

  /**
   * Read `[settings].custom_header`.
   *
   * @returns The single `(name, value)` entry, or `null` when unset.
   */
  getCustomHeader: () => readonly [string, string] | null;
}

/**
 * The bridge fields the resolver reads — a view, not the file model
 * (`BridgeFile` and its loader live in `@mixpanel-headless/node`).
 */
export interface BridgeView {
  /** The bridge's account. */
  readonly account: Account;
  /** The bridge's project axis, when present. */
  readonly project: string | null;
  /** The bridge's workspace axis, when present. */
  readonly workspace: number | null;
  /** Multi-entry custom-header map (wins over settings on collision). */
  readonly headers: Readonly<Record<string, string>>;
}

/** The full injected-source bag {@link resolveSession} consumes. */
export interface ResolverSources {
  /** The `MP_*` env reads. */
  readonly env: ResolverEnv;
  /** The config reads. */
  readonly config: ResolverConfigSource;
  /** The loaded bridge, or `null` when none exists. */
  readonly bridge: BridgeView | null;
}

/** The per-axis explicit overrides (Python keyword-only parameters). */
export interface ResolveSessionOptions {
  /**
   * Explicit account name (e.g. from `--account NAME`).
   *
   * @defaultValue `null`
   */
  readonly account?: string | null | undefined;
  /**
   * Explicit project ID (e.g. from `--project ID`).
   *
   * @defaultValue `null`
   */
  readonly project?: string | null | undefined;
  /**
   * Explicit workspace ID (e.g. from `--workspace ID`).
   *
   * @defaultValue `null`
   */
  readonly workspace?: number | null | undefined;
  /**
   * Named target whose three axes apply (mutually exclusive with
   * `account` / `project` / `workspace`).
   *
   * @defaultValue `null`
   */
  readonly target?: string | null | undefined;
}

// --- Internals ---

/**
 * Runtime region set derived from the shared literal table, never a
 * re-derived list (the `_VALID_REGIONS` twin).
 */
const VALID_REGIONS: ReadonlySet<string> = new Set(REGION_VALUES);

/**
 * Return `MP_REGION` if it's a valid region literal, else `null`
 * (`_env_region`). An empty string counts as absent.
 *
 * @param env - The env bag.
 * @returns The region value when set, or `null` when absent/empty.
 * @throws {@link ConfigError} - `MP_REGION` set to a value outside the allowed
 *   set — surfaced loudly (silently dropping an invalid region would
 *   route requests to the wrong data residency); details
 *   `{env_var: "MP_REGION", value}`.
 */
function envRegion(env: ResolverEnv): Region | null {
  const val = env.MP_REGION;
  if (val === undefined || val === "") {
    return null;
  }
  if (!VALID_REGIONS.has(val)) {
    const sortedRegions = [...VALID_REGIONS].sort();
    const rendered = `[${sortedRegions.map((r) => pythonRepr(r)).join(", ")}]`;
    throw new ConfigError(
      `MP_REGION=${pythonRepr(val)} is not one of ${rendered}.`,
      { env_var: "MP_REGION", value: val },
    );
  }
  return val as Region;
}

/**
 * Synthesize a `ServiceAccount` if the full SA env quad is present
 * (`_env_account_from_service_quad`).
 *
 * Evaluation order matches Python: {@link envRegion} runs before the
 * completeness guard, so an invalid `MP_REGION` aborts resolution even
 * when the quad is otherwise incomplete.
 *
 * @param env - The env bag.
 * @returns A synthesized service account, or `null` if any quad member
 *   is missing.
 * @throws {@link ConfigError} - Invalid `MP_REGION` (via {@link envRegion}).
 */
function envAccountFromServiceQuad(env: ResolverEnv): Account | null {
  const username = env.MP_USERNAME;
  const secret = env.MP_SECRET;
  const project = env.MP_PROJECT_ID;
  const region = envRegion(env);
  if (
    username === undefined ||
    username === "" ||
    secret === undefined ||
    secret === "" ||
    project === undefined ||
    project === "" ||
    region === null
  ) {
    return null;
  }
  try {
    return parseAccount({
      type: "service_account",
      name: "env-service-account",
      region,
      username,
      secret,
    });
  } catch {
    // Defensive parity with Python's `except ValidationError: return
    // None` (pragma no cover — unreachable: every field is non-empty
    // and the name is a fixed valid literal).
    return null;
  }
}

/**
 * Synthesize an `OAuthTokenAccount` from `MP_OAUTH_TOKEN` env
 * (`_env_account_from_oauth_token`). Requires `MP_OAUTH_TOKEN` +
 * `MP_PROJECT_ID` + `MP_REGION`; the SA quad takes precedence
 * ({@link resolveAccountAxis} checks it first, as Python does).
 *
 * @param env - The env bag.
 * @returns A synthesized oauth-token account, or `null` if any
 *   required env var is missing.
 * @throws {@link ConfigError} - Invalid `MP_REGION` (via {@link envRegion}).
 */
function envAccountFromOAuthToken(env: ResolverEnv): Account | null {
  const token = env.MP_OAUTH_TOKEN;
  const project = env.MP_PROJECT_ID;
  const region = envRegion(env);
  if (
    token === undefined ||
    token === "" ||
    project === undefined ||
    project === "" ||
    region === null
  ) {
    return null;
  }
  try {
    return parseAccount({
      type: "oauth_token",
      name: "env-oauth-token",
      region,
      token,
    });
  } catch {
    // Defensive parity (see envAccountFromServiceQuad).
    return null;
  }
}

/** Arguments of {@link resolveAccountAxis} (Python keyword-only). */
export interface ResolveAccountAxisArgs {
  /** Value of the `account=` kwarg. */
  readonly explicit: string | null;
  /** Account name from the applied `--target NAME` block, if any. */
  readonly target_account_name: string | null;
  /** Loaded bridge view, if any. */
  readonly bridge: BridgeView | null;
  /** Config source (may have an empty `[active]` block). */
  readonly config: ResolverConfigSource;
  /** The env bag (Python reads `os.environ` inline). */
  readonly env: ResolverEnv;
}

/**
 * Resolve the account axis per the documented priority order.
 *
 * Order: env SA quad first, then OAuth-token env, then explicit
 * `account=` (config load), then the target's account, then the
 * bridge's account, then `[active].account`.
 *
 * @param args - The axis inputs.
 * @returns The resolved account, or `null` if no source produced one.
 * @throws {@link ConfigError} - Invalid `MP_REGION`; unknown account names
 *   (propagated from the config source).
 * @example
 * ```typescript
 * const account = resolveAccountAxis({
 *   explicit: "team",
 *   target_account_name: null,
 *   bridge: null,
 *   config,
 *   env: { MP_OAUTH_TOKEN: "t", MP_PROJECT_ID: "1", MP_REGION: "us" },
 * });
 * // account?.type === "oauth_token" — env outranks the explicit name
 * ```
 * @see mixpanel_headless._internal.auth.resolver.resolve_account_axis
 */
export function resolveAccountAxis(
  args: ResolveAccountAxisArgs,
): Account | null {
  const sa = envAccountFromServiceQuad(args.env);
  if (sa !== null) {
    return sa;
  }
  const ot = envAccountFromOAuthToken(args.env);
  if (ot !== null) {
    return ot;
  }
  if (args.explicit !== null) {
    return args.config.getAccount(args.explicit);
  }
  if (args.target_account_name !== null) {
    return args.config.getAccount(args.target_account_name);
  }
  if (args.bridge !== null) {
    return args.bridge.account;
  }
  const active = args.config.getActive();
  if (active.account !== null && active.account !== undefined) {
    return args.config.getAccount(active.account);
  }
  return null;
}

/** Arguments of {@link resolveProjectAxis} (Python keyword-only). */
export interface ResolveProjectAxisArgs {
  /** Value of the `project=` kwarg. */
  readonly explicit: string | null;
  /** Project from the applied `--target NAME` block, if any. */
  readonly target_project: string | null;
  /** Loaded bridge view, if any. */
  readonly bridge: BridgeView | null;
  /** The resolved account whose `default_project` bottoms the chain. */
  readonly account: Account | null;
  /** The env bag. */
  readonly env: ResolverEnv;
}

/**
 * Resolve the project axis per the documented priority order.
 *
 * Order: env → param → target → bridge → `account.default_project`.
 * There is no `[active].project` rung — project lives on the account
 * itself.
 *
 * The env guard is Python `str.isdigit()` on the whole string, ported as
 * `/^\p{Nd}+$/u` (decimal-digit codepoints). It is deliberately not the
 * `pythonInt` grammar used three lines away for `MP_WORKSPACE_ID`:
 * `isdigit` admits no sign, underscore or whitespace but does admit
 * non-ASCII decimal digits.
 *
 * @param args - The axis inputs.
 * @returns Project ID (digit string), or `null` if no source resolves.
 * @throws {@link ConfigError} - `MP_PROJECT_ID` set but not a digit string;
 *   details `{env_var: "MP_PROJECT_ID", value}`.
 * @example
 * ```typescript
 * resolveProjectAxis({
 *   explicit: "222",
 *   target_project: null,
 *   bridge: null,
 *   account: null,
 *   env: { MP_PROJECT_ID: "111" },
 * });
 * // "111" — env outranks the explicit parameter
 * ```
 * @see mixpanel_headless._internal.auth.resolver.resolve_project_axis
 */
export function resolveProjectAxis(
  args: ResolveProjectAxisArgs,
): string | null {
  const envVal = args.env.MP_PROJECT_ID;
  if (envVal !== undefined && envVal !== "") {
    // Divergence: `str.isdigit()` also accepts Numeric_Type=Digit
    // codepoints outside Nd (e.g. "²"), which CPython then rejects at
    // `Project(id=…)`; JS has no Numeric_Type property, so they fail this
    // guard instead — same ConfigError class and code, different message.
    // Nd digits (e.g. "٤٢") pass both guards in both languages.
    if (!/^\p{Nd}+$/u.test(envVal)) {
      throw new ConfigError(
        `MP_PROJECT_ID=${pythonRepr(envVal)} must be a digit string.`,
        { env_var: "MP_PROJECT_ID", value: envVal },
      );
    }
    return envVal;
  }
  if (args.explicit !== null) {
    return args.explicit;
  }
  if (args.target_project !== null) {
    return args.target_project;
  }
  if (args.bridge !== null && args.bridge.project !== null) {
    return args.bridge.project;
  }
  if (args.account !== null) {
    return args.account.default_project ?? null;
  }
  return null;
}

/**
 * Return `MP_WORKSPACE_ID` as a validated positive int, or `null`
 * (also the `ResolverSeams.envWorkspaceId` default).
 *
 * Parsing is the CPython `int(str)` grammar via `pythonInt` —
 * underscores, surrounding whitespace, signs, non-ASCII decimal digits.
 * A magnitude beyond 2^53−1 (`PY_INT_UNSAFE_INTEGER`) maps to the same
 * coded ConfigError as any other malformed value.
 *
 * @param env - The env bag.
 * @returns Parsed positive integer, or `null` if the env var is
 *   unset/empty.
 * @throws {@link ConfigError} - `MP_WORKSPACE_ID` set but not a positive
 *   integer; details `{env_var: "MP_WORKSPACE_ID", value}`.
 * @example
 * ```typescript
 * envWorkspaceId({ MP_WORKSPACE_ID: " 4_2 " });
 * // 42 — the CPython int() grammar
 * envWorkspaceId({});
 * // null
 * ```
 * @see mixpanel_headless._internal.auth.resolver.env_workspace_id
 */
export function envWorkspaceId(env: ResolverEnv): number | null {
  const envVal = env.MP_WORKSPACE_ID;
  if (envVal === undefined || envVal === "") {
    return null;
  }
  let parsed: number;
  try {
    parsed = pythonInt(envVal);
  } catch (error) {
    throw new ConfigError(
      `MP_WORKSPACE_ID=${pythonRepr(envVal)} is not a positive integer.`,
      { env_var: "MP_WORKSPACE_ID", value: envVal },
      { cause: error },
    );
  }
  if (parsed <= 0) {
    throw new ConfigError(
      `MP_WORKSPACE_ID=${pythonRepr(envVal)} is not a positive integer.`,
      { env_var: "MP_WORKSPACE_ID", value: envVal },
    );
  }
  return parsed;
}

/** Arguments of the workspace-axis chain (module-private in Python). */
interface ResolveWorkspaceAxisArgs {
  /** Value of the `workspace=` kwarg. */
  readonly explicit: number | null;
  /** Workspace from the applied `--target NAME` block, if any. */
  readonly target_workspace: number | null;
  /** Loaded bridge view, if any. */
  readonly bridge: BridgeView | null;
  /** Config source. */
  readonly config: ResolverConfigSource;
  /** The env bag. */
  readonly env: ResolverEnv;
}

/**
 * Resolve the workspace axis per the documented priority order
 * (`resolve_workspace_axis`).
 *
 * Order: env → param → target → bridge → `[active].workspace`. `null`
 * is a valid terminal value (lazy resolution on the first
 * workspace-scoped API call).
 *
 * @param args - The axis inputs.
 * @returns Workspace ID, or `null` (lazy-resolve later).
 * @throws {@link ConfigError} - Malformed `MP_WORKSPACE_ID` (via
 *   {@link envWorkspaceId}).
 */
function resolveWorkspaceAxis(args: ResolveWorkspaceAxisArgs): number | null {
  const envVal = envWorkspaceId(args.env);
  if (envVal !== null) {
    return envVal;
  }
  if (args.explicit !== null) {
    return args.explicit;
  }
  if (args.target_workspace !== null) {
    return args.target_workspace;
  }
  if (args.bridge !== null && args.bridge.workspace !== null) {
    return args.bridge.workspace;
  }
  const active = args.config.getActive();
  return active.workspace ?? null;
}

/**
 * Collect custom HTTP headers from settings + bridge (`_resolve_headers`).
 *
 * `[settings].custom_header` contributes a single entry; the bridge
 * contributes a multi-entry map. Bridge wins on collision (the settings
 * entry is written first, then the bridge overrides).
 *
 * @param bridge - Loaded bridge view, if any.
 * @param config - Config source.
 * @returns Headers map ready to attach to `Session.headers`.
 */
function resolveHeaders(
  bridge: BridgeView | null,
  config: ResolverConfigSource,
): Map<string, string> {
  const headers = new Map<string, string>();
  const setting = config.getCustomHeader();
  if (setting !== null) {
    headers.set(setting[0], setting[1]);
  }
  if (bridge !== null) {
    for (const [name, value] of Object.entries(bridge.headers)) {
      headers.set(name, value);
    }
  }
  return headers;
}

/**
 * Return the multi-line error text for an unresolvable account axis
 * (`format_no_account_error`). Message text is out of contract but
 * ported as-is.
 *
 * @returns The error message body.
 */
function formatNoAccountError(): string {
  return (
    "No account configured.\n" +
    "\n" +
    "Fix one of the following:\n" +
    "  - Set MP_USERNAME, MP_SECRET, MP_PROJECT_ID, MP_REGION\n" +
    "  - Set MP_OAUTH_TOKEN, MP_PROJECT_ID, MP_REGION\n" +
    "  - Run `mp account add NAME ...` then `mp account use NAME`\n" +
    "  - Run `mp account login NAME` for OAuth\n" +
    "  - Use `--account NAME` per command\n" +
    "  - Use `--target NAME` per command\n"
  );
}

/**
 * Return the multi-line error text for an unresolvable project axis
 * (`format_no_project_error` — two message shapes: with and without a
 * resolved account).
 *
 * @param account - The resolved account (when available) so the error
 *   can name it explicitly.
 * @returns The error message body.
 */
function formatNoProjectError(account: Account | null = null): string {
  if (account !== null) {
    return (
      `No project configured for account ${pythonRepr(account.name)}.\n` +
      "\n" +
      "Fix one of the following:\n" +
      "  - Set MP_PROJECT_ID\n" +
      `  - Run \`mp account update ${account.name} --project ID\`\n` +
      "  - Use `--project ID` per command\n" +
      "  - Use `--target NAME` per command (target supplies project)\n"
    );
  }
  return (
    "No project configured.\n" +
    "\n" +
    "Fix one of the following:\n" +
    "  - Set MP_PROJECT_ID\n" +
    "  - Run `mp account update NAME --project ID` for an existing account\n" +
    "  - Add an account with a project: `mp account add NAME ... --project ID`\n" +
    "  - Use `--project ID` per command\n" +
    "  - Use `--target NAME` per command (target supplies project)\n"
  );
}

/**
 * Resolve a {@link Session} from per-axis inputs and injected sources.
 *
 * The three axes resolve independently; each consults env → param →
 * target → bridge → config in priority order. Pure-functional: no token
 * I/O, no source mutation, no network; deterministic on identical
 * inputs.
 *
 * Divergence: no inline `ConfigManager()` / bridge defaults — the caller
 * passes the full {@link ResolverSources} bag and
 * `@mixpanel-headless/node` supplies the defaults Python builds inline.
 *
 * @param options - The per-axis explicit overrides.
 * @param sources - The injected env / config / bridge sources.
 * @returns A session with account, project, optional workspace, and
 *   any custom headers attached.
 * @throws {@link ParamValidationError} - `target` combined with any axis kwarg
 *   (code `WS1_TARGET_MUTUALLY_EXCLUSIVE`, the same code the
 *   `Workspace` facade uses for this guard; Python raises a bare
 *   `ValueError`).
 * @throws {@link ConfigError} - An axis cannot be resolved or refers to an
 *   unknown account / target; invalid env values.
 * @example
 * ```typescript
 * const session = resolveSession(
 *   { account: "team" },
 *   { env: {}, config: myConfigSource, bridge: null },
 * );
 * // session.account.name === "team"
 * ```
 * @see mixpanel_headless._internal.auth.resolver.resolve_session
 */
export function resolveSession(
  options: ResolveSessionOptions,
  sources: ResolverSources,
): Session {
  const account = options.account ?? null;
  const project = options.project ?? null;
  const workspace = options.workspace ?? null;
  const target = options.target ?? null;

  if (
    target !== null &&
    (account !== null || project !== null || workspace !== null)
  ) {
    throw new ParamValidationError(
      "`target=` is mutually exclusive with `account=`/`project=`/`workspace=`.",
      "WS1_TARGET_MUTUALLY_EXCLUSIVE",
    );
  }

  const cfg = sources.config;
  const br = sources.bridge;
  const env = sources.env;

  let targetAccountName: string | null = null;
  let targetProject: string | null = null;
  let targetWorkspace: number | null = null;
  if (target !== null) {
    const t = cfg.getTarget(target);
    targetAccountName = t.account;
    targetProject = t.project;
    // `Target.workspace` is `null` when unset (Pydantic default) —
    // normalize a hypothetical `undefined` too so the axis chain's
    // `!== null` rungs stay faithful.
    targetWorkspace = t.workspace ?? null;
  }

  const accountObj = resolveAccountAxis({
    explicit: account,
    target_account_name: targetAccountName,
    bridge: br,
    config: cfg,
    env,
  });
  if (accountObj === null) {
    throw new ConfigError(formatNoAccountError());
  }

  const projectId = resolveProjectAxis({
    explicit: project,
    target_project: targetProject,
    bridge: br,
    account: accountObj,
    env,
  });
  if (projectId === null) {
    throw new ConfigError(formatNoProjectError(accountObj));
  }
  let projectObj: Project;
  try {
    projectObj = parseProject({ id: projectId });
  } catch (error) {
    throw new ConfigError(
      `Invalid project ID: ${pythonRepr(projectId)}. Must match \`^\\d+$\`.`,
      null,
      { cause: error },
    );
  }

  const workspaceId = resolveWorkspaceAxis({
    explicit: workspace,
    target_workspace: targetWorkspace,
    bridge: br,
    config: cfg,
    env,
  });
  let workspaceObj: WorkspaceRef | null = null;
  if (workspaceId !== null) {
    try {
      workspaceObj = parseWorkspaceRef({ id: workspaceId });
    } catch (error) {
      throw new ConfigError(
        `Invalid workspace ID: ${String(workspaceId)}. Must be > 0.`,
        null,
        { cause: error },
      );
    }
  }

  const headers = resolveHeaders(br, cfg);

  return {
    account: accountObj,
    project: projectObj,
    workspace: workspaceObj,
    headers,
  };
}
