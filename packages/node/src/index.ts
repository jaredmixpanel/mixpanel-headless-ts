/**
 * @mixpanel-headless/node — Node-specific surface (R9.2): TOML config,
 * token files, localhost OAuth callback, bridge file, env resolution.
 *
 * B8-N3 (b8-packets.md §4.1 row 5) turns the Phase-1 skeleton into the
 * ready-made public surface: `createNodeAuthEffects` (the real
 * {@link AuthEffects} bag), `createNodeResolverSources` (default
 * `ResolverSources` wiring — PURE bridge load),
 * `createNodeWorkspaceSources` (the `Workspace()` STARTUP wiring with
 * the bridge-token materialization side effect, `workspace.py:476-513`
 * — B8-ARB-A SEM-F1), and the `accounts` / `session` /
 * `targets` namespaces + `loginUnified` over the real bag — closing
 * the four Phase-2 `__all__` deferrals at node level (Python's
 * `mp.accounts` / `mp.session` / `mp.targets` /
 * `mp.accounts.login_unified`; the snake_case `login_unified` name
 * maps to `loginUnified` per the standard naming rules).
 *
 * Freshness rule: each namespace call builds a FRESH default bag so
 * `MP_CONFIG_PATH` / `MP_OAUTH_STORAGE_DIR` / `MP_AUTH_FILE` are read
 * at call time (packet §0.5 / §7 caution 16 — module-load env capture
 * would break test isolation). Callers wanting one pinned bag build it
 * themselves via {@link createNodeAuthEffects} and the core factories.
 */

import type { AuthEffects } from "../../core/src/accounts/auth-effects.js";
import {
  loginUnified as coreLoginUnified,
  type LoginUnifiedOptions,
} from "../../core/src/accounts/login-unified.js";
import {
  createAccountsNamespace,
  type AccountsNamespace,
} from "../../core/src/accounts/namespace.js";
import {
  createSessionNamespace,
  type SessionNamespace,
} from "../../core/src/accounts/session-namespace.js";
import {
  createTargetsNamespace,
  type TargetsNamespace,
} from "../../core/src/accounts/targets-namespace.js";
import type { AccountSummary } from "../../core/src/types/entities/accounts.js";
import { createNodeAuthEffects } from "./auth-effects.js";

/** Package name constant exercised by the skeleton smoke test. */
export const NODE_PACKAGE_NAME = "@mixpanel-headless/node";

export {
  createNodeAuthEffects,
  createNodeResolverSources,
  createNodeWorkspaceSources,
  type NodeAuthEffectsOptions,
  type NodeFlowSeams,
} from "./auth-effects.js";

// QA 2026-08-17: the Python `Workspace()` zero-config twin — sources +
// on-disk token resolver + on-disk MeCache + node:fs read seam in one
// call (see workspace.ts header for why the pieces alone weren't
// enough).
export { createNodeWorkspace, type NodeWorkspaceOptions } from "./workspace.js";

/**
 * A fresh default bag (call-time env reads — module header).
 *
 * @returns The fully-wired node effects.
 */
function freshEffects(): AuthEffects {
  return createNodeAuthEffects();
}

/**
 * Ready-made `mp.accounts` twin over the real node bag. Every call
 * delegates to a fresh {@link createNodeAuthEffects} bag (module
 * header freshness rule).
 */
