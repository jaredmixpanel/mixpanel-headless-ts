/**
 * Popup-based PKCE login for pages that are themselves embedded (an
 * `<iframe>` in Notion, Confluence or an intranet portal). Mixpanel's
 * authorize page refuses to be framed, so the login runs in a top-level
 * popup, and the relay page at the redirect URI posts its own address
 * back to the opener. This is a different transport for the one string
 * the redirect flow already splits around: {@link loginInPopup} composes
 * {@link beginLogin} and {@link completeLogin} unchanged, and touches the
 * window only through the injected {@link PopupHost} seam.
 *
 * @remarks Divergence: Python waits on a loopback callback server with a
 * stdin paste fallback; the browser waits on a `postMessage` from its own
 * popup, with the redirect flow and the paste path as the fallbacks.
 * @see mixpanel_headless._internal.auth.flow.OAuthFlow.login
 */

import {
  CREDENTIAL_KEYS,
  OAuthError,
  type OAuthTokens,
} from "@mixpanel-headless/core";

import {
  BROWSER_POPUP_BLOCKED,
  BROWSER_POPUP_CLOSED,
  BrowserUnsupportedError,
} from "./errors.js";
import {
  beginLogin,
  type BeginLoginOptions,
  completeLogin,
} from "./redirect-flow.js";

/**
 * The `window.open` target name of the login popup. A constant, so
 * {@link relayPopupReturn} can tell the popup apart from a redirect-mode
 * return that happens to have an opener, and so the browser never holds
 * two of these windows at once (a repeat {@link loginInPopup} call is
 * refused before `open`, because the name is global to the page). Every
 * page the popup visits can read `window.name`, which is why it carries
 * nothing derived from the login.
 */
export const POPUP_WINDOW_NAME = "mixpanel-headless-login";

/**
 * The `type` field of the message the relay page posts to its opener.
 * Namespaced so other `postMessage` traffic on the page is ignored by
 * shape before anything else is looked at.
 */
export const POPUP_RETURN_MESSAGE_TYPE = "mixpanel-headless/oauth-return";

/**
 * Default time to wait for the popup to return, in milliseconds: five
 * minutes, the same budget Python gives its loopback callback server.
 *
 * @see mixpanel_headless._internal.auth.callback_server.start_callback_server
 */
export const DEFAULT_POPUP_TIMEOUT_MS: number = 300_000;

/**
 * The `window.open` features of the default popup: a real popup (not a
 * tab) sized for Mixpanel's login and consent pages.
 */
const DEFAULT_WINDOW_FEATURES = "popup=yes,width=520,height=760";

/**
 * How often the popup is polled for `closed`. No event fires when the
 * user closes a cross-origin popup, so polling is the only signal; half a
 * second keeps the "sign-in cancelled" feedback prompt without waking the
 * page needlessly.
 */
const CLOSE_POLL_INTERVAL_MS = 500;

/** The protocol version carried in every relay message. */
const MESSAGE_VERSION = 1;

/** The window the flow opened; the subset of `WindowProxy` it touches. */
export interface PopupWindowLike {
  /** `true` once the user (or the relay page) has closed the popup. */
  readonly closed: boolean;
  /** Close the popup. */
  close: () => void;
  /** Raise the popup, so a repeat click brings the existing one forward. */
  focus: () => void;
}

/**
 * The window surface {@link loginInPopup} needs — a thin wrapper over
 * the page's own `window` by default. Everything the flow does to the
 * page goes through this seam, so the browser test project (which runs
 * under Node with no DOM) drives it directly, and a reader can verify
 * that the library never reaches for `window` behind the caller's back.
 */
