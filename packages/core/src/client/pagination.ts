/**
 * Cursor-based pagination helper for the Mixpanel App API — Phase-3
 * packet B4-C6 port of `mixpanel_headless/_internal/pagination.py`
 * (288 LOC, whole file).
 *
 * `paginateAll` follows `pagination.next_cursor` through App API
 * responses as a lazy `async function*` (R6.1: `for await` consumable;
 * R6.6: item-level `yield*`).
 *
 * Fidelity notes (packet C6 §Measured spine — this function does NOT go
 * through `appRequest`/`executeWithRetry`; its private wiring is ported
 * verbatim):
 * - headers are the LITERAL `{Authorization: ...}` — no 4-layer
 *   `requestHeaders` merge, no User-Agent (`pagination.py:161-163`, a
 *   real divergence from the client methods; the recorded vectors lock
 *   it);
 * - its OWN 429 loop (`:168-217`) with `MAX_RATE_LIMIT_RETRIES = 3`
 *   retries per page, independent of the client's `max_retries`; wait
 *   times are UNJITTERED in both arms (unlike the client backoff — do
 *   not import `calculateBackoff`'s jitter);
 * - transport failures map to `NETWORK_ERROR` (not `HTTP_ERROR` — a
 *   different mapping from `_execute_with_retry`, `:177-182`);
 * - non-429 non-2xx statuses map 401 → AuthenticationError, ≥500 →
 *   ServerError, else `API_ERROR` (`:219-244`; httpx `raise_for_status`
 *   fires for EVERY non-2xx, so an unfollowed 3xx lands in the
 *   `API_ERROR` arm — R2.11);
 * - the exhausted-429 RateLimitError carries NO `project_id` and NO
 *   `request_params` (Caution #3: this raise site is NOT one of the
 *   five; the reduced shape is ported verbatim).
 *
 * R6.7: AbortSignal at all four points — between pages (the loop-head
 * check below), into the request and into the backoff sleep (the C1
 * signal-aware closures via `core.executeDeps(signal)`), normalized on
 * exit as `DOMException(..., 'AbortError')`.
 *
 * Consumers (packet C6 §R10.10): `paginate_all` has ZERO in-library
 * call sites — this export mirrors the Python module's importability
 * for end users, and is deliberately wired into no client method
 * (routing any listing through it would diverge from every recorded
 * request sequence).
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
 * Maximum number of pages to fetch before raising an error
 * (`pagination.py:35`). Prevents infinite loops when the server returns
 * a non-null cursor indefinitely. Overridable per call via
 * {@link PaginateAllOptions.maxPages} (the injectable replacement for
 * Python's `MAX_PAGES` monkeypatch — packet C6 §Layer-3).
 */
const MAX_PAGES = 10000;

/**
 * Maximum number of retries for rate-limited (429) responses per page
 * request (`pagination.py:38`) — per-paginator, independent of the
 * client's `max_retries`.
 */
export const MAX_RATE_LIMIT_RETRIES = 3;

/**
 * Base delay in SECONDS for exponential backoff on 429 retries
 * (`_BACKOFF_BASE`, `pagination.py:41`; the Python-seconds value keeps
 * a `*_SECONDS` name per R2.12 — ms conversion happens only at the
 * sleep seam).
 */
const PAGINATION_BACKOFF_BASE_SECONDS = 1.0;

/**
 * Maximum backoff delay in SECONDS (`_BACKOFF_MAX`, `pagination.py:44`).
 */
export const PAGINATION_BACKOFF_MAX_SECONDS = 60.0;

