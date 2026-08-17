/**
 * Redirect-based PKCE login flow for browsers — the adaptation of
 * `OAuthFlow.login` (`flow.py:227-393`) to a page-leaving redirect
 * (b9-packets.md §3.2; contract arbiters: `flow.py` for every twinned
 * behavior, R9.3 / plan §4.3 for the redirect-shape adaptation). The
 * redirect LEAVES the page, so login splits into
 * {@link beginLogin} / {@link completeLogin}. No callback server, no
 * paste fallback, no `webbrowser` — the Python steps map as follows
 * (the §3.2 table, verbatim):
 *
 * | Python `login()` step | Browser twin |
 * |---|---|
 * | PKCE + state generation (`flow.py:268-270`: `PkceChallenge.generate()`, `state = secrets.token_urlsafe(32)`) | `await PkceChallenge.generate()` (core) + `state` = 32 random bytes via `crypto.getRandomValues`, base64url-no-pad (43 chars — same alphabet/length as `token_urlsafe(32)`) |
 * | port probe + `redirect_uri = http://localhost:{port}/callback` | caller-supplied `redirectUri` (the app's own https URL) — REQUIRED option, no default |
 * | DCR `ensure_client_registered` | `ensureBrowserClientRegistered` = core `registerClient` + `CredentialStore` caching (cache-hit rule identical to Python) |
 * | `_build_authorize_url` | core `buildAuthorizeUrl` (§3.1 hoist) — byte-identical output |
 * | callback wait / paste race | `completeLogin(returnUrl)` on the return page |
 * | `exchange_code` | `completeLogin` step 4 via core `postTokenRequest` with the verbatim form fields (`flow.py:428-434`) |
 * | persist via `OAuthStorage` when `persist=True` | ALWAYS persists via the injected `CredentialStore` (in-memory default = no durable persistence unless the caller opts into the localStorage adapter — R9.3 posture) |
 *
 * The pending-login record (JSON under
 * `CREDENTIAL_KEYS.pendingLogin(region)`) is `{state, verifier,
 * client_id, redirect_uri, created_at}` — it substitutes for Python's
 * in-process locals (`flow.py:268-306`); `created_at` renders through
 * the R11.9 tokens-twin formatter (`+00:00`). The key set is fixed and
 * non-numeric with no ordering contract (§7 caution 7).
 *
 * Code reuse (§3.2 note): `OAUTH_PASTE_ERROR` is reused VERBATIM for
 * malformed return URLs — same semantic (an out-of-band-returned
 * redirect URL fails to parse); the name's CLI origin is historical.
 * Only genuinely twin-less branches get browser-local codes
 * (`BROWSER_NO_PENDING_LOGIN`).
 *
 * SA note (§2.3 row 5): these functions take no `Account` at all —
 * state/verifier/client-info only — so service-account ingress is
 * compile-time excluded here.
 *
 * Refresh note (§2.2 disposition / §3.4): browser v1 has NO refresh
 * surface (`flow.py:442-498` stays node-only); the Phase-4 ledger row
 * 8 tracks the D2-ACCEPTED follow-on.
 *
 * D2 spike outcome (b9-packets.md §4.3: **ACCEPTED**): PKCE-in-browser
 * ships ENABLED — DCR accepts third-party https redirect URIs (verified
 * 2026-08-16, live `mcp/register/` 201 for
 * `https://spike-b9.example.com/oauth/callback`); end-to-end browser
 * consent/exchange verified in Phase-4 live burn-in. Residual gap
 * (§4.5, unverified without a real browser session): authorize-time
 * `redirect_uri_allowed` enforcement for the registered third-party
 * URI, consent-screen code issuance to that redirect, and the token
 * endpoint's cross-origin CORS posture. Nothing here claims e2e
 * verification. Evidence of record:
 * `context/phase3/notes/B9-spike.md` (Python repo).
 */

import {
  CREDENTIAL_KEYS,
  type CredentialStore,
} from "../../core/src/auth/credential-store.js";
import { OAUTH_BASE_URLS } from "../../core/src/auth/oauth-constants.js";
import {
  buildAuthorizeUrl,
  postTokenRequest,
} from "../../core/src/auth/oauth-http.js";
import {
  base64UrlEncodeBytes,
  PkceChallenge,
} from "../../core/src/auth/pkce.js";
import { parsePastedRedirect } from "../../core/src/auth/redirect-parse.js";
import {
  pythonUtcIsoformat,
  type OAuthTokens,
} from "../../core/src/auth/token.js";
import { OAuthError } from "../../core/src/errors.js";
import { BROWSER_NO_PENDING_LOGIN, BrowserUnsupportedError } from "./errors.js";
import { ensureBrowserClientRegistered } from "./registration.js";
import { serializeTokensPayload } from "./token-serialization.js";

