/**
 * Secure local storage for OAuth tokens and client registration info:
 * JSON files in a permission-restricted directory (`~/.mp/oauth/` by
 * default, dir `0o700`, files `0o600`). This is the legacy region-keyed
 * layout; the per-account `~/.mp/accounts/{name}/` files belong to
 * `token-resolver.ts` and `me-cache.ts`, and the two layouts are
 * deliberately not unified. `MP_OAUTH_STORAGE_DIR` is read at call time,
 * mirroring Python's per-call `os.environ.get`.
 *
 * @see mixpanel_headless._internal.auth.storage
 */

import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  isPythonDict,
  MixpanelHeadlessError,
  type OAuthClientInfo,
  OAuthTokens,
  ParamValidationError,
  parseOAuthClientInfo,
  Secret,
} from "@mixpanel-headless/core";

import {
  atomicWriteBytes,
  CredentialPathError,
  readCredentialText,
  rejectIfSymlink,
} from "../io-utils.js";
import { jsonPythonStr } from "./json-str.js";
import {
  coerceLaxExpiresAt,
  pydanticJsonDatetimeText,
  pythonIsoformatDatetimeText,
} from "./pydantic-datetime.js";

/**
 * Injected log sink. Log text is never vector-compared and the node
 * package must not write to `console`, so the default is silent.
 */
export interface StorageLogger {
  /**
   * Write a warning-level line (symlink refusals, repair failures,
   * corrupt files — Python's `logger.warning` sites).
   *
   * @param message - The formatted warning text.
   */
  warning: (message: string) => void;

  /**
   * Write a debug-level line (cache-expiry chatter — Python's
   * `logger.debug` sites).
   *
   * @param message - The formatted debug text.
   */
  debug?: (message: string) => void;
}

/** The silent default logger. */
const SILENT_LOGGER: StorageLogger = {
  warning: (): void => undefined,
  debug: (): void => undefined,
};

/** Account-name pattern, `^[a-zA-Z0-9_-]{1,64}$` as in Python. */
const ACCOUNT_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Return the root directory under which every on-disk artifact lives.
 * Resolved on every call so `$HOME` / `MP_OAUTH_STORAGE_DIR` test
 * isolation takes effect.
 *
 * @returns `$MP_OAUTH_STORAGE_DIR` if set and non-empty (Python's
 *   `if env_dir:` falsiness), else `$HOME/.mp`.
 * @example
 * ```ts
 * process.env.MP_OAUTH_STORAGE_DIR = "/tmp/mp-test";
 * storageRoot(); // "/tmp/mp-test"
 * ```
 * @see mixpanel_headless._internal.auth.storage._storage_root
 */
export function storageRoot(): string {
  const envDir = process.env["MP_OAUTH_STORAGE_DIR"];
  if (envDir !== undefined && envDir !== "") {
    return envDir;
  }
  return join(homedir(), ".mp");
}

/**
 * Return the directory holding every per-account state directory. Not
 * created by this call.
 *
 * @returns `{storageRoot}/accounts`.
 * @example
 * ```ts
 * for (const name of readdirSync(accountsRoot())) { ... }
 * ```
 * @see mixpanel_headless._internal.auth.storage.accounts_root
 */
export function accountsRoot(): string {
  return join(storageRoot(), "accounts");
}

/**
 * Return the per-account directory for `name`. Does not create the
 * directory.
 *
 * @param name - Account name; validated against
 *   `^[a-zA-Z0-9_-]{1,64}$` as a defense-in-depth path-traversal check.
 * @returns Absolute path of the per-account directory.
 * @throws {@link ParamValidationError} - Invalid name (Python raises a
 *   bare `ValueError`; no new code minted).
 * @example
 * ```ts
 * const tokensPath = join(accountDir("team"), "tokens.json");
 * ```
 * @see mixpanel_headless._internal.auth.storage.account_dir
 */
export function accountDir(name: string): string {
  if (!ACCOUNT_NAME_PATTERN.test(name)) {
    throw new ParamValidationError(
      `Invalid account name: ${JSON.stringify(name)}. ` +
        "Must match `^[a-zA-Z0-9_-]{1,64}$`.",
    );
  }
  return join(accountsRoot(), name);
}

