/**
 * On-disk TOML configuration manager: owns the single-schema config
 * file (`~/.mp/config.toml`, or the `MP_CONFIG_PATH` override read at
 * construction time exactly as Python's `__init__` does) with its
 * `[active]`, `[accounts.NAME]`, `[targets.NAME]` and `[settings]`
 * sections. Block conversions live in `./blocks.ts`, the in-place
 * `_apply_*` mutators in `./apply.ts`; `../config.ts` re-exports the
 * public surface.
 *
 * Every public mutator is one `readRaw`, mutate, `validateRaw`,
 * `writeRaw` cycle, exposed as {@link ConfigManager.transaction} (the
 * `_mutate()` context-manager twin, public in TS because the
 * `ConfigWrites` adapter composes several `apply*` statics under one
 * transaction). If the body throws, the write is skipped, so partial
 * mutations never reach disk. Writes route through `atomicWriteBytes`
 * at mode `0o600` with the parent dir created `0o700`.
 *
 * Python uses `tomllib` / `tomli_w`; the node port uses `smol-toml`
 * (TOML 1.0 parse and stringify, zero dependencies). Serialization
 * formatting on disk (whitespace, key order) is out of contract: each
 * side reads its own writes and both read the same schema, and the
 * parity locks are read-side over the verbatim Python fixtures.
 *
 * @see mixpanel_headless._internal.config.ConfigManager
 */

import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { parse, stringify, TomlError } from "smol-toml";

import {
  type Account,
  AccountInUseError,
  AccountSummary,
  type ActiveSession,
  type AddAccountParams,
  type AddTargetOptions,
  type ApplySessionUpdate,
  ConfigError,
  isPythonDict,
  ParamValidationError,
  parseActiveSession,
  Target,
  type UpdateAccountFields,
} from "@mixpanel-headless/core";

import { wrapAsConfigError } from "../errors.js";
import {
  atomicWriteBytes,
  type AtomicWriteOptions,
  CredentialPathError,
  isErrnoError,
  readCredentialText,
  rejectIfSymlink,
} from "../io-utils.js";
import {
  applyAddAccount,
  applyClearActive,
  applySetActive,
  applyUpdateAccount,
  type ManagerClearActive,
  type ManagerSetActive,
  validateRaw,
  validateWorkspaceId,
} from "./apply.js";
import {
  accountFromBlock,
  blockAt,
  defaultConfigPath,
  type RawConfig,
  setdefaultBlock,
  targetFromBlock,
} from "./blocks.js";

/** `[settings].custom_header` write params. */
export interface CustomHeaderParams {
  /** Header name (e.g. `X-Mixpanel-Cluster`). */
  readonly name: string;
  /** Header value. */
  readonly value: string;
}

/**
 * The injectable atomic-write seam — the
 * `patch("…config.atomic_write_bytes")` monkeypatch twin used by the
 * single-write-per-transaction lock.
 */
export type ConfigWriteBytes = (
  path: string,
  data: Uint8Array,
  options?: AtomicWriteOptions,
) => void;

/** Constructor options of {@link ConfigManager} (Python's keyword-only args). */
export interface ConfigManagerOptions {
  /**
   * Path to the TOML config file. A custom location's parent directory
   * is the caller's responsibility: it is created `0o700` if absent but
   * an existing directory's mode is never changed (the config file
   * itself is always written `0o600`). Only the default `~/.mp` is
   * tightened to `0o700` on every write.
   *
   * @defaultValue `$MP_CONFIG_PATH` when set (read at construction), else `~/.mp/config.toml`
   */
  readonly configPath?: string | undefined;
  /**
   * Injected write seam (tests and the harness only).
   *
   * @defaultValue `atomicWriteBytes`
   * @internal
   */
  readonly writeBytes?: ConfigWriteBytes | undefined;
}

