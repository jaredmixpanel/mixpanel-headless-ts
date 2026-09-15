/**
 * In-place transaction mutators of the config manager — the `_apply_*`
 * / `_validate_raw` / `_validate_workspace_id` statics of Python's
 * `ConfigManager` (`mixpanel_headless/_internal/config.py`) as module
 * functions. Each mutates the live raw document a
 * `ConfigManager.transaction` body received; `ConfigWrites` composes
 * several of them under one transaction.
 */

import {
  type Account,
  type AddAccountParams,
  ConfigError,
  isPythonDict,
  parseAccount,
  type UpdateAccountFields,
} from "@mixpanel-headless/core";

import { wrapAsConfigError } from "../errors.js";
import {
  accountFromBlock,
  accountToBlock,
  blockAt,
  credentialText,
  type RawConfig,
  setdefaultBlock,
} from "./blocks.js";

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

/**
 * Validate every account block in `raw` (`_validate_raw`,
 * `config.py:236-254`) — the transaction-exit safety net.
 *
 * @param raw - Parsed document to validate.
 * @throws ConfigError - Any account block fails schema validation.
 */
export function validateRaw(raw: RawConfig): void {
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
export function applySetActive(raw: RawConfig, update: ManagerSetActive): void {
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
    validateWorkspaceId(workspace);
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
export function applyClearActive(
  raw: RawConfig,
  axes: ManagerClearActive,
): void {
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
// eslint-disable-next-line complexity -- branch-for-branch port of one Python function (see the docblock); splitting it would scatter the guard order the corpus pins
export function applyUpdateAccount(
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
    if (token === null) {
      block["token_env"] = tokenEnv;
    } else {
      block["token"] = credentialText(token);
    }
  }

  let account: Account;
  try {
    account = parseAccount({ name, ...block });
  } catch (error) {
    throw wrapAsConfigError(`Invalid account fields for '${name}'`, error);
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
export function applyAddAccount(
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
  switch (params.type) {
    case "service_account": {
      if (username === null || secret === null) {
        throw new ConfigError(
          "ServiceAccount requires `username` and `secret`.",
        );
      }
      block["username"] = username;
      block["secret"] = credentialText(secret);

      break;
    }
    case "oauth_browser": {
      // default_project is optional; populated by `mp account login`.

      break;
    }
    case "oauth_token": {
      if ((token === null) === (tokenEnv === null)) {
        throw new ConfigError(
          "OAuthTokenAccount requires exactly one of `token` or `token_env`.",
        );
      }
      if (token === null) {
        block["token_env"] = tokenEnv;
      } else {
        block["token"] = credentialText(token);
      }

      break;
    }
    default: {
      // Literal exhaustiveness twin (`config.py:478-479`).
      throw new ConfigError(`Unknown account type: '${String(params.type)}'`);
    }
  }

  let account: Account;
  try {
    account = parseAccount({ name, ...block });
  } catch (error) {
    throw wrapAsConfigError(`Invalid account fields for '${name}'`, error);
  }

  accountsBlock[name] = accountToBlock(account);
  return account;
}

/**
 * Validate a workspace ID (`_validate_workspace_id`,
 * `config.py:1043-1056`) — a VALUE typecheck, not a string parse
 * (packet §7 caution 1: `Number.isInteger && > 0`, never `!w` and
 * never `pythonInt`).
 *
 * @param workspace - Candidate ID.
 * @throws ConfigError - Not a positive integer.
 */
export function validateWorkspaceId(workspace: number): void {
  if (!Number.isInteger(workspace) || workspace <= 0) {
    throw new ConfigError(
      `Invalid workspace ID: ${String(workspace)}. ` +
        "Must be a positive integer.",
    );
  }
}