/**
 * Create `{storageRoot}/accounts/{name}/` (and parents) with mode
 * `0o700`. Idempotent; a pre-existing dir with looser permissions gets
 * locked down.
 *
 * @param name - Account name (validated by {@link accountDir}).
 * @returns The created (or pre-existing) account directory path.
 * @throws {@link ParamValidationError} - Invalid name.
 * @example
 * ```ts
 * const path = join(ensureAccountDir("team"), "tokens.json");
 * atomicWriteBytes(path, tokenPayloadBytes(tokens));
 * ```
 * @see mixpanel_headless._internal.auth.storage.ensure_account_dir
 */
export function ensureAccountDir(name: string): string {
  const path = accountDir(name);
  // Python masks the umask around mkdir then chmods; node applies the
  // mode at create and the defensive chmod covers pre-existing dirs.
  mkdirSync(path, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    chmodSync(path, 0o700);
  }
  return path;
}

/** Options bag of {@link OAuthStorage}. */
export interface OAuthStorageOptions {
  /**
   * Override the storage directory.
   *
   * @defaultValue `{storageRoot}/oauth`
   */
  readonly storageDir?: string | undefined;
  /**
   * Injected log sink.
   *
   * @defaultValue silent
   */
  readonly logger?: StorageLogger | undefined;
}

/**
 * Secure file-based storage for OAuth tokens and client info. Each
 * region gets its own pair of files, `tokens_{region}.json` and
 * `client_{region}.json` (the DCR persistence path); directory
 * permissions `0o700`, file permissions `0o600`.
 *
 * @remarks
 * Python's `_fchmod_no_follow` repair pins the inode via an
 * `O_NOFOLLOW`-opened fd before `fchmod`; the node port substitutes an
 * `lstat` probe (symlink means warn, no chmod) followed by a plain
 * `chmodSync` (the `// Divergence:` line at
 * {@link OAuthStorage.checkAndFixPermissions}). Observable behaviour
 * (symlinked targets never chmodded, lax modes repaired, warnings on
 * failure) is preserved.
 * @example
 * ```ts
 * const storage = new OAuthStorage();
 * storage.saveClientInfo(clientInfo);
 * const cached = storage.loadClientInfo("us"); // OAuthClientInfo or null
 * ```
 * @see mixpanel_headless._internal.auth.storage.OAuthStorage
 */
export class OAuthStorage {
  /** The resolved storage directory. */
  readonly #storageDir: string;

  /** Injected log sink. */
  readonly #logger: StorageLogger;

  /**
   * Return the default OAuth storage path, resolved at call time.
   *
   * @returns `{storageRoot}/oauth`.
   * @see mixpanel_headless._internal.auth.storage.OAuthStorage._default_storage_dir
   */
  static defaultStorageDir(): string {
    return join(storageRoot(), "oauth");
  }

  /**
   * Initialize the storage.
   *
   * @param options - Optional `storageDir` override (wins over the
   *   `MP_OAUTH_STORAGE_DIR` env default) and log sink.
   */
  constructor(options: OAuthStorageOptions = {}) {
    this.#storageDir = options.storageDir ?? OAuthStorage.defaultStorageDir();
    this.#logger = options.logger ?? SILENT_LOGGER;
  }

  /**
   * Read the storage directory path.
   *
   * @returns The resolved storage directory.
   */
  get storageDir(): string {
    return this.#storageDir;
  }

  /**
   * Validate that a region string is safe for file paths: exactly two
   * lowercase ASCII letters.
   *
   * @param region - The region string to validate.
   * @throws {@link ParamValidationError} - Not a 2-letter lowercase
   *   string (Python raises a bare `ValueError`).
   * @see mixpanel_headless._internal.auth.storage.OAuthStorage._validate_region
   */
  static validateRegion(region: string): void {
    if (!/^[a-z]{2}$/.test(region)) {
      throw new ParamValidationError(
        `Invalid region: ${JSON.stringify(region)}. ` +
          "Must be a 2-letter lowercase string.",
      );
    }
  }

