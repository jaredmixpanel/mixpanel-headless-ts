/**
 * The real on-disk `ResolverConfigSource & ConfigWrites` adapter over
 * {@link ConfigManager} (b8-packets.md §2.1 row 2, §2.4) — the node
 * implementation of the `config.*` members of `UNPORTED_AUTH_SEAMS`
 * (packet §4.4 owner map, N1 rows).
 *
 * Layering (B7-ARB-B B-E2E-N1, `auth-effects.ts` interface JSDoc): the
 * FR-045 first-account promotion happens exactly ONCE, in THIS
 * adapter's {@link NodeConfigSource.addAccount} transaction — the
 * `accounts.py:472-489` twin (`_apply_add_account` + first-account
 * `_apply_set_active` under one `_mutate()`). The underlying
 * {@link ConfigManager.addAccount} stays non-promoting
 * (`test_config.py`'s asserts lock that layer).
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

/** Options of {@link createNodeConfigSource} (packet §2.4). */
export interface NodeConfigSourceOptions {
  /**
   * Config file path override (defaults to `$MP_CONFIG_PATH` at
   * construction, else `~/.mp/config.toml` — the
   * {@link ConfigManager} ctor rules).
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
 * ```typescript
 * const config = createNodeConfigSource({ configPath: "/tmp/x/config.toml" });
 * config.addAccount("team", { type: "oauth_browser", region: "us" });
 * config.getActive(); // { account: "team" } — FR-045 promotion
 * ```
 */
export function createNodeConfigSource(
  options: NodeConfigSourceOptions = {},
): NodeConfigSource {
  const manager = new ConfigManager({ configPath: options.configPath });

  return {
    manager,

    // ---- ResolverConfigSource (reads) ------------------------------

    /**
     * Load a named account.
     *
     * @param name - Account name.
     * @returns The account record.
     * @throws ConfigError - Unknown name (`config.py:549`).
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
     * @throws ConfigError - Unknown name.
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

    // ---- ConfigWrites ----------------------------------------------

    /**
     * Add an account, promoting the FIRST-ever account to
     * `[active].account` in the SAME transaction (FR-045; the
     * `accounts.py:472-489` composition).
     *
     * @param name - Account name.
     * @param params - Typed credential fields.
     * @throws ConfigError - Duplicate name (PLAIN ConfigError,
     *   B-E2E-F1) or validation failure.
     */
    addAccount(name: string, params: AddAccountParams): void {
      manager.transaction((raw) => {
        // `is_first = not (raw.get("accounts") or {})` — evaluated
        // BEFORE the insert (`accounts.py:476`).
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
     * Update fields on an existing account (`config.py:607-650`).
     *
     * @param name - Account to update.
     * @param fields - Fields to rewrite.
     * @throws ConfigError - Missing account, type-incompatible field,
     *   or validation failure.
     */
    updateAccount(name: string, fields: UpdateAccountFields): void {
      manager.updateAccount(name, fields);
    },

    /**
     * Remove an account (`config.py:652-692`).
     *
     * @param name - Account to remove.
     * @param removeOptions - `force` removes despite target refs.
     * @returns Sorted names of targets that referenced the account.
     * @throws ConfigError - Missing account.
     * @throws AccountInUseError - Referenced and `force` not set.
     */
    removeAccount(
      name: string,
      removeOptions: { readonly force?: boolean } = {},
    ): string[] {
      return manager.removeAccount(name, removeOptions);
    },

    /**
     * List account summaries sorted by name (`config.py:494-532`).
     *
     * @returns The summaries.
     */
    listAccounts(): AccountSummary[] {
      return manager.listAccounts();
    },

    /**
     * Update `[active]` axes in ONE transaction. `workspace: null`
     * CLEARS the axis (the `accounts.use` account-swap clear —
     * `SetActiveUpdate` JSDoc; both writes in a single transaction).
     *
     * @param update - The axes to touch.
     * @throws ConfigError - Unknown account or invalid workspace.
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
     * Atomically apply per-axis session updates
     * (`config.py:764-835`).
     *
     * @param update - The axes to touch.
     * @throws ParamValidationError - `workspace` with
     *   `clear_workspace` (the bare-ValueError twin).
     * @throws ConfigError - Unknown account, or `project` with no
     *   resolvable account.
     */
    applySession(update: ApplySessionUpdate): void {
      manager.applySession(update);
    },

    /**
     * Apply a target: `[active]` replaced wholesale + the target
     * account's `default_project` updated, one transaction
     * (`config.py:951-1002`).
     *
     * @param name - Target to apply.
     * @throws ConfigError - Unknown target OR its account is gone.
     */
    applyTarget(name: string): void {
      manager.applyTarget(name);
    },

    /**
     * Add a target block (`config.py:887-934`).
     *
     * @param name - Target name.
     * @param targetOptions - account / project / workspace.
     * @returns The constructed target.
     * @throws ConfigError - Duplicate name, missing account, or
     *   wrapped model validation failure.
     */
    addTarget(name: string, targetOptions: AddTargetOptions): Target {
      return manager.addTarget(name, targetOptions);
    },

    /**
     * Remove a target block (`config.py:936-949`).
     *
     * @param name - Target to remove.
     * @throws ConfigError - Unknown target.
     */
    removeTarget(name: string): void {
      manager.removeTarget(name);
    },

    /**
     * List targets sorted by name (`config.py:837-860`).
     *
     * @returns The targets.
     */
    listTargets(): Target[] {
      return manager.listTargets();
    },
  };
}
