/**
 * On-disk TOML configuration manager — TS port of
 * `mixpanel_headless/_internal/config.py` (whole file,
 * `config.py:1-1061`; b8-packets.md §2.1 row 2). The block conversions
 * live in `./blocks.ts`, the in-place `_apply_*` mutators in
 * `./apply.ts`; `../config.ts` re-exports the public surface.
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
   *
   * A custom location's PARENT directory is the caller's responsibility:
   * it is created `0o700` if absent but an existing directory's mode is
   * never changed (the config file itself is always written `0o600`).
   * Only the default `~/.mp` is tightened to `0o700` on every write.
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

  /** The path of the on-disk TOML config (`config.py:155-158`). */
  get configPath(): string {
    return this.#path;
  }

  /**
   * Whole-file account validation (`_validate_raw`) — the static twin
   * delegating to {@link validateRaw}.
   *
   * @param raw - Parsed document to validate.
   */
  static validateRaw(raw: RawConfig): void {
    validateRaw(raw);
  }

  /**
   * In-place `[active]` mutation (`_apply_set_active`) — delegates to
   * {@link applySetActive}.
   *
   * @param raw - Parsed document (mutated in place).
   * @param update - New account / workspace values.
   */
  static applySetActive(raw: RawConfig, update: ManagerSetActive): void {
    applySetActive(raw, update);
  }

  /**
   * In-place `[active]` axis removal (`_apply_clear_active`) — delegates
   * to {@link applyClearActive}.
   *
   * @param raw - Parsed document (mutated in place).
   * @param axes - Which axes to drop.
   */
  static applyClearActive(raw: RawConfig, axes: ManagerClearActive): void {
    applyClearActive(raw, axes);
  }

  /**
   * In-place per-account mutation (`_apply_update_account`) — delegates
   * to {@link applyUpdateAccount}.
   *
   * @param raw - Parsed document (mutated in place).
   * @param name - Account to update (must exist).
   * @param fields - Fields to rewrite (absent members untouched).
   * @returns The updated validated account.
   */
  static applyUpdateAccount(
    raw: RawConfig,
    name: string,
    fields: UpdateAccountFields,
  ): Account {
    return applyUpdateAccount(raw, name, fields);
  }

  /**
   * In-place `[accounts.NAME]` insertion (`_apply_add_account`) —
   * delegates to {@link applyAddAccount}.
   *
   * @param raw - Parsed document (mutated in place).
   * @param name - New account name.
   * @param params - Typed credential fields.
   * @returns The constructed validated account.
   */
  static applyAddAccount(
    raw: RawConfig,
    name: string,
    params: AddAccountParams,
  ): Account {
    return applyAddAccount(raw, name, params);
  }

  /**
   * Workspace-ID value check (`_validate_workspace_id`) — delegates to
   * {@link validateWorkspaceId}.
   *
   * @param workspace - Candidate ID.
   */
  static validateWorkspaceId(workspace: number): void {
    validateWorkspaceId(workspace);
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
    } catch (error) {
      // Python wraps ANY OSError from the probe (`config.py:180-183`),
      // so errno-bearing lstat failures (e.g. EACCES on an unreadable
      // parent) code up exactly like the symlink refusal — B8-ARB-A
      // SEM-F6 (`b8-reviewA-resolution.md`).
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
    const dir = dirname(this.#path);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    // Divergence: Python chmods the config file's parent to 0o700 on every write whatever the path (`config.py:202-205`); TS tightens only the default `~/.mp` — a custom `configPath`/`MP_CONFIG_PATH` parent (a repo `config/`, `/tmp`) is left alone.
    if (resolve(dir) === resolve(dirname(defaultConfigPath()))) {
      try {
        chmodSync(dir, 0o700);
      } catch {
        // suppress(OSError) — best-effort tighten (`config.py:203-204`).
      }
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
    validateRaw(raw);
    this.writeRaw(raw);
    return result;
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
    return this.transaction((raw) => applyAddAccount(raw, name, params));
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
    return this.transaction((raw) => applyUpdateAccount(raw, name, fields));
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
      Reflect.deleteProperty(accountsBlock, name);
      // If the removed account was the active one, drop both axes
      // (`config.py:683-689` — the workspace ID is meaningless without
      // its account).
      const activeBlock = blockAt(raw, "active");
      if (activeBlock["account"] === name) {
        applyClearActive(raw, { account: true, workspace: true });
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
    } catch (error) {
      throw wrapAsConfigError(`Invalid [active] block`, error);
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
      applySetActive(raw, update);
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
      applyClearActive(raw, axes);
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
      out.push(targetFromBlock(name, block));
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
    return targetFromBlock(name, block);
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
      Reflect.deleteProperty(targetsBlock, name);
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
}
