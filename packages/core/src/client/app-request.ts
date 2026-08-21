/**
 * Authenticated App API request path — TS port of
 * `MixpanelAPIClient.app_request`
 * (`mixpanel_headless/_internal/api_client.py:1191-1387`) — Phase-3
 * packet B0-2, R10.8 (ported once, by name: every entity CRUD wire
 * method (B4-C3..C5), `pagination.paginate` (B4-C6, per-page via a
 * `PageFetcher`-style seam preserving per-request auth, R2.8), and every
 * `create<Entity>Client` factory (B6, R2.9) call THIS function — never a
 * re-implementation).
 *
 * Behavior notes (byte-for-byte from source):
 * - Bearer/Basic auth resolves PER CALL via the injected
 *   {@link AppRequestDeps.getAuthHeader} seam (R2.9 — never captured at
 *   construction) so refreshed OAuth tokens reach App API calls without
 *   rebuilding the client.
 * - NO `query_origin` on App-API params — some App API endpoints reject
 *   unknown query parameters (`api_client.py:1268-1272`).
 * - 204 → `{status: "ok"}`; its own 429 loop (same backoff trio); 422 →
 *   `QueryError` with the lossless body; everything else delegates to
 *   {@link handleResponse}; a `results` key unwraps unless `raw`
 *   (`Object.hasOwn`, R4.8/watchlist §8 item 7).
 */

import { cpSlice } from "../compat/index.js";
import {
  MixpanelHeadlessError,
  ParamValidationError,
  QueryError,
  RateLimitError,
} from "../errors.js";
import {
  parseRetryAfter,
  retryWaitSeconds,
  type RandomSource,
} from "./backoff.js";
import {
  MixpanelHttpError,
  errorMessage,
  handleResponse,
  isPlainRecord,
  parseBody,
  type RequestExecutor,
  type RetryLogger,
  type TransportRequestOptions,
} from "./internals.js";
import type { JsonValue } from "./json-value.js";
import { LosslessJsonError, parseLossless } from "./lossless-json.js";
import { buildUrl, type Region } from "./url.js";

/** Dependencies of {@link appRequest} (the B4 client wires these). */
export interface AppRequestDeps {
  /** Transport seam (R2.10/R2.11 contract — see `internals.ts`). */
  readonly request: RequestExecutor;
  /** Sleep seam in MILLISECONDS (R2.12/R6.3). */
  sleep(ms: number): Promise<void>;
  /** Uniform-[0,1) RNG for backoff jitter. */
  readonly random: RandomSource;
  /** Maximum retry attempts for rate-limited requests (Python default 3). */
  readonly maxRetries: number;
  /**
   * Resolve the default request timeout for a URL
   * (`self._default_timeout(url)`, `api_client.py:489-509`): explicit
   * constructor timeout wins, else the route-aware default.
   *
   * @param url - The full request URL.
   * @returns The timeout in seconds.
   */
  defaultTimeoutSeconds(url: string): number;
  /**
   * The B0-owned 4-layer header merge, pre-bound to the session.
   *
   * @param extra - Per-call headers (Authorization etc.).
   * @returns The merged header set.
   */
  requestHeaders(extra: Record<string, string>): Record<string, string>;
  /** Bound project id (`session.project.id`). */
  readonly projectId: string;
  /** Data-residency region (`session.account.region`). */
  readonly region: Region;
  /**
   * Per-request Authorization resolver (`_get_auth_header`, R2.9):
   * re-resolves refreshed OAuth bearers on every `appRequest` call;
   * async because TS token resolvers may do I/O.
   *
   * @returns The Authorization header value.
   */
  getAuthHeader(): string | Promise<string>;
  /** Optional retry-warning logger (R9.5). */
  readonly logger?: RetryLogger | undefined;
}

/** Keyword options of {@link appRequest} (Python kw-only params, R3.8). */
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
   * If `true`, return the full response value without unwrapping the
   * `results` field (Python `_raw`) — useful for endpoints that include
   * pagination metadata alongside results.
   */
  readonly raw?: boolean | undefined;
}

