/**
 * Session-replay pipeline: discover replays through an Insights query,
 * sign them through the client, then walk the signed CDN files in
 * parallel batches and yield raw rrweb events. Owned by `Workspace`, not
 * part of the public API; the service stays pure bytes — the rrweb
 * analyzer runs a layer above. Signing and the sensitive-data 403
 * mapping live in the client (`signReplays`, `handleResponse`); CDN GETs
 * share the client's injected fetch seam and {@link rawFetch}, so
 * transport-error normalization and the timeout shape are not
 * re-derived here.
 *
 * @see mixpanel_headless._internal.services.replays.ReplaysService
 */

import type { MixpanelClient } from "../client/client.js";
import { MixpanelHttpError } from "../client/internals.js";
import { toNativeJson } from "../client/json-value.js";
import { LosslessJsonError, parseLossless } from "../client/lossless-json.js";
import { rawFetch } from "../client/transport.js";
import { isPythonDict } from "../compat/python-dict.js";
import { pythonIntCoerce } from "../compat/python-int.js";
import { pythonRepr, pythonStrOf } from "../compat/python-str.js";
import { zfill } from "../compat/zfill.js";
import {
  MixpanelHeadlessError,
  ReplayNotFoundError,
  SignedURLExpiredError,
  UnsupportedReplayFormatError,
} from "../errors.js";
import { Filter } from "../types/query-params/filter.js";
import {
  ReplayEvent,
  ReplaySummary,
  SignedReplay,
} from "../types/results/replay-models.js";
import type { WarningSink } from "./discovery.js";

/** Any JSON-shaped mapping the parsers walk. */
type Dict = Readonly<Record<string, unknown>>;

/**
 * Retention window assumed when a replay lacks
 * `$mp_replay_retention_period` (`_DEFAULT_RETENTION_DAYS`).
 */
const DEFAULT_RETENTION_DAYS = 30;

/**
 * Lookback for {@link ReplaysService.eventsFor} when the caller doesn't
 * pass an explicit window (`_EVENTS_DEFAULT_LOOKBACK_DAYS`): 90 days, the
 * maximum replay retention window.
 */
const EVENTS_DEFAULT_LOOKBACK_DAYS = 90;

/**
 * Per-request CDN timeout in seconds (`_CDN_TIMEOUT`: httpx
 * `connect=10, read=30, write=10, pool=30`).
 *
 * `fetch` has no per-operation timeout primitive, so the port arms one
 * clock at the largest per-operation budget until the headers arrive,
 * exactly as the wire client bounds its own requests; the streamed body
 * is not clock-bounded (see PORTING.md).
 */
const CDN_TIMEOUT_SECONDS = 30;

/**
 * Report whether a CDN-file element looks like an rrweb web-recording
 * event.
 *
 * @remarks
 * An rrweb event always carries at least `type` (int discriminator),
 * `data` (dict) and `timestamp` (int ms). Mobile session replays use a
 * different recording format that lacks these keys; absence is treated
 * as "not rrweb".
 * @param event - A single deserialized CDN-file element.
 * @returns `true` when the event carries the three required keys.
 * @see mixpanel_headless._internal.services.replays._looks_like_rrweb
 */
function looksLikeRrweb(event: unknown): boolean {
  if (!isPythonDict(event)) {
    return false;
  }
  // Python `"k" in dict` is an own-key membership test — `Object.hasOwn`,
  // never the prototype-walking `in`, which would see inherited keys.
  return (
    Object.hasOwn(event, "type") &&
    Object.hasOwn(event, "data") &&
    Object.hasOwn(event, "timestamp")
  );
}

/**
 * Build the canonical `ReplayNotFoundError` for an absent replay.
 *
 * @remarks
 * Two call sites surface the same "no replay on the CDN" condition —
 * the walker's first-file 404, and `Workspace.fetchReplay` when the
 * walk yields zero events. Sharing one constructor keeps their message
 * and `details` shape from drifting.
 * @param replayId - The replay that could not be found.
 * @param options - The `retentionDays` window searched and the
 *   `cdnUrlPrefix` that was walked.
 * @returns The error with status 404 and structured details.
 * @example
 * ```typescript
 * const error = replayNotFoundError("1a2b3c", {
 *   retentionDays: 30,
 *   cdnUrlPrefix: "https://cdn.example/replays/1a2b3c/",
 * });
 * // error.statusCode === 404; error.details.retention_days === 30
 * ```
 * @see mixpanel_headless._internal.services.replays.replay_not_found_error
 */
export function replayNotFoundError(
  replayId: string,
  options: { retentionDays: number; cdnUrlPrefix: string },
): ReplayNotFoundError {
  return new ReplayNotFoundError(
    `Replay ${replayId} not found on CDN. The replay may have aged ` +
      `out of its retention window (${String(options.retentionDays)} days), never been ` +
      `recorded, or been deleted.`,
    {
      details: {
        replay_id: replayId,
        retention_days: options.retentionDays,
        cdn_url_prefix: options.cdnUrlPrefix,
      },
      statusCode: 404,
    },
  );
}

/**
 * The `Workspace.query` seam the service issues Insights queries
 * through (Python's `query_fn` constructor kwarg) — a bound facade
 * method, so the service never imports `Workspace`.
 */