/** Options bag of {@link beginLogin} (b9-packets.md §3.2 — pasted contract). */
export interface BeginLoginOptions {
  /**
   * Mixpanel data residency region — validated against
   * `OAUTH_BASE_URLS` keys; unknown → `OAuthError`
   * `OAUTH_CONFIG_ERROR` (`flow.py:164` twin — same code).
   */
  readonly region: "us" | "eu" | "in";
  /** The app's return URL, registered via DCR. REQUIRED — no default. */
  readonly redirectUri: string;
  /** Credential store holding the pending record + DCR cache. */
  readonly store: CredentialStore;
  /** Injected fetch (R2.4 seam); default `globalThis.fetch`. */
  readonly fetch?: typeof fetch;
  /**
   * Epoch-ms clock seam (client-info `created_at`, pending-record
   * `created_at`, token `expires_at`). Default ambient (§7 caution 5:
   * tests freeze it; the flow never reads the ambient clock directly).
   */
  readonly now?: () => number;
}

/** Result of {@link beginLogin}. */
export interface BeginLoginResult {
  /**
   * The authorization URL. The CALLER navigates (`location.assign`) —
   * the library NEVER navigates.
   */
  readonly authorizeUrl: string;
  /** The CSRF state bound to this login attempt. */
  readonly state: string;
}

/** Options bag of {@link completeLogin} (§3.2 pasted contract). */
export interface CompleteLoginOptions {
  /** Mixpanel data residency region (same gate as {@link beginLogin}). */
  readonly region: "us" | "eu" | "in";
  /**
   * The redirect-return: a full URL or query string —
   * `parsePastedRedirect` grammar (`flow.py:51-117`).
   */
  readonly returnUrl: string;
  /** The store carrying the pending record from {@link beginLogin}. */
  readonly store: CredentialStore;
  /** Injected fetch (R2.4 seam); default `globalThis.fetch`. */
  readonly fetch?: typeof fetch;
  /** Epoch-ms clock seam (token `expires_at`). Default ambient. */
  readonly now?: () => number;
}

/** The pending-login record shape (module header — fixed key set). */
interface PendingLoginRecord {
  /** The CSRF state. */
  readonly state: string;
  /** The PKCE code verifier (held server-side never — stays in store). */
  readonly verifier: string;
  /** The DCR client id used for the authorize URL. */
  readonly client_id: string;
  /** The redirect URI the authorize URL carried. */
  readonly redirect_uri: string;
  /** R11.9 tokens-twin timestamp of the begin call. */
  readonly created_at: string;
}

/**
 * Validate the region against `OAUTH_BASE_URLS` and return its base
 * URL (`OAuthFlow.__init__` gate twin, `flow.py:160-165` — same code
 * and message shape).
 *
 * @param region - The caller-supplied region.
 * @returns The region's OAuth base URL (trailing slash).
 * @throws OAuthError - `OAUTH_CONFIG_ERROR` for unknown regions.
 */
function requireBaseUrl(region: string): string {
  if (!Object.hasOwn(OAUTH_BASE_URLS, region)) {
    throw new OAuthError(
      `Unknown region: ${JSON.stringify(region)}. Must be one of: ` +
        `${Object.keys(OAUTH_BASE_URLS).sort().join(", ")}`,
      "OAUTH_CONFIG_ERROR",
    );
  }
  return OAUTH_BASE_URLS[region] as string;
}

/**
 * Generate the CSRF state — the `secrets.token_urlsafe(32)` twin
 * (`flow.py:270`): 32 random bytes, base64url without padding
 * (43 chars, same alphabet as Python's output).
 *
 * @returns The state string.
 */
function generateState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncodeBytes(bytes);
}

/**
 * Begin the browser redirect PKCE login (b9-packets.md §3.2):
 * 1. region gate  2. DCR (cached)  3. PKCE + state  4. persist the
 * pending record under `CREDENTIAL_KEYS.pendingLogin(region)`
 * 5. return the authorize URL (core `buildAuthorizeUrl`).
 *
 * @param options - Region / redirect URI / store / seams.
 * @returns The authorize URL (caller navigates) + state.
 * @throws OAuthError - `OAUTH_CONFIG_ERROR` (bad region) or
 *   `OAUTH_REGISTRATION_ERROR` (DCR failure).
 *
 * @example
 * ```typescript
 * const { authorizeUrl } = await beginLogin({
 *   region: "us",
 *   redirectUri: "https://app.example.com/oauth/callback",
 *   store,
 * });
 * location.assign(authorizeUrl);
 * ```
 */
export async function beginLogin(
  options: BeginLoginOptions,
): Promise<BeginLoginResult> {
  // 1. Region gate (`flow.py:160-165` twin).
  const baseUrl = requireBaseUrl(options.region);
  const now = options.now ?? Date.now;

  // 2. DCR, CredentialStore-cached (`flow.py:282-288` twin).
  const clientInfo = await ensureBrowserClientRegistered({
    fetch: options.fetch,
    region: options.region,
    redirectUri: options.redirectUri,
    store: options.store,
    now,
  });

  // 3. PKCE + state (`flow.py:268-270` twin — §3.2 table row 1).
  const pkce = await PkceChallenge.generate();
  const state = generateState();

  // 4. Persist the pending record (substitutes for Python's in-process
  // locals; created_at via the R11.9 tokens-twin formatter).
  const pending: PendingLoginRecord = {
    state,
    verifier: pkce.verifier,
    client_id: clientInfo.client_id,
    redirect_uri: options.redirectUri,
    created_at: pythonUtcIsoformat(now()),
  };
  await options.store.set(
    CREDENTIAL_KEYS.pendingLogin(options.region),
    JSON.stringify(pending),
  );

  // 5. Authorize URL (`flow.py:290-296` twin) — the library NEVER
  // navigates.
  return {
    authorizeUrl: buildAuthorizeUrl(baseUrl, {
      clientId: clientInfo.client_id,
      redirectUri: options.redirectUri,
      challenge: pkce.challenge,
      state,
    }),
    state,
  };
}

