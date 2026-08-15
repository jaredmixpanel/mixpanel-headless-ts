/**
 * OAuth token and client-info models — TS port of
 * `mixpanel_headless/_internal/auth/token.py` (phase2-design C4).
 *
 * `OAuthTokens` is in Phase-2 scope because `$type: "OAuthTokens"`
 * appears in the corpus (7 occurrences in `auth/test_auth_flow.jsonl`);
 * the codec entry lives in `types/vector-codecs.ts`. Datetimes are held
 * as ISO-8601 STRINGS (never `Date`) so the recorded `iso` text
 * round-trips byte-for-byte through the codec — exactly the reason the
 * runner's `PyDatetime` wrapper keeps the raw text.
 *
 * `token_payload_bytes` (the on-disk `tokens.json` serialization) is
 * node-side file-I/O plumbing and ships with Phase 3 B8 alongside
 * `BridgeFile`/`load_bridge` (C8 deferral table).
 */

import { coerceInt } from "../coerce.js";
import { ParamValidationError, ResponseValidationError } from "../errors.js";
import { Secret } from "../secret.js";
import { requireRecord, type ParseAccountOptions } from "./account.js";

/**
 * Matches a timezone suffix on an ISO-8601 datetime string: `Z`/`z` or a
 * `±HH:MM[:SS[.ffffff]]` offset (Python `isoformat()` emits `+HH:MM` /
 * `+HH:MM:SS`). A string WITHOUT this suffix is a naive datetime.
 */
