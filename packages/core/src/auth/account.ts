/**
 * The account discriminated union (`service_account` / `oauth_browser` /
 * `oauth_token`) and the `TokenResolver` seam. Frozen Pydantic models
 * port to compile-time `readonly` interfaces (no runtime `Object.freeze`);
 * {@link parseAccount} replicates the Pydantic invariants (`extra='forbid'`,
 * name pattern and length, digits-only `default_project`, exactly one
 * token source) and throws the generic boundary errors rather than
 * minting new codes. `auth_header()` / `is_long_lived()` port as free
 * functions so the interfaces stay data-only.
 *
 * @see mixpanel_headless._internal.auth.account
 */

import { cpLength } from "../compat/codepoint.js";
import { MixpanelHeadlessError, ParamTypeError } from "../errors.js";
import { Secret } from "../secret.js";
import {
  ACCOUNT_TYPE_VALUES,
  type Region,
  REGION_VALUES,
} from "../types/literals.js";
import { type ParseAccountOptions, parseFail } from "./shared.js";

// --- Identifier aliases (Python NewType) ---
//
// Python's `NewType` is erased at runtime and the public facade
// deliberately accepts bare `str`, so these port as plain type aliases,
// not branded types: brands would force casts at every mechanically
// translated call site for zero wire-contract gain.

/** Identifier for `[accounts.NAME]` config blocks. `string` at runtime. */
export type AccountName = string;

/** Mixpanel project ID (numeric string on the wire). `string` at runtime. */
export type ProjectId = string;

/** Mixpanel workspace ID (positive integer). `number` at runtime. */
export type WorkspaceId = number;

/** Identifier for `[targets.NAME]` config blocks. `string` at runtime. */
export type TargetName = string;

/**
 * Produces bearer tokens for OAuth accounts (the Python `TokenResolver`
 * Protocol).
 *
 * Token refresh does I/O, so both methods are async; refresh already
 * happens at per-request resolution time, so the async signature
 * changes no observable wire behaviour.
 *
 * @see mixpanel_headless._internal.auth.account.TokenResolver
 */
export interface TokenResolver {
  /**
   * Return a fresh access token for an {@link OAuthBrowserAccount}.
   *
   * @param name - Account name (locates persisted tokens on disk).
   * @param region - Mixpanel region (used by some implementations).
   * @returns The current access token (no `Bearer` prefix).
   */
  getBrowserToken: (name: string, region: Region) => Promise<string>;

  /**
   * Return the static bearer for an {@link OAuthTokenAccount}.
   *
   * @param account - The account whose `token` / `token_env` to resolve.
   * @returns The bearer token (no `Bearer` prefix).
   */
  getStaticToken: (account: OAuthTokenAccount) => Promise<string>;
}

/**
 * Basic-auth service account credentials (Python `ServiceAccount`).
 *
 * Long-lived credentials provisioned via the Mixpanel UI ("Service
 * Accounts" section). {@link accountAuthHeader} encodes
 * `username:secret` as base64 per the Mixpanel REST API spec.
 */
export interface ServiceAccount {
  /** Discriminator value for this variant. */
  readonly type: "service_account";
  /** Local config-side identifier — alphanumeric, `_`, `-` (1–64 chars). */
  readonly name: AccountName;
  /** Mixpanel data residency — one of `us`, `eu`, `in`. */
  readonly region: Region;
  /**
   * Account's home project (numeric string). Resolves the project axis
   * when no env / param / target / bridge source overrides it.
   */
  readonly default_project?: ProjectId | null | undefined;
  /** Service account username (e.g. `sa.demo`). */
  readonly username: string;
  /** Service account secret (a `Secret` wrapper — redacted everywhere). */
  readonly secret: Secret;
}

/**
 * OAuth account authenticated via PKCE browser flow (Python
 * `OAuthBrowserAccount`).
 *
 * The account itself carries no secret — tokens are persisted at
 * `~/.mp/accounts/{name}/tokens.json` and produced on demand by a
 * {@link TokenResolver}.
 */
