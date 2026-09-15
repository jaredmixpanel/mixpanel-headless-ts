/**
 * Cowork credential bridge (v2 schema): load, export and remove the
 * bridge file, plus the Workspace constructor's bridge-token
 * materialization side effect.
 *
 * Bridge file search order, first existing wins: the explicit `path`
 * argument; `$MP_AUTH_FILE` (read at call time);
 * `~/.claude/mixpanel/auth.json`, then `mixpanel_auth.json` in the
 * current directory.
 *
 * `serializeBridge` is a designated secret-reveal site: the bridge
 * crosses a trust boundary by design and must carry raw secrets, never
 * the redaction mask.
 *
 * @see mixpanel_headless._internal.auth.bridge
 */

import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
  type Account,
  type BridgeEffects,
  type BridgeView,
  ConfigError,
  isPythonDict,
  MixpanelHeadlessError,
  OAuthError,
  OAuthTokens,
  ParamValidationError,
  parseAccount,
  parseOAuthTokens,
  pythonInt,
  Secret,
  sortedByCodepoint,
} from "@mixpanel-headless/core";
import { exceptionMessage } from "@mixpanel-headless/core/internal";

import { wrapAsConfigError } from "../errors.js";
import {
  atomicWriteBytes,
  CredentialPathError,
  isErrnoError,
  readCredentialText,
  rejectIfSymlink,
} from "../io-utils.js";
import { jsonPythonStr } from "./json-str.js";
import {
  coerceLaxExpiresAt,
  pydanticJsonDatetimeText,
} from "./pydantic-datetime.js";
import { accountDir, ensureAccountDir } from "./storage.js";
import { tokenPayloadBytes } from "./token-payload.js";

/**
 * Parsed v2 bridge file (the `BridgeFile` pydantic model twin:
 * `frozen=True`, `extra="forbid"`).
 *
 * @see mixpanel_headless._internal.auth.bridge.BridgeFile
 */
export interface BridgeFile {
  /** Bridge schema version — always `2`. */
  readonly version: 2;
  /** Full Account record (secrets inline by design). */
  readonly account: Account;
  /** OAuth tokens — required iff `account.type === "oauth_browser"`. */
  readonly tokens: OAuthTokens | null;
  /** Optional pinned project ID (numeric string, `^\d+$`). */
  readonly project: string | null;
  /** Optional pinned workspace ID (positive int). */
  readonly workspace: number | null;
  /** Custom HTTP headers attached at resolution time. */
  readonly headers: Readonly<Record<string, string>>;
}

/** The allowed top-level keys (`extra="forbid"`). */
const BRIDGE_KEYS = new Set([
  "version",
  "account",
  "tokens",
  "project",
  "workspace",
  "headers",
]);

/**
 * Return the default bridge file paths in priority order. Callers
 * consult `MP_AUTH_FILE` before any default path.
 *
 * @returns Candidate paths (Cowork default first, then the cwd fallback).
 * @example
 * ```ts
 * const existing = defaultBridgeSearchPaths().find((p) => existsSync(p));
 * ```
 * @see mixpanel_headless._internal.auth.bridge.default_bridge_search_paths
 */
export function defaultBridgeSearchPaths(): readonly string[] {
  return [
    join(homedir(), ".claude", "mixpanel", "auth.json"),
    join(process.cwd(), "mixpanel_auth.json"),
  ];
}

/**
 * Validate a raw payload against the v2 bridge schema (the
 * `BridgeFile.model_validate` twin).
 *
 * @param raw - The parsed JSON payload.
 * @returns The validated bridge.
 * @throws {@link ParamValidationError} - Any schema violation (the
 *   pydantic `ValidationError` twin; `loadBridge` wraps it in
 *   `ConfigError`).
 * @example
 * ```ts
 * const bridge = parseBridgeFile(JSON.parse(text));
 * bridge.account.type; // "oauth_browser" | "service_account" | "oauth_token"
 * ```
 * @see mixpanel_headless._internal.auth.bridge.BridgeFile
 */
