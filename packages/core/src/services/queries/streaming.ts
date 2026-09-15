/**
 * Streaming export methods — Phase-3 packet B4-C2 port of
 * `MixpanelAPIClient.export_events` (`api_client.py:1813-1953`, its own
 * inline 429 loop and the FF4 reduced-shape RateLimitError raise at
 * `:1883-1891`) and `export_profiles` (`:1954-2110`, session-paged
 * engage export), plus the two B4 api-map facade wrappers
 * `stream_events` / `stream_profiles` (`workspace.py:1381-1578`).
 *
 * R2.6/R3.2: Python generators port as `async function*` —
 * item-level `yield` (R6.6), laziness preserved (the AC* guards fire on
 * FIRST iteration, exactly like Python's generator semantics).
 * GATE-VERDICT R5: every wire line/body parses via `parseLossless`
 * with `{ pythonConstants: true }` (Python `json.loads` at `:1911` and
 * `:1931`).
 * R6.7: the per-call signal threads into the raw request and into the
 * signal-aware sleep built by the C1 closures (`core.executeDeps`).
 */

import {
  calculateBackoff,
  parseRetryAfter,
  retryWaitSeconds,
} from "../../client/backoff.js";
import type { ClientCore } from "../../client/core.js";
import {
  errorMessage,
  isPlainRecord,
  MixpanelHttpError,
} from "../../client/internals.js";
import {
  JsonNumber,
  type JsonValue,
  toNativeJson,
} from "../../client/json-value.js";
import { iterJsonlLines } from "../../client/jsonl.js";
import {
  LosslessJsonError,
  parseLossless,
} from "../../client/lossless-json.js";
import { normalizedAbortError } from "../../client/transport.js";
import { codepoints } from "../../compat/codepoint.js";
import { cpSlice, pythonJsonDumps } from "../../compat/index.js";
import {
  AuthenticationError,
  MixpanelHeadlessError,
  ParamValidationError,
  QueryError,
  RateLimitError,
} from "../../errors.js";
import { transformEvent, transformProfile } from "../../query/transforms.js";

/** Lower bound of the facade `limit` guard (`workspace.py`). */
const MIN_LIMIT = 1;

/** Upper bound of the facade `limit` guard (`workspace.py`). */
const MAX_LIMIT = 100000;

/** Options bag of {@link StreamingMethods.exportEvents}. */
export interface ExportEventsOptions {
  /** Event names to filter. */
  readonly events?: readonly string[] | null | undefined;
  /** Filter expression. */
  readonly where?: string | null | undefined;
  /** Maximum number of events to return (max 100000). */
  readonly limit?: number | null | undefined;
  /**
   * Invoked with the cumulative count every 1000 events, and once at
   * the end for any partial batch.
   */
  readonly onBatch?: ((count: number) => void) | null | undefined;
  /** Optional cancellation signal (R6.7). */
  readonly signal?: AbortSignal | undefined;
}

/** Options bag of {@link StreamingMethods.exportProfiles}. */
export interface ExportProfilesOptions {
  /** Filter expression. */
  readonly where?: string | null | undefined;
  /** Cohort ID filter (members only). */
  readonly cohort_id?: string | null | undefined;
  /** Properties to include. */
  readonly output_properties?: readonly string[] | null | undefined;
  /** Invoked with the cumulative count after each page. */
  readonly onBatch?: ((count: number) => void) | null | undefined;
  /** Single user ID (mutually exclusive with `distinct_ids`). */
  readonly distinct_id?: string | null | undefined;
  /** User IDs (mutually exclusive with `distinct_id`; deduplicated). */
  readonly distinct_ids?: readonly string[] | null | undefined;
  /** Group type identifier (group profiles instead of users). */
  readonly group_id?: string | null | undefined;
  /** Behavioral filters (mutually exclusive with `cohort_id`). */
  readonly behaviors?: readonly unknown[] | string | null | undefined;
  /** Unix timestamp for point-in-time query (must be in the past). */
  readonly as_of_timestamp?: number | null | undefined;
  /** Include all users and mark cohort membership. */
  readonly include_all_users?: boolean | undefined;
  /** Optional cancellation signal (R6.7). */
  readonly signal?: AbortSignal | undefined;
}

