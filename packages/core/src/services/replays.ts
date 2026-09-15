/**
 * ReplaysService — TS port of
 * `mixpanel_headless/_internal/services/replays.py` (971 lines, whole
 * file) for Phase-3 batch B5, shard S3
 * (`docs/history/phase3/design/b5-packets.md` §5).
 *
 * Orchestrates the discovery → sign → fetch pipeline against the
 * Mixpanel App API and the signed CDN. Owned by `Workspace`; not part
 * of the public API. The service stays PURE BYTES — the rrweb analyzer
 * runs a layer above, in `Workspace.fetchReplay`.
 *
 * Port-wide conventions applied here:
 *
 * - R10.8 — signing is the ALREADY-PORTED B4 client method
 *   (`signReplays`, `services/entities/replays-signing.ts`); the 403
 *   `SESSION_RECORDING_SENSITIVE_DATA` mapping lives in B0
 *   `handleResponse`. Nothing is re-assembled or re-handled here.
 * - GATE-R5 / B0-1 F1 — the CDN 200 body parses through
 *   {@link parseLossless} with `pythonConstants: true` (CPython
 *   `json.loads` accepts `NaN` / `Infinity` / `-Infinity`), never
 *   `response.json()` or a bare `JSON.parse`.
 * - R2.4 — CDN GETs go through the SAME injected fetch seam as the
 *   wire client (`client.core.http().fetchImpl` by default; the
 *   `fetchImpl` option is the `_async_transport` twin), via
 *   {@link rawFetch} so `httpx.HTTPError` normalization (R2.10) and
 *   the D-B4ARB-1 timeout scope are shared, not re-derived.
 * - R6.4 (packet §5) — batch bounds, issue order, the 403 re-sign-once
 *   rule, the 404 sentinel, the once-only mobile check, and the
 *   per-file `sorted(events, key=int(timestamp))` yield are
 *   byte-identical to Python.
 * - R6.6 — {@link ReplaysService.walkCdnAsync} is a true async
 *   generator yielding ITEM-BY-ITEM; nothing buffers except
 *   {@link ReplaysService.fetchFiles}, which is Python's buffered
 *   wrapper.
 * - R11.7 / packet §9 Caution #3 — `int(e.get("timestamp", 0))` routes
 *   through {@link pythonIntCoerce} (CPython truncates floats toward
 *   zero and parses strings with the CPython grammar).
 * - R9.5 — the `warnings.warn` side channel and the logger are
 *   injected seams; `core` never touches `console`.
 * - §0.4 determinism — `time.time()` at `replays.py:207` routes
 *   through the injected `now` seam.
 * - packet §9 Caution #4 — `_build_expired_error(signed)` takes the
 *   ORIGINAL handle even after a re-sign.
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
 * Allowed retention windows — surfaced as a sentinel so the
 * discover-time warning path can default a missing
 * `$mp_replay_retention_period` (`_DEFAULT_RETENTION_DAYS`,
 * `replays.py:54`).
 */
const DEFAULT_RETENTION_DAYS = 30;

/**
 * Lookback for {@link ReplaysService.eventsFor} when the caller doesn't
 * pass an explicit window (`_EVENTS_DEFAULT_LOOKBACK_DAYS`,
 * `replays.py:59`). 90 = the maximum replay retention window.
 */
const EVENTS_DEFAULT_LOOKBACK_DAYS = 90;

/**
 * Per-request CDN timeout in SECONDS (`_CDN_TIMEOUT`,
 * `replays.py:68` — httpx `connect=10, read=30, write=10, pool=30`).
 *
 * fetch has no per-operation timeout primitive, so the port arms ONE
 * clock at the largest per-operation budget — the sanctioned
 * D-B4ARB-1 scope (`b4-review-resolution.md` §W-F2), identical to how
 * the B4 client bounds its own requests.
 */
const CDN_TIMEOUT_SECONDS = 30;

/**
 * Heuristic: does this look like an rrweb web-recording event?
 * (`_looks_like_rrweb`, `replays.py:70-88`).
 *
 * rrweb event shape always includes at minimum `type` (int
 * discriminator), `data` (dict), and `timestamp` (int ms). Mobile
 * session replays use a different recording format that lacks these
 * keys; absence is treated as "not rrweb".
 *
 * @param event - A single deserialized CDN-file element.
 * @returns `true` when the event carries the three required keys.
 */
