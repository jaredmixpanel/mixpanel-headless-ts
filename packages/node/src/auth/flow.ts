/**
 * OAuth 2.0 flow orchestrator — TS port of
 * `mixpanel_headless/_internal/auth/flow.py`. The refresh half landed
 * at B8-N2 (b8-packets.md §3.1 row 2 / §0.2 mapping note): constructor
 * + region validation (`flow.py:118-179`), `get_valid_token`
 * (`flow.py:180-226`), `refresh_tokens` (`flow.py:442-499`) and
 * `_post_token_request` (`flow.py:500-605`). B8-N3 (packet §4.1 row 4)
 * extends THIS file with the interactive-login half: `login`
 * (`flow.py:227-394`), `exchange_code` (`flow.py:395-441`),
 * `_parse_pasted_redirect` (`flow.py:51-117`), `_build_authorize_url`
 * (`flow.py:606-637`) and `_find_available_port` (`flow.py:638-654`).
 *
 * Login substitutions (all header-documented, R10.7):
 * - Python's module monkeypatch surfaces (`flow.webbrowser`,
 *   `flow.start_callback_server`, `flow.ensure_client_registered`)
 *   become injected {@link OAuthFlowOptions} seams (`openBrowser`,
 *   `startCallbackServer`, `registerClient`) — no `child_process`
 *   launch at module scope (packet §4.2).
 * - `_find_available_port`'s sync bind-and-release probe is async in
 *   node (`net.Server.listen` has no sync form); the two-phase
 *   probe-then-bind shape is kept verbatim — the TOCTOU window is
 *   Python's own (packet §7 caution 14).
 * - Python's two racing completer THREADS (callback server + stdin
 *   paste reader) become racing promises; the losing completer is
 *   CANCELLED via an `AbortSignal` where Python leaks a daemon thread
 *   (node's event loop would otherwise never drain — behavior-neutral,
 *   the loser's outcome is discarded in both runtimes).
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

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { createInterface } from "node:readline";

import {
  OAuthTokens,
  pythonUtcIsoformat,
} from "../../../core/src/auth/token.js";
import type { OAuthClientInfo } from "../../../core/src/auth/token.js";
import {
  MixpanelHttpError,
  isPlainRecord,
} from "../../../core/src/client/internals.js";
import { toNativeJson } from "../../../core/src/client/json-value.js";
import { parseLossless } from "../../../core/src/client/lossless-json.js";
import {
  createRequestExecutor,
  urlEncodePairs,
} from "../../../core/src/client/transport.js";
import { pythonStrip } from "../../../core/src/compat/python-strip.js";
import { MixpanelHeadlessError, OAuthError } from "../../../core/src/errors.js";
import { pythonStr } from "../../../core/src/compat/python-str.js";
import {
  CALLBACK_PORTS,
  CallbackResult,
  startCallbackServer,
  type StartCallbackServerOptions,
} from "./callback-server.js";
import {
  ensureClientRegistered,
  type EnsureClientRegisteredOptions,
} from "./client-registration.js";
import { OAUTH_BASE_URLS } from "./oauth-constants.js";
import { PkceChallenge } from "./pkce.js";
import { parseQs } from "./query-params.js";
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
  /**
   * Browser-launch effect for {@link OAuthFlow.login} (the
   * `webbrowser.open` seam — packet §4.2). Default: a best-effort
   * platform launcher (`open` / `cmd start` / `xdg-open`). A THROW
   * here is wrapped into `OAUTH_BROWSER_ERROR`.
   */
  readonly openBrowser?: ((url: string) => void | Promise<void>) | undefined;
  /**
   * Callback-server seam (the `flow.start_callback_server` module
   * monkeypatch twin). Default: the real localhost server.
   */
  readonly startCallbackServer?:
    | ((
        options: StartCallbackServerOptions,
      ) => Promise<readonly [CallbackResult, number]>)
    | undefined;
  /**
   * DCR seam (the `flow.ensure_client_registered` monkeypatch twin).
   * Default: the real {@link ensureClientRegistered}.
   */
  readonly registerClient?:
    | ((options: EnsureClientRegisteredOptions) => Promise<OAuthClientInfo>)
    | undefined;
  /**
   * Port-probe seam (`_find_available_port`). Default: the real
   * bind-and-release probe over {@link CALLBACK_PORTS}.
   */
  readonly findAvailablePort?: (() => Promise<number | null>) | undefined;
  /**
   * Stdin paste-reader seam (`sys.stdin.readline()`,
   * `flow.py:321-330`). Resolves one line; the `signal` aborts the
   * read when the other completer wins. Default: `process.stdin`.
   */
  readonly readStdinLine?:
    ((signal: AbortSignal) => Promise<string>) | undefined;
  /**
   * Stderr writer for the `open_browser=False` URL banner
   * (`flow.py:349-361` `print(..., file=sys.stderr)`). Default:
   * `process.stderr.write`.
   */
  readonly stderr?: ((text: string) => void) | undefined;
}

