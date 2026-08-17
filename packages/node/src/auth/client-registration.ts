/**
 * Dynamic Client Registration for Mixpanel OAuth — TS port of
 * `mixpanel_headless/_internal/auth/client_registration.py` (whole
 * file, b8-packets.md §4.1 row 2).
 *
 * Implements RFC 7591 DCR to obtain a `client_id` from the Mixpanel
 * authorization server. Registrations are cached per-region via
 * {@link OAuthStorage} (`~/.mp/oauth/client_{region}.json`, 0o600 —
 * THE DCR persistence duty) to avoid redundant network calls; the
 * cached fast path performs ZERO fetches.
 *
 * `OAUTH_BASE_URLS` is imported from N2's `oauth-constants.ts` — the
 * constant's Python home is THIS module (`client_registration.py:39-44`)
 * but the TS home moved so the N2 refresh half never depends on this
 * N3 module (packet §3.1 row 2 home note).
 *
 * Transport runs over the injected `fetchImpl` through the R2.10
 * adapter (`createRequestExecutor`); bodies parse via `parseLossless`
 * (GATE-R5 — never `response.json()`).
 */

import { pythonUtcIsoformat } from "../../../core/src/auth/token.js";
import type { OAuthClientInfo } from "../../../core/src/auth/token.js";
import {
  MixpanelHttpError,
  isPlainRecord,
} from "../../../core/src/client/internals.js";
import { toNativeJson } from "../../../core/src/client/json-value.js";
import { parseLossless } from "../../../core/src/client/lossless-json.js";
import { createRequestExecutor } from "../../../core/src/client/transport.js";
import { pythonStr } from "../../../core/src/compat/python-str.js";
import { OAuthError } from "../../../core/src/errors.js";
import { OAUTH_BASE_URLS } from "./oauth-constants.js";
import type { OAuthStorage } from "./storage.js";

/**
 * httpx default total timeout in seconds (the Python caller threads
 * its own `httpx.Client`; the N2 flow default is mirrored here — not
 * vector-observable, R2.12 unit spelling kept).
 */
const DEFAULT_TIMEOUT_SECONDS = 5;

/**
 * Scopes sent in the DCR request body for server-side validation
 * (`_DEFAULT_SCOPE`, `client_registration.py:46-52`). Advisory only —
 * DCR does NOT store these on the application model; the created app
 * has an empty scope field, meaning all scopes are allowed.
 */
export const DEFAULT_SCOPE: string =
  "projects analysis events insights segmentation retention " +
  "data:read funnels flows data_definitions dashboard_reports bookmarks";

/** Options bag of {@link ensureClientRegistered} (the Python params). */
export interface EnsureClientRegisteredOptions {
  /** Injected fetch (the `http_client` seam). */
  readonly fetchImpl: typeof fetch;
  /** Mixpanel data residency region (`us`, `eu`, or `in`). */
  readonly region: string;
  /** The OAuth redirect URI to register. */
  readonly redirectUri: string;
  /** Storage for caching client info. */
  readonly storage: OAuthStorage;
  /**
   * Epoch-ms clock for the `created_at` stamp (Python reads the
   * ambient `datetime.now(timezone.utc)`; the optional seam only adds
   * determinism for tests/harness — default ambient).
   */
  readonly now?: (() => number) | undefined;
}

/**
 * Ensure a Dynamic Client Registration exists for the given region
 * (port of `ensure_client_registered`, `client_registration.py:54-170`).
 *
 * Checks the local cache first (BEFORE region validation — Python
 * order); a cached client with a matching `redirect_uri` returns
 * immediately with zero fetches. Otherwise POSTs to the Mixpanel
 * `mcp/register/` endpoint and persists the result BEFORE returning
 * (a crash between register and persist re-registers next time —
 * ported, not "improved"; packet §4.2).
 *
 * @param options - fetch + region + redirect URI + storage.
 * @returns The registered (or cached) client info.
 * @throws OAuthError - `OAUTH_REGISTRATION_ERROR` on unknown region,
 *   network failure, 429 rate limit, non-2xx status, or a malformed
 *   response body.
 *
 * @example
 * ```typescript
 * const info = await ensureClientRegistered({
 *   fetchImpl: fetch,
 *   region: "us",
 *   redirectUri: "http://localhost:19284/callback",
 *   storage: new OAuthStorage(),
 * });
 * // info.client_id
 * ```
 */
export async function ensureClientRegistered(
  options: EnsureClientRegisteredOptions,
): Promise<OAuthClientInfo> {
  const { region, redirectUri, storage } = options;

  // Check cache (`client_registration.py:91-94`).
  const cached = storage.loadClientInfo(region);
  if (cached !== null && cached.redirect_uri === redirectUri) {
    return cached;
  }

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

  const execute = createRequestExecutor(options.fetchImpl);
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
  const clientInfo: OAuthClientInfo = {
    client_id: clientId,
    region,
    redirect_uri: redirectUri,
    scope: DEFAULT_SCOPE,
    created_at: pythonUtcIsoformat(nowMs),
  };

  // Cache for future use — persist BEFORE returning.
  storage.saveClientInfo(clientInfo);

  return clientInfo;
}