// eslint-disable-next-line complexity -- branch-for-branch port of one Python function (see the docblock); splitting it would scatter the guard order the corpus pins
export function parseBridgeFile(raw: unknown): BridgeFile {
  if (!isPythonDict(raw)) {
    throw new ParamValidationError("BridgeFile payload must be an object");
  }
  for (const key of Object.keys(raw)) {
    if (!BRIDGE_KEYS.has(key)) {
      // `extra="forbid"`.
      throw new ParamValidationError(`Extra inputs are not permitted: ${key}`);
    }
  }
  const version = Object.hasOwn(raw, "version") ? raw["version"] : 2;
  if (version !== 2) {
    // `Literal[2]` — `"2"` (string) is rejected too (lax mode does not
    // cross types for Literal members).
    throw new ParamValidationError("BridgeFile.version must be 2");
  }
  const account = parseAccount(raw["account"], { boundary: "param" });
  let tokens: OAuthTokens | null = null;
  let rawTokens = raw["tokens"];
  if (rawTokens !== undefined && rawTokens !== null) {
    // Pydantic-lax twin: the Python `BridgeFile.tokens` model coerces
    // numeric epoch `expires_at` values and rejects tz-suffixed
    // non-instants.
    if (isPythonDict(rawTokens) && Object.hasOwn(rawTokens, "expires_at")) {
      rawTokens = {
        ...rawTokens,
        expires_at: coerceLaxExpiresAt(rawTokens["expires_at"]),
      };
    }
    tokens = parseOAuthTokens(rawTokens, { boundary: "param" });
  }
  let project: string | null = null;
  const rawProject = raw["project"];
  if (rawProject !== undefined && rawProject !== null) {
    // Pattern `^\d+$`: a regex gate, never `pythonInt` (the field is a
    // digit string, not an integer).
    if (typeof rawProject !== "string" || !/^\d+$/.test(rawProject)) {
      throw new ParamValidationError(
        "BridgeFile.project must be a numeric string",
      );
    }
    project = rawProject;
  }
  let workspace: number | null = null;
  const rawWorkspace = raw["workspace"];
  if (rawWorkspace !== undefined && rawWorkspace !== null) {
    // `PositiveInt` under pydantic-lax: an int, or a digit string via
    // the Python `int()` parser (`pythonInt`, not `Number()`).
    let candidate: number;
    if (typeof rawWorkspace === "number") {
      if (!Number.isInteger(rawWorkspace)) {
        throw new ParamValidationError(
          "BridgeFile.workspace must be an integer",
        );
      }
      candidate = rawWorkspace;
    } else if (typeof rawWorkspace === "string") {
      try {
        candidate = pythonInt(rawWorkspace);
      } catch {
        throw new ParamValidationError(
          "BridgeFile.workspace must be an integer",
        );
      }
    } else {
      throw new ParamValidationError("BridgeFile.workspace must be an integer");
    }
    if (candidate <= 0) {
      throw new ParamValidationError(
        "BridgeFile.workspace must be a positive integer",
      );
    }
    workspace = candidate;
  }
  const headers: Record<string, string> = {};
  const rawHeaders = raw["headers"];
  if (rawHeaders !== undefined) {
    if (!isPythonDict(rawHeaders)) {
      throw new ParamValidationError("BridgeFile.headers must be a string map");
    }
    for (const [key, value] of Object.entries(rawHeaders)) {
      if (typeof value !== "string") {
        throw new ParamValidationError(
          `BridgeFile.headers[${JSON.stringify(key)}] must be a string`,
        );
      }
      headers[key] = value;
    }
  }
  // Model validator: oauth_browser requires tokens.
  if (account.type === "oauth_browser" && tokens === null) {
    throw new ParamValidationError(
      "BridgeFile with oauth_browser account requires `tokens`.",
    );
  }
  return { version: 2, account, tokens, project, workspace, headers };
}

/**
 * Load and validate a v2 bridge file from disk.
 *
 * @param path - Optional explicit bridge path (else `$MP_AUTH_FILE`,
 *   else the default search paths; first existing wins).
 * @returns The parsed bridge, or `null` when no candidate exists.
 * @throws {@link ConfigError} - A candidate exists but is symlinked,
 *   unreadable, malformed, or fails schema validation.
 * @example
 * ```ts
 * const bridge = loadBridge();
 * if (bridge !== null) console.log(bridge.account.name);
 * ```
 * @see mixpanel_headless._internal.auth.bridge.load_bridge
 */