export type ReplayQueryFn = (
  events: string,
  options: Readonly<Record<string, unknown>>,
) => Promise<{ readonly series?: unknown }>;

/** Debug/warning log seam of the service. */
export interface ReplaysLogger {
  /**
   * Record a debug message.
   *
   * @param message - The formatted text (never vector-compared).
   */
  debug?: (message: string) => void;
}

/** Construction options of {@link ReplaysService}. */
export interface ReplaysServiceOptions {
  /**
   * Bound `Workspace.query` for discovery queries. Optional — when
   * omitted, {@link ReplaysService.discover} and
   * {@link ReplaysService.eventsFor} throw, exactly as Python's
   * `RuntimeError` does.
   */
  readonly queryFn?: ReplayQueryFn | undefined;
  /** Optional logger; never receives `query_string` at any level. */
  readonly logger?: ReplaysLogger | undefined;
  /**
   * Injected fetch for CDN GETs — the `_async_transport` twin.
   *
   * @defaultValue the client's own fetch seam
   */
  readonly fetchImpl?: typeof fetch | undefined;
  /**
   * `warnings.warn` sink for the missing-retention path.
   *
   * @defaultValue a no-op (warnings are dropped)
   */
  readonly warn?: WarningSink | undefined;
  /**
   * Clock seam backing Python's `time.time()`; unix seconds as a float.
   *
   * @defaultValue `() => Date.now() / 1000`
   */
  readonly now?: (() => number) | undefined;
}

/** Options of {@link ReplaysService.fetchFiles} / `walkCdnAsync`. */
export interface WalkCdnOptions {
  /** 1, 7, 30, or 90 — the CDN file-name suffix (`NNNN-{days}.json`). */
  readonly retentionDays: number;
  /**
   * Hard upper bound on the number of CDN files walked.
   *
   * @defaultValue `500`
   */
  readonly maxFiles?: number | undefined;
  /**
   * Parallel batch size (files fetched per round).
   *
   * @defaultValue `50`
   */
  readonly concurrency?: number | undefined;
  /**
   * Re-sign once when a batch hits a 403; `false` raises
   * `SignedURLExpiredError` immediately.
   *
   * @defaultValue `true`
   */
  readonly reSignOnExpiry?: boolean | undefined;
}

/** Options of {@link ReplaysService.discover}. */
export interface DiscoverOptions {
  /** Filter to a single user; mutually exclusive with `replayIds`. */
  readonly distinctId?: string | null | undefined;
  /** Hydrate explicit IDs; mutually exclusive with `distinctId`. */
  readonly replayIds?: readonly string[] | null | undefined;
  /** ISO date (`YYYY-MM-DD`) lower bound. */
  readonly fromDate?: string | null | undefined;
  /** ISO date (`YYYY-MM-DD`) upper bound. */
  readonly toDate?: string | null | undefined;
  /**
   * Maximum summaries to return.
   *
   * @defaultValue `100`
   */
  readonly limit?: number | undefined;
}

/** Options of {@link ReplaysService.eventsFor}. */
export interface EventsForOptions {
  /** Up to 5 extra event properties to include as group keys. */
  readonly eventProperties?: readonly string[] | null | undefined;
  /** ISO date (`YYYY-MM-DD`) lower bound for the events scan. */
  readonly fromDate?: string | null | undefined;
  /** ISO date (`YYYY-MM-DD`) upper bound. */
  readonly toDate?: string | null | undefined;
}

/** One CDN fetch outcome: `(statusCode, eventsOrNull)`. */
type FetchOutcome = readonly [number, readonly Dict[] | null];

/**
 * Run the session-replay pipeline between `Workspace` and the wire
 * client: discover replays through an Insights query, sign them, and
 * walk the signed CDN files in parallel batches for raw rrweb events.
 *
 * @example
 * ```typescript
 * const replays = new ReplaysService(client, {
 *   queryFn: (events, options) => workspace.query(events, options),
 * });
 * const summaries = await replays.discover({ distinctId: "user-42" });
 * for (const signed of await replays.sign([summaries[0].replay_id])) {
 *   for await (const event of replays.walkCdnAsync(signed, {
 *     retentionDays: summaries[0].retention_days,
 *   })) {
 *     // one raw rrweb event dict per iteration
 *   }
 * }
 * ```
 * @see mixpanel_headless._internal.services.replays.ReplaysService
 */
export class ReplaysService {
  /** The bound API client used for signing and Insights calls. */
  readonly api: MixpanelClient;

  /**
   * The bound `Workspace.query`, or `null`.
   *
   * @internal
   */
  readonly queryFn: ReplayQueryFn | null;

  /**
   * Debug sink; never receives `query_string`. Python's `self._logger`
   * is likewise assigned but never emitted to — it is part of the
   * documented injection surface, not a live call site, and the port
   * keeps it observable for the same reason.
   */
  readonly logger: ReplaysLogger | undefined;

  /** The CDN fetch seam (`_async_transport` twin). */
  readonly #fetchImpl: typeof fetch | undefined;

  /** The `warnings.warn` sink. */
  readonly #warn: WarningSink;

