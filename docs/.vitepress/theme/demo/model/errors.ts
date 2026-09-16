// Library errors mapped to the playground's copy. Programs key on the
// error class and its `.code`, never on message text; the message shown
// is ours, the library's redacted `details` stay behind a disclosure.
// Fatal errors end the live session and name the state to retry from;
// everything else renders inline under the result.

import {
  AuthenticationError,
  BROWSER_NO_PENDING_LOGIN,
  BROWSER_POPUP_BLOCKED,
  BROWSER_POPUP_CLOSED,
  BrowserUnsupportedError,
  ConfigError,
  EventNotFoundError,
  MixpanelHeadlessError,
  OAuthError,
  QueryError,
  RateLimitError,
  ServerError,
} from "@mixpanel-headless/browser";

import type { DemoError, ErrorRetry } from "./session-state.js";

/** What the copy needs beyond the error itself. */
export interface ErrorContext {
  /** The build's redirect URI, quoted in the config-error copy. */
  readonly redirectUri?: string;
  /** The session's `expires_at`, quoted in the expiry copy. */
  readonly expiresAt?: string;
}

const FIXTURE_MISS = /^demo fixture miss: (.+)$/u;

const NO_PENDING_LOGIN_MESSAGE =
  "No sign-in in progress in this tab (it may have expired — 30 minutes — or this URL was opened in a new tab). Start again.";

/** Shown in the framed pending card when `window.open` returned nothing. */
export const POPUP_BLOCKED_MESSAGE =
  "Your browser blocked the sign-in window. Try again from the button below (a direct click usually gets through), or open the sign-in page in a new tab and paste the address of the page you land on.";
/** The quiet notice after the visitor closed the popup before it returned. */
export const POPUP_CANCELED_NOTICE = "Sign-in canceled.";
/** The quiet notice after the popup did not return within its budget. */
export const POPUP_TIMEOUT_NOTICE =
  "The sign-in window did not return within five minutes. Try again.";

/**
 * What the framed page does with a `loginInPopup` rejection: keep the
 * pending card up with the fallback link (the browser refused the popup;
 * the pending record is kept for the paste box), keep waiting (a repeat
 * click while the popup is open, which has already focused it), drop
 * back to signed-out with a quiet notice (closed, timed out), or end the
 * attempt with the error block (everything the redirect flow can fail
 * with too).
 */
export type PopupLoginOutcome =
  | { readonly kind: "blocked"; readonly authorizeUrl: string }
  | { readonly kind: "in-flight" }
  | { readonly kind: "signed-out"; readonly notice: string }
  | { readonly kind: "error"; readonly error: DemoError };

/**
 * `hh:mm` of an ISO instant in the visitor's locale.
 *
 * @param iso - Timezone-aware ISO-8601 text.
 * @returns The local wall-clock time, or the raw text when unparsable.
 */
export function clockTime(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms)
    ? iso
    : new Date(ms).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });
}

/**
 * The library's `details` when it says something, else `null` (the
 * disclosure button is hidden for an empty bag).
 *
 * @param error - A library error.
 * @returns The bag or `null`.
 */
function detailsOf(
  error: MixpanelHeadlessError,
): Readonly<Record<string, unknown>> | null {
  const bag = error.details;
  return Object.keys(bag).length > 0 ? bag : null;
}

/**
 * The HTTP status a library error reports: `statusCode` on the API
 * errors, `details.status_code` on the `/me` service's `ConfigError`.
 *
 * @param error - The library error.
 * @returns The status, or `null`.
 */
function statusOf(error: MixpanelHeadlessError): number | null {
  const own = (error as { statusCode?: unknown }).statusCode;
  if (typeof own === "number") {
    return own;
  }
  const fromDetails = error.details["status_code"];
  return typeof fromDetails === "number" ? fromDetails : null;
}

/**
 * Build a `DemoError` for a library error with our message.
 *
 * @param error - The library error.
 * @param message - The user-facing copy.
 * @param retry - The state to retry from; `null` keeps the error inline.
 * @returns The mapped error.
 */
function mapped(
  error: MixpanelHeadlessError,
  message: string,
  retry: ErrorRetry | null,
): DemoError {
  return {
    code: error.code,
    className: error.name,
    message,
    statusCode: statusOf(error),
    details: detailsOf(error),
    fatal: retry !== null,
    retry,
  };
}

/**
 * The copy for a callback page opened without a sign-in in progress —
 * the same words `completeLogin`'s `BROWSER_NO_PENDING_LOGIN` gets, built
 * without calling the library.
 *
 * @returns The error as the callback page shows it.
 */
export function noPendingLoginError(): DemoError {
  return {
    code: BROWSER_NO_PENDING_LOGIN,
    className: "BrowserUnsupportedError",
    message: NO_PENDING_LOGIN_MESSAGE,
    statusCode: null,
    details: null,
    fatal: true,
    retry: "signed-out",
  };
}

/**
 * Map an `OAuthError` (login flow, token store, expiry gate) by code.
 *
 * @param error - The error.
 * @param context - Redirect URI and expiry for the copy.
 * @returns The mapped error.
 */