/**
 * Single-schema configuration manager over one TOML file.
 *
 * @remarks
 * All operations re-read the file from disk, so concurrent edits are
 * safe in the "last write wins" sense (no file locking; single-user
 * workflow by design). File creation enforces mode `0o600` and parent
 * dir `0o700`; the config path is symlink-refused on every read and
 * every write through the shared io-utils helpers.
 * {@link ConfigManager.addAccount} does not promote the first account to
 * `[active]`; that promotion happens exactly once, in the
 * `ConfigWrites` adapter transaction (`config-writes.ts`).
 * @example
 * ```ts
 * const manager = new ConfigManager();
 * manager.addAccount("team", { type: "oauth_browser", region: "us" });
 * manager.setActive({ account: "team" });
 * manager.listAccounts(); // [AccountSummary { name: "team", is_active: true }]
 * ```
 * @see mixpanel_headless._internal.config.ConfigManager
 */
export class ConfigManager {
  /** The resolved config file path. */
  readonly #path: string;

  /** The injected write seam (default: the real atomic writer). */
  readonly #writeBytes: ConfigWriteBytes;

  /**
   * Initialize the manager.
   *
   * @param options - Optional path override and test-only write seam.
   */
  constructor(options: ConfigManagerOptions = {}) {
    const envPath = process.env["MP_CONFIG_PATH"];
    if (options.configPath !== undefined) {
      this.#path = options.configPath;
    } else if (envPath === undefined) {
      this.#path = defaultConfigPath();
    } else {
      this.#path = envPath;
    }
    this.#writeBytes =
      options.writeBytes ??
      ((path, data, writeOptions): void => {
        atomicWriteBytes(path, data, writeOptions);
      });
  }

  /**
   * Read the path of the on-disk TOML config.
   *
   * @returns The resolved config file path.
   */
  get configPath(): string {
    return this.#path;
  }

  /**
   * Validate every account block of a document (delegates to
   * {@link validateRaw}).
   *
   * @param raw - Parsed document to validate.
   * @throws {@link ConfigError} - Any account block fails validation.
   */
  static validateRaw(raw: RawConfig): void {
    validateRaw(raw);
  }

  /**
   * Mutate `[active]` in place (delegates to {@link applySetActive}).
   *
   * @param raw - Parsed document (mutated in place).
   * @param update - New account and workspace values.
   * @throws {@link ConfigError} - Unknown account or invalid workspace.
   */
  static applySetActive(raw: RawConfig, update: ManagerSetActive): void {
    applySetActive(raw, update);
  }

  /**
   * Remove `[active]` axes in place (delegates to
   * {@link applyClearActive}).
   *
   * @param raw - Parsed document (mutated in place).
   * @param axes - Which axes to drop.
   */
  static applyClearActive(raw: RawConfig, axes: ManagerClearActive): void {
    applyClearActive(raw, axes);
  }

  /**
   * Update one account block in place (delegates to
   * {@link applyUpdateAccount}).
   *
   * @param raw - Parsed document (mutated in place).
   * @param name - Account to update (must exist).
   * @param fields - Fields to rewrite (absent members untouched).
   * @returns The updated validated account.
   * @throws {@link ConfigError} - Missing account, type-incompatible
   *   field, or validation failure.
   */
  static applyUpdateAccount(
    raw: RawConfig,
    name: string,
    fields: UpdateAccountFields,
  ): Account {
    return applyUpdateAccount(raw, name, fields);
  }

  /**
   * Insert an `[accounts.NAME]` block in place (delegates to
   * {@link applyAddAccount}).
   *
   * @param raw - Parsed document (mutated in place).
   * @param name - New account name.
   * @param params - Typed credential fields.
   * @returns The constructed validated account.
   * @throws {@link ConfigError} - Duplicate name, missing required
   *   field, or validation failure.
   */
  static applyAddAccount(
    raw: RawConfig,
    name: string,
    params: AddAccountParams,
  ): Account {
    return applyAddAccount(raw, name, params);
  }

  /**
   * Check a workspace ID value (delegates to {@link validateWorkspaceId}).
   *
   * @param workspace - Candidate ID.
   * @throws {@link ConfigError} - Not a positive integer.
   */
  static validateWorkspaceId(workspace: number): void {
    validateWorkspaceId(workspace);
  }

  // --- internals ---