function looksLikeRrweb(event: unknown): boolean {
  if (!isPythonDict(event)) {
    return false;
  }
  // Python `"k" in dict` is an own-key membership test — `Object.hasOwn`,
  // never the prototype-walking `in` (watchlist: prototype pollution).
  return (
    Object.hasOwn(event, "type") &&
    Object.hasOwn(event, "data") &&
    Object.hasOwn(event, "timestamp")
  );
}

/**
 * Build the canonical `ReplayNotFoundError` for an absent replay
 * (`replay_not_found_error`, `replays.py:91-122`).
 *
 * Two call sites surface the same "no replay on the CDN" condition —
 * the walker's first-file 404, and `Workspace.fetchReplay` when the
 * walk yields zero events. Sharing one constructor keeps their message
 * and `details` shape from drifting.
 *
 * @param replayId - The replay that could not be found.
 * @param options - `retentionDays` (the window searched) and
 *   `cdnUrlPrefix` (the signed prefix that was walked).
 * @returns The error with status 404 and structured details.
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
 * through (Python's `query_fn` DI kwarg, `replays.py:150-176`) — a
 * bound facade method, so the service never imports `Workspace`.
 */
export type ReplayQueryFn = (
  events: string,
  options: Readonly<Record<string, unknown>>,
) => Promise<{ readonly series?: unknown }>;

/** Debug/warning log seam of the service (R9.5). */
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
   * Injected fetch for CDN GETs — the `_async_transport` twin
   * (`replays.py:167`). Defaults to the client's own fetch seam.
   */
  readonly fetchImpl?: typeof fetch | undefined;
  /** `warnings.warn` sink for the missing-retention path (R9.5). */
  readonly warn?: WarningSink | undefined;
  /**
   * Clock seam backing `time.time()` at `replays.py:207`
   * (packet §0.4). Returns unix SECONDS as a float.
   */
  readonly now?: (() => number) | undefined;
}

/** Options of {@link ReplaysService.fetchFiles} / `walkCdnAsync`. */
export interface WalkCdnOptions {
  /** 1, 7, 30, or 90 — drives the file-name suffix per FR-013. */
  readonly retentionDays: number;
  /** Hard upper bound on the walk (default 500). */
  readonly maxFiles?: number | undefined;
  /** Parallel batch size (default 50). */
  readonly concurrency?: number | undefined;
  /** Re-sign once on 403 (default `true`); raise otherwise. */
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
  /** Maximum summaries to return (default 100). */
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
 * Orchestrator for the session-replay pipeline (`ReplaysService`,
 * `replays.py:125-783`).
 *
 * Sits between `Workspace` and the wire client; owns the async CDN
 * walker that pulls raw rrweb bytes.
 */
export class ReplaysService {
  /** The bound API client used for signing and Insights calls. */
  readonly api: MixpanelClient;

  /** The bound `Workspace.query`, or `null`. @internal */
  readonly queryFn: ReplayQueryFn | null;

  /**
   * Debug sink; never receives `query_string` (FR-009). Python's
   * `self._logger` (`replays.py:171`) is likewise ASSIGNED but never
   * emitted to — it is part of the documented DI surface, not a live
   * call site, and the port keeps it observable for the same reason.
   */
  readonly logger: ReplaysLogger | undefined;

  /** The CDN fetch seam (`_async_transport` twin). */
  readonly #fetchImpl: typeof fetch | undefined;

  /** The `warnings.warn` sink. */
  readonly #warn: WarningSink;

  /** The `time.time()` seam (unix seconds). */
  readonly #now: () => number;

  /**
   * Initialize the service (`__init__`, `replays.py:150-176`).
   *
   * @param apiClient - Authenticated Mixpanel client (B4, R10.8).
   * @param options - The DI bag (`queryFn` / `logger` / `fetchImpl` /
   *   `warn` / `now`).
   */
  constructor(apiClient: MixpanelClient, options: ReplaysServiceOptions = {}) {
    this.api = apiClient;
    this.queryFn = options.queryFn ?? null;
    this.logger = options.logger;
    this.#fetchImpl = options.fetchImpl;
    this.#warn =
      options.warn ??
      ((): void => {
        // No sink injected: warnings are dropped (CLEANUP-PLAN.md §12 8.8).
      });
    this.#now = options.now ?? ((): number => Date.now() / 1000);
  }

  // =========================================================================
  // Sign
  // =========================================================================

