/**
 * Redirect-based PKCE login flow for browsers — `OAuthFlow.login`
 * adapted to a page-leaving redirect. Because the redirect leaves the
 * page, login splits into {@link beginLogin} and {@link completeLogin},
 * and a pending-login record under `CREDENTIAL_KEYS.pendingLogin(region)`
 * (`{state, verifier, client_id, redirect_uri, created_at}`) substitutes
 * for Python's in-process locals. There is no callback server, no paste
 * fallback and no browser launcher: the caller navigates to the
 * authorize URL and calls `completeLogin` on the return page. These
 * functions take no `Account` at all, so service-account ingress is
 * excluded at compile time.
 *
 * @remarks Divergence: Python refreshes expired tokens through the
 * refresh-token grant; the browser flow has no refresh surface — an
 * expired token means a fresh login.
 * @see mixpanel_headless._internal.auth.flow.OAuthFlow.login
 */

import {
  buildAuthorizeUrl,
  CREDENTIAL_KEYS,
  type CredentialStore,
  OAuthError,
  type OAuthTokens,
  parsePastedRedirect,
  PkceChallenge,
  postTokenRequest,
  pythonUtcIsoformat,
} from "@mixpanel-headless/core";
import {
  base64UrlEncodeBytes,
  requireOAuthBaseUrl,
} from "@mixpanel-headless/core/internal";

import { BROWSER_NO_PENDING_LOGIN, BrowserUnsupportedError } from "./errors.js";
import { ensureBrowserClientRegistered } from "./registration.js";
import { serializeTokensPayload } from "./token-serialization.js";

/**
 * Default lifetime of the pending-login record: a record older than
 * this at `completeLogin` time is refused and consumed
 * (`BROWSER_NO_PENDING_LOGIN`), so a leaked state/verifier pair does
 * not stay redeemable forever (the OAuth BCP short-lived-state
 * posture). 30 minutes bounds the at-rest window while comfortably
 * covering a slow consent/MFA hop; override via
 * {@link CompleteLoginOptions.maxPendingAgeMs}.
 */
export const DEFAULT_MAX_PENDING_AGE_MS: number = 30 * 60 * 1000;

/** Options bag of {@link beginLogin}. */
export interface BeginLoginOptions {
  /**
   * Mixpanel data residency region — validated against
   * `OAUTH_BASE_URLS` keys; unknown → `OAuthError`
   * `OAUTH_CONFIG_ERROR` (the same code as Python).
   */
  readonly region: "us" | "eu" | "in";
  /**
   * The app's return URL, registered via DCR. Required — no default.
   *
   * Security: this must be a compile-time constant of your application
   * — never derive it from user input, query parameters
   * (`?returnTo=…`), or any request-controlled value. DCR registers
   * arbitrary third-party https origins, so an attacker-influenced
   * value here delivers the authorization code to the attacker's
   * origin. The value is validated as an absolute URL with an `https:`
   * scheme (`http:` is allowed only for loopback hosts, RFC 8252 §7.3 —
   * the same localhost posture as Python's own redirect URI); anything
   * else throws `OAUTH_CONFIG_ERROR`.
   */
  readonly redirectUri: string;
  /** Credential store holding the pending record and the DCR cache. */
  readonly store: CredentialStore;
  /**
   * Injected fetch.
   *
   * @defaultValue `globalThis.fetch`
   */
  readonly fetch?: typeof fetch;
  /**
   * Epoch-ms clock seam (client-info `created_at`, pending-record
   * `created_at`, token `expires_at`). Tests freeze it; the flow never
   * reads the ambient clock directly.
   *
   * @defaultValue `Date.now`
   */
  readonly now?: () => number;
}

/** Result of {@link beginLogin}. */
export interface BeginLoginResult {
  /**
   * The authorization URL. The caller navigates (`location.assign`) —
   * the library never navigates.
   */
  readonly authorizeUrl: string;
  /** The CSRF state bound to this login attempt. */
  readonly state: string;
}

/** Options bag of {@link completeLogin}. */
export interface CompleteLoginOptions {
  /** Mixpanel data residency region (same gate as {@link beginLogin}). */
  readonly region: "us" | "eu" | "in";
  /**
   * The redirect return: a full URL or query string —
   * `parsePastedRedirect` grammar.
   */
  readonly returnUrl: string;
  /** The store carrying the pending record from {@link beginLogin}. */
  readonly store: CredentialStore;
  /**
   * Injected fetch.
   *
   * @defaultValue `globalThis.fetch`
   */
  readonly fetch?: typeof fetch;
  /**
   * Epoch-ms clock seam (token `expires_at` and the pending-record age
   * gate).
   *
   * @defaultValue `Date.now`
   */
  readonly now?: () => number;
  /**
   * Maximum accepted age of the pending-login record. An older (or
   * unparseable-`created_at`) record is refused and consumed with
   * `BROWSER_NO_PENDING_LOGIN`.
   *
   * @defaultValue {@link DEFAULT_MAX_PENDING_AGE_MS}
   */
  readonly maxPendingAgeMs?: number;
}

