/**
 * Cursor-based pagination helper for the App API: `paginateAll` follows
 * `pagination.next_cursor` as a lazy async generator. Python's private
 * wiring is ported verbatim rather than routed through `appRequest` /
 * `executeWithRetry`: literal `Authorization`-only headers (no four-layer
 * merge, no User-Agent), its own unjittered 429 loop per page,
 * `NETWORK_ERROR` rather than `HTTP_ERROR` for transport failures, and a
 * reduced `RateLimitError` shape. Like the Python module it is wired into
 * no client method; routing a listing through it would diverge from every
 * recorded request sequence.
 *
 * @see mixpanel_headless._internal.pagination.paginate_all
 */

import { pythonFloat, pythonFloatStr } from "../compat/index.js";
import {
  AuthenticationError,
  MixpanelHeadlessError,
  RateLimitError,
  ServerError,
} from "../errors.js";
import type { ClientCore } from "./core.js";
import {
  isPlainRecord,
  MixpanelHttpError,
  type WireResponse,
} from "./internals.js";
import { JsonNumber, type JsonValue } from "./json-value.js";
import { parseLossless } from "./lossless-json.js";
import { normalizedAbortError } from "./transport.js";

/**
 * Maximum number of pages to fetch before raising an error (Python
 * `MAX_PAGES`). Prevents infinite loops when the server returns a
 * non-null cursor indefinitely. Overridable per call via
 * {@link PaginateAllOptions.maxPages} (the injectable replacement for
 * the Python tests' `MAX_PAGES` monkeypatch).
 */
const MAX_PAGES = 10000;

/**
 * Maximum number of retries for rate-limited (429) responses per page
 * request (Python `MAX_RATE_LIMIT_RETRIES`) — per-paginator, independent
 * of the client's `max_retries`.
 */
export const MAX_RATE_LIMIT_RETRIES = 3;

/**
 * Base delay in seconds for exponential backoff on 429 retries (Python
 * `_BACKOFF_BASE`); the millisecond conversion happens only at the sleep
 * seam.
 */
const PAGINATION_BACKOFF_BASE_SECONDS = 1.0;

/** Maximum backoff delay in seconds (Python `_BACKOFF_MAX`). */
export const PAGINATION_BACKOFF_MAX_SECONDS = 60.0;

/**
 * Parse a `Retry-After` header value into a safe number of seconds — the
 * module-level string-input parser, not the client's response-based
 * `parseRetryAfter` in `backoff.ts`.
 *
 * @remarks
 * Anything that is not a finite, non-negative number is rejected so the
 * caller falls back to the exponential-backoff schedule. `float(raw)`
 * ports as `pythonFloat` — `"inf"` parses and is then filtered to
 * `null`; `"1,000"` fails the CPython grammar. The value is not capped
 * here; `PAGINATION_BACKOFF_MAX_SECONDS` applies at the point of
 * sleeping.
 * @param raw - Raw header value, or `null` when the header is absent.
 * @returns The advertised delay in seconds, or `null` when the header
 *   is absent, empty, unparseable, negative, NaN, or infinite.
 * @throws Any non-`PY_FLOAT_INVALID_LITERAL` error raised by
 *   `pythonFloat`, unchanged (a programming error, never a header value).
 * @see mixpanel_headless._internal.pagination._parse_retry_after
 */
function parseRetryAfterSeconds(raw: string | null): number | null {
  // Python `if not raw:` — None and "" are both falsy.
  if (raw === null || raw === "") {
    return null;
  }
  let seconds: number;
  try {
    seconds = pythonFloat(raw);
  } catch (error) {
    // The ValueError analog only (a typed guard, never a bare catch).
    if (
      error instanceof MixpanelHeadlessError &&
      error.code === "PY_FLOAT_INVALID_LITERAL"
    ) {
      return null;
    }
    throw error;
  }
  if (!Number.isFinite(seconds) || seconds < 0) {
    return null;
  }
  return seconds;
}

/**
 * Return `type(x).__name__` for a lossless-parsed wire value — the Python
 * `json.loads` product domain (`NoneType`/`bool`/`int`/`float`/`str`/
 * `list`/`dict`), used for the malformed-`results` error detail
 * (the recorded vectors lock `results_type`).
 *
 * @param value - The parsed value.
 * @returns The CPython type name.
 */