  /** The `time.time()` seam (unix seconds). */
  readonly #now: () => number;

  /**
   * Initialize the service; see {@link ReplaysServiceOptions} for each
   * injected seam.
   *
   * @param apiClient - Authenticated Mixpanel client.
   * @param options - The injection bag.
   */
  constructor(apiClient: MixpanelClient, options: ReplaysServiceOptions = {}) {
    this.api = apiClient;
    this.queryFn = options.queryFn ?? null;
    this.logger = options.logger;
    this.#fetchImpl = options.fetchImpl;
    this.#warn =
      options.warn ??
      ((): void => {
        // No sink injected: warnings are dropped.
      });
    this.#now = options.now ?? ((): number => Date.now() / 1000);
  }

  // --- Sign ---

  /**
   * Sign one or more replay IDs for CDN access.
   *
   * @remarks
   * Captures `signed_at` before issuing the request so callers' expiry
   * arithmetic is conservative. Delegates raw signing to the client's
   * `signReplays`, which handles the 403 → `SessionReplayAccessError`
   * mapping.
   * @param replayIds - Replay IDs to sign, in any order.
   * @param env - `"prod"` or `"dev"`; defaults to `"prod"`.
   * @returns `SignedReplay`s in input order. `query_string` is a
   *   bearer credential — never log it.
   * @throws {@link SessionReplayAccessError} - Sensitive-data 403.
   * @throws {@link QueryError} - Other 4xx rejections.
   * @throws {@link ServerError} - 5xx after the retry budget.
   * @see mixpanel_headless._internal.services.replays.ReplaysService.sign
   */
  async sign(
    replayIds: readonly string[],
    env: "prod" | "dev" = "prod",
  ): Promise<SignedReplay[]> {
    const signedAt = this.#now();
    const raw = await this.api.signReplays(replayIds, env);
    return raw.map((item) => {
      const row = toNativeJson(item) as Dict;
      return new SignedReplay({
        replay_id: String(row["replay_id"]),
        url: String(row["url"]),
        query_string: String(row["query_string"]),
        env,
        signed_at: signedAt,
      });
    });
  }

  // --- Fetch / walk ---

  /**
   * Fetch every CDN file of a replay in parallel batches and return the
   * concatenated events.
   *
   * @param signed - Signed CDN access handle from {@link sign}.
   * @param options - Retention suffix, bounds, concurrency and re-sign
   *   policy.
   * @returns The rrweb event stream ordered by file number, then by
   *   in-file `timestamp`.
   * @throws {@link ReplayNotFoundError} - First CDN file was 404.
   * @throws {@link SignedURLExpiredError} - Re-sign retry also 403'd, or
   *   `reSignOnExpiry` was `false`.
   * @throws {@link UnsupportedReplayFormatError} - First event isn't
   *   rrweb.
   * @throws {@link MixpanelHeadlessError} - Network errors during the
   *   CDN fetch.
   * @see mixpanel_headless._internal.services.replays.ReplaysService.fetch_files
   */
  async fetchFiles(
    signed: SignedReplay,
    options: WalkCdnOptions,
  ): Promise<Dict[]> {
    const collected: Dict[] = [];
    for await (const ev of this.walkCdnAsync(signed, options)) {
      collected.push(ev);
    }
    return collected;
  }

  /**
   * Walk the CDN files of a replay in parallel batches, yielding rrweb
   * events lazily.
   *
   * @remarks
   * 1. Fetch files `[N, N+concurrency)` in parallel.
   * 2. If any 403 hits and `reSignOnExpiry`, re-sign once and retry the
   *    whole batch; otherwise raise `SignedURLExpiredError`.
   * 3. Walk the batch in file-number order. File 0 returning 404 raises
   *    `ReplayNotFoundError`; any subsequent 404 terminates the walk
   *    cleanly (end-of-replay sentinel).
   * 4. Within each surviving file, yield events sorted by `timestamp`.
   * 5. Continue until termination, exhaustion, or `maxFiles`.
   * @param signed - Signed CDN access handle.
   * @param options - Retention suffix, bounds, concurrency and re-sign
   *   policy.
   * @yields Raw rrweb event dicts ordered by file number, then by
   *   in-file `timestamp`.
   * @throws {@link ReplayNotFoundError} - First CDN file 404.
   * @throws {@link SignedURLExpiredError} - Expiry retry exhausted or
   *   disabled.
   * @throws {@link UnsupportedReplayFormatError} - First event isn't
   *   rrweb.
   * @throws {@link MixpanelHeadlessError} - Underlying CDN HTTP error.
   * @see mixpanel_headless._internal.services.replays.ReplaysService.walk_cdn_async
   */
  // eslint-disable-next-line complexity -- branch-for-branch port of one Python function (see the docblock); splitting it would scatter the guard order the corpus pins
  async *walkCdnAsync(
    signed: SignedReplay,
    options: WalkCdnOptions,
  ): AsyncGenerator<Dict, void, undefined> {
    const retentionDays = options.retentionDays;
    const maxFiles = options.maxFiles ?? 500;
    const concurrency = options.concurrency ?? 50;
    const reSignOnExpiry = options.reSignOnExpiry ?? true;

    let currentSigned = signed;
    let fileNum = 0;
    let mobileChecked = false;
    let reSignedOnce = false;

    while (fileNum < maxFiles) {
      const batchEnd = Math.min(fileNum + concurrency, maxFiles);
      const batchNums: number[] = [];
      for (let n = fileNum; n < batchEnd; n += 1) {
        batchNums.push(n);
      }

      let results = await this.#fetchBatch(
        currentSigned,
        batchNums,
        retentionDays,
      );

      // 403 retry: re-sign once if any file in the batch expired.
      if (results.some(([status]) => status === 403)) {
        if (!reSignOnExpiry || reSignedOnce) {
          throw this.buildExpiredError(signed);
        }
        reSignedOnce = true;
        const fresh = await this.sign([signed.replay_id], signed.env);
        currentSigned = fresh[0] as SignedReplay;
        results = await this.#fetchBatch(
          currentSigned,
          batchNums,
          retentionDays,
        );
        if (results.some(([status]) => status === 403)) {
          throw this.buildExpiredError(signed);
        }
      }

