/**
 * Shared client internals — TS port of `_error_message`
 * (`mixpanel_headless/_internal/api_client.py:81-106`), `_handle_response`
 * (`:503-662`), and `_execute_with_retry` (`:706-820`) — Phase-3 packet
 * B0-2, R10.8 (ported once, by name; B4 domain shards and B6 entity
 * clients import these and NEVER re-implement response handling,
 * retries, or error mapping — two independent `_handle_response` ports
 * diverging is R10.8's founding failure).
 *
 * Response bodies parse via {@link parseLossless} ONLY (GATE-VERDICT R5)
 * — never `response.json()` / bare `JSON.parse` — so `18` vs `18.0` and
 * >2^53 integers survive into results and error `response_body` bags.
 *
 * Transport contract (R2.10/R2.11): the injected {@link RequestExecutor}
 * (B4-C1's fetch adapter) normalizes every transport failure to
 * {@link MixpanelHttpError} and sets `redirect: 'manual'`, mirroring
 * httpx (which raises on 3xx instead of silently following).
 */

import {
  cpSlice,
  pythonInt,
  pythonStr,
  pythonStrip,
  type PythonValue,
} from "../compat/index.js";
import {
  AuthenticationError,
  MixpanelHeadlessError,
  QueryError,
  RateLimitError,
  ServerError,
  SessionReplayAccessError,
} from "../errors.js";
import {
  parseRetryAfter,
  type RandomSource,
  retryWaitSeconds,
} from "./backoff.js";
import { QUERY_ORIGIN } from "./headers.js";
import { JsonNumber, type JsonValue } from "./json-value.js";
import { LosslessJsonError, parseLossless } from "./lossless-json.js";

/**
 * HTTP/transport-level failure — the TS analog of `httpx.HTTPError`.
 *
 * Deliberately NOT part of the ported `MixpanelHeadlessError` hierarchy
 * (httpx errors are external to it in Python too): adapters normalize
 * every transport failure to this class (R2.10), and the B0 retry loops
 * catch it with the `if (!(e instanceof MixpanelHttpError)) throw e;`
 * idiom before wrapping it as `MixpanelHeadlessError` code `HTTP_ERROR`.
 * Library callers therefore never observe it directly.
 */
export class MixpanelHttpError extends Error {
  /** HTTP status when the failure came from a live response (R2.11). */
  readonly status: number | null;

  /**
   * Create a transport-level error.
   *
   * @param message - Human-readable description (out of contract, R5.4).
   * @param options - Optional `status` (for `raiseForStatus`) and
   *   standard `cause` threading.
   */
  constructor(
    message: string,
    options: { status?: number | null; cause?: unknown } = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "MixpanelHttpError";
    this.status = options.status ?? null;
  }
}

/** The response slice the B0 internals consume (adapter-produced). */
export interface WireResponse {
  /** HTTP status code. */
  readonly status: number;
  /** Complete body text (adapter reads it before handing over). */
  readonly text: string;
  /**
   * Case-insensitive response-header lookup (httpx `Headers.get`).
   *
   * @param name - Header name.
   * @returns The value, or `null` when absent.
   */
  header: (name: string) => string | null;
}

/** One outbound request as the injected executor receives it. */
export interface TransportRequestOptions {
  /** HTTP method (GET, POST, ...). */
  readonly method: string;
  /** Full request URL. */
  readonly url: string;
  /** Query parameters (serialization is the adapter's job). */
  readonly params: Record<string, unknown>;
  /** JSON request body, or `null` (httpx `json=`). */
  readonly jsonBody: Record<string, unknown> | null;
  /** Form-encoded request body, or `null` (httpx `data=`). */
  readonly formBody: Record<string, string> | null;
  /** Request headers (already merged by `requestHeaders`). */
  readonly headers: Record<string, string>;
  /** Request timeout in SECONDS (Python spelling of the unit, R2.12). */
  readonly timeoutSeconds: number;
}

/**
 * The injected transport seam (B4-C1's fetch adapter implements it).
 *
 * MUST reject with {@link MixpanelHttpError} for every transport-level
 * failure (fetch `TypeError` / `DOMException` / `UND_ERR_*` — R2.10) and
 * request with `redirect: 'manual'` (R2.11).
 */
