/**
 * Session-replay members of the `Workspace` facade — list, events-for,
 * sign, fetch, stream, replays-for-user and analyze — as functions over
 * the facade slice they read ({@link ReplayHost}); the facade keeps
 * one-line delegations. Calls between members go back through the host
 * (`host.fetchReplay`, `host.listReplays`, …), never directly, so an
 * instance-level override on the facade — Python's `ws.fetch_replay = …`
 * test seam — is honoured exactly as `self.fetch_replay(...)` would be.
 *
 * @see mixpanel_headless.workspace.Workspace
 */

import type { MixpanelClient } from "../client/client.js";
import { KeyError } from "../compat/python-builtins.js";
import { pythonIntCoerce } from "../compat/python-int.js";
import { pythonRepr } from "../compat/python-str.js";
import { zfill } from "../compat/zfill.js";
import { ParamValidationError } from "../errors.js";
import { toError } from "../invariant.js";
import { RrwebAnalyzer } from "../replays/rrweb-analyzer.js";
import { isoUtc } from "../services/discovery.js";
import {
  replayNotFoundError,
  type ReplaysService,
} from "../services/replays.js";
import {
  Replay,
  type ReplayEvent,
  type ReplaySummary,
  type SignedReplay,
} from "../types/results/replay-models.js";
import {
  ReplayBundle,
  type ReplayFetchFailure,
} from "../types/results/replays.js";
import type {
  ResolvedWorkspaceLogger,
  WorkspaceEventsForReplayOptions,
  WorkspaceFetchReplayOptions,
  WorkspaceFetchReplaysOptions,
  WorkspaceListReplaysOptions,
  WorkspaceReplaysForUserOptions,
  WorkspaceSignReplayOptions,
  WorkspaceStreamReplayOptions,
} from "./options.js";

/**
 * The facade slice the replay members read. The lazily-created service
 * and the project id are thunks so they are resolved exactly where the
 * Python method reads `self._replays_svc` / `int(self._session.project.id)`.
 */
export interface ReplayHost {
  /** The bound wire client (its clock stamps `computed_at`). */
  readonly client: MixpanelClient;
  /** The log seam. */
  readonly logger: ResolvedWorkspaceLogger;
  /** The memoized `ReplaysService` (`self._replays_svc`). */
  readonly replaysService: () => ReplaysService;
  /** `int(self._session.project.id)`. */
  readonly projectId: () => number;
  /** The facade's `listReplays` (instance dispatch, see the module doc). */
  readonly listReplays: (
    options?: WorkspaceListReplaysOptions,
  ) => Promise<ReplaySummary[]>;
  /** The facade's `eventsForReplay`. */
  readonly eventsForReplay: (
    replayId: string,
    options?: WorkspaceEventsForReplayOptions,
  ) => Promise<ReplayEvent[]>;
  /** The facade's `eventsForReplays`. */
  readonly eventsForReplays: (
    replayIds: readonly string[],
    options?: WorkspaceEventsForReplayOptions,
  ) => Promise<Map<string, ReplayEvent[]>>;
  /** The facade's `fetchReplay`. */
  readonly fetchReplay: (
    replayId: string,
    options?: WorkspaceFetchReplayOptions,
  ) => Promise<Replay>;
  /** The facade's `fetchReplays`. */
  readonly fetchReplays: (
    replayIds: readonly string[],
    options?: WorkspaceFetchReplaysOptions,
  ) => Promise<ReplayBundle>;
}

/** Signing environment default (`env="prod"`). */
const DEFAULT_REPLAY_ENV = "prod";

/** `max_files` default of the CDN walk (`fetch_replay(max_files=500)`). */
const DEFAULT_MAX_REPLAY_FILES = 500;

/** `cdn_concurrency` default — parallel CDN file fetches per replay. */
const DEFAULT_CDN_CONCURRENCY = 50;

/** `concurrency` default of `fetch_replays` — replays fetched at once. */
const DEFAULT_FETCH_REPLAYS_CONCURRENCY = 4;

/** `limit` default of `list_replays`. */
const DEFAULT_LIST_REPLAYS_LIMIT = 100;

/**
 * `limit` default of `replays_for_user` — conservative because each
 * replay materializes its full byte stream.
 */
const DEFAULT_REPLAYS_FOR_USER_LIMIT = 20;