      // Walk results in file-number order. A 404 mid-walk is the clean
      // end-of-replay sentinel; a 404 on file 0 means the replay simply
      // doesn't exist on the CDN.
      let terminateAt = results.length;
      for (const [i, result] of results.entries()) {
        const [status] = result;
        if (status === 404) {
          if (fileNum + i === 0) {
            throw replayNotFoundError(signed.replay_id, {
              retentionDays,
              cdnUrlPrefix: signed.url,
            });
          }
          terminateAt = i;
          break;
        }
      }

      // Yield events from the surviving files in timestamp order.
      for (let i = 0; i < terminateAt; i += 1) {
        const [status, events] = results[i] as FetchOutcome;
        if (status !== 200 || events === null || events.length === 0) {
          continue;
        }
        if (!mobileChecked) {
          mobileChecked = true;
          if (!looksLikeRrweb(events[0])) {
            throw new UnsupportedReplayFormatError(
              `Replay ${signed.replay_id} appears to be a ` +
                `mobile session (non-rrweb format). Mobile ` +
                `session replays are not yet supported by ` +
                `mixpanel-headless. Track upstream at SR-230.`,
              {
                details: {
                  replay_id: signed.replay_id,
                  format: "non-rrweb",
                },
              },
            );
          }
        }
        // Python `sorted(events, key=lambda e: int(e.get("timestamp", 0)))`
        // — stable, and the key is the CPython `int()` ladder
        // (`pythonIntCoerce`: floats truncate toward zero, strings parse
        // with the CPython grammar). Decorate-sort-undecorate because
        // Python computes the key for every element — including
        // single-element files a JS comparator would never visit — and
        // `.get`'s default applies only when the key is absent (an
        // explicit `null` raises `int(None)`'s `TypeError`).
        const ordered = events
          .map((event) => ({
            event,
            key: pythonIntCoerce(
              Object.hasOwn(event, "timestamp") ? event["timestamp"] : 0,
            ),
          }))
          .sort((a, b) => a.key - b.key)
          .map((decorated) => decorated.event);
        for (const ev of ordered) {
          yield ev;
        }
      }

