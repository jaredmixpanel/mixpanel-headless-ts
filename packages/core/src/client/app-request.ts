/**
 * Authenticated App API request path; every entity CRUD method and the
 * paginator's per-page fetch call this one function. The Authorization
 * header is resolved per call through the injected seam so refreshed OAuth
 * tokens reach App API calls without rebuilding the client, and no
 * `query_origin` is added because some App API endpoints reject unknown
 * query parameters. 204 → `{status: "ok"}`; 429 retries over the shared
 * backoff trio; 422 → `QueryError` with the lossless body; everything else
 * goes through {@link handleResponse}; a `results` key unwraps unless `raw`.
 *
 * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.app_request
 */

import {
  MixpanelHeadlessError,
  ParamValidationError,
  QueryError,
  RateLimitError,
} from "../errors.js";
import {
  parseRetryAfter,
  type RandomSource,
  retryWaitSeconds,
} from "./backoff.js";
import {
  errorMessage,
  handleResponse,
  isPlainRecord,
  MixpanelHttpError,
  parseBody,
  parseErrorBody,
  type RequestExecutor,
  type RetryLogger,
  type TransportRequestOptions,
} from "./internals.js";
import type { JsonValue } from "./json-value.js";
import { buildUrl, type EndpointOverrides, type Region } from "./url.js";

/** Dependencies of {@link appRequest} (the client wires these). */
export interface AppRequestDeps {
  /** Transport seam (the {@link RequestExecutor} contract). */
  readonly request: RequestExecutor;
  /** Sleep seam in milliseconds. */
  sleep: (ms: number) => Promise<void>;
  /** Uniform-[0,1) RNG for backoff jitter. */
  readonly random: RandomSource;
  /** Maximum retry attempts for rate-limited requests (the client's default is 3). */
  readonly maxRetries: number;
  /**
   * Resolve the default request timeout for a URL
   * (`MixpanelAPIClient._default_timeout`): explicit
   * constructor timeout wins, else the route-aware default.
   *
   * @param url - The full request URL.
   * @returns The timeout in seconds.
   */
  defaultTimeoutSeconds: (url: string) => number;
  /**
   * The four-layer header merge, pre-bound to the session.
   *
   * @param extra - Per-call headers (Authorization etc.).
   * @returns The merged header set.
   */
  requestHeaders: (extra: Record<string, string>) => Record<string, string>;
  /** Bound project id (`session.project.id`). */
  readonly projectId: string;
  /** Data-residency region (`session.account.region`). */
  readonly region: Region;
  /**
   * Alternate-host overrides in force for this request (the client
   * snapshots its per-request provider when it builds the deps — Python
   * PR #235). Absent → the live per-region App API host.
   */
  readonly endpointOverrides?: EndpointOverrides | undefined;
  /**
   * Per-request Authorization resolver (`_get_auth_header`):
   * re-resolves refreshed OAuth bearers on every `appRequest` call;
   * async because TS token resolvers may do I/O.
   *
   * @returns The Authorization header value.
   */
  getAuthHeader: () => string | Promise<string>;
  /** Optional retry-warning logger. */
  readonly logger?: RetryLogger | undefined;
}

/** Keyword options of {@link appRequest} (Python kw-only params). */
export interface AppRequestOptions {
  /** Optional query parameters. */
  readonly params?: Record<string, string> | null | undefined;
  /** Optional JSON request body (mutually exclusive with `formBody`). */
  readonly jsonBody?: Record<string, unknown> | null | undefined;
  /**
   * Optional `application/x-www-form-urlencoded` body — used by
   * endpoints like `custom_events/` and
   * `data-definitions/lookup-tables/` that don't accept JSON. Mutually
   * exclusive with `jsonBody`.
   */
  readonly formBody?: Record<string, string> | null | undefined;
  /**
   * Return the full response value without unwrapping the `results`
   * field (Python `_raw`) — useful for endpoints that include pagination
   * metadata alongside results.
   *
   * @defaultValue `false`
   */
  readonly raw?: boolean | undefined;
}

/**
 * Make an authenticated request to the Mixpanel App API.
 *
 * @remarks
 * Uses Bearer auth (OAuth) or Basic auth depending on the resolved
 * header; builds the URL from the `app` endpoint for the configured
 * region; unwraps the `results` field from the response JSON when
 * present.
 * @param deps - Injected client dependencies.
 * @param method - HTTP method (GET, POST, PATCH, DELETE, etc.).
 * @param path - API path (e.g. `/projects/12345/dashboards`).
 * @param options - Optional params/body/raw flags.
 * @returns The `results` field from the response JSON if present,
 *   otherwise the full response body. For 204 No Content responses,
 *   returns `{status: "ok"}`. When `raw` is true, the full response
 *   value is returned without unwrapping `results`.
 * @throws {@link ParamValidationError} - Both `jsonBody` and `formBody`
 *   were provided (`AC1_BODY_MUTUALLY_EXCLUSIVE`).
 * @throws {@link RateLimitError} - Rate limit exceeded after the maximum
 *   retries (429).
 * @throws {@link QueryError} - Invalid parameters or resource not found
 *   (400, 404, 422).
 * @throws {@link MixpanelHeadlessError} - Network/connection errors
 *   (`HTTP_ERROR`), plus `AuthenticationError` (401) and `ServerError`
 *   (5xx) raised by {@link handleResponse}.
 * @example
 * ```typescript
 * const dashboards = await appRequest(deps, "GET", "/projects/12345/dashboards");
 * // form-encoded POST
 * const ce = await appRequest(deps, "POST", "/projects/12345/custom_events/", {
 *   formBody: { name: "X", alternatives: '[{"event": "Y"}]' },
 * });
 * ```
 * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.app_request
 */
