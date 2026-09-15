/**
 * Factory for the `accounts` namespace: binds the `accounts-ops.ts` /
 * `login-unified.ts` operations to one injected {@link AuthEffects} bag.
 * Python exposes module-level functions that build a fresh
 * `ConfigManager()` per call; core exports this factory and
 * `@mixpanel-headless/node` exports the ready-made `accounts` object
 * bound to on-disk effects. Method names are camelCase like the
 * `Workspace` facade (`exportBridge` ~ `export_bridge`); option-bag keys
 * keep the Python keyword spelling (`default_project`, `derive_name`, …).
 *
 * @see mixpanel_headless.accounts
 */

import type {
  AccountSummary,
  AccountTestResult,
  OAuthLoginResult,
} from "../types/entities/accounts.js";
import {
  accountsAdd,
  type AccountsAddOptions,
  accountsExportBridge,
  accountsList,
  accountsLogin,
  type AccountsLoginOptions,
  accountsLogout,
  accountsRemove,
  accountsRemoveBridge,
  accountsShow,
  accountsTest,
  accountsToken,
  accountsUpdate,
  type AccountsUpdateOptions,
  accountsUse,
  type ExportBridgeOptions,
} from "./accounts-ops.js";
import type { AuthEffects } from "./auth-effects.js";
import { loginUnified, type LoginUnifiedOptions } from "./login-unified.js";

/**
 * The `accounts` namespace: the thirteen operations Python exports from
 * its `accounts` module, bound to one effect bag.
 *
 * @see mixpanel_headless.accounts
 */
export interface AccountsNamespace {
  /**
   * Return every configured account, sorted by name.
   *
   * @returns The account summaries.
   * @see mixpanel_headless.accounts.list
   */
  list: () => AccountSummary[];

  /**
   * Add a new account and return its summary.
   *
   * @param name - Account name; `null` only together with `derive_name`.
   * @param options - Typed credential fields plus `derive_name`.
   * @returns The new account's summary.
   * @throws {@link ParamTypeError} - When `derive_name` is combined with
   *   an explicit `name`, or neither is given.
   * @throws {@link ConfigError} - When validation fails, the name is
   *   taken, or `region` is omitted for a non-browser type.
   * @see mixpanel_headless.accounts.add
   */
  add: (
    name: string | null,
    options: AccountsAddOptions,
  ) => Promise<AccountSummary>;

  /**
   * Update fields on an existing account in place; the type cannot
   * change.
   *
   * @param name - Account to update.
   * @param options - Fields to rewrite; absent fields stay untouched.
   * @returns The updated summary.
   * @throws {@link ConfigError} - When the account is missing, a field
   *   does not fit its type, or validation fails.
   * @see mixpanel_headless.accounts.update
   */
  update: (name: string, options?: AccountsUpdateOptions) => AccountSummary;

  /**
   * Remove an account and report the targets that referenced it.
   *
   * @param name - Account name.
   * @param options - `force` (default `false`) removes the account even
   *   when targets reference it.
   * @returns Names of the targets left pointing at the removed account.
   * @throws {@link ConfigError} - When the account does not exist.
   * @throws {@link AccountInUseError} - When targets reference the
   *   account and `force` is not set.
   * @see mixpanel_headless.accounts.remove
   */
  remove: (name: string, options?: { readonly force?: boolean }) => string[];

  /**
   * Make an account active and clear the workspace pin in one
   * transaction.
   *
   * @param name - Account to make active.
   * @throws {@link ConfigError} - When the account does not exist.
   * @see mixpanel_headless.accounts.use
   */
  use: (name: string) => void;

  /**
   * Return the named account's summary, or the active account's.
   *
   * @param name - Account name; omitted means the active account.
   * @returns The summary.
   * @throws {@link ConfigError} - When the account is not found, or no
   *   account is active.
   * @see mixpanel_headless.accounts.show
   */
  show: (name?: string | null) => AccountSummary;

  /**
   * Probe `/me` for an account and report the outcome without throwing.
   *
   * @param name - Account to test; omitted means the active account.
   * @returns The probe result; failures land in `ok: false` plus `error`.
   * @see mixpanel_headless.accounts.test
   */
  test: (name?: string | null) => Promise<AccountTestResult>;

  /**
   * Run the OAuth browser flow for an `oauth_browser` account and persist
   * its tokens.
   *
   * @param name - Account name; must be an `oauth_browser` account.
   * @param options - `open_browser` (default `true`) launches the system
   *   browser instead of printing the authorize URL.
   * @returns The persistence paths, token expiry and user identity.
   * @throws {@link ConfigError} - When the account is unknown, of another
   *   type, or its project lives in a different region.
   * @throws {@link OAuthError} - When the flow or the `/me` probe fails.
   * @see mixpanel_headless.accounts.login
   */
  login: (
    name: string,
    options?: AccountsLoginOptions,
  ) => Promise<OAuthLoginResult>;

  /**
   * Delete the persisted OAuth tokens for an account.
   *
   * @param name - Account name.
   * @throws {@link ConfigError} - When the account does not exist.
   * @see mixpanel_headless.accounts.logout
   */
  logout: (name: string) => void;

  /**
   * Return the current bearer for an OAuth account.
   *
   * @param name - Account name; omitted means the active account.
   * @returns The plaintext bearer, or `null` for a `service_account`.
   * @throws {@link ConfigError} - When the account does not exist.
   * @throws {@link OAuthError} - When the token cannot be resolved.
   * @see mixpanel_headless.accounts.token
   */
  token: (name?: string | null) => Promise<string | null>;

  /**
   * Export an account as a v2 bridge file.
   *
   * @param options - The destination path `to`, the `account` (default:
   *   the active account) and optional `project` / `workspace` pins.
   * @returns The path written.
   * @throws {@link ConfigError} - When the account is not found, or no
   *   account is active.
   * @throws {@link OAuthError} - When an `oauth_browser` account has no
   *   tokens.
   * @see mixpanel_headless.accounts.export_bridge
   */
  exportBridge: (options: ExportBridgeOptions) => Promise<string>;

  /**
   * Remove the v2 bridge file.
   *
   * @param options - `at` (default `null`, the default search paths)
   *   names the file to delete.
   * @returns `true` when a file was deleted.
   * @see mixpanel_headless.accounts.remove_bridge
   */
  removeBridge: (options?: { readonly at?: string | null }) => boolean;

  /**
   * Add and activate an account in one orchestrated call.
   *
   * @param options - The orchestrator flags (see
   *   {@link LoginUnifiedOptions}).
   * @returns The new or refreshed summary with `/me`-derived fields.
   * @throws {@link InvalidArgumentError} - When flags conflict.
   * @throws {@link ConfigError} - When the region or auth type cannot be
   *   honoured, or the project cannot be resolved.
   * @throws {@link AccountExistsError} - When a derived name collides.
   * @throws {@link ProjectNotFoundError} - When an explicit `project` is
   *   not visible in `/me`.
   * @throws {@link OAuthError} - When the PKCE flow fails.
   * @see mixpanel_headless.accounts.login_unified
   */
  loginUnified: (options?: LoginUnifiedOptions) => Promise<AccountSummary>;
}

/**
 * Build the `accounts` namespace over an effect bag.
 *
 * @param effects - The injected effects; `@mixpanel-headless/node`
 *   exports a fully wired bag.
 * @returns The namespace object.
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
 * @see mixpanel_headless.accounts
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