/**
 * Retention window assumed when discovery returns no summary for a
 * replay (`_resolve_retention`'s fallback; the warning already fired in
 * `discover`).
 */
const FALLBACK_RETENTION_DAYS = 30;

/** Insights group-by cap that bounds `event_properties`. */
const MAX_EVENT_PROPERTIES = 5;

/**
 * List replays for a user, or hydrate summaries for explicit ids.
 *
 * @remarks
 * Exactly one of `distinct_id` or `replay_ids` must be provided; when
 * `distinct_id` is set, `from_date` and `to_date` are required too.
 * @param host - The facade slice.
 * @param options - The selector, the optional window, and the limit.
 * @returns `ReplaySummary` rows, possibly empty.
 * @throws {@link ParamValidationError} - Neither or both selectors
 *   (`WR4_REPLAY_SELECTOR_REQUIRED`), or `distinct_id` without a date
 *   window (`WR5_DATE_RANGE_REQUIRED`).
 * @throws {@link QueryError} - Underlying Insights API failure.
 * @example
 * ```typescript
 * const summaries = await ws.listReplays({
 *   distinct_id: "user-123",
 *   from_date: "2026-01-01",
 *   to_date: "2026-01-07",
 * });
 * ```
 * @see mixpanel_headless.workspace.Workspace.list_replays
 */
export async function listReplays(
  host: ReplayHost,
  options: WorkspaceListReplaysOptions = {},
): Promise<ReplaySummary[]> {
  const distinctId = options.distinct_id ?? null;
  const replayIds = options.replay_ids ?? null;
  const fromDate = options.from_date ?? null;
  const toDate = options.to_date ?? null;
  const limit = options.limit ?? DEFAULT_LIST_REPLAYS_LIMIT;

  // Guard order follows the Python source; Python's `not replay_ids` is
  // falsiness, so an empty list trips WR4 as well.
  const hasReplayIds = replayIds !== null && replayIds.length > 0;
  if (distinctId === null && !hasReplayIds) {
    throw new ParamValidationError(
      "list_replays requires exactly one of distinct_id or replay_ids.",
      "WR4_REPLAY_SELECTOR_REQUIRED",
    );
  }
  if (distinctId !== null && hasReplayIds) {
    throw new ParamValidationError(
      "list_replays requires exactly one of distinct_id or " +
        "replay_ids; both were given.",
      "WR4_REPLAY_SELECTOR_REQUIRED",
    );
  }
  if (distinctId !== null && (fromDate === null || toDate === null)) {
    throw new ParamValidationError(
      "list_replays(distinct_id=...) requires from_date and to_date.",
      "WR5_DATE_RANGE_REQUIRED",
    );
  }

  return host.replaysService().discover({
    distinctId,
    replayIds,
    fromDate,
    toDate,
    limit,
  });
}

/**
 * List the Mixpanel events that occurred during one replay's time
 * window.
 *
 * @param host - The facade slice.
 * @param replayId - The replay to fetch events for.
 * @param options - Extra group keys and the optional window.
 * @returns Ordered `ReplayEvent`s; empty when the window has none.
 * @throws {@link ParamValidationError} - More than 5 `event_properties`
 *   (`WR1_TOO_MANY_EVENT_PROPERTIES`).
 * @throws {@link QueryError} - Underlying Insights API failure.
 * @example
 * ```typescript
 * const events = await ws.eventsForReplay(replayId, {
 *   event_properties: ["$browser"],
 * });
 * ```
 * @see mixpanel_headless.workspace.Workspace.events_for_replay
 */
export async function eventsForReplay(
  host: ReplayHost,
  replayId: string,
  options: WorkspaceEventsForReplayOptions = {},
): Promise<ReplayEvent[]> {
  checkEventPropertiesCount(options.event_properties ?? null);
  const bundle = await host.replaysService().eventsFor([replayId], {
    eventProperties: options.event_properties ?? null,
    fromDate: options.from_date ?? null,
    toDate: options.to_date ?? null,
  });
  return bundle.get(replayId) ?? [];
}