/** The C2 streaming method surface (mixed into `MixpanelClient`). */
export interface StreamingMethods {
  /**
   * Stream events from the Export API (`export_events`,
   * `api_client.py:1813-1953`) — JSONL lines parsed one at a time;
   * malformed lines are skipped, never raised.
   *
   * @param fromDate - Start date (inclusive).
   * @param toDate - End date (inclusive).
   * @param options - events/where/limit/onBatch/signal.
   * @returns Async generator of parsed event values.
   * @throws AuthenticationError - Invalid credentials (401).
   * @throws RateLimitError - 429 after max retries (carries
   *   `project_id`; omits `response_body` — the FF4 `:1883-1891` shape).
   * @throws QueryError - Invalid parameters (400).
   * @throws MixpanelHeadlessError - `HTTP_ERROR` after transport /
   *   non-2xx-status retries are exhausted (the `raise_for_status` arm —
   *   NOTE: unlike the buffered paths, a 5xx here retries and then
   *   surfaces as `HTTP_ERROR`, exactly like Python).
   */
  exportEvents: (
    fromDate: string,
    toDate: string,
    options?: ExportEventsOptions,
  ) => AsyncGenerator<JsonValue, void, undefined>;

  /**
   * Stream profiles from the Engage API (`export_profiles`,
   * `api_client.py:1954-2110`) — session-based pagination, one request
   * per page.
   *
   * @param options - Filters, callbacks, and the AC*-guarded knobs.
   * @returns Async generator of profile values.
   * @throws ParamValidationError - `AC2_DISTINCT_ID_CONFLICT`,
   *   `AC3_BEHAVIORS_COHORT_CONFLICT`,
   *   `AC4_INCLUDE_ALL_USERS_REQUIRES_COHORT`, `AC5_BEHAVIORS_NOT_LIST`,
   *   `AC6_AS_OF_TIMESTAMP_FUTURE` (on first iteration — generator
   *   semantics).
   * @throws AuthenticationError | RateLimitError | ServerError - Per
   *   the retry core.
   */
  exportProfiles: (
    options?: ExportProfilesOptions,
  ) => AsyncGenerator<JsonValue, void, undefined>;
}

/**
 * `_validate_limit` (`workspace.py:326-351`) — the facade streaming
 * limit guard.
 *
 * @param limit - Maximum number of events, or absent for no limit.
 * @throws ParamValidationError - `WR2_LIMIT_TOO_SMALL` /
 *   `WR3_LIMIT_TOO_LARGE` outside 1..100000.
 */
export function validateLimit(limit: number | null | undefined): void {
  if (limit === null || limit === undefined) {
    return;
  }
  if (limit < MIN_LIMIT) {
    throw new ParamValidationError(
      `limit must be at least ${MIN_LIMIT}, got ${limit}`,
      "WR2_LIMIT_TOO_SMALL",
    );
  }
  if (limit > MAX_LIMIT) {
    throw new ParamValidationError(
      `limit must be at most ${MAX_LIMIT}, got ${limit}`,
      "WR3_LIMIT_TOO_LARGE",
    );
  }
}

/**
 * View a fetch body as the byte source `iterJsonlLines` consumes
 * (platform-typing shim, B0 binding precedent: the runtime
 * `ReadableStream<Uint8Array>` is async-iterable on every supported
 * runtime; a `null` body reads as an empty stream).
 *
 * @param body - The platform response body.
 * @returns The byte source.
 */
function bodyByteSource(
  body: ReadableStream<Uint8Array> | null,
): AsyncIterable<Uint8Array> {
  if (body === null) {
    return (async function* (): AsyncGenerator<Uint8Array, void, undefined> {
      /* empty body */
    })();
  }
  return body;
}

/**
 * {@link bodyByteSource} with R2.10 normalization over PRODUCER-side
 * failures (B4-ARB W-F1): a body-read error while consuming the stream
 * is an `httpx.ReadError` ⊂ `httpx.HTTPError` in Python
 * (`api_client.py:1870-1953` — the `_iter_jsonl_lines` walk sits inside
 * the `except httpx.HTTPError` scope), so it must surface as
 * {@link MixpanelHttpError} for the export retry loop to catch. Caller
 * cancellation exits as a normalized `AbortError` instead (R6.7).
 *
 * Consumer-side exits (`return()` from an early-terminated `for await`)
 * run the generator's return path, not this catch.
 *
 * @param body - The platform response body.
 * @param signal - The caller's cancellation signal, if any.
 * @returns The guarded byte source.
 */