/** The pending-login record shape (fixed key set; see module header). */
interface PendingLoginRecord {
  /** The CSRF state. */
  readonly state: string;
  /** The PKCE code verifier (never sent anywhere but the token endpoint). */
  readonly verifier: string;
  /** The DCR client id used for the authorize URL. */
  readonly client_id: string;
  /** The redirect URI the authorize URL carried. */
  readonly redirect_uri: string;
  /** Timestamp of the begin call, in the tokens-file isoformat shape. */
  readonly created_at: string;
}

/**
 * Loopback hostnames for which plain `http:` redirect URIs are legal
 * (RFC 8252 §7.3; Python's own localhost redirect posture).
 */
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Validate the caller-supplied redirect URI: it must be an absolute URL
 * whose scheme is `https:`, or `http:` on a loopback host. This does
 * not make a user-input-derived value safe (an attacker-controlled
 * https origin still registers via DCR) — see the
 * {@link BeginLoginOptions.redirectUri} warning; the gate only turns
 * garbage/relative/scheme-confused values into one coded, pre-network
 * error. Browser-local rule with no Python twin (Python generates its
 * own localhost URI); `OAUTH_CONFIG_ERROR` matches the flow's other
 * config-shape errors.
 *
 * @param redirectUri - The caller-supplied redirect URI.
 * @throws {@link OAuthError} `OAUTH_CONFIG_ERROR` for non-absolute,
 *   non-https (non-loopback) or unparseable values.
 */
function validateRedirectUri(redirectUri: string): void {
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch (error) {
    throw new OAuthError(
      `redirectUri is not an absolute URL: ${JSON.stringify(redirectUri)}. ` +
        "Pass your app's full return URL (a compile-time constant, " +
        "never user input).",
      "OAUTH_CONFIG_ERROR",
      { field: "redirectUri" },
      { cause: error },
    );
  }
  const loopback = LOOPBACK_HOSTNAMES.has(parsed.hostname);
  if (
    parsed.protocol !== "https:" &&
    !(parsed.protocol === "http:" && loopback)
  ) {
    throw new OAuthError(
      `redirectUri must use https (or http on a loopback host — RFC 8252 ` +
        `§7.3); got scheme ${JSON.stringify(parsed.protocol)}. Never derive ` +
        "the redirect URI from user input.",
      "OAUTH_CONFIG_ERROR",
      { field: "redirectUri", scheme: parsed.protocol },
    );
  }
}

/**
 * Generate the CSRF state — the `secrets.token_urlsafe(32)` twin: 32
 * random bytes, base64url without padding (43 chars, same alphabet as
 * Python's output).
 *
 * @returns The state string.
 */
function generateState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncodeBytes(bytes);
}

/**
 * Begin the browser redirect PKCE login: 1. region gate and
 * redirect-URI gate 2. DCR (cached) 3. PKCE and state 4. persist the
 * pending record under `CREDENTIAL_KEYS.pendingLogin(region)`
 * 5. return the authorize URL (core `buildAuthorizeUrl`). The PKCE
 * challenge, state generation, DCR and authorize URL match Python
 * step for step; the redirect URI is caller-supplied where Python
 * probes a localhost port.
 *
 * Store durability: the redirect navigates away from the page, so
 * `completeLogin` runs on a fresh page load — the store passed here
 * must survive that navigation or the login can never complete
 * (`BROWSER_NO_PENDING_LOGIN`). The in-memory default store does not
 * survive navigation; for the redirect flow use a storage-backed store
 * — `new LocalStorageCredentialStore(sessionStorage)` is the
 * recommended narrower-exposure option (see the adapter's security
 * warning).
 *
 * @param options - Region / redirect URI / store / seams.
 * @returns The authorize URL (caller navigates) and the state.
 * @throws {@link OAuthError} `OAUTH_CONFIG_ERROR` (bad region / bad
 *   redirect URI) or `OAUTH_REGISTRATION_ERROR` (DCR failure).
 * @example
 * ```typescript
 * // A store that survives the redirect:
 * const store = new LocalStorageCredentialStore(sessionStorage);
 * const { authorizeUrl } = await beginLogin({
 *   region: "us",
 *   redirectUri: "https://app.example.com/oauth/callback", // constant!
 *   store,
 * });
 * location.assign(authorizeUrl);
 * ```
 * @see mixpanel_headless._internal.auth.flow.OAuthFlow.login
 */
