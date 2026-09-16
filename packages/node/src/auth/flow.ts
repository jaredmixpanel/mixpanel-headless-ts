/**
 * OAuth 2.0 Authorization Code + PKCE flow orchestrator: the interactive
 * login (callback server, port probe, browser launch, stdin paste), the
 * code exchange and the refresh path. The fetch-pure halves
 * (`parsePastedRedirect`, `buildAuthorizeUrl`, `postTokenRequest`) live
 * in core; this module owns the node-only surfaces and `OAuthStorage`.
 *
 * Python's module monkeypatch surfaces (`flow.webbrowser`,
 * `flow.start_callback_server`, `flow.ensure_client_registered`) become
 * injected {@link OAuthFlowOptions} seams (`openBrowser`,
 * `startCallbackServer`, `registerClient`), so nothing is launched at
 * module scope. The port probe is async because `net.Server.listen` has
 * no sync form; its two-phase probe-then-bind shape is kept verbatim and
 * the TOCTOU window between the two is Python's own. Python's two racing
 * completer threads (callback server and stdin paste reader) become
 * racing promises, and the loser is canceled via an `AbortSignal` where
 * Python leaks a daemon thread; node's event loop would otherwise never
 * drain, and the loser's outcome is discarded in both runtimes.
 *
 * Response bodies are parsed via `parseLossless`, never
 * `response.json()`, so large integers survive; the form body keeps
 * Python's dict insertion order because the wire vectors lock the text.
 *
 * @see mixpanel_headless._internal.auth.flow
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { createInterface } from "node:readline";

import {
  buildAuthorizeUrl,
  type CallbackResult,
  type OAuthClientInfo,
  OAuthError,
  type OAuthTokens,
  parsePastedRedirect,
  PkceChallenge,
  postTokenRequest,
} from "@mixpanel-headless/core";
import {
  exceptionMessage,
  requireOAuthBaseUrl,
} from "@mixpanel-headless/core/internal";

import {
  CALLBACK_PORTS,
  startCallbackServer,
  type StartCallbackServerOptions,
} from "./callback-server.js";
import {
  ensureClientRegistered,
  type EnsureClientRegisteredOptions,
} from "./client-registration.js";
import { OAuthStorage } from "./storage.js";

/** Options bag of {@link OAuthFlow} (the Python kwargs plus seams). */
export interface OAuthFlowOptions {
  /**
   * Mixpanel data residency region.
   *
   * @defaultValue `"us"`
   */
  readonly region?: string | undefined;
  /**
   * Storage for cached tokens and client info.
   *
   * @defaultValue the on-disk `OAuthStorage`
   */
  readonly storage?: OAuthStorage | undefined;
  /**
   * Injected fetch (the `http_client` seam).
   *
   * @defaultValue the global `fetch`
   */
  readonly fetchImpl?: typeof fetch | undefined;
  /**
   * Epoch-ms clock seam threaded into `fromTokenResponse` and the
   * `isExpired` checks.
   *
   * @defaultValue the ambient clock
   */
  readonly now?: (() => number) | undefined;
  /**
   * Browser-launch effect for {@link OAuthFlow.login} (the
   * `webbrowser.open` seam). A throw here is wrapped into
   * `OAUTH_BROWSER_ERROR`.
   *
   * @defaultValue a best-effort platform launcher (`open` / `rundll32` / `xdg-open`)
   */
  readonly openBrowser?: ((url: string) => void | Promise<void>) | undefined;
  /**
   * Callback-server seam (the `flow.start_callback_server` monkeypatch
   * twin).
   *
   * @defaultValue the real localhost server
   */
  readonly startCallbackServer?:
    | ((
        options: StartCallbackServerOptions,
      ) => Promise<readonly [CallbackResult, number]>)
    | undefined;
  /**
   * DCR seam (the `flow.ensure_client_registered` monkeypatch twin).
   *
   * @defaultValue the real `ensureClientRegistered`
   */
  readonly registerClient?:
    | ((options: EnsureClientRegisteredOptions) => Promise<OAuthClientInfo>)
    | undefined;
  /**
   * Port-probe seam (`_find_available_port`).
   *
   * @defaultValue the real bind-and-release probe over `CALLBACK_PORTS`
   */
  readonly findAvailablePort?: (() => Promise<number | null>) | undefined;
  /**
   * Stdin paste-reader seam (`sys.stdin.readline()`). Resolves one
   * line; the `signal` aborts the read when the other completer wins.
   *
   * @defaultValue a `process.stdin` line reader
   */
  readonly readStdinLine?:
    ((signal: AbortSignal) => Promise<string>) | undefined;
  /**
   * Stderr writer for the `open_browser=False` URL banner (Python's
   * `print(..., file=sys.stderr)`).
   *
   * @defaultValue `process.stderr.write`
   */
  readonly stderr?: ((text: string) => void) | undefined;
}

