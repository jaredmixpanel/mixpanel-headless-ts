/**
 * Shared client internals: the transport error class, response handling
 * with every branch in Python source order, the 429 retry loop and the
 * error-message extraction that the entity clients and query-host methods
 * all import — nothing else re-implements response handling, retries or
 * error mapping. Bodies parse through {@link parseLossless} only, never
 * `JSON.parse`, so `18` vs `18.0` and integers beyond 2^53 survive into
 * results and error `response_body` bags. The injected
 * {@link RequestExecutor} normalizes every transport failure to
 * {@link MixpanelHttpError} and uses `redirect: 'manual'`, as httpx does.
 *
 * @see mixpanel_headless._internal.api_client.MixpanelAPIClient._handle_response
 * @see mixpanel_headless._internal.api_client.MixpanelAPIClient._execute_with_retry
 */

import {
  cpSlice,
  pythonInt,
  pythonStr,
  pythonStrip,
  type PythonValue,
  setOwn,
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
 * Deliberately not part of the ported `MixpanelHeadlessError` hierarchy
 * (httpx errors are external to it in Python too): adapters normalize
 * every transport failure to this class, and the retry loops
 * catch it with the `if (!(e instanceof MixpanelHttpError)) throw e;`
 * idiom before wrapping it as `MixpanelHeadlessError` code `HTTP_ERROR`.
 * Library callers therefore never observe it directly.
 *
 * @example
 * ```typescript
 * throw new MixpanelHttpError("connect ECONNREFUSED", { cause: error });
 * // or, from raiseForStatus:
 * new MixpanelHttpError("HTTP status 302 for url …", { status: 302 }).status; // 302
 * ```
 */
export class MixpanelHttpError extends Error {
  /** HTTP status when the failure came from a live response. */
  readonly status: number | null;

  /**
   * Create a transport-level error.
   *
   * @param message - Human-readable description (out of contract).
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

/** The response slice the internals consume (adapter-produced). */
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
  /** Request timeout in seconds (the Python unit). */
  readonly timeoutSeconds: number;
}

/**
 * The injected transport seam (`transport.ts` implements it over fetch).
 *
 * Must reject with {@link MixpanelHttpError} for every transport-level
 * failure (fetch `TypeError` / `DOMException` / `UND_ERR_*`) and request
 * with `redirect: 'manual'`.
 */
export type RequestExecutor = (
  options: TransportRequestOptions,
) => Promise<WireResponse>;

/** Minimal logger seam (log text is never vector-compared). */
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
 * Fix the leading argument of a module-level method implementation.
 *
 * @remarks
 * The client factories keep their methods as plain functions whose first
 * parameter is the shared client core (or the assembled client context)
 * and re-attach them to the method bag they return with
 * `{ listDashboards: bindFirst(core, listDashboards) }` — no closure per
 * method, so nothing can be captured by accident.
 * @param first - The value bound as `method`'s first argument.
 * @param method - A function taking that value first.
 * @returns `method` with its first parameter fixed.
 * @example
 * ```typescript
 * const listDashboards = bindFirst(core, listDashboardsImpl);
 * await listDashboards({ ids: [1, 2] });
 * ```
 */
export function bindFirst<First, Args extends unknown[], Result>(
  first: First,
  method: (first: First, ...args: Args) => Result,
): (...args: Args) => Result {
  return (...args: Args): Result => method(first, ...args);
}

/**
 * Report whether a parsed JSON value is a plain record (Python `dict`).
 *
 * @remarks
 * `JsonNumber` instances are objects but not dicts — they are the
 * lossless number tokens (never treat them as records).
 * @param value - A parsed body value.
 * @returns `true` for plain objects.
 * @example
 * ```typescript
 * isPlainRecord(parseLossless('{"a": 1}')); // true
 * isPlainRecord(parseLossless("18.0")); // false — a JsonNumber
 * ```
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
 * consumed only by the 403 branch's substring scan
 * (`"SESSION_RECORDING_SENSITIVE_DATA" in body_text`, applied uniformly
 * to dict/list/scalar bodies). Separator/escaping
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
 * `error` stringification (message text, out of contract) and by the
 * `engage_stats` non-dict guard and the `get_events` /
 * `get_property_values` `str(e)` element casts.
 *
 * @remarks
 * Integer `JsonNumber` tokens map to `bigint` (Python `int`, arbitrary
 * precision); float tokens map to `number` — an integral float token
 * (`42.0`) therefore renders `"42"` where Python says `"42.0"`, a
 * documented message-text-only approximation.
 * @param value - The parsed value.
 * @returns Python's `str()` rendering (containers via `repr`).
 * @example
 * ```typescript
 * jsonValuePythonStr(parseLossless('["a", 1, null]')); // "['a', 1, None]"
 * ```
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
      setOwn(out, key, toPythonValue(member));
    }
    return out;
  }
  return value;
}

/**
 * Read an error response body the way the Python client does
 * (`response.json()` with the JSONDecodeError fallback
 * `body.decode()[:500] if body else None`): the lossless parse with
 * json.loads' non-finite constants accepted, else the first 500 code
 * points of the text, else `null` for an empty body.
 *
 * @param text - The response body text.
 * @returns The parsed body, its 500-code-point prefix, or `null`.
 * @throws Any non-`LosslessJsonError` from the parser, unchanged (the
 *   `RecursionError` analog on a pathologically nested body).
 * @example
 * ```typescript
 * parseErrorBody('{"error": "bad"}'); // { error: "bad" }
 * parseErrorBody("<html>oops</html>"); // "<html>oops</html>"
 * parseErrorBody(""); // null
 * ```
 */
export function parseErrorBody(text: string): JsonValue | null {
  try {
    return parseLossless(text, { pythonConstants: true });
  } catch (error) {
    if (!(error instanceof LosslessJsonError)) {
      throw error;
    }
    return text === "" ? null : cpSlice(text, 0, 500);
  }
}

/**
 * Extract a human-readable error message from a parsed error body.
 *
 * @remarks
 * Mixpanel error bodies are either a JSON object with an `error` key, a
 * plain-text blob, or nothing at all. Any of those can be empty or
 * blank, which must not produce a blank exception message. A body of
 * `{"error": null}` and an absent `error` key are indistinguishable to
 * Python's `body.get("error") is None` — both yield the default, never
 * the string `"None"`.
 * @param responseBody - Parsed JSON value, raw text, or `null`.
 * @param defaultMessage - Message when the body carries no usable text.
 * @returns The extracted message, or the default when the body is
 *   missing, blank, or has no `error` key. Non-string `error` values
 *   (lists, nested objects) are stringified rather than returned as-is.
 * @example
 * ```typescript
 * errorMessage(parseLossless('{"error": "Invalid date"}'), "Unknown error");
 * // "Invalid date"
 * errorMessage(parseLossless('{"error": null}'), "Unknown error");
 * // "Unknown error"
 * ```
 * @see mixpanel_headless._internal.api_client._error_message
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
    // Python `body[:200]` counts code points.
    text = cpSlice(responseBody, 0, 200);
  } else {
    return defaultMessage;
  }
  // Python `text.strip()` uses the CPython whitespace set.
  return pythonStrip(text) === "" ? defaultMessage : text;
}

/**
 * Parse a response body exactly as `_handle_response`'s opening block
 * does: lossless JSON (with the `json.loads` non-finite constants), else
 * the first 500 codepoints of the text, else `null` for an empty body.
 *
 * @param text - The raw body text.
 * @returns Parsed value, truncated text, or `null`.
 * @throws {@link RangeError} - Parser stack overflow on a pathologically
 *   nested body — the `except json.JSONDecodeError` scope does not cover
 *   Python's RecursionError either.
 */
function parseBody(text: string): JsonValue | null {
  try {
    return parseLossless(text, { pythonConstants: true });
  } catch (error) {
    // Python catches `json.JSONDecodeError` only — anything else (the
    // RecursionError analog) propagates.
    if (!(error instanceof LosslessJsonError)) {
      throw error;
    }
    // Python: `response.text[:500] if response.text else None`.
    return text === "" ? null : cpSlice(text, 0, 500);
  }
}

/**
 * Explicit `raise_for_status` port: throw a normalized
 * {@link MixpanelHttpError} for any non-2xx status. By the time the
 * `_handle_response` tail runs, only 1xx/3xx remain (2xx pass; every
 * 4xx/5xx raised earlier) — httpx raises `HTTPStatusError` for those,
 * which `_execute_with_retry` catches and wraps as `HTTP_ERROR`; a 3xx
 * with a JSON object body is an error, never a success return.
 *
 * @param response - The response.
 * @param requestUrl - URL for the message (out of contract).
 * @throws {@link MixpanelHttpError} - For any status outside 200-299.
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
 * Handle an API response, raising the appropriate error with full context
 * (every branch in Python source order).
 *
 * @remarks
 * Status code handling:
 * - 200-299: parse and return the lossless JSON body
 * - 401: `AuthenticationError` (invalid credentials)
 * - 403 + `SESSION_RECORDING_SENSITIVE_DATA` in the serialized body:
 *   `SessionReplayAccessError`; other 403:
 *   `QueryError` ("Permission denied")
 * - 400: `QueryError` ("Unknown error"); 404: `QueryError` ("Resource
 *   not found"); other 4xx: `QueryError` ("Request failed")
 * - 5xx: `ServerError` ("Server error: " prefix)
 * - 429 is handled by the callers' retry loops, never here.
 * @param response - The HTTP response to handle.
 * @param context - Request context + bound project id.
 * @returns Parsed lossless JSON body for successful requests (objects,
 *   arrays, and bare JSON scalars — httpx `.json()` returns scalars too).
 * @throws {@link AuthenticationError} - On 401.
 * @throws {@link SessionReplayAccessError} - On the flagged 403.
 * @throws {@link QueryError} - On 400/403/404/other 4xx.
 * @throws {@link ServerError} - On 5xx.
 * @throws {@link MixpanelHttpError} - For residual non-2xx (1xx/3xx)
 *   statuses.
 * @throws {@link MixpanelHeadlessError} - Code `INVALID_RESPONSE` for a
 *   2xx non-JSON body.
 * @example
 * ```typescript
 * const body = handleResponse(response, {
 *   requestMethod: "GET",
 *   requestUrl: url,
 *   requestParams: params,
 *   projectId: "12345",
 * });
 * // 200 → the lossless JSON body; 404 → throws QueryError("Resource not found")
 * ```
 * @see mixpanel_headless._internal.api_client.MixpanelAPIClient._handle_response
 */
// eslint-disable-next-line complexity -- branch-for-branch port of one Python function (see the docblock); splitting it would scatter the guard order the corpus pins
export function handleResponse(
  response: WireResponse,
  context: ResponseContext,
): JsonValue {
  const responseBody = parseBody(response.text);
  const requestMethod = context.requestMethod ?? null;
  const requestUrl = context.requestUrl ?? null;
  const requestParams = context.requestParams ?? null;
  const requestBody = context.requestBody ?? null;
  // One provenance bag for every throw site below: each error class
  // carries the same request/response context.
  const httpContext = {
    statusCode: response.status,
    responseBody,
    requestMethod,
    requestUrl,
    requestParams,
    requestBody,
  };

  if (response.status === 401) {
    throw new AuthenticationError(
      "Invalid credentials. Check username, secret, and project_id.",
      httpContext,
    );
  }
  if (response.status === 403) {
    // A 403 mentioning SESSION_RECORDING_SENSITIVE_DATA means the
    // project's sensitive-data flag is set and the caller lacks the
    // `sensitive_data_replay` permission. Map to SessionReplayAccessError
    // so callers can branch on it instead of pattern-matching the message.
    //
    // Python serializes every non-str JSON body for the sniff (None →
    // ""), giving uniform substring semantics across dict/list/scalar
    // bodies — no TypeError possible.
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
          ...httpContext,
        },
      );
    }
    throw new QueryError(
      errorMessage(responseBody, "Permission denied"),
      httpContext,
    );
  }
  if (response.status === 400) {
    throw new QueryError(
      errorMessage(responseBody, "Unknown error"),
      httpContext,
    );
  }
  if (response.status === 404) {
    throw new QueryError(
      errorMessage(responseBody, "Resource not found"),
      httpContext,
    );
  }
  if (response.status >= 400 && response.status < 500) {
    // Any other 4xx (e.g. 412 Precondition Failed) — preserve the
    // response body and status as a QueryError instead of letting it
    // fall through to a generic HTTP error in executeWithRetry.
    throw new QueryError(
      errorMessage(responseBody, "Request failed"),
      httpContext,
    );
  }
  if (response.status >= 500) {
    throw new ServerError(
      `Server error: ${errorMessage(responseBody, String(response.status))}`,
      httpContext,
    );
  }
  // Fallthrough tail in Python source order: (i) raise_for_status first ...
  raiseForStatus(response, requestUrl);
  // ... (ii) object/array bodies return as-is ...
  if (
    responseBody !== null &&
    (isPlainRecord(responseBody) || Array.isArray(responseBody))
  ) {
    return responseBody;
  }
  // ... (iii) re-parse: a JSON scalar (42, "ok", true, null) is returned
  // as the result (httpx: Response(200, b"42").json() → 42); only a
  // parse failure raises INVALID_RESPONSE (`except json.JSONDecodeError`
  // scope — anything else propagates).
  try {
    return parseLossless(response.text, { pythonConstants: true });
  } catch (error) {
    if (!(error instanceof LosslessJsonError)) {
      throw error;
    }
    throw new MixpanelHeadlessError(
      `Non-JSON response from ${requestMethod ?? "<unknown>"} ${requestUrl ?? "<unknown>"} ` +
        `(status ${response.status}): ${cpSlice(response.text, 0, 500)}`,
      "INVALID_RESPONSE",
      null,
      { cause: error },
    );
  }
}

