/**
 * Streaming export methods: `exportEvents` (the Export API JSONL stream,
 * with its own inline 429 loop) and `exportProfiles` (session-paged
 * Engage export), plus the `streamEvents` / `streamProfiles` wrappers the
 * `Workspace` facade delegates to. Python generators port as
 * `async function*`, so the argument guards fire on first iteration
 * exactly as in Python; every wire line and body parses through
 * `parseLossless` with Python constants enabled, and the per-call signal
 * threads into both the raw request and the retry sleep.
 *
 * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.export_events
 */

import {
  calculateBackoff,
  parseRetryAfter,
  retryWaitSeconds,
} from "../../client/backoff.js";
import type { ClientCore } from "../../client/core.js";
import {
  bindFirst,
  errorMessage,
  isPlainRecord,
  MixpanelHttpError,
  parseErrorBody,
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
import { pythonJsonDumps } from "../../compat/index.js";
import {
  AuthenticationError,
  MixpanelHeadlessError,
  ParamValidationError,
  QueryError,
  RateLimitError,
} from "../../errors.js";
import { transformEvent, transformProfile } from "../../query/transforms.js";

/** Lower bound of the facade `limit` guard (`workspace._validate_limit`). */
const MIN_LIMIT = 1;

/** Upper bound of the facade `limit` guard (`workspace._validate_limit`). */
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
  /** Optional cancellation signal. */
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
  /** Optional cancellation signal. */
  readonly signal?: AbortSignal | undefined;
}

/** The streaming method surface (mixed into `MixpanelClient`). */
export interface StreamingMethods {
  /**
   * Stream events from the Export API (`MixpanelAPIClient.export_events`) — JSONL lines parsed one at a time;
   * malformed lines are skipped, never raised.
   *
   * @param fromDate - Start date (inclusive).
   * @param toDate - End date (inclusive).
   * @param options - events/where/limit/onBatch/signal.
   * @returns Async generator of parsed event values.
   * @throws AuthenticationError - Invalid credentials (401).
   * @throws RateLimitError - 429 after max retries (carries
   *   `project_id` and omits `response_body`, as Python's raise does).
   * @throws QueryError - Invalid parameters (400).
   * @throws MixpanelHeadlessError - `HTTP_ERROR` after transport /
   *   non-2xx-status retries are exhausted (the `raise_for_status` arm;
   *   unlike the buffered paths, a 5xx here retries and then surfaces
   *   as `HTTP_ERROR`, exactly like Python).
   */
  exportEvents: (
    fromDate: string,
    toDate: string,
    options?: ExportEventsOptions,
  ) => AsyncGenerator<JsonValue, void, undefined>;