export interface PopupHost {
  /** The page's own origin (`location.origin`). */
  readonly origin: string;
  /**
   * Open the popup (`window.open`).
   *
   * @param url - The authorize URL.
   * @param name - The window name ({@link POPUP_WINDOW_NAME}).
   * @param features - The `window.open` features string.
   * @returns The popup, or `null` when a popup blocker refused it.
   */
  open: (url: string, name: string, features: string) => PopupWindowLike | null;
  /**
   * Subscribe to `message` events (`window.addEventListener`).
   *
   * @param type - Always `"message"`.
   * @param listener - The receiver.
   */
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent) => void,
  ) => void;
  /**
   * Unsubscribe from `message` events (`window.removeEventListener`).
   *
   * @param type - Always `"message"`.
   * @param listener - The receiver passed to `addEventListener`.
   */
  removeEventListener: (
    type: "message",
    listener: (event: MessageEvent) => void,
  ) => void;
  /**
   * Schedule a repeating callback (`window.setInterval`).
   *
   * @param fn - The callback.
   * @param ms - The period in milliseconds.
   * @returns An opaque handle for `clearInterval`.
   */
  setInterval: (fn: () => void, ms: number) => unknown;
  /**
   * Cancel a repeating callback (`window.clearInterval`).
   *
   * @param handle - The handle `setInterval` returned.
   */
  clearInterval: (handle: unknown) => void;
  /**
   * Schedule a one-shot callback (`window.setTimeout`).
   *
   * @param fn - The callback.
   * @param ms - The delay in milliseconds.
   * @returns An opaque handle for `clearTimeout`.
   */
  setTimeout: (fn: () => void, ms: number) => unknown;
  /**
   * Cancel a one-shot callback (`window.clearTimeout`).
   *
   * @param handle - The handle `setTimeout` returned.
   */
  clearTimeout: (handle: unknown) => void;
}

/** Options bag of {@link loginInPopup}. */
export interface PopupLoginOptions extends BeginLoginOptions {
  /**
   * How long to wait for the popup to return, in milliseconds, before
   * rejecting with `OAUTH_TIMEOUT`.
   *
   * @defaultValue {@link DEFAULT_POPUP_TIMEOUT_MS}
   */
  readonly timeoutMs?: number;
  /**
   * Caller cancellation. While the flow is waiting for the popup, an
   * abort closes the popup, discards the pending record and rejects
   * with the signal's reason, passed through untouched. Once the return
   * has arrived the exchange runs to completion.
   */
  readonly signal?: AbortSignal;
  /**
   * The `window.open` features string.
   *
   * @defaultValue `"popup=yes,width=520,height=760"`
   */
  readonly windowFeatures?: string;
  /**
   * The window seam.
   *
   * @defaultValue a thin wrapper over the page's own `window`
   */
  readonly host?: PopupHost;
  /**
   * Forwarded to {@link completeLogin}: the maximum accepted age of the
   * pending record at exchange time.
   *
   * @defaultValue {@link DEFAULT_MAX_PENDING_AGE_MS}
   */
  readonly maxPendingAgeMs?: number;
}

/** The subset of the opener window {@link relayPopupReturn} touches. */
interface OpenerLike {
  readonly closed?: unknown;
  readonly postMessage?: (message: unknown, targetOrigin: string) => void;
}

/** Options bag of {@link relayPopupReturn}. */
export interface RelayPopupReturnOptions {
  /**
   * The relay page's window.
   *
   * @defaultValue `globalThis.window`
   */
  readonly window?: Pick<Window, "name" | "opener" | "location">;
}

/**
 * Whether a popup login is running on this page. The guard is global,
 * not per store or region, because the popup window name is: a second
 * flow would navigate the first flow's popup away from its login and,
 * over the same store, race for the single pending record. The second
 * caller is refused up front instead of silently breaking the first.
 */
let popupLoginInFlight = false;

/**
 * The page's own `window`, looked up only when a flow starts, so
 * importing this module under Node (tests, server rendering) never
 * touches a DOM global.
 *
 * @returns The ambient window, or `undefined` outside a browser.
 */
function ambientWindow(): Window | undefined {
  return (globalThis as { readonly window?: Window }).window;
}