      if (terminateAt < results.length) {
        return;
      }
      fileNum = batchEnd;
    }
  }

  /**
   * Issue parallel CDN GETs for a batch of file numbers.
   *
   * @remarks
   * The promise array is built eagerly in file-number order, so every
   * request fires synchronously before the first await — the
   * `asyncio.gather` task-order twin, which is what lets the conformance
   * rig serve positional fetch responses deterministically.
   * @param signed - The active signed handle (may be re-signed).
   * @param fileNums - File numbers to fetch, in order.
   * @param retentionDays - Retention suffix.
   * @returns `(status, eventsOrNull)` outcomes in `fileNums` order.
   * @see mixpanel_headless._internal.services.replays.ReplaysService._fetch_batch
   */
  async #fetchBatch(
    signed: SignedReplay,
    fileNums: readonly number[],
    retentionDays: number,
  ): Promise<FetchOutcome[]> {
    const tasks = fileNums.map((n) => this.#fetchOne(signed, n, retentionDays));
    return Promise.all(tasks);
  }

  /**
   * Fetch a single CDN file:
   * `{signed.url}{file_num:04d}-{retention_days}.json?{query_string}`.
   *
   * @param signed - Signed access handle providing url + credential.
   * @param fileNum - Zero-padded file index (0–9999).
   * @param retentionDays - Retention suffix.
   * @returns `(status, events)` — the decoded list for 200s, `null` for
   *   404 and 403.
   * @throws {@link MixpanelHeadlessError} - `CDN_FETCH_ERROR` on
   *   transport failure (credential scrubbed from the message),
   *   `CDN_INVALID_RESPONSE` on a non-JSON 200 body,
   *   `CDN_UNEXPECTED_STATUS` otherwise.
   * @see mixpanel_headless._internal.services.replays.ReplaysService._fetch_one
   */
  async #fetchOne(
    signed: SignedReplay,
    fileNum: number,
    retentionDays: number,
  ): Promise<FetchOutcome> {
    // query_string is a bearer credential — never log this URL.
    const url = `${signed.url}${zfill(String(fileNum), 4)}-${String(retentionDays)}.json?${signed.query_string}`;
    const label = zfill(String(fileNum), 4);
    let response: Response;
    let release: () => void;
    try {
      const raw = await rawFetch(this.#resolveFetch(), {
        method: "GET",
        url,
        params: {},
        jsonBody: null,
        formBody: null,
        headers: {},
        timeoutSeconds: CDN_TIMEOUT_SECONDS,
      });
      response = raw.response;
      release = raw.release;
    } catch (error) {
      if (!(error instanceof MixpanelHttpError)) {
        // Cancellation (`AbortError`) passes through unchanged — it is
        // not an `httpx.HTTPError` on the Python side either.
        throw error;
      }
      // `str(exc)` can embed the request URL, and our URL carries the
      // signed query_string bearer credential. Scrub it before it lands
      // in an exception message or log, as Python does.
      const safe = error.message.replaceAll(signed.query_string, "<redacted>");
      // Python raises with no details (`raise ... from exc`) — the cause
      // threads through ErrorOptions, never the details bag, which the
      // recorded `details_contain` assertions would otherwise see.
      throw new MixpanelHeadlessError(
        `CDN fetch failed for file ${label}: ${safe}`,
        "CDN_FETCH_ERROR",
        null,
        { cause: error },
      );
    }

    try {
      if (response.status === 200) {
        const text = await response.text();
        let payload: unknown;
        // CPython `json.loads` accepts `NaN` / `Infinity` / `-Infinity`,
        // so the body parses with Python constants enabled, never through
        // `response.json()`.
        try {
          payload = toNativeJson(
            parseLossless(text, { pythonConstants: true }),
          );
        } catch (error) {
          if (!(error instanceof LosslessJsonError)) {
            throw error;
          }
          // Python: `raise ... from exc` with no details — cause via
          // ErrorOptions, never the details bag.
          throw new MixpanelHeadlessError(
            `CDN file ${label} returned non-JSON: ${error.message}`,
            "CDN_INVALID_RESPONSE",
            null,
            { cause: error },
          );
        }
        // A 200 dict/scalar body is an empty file, not an error, as in
        // Python.
        const events = Array.isArray(payload) ? (payload as Dict[]) : [];
        return [200, events];
      }
      if (response.status === 403 || response.status === 404) {
        return [response.status, null];
      }
      throw new MixpanelHeadlessError(
        `CDN file ${label} returned unexpected status ${String(
          response.status,
        )}`,
        "CDN_UNEXPECTED_STATUS",
      );
    } finally {
      release();
    }
  }

  /**
   * Resolve the fetch seam: the injected transport, else the client's.
   *
   * @returns The fetch implementation for CDN GETs.
   */
  #resolveFetch(): typeof fetch {
    return this.#fetchImpl ?? this.api.core.http().fetchImpl;
  }

  /**
   * Construct the canonical `SignedURLExpiredError` for a signed handle.
   *
   * @param signed - The signed handle whose URL expired — always the
   *   original handle, even after a re-sign, so `signed_at` /
   *   `expired_at` describe the URL that actually expired.
   * @returns The error with the catalog message and the
   *   `replay_id` / `signed_at` / `expired_at` details.
   * @see mixpanel_headless._internal.services.replays.ReplaysService._build_expired_error
   */
  buildExpiredError(signed: SignedReplay): SignedURLExpiredError {
    return new SignedURLExpiredError(
      `Signed URL for replay ${signed.replay_id} expired (5-minute ` +
        `TTL). Re-sign with sign_replay(${pythonRepr(signed.replay_id)}) or use ` +
        `the default re_sign_on_expiry=True on stream_replay.`,
      {
        details: {
          replay_id: signed.replay_id,
          signed_at: signed.signed_at,
          expired_at: signed.expires_at,
        },
        statusCode: 403,
      },
    );
  }

  // --- Discovery + events ---

  /**
   * Discover replays for a user or hydrate explicit IDs.
   *
   * @remarks
   * Issues exactly one Insights query against `$mp_session_record`
   * grouped on `$mp_replay_id` and `$mp_replay_retention_period`, then
   * collapses the result into `ReplaySummary` rows. A warning fires for
   * any replay missing `$mp_replay_retention_period` — those default to
   * 30 days.
   * @param options - The selector (`distinctId` or `replayIds`, not
   *   both), the optional date window and the `limit`.
   * @returns `ReplaySummary` rows, possibly empty.
   * @throws {@link MixpanelHeadlessError} - `REPLAYS_QUERY_FN_REQUIRED`
   *   when the service was constructed without a `queryFn`. Divergence:
   *   Python raises a bare `RuntimeError`; the code is the port's
   *   discriminator.
   * @see mixpanel_headless._internal.services.replays.ReplaysService.discover
   */
  async discover(options: DiscoverOptions = {}): Promise<ReplaySummary[]> {
    if (this.queryFn === null) {
      throw new MixpanelHeadlessError(
        "ReplaysService.discover requires query_fn (typically " +
          "Workspace.query) at construction",
        "REPLAYS_QUERY_FN_REQUIRED",
      );
    }

    const distinctId = options.distinctId ?? null;
    const replayIds = options.replayIds ?? null;
    const fromDate = options.fromDate ?? null;
    const toDate = options.toDate ?? null;
    const limit = options.limit ?? 100;

    let where: Filter;
    if (distinctId !== null) {
      where = Filter.equals("$distinct_id", distinctId);
    } else if (replayIds !== null && replayIds.length > 0) {
      where = Filter.equals("$mp_replay_id", [...replayIds]);
    } else {
      return [];
    }

    // Scope the discovery scan. With an explicit window the query is
    // tight; without one (the replay_ids hydration path), fall back to a
    // 90-day lookback so replays anywhere in the maximum retention
    // window are discoverable.
    const dateKwargs: Record<string, unknown> =
      fromDate !== null && toDate !== null
        ? { from_date: fromDate, to_date: toDate }
        : { last: EVENTS_DEFAULT_LOOKBACK_DAYS };

    // math="min" on the event $time property returns the earliest event
    // timestamp per (replay, retention) segment as a single compact
    // leaf. The leaf is unix seconds; `toUnixMs` up-converts it. Note
    // the property is "$time" (the reserved event-time property); plain
    // "time" silently returns an empty series.
    const result = await this.queryFn("$mp_session_record", {
      group_by: ["$mp_replay_id", "$mp_replay_retention_period"],
      where,
      math: "min",
      math_property: "$time",
      mode: "table",
      ...dateKwargs,
    });

    const projectId = pythonIntCoerce(this.api.projectId);
    return this.parseSummaries(result.series, {
      projectId,
      distinctId,
      limit,
    });
  }

  /**
   * Collapse a min-time Insights `series` into `ReplaySummary` rows.
   *
   * @remarks
   * Walks the raw nested dict the Insights API returns rather than the
   * lossy `.df` projection: the series nests in group order with an
   * `$overall` rollup key at every level.
   * @param series - The `result.series` value.
   * @param options - The `projectId` to stamp, the `distinctId` to
   *   attach and the hard `limit`.
   * @returns Up to `limit` rows. Empty when the query produced none.
   * @see mixpanel_headless._internal.services.replays.ReplaysService._parse_summaries
   */
  parseSummaries(
    series: unknown,
    options: {
      projectId: number;
      distinctId: string | null;
      limit: number;
    },
  ): ReplaySummary[] {
    const replayLevel = firstMetricNode(series);
    if (replayLevel === null) {
      return [];
    }

    const summaries: ReplaySummary[] = [];
    const seen = new Set<string>();
    for (const [replayId, retentionNode] of Object.entries(replayLevel)) {
      if (replayId === "$overall") {
        continue;
      }
      const replayIdStr = replayId;
      if (replayIdStr === "" || seen.has(replayIdStr)) {
        continue;
      }
      if (!isPythonDict(retentionNode)) {
        continue;
      }

      const [retentionDays, minTime] = this.#extractRetentionAndTime(
        retentionNode,
        replayIdStr,
      );
      const startTime = toUnixMs(minTime);
      if (startTime <= 0) {
        // No usable start time — can't form a valid ReplaySummary
        // (positive unix-ms is a constructor invariant).
        continue;
      }

      seen.add(replayIdStr);
      summaries.push(
        new ReplaySummary({
          replay_id: replayIdStr,
          distinct_id: options.distinctId,
          project_id: options.projectId,
          start_time: startTime,
          retention_days: retentionDays,
        }),
      );
      if (summaries.length >= options.limit) {
        break;
      }
    }

    return summaries;
  }

  /**
   * Pull `(retentionDays, minTime)` from a replay's retention subtree.
   *
   * @remarks
   * Returns the first standard retention window in `{1, 7, 30, 90}`
   * with its min-time leaf. When none is present, defaults to 30 days,
   * warns, and recovers the min-time from any available branch (a
   * non-standard key if one exists, else the `$overall` rollup).
   * @param retentionNode - The replay's retention-level dict.
   * @param replayId - The replay id, used in the warning message.
   * @returns The `(retention_days, min_time_value)` pair.
   * @see mixpanel_headless._internal.services.replays.ReplaysService._extract_retention_and_time
   */
  #extractRetentionAndTime(
    retentionNode: Dict,
    replayId: string,
  ): [number, unknown] {
    let fallbackKey: string | null = null;
    for (const [key, leaf] of Object.entries(retentionNode)) {
      if (key === "$overall") {
        continue;
      }
      fallbackKey ??= key;
      let window: number;
      try {
        window = pythonIntCoerce(key);
      } catch {
        // Python catches (TypeError, ValueError) from `int(key)`.
        continue;
      }
      if (window === 1 || window === 7 || window === 30 || window === 90) {
        return [window, leafValue(leaf)];
      }
    }

    this.#warn(
      `replay ${replayId} is missing ` +
        `$mp_replay_retention_period; defaulting to 30 days. Upgrade your ` +
        `Mixpanel SDK to stamp this property on new recordings.`,
    );
    if (fallbackKey !== null) {
      return [DEFAULT_RETENTION_DAYS, leafValue(retentionNode[fallbackKey])];
    }
    return [DEFAULT_RETENTION_DAYS, leafValue(retentionNode["$overall"])];
  }

  /**
   * Fetch the Mixpanel events of a list of replays in one round-trip.
   *
   * @remarks
   * Queries the `$all_events` wildcard grouped on `$time` /
   * `$event_name` / `$mp_replay_id` (plus any caller-supplied
   * `eventProperties`), filters on `$mp_replay_id IN replayIds`, and
   * excludes the `$mp_session_record` event itself.
   * @param replayIds - Replays to look up events for. May be empty.
   * @param options - Extra group keys and the optional date window.
   * @returns `replay_id` → time-sorted `ReplayEvent` list. Replays with
   *   no events are omitted.
   * @throws {@link MixpanelHeadlessError} - `REPLAYS_QUERY_FN_REQUIRED`
   *   when the service was constructed without a `queryFn` (Python
   *   raises a bare `RuntimeError`).
   * @see mixpanel_headless._internal.services.replays.ReplaysService.events_for
   */
  // eslint-disable-next-line complexity -- branch-for-branch port of one Python function (see the docblock); splitting it would scatter the guard order the corpus pins
  async eventsFor(
    replayIds: readonly string[],
    options: EventsForOptions = {},
  ): Promise<Map<string, ReplayEvent[]>> {
    if (this.queryFn === null) {
      throw new MixpanelHeadlessError(
        "ReplaysService.events_for requires query_fn (typically " +
          "Workspace.query) at construction",
        "REPLAYS_QUERY_FN_REQUIRED",
      );
    }
    if (replayIds.length === 0) {
      return new Map();
    }

    const eventProperties = options.eventProperties ?? null;
    const fromDate = options.fromDate ?? null;
    const toDate = options.toDate ?? null;

    // Group on time + event_name + replay_id (+ any caller extras) so
    // the result has one row per event per replay.
    const groupBy: string[] = ["$time", "$event_name", "$mp_replay_id"];
    if (eventProperties !== null && eventProperties.length > 0) {
      groupBy.push(...eventProperties);
    }

    // Two filters: limit to the requested replays AND exclude the
    // recording event itself.
    const where = [
      Filter.equals("$mp_replay_id", [...replayIds]),
      Filter.notEquals("$event_name", "$mp_session_record"),
    ];
    const dateKwargs: Record<string, unknown> =
      fromDate !== null && toDate !== null
        ? { from_date: fromDate, to_date: toDate }
        : { last: EVENTS_DEFAULT_LOOKBACK_DAYS };
    const result = await this.queryFn("$all_events", {
      group_by: groupBy,
      where,
      mode: "table",
      ...dateKwargs,
    });

    // Parse result.series directly — `flattenSeries` walks the nested
    // dict in group_by order, skipping `$overall` rollups.
    const out = new Map<string, ReplayEvent[]>();
    const rows = flattenSeries(result.series, groupBy);
    for (const row of rows) {
      const replayId = row["$mp_replay_id"];
      if (replayId === undefined || replayId === null) {
        continue;
      }
      const replayIdStr = pythonStrOf(replayId);
      const eventTime = toUnixSeconds(row["$time"]);
      if (eventTime <= 0) {
        continue;
      }
      const eventName = pythonStrOf(row["$event_name"] ?? "(unknown)");
      let properties: Record<string, unknown> | null = null;
      if (eventProperties !== null && eventProperties.length > 0) {
        properties = {};
        for (const prop of eventProperties) {
          if (Object.hasOwn(row, prop)) {
            properties[prop] = row[prop];
          }
        }
      }
      const bucket = out.get(replayIdStr) ?? [];
      bucket.push(
        new ReplayEvent({
          replay_id: replayIdStr,
          event_name: eventName,
          event_time: eventTime,
          properties,
        }),
      );
      out.set(replayIdStr, bucket);
    }

    // Match upstream's deterministic time-ordered output per replay
    // (Python `list.sort` is stable; so is `Array.prototype.sort`).
    for (const events of out.values()) {
      events.sort((a, b) => a.event_time - b.event_time);
    }

    return out;
  }
}