  /**
   * Parse the TOML file.
   *
   * @remarks
   * Probes for a symlink before the existence check: `existsSync`
   * follows symlinks and silently returns `false` for dangling links,
   * hiding the attack signal.
   * @returns The raw parsed document; `{}` when the file is missing.
   * @throws {@link ConfigError} - Symlinked path, unreadable file, or
   *   malformed TOML (each wrapping the underlying error).
   * @see mixpanel_headless._internal.config.ConfigManager._read_raw
   */
  readRaw(): RawConfig {
    try {
      rejectIfSymlink(this.#path);
    } catch (error) {
      // Python wraps any OSError from the probe, so errno-bearing lstat
      // failures (e.g. EACCES on an unreadable parent) code up exactly
      // like the symlink refusal.
      if (error instanceof CredentialPathError || isErrnoError(error)) {
        throw wrapAsConfigError(
          `Could not parse config at ${this.#path}`,
          error,
        );
      }
      throw error;
    }
    if (!existsSync(this.#path)) {
      return {};
    }
    let text: string;
    try {
      text = readCredentialText(this.#path);
    } catch (error) {
      // The Python boundary catches OSError (CredentialPathError is an
      // OSError there); decode errors (UnicodeDecodeError twin
      // TypeError) propagate unchanged.
      if (error instanceof CredentialPathError || isErrnoError(error)) {
        throw wrapAsConfigError(
          `Could not parse config at ${this.#path}`,
          error,
        );
      }
      throw error;
    }
    try {
      return parse(text);
    } catch (error) {
      if (error instanceof TomlError) {
        throw new ConfigError(
          `Could not parse config at ${this.#path}: ${error.message}`,
          null,
          { cause: error },
        );
      }
      throw error;
    }
  }

  /**
   * Serialize `raw` to the config file with restrictive permissions:
   * parent dirs created with mode `0o700`, the default `~/.mp` parent
   * tightened to `0o700` (failures suppressed, as Python's
   * `contextlib.suppress(OSError)`), and an atomic write at `0o600`.
   *
   * @param raw - Document to serialize as TOML.
   * @see mixpanel_headless._internal.config.ConfigManager._write_raw
   */
  writeRaw(raw: RawConfig): void {
    const dir = dirname(this.#path);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    // Divergence: Python chmods the config file's parent to 0o700 on every write whatever the path; TS tightens only the default `~/.mp` — a custom `configPath`/`MP_CONFIG_PATH` parent (a repo `config/`, `/tmp`) is left alone.
    if (resolve(dir) === resolve(dirname(defaultConfigPath()))) {
      try {
        chmodSync(dir, 0o700);
      } catch {
        // Best-effort tighten, as Python's `suppress(OSError)`.
      }
    }
    const text = stringify(raw);
    // tomli_w.dumps always terminates tables with a newline; smol-toml
    // does not. Formatting is out of contract, but matching keeps
    // on-disk diffs against the fixtures stable.
    const body = text.length > 0 && !text.endsWith("\n") ? `${text}\n` : text;
    this.#writeBytes(this.#path, new TextEncoder().encode(body));
  }

  /**
   * Run one read-modify-write transaction (the `_mutate()` context
   * manager twin).
   *
   * @remarks
   * The document is read once at entry and written once at exit; a
   * throwing body skips the write. Before the write,
   * {@link ConfigManager.validateRaw} runs the whole-file account pass
   * so an externally corrupted sibling block is never silently
   * rewritten.
   * @param body - Mutation body; receives the live raw document.
   * @returns The body's return value.
   * @throws {@link ConfigError} - Propagated from read, body,
   *   validation, or write.
   * @see mixpanel_headless._internal.config.ConfigManager._mutate
   */
  transaction<T>(body: (raw: RawConfig) => T): T {
    const raw = this.readRaw();
    const result = body(raw);
    validateRaw(raw);
    this.writeRaw(raw);
    return result;
  }

  // --- accounts ---

  /**
   * List every configured account as a sorted summary.
   *
   * @returns Sorted-by-name summaries; `is_active` is `true` iff
   *   `[active].account == name`; `referenced_by_targets` lists the
   *   referencing target names (sorted).
   * @throws {@link ConfigError} - A block fails validation or the file
   *   is unreadable.
   * @see mixpanel_headless._internal.config.ConfigManager.list_accounts
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
   * Load one account.
   *
   * @param name - Account name.
   * @returns The validated account.
   * @throws {@link ConfigError} - Unknown name or validation failure.
   * @see mixpanel_headless._internal.config.ConfigManager.get_account
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
   * Add an account block. Non-promoting: the first-account promotion to
   * `[active]` belongs to the `ConfigWrites` adapter.
   *
   * @param name - Account name (`^[a-zA-Z0-9_-]{1,64}$`).
   * @param params - Typed credential fields.
   * @returns The constructed account.
   * @throws {@link ConfigError} - Duplicate name or validation failure.
   * @see mixpanel_headless._internal.config.ConfigManager.add_account
   */
  addAccount(name: string, params: AddAccountParams): Account {
    return this.transaction((raw) => applyAddAccount(raw, name, params));
  }

  /**
   * Update an existing account in place; the type cannot change.
   *
   * @param name - Account to update.
   * @param fields - Fields to rewrite.
   * @returns The updated account.
   * @throws {@link ConfigError} - Missing account, type-incompatible
   *   field, or validation failure.
   * @see mixpanel_headless._internal.config.ConfigManager.update_account
   */
  updateAccount(name: string, fields: UpdateAccountFields): Account {
    return this.transaction((raw) => applyUpdateAccount(raw, name, fields));
  }

  /**
   * Remove an account.
   *
   * @param name - Account to remove.
   * @param options - Removal switches; `force` removes the account even
   *   when targets still reference it.
   * @returns Sorted names of targets that referenced the account.
   * @throws {@link ConfigError} - Unknown account.
   * @throws {@link AccountInUseError} - Referenced and `force` not set.
   * @see mixpanel_headless._internal.config.ConfigManager.remove_account
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
      Reflect.deleteProperty(accountsBlock, name);
      // If the removed account was the active one, drop both axes: the
      // workspace ID is meaningless without its account.
      const activeBlock = blockAt(raw, "active");
      if (activeBlock["account"] === name) {
        applyClearActive(raw, { account: true, workspace: true });
      }
      return referenced;
    });
  }

  // --- active ---

  /**
   * Read the persisted `[active]` block.
   *
   * @returns The active session (empty when the block is missing).
   * @throws {@link ConfigError} - Malformed `[active]` block.
   * @see mixpanel_headless._internal.config.ConfigManager.get_active
   */
  getActive(): ActiveSession {
    const raw = this.readRaw();
    const activeBlock = blockAt(raw, "active");
    try {
      return parseActiveSession(activeBlock);
    } catch (error) {
      throw wrapAsConfigError(`Invalid [active] block`, error);
    }
  }

  /**
   * Update one or more `[active]` axes. Absent members leave the axis
   * untouched (use {@link ConfigManager.clearActive} to remove keys).
   *
   * @param update - New account and workspace values.
   * @returns The updated active session.
   * @throws {@link ConfigError} - Unknown account or invalid workspace ID.
   * @see mixpanel_headless._internal.config.ConfigManager.set_active
   */
  setActive(update: ManagerSetActive): ActiveSession {
    this.transaction((raw) => {
      applySetActive(raw, update);
    });
    return this.getActive();
  }

  /**
   * Remove specific `[active]` axes.
   *
   * @param axes - Which axes to drop.
   * @returns The updated active session.
   * @see mixpanel_headless._internal.config.ConfigManager.clear_active
   */
  clearActive(axes: ManagerClearActive): ActiveSession {
    this.transaction((raw) => {
      applyClearActive(raw, axes);
    });
    return this.getActive();
  }

  /**
   * Atomically apply per-axis session updates. All axes land within one
   * transaction; `project` writes to the explicit `account` when given,
   * else to the persisted active account.
   *
   * @param update - The axes to touch.
   * @returns The updated active session.
   * @throws {@link ParamValidationError} - `workspace` and
   *   `clear_workspace` both supplied (Python raises a bare
   *   `ValueError`; the existing `VALIDATION_ERROR` code is reused).
   * @throws {@link ConfigError} - Unknown account, or `project` supplied
   *   with no resolvable account.
   * @see mixpanel_headless._internal.config.ConfigManager.apply_session
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
        applySetActive(raw, {
          ...(account === null ? {} : { account }),
          ...(workspace === null ? {} : { workspace }),
        });
      }
      if (clearWorkspace) {
        applyClearActive(raw, { workspace: true });
      }
      if (project !== null) {
        const activeBlock = blockAt(raw, "active");
        const targetAccount = account ?? activeBlock["account"];
        if (typeof targetAccount !== "string") {
          throw new ConfigError(
            "Cannot set project: no active account. " +
              "Run `mp account use NAME` first, or pass `account=NAME` " +
              "together with `project=`.",
          );
        }
        applyUpdateAccount(raw, targetAccount, {
          default_project: project,
        });
      }
    });
    return this.getActive();
  }

  // --- targets ---

  /**
   * List targets sorted by name.
   *
   * @returns All configured targets.
   * @throws {@link ConfigError} - A target block fails validation.
   * @see mixpanel_headless._internal.config.ConfigManager.list_targets
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
      out.push(targetFromBlock(name, block));
    }
    return out;
  }

  /**
   * Load one target.
   *
   * @param name - Target name.
   * @returns The validated target.
   * @throws {@link ConfigError} - Unknown name or validation failure.
   * @see mixpanel_headless._internal.config.ConfigManager.get_target
   */
  getTarget(name: string): Target {
    const raw = this.readRaw();
    const targetsBlock = blockAt(raw, "targets");
    const block = targetsBlock[name];
    if (!isPythonDict(block)) {
      throw new ConfigError(`Target '${name}' not found.`);
    }
    return targetFromBlock(name, block);
  }

  /**
   * Add a target block.
   *
   * @param name - Target name (block key).
   * @param options - Account, project and workspace axes.
   * @returns The constructed target.
   * @throws {@link ConfigError} - Duplicate name, missing referenced
   *   account, or validation failure (Target model errors are wrapped).
   * @see mixpanel_headless._internal.config.ConfigManager.add_target
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
      } catch (error) {
        throw wrapAsConfigError(`Invalid target fields for '${name}'`, error);
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
   * Remove a target block.
   *
   * @param name - Target to remove.
   * @throws {@link ConfigError} - Unknown target.
   * @see mixpanel_headless._internal.config.ConfigManager.remove_target
   */
  removeTarget(name: string): void {
    this.transaction((raw) => {
      const targetsBlock = blockAt(raw, "targets");
      if (!Object.hasOwn(targetsBlock, name)) {
        throw new ConfigError(`Target '${name}' not found.`);
      }
      Reflect.deleteProperty(targetsBlock, name);
    });
  }

  /**
   * Apply a target in a single atomic save: `[active]` is replaced
   * wholesale (a target with no workspace clears any prior pin) and the
   * target account's `default_project` is updated to the target's
   * project.
   *
   * @param name - Target to apply.
   * @returns The updated active session.
   * @throws {@link ConfigError} - Unknown target, or its referenced
   *   account is no longer configured.
   * @see mixpanel_headless._internal.config.ConfigManager.apply_target
   */
  applyTarget(name: string): ActiveSession {
    this.transaction((raw) => {
      const targetsBlock = blockAt(raw, "targets");
      const targetBlock = targetsBlock[name];
      if (!isPythonDict(targetBlock)) {
        throw new ConfigError(`Target '${name}' not found.`);
      }
      const target = targetFromBlock(name, targetBlock);
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
      const activeBlock: Record<string, unknown> = { account: target.account };
      if (target.workspace !== null) {
        activeBlock["workspace"] = target.workspace;
      }
      raw["active"] = activeBlock;
    });
    return this.getActive();
  }

  // --- settings ---

  /**
   * Read `[settings].custom_header`.
   *
   * @returns The `(name, value)` pair, or `null` when unset.
   * @throws {@link ConfigError} - Malformed block (non-table, missing
   *   keys, or non-string values).
   * @see mixpanel_headless._internal.config.ConfigManager.get_custom_header
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
   * Write the custom HTTP header.
   *
   * @param params - Header name and value.
   * @see mixpanel_headless._internal.config.ConfigManager.set_custom_header
   */
  setCustomHeader(params: CustomHeaderParams): void {
    this.transaction((raw) => {
      const settings = setdefaultBlock(raw, "settings");
      settings["custom_header"] = { name: params.name, value: params.value };
    });
  }
}
