/**
 * Fetch-pure OAuth HTTP: the authorize-URL builder, the token-endpoint
 * POST with its error classifier and payload redaction, and the Dynamic
 * Client Registration POST. Node's `OAuthFlow` / `ensureClientRegistered`
 * and the browser redirect flow all delegate here so the token-endpoint
 * semantics exist once. Transport runs over an injected `fetchImpl`
 * through `createRequestExecutor`; bodies parse via `parseLossless`,
 * never `response.json()`. Caching of registrations stays with the
 * callers (`OAuthStorage` on Node, `CredentialStore` in the browser).
 *
 * @see mixpanel_headless._internal.auth.flow.OAuthFlow
 * @see mixpanel_headless._internal.auth.client_registration.ensure_client_registered
 */

import { isPlainRecord, MixpanelHttpError } from "../client/internals.js";
import { toNativeJson } from "../client/json-value.js";
import { parseLossless } from "../client/lossless-json.js";
import { createRequestExecutor, urlEncodePairs } from "../client/transport.js";
import { cpLength } from "../compat/codepoint.js";
import { isPythonValue, pythonStr } from "../compat/python-str.js";
import { MixpanelHeadlessError, OAuthError } from "../errors.js";
import { exceptionMessage } from "../invariant.js";
import { DEFAULT_SCOPE, OAUTH_BASE_URLS } from "./oauth-constants.js";
import {
  type OAuthClientInfo,
  OAuthTokens,
  pythonUtcIsoformat,
} from "./token.js";

/**
 * httpx default total timeout in seconds (the Python constructor builds
 * a default `httpx.Client()`). Not corpus-observable.
 */
const DEFAULT_TIMEOUT_SECONDS = 5;

/**
 * Token-endpoint response keys whose values are structurally non-secret
 * RFC 6749 §5.1 metadata. Only these survive redaction (and only when
 * the value is a primitive); every other value in a malformed 200 token
 * payload is replaced with `"<redacted>"`, whatever its key. An
 * allow-list rather than a deny-list because a deny-list over canonical
 * token keys leaks nested envelopes, list values, non-canonical
 * credential keys (`client_secret`) and case-variant keys
 * (`Access_Token`). Twin of `_SAFE_TOKEN_DETAIL_KEYS`.
 *
 * @see mixpanel_headless._internal.auth.flow
 */
const SAFE_TOKEN_DETAIL_KEYS: ReadonlySet<string> = new Set([
  "token_type",
  "expires_in",
  "scope",
  "error",
  "error_description",
]);

/**
 * Rendering for non-object 200 JSON token bodies in error details: the
 * value itself can be the credential (an IdP returning the bare token
 * as a JSON string), so it never renders verbatim. Byte-identical to
 * the Python constant.
 */
const NON_OBJECT_BODY_PLACEHOLDER = "<redacted non-object body>";

/**
 * Render a malformed 200 token payload safely for OAuthError details.
 * Every field name stays visible for diagnosis, but only the values of
 * {@link SAFE_TOKEN_DETAIL_KEYS} survive — and only when they are
 * primitives. Every other value renders as `"<redacted>"` regardless of
 * nesting, and a non-object body renders as
 * {@link NON_OBJECT_BODY_PLACEHOLDER}, so no value channel can carry
 * bearer material into serialized error details.
 *
 * @param data - The parsed 200 token-endpoint JSON body (any value).
 * @returns The `pythonStr` rendering of the redacted mapping
 *   (byte-matching the Python twin's `str()`), or the fixed
 *   placeholder for non-object bodies.
 * @see mixpanel_headless._internal.auth.flow._redact_token_payload
 */
function redactTokenPayload(data: unknown): string {
  if (!isPlainRecord(data)) {
    return NON_OBJECT_BODY_PLACEHOLDER;
  }
  return pythonStr(
    Object.fromEntries(
      Object.entries(data).map(([k, v]) => [
        k,
        SAFE_TOKEN_DETAIL_KEYS.has(k) &&
        (v === null ||
          typeof v === "string" ||
          typeof v === "number" ||
          typeof v === "bigint" ||
          typeof v === "boolean")
          ? v
          : "<redacted>",
      ]),
    ),
  );
}