  /**
   * Sign one or more replay IDs for CDN access (`sign`,
   * `replays.py:178-217`).
   *
   * Captures `signed_at` BEFORE issuing the request so callers' expiry
   * arithmetic is conservative. Delegates raw signing to the B4 client
   * method, which handles the 403 → `SessionReplayAccessError` mapping.
   *
   * @param replayIds - Replay IDs to sign, in any order.
   * @param env - `"prod"` (default) or `"dev"`.
   * @returns `SignedReplay`s in input order. `query_string` is a
   *   bearer credential — never log it.
   * @throws SessionReplayAccessError - Sensitive-data 403.
   * @throws QueryError | ServerError - Other 4xx / 5xx.
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

  // =========================================================================
  // Fetch / walk
  // =========================================================================

  /**
   * Buffered parallel fetch of all CDN files for a replay
   * (`fetch_files`, `replays.py:224-275`).
   *
   * @param signed - Signed CDN access handle from {@link sign}.
   * @param options - Retention / bounds / concurrency / re-sign policy.
   * @returns The concatenated rrweb event stream in
   *   `(file-number, in-file timestamp)` order.
   * @throws ReplayNotFoundError - First CDN file was 404.
   * @throws SignedURLExpiredError - Re-sign retry also 403'd, or
   *   `reSignOnExpiry` was `false`.
   * @throws UnsupportedReplayFormatError - First event isn't rrweb.
   * @throws MixpanelHeadlessError - Network errors during CDN fetch.
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
   * Streaming parallel walk of CDN files; yields rrweb events lazily
   * (`walk_cdn_async`, `replays.py:277-394`).
   *
   * Algorithm (FR-011/012/014/015):
   * 1. Fetch files `[N, N+concurrency)` in parallel.
   * 2. If any 403 hits and `reSignOnExpiry`, re-sign ONCE and retry the
   *    whole batch; otherwise raise `SignedURLExpiredError`.
   * 3. Walk the batch in file-number order. File 0 returning 404 raises
   *    `ReplayNotFoundError`; any subsequent 404 terminates the walk
   *    cleanly (end-of-replay sentinel).
   * 4. Within each surviving file, yield events sorted by `timestamp`.
   * 5. Continue until termination, exhaustion, or `maxFiles`.
   *
   * @param signed - Signed CDN access handle.
   * @param options - Retention / bounds / concurrency / re-sign policy.
   * @yields Raw rrweb event dicts in
   *   `(file-number, then in-file timestamp)` order.
   * @throws ReplayNotFoundError - First CDN file 404.
   * @throws SignedURLExpiredError - Expiry retry exhausted or disabled.
   * @throws UnsupportedReplayFormatError - First event isn't rrweb.
   * @throws MixpanelHeadlessError - Underlying CDN HTTP error.
   */
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
        // — STABLE, and the key is the CPython `int()` ladder
        // (Caution #3). Decorate-sort-undecorate (B5-ARB FID-F3):
        // Python computes the key for EVERY element — including
        // single-element files a JS comparator would never visit —
        // and `.get`'s default applies only when the key is ABSENT
        // (an explicit `null` raises `int(None)`'s `TypeError`).
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
   * Issue parallel CDN GETs for a batch of file numbers
   * (`_fetch_batch`, `replays.py:396-418`).
   *
   * R6.4: the promise array is built EAGERLY in file-number order, so
   * every request fires synchronously before the first await — the
   * `asyncio.gather` task-order twin, and the reason a positional
   * `VectorFetch` serves deterministically.
   *
   * @param signed - The active signed handle (may be re-signed).
   * @param fileNums - File numbers to fetch, in order.
   * @param retentionDays - Retention suffix.
   * @returns `(status, eventsOrNull)` outcomes in `fileNums` order.
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
   * Fetch a single CDN file (`_fetch_one`, `replays.py:420-478`).
   *
   * URL pattern per FR-013:
   * `{signed.url}{file_num:04d}-{retention_days}.json?{query_string}`.
   *
   * @param signed - Signed access handle providing url + credential.
   * @param fileNum - Zero-padded file index (0–9999).
   * @param retentionDays - Retention suffix.
   * @returns `(status, events)` — the decoded list for 200s, `null` for
   *   404 and 403.
   * @throws MixpanelHeadlessError - `CDN_FETCH_ERROR` on transport
   *   failure (credential SCRUBBED), `CDN_INVALID_RESPONSE` on a
   *   non-JSON 200 body, `CDN_UNEXPECTED_STATUS` otherwise.
   */
  async #fetchOne(
    signed: SignedReplay,
    fileNum: number,
    retentionDays: number,
  ): Promise<FetchOutcome> {
    // NB: query_string is a bearer credential — never log this URL.
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
        // Cancellation (R6.7 `AbortError`) passes through unchanged —
        // it is not an `httpx.HTTPError` on the Python side either.
        throw error;
      }
      // `str(exc)` can embed the request URL, and our URL carries the
      // signed query_string bearer credential. Scrub it before it lands
      // in an exception message or log (`replays.py:455-467`).
      const safe = error.message.replaceAll(signed.query_string, "<redacted>");
      // Python raises with NO details (`raise ... from exc`,
      // `replays.py:457-460`) — the cause threads through ErrorOptions,
      // never the details bag (B5-BIND fix: `{cause}` in details leaked
      // into the recorded `details_contain` twin).
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
        try {
          payload = toNativeJson(
            parseLossless(text, { pythonConstants: true }),
          );
        } catch (error) {
          if (!(error instanceof LosslessJsonError)) {
            throw error;
          }
          // Python: `raise ... from exc` with NO details
          // (`replays.py:465-469`) — cause via ErrorOptions (B5-BIND fix).
          throw new MixpanelHeadlessError(
            `CDN file ${label} returned non-JSON: ${error.message}`,
            "CDN_INVALID_RESPONSE",
            null,
            { cause: error },
          );
        }
        // A 200 dict/scalar is an EMPTY file, not an error
        // (`replays.py:470`, packet §9 Caution #5).
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
   * Construct a canonical `SignedURLExpiredError` for `signed`
   * (`_build_expired_error`, `replays.py:480-506`).
   *
   * @param signed - The signed handle whose URL expired — always the
   *   ORIGINAL, even after a re-sign (packet §9 Caution #4).
   * @returns The error with the catalog message and the
   *   `replay_id` / `signed_at` / `expired_at` details.
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

  // =========================================================================
  // Discovery + events
  // =========================================================================

  /**
   * Discover replays for a user or hydrate explicit IDs (`discover`,
   * `replays.py:508-595`).
   *
   * Issues exactly one Insights query against `$mp_session_record`
   * grouped on `$mp_replay_id` and `$mp_replay_retention_period`, then
   * collapses the result into `ReplaySummary` rows. A warning fires for
   * any replay missing `$mp_replay_retention_period` — those default to
   * 30 days.
   *
   * @param options - Selector (`distinctId` XOR `replayIds`), the
   *   optional window, and the `limit`.
   * @returns `ReplaySummary` rows, possibly empty.
   * @throws MixpanelHeadlessError - Code `REPLAYS_QUERY_FN_REQUIRED`
   *   when the service was constructed without a `queryFn` (Python
   *   raises the uncoded `RuntimeError`; the code is the port's
   *   discriminator, R5.4).
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
    // leaf. The leaf is unix SECONDS; `toUnixMs` up-converts it. Note
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
   * Collapse a min-time Insights `series` into `ReplaySummary` rows
   * (`_parse_summaries`, `replays.py:597-668`).
   *
   * Walks the raw nested dict the Insights API returns rather than the
   * lossy `.df` projection: the series nests in group order with an
   * `$overall` rollup key at every level.
   *
   * @param series - The `result.series` value.
   * @param options - `projectId` to stamp, the `distinctId` to attach,
   *   and the hard `limit`.
   * @returns Up to `limit` rows. Empty when the query produced none.
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
   * Pull `(retentionDays, minTime)` from a replay's retention subtree
   * (`_extract_retention_and_time`, `replays.py:869-928`).
   *
   * Returns the first standard retention window in `{1, 7, 30, 90}`
   * with its min-time leaf. When none is present, defaults to 30 days,
   * warns, and recovers the min-time from any available branch (a
   * non-standard key if one exists, else the `$overall` rollup).
   *
   * @param retentionNode - The replay's retention-level dict.
   * @param replayId - The replay id, used in the warning message.
   * @returns The `(retention_days, min_time_value)` pair.
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
   * Mixpanel events for a list of replays in one round-trip
   * (`events_for`, `replays.py:670-783`).
   *
   * Queries the `$all_events` wildcard grouped on `$time` /
   * `$event_name` / `$mp_replay_id` (+ any caller-supplied
   * `eventProperties`), filters on `$mp_replay_id IN replayIds`, and
   * excludes the `$mp_session_record` event itself.
   *
   * @param replayIds - Replays to look up events for. May be empty.
   * @param options - Extra group keys and the optional window.
   * @returns `replay_id` → time-sorted `ReplayEvent` list. Replays with
   *   no events are omitted.
   * @throws MixpanelHeadlessError - Code `REPLAYS_QUERY_FN_REQUIRED`
   *   when the service was constructed without a `queryFn`.
   */
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
    // (Python `list.sort` is STABLE; so is `Array.prototype.sort`).
    for (const events of out.values()) {
      events.sort((a, b) => a.event_time - b.event_time);
    }

    return out;
  }
}