/**
 * Read and validate the pending-login record for a region.
 *
 * @param store - The credential store.
 * @param region - The region key.
 * @returns The parsed record.
 * @throws BrowserUnsupportedError - `BROWSER_NO_PENDING_LOGIN` when
 *   absent, consumed, or corrupted (twin-less branch — errors.ts note).
 */
async function loadPendingRecord(
  store: CredentialStore,
  region: string,
): Promise<PendingLoginRecord> {
  const raw = await store.get(CREDENTIAL_KEYS.pendingLogin(region));
  const fail = (reason: string): never => {
    throw new BrowserUnsupportedError(
      `No pending login for region '${region}' (${reason}). The pending ` +
        "record is single-use and lives only in the CredentialStore that " +
        "beginLogin wrote — start a fresh beginLogin.",
      BROWSER_NO_PENDING_LOGIN,
      { region, reason },
    );
  };
  if (raw === null) {
    return fail("absent or already consumed");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return fail("corrupted record");
  }
  if (typeof decoded !== "object" || decoded === null) {
    return fail("corrupted record");
  }
  const record = decoded as Record<string, unknown>;
  for (const field of ["state", "verifier", "client_id", "redirect_uri"]) {
    if (typeof record[field] !== "string") {
      return fail("corrupted record");
    }
  }
  return record as unknown as PendingLoginRecord;
}

/**
 * Complete the browser redirect PKCE login on the return page
 * (b9-packets.md §3.2): 1. load the pending record  2. parse/validate
 * the return URL (`parsePastedRedirect` — Python codes verbatim)
 * 3. DELETE the pending record BEFORE the exchange (single-use state —
 * a replay of the same URL hits step 1; a FAILED exchange does not
 * resurrect it either, §6 R2-3: replay after failure is a fresh
 * `beginLogin`)  4. exchange the code (`flow.py:428-434`
 * field-for-field)  5. ALWAYS persist the tokens under
 * `CREDENTIAL_KEYS.tokens(region)` (R11.9 writer shape) and return
 * them.
 *
 * @param options - Region / return URL / store / seams.
 * @returns The obtained tokens.
 * @throws OAuthError - `OAUTH_CONFIG_ERROR` (bad region),
 *   `OAUTH_PASTE_ERROR` (empty/malformed/missing code+state,
 *   `flow.py:86,105-106`), `OAUTH_AUTH_DENIED` (provider `error=`
 *   param, `:98`), `OAUTH_STATE_MISMATCH` (`:113`), or
 *   `OAUTH_TOKEN_ERROR` (exchange failure — every classifier branch).
 * @throws BrowserUnsupportedError - `BROWSER_NO_PENDING_LOGIN` when no
 *   pending record exists (replay / expired tab).
 *
 * @example
 * ```typescript
 * // On the redirect return page:
 * const tokens = await completeLogin({
 *   region: "us",
 *   returnUrl: location.href,
 *   store,
 * });
 * ```
 */
export async function completeLogin(
  options: CompleteLoginOptions,
): Promise<OAuthTokens> {
  const baseUrl = requireBaseUrl(options.region);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const pendingKey = CREDENTIAL_KEYS.pendingLogin(options.region);

  // 1. Load the pending record.
  const pending = await loadPendingRecord(options.store, options.region);

  // 2. Parse the return URL against the pending state (Python codes
  // verbatim — parse failures precede the delete, so the user can
  // retry with the CORRECT url; only a successful parse consumes the
  // record).
  const result = parsePastedRedirect(options.returnUrl, {
    expectedState: pending.state,
  });

  // 3. Single-use state: DELETE BEFORE the exchange (replay-attack
  // lock — §3.2 step 3).
  await options.store.delete(pendingKey);

  // 4. Exchange (`flow.py:428-434` field-for-field via the §3.1 hoist).
  const tokens = await postTokenRequest(
    fetchImpl,
    baseUrl,
    {
      grant_type: "authorization_code",
      code: result.code,
      redirect_uri: pending.redirect_uri,
      client_id: pending.client_id,
      code_verifier: pending.verifier,
    },
    {
      operation: "Token exchange",
      errorCode: "OAUTH_TOKEN_ERROR",
      accountName: null,
      now: options.now,
    },
  );

  // 5. ALWAYS persist (R9.3 posture — durable only if the caller chose
  // the localStorage adapter), R11.9 tokens-twin writer shape.
  await options.store.set(
    CREDENTIAL_KEYS.tokens(options.region),
    serializeTokensPayload(tokens),
  );
  return tokens;
}