/**
 * Build the OAuth authorization URL with PKCE parameters. Param order is
 * `urlencode` insertion order, locked: response_type, client_id,
 * redirect_uri, state, code_challenge, code_challenge_method.
 *
 * Scope is intentionally omitted — DCR creates apps with an empty scope
 * field, so the provider defaults to every scope; the omission is part
 * of the contract. The encoder is the `quote_plus` twin
 * `urlEncodePairs`: `~` stays bare where `URLSearchParams` would
 * percent-encode it.
 *
 * @param baseUrl - The region OAuth base URL (trailing slash).
 * @param args - client id / redirect URI / challenge / state.
 * @returns The full authorization URL.
 * @example
 * ```typescript
 * const url = buildAuthorizeUrl(OAUTH_BASE_URLS["us"], {
 *   clientId: "cid",
 *   redirectUri: "https://app.example.com/cb",
 *   challenge: "chal",
 *   state: "st",
 * });
 * ```
 * @see mixpanel_headless._internal.auth.flow.OAuthFlow._build_authorize_url
 */
export function buildAuthorizeUrl(
  baseUrl: string,
  args: {
    readonly clientId: string;
    readonly redirectUri: string;
    readonly challenge: string;
    readonly state: string;
  },
): string {
  const params: Record<string, string> = {
    response_type: "code",
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    state: args.state,
    code_challenge: args.challenge,
    code_challenge_method: "S256",
  };
  return `${baseUrl}authorize/?${urlEncodePairs(params)}`;
}

/** Context bag of {@link postTokenRequest} (the Python keyword-only parameters). */
export interface PostTokenRequestContext {
  /** Human-readable operation name for error messages. */
  readonly operation: string;
  /** OAuthError code to use on failure. */
  readonly errorCode: string;
  /** Optional account name embedded in recovery hints. */
  readonly accountName?: string | null | undefined;
  /**
   * Epoch-ms clock seam threaded into `fromTokenResponse` so tests and
   * the conformance binding never read the ambient clock. Default
   * `Date.now`.
   */
  readonly now?: (() => number) | undefined;
}

/**
 * POST form data to the token endpoint and parse the response. Shared by
 * the Node refresh/exchange paths and the browser `completeLogin`.
 *
 * @remarks
 * A 200 token-endpoint body may be the live token payload even when it
 * is malformed, so no 200-branch error path embeds it (the browser
 * exchange path in particular may ship error details to telemetry):
 *
 * - JSON-object body failing `OAuthTokens.fromTokenResponse`:
 *   `details.response_data` keeps every field name but only the
 *   primitive values of the safe RFC 6749 metadata keys
 *   ({@link SAFE_TOKEN_DETAIL_KEYS}); every other value — any key, any
 *   nesting — renders as `"<redacted>"`.
 * - Non-object JSON body: fixed `"<redacted non-object body>"`
 *   placeholder — the value itself can be the credential.
 * - Body that fails JSON parsing (truncated / proxy-mangled token
 *   JSON): never embedded; only `content_type` and `body_length`
 *   (code points) survive.
 *
 * Non-200 branches still embed the raw error body in
 * `details.response_body` — those are IdP error documents, not token
 * grants, and their shapes are corpus-locked.
 * @param fetchImpl - The injected fetch.
 * @param baseUrl - The region OAuth base URL (trailing slash).
 * @param formData - Form-encoded body (insertion order preserved).
 * @param context - Operation name, error code, optional account/clock.
 * @returns Parsed tokens from the endpoint response.
 * @throws OAuthError - Every branch of the corpus-locked classifier
 *   (transport failure, non-200 incl. the `invalid_grant`→
 *   `OAUTH_REFRESH_REVOKED` refresh-only mapping, non-JSON body,
 *   missing required fields).
 * @see mixpanel_headless._internal.auth.flow.OAuthFlow._post_token_request
 */
