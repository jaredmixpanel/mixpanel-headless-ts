// Shared helpers for the B5-S2 `Workspace` Layer-3 translations: the
// `_TEST_SESSION` mirror the query-user test files declare, and a
// `MagicMock(spec=MixpanelAPIClient)` twin — a stub carrying only the
// client members the facade touches, plus per-member call logs.
//
// The Python files wrap every body in `try: ... finally: ws.close()`.
// `Workspace.close()` is a B6-W1 stub in TS (it throws
// `UNPORTED_MEMBER`) and the TS client owns no connection pool that
// needs releasing (R6.2), so the translations DROP the `finally` and
// record the omission here rather than in every file.

import type { Session } from "../src/auth/session.js";
import type { MixpanelClient } from "../src/client/client.js";
import type { JsonValue } from "../src/client/json-value.js";
import { Secret } from "../src/secret.js";
import { ProfilePageResult } from "../src/types/results/discovery.js";
import type { WorkspaceLogger } from "../src/workspace.js";

/**
 * The canonical fake Session the query-user test modules declare
 * (`_TEST_SESSION`, e.g. test_workspace_query_user_parallel.py:41-51).
 */
export const TEST_SESSION: Session = {
  account: {
    type: "service_account",
    name: "test_account",
    region: "us",
    username: "test_user",
    secret: new Secret("test_secret"),
    default_project: "12345",
  },
  project: { id: "12345" },
  workspace: null,
  headers: new Map<string, string>(),
};

/** One recorded `exportProfilesPage` call. */
export interface ExportPageCall {
  /** The zero-based page index. */
  readonly page: number;
  /** The options bag (Python's kwargs). */
  readonly options: Record<string, unknown>;
}

/** A page handler: returns the page result or throws. */
export type PageHandler = (
  page: number,
  options: Record<string, unknown>,
) => ProfilePageResult;

/** The `MagicMock(spec=MixpanelAPIClient)` twin. */
export interface MockWorkspaceClient {
  /** The stub cast to the client type the facade consumes. */
  readonly client: MixpanelClient;
  /** Every `exportProfilesPage` call, in order. */
  readonly exportPageCalls: ExportPageCall[];
  /** Every `engageStats` options bag, in order. */
  readonly engageStatsCalls: Array<Record<string, unknown>>;
  /** Every `insightsQuery` body, in order. */
  readonly insightsCalls: Array<Record<string, unknown>>;
  /** Every `arbFunnelsQuery` body, in order. */
  readonly arbFunnelsCalls: Array<Record<string, unknown>>;
  /**
   * Every `insightsQuery` options bag (Python's `workspace_id` /
   * `inject_workspace_id` kwargs), in order — parallel to
   * {@link insightsCalls}.
   */
  readonly insightsOptions: Array<Record<string, unknown> | undefined>;
  /**
   * Every `arbFunnelsQuery` options bag, in order — parallel to
   * {@link arbFunnelsCalls}.
   */
  readonly arbFunnelsOptions: Array<Record<string, unknown> | undefined>;
  /** Install the `export_profiles_page` behaviour. */
  setPageHandler: (handler: PageHandler) => void;
  /** Install a fixed `engage_stats` response. */
  setEngageStats: (value: unknown) => void;
  /** Install a fixed `insights_query` response. */
  setInsightsResponse: (value: unknown) => void;
  /** Install a fixed `arb_funnels_query` response. */
  setArbFunnelsResponse: (value: unknown) => void;
}

/**
 * Build a `MagicMock(spec=MixpanelAPIClient)` twin.
 *
 * The stub also carries the `core.now()` clock seam the facade reads
 * for `computed_at`; it is pinned to a fixed instant so the timestamps
 * are deterministic (packet §0.4).
 *
 * @param now - The pinned clock reading (default 2025-01-15T10:00:00Z).
 * @returns The stub client plus its call logs.
 */
export function mockWorkspaceClient(
  now: Date = new Date("2025-01-15T10:00:00.000Z"),
): MockWorkspaceClient {
  const exportPageCalls: ExportPageCall[] = [];
  const engageStatsCalls: Array<Record<string, unknown>> = [];
  const insightsCalls: Array<Record<string, unknown>> = [];
  const arbFunnelsCalls: Array<Record<string, unknown>> = [];
  const insightsOptions: Array<Record<string, unknown> | undefined> = [];
  const arbFunnelsOptions: Array<Record<string, unknown> | undefined> = [];
  let pageHandler: PageHandler = () =>
    new ProfilePageResult({
      profiles: [],
      page: 0,
      total: 0,
      page_size: 1000,
      session_id: null,
      has_more: false,
    });
  let engageStats: unknown = {};
  let insightsResponse: unknown = {};
  let arbFunnelsResponse: unknown = {};

  const stub = {
    core: { now: (): Date => now },
    // B6-W1: the facade constructor wires the /me-backed workspace
    // resolver (`_install_workspace_resolver`, `workspace.py:775-793`).
    // `MagicMock(spec=MixpanelAPIClient)` auto-provides both members in
    // Python; the TS stub declares them.
    hasWorkspaceResolver: false,
    setWorkspaceResolver: (): void => {},
    close: (): Promise<void> => Promise.resolve(),
    exportProfilesPage: (
      page: number,
      options: Record<string, unknown> = {},
    ): Promise<ProfilePageResult> => {
      exportPageCalls.push({ page, options });
      try {
        return Promise.resolve(pageHandler(page, options));
      } catch (error) {
        return Promise.reject(error as Error);
      }
    },
    engageStats: (
      options: Record<string, unknown> = {},
    ): Promise<JsonValue> => {
      engageStatsCalls.push(options);
      return Promise.resolve(engageStats as JsonValue);
    },
    insightsQuery: (
      body: Record<string, unknown>,
      options?: Record<string, unknown>,
    ): Promise<JsonValue> => {
      insightsCalls.push(body);
      insightsOptions.push(options);
      return Promise.resolve(insightsResponse as JsonValue);
    },
    arbFunnelsQuery: (
      body: Record<string, unknown>,
      options?: Record<string, unknown>,
    ): Promise<JsonValue> => {
      arbFunnelsCalls.push(body);
      arbFunnelsOptions.push(options);
      return Promise.resolve(arbFunnelsResponse as JsonValue);
    },
  };

  return {
    client: stub as unknown as MixpanelClient,
    exportPageCalls,
    engageStatsCalls,
    insightsCalls,
    arbFunnelsCalls,
    insightsOptions,
    arbFunnelsOptions,
    setPageHandler(handler: PageHandler): void {
      pageHandler = handler;
    },
    setEngageStats(value: unknown): void {
      engageStats = value;
    },
    setInsightsResponse(value: unknown): void {
      insightsResponse = value;
    },
    setArbFunnelsResponse(value: unknown): void {
      arbFunnelsResponse = value;
    },
  };
}