function describeOAuthError(
  error: OAuthError,
  context: ErrorContext,
): DemoError {
  const { code, details } = error;
  switch (code) {
    case "OAUTH_CONFIG_ERROR": {
      // The storage adapter is the only source that names a `seam`.
      if (typeof details["seam"] === "string") {
        return mapped(
          error,
          "This browser refused session storage (private mode or quota), and the sign-in hop needs it. Allow site data for this page and start again.",
          "signed-out",
        );
      }
      return mapped(
        error,
        `This build's redirect URI is not valid (${context.redirectUri ?? "unknown"}). This is a site build problem, not yours.`,
        "offline",
      );
    }
    case "OAUTH_REGISTRATION_ERROR": {
      return mapped(
        error,
        `Could not register this page with Mixpanel's OAuth server (${code}). Rate limits apply per origin; try again in a minute.`,
        "signed-out",
      );
    }
    case "OAUTH_AUTH_DENIED": {
      return mapped(
        error,
        "You declined the Mixpanel authorization (or SSO refused it). Nothing was stored.",
        "signed-out",
      );
    }
    case "OAUTH_STATE_MISMATCH": {
      return mapped(
        error,
        "The return URL did not match this tab's sign-in attempt and was rejected. Start again.",
        "signed-out",
      );
    }
    case "OAUTH_PASTE_ERROR": {
      return mapped(
        error,
        "The return URL is malformed. Start again.",
        "signed-out",
      );
    }
    case "OAUTH_TIMEOUT": {
      return mapped(error, POPUP_TIMEOUT_NOTICE, "signed-out");
    }
    case "OAUTH_TOKEN_ERROR": {
      if (typeof details["has_refresh_token"] === "boolean") {
        const at =
          context.expiresAt === undefined
            ? "a moment ago"
            : clockTime(context.expiresAt);
        return mapped(
          error,
          `Your token expired at ${at}. The browser package has no refresh (a documented divergence); sign in again.`,
          "signed-out",
        );
      }
      return mapped(
        error,
        `Mixpanel refused the token exchange (${code}). Start again.`,
        "signed-out",
      );
    }
    default: {
      return mapped(error, error.message, "signed-out");
    }
  }
}

/**
 * Map a thrown value to what the UI shows and where it goes next.
 *
 * @param error - Whatever a library call rejected with.
 * @param context - Redirect URI and expiry for the copy that quotes them.
 * @returns The mapped error.
 */
export function describeError(
  error: unknown,
  context: ErrorContext = {},
): DemoError {
  if (error instanceof OAuthError) {
    return describeOAuthError(error, context);
  }
  if (error instanceof BrowserUnsupportedError) {
    switch (error.code) {
      case BROWSER_NO_PENDING_LOGIN: {
        return mapped(error, NO_PENDING_LOGIN_MESSAGE, "signed-out");
      }
      case BROWSER_POPUP_BLOCKED: {
        // Not the end of the attempt: the pending record is kept for the
        // link-and-paste fallback, so the copy stays inline.
        return mapped(error, POPUP_BLOCKED_MESSAGE, null);
      }
      case BROWSER_POPUP_CLOSED: {
        return mapped(error, POPUP_CANCELED_NOTICE, "signed-out");
      }
      default: {
        return mapped(error, error.message, null);
      }
    }
  }
  if (error instanceof ConfigError) {
    const status = error.details["status_code"];
    if (status === 401) {
      return mapped(
        error,
        "The token was rejected. Sign in again.",
        "signed-out",
      );
    }
    if (status === 403) {
      return mapped(
        error,
        "This account cannot list projects (/me scope). The Node package accepts an explicit project id; this page cannot.",
        "signed-out",
      );
    }
    return mapped(error, error.message, null);
  }
  if (error instanceof AuthenticationError) {
    return mapped(
      error,
      "Your session is no longer valid. Sign in again.",
      "signed-out",
    );
  }
  if (error instanceof EventNotFoundError) {
    const hint =
      error.similarEvents.length > 0
        ? ` Suggestions: ${error.similarEvents.join(", ")}.`
        : "";
    return mapped(
      error,
      `${JSON.stringify(error.eventName)} is not an event of this project.${hint}`,
      null,
    );
  }
  if (
    error instanceof QueryError ||
    error instanceof RateLimitError ||
    error instanceof ServerError ||
    error instanceof MixpanelHeadlessError
  ) {
    return mapped(error, error.message, null);
  }
  if (error instanceof Error) {
    const miss = FIXTURE_MISS.exec(error.message);
    return {
      code: null,
      className: error.name,
      message:
        miss?.[1] === undefined
          ? error.message
          : `Playground fixture missing for ${miss[1]} — please report this.`,
      statusCode: null,
      details: null,
      fatal: false,
      retry: null,
    };
  }
  return {
    code: null,
    className: "Error",
    message: String(error),
    statusCode: null,
    details: null,
    fatal: false,
    retry: null,
  };
}

/**
 * Classify a `loginInPopup` rejection for the framed page.
 *
 * @param error - Whatever `loginInPopup` rejected with.
 * @param context - Redirect URI and expiry for the copy that quotes them.
 * @returns What the page does next.
 */
export function popupLoginOutcome(
  error: unknown,
  context: ErrorContext = {},
): PopupLoginOutcome {
  if (
    error instanceof BrowserUnsupportedError &&
    error.code === BROWSER_POPUP_BLOCKED
  ) {
    const { details } = error;
    if (details["reason"] === "in_flight") {
      return { kind: "in-flight" };
    }
    const authorizeUrl = details["authorize_url"];
    if (details["reason"] === "blocked" && typeof authorizeUrl === "string") {
      return { kind: "blocked", authorizeUrl };
    }
  }
  if (
    error instanceof BrowserUnsupportedError &&
    error.code === BROWSER_POPUP_CLOSED
  ) {
    return { kind: "signed-out", notice: POPUP_CANCELED_NOTICE };
  }
  if (error instanceof OAuthError && error.code === "OAUTH_TIMEOUT") {
    return { kind: "signed-out", notice: POPUP_TIMEOUT_NOTICE };
  }
  return { kind: "error", error: describeError(error, context) };
}