/**
 * Build the default {@link PopupHost} over the page's own `window`.
 *
 * @returns The host.
 * @throws {@link BrowserUnsupportedError} `BROWSER_POPUP_BLOCKED` (reason
 *   `no_window`) when there is no window to open a popup from.
 */
function ambientHost(): PopupHost {
  const w = ambientWindow();
  if (w === undefined) {
    throw new BrowserUnsupportedError(
      "loginInPopup needs a window to open the popup from and found none " +
        "— outside a browser page, pass `host`.",
      BROWSER_POPUP_BLOCKED,
      { reason: "no_window" },
    );
  }
  return {
    origin: w.location.origin,
    open: (url, name, features) => w.open(url, name, features),
    addEventListener: (type, listener) => {
      w.addEventListener(type, listener);
    },
    removeEventListener: (type, listener) => {
      w.removeEventListener(type, listener);
    },
    setInterval: (fn, ms) => w.setInterval(fn, ms),
    clearInterval: (handle) => {
      w.clearInterval(handle as number);
    },
    setTimeout: (fn, ms) => w.setTimeout(fn, ms),
    clearTimeout: (handle) => {
      w.clearTimeout(handle as number);
    },
  };
}

/**
 * Close the popup without letting the call fail the flow: a popup the
 * user already closed, or one still parked on a cross-origin page, may
 * throw from `close()`.
 *
 * @param popup - The popup.
 */
function closeQuietly(popup: PopupWindowLike): void {
  try {
    if (!popup.closed) {
      popup.close();
    }
  } catch {
    // Nothing to recover: the popup is either gone or out of reach.
  }
}

/**
 * Refuse a `redirectUri` on another origin before any network: the relay
 * posts to `location.origin`, so a redirect URI elsewhere could never
 * deliver its message here, and a page must not open a login it cannot
 * complete.
 *
 * @param redirectUri - The caller's redirect URI (already known to be an
 *   absolute URL only after {@link beginLogin}'s own gate, so an
 *   unparseable value is left for that gate to report).
 * @param pageOrigin - The page's own origin.
 * @throws {@link OAuthError} `OAUTH_CONFIG_ERROR` when the origins differ.
 */
function requireSameOrigin(redirectUri: string, pageOrigin: string): void {
  let origin: string;
  try {
    origin = new URL(redirectUri).origin;
  } catch {
    return;
  }
  if (origin !== pageOrigin) {
    throw new OAuthError(
      `The popup flow needs redirectUri on this page's own origin ` +
        `(${pageOrigin}); got ${JSON.stringify(origin)}. The relay page ` +
        "posts the return to its opener's origin only.",
      "OAUTH_CONFIG_ERROR",
      { field: "redirectUri", expected_origin: pageOrigin, origin },
    );
  }
}

/**
 * Read the return URL out of a `message` event, or `null` when the event
 * is not a relay message meant for this flow. The origin and source
 * checks are the security boundary (a hostile embedder, an ad frame or a
 * same-origin page in another tab can all call `postMessage`); the shape
 * check keeps unrelated traffic on the page out of the way.
 *
 * @param event - The `message` event.
 * @param popup - The popup this flow opened.
 * @param expectedOrigin - The redirect URI's origin.
 * @returns The relayed URL, or `null` to keep waiting.
 */
function readRelayedUrl(
  event: MessageEvent,
  popup: PopupWindowLike,
  expectedOrigin: string,
): string | null {
  if (event.origin !== expectedOrigin) {
    return null;
  }
  if (event.source !== popup) {
    return null;
  }
  const data: unknown = event.data;
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const message = data as Record<string, unknown>;
  if (
    message["type"] !== POPUP_RETURN_MESSAGE_TYPE ||
    message["v"] !== MESSAGE_VERSION ||
    typeof message["url"] !== "string"
  ) {
    return null;
  }
  return message["url"];
}

/**
 * The rejection for a relayed URL that is not the redirect URI.
 *
 * @param redirectUri - The caller's redirect URI.
 * @returns The coded error.
 */
