// Library errors mapped to the playground's copy. Programs key on the
// error class and its `.code`, never on message text; the message shown
// is ours, the library's redacted `details` stay behind a disclosure.
// Fatal errors end the live session and name the state to retry from;
// everything else renders inline under the result.

import {
  AuthenticationError,
  BROWSER_NO_PENDING_LOGIN,
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
    return error.code === BROWSER_NO_PENDING_LOGIN
      ? mapped(error, NO_PENDING_LOGIN_MESSAGE, "signed-out")
      : mapped(error, error.message, null);
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
