/**
 * On-disk TOML configuration manager — TS port of
 * `mixpanel_headless/_internal/config.py` (whole file,
 * `config.py:1-1061`; b8-packets.md §2.1 row 2).
 *
 * Owns the single-schema TOML config file (`~/.mp/config.toml`, or the
 * `MP_CONFIG_PATH` override read at CONSTRUCTION time exactly as
 * Python's `__init__` does, `config.py:141-153`) with `[active]`,
 * `[accounts.NAME]`, `[targets.NAME]`, `[settings]` sections.
 *
 * Transaction contract (`config.py:207-235`): every public mutator is
 * ONE `readRaw → mutate → validateRaw → writeRaw` cycle exposed here as
 * {@link ConfigManager.transaction} (the `_mutate()` context-manager
 * twin — public in TS because the `ConfigWrites` adapter and multi-call
 * namespace sites compose several `apply*` statics under one
 * transaction, `accounts.py:472-489`). If the body throws, the write is
 * skipped — partial mutations never reach disk. Writes route through
 * {@link atomicWriteBytes} at mode `0o600` with the parent dir created
 * `0o700` (`config.py:192-205`).
 *
 * TOML library decision (packet §0.4, recorded in the shard notes):
 * Python uses `tomllib`/`tomli_w`; the node port uses `smol-toml`
 * (pinned 1.7.1) — TOML 1.0 parse + stringify, zero-dep. Serialization
 * FORMATTING (whitespace, key ordering on disk) is out of contract:
 * each side reads its own writes and both read the same schema; the
 * Layer-3 locks are read-side (`TestFixtureLoad` over the verbatim
 * Python fixtures).
 *
 * CRED-F3 (B7-ARB-B, `b7-reviewB-resolution.md:245-252`): the ONE
 * on-disk reveal site in this module is {@link accountToBlock} — the
 * `_account_to_block` twin (`config.py:92-125`), which unwraps
 * {@link Secret} values to plain strings because TOML cannot store an
 * opaque wrapper and `Secret.toJSON()` would persist the redaction
 * mask. Raw in-memory transaction dicts only ever hold the revealed
 * strings this function produced (or strings read back from disk);
 * a `Secret` instance never reaches the TOML serializer.
 */

import { existsSync } from "node:fs";
import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { TomlError, parse, stringify } from "smol-toml";

import {
  parseAccount,
  type Account,
  type Region,
} from "../../core/src/auth/account.js";
import {
  parseActiveSession,
  type ActiveSession,
} from "../../core/src/auth/session.js";
import { isPythonDict } from "../../core/src/compat/python-dict.js";
import {
  AccountInUseError,
  ConfigError,
  ParamValidationError,
} from "../../core/src/errors.js";
import { Secret } from "../../core/src/secret.js";
import {
  AccountSummary,
  Target,
} from "../../core/src/types/entities/accounts.js";
import type {
  AddAccountParams,
  AddTargetOptions,
  ApplySessionUpdate,
  UpdateAccountFields,
} from "../../core/src/accounts/auth-effects.js";
import {
  CredentialPathError,
  atomicWriteBytes,
  isErrnoError,
  readCredentialText,
  rejectIfSymlink,
  type AtomicWriteOptions,
} from "./io-utils.js";

/** The raw parsed TOML document a transaction mutates in place. */
export type RawConfig = Record<string, unknown>;

/**
 * The default config path — `~/.mp/config.toml` (`config.py:59`).
 *
 * SANCTIONED DEVIATION (B8-ARB-B F3, `b8-reviewB-resolution.md`;
 * playbook Discrepancy #15): Python freezes `_DEFAULT_CONFIG_PATH` at
 * MODULE IMPORT (`Path.home()` evaluated once), so a Python process
 * that changes `HOME` after import keeps writing the import-time
 * config; the TS twin resolves `homedir()` at every `ConfigManager`
 * construction and follows the new `HOME`. Divergent ONLY when `HOME`
 * changes mid-process with `MP_CONFIG_PATH` unset (test harnesses /
 * long-lived agent hosts — observed live by the pair-B e2e review).
 * Python's own bridge and storage defaults are call-time; only the
 * config default is import-frozen, and matching an import-time freeze
 * in ESM would pin module-evaluation-order trivia. Blessed as
 * call-time per R10.7's disclose option.
 *
 * @returns The absolute default path (computed at call time).
 */
function defaultConfigPath(): string {
  return join(homedir(), ".mp", "config.toml");
}

/**
 * `raw.get(key, {}) or {}` — return the LIVE block when it is a dict,
 * else a detached empty record (mutations of the fallback are lost,
 * exactly like mutating Python's default `{}`).
 *
 * @param raw - The parsed TOML document.
 * @param key - Top-level section name.
 * @returns The live section dict or a detached `{}`.
 */
function blockAt(raw: RawConfig, key: string): Record<string, unknown> {
  const value = raw[key];
  return isPythonDict(value) ? value : {};
}

