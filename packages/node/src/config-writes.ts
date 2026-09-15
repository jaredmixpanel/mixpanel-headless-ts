/**
 * The on-disk `ResolverConfigSource & ConfigWrites` adapter over
 * {@link ConfigManager} — the node implementation of the `config.*`
 * members of `UNPORTED_AUTH_SEAMS`.
 *
 * The first-account promotion to `[active].account` happens exactly
 * once, in this adapter's {@link NodeConfigSource.addAccount}
 * transaction (Python's `accounts.add` runs `_apply_add_account` and
 * `_apply_set_active` under one `_mutate()`); the underlying
 * {@link ConfigManager.addAccount} stays non-promoting, as Python's
 * config-layer tests require.
 *
 * @see mixpanel_headless.accounts.add
 */

import {
  type Account,
  type AccountSummary,
  type ActiveSession,
  type AddAccountParams,
  type AddTargetOptions,
  type ApplySessionUpdate,
  type ConfigWrites,
  isPythonDict,
  type ResolverConfigSource,
  type SetActiveUpdate,
  type Target,
  type UpdateAccountFields,
} from "@mixpanel-headless/core";

import { ConfigManager } from "./config.js";

/** Options of {@link createNodeConfigSource}. */
export interface NodeConfigSourceOptions {
  /**
   * Config file path override (the {@link ConfigManager} constructor
   * rules).
   *
   * @defaultValue `$MP_CONFIG_PATH` at construction, else `~/.mp/config.toml`
   */
  readonly configPath?: string | undefined;
}

/** The combined read/write surface the effects bag consumes. */
export type NodeConfigSource = ResolverConfigSource &
  ConfigWrites & {
    /** The underlying manager (path introspection / direct driving). */
    readonly manager: ConfigManager;
  };

/**
 * Build the on-disk config source + write surface.
 *
 * @param options - Optional config path override.
 * @returns The adapter bound to one {@link ConfigManager}.
 * @example
 * ```ts
 * const config = createNodeConfigSource({ configPath: "/tmp/x/config.toml" });
 * config.addAccount("team", { type: "oauth_browser", region: "us" });
 * config.getActive(); // { account: "team" } — first-account promotion
 * ```
 */
export function createNodeConfigSource(
  options: NodeConfigSourceOptions = {},
): NodeConfigSource {
  const manager = new ConfigManager({ configPath: options.configPath });

  return {
    manager,

    // --- ResolverConfigSource (reads) ---

    /**
     * Load a named account.
     *
     * @param name - Account name.
     * @returns The account record.
     * @throws {@link ConfigError} - Unknown name.
     */
    getAccount(name: string): Account {
      return manager.getAccount(name);
    },

    /**
     * Read the persisted `[active]` block.
     *
     * @returns The active session (may be empty).
     */
    getActive(): ActiveSession {
      return manager.getActive();
    },

    /**
     * Load a named target.
     *
     * @param name - Target name.
     * @returns The target record.
     * @throws {@link ConfigError} - Unknown name.
     */
    getTarget(name: string): Target {
      return manager.getTarget(name);
    },

    /**
     * Read `[settings].custom_header`.
     *
     * @returns The `(name, value)` entry, or `null` when unset.
     */
    getCustomHeader(): readonly [string, string] | null {
      return manager.getCustomHeader();
    },

    // --- ConfigWrites ---

    /**
     * Add an account, promoting the first-ever account to
     * `[active].account` in the same transaction.
     *
     * @param name - Account name.
     * @param params - Typed credential fields.
     * @throws {@link ConfigError} - Duplicate name (a plain
     *   `ConfigError`, not `AccountExistsError`) or validation failure.
     */
    addAccount(name: string, params: AddAccountParams): void {
      manager.transaction((raw) => {
        // `is_first = not (raw.get("accounts") or {})`, evaluated before
        // the insert.
        const accounts = raw["accounts"];
        const isFirst =
          !isPythonDict(accounts) || Object.keys(accounts).length === 0;
        ConfigManager.applyAddAccount(raw, name, params);
        if (isFirst) {
          ConfigManager.applySetActive(raw, { account: name });
        }
      });
    },

    /**
     * Update fields on an existing account.
     *
     * @param name - Account to update.
     * @param fields - Fields to rewrite.
     * @throws {@link ConfigError} - Missing account, type-incompatible
     *   field, or validation failure.
     */
    updateAccount(name: string, fields: UpdateAccountFields): void {
      manager.updateAccount(name, fields);
    },

    /**
     * Remove an account.
     *
     * @param name - Account to remove.
     * @param removalOptions - Removal switches; `force` removes the
     *   account even when targets still reference it.
     * @returns Sorted names of targets that referenced the account.
     * @throws {@link ConfigError} - Missing account.
     * @throws {@link AccountInUseError} - Referenced and `force` not set.
     */
    removeAccount(
      name: string,
      removalOptions: { readonly force?: boolean } = {},
    ): string[] {
      return manager.removeAccount(name, removalOptions);
    },

    /**
     * List account summaries sorted by name.
     *
     * @returns The summaries.
     */
    listAccounts(): AccountSummary[] {
      return manager.listAccounts();
    },

    /**
     * Update `[active]` axes in one transaction. `workspace: null`
     * clears the axis (the `accounts.use` account-swap clear); both
     * writes land in a single transaction.
     *
     * @param update - The axes to touch.
     * @throws {@link ConfigError} - Unknown account or invalid workspace.
     */
    setActive(update: SetActiveUpdate): void {
      manager.transaction((raw) => {
        if (update.account !== undefined) {
          ConfigManager.applySetActive(raw, { account: update.account });
        }
        if (update.workspace === null) {
          ConfigManager.applyClearActive(raw, { workspace: true });
        } else if (update.workspace !== undefined) {
          ConfigManager.applySetActive(raw, { workspace: update.workspace });
        }
      });
    },

    /**
     * Atomically apply per-axis session updates.
     *
     * @param update - The axes to touch.
     * @throws {@link ParamValidationError} - `workspace` combined with
     *   `clear_workspace` (Python raises a bare `ValueError`).
     * @throws {@link ConfigError} - Unknown account, or `project` with
     *   no resolvable account.
     */
    applySession(update: ApplySessionUpdate): void {
      manager.applySession(update);
    },

    /**
     * Apply a target: `[active]` is replaced wholesale and the target
     * account's `default_project` updated, in one transaction.
     *
     * @param name - Target to apply.
     * @throws {@link ConfigError} - Unknown target, or its account is
     *   gone.
     */
    applyTarget(name: string): void {
      manager.applyTarget(name);
    },

    /**
     * Add a target block.
     *
     * @param name - Target name.
     * @param targetOptions - Account, project and workspace axes.
     * @returns The constructed target.
     * @throws {@link ConfigError} - Duplicate name, missing account, or
     *   wrapped model validation failure.
     */
    addTarget(name: string, targetOptions: AddTargetOptions): Target {
      return manager.addTarget(name, targetOptions);
    },

    /**
     * Remove a target block.
     *
     * @param name - Target to remove.
     * @throws {@link ConfigError} - Unknown target.
     */
    removeTarget(name: string): void {
      manager.removeTarget(name);
    },

    /**
     * List targets sorted by name.
     *
     * @returns The targets.
     */
    listTargets(): Target[] {
      return manager.listTargets();
    },
  };
}
