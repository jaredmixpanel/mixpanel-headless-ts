/**
 * Report-link wire methods — TS port of the 045-report-links range of
 * `MixpanelAPIClient` (`api_client.py`, Python PR #223):
 * `create_bookmark_url`, `get_bookmark_url` (the unsaved-report slug
 * records under `/projects/{pid}/bookmark-urls/`) and
 * `resolve_short_link` (the one-hop `https://{host}/s/{code}` expansion).
 *
 * `createBookmarkUrl` / `getBookmarkUrl` route through B0 `appRequest`
 * (R10.8). `resolveShortLink` deliberately bypasses `executeWithRetry`
 * and `handleResponse` — both treat a 3xx as an error — and drives the
 * injected {@link RequestExecutor} directly with the same 429 backoff
 * trio; the executor already requests with `redirect: 'manual'` (R2.11),
 * so a 3xx surfaces with its `Location` header intact.
 *
 * Browser caveat (documented, not a divergence the port can close): a
 * browser `fetch` with `redirect: 'manual'` yields an opaque-redirect
 * response (status 0, no headers) for a 3xx, so shortlinks that redirect
 * with a header resolve only on Node/undici; the 200-with-script form
 * works everywhere.
 */

import { appRequest } from "../../client/app-request.js";
import { parseRetryAfter, retryWaitSeconds } from "../../client/backoff.js";
import type { ClientCore } from "../../client/core.js";
import {
  bindFirst,
  errorMessage,
  MixpanelHttpError,
  parseBody,
  type WireResponse,
} from "../../client/internals.js";
import type { JsonValue } from "../../client/json-value.js";
import { DEFAULT_APP_TIMEOUT_S } from "../../client/url.js";
import { setOwn } from "../../compat/python-dict.js";
import { pythonInt } from "../../compat/python-int.js";
import { urljoin, urlsplit } from "../../compat/urllib.js";
import {
  AuthenticationError,
  MixpanelHeadlessError,
  QueryError,
  RateLimitError,
  ReportLinkNotFoundError,
  ServerError,
  ShortLinkResolutionError,
} from "../../errors.js";
import { webHost } from "../../report-links.js";
import { expectRecordResult } from "./shared.js";

/**
 * 045-report-links: the shortlink view returns 200 HTML instead of a
 * 3xx when the target URL is longer than ~2048 chars. The body then
 * carries the target as a JSON-quoted string assigned to
 * `window.location.href` (`_SHORT_LINK_HREF_RE`).
 */
const SHORT_LINK_HREF_RE = /window\.location\.href\s*=\s*("(?:[^"\\]|\\.)*")/u;

/** `_SHORT_LINK_REDIRECT_STATUSES`. */
const SHORT_LINK_REDIRECT_STATUSES: ReadonlySet<number> = new Set([
  301, 302, 303, 307, 308,
]);

/** `_SHORT_LINK_HINT`. */
const SHORT_LINK_HINT =
  "Open the shortlink in a browser and copy the full URL.";