/**
 * Fetch the events of several replays in a single round-trip — the
 * batched form of {@link eventsForReplay}.
 *
 * @param host - The facade slice.
 * @param replayIds - Replays to fetch events for.
 * @param options - Extra group keys and the optional window.
 * @returns A `Map` from `replay_id` to its ordered `ReplayEvent` list;
 *   replays with no events are omitted.
 * @throws {@link ParamValidationError} - More than 5 `event_properties`
 *   (`WR1_TOO_MANY_EVENT_PROPERTIES`).
 * @throws {@link QueryError} - Underlying Insights API failure.
 * @example
 * ```typescript
 * const byReplay = await ws.eventsForReplays([idA, idB]);
 * byReplay.get(idA)?.length;
 * ```
 * @see mixpanel_headless.workspace.Workspace.events_for_replays
 */
export async function eventsForReplays(
  host: ReplayHost,
  replayIds: readonly string[],
  options: WorkspaceEventsForReplayOptions = {},
): Promise<Map<string, ReplayEvent[]>> {
  checkEventPropertiesCount(options.event_properties ?? null);
  return host.replaysService().eventsFor(replayIds, {
    eventProperties: options.event_properties ?? null,
    fromDate: options.from_date ?? null,
    toDate: options.to_date ?? null,
  });
}

/**
 * Sign a single replay id; sugar over {@link signReplays}.
 *
 * @param host - The facade slice.
 * @param replayId - Replay to sign.
 * @param options - `env` (default `"prod"`).
 * @returns One `SignedReplay`. `query_string` is a 5-minute bearer
 *   credential — treat it like a session token.
 * @throws {@link SessionReplayAccessError} - Sensitive-data flag set.
 * @throws {@link QueryError} | {@link ServerError} - Other 4xx / 5xx.
 * @example
 * ```typescript
 * const signed = await ws.signReplay(replayId);
 * signed.query_string; // short-lived credential
 * ```
 * @see mixpanel_headless.workspace.Workspace.sign_replay
 */
export async function signReplay(
  host: ReplayHost,
  replayId: string,
  options: WorkspaceSignReplayOptions = {},
): Promise<SignedReplay> {
  const signed = await host
    .replaysService()
    .sign([replayId], options.env ?? DEFAULT_REPLAY_ENV);
  return signed[0] as SignedReplay;
}

/**
 * Sign multiple replays via the bulk endpoint.
 *
 * @param host - The facade slice.
 * @param replayIds - Replays to sign.
 * @param options - `env` (default `"prod"`).
 * @returns `SignedReplay`s in input order.
 * @throws {@link SessionReplayAccessError} - Sensitive-data flag set.
 * @throws {@link QueryError} | {@link ServerError} - Other 4xx / 5xx.
 * @example
 * ```typescript
 * const signed = await ws.signReplays([idA, idB], { env: "prod" });
 * ```
 * @see mixpanel_headless.workspace.Workspace.sign_replays
 */
export async function signReplays(
  host: ReplayHost,
  replayIds: readonly string[],
  options: WorkspaceSignReplayOptions = {},
): Promise<SignedReplay[]> {
  return host
    .replaysService()
    .sign(replayIds, options.env ?? DEFAULT_REPLAY_ENV);
}

/**
 * Sign, fetch, and assemble a single `Replay`.
 *
 * @remarks
 * Runs the vendored rrweb analyzer to populate `Replay.actions`; the raw
 * `rrweb_events` list is also populated for downstream tools. Python's
 * event-loop caveat (`asyncio.run` cannot run inside a running loop) has
 * no TS twin — this member is `async` and composes naturally; the Python
 * docstring's guidance to drive `walk_cdn_async` directly maps to
 * {@link ReplaysService.walkCdnAsync}, which is public here too.
 * @param host - The facade slice.
 * @param replayId - The replay to fetch.
 * @param options - Retention / bounds / concurrency / join knobs.
 * @returns A `Replay` with `rrweb_events` and `actions` populated.
 * @throws {@link ReplayNotFoundError} - First CDN file 404'd, or the walk
 *   yielded zero events.
 * @throws {@link SessionReplayAccessError} - Sensitive-data flag set.
 * @throws {@link SignedURLExpiredError} - Signed URL expired during fetch.
 * @throws {@link ParamValidationError} - More than 5 `event_properties`.
 * @example
 * ```typescript
 * const replay = await ws.fetchReplay(replayId, {
 *   include_mixpanel_events: true,
 * });
 * replay.actions.length;
 * ```
 * @see mixpanel_headless.workspace.Workspace.fetch_replay
 */