// ===========================================================================
// Module-level series helpers (`replays.py:786-971`)
// ===========================================================================

/**
 * Return the first dict-valued metric node of an Insights `series`
 * (`_first_metric_node`, `replays.py:786-805`).
 *
 * @param series - The `result.series` value (expected `dict`).
 * @returns The replay-level dict, or `null`.
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
 * Extract the scalar from a series leaf — `{"all": v}` → `v`
 * (`_leaf_value`, `replays.py:808-819`).
 *
 * @param leaf - A series leaf node, normally `{"all": value}`.
 * @returns The `"all"` value for dict leaves; the leaf itself
 *   otherwise.
 */
function leafValue(leaf: unknown): unknown {
  if (isPythonDict(leaf)) {
    return leaf["all"] ?? null;
  }
  return leaf;
}

/**
 * Flatten a nested Insights `series` into one row dict per leaf
 * (`_flatten_series`, `replays.py:931-961`).
 *
 * @param series - The `result.series` nested dict.
 * @param groupBy - Group-by property names in request order.
 * @returns One row per non-rollup leaf. Empty for a non-dict series.
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
 * Recursively collect leaf rows from a nested series node
 * (`_walk_series`, `replays.py:964-990`).
 *
 * @param node - The current sub-dict.
 * @param groupBy - Group-by property names (the nesting order).
 * @param depth - How many group levels have been consumed.
 * @param acc - Group key/value pairs accumulated down this branch.
 * @param rows - Output accumulator, appended in place.
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
 * Coerce a Mixpanel `$time` value to unix MILLISECONDS (`_to_unix_ms`,
 * `replays.py:993-1019` in the current-HEAD numbering).
 *
 * Mixpanel's `$time` comes back as an ISO-8601 string, a pandas
 * Timestamp, or a unix seconds/ms int depending on the response shape.
 * Returns `0` when the value can't be parsed — callers treat that as
 * "skip this row".
 *
 * TODO(port): Python's final branch is `pd.Timestamp(value)`, whose
 * accepted grammar is far wider than ISO-8601 (`"now"`, `"3 Jan 2026"`,
 * numpy datetimes, …). The REACHABLE domain here is the Insights
 * `$time` group key, which is always a second-precision ISO-8601
 * string, so this port implements ISO-8601 only and returns `0`
 * (Python's unparseable fallback) for everything else. Widening it
 * would need a pandas date-parser port, which no vector or Layer-3
 * assert reaches.
 *
 * @param value - Raw cell from the result series.
 * @returns Unix milliseconds, or `0` when uninterpretable.
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
 * Coerce a Mixpanel `$time` value to unix SECONDS (`_to_unix_seconds`,
 * `replays.py:1022-1035`).
 *
 * @param value - Raw cell from the result series.
 * @returns Unix seconds, or `0` when uninterpretable.
 */
function toUnixSeconds(value: unknown): number {
  const ms = toUnixMs(value);
  // Python `ms // 1000` is FLOOR division; `ms > 0` guards the branch.
  return ms > 0 ? Math.floor(ms / 1000) : 0;
}

/**
 * Parse an ISO-8601 datetime the way `pd.Timestamp(str)` does for the
 * reachable `$time` domain: a NAIVE timestamp is UTC (pandas' `.value`
 * is epoch nanoseconds with no zone applied), an explicit offset is
 * honoured.
 *
 * `Date.parse` is NOT a drop-in: per ES2016 it reads a date-TIME form
 * without an offset as LOCAL time, which would shift every naive
 * Insights key by the host's zone.
 *
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