export interface OAuthBrowserAccount {
  /** Discriminator value for this variant. */
  readonly type: "oauth_browser";
  /** Local config-side identifier — alphanumeric, `_`, `-` (1–64 chars). */
  readonly name: AccountName;
  /** Mixpanel data residency — one of `us`, `eu`, `in`. */
  readonly region: Region;
  /**
   * Account's home project (numeric string); populated post-PKCE via
   * `/me` for browser accounts.
   */
  readonly default_project?: ProjectId | null | undefined;
}

/**
 * OAuth account using a static bearer token (Python `OAuthTokenAccount`;
 * CI, agents, ephemeral runs).
 *
 * Exactly one of `token` (inline {@link Secret}) or `token_env` (env-var
 * name) must be provided — never both, never neither; enforced by
 * {@link parseAccount} exactly as Python's
 * `_validate_exactly_one_token_source` model validator does.
 */
export interface OAuthTokenAccount {
  /** Discriminator value for this variant. */
  readonly type: "oauth_token";
  /** Local config-side identifier — alphanumeric, `_`, `-` (1–64 chars). */
  readonly name: AccountName;
  /** Mixpanel data residency — one of `us`, `eu`, `in`. */
  readonly region: Region;
  /** Account's home project (numeric string). */
  readonly default_project?: ProjectId | null | undefined;
  /** Inline static bearer token (mutually exclusive with `token_env`). */
  readonly token?: Secret | null | undefined;
  /** Env-var name to read the bearer from at resolution time. */
  readonly token_env?: string | null | undefined;
}

/**
 * Discriminated union over the three account variants.
 *
 * Python's `Account = Annotated[..., Field(discriminator="type")]`; use
 * {@link parseAccount} to construct from a raw payload — it dispatches on
 * the `type` field exactly as Pydantic's `TypeAdapter(Account)` does.
 */
export type Account = ServiceAccount | OAuthBrowserAccount | OAuthTokenAccount;

/** Account `name` constraint: Python `pattern=r"^[a-zA-Z0-9_-]+$"`. */
const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * `default_project` constraint: Python `pattern=r"^\d+$"`. Pydantic v2
 * compiles patterns with the Rust `regex` crate, whose `\d` is
 * Unicode-aware — `\p{Nd}` is the faithful JS spelling (JS `\d` is
 * ASCII-only).
 */
const PROJECT_ID_PATTERN = /^\p{Nd}+$/u;

/**
 * Narrow a raw value to a plain (non-array) object usable as model input.
 *
 * @param raw - The candidate payload.
 * @param model - Model name for error messages.
 * @param options - Parse options carrying the boundary kind.
 * @returns The same value, typed as a string-keyed record.
 * @throws ParamValidationError | ResponseValidationError - When `raw` is
 *   not a plain object.
 */
export function requireRecord(
  raw: unknown,
  model: string,
  options: ParseAccountOptions,
): Readonly<Record<string, unknown>> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    parseFail(`${model} payload must be an object`, options, { model });
  }
  return raw as Readonly<Record<string, unknown>>;
}

/**
 * Reject unknown keys (Pydantic `extra='forbid'` parity).
 *
 * @param payload - The raw payload record.
 * @param known - The declared field names (discriminator included).
 * @param model - Model name for error messages.
 * @param options - Parse options carrying the boundary kind.
 * @throws ParamValidationError | ResponseValidationError - When any key
 *   outside `known` is present.
 */
export function forbidExtraKeys(
  payload: Readonly<Record<string, unknown>>,
  known: ReadonlySet<string>,
  model: string,
  options: ParseAccountOptions,
): void {
  const extra = Object.keys(payload)
    .filter((key) => !known.has(key))
    .sort();
  if (extra.length > 0) {
    parseFail(`${model} rejects unknown fields: ${extra.join(", ")}`, options, {
      model,
      extra_fields: extra,
    });
  }
}