function relayedUrlError(redirectUri: string): OAuthError {
  return new OAuthError(
    "The login popup relayed a return URL that is not the redirect URI — " +
      "start a fresh loginInPopup.",
    "OAUTH_PASTE_ERROR",
    { redirect_uri: redirectUri },
  );
}

/**
 * The rejection for a popup that did not return in time.
 *
 * @param timeoutMs - The budget that elapsed.
 * @returns The coded error.
 */
function timeoutError(timeoutMs: number): OAuthError {
  return new OAuthError(
    `No return from the login popup within ${String(timeoutMs)} ms.`,
    "OAUTH_TIMEOUT",
    { timeout_ms: timeoutMs },
  );
}

/**
 * The rejection for a popup the user closed before it returned.
 *
 * @returns The coded error.
 */
function closedError(): BrowserUnsupportedError {
  return new BrowserUnsupportedError(
    "The login popup was closed before it returned — sign in again to retry.",
    BROWSER_POPUP_CLOSED,
    { reason: "closed" },
  );
}

/** What the wait needs to know about the login it is waiting for. */
interface PopupWaitOptions {
  readonly host: PopupHost;
  readonly redirectUri: string;
  readonly state: string;
  readonly timeoutMs: number;
  readonly signal: AbortSignal | undefined;
}

/** The wait for the popup's return, started before the popup exists. */
interface PopupWaiter {
  /** Settles with the relayed return URL, or the coded rejection. */
  readonly returned: Promise<string>;
  /**
   * Hand over the popup `open` produced: from here on messages are
   * matched against it and it is polled for `closed`.
   *
   * @param popup - The popup.
   */
  attach: (popup: PopupWindowLike) => void;
  /** Tear down without settling, when no popup could be opened. */
  abandon: () => void;
}

/**
 * Start waiting for the popup to relay its return URL. The `message`
 * subscription, the timeout and the abort hook are installed at once —
 * before the caller opens anything — and the popup is attached as soon
 * as `open` returns, so a message is matched against the exact window
 * the flow opened. The promise resolves with the URL when a message
 * passes every gate; it rejects when the popup is closed first, the
 * timeout elapses, the caller aborts, or the relay posts a URL that is
 * not the redirect URI. Every subscription and timer is torn down
 * before it settles.
 *
 * @param wait - The expectations and the seams.
 * @returns The waiter.
 * @throws {@link BrowserUnsupportedError} `BROWSER_POPUP_CLOSED` (via
 *   the promise) when the popup closes before returning.
 * @throws {@link OAuthError} (via the promise) `OAUTH_TIMEOUT` after
 *   `timeoutMs`; `OAUTH_PASTE_ERROR` for a relayed URL that is not the
 *   redirect URI.
 */
