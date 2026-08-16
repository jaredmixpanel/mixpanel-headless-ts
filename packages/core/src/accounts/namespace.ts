/**
 * The `mp.accounts` namespace factory — binds the `accounts-ops.ts` /
 * `login-unified.ts` operations to one injected {@link AuthEffects}
 * bag (B7-A1 packet §3.1, `b7-packets.md`).
 *
 * Python exposes module-level functions building a fresh
 * `ConfigManager()` per call; the TS core exports this factory and B8
 * exports the ready-made `accounts` object bound to on-disk effects —
 * closing the Phase-2 audit's deferred `__all__` names
 * (`accounts` / `session` / `targets` / `login_unified`, playbook
 * `:74-79`).
 *
 * Naming decision (packet §3.5, B6 Caution-6 precedent, recorded in
 * the shard notes): METHOD names are camelCase like the `Workspace`
 * facade (`exportBridge` ~ `export_bridge`); OPTIONS-BAG keys keep the
 * exact Python kwarg spelling (`default_project`, `token_env`,
 * `derive_name`, `no_browser`, …).
 */

import type {
  AccountSummary,
  AccountTestResult,
  OAuthLoginResult,
} from "../types/entities/accounts.js";
import {
  accountsAdd,
  accountsExportBridge,
  accountsList,
  accountsLogin,
  accountsLogout,
  accountsRemove,
  accountsRemoveBridge,
  accountsShow,
  accountsTest,
  accountsToken,
  accountsUpdate,
  accountsUse,
  type AccountsAddOptions,
  type AccountsLoginOptions,
  type AccountsUpdateOptions,
  type ExportBridgeOptions,
} from "./accounts-ops.js";
import type { AuthEffects } from "./auth-effects.js";
import { loginUnified, type LoginUnifiedOptions } from "./login-unified.js";

/**
 * The `mp.accounts` surface (`accounts.py` `__all__:2014-2028` — 13
 * public names).
 */
export interface AccountsNamespace {
  /**
   * Return all configured accounts (`list`).
   *
   * @returns Sorted-by-name summaries.
   */
  list(): AccountSummary[];

  /**
   * Add a new account (`add`).
   *
   * @param name - Account name; `null` only with `derive_name`.
   * @param options - Typed credential fields.
   * @returns The new summary.
   */
  add(
    name: string | null,
    options: AccountsAddOptions,
  ): Promise<AccountSummary>;

  /**
   * Update fields on an existing account (`update`).
   *
   * @param name - Account to update.
   * @param options - Fields to rewrite.
   * @returns The updated summary.
   */
  update(name: string, options?: AccountsUpdateOptions): AccountSummary;

  /**
   * Remove an account (`remove`).
   *
   * @param name - Account name.
   * @param options - `force` removes despite target references.
   * @returns Orphaned target names.
   */
  remove(name: string, options?: { readonly force?: boolean }): string[];

  /**
   * Switch the active account, clearing the workspace pin (`use`).
   *
   * @param name - Account to make active.
   */
  use(name: string): void;

  /**
   * Return the named (or active) account summary (`show`).
   *
   * @param name - Account name; omitted means the active account.
   * @returns The summary.
   */
  show(name?: string | null): AccountSummary;

  /**
   * Probe `/me` and report the structured outcome (`test`).
   *
   * @param name - Account to test; omitted means the active account.
   * @returns The probe result (never throws).
   */
  test(name?: string | null): Promise<AccountTestResult>;

  /**
   * Run the OAuth browser flow (`login`).
   *
   * @param name - Account name (must be `oauth_browser`).
   * @param options - `open_browser` toggle.
   * @returns The login result.
   */
  login(
    name: string,
    options?: AccountsLoginOptions,
  ): Promise<OAuthLoginResult>;

  /**
   * Remove the on-disk OAuth tokens (`logout`).
   *
   * @param name - Account name.
   */
  logout(name: string): void;

  /**
   * Return the current bearer for an OAuth account (`token`).
   *
   * @param name - Account name; omitted means the active account.
   * @returns The bearer, or `null` for `service_account`.
   */
  token(name?: string | null): Promise<string | null>;

  /**
   * Export a v2 bridge file (`export_bridge`).
   *
   * @param options - Destination + optional account / pins.
   * @returns The path written.
   */
  exportBridge(options: ExportBridgeOptions): Promise<string>;

  /**
   * Remove the v2 bridge file (`remove_bridge`).
   *
   * @param options - `at` overrides the default search path.
   * @returns `true` if a file was deleted.
   */
  removeBridge(options?: { readonly at?: string | null }): boolean;

  /**
   * Add and activate an account in one orchestrated call
   * (`login_unified`).
   *
   * @param options - The orchestrator flags.
   * @returns The new/refreshed summary with `/me`-derived fields.
   */
  loginUnified(options?: LoginUnifiedOptions): Promise<AccountSummary>;
}

/**
 * Build the `mp.accounts` namespace over an effect bag.
 *
 * @param effects - The injected effects.
 * @returns The namespace object.
 *
 * @example
 * ```typescript
 * const accounts = createAccountsNamespace(effects);
 * await accounts.add("team", {
 *   type: "service_account",
 *   region: "us",
 *   username: "u",
 *   secret: "s",
 * });
 * ```
 */
export function createAccountsNamespace(
  effects: AuthEffects,
): AccountsNamespace {
  return {
    list: () => accountsList(effects),
    add: (name, options) => accountsAdd(effects, name, options),
    update: (name, options = {}) => accountsUpdate(effects, name, options),
    remove: (name, options = {}) => accountsRemove(effects, name, options),
    use: (name) => {
      accountsUse(effects, name);
    },
    show: (name = null) => accountsShow(effects, name),
    test: (name = null) => accountsTest(effects, name),
    login: (name, options = {}) => accountsLogin(effects, name, options),
    logout: (name) => {
      accountsLogout(effects, name);
    },
    token: (name = null) => accountsToken(effects, name),
    exportBridge: (options) => accountsExportBridge(effects, options),
    removeBridge: (options = {}) => accountsRemoveBridge(effects, options),
    loginUnified: (options = {}) => loginUnified(effects, options),
  };
}