  /**
   * Create the storage directory with restricted permissions; public
   * because the Python suite drives `storage._ensure_dir()` directly.
   *
   * @see mixpanel_headless._internal.auth.storage.OAuthStorage._ensure_dir
   */
  ensureDir(): void {
    mkdirSync(this.#storageDir, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") {
      chmodSync(this.#storageDir, 0o700);
    }
  }

  /**
   * Check and repair file and directory permissions. Symlinked dirs and
   * files are never chmodded (the read path rejects them separately);
   * on Windows this is a no-op.
   *
   * @param path - File whose permissions (and parent dir) to check.
   * @see mixpanel_headless._internal.auth.storage.OAuthStorage._check_and_fix_permissions
   */
  checkAndFixPermissions(path: string): void {
    if (process.platform === "win32") {
      return;
    }
    // Divergence: Python's `_fchmod_no_follow` pins the inode with an `O_NOFOLLOW` fd before `fchmod`; the port probes with `lstat` and then calls `chmodSync` by path, leaving a TOCTOU window between probe and chmod.
    const dirSt = lstatSync(this.#storageDir, { throwIfNoEntry: false });
    if (dirSt !== undefined) {
      if (dirSt.isSymbolicLink()) {
        this.#logger.warning(
          "Refusing to chmod through symlinked storage directory.",
        );
      } else if ((dirSt.mode & 0o7777) !== 0o700) {
        this.#repairMode(this.#storageDir, 0o700, dirSt.mode & 0o7777);
      }
    }
    const fileSt = lstatSync(path, { throwIfNoEntry: false });
    if (fileSt === undefined) {
      return;
    }
    if (fileSt.isSymbolicLink()) {
      this.#logger.warning(
        `Refusing to chmod through symlink at ${path}. The subsequent ` +
          "read will reject the symlink and the cache will be re-fetched.",
      );
      return;
    }
    if ((fileSt.mode & 0o7777) !== 0o600) {
      this.#repairMode(path, 0o600, fileSt.mode & 0o7777);
    }
  }