function pythonJsonTypeName(value: JsonValue): string {
  if (value === null) {
    return "NoneType";
  }
  if (typeof value === "boolean") {
    return "bool";
  }
  if (typeof value === "string") {
    return "str";
  }
  if (value instanceof JsonNumber) {
    return value.isIntegerToken() ? "int" : "float";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? "int" : "float";
  }
  if (typeof value === "bigint") {
    return "int";
  }
  if (Array.isArray(value)) {
    return "list";
  }
  return "dict";
}

/**
 * Render a followed cursor as its query-param value the way httpx's
 * `primitive_value_to_str` + `str()` would for the value Python
 * assigned into `request_params["cursor"]`.
 *
 * @remarks
 * Cursors are strings in every recorded exchange; the non-string arms
 * exist only because Python's `dict[str, str]` annotation is not
 * enforced at runtime. Integer tokens keep their exact digits; float
 * tokens render via the CPython float repr.
 * @param cursor - The non-null `next_cursor` value.
 * @returns The value to place in the request params.
 */
function cursorParamValue(cursor: JsonValue): unknown {
  if (cursor instanceof JsonNumber) {
    // Divergence: a numeric `next_cursor` is re-spelled here — integer
    // tokens keep their digits, float tokens take the CPython float repr
    // (`str(500.0) == "500.0"`), which is how Python's params render a
    // parsed float. Only string cursors are ever observed.
    return cursor.isIntegerToken()
      ? cursor.raw
      : pythonFloatStr(cursor.toNumber());
  }
  return cursor;
}

/**
 * The client slice {@link paginateAll} consumes (Python takes the
 * whole `MixpanelAPIClient`; the TS paginator reaches the same
 * internals through the {@link ClientCore} seam).
 */
export interface PaginationClient {
  /**
   * The shared client-internals seam.
   *
   * @internal
   */
  readonly core: ClientCore;
}

/**
 * Keyword options of {@link paginateAll} (Python kw-only args + the
 * TS seams).
 */
export interface PaginateAllOptions {
  /** Optional additional query parameters for each request. */
  readonly params?: Readonly<Record<string, string>> | null | undefined;
  /**
   * Number of items per page (Python `page_size`).
   *
   * @defaultValue `100`
   */
  readonly page_size?: number | undefined;
  /**
   * Page-limit override — the injectable replacement for Python tests'
   * `MAX_PAGES` monkeypatch; an option, not a mutable module global.
   *
   * @defaultValue `10000` ({@link MAX_PAGES})
   */
  readonly maxPages?: number | undefined;
  /** Optional cancellation signal. */
  readonly signal?: AbortSignal | undefined;
}

/**
 * Iterate through all pages of a paginated App API response.
 *
 * @remarks
 * Makes repeated raw GET requests to the App API path, following the
 * `pagination.next_cursor` field until it is `null`/absent. The
 * canonical `query_origin=mixpanel-headless` telemetry param is set
 * last so caller params can never override it.
 * @param client - The assembled client (per-request auth resolution is
 *   preserved).
 * @param path - App API path (e.g. `/projects/12345/dashboards`).
 * @param options - Optional params, `page_size` (default 100),
 *   `maxPages` (default 10000) and cancellation `signal`.
 * @yields Each individual item across all pages, in page order.
 * @throws {@link AuthenticationError} - Invalid credentials (401).
 * @throws {@link RateLimitError} - Rate limit exceeded after the maximum
 *   retries (429; the reduced constructor shape — no `project_id`, no
 *   `request_params`).
 * @throws {@link ServerError} - Server-side errors (5xx).
 * @throws {@link MixpanelHeadlessError} - `NETWORK_ERROR` (transport
 *   failure), `PAGINATION_LIMIT` (page limit exceeded), `API_ERROR` (other
 *   non-2xx statuses, unfollowed 3xx included), or `INVALID_RESPONSE`
 *   (non-JSON body, or a `results` field that is neither a list nor
 *   null).
 * @throws {@link DOMException} - Name `AbortError` on cancellation.
 * @example
 * ```typescript
 * const client = createMixpanelClient({ session });
 * const dashboards = [];
 * for await (const item of paginateAll(
 *   client,
 *   "/projects/12345/dashboards",
 *   { page_size: 50 },
 * )) {
 *   dashboards.push(item);
 * }
 * ```
 * @see mixpanel_headless._internal.pagination.paginate_all
 */