/**
 * Validate the shared `_AccountBase` fields (`name`, `region`,
 * `default_project`).
 *
 * @param payload - The raw payload record (already extra-checked).
 * @param options - Parse options carrying the boundary kind.
 * @returns The validated base fields; `default_project` is present only
 *   when the key was present in the payload (absent and `null` are
 *   distinct).
 * @throws ParamValidationError | ResponseValidationError - On any
 *   constraint violation.
 */
function parseAccountBase(
  payload: Readonly<Record<string, unknown>>,
  options: ParseAccountOptions,
): {
  name: AccountName;
  region: Region;
  default_project?: ProjectId | null;
} {
  const name = payload["name"];
  if (typeof name !== "string") {
    parseFail("Account.name must be a string", options, { field: "name" });
  }
  // Codepoint-counted length (the pattern is ASCII-only, so the counts
  // coincide for valid names); length + pattern are one Pydantic error
  // boundary, so they share one guard.
  const codepointCount = cpLength(name);
  if (codepointCount < 1 || codepointCount > 64 || !NAME_PATTERN.test(name)) {
    parseFail(
      "Account.name must match ^[a-zA-Z0-9_-]+$ (1-64 characters)",
      options,
      { field: "name" },
    );
  }
  const region = payload["region"];
  if (
    typeof region !== "string" ||
    !(REGION_VALUES as readonly string[]).includes(region)
  ) {
    parseFail("Account.region must be one of us, eu, in", options, {
      field: "region",
    });
  }
  const base: {
    name: AccountName;
    region: Region;
    default_project?: ProjectId | null;
  } = { name, region: region as Region };
  if (Object.hasOwn(payload, "default_project")) {
    const project = payload["default_project"];
    if (project === null) {
      base.default_project = null;
    } else {
      if (typeof project !== "string" || !PROJECT_ID_PATTERN.test(project)) {
        parseFail(
          "Account.default_project must be a digits-only string",
          options,
          { field: "default_project" },
        );
      }
      base.default_project = project;
    }
  }
  return base;
}

/**
 * Read an optional secret-valued field (`Secret` instance passes through;
 * a raw string is wrapped, mirroring Pydantic's `str -> SecretStr`
 * coercion).
 *
 * @param payload - The raw payload record.
 * @param field - The field name.
 * @param options - Parse options carrying the boundary kind.
 * @returns The wrapped secret, `null` for an explicit null, or
 *   `undefined` when the key is absent.
 * @throws ParamValidationError | ResponseValidationError - When present
 *   but neither string nor `Secret` nor null.
 */
function readSecretField(
  payload: Readonly<Record<string, unknown>>,
  field: string,
  options: ParseAccountOptions,
): Secret | null | undefined {
  if (!Object.hasOwn(payload, field)) {
    return undefined;
  }
  const value = payload[field];
  if (value === null) {
    return null;
  }
  if (value instanceof Secret) {
    return value;
  }
  if (typeof value === "string") {
    return new Secret(value);
  }
  parseFail(`Account.${field} must be a secret string`, options, { field });
}

/** Declared field names per variant (discriminator included). */
const SERVICE_ACCOUNT_FIELDS: ReadonlySet<string> = new Set([
  "type",
  "name",
  "region",
  "default_project",
  "username",
  "secret",
]);

/** Declared field names for `oauth_browser` (discriminator included). */
const OAUTH_BROWSER_FIELDS: ReadonlySet<string> = new Set([
  "type",
  "name",
  "region",
  "default_project",
]);

/** Declared field names for `oauth_token` (discriminator included). */
const OAUTH_TOKEN_FIELDS: ReadonlySet<string> = new Set([
  "type",
  "name",
  "region",
  "default_project",
  "token",
  "token_env",
]);

