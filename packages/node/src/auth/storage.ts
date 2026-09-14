/**
 * Secure local storage for OAuth tokens and client registration info —
 * TS port of `mixpanel_headless/_internal/auth/storage.py` (whole file,
 * `storage.py:1-635`; b8-packets.md §3.1 row 1).
 *
 * Persists OAuth tokens and client metadata as JSON files in a
 * permission-restricted directory (`~/.mp/oauth/` by default; the
 * LEGACY v2 region-keyed world — packet §7 caution 9: per-account
 * `~/.mp/accounts/{name}/` files are `token-resolver.ts` /
 * `me-cache.ts` territory and the two worlds are NOT unified).
 * Directory permissions are `0o700` and file permissions `0o600`.
 *
 * **Sanctioned R9.2 deviation (plan §4.2; packet §2.1 drop, carried
 * from N1's `io-utils.ts` header)**: Python's `_fchmod_no_follow`
 * repair (`storage.py:143-192`) pins the inode via an
 * `O_NOFOLLOW`-opened fd before `fchmod`. The node port substitutes an
 * `lstat` probe (symlink → warn, no chmod) followed by a plain
 * `chmodSync` — the TOCTOU window between probe and chmod is the
 * documented deviation (Phase-4 burn-in row). Observable behavior
 * (symlinked targets never chmodded; lax modes repaired; warnings on
 * failure) is preserved.
 *
 * Env reads (`MP_OAUTH_STORAGE_DIR`) happen AT CALL TIME (packet §0.4 /
 * §7 caution 16), mirroring Python's per-call `os.environ.get`.
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
  parseOAuthClientInfo,
  OAuthTokens,
  type OAuthClientInfo,
  isPythonDict,
  pythonStr,
  type PythonValue,
  MixpanelHeadlessError,
  ParamValidationError,
  Secret,
} from "@mixpanel-headless/core";
import {
  CredentialPathError,
  atomicWriteBytes,
  readCredentialText,
  rejectIfSymlink,
} from "../io-utils.js";
import {
  coerceLaxExpiresAt,
  pydanticJsonDatetimeText,
  pythonIsoformatDatetimeText,
} from "./pydantic-datetime.js";

/**
 * Injected log sink (R9.5 — log text is never vector-compared and the
 * node package must not write to `console`; the default is silent).
 */
export interface StorageLogger {
  /**
   * WARNING-level line (symlink refusals, repair failures, corrupt
   * files — the `logger.warning` sites in `storage.py`).
   *
   * @param message - The formatted warning text.
   */
  warning(message: string): void;

  /**
   * DEBUG-level line (cache-expiry chatter — `logger.debug` sites).
   *
   * @param message - The formatted debug text.
   */
  debug?(message: string): void;
}

/** The silent default logger. */
const SILENT_LOGGER: StorageLogger = {
  warning: (): void => undefined,
  debug: (): void => undefined,
};

/** Account-name pattern (`storage.py:50` — `^[a-zA-Z0-9_-]{1,64}$`). */
const ACCOUNT_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Root directory under which every on-disk artifact lives (port of
 * `_storage_root`, `storage.py:53-76`). Resolved at EVERY call so
 * `$HOME` / `MP_OAUTH_STORAGE_DIR` test isolation takes effect.
 *
 * @returns `$MP_OAUTH_STORAGE_DIR` if set (non-empty — Python `if
 *   env_dir:` falsiness), else `$HOME/.mp`.
 */
export function storageRoot(): string {
  const envDir = process.env["MP_OAUTH_STORAGE_DIR"];
  if (envDir !== undefined && envDir !== "") {
    return envDir;
  }
  return join(homedir(), ".mp");
}

/**
 * The directory holding every per-account state directory (port of
 * `accounts_root`, `storage.py:77-90`). Not created by this call.
 *
 * @returns `<storage-root>/accounts`.
 */
export function accountsRoot(): string {
  return join(storageRoot(), "accounts");
}