export function loadBridge(path?: string | null): BridgeFile | null {
  const candidates: string[] = [];
  const envPath = process.env["MP_AUTH_FILE"];
  if (path !== undefined && path !== null) {
    candidates.push(path);
  } else if (envPath !== undefined && envPath !== "") {
    candidates.push(envPath);
  } else {
    candidates.push(...defaultBridgeSearchPaths());
  }

  for (const candidate of candidates) {
    // Symlink probe before the existence check. Python wraps any OSError
    // from the probe (`except OSError`), so errno-bearing lstat failures
    // code up like the symlink refusal.
    try {
      rejectIfSymlink(candidate);
    } catch (error) {
      if (!(error instanceof MixpanelHeadlessError) && !isErrnoError(error)) {
        throw error;
      }
      throw wrapAsConfigError(
        `Could not read bridge file at ${candidate}`,
        error,
        { path: candidate },
      );
    }
    if (!existsSync(candidate)) {
      continue;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(readCredentialText(candidate));
    } catch (error) {
      // Python wraps `(OSError, json.JSONDecodeError)` only; a
      // UnicodeDecodeError escapes raw, so the TS twin (TextDecoder
      // fatal-mode TypeError) propagates unchanged.
      if (
        !(error instanceof CredentialPathError) &&
        !(error instanceof SyntaxError) &&
        !isErrnoError(error)
      ) {
        throw error;
      }
      throw wrapAsConfigError(
        `Could not read bridge file at ${candidate}`,
        error,
        { path: candidate },
      );
    }
    try {
      return parseBridgeFile(payload);
    } catch (error) {
      if (!(error instanceof MixpanelHeadlessError)) {
        throw error;
      }
      throw new ConfigError(
        `Invalid bridge file at ${candidate}: ${error.message}`,
        { path: candidate },
        { cause: error },
      );
    }
  }
  return null;
}

/**
 * Load on-disk OAuth tokens for an oauth_browser account: snapshot
 * semantics, no refresh attempt.
 *
 * @param name - Account name (locates the per-account tokens file).
 * @returns The parsed tokens.
 * @throws {@link OAuthError} - Missing, symlinked or malformed tokens
 *   file.
 * @see mixpanel_headless._internal.auth.bridge._read_browser_tokens
 */
function readBrowserTokens(name: string): OAuthTokens {
  const path = join(accountDir(name), "tokens.json");
  // Python wraps any OSError from the probe (`except OSError`),
  // errno-bearing lstat failures included.
  try {
    rejectIfSymlink(path);
  } catch (error) {
    if (!(error instanceof MixpanelHeadlessError) && !isErrnoError(error)) {
      throw error;
    }
    throw new OAuthError(
      `Could not read OAuth tokens for account '${name}' from ${path}: ${exceptionMessage(error)}`,
      "OAUTH_TOKEN_ERROR",
      { account_name: name, path },
      { cause: error },
    );
  }
  if (!existsSync(path)) {
    throw new OAuthError(
      `No OAuth tokens found for account '${name}' at ${path}. ` +
        `Run \`mp account login ${name}\` before exporting a bridge.`,
      "OAUTH_TOKEN_ERROR",
      { account_name: name, path },
    );
  }
  let payload: unknown;
  try {
    payload = JSON.parse(readCredentialText(path));
  } catch (error) {
    // Python wraps `(OSError, json.JSONDecodeError)` only; the
    // UnicodeDecodeError twin (TextDecoder fatal-mode TypeError)
    // propagates raw.
    if (
      !(error instanceof CredentialPathError) &&
      !(error instanceof SyntaxError) &&
      !isErrnoError(error)
    ) {
      throw error;
    }
    throw new OAuthError(
      `Could not read OAuth tokens for account '${name}' from ${path}: ${exceptionMessage(error)}`,
      "OAUTH_TOKEN_ERROR",
      { account_name: name, path },
      { cause: error },
    );
  }
  const record = isPythonDict(payload) ? payload : {};
  const expiresRaw = record["expires_at"];
  if (typeof expiresRaw !== "string" || expiresRaw === "") {
    throw new OAuthError(
      `OAuth tokens for account '${name}' are missing \`expires_at\`.`,
      "OAUTH_TOKEN_ERROR",
      { account_name: name, path },
    );
  }
  if (Number.isNaN(Date.parse(expiresRaw))) {
    throw new OAuthError(
      `OAuth tokens for account '${name}' have an invalid \`expires_at\` value.`,
      "OAUTH_TOKEN_ERROR",
      { account_name: name, path },
    );
  }
  const accessToken = record["access_token"];
  if (typeof accessToken !== "string" || accessToken === "") {
    throw new OAuthError(
      `OAuth tokens for account '${name}' are missing \`access_token\`.`,
      "OAUTH_TOKEN_ERROR",
      { account_name: name, path },
    );
  }
  const refreshRaw = record["refresh_token"];
  const refreshToken =
    typeof refreshRaw === "string" && refreshRaw !== ""
      ? new Secret(refreshRaw)
      : null;
  return new OAuthTokens({
    access_token: new Secret(accessToken),
    refresh_token: refreshToken,
    expires_at: expiresRaw,
    // Python `str()` over the decoded members, defaults as in the reader.
    scope: jsonPythonStr(record["scope"] ?? "", "scope"),
    token_type: jsonPythonStr(record["token_type"] ?? "Bearer", "token_type"),
  });
}