/**
 * Parse a `Retry-After` header value into a safe number of seconds —
 * the MODULE-LEVEL string-input parser (`_parse_retry_after`,
 * `pagination.py:47-83`), NOT the client's response-based
 * `parseRetryAfter` in `backoff.ts`.
 *
 * Anything that is not a finite, non-negative number is rejected so the
 * caller falls back to the exponential-backoff schedule. `float(raw)`
 * ports as `pythonFloat` (R11.7 [SA3]) — `"inf"` PARSES and is then
 * filtered to `null`; `"1,000"` fails the CPython grammar. The value is
 * NOT capped here; `PAGINATION_BACKOFF_MAX_SECONDS` applies at the
 * point of sleeping.
 *
 * @param raw - Raw header value, or `null` when the header is absent.
 * @returns The advertised delay in seconds, or `null` when the header
 *   is absent, empty, unparseable, negative, NaN, or infinite.
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
    // The ValueError-analog only (B0-ARB F3 discipline: typed guard,
    // never a bare catch).
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
 * `type(x).__name__` over a lossless-parsed wire value — the Python
 * `json.loads` product domain (`NoneType`/`bool`/`int`/`float`/`str`/
 * `list`/`dict`), used for the malformed-`results` error detail
 * (`pagination.py:269-273`; the recorded vectors lock `results_type`).
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
 * Cursors are strings in every recorded exchange; the non-string arms
 * exist only because Python's `dict[str, str]` annotation is not
 * enforced at runtime. Integer tokens keep their exact digits; float
 * tokens render via the CPython float repr.
 *
 * @param cursor - The non-null `next_cursor` value.
 * @returns The value to place in the request params.
 */
function cursorParamValue(cursor: JsonValue): unknown {
  if (cursor instanceof JsonNumber) {
    // TODO(port): an exponent-form float token (`5e2`) would spell
    // "5e2" in Python's params only if the server sent a string; a
    // parsed float renders `str(500.0) == "500.0"` — pythonFloatStr
    // matches that. No vector or Layer-3 lock reaches this arm.
    return cursor.isIntegerToken()
      ? cursor.raw
      : pythonFloatStr(cursor.toNumber());
  }
  return cursor;
}

/**
 * The client slice {@link paginateAll} consumes (Python takes the
 * whole `MixpanelAPIClient`; the TS paginator reaches the same
 * internals through the C1 {@link ClientCore} seam).
 */
export interface PaginationClient {
  /** @internal The shared client-internals seam (B4-C1). */
  readonly core: ClientCore;
}

/**
 * Keyword options of {@link paginateAll} (Python kw-only args + the
 * TS seams).
 */
export interface PaginateAllOptions {
  /** Optional additional query parameters for each request. */
  readonly params?: Readonly<Record<string, string>> | null | undefined;
  /** Number of items per page (Python `page_size`, default 100). */
  readonly page_size?: number | undefined;
  /**
   * Page-limit override (default {@link MAX_PAGES}) — the injectable
   * replacement for Python tests' `MAX_PAGES` monkeypatch; an option,
   * not a mutable module global.
   */
  readonly maxPages?: number | undefined;
  /** Optional cancellation signal (R6.7). */
  readonly signal?: AbortSignal | undefined;
}