function startPopupWait(wait: PopupWaitOptions): PopupWaiter {
  const { host, redirectUri, state, timeoutMs, signal } = wait;
  // Compared field by field, never as a string prefix: the browser
  // normalizes `location.href` (lowercase host, default port dropped,
  // dot segments resolved), so a prefix test would refuse a legitimate
  // return for a constant like `https://App.Example.com/cb` and accept
  // `/cb.evil` or `/cb/../x`.
  const want = new URL(redirectUri);
  const expectedOrigin = want.origin;
  let popup: PopupWindowLike | null = null;
  const timers: { poll?: unknown; timeout?: unknown; closed?: unknown } = {};
  let settled = false;
  let resolveReturned!: (url: string) => void;
  let rejectReturned!: (reason: unknown) => void;
  const returned = new Promise<string>((resolve, reject) => {
    resolveReturned = resolve;
    rejectReturned = reject;
  });
  // The flow always awaits `returned`, but a rejection that lands after
  // the caller has already thrown (open failed, aborted meanwhile) must
  // not surface as an unhandled rejection; awaiters still see it.
  void returned.catch(() => undefined);

  const cleanup = (): void => {
    host.removeEventListener("message", onMessage);
    host.clearInterval(timers.poll);
    host.clearTimeout(timers.timeout);
    host.clearTimeout(timers.closed);
    signal?.removeEventListener("abort", onAbort);
  };
  const settle = (outcome: () => void): void => {
    if (settled) {
      return;
    }
    settled = true;
    cleanup();
    outcome();
  };
  const onAbort = (): void => {
    settle(() => {
      rejectReturned(signal?.reason);
    });
  };
  const onMessage = (event: MessageEvent): void => {
    if (popup === null) {
      return;
    }
    const url = readRelayedUrl(event, popup, expectedOrigin);
    if (url === null) {
      return;
    }
    let got: URL | null;
    try {
      got = new URL(url);
    } catch {
      got = null;
    }
    if (got?.origin !== want.origin || got.pathname !== want.pathname) {
      // Only a bug or an attack makes the relay post an address other
      // than its own: a malformed return, in the redirect flow's terms.
      settle(() => {
        rejectReturned(relayedUrlError(redirectUri));
      });
      return;
    }
    // Defence in depth ahead of completeLogin's own state check: a relay
    // whose state does not match is left alone (the real return may
    // still arrive), except when it carries the provider's `error=` — a
    // denial must surface at once, not after the timeout.
    const params = got.searchParams;
    if (params.get("state") !== state && !params.has("error")) {
      return;
    }
    settle(() => {
      resolveReturned(url);
    });
  };

  host.addEventListener("message", onMessage);
  timers.timeout = host.setTimeout(() => {
    settle(() => {
      rejectReturned(timeoutError(timeoutMs));
    });
  }, timeoutMs);
  if (signal !== undefined) {
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener("abort", onAbort);
    }
  }

  return {
    returned,
    attach: (opened) => {
      popup = opened;
      timers.poll = host.setInterval(() => {
        if (!opened.closed) {
          return;
        }
        // The relay posts its message and then closes itself, so
        // `closed` can be observed while that message is still queued.
        // Deferring the rejection by one task lets the message win.
        host.clearInterval(timers.poll);
        timers.closed = host.setTimeout(() => {
          settle(() => {
            rejectReturned(closedError());
          });
        }, 0);
      }, CLOSE_POLL_INTERVAL_MS);
    },
    abandon: () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
    },
  };
}

/**
 * The body of {@link loginInPopup} once the in-flight slot is held:
 * begin, open, wait, complete. A rejection that cannot be completed
 * later (closed, timed out, aborted) discards the pending record, so
 * nothing redeemable is left behind. A blocked popup keeps it: the
 * documented fallback is the authorize link plus a paste box that calls
 * {@link completeLogin} on the same store, which needs the record (still
 * bounded by the age gate). The relay-URL parse failure keeps it too, as
 * the redirect flow's parse failures do — and so does a provider
 * `error=` return (`OAUTH_AUTH_DENIED`), because {@link completeLogin}
 * fails its parse step before its delete step, exactly as in the
 * redirect flow; the next `loginInPopup` overwrites it.
 *
 * @param options - The caller's options.
 * @param host - The resolved window seam.
 * @returns The obtained tokens.
 * @throws {@link BrowserUnsupportedError} `BROWSER_POPUP_BLOCKED` when
 *   `open` returns `null`; `BROWSER_POPUP_CLOSED` when the popup closes
 *   before returning.
 * @throws {@link OAuthError} `OAUTH_TIMEOUT`, `OAUTH_PASTE_ERROR`, or
 *   anything {@link beginLogin} and {@link completeLogin} throw.
 */
