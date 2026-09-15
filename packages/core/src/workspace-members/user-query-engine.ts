/**
 * The Engage execution engines behind `Workspace.queryUser` /
 * `Workspace.runUserParams` — `_execute_user_query_sequential`,
 * `_execute_user_aggregate` and `_execute_user_query_parallel`
 * (`mixpanel_headless.workspace.Workspace`), as functions over the facade
 * slice they read ({@link UserQueryHost}). The facade keeps the public
 * members and their validation; everything after "the params are valid"
 * lives here.
 */

import type { MixpanelClient } from "../client/client.js";
import { toNativeJson } from "../client/json-value.js";
import {
  AuthenticationError,
  QueryError,
  RateLimitError,
  ServerError,
} from "../errors.js";
import { transformProfile } from "../query/transforms.js";
import { isoUtc } from "../services/discovery.js";
import type { ProfilePageResult } from "../types/results/discovery.js";
import { UserQueryResult } from "../types/results/query-engine.js";
import {
  buildPageKwargs,
  buildStatsKwargs,
  type ParamsDict,
} from "../workspace-query-params.js";
import type {
  ResolvedWorkspaceLogger,
  WorkspaceRunUserParamsOptions,
} from "./options.js";

/** The facade slice the engines read. */
export interface UserQueryHost {
  /** The bound wire client (`self._api_client`). */
  readonly client: MixpanelClient;
  /** The log seam (`logger.warning` / `logger.debug`). */
  readonly logger: ResolvedWorkspaceLogger;
}

/**
 * `workers` default of `query_user` / `run_user_params`
 * (`Workspace.query_user(workers=5)`).
 */
export const DEFAULT_USER_QUERY_WORKERS = 5;

/**
 * Cap on concurrent page fetches — Python's
 * `ThreadPoolExecutor(max_workers=min(workers, 5))`; the U23 validator
 * rejects larger requests before the engine runs.
 */
export const MAX_PARALLEL_WORKERS = 5;

/**
 * Page count above which the parallel engine warns: the engage API
 * allows roughly 60 queries per hour, so a query that needs more than
 * this many pages is likely to be rate limited.
 */
export const RATE_LIMIT_PAGE_WARNING_THRESHOLD = 48;

/**
 * Page size assumed when page 0 reports none — Python's
 * `page0.page_size or 1000`.
 */
export const FALLBACK_ENGAGE_PAGE_SIZE = 1000;

/** `[profiles, total, computed_at, meta]` — what a profiles engine returns. */
type ProfilesEngineResult = [
  Array<Record<string, unknown>>,
  number,
  string,
  ParamsDict,
];

/**
 * Run pre-built Engage API params: the body of `run_user_params`
 * (`Workspace.run_user_params`). A dict that carries an aggregate
 * `action` key runs as an aggregate query; any other dict runs as a
 * profiles query, sequentially or in parallel.
 *
 * @param host - The facade slice.
 * @param params - Engage API params dict, normally from `buildUserParams`.
 * @param options - `limit` (default `1`; `null` fetches all), `parallel`
 *   (default `false`) and `workers` (default
 *   {@link DEFAULT_USER_QUERY_WORKERS}).
 * @returns Profiles/aggregate payload with metadata.
 * @throws AuthenticationError | QueryError | RateLimitError |
 *   ServerError - Wire failures.
 */
export async function runUserParams(
  host: UserQueryHost,
  params: ParamsDict,
  options: WorkspaceRunUserParamsOptions = {},
): Promise<UserQueryResult> {
  const limit = options.limit === undefined ? 1 : options.limit;
  const parallel = options.parallel ?? false;
  const workers = options.workers ?? DEFAULT_USER_QUERY_WORKERS;

  if (Object.hasOwn(params, "action")) {
    const [aggregateData, aggregateTotal, aggregateComputedAt, aggregateMeta] =
      await executeUserAggregate(host, params);
    return new UserQueryResult({
      computed_at: aggregateComputedAt,
      total: aggregateTotal,
      profiles: [],
      params,
      meta: aggregateMeta,
      mode: "aggregate",
      aggregate_data: aggregateData,
    });
  }

  // Profiles mode — choose sequential or parallel
  let profiles: Array<Record<string, unknown>>;
  let total: number;
  let computedAt: string;
  let meta: Record<string, unknown>;
  if (parallel && limit !== 1) {
    [profiles, total, computedAt, meta] = await executeUserQueryParallel(
      host,
      params,
      limit,
      workers,
    );
  } else {
    if (parallel && limit === 1) {
      host.logger.debug("parallel=True ignored: limit=1 uses sequential path");
    }
    [profiles, total, computedAt, meta] = await executeUserQuerySequential(
      host,
      params,
      limit,
    );
  }

  return new UserQueryResult({
    computed_at: computedAt,
    total,
    profiles,
    params,
    meta,
    mode: "profiles",
    aggregate_data: null,
  });
}