export type RequestExecutor = (
  options: TransportRequestOptions,
) => Promise<WireResponse>;

/** Minimal logger seam (R9.5 — log text is never vector-compared). */
export interface RetryLogger {
  /**
   * Log a retry warning.
   *
   * @param message - The formatted warning text.
   */
  warning: (message: string) => void;
}

/** Request context threaded into error constructors. */
export interface ResponseContext {
  /** HTTP method used (GET, POST). */
  readonly requestMethod?: string | null | undefined;
  /** Full request URL. */
  readonly requestUrl?: string | null | undefined;
  /** Query parameters sent. */
  readonly requestParams?: Record<string, unknown> | null | undefined;
  /** Request body sent (for POST). */
  readonly requestBody?: Record<string, unknown> | null | undefined;
  /**
   * Bound project id (`session.project.id`) — consumed by the 403
   * SESSION_RECORDING_SENSITIVE_DATA branch's `int()` coercion.
   */
  readonly projectId: string;
}

/**
 * Whether a parsed JSON value is a plain record (Python `dict`).
 *
 * `JsonNumber` instances are objects but NOT dicts — they are the
 * lossless number tokens (never treat them as records).
 *
 * @param value - A parsed body value.
 * @returns `true` for plain objects.
 */
export function isPlainRecord(
  value: unknown,
): value is Record<string, JsonValue> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof JsonNumber)
  );
}

/**
 * Serialize a parsed non-string body the way `json.dumps` does —
 * consumed ONLY by the 403 branch's substring scan
 * (`"SESSION_RECORDING_SENSITIVE_DATA" in body_text`, applied uniformly
 * to dict/list/scalar bodies post-FIX-2). Separator/escaping
 * differences from CPython cannot create or destroy an all-ASCII flag
 * substring (every token boundary contains a quote character the flag
 * lacks), so this rendering is behaviorally equivalent for its one
 * consumer.
 *
 * @param value - The parsed value.
 * @returns The serialized text (JsonNumber tokens verbatim).
 */