/**
 * `raw.setdefault(key, {})` — return the live section, inserting an
 * empty one when absent.
 *
 * @param raw - The parsed TOML document.
 * @param key - Top-level section name.
 * @returns The live section dict.
 */
function setdefaultBlock(raw: RawConfig, key: string): Record<string, unknown> {
  const existing = raw[key];
  if (isPythonDict(existing)) {
    return existing;
  }
  if (existing === undefined) {
    const fresh: Record<string, unknown> = {};
    raw[key] = fresh;
    return fresh;
  }
  // Python setdefault would return the non-dict and the caller would
  // crash on `.items()`; the TS twin degrades to a detached record —
  // out of contract (no test reaches a non-table top-level section).
  return {};
}

/**
 * Unwrap a `Secret | string` credential param to plain text (Python's
 * `secret.get_secret_value() if isinstance(secret, SecretStr) else
 * secret` at `config.py:366-367` / `:455-457` / `:466-468`).
 *
 * NOTE this is a transaction-local unwrap feeding `parseAccount`
 * validation payloads that never reach disk directly — the value is
 * re-wrapped into a {@link Secret} by `parseAccount` and only revealed
 * for PERSISTENCE at the designated {@link accountToBlock} site.
 *
 * @param value - Credential param.
 * @returns The plain text, or `null` when absent.
 */
function credentialText(
  value: Secret | string | null | undefined,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return value instanceof Secret ? value.reveal() : value;
}

/**
 * Construct an {@link Account} variant from a parsed `[accounts.NAME]`
 * block (`_account_from_block`, `config.py:70-90`).
 *
 * @param name - Account name (matches the TOML block key).
 * @param block - Parsed block contents.
 * @returns The validated account.
 * @throws ConfigError - Validation failure (missing required field,
 *   unknown key, bad type) — the Pydantic-wrap twin.
 */
function accountFromBlock(
  name: string,
  block: Record<string, unknown>,
): Account {
  try {
    return parseAccount({ name, ...block });
  } catch (exc) {
    const rendered = exc instanceof Error ? exc.message : String(exc);
    throw new ConfigError(
      `Invalid [accounts.${name}] block: ${rendered}`,
      null,
      {
        cause: exc,
      },
    );
  }
}

/**
 * Serialize an {@link Account} to a TOML-ready plain dict, excluding
 * `name` (`_account_to_block`, `config.py:92-125`).
 *
 * **THE designated CRED-F3 reveal site** (packet §2.2): secrets unwrap
 * to plain strings here because TOML cannot store an opaque wrapper —
 * routing through `Secret.toJSON()` would persist the redaction mask.
 *
 * @param account - Validated account to serialize.
 * @returns Plain dict with `type`, `region`, and type-specific fields.
 * @throws ConfigError - `oauth_token` account with neither `token` nor
 *   `token_env` (model invariant guard, `config.py:115-119`).
 */
function accountToBlock(account: Account): Record<string, unknown> {
  const out: Record<string, unknown> = {
    type: account.type,
    region: account.region,
  };
  if (
    account.default_project !== null &&
    account.default_project !== undefined
  ) {
    out["default_project"] = account.default_project;
  }
  if (account.type === "service_account") {
    out["username"] = account.username;
    out["secret"] = account.secret.reveal();
  } else if (account.type === "oauth_token") {
    if (account.token !== null && account.token !== undefined) {
      out["token"] = account.token.reveal();
    } else if (account.token_env === null || account.token_env === undefined) {
      // Model invariant (XOR) — explicit raise, not an assert
      // (`config.py:115-119`).
      throw new ConfigError(
        `OAuthTokenAccount '${account.name}' has neither ` +
          "`token` nor `token_env`.",
      );
    } else {
      out["token_env"] = account.token_env;
    }
  }
  // oauth_browser has no extra fields beyond the common set.
  return out;
}

/** Static-method update bag of {@link ConfigManager.applySetActive}. */
export interface ManagerSetActive {
  /** New active account name (must reference an existing account). */
  readonly account?: string | null | undefined;
  /** New active workspace ID (positive integer). */
  readonly workspace?: number | null | undefined;
}

/** Axis-removal flags of {@link ConfigManager.applyClearActive}. */
export interface ManagerClearActive {
  /** Drop `[active].account` when `true`. */
  readonly account?: boolean | undefined;
  /** Drop `[active].workspace` when `true`. */
  readonly workspace?: boolean | undefined;
}

/** `[settings].custom_header` write params (`config.py:1030-1042`). */
export interface CustomHeaderParams {
  /** Header name (e.g. `X-Mixpanel-Cluster`). */
  readonly name: string;
  /** Header value. */
  readonly value: string;
}

/**
 * The injectable atomic-write seam — the
 * `patch("…config.atomic_write_bytes")` monkeypatch twin used by the
 * single-write-per-transaction lock (`test_config.py:676`).
 */