// eslint-disable-next-line complexity, max-lines-per-function -- branch-for-branch port of one Python function (see the docblock); splitting it would scatter the guard order the corpus pins
export async function* paginateAll(
  client: PaginationClient,
  path: string,
  options: PaginateAllOptions = {},
): AsyncGenerator<JsonValue, void, undefined> {
  const core = client.core;
  const params = options.params ?? null;
  const pageSize = options.page_size ?? 100;
  const maxPages = options.maxPages ?? MAX_PAGES;
  const signal = options.signal;
  // The client's signal-aware closures; `deps.request` is the raw
  // text-buffering transport view — this walk never enters
  // `executeWithRetry`.
  const deps = core.executeDeps(signal);

  let nextCursor: JsonValue | null = null;
  let pageCount = 0;

  for (;;) {
    // Cancellation check between pages.
    if (signal?.aborted === true) {
      throw normalizedAbortError(signal.reason);
    }
    pageCount += 1;

    if (pageCount > maxPages) {
      throw new MixpanelHeadlessError(
        "Pagination exceeded maximum page limit",
        "PAGINATION_LIMIT",
        { max_pages: maxPages, path },
      );
    }

    // Python dict insertion-order semantics carry over 1:1: page_size
    // first, caller params merged (an existing key keeps its position),
    // cursor, then query_origin set last so callers can't override the
    // canonical telemetry value.
    const requestParams: Record<string, unknown> = {
      page_size: String(pageSize),
    };
    if (params !== null) {
      Object.assign(requestParams, params);
    }
    if (nextCursor !== null) {
      requestParams["cursor"] = cursorParamValue(nextCursor);
    }
    requestParams["query_origin"] = "mixpanel-headless";

    const url = core.buildUrl("app", path);
    // Per-page, per-request auth resolution. Literal header set — no
    // `requestHeaders` merge, exactly like the Python module.
    const headers = { Authorization: await core.getAuthHeader() };

    let response: WireResponse | null = null;

    for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
      try {
        response = await deps.request({
          method: "GET",
          url,
          params: requestParams,
          jsonBody: null,
          formBody: null,
          headers,
          // `client._default_timeout(url)` — never
          // the raw client timeout: a bare None would mean "no timeout
          // at all" in httpx; the route-aware default outlasts the App
          // API's ~120s server deadline instead.
          timeoutSeconds: core.defaultTimeoutSeconds(url),
        });
      } catch (error) {
        // `except httpx.HTTPError` — the transport-error class filter
        // (no bare catch; AbortError and library errors pass).
        if (!(error instanceof MixpanelHttpError)) {
          throw error;
        }
        throw new MixpanelHeadlessError(
          `Network error during pagination: ${error.message}`,
          "NETWORK_ERROR",
          { path, error: error.message },
          { cause: error },
        );
      }

      // Handle 429 with retry/backoff.
      if (response.status === 429) {
        const advertised = parseRetryAfterSeconds(
          response.header("Retry-After"),
        );
        if (attempt >= MAX_RATE_LIMIT_RETRIES) {
          // Reduced shape: retry_after = int(advertised) truncation or
          // None; no project_id, no request_params.
          const retryAfter =
            advertised === null ? null : Math.trunc(advertised);
          throw new RateLimitError(
            "Rate limit exceeded after max retries during pagination",
            {
              retryAfter,
              statusCode: 429,
              responseBody: response.text,
              requestMethod: "GET",
              requestUrl: url,
            },
          );
        }
        // Honor a sane Retry-After, but never sleep longer than the
        // backoff cap. No jitter in either arm.
        const waitSeconds =
          advertised === null
            ? Math.min(
                PAGINATION_BACKOFF_BASE_SECONDS * 2 ** attempt,
                PAGINATION_BACKOFF_MAX_SECONDS,
              )
            : Math.min(advertised, PAGINATION_BACKOFF_MAX_SECONDS);
        core.logger?.warning(
          `Rate limited during pagination, retrying in ` +
            `${waitSeconds.toFixed(1)} seconds ` +
            `(attempt ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES})`,
        );
        await deps.sleep(waitSeconds * 1000); // seconds→ms seam.
        continue;
      }

      // Not a 429 — break out of the retry loop.
      break;
    }

    // At this point response is guaranteed non-null.
    if (response === null) {
      throw new Error(
        "unreachable: pagination retry loop produced no response",
      );
    }

    // httpx `raise_for_status()` raises for every non-2xx status —
    // unfollowed 3xx included.
    if (response.status < 200 || response.status >= 300) {
      const status = response.status;
      const body = response.text;
      if (status === 401) {
        throw new AuthenticationError(
          `Authentication failed during pagination: ${body}`,
          {
            statusCode: status,
            responseBody: body,
            requestMethod: "GET",
            requestUrl: url,
          },
        );
      }
      if (status >= 500) {
        throw new ServerError(`Server error during pagination: ${body}`, {
          statusCode: status,
          responseBody: body,
          requestMethod: "GET",
          requestUrl: url,
        });
      }
      throw new MixpanelHeadlessError(
        `HTTP ${status} during pagination: ${body}`,
        "API_ERROR",
        { status_code: status, response_body: body },
      );
    }

    // `response.json()` → lossless with Python constants (`json.loads`
    // accepts NaN/Infinity).
    let data: JsonValue;
    try {
      data = parseLossless(response.text, { pythonConstants: true });
    } catch (error) {
      // Python catches a broad `except Exception` at this site — unlike
      // the `except json.JSONDecodeError` sites elsewhere — so every
      // parse failure (a RangeError from pathological nesting included)
      // wraps as INVALID_RESPONSE.
      const contentType = response.header("content-type");
      throw new MixpanelHeadlessError(
        `Non-JSON response during pagination (content-type: ` +
          `${contentType ?? "unknown"})`,
        "INVALID_RESPONSE",
        // Python's details use `.get` without the "unknown" default —
        // the key is present with None/null when the header is absent.
        { content_type: contentType },
        { cause: error },
      );
    }

    // Extract results. `isinstance(data, dict)` over a json.loads
    // product is the "JSON object body" predicate → isPlainRecord.
    let results: readonly JsonValue[] = [];
    if (isPlainRecord(data)) {
      // `dict.get("results")` — absent key and explicit JSON null both
      // read as None: an empty page (the cursor, not this field, ends
      // iteration).
      const rawResults: JsonValue = Object.hasOwn(data, "results")
        ? (data["results"] as JsonValue)
        : null;
      if (rawResults === null) {
        results = [];
      } else if (Array.isArray(rawResults)) {
        results = rawResults;
      } else {
        // Iterating a str would yield characters and a dict would
        // yield keys — corrupt output dressed up as success.
        const typeName = pythonJsonTypeName(rawResults);
        throw new MixpanelHeadlessError(
          `Malformed paginated response: 'results' must be a list, got ${
            typeName
          }`,
          "INVALID_RESPONSE",
          { path, results_type: typeName },
        );
      }
    } else if (Array.isArray(data)) {
      // A top-level list body yields directly.
      results = data;
    }

    // `yield from results` — item-level yield*.
    yield* results;

    // Check for the next page: only a truthy dict
    // `pagination` block is consulted (an empty dict is falsy).
    let pagination: JsonValue = null;
    if (isPlainRecord(data)) {
      pagination = Object.hasOwn(data, "pagination")
        ? (data["pagination"] as JsonValue)
        : null;
    }
    if (isPlainRecord(pagination) && Object.keys(pagination).length > 0) {
      nextCursor = Object.hasOwn(pagination, "next_cursor")
        ? (pagination["next_cursor"] as JsonValue)
        : null;
    } else {
      nextCursor = null;
    }

    if (nextCursor === null) {
      break;
    }
  }
}