/**
 * Iterate through all pages of a paginated App API response
 * (`paginate_all`, `pagination.py:85-288`).
 *
 * Makes repeated raw GET requests to the App API path, following the
 * `pagination.next_cursor` field until it is `null`/absent. The
 * canonical `query_origin=mixpanel-headless` telemetry param is set
 * LAST so caller params can never override it.
 *
 * @param client - The assembled client (per-request auth resolution is
 *   preserved — R2.8).
 * @param path - App API path (e.g. `/projects/12345/dashboards`).
 * @param options - Optional params/page_size/maxPages/signal.
 * @returns Async generator of individual items across all pages.
 * @throws AuthenticationError - Invalid credentials (401).
 * @throws RateLimitError - Rate limit exceeded after max retries (429;
 *   the reduced constructor shape — no `project_id`, no
 *   `request_params`).
 * @throws ServerError - Server-side errors (5xx).
 * @throws MixpanelHeadlessError - `NETWORK_ERROR` (transport failure),
 *   `PAGINATION_LIMIT` (page limit exceeded), `API_ERROR` (other non-2xx
 *   statuses, unfollowed 3xx included), or `INVALID_RESPONSE` (non-JSON
 *   body, or a `results` field that is neither a list nor null).
 * @throws DOMException - Name `AbortError` on cancellation (R6.7).
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
 */
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
  // The C1 signal-aware closures (R6.7 points 2 and 3 without touching
  // the B0 module signatures); `deps.request` is the raw text-buffering
  // transport view — this walk never enters `executeWithRetry`.
  const deps = core.executeDeps(signal);

  let nextCursor: JsonValue | null = null;
  let pageCount = 0;

  for (;;) {
    // R6.7 point 1: between pages.
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
    // cursor, then query_origin set LAST so callers can't override the
    // canonical telemetry value (`pagination.py:152-158`).
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
    // Per-page, per-request auth resolution (`pagination.py:162`; R2.8).
    // LITERAL header set — no `requestHeaders` merge (`:161-163`).
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
          // `client._default_timeout(url)` (`pagination.py:175`) — never
          // the raw client timeout: a bare None would mean "no timeout
          // at all" in httpx; the route-aware default outlasts the App
          // API's ~120s server deadline instead.
          timeoutSeconds: core.defaultTimeoutSeconds(url),
        });
      } catch (error) {
        // `except httpx.HTTPError` — the transport-error class filter
        // (R2.10: no bare catch; AbortError and library errors pass).
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

      // Handle 429 with retry/backoff (`pagination.py:185-211`).
      if (response.status === 429) {
        const advertised = parseRetryAfterSeconds(
          response.header("Retry-After"),
        );
        if (attempt >= MAX_RATE_LIMIT_RETRIES) {
          // Reduced shape (`:188-196`): retry_after = int(advertised)
          // truncation or None; NO project_id, NO request_params.
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
        // backoff cap. NO jitter in either arm (`:199-202`).
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
        await deps.sleep(waitSeconds * 1000); // R2.12 seconds→ms seam.
        continue;
      }

      // Not a 429 — break out of the retry loop.
      break;
    }

    // At this point response is guaranteed non-null (`:217`).
    if (response === null) {
      throw new Error(
        "unreachable: pagination retry loop produced no response",
      );
    }

    // httpx `raise_for_status()` raises for every non-2xx status —
    // unfollowed 3xx included (R2.11) — mapped per `:219-244`.
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

    // `response.json()` → lossless with Python constants (GATE-R5 +
    // B0 arbiter F1; Python `json.loads` accepts NaN/Infinity).
    let data: JsonValue;
    try {
      data = parseLossless(response.text, { pythonConstants: true });
    } catch (error) {
      // Python catches broad `except Exception` at THIS site
      // (pagination.py:246-254) — unlike the `except json.JSONDecodeError`
      // sites B0-ARB F3 ruled on — so EVERY parse failure (a RangeError
      // from pathological nesting included) wraps as INVALID_RESPONSE
      // (B4-ARB W-F4 corrected the earlier mis-citation here).
      const contentType = response.header("content-type");
      throw new MixpanelHeadlessError(
        `Non-JSON response during pagination (content-type: ` +
          `${contentType ?? "unknown"})`,
        "INVALID_RESPONSE",
        // Python's details use `.get` WITHOUT the "unknown" default —
        // the key is present with None/null when the header is absent.
        { content_type: contentType },
        { cause: error },
      );
    }

    // Extract results (`:256-278`). `isinstance(data, dict)` over a
    // json.loads product is the "JSON object body" predicate →
    // isPlainRecord (watchlist #13 note in the packet cautions).
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
      // A top-level LIST body yields directly.
      results = data;
    }

    // `yield from results` — item-level yield* (R6.6).
    yield* results;

    // Check for the next page (`:281-288`): only a TRUTHY dict
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