async function runPopupLogin(
  options: PopupLoginOptions,
  host: PopupHost,
): Promise<OAuthTokens> {
  const pendingKey = CREDENTIAL_KEYS.pendingLogin(options.region);
  const { authorizeUrl, state } = await beginLogin(options);

  // A cancellation during the DCR round trip lands here: the record was
  // just written, so it is removed before anything is opened.
  if (options.signal?.aborted === true) {
    await options.store.delete(pendingKey);
    throw options.signal.reason;
  }

  // Subscribed before `open`, so nothing the popup posts can be missed.
  const waiter = startPopupWait({
    host,
    redirectUri: options.redirectUri,
    state,
    timeoutMs: options.timeoutMs ?? DEFAULT_POPUP_TIMEOUT_MS,
    signal: options.signal,
  });
  let popup: PopupWindowLike | null;
  try {
    popup = host.open(
      authorizeUrl,
      POPUP_WINDOW_NAME,
      options.windowFeatures ?? DEFAULT_WINDOW_FEATURES,
    );
    if (popup !== null) {
      waiter.attach(popup);
      popup.focus();
    }
  } catch (error) {
    // A throwing `open` (a sandboxed frame, a host seam that refuses)
    // must not leave the subscription and timers behind.
    waiter.abandon();
    throw error;
  }
  if (popup === null) {
    waiter.abandon();
    // The pending record stays: the caller's fallback is a link to
    // `authorize_url` and a paste box that completes on the same store.
    throw new BrowserUnsupportedError(
      "The browser refused to open the login popup (a popup blocker, or a " +
        "call outside a user gesture). Offer the authorize URL as a link " +
        "and complete the login with completeLogin.",
      BROWSER_POPUP_BLOCKED,
      { reason: "blocked", authorize_url: authorizeUrl, state },
    );
  }

  let returnUrl: string;
  try {
    returnUrl = await waiter.returned;
  } catch (error) {
    closeQuietly(popup);
    if (!(error instanceof OAuthError && error.code === "OAUTH_PASTE_ERROR")) {
      try {
        await options.store.delete(pendingKey);
      } catch {
        // The coded outcome (closed, timed out, aborted) is the one the
        // caller must see; a store that cannot delete is not allowed to
        // mask it, and the record stays bounded by the age gate.
      }
    }
    throw error;
  }

  try {
    return await completeLogin({
      region: options.region,
      returnUrl,
      store: options.store,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.maxPendingAgeMs === undefined
        ? {}
        : { maxPendingAgeMs: options.maxPendingAgeMs }),
    });
  } finally {
    // The relay page closes itself; this covers a relay that could not.
    closeQuietly(popup);
  }
}

/**
 * Sign in through a popup: 1. refuse a `redirectUri` on another origin
 * 2. refuse a second flow while one is already running on the page
 * 3. {@link beginLogin} 4. open the authorize URL in a popup
 * named {@link POPUP_WINDOW_NAME} 5. wait for the relay page at the
 * redirect URI to post its address back ({@link relayPopupReturn}),
 * checking the message's origin, source, shape, URL and state
 * 6. {@link completeLogin} with that URL 7. close the popup. Only the
 * return URL ever crosses the window boundary: the verifier stays in
 * this page's store, and the tokens never leave it.
 *
 * The page may itself be framed by a third-party site; the popup is a
 * top-level window, which is what Mixpanel's login page requires. The
 * in-memory default store is enough here — nothing navigates away.
 *
 * @param options - Region / redirect URI / store / popup seams.
 * @returns The obtained tokens (also persisted under
 *   `CREDENTIAL_KEYS.tokens(region)`).
 * @throws {@link OAuthError} `OAUTH_CONFIG_ERROR` when `redirectUri` is
 *   not on the page's origin (or fails {@link beginLogin}'s own gates),
 *   `OAUTH_TIMEOUT` when the popup does not return within
 *   {@link PopupLoginOptions.timeoutMs}, `OAUTH_PASTE_ERROR` when the
 *   relay posts a URL outside the redirect URI, and every
 *   {@link completeLogin} code (`OAUTH_AUTH_DENIED` when the user
 *   declines consent).
 * @throws {@link BrowserUnsupportedError} `BROWSER_POPUP_BLOCKED` when
 *   the popup could not be opened (`details.reason` is `"blocked"`,
 *   `"in_flight"` for a second concurrent call, or `"no_window"` outside
 *   a browser page); for `"blocked"` the pending record is kept and
 *   `details.authorize_url` / `details.state` let the page offer the
 *   link-and-paste fallback ({@link completeLogin} on the same store).
 *   `BROWSER_POPUP_CLOSED` when the user closes the popup before it
 *   returns; closed, timed-out and aborted logins discard the record.
 * @example
 * ```typescript
 * const store = new InMemoryCredentialStore();
 * try {
 *   const tokens = await loginInPopup({
 *     region: "us",
 *     redirectUri: `${location.origin}/oauth/callback`, // constant!
 *     store,
 *   });
 * } catch (error) {
 *   if (
 *     error instanceof BrowserUnsupportedError &&
 *     error.code === BROWSER_POPUP_BLOCKED
 *   ) {
 *     // Offer the authorize URL as a link and a paste box for the
 *     // return URL (completeLogin) instead.
 *   }
 * }
 * ```
 * @see mixpanel_headless._internal.auth.flow.OAuthFlow.login
 */