// eslint-disable-next-line complexity -- branch-for-branch port of one Python function (see the docblock); splitting it would scatter the guard order the corpus pins
export async function appRequest(
  deps: AppRequestDeps,
  method: string,
  path: string,
  options: AppRequestOptions = {},
): Promise<JsonValue> {
  const jsonBody = options.jsonBody ?? null;
  const formBody = options.formBody ?? null;
  if (jsonBody !== null && formBody !== null) {
    throw new ParamValidationError(
      "app_request: json_body and form_body are mutually exclusive",
      "AC1_BODY_MUTUALLY_EXCLUSIVE",
    );
  }

  const url = buildUrl(deps.region, "app", path, deps.endpointOverrides);
  // Re-resolve per request via the getAuthHeader seam so refreshed
  // OAuth tokens (browser refresh / static-token rotation) reach App
  // API calls without rebuilding the client.
  const authHeader = await deps.getAuthHeader();
  const headers = deps.requestHeaders({ Authorization: authHeader });

  // Pass through caller-supplied params only (no query_origin — some
  // App API endpoints reject unknown query parameters).
  const requestParams: Record<string, string> = {};
  if (options.params) {
    Object.assign(requestParams, options.params);
  }

  const requestBody: Record<string, unknown> | null = formBody ?? jsonBody;

  for (let attempt = 0; attempt <= deps.maxRetries; attempt += 1) {
    try {
      const response = await deps.request({
        method,
        url,
        params: requestParams,
        jsonBody: formBody === null ? jsonBody : null,
        formBody,
        headers,
        timeoutSeconds: deps.defaultTimeoutSeconds(url),
      } satisfies TransportRequestOptions);

      // Handle 204 No Content.
      if (response.status === 204) {
        return { status: "ok" };
      }

      // Handle 429 rate limiting with retry.
      if (response.status === 429) {
        if (attempt >= deps.maxRetries) {
          const retryAfter = parseRetryAfter(response);
          const responseBody = parseBody(response.text);
          throw new RateLimitError("Rate limit exceeded after max retries", {
            retryAfter,
            statusCode: response.status,
            responseBody,
            requestMethod: method,
            requestUrl: url,
            requestParams,
            projectId: deps.projectId,
          });
        }
        const waitSeconds = retryWaitSeconds(
          parseRetryAfter(response),
          attempt,
          deps.random,
        );
        deps.logger?.warning(
          `Rate limited, retrying in ${waitSeconds.toFixed(1)} seconds ` +
            `(attempt ${attempt + 1}/${deps.maxRetries})`,
        );
        // The one seconds→milliseconds conversion point.
        await deps.sleep(waitSeconds * 1000);
        continue;
      }

      // Handle 422 as QueryError. Body parse mirrors the Python
      // `response.json()` site: `json.loads` non-finite constants are
      // accepted, and only the JSONDecodeError analog is caught.
      if (response.status === 422) {
        const errBody = parseErrorBody(response.text);
        throw new QueryError(errorMessage(errBody, "Unprocessable entity"), {
          statusCode: 422,
          responseBody: errBody,
          requestMethod: method,
          requestUrl: url,
          requestParams,
          requestBody,
        });
      }

      // Delegate other error codes to handleResponse.
      const result = handleResponse(response, {
        requestMethod: method,
        requestUrl: url,
        requestParams,
        requestBody,
        projectId: deps.projectId,
      });

      // Unwrap results field if present (unless raw requested).
      // `Object.hasOwn`, never `in`: an inherited `results` must not count.
      if (
        options.raw !== true &&
        isPlainRecord(result) &&
        Object.hasOwn(result, "results")
      ) {
        return result["results"] ?? null;
      }
      return result;
    } catch (error) {
      // `except httpx.HTTPError` → the instanceof filter.
      if (!(error instanceof MixpanelHttpError)) {
        throw error;
      }
      throw new MixpanelHeadlessError(
        `HTTP error: ${error.message}`,
        "HTTP_ERROR",
        {
          error: error.message,
          request_method: method,
          request_url: url,
          request_params: requestParams,
        },
        { cause: error },
      );
    }
  }

  // Should not reach here — mirrors Python's type-checker-satisfying
  // raise.
  throw new RateLimitError("Rate limit exceeded after max retries", {
    requestMethod: method,
    requestUrl: url,
    requestParams,
    projectId: deps.projectId,
  });
}