const TZ_AWARE_SUFFIX = /(?:[Zz]|[+-]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/;

/**
 * Throw the boundary-appropriate parse error (R5.5 generic codes).
 *
 * @param message - Human-readable description (out of contract, R5.4).
 * @param options - Parse options carrying the boundary kind.
 * @param details - Optional structured error data.
 * @returns Never returns.
 * @throws ParamValidationError | ResponseValidationError - Always.
 */
function parseFail(
  message: string,
  options: ParseAccountOptions,
  details?: Readonly<Record<string, unknown>>,
): never {
  if (options.boundary === "param") {
    throw new ParamValidationError(message, "VALIDATION_ERROR", details);
  }
  throw new ResponseValidationError(
    message,
    "RESPONSE_VALIDATION_ERROR",
    details,
  );
}

/**
 * Reject naive `expires_at` values (port of Python's `_require_tz_aware`
 * field validator — Fix 25).
 *
 * @param iso - The candidate ISO-8601 datetime text.
 * @param options - Parse options carrying the boundary kind.
 * @returns The same string when timezone-aware.
 * @throws ParamValidationError | ResponseValidationError - When the text
 *   carries no timezone suffix (a naive datetime would compare unsafely
 *   against the aware clock and silently bypass the expiry check).
 */
function requireTzAware(iso: string, options: ParseAccountOptions): string {
  if (!TZ_AWARE_SUFFIX.test(iso)) {
    parseFail(
      "OAuthTokens.expires_at must be timezone-aware (UTC). Got a naive " +
        "datetime, which would compare unsafely against the aware clock " +
        "and silently bypass the expiry check.",
      options,
      { field: "expires_at" },
    );
  }
  return iso;
}

/** Constructor fields for {@link OAuthTokens}. */
export interface OAuthTokensFields {
  /** The OAuth access token. */
  readonly access_token: Secret;
  /** The OAuth refresh token, if provided. */
  readonly refresh_token?: Secret | null | undefined;
  /** Timezone-aware ISO-8601 expiry instant. */
  readonly expires_at: string;
  /** Space-separated list of granted scopes. */
  readonly scope: string;
  /** Token type, typically `"Bearer"`. */
  readonly token_type: string;
}

/**
 * Immutable OAuth 2.0 token set with expiry tracking (Python
 * `OAuthTokens`, a frozen Pydantic model — extras IGNORED at parse, no
 * runtime freeze per R4.6).
 *
 * A class (not an interface) so the codec sweep's anti-vacuity
 * `instanceof` probe has a real product to check (phase2-design C8a).
 *
 * Example:
 * ```typescript
 * const tokens = parseOAuthTokens({
 *   access_token: "abc",
 *   expires_at: "2026-01-15T11:00:00+00:00",
 *   scope: "projects analysis",
 *   token_type: "Bearer",
 * });
 * tokens.isExpired(); // true — 2026-01-15 is in the past
 * ```
 */
export class OAuthTokens {
  /** The OAuth access token (redacted in all serialized output, R4.6). */
  readonly access_token: Secret;

  /**
   * The OAuth refresh token, if provided (redacted). Python declares
   * `SecretStr | None = None` — the attribute always exists and is
   * `None` when absent, so the TS field normalizes to `null` (the codec
   * encodes ALL declared fields, `refresh_token: null` included, exactly
   * as Python's `_encode_common` does).
   */
  readonly refresh_token: Secret | null;

  /**
   * UTC expiry instant as timezone-aware ISO-8601 TEXT (Python holds a
   * `datetime`; the string form keeps the recorded `iso` byte-exact
   * through codec round-trips). Naive values are rejected at
   * construction, mirroring the Python field validator.
   */
  readonly expires_at: string;

  /** Space-separated list of granted scopes. */
  readonly scope: string;

  /** Token type, typically `"Bearer"`. */
  readonly token_type: string;

  /**
   * Construct a token set (validators fire exactly as Pydantic's do).
   *
   * @param fields - The declared field values; `refresh_token` may be
   *   omitted (normalizes to `null`, matching Python's `None` default).
   * @throws ParamValidationError | ResponseValidationError - When
   *   `expires_at` is naive (no timezone suffix).
   */
  constructor(fields: OAuthTokensFields) {
    this.access_token = fields.access_token;
    this.refresh_token = fields.refresh_token ?? null;
    this.expires_at = requireTzAware(fields.expires_at, {});
    this.scope = fields.scope;
    this.token_type = fields.token_type;
  }

  /**
   * Check whether the access token is expired or about to expire (port
   * of Python `is_expired`).
   *
   * Uses a 30-second safety buffer to avoid sending tokens that expire
   * during in-flight requests.
   *
   * @returns `true` if the token is expired or will expire within 30
   *   seconds of now.
   */
  isExpired(): boolean {
    return Date.now() + 30_000 >= Date.parse(this.expires_at);
  }

  /**
   * Create an {@link OAuthTokens} from a raw token-endpoint response
   * (port of Python `from_token_response`).
   *
   * Computes `expires_at` by adding `expires_in` seconds to the current
   * UTC time.
   *
   * TODO(port): Python renders `expires_at` via `datetime.isoformat()`
   * (`+00:00` offset, microseconds); this port emits
   * `Date.toISOString()` (`Z`, milliseconds). Both are tz-aware UTC and
   * nothing in Phase 2 locks the rendering — the B8 `oauth_flow` wire
   * vectors (Phase 3) pin it down.
   *
   * @param data - Raw JSON response from the token endpoint. Must carry
   *   `access_token`, `expires_in`, `scope`, and `token_type`; may carry
   *   `refresh_token`.
   * @returns A new token set.
   * @throws ParamValidationError - When required keys are missing or
   *   `expires_in` is not an integer (Python raises
   *   `KeyError`/`ValueError`; the coded twin is the closest TS analog —
   *   message text out of contract, R5.4).
   */
  static fromTokenResponse(
    data: Readonly<Record<string, unknown>>,
  ): OAuthTokens {
    for (const key of ["access_token", "expires_in", "token_type"]) {
      if (!Object.hasOwn(data, key)) {
        throw new ParamValidationError(
          `token response is missing required key ${JSON.stringify(key)}`,
          "VALIDATION_ERROR",
          { field: key },
        );
      }
    }
    const expiresIn = coerceInt(data["expires_in"], {
      kind: "param",
      field: "expires_in",
    });
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    const rawRefresh = data["refresh_token"];
    const refreshToken =
      rawRefresh === undefined || rawRefresh === null
        ? null
        : new Secret(String(rawRefresh));
    return new OAuthTokens({
      access_token: new Secret(String(data["access_token"])),
      refresh_token: refreshToken,
      expires_at: expiresAt,
      scope: String(data["scope"] ?? ""),
      token_type: String(data["token_type"]),
    });
  }
}

/**
 * Read a secret-valued field for the token parsers (accepts `Secret` or
 * raw string, mirroring Pydantic's `str -> SecretStr` coercion).
 *
 * @param value - The raw field value.
 * @param field - Field name for error details.
 * @param options - Parse options carrying the boundary kind.
 * @returns The wrapped secret.
 * @throws ParamValidationError | ResponseValidationError - When neither
 *   string nor `Secret`.
 */
function requireSecret(
  value: unknown,
  field: string,
  options: ParseAccountOptions,
): Secret {
  if (value instanceof Secret) {
    return value;
  }
  if (typeof value === "string") {
    return new Secret(value);
  }
  parseFail(`OAuthTokens.${field} must be a secret string`, options, {
    field,
  });
}

/**
 * Read a required string field for the token parsers.
 *
 * @param payload - The raw payload record.
 * @param model - Model name for error messages.
 * @param field - Field name.
 * @param options - Parse options carrying the boundary kind.
 * @returns The string value.
 * @throws ParamValidationError | ResponseValidationError - When absent
 *   or not a string.
 */
function requireString(
  payload: Readonly<Record<string, unknown>>,
  model: string,
  field: string,
  options: ParseAccountOptions,
): string {
  const value = payload[field];
  if (typeof value !== "string") {
    parseFail(`${model}.${field} must be a string`, options, { field });
  }
  return value;
}

/**
 * Construct an {@link OAuthTokens} from a raw payload (Pydantic parity:
 * frozen model, extras IGNORED; the tz-aware validator fires).
 *
 * @param raw - The raw payload (`access_token`/`refresh_token` as string
 *   or `Secret`; `expires_at` as ISO-8601 text).
 * @param options - Error-boundary selection (defaults to `'response'`).
 * @returns The parsed token set.
 * @throws ParamValidationError | ResponseValidationError - On missing /
 *   malformed fields or a naive `expires_at`.
 */
export function parseOAuthTokens(
  raw: unknown,
  options: ParseAccountOptions = {},
): OAuthTokens {
  const payload = requireRecord(raw, "OAuthTokens", options);
  const accessToken = requireSecret(
    payload["access_token"],
    "access_token",
    options,
  );
  const rawRefresh = payload["refresh_token"];
  const refreshToken =
    rawRefresh === undefined || rawRefresh === null
      ? null
      : requireSecret(rawRefresh, "refresh_token", options);
  const expiresAt = requireTzAware(
    requireString(payload, "OAuthTokens", "expires_at", options),
    options,
  );
  return new OAuthTokens({
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: expiresAt,
    scope: requireString(payload, "OAuthTokens", "scope", options),
    token_type: requireString(payload, "OAuthTokens", "token_type", options),
  });
}

/**
 * Immutable OAuth client registration metadata (Python
 * `OAuthClientInfo`; Dynamic Client Registration, RFC 7591).
 *
 * Note: `region` is a plain `string` in Python (NOT the `Region`
 * literal) — preserved as-is.
 */
export interface OAuthClientInfo {
  /** The OAuth client identifier. */
  readonly client_id: string;
  /** Mixpanel data residency region (`us`, `eu`, or `in`). */
  readonly region: string;
  /** The redirect URI registered with the authorization server. */
  readonly redirect_uri: string;
  /** Space-separated list of requested scopes. */
  readonly scope: string;
  /**
   * Registration instant as ISO-8601 text (Python holds a `datetime`
   * with NO tz-aware validator — naive values are accepted here too).
   */
  readonly created_at: string;
}

/**
 * Construct an {@link OAuthClientInfo} from a raw payload (Pydantic
 * parity: frozen model, extras IGNORED, no field validators).
 *
 * @param raw - The raw payload.
 * @param options - Error-boundary selection (defaults to `'response'`).
 * @returns The parsed client info.
 * @throws ParamValidationError | ResponseValidationError - On missing /
 *   non-string fields.
 */
export function parseOAuthClientInfo(
  raw: unknown,
  options: ParseAccountOptions = {},
): OAuthClientInfo {
  const payload = requireRecord(raw, "OAuthClientInfo", options);
  return {
    client_id: requireString(payload, "OAuthClientInfo", "client_id", options),
    region: requireString(payload, "OAuthClientInfo", "region", options),
    redirect_uri: requireString(
      payload,
      "OAuthClientInfo",
      "redirect_uri",
      options,
    ),
    scope: requireString(payload, "OAuthClientInfo", "scope", options),
    created_at: requireString(
      payload,
      "OAuthClientInfo",
      "created_at",
      options,
    ),
  };
}