/**
 * Construct an {@link Account} from a raw payload, replicating every
 * Pydantic invariant of the Python discriminated union.
 *
 * Checks applied (all failures use the generic boundary errors — no new
 * registry codes):
 *
 * - `type` discriminator present and one of the three variants;
 * - `extra='forbid'` per variant;
 * - `name` pattern/length, `region` membership, `default_project`
 *   digits-only;
 * - `ServiceAccount.username` non-empty, `secret` required;
 * - `OAuthTokenAccount` exactly-one-of `token` / `token_env`.
 *
 * Absent optional keys stay absent on the returned object; explicit JSON
 * `null` is preserved as `null` (the canonicalizer distinguishes them).
 *
 * @param raw - The raw payload (config block, bridge entry, vector value).
 * @param options - Error-boundary selection (defaults to `'response'`).
 * @returns The narrowed account variant.
 * @throws ParamValidationError - Any violation at the `'param'` boundary.
 * @throws ResponseValidationError - Any violation at the default
 *   `'response'` boundary.
 * @example
 * ```typescript
 * const account = parseAccount({
 *   type: "service_account",
 *   name: "team",
 *   region: "us",
 *   username: "sa.user",
 *   secret: "hunter2",
 * });
 * // account.type === "service_account"
 * ```
 * @see mixpanel_headless._internal.auth.account
 */
export function parseAccount(
  raw: unknown,
  options: ParseAccountOptions = {},
): Account {
  const payload = requireRecord(raw, "Account", options);
  const type = payload["type"];
  switch (type) {
    case "service_account": {
      forbidExtraKeys(
        payload,
        SERVICE_ACCOUNT_FIELDS,
        "ServiceAccount",
        options,
      );
      const base = parseAccountBase(payload, options);
      const username = payload["username"];
      if (typeof username !== "string" || username.length === 0) {
        parseFail(
          "ServiceAccount.username must be a non-empty string",
          options,
          { field: "username" },
        );
      }
      const secret = readSecretField(payload, "secret", options);
      if (secret === undefined || secret === null) {
        parseFail("ServiceAccount.secret is required", options, {
          field: "secret",
        });
      }
      return { type: "service_account", ...base, username, secret };
    }
    case "oauth_browser": {
      forbidExtraKeys(
        payload,
        OAUTH_BROWSER_FIELDS,
        "OAuthBrowserAccount",
        options,
      );
      const base = parseAccountBase(payload, options);
      return { type: "oauth_browser", ...base };
    }
    case "oauth_token": {
      forbidExtraKeys(
        payload,
        OAUTH_TOKEN_FIELDS,
        "OAuthTokenAccount",
        options,
      );
      const base = parseAccountBase(payload, options);
      const token = readSecretField(payload, "token", options);
      const tokenEnvRaw = Object.hasOwn(payload, "token_env")
        ? payload["token_env"]
        : undefined;
      if (
        tokenEnvRaw !== undefined &&
        tokenEnvRaw !== null &&
        typeof tokenEnvRaw !== "string"
      ) {
        parseFail("OAuthTokenAccount.token_env must be a string", options, {
          field: "token_env",
        });
      }
      // Python `_validate_exactly_one_token_source`: `is not None` on both
      // sides — absent and explicit null both count as "unset".
      const hasInline = token !== undefined && token !== null;
      const hasEnv = tokenEnvRaw !== undefined && tokenEnvRaw !== null;
      if (hasInline === hasEnv) {
        parseFail(
          "OAuthTokenAccount requires exactly one of `token` or `token_env`",
          options,
          { fields: ["token", "token_env"] },
        );
      }
      return {
        type: "oauth_token",
        ...base,
        ...(token === undefined ? {} : { token }),
        ...(tokenEnvRaw === undefined ? {} : { token_env: tokenEnvRaw }),
      };
    }
    default: {
      parseFail(
        "Account.type must be one of service_account, oauth_browser, oauth_token",
        options,
        { field: "type", allowed: ACCOUNT_TYPE_VALUES },
      );
    }
  }
}