/** Dependencies of {@link executeWithRetry} (the client wires these). */
export interface RetryExecutorDeps {
  /** Transport seam (see {@link RequestExecutor} contract). */
  readonly request: RequestExecutor;
  /** Sleep seam in milliseconds (fake-timer friendly). */
  sleep: (ms: number) => Promise<void>;
  /** Uniform-[0,1) RNG for backoff jitter (injectable). */
  readonly random: RandomSource;
  /** Maximum retry attempts for rate-limited requests (Python default 3). */
  readonly maxRetries: number;
  /**
   * Resolve the default request timeout for a URL — the
   * `MixpanelAPIClient._default_timeout` seam: an
   * explicit constructor timeout wins; otherwise the default is
   * route-aware (135s on App API routes, 503s elsewhere), sized to
   * outlast the server's own read deadline.
   *
   * @param url - The full request URL.
   * @returns The timeout in seconds.
   */
  defaultTimeoutSeconds: (url: string) => number;
  /**
   * The four-layer header merge, pre-bound to the session
   * (`requestHeaders` in `headers.ts`).
   *
   * @param extra - Per-call headers (Authorization etc.).
   * @returns The merged header set.
   */
  requestHeaders: (extra: Record<string, string>) => Record<string, string>;
  /** Bound project id (`session.project.id`). */
  readonly projectId: string;
  /** Optional retry-warning logger (never vector-compared). */
  readonly logger?: RetryLogger | undefined;
}

