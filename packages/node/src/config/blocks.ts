/**
 * Raw TOML document access and the `[accounts.NAME]` / `[targets.NAME]`
 * block ↔ model conversions of the config manager — the
 * `_account_from_block` / `_account_to_block` / target-block twins of
 * `mixpanel_headless/_internal/config.py`.
 *
 * CRED-F3: the ONE on-disk reveal site of the config manager is
 * {@link accountToBlock}, which unwraps {@link Secret} values to plain
 * strings because TOML cannot store an opaque wrapper and
 * `Secret.toJSON()` would persist the redaction mask. Raw in-memory
 * transaction dicts only ever hold the revealed strings this function
 * produced (or strings read back from disk); a `Secret` instance never
 * reaches the TOML serializer.
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
 * The default config path — `~/.mp/config.toml`.
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
export function defaultConfigPath(): string {
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
export function blockAt(raw: RawConfig, key: string): Record<string, unknown> {
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
 * block (`_account_from_block`, `config.py`).
 *
 * @param name - Account name (matches the TOML block key).
 * @param block - Parsed block contents.
 * @returns The validated account.
 * @throws ConfigError - Validation failure (missing required field,
 *   unknown key, bad type) — the Pydantic-wrap twin.
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
 * `name` (`_account_to_block`, `config.py`).
 *
 * **THE designated CRED-F3 reveal site** (packet §2.2): secrets unwrap
 * to plain strings here because TOML cannot store an opaque wrapper —
 * routing through `Secret.toJSON()` would persist the redaction mask.
 *
 * @param account - Validated account to serialize.
 * @returns Plain dict with `type`, `region`, and type-specific fields.
 * @throws ConfigError - `oauth_token` account with neither `token` nor
 *   `token_env` (model invariant guard, `config.py`).
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
      // Model invariant (XOR) — explicit raise, not an assert
      // (`config.py`).
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
 * Construct a validated {@link Target} from a `[targets.NAME]`
 * block, wrapping model errors in ConfigError (`config.py`).
 *
 * @param name - Target name (the block key).
 * @param block - Parsed block contents.
 * @returns The target.
 * @throws ConfigError - Model validation failure.
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