/**
 * Make an authenticated request to the Mixpanel App API — TS port of
 * `app_request` (`api_client.py:1191-1387`).
 *
 * Uses Bearer auth (OAuth) or Basic auth depending on the resolved
 * header; builds the URL from the `app` endpoint for the configured
 * region; unwraps the `results` field from the response JSON when
 * present.
 *
 * @param deps - Injected client dependencies.
 * @param method - HTTP method (GET, POST, PATCH, DELETE, etc.).
 * @param path - API path (e.g. `/projects/12345/dashboards`).
 * @param options - Optional params/body/raw flags.
 * @returns The `results` field from the response JSON if present,
 *   otherwise the full response body. For 204 No Content responses,
 *   returns `{status: "ok"}`. When `raw` is true, the full response
 *   value is returned without unwrapping `results`.
 * @throws ParamValidationError - Both `jsonBody` and `formBody` were
 *   provided (`AC1_BODY_MUTUALLY_EXCLUSIVE`).
 * @throws AuthenticationError - Invalid credentials (401).
 * @throws RateLimitError - Rate limit exceeded after max retries (429).
 * @throws QueryError - Invalid parameters or resource not found
 *   (400, 404, 422).
 * @throws ServerError - Server-side errors (5xx).
 * @throws MixpanelHeadlessError - Network/connection errors
 *   (`HTTP_ERROR`, R2.10).
 *
 * @example
 * ```typescript
 * const dashboards = await appRequest(deps, "GET", "/projects/12345/dashboards");
 * // form-encoded POST
 * const ce = await appRequest(deps, "POST", "/projects/12345/custom_events/", {
 *   formBody: { name: "X", alternatives: '[{"event": "Y"}]' },
 * });
 * ```
 */
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

  const url = buildUrl(deps.region, "app", path);
  // Re-resolve per request via the getAuthHeader seam so refreshed
  // OAuth tokens (browser refresh / static-token rotation) reach App
  // API calls without rebuilding the client (api_client.py:1258-1263).
  const authHeader = await deps.getAuthHeader();
  const headers = deps.requestHeaders({ Authorization: authHeader });

  // Pass through caller-supplied params only (no query_origin — some
  // App API endpoints reject unknown query parameters).
  const requestParams: Record<string, string> = {};
  if (options.params) {
    Object.assign(requestParams, options.params);
  }

  const requestBody: Record<string, unknown> | null =
    formBody !== null ? formBody : jsonBody;

  for (let attempt = 0; attempt <= deps.maxRetries; attempt += 1) {
    try {
      const response = await deps.request({
        method,
        url,
        params: requestParams,
        jsonBody: formBody !== null ? null : jsonBody,
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
        // R2.12: the ONE seconds→milliseconds conversion point.
        await deps.sleep(waitSeconds * 1000);
        continue;
      }

      // Handle 422 as QueryError. Body parse mirrors the Python
      // `response.json()` site (`api_client.py:1339-1342`): json.loads
      // non-finite constants accepted (arbiter fix F1), catch scope is
      // the JSONDecodeError analog only (arbiter fix F3/A2).
      if (response.status === 422) {
        let errBody: JsonValue | null;
        try {
          errBody = parseLossless(response.text, { pythonConstants: true });
        } catch (e) {
          if (!(e instanceof LosslessJsonError)) {
            throw e;
          }
          errBody =
            response.text !== "" ? cpSlice(response.text, 0, 500) : null;
        }
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
      // `Object.hasOwn` — never `in` (prototype-chain trap, R4.8/§8.7).
      if (
        options.raw !== true &&
        isPlainRecord(result) &&
        Object.hasOwn(result, "results")
      ) {
        return result["results"] ?? null;
      }
      return result;
    } catch (e) {
      // R2.10: `except httpx.HTTPError` → the instanceof filter.
      if (!(e instanceof MixpanelHttpError)) {
        throw e;
      }
      throw new MixpanelHeadlessError(
        `HTTP error: ${e.message}`,
        "HTTP_ERROR",
        {
          error: e.message,
          request_method: method,
          request_url: url,
          request_params: requestParams,
        },
        { cause: e },
      );
    }
  }

  // Should not reach here — mirror Python's type-checker-satisfying
  // raise; reduced constructor shape per FF4.
  throw new RateLimitError("Rate limit exceeded after max retries", {
    requestMethod: method,
    requestUrl: url,
    requestParams,
    projectId: deps.projectId,
  });
}