/** Arguments of one {@link executeWithRetry} call (Python kwargs). */
export interface ExecuteWithRetryArgs {
  /** HTTP method (GET, POST, etc.). */
  readonly method: string;
  /** Full URL to request. */
  readonly url: string;
  /**
   * Optional query parameters — mutated with `query_origin` exactly as
   * Python mutates the caller's dict.
   */
  readonly params?: Record<string, unknown> | null | undefined;
  /** Optional JSON request body. */
  readonly jsonData?: Record<string, unknown> | null | undefined;
  /** Optional form-encoded request body. */
  readonly formData?: Record<string, string> | null | undefined;
  /** Request headers (must include Authorization). */
  readonly headers: Record<string, string>;
  /**
   * Per-call timeout in seconds; `null` and `0` both fall back to the
   * route-aware default.
   *
   * @defaultValue `null`
   */
  readonly timeoutSeconds?: number | null | undefined;
}

/**
 * Execute an HTTP request with retry logic for rate limiting.
 *
 * @remarks
 * The core request-execution path shared by the Query-host methods and
 * the public `request()` escape hatch. Injects the canonical
 * `query_origin` telemetry param (caller values are overwritten), merges
 * headers through the four-layer merge, retries 429s with
 * Retry-After/backoff timing, and maps error responses via
 * {@link handleResponse}.
 * @param deps - Injected client dependencies.
 * @param args - The request.
 * @returns Parsed lossless JSON response.
 * @throws {@link RateLimitError} - Rate limit exceeded after the maximum
 *   retries (429); carries `retry_after`, the lossless body, and
 *   `project_id` at every raise site.
 * @throws {@link MixpanelHeadlessError} - Code `HTTP_ERROR` for network /
 *   transport / residual-status errors, plus every class
 *   {@link handleResponse} raises (`AuthenticationError`, `QueryError`,
 *   `ServerError`, …).
 * @example
 * ```typescript
 * const result = await executeWithRetry(core.executeDeps(signal), {
 *   method: "GET",
 *   url: core.buildUrl("query", "/events/names"),
 *   params: { type: "general" },
 *   headers: { Authorization: await core.getAuthHeader() },
 * });
 * ```
 * @see mixpanel_headless._internal.api_client.MixpanelAPIClient._execute_with_retry
 */