export async function fetchReplay(
  host: ReplayHost,
  replayId: string,
  options: WorkspaceFetchReplayOptions = {},
): Promise<Replay> {
  checkEventPropertiesCount(options.event_properties ?? null);
  const env = options.env ?? DEFAULT_REPLAY_ENV;
  const resolvedRetention = await resolveRetention(
    host,
    replayId,
    options.retention_days ?? null,
  );
  const signed = (await host.replaysService().sign([replayId], env))[0];
  const rrwebEvents = await host
    .replaysService()
    .fetchFiles(signed as SignedReplay, {
      retentionDays: resolvedRetention,
      maxFiles: options.max_files ?? DEFAULT_MAX_REPLAY_FILES,
      concurrency: options.cdn_concurrency ?? DEFAULT_CDN_CONCURRENCY,
    });
  if (rrwebEvents.length === 0) {
    throw replayNotFoundError(replayId, {
      retentionDays: resolvedRetention,
      cdnUrlPrefix: (signed as SignedReplay).url,
    });
  }

  // Derive the window from min/max rather than first/last:
  // `walkCdnAsync` yields in (file-number, in-file timestamp) order
  // with no global merge, so indexing [0]/[-1] would drift if CDN
  // files ever overlap in time.
  // Python reads `int(ev["timestamp"])` — a subscript, so a missing key
  // is a KeyError, not the `int()` ladder's TypeError.
  const eventTimestamps = rrwebEvents.map((ev) => {
    if (!Object.hasOwn(ev, "timestamp")) {
      throw new KeyError("timestamp");
    }
    return pythonIntCoerce(ev["timestamp"]);
  });
  const startTime = Math.min(...eventTimestamps);
  const endTime = Math.max(...eventTimestamps);

  let mixpanelEvents: ReplayEvent[] = [];
  if (options.include_mixpanel_events === true) {
    // Scope the events scan to the replay's own day(s).
    const winFrom = utcYmdFromEpochMs(startTime);
    const winTo = utcYmdFromEpochMs(endTime);
    mixpanelEvents = await host.eventsForReplay(replayId, {
      event_properties: options.event_properties ?? null,
      from_date: winFrom,
      to_date: winTo,
    });
  }

  // Run the rrweb analyzer to populate actions.
  const analyzerResult = new RrwebAnalyzer().analyze(rrwebEvents);
  return new Replay({
    replay_id: replayId,
    distinct_id: options.distinct_id ?? null,
    project_id: host.projectId(),
    start_time: startTime,
    end_time: endTime,
    retention_days: resolvedRetention,
    rrweb_events: rrwebEvents,
    actions: [...analyzerResult.actions],
    mixpanel_events: mixpanelEvents,
  });
}

/**
 * Yield raw rrweb events one at a time, batched-parallel under the
 * hood.
 *
 * @remarks
 * Item-level `yield*` over the service generator; nothing buffers.
 * Python's private-event-loop plumbing (`asyncio.new_event_loop` +
 * `run_until_complete(gen.__anext__())`) has no TS twin: the async
 * generator composes directly, and the `finally: gen.aclose()` contract
 * is what `for await` + `AsyncGenerator.return()` already guarantee.
 * @param host - The facade slice.
 * @param replayId - The replay to stream.
 * @param options - Retention / bounds / concurrency / re-sign policy.
 * @yields Raw rrweb event dicts in timestamp order.
 * @throws {@link ReplayNotFoundError} - First CDN file 404'd.
 * @throws {@link SignedURLExpiredError} - Re-sign retry exhausted or
 *   disabled.
 * @throws {@link SessionReplayAccessError} - Sensitive-data flag set.
 * @example
 * ```typescript
 * for await (const event of ws.streamReplay(replayId)) {
 *   if (event["type"] === 3) count += 1;
 * }
 * ```
 * @see mixpanel_headless.workspace.Workspace.stream_replay
 */
export async function* streamReplay(
  host: ReplayHost,
  replayId: string,
  options: WorkspaceStreamReplayOptions = {},
): AsyncGenerator<Readonly<Record<string, unknown>>, void, undefined> {
  const resolvedRetention = await resolveRetention(
    host,
    replayId,
    options.retention_days ?? null,
  );
  const signed = (
    await host
      .replaysService()
      .sign([replayId], options.env ?? DEFAULT_REPLAY_ENV)
  )[0];
  yield* host.replaysService().walkCdnAsync(signed as SignedReplay, {
    retentionDays: resolvedRetention,
    maxFiles: options.max_files ?? DEFAULT_MAX_REPLAY_FILES,
    concurrency: options.cdn_concurrency ?? DEFAULT_CDN_CONCURRENCY,
    reSignOnExpiry: options.re_sign_on_expiry ?? true,
  });
}