// eslint-disable-next-line complexity -- branch-for-branch port of one Python function (see the docblock); splitting it would scatter the guard order the corpus pins
export async function postTokenRequest(
  fetchImpl: typeof fetch,
  baseUrl: string,
  formData: Readonly<Record<string, string>>,
  context: PostTokenRequestContext,
): Promise<OAuthTokens> {
  const { operation, errorCode } = context;
  const accountName = context.accountName ?? null;
  const now = context.now ?? Date.now;
  const tokenUrl = `${baseUrl}token/`;

  const execute = createRequestExecutor(fetchImpl);
  let response: {
    status: number;
    text: string;
    header: (name: string) => string | null;
  };
  try {
    response = await execute({
      method: "POST",
      url: tokenUrl,
      params: {},
      jsonBody: null,
      formBody: { ...formData },
      headers: {},
      timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    });
  } catch (error) {
    if (!(error instanceof MixpanelHttpError)) {
      throw error;
    }
    // Transport failure — the corpus locks `details.url`.
    throw new OAuthError(
      `${operation} request failed: ${error.message}`,
      errorCode,
      { url: tokenUrl },
      { cause: error },
    );
  }

  if (response.status !== 200) {
    // Distinguish a permanently dead refresh token from a transient
    // failure. The `invalid_grant` probe runs only for 400/401, and the
    // revoked mapping additionally requires the refresh operation (a
    // code exchange keeps the generic code).
    let invalidGrant = false;
    if (response.status === 400 || response.status === 401) {
      try {
        const payload = toNativeJson(parseLossless(response.text));
        invalidGrant =
          isPlainRecord(payload) && payload["error"] === "invalid_grant";
      } catch {
        invalidGrant = false;
      }
    }
    if (invalidGrant && operation === "Token refresh") {
      const hint =
        accountName !== null && accountName !== ""
          ? `Re-run \`mp account login ${accountName}\`.`
          : "Re-run `mp account login NAME`.";
      const forAccount =
        accountName !== null && accountName !== ""
          ? ` for account '${accountName}'`
          : "";
      throw new OAuthError(
        `Refresh token has been revoked or expired${forAccount}. ${hint}`,
        "OAUTH_REFRESH_REVOKED",
        // Revoked details always carry account_name — null when not
        // supplied (corpus-locked shape).
        {
          status_code: response.status,
          response_body: response.text,
          account_name: accountName,
        },
      );
    }
    throw new OAuthError(
      `${operation} failed with status ${response.status}: ${response.text}`,
      errorCode,
      // Generic shape spreads account_name only when supplied.
      {
        status_code: response.status,
        response_body: response.text,
        ...(accountName !== null && accountName !== ""
          ? { account_name: accountName }
          : {}),
      },
    );
  }

  let data: unknown;
  try {
    data = toNativeJson(parseLossless(response.text));
  } catch (error) {
    // Never embed the body: a 200 that fails JSON parsing can still be
    // the token payload (truncated JSON, trailing proxy garbage).
    // body_length counts code points, matching Python's
    // `len(response.text)`.
    throw new OAuthError(
      `${operation} returned non-JSON response: ${
        response.header("content-type") ?? "unknown"
      }`,
      errorCode,
      {
        content_type: response.header("content-type") ?? "unknown",
        body_length: cpLength(response.text),
      },
      { cause: error },
    );
  }

  try {
    if (!isPlainRecord(data)) {
      throw new MixpanelHeadlessError(
        "token response is not an object",
        "VALIDATION_ERROR",
      );
    }
    return OAuthTokens.fromTokenResponse(data, { now });
  } catch (error) {
    if (!(error instanceof MixpanelHeadlessError)) {
      throw error;
    }
    // Redact before embedding: `data` is a live (if malformed) token
    // payload — see the remarks on this function. `redactTokenPayload`
    // renders the non-record edge as a placeholder (both languages raise
    // the coded OAuthError) and allow-list-redacts object bodies.
    throw new OAuthError(
      `${operation} response missing required fields: ${error.message}`,
      errorCode,
      { response_data: redactTokenPayload(data) },
      { cause: error },
    );
  }
}

/** Options bag of {@link registerClient}. */
export interface RegisterClientOptions {
  /**
   * Epoch-ms clock for the `created_at` stamp (Python reads the
   * ambient `datetime.now(timezone.utc)`; the optional seam only adds
   * determinism for tests/harness — default ambient).
   */
  readonly now?: (() => number) | undefined;
}