/**
 * The per-account directory for `name` (port of `account_dir`,
 * `storage.py:91-115`). Does not create the directory.
 *
 * @param name - Account name; validated against
 *   `^[a-zA-Z0-9_-]{1,64}$` as a defense-in-depth path-traversal check.
 * @returns Absolute path of the per-account directory.
 * @throws ParamValidationError - Invalid name (Python raises bare
 *   `ValueError`; the coded twin per R5 — no new code minted).
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
 * Create `<root>/accounts/{name}/` (and parents) with mode `0o700`
 * (port of `ensure_account_dir`, `storage.py:116-142`). Idempotent; a
 * pre-existing dir with looser permissions gets locked down.
 *
 * @param name - Account name (validated by {@link accountDir}).
 * @returns The created (or pre-existing) account directory path.
 * @throws ParamValidationError - Invalid name.
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
  /** Override the storage directory (else `<root>/oauth`). */
  readonly storageDir?: string | undefined;
  /** Injected log sink (default silent — R9.5). */
  readonly logger?: StorageLogger | undefined;
}

/**
 * Secure file-based storage for OAuth tokens and client info (port of
 * `OAuthStorage`, `storage.py:193-635`).
 *
 * Each region gets its own pair of files (`tokens_{region}.json` and
 * `client_{region}.json` — THE DCR persistence path). Directory
 * permissions `0o700`, file permissions `0o600`.
 */
export class OAuthStorage {
  /** The resolved storage directory. */
  readonly #storageDir: string;

  /** Injected log sink. */
  readonly #logger: StorageLogger;

  /**
   * Return the default OAuth storage path, resolved lazily (port of
   * `_default_storage_dir`, `storage.py:212-224`).
   *
   * @returns `<storage-root>/oauth` resolved at call time.
   */
  static defaultStorageDir(): string {
    return join(storageRoot(), "oauth");
  }

  /**
   * Initialize OAuthStorage (`storage.py:225-243`).
   *
   * @param options - Optional `storageDir` override (wins over the
   *   `MP_OAUTH_STORAGE_DIR` env default) and log sink.
   */
  constructor(options: OAuthStorageOptions = {}) {
    this.#storageDir = options.storageDir ?? OAuthStorage.defaultStorageDir();
    this.#logger = options.logger ?? SILENT_LOGGER;
  }

  /**
   * The storage directory path (`storage.py:244-251`).
   *
   * @returns The resolved storage directory.
   */
  get storageDir(): string {
    return this.#storageDir;
  }

