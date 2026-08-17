/**
 * Fetch-pure OAuth HTTP helpers — the B9-R2 core home of the
 * `node:*`-free halves of the B8 flow/DCR modules (b9-packets.md §3.1,
 * the second R10.8 ruling: hoist, don't duplicate — a browser copy
 * would have created second implementations of `flow.py:395-635` +
 * `client_registration.py:96-170` semantics in the one area with NO
 * second oracle). Node's `OAuthFlow` / `ensureClientRegistered`
 * delegate here (their B8 Layer-3 suites stay green UNCHANGED — the
 * zero-behavior-change proof); the browser redirect flow imports the
 * same names.
 *
 * Moved lines keep their `flow.py` / `client_registration.py`
 * citations. Transport runs over the injected `fetchImpl` through the
 * R2.10 adapter (`createRequestExecutor`); bodies parse via
 * `parseLossless` (GATE-R5 — never `response.json()`).
 *
 * HOIST NOTE (recorded in B9-R2-notes.md): the packet's pasted
 * `postTokenRequest` context omits a clock, but the moved body calls
 * `OAuthTokens.fromTokenResponse(data, { now })` (§7 caution 5: thread
 * the seam, never read the ambient clock in tests) — the options bag
 * therefore carries `now?` with the same `Date.now` default the node
 * class supplied. Mechanical parameterization, not a behavior change.
 */

import { MixpanelHttpError, isPlainRecord } from "../client/internals.js";
import { toNativeJson } from "../client/json-value.js";
import { parseLossless } from "../client/lossless-json.js";
import { createRequestExecutor, urlEncodePairs } from "../client/transport.js";
import { pythonStr } from "../compat/python-str.js";
import { MixpanelHeadlessError, OAuthError } from "../errors.js";
import { DEFAULT_SCOPE, OAUTH_BASE_URLS } from "./oauth-constants.js";
import {
  OAuthTokens,
  pythonUtcIsoformat,
  type OAuthClientInfo,
} from "./token.js";

/**
 * httpx default total timeout in seconds (`httpx.Client()` default —
 * the Python ctor builds a default client, `flow.py:168`). Not
 * vector-observable (R2.12 unit spelling kept).
 */
const DEFAULT_TIMEOUT_SECONDS = 5;

/**
 * Build the OAuth authorization URL with PKCE parameters (port of
 * `_build_authorize_url`, `flow.py:606-635` — lifted from the private
 * `OAuthFlow.#buildAuthorizeUrl` to a module-level pure function at
 * B9-R2; the class method is now a one-line delegate). Param order is
 * `urlencode` insertion order, locked: response_type, client_id,
 * redirect_uri, state, code_challenge, code_challenge_method.
 *
 * Scope is intentionally omitted — DCR creates apps with an empty
 * scope field, so the provider defaults to every scope
 * (`flow.py:624-626` comment ported; §3.3: omission is CONTRACT, and
 * the encoder is the core `urlEncodePairs` quote_plus twin — `~` stays
 * bare where `URLSearchParams` would percent-encode it, golden-locked
 * in `oauth-http.test.ts`).
 *
 * @param baseUrl - The region OAuth base URL (trailing slash).
 * @param args - client id / redirect URI / challenge / state.
 * @returns The full authorization URL.
 *
 * @example
 * ```typescript
 * const url = buildAuthorizeUrl(OAUTH_BASE_URLS["us"], {
 *   clientId: "cid",
 *   redirectUri: "https://app.example.com/cb",
 *   challenge: "chal",
 *   state: "st",
 * });
 * ```
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

/** Context bag of {@link postTokenRequest} (the Python kwonly params). */
export interface PostTokenRequestContext {
  /** Human-readable operation name for error messages. */
  readonly operation: string;
  /** OAuthError code to use on failure. */
  readonly errorCode: string;
  /** Optional account name embedded in recovery hints. */
  readonly accountName?: string | null | undefined;
  /**
   * Epoch-ms clock seam threaded into `fromTokenResponse` (§7 caution
   * 5 — see module header hoist note). Default ambient `Date.now`.
   */
  readonly now?: (() => number) | undefined;
}

