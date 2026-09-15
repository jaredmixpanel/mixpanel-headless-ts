/**
 * Raw TOML document access and the `[accounts.NAME]` / `[targets.NAME]`
 * block-to-model conversions of the config manager.
 *
 * The one on-disk secret-reveal site of the config manager is
 * {@link accountToBlock}, which unwraps {@link Secret} values to plain
 * strings because TOML cannot store an opaque wrapper and
 * `Secret.toJSON()` would persist the redaction mask. Raw in-memory
 * transaction dicts only ever hold the revealed strings this function
 * produced (or strings read back from disk); a `Secret` instance never
 * reaches the TOML serializer.
 *
 * @see mixpanel_headless._internal.config._account_to_block
 */

import { homedir } from "node:os";
import { join } from "node:path";

import {
  type Account,
  ConfigError,
  isPythonDict,
  parseAccount,
  Secret,
  Target,
} from "@mixpanel-headless/core";

import { wrapAsConfigError } from "../errors.js";

/** The raw parsed TOML document a transaction mutates in place. */
export type RawConfig = Record<string, unknown>;

/**
 * Return the default config path, `~/.mp/config.toml`, computed at call
 * time.
 *
 * @remarks
 * Divergence: Python freezes `_DEFAULT_CONFIG_PATH` at module import
 * (`Path.home()` evaluated once), so a Python process that changes
 * `HOME` after import keeps writing the import-time config; the TS twin
 * resolves `homedir()` at every `ConfigManager` construction and follows
 * the new `HOME`. Observable only when `HOME` changes mid-process with
 * `MP_CONFIG_PATH` unset (test harnesses, long-lived agent hosts).
 * Python's own bridge and storage defaults are call-time; only the
 * config default is import-frozen, and matching an import-time freeze in
 * ESM would pin module-evaluation-order trivia.
 * @returns The absolute default path.
 * @example
 * ```ts
 * defaultConfigPath(); // "/Users/me/.mp/config.toml"
 * ```
 */
export function defaultConfigPath(): string {
  return join(homedir(), ".mp", "config.toml");
}

/**
 * Return the live block when it is a dict, else a detached empty record
 * (`raw.get(key, {}) or {}`; mutations of the fallback are lost, exactly
 * like mutating Python's default `{}`).
 *
 * @param raw - The parsed TOML document.
 * @param key - Top-level section name.
 * @returns The live section dict or a detached `{}`.
 * @example
 * ```ts
 * const accounts = blockAt(raw, "accounts");
 * Object.hasOwn(accounts, name); // false on a missing section, no throw
 * ```
 */
export function blockAt(raw: RawConfig, key: string): Record<string, unknown> {
  const value = raw[key];
  return isPythonDict(value) ? value : {};
}

/**
 * Return the live section, inserting an empty one when absent
 * (`raw.setdefault(key, {})`).
 *
 * @param raw - The parsed TOML document.
 * @param key - Top-level section name.
 * @returns The live section dict.
 * @example
 * ```ts
 * const targets = setdefaultBlock(raw, "targets");
 * targets[name] = { account, project }; // lands in `raw`
 * ```
 */
export function setdefaultBlock(
  raw: RawConfig,
  key: string,
): Record<string, unknown> {
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
 * `secret.get_secret_value() if isinstance(secret, SecretStr) else secret`).
 *
 * @remarks
 * A transaction-local unwrap feeding `parseAccount` validation payloads
 * that never reach disk directly: the value is re-wrapped into a
 * {@link Secret} by `parseAccount` and only revealed for persistence at
 * the designated {@link accountToBlock} site.
 * @param value - Credential param.
 * @returns The plain text, or `null` when absent.
 * @example
 * ```ts
 * block["secret"] = credentialText(params.secret);
 * ```
 */
export function credentialText(
  value: Secret | string | null | undefined,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return value instanceof Secret ? value.reveal() : value;
}

/**
 * Construct an {@link Account} variant from a parsed `[accounts.NAME]`
 * block.
 *
 * @param name - Account name (matches the TOML block key).
 * @param block - Parsed block contents.
 * @returns The validated account.
 * @throws {@link ConfigError} - Validation failure (missing required
 *   field, unknown key, bad type), wrapping the model error as Python
 *   wraps pydantic's.
 * @example
 * ```ts
 * const account = accountFromBlock("team", blockAt(raw, "accounts")["team"]);
 * ```
 * @see mixpanel_headless._internal.config._account_from_block
 */
export function accountFromBlock(
  name: string,
  block: Record<string, unknown>,
): Account {
  try {
    return parseAccount({ name, ...block });
  } catch (error) {
    throw wrapAsConfigError(`Invalid [accounts.${name}] block`, error);
  }
}

/**
 * Serialize an {@link Account} to a TOML-ready plain dict, excluding
 * `name`. The designated secret-reveal site: secrets unwrap to plain
 * strings here because TOML cannot store an opaque wrapper, and routing
 * through `Secret.toJSON()` would persist the redaction mask.
 *
 * @param account - Validated account to serialize.
 * @returns Plain dict with `type`, `region`, and type-specific fields.
 * @throws {@link ConfigError} - `oauth_token` account with neither
 *   `token` nor `token_env` (model invariant guard).
 * @example
 * ```ts
 * accountsBlock[account.name] = accountToBlock(account);
 * ```
 * @see mixpanel_headless._internal.config._account_to_block
 */
export function accountToBlock(account: Account): Record<string, unknown> {
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
      // Model invariant (`token` xor `token_env`): an explicit raise, not
      // an assert.
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

/**
 * Construct a validated {@link Target} from a `[targets.NAME]` block,
 * wrapping model errors in `ConfigError`.
 *
 * @param name - Target name (the block key).
 * @param block - Parsed block contents.
 * @returns The target.
 * @throws {@link ConfigError} - Model validation failure.
 * @example
 * ```ts
 * const target = targetFromBlock("prod", blockAt(raw, "targets")["prod"]);
 * ```
 * @see mixpanel_headless._internal.config.ConfigManager.get_target
 */
export function targetFromBlock(
  name: string,
  block: Record<string, unknown>,
): Target {
  try {
    return Target.fromDict({ name, ...block });
  } catch (error) {
    throw wrapAsConfigError(`Invalid [targets.${name}] block`, error);
  }
}
