/**
 * Cowork credential bridge (v2 schema) — TS port of
 * `mixpanel_headless/_internal/auth/bridge.py` (whole file,
 * `bridge.py:1-409`; b8-packets.md §3.1 row 4), plus the Workspace
 * constructor's bridge-token materialization side effect
 * (`workspace.py:476-513` — the inbound
 * `TestBridgeTokenMaterialization` duty, packet §3.3 row 8).
 *
 * Bridge file search order (first existing wins):
 *   1. explicit `path` argument;
 *   2. `$MP_AUTH_FILE` (call-time read — packet §0.5);
 *   3. `~/.claude/mixpanel/auth.json`, then `<cwd>/mixpanel_auth.json`.
 *
 * CRED-F3 (b7-reviewB-resolution.md): `serializeBridge` is a
 * DESIGNATED reveal site — the bridge crosses a trust boundary by
 * design and MUST carry raw secrets, never the `**********` mask.
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
 * Parsed v2 bridge file (the `BridgeFile` Pydantic model twin,
 * `bridge.py:61-117` — `frozen=True`, `extra="forbid"`).
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
 * Default bridge file paths in priority order (port of
 * `default_bridge_search_paths`, `bridge.py:119-136`). `MP_AUTH_FILE`
 * is consulted by CALLERS before any default path.
 *
 * @returns Candidate paths (Cowork default first, then cwd fallback).
 */
export function defaultBridgeSearchPaths(): readonly string[] {
  return [
    join(homedir(), ".claude", "mixpanel", "auth.json"),
    join(process.cwd(), "mixpanel_auth.json"),
  ];
}

/**
 * Validate a raw payload against the v2 bridge schema (the
 * `BridgeFile.model_validate` twin — the 042 edge-case class drives it
 * directly, `test_042_edge_cases.py:394`).
 *
 * @param raw - The parsed JSON payload.
 * @returns The validated bridge.
 * @throws ParamValidationError - Any schema violation (the Pydantic
 *   `ValidationError` twin; `loadBridge` wraps it in `ConfigError`).
 */
