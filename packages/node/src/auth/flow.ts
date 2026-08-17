/**
 * OAuth 2.0 flow orchestrator — TS port of
 * `mixpanel_headless/_internal/auth/flow.py`, REFRESH HALF ONLY at
 * B8-N2 (b8-packets.md §3.1 row 2 / §0.2 mapping note): constructor +
 * region validation (`flow.py:118-179`), `get_valid_token`
 * (`flow.py:180-226`), `refresh_tokens` (`flow.py:442-499`) and
 * `_post_token_request` (`flow.py:500-605`). B8-N3 extends THIS file
 * with the interactive-login half (`login` / `exchange_code` /
 * `_parse_pasted_redirect` / `_build_authorize_url` /
 * `_find_available_port`).
 *
 * The 7 `oauth_flow.refresh_tokens` wire vectors lock the request
 * shape (form body in insertion order, `content-type:
 * application/x-www-form-urlencoded`), the error classifier branches,
 * and the Python-isoformat `expires_at` rendering (packet §3.2).
 *
 * Transport runs over the injected `fetchImpl` through the R2.10
 * adapter (`createRequestExecutor`) — transport failures surface as
 * `MixpanelHttpError` and are wrapped into coded `OAuthError`s here.
 * Response bodies are parsed via `parseLossless` (GATE-R5 — never
 * `response.json()`; the `pythonConstants` superset is the sanctioned
 * B0-1 F1 deviation, packet §7 caution 6).
 */

import {
  OAuthTokens,
  pythonUtcIsoformat,
} from "../../../core/src/auth/token.js";
import {
  MixpanelHttpError,
  isPlainRecord,
} from "../../../core/src/client/internals.js";
import { toNativeJson } from "../../../core/src/client/json-value.js";
import { parseLossless } from "../../../core/src/client/lossless-json.js";
import { createRequestExecutor } from "../../../core/src/client/transport.js";
import { MixpanelHeadlessError, OAuthError } from "../../../core/src/errors.js";
import { pythonStr } from "../../../core/src/compat/python-str.js";
import { OAUTH_BASE_URLS } from "./oauth-constants.js";
import { OAuthStorage } from "./storage.js";

/**
 * httpx default total timeout in seconds (`httpx.Client()` default —
 * the Python ctor builds a default client, `flow.py:168`). Not
 * vector-observable (R2.12 unit spelling kept).
 */
const DEFAULT_TIMEOUT_SECONDS = 5;

/** Options bag of {@link OAuthFlow} (`flow.py:137-169` kwargs). */
export interface OAuthFlowOptions {
  /** Mixpanel data residency region (default `"us"`). */
  readonly region?: string | undefined;
  /** Storage for cached tokens / client info (default: on-disk). */
  readonly storage?: OAuthStorage | undefined;
  /** Injected fetch (the `http_client` seam; default global fetch). */
  readonly fetchImpl?: typeof fetch | undefined;
  /**
   * Epoch-ms clock seam (packet §0.3.2 / D1.4) threaded into
   * `fromTokenResponse` and the `isExpired` checks. Default ambient.
   */
  readonly now?: (() => number) | undefined;
}

/** Kwonly options of {@link OAuthFlow.refreshTokens} (R3.8). */
export interface RefreshTokensOptions {
  /**
   * When supplied, embedded in error messages/details so the user
   * knows which `mp account login NAME` to re-run.
   */
  readonly accountName?: string | null | undefined;
}

/**
 * Orchestrator for the OAuth 2.0 Authorization Code + PKCE flow —
 * refresh surface (`OAuthFlow`, `flow.py:118-...`; login surface lands
 * at B8-N3).
 *
 * Example:
 * ```typescript
 * const flow = new OAuthFlow({ region: "us", storage, fetchImpl });
 * const fresh = await flow.refreshTokens(tokens, "my-client-id");
 * ```
 */
export class OAuthFlow {
  /** Validated region. */
  readonly #region: string;

  /** Token/client-info storage. */
  readonly #storage: OAuthStorage;

  /** Injected fetch. */
  readonly #fetchImpl: typeof fetch;

  /** Epoch-ms clock. */
  readonly #now: () => number;

  /** Region base URL (`OAUTH_BASE_URLS[region]`). */
  readonly #baseUrl: string;

  /**
   * Initialize the flow orchestrator (`flow.py:137-169`).
   *
   * @param options - Region + injected seams.
   * @throws OAuthError - `OAUTH_CONFIG_ERROR` for a region outside
   *   `OAUTH_BASE_URLS` (`flow.py:160-165`).
   */
  constructor(options: OAuthFlowOptions = {}) {
    const region = options.region ?? "us";
    if (!Object.hasOwn(OAUTH_BASE_URLS, region)) {
      throw new OAuthError(
        `Unknown region: ${JSON.stringify(region)}. Must be one of: ` +
          `${Object.keys(OAUTH_BASE_URLS).sort().join(", ")}`,
        "OAUTH_CONFIG_ERROR",
      );
    }
    this.#region = region;
    this.#storage = options.storage ?? new OAuthStorage();
    this.#fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.#now = options.now ?? Date.now;
    this.#baseUrl = OAUTH_BASE_URLS[region] as string;
  }