/** Kwonly options of {@link OAuthFlow.login} (`flow.py:227`). */
export interface LoginOptions {
  /**
   * When `true`, persist the resulting tokens to the LEGACY v2 layout
   * (`~/.mp/oauth/tokens_{region}.json` via `OAuthStorage.saveTokens`
   * — `flow.py:389-391`; the two-persistence-worlds rule, packet §7
   * caution 9). Default `false`: the v3 orchestrator persists via
   * `TokenStore.writeTokens` itself.
   */
  readonly persist?: boolean | undefined;
  /**
   * When `true` (default), launch the browser to the authorize URL.
   * When `false`, print the URL to stderr and ADD the stdin paste
   * completer — the callback server listens either way.
   */
  readonly openBrowser?: boolean | undefined;
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
 * Parse a pasted OAuth redirect URL or query string into a
 * {@link CallbackResult} (port of `_parse_pasted_redirect`,
 * `flow.py:51-115` — exported because the Python suite drives the
 * "private" function directly, `test_auth_flow.py:215`).
 *
 * Accepts (whitespace-trimmed): a full redirect URL, a query string
 * with leading `?`, or the bare `code=...&state=...` text. Validates
 * the pasted `state` against `expectedState` (CSRF — without this
 * check a hostile party could trick the user into pasting an
 * attacker-supplied code).
 *
 * @param line - The text the user pasted on stdin.
 * @param options - The `state` generated by this login session.
 * @returns The extracted code/state pair.
 * @throws OAuthError - Empty paste (`OAUTH_PASTE_ERROR`), provider
 *   `error=` param (`OAUTH_AUTH_DENIED`), missing `code`/`state`
 *   (`OAUTH_PASTE_ERROR`), or state mismatch
 *   (`OAUTH_STATE_MISMATCH`).
 *
 * @example
 * ```typescript
 * const result = parsePastedRedirect(
 *   "http://localhost:19284/callback?code=ABC&state=XYZ",
 *   { expectedState: "XYZ" },
 * );
 * // result.code === "ABC"
 * ```
 */
export function parsePastedRedirect(
  line: string,
  options: { readonly expectedState: string },
): CallbackResult {
  const text = pythonStrip(line);
  if (text === "") {
    throw new OAuthError(
      "Empty paste — expected the redirect URL or `code=...&state=...`.",
      "OAUTH_PASTE_ERROR",
    );
  }
  // Strip everything up to and including the first `?` so both the
  // full URL form and the bare query-string form parse the same way.
  const questionMark = text.indexOf("?");
  const queryPart = questionMark !== -1 ? text.slice(questionMark + 1) : text;
  const params = parseQs(queryPart);
  const errorList = params.get("error");
  if (errorList !== undefined) {
    const err = errorList[0] as string;
    const desc = params.get("error_description")?.[0] ?? "";
    throw new OAuthError(
      `OAuth provider returned an error: ${err}` +
        (desc !== "" ? ` — ${desc}` : ""),
      "OAUTH_AUTH_DENIED",
    );
  }
  const codeList = params.get("code") ?? [];
  const stateList = params.get("state") ?? [];
  if (codeList.length === 0 || stateList.length === 0) {
    throw new OAuthError(
      "Pasted text is missing `code` or `state` parameters. " +
        "Paste the full redirect URL (e.g., " +
        "http://localhost:.../callback?code=...&state=...).",
      "OAUTH_PASTE_ERROR",
    );
  }
  const code = codeList[0] as string;
  const state = stateList[0] as string;
  if (state !== options.expectedState) {
    throw new OAuthError(
      "State mismatch — the pasted text does not belong to this login session.",
      "OAUTH_STATE_MISMATCH",
    );
  }
  return new CallbackResult({ code, state });
}

/**
 * Probe {@link CALLBACK_PORTS} for one that is not currently in use
 * (port of `_find_available_port`, `flow.py:638-654`): binds and
 * immediately releases each candidate on 127.0.0.1, in port order.
 * Async where Python is sync (module header substitution note).
 *
 * @returns The first available port, or `null` when all are occupied.
 */
export async function findAvailablePort(): Promise<number | null> {
  for (const port of CALLBACK_PORTS) {
    const available = await new Promise<boolean>((resolve) => {
      const probe = createServer();
      probe.once("error", () => {
        resolve(false);
      });
      probe.listen(port, "127.0.0.1", () => {
        probe.close(() => {
          resolve(true);
        });
      });
    });
    if (available) {
      return port;
    }
  }
  return null;
}

/**
 * Best-effort platform browser launcher (the `webbrowser.open` twin).
 * Launch failures after spawn are swallowed like `webbrowser.open`
 * returning `False`; only a synchronous spawn error propagates.
 *
 * @param url - The authorize URL to open.
 */
function defaultOpenBrowser(url: string): void {
  const [command, args]: readonly [string, readonly string[]] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  const child = spawn(command, [...args], {
    stdio: "ignore",
    detached: true,
  });
  child.on("error", () => {
    // Async launch failure ≈ webbrowser.open returning False — Python
    // does not raise for that either.
  });
  child.unref();
}

/**
 * Read one line from `process.stdin` (the paste completer's
 * `sys.stdin.readline()` default).
 *
 * @param signal - Aborting closes the reader (losing completer).
 * @returns The line (without requiring a trailing newline).
 */
function defaultReadStdinLine(signal: AbortSignal): Promise<string> {
  return new Promise((resolve) => {
    const reader = createInterface({ input: process.stdin });
    reader.once("line", (line: string) => {
      reader.close();
      resolve(line);
    });
    signal.addEventListener(
      "abort",
      () => {
        reader.close();
      },
      { once: true },
    );
  });
}

/**
 * Millisecond sleep (the `time.sleep(0.1)` twin, `flow.py:338`).
 *
 * @param ms - Milliseconds to wait.
 * @returns Resolves after the delay.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Sentinel for "no completer error recorded yet". */
const NO_ERROR: unique symbol = Symbol("no-error");

/**
 * Orchestrator for the OAuth 2.0 Authorization Code + PKCE flow —
 * refresh surface from B8-N2 (`flow.py:118-226`, `:442-605`) plus the
 * B8-N3 interactive-login surface (`flow.py:227-441`, `:606-654`).
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

  /** Browser-launch effect (login half). */
  readonly #openBrowser: (url: string) => void | Promise<void>;