/**
 * Fetch several replays in parallel and return them as a `ReplayBundle`.
 *
 * @remarks
 * Materializes each replay via {@link fetchReplay} and bundles them.
 * Outer `concurrency` parallelizes across replays; inner
 * `cdn_concurrency` parallelizes each replay's CDN file walk. Python
 * uses a `ThreadPoolExecutor` purely so each replay's `asyncio.run` gets
 * its own event loop — the port needs no such isolation, so the outer
 * level is bounded-concurrency promise scheduling with the same worker
 * cap, the same input-order output and the same per-replay failure
 * isolation: a replay that 404s, stalls or fails to parse is logged and
 * skipped; only an all-fail batch throws (the first underlying error,
 * preserving its type).
 * @param host - The facade slice.
 * @param replayIds - Replays to fetch.
 * @param options - Env / bounds / concurrency / join / retention and
 *   distinct-id maps.
 * @returns A `ReplayBundle` with `replays` in input order; the failed
 *   replays are omitted from `replays` and listed on `failures`.
 * @throws {@link MixpanelHeadlessError} - Only when every requested replay
 *   failed; the first underlying error propagates with its type.
 * @throws {@link ParamValidationError} - More than 5 `event_properties`.
 * @example
 * ```typescript
 * const bundle = await ws.fetchReplays([idA, idB], { concurrency: 2 });
 * bundle.replays.length; // successes, in input order
 * bundle.failures;       // the skipped ones
 * ```
 * @see mixpanel_headless.workspace.Workspace.fetch_replays
 */
export async function fetchReplays(
  host: ReplayHost,
  replayIds: readonly string[],
  options: WorkspaceFetchReplaysOptions = {},
): Promise<ReplayBundle> {
  checkEventPropertiesCount(options.event_properties ?? null);
  const retentionMap = options.retention_by_id ?? new Map<string, number>();
  const distinctMap = options.distinct_id_by_id ?? new Map<string, string>();
  const concurrency = Math.max(
    1,
    options.concurrency ?? DEFAULT_FETCH_REPLAYS_CONCURRENCY,
  );

  // Events are joined once after assembly (below), not per replay — so
  // each fetch runs with include_mixpanel_events=false here regardless
  // of the caller's flag.
  const results = new Map<number, Replay>();
  // Completion-ordered (workers push as they fail); the bundle gets
  // them re-sorted into input order.
  const failures: Array<[index: number, failure: ReplayFetchFailure]> = [];
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= replayIds.length) {
        return;
      }
      const rid = replayIds[index] as string;
      try {
        results.set(
          index,
          await host.fetchReplay(rid, {
            distinct_id: mapGet(distinctMap, rid) ?? null,
            env: options.env ?? DEFAULT_REPLAY_ENV,
            retention_days: mapGet(retentionMap, rid) ?? null,
            max_files: options.max_files ?? DEFAULT_MAX_REPLAY_FILES,
            include_mixpanel_events: false,
            cdn_concurrency: options.cdn_concurrency ?? DEFAULT_CDN_CONCURRENCY,
          }),
        );
      } catch (error) {
        // One replay's CDN stall, 404, or parse error must not sink
        // the whole bundle. Log it and keep the successful replays;
        // only an all-fail batch raises.
        host.logger.warning(
          `fetch_replays: skipping replay ${rid} — ` +
            `${error instanceof Error ? error.name : typeof error}: ${String(error)}`,
        );
        failures.push([index, { replay_id: rid, error: toError(error) }]);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, replayIds.length) }, () =>
      worker(),
    ),
  );
  const firstFailure = failures[0];
  if (results.size === 0 && firstFailure !== undefined) {
    // Every replay failed — surface the first underlying error rather
    // than a generic wrapper, preserving its type for callers that
    // branch on it. `failures` is completion-ordered here (the workers
    // push as they fail), the same reading as Python's `as_completed`
    // loop; only the bundle's `failures` list below is re-sorted into
    // input order.
    throw firstFailure[1].error;
  }
  let ordered = [...results]
    .sort((a, b) => a[0] - b[0])
    .map(([, replay]) => replay);

  // Join Mixpanel events in one query across all replays (the
  // per-replay alternative fans out N queries and exhausts the
  // Insights rate limit). The combined window spans the earliest
  // start to the latest end.
  if (options.include_mixpanel_events === true && ordered.length > 0) {
    const winFrom = utcYmdFromEpochMs(
      Math.min(...ordered.map((r) => r.start_time)),
    );
    const winTo = utcYmdFromEpochMs(
      Math.max(...ordered.map((r) => r.end_time)),
    );
    const eventsByReplay = await host.eventsForReplays(
      ordered.map((r) => r.replay_id),
      {
        event_properties: options.event_properties ?? null,
        from_date: winFrom,
        to_date: winTo,
      },
    );
    ordered = ordered.map((r) =>
      eventsByReplay.has(r.replay_id)
        ? replaceReplayEvents(
            r,
            eventsByReplay.get(r.replay_id) as ReplayEvent[],
          )
        : r,
    );
  }
  return new ReplayBundle({
    replays: ordered,
    computed_at: isoUtc(host.client.core.now()),
    project_id: host.projectId(),
    // Divergence: Python only logs the skipped replays; the TS bundle
    // also records them (`ReplayBundle.failures`, additive).
    failures: [...failures]
      .sort((a, b) => a[0] - b[0])
      .map(([, failure]) => failure),
  });
}