export async function executeWithRetry(
  deps: RetryExecutorDeps,
  args: ExecuteWithRetryArgs,
): Promise<JsonValue> {
  const jsonData = args.jsonData ?? null;
  const formData = args.formData ?? null;
  // Python `request_body = json_data or form_data` — dict truthiness: an
  // empty json_data falls through to form_data.
  const requestBody: Record<string, unknown> | null =
    jsonData !== null && Object.keys(jsonData).length > 0 ? jsonData : formData;
  // Python `if params is None: params = {}` then in-place mutation — the
  // caller's object is deliberately shared.
  const params = args.params ?? {};
  params["query_origin"] = QUERY_ORIGIN;
  const requestHeaders = deps.requestHeaders(args.headers);
  // Python `timeout or self._default_timeout(url)`: None and 0 both
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
        // The one seconds→milliseconds conversion point.
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
      // `except httpx.HTTPError` ports as the instanceof filter —
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
  // >= 0), but mirror Python's type-checker-satisfying raise, with the
  // reduced constructor shape (no retry_after/status_code/response_body).
  throw new RateLimitError("Rate limit exceeded after max retries", {
    requestMethod: args.method,
    requestUrl: args.url,
    requestParams: params,
    projectId: deps.projectId,
  });
}

/**
 * Shared body-parse helper for the retry loops' 429-exhaustion raises
 * (`app-request.ts` reuses it; exported for that one consumer).
 *
 * @param text - The raw body text.
 * @returns Parsed value, truncated text, or `null`.
 */
export { parseBody };