/**
 * Execute a user profile query with sequential page fetching
 * (`Workspace._execute_user_query_sequential`).
 *
 * @param host - The facade slice.
 * @param params - Engage params from the resolver.
 * @param limit - Maximum profiles to collect (`null` = all).
 * @returns `[profiles, total, computed_at, meta]`.
 * @throws AuthenticationError | RateLimitError | QueryError |
 *   ServerError - Wire failures.
 */
export async function executeUserQuerySequential(
  host: UserQueryHost,
  params: ParamsDict,
  limit: number | null,
): Promise<ProfilesEngineResult> {
  // Reuse buildPageKwargs for params→kwargs translation; pass the
  // limit server-side for efficient fetching. `total` is
  // `len(profiles)` — the count in THIS response, not the API's
  // population total (use mode="aggregate" for that).
  const apiKwargs = buildPageKwargs(params);
  apiKwargs["limit"] = limit;

  let result = await exportPage(host.client, 0, apiKwargs);
  let profiles: Array<Record<string, unknown>> = result.profiles.map((p) =>
    transformProfile(p),
  );
  const sessionId = result.session_id;
  let pagesFetched = 1;

  // Check if we already have enough
  if (limit !== null && profiles.length >= limit) {
    profiles = profiles.slice(0, limit);
  } else if (result.has_more && result.profiles.length > 0) {
    // Paginate for more (guard: stop if a page returns no profiles)
    let currentPage = 0;
    while (result.has_more) {
      if (limit !== null && profiles.length >= limit) {
        break;
      }
      currentPage += 1;
      result = await exportPage(host.client, currentPage, {
        ...apiKwargs,
        session_id: sessionId,
      });
      if (result.profiles.length === 0) {
        break;
      }
      for (const p of result.profiles) {
        profiles.push(transformProfile(p));
      }
      pagesFetched += 1;
    }

    // Python `profiles[:None]` returns everything (limit=None case).
    profiles = limit === null ? profiles : profiles.slice(0, limit);
  }

  const computedAt = isoUtc(host.client.core.now());
  const meta: ParamsDict = {
    session_id: sessionId,
    pages_fetched: pagesFetched,
    parallel: false,
  };

  return [profiles, profiles.length, computedAt, meta];
}

/**
 * Execute an aggregate query via the Engage stats endpoint
 * (`Workspace._execute_user_aggregate`).
 *
 * @param host - The facade slice.
 * @param params - Engage params from the resolver.
 * @returns `[aggregate_data, total, computed_at, meta]`.
 * @throws AuthenticationError | RateLimitError | QueryError |
 *   ServerError - Wire failures.
 */
export async function executeUserAggregate(
  host: UserQueryHost,
  params: ParamsDict,
): Promise<
  [
    Readonly<Record<string, unknown>> | number | null,
    number,
    string,
    ParamsDict,
  ]
> {
  // The kwargs block is the exported `buildStatsKwargs` (the `self`-free
  // half of the Python method, lifted so tests can reach it).
  const statsKwargs = buildStatsKwargs(params);

  // The engage-stats body is read with plain `dict.get` in Python, so it
  // is viewed as the native tree `json.loads` would produce.
  const body = toNativeJson(
    await host.client.engageStats(statsKwargs),
  ) as Record<string, unknown>;

  const aggregateData = Object.hasOwn(body, "results")
    ? body["results"]
    : undefined;
  const computedAt = Object.hasOwn(body, "computed_at")
    ? (body["computed_at"] as string)
    : isoUtc(host.client.core.now());
  let total: number;
  if (typeof aggregateData === "number") {
    // Python: `int(aggregate_data)` — truncation toward zero.
    total = params["action"] === "count()" ? Math.trunc(aggregateData) : 0;
  } else {
    total = 0;
  }

  const action = Object.hasOwn(params, "action") ? params["action"] : "count()";
  const segmented = Object.hasOwn(params, "segment_by_cohorts");
  const meta: ParamsDict = { action, segmented };

  return [
    (aggregateData ?? null) as
      Readonly<Record<string, unknown>> | number | null,
    total,
    computedAt,
    meta,
  ];
}

/**
 * Fetch profiles with concurrent page retrieval
 * (`Workspace._execute_user_query_parallel`).
 *
 * Page 0 is fetched first for metadata, then pages `1..n-1` run under
 * a bounded scheduler with the SAME worker cap Python's
 * `ThreadPoolExecutor(max_workers=min(workers, 5))` applies. Results
 * are re-ordered by page number, failed pages are recorded rather
 * than aborting, and the four CODED wire errors abort the whole
 * query (Python cancels the queued futures and re-raises; the TS twin
 * stops scheduling and lets the in-flight pages settle, exactly as
 * `ThreadPoolExecutor.__exit__` does).
 *
 * @param host - The facade slice.
 * @param params - Engage params from the resolver.
 * @param limit - Maximum profiles to return (`null` = all).
 * @param workers - Requested worker count (capped at
 *   {@link MAX_PARALLEL_WORKERS}).
 * @returns `[profiles, total, computed_at, meta]`.
 * @throws AuthenticationError | RateLimitError | ServerError |
 *   QueryError - Propagated from any page.
 */