/** A `logger.warning` / `logger.debug` collector (the caplog twin). */
export interface LogCollector extends WorkspaceLogger {
  /** Every `warning(...)` message, in order. */
  readonly warnings: string[];
  /** Every `debug(...)` message, in order. */
  readonly debugs: string[];
}

/**
 * Build the `caplog` twin — the facade's injected logger seam (R9.5).
 *
 * @returns A logger that records every message.
 */
export function logCollector(): LogCollector {
  const warnings: string[] = [];
  const debugs: string[] = [];
  return {
    warnings,
    debugs,
    debug(message: string): void {
      debugs.push(message);
    },
    warning(message: string): void {
      warnings.push(message);
    },
  };
}

/**
 * Build a raw Mixpanel API profile dict (`_make_raw_profile`).
 *
 * @param distinctId - The user's distinct ID.
 * @param lastSeen - ISO timestamp for `$last_seen`.
 * @param extraProps - Additional profile properties.
 * @returns The raw Engage-format profile dict.
 */
export function makeRawProfile(
  distinctId: string,
  lastSeen = "2025-01-15T10:00:00",
  extraProps: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  const props: Record<string, unknown> = {
    $last_seen: lastSeen,
    ...extraProps,
  };
  return { $distinct_id: distinctId, $properties: props };
}

/**
 * Build a batch of raw profile dicts with sequential IDs
 * (`_make_profiles_batch`).
 *
 * @param startIndex - Starting index (`user_000`, `user_001`, …).
 * @param count - Number of profiles to generate.
 * @returns The raw profile dicts.
 */
export function makeProfilesBatch(
  startIndex: number,
  count: number,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < count; i += 1) {
    out.push(
      makeRawProfile(
        `user_${`${startIndex + i}`.padStart(3, "0")}`,
        undefined,
        {
          plan: "free",
        },
      ),
    );
  }
  return out;
}

/** Keyword arguments of {@link makePageResult}. */
export interface MakePageResultOptions {
  /** Zero-based page index. */
  readonly page?: number;
  /** Total matching profiles across all pages. */
  readonly total?: number;
  /** Profiles per page. */
  readonly page_size?: number;
  /** Pagination session ID. */
  readonly session_id?: string | null;
  /** Whether more pages exist. */
  readonly has_more?: boolean;
}

/**
 * Build a `ProfilePageResult` (`_make_page_result`).
 *
 * @param profiles - Raw profile dicts for this page.
 * @param options - The Python keyword-only defaults.
 * @returns The page result.
 */
export function makePageResult(
  profiles: ReadonlyArray<Readonly<Record<string, unknown>>>,
  options: MakePageResultOptions = {},
): ProfilePageResult {
  return new ProfilePageResult({
    profiles,
    page: options.page ?? 0,
    total: options.total ?? 100,
    page_size: options.page_size ?? 1000,
    session_id:
      options.session_id === undefined ? "sess_abc123" : options.session_id,
    has_more: options.has_more ?? false,
  });
}

/**
 * Build the `export_profiles_page` behaviour
 * (`_page_side_effect_factory`).
 *
 * @param total - Total profiles across all pages.
 * @param pageSize - Profiles per page.
 * @param sessionId - Session ID returned in page results.
 * @param failPages - Page numbers that raise instead.
 * @returns The handler.
 */
export function pageSideEffectFactory(
  total: number,
  pageSize: number,
  sessionId = "sess_parallel",
  failPages: ReadonlySet<number> = new Set(),
): PageHandler {
  const numPages = total > 0 ? Math.ceil(total / pageSize) : 1;
  return (page: number): ProfilePageResult => {
    if (failPages.has(page)) {
      throw new Error(`Simulated failure on page ${String(page)}`);
    }
    const startIdx = page * pageSize;
    const remaining = total - startIdx;
    const count = remaining > 0 ? Math.min(pageSize, remaining) : 0;
    return makePageResult(makeProfilesBatch(startIdx, count), {
      page,
      total,
      page_size: pageSize,
      session_id: sessionId,
      has_more: page < numPages - 1,
    });
  };
}