  /**
   * Stream profiles from the Engage API (`MixpanelAPIClient.export_profiles`) — session-based pagination, one request
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
 * The facade streaming `limit` guard (`workspace._validate_limit`).
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
 * View a fetch body as the byte source `iterJsonlLines` consumes. The
 * runtime `ReadableStream<Uint8Array>` is async-iterable on every
 * supported runtime even where the lib typings lag; a `null` body reads
 * as an empty stream.
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
 * {@link bodyByteSource} with transport-error normalization over
 * producer-side failures: a body-read error while consuming the stream
 * is an `httpx.ReadError` ⊂ `httpx.HTTPError` in Python (the
 * `_iter_jsonl_lines` walk sits inside the `except httpx.HTTPError`
 * scope), so it must surface as {@link MixpanelHttpError} for the export
 * retry loop to catch. Caller cancellation exits as a normalized
 * `AbortError` instead.
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
 * non-2xx statuses (text reaches only `HTTP_ERROR.details.error`; no
 * recorded vector asserts it, so the shape is kept close for humans).
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
 * Python truthiness over a parsed wire value: falsy = `null`, `false`,
 * numeric zero (native or lossless token), `""`, `[]`, `{}`.
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

/**
 * Iterate a parsed engage `results` value the way Python's
 * `for profile in results` does: lists yield elements, dicts yield
 * keys, strings yield code points; anything else raises TypeError.
 *
 * @param results - The parsed value (already Python-truthy).
 * @returns The iterable of yielded values.
 * @throws TypeError - Non-iterable value (Python raise emulation).
 */
function pyIterate(results: JsonValue): readonly JsonValue[] {
  if (Array.isArray(results)) {
    return results;
  }
  if (typeof results === "string") {
    return codepoints(results);
  }
  if (isPlainRecord(results)) {
    return Object.keys(results);
  }
  // Numbers / booleans / tokens: `'int' object is not iterable`.
  throw new TypeError("'object' is not iterable");
}

// eslint-disable-next-line complexity, max-lines-per-function -- branch-for-branch port of one Python function (see the docblock); splitting it would scatter the guard order the corpus pins
async function* exportEvents(
  core: ClientCore,
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
  // The auth header and the four-layer header merge are captured once,
  // before the retry loop, exactly like Python (`self._ensure_client()`
  // then `_request_headers`).
  const headers = core.requestHeaders({
    Authorization: await core.getAuthHeader(),
    "Accept-Encoding": "gzip",
  });
  // Signal-aware sleep from the client core; the executor member is
  // unused because streaming reads the raw response.
  const sleep = core.executeDeps(options.signal).sleep;

  for (let attempt = 0; attempt <= core.maxRetries; attempt += 1) {
    let batchCount = 0; // Reset on each attempt, as in Python.
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
      // not clock-bounded (httpx read timeouts are per-read; a total
      // clock would kill healthy long exports — see PORTING.md).
      // Caller-signal forwarding stays live for the stream.
      stopTimeout();
      const headerCarrier = {
        header: (name: string): string | null => response.headers.get(name),
      };
      if (response.status === 429) {
        if (attempt >= core.maxRetries) {
          const retryAfter = parseRetryAfter(headerCarrier);
          // Python's raise carries project_id and omits response_body.
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
        await sleep(waitSeconds * 1000); // seconds → ms
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
        const responseBody = parseErrorBody(await response.text());
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
        // below (3xx is an error here too: redirects are not followed).
        throw new MixpanelHttpError(httpStatusText(response.status, url));
      }
      for await (const line of iterJsonlLines(
        guardedByteSource(response.body, options.signal),
      )) {
        let event: JsonValue;
        try {
          event = parseLossless(line, { pythonConstants: true });
        } catch (error) {
          // eslint-disable-next-line max-depth -- mirrors the Python nesting; flattening would reorder the guards
          if (!(error instanceof LosslessJsonError)) {
            throw error;
          }
          // Python logs a warning and skips the malformed line; log
          // text is out of contract.
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
      // `except httpx.HTTPError` — the transport-error class filter;
      // library errors and AbortError pass through.
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

// eslint-disable-next-line complexity, max-lines-per-function -- branch-for-branch port of one Python function (see the docblock); splitting it would scatter the guard order the corpus pins
async function* exportProfiles(
  core: ClientCore,
  options: ExportProfilesOptions = {},
): AsyncGenerator<JsonValue, void, undefined> {
  const distinctId = options.distinct_id ?? null;
  let distinctIds = options.distinct_ids ?? null;
  const behaviors = options.behaviors ?? null;
  const cohortId = options.cohort_id ?? null;
  const includeAllUsers = options.include_all_users ?? false;
  const asOfTimestamp = options.as_of_timestamp ?? null;
  // AC guards in Python source order.
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
    // the next page's JSON body verbatim (an int stays an int — no
    // stringification). Lossless tokens fold to native via
    // `toNativeJson` for `JSON.stringify`, so a session_id beyond 2^53
    // would round through a JS double (PORTING.md: numbers beyond 2^53).
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
      params["output_properties"] = pythonJsonDumps(options.output_properties);
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
    // Sent explicitly because the API defaults to True.
    if (cohortId !== null && cohortId !== "") {
      params["include_all_users"] = includeAllUsers;
    }

    const response = await core.requestQueryHost("POST", url, {
      data: params,
      signal: options.signal,
    });
    if (!isPlainRecord(response)) {
      // Python `response.get(...)` on a non-dict raises
      // AttributeError (no recorded vector reaches this arm).
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

/**
 * Build the streaming methods over the shared client core.
 *
 * @param core - The shared client internals seam.
 * @returns The method bag.
 */
export function createStreamingMethods(core: ClientCore): StreamingMethods {
  return {
    exportEvents: bindFirst(core, exportEvents),
    exportProfiles: bindFirst(core, exportProfiles),
  };
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
  /** Optional cancellation signal. */
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
 * Stream events directly from the Mixpanel API — the standalone form of
 * `Workspace.stream_events`, a thin wrapper over `exportEvents` that
 * the facade delegates to.
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
  // Validate limit early to avoid wasted API calls.
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
 * Stream user profiles directly from the Mixpanel API — the standalone
 * form of `Workspace.stream_profiles`, a thin wrapper over
 * `exportProfiles` that the facade delegates to.
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