/** Keyword-only options of {@link OAuthFlow.login}. */
export interface LoginOptions {
  /**
   * When `true`, persist the resulting tokens to the legacy region-keyed
   * layout (`~/.mp/oauth/tokens_{region}.json` via
   * `OAuthStorage.saveTokens`). The account orchestrator persists via
   * `TokenStore.writeTokens` itself and leaves this off.
   *
   * @defaultValue `false`
   */
  readonly persist?: boolean | undefined;
  /**
   * When `true`, launch the browser to the authorize URL. When `false`,
   * print the URL to stderr and add the stdin paste completer; the
   * callback server listens either way.
   *
   * @defaultValue `true`
   */
  readonly openBrowser?: boolean | undefined;
}

/** Keyword-only options of {@link OAuthFlow.refreshTokens}. */
export interface RefreshTokensOptions {
  /**
   * When supplied, embedded in error messages and details so the user
   * knows which `mp account login NAME` to re-run.
   */
  readonly accountName?: string | null | undefined;
}

/**
 * Probe `CALLBACK_PORTS` for one that is not currently in use:
 * bind and immediately release each candidate on 127.0.0.1, in port
 * order. Async where Python is sync (see the module header).
 *
 * @returns The first available port, or `null` when all are occupied.
 * @example
 * ```ts
 * const port = await findAvailablePort();
 * if (port === null) throw new OAuthError("all ports busy", "OAUTH_PORT_ERROR");
 * ```
 * @see mixpanel_headless._internal.auth.flow._find_available_port
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

/** A platform browser-launch command, ready for `spawn(command, args)`. */
export interface BrowserLaunchArgv {
  /** The executable to spawn. */
  readonly command: string;
  /** Its argv (the URL is always exactly one element, verbatim). */
  readonly args: readonly string[];
}

/**
 * Build the argv behind the default {@link OAuthFlowOptions.openBrowser}
 * (the `webbrowser.open` twin per platform). Exported so the command
 * shape is unit-testable on every platform from one host.
 *
 * @remarks
 * win32 goes through ShellExecute via `rundll32 url.dll,FileProtocolHandler`,
 * the `os.startfile` path CPython's `webbrowser` takes on Windows. Never
 * `cmd /c start "" url`: `spawn()` (no `shell`) passes a whitespace-free
 * argument verbatim and cmd.exe then splits it at every `&` (and expands
 * `%`), so the authorize URL would reach the browser truncated to
 * `?response_type=code` with the remaining query pairs run as commands.
 * @param platform - `process.platform`.
 * @param url - The authorize URL to open.
 * @returns The command and argv to spawn.
 * @example
 * ```ts
 * const { command, args } = browserLaunchArgv(process.platform, authorizeUrl);
 * spawn(command, [...args], { stdio: "ignore", detached: true }).unref();
 * ```
 */
export function browserLaunchArgv(
  platform: NodeJS.Platform,
  url: string,
): BrowserLaunchArgv {
  if (platform === "darwin") {
    return { command: "open", args: [url] };
  }
  if (platform === "win32") {
    return {
      command: "rundll32",
      args: ["url.dll,FileProtocolHandler", url],
    };
  }
  return { command: "xdg-open", args: [url] };
}

/**
 * Best-effort platform browser launcher (the `webbrowser.open` twin).
 * Launch failures after spawn are swallowed like `webbrowser.open`
 * returning `False`; only a synchronous spawn error propagates.
 *
 * @param url - The authorize URL to open.
 */