// --- Series helpers ---

/**
 * Return the first dict-valued metric node of an Insights `series`.
 *
 * @param series - The `result.series` value (expected `dict`).
 * @returns The replay-level dict, or `null`.
 * @see mixpanel_headless._internal.services.replays.ReplaysService._first_metric_node
 */
function firstMetricNode(series: unknown): Dict | null {
  if (!isPythonDict(series)) {
    return null;
  }
  for (const value of Object.values(series)) {
    if (isPythonDict(value)) {
      return value;
    }
  }
  return null;
}

/**
 * Extract the scalar from a series leaf — `{"all": v}` → `v`.
 *
 * @param leaf - A series leaf node, normally `{"all": value}`.
 * @returns The `"all"` value for dict leaves; the leaf itself
 *   otherwise.
 * @see mixpanel_headless._internal.services.replays.ReplaysService._leaf_value
 */
function leafValue(leaf: unknown): unknown {
  if (isPythonDict(leaf)) {
    return leaf["all"] ?? null;
  }
  return leaf;
}

/**
 * Flatten a nested Insights `series` into one row dict per leaf.
 *
 * @param series - The `result.series` nested dict.
 * @param groupBy - Group-by property names in request order.
 * @returns One row per non-rollup leaf. Empty for a non-dict series.
 * @see mixpanel_headless._internal.services.replays.ReplaysService._flatten_series
 */