function jsonDumpsLike(value: JsonValue): string {
  if (value === null) {
    return "null";
  }
  if (value === true) {
    return "true";
  }
  if (value === false) {
    return "false";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  if (value instanceof JsonNumber) {
    return value.raw;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => jsonDumpsLike(item)).join(", ")}]`;
  }
  return `{${Object.entries(value)
    .map(([k, v]) => `${JSON.stringify(k)}: ${jsonDumpsLike(v)}`)
    .join(", ")}}`;
}

/**
 * Render a parsed JSON value the way Python `str()` renders the
 * `json.loads` product — consumed by `_error_message`'s non-string
 * `error` stringification (message text; out of contract per R5.4) and
 * by B4-C2's `engage_stats` non-dict guard / `get_events` /
 * `get_property_values` `str(e)` element casts (`api_client.py:2339`,
 * `:2427`, `:2479` — exported for those R10.8 by-name consumers).
 *
 * Integer `JsonNumber` tokens map to `bigint` (Python `int`, arbitrary
 * precision); float tokens map to `number` — an INTEGRAL float token
 * (`42.0`) therefore renders `"42"` where Python says `"42.0"`, a
 * documented message-text-only approximation (R5.4).
 *
 * @param value - The parsed value.
 * @returns Python's `str()` rendering (containers via `repr`).
 */
export function jsonValuePythonStr(value: JsonValue): string {
  return pythonStr(toPythonValue(value));
}

/**
 * Convert a parsed JSON value into the `PythonValue` domain.
 *
 * @param value - The parsed value.
 * @returns The `pythonStr`-compatible twin.
 */
function toPythonValue(value: JsonValue): PythonValue {
  if (value instanceof JsonNumber) {
    return value.isIntegerToken() ? BigInt(value.raw) : value.toNumber();
  }
  if (Array.isArray(value)) {
    return value.map((item) => toPythonValue(item));
  }
  if (isPlainRecord(value)) {
    const out: Record<string, PythonValue> = {};
    for (const [key, member] of Object.entries(value)) {
      out[key] = toPythonValue(member);
    }
    return out;
  }
  return value;
}

/**
 * Extract a human-readable error message from a parsed error body — TS
 * port of `_error_message` (`api_client.py:81-106`).
 *
 * Mixpanel error bodies are either a JSON object with an `error` key, a
 * plain-text blob, or nothing at all. Any of those can be empty or
 * blank, which must not produce a blank exception message.
 *
 * `{"error": null}` and an ABSENT `error` key are indistinguishable to
 * Python's `body.get("error") is None` — both yield the default, never
 * the string `"None"` (review-resolution R11).
 *
 * @param responseBody - Parsed JSON value, raw text, or `null`.
 * @param defaultMessage - Message when the body carries no usable text.
 * @returns The extracted message, or the default when the body is
 *   missing, blank, or has no `error` key. Non-string `error` values
 *   (lists, nested objects) are stringified rather than returned as-is.
 */
export function errorMessage(
  responseBody: JsonValue | null,
  defaultMessage: string,
): string {
  let text: string;
  if (isPlainRecord(responseBody)) {
    const raw = Object.hasOwn(responseBody, "error")
      ? responseBody["error"]
      : undefined;
    if (raw === undefined || raw === null) {
      return defaultMessage;
    }
    text = typeof raw === "string" ? raw : jsonValuePythonStr(raw);
  } else if (typeof responseBody === "string") {
    // Python `body[:200]` counts CODEPOINTS (R11.6).
    text = cpSlice(responseBody, 0, 200);
  } else {
    return defaultMessage;
  }
  // Python `text.strip()` uses the CPython whitespace set (R11.3 dep).
  return pythonStrip(text) === "" ? defaultMessage : text;
}

/**
 * Parse a response body exactly as `_handle_response`'s opening block
 * does: lossless JSON (with the `json.loads` non-finite constants —
 * arbiter fix F1), else the first 500 codepoints of the text, else
 * `null` for an empty body.
 *
 * @param text - The raw body text.
 * @returns Parsed value, truncated text, or `null`.
 * @throws RangeError - Parser stack overflow on a pathologically nested
 *   body — the `except json.JSONDecodeError` scope does not cover
 *   Python's RecursionError either (arbiter fix F3/A2).
 */
function parseBody(text: string): JsonValue | null {
  try {
    return parseLossless(text, { pythonConstants: true });
  } catch (error) {
    // Python catches `json.JSONDecodeError` ONLY — anything else (the
    // RecursionError analog) propagates.
    if (!(error instanceof LosslessJsonError)) {
      throw error;
    }
    // Python: `response.text[:500] if response.text else None`.
    return text === "" ? null : cpSlice(text, 0, 500);
  }
}

/**
 * Explicit `raise_for_status` port (R2.11): throw a normalized
 * {@link MixpanelHttpError} for any non-2xx status. By the time the
 * `_handle_response` tail runs, only 1xx/3xx remain (2xx pass; every
 * 4xx/5xx raised earlier) — httpx raises `HTTPStatusError` for those,
 * which `_execute_with_retry` catches at `:801` and wraps as
 * `HTTP_ERROR`; a 3xx with a JSON object body is an ERROR, never a
 * success return (review-resolution R6).
 *
 * @param response - The response.
 * @param requestUrl - URL for the message (out of contract).
 * @throws MixpanelHttpError - For any status outside 200-299.
 */
function raiseForStatus(
  response: WireResponse,
  requestUrl: string | null | undefined,
): void {
  if (response.status < 200 || response.status >= 300) {
    throw new MixpanelHttpError(
      `HTTP status ${response.status} for url ${requestUrl ?? "<unknown>"}`,
      { status: response.status },
    );
  }
}

/**
 * Handle an API response, raising appropriate exceptions with full
 * context — TS port of `_handle_response` (`api_client.py:503-662`),
 * every branch in exact source order.
 *
 * Status code handling:
 * - 200-299: parse and return the lossless JSON body
 * - 401: `AuthenticationError` (invalid credentials)
 * - 403 + `SESSION_RECORDING_SENSITIVE_DATA` in the serialized body:
 *   `SessionReplayAccessError` (044-session-replay); other 403:
 *   `QueryError` ("Permission denied")
 * - 400: `QueryError` ("Unknown error"); 404: `QueryError` ("Resource
 *   not found"); other 4xx: `QueryError` ("Request failed")
 * - 5xx: `ServerError` ("Server error: " prefix)
 *
 * 429 is handled by the callers' retry loops, never here.
 *
 * @param response - The HTTP response to handle.
 * @param context - Request context + bound project id.
 * @returns Parsed lossless JSON body for successful requests (objects,
 *   arrays, AND bare JSON scalars — httpx `.json()` returns scalars too).
 * @throws AuthenticationError - On 401.
 * @throws SessionReplayAccessError - On the flagged 403.
 * @throws QueryError - On 400/403/404/other 4xx.
 * @throws ServerError - On 5xx.
 * @throws MixpanelHttpError - For residual non-2xx (1xx/3xx) statuses.
 * @throws MixpanelHeadlessError - Code `INVALID_RESPONSE` for a 2xx
 *   non-JSON body.
 */
export function handleResponse(
  response: WireResponse,
  context: ResponseContext,
): JsonValue {
  const responseBody = parseBody(response.text);
  const requestMethod = context.requestMethod ?? null;
  const requestUrl = context.requestUrl ?? null;
  const requestParams = context.requestParams ?? null;
  const requestBody = context.requestBody ?? null;

  if (response.status === 401) {
    throw new AuthenticationError(
      "Invalid credentials. Check username, secret, and project_id.",
      {
        statusCode: response.status,
        responseBody,
        requestMethod,
        requestUrl,
        requestParams,
        requestBody,
      },
    );
  }
  if (response.status === 403) {
    // 044-session-replay: a 403 mentioning SESSION_RECORDING_SENSITIVE_DATA
    // means the project's sensitive-data flag is set and the caller lacks
    // the `sensitive_data_replay` permission. Map to SessionReplayAccessError
    // so callers can branch on it instead of pattern-matching the message.
    //
    // Python (post-FIX-2, `api_client.py:565-574`): serialize every
    // non-str JSON body for the sniff (None → ""), giving uniform
    // SUBSTRING semantics across dict/list/scalar bodies — no TypeError
    // possible (fix-of-record:
    // context/phase3/bug-reports/python-handle-response-403-typeerror.md;
    // the R10.7 element-membership / TypeError twin retired with it).
    const flag = "SESSION_RECORDING_SENSITIVE_DATA";
    let bodyText: string;
    if (typeof responseBody === "string") {
      bodyText = responseBody;
    } else if (responseBody === null) {
      bodyText = "";
    } else {
      bodyText = jsonDumpsLike(responseBody);
    }
    const flagged = bodyText.includes(flag);
    if (flagged) {
      const projectIdInt = pythonInt(context.projectId);
      throw new SessionReplayAccessError(
        `Project ${projectIdInt} has SESSION_RECORDING_SENSITIVE_DATA` +
          " enabled. Your account lacks sensitive-data access. Contact" +
          " the project owner to grant the 'sensitive_data_replay'" +
          " permission, or use a service account that has it.",
        {
          details: {
            project_id: projectIdInt,
            flag: "SESSION_RECORDING_SENSITIVE_DATA",
            permission_required: "sensitive_data_replay",
          },
          statusCode: response.status,
          responseBody,
          requestMethod,
          requestUrl,
          requestParams,
          requestBody,
        },
      );
    }
    throw new QueryError(errorMessage(responseBody, "Permission denied"), {
      statusCode: response.status,
      responseBody,
      requestMethod,
      requestUrl,
      requestParams,
      requestBody,
    });
  }
  if (response.status === 400) {
    throw new QueryError(errorMessage(responseBody, "Unknown error"), {
      statusCode: response.status,
      responseBody,
      requestMethod,
      requestUrl,
      requestParams,
      requestBody,
    });
  }
  if (response.status === 404) {
    throw new QueryError(errorMessage(responseBody, "Resource not found"), {
      statusCode: response.status,
      responseBody,
      requestMethod,
      requestUrl,
      requestParams,
      requestBody,
    });
  }
  if (response.status >= 400 && response.status < 500) {
    // Any other 4xx (e.g. 412 Precondition Failed) — preserve the
    // response body and status as a QueryError instead of letting it
    // fall through to a generic HTTP error in executeWithRetry.
    throw new QueryError(errorMessage(responseBody, "Request failed"), {
      statusCode: response.status,
      responseBody,
      requestMethod,
      requestUrl,
      requestParams,
      requestBody,
    });
  }
  if (response.status >= 500) {
    throw new ServerError(
      `Server error: ${errorMessage(responseBody, String(response.status))}`,
      {
        statusCode: response.status,
        responseBody,
        requestMethod,
        requestUrl,
        requestParams,
        requestBody,
      },
    );
  }
  // Fallthrough tail in EXACT source order (api_client.py:652-662 /
  // review-resolution R6): (i) raise_for_status FIRST ...
  raiseForStatus(response, requestUrl);
  // ... (ii) object/array bodies return as-is ...
  if (
    responseBody !== null &&
    (isPlainRecord(responseBody) || Array.isArray(responseBody))
  ) {
    return responseBody;
  }
  // ... (iii) re-parse: a JSON scalar (42, "ok", true, null) is RETURNED
  // as the result (httpx: Response(200, b"42").json() → 42); only a
  // parse FAILURE raises INVALID_RESPONSE (`except json.JSONDecodeError`
  // scope — anything else propagates, arbiter fix F3/A2).
  try {
    return parseLossless(response.text, { pythonConstants: true });
  } catch (error) {
    if (!(error instanceof LosslessJsonError)) {
      throw error;
    }
    throw new MixpanelHeadlessError(
      `Non-JSON response from ${requestMethod} ${requestUrl} ` +
        `(status ${response.status}): ${cpSlice(response.text, 0, 500)}`,
      "INVALID_RESPONSE",
      null,
      { cause: error },
    );
  }
}

/** Dependencies of {@link executeWithRetry} (the B4 client wires these). */
export interface RetryExecutorDeps {
  /** Transport seam (see {@link RequestExecutor} contract). */
  readonly request: RequestExecutor;
  /** Sleep seam in MILLISECONDS (R2.12/R6.3; fake-timer friendly). */
  sleep: (ms: number) => Promise<void>;
  /** Uniform-[0,1) RNG for backoff jitter (injectable, Discrepancy #1). */
  readonly random: RandomSource;
  /** Maximum retry attempts for rate-limited requests (Python default 3). */
  readonly maxRetries: number;
  /**
   * Resolve the default request timeout for a URL — the
   * `self._default_timeout(url)` seam (`api_client.py:489-509`): an
   * explicit constructor timeout wins; otherwise the default is
   * route-aware (135s on App API routes, 503s elsewhere), sized to
   * outlast the server's own read deadline.
   *
   * @param url - The full request URL.
   * @returns The timeout in seconds.
   */
  defaultTimeoutSeconds: (url: string) => number;
  /**
   * The B0-owned 4-layer header merge, pre-bound to the session
   * (`headers.ts` `requestHeaders`; B4-C1 imports it by name).
   *
   * @param extra - Per-call headers (Authorization etc.).
   * @returns The merged header set.
   */
  requestHeaders: (extra: Record<string, string>) => Record<string, string>;
  /** Bound project id (`session.project.id`). */
  readonly projectId: string;
  /** Optional retry-warning logger (R9.5; never vector-compared). */
  readonly logger?: RetryLogger | undefined;
}

/** Arguments of one {@link executeWithRetry} call (Python kwargs). */
export interface ExecuteWithRetryArgs {
  /** HTTP method (GET, POST, etc.). */
  readonly method: string;
  /** Full URL to request. */
  readonly url: string;
  /**
   * Optional query parameters — MUTATED with `query_origin` exactly as
   * Python mutates the caller's dict (B0-notes decision 6).
   */
  readonly params?: Record<string, unknown> | null | undefined;
  /** Optional JSON request body. */
  readonly jsonData?: Record<string, unknown> | null | undefined;
  /** Optional form-encoded request body. */
  readonly formData?: Record<string, string> | null | undefined;
  /** Request headers (must include Authorization). */
  readonly headers: Record<string, string>;
  /** Optional per-call timeout in seconds. */
  readonly timeoutSeconds?: number | null | undefined;
}

/**
 * Execute an HTTP request with retry logic for rate limiting — TS port
 * of `_execute_with_retry` (`api_client.py:706-820`).
 *
 * The core request-execution path shared by the Query-host methods and
 * the public `request()` escape hatch (both B4). Injects the canonical
 * `query_origin` telemetry param (caller values are overwritten), merges
 * headers through the B0-owned 4-layer merge, retries 429s with
 * Retry-After/backoff timing, and maps error responses via
 * {@link handleResponse}.
 *
 * @param deps - Injected client dependencies.
 * @param args - The request.
 * @returns Parsed lossless JSON response.
 * @throws AuthenticationError - Invalid credentials (401).
 * @throws RateLimitError - Rate limit exceeded after max retries (429);
 *   carries `retry_after`, the lossless body, and `project_id` at EVERY
 *   raise site (FF4).
 * @throws QueryError - Invalid parameters (400/403/404/4xx).
 * @throws ServerError - Server-side errors (5xx).
 * @throws MixpanelHeadlessError - Code `HTTP_ERROR` for network /
 *   transport / residual-status errors (R2.10).
 */
export async function executeWithRetry(
  deps: RetryExecutorDeps,
  args: ExecuteWithRetryArgs,
): Promise<JsonValue> {
  const jsonData = args.jsonData ?? null;
  const formData = args.formData ?? null;
  // Python `request_body = json_data or form_data` — dict TRUTHINESS: an
  // empty json_data falls through to form_data (watchlist §8 item 6).
  const requestBody: Record<string, unknown> | null =
    jsonData !== null && Object.keys(jsonData).length > 0 ? jsonData : formData;
  // Python `if params is None: params = {}` then in-place mutation — the
  // caller's object is deliberately shared (B0-notes decision 6).
  const params = args.params ?? {};
  params["query_origin"] = QUERY_ORIGIN;
  const requestHeaders = deps.requestHeaders(args.headers);
  // Python `timeout or self._default_timeout(url)`: None AND 0 both
  // fall back (truthiness preserved on purpose) to the route-aware
  // default (explicit constructor timeout wins inside the seam).
  const timeoutSeconds =
    args.timeoutSeconds !== null &&
    args.timeoutSeconds !== undefined &&
    args.timeoutSeconds !== 0
      ? args.timeoutSeconds
      : deps.defaultTimeoutSeconds(args.url);

  for (let attempt = 0; attempt <= deps.maxRetries; attempt += 1) {
    try {
      const response = await deps.request({
        method: args.method,
        url: args.url,
        params,
        jsonBody: jsonData,
        formBody: formData,
        headers: requestHeaders,
        timeoutSeconds,
      });

      if (response.status === 429) {
        if (attempt >= deps.maxRetries) {
          const retryAfter = parseRetryAfter(response);
          const responseBody = parseBody(response.text);
          throw new RateLimitError("Rate limit exceeded after max retries", {
            retryAfter,
            statusCode: response.status,
            responseBody,
            requestMethod: args.method,
            requestUrl: args.url,
            requestParams: params,
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

      return handleResponse(response, {
        requestMethod: args.method,
        requestUrl: args.url,
        requestParams: params,
        requestBody,
        projectId: deps.projectId,
      });
    } catch (error) {
      // R2.10: `except httpx.HTTPError` ports as the instanceof filter —
      // library errors (QueryError, RateLimitError, ...) pass through.
      if (!(error instanceof MixpanelHttpError)) {
        throw error;
      }
      throw new MixpanelHeadlessError(
        `HTTP error: ${error.message}`,
        "HTTP_ERROR",
        {
          error: error.message,
          request_method: args.method,
          request_url: args.url,
          request_params: params,
        },
        { cause: error },
      );
    }
  }

  // Should not reach here (loop always returns/throws when maxRetries
  // >= 0), but mirror Python's type-checker-satisfying raise — reduced
  // constructor shape per FF4 (no retry_after/status_code/response_body).
  throw new RateLimitError("Rate limit exceeded after max retries", {
    requestMethod: args.method,
    requestUrl: args.url,
    requestParams: params,
    projectId: deps.projectId,
  });
}

/**
 * Shared body-parse helper for the B0 retry loops' 429-exhaustion raises
 * (`app-request.ts` reuses it; exported for that one consumer).
 *
 * @param text - The raw body text.
 * @returns Parsed value, truncated text, or `null`.
 */
export { parseBody };