export async function beginLogin(
  options: BeginLoginOptions,
): Promise<BeginLoginResult> {
  // 1. Region gate + redirect-URI gate.
  const baseUrl = requireOAuthBaseUrl(options.region);
  validateRedirectUri(options.redirectUri);
  const now = options.now ?? Date.now;

  // 2. DCR, CredentialStore-cached.
  const clientInfo = await ensureBrowserClientRegistered({
    fetch: options.fetch,
    region: options.region,
    redirectUri: options.redirectUri,
    store: options.store,
    now,
  });

  // 3. PKCE + state.
  const pkce = await PkceChallenge.generate();
  const state = generateState();

  // 4. Persist the pending record (substitutes for Python's in-process
  // locals; `created_at` in the tokens-file isoformat shape).
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

  // 5. Authorize URL — the library never navigates.
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
 * @throws {@link BrowserUnsupportedError} `BROWSER_NO_PENDING_LOGIN` when
 *   absent, consumed, or corrupted (a branch with no Python twin — see
 *   `errors.ts`).
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
  for (const field of [
    "state",
    "verifier",
    "client_id",
    "redirect_uri",
    // `created_at` feeds the age gate, so it is validated like the rest.
    "created_at",
  ]) {
    if (typeof record[field] !== "string") {
      return fail("corrupted record");
    }
  }
  return record as unknown as PendingLoginRecord;
}

/**
 * In-flight `completeLogin` registry. The load→parse→delete sequence
 * spans awaits, so two concurrent calls over the same store would both
 * redeem the single-use code (React 18 StrictMode double-invokes
 * exactly this shape). A second concurrent call with the same
 * `returnUrl` shares the first call's promise (one exchange, one
 * outcome for both); a concurrent call with a different `returnUrl`
 * waits for the in-flight attempt to settle and then proceeds normally
 * (finding the record consumed → `BROWSER_NO_PENDING_LOGIN`). This
 * guards same-realm concurrency only — cross-tab races over a shared
 * localStorage cannot be serialized through the three-method
 * `CredentialStore` interface (no atomic compare-and-delete exists); a
 * documented limitation.
 */
const inFlightCompletions = new WeakMap<
  CredentialStore,
  Map<
    string,
    { readonly returnUrl: string; readonly promise: Promise<OAuthTokens> }
  >
>();

/**
 * Complete the browser redirect PKCE login on the return page: 1. load
 * the pending record and apply the age gate (a record older than
 * {@link CompleteLoginOptions.maxPendingAgeMs} is refused and consumed)
 * 2. parse and validate the return URL (`parsePastedRedirect` — Python
 * codes verbatim; the URL fragment is stripped first because the
 * documented input is `location.href`, and hash-router fragments are
 * not query text) 3. delete the pending record before the exchange
 * (single-use state — a replay of the same URL hits step 1, and a
 * failed exchange does not resurrect it either: retry after failure is
 * a fresh `beginLogin`) 4. exchange the code (Python's request field
 * for field) 5. always persist the tokens under
 * `CREDENTIAL_KEYS.tokens(region)` and return them. Concurrent
 * duplicate calls share one exchange (see the in-flight registry note).
 *
 * `OAUTH_PASTE_ERROR` is reused verbatim for malformed return URLs: the
 * semantic is the same (an out-of-band-returned redirect URL fails to
 * parse); the name's CLI origin is historical. Only genuinely twin-less
 * branches get browser-local codes (`BROWSER_NO_PENDING_LOGIN`).
 *
 * Step-5 failure disposition: if the store write of step 5 throws, the
 * error propagates and the tokens are not returned — the code was
 * already redeemed, so the caller must restart with a fresh
 * `beginLogin`. Choose a reliable store; the shipped localStorage
 * adapter re-throws backend failures as coded `OAUTH_CONFIG_ERROR`.
 *
 * @param options - Region / return URL / store / seams.
 * @returns The obtained tokens.
 * @throws {@link OAuthError} `OAUTH_CONFIG_ERROR` (bad region),
 *   `OAUTH_PASTE_ERROR` (empty/malformed/missing code+state),
 *   `OAUTH_AUTH_DENIED` (provider `error=` param),
 *   `OAUTH_STATE_MISMATCH`, or `OAUTH_TOKEN_ERROR` (exchange failure —
 *   every classifier branch).
 * @throws {@link BrowserUnsupportedError} `BROWSER_NO_PENDING_LOGIN` when
 *   no pending record exists (replay / expired tab) or the record is
 *   older than the accepted lifetime.
 * @example
 * ```typescript
 * // On the redirect return page (a fragment in the URL is fine):
 * const tokens = await completeLogin({
 *   region: "us",
 *   returnUrl: location.href,
 *   store,
 * });
 * ```
 * @see mixpanel_headless._internal.auth.flow.OAuthFlow.login
 */