function defaultOpenBrowser(url: string): void {
  const { command, args } = browserLaunchArgv(process.platform, url);
  const child = spawn(command, [...args], {
    stdio: "ignore",
    detached: true,
  });
  child.on("error", () => {
    // An async launch failure is `webbrowser.open` returning False;
    // Python does not raise for that either.
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
 * Millisecond sleep (the `time.sleep(0.1)` twin).
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
 * Orchestrator for the OAuth 2.0 Authorization Code + PKCE flow:
 * interactive login, code exchange and token refresh for one region.
 *
 * @example
 * ```ts
 * const flow = new OAuthFlow({ region: "us", storage, fetchImpl });
 * const fresh = await flow.refreshTokens(tokens, "my-client-id");
 * ```
 * @see mixpanel_headless._internal.auth.flow.OAuthFlow
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

  /** Region base URL (`requireOAuthBaseUrl(region)`). */
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
   * Initialize the flow orchestrator.
   *
   * @param options - Region and injected seams.
   * @throws {@link OAuthError} - `OAUTH_CONFIG_ERROR` for a region
   *   outside `OAUTH_BASE_URLS`.
   */
  constructor(options: OAuthFlowOptions = {}) {
    const region = options.region ?? "us";
    // The region gate runs before any other wiring, as in Python.
    this.#baseUrl = requireOAuthBaseUrl(region);
    this.#region = region;
    this.#storage = options.storage ?? new OAuthStorage();
    this.#fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.#now = options.now ?? Date.now;
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
   * Read the Mixpanel data residency region.
   *
   * @returns The region string (`us`, `eu`, or `in`).
   */
  get region(): string {
    return this.#region;
  }

  /**
   * Return a valid access token, refreshing if expired. Refreshed
   * tokens are persisted via the legacy region-keyed storage path
   * (`storage.save_tokens`), not the per-account layout.
   *
   * @param region - Mixpanel region for the storage lookup.
   * @returns A valid OAuth access token string (no `Bearer` prefix).
   * @throws {@link OAuthError} - `OAUTH_TOKEN_ERROR` when no tokens
   *   exist; `OAUTH_REFRESH_ERROR` when client info is missing or the
   *   refresh fails; `OAUTH_REFRESH_REVOKED` on `invalid_grant`.
   * @see mixpanel_headless._internal.auth.flow.OAuthFlow.get_valid_token
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
   * Execute the full interactive OAuth PKCE login flow, in Python's step
   * order: PKCE and state, port probe, DCR, authorize URL, the two racing
   * completers (callback server always; stdin paste reader only when
   * `openBrowser` is `false`), exchange, optional persist.
   *
   * @param options - `persist` and `openBrowser` (see {@link LoginOptions}).
   * @returns The obtained tokens (access plus optional refresh).
   * @throws {@link OAuthError} - Any step fails: all ports busy
   *   (`OAUTH_PORT_ERROR`), registration, browser launch
   *   (`OAUTH_BROWSER_ERROR`), callback or paste errors, timeout
   *   (`OAUTH_TIMEOUT`), or token exchange (`OAUTH_TOKEN_ERROR`).
   * @example
   * ```ts
   * const flow = new OAuthFlow({ region: "us" });
   * const tokens = await flow.login({ openBrowser: false });
   * ```
   * @see mixpanel_headless._internal.auth.flow.OAuthFlow.login
   */
  async login(options: LoginOptions = {}): Promise<OAuthTokens> {
    const persist = options.persist ?? false;
    const openBrowser = options.openBrowser ?? true;

    // Step 1: PKCE challenge and state (`secrets.token_urlsafe(32)` is
    // 32 random bytes, base64url without padding). `generate()` awaits
    // WebCrypto's `crypto.subtle.digest`; generation still precedes all
    // I/O, as in Python.
    const pkce = await PkceChallenge.generate();
    const state = randomBytes(32).toString("base64url");

    // Step 2: find an available callback port by probing before binding.
    const boundPort = await this.#findAvailablePort();
    if (boundPort === null) {
      throw new OAuthError(
        `All OAuth callback ports ([${CALLBACK_PORTS.join(", ")}]) are busy.`,
        "OAUTH_PORT_ERROR",
      );
    }

    // `localhost` on purpose, not RFC 8252 §7.3's loopback literal
    // (`127.0.0.1`): Mixpanel's redirect_uri allow-list is
    // `http://localhost:<port>/`, DCR registrations are keyed on this
    // exact string, and Python pins it. The server binds 127.0.0.1 only;
    // nothing listens on ::1, so an IPv6-first browser gets a refused
    // connect and falls back at once, without a stall.
    const redirectUri = `http://localhost:${boundPort}/callback`;

    // Step 3: ensure client registration.
    const clientInfo = await this.#registerClient({
      fetchImpl: this.#fetchImpl,
      region: this.#region,
      redirectUri,
      storage: this.#storage,
      now: this.#now,
    });

    // Step 4: build the authorize URL.
    const authorizeUrl = this.#buildAuthorizeUrl({
      clientId: clientInfo.client_id,
      redirectUri,
      challenge: pkce.challenge,
      state,
    });

    // Step 5: two completers race on a shared result slot: the callback
    // server (always) and the stdin paste reader (only when
    // `openBrowser` is false). Whichever produces a valid (code, state)
    // first wins; the PKCE verifier stays in this process. The first
    // completer error is retained but only surfaced after the result
    // wait expires, matching Python's `error_q` consultation order.
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
        } catch (error) {
          recordError(error);
        }
      }, recordError);
    }

    // Small delay so the callback server is listening before the
    // browser opens or the URL prints.
    await sleep(100);

    if (openBrowser) {
      try {
        await this.#openBrowser(authorizeUrl);
      } catch (error) {
        abort.abort();
        throw new OAuthError(
          `Could not open browser for authorization: ${exceptionMessage(error)}`,
          "OAUTH_BROWSER_ERROR",
          { authorize_url: authorizeUrl },
          { cause: error },
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
    // 310 s; `null` means the wait expired (the `queue.Empty` twin).
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
        `Callback / paste error: ${exceptionMessage(firstError)}`,
        "OAUTH_TOKEN_ERROR",
        {},
        { cause: firstError },
      );
    }
    // Divergence: Python leaks the losing completer's daemon thread (it dies with the process); TS cancels it through the AbortSignal so the event loop can drain. The loser's outcome is discarded in both runtimes.
    abort.abort();

    // Step 7: exchange code for tokens.
    const tokens = await this.exchangeCode(
      winner.code,
      pkce.verifier,
      clientInfo.client_id,
      redirectUri,
    );

    // Step 8: save tokens (legacy region-keyed layout) when the caller
    // opts in.
    if (persist) {
      this.#storage.saveTokens(tokens, this.#region);
    }

    return tokens;
  }

  /**
   * Exchange an authorization code for OAuth tokens.
   *
   * @param code - The authorization code from the callback.
   * @param verifier - The PKCE code verifier.
   * @param clientId - The registered OAuth client ID.
   * @param redirectUri - The redirect URI used in the authorization
   *   request.
   * @returns The obtained tokens.
   * @throws {@link OAuthError} - The exchange fails (`OAUTH_TOKEN_ERROR`
   *   on every classifier branch; `invalid_grant` stays generic for the
   *   exchange operation).
   * @example
   * ```ts
   * const tokens = await flow.exchangeCode(
   *   "auth-code",
   *   "pkce-verifier",
   *   "my-client",
   *   "http://localhost:19284/callback",
   * );
   * ```
   * @see mixpanel_headless._internal.auth.flow.OAuthFlow.exchange_code
   */
  async exchangeCode(
    code: string,
    verifier: string,
    clientId: string,
    redirectUri: string,
  ): Promise<OAuthTokens> {
    // Form body in Python dict insertion order.
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
   * Build the OAuth authorization URL with PKCE parameters; the
   * urlencode param order is locked (response_type, client_id,
   * redirect_uri, state, code_challenge, code_challenge_method). Scope
   * is intentionally omitted: DCR creates apps with an empty scope
   * field, so the provider defaults to every scope.
   *
   * @param args - The `clientId`, `redirectUri`, PKCE `challenge` and
   *   `state` to encode.
   * @returns The full authorization URL.
   * @see mixpanel_headless._internal.auth.flow.OAuthFlow._build_authorize_url
   */
  #buildAuthorizeUrl(args: {
    readonly clientId: string;
    readonly redirectUri: string;
    readonly challenge: string;
    readonly state: string;
  }): string {
    return buildAuthorizeUrl(this.#baseUrl, args);
  }

  /**
   * Refresh OAuth tokens using a refresh token.
   *
   * @param tokens - Current tokens carrying the refresh token.
   * @param clientId - The OAuth client ID.
   * @param options - Optional `accountName` for error messages.
   * @returns New tokens with a fresh access token.
   * @throws {@link OAuthError} - `OAUTH_REFRESH_ERROR` when no refresh
   *   token is available or the request fails transiently;
   *   `OAUTH_REFRESH_REVOKED` when the IdP rejects the token as
   *   `invalid_grant`.
   * @see mixpanel_headless._internal.auth.flow.OAuthFlow.refresh_tokens
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
        // Two detail shapes, ported verbatim.
        accountName !== null && accountName !== ""
          ? { account_name: accountName }
          : {},
      );
    }
    // Form body in Python dict insertion order; the wire vectors lock
    // the body text.
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
   * POST form data to the token endpoint and parse the response; shared
   * by refresh and exchange.
   *
   * @param formData - Form-encoded body (insertion order preserved).
   * @param context - The `operation` name for messages, the `errorCode`
   *   to raise with, and the optional `accountName` for hints.
   * @returns Parsed tokens from the endpoint response.
   * @throws {@link OAuthError} - Every branch of the vector-locked
   *   classifier.
   * @see mixpanel_headless._internal.auth.flow.OAuthFlow._post_token_request
   */
  async #postTokenRequest(
    formData: Record<string, string>,
    context: {
      operation: string;
      errorCode: string;
      accountName: string | null;
    },
  ): Promise<OAuthTokens> {
    return postTokenRequest(this.#fetchImpl, this.#baseUrl, formData, {
      ...context,
      now: this.#now,
    });
  }
}