export async function loginInPopup(
  options: PopupLoginOptions,
): Promise<OAuthTokens> {
  const host = options.host ?? ambientHost();
  requireSameOrigin(options.redirectUri, host.origin);
  if (options.signal?.aborted === true) {
    // Nothing has been registered or written yet, so an already-cancelled
    // call costs no network and leaves nothing behind.
    throw options.signal.reason;
  }

  if (popupLoginInFlight) {
    throw new BrowserUnsupportedError(
      "A popup login is already running on this page — wait for it to " +
        "settle rather than starting a second one.",
      BROWSER_POPUP_BLOCKED,
      { reason: "in_flight" },
    );
  }
  popupLoginInFlight = true;
  try {
    return await runPopupLogin(options, host);
  } finally {
    popupLoginInFlight = false;
  }
}

/**
 * On the redirect-URI page: if this document is the popup
 * {@link loginInPopup} opened, post the page's own address to the
 * opener and return `true` (the page should close itself or say "you
 * can close this window"); otherwise return `false` so the page runs
 * its redirect-mode {@link completeLogin} instead. Dependency-free and
 * safe to call on any page, including outside a browser.
 *
 * The message is exactly `{ type, v, url }` — the relay never parses,
 * stores or logs the return; the code in it is useless without the
 * verifier the opener holds. It is posted to `location.origin` only,
 * which {@link loginInPopup} proved is the opener's origin before it
 * opened anything.
 *
 * @param options - The relay page's window seam.
 * @returns `true` when the return was relayed to the opener.
 * @example
 * ```typescript
 * // On the redirect-URI page, before the redirect-mode completion:
 * if (relayPopupReturn()) {
 *   window.close();
 * } else {
 *   const tokens = await completeLogin({ region, returnUrl: location.href, store });
 * }
 * ```
 */
export function relayPopupReturn(options?: RelayPopupReturnOptions): boolean {
  const w = options?.window ?? ambientWindow();
  if (w?.name !== POPUP_WINDOW_NAME) {
    return false;
  }
  // `Window["opener"]` is typed `any`; it is narrowed by hand because a
  // severed opener (Electron, a future COOP header) shows up as `null`.
  const opener = w.opener as OpenerLike | null | undefined;
  if (
    !opener ||
    opener.closed === true ||
    typeof opener.postMessage !== "function"
  ) {
    return false;
  }
  try {
    opener.postMessage(
      {
        type: POPUP_RETURN_MESSAGE_TYPE,
        v: MESSAGE_VERSION,
        url: w.location.href,
      },
      w.location.origin,
    );
  } catch {
    // An opaque origin ("null" — a sandboxed or file: document) is not a
    // valid target, so the page falls through to its paste fallback.
    return false;
  }
  return true;
}