/** The report-link method surface (mixed into `MixpanelClient`). */
export interface BookmarkUrlMethods {
  /**
   * Store an unsaved report under a client-minted slug
   * (`create_bookmark_url`). `POST /api/app/projects/{pid}/bookmark-urls/`.
   * The endpoint is always project-scoped — it never goes under
   * `/workspaces/{wid}/` even when a workspace is pinned — and the
   * server strips `workspace_id` from the body, so this method drops
   * that key before sending.
   *
   * @param body - `{slug, type, params}` plus optional `name`,
   *   `description`, and `bookmark_id`. `type` is one of `insights`,
   *   `funnels`, `retention`, `flows`.
   * @param signal - Optional cancellation signal (R6.7).
   * @returns The stored record (`results` unwrapped): `slug`, `type`,
   *   `params`, `project_id`, `created_at` and friends.
   * @throws AuthenticationError - Invalid or expired credentials (401).
   * @throws QueryError - Invalid payload or duplicate slug (400/404/422).
   * @throws RateLimitError - Rate limit exceeded after max retries (429).
   * @throws ServerError - Server-side errors (5xx).
   * @throws MixpanelHeadlessError - The response was not a dict.
   */
  createBookmarkUrl: (
    body: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Fetch the unsaved-report record stored under a slug
   * (`get_bookmark_url`). `GET /api/app/projects/{pid}/bookmark-urls/{slug}/`.
   * Always project-scoped, even when a workspace is pinned. A slug is
   * readable only in the project and region that created it, so a 404 is
   * mapped to {@link ReportLinkNotFoundError} with that explanation.
   *
   * @param slug - The 12-character slug.
   * @param signal - Optional cancellation signal (R6.7).
   * @returns The record (`results` unwrapped): `slug`, `type`, `params`,
   *   optional `name`, `description`, `overrides`, `bookmark` /
   *   `bookmark_id`, `project_id`, `created_at`.
   * @throws ReportLinkNotFoundError - `REPORT_LINK_SLUG_NOT_FOUND` on a 404.
   * @throws AuthenticationError - Invalid or expired credentials (401).
   * @throws QueryError - Other 4xx responses (400/403/422).
   * @throws RateLimitError - Rate limit exceeded after max retries (429).
   * @throws ServerError - Server-side errors (5xx).
   * @throws MixpanelHeadlessError - The response was not a dict.
   */
  getBookmarkUrl: (
    slug: string,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Expand a `https://{host}/s/{code}` shortlink to its target URL
   * (`resolve_short_link`). Sends one authenticated GET without
   * following redirects and reads the target from the `Location` header,
   * or from the `window.location.href` script the server returns for
   * very long targets. A relative target is joined to the request URL in
   * both cases. The Authorization header is never logged.
   *
   * @param code - The shortlink code after `/s/`.
   * @param signal - Optional cancellation signal (R6.7).
   * @returns The absolute target URL. It is not parsed or validated here.
   * @throws AuthenticationError - 401, or a redirect (header or script)
   *   to `/login`.
   * @throws ReportLinkNotFoundError - `SHORT_LINK_NOT_FOUND` on a 404.
   * @throws QueryError - 403 (permission denied).
   * @throws RateLimitError - 429 on every retry attempt.
   * @throws ServerError - 5xx.
   * @throws ShortLinkResolutionError - `SHORT_LINK_NO_LOCATION` for a
   *   3xx without `Location`; `SHORT_LINK_UNEXPECTED_RESPONSE` for a 200
   *   whose body has no decodable, non-empty redirect script, or for any
   *   other status.
   * @throws MixpanelHeadlessError - `HTTP_ERROR` on a transport failure.
   */
  resolveShortLink: (code: string, signal?: AbortSignal) => Promise<string>;
}

/**
 * Join a shortlink target to the request URL and reject the login page
 * (`_short_link_target`).
 *
 * @param requestUrl - The `https://{host}/s/{code}` URL that was fetched.
 * @param rawTarget - The `Location` header or the scripted `href`,
 *   absolute or relative.
 * @param code - The shortlink code, for the message.
 * @param status - The HTTP status, for the error context.
 * @returns The absolute target URL.
 * @throws AuthenticationError - The target path is `/login` or under it.
 */
function shortLinkTarget(
  requestUrl: string,
  rawTarget: string,
  code: string,
  status: number,
): string {
  const target = urljoin(requestUrl, rawTarget);
  const path = urlsplit(target).path;
  if (path === "/login" || path.startsWith("/login/")) {
    throw new AuthenticationError(
      `Shortlink /s/${code} requires authentication; the server ` +
        `redirected to the login page.`,
      { statusCode: status, requestMethod: "GET", requestUrl },
    );
  }
  return target;
}
/**
 * Send the shortlink GET, with the same 429 backoff as every API call
 * (`_get_short_link`).
 *
 * @param url - The `https://{host}/s/{code}` URL.
 * @param signal - Optional cancellation signal.
 * @returns The first response whose status is not 429.
 * @throws RateLimitError - 429 on every attempt.
 * @throws MixpanelHeadlessError - `HTTP_ERROR` on a transport failure.
 */
async function getShortLink(
  core: ClientCore,
  url: string,
  signal: AbortSignal | undefined,
): Promise<WireResponse> {
  const deps = core.executeDeps(signal);
  const headers = core.requestHeaders({
    Authorization: await core.getAuthHeader(),
  });
  for (let attempt = 0; attempt <= deps.maxRetries; attempt += 1) {
    let response: WireResponse;
    try {
      response = await deps.request({
        method: "GET",
        url,
        params: {},
        jsonBody: null,
        formBody: null,
        headers,
        timeoutSeconds: DEFAULT_APP_TIMEOUT_S,
      });
    } catch (error) {
      // R2.10: `except httpx.HTTPError` → the instanceof filter.
      if (!(error instanceof MixpanelHttpError)) {
        throw error;
      }
      throw new MixpanelHeadlessError(
        `HTTP error: ${error.message}`,
        "HTTP_ERROR",
        { error: error.message, request_method: "GET", request_url: url },
        { cause: error },
      );
    }
    if (response.status !== 429) {
      return response;
    }
    const retryAfter = parseRetryAfter(response);
    if (attempt >= deps.maxRetries) {
      throw new RateLimitError("Rate limit exceeded", {
        retryAfter,
        statusCode: response.status,
        requestMethod: "GET",
        requestUrl: url,
        projectId: deps.projectId,
      });
    }
    const waitSeconds = retryWaitSeconds(retryAfter, attempt, deps.random);
    deps.logger?.warning(
      `Rate limited, retrying in ${waitSeconds.toFixed(1)} seconds ` +
        `(attempt ${String(attempt + 1)}/${String(deps.maxRetries)})`,
    );
    // R2.12: the ONE seconds→milliseconds conversion point.
    await deps.sleep(waitSeconds * 1000);
  }
  // Unreachable (the loop always returns or throws) — mirror Python's
  // type-checker-satisfying raise.
  throw new RateLimitError("Rate limit exceeded", {
    requestMethod: "GET",
    requestUrl: url,
    projectId: deps.projectId,
  });
}

async function createBookmarkUrl(
  core: ClientCore,
  body: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<Record<string, JsonValue>> {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (key !== "workspace_id") {
      setOwn(payload, key, value);
    }
  }
  const result = await appRequest(
    core.appDeps(signal),
    "POST",
    `/projects/${core.projectId()}/bookmark-urls/`,
    { jsonBody: payload },
  );
  return expectRecordResult(result, "create_bookmark_url");
}

async function getBookmarkUrl(
  core: ClientCore,
  slug: string,
  signal?: AbortSignal,
): Promise<Record<string, JsonValue>> {
  let result: JsonValue;
  try {
    result = await appRequest(
      core.appDeps(signal),
      "GET",
      `/projects/${core.projectId()}/bookmark-urls/${slug}/`,
    );
  } catch (error) {
    if (error instanceof QueryError && error.statusCode === 404) {
      const projectId = pythonInt(core.projectId());
      const region = core.region();
      throw new ReportLinkNotFoundError(
        `No unsaved report found for slug ${slug} in project ` +
          `${String(projectId)} (${region}). A slug is only readable in ` +
          `the project and region that created it.`,
        {
          code: "REPORT_LINK_SLUG_NOT_FOUND",
          details: {
            kind: "slug",
            slug,
            project_id: projectId,
            region,
            hint:
              "Switch to the project and region that created the " +
              "link (ws.use(project=...); CLI: mp --project ... " +
              "or mp --account ...) and retry.",
          },
          cause: error,
        },
      );
    }
    throw error;
  }
  return expectRecordResult(result, "get_bookmark_url");
}

async function resolveShortLink(
  core: ClientCore,
  code: string,
  signal?: AbortSignal,
): Promise<string> {
  const region = core.region();
  const host = webHost(region);
  const url = `https://${host}/s/${code}`;
  const response = await getShortLink(core, url, signal);

  const status = response.status;
  const baseDetails: Record<string, unknown> = {
    kind: "short_link",
    short_code: code,
    host,
    region,
  };

  if (SHORT_LINK_REDIRECT_STATUSES.has(status)) {
    const location = response.header("Location") ?? "";
    if (location === "") {
      throw new ShortLinkResolutionError(
        `Shortlink /s/${code} returned HTTP ${String(status)} without a ` +
          `Location header.`,
        {
          code: "SHORT_LINK_NO_LOCATION",
          details: { ...baseDetails, status, hint: SHORT_LINK_HINT },
        },
      );
    }
    return shortLinkTarget(url, location, code, status);
  }

  if (status === 200) {
    const match = SHORT_LINK_HREF_RE.exec(response.text);
    let decoded: unknown = null;
    if (match !== null) {
      try {
        decoded = JSON.parse(match[1] as string);
      } catch (error) {
        // Python: `except json.JSONDecodeError` — the SyntaxError analog.
        if (!(error instanceof SyntaxError)) {
          throw error;
        }
        decoded = null;
      }
    }
    if (typeof decoded === "string" && decoded !== "") {
      return shortLinkTarget(url, decoded, code, status);
    }
    throw new ShortLinkResolutionError(
      `Shortlink /s/${code} returned HTTP ${String(status)} with a body ` +
        `mixpanel-headless does not recognize.`,
      {
        code: "SHORT_LINK_UNEXPECTED_RESPONSE",
        details: { ...baseDetails, status, hint: SHORT_LINK_HINT },
      },
    );
  }

  if (status === 401) {
    throw new AuthenticationError(
      "Invalid credentials. Check username, secret, and project_id.",
      { statusCode: status, requestMethod: "GET", requestUrl: url },
    );
  }
  if (status === 403) {
    const body = parseBody(response.text);
    throw new QueryError(errorMessage(body, "Permission denied"), {
      statusCode: status,
      responseBody: body,
      requestMethod: "GET",
      requestUrl: url,
    });
  }
  if (status === 404) {
    throw new ReportLinkNotFoundError(
      `Shortlink /s/${code} does not exist on ${host}.`,
      {
        code: "SHORT_LINK_NOT_FOUND",
        details: {
          ...baseDetails,
          hint:
            "Check the shortlink for typos, or open it in a browser " +
            "and copy the full URL.",
        },
      },
    );
  }
  if (status >= 500) {
    throw new ServerError(
      `Server error ${String(status)} while resolving shortlink /s/${code}`,
      { statusCode: status, requestMethod: "GET", requestUrl: url },
    );
  }
  throw new ShortLinkResolutionError(
    `Shortlink /s/${code} returned HTTP ${String(status)} with a body ` +
      `mixpanel-headless does not recognize.`,
    {
      code: "SHORT_LINK_UNEXPECTED_RESPONSE",
      details: { ...baseDetails, status, hint: SHORT_LINK_HINT },
    },
  );
}

/**
 * Build the report-link wire methods over the shared client core.
 *
 * @param core - The B4 client internals seam.
 * @returns The three methods.
 */
export function createBookmarkUrlMethods(core: ClientCore): BookmarkUrlMethods {
  return {
    createBookmarkUrl: bindFirst(core, createBookmarkUrl),
    getBookmarkUrl: bindFirst(core, getBookmarkUrl),
    resolveShortLink: bindFirst(core, resolveShortLink),
  };
}