/**
 * UTF-8 encode a string and render it as base64 (no `node:buffer` in
 * `core`; `btoa` is a global in every supported runtime).
 *
 * Exported so `auth/region-probe.ts` builds its Basic header over the
 * same encoder as {@link accountAuthHeader}: UTF-8 bytes then base64,
 * never `btoa` on raw UTF-16.
 *
 * @param text - The text to encode (Python `str.encode()` is UTF-8).
 * @returns The base64 rendering.
 */
export function base64EncodeUtf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/** Options bag for {@link accountAuthHeader}. */
export interface AccountAuthHeaderOptions {
  /**
   * Resolver for OAuth accounts. Ignored for `service_account` (signature
   * parity with Python); required for the two OAuth variants.
   */
  readonly tokenResolver?: TokenResolver | null | undefined;
}

/**
 * Return the `Authorization` header value for an account (the
 * per-variant `auth_header` methods as one free function — the
 * exhaustive switch lives here).
 *
 * Async because OAuth token resolution does I/O; the `service_account`
 * arm is synchronous work behind the same signature.
 *
 * @param account - The account to authenticate as.
 * @param options - Carries the {@link TokenResolver} for OAuth variants.
 * @returns The header value (`Basic ...` or `Bearer ...`).
 * @throws ParamTypeError - When an OAuth variant is given no resolver
 *   (Python raises `TypeError`; `ParamTypeError` is its coded twin —
 *   message text is out of contract).
 * @throws MixpanelHeadlessError - Never in practice: the `never` default
 *   arm guards against an un-narrowed 4th variant at runtime.
 * @example
 * ```typescript
 * const header = await accountAuthHeader(serviceAccount, {});
 * // "Basic c2EudXNlcjpodW50ZXIy"
 * ```
 * @see mixpanel_headless._internal.auth.account.ServiceAccount.auth_header
 */
export async function accountAuthHeader(
  account: Account,
  options: AccountAuthHeaderOptions = {},
): Promise<string> {
  const resolver = options.tokenResolver ?? null;
  switch (account.type) {
    case "service_account": {
      const raw = `${account.username}:${account.secret.reveal()}`;
      return `Basic ${base64EncodeUtf8(raw)}`;
    }
    case "oauth_browser": {
      if (resolver === null) {
        throw new ParamTypeError(
          "TokenResolver is required to compute auth_header for OAuth accounts",
        );
      }
      const token = await resolver.getBrowserToken(
        account.name,
        account.region,
      );
      return `Bearer ${token}`;
    }
    case "oauth_token": {
      if (resolver === null) {
        throw new ParamTypeError(
          "TokenResolver is required to compute auth_header for OAuth accounts",
        );
      }
      const token = await resolver.getStaticToken(account);
      return `Bearer ${token}`;
    }
    default: {
      const exhaustive: never = account;
      throw new MixpanelHeadlessError(
        `unreachable account variant: ${JSON.stringify(exhaustive)}`,
      );
    }
  }
}

/**
 * Whether the account survives across restarts without refresh (port of
 * the per-variant `is_long_lived` methods).
 *
 * @param account - The account to inspect.
 * @returns `true` for `service_account` (credentials never expire) and
 *   `oauth_browser` (refresh-token re-issuance); `false` for
 *   `oauth_token` (caller controls rotation, no refresh path).
 * @throws MixpanelHeadlessError - Never in practice (`never` default arm).
 * @see mixpanel_headless._internal.auth.account.ServiceAccount.is_long_lived
 */
export function isLongLived(account: Account): boolean {
  switch (account.type) {
    case "service_account": {
      return true;
    }
    case "oauth_browser": {
      return true;
    }
    case "oauth_token": {
      return false;
    }
    default: {
      const exhaustive: never = account;
      throw new MixpanelHeadlessError(
        `unreachable account variant: ${JSON.stringify(exhaustive)}`,
      );
    }
  }
}

export {
  ACCOUNT_TYPE_VALUES,
  type AccountType,
  type Region,
  REGION_VALUES,
} from "../types/literals.js";