export const accounts: AccountsNamespace = {
  /**
   * List all configured accounts.
   *
   * @returns Sorted-by-name summaries.
   */
  list: () => createAccountsNamespace(freshEffects()).list(),
  /**
   * Add a new account.
   *
   * @param name - Account name (`null` only with `derive_name`).
   * @param options - Typed credential fields.
   * @returns The new summary.
   */
  add: (...args: Parameters<AccountsNamespace["add"]>) =>
    createAccountsNamespace(freshEffects()).add(...args),
  /**
   * Update fields on an existing account.
   *
   * @param name - Account to update.
   * @param options - Fields to rewrite.
   * @returns The updated summary.
   */
  update: (...args: Parameters<AccountsNamespace["update"]>) =>
    createAccountsNamespace(freshEffects()).update(...args),
  /**
   * Remove an account.
   *
   * @param name - Account name.
   * @param options - `force` removes despite target references.
   * @returns Orphaned target names.
   */
  remove: (...args: Parameters<AccountsNamespace["remove"]>) =>
    createAccountsNamespace(freshEffects()).remove(...args),
  /**
   * Switch the active account, clearing the workspace pin.
   *
   * @param name - Account to make active.
   */
  use: (...args: Parameters<AccountsNamespace["use"]>) =>
    createAccountsNamespace(freshEffects()).use(...args),
  /**
   * Return the named (or active) account summary.
   *
   * @param name - Account name; omitted means the active account.
   * @returns The summary.
   */
  show: (...args: Parameters<AccountsNamespace["show"]>) =>
    createAccountsNamespace(freshEffects()).show(...args),
  /**
   * Probe `/me` and report the structured outcome.
   *
   * @param name - Account to test; omitted means the active account.
   * @returns The probe result (never throws).
   */
  test: (...args: Parameters<AccountsNamespace["test"]>) =>
    createAccountsNamespace(freshEffects()).test(...args),
  /**
   * Run the PKCE flow for an oauth_browser account.
   *
   * @param name - Account to log in.
   * @param options - Flow options.
   * @returns The login result.
   */
  login: (...args: Parameters<AccountsNamespace["login"]>) =>
    createAccountsNamespace(freshEffects()).login(...args),
  /**
   * Delete the persisted tokens for an account.
   *
   * @param name - Account to log out.
   */
  logout: (...args: Parameters<AccountsNamespace["logout"]>) =>
    createAccountsNamespace(freshEffects()).logout(...args),
  /**
   * Return a valid bearer token for an account.
   *
   * @param name - Account name; omitted means the active account.
   * @returns The token result.
   */
  token: (...args: Parameters<AccountsNamespace["token"]>) =>
    createAccountsNamespace(freshEffects()).token(...args),
  /**
   * Write a v2 Cowork bridge file.
   *
   * @param options - Destination + optional account/pins.
   * @returns The written path.
   */
  exportBridge: (...args: Parameters<AccountsNamespace["exportBridge"]>) =>
    createAccountsNamespace(freshEffects()).exportBridge(...args),
  /**
   * Remove a bridge file (idempotent).
   *
   * @param options - Optional explicit path.
   * @returns Whether a file was deleted.
   */
  removeBridge: (...args: Parameters<AccountsNamespace["removeBridge"]>) =>
    createAccountsNamespace(freshEffects()).removeBridge(...args),
  /**
   * One-shot login orchestrator (`mp login`).
   *
   * @param options - Orchestrator flags.
   * @returns The new/refreshed account summary.
   */
  loginUnified: (...args: Parameters<AccountsNamespace["loginUnified"]>) =>
    createAccountsNamespace(freshEffects()).loginUnified(...args),
};

/**
 * Ready-made `mp.session` twin over the real node bag (call-time
 * fresh-bag rule — module header).
 */
export const session: SessionNamespace = {
  /**
   * Read the persisted `[active]` block.
   *
   * @returns The active session (may be empty).
   */
  show: (...args: Parameters<SessionNamespace["show"]>) =>
    createSessionNamespace(freshEffects()).show(...args),
  /**
   * Write axes (or a target) to `[active]` in one transaction.
   *
   * @param options - The axes (or a target).
   */
  use: (...args: Parameters<SessionNamespace["use"]>) =>
    createSessionNamespace(freshEffects()).use(...args),
};

/**
 * Ready-made `mp.targets` twin over the real node bag (call-time
 * fresh-bag rule — module header).
 */
export const targets: TargetsNamespace = {
  /**
   * List all configured targets sorted by name.
   *
   * @returns Sorted target records.
   */
  list: (...args: Parameters<TargetsNamespace["list"]>) =>
    createTargetsNamespace(freshEffects()).list(...args),
  /**
   * Add a new target block.
   *
   * @param name - Target name.
   * @param options - account / project / optional workspace.
   * @returns The constructed target.
   */
  add: (...args: Parameters<TargetsNamespace["add"]>) =>
    createTargetsNamespace(freshEffects()).add(...args),
  /**
   * Remove a target block.
   *
   * @param name - Target to remove.
   */
  remove: (...args: Parameters<TargetsNamespace["remove"]>) =>
    createTargetsNamespace(freshEffects()).remove(...args),
  /**
   * Apply the target — all three axes to `[active]` atomically.
   *
   * @param name - Target to apply.
   */
  use: (...args: Parameters<TargetsNamespace["use"]>) =>
    createTargetsNamespace(freshEffects()).use(...args),
  /**
   * Return the named target.
   *
   * @param name - Target name.
   * @returns The target record.
   */
  show: (...args: Parameters<TargetsNamespace["show"]>) =>
    createTargetsNamespace(freshEffects()).show(...args),
};

/**
 * Ready-made `mp.accounts.login_unified` twin over the real node bag
 * (`mp login`'s engine) — the fourth Phase-2 `__all__` deferral.
 *
 * @param options - The orchestrator flags.
 * @returns The new/refreshed account's summary.
 * @throws ConfigError | AccountExistsError | OAuthError |
 *   InvalidArgumentError - Per the core orchestrator's catalog.
 *
 * @example
 * ```typescript
 * import { loginUnified } from "@mixpanel-headless/node";
 * const summary = await loginUnified({ region: "us" });
 * ```
 */
export function loginUnified(
  options: LoginUnifiedOptions = {},
): Promise<AccountSummary> {
  return coreLoginUnified(freshEffects(), options);
}