/**
 * Serialize a bridge to UTF-8 JSON bytes with secrets unwrapped — the
 * designated reveal site (`exclude_none`, `sort_keys=True`, 2-space
 * indent).
 *
 * @param bridge - Validated bridge.
 * @returns UTF-8 encoded JSON bytes ready for atomic write.
 * @see mixpanel_headless._internal.auth.bridge._serialize_bridge
 */
function serializeBridge(bridge: BridgeFile): Uint8Array {
  const account: Record<string, unknown> = {
    type: bridge.account.type,
    name: bridge.account.name,
    region: bridge.account.region,
  };
  const defaultProject = bridge.account.default_project;
  if (defaultProject !== null && defaultProject !== undefined) {
    account["default_project"] = defaultProject;
  }
  if (bridge.account.type === "service_account") {
    account["username"] = bridge.account.username;
    account["secret"] = bridge.account.secret.reveal();
  } else if (bridge.account.type === "oauth_token") {
    if (bridge.account.token !== null && bridge.account.token !== undefined) {
      account["token"] = bridge.account.token.reveal();
    }
    if (
      bridge.account.token_env !== null &&
      bridge.account.token_env !== undefined
    ) {
      account["token_env"] = bridge.account.token_env;
    }
  }
  const payload: Record<string, unknown> = {
    version: bridge.version,
    account,
    headers: bridge.headers,
  };
  if (bridge.tokens !== null) {
    const tokens: Record<string, unknown> = {
      access_token: bridge.tokens.access_token.reveal(),
      // Pydantic JSON mode (`model_dump(mode="json")`) spells UTC with
      // `Z`; the written file must be byte-identical to Python's.
      expires_at: pydanticJsonDatetimeText(bridge.tokens.expires_at),
      scope: bridge.tokens.scope,
      token_type: bridge.tokens.token_type,
    };
    if (bridge.tokens.refresh_token !== null) {
      tokens["refresh_token"] = bridge.tokens.refresh_token.reveal();
    }
    payload["tokens"] = tokens;
  }
  if (bridge.project !== null) {
    payload["project"] = bridge.project;
  }
  if (bridge.workspace !== null) {
    payload["workspace"] = bridge.workspace;
  }
  return new TextEncoder().encode(JSON.stringify(sortKeys(payload), null, 2));
}

/**
 * Recursively sort object keys (the `json.dumps(sort_keys=True)` twin;
 * JS preserves string-key insertion order). Python `sorted()` orders by
 * codepoint, so the comparator is `sortedByCodepoint`: the default
 * `Array.prototype.sort` compares UTF-16 code units, which inverts
 * e.g. `"｡"` vs `"😀"`.
 *
 * @param value - Any JSON-serializable value.
 * @returns A key-sorted deep copy.
 */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeys(item));
  }
  if (isPythonDict(value)) {
    const out: Record<string, unknown> = {};
    for (const key of sortedByCodepoint(Object.keys(value))) {
      out[key] = sortKeys(value[key]);
    }
    return out;
  }
  return value;
}