export type ConfigWriteBytes = (
  path: string,
  data: Uint8Array,
  options?: AtomicWriteOptions,
) => void;

/** Constructor options of {@link ConfigManager} (Python kwonly, R3.8). */
export interface ConfigManagerOptions {
  /**
   * Path to the TOML config file. Defaults to `$MP_CONFIG_PATH` when
   * set (read at construction, `config.py:150-151`), else
   * `~/.mp/config.toml`.
   */
  readonly configPath?: string | undefined;
  /**
   * @internal Injected write seam (tests/harness only; defaults to
   * {@link atomicWriteBytes}).
   */
  readonly writeBytes?: ConfigWriteBytes | undefined;
}

/**
 * Single-schema configuration manager (`ConfigManager`,
 * `config.py:126-1057`).
 *
 * Wraps one TOML file. All operations re-read the file from disk, so
 * concurrent edits are safe in the "last write wins" sense (no file
 * locking — single-user workflow by design). File creation enforces
 * mode `0o600` and parent dir `0o700`; the config path is
 * symlink-refused on every read AND every write (via the shared
 * io-utils helpers — `test_config.py::TestSymlinkRejection` lock).
 *
 * Layering note (B7-ARB-B B-E2E-N1): {@link addAccount} does NOT
 * promote the first account to `[active]` — that promotion happens
 * exactly once, in the `ConfigWrites` adapter transaction
 * (`config-writes.ts`, the `accounts.py:472-489` twin).
 */
export class ConfigManager {
  /** The resolved config file path. */
  readonly #path: string;

  /** The injected write seam (default: the real atomic writer). */
  readonly #writeBytes: ConfigWriteBytes;

  /**
   * Initialize the manager (`config.py:141-153`).
   *
   * @param options - Optional path override + test-only write seam.
   */
  constructor(options: ConfigManagerOptions = {}) {
    const envPath = process.env["MP_CONFIG_PATH"];
    if (options.configPath !== undefined) {
      this.#path = options.configPath;
    } else if (envPath !== undefined) {
      this.#path = envPath;
    } else {
      this.#path = defaultConfigPath();
    }
    this.#writeBytes =
      options.writeBytes ??
      ((path, data, writeOptions): void => {
        atomicWriteBytes(path, data, writeOptions);
      });
  }

  /** The path of the on-disk TOML config (`config.py:155-158`). */
  get configPath(): string {
    return this.#path;
  }

  // ---- internals ---------------------------------------------------