export function parseBridgeFile(raw: unknown): BridgeFile {
  if (!isPythonDict(raw)) {
    throw new ParamValidationError("BridgeFile payload must be an object");
  }
  for (const key of Object.keys(raw)) {
    if (!BRIDGE_KEYS.has(key)) {
      // `extra="forbid"` (`bridge.py:83`).
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
    // Pydantic-LAX twin (B8-ARB-B F1, `b8-reviewB-resolution.md`): the
    // Python `BridgeFile.tokens` model coerces numeric epoch
    // `expires_at` values, and rejects tz-suffixed non-instants.
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
    // Pattern `^\d+$` — a REGEX gate, never `pythonInt` (packet §7
    // caution 1: two-parser rule).
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
    // `PositiveInt` under Pydantic-lax: int, or a digit string via the
    // Python `int()` parser (R11.7 — `pythonInt`, not `Number()`).
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
  // Model validator (`bridge.py:103-116`): oauth_browser requires
  // tokens.
  if (account.type === "oauth_browser" && tokens === null) {
    throw new ParamValidationError(
      "BridgeFile with oauth_browser account requires `tokens`.",
    );
  }
  return { version: 2, account, tokens, project, workspace, headers };
}

/**
 * Load and validate a v2 bridge file from disk (port of `load_bridge`,
 * `bridge.py:137-194`).
 *
 * @param path - Optional explicit bridge path (else `$MP_AUTH_FILE`,
 *   else the default search paths — first existing wins).
 * @returns The parsed bridge, or `null` when no candidate exists.
 * @throws ConfigError - A candidate exists but is symlinked, unreadable,
 *   malformed, or fails schema validation.
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
    // Symlink probe BEFORE the existence check (`bridge.py:166-176`).
    // Python wraps ANY OSError from the probe (`except OSError`) —
    // errno-bearing lstat failures code up like the symlink refusal
    // (B8-ARB-A SEM-F6 family, `b8-reviewA-resolution.md`).
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
      // Python wraps `(OSError, json.JSONDecodeError)` only
      // (`bridge.py:181`); a UnicodeDecodeError escapes RAW — the TS
      // twin (TextDecoder fatal-mode TypeError) propagates unchanged
      // (B8-ARB-A SEM-F2b, live CPython probe in the resolution).
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
 * Load on-disk OAuth tokens for an oauth_browser account — snapshot
 * semantics, NO refresh attempt (port of `_read_browser_tokens`,
 * `bridge.py:197-275`).
 *
 * @param name - Account name (locates the per-account tokens file).
 * @returns The parsed tokens.
 * @throws OAuthError - Missing / symlinked / malformed tokens file.
 */
function readBrowserTokens(name: string): OAuthTokens {
  const path = join(accountDir(name), "tokens.json");
  // Python wraps ANY OSError from the probe (`bridge.py:221-227`
  // `except OSError`) — errno-bearing lstat failures included
  // (B8-ARB-A SEM-F6 family, `b8-reviewA-resolution.md`).
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
    // Python wraps `(OSError, json.JSONDecodeError)` only
    // (`bridge.py:235-242`); the UnicodeDecodeError twin (TextDecoder
    // fatal-mode TypeError) propagates RAW (B8-ARB-A SEM-F2 family).
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
 * Serialize a bridge to UTF-8 JSON bytes with secrets UNWRAPPED (port
 * of `_serialize_bridge`, `bridge.py:278-311` — the CRED-F3 reveal
 * site; `exclude_none` + `sort_keys=True` + 2-space indent).
 *
 * @param bridge - Validated bridge.
 * @returns UTF-8 encoded JSON bytes ready for atomic write.
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
      // Pydantic JSON mode spells UTC with `Z` (`bridge.py:292`
      // `model_dump(mode="json")` — B8-ARB-B F2 byte-parity lock).
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
 * Recursively sort object keys (the `json.dumps(sort_keys=True)`
 * twin; string keys sort lexicographically and JS preserves string-key
 * insertion order). Python `sorted()` orders by CODEPOINT, so the
 * comparator is R11.5's `sortedByCodepoint` — the default
 * `Array.prototype.sort` compares UTF-16 code units, which inverts
 * e.g. `"｡"` vs `"😀"` (B8-ARB-A SEM-F4, `b8-reviewA-resolution.md`).
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

/** Kwonly options of {@link exportBridge} (R3.8). */
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
 * Write a v2 bridge file embedding the account's full record (port of
 * `export_bridge`, `bridge.py:314-369`). For oauth_browser accounts
 * the current on-disk tokens are embedded (snapshot; no refresh).
 * Atomic 0o600 write — a consumer never observes a half-written file,
 * and a failed export leaves nothing behind.
 *
 * @param account - Account to embed (secrets inline by design, B3).
 * @param options - Destination + optional pins. (The Python
 *   `token_resolver` kwarg is signature parity only — the on-disk
 *   reader is used directly, `bridge.py:321`; the `BridgeEffects`
 *   adapter accepts and ignores it the same way.)
 * @returns The path written (same as `options.to`).
 * @throws OAuthError - oauth_browser account with missing/malformed
 *   on-disk tokens.
 * @throws ParamValidationError - Bad project format / non-positive
 *   workspace, RAW (Python's pydantic ValidationError escapes
 *   `export_bridge` unwrapped, `bridge.py:357-364` — B8-ARB-A SEM-F3;
 *   the Python docstring's ConfigError claim is wrong in Python too).
 */
export function exportBridge(
  account: Account,
  options: ExportBridgeOptions,
): string {
  let tokens: OAuthTokens | null = null;
  if (account.type === "oauth_browser") {
    tokens = readBrowserTokens(account.name);
  }
  // Invalid pins propagate the model's ParamValidationError RAW —
  // Python builds `BridgeFile(...)` with no try/except
  // (`bridge.py:357-364`; the pydantic ValidationError escapes
  // unwrapped, matching the established validation-error convention).
  // B8-ARB-A SEM-F3, `b8-reviewA-resolution.md`.
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
 * Validate an export `project` pin (`^\d+$` — the BridgeFile field
 * constraint).
 *
 * @param project - The candidate pin.
 * @returns The validated pin (or `null`).
 * @throws ParamValidationError - Non-digit-string pin.
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
 * Validate an export `workspace` pin (PositiveInt).
 *
 * @param workspace - The candidate pin.
 * @returns The validated pin (or `null`).
 * @throws ParamValidationError - Non-positive / non-integer pin.
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

/** Kwonly options of {@link removeBridge} (R3.8). */
export interface RemoveBridgeOptions {
  /** Explicit bridge path (else `$MP_AUTH_FILE`, else defaults). */
  readonly at?: string | null | undefined;
}

/**
 * Delete the bridge file at the resolved path (port of
 * `remove_bridge`, `bridge.py:372-400`). Idempotent.
 *
 * @param options - Optional explicit path.
 * @returns `true` if a file was deleted; `false` if none was found.
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
 * The resolver's view of a bridge (`ResolverSources.bridge` — packet
 * §3.2 item 9: the resolver rung reads THIS shape).
 *
 * @param bridge - A loaded bridge file.
 * @returns The four-field view.
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
 * The Workspace constructor's bridge-token materialization side effect
 * (port of `workspace.py:476-513`): when the bridge embeds
 * oauth_browser tokens, ALWAYS overwrite the per-account
 * `tokens.json` — the bridge is the authoritative source of truth at
 * startup (a refreshed payload from the host must replace any stale
 * on-disk cache). Empty bridge scope gets the `"read"` default so the
 * cached file matches what `mp account login` would have written.
 *
 * @param bridge - The loaded bridge.
 * @returns The written tokens path, or `null` when the bridge carries
 *   no oauth_browser tokens (non-browser account, or no bridge tokens).
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
 * The `Workspace()` startup composition (`workspace.py:476-513`):
 * `load_bridge()` + the materialization side effect. The SHIPPED
 * caller is `createNodeWorkspaceSources()` (auth-effects.ts — the
 * facade-construction sources; B8-ARB-A SEM-F1,
 * `b8-reviewA-resolution.md`); in-session `use()` re-resolution and
 * the namespace surfaces go through the pure loader
 * (`createNodeResolverSources` — Python does not re-materialize on
 * `use`).
 *
 * @returns The loaded bridge (post-materialization), or `null`.
 * @throws ConfigError - Malformed bridge file.
 */
export function loadBridgeForStartup(): BridgeFile | null {
  const bridge = loadBridge();
  if (bridge !== null) {
    materializeBridgeTokens(bridge);
  }
  return bridge;
}

/**
 * The real node `BridgeEffects` (auth-effects.ts:259-303 — packet §3.5).
 * `load()` is the PURE loader producing the resolver view; `export` /
 * `remove` are the writer pair.
 *
 * @returns The effects triple over the on-disk world.
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