/** Keyword-only options of {@link exportBridge}. */
export interface ExportBridgeOptions {
  /** Destination path for the bridge file. */
  readonly to: string;
  /** Optional pinned project ID (must match `^\d+$`). */
  readonly project?: string | null | undefined;
  /** Optional pinned workspace ID (positive int). */
  readonly workspace?: number | null | undefined;
  /** Optional custom HTTP headers map. */
  readonly headers?: Readonly<Record<string, string>> | null | undefined;
}

/**
 * Write a v2 bridge file embedding the account's full record. For
 * oauth_browser accounts the current on-disk tokens are embedded
 * (snapshot; no refresh). The write is atomic at 0o600, so a consumer
 * never observes a half-written file and a failed export leaves nothing
 * behind.
 *
 * @param account - Account to embed (secrets inline by design).
 * @param options - Destination and optional pins. Python's
 *   `token_resolver` kwarg is signature parity only: the on-disk reader
 *   is used directly, and the `BridgeEffects` adapter accepts and
 *   ignores it the same way.
 * @returns The path written (same as `options.to`).
 * @throws {@link OAuthError} - oauth_browser account with missing or
 *   malformed on-disk tokens.
 * @throws {@link ParamValidationError} - Bad project format or
 *   non-positive workspace, raw: Python's pydantic `ValidationError`
 *   escapes `export_bridge` unwrapped (its docstring's `ConfigError`
 *   claim is wrong in Python too).
 * @example
 * ```ts
 * const path = exportBridge(account, {
 *   to: join(homedir(), ".claude", "mixpanel", "auth.json"),
 *   project: "12345",
 * });
 * ```
 * @see mixpanel_headless._internal.auth.bridge.export_bridge
 */
export function exportBridge(
  account: Account,
  options: ExportBridgeOptions,
): string {
  let tokens: OAuthTokens | null = null;
  if (account.type === "oauth_browser") {
    tokens = readBrowserTokens(account.name);
  }
  // Invalid pins propagate the model's ParamValidationError raw: Python
  // builds `BridgeFile(...)` with no try/except, so the pydantic
  // ValidationError escapes unwrapped.
  const bridge: BridgeFile = {
    version: 2,
    account,
    tokens,
    project: validatedProject(options.project ?? null),
    workspace: validatedWorkspace(options.workspace ?? null),
    headers: options.headers ?? {},
  };
  const parent = dirname(options.to);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true, mode: 0o700 });
  }
  atomicWriteBytes(options.to, serializeBridge(bridge), { mode: 0o600 });
  return options.to;
}

/**
 * Validate an export `project` pin (`^\d+$`, the BridgeFile field
 * constraint).
 *
 * @param project - The candidate pin.
 * @returns The validated pin (or `null`).
 * @throws {@link ParamValidationError} - Non-digit-string pin.
 */
function validatedProject(project: string | null): string | null {
  if (project === null) {
    return null;
  }
  if (!/^\d+$/.test(project)) {
    throw new ParamValidationError(
      "BridgeFile.project must be a numeric string",
    );
  }
  return project;
}

/**
 * Validate an export `workspace` pin (`PositiveInt`).
 *
 * @param workspace - The candidate pin.
 * @returns The validated pin (or `null`).
 * @throws {@link ParamValidationError} - Non-positive or non-integer pin.
 */
function validatedWorkspace(workspace: number | null): number | null {
  if (workspace === null) {
    return null;
  }
  if (!Number.isInteger(workspace) || workspace <= 0) {
    throw new ParamValidationError(
      "BridgeFile.workspace must be a positive integer",
    );
  }
  return workspace;
}

/** Keyword-only options of {@link removeBridge}. */
export interface RemoveBridgeOptions {
  /** Explicit bridge path (else `$MP_AUTH_FILE`, else the defaults). */
  readonly at?: string | null | undefined;
}

/**
 * Delete the bridge file at the resolved path. Idempotent.
 *
 * @param options - Optional explicit path.
 * @returns `true` if a file was deleted; `false` if none was found.
 * @example
 * ```ts
 * removeBridge(); // true when a default-path bridge existed
 * ```
 * @see mixpanel_headless._internal.auth.bridge.remove_bridge
 */