/**
 * Discover and fetch a user's replays in one call.
 *
 * @remarks
 * Composes {@link listReplays} and {@link fetchReplays}. Defaults
 * `include_mixpanel_events` to `true` since this is the "show me what
 * this user did" convenience method. The default `limit` is a
 * conservative 20 — each replay materializes its full byte stream.
 * @param host - The facade slice.
 * @param distinctId - Mixpanel user identifier.
 * @param options - The required window plus the limit / join knobs.
 * @returns A `ReplayBundle`; empty when no replays exist in the
 *   window.
 * @throws {@link ParamValidationError} - More than 5 `event_properties`.
 * @example
 * ```typescript
 * const bundle = await ws.replaysForUser("user-123", {
 *   from_date: "2026-01-01",
 *   to_date: "2026-01-07",
 *   limit: 5,
 * });
 * ```
 * @see mixpanel_headless.workspace.Workspace.replays_for_user
 */
export async function replaysForUser(
  host: ReplayHost,
  distinctId: string,
  options: WorkspaceReplaysForUserOptions,
): Promise<ReplayBundle> {
  checkEventPropertiesCount(options.event_properties ?? null);
  const summaries = await host.listReplays({
    distinct_id: distinctId,
    from_date: options.from_date,
    to_date: options.to_date,
    limit: options.limit ?? DEFAULT_REPLAYS_FOR_USER_LIMIT,
  });
  if (summaries.length === 0) {
    return new ReplayBundle({
      replays: [],
      computed_at: isoUtc(host.client.core.now()),
      project_id: host.projectId(),
    });
  }
  return host.fetchReplays(
    summaries.map((s) => s.replay_id),
    {
      include_mixpanel_events: options.include_mixpanel_events ?? true,
      event_properties: options.event_properties ?? null,
      // We already discovered each replay's retention above — pass it
      // through so fetchReplay skips re-discovering it per replay.
      retention_by_id: new Map(
        summaries.map((s) => [s.replay_id, s.retention_days]),
      ),
      // Every replay was discovered for this user — stamp it.
      distinct_id_by_id: new Map(
        summaries.map((s) => [s.replay_id, distinctId]),
      ),
    },
  );
}

/**
 * Sign + fetch + analyze a replay, returning only the markdown
 * timeline.
 *
 * @param host - The facade slice.
 * @param replayId - The replay to analyze.
 * @returns The markdown timeline (`Replay.summaryMarkdown()`).
 * @throws {@link ReplayNotFoundError} - First CDN file 404'd.
 * @throws {@link SessionReplayAccessError} - Sensitive-data flag set.
 * @example
 * ```typescript
 * console.log(await ws.analyzeReplay(replayId));
 * ```
 * @see mixpanel_headless.workspace.Workspace.analyze_replay
 */