  /**
   * Mixpanel data residency region (`flow.py:171-178`).
   *
   * @returns The region string (`us`, `eu`, or `in`).
   */
  get region(): string {
    return this.#region;
  }

  /**
   * Return a valid access token, refreshing if expired (port of
   * `get_valid_token`, `flow.py:180-226`). Persists refreshed tokens
   * via the LEGACY v2 region path (`storage.save_tokens` — packet §3.2
   * item 7: two persistence worlds, not unified).
   *
   * @param region - Mixpanel region for the storage lookup.
   * @returns A valid OAuth access token string (no `Bearer` prefix).
   * @throws OAuthError - `OAUTH_TOKEN_ERROR` when no tokens exist;
   *   `OAUTH_REFRESH_ERROR` when client info is missing or the refresh
   *   fails; `OAUTH_REFRESH_REVOKED` on `invalid_grant`.
   */
  async getValidToken(region: string): Promise<string> {
    const tokens = this.#storage.loadTokens(region);
    if (tokens === null) {
      throw new OAuthError(
        "No OAuth tokens found. Please log in first with " +
          "`mp account login NAME`.",
        "OAUTH_TOKEN_ERROR",
      );
    }
    if (!tokens.isExpired({ now: this.#now })) {
      return tokens.access_token.reveal();
    }
    // Token is expired — refresh it.
    const clientInfo = this.#storage.loadClientInfo(region);
    if (clientInfo === null) {
      throw new OAuthError(
        "No OAuth client info found for refresh. " +
          "Please log in again with `mp account login NAME`.",
        "OAUTH_REFRESH_ERROR",
      );
    }
    const newTokens = await this.refreshTokens(tokens, clientInfo.client_id);
    this.#storage.saveTokens(newTokens, region);
    return newTokens.access_token.reveal();
  }

  /**
   * Refresh OAuth tokens using a refresh token (port of
   * `refresh_tokens`, `flow.py:442-499`).
   *
   * @param tokens - Current tokens carrying the refresh token.
   * @param clientId - The OAuth client ID.
   * @param options - Optional `accountName` for error messages.
   * @returns New tokens with a fresh access token.
   * @throws OAuthError - `OAUTH_REFRESH_ERROR` when no refresh token is
   *   available or the request fails transiently;
   *   `OAUTH_REFRESH_REVOKED` when the IdP rejects the token as
   *   `invalid_grant`.
   */
  async refreshTokens(
    tokens: OAuthTokens,
    clientId: string,
    options: RefreshTokensOptions = {},
  ): Promise<OAuthTokens> {
    const accountName = options.accountName ?? null;
    if (tokens.refresh_token === null) {
      const hint =
        accountName !== null && accountName !== ""
          ? `Run \`mp account login ${accountName}\`.`
          : "Run `mp account login NAME`.";
      throw new OAuthError(
        `Cannot refresh: no refresh token available. ${hint}`,
        "OAUTH_REFRESH_ERROR",
        // Two detail shapes, port verbatim (`flow.py:485`; caution 5).
        accountName !== null && accountName !== ""
          ? { account_name: accountName }
          : {},
      );
    }
    // Form body in Python dict INSERTION ORDER (packet §3.2 item 1;
    // vector `test_refresh_posts_correct_params` locks the body text).
    const formData: Record<string, string> = {
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token.reveal(),
      client_id: clientId,
    };
    return this.#postTokenRequest(formData, {
      operation: "Token refresh",
      errorCode: "OAUTH_REFRESH_ERROR",
      accountName,
    });
  }

  /**
   * POST form data to the token endpoint and parse the response (port
   * of `_post_token_request`, `flow.py:500-605` — shared by refresh
   * and, at N3, exchange).
   *
   * @param formData - Form-encoded body (insertion order preserved).
   * @param context - Operation name, error code, optional account.
   * @returns Parsed tokens from the endpoint response.
   * @throws OAuthError - Every branch of the vector-locked classifier
   *   (packet §3.2 items 3-5).
   */
  async #postTokenRequest(
    formData: Record<string, string>,
    context: {
      operation: string;
      errorCode: string;
      accountName: string | null;
    },
  ): Promise<OAuthTokens> {
    const { operation, errorCode, accountName } = context;
    const tokenUrl = `${this.#baseUrl}token/`;

    const execute = createRequestExecutor(this.#fetchImpl);
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
        formBody: formData,
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
      // operation (caution 6: exchange keeps the generic code).
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
        // (`flow.py:580-584`; caution 5).
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
      return OAuthTokens.fromTokenResponse(data, { now: this.#now });
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
}

/**
 * Re-export of the Python-isoformat renderer for the R10.9 harness and
 * the N3 login half (single mechanism — packet §0.3.2).
 */
export { pythonUtcIsoformat };