  /**
   * Parse the TOML file (`_read_raw`, `config.py:162-190`).
   *
   * Probes for a symlink BEFORE the existence check — `existsSync`
   * follows symlinks and silently returns `false` for dangling links,
   * hiding the attack signal (`config.py:176-183` comment ported).
   *
   * @returns The raw parsed document; `{}` when the file is missing.
   * @throws ConfigError - Symlinked path, unreadable file, or
   *   malformed TOML (each wrapping the underlying error).
   */
  readRaw(): RawConfig {
    try {
      rejectIfSymlink(this.#path);
    } catch (exc) {
      // Python wraps ANY OSError from the probe (`config.py:180-183`),
      // so errno-bearing lstat failures (e.g. EACCES on an unreadable
      // parent) code up exactly like the symlink refusal — B8-ARB-A
      // SEM-F6 (`b8-reviewA-resolution.md`).
      if (exc instanceof CredentialPathError || isErrnoError(exc)) {
        const rendered = exc instanceof Error ? exc.message : String(exc);
        throw new ConfigError(
          `Could not parse config at ${this.#path}: ${rendered}`,
          null,
          { cause: exc },
        );
      }
      throw exc;
    }
    if (!existsSync(this.#path)) {
      return {};
    }
    let text: string;
    try {
      text = readCredentialText(this.#path);
    } catch (exc) {
      // The Python boundary catches OSError (CredentialPathError is an
      // OSError there); decode errors (UnicodeDecodeError twin
      // TypeError) propagate unchanged.
      if (exc instanceof CredentialPathError || isErrnoError(exc)) {
        const rendered = exc instanceof Error ? exc.message : String(exc);
        throw new ConfigError(
          `Could not parse config at ${this.#path}: ${rendered}`,
          null,
          { cause: exc },
        );
      }
      throw exc;
    }
    try {
      return parse(text);
    } catch (exc) {
      if (exc instanceof TomlError) {
        throw new ConfigError(
          `Could not parse config at ${this.#path}: ${exc.message}`,
          null,
          { cause: exc },
        );
      }
      throw exc;
    }
  }

  /**
   * Serialize `raw` to the config file with restrictive permissions
   * (`_write_raw`, `config.py:192-205`).
   *
   * Creates parent dirs (`~/.mp/`) with mode `0o700`, tightens a
   * pre-existing parent to `0o700` (failures suppressed, as Python's
   * `contextlib.suppress(OSError)`), and writes atomically at `0o600`.
   *
   * @param raw - Document to serialize as TOML.
   */
  writeRaw(raw: RawConfig): void {
    mkdirSync(dirname(this.#path), { recursive: true, mode: 0o700 });
    try {
      chmodSync(dirname(this.#path), 0o700);
    } catch {
      // suppress(OSError) — best-effort tighten (`config.py:203-204`).
    }
    const text = stringify(raw);
    // tomli_w.dumps always terminates tables with a newline; smol-toml
    // does not — parity is cosmetic (formatting out of contract §0.4)
    // but keeps on-disk diffs stable for the fixtures.
    const body = text.length > 0 && !text.endsWith("\n") ? `${text}\n` : text;
    this.#writeBytes(this.#path, new TextEncoder().encode(body));
  }

  /**
   * Run one read-modify-write transaction (the `_mutate()` context
   * manager twin, `config.py:207-234`).
   *
   * The document is read once at entry and written once at exit; a
   * throwing body skips the write. Before the write,
   * {@link ConfigManager.validateRaw} runs the whole-file account pass
   * so an externally-corrupted sibling block is never silently
   * rewritten.
   *
   * @param body - Mutation body; receives the live raw document.
   * @returns The body's return value.
   * @throws ConfigError - Propagated from read, body, validation, or
   *   write.
   */
  transaction<T>(body: (raw: RawConfig) => T): T {
    const raw = this.readRaw();
    const result = body(raw);
    ConfigManager.validateRaw(raw);
    this.writeRaw(raw);
    return result;
  }

  /**
   * Validate every account block in `raw` (`_validate_raw`,
   * `config.py:236-254`) — the transaction-exit safety net.
   *
   * @param raw - Parsed document to validate.
   * @throws ConfigError - Any account block fails schema validation.
   */
  static validateRaw(raw: RawConfig): void {
    const accountsBlock = blockAt(raw, "accounts");
    for (const [name, block] of Object.entries(accountsBlock)) {
      if (isPythonDict(block)) {
        accountFromBlock(name, block);
      }
    }
  }

  /**
   * In-place `[active]` mutation shared by {@link setActive} and
   * multi-call sites (`_apply_set_active`, `config.py:256-286`).
   *
   * Each member is independent: `null`/absent leaves that axis
   * untouched.
   *
   * @param raw - Parsed document (mutated in place).
   * @param update - New account / workspace values.
   * @throws ConfigError - Account not configured, or workspace not a
   *   positive integer.
   */
  static applySetActive(raw: RawConfig, update: ManagerSetActive): void {
    const activeBlock = setdefaultBlock(raw, "active");
    const account = update.account ?? null;
    const workspace = update.workspace ?? null;
    if (account !== null) {
      const accountsBlock = blockAt(raw, "accounts");
      if (!Object.hasOwn(accountsBlock, account)) {
        throw new ConfigError(
          `Cannot set active account: '${account}' is not configured.`,
        );
      }
      activeBlock["account"] = account;
    }
    if (workspace !== null) {
      ConfigManager.validateWorkspaceId(workspace);
      activeBlock["workspace"] = workspace;
    }
  }

  /**
   * In-place `[active]` axis removal (`_apply_clear_active`,
   * `config.py:288-310`).
   *
   * @param raw - Parsed document (mutated in place).
   * @param axes - Which axes to drop.
   */
  static applyClearActive(raw: RawConfig, axes: ManagerClearActive): void {
    const activeBlock = blockAt(raw, "active");
    if (axes.account === true && Object.hasOwn(activeBlock, "account")) {
      delete activeBlock["account"];
    }
    if (axes.workspace === true && Object.hasOwn(activeBlock, "workspace")) {
      delete activeBlock["workspace"];
    }
    if (Object.keys(activeBlock).length > 0) {
      raw["active"] = activeBlock;
    } else {
      delete raw["active"];
    }
  }

  /**
   * In-place per-account mutation (`_apply_update_account`,
   * `config.py:312-403`).
   *
   * @param raw - Parsed document (mutated in place).
   * @param name - Account to update (must exist).
   * @param fields - Fields to rewrite (absent members untouched).
   * @returns The updated validated account.
   * @throws ConfigError - Account not found, type-incompatible field,
   *   token/token_env both supplied, or validation failure.
   */
  static applyUpdateAccount(
    raw: RawConfig,
    name: string,
    fields: UpdateAccountFields,
  ): Account {
    const accountsBlock = blockAt(raw, "accounts");
    if (!Object.hasOwn(accountsBlock, name)) {
      throw new ConfigError(`Account '${name}' not found.`);
    }
    const existing = accountsBlock[name];
    const block: Record<string, unknown> = isPythonDict(existing)
      ? { ...existing }
      : {};
    const acctType = block["type"];

    const region = fields.region ?? null;
    const defaultProject = fields.default_project ?? null;
    const username = fields.username ?? null;
    const secret = fields.secret ?? null;
    const token = fields.token ?? null;
    const tokenEnv = fields.token_env ?? null;

    if (region !== null) {
      block["region"] = region;
    }
    if (defaultProject !== null) {
      block["default_project"] = defaultProject;
    }
    if (username !== null) {
      if (acctType !== "service_account") {
        throw new ConfigError(
          "`username` only applies to service_account " +
            `(account '${name}' is '${String(acctType)}').`,
        );
      }
      block["username"] = username;
    }
    if (secret !== null) {
      if (acctType !== "service_account") {
        throw new ConfigError(
          "`secret` only applies to service_account " +
            `(account '${name}' is '${String(acctType)}').`,
        );
      }
      block["secret"] = credentialText(secret);
    }
    if (token !== null || tokenEnv !== null) {
      if (acctType !== "oauth_token") {
        throw new ConfigError(
          "`token`/`token_env` only apply to oauth_token " +
            `(account '${name}' is '${String(acctType)}').`,
        );
      }
      if (token !== null && tokenEnv !== null) {
        throw new ConfigError(
          "OAuthTokenAccount: `token` and `token_env` are mutually exclusive.",
        );
      }
      delete block["token"];
      delete block["token_env"];
      if (token !== null) {
        block["token"] = credentialText(token);
      } else {
        block["token_env"] = tokenEnv;
      }
    }

    let account: Account;
    try {
      account = parseAccount({ name, ...block });
    } catch (exc) {
      const rendered = exc instanceof Error ? exc.message : String(exc);
      throw new ConfigError(
        `Invalid account fields for '${name}': ${rendered}`,
        null,
        { cause: exc },
      );
    }
    accountsBlock[name] = accountToBlock(account);
    return account;
  }

  /**
   * In-place `[accounts.NAME]` insertion (`_apply_add_account`,
   * `config.py:405-490`). NON-promoting (B-E2E-N1 — the adapter owns
   * the FR-045 promotion).
   *
   * Per 043 FR-001, `default_project` is optional for every type.
   *
   * @param raw - Parsed document (mutated in place).
   * @param name - New account name.
   * @param params - Typed credential fields.
   * @returns The constructed validated account.
   * @throws ConfigError - Duplicate name (PLAIN ConfigError,
   *   `config.py:446` — never AccountExistsError, B7-ARB-B B-E2E-F1),
   *   missing required field, or validation failure.
   */
  static applyAddAccount(
    raw: RawConfig,
    name: string,
    params: AddAccountParams,
  ): Account {
    const accountsBlock = setdefaultBlock(raw, "accounts");
    if (Object.hasOwn(accountsBlock, name)) {
      throw new ConfigError(`Account '${name}' already exists.`);
    }

    const block: Record<string, unknown> = {
      type: params.type,
      region: params.region,
    };
    const defaultProject = params.default_project ?? null;
    const username = params.username ?? null;
    const secret = params.secret ?? null;
    const token = params.token ?? null;
    const tokenEnv = params.token_env ?? null;
    if (defaultProject !== null) {
      block["default_project"] = defaultProject;
    }
    if (params.type === "service_account") {
      if (username === null || secret === null) {
        throw new ConfigError(
          "ServiceAccount requires `username` and `secret`.",
        );
      }
      block["username"] = username;
      block["secret"] = credentialText(secret);
    } else if (params.type === "oauth_browser") {
      // default_project is optional; populated by `mp account login`.
    } else if (params.type === "oauth_token") {
      if ((token === null) === (tokenEnv === null)) {
        throw new ConfigError(
          "OAuthTokenAccount requires exactly one of `token` or `token_env`.",
        );
      }
      if (token !== null) {
        block["token"] = credentialText(token);
      } else {
        block["token_env"] = tokenEnv;
      }
    } else {
      // Literal exhaustiveness twin (`config.py:478-479`).
      throw new ConfigError(`Unknown account type: '${String(params.type)}'`);
    }

    let account: Account;
    try {
      account = parseAccount({ name, ...block });
    } catch (exc) {
      const rendered = exc instanceof Error ? exc.message : String(exc);
      throw new ConfigError(
        `Invalid account fields for '${name}': ${rendered}`,
        null,
        { cause: exc },
      );
    }

    accountsBlock[name] = accountToBlock(account);
    return account;
  }

  // ---- accounts ----------------------------------------------------

  /**
   * List every configured account as a sorted summary
   * (`list_accounts`, `config.py:494-531`).
   *
   * @returns Sorted-by-name summaries; `is_active` is `true` iff
   *   `[active].account == name`; `referenced_by_targets` lists the
   *   referencing target names (sorted).
   * @throws ConfigError - A block fails validation or the file is
   *   unreadable.
   */
  listAccounts(): AccountSummary[] {
    const raw = this.readRaw();
    const accountsBlock = blockAt(raw, "accounts");
    const targetsBlock = blockAt(raw, "targets");
    const activeBlock = blockAt(raw, "active");
    const activeAccount = activeBlock["account"];

    const refs = new Map<string, string[]>();
    for (const tname of Object.keys(targetsBlock).sort()) {
      const tblock = targetsBlock[tname];
      if (isPythonDict(tblock)) {
        const acct = tblock["account"];
        if (typeof acct === "string") {
          const list = refs.get(acct) ?? [];
          list.push(tname);
          refs.set(acct, list);
        }
      }
    }

    const out: AccountSummary[] = [];
    for (const name of Object.keys(accountsBlock).sort()) {
      const block = accountsBlock[name];
      if (!isPythonDict(block)) {
        continue;
      }
      const account = accountFromBlock(name, block);
      out.push(
        new AccountSummary({
          name: account.name,
          type: account.type,
          region: account.region,
          is_active: activeAccount === account.name,
          referenced_by_targets: refs.get(account.name) ?? [],
        }),
      );
    }
    return out;
  }

  /**
   * Load one account (`get_account`, `config.py:533-550`).
   *
   * @param name - Account name.
   * @returns The validated account.
   * @throws ConfigError - Unknown name or validation failure.
   */
  getAccount(name: string): Account {
    const raw = this.readRaw();
    const accountsBlock = blockAt(raw, "accounts");
    const block = accountsBlock[name];
    if (!isPythonDict(block)) {
      throw new ConfigError(`Account '${name}' not found.`);
    }
    return accountFromBlock(name, block);
  }

  /**
   * Add an account block (`add_account`, `config.py:552-605`).
   * NON-promoting — see the class JSDoc layering note.
   *
   * @param name - Account name (`^[a-zA-Z0-9_-]{1,64}$`).
   * @param params - Typed credential fields.
   * @returns The constructed account.
   * @throws ConfigError - Duplicate name or validation failure.
   */
  addAccount(name: string, params: AddAccountParams): Account {
    return this.transaction((raw) =>
      ConfigManager.applyAddAccount(raw, name, params),
    );
  }

  /**
   * Update an existing account in place (`update_account`,
   * `config.py:607-650`). Type cannot change.
   *
   * @param name - Account to update.
   * @param fields - Fields to rewrite.
   * @returns The updated account.
   * @throws ConfigError - Missing account, type-incompatible field, or
   *   validation failure.
   */
  updateAccount(name: string, fields: UpdateAccountFields): Account {
    return this.transaction((raw) =>
      ConfigManager.applyUpdateAccount(raw, name, fields),
    );
  }

  /**
   * Remove an account (`remove_account`, `config.py:652-690`).
   *
   * @param name - Account to remove.
   * @param options - `force` removes even when targets reference it.
   * @returns Sorted names of targets that referenced the account.
   * @throws ConfigError - Unknown account.
   * @throws AccountInUseError - Referenced and `force` not set.
   */
  removeAccount(
    name: string,
    options: { readonly force?: boolean } = {},
  ): string[] {
    return this.transaction((raw) => {
      const accountsBlock = blockAt(raw, "accounts");
      if (!Object.hasOwn(accountsBlock, name)) {
        throw new ConfigError(`Account '${name}' not found.`);
      }
      const targetsBlock = blockAt(raw, "targets");
      const referenced = Object.entries(targetsBlock)
        .filter(
          ([, tblock]) => isPythonDict(tblock) && tblock["account"] === name,
        )
        .map(([tname]) => tname)
        .sort();
      if (referenced.length > 0 && options.force !== true) {
        throw new AccountInUseError(name, referenced);
      }
      delete accountsBlock[name];
      // If the removed account was the active one, drop both axes
      // (`config.py:683-689` — the workspace ID is meaningless without
      // its account).
      const activeBlock = blockAt(raw, "active");
      if (activeBlock["account"] === name) {
        ConfigManager.applyClearActive(raw, { account: true, workspace: true });
      }
      return referenced;
    });
  }

  // ---- active ------------------------------------------------------

  /**
   * Read the persisted `[active]` block (`get_active`,
   * `config.py:694-711`).
   *
   * @returns The active session (empty when the block is missing).
   * @throws ConfigError - Malformed `[active]` block.
   */
  getActive(): ActiveSession {
    const raw = this.readRaw();
    const activeBlock = blockAt(raw, "active");
    try {
      return parseActiveSession(activeBlock);
    } catch (exc) {
      const rendered = exc instanceof Error ? exc.message : String(exc);
      throw new ConfigError(`Invalid [active] block: ${rendered}`, null, {
        cause: exc,
      });
    }
  }

  /**
   * Update one or more `[active]` axes (`set_active`,
   * `config.py:713-743`). Absent members leave the axis untouched
   * (use {@link clearActive} to remove keys).
   *
   * @param update - New account / workspace values.
   * @returns The updated active session.
   * @throws ConfigError - Unknown account or invalid workspace ID.
   */
  setActive(update: ManagerSetActive): ActiveSession {
    this.transaction((raw) => {
      ConfigManager.applySetActive(raw, update);
    });
    return this.getActive();
  }

  /**
   * Remove specific `[active]` axes (`clear_active`,
   * `config.py:745-762`).
   *
   * @param axes - Which axes to drop.
   * @returns The updated active session.
   */
  clearActive(axes: ManagerClearActive): ActiveSession {
    this.transaction((raw) => {
      ConfigManager.applyClearActive(raw, axes);
    });
    return this.getActive();
  }

  /**
   * Atomically apply per-axis session updates (`apply_session`,
   * `config.py:764-833`). All axes land within ONE transaction;
   * `project` writes to the explicit `account` (if given) else the
   * persisted active account.
   *
   * @param update - The axes to touch.
   * @returns The updated active session.
   * @throws ParamValidationError - `workspace` and `clear_workspace`
   *   both supplied (Python's bare `ValueError` twin — R5
   *   codes-not-messages, the existing VALIDATION_ERROR code).
   * @throws ConfigError - Unknown account, or `project` supplied with
   *   no resolvable account.
   */
  applySession(update: ApplySessionUpdate): ActiveSession {
    const account = update.account ?? null;
    const project = update.project ?? null;
    const workspace = update.workspace ?? null;
    const clearWorkspace = update.clear_workspace ?? false;
    if (workspace !== null && clearWorkspace) {
      throw new ParamValidationError(
        "`workspace=` and `clear_workspace=True` are mutually exclusive.",
      );
    }
    this.transaction((raw) => {
      if (account !== null || workspace !== null) {
        ConfigManager.applySetActive(raw, {
          ...(account !== null ? { account } : {}),
          ...(workspace !== null ? { workspace } : {}),
        });
      }
      if (clearWorkspace) {
        ConfigManager.applyClearActive(raw, { workspace: true });
      }
      if (project !== null) {
        const activeBlock = blockAt(raw, "active");
        const targetAccount =
          account !== null ? account : activeBlock["account"];
        if (typeof targetAccount !== "string") {
          throw new ConfigError(
            "Cannot set project: no active account. " +
              "Run `mp account use NAME` first, or pass `account=NAME` " +
              "together with `project=`.",
          );
        }
        ConfigManager.applyUpdateAccount(raw, targetAccount, {
          default_project: project,
        });
      }
    });
    return this.getActive();
  }

  // ---- targets -----------------------------------------------------

  /**
   * List targets sorted by name (`list_targets`, `config.py:837-860`).
   *
   * @returns All configured targets.
   * @throws ConfigError - A target block fails validation.
   */
  listTargets(): Target[] {
    const raw = this.readRaw();
    const targetsBlock = blockAt(raw, "targets");
    const out: Target[] = [];
    for (const name of Object.keys(targetsBlock).sort()) {
      const block = targetsBlock[name];
      if (!isPythonDict(block)) {
        continue;
      }
      out.push(ConfigManager.#targetFromBlock(name, block));
    }
    return out;
  }

  /**
   * Load one target (`get_target`, `config.py:862-885`).
   *
   * @param name - Target name.
   * @returns The validated target.
   * @throws ConfigError - Unknown name or validation failure.
   */
  getTarget(name: string): Target {
    const raw = this.readRaw();
    const targetsBlock = blockAt(raw, "targets");
    const block = targetsBlock[name];
    if (!isPythonDict(block)) {
      throw new ConfigError(`Target '${name}' not found.`);
    }
    return ConfigManager.#targetFromBlock(name, block);
  }

  /**
   * Construct a validated {@link Target} from a `[targets.NAME]`
   * block, wrapping model errors in ConfigError (`config.py:853-859`).
   *
   * @param name - Target name (the block key).
   * @param block - Parsed block contents.
   * @returns The target.
   * @throws ConfigError - Model validation failure.
   */
  static #targetFromBlock(
    name: string,
    block: Record<string, unknown>,
  ): Target {
    try {
      return Target.fromDict({ name, ...block });
    } catch (exc) {
      const rendered = exc instanceof Error ? exc.message : String(exc);
      throw new ConfigError(
        `Invalid [targets.${name}] block: ${rendered}`,
        null,
        { cause: exc },
      );
    }
  }

  /**
   * Add a target block (`add_target`, `config.py:887-933`).
   *
   * @param name - Target name (block key).
   * @param options - account / project / workspace.
   * @returns The constructed target.
   * @throws ConfigError - Duplicate name, missing referenced account,
   *   or validation failure (Target model errors WRAPPED,
   *   `config.py:915-920`).
   */
  addTarget(name: string, options: AddTargetOptions): Target {
    return this.transaction((raw) => {
      const accountsBlock = blockAt(raw, "accounts");
      if (!Object.hasOwn(accountsBlock, options.account)) {
        throw new ConfigError(
          `Cannot create target '${name}': ` +
            `account '${options.account}' is not configured.`,
        );
      }
      const targetsBlock = setdefaultBlock(raw, "targets");
      if (Object.hasOwn(targetsBlock, name)) {
        throw new ConfigError(`Target '${name}' already exists.`);
      }
      let target: Target;
      try {
        target = new Target({
          name,
          account: options.account,
          project: options.project,
          workspace: options.workspace ?? null,
        });
      } catch (exc) {
        const rendered = exc instanceof Error ? exc.message : String(exc);
        throw new ConfigError(
          `Invalid target fields for '${name}': ${rendered}`,
          null,
          { cause: exc },
        );
      }
      const block: Record<string, unknown> = {
        account: options.account,
        project: options.project,
      };
      if (options.workspace !== null && options.workspace !== undefined) {
        block["workspace"] = options.workspace;
      }
      targetsBlock[name] = block;
      return target;
    });
  }

  /**
   * Remove a target block (`remove_target`, `config.py:936-949`).
   *
   * @param name - Target to remove.
   * @throws ConfigError - Unknown target.
   */
  removeTarget(name: string): void {
    this.transaction((raw) => {
      const targetsBlock = blockAt(raw, "targets");
      if (!Object.hasOwn(targetsBlock, name)) {
        throw new ConfigError(`Target '${name}' not found.`);
      }
      delete targetsBlock[name];
    });
  }

  /**
   * Apply a target in a single atomic save (`apply_target`,
   * `config.py:951-1000`): `[active]` replaced WHOLESALE (a target
   * with no workspace clears any prior pin) + the target account's
   * `default_project` updated to the target's project.
   *
   * @param name - Target to apply.
   * @returns The updated active session.
   * @throws ConfigError - Unknown target OR its referenced account is
   *   no longer configured.
   */
  applyTarget(name: string): ActiveSession {
    this.transaction((raw) => {
      const targetsBlock = blockAt(raw, "targets");
      const targetBlock = targetsBlock[name];
      if (!isPythonDict(targetBlock)) {
        throw new ConfigError(`Target '${name}' not found.`);
      }
      const target = ConfigManager.#targetFromBlock(name, targetBlock);
      const accountsBlock = blockAt(raw, "accounts");
      if (!Object.hasOwn(accountsBlock, target.account)) {
        throw new ConfigError(
          `Cannot apply target '${name}': ` +
            `account '${target.account}' is not configured.`,
        );
      }
      // Update the target account's default_project to match.
      const existing = accountsBlock[target.account];
      const accountBlock: Record<string, unknown> = isPythonDict(existing)
        ? { ...existing }
        : {};
      accountBlock["default_project"] = target.project;
      accountsBlock[target.account] = accountBlock;
      // Replace [active] wholesale (`config.py:994-999`).
      const activeBlock: Record<string, unknown> = { account: target.account };
      if (target.workspace !== null) {
        activeBlock["workspace"] = target.workspace;
      }
      raw["active"] = activeBlock;
    });
    return this.getActive();
  }

  // ---- settings ----------------------------------------------------

  /**
   * Read `[settings].custom_header` (`get_custom_header`,
   * `config.py:1004-1028`).
   *
   * @returns The `(name, value)` pair, or `null` when unset.
   * @throws ConfigError - Malformed block (non-table, missing keys, or
   *   non-string values).
   */
  getCustomHeader(): readonly [string, string] | null {
    const raw = this.readRaw();
    const settings = blockAt(raw, "settings");
    const header = Object.hasOwn(settings, "custom_header")
      ? settings["custom_header"]
      : null;
    if (header === null || header === undefined) {
      return null;
    }
    if (!isPythonDict(header)) {
      throw new ConfigError(
        "[settings].custom_header must be an inline table {name=, value=}.",
      );
    }
    const name = header["name"];
    const value = header["value"];
    if (typeof name !== "string" || typeof value !== "string") {
      throw new ConfigError(
        "[settings].custom_header requires `name` and `value` strings.",
      );
    }
    return [name, value];
  }

  /**
   * Write the custom HTTP header (`set_custom_header`,
   * `config.py:1030-1042`).
   *
   * @param params - Header name + value.
   */
  setCustomHeader(params: CustomHeaderParams): void {
    this.transaction((raw) => {
      const settings = setdefaultBlock(raw, "settings");
      settings["custom_header"] = { name: params.name, value: params.value };
    });
  }

  // ---- validators --------------------------------------------------

  /**
   * Validate a workspace ID (`_validate_workspace_id`,
   * `config.py:1043-1056`) — a VALUE typecheck, not a string parse
   * (packet §7 caution 1: `Number.isInteger && > 0`, never `!w` and
   * never `pythonInt`).
   *
   * @param workspace - Candidate ID.
   * @throws ConfigError - Not a positive integer.
   */
  static validateWorkspaceId(workspace: number): void {
    if (!Number.isInteger(workspace) || workspace <= 0) {
      throw new ConfigError(
        `Invalid workspace ID: ${String(workspace)}. ` +
          "Must be a positive integer.",
      );
    }
  }
}

/** Re-export the region type for adapter convenience. */
export type { Region };