function flattenSeries(
  series: unknown,
  groupBy: readonly string[],
): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  if (!isPythonDict(series)) {
    return rows;
  }
  for (const node of Object.values(series)) {
    if (isPythonDict(node)) {
      walkSeries(node, groupBy, 0, {}, rows);
    }
  }
  return rows;
}

/**
 * Collect leaf rows from a nested series node, recursively.
 *
 * @param node - The current sub-dict.
 * @param groupBy - Group-by property names (the nesting order).
 * @param depth - How many group levels have been consumed.
 * @param acc - Group key/value pairs accumulated down this branch.
 * @param rows - Output accumulator, appended in place.
 * @see mixpanel_headless._internal.services.replays.ReplaysService._walk_series
 */
function walkSeries(
  node: Dict,
  groupBy: readonly string[],
  depth: number,
  acc: Readonly<Record<string, unknown>>,
  rows: Array<Record<string, unknown>>,
): void {
  if (depth >= groupBy.length) {
    rows.push({ ...acc, count: leafValue(node) });
    return;
  }
  const prop = groupBy[depth] as string;
  for (const [key, child] of Object.entries(node)) {
    if (key === "$overall") {
      continue;
    }
    if (isPythonDict(child)) {
      walkSeries(child, groupBy, depth + 1, { ...acc, [prop]: key }, rows);
    }
  }
}