/**
 * Register a new OAuth client via Dynamic Client Registration — the
 * POST half of `ensure_client_registered`: region gate, request body,
 * network-error / 429 / non-2xx branches, `client_id` parse and
 * `OAuthClientInfo` assembly. The cache read/write stays with the
 * callers: Node's `ensureClientRegistered` wraps this in `OAuthStorage`,
 * the browser caches via `CredentialStore`.
 *
 * @param fetchImpl - The injected fetch.
 * @param region - Mixpanel data residency region (`us`, `eu`, `in`).
 * @param redirectUri - The OAuth redirect URI to register.
 * @param options - Optional clock seam.
 * @returns The freshly registered client info (not persisted here).
 * @throws OAuthError - `OAUTH_REGISTRATION_ERROR` on unknown region,
 *   network failure, 429 rate limit, non-2xx status, or a malformed
 *   response body.
 * @example
 * ```typescript
 * const info = await registerClient(fetch, "us",
 *   "https://app.example.com/cb");
 * // info.client_id
 * ```
 * @see mixpanel_headless._internal.auth.client_registration.ensure_client_registered
 */
export async function registerClient(
  fetchImpl: typeof fetch,
  region: string,
  redirectUri: string,
  options: RegisterClientOptions = {},
): Promise<OAuthClientInfo> {
  if (!Object.hasOwn(OAUTH_BASE_URLS, region)) {
    throw new OAuthError(
      `Unknown region: ${JSON.stringify(region)}. Must be one of: ${Object.keys(
        OAUTH_BASE_URLS,
      )
        .sort()
        .join(", ")}`,
      "OAUTH_REGISTRATION_ERROR",
    );
  }
  const baseUrl = OAUTH_BASE_URLS[region] as string;
  const registerUrl = `${baseUrl}mcp/register/`;

  // Body keys in Python dict insertion order.
  const body: Record<string, unknown> = {
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: DEFAULT_SCOPE,
  };

  const execute = createRequestExecutor(fetchImpl);
  let response: {
    status: number;
    text: string;
    header: (name: string) => string | null;
  };
  try {
    response = await execute({
      method: "POST",
      url: registerUrl,
      params: {},
      jsonBody: body,
      formBody: null,
      headers: {},
      timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    });
  } catch (error) {
    if (!(error instanceof MixpanelHttpError)) {
      throw error;
    }
    throw new OAuthError(
      `Client registration request failed: ${error.message}`,
      "OAUTH_REGISTRATION_ERROR",
      { region, url: registerUrl },
      { cause: error },
    );
  }

  if (response.status === 429) {
    throw new OAuthError(
      "Client registration rate limited. Please try again later.",
      "OAUTH_REGISTRATION_ERROR",
      {
        region,
        status_code: 429,
        retry_after: response.header("Retry-After"),
      },
    );
  }

  // httpx `is_success` = 2xx.
  if (response.status < 200 || response.status >= 300) {
    throw new OAuthError(
      `Client registration failed with status ${response.status}: ${
        response.text
      }`,
      "OAUTH_REGISTRATION_ERROR",
      {
        region,
        status_code: response.status,
        response_body: response.text,
      },
    );
  }

  let clientId: string;
  try {
    const data = toNativeJson(parseLossless(response.text));
    const rawClientId = isPlainRecord(data) ? data["client_id"] : undefined;
    if (rawClientId === undefined || !isPythonValue(rawClientId)) {
      // The `KeyError` / `TypeError` branch of `str(data["client_id"])`
      // (native JSON is always a PythonValue; the guard types the read).
      throw new Error("'client_id'");
    }
    clientId = pythonStr(rawClientId);
  } catch (error) {
    throw new OAuthError(
      `Invalid registration response: ${exceptionMessage(error)}`,
      "OAUTH_REGISTRATION_ERROR",
      {
        region,
        response_body: response.text,
      },
      { cause: error },
    );
  }

  const nowMs = options.now === undefined ? Date.now() : options.now();
  return {
    client_id: clientId,
    region,
    redirect_uri: redirectUri,
    scope: DEFAULT_SCOPE,
    created_at: pythonUtcIsoformat(nowMs),
  };
}