export function removeBridge(options: RemoveBridgeOptions = {}): boolean {
  let target: string | null;
  const envPath = process.env["MP_AUTH_FILE"];
  if (options.at !== undefined && options.at !== null) {
    target = options.at;
  } else if (envPath !== undefined && envPath !== "") {
    target = envPath;
  } else {
    target = defaultBridgeSearchPaths().find((p) => existsSync(p)) ?? null;
  }
  if (target === null || !existsSync(target)) {
    return false;
  }
  unlinkSync(target);
  return true;
}

/**
 * Project a loaded bridge to the resolver's view (`ResolverSources.bridge`).
 *
 * @param bridge - A loaded bridge file.
 * @returns The four-field view.
 * @example
 * ```ts
 * const bridge = loadBridge();
 * const sources = { env, config, bridge: bridge && bridgeViewFromFile(bridge) };
 * ```
 */
export function bridgeViewFromFile(bridge: BridgeFile): BridgeView {
  return {
    account: bridge.account,
    project: bridge.project,
    workspace: bridge.workspace,
    headers: bridge.headers,
  };
}

/**
 * Run the Workspace constructor's bridge-token materialization side
 * effect: when the bridge embeds oauth_browser tokens, always overwrite
 * the per-account `tokens.json`. The bridge is the authoritative source
 * of truth at startup (a refreshed payload from the host must replace
 * any stale on-disk cache). An empty bridge scope gets the `"read"`
 * default so the cached file matches what `mp account login` would have
 * written.
 *
 * @param bridge - The loaded bridge.
 * @returns The written tokens path, or `null` when the bridge carries
 *   no oauth_browser tokens (non-browser account, or no bridge tokens).
 * @example
 * ```ts
 * const bridge = loadBridge();
 * if (bridge !== null) materializeBridgeTokens(bridge);
 * ```
 * @see mixpanel_headless.workspace.Workspace.__init__
 */
export function materializeBridgeTokens(bridge: BridgeFile): string | null {
  if (bridge.tokens === null || bridge.account.type !== "oauth_browser") {
    return null;
  }
  let tokensToPersist = bridge.tokens;
  if (tokensToPersist.scope === "") {
    tokensToPersist = new OAuthTokens({
      access_token: tokensToPersist.access_token,
      refresh_token: tokensToPersist.refresh_token,
      expires_at: tokensToPersist.expires_at,
      scope: "read",
      token_type: tokensToPersist.token_type,
    });
  }
  const tokensPath = join(ensureAccountDir(bridge.account.name), "tokens.json");
  atomicWriteBytes(tokensPath, tokenPayloadBytes(tokensToPersist));
  return tokensPath;
}

/**
 * Run the `Workspace()` startup composition: `load_bridge()` plus the
 * materialization side effect. The facade-construction sources
 * (`createNodeWorkspaceSources`, `createNodeWorkspace`) call this;
 * in-session `use()` re-resolution and the namespace surfaces go through
 * the pure loader (`createNodeResolverSources`), because Python does not
 * re-materialize on `use`.
 *
 * @returns The loaded bridge (post-materialization), or `null`.
 * @throws {@link ConfigError} - Malformed bridge file.
 * @example
 * ```ts
 * const bridge = loadBridgeForStartup();
 * const sources = { env, config, bridge: bridge && bridgeViewFromFile(bridge) };
 * ```
 */
export function loadBridgeForStartup(): BridgeFile | null {
  const bridge = loadBridge();
  if (bridge !== null) {
    materializeBridgeTokens(bridge);
  }
  return bridge;
}

/**
 * Build the node `BridgeEffects`: `load()` is the pure loader producing
 * the resolver view; `export` and `remove` are the writer pair.
 *
 * @returns The effects triple over the on-disk bridge file.
 * @example
 * ```ts
 * const bridge = createNodeBridgeEffects();
 * bridge.load(); // BridgeView or null, no materialization
 * ```
 */
export function createNodeBridgeEffects(): BridgeEffects {
  return {
    load: (): BridgeView | null => {
      const bridge = loadBridge();
      return bridge === null ? null : bridgeViewFromFile(bridge);
    },
    export: (options): string =>
      exportBridge(options.account, {
        to: options.to,
        project: options.project,
        workspace: options.workspace,
        headers: options.headers,
      }),
    remove: (at: string | null): boolean => removeBridge({ at }),
  };
}