/**
 * Coerce a Mixpanel `$time` value to unix milliseconds.
 *
 * @remarks
 * Mixpanel's `$time` comes back as an ISO-8601 string, a pandas
 * Timestamp, or a unix seconds/ms int depending on the response shape.
 * Returns `0` when the value can't be parsed — callers treat that as
 * "skip this row".
 *
 * Divergence: Python's final branch is `pd.Timestamp(value)`, whose
 * grammar is far wider than ISO-8601 (`"now"`, `"3 Jan 2026"`, …); the
 * port accepts ISO-8601 and unix seconds/ms only and returns `0` for
 * anything else. The reachable domain is the Insights `$time` group
 * key, always a second-precision ISO-8601 string.
 * @param value - Raw cell from the result series.
 * @returns Unix milliseconds, or `0` when uninterpretable.
 * @see mixpanel_headless._internal.services.replays.ReplaysService._to_unix_ms
 */
function toUnixMs(value: unknown): number {
  if (value === null || value === undefined) {
    return 0;
  }
  if (typeof value === "boolean") {
    // Python `isinstance(True, int)` is True — bool takes the int path.
    const ivalue = value ? 1 : 0;
    return ivalue > 10 ** 12 ? ivalue : ivalue * 1000;
  }
  if (typeof value === "number") {
    // Python splits int vs float, but both branches compute the same
    // thing once the float is truncated.
    const ivalue = Number.isInteger(value) ? value : Math.trunc(value);
    return ivalue > 10 ** 12 ? ivalue : ivalue * 1000;
  }
  if (typeof value === "string") {
    const ms = parseIsoToMs(value);
    return ms ?? 0;
  }
  return 0;
}

/**
 * Coerce a Mixpanel `$time` value to unix seconds.
 *
 * @param value - Raw cell from the result series.
 * @returns Unix seconds, or `0` when uninterpretable.
 * @see mixpanel_headless._internal.services.replays.ReplaysService._to_unix_seconds
 */
function toUnixSeconds(value: unknown): number {
  const ms = toUnixMs(value);
  // Python `ms // 1000` is floor division; `ms > 0` guards the branch.
  return ms > 0 ? Math.floor(ms / 1000) : 0;
}

/**
 * Parse an ISO-8601 datetime the way `pd.Timestamp(str)` does for the
 * reachable `$time` domain: a naive timestamp is UTC (pandas' `.value`
 * is epoch nanoseconds with no zone applied), an explicit offset is
 * honoured.
 *
 * @remarks
 * `Date.parse` is not a drop-in: per ES2016 it reads a date-time form
 * without an offset as local time, which would shift every naive
 * Insights key by the host's zone.
 * @param text - The candidate timestamp string.
 * @returns Epoch milliseconds, or `null` when the text isn't ISO-8601.
 */
function parseIsoToMs(text: string): number | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(
      text,
    );
  if (match === null) {
    return null;
  }
  const [, y, mo, d, h, mi, s, frac, zone] = match;
  const fracMs =
    frac === undefined ? 0 : Math.trunc(Number(`0.${frac}`) * 1000);
  let ms = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    h === undefined ? 0 : Number(h),
    mi === undefined ? 0 : Number(mi),
    s === undefined ? 0 : Number(s),
    fracMs,
  );
  if (zone !== undefined && zone !== "Z") {
    const sign = zone.startsWith("-") ? 1 : -1;
    const digits = zone.slice(1).replace(":", "");
    const offsetMinutes =
      Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4));
    ms += sign * offsetMinutes * 60_000;
  }
  return Number.isNaN(ms) ? null : ms;
}