  /** Callback-server seam (login half). */
  readonly #startCallbackServer: (
    options: StartCallbackServerOptions,
  ) => Promise<readonly [CallbackResult, number]>;

  /** DCR seam (login half). */
  readonly #registerClient: (
    options: EnsureClientRegisteredOptions,
  ) => Promise<OAuthClientInfo>;

  /** Port-probe seam (login half). */
  readonly #findAvailablePort: () => Promise<number | null>;

  /** Stdin paste-reader seam (login half). */
  readonly #readStdinLine: (signal: AbortSignal) => Promise<string>;

  /** Stderr writer (login half's `open_browser=False` banner). */
  readonly #stderr: (text: string) => void;

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
    this.#openBrowser = options.openBrowser ?? defaultOpenBrowser;
    this.#startCallbackServer =
      options.startCallbackServer ?? startCallbackServer;
    this.#registerClient = options.registerClient ?? ensureClientRegistered;
    this.#findAvailablePort = options.findAvailablePort ?? findAvailablePort;
    this.#readStdinLine = options.readStdinLine ?? defaultReadStdinLine;
    this.#stderr =
      options.stderr ??
      ((text: string): void => {
        process.stderr.write(text);
      });
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
   * Execute the full interactive OAuth PKCE login flow (port of
   * `login`, `flow.py:227-393`). Step order locked (packet §4.2):
   * PKCE + state → port probe → DCR → authorize URL → the two racing
   * completers (callback server always; stdin paste reader only when
   * `openBrowser` is `false`) → exchange → optional persist.
   *
   * @param options - `persist` / `openBrowser` (see {@link LoginOptions}).
   * @returns The obtained tokens (access + optional refresh).
   * @throws OAuthError - Any step fails: all ports busy
   *   (`OAUTH_PORT_ERROR`), registration, browser launch
   *   (`OAUTH_BROWSER_ERROR`), callback/paste errors, timeout
   *   (`OAUTH_TIMEOUT`), or token exchange (`OAUTH_TOKEN_ERROR`).
   *
   * @example
   * ```typescript
   * const flow = new OAuthFlow({ region: "us" });
   * const tokens = await flow.login({ openBrowser: false });
   * ```
   */
  async login(options: LoginOptions = {}): Promise<OAuthTokens> {
    const persist = options.persist ?? false;
    const openBrowser = options.openBrowser ?? true;

    // Step 1: PKCE challenge and state (`flow.py:268-270` —
    // `secrets.token_urlsafe(32)` = 32 random bytes, base64url no-pad).
    const pkce = PkceChallenge.generate();
    const state = randomBytes(32).toString("base64url");

    // Step 2: find an available callback port by probing before
    // binding (`flow.py:272-278`).
    const boundPort = await this.#findAvailablePort();
    if (boundPort === null) {
      throw new OAuthError(
        `All OAuth callback ports ([${CALLBACK_PORTS.join(", ")}]) are busy.`,
        "OAUTH_PORT_ERROR",
      );
    }

    const redirectUri = `http://localhost:${boundPort}/callback`;

    // Step 3: ensure client registration (`flow.py:282-288`).
    const clientInfo = await this.#registerClient({
      fetchImpl: this.#fetchImpl,
      region: this.#region,
      redirectUri,
      storage: this.#storage,
      now: this.#now,
    });

    // Step 4: build the authorize URL (`flow.py:290-296`).
    const authorizeUrl = this.#buildAuthorizeUrl({
      clientId: clientInfo.client_id,
      redirectUri,
      challenge: pkce.challenge,
      state,
    });

    // Step 5: two completers race on a shared result slot
    // (`flow.py:298-334`): the callback server (always) and the stdin
    // paste reader (only when `openBrowser` is false). Whichever
    // produces a valid (code, state) first wins; the PKCE verifier
    // stays in this process. First completer ERROR is retained but
    // only surfaced after the result wait expires — Python's
    // `error_q` consultation order (`flow.py:363-379`).
    const abort = new AbortController();
    let firstError: unknown = NO_ERROR;
    const recordError = (exc: unknown): void => {
      if (firstError === NO_ERROR) {
        firstError = exc;
      }
    };
    let resolveResult: (result: CallbackResult) => void = () => undefined;
    const resultPromise = new Promise<CallbackResult>((resolve) => {
      resolveResult = resolve;
    });

    void this.#startCallbackServer({
      state,
      timeoutSeconds: 300.0,
      port: boundPort,
      signal: abort.signal,
    }).then(([result]) => {
      resolveResult(result);
    }, recordError);

    if (!openBrowser) {
      void this.#readStdinLine(abort.signal).then((line) => {
        try {
          resolveResult(parsePastedRedirect(line, { expectedState: state }));
        } catch (exc) {
          recordError(exc);
        }
      }, recordError);
    }

    // Small delay so the callback server is listening before the
    // browser opens / the URL prints (`flow.py:336-338`).
    await sleep(100);

    if (openBrowser) {
      try {
        await this.#openBrowser(authorizeUrl);
      } catch (exc) {
        abort.abort();
        throw new OAuthError(
          `Could not open browser for authorization: ` +
            `${exc instanceof Error ? exc.message : String(exc)}`,
          "OAUTH_BROWSER_ERROR",
          { authorize_url: authorizeUrl },
          { cause: exc },
        );
      }
    } else {
      this.#stderr(
        "Open this URL in your browser to authorize:\n" +
          `  ${authorizeUrl}\n` +
          "\n" +
          `If the redirect to http://localhost:${boundPort}/callback ` +
          "succeeds, the CLI will continue automatically.\n" +
          "Otherwise, paste the redirect URL (or the `code=...&state=...` " +
          "portion) below and press Enter:\n",
      );
    }

    // Step 6: wait for whichever completer produces first, capped at
    // 310s (`flow.py:363-379`).
    // `null` = the 310s result wait expired (the `queue.Empty` twin).
    const winner = await new Promise<CallbackResult | null>((resolve) => {
      const timer = setTimeout(() => {
        resolve(null);
      }, 310_000);
      void resultPromise.then((result) => {
        clearTimeout(timer);
        resolve(result);
      });
    });
    if (winner === null) {
      abort.abort();
      if (firstError === NO_ERROR) {
        throw new OAuthError(
          "Login timed out waiting for callback or paste.",
          "OAUTH_TIMEOUT",
        );
      }
      if (firstError instanceof OAuthError) {
        throw firstError;
      }
      throw new OAuthError(
        `Callback / paste error: ` +
          `${firstError instanceof Error ? firstError.message : String(firstError)}`,
        "OAUTH_TOKEN_ERROR",
        {},
        { cause: firstError },
      );
    }
    // Cancel the losing completer (module-header substitution note —
    // Python leaks the daemon thread instead).
    abort.abort();

    // Step 7: exchange code for tokens (`flow.py:381-387`).
    const tokens = await this.exchangeCode(
      winner.code,
      pkce.verifier,
      clientInfo.client_id,
      redirectUri,
    );

    // Step 8: save tokens (v2 layout) when the caller opts in
    // (`flow.py:389-391`).
    if (persist) {
      this.#storage.saveTokens(tokens, this.#region);
    }

    return tokens;
  }

  /**
   * Exchange an authorization code for OAuth tokens (port of
   * `exchange_code`, `flow.py:395-440`).
   *
   * @param code - The authorization code from the callback.
   * @param verifier - The PKCE code verifier.
   * @param clientId - The registered OAuth client ID.
   * @param redirectUri - The redirect URI used in the authorization
   *   request.
   * @returns The obtained tokens.
   * @throws OAuthError - The exchange fails (`OAUTH_TOKEN_ERROR` on
   *   every classifier branch — `invalid_grant` stays generic for the
   *   exchange operation, packet §7 caution 6).
   *
   * @example
   * ```typescript
   * const tokens = await flow.exchangeCode(
   *   "auth-code",
   *   "pkce-verifier",
   *   "my-client",
   *   "http://localhost:19284/callback",
   * );
   * ```
   */
  async exchangeCode(
    code: string,
    verifier: string,
    clientId: string,
    redirectUri: string,
  ): Promise<OAuthTokens> {
    // Form body in Python dict INSERTION ORDER (`flow.py:429-435`).
    const formData: Record<string, string> = {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
    };
    return this.#postTokenRequest(formData, {
      operation: "Token exchange",
      errorCode: "OAUTH_TOKEN_ERROR",
      accountName: null,
    });
  }

  /**
   * Build the OAuth authorization URL with PKCE parameters (port of
   * `_build_authorize_url`, `flow.py:606-635` — urlencode param order
   * locked: response_type, client_id, redirect_uri, state,
   * code_challenge, code_challenge_method).
   *
   * Scope is intentionally omitted — DCR creates apps with an empty
   * scope field, so the provider defaults to every scope
   * (`flow.py:624-626` comment ported).
   *
   * @param args - client id / redirect URI / challenge / state.
   * @returns The full authorization URL.
   */
  #buildAuthorizeUrl(args: {
    readonly clientId: string;
    readonly redirectUri: string;
    readonly challenge: string;
    readonly state: string;
  }): string {
    const params: Record<string, string> = {
      response_type: "code",
      client_id: args.clientId,
      redirect_uri: args.redirectUri,
      state: args.state,
      code_challenge: args.challenge,
      code_challenge_method: "S256",
    };
    return `${this.#baseUrl}authorize/?${urlEncodePairs(params)}`;
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