  /**
   * chmod with the fallback warning (the `_fchmod_no_follow` substitute).
   *
   * @param path - Target path (already lstat-verified non-symlink).
   * @param mode - Target mode bits.
   * @param got - The observed lax mode (for the warning text).
   */
  #repairMode(path: string, mode: number, got: number): void {
    try {
      chmodSync(path, mode);
    } catch {
      this.#logger.warning(
        `Cannot repair permissions on ${path}. ` +
          `Expected 0o${mode.toString(8)}, got 0o${got.toString(8)}.`,
      );
    }
  }

  /**
   * Atomically write JSON data with mode `0o600`.
   *
   * @param path - Destination file.
   * @param data - JSON-serializable record.
   * @see mixpanel_headless._internal.auth.storage.OAuthStorage._write_file
   */
  #writeFile(path: string, data: Record<string, unknown>): void {
    this.ensureDir();
    atomicWriteBytes(
      path,
      new TextEncoder().encode(JSON.stringify(data, null, 2)),
    );
  }

  /**
   * Read JSON data from a file: symlink probe before the existence
   * check, permission check-and-fix, then a strict credential read.
   * Corrupt or non-object JSON degrades to `null` with a warning.
   *
   * @param path - File to read.
   * @returns The parsed record, or `null`.
   * @throws Error - Node system errors from the read (e.g. `EACCES`)
   *   propagate: Python's degrade clause catches only the `ValueError`
   *   family and lets an `OSError` through.
   * @see mixpanel_headless._internal.auth.storage.OAuthStorage._read_file
   */
  #readFile(path: string): Record<string, unknown> | null {
    try {
      rejectIfSymlink(path);
    } catch (error) {
      if (error instanceof CredentialPathError) {
        this.#logger.warning(
          `Refusing to read credential file ${path}: ${error.message}`,
        );
        return null;
      }
      throw error;
    }
    if (!existsSync(path)) {
      return null;
    }
    this.checkAndFixPermissions(path);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readCredentialText(path));
    } catch (error) {
      if (error instanceof CredentialPathError) {
        // Symlink or lax mode rejected by the read helper: a warning,
        // not the lower-severity corrupt-JSON path.
        this.#logger.warning(
          `Refusing to read credential file ${path}: ${error.message}`,
        );
        return null;
      }
      // Python degrades only the ValueError family
      // (`json.JSONDecodeError`, `ValueError`, `UnicodeDecodeError`);
      // the TS twins are `SyntaxError` (JSON.parse) and `TypeError`
      // (TextDecoder fatal decode). An OSError (errno error, e.g. EACCES
      // on a root-owned file) propagates rather than reading a
      // permission problem as "no tokens".
      if (!(error instanceof SyntaxError || error instanceof TypeError)) {
        throw error;
      }
      this.#logger.warning(
        `Corrupted or invalid JSON in ${path} — ignoring file.`,
      );
      return null;
    }
    if (!isPythonDict(parsed)) {
      this.#logger.warning(
        `Expected JSON object in ${path}, got ${typeof parsed} — ignoring file.`,
      );
      return null;
    }
    return parsed;
  }

  /**
   * Return the tokens file path for a region; public because the Python
   * suite computes it.
   *
   * @param region - Mixpanel region.
   * @returns `{storageDir}/tokens_{region}.json`.
   * @see mixpanel_headless._internal.auth.storage.OAuthStorage._tokens_path
   */
  tokensPath(region: string): string {
    return join(this.#storageDir, `tokens_${region}.json`);
  }

  /**
   * Return the client-info file path for a region (the DCR persistence
   * path).
   *
   * @param region - Mixpanel region.
   * @returns `{storageDir}/client_{region}.json`.
   * @see mixpanel_headless._internal.auth.storage.OAuthStorage._client_path
   */
  clientPath(region: string): string {
    return join(this.#storageDir, `client_${region}.json`);
  }

  /**
   * Persist OAuth tokens to disk. A designated secret-reveal site:
   * secrets are unwrapped explicitly, never via
   * `JSON.stringify(tokens)`.
   *
   * @param tokens - The tokens to save.
   * @param region - Mixpanel region (`us`, `eu` or `in`).
   * @throws {@link ParamValidationError} - Invalid region.
   * @see mixpanel_headless._internal.auth.storage.OAuthStorage.save_tokens
   */
  saveTokens(tokens: OAuthTokens, region: string): void {
    OAuthStorage.validateRegion(region);
    const data: Record<string, unknown> = {
      access_token: tokens.access_token.reveal(),
      // `datetime.isoformat()` twin: never echo a foreign `Z` spelling
      // into the written file.
      expires_at: pythonIsoformatDatetimeText(tokens.expires_at),
      scope: tokens.scope,
      token_type: tokens.token_type,
    };
    if (tokens.refresh_token !== null) {
      data["refresh_token"] = tokens.refresh_token.reveal();
    }
    this.#writeFile(this.tokensPath(region), data);
  }

  /**
   * Load OAuth tokens from disk. Missing, corrupt or schema-invalid
   * files degrade to `null` exactly as Python's
   * KeyError/TypeError/ValueError catch does.
   *
   * @param region - Mixpanel region.
   * @returns The loaded tokens, or `null`.
   * @throws {@link ParamValidationError} - Invalid region.
   * @see mixpanel_headless._internal.auth.storage.OAuthStorage.load_tokens
   */
  loadTokens(region: string): OAuthTokens | null {
    OAuthStorage.validateRegion(region);
    const data = this.#readFile(this.tokensPath(region));
    if (data === null) {
      return null;
    }
    try {
      if (!Object.hasOwn(data, "access_token")) {
        throw new ParamValidationError("missing access_token");
      }
      const rawRefresh = data["refresh_token"];
      const refreshToken =
        rawRefresh === null || rawRefresh === undefined
          ? null
          : new Secret(jsonPythonStr(rawRefresh, "refresh_token"));
      const expiresAt = coerceLaxExpiresAt(data["expires_at"]);
      if (!Object.hasOwn(data, "scope") || !Object.hasOwn(data, "token_type")) {
        throw new ParamValidationError("missing scope/token_type");
      }
      return new OAuthTokens({
        // Python's `str()` coercion over each decoded member.
        access_token: new Secret(
          jsonPythonStr(data["access_token"], "access_token"),
        ),
        refresh_token: refreshToken,
        expires_at: expiresAt,
        scope: jsonPythonStr(data["scope"], "scope"),
        token_type: jsonPythonStr(data["token_type"], "token_type"),
      });
    } catch (error) {
      if (
        error instanceof MixpanelHeadlessError ||
        error instanceof TypeError
      ) {
        this.#logger.warning(
          `Failed to parse tokens from tokens_${region}.json: ` +
            `${error.message} — ignoring file.`,
        );
        return null;
      }
      throw error;
    }
  }

  /**
   * Persist OAuth client registration info.
   *
   * @param info - The client registration info (its `region` field
   *   selects the file).
   * @throws {@link ParamValidationError} - Invalid region.
   * @see mixpanel_headless._internal.auth.storage.OAuthStorage.save_client_info
   */
  saveClientInfo(info: OAuthClientInfo): void {
    OAuthStorage.validateRegion(info.region);
    const data: Record<string, unknown> = {
      client_id: info.client_id,
      region: info.region,
      redirect_uri: info.redirect_uri,
      scope: info.scope,
      // Pydantic JSON mode (`model_dump(mode="json")`) spells UTC with
      // `Z`; the written file must be byte-identical to Python's.
      created_at: pydanticJsonDatetimeText(info.created_at),
    };
    this.#writeFile(this.clientPath(info.region), data);
  }

  /**
   * Load OAuth client registration info. Missing or corrupt files
   * degrade to `null`.
   *
   * @param region - Mixpanel region.
   * @returns The loaded info, or `null`.
   * @throws {@link ParamValidationError} - Invalid region.
   * @see mixpanel_headless._internal.auth.storage.OAuthStorage.load_client_info
   */
  loadClientInfo(region: string): OAuthClientInfo | null {
    OAuthStorage.validateRegion(region);
    const data = this.#readFile(this.clientPath(region));
    if (data === null) {
      return null;
    }
    try {
      // Pydantic-lax twin for `created_at` (`OAuthClientInfo.model_validate`):
      // a numeric epoch coerces; unparseable text degrades to null.
      let payload: Record<string, unknown> = data;
      if (Object.hasOwn(payload, "created_at")) {
        payload = {
          ...payload,
          created_at: coerceLaxExpiresAt(payload["created_at"]),
        };
      }
      return parseOAuthClientInfo(payload);
    } catch (error) {
      if (error instanceof MixpanelHeadlessError) {
        this.#logger.warning(
          `Failed to parse client info from client_${region}.json: ` +
            `${error.message} — ignoring file.`,
        );
        return null;
      }
      throw error;
    }
  }

  /**
   * Delete stored tokens for a region; a missing file is a no-op.
   *
   * @param region - Mixpanel region.
   * @throws {@link ParamValidationError} - Invalid region.
   * @see mixpanel_headless._internal.auth.storage.OAuthStorage.delete_tokens
   */
  deleteTokens(region: string): void {
    OAuthStorage.validateRegion(region);
    const path = this.tokensPath(region);
    if (existsSync(path)) {
      unlinkSync(path);
    }
  }

  /**
   * Delete all stored `*.json` files, preserving the directory.
   *
   * @see mixpanel_headless._internal.auth.storage.OAuthStorage.delete_all
   */
  deleteAll(): void {
    if (!existsSync(this.#storageDir)) {
      return;
    }
    for (const name of readdirSync(this.#storageDir)) {
      if (name.endsWith(".json")) {
        rmSync(join(this.#storageDir, name), { force: true });
      }
    }
  }

  /**
   * Remove all legacy `me_*.json` cache files.
   *
   * @returns Number of cache files removed.
   * @see mixpanel_headless._internal.auth.storage.OAuthStorage.clear_me_cache
   */
  clearMeCache(): number {
    if (!existsSync(this.#storageDir)) {
      return 0;
    }
    let count = 0;
    for (const name of readdirSync(this.#storageDir)) {
      if (!(name.startsWith("me_") && name.endsWith(".json"))) {
        continue;
      }

      unlinkSync(join(this.#storageDir, name));
      count += 1;
    }
    return count;
  }
}