/**
 * POST form data to the token endpoint and parse the response (port of
 * `_post_token_request`, `flow.py:500-605` — lifted from the private
 * `OAuthFlow.#postTokenRequest` at B9-R2; the class method delegates).
 * Shared by node refresh/exchange and the browser `completeLogin`.
 *
 * @param fetchImpl - The injected fetch (R2.4 seam).
 * @param baseUrl - The region OAuth base URL (trailing slash).
 * @param formData - Form-encoded body (insertion order preserved).
 * @param context - Operation name, error code, optional account/clock.
 * @returns Parsed tokens from the endpoint response.
 * @throws OAuthError - Every branch of the vector-locked classifier
 *   (transport failure, non-200 incl. the `invalid_grant`→
 *   `OAUTH_REFRESH_REVOKED` refresh-only mapping, non-JSON body,
 *   missing required fields).
 */
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
    header(name: string): string | null;
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
  } catch (exc) {
    if (!(exc instanceof MixpanelHttpError)) {
      throw exc;
    }
    // Transport failure (`flow.py:535-540`) — vector
    // `test_refresh_tokens_timeout` locks `details_contain.url`.
    throw new OAuthError(
      `${operation} request failed: ${exc.message}`,
      errorCode,
      { url: tokenUrl },
      { cause: exc },
    );
  }

  if (response.status !== 200) {
    // Distinguish a permanently dead refresh token from a transient
    // failure (`flow.py:542-585`). The probe runs ONLY for 400/401
    // and the REVOKED mapping additionally requires the refresh
    // operation (B8 caution 6: exchange keeps the generic code).
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
        // Revoked details ALWAYS carry account_name — null when not
        // supplied (`flow.py:570-575`; vector lock).
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
      // Generic shape spreads account_name only when supplied
      // (`flow.py:580-584`; B8 caution 5).
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
  } catch (exc) {
    throw new OAuthError(
      `${operation} returned non-JSON response: ` +
        `${response.header("content-type") ?? "unknown"}`,
      errorCode,
      { response_body: response.text },
      { cause: exc },
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
  } catch (exc) {
    if (!(exc instanceof MixpanelHeadlessError)) {
      throw exc;
    }
    throw new OAuthError(
      `${operation} response missing required fields: ${exc.message}`,
      errorCode,
      { response_data: pythonStr(data as never) },
      { cause: exc },
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
 * POST half of `ensure_client_registered`
 * (`client_registration.py:96-170`: region gate `:97-103`,
 * register-URL build `:104`, body `:106-112`, network-error branch
 * `:114-121`, 429 branch `:123-132`, non-success branch `:134-144`,
 * JSON/`client_id` parse `:146-157`, `OAuthClientInfo` assembly with
 * injected `now` `:159-165`). The cache read/write stays OUTSIDE this
 * hoist (b9-packets.md §3.1 row 6): node's `ensureClientRegistered`
 * keeps its `OAuthStorage` wrapper and delegates the POST here; the
 * browser caches via `CredentialStore`.
 *
 * @param fetchImpl - The injected fetch (R2.4 seam).
 * @param region - Mixpanel data residency region (`us`, `eu`, `in`).
 * @param redirectUri - The OAuth redirect URI to register.
 * @param options - Optional clock seam.
 * @returns The freshly registered client info (NOT persisted here).
 * @throws OAuthError - `OAUTH_REGISTRATION_ERROR` on unknown region,
 *   network failure, 429 rate limit, non-2xx status, or a malformed
 *   response body.
 *
 * @example
 * ```typescript
 * const info = await registerClient(fetch, "us",
 *   "https://app.example.com/cb");
 * // info.client_id
 * ```
 */
export async function registerClient(
  fetchImpl: typeof fetch,
  region: string,
  redirectUri: string,
  options: RegisterClientOptions = {},
): Promise<OAuthClientInfo> {
  // Register new client (`client_registration.py:96-104`).
  if (!Object.hasOwn(OAUTH_BASE_URLS, region)) {
    throw new OAuthError(
      `Unknown region: ${JSON.stringify(region)}. Must be one of: ` +
        `${Object.keys(OAUTH_BASE_URLS).sort().join(", ")}`,
      "OAUTH_REGISTRATION_ERROR",
    );
  }
  const baseUrl = OAUTH_BASE_URLS[region] as string;
  const registerUrl = `${baseUrl}mcp/register/`;

  // Body keys in Python dict insertion order
  // (`client_registration.py:106-112`).
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
    header(name: string): string | null;
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
  } catch (exc) {
    if (!(exc instanceof MixpanelHttpError)) {
      throw exc;
    }
    throw new OAuthError(
      `Client registration request failed: ${exc.message}`,
      "OAUTH_REGISTRATION_ERROR",
      { region, url: registerUrl },
      { cause: exc },
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

  // httpx `is_success` = 2xx (`client_registration.py:134-144`).
  if (response.status < 200 || response.status >= 300) {
    throw new OAuthError(
      `Client registration failed with status ${response.status}: ` +
        `${response.text}`,
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
    if (!isPlainRecord(data) || !("client_id" in data)) {
      // The `KeyError` / `TypeError` branch of `str(data["client_id"])`.
      throw new Error("'client_id'");
    }
    clientId = pythonStr(data["client_id"] as never);
  } catch (exc) {
    throw new OAuthError(
      `Invalid registration response: ` +
        `${exc instanceof Error ? exc.message : String(exc)}`,
      "OAUTH_REGISTRATION_ERROR",
      {
        region,
        response_body: response.text,
      },
      { cause: exc },
    );
  }

  const nowMs = options.now !== undefined ? options.now() : Date.now();
  return {
    client_id: clientId,
    region,
    redirect_uri: redirectUri,
    scope: DEFAULT_SCOPE,
    created_at: pythonUtcIsoformat(nowMs),
  };
}