export async function executeUserQueryParallel(
  host: UserQueryHost,
  params: ParamsDict,
  limit: number | null,
  workers: number,
): Promise<ProfilesEngineResult> {
  const cappedWorkers = Math.min(workers, MAX_PARALLEL_WORKERS);
  const pageKwargs = buildPageKwargs(params);

  // Page 0: get metadata
  const page0 = await exportPage(host.client, 0, pageKwargs);
  const total = page0.total;
  // Python `page0.page_size or 1000` — 0/None fall back.
  const pageSize = page0.page_size || FALLBACK_ENGAGE_PAGE_SIZE;
  const sessionId = page0.session_id;
  const computedAt = isoUtc(host.client.core.now());

  let allProfiles: Array<Record<string, unknown>> = page0.profiles.map((p) =>
    transformProfile(p),
  );

  let pagesNeeded: number;
  if (limit === null) {
    pagesNeeded = Math.ceil(total / pageSize);
  } else {
    // Cap by total to avoid fetching empty pages when limit > total
    const effective = total > 0 ? Math.min(limit, total) : limit;
    pagesNeeded = Math.ceil(effective / pageSize);
  }

  // Single page — skip parallel overhead
  if (pagesNeeded <= 1 || !page0.has_more) {
    allProfiles = limit === null ? allProfiles : allProfiles.slice(0, limit);
    return [
      allProfiles,
      allProfiles.length,
      computedAt,
      {
        session_id: sessionId,
        pages_fetched: 1,
        failed_pages: [],
        parallel: true,
        workers: cappedWorkers,
      },
    ];
  }

  if (pagesNeeded > RATE_LIMIT_PAGE_WARNING_THRESHOLD) {
    host.logger.warning(
      `Fetching ${pagesNeeded} pages may trigger rate limiting ` +
        "(engage API allows ~60 queries/hour).",
    );
  }

  const failedPages: number[] = [];
  const pageResults = new Map<number, Array<Record<string, unknown>>>();

  /**
   * Fetch and normalize a single page (`_fetch_page`).
   *
   * @param pageNum - The page index.
   * @returns The page number and its normalized profiles.
   */
  const fetchPage = async (
    pageNum: number,
  ): Promise<[number, Array<Record<string, unknown>>]> => {
    const result = await exportPage(host.client, pageNum, {
      ...pageKwargs,
      session_id: sessionId,
    });
    return [pageNum, result.profiles.map((p) => transformProfile(p))];
  };

  // Bounded-concurrency scheduler: the TS twin of
  // `ThreadPoolExecutor(max_workers=capped)` + `as_completed`.
  let next = 1;
  // Boxed rather than a bare `let`: the workers assign it inside a
  // closure, which TS's flow analysis does not track for a local.
  const abort: {
    error:
      AuthenticationError | RateLimitError | ServerError | QueryError | null;
  } = { error: null };
  const runWorker = async (): Promise<void> => {
    for (;;) {
      if (abort.error !== null) {
        return;
      }
      const pageNum = next;
      if (pageNum >= pagesNeeded) {
        return;
      }
      next += 1;
      try {
        const [pnum, profiles] = await fetchPage(pageNum);
        pageResults.set(pnum, profiles);
      } catch (error) {
        if (
          error instanceof AuthenticationError ||
          error instanceof RateLimitError ||
          error instanceof ServerError ||
          error instanceof QueryError
        ) {
          // Python cancels the queued futures and re-raises out of
          // the `with` block (running futures still finish).
          abort.error = error;
          return;
        }
        host.logger.warning(
          `Failed to fetch page ${pageNum} (${
            error instanceof Error ? error.constructor.name : typeof error
          }: ${String(error)}), continuing with partial results`,
        );
        failedPages.push(pageNum);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(cappedWorkers, pagesNeeded - 1) }, () =>
      runWorker(),
    ),
  );
  if (abort.error !== null) {
    throw abort.error;
  }

  for (const [, profiles] of [...pageResults].sort((a, b) => a[0] - b[0])) {
    allProfiles.push(...profiles);
  }

  allProfiles = limit === null ? allProfiles : allProfiles.slice(0, limit);

  return [
    allProfiles,
    allProfiles.length,
    computedAt,
    {
      session_id: sessionId,
      pages_fetched: pagesNeeded - failedPages.length,
      failed_pages: [...failedPages].sort((a, b) => a - b),
      parallel: true,
      workers: cappedWorkers,
    },
  ];
}

/**
 * `api_client.export_profiles_page(page=..., **kwargs)` with the
 * dynamic kwargs bag the two engines build.
 *
 * @param client - The wire client.
 * @param page - Zero-based page index.
 * @param kwargs - The dynamic options bag.
 * @returns The page result.
 * @throws AuthenticationError | RateLimitError | QueryError |
 *   ServerError - Wire failures.
 */
function exportPage(
  client: MixpanelClient,
  page: number,
  kwargs: Readonly<Record<string, unknown>>,
): Promise<ProfilePageResult> {
  return client.exportProfilesPage(page, kwargs);
}