async function* guardedByteSource(
  body: ReadableStream<Uint8Array> | null,
  signal: AbortSignal | undefined,
): AsyncGenerator<Uint8Array, void, undefined> {
  try {
    for await (const chunk of bodyByteSource(body)) {
      yield chunk;
    }
  } catch (error) {
    if (signal?.aborted === true) {
      throw normalizedAbortError(signal.reason);
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    if (error instanceof MixpanelHttpError) {
      throw error;
    }
    throw new MixpanelHttpError(
      `transport body read failure: ${String(error)}`,
      { cause: error },
    );
  }
}

/**
 * The httpx `raise_for_status` message twin for the export stream's
 * non-2xx statuses (text reaches only `HTTP_ERROR.details.error` —
 * no vector or Layer-3 lock asserts it; shape kept close for humans).
 *
 * @param status - HTTP status code.
 * @param url - The request URL.
 * @returns The error text.
 */
function httpStatusText(status: number, url: string): string {
  let category: string;
  if (status < 200) {
    category = "Informational response";
  } else if (status < 400) {
    category = "Redirect response";
  } else if (status < 500) {
    category = "Client error";
  } else {
    category = "Server error";
  }
  return `${category} '${status}' for url '${url}'`;
}

/**
 * Iterate a parsed engage `results` value the way Python's
 * `for profile in results` does: lists yield elements, dicts yield
 * keys, strings yield characters; anything else raises TypeError.
 *
 * @param results - The parsed value (already Python-truthy).
 * @returns The iterable of yielded values.
 * @throws TypeError - Non-iterable value (Python raise emulation).
 */
/**
 * Python truthiness over a parsed wire value (watchlist §8 item 6):
 * falsy = `null`, `false`, numeric zero (native or lossless token),
 * `""`, `[]`, `{}`.
 *
 * @param value - The parsed value.
 * @returns The Python `bool(value)`.
 */
function pyTruthyJson(value: JsonValue): boolean {
  if (value === null || value === false) {
    return false;
  }
  if (typeof value === "string") {
    return value !== "";
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "bigint") {
    return value !== 0n;
  }
  if (value instanceof JsonNumber) {
    return value.toNumber() !== 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }
  return true;
}

function pyIterate(results: JsonValue): readonly JsonValue[] {
  if (Array.isArray(results)) {
    return results;
  }
  if (typeof results === "string") {
    // Python iterates a str by CODE POINT.
    return codepoints(results);
  }
  if (isPlainRecord(results)) {
    // A truthy dict: Python `for x in dict` yields KEYS.
    return Object.keys(results);
  }
  // Numbers / booleans / tokens: `'int' object is not iterable`.
  throw new TypeError("'object' is not iterable");
}

/**
 * Build the C2 streaming methods over the C1 core seam.
 *
 * @param core - The shared client internals seam.
 * @returns The method bag.
 */
export function createStreamingMethods(core: ClientCore): StreamingMethods {
  async function* exportEvents(
    fromDate: string,
    toDate: string,
    options: ExportEventsOptions = {},
  ): AsyncGenerator<JsonValue, void, undefined> {
    const url = core.buildUrl("export", "/export");
    const params: Record<string, unknown> = {
      project_id: core.projectId(),
      from_date: fromDate,
      to_date: toDate,
    };
    if (
      options.events !== undefined &&
      options.events !== null &&
      options.events.length > 0
    ) {
      params["event"] = pythonJsonDumps(options.events);
    }
    if (
      options.where !== undefined &&
      options.where !== null &&
      options.where !== ""
    ) {
      params["where"] = options.where;
    }
    if (options.limit !== undefined && options.limit !== null) {
      params["limit"] = options.limit;
    }
    const onBatch = options.onBatch ?? null;
    // Ensure the pool token exists (`self._ensure_client()`); the auth
    // header + 4-layer merge are captured ONCE before the retry loop,
    // exactly like Python (`api_client.py:1861-1867`).
    const headers = core.requestHeaders({
      Authorization: await core.getAuthHeader(),
      "Accept-Encoding": "gzip",
    });
    // Signal-aware sleep from the C1 closures (R6.7 point 3) — the
    // executor member is unused; streaming reads the RAW response.
    const sleep = core.executeDeps(options.signal).sleep;

    for (let attempt = 0; attempt <= core.maxRetries; attempt += 1) {
      let batchCount = 0; // Reset on each attempt (deviation-3 lock).
      let releaseRaw: (() => void) | null = null;
      try {
        const { response, stopTimeout, release } = await core.rawRequest(
          {
            method: "GET",
            url,
            params,
            jsonBody: null,
            formBody: null,
            headers,
            timeoutSeconds: core.exportTimeoutSeconds,
          },
          options.signal,
        );
        releaseRaw = release;
        // Headers are in: stop the export-timeout clock. Body reads are
        // not clock-bounded (D-B4ARB-1 — httpx read-timeouts are
        // per-read; a total clock would kill healthy long exports).
        // Caller-signal forwarding stays live for the stream.
        stopTimeout();
        const headerCarrier = {
          header: (name: string): string | null => response.headers.get(name),
        };
        if (response.status === 429) {
          if (attempt >= core.maxRetries) {
            const retryAfter = parseRetryAfter(headerCarrier);
            // FF4 `:1883-1891`: carries project_id; omits response_body.
            throw new RateLimitError("Rate limit exceeded after max retries", {
              retryAfter,
              statusCode: response.status,
              requestMethod: "GET",
              requestUrl: url,
              requestParams: params,
              projectId: core.projectId(),
            });
          }
          const waitSeconds = retryWaitSeconds(
            parseRetryAfter(headerCarrier),
            attempt,
            core.random,
          );
          await sleep(waitSeconds * 1000); // R2.12 seconds→ms seam.
          continue;
        }
        if (response.status === 401) {
          throw new AuthenticationError(
            "Invalid credentials. Check username, secret, and project_id.",
            {
              statusCode: response.status,
              requestMethod: "GET",
              requestUrl: url,
              requestParams: params,
            },
          );
        }
        if (response.status === 400) {
          const bodyText = await response.text();
          let responseBody: JsonValue | null;
          try {
            responseBody = parseLossless(bodyText, { pythonConstants: true });
          } catch (error) {
            if (!(error instanceof LosslessJsonError)) {
              throw error;
            }
            // Python: `body.decode()[:500] if body else None` (codepoint
            // slice, R11.6).
            responseBody = bodyText === "" ? null : cpSlice(bodyText, 0, 500);
          }
          throw new QueryError(errorMessage(responseBody, "Unknown error"), {
            statusCode: response.status,
            responseBody,
            requestMethod: "GET",
            requestUrl: url,
            requestParams: params,
          });
        }
        if (response.status < 200 || response.status >= 300) {
          // httpx `response.raise_for_status()` raises HTTPStatusError —
          // an httpx.HTTPError subclass, so it lands in the retry catch
          // below (R2.11: 3xx is an error here too).
          throw new MixpanelHttpError(httpStatusText(response.status, url));
        }
        for await (const line of iterJsonlLines(
          guardedByteSource(response.body, options.signal),
        )) {
          let event: JsonValue;
          try {
            event = parseLossless(line, { pythonConstants: true });
          } catch (error) {
            if (!(error instanceof LosslessJsonError)) {
              throw error;
            }
            // Python logs a warning and skips the malformed line
            // (`api_client.py:1936-1937`); log text is out of contract.
            continue;
          }
          yield event;
          batchCount += 1;
          if (onBatch !== null && batchCount % 1000 === 0) {
            onBatch(batchCount);
          }
        }
        if (onBatch !== null && batchCount % 1000 !== 0) {
          onBatch(batchCount);
        }
        return; // Success, exit retry loop.
      } catch (error) {
        // `except httpx.HTTPError` — the transport-error class filter
        // (R2.10); library errors and AbortError pass through.
        if (!(error instanceof MixpanelHttpError)) {
          throw error;
        }
        if (attempt >= core.maxRetries) {
          throw new MixpanelHeadlessError(
            `HTTP error during export: ${error.message}`,
            "HTTP_ERROR",
            { error: error.message },
            { cause: error },
          );
        }
        await sleep(calculateBackoff(attempt, core.random) * 1000);
      } finally {
        // Detach the attempt's signal forwarding once its body is done
        // (success, retryable failure, or consumer return()).
        releaseRaw?.();
      }
    }
  }

  async function* exportProfiles(
    options: ExportProfilesOptions = {},
  ): AsyncGenerator<JsonValue, void, undefined> {
    const distinctId = options.distinct_id ?? null;
    let distinctIds = options.distinct_ids ?? null;
    const behaviors = options.behaviors ?? null;
    const cohortId = options.cohort_id ?? null;
    const includeAllUsers = options.include_all_users ?? false;
    const asOfTimestamp = options.as_of_timestamp ?? null;
    // AC guards in Python source order (`api_client.py:2012-2049`).
    if (distinctId !== null && distinctIds !== null) {
      throw new ParamValidationError(
        "distinct_id and distinct_ids are mutually exclusive. " +
          "Provide only one to fetch specific profiles.",
        "AC2_DISTINCT_ID_CONFLICT",
      );
    }
    if (behaviors !== null && cohortId !== null) {
      throw new ParamValidationError(
        "behaviors and cohort_id are mutually exclusive. " +
          "Use behaviors for behavioral filtering or cohort_id for cohort membership.",
        "AC3_BEHAVIORS_COHORT_CONFLICT",
      );
    }
    if (includeAllUsers && cohortId === null) {
      throw new ParamValidationError(
        "include_all_users requires cohort_id. " +
          "This parameter is only valid for cohort membership queries.",
        "AC4_INCLUDE_ALL_USERS_REQUIRES_COHORT",
      );
    }
    if (behaviors !== null && !Array.isArray(behaviors)) {
      throw new ParamValidationError(
        "behaviors must be a list of behavioral filter dictionaries.",
        "AC5_BEHAVIORS_NOT_LIST",
      );
    }
    if (asOfTimestamp !== null) {
      const currentTime = Math.floor(core.now().getTime() / 1000);
      if (asOfTimestamp > currentTime) {
        throw new ParamValidationError(
          "as_of_timestamp cannot be in the future. " +
            "Provide a Unix timestamp in the past to query historical profile state.",
          "AC6_AS_OF_TIMESTAMP_FUTURE",
        );
      }
    }
    // Empty distinct_ids: return early without an API call.
    if (distinctIds !== null && distinctIds.length === 0) {
      return;
    }
    // Deduplicate, preserving order (`dict.fromkeys`; string ids — a
    // JS Set is the same key discipline for the string domain).
    if (distinctIds !== null) {
      distinctIds = [...new Set(distinctIds)];
    }

    const url = core.buildUrl("engage", "");
    let sessionId: JsonValue = null;
    let page = 0;
    let totalCount = 0;
    const onBatch = options.onBatch ?? null;

    for (;;) {
      const params: Record<string, unknown> = {
        project_id: core.projectId(),
        page,
      };
      // `if session_id:` — Python truthiness; the value threads into
      // the next page's JSON body VERBATIM (B4-ARB W-F5: an int stays
      // an int — no stringification). Lossless tokens fold to native
      // via toNativeJson for JSON.stringify (an unsafe-int session_id
      // would round through a JS double — disclosed residual, see
      // b4-review-resolution.md W-F5).
      if (pyTruthyJson(sessionId)) {
        params["session_id"] = toNativeJson(sessionId);
      }
      if (
        options.where !== undefined &&
        options.where !== null &&
        options.where !== ""
      ) {
        params["where"] = options.where;
      }
      if (cohortId !== null && cohortId !== "") {
        params["filter_by_cohort"] = pythonJsonDumps({ id: cohortId });
      }
      if (
        options.output_properties !== undefined &&
        options.output_properties !== null &&
        options.output_properties.length > 0
      ) {
        params["output_properties"] = pythonJsonDumps(
          options.output_properties,
        );
      }
      if (distinctId !== null && distinctId !== "") {
        params["distinct_id"] = distinctId;
      }
      if (distinctIds !== null && distinctIds.length > 0) {
        params["distinct_ids"] = pythonJsonDumps(distinctIds);
      }
      if (
        options.group_id !== undefined &&
        options.group_id !== null &&
        options.group_id !== ""
      ) {
        params["data_group_id"] = options.group_id;
      }
      if (Array.isArray(behaviors) && behaviors.length > 0) {
        params["behaviors"] = pythonJsonDumps(behaviors);
      }
      if (asOfTimestamp !== null) {
        params["as_of_timestamp"] = asOfTimestamp;
      }
      // Sent explicitly because the API defaults to True
      // (`api_client.py:2088-2091`).
      if (cohortId !== null && cohortId !== "") {
        params["include_all_users"] = includeAllUsers;
      }

      const response = await core.requestQueryHost("POST", url, {
        data: params,
        signal: options.signal,
      });
      if (!isPlainRecord(response)) {
        // Python `response.get(...)` on a non-dict raises
        // AttributeError (no lock reaches this arm).
        throw new TypeError("'object' has no attribute 'get'");
      }
      const record: Record<string, JsonValue> = response;
      const results = Object.hasOwn(record, "results")
        ? (record["results"] as JsonValue)
        : [];
      // `if not results: break` — Python truthiness over parsed JSON.
      if (!pyTruthyJson(results)) {
        break;
      }
      for (const profile of pyIterate(results)) {
        yield profile;
        totalCount += 1;
      }
      if (onBatch !== null) {
        onBatch(totalCount);
      }
      const nextSession = Object.hasOwn(record, "session_id")
        ? (record["session_id"] as JsonValue)
        : null;
      // `if not session_id: break` — same truthiness discipline.
      if (!pyTruthyJson(nextSession)) {
        break;
      }
      sessionId = nextSession;
      page += 1;
    }
  }

  return { exportEvents, exportProfiles };
}

/** Options bag of {@link streamEvents} (`workspace.stream_events`). */
export interface StreamEventsOptions {
  /** Start date inclusive (`YYYY-MM-DD`). */
  readonly from_date: string;
  /** End date inclusive (`YYYY-MM-DD`). */
  readonly to_date: string;
  /** Event names to filter. */
  readonly events?: readonly string[] | null | undefined;
  /** Filter expression. */
  readonly where?: string | null | undefined;
  /** Maximum number of events (1..100000). */
  readonly limit?: number | null | undefined;
  /** Return raw Mixpanel format instead of the normalized shape. */
  readonly raw?: boolean | undefined;
  /**
   * `$insert_id` generator seam for the normalized shape (defaults to
   * `crypto.randomUUID` inside `transformEvent`).
   */
  readonly uuid?: (() => string) | undefined;
  /** Optional cancellation signal (R6.7). */
  readonly signal?: AbortSignal | undefined;
}

/** Options bag of {@link streamProfiles} (`workspace.stream_profiles`). */
export interface StreamProfilesOptions extends ExportProfilesOptions {
  /** Return raw Mixpanel format instead of the normalized shape. */
  readonly raw?: boolean | undefined;
}

/** The client slice the facade wrappers consume. */
export interface StreamingClient {
  /** See {@link StreamingMethods.exportEvents}. */
  exportEvents: (
    fromDate: string,
    toDate: string,
    options?: ExportEventsOptions,
  ) => AsyncGenerator<JsonValue, void, undefined>;
  /** See {@link StreamingMethods.exportProfiles}. */
  exportProfiles: (
    options?: ExportProfilesOptions,
  ) => AsyncGenerator<JsonValue, void, undefined>;
}

/**
 * Stream events directly from the Mixpanel API — the B4 api-map member
 * `workspace.stream_events` (`workspace.py:1381-1462`) as a standalone
 * wrapper until the B6 facade lands (packet C2 §TS homes: "facade-level
 * thin wrappers over export_events").
 *
 * @param client - The assembled client (or its streaming slice).
 * @param options - Dates/filters/limit/raw.
 * @returns Async generator of event dicts (normalized unless `raw`).
 * @throws ParamValidationError - `WR2_LIMIT_TOO_SMALL` /
 *   `WR3_LIMIT_TOO_LARGE` (on first iteration).
 * @throws AuthenticationError | RateLimitError | QueryError - Per
 *   {@link StreamingMethods.exportEvents}.
 */
export async function* streamEvents(
  client: StreamingClient,
  options: StreamEventsOptions,
): AsyncGenerator<unknown, void, undefined> {
  // Validate limit early to avoid wasted API calls (`workspace.py:1454`).
  validateLimit(options.limit);
  const iterator = client.exportEvents(options.from_date, options.to_date, {
    events: options.events,
    where: options.where,
    limit: options.limit,
    signal: options.signal,
  });
  if (options.raw === true) {
    yield* iterator;
    return;
  }
  for await (const event of iterator) {
    yield transformEvent(
      toNativeJson(event) as Record<string, unknown>,
      options.uuid === undefined ? undefined : { uuid: options.uuid },
    );
  }
}

/**
 * Stream user profiles directly from the Mixpanel API — the B4 api-map
 * member `workspace.stream_profiles` (`workspace.py:1469-1578`) as a
 * standalone wrapper until the B6 facade lands.
 *
 * @param client - The assembled client (or its streaming slice).
 * @param options - Filters plus `raw`.
 * @returns Async generator of profile dicts (normalized unless `raw`).
 * @throws ParamValidationError - The AC* guards (on first iteration).
 * @throws AuthenticationError | RateLimitError - Per
 *   {@link StreamingMethods.exportProfiles}.
 */
export async function* streamProfiles(
  client: StreamingClient,
  options: StreamProfilesOptions = {},
): AsyncGenerator<unknown, void, undefined> {
  const { raw, ...rest } = options;
  const iterator = client.exportProfiles(rest);
  if (raw === true) {
    yield* iterator;
    return;
  }
  for await (const profile of iterator) {
    yield transformProfile(toNativeJson(profile) as Record<string, unknown>);
  }
}