  /**
   * Validate that a region string is safe for file paths (port of
   * `_validate_region`, `storage.py:253-276` — exactly two lowercase
   * ASCII letters).
   *
   * @param region - The region string to validate.
   * @throws ParamValidationError - Not a 2-letter lowercase string
   *   (Python raises bare `ValueError` — coded twin per R5).
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
   * Create the storage directory with restricted permissions (port of
   * `_ensure_dir`, `storage.py:277-288`; public because the Python
   * suite drives `storage._ensure_dir()` directly).
   */
  ensureDir(): void {
    mkdirSync(this.#storageDir, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") {
      chmodSync(this.#storageDir, 0o700);
    }
  }

  /**
   * Check and repair file/directory permissions (port of
   * `_check_and_fix_permissions`, `storage.py:289-365`, under the
   * module-header lstat substitution). Symlinked dirs/files are never
   * chmodded — the read path rejects them separately. Windows: no-op.
   *
   * @param path - File whose permissions (and parent dir) to check.
   */
  checkAndFixPermissions(path: string): void {
    if (process.platform === "win32") {
      return;
    }
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
   * chmod with the historic fallback warning (the `_fchmod_no_follow`
   * substitution — module header).
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
   * Atomically write JSON data with mode `0o600` (port of
   * `_write_file`, `storage.py:366-381`).
   *
   * @param path - Destination file.
   * @param data - JSON-serializable record.
   */
  #writeFile(path: string, data: Record<string, unknown>): void {
    this.ensureDir();
    atomicWriteBytes(
      path,
      new TextEncoder().encode(JSON.stringify(data, null, 2)),
    );
  }

  /**
   * Read JSON data from a file (port of `_read_file`,
   * `storage.py:382-428`): symlink probe BEFORE existence check,
   * permission check-and-fix, then a strict credential read. Corrupt /
   * non-object JSON degrades to `null` with a warning.
   *
   * @param path - File to read.
   * @returns The parsed record, or `null`.
   */
  #readFile(path: string): Record<string, unknown> | null {
    try {
      rejectIfSymlink(path);
    } catch (exc) {
      if (exc instanceof CredentialPathError) {
        this.#logger.warning(
          `Refusing to read credential file ${path}: ${exc.message}`,
        );
        return null;
      }
      throw exc;
    }
    if (!existsSync(path)) {
      return null;
    }
    this.checkAndFixPermissions(path);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readCredentialText(path));
    } catch (exc) {
      if (exc instanceof CredentialPathError) {
        // Symlink or lax mode rejected by the read helper — WARNING,
        // not the lower-severity corrupt-JSON path (`storage.py:408`).
        this.#logger.warning(
          `Refusing to read credential file ${path}: ${exc.message}`,
        );
        return null;
      }
      // Python degrades ONLY the ValueError family —
      // `(json.JSONDecodeError, ValueError, UnicodeDecodeError)`
      // (`storage.py:415-419`); the TS twins are `SyntaxError`
      // (JSON.parse) and `TypeError` (TextDecoder fatal decode). An
      // OSError (errno error, e.g. EACCES on a root-owned file)
      // PROPAGATES rather than reading a permission problem as "no
      // tokens" — B8-ARB-A SEM-F2a (`b8-reviewA-resolution.md`).
      if (!(exc instanceof SyntaxError || exc instanceof TypeError)) {
        throw exc;
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
   * Tokens file path for a region (port of `_tokens_path`,
   * `storage.py:429-439`; public because the Python suite computes it).
   *
   * @param region - Mixpanel region.
   * @returns `<dir>/tokens_{region}.json`.
   */
  tokensPath(region: string): string {
    return join(this.#storageDir, `tokens_${region}.json`);
  }

  /**
   * Client-info file path for a region — THE DCR persistence path
   * (port of `_client_path`, `storage.py:440-450`).
   *
   * @param region - Mixpanel region.
   * @returns `<dir>/client_{region}.json`.
   */
  clientPath(region: string): string {
    return join(this.#storageDir, `client_${region}.json`);
  }

  /**
   * Persist OAuth tokens to disk (port of `save_tokens`,
   * `storage.py:451-478`). CRED-F3: a DESIGNATED reveal site — secrets
   * are unwrapped explicitly, never via `JSON.stringify(tokens)`.
   *
   * @param tokens - The tokens to save.
   * @param region - Mixpanel region (`us` / `eu` / `in`).
   * @throws ParamValidationError - Invalid region.
   */
  saveTokens(tokens: OAuthTokens, region: string): void {
    OAuthStorage.validateRegion(region);
    const data: Record<string, unknown> = {
      access_token: tokens.access_token.reveal(),
      // `datetime.isoformat()` twin (`storage.py:471` — B8-ARB-B F2:
      // never echo a foreign `Z` spelling into the written file).
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
   * Load OAuth tokens from disk (port of `load_tokens`,
   * `storage.py:479-525`). Missing / corrupt / schema-invalid files
   * degrade to `null` exactly as Python's KeyError/TypeError/ValueError
   * catch does.
   *
   * @param region - Mixpanel region.
   * @returns The loaded tokens, or `null`.
   * @throws ParamValidationError - Invalid region.
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
          : new Secret(pythonStr(rawRefresh as PythonValue));
      const expiresAt = coerceLaxExpiresAt(data["expires_at"]);
      if (!Object.hasOwn(data, "scope") || !Object.hasOwn(data, "token_type")) {
        throw new ParamValidationError("missing scope/token_type");
      }
      return new OAuthTokens({
        // JSON-decoded values are PythonValue by construction (the
        // `str()` coercion mirror of `storage.py:511-517`).
        access_token: new Secret(
          pythonStr(data["access_token"] as PythonValue),
        ),
        refresh_token: refreshToken,
        expires_at: expiresAt,
        scope: pythonStr(data["scope"] as PythonValue),
        token_type: pythonStr(data["token_type"] as PythonValue),
      });
    } catch (exc) {
      if (exc instanceof MixpanelHeadlessError || exc instanceof TypeError) {
        this.#logger.warning(
          `Failed to parse tokens from tokens_${region}.json: ` +
            `${exc.message} — ignoring file.`,
        );
        return null;
      }
      throw exc;
    }
  }

  /**
   * Persist OAuth client registration info (port of
   * `save_client_info`, `storage.py:526-543`).
   *
   * @param info - The client registration info (its `region` field
   *   selects the file).
   * @throws ParamValidationError - Invalid region.
   */
  saveClientInfo(info: OAuthClientInfo): void {
    OAuthStorage.validateRegion(info.region);
    const data: Record<string, unknown> = {
      client_id: info.client_id,
      region: info.region,
      redirect_uri: info.redirect_uri,
      scope: info.scope,
      // Pydantic JSON mode spells UTC with `Z` (`storage.py:541`
      // `model_dump(mode="json")` — B8-ARB-B F2 byte-parity lock).
      created_at: pydanticJsonDatetimeText(info.created_at),
    };
    this.#writeFile(this.clientPath(info.region), data);
  }

  /**
   * Load OAuth client registration info (port of `load_client_info`,
   * `storage.py:544-574`). Missing / corrupt files degrade to `null`.
   *
   * @param region - Mixpanel region.
   * @returns The loaded info, or `null`.
   * @throws ParamValidationError - Invalid region.
   */
  loadClientInfo(region: string): OAuthClientInfo | null {
    OAuthStorage.validateRegion(region);
    const data = this.#readFile(this.clientPath(region));
    if (data === null) {
      return null;
    }
    try {
      // Pydantic-LAX twin for `created_at` (`storage.py:566`
      // `OAuthClientInfo.model_validate` — B8-ARB-B F1 sibling: a
      // numeric epoch coerces; unparseable text degrades to null).
      let payload: Record<string, unknown> = data;
      if (Object.hasOwn(payload, "created_at")) {
        payload = {
          ...payload,
          created_at: coerceLaxExpiresAt(payload["created_at"]),
        };
      }
      return parseOAuthClientInfo(payload);
    } catch (exc) {
      if (exc instanceof MixpanelHeadlessError) {
        this.#logger.warning(
          `Failed to parse client info from client_${region}.json: ` +
            `${exc.message} — ignoring file.`,
        );
        return null;
      }
      throw exc;
    }
  }

  /**
   * Delete stored tokens for a region (port of `delete_tokens`,
   * `storage.py:575-593`). Missing file is a no-op.
   *
   * @param region - Mixpanel region.
   * @throws ParamValidationError - Invalid region.
   */
  deleteTokens(region: string): void {
    OAuthStorage.validateRegion(region);
    const path = this.tokensPath(region);
    if (existsSync(path)) {
      unlinkSync(path);
    }
  }

  /**
   * Delete all stored `*.json` files, preserving the directory (port
   * of `delete_all`, `storage.py:594-611`).
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
   * Remove all legacy `me_*.json` cache files (port of
   * `clear_me_cache`, `storage.py:612-635`).
   *
   * @returns Number of cache files removed.
   */
  clearMeCache(): number {
    if (!existsSync(this.#storageDir)) {
      return 0;
    }
    let count = 0;
    for (const name of readdirSync(this.#storageDir)) {
      if (name.startsWith("me_") && name.endsWith(".json")) {
        unlinkSync(join(this.#storageDir, name));
        count += 1;
      }
    }
    return count;
  }
}

// NOTE (B8-ARB-B, `b8-reviewB-resolution.md` F1): the former private
// `coerceStoredExpiresAt` helper moved to `./pydantic-datetime.ts` as
// `coerceLaxExpiresAt` — ONE pydantic-lax mirror shared by every
// credential read path (R10.8), now covering the numeric-STRING epoch
// spelling and the speedate seconds/milliseconds watershed too.