export async function analyzeReplay(
  host: ReplayHost,
  replayId: string,
): Promise<string> {
  return (await host.fetchReplay(replayId)).summaryMarkdown();
}

/**
 * Resolve a replay's retention window, discovering it when `null`.
 *
 * @param host - The facade slice.
 * @param replayId - The replay to look up.
 * @param retentionDays - Caller-provided value; pass-through when
 *   set.
 * @returns One of 1, 7, 30, or 90. Defaults to 30 when discovery
 *   returns no summary (the warning already fired in `discover`).
 * @see mixpanel_headless.workspace.Workspace._resolve_retention
 */
async function resolveRetention(
  host: ReplayHost,
  replayId: string,
  retentionDays: number | null,
): Promise<number> {
  if (retentionDays !== null) {
    return retentionDays;
  }
  const summaries = await host.listReplays({ replay_ids: [replayId] });
  if (summaries.length > 0) {
    return (summaries[0] as ReplaySummary).retention_days;
  }
  return FALLBACK_RETENTION_DAYS;
}

/**
 * Reject an `event_properties` list longer than the Insights group-by
 * cap ({@link MAX_EVENT_PROPERTIES}); every session-replay surface passes
 * through to that endpoint.
 *
 * @param eventProperties - Caller-supplied list (or `null`).
 * @throws {@link ParamValidationError} - Code `WR1_TOO_MANY_EVENT_PROPERTIES`.
 * @example
 * ```typescript
 * checkEventPropertiesCount(["$browser", "$os"]); // passes
 * ```
 * @see mixpanel_headless.workspace._check_event_properties_count
 */
export function checkEventPropertiesCount(
  eventProperties: readonly string[] | null,
): void {
  if (
    eventProperties !== null &&
    eventProperties.length > MAX_EVENT_PROPERTIES
  ) {
    throw new ParamValidationError(
      `events_for_replay accepts at most ${String(MAX_EVENT_PROPERTIES)} event_properties ` +
        `(Insights group-by limit). Got ${String(eventProperties.length)}: ${pythonRepr(
          eventProperties,
        )}`,
      "WR1_TOO_MANY_EVENT_PROPERTIES",
    );
  }
}

/**
 * Format Unix milliseconds as a `YYYY-MM-DD` UTC date — Python's
 * `datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y-%m-%d")`
 * at the two window-derivation sites in `fetch_replay` / `fetch_replays`.
 *
 * @param epochMs - Unix milliseconds.
 * @returns The `YYYY-MM-DD` UTC date.
 */
function utcYmdFromEpochMs(epochMs: number): string {
  const date = new Date(epochMs);
  return [
    zfill(String(date.getUTCFullYear()), 4),
    zfill(String(date.getUTCMonth() + 1), 2),
    zfill(String(date.getUTCDate()), 2),
  ].join("-");
}

/**
 * Copy a replay with its Mixpanel events attached — Python's
 * `dataclasses.replace(replay, mixpanel_events=...)` in `fetch_replays`.
 *
 * @param replay - The replay to copy.
 * @param mixpanelEvents - The events to attach.
 * @returns A new `Replay` with the events attached.
 */
function replaceReplayEvents(
  replay: Replay,
  mixpanelEvents: readonly ReplayEvent[],
): Replay {
  return new Replay({
    replay_id: replay.replay_id,
    distinct_id: replay.distinct_id,
    project_id: replay.project_id,
    start_time: replay.start_time,
    end_time: replay.end_time,
    retention_days: replay.retention_days,
    rrweb_events: replay.rrweb_events,
    actions: replay.actions,
    mixpanel_events: mixpanelEvents,
  });
}

/**
 * Read a key from the optional retention / distinct-id maps, which
 * callers may hand in as a `Map` or a plain record (`Mapping.get`).
 *
 * @param source - The map or record.
 * @param key - The replay id.
 * @returns The value, or `undefined`.
 */
function mapGet<T>(
  source: ReadonlyMap<string, T> | Readonly<Record<string, T>>,
  key: string,
): T | undefined {
  if (source instanceof Map) {
    // Declared type, not the `instanceof` intersection (whose `Map<any,
    // any>` half would make `get` return `any`).
    const map: ReadonlyMap<string, T> = source;
    return map.get(key);
  }
  const record = source as Readonly<Record<string, T>>;
  return Object.hasOwn(record, key) ? record[key] : undefined;
}