export async function completeLogin(
  options: CompleteLoginOptions,
): Promise<OAuthTokens> {
  const baseUrl = requireOAuthBaseUrl(options.region);
  const pendingKey = CREDENTIAL_KEYS.pendingLogin(options.region);

  // Same-realm concurrency dedup (see the registry doc block).
  let perStore = inFlightCompletions.get(options.store);
  if (perStore === undefined) {
    perStore = new Map();
    inFlightCompletions.set(options.store, perStore);
  }
  const existing = perStore.get(pendingKey);
  if (existing !== undefined) {
    if (existing.returnUrl === options.returnUrl) {
      return existing.promise;
    }
    // Different returnUrl: serialize behind the in-flight attempt
    // (its own outcome is not ours to share), then proceed normally.
    await existing.promise.catch(() => undefined);
  }
  const promise = completeLoginInner(options, baseUrl, pendingKey);
  const entry = { returnUrl: options.returnUrl, promise };
  perStore.set(pendingKey, entry);
  try {
    return await promise;
  } finally {
    if (perStore.get(pendingKey) === entry) {
      perStore.delete(pendingKey);
    }
  }
}

/**
 * The single-attempt body of {@link completeLogin} (steps 1–5; the
 * public wrapper adds the in-flight dedup).
 *
 * @param options - The caller's options.
 * @param baseUrl - The validated region base URL.
 * @param pendingKey - `CREDENTIAL_KEYS.pendingLogin(region)`.
 * @returns The obtained tokens.
 * @throws {@link BrowserUnsupportedError} `BROWSER_NO_PENDING_LOGIN` when
 *   the pending record is absent, corrupted or expired.
 * @throws {@link OAuthError} From the return-URL parse or the exchange
 *   (see {@link completeLogin}).
 */
async function completeLoginInner(
  options: CompleteLoginOptions,
  baseUrl: string,
  pendingKey: string,
): Promise<OAuthTokens> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const maxPendingAgeMs = options.maxPendingAgeMs ?? DEFAULT_MAX_PENDING_AGE_MS;

  // 1. Load the pending record.
  const pending = await loadPendingRecord(options.store, options.region);

  // 1b. Age gate: expired records are refused and consumed (the stale
  // verifier must not stay redeemable at rest). `created_at` is the
  // tokens-file isoformat (`+00:00` offset — Date.parse handles it); an
  // unparseable stamp counts as expired.
  const createdAtMs = Date.parse(pending.created_at);
  if (Number.isNaN(createdAtMs) || now() - createdAtMs > maxPendingAgeMs) {
    await options.store.delete(pendingKey);
    throw new BrowserUnsupportedError(
      `The pending login for region '${options.region}' is older than ` +
        `${String(maxPendingAgeMs)} ms and has been discarded — start a ` +
        "fresh beginLogin.",
      BROWSER_NO_PENDING_LOGIN,
      {
        region: options.region,
        reason: "pending record expired",
        max_pending_age_ms: maxPendingAgeMs,
      },
    );
  }

  // 2. Parse the return URL against the pending state (Python codes
  // verbatim — parse failures precede the delete, so the user can
  // retry with the correct URL; only a successful parse consumes the
  // record). Strip the URL fragment first — the browser input is
  // `location.href`, whose `#…` part is never query text (a `#` in a
  // query value is always `%23`-encoded); the shared core parser keeps
  // its CPython `parse_qs` semantics untouched for node.
  const hashIndex = options.returnUrl.indexOf("#");
  const fragmentFree =
    hashIndex === -1
      ? options.returnUrl
      : options.returnUrl.slice(0, hashIndex);
  const result = parsePastedRedirect(fragmentFree, {
    expectedState: pending.state,
  });

  // 3. Single-use state: delete before the exchange (replay lock).
  await options.store.delete(pendingKey);

  // 4. Exchange — Python's `exchange_code` request field for field.
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

  // 5. Always persist, in the tokens-file writer shape — durable only if
  // the caller chose the localStorage adapter (Python persists only
  // when `persist=True`; the browser's store is the only place the
  // tokens can live).
  await options.store.set(
    CREDENTIAL_KEYS.tokens(options.region),
    serializeTokensPayload(tokens),
  );
  return tokens;
}
