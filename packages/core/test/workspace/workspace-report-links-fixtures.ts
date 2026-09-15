// Shared fixtures for the Workspace report-link suites: `MockApiClient` (the
// `MagicMock(spec=MixpanelAPIClient)` twin with per-member call logs, an
// echoing create_bookmark_url and resolve_workspace_id → 99), makeWorkspace
// with the `generateSlug` seam replacing the `generate_slug` patch, pinned and
// EU sessions, and the slug-record / resolved-report builders.

import { expect } from "vitest";

import type { Session } from "../../src/auth/session.js";
import type { MixpanelClient } from "../../src/client/client.js";
import type { JsonValue } from "../../src/client/json-value.js";
import { toError } from "../../src/invariant.js";
import {
  ResolvedReport,
  type ResolvedReportFields,
} from "../../src/types/report-links.js";
import { Workspace } from "../../src/workspace.js";
import {
  type LogCollector,
  logCollector,
  TEST_SESSION,
} from "../../test-support/workspace-test-helpers.js";

export const SLUG = "EBrV5bW2u9Mw";

// ---- 042 redesign: canonical fake Session for Workspace({session}) ----
/** `_PINNED_SESSION` — `_TEST_SESSION.replace(workspace=WorkspaceRef(id=75))`. */
export const PINNED_SESSION: Session = {
  ...TEST_SESSION,
  workspace: { id: 75 },
};
/** `_EU_SESSION`. */
export const EU_SESSION: Session = {
  ...TEST_SESSION,
  account: { ...TEST_SESSION.account, name: "eu_account", region: "eu" },
};

/** One recorded inline query call (body + scope bag). */
interface InlineCall {
  /** The request body (`bookmark`, `project_id`, …). */
  readonly body: Record<string, unknown>;
  /** The `{workspace_id, inject_workspace_id}` scope bag. */
  readonly scope: Record<string, unknown> | undefined;
}

/** The `mock_api_client` fixture twin. */
export interface MockApiClient {
  /** The stub cast to the client type the facade consumes. */
  readonly client: MixpanelClient;
  /** Every `create_bookmark_url` body, in order. */
  readonly bookmarkUrlCreateCalls: Array<Record<string, unknown>>;
  /** Every `get_bookmark_url` slug, in order. */
  readonly bookmarkUrlGetCalls: string[];
  /** Every `get_bookmark` id, in order. */
  readonly bookmarkGetCalls: number[];
  /** Every `resolve_short_link` code, in order. */
  readonly resolveShortLinkCalls: string[];
  /** Number of `resolve_workspace_id` calls. */
  readonly resolveWorkspaceIdCalls: number[];
  /** Every `insights_query` call, in order. */
  readonly insightsCalls: InlineCall[];
  /** Every `arb_funnels_query` call, in order. */
  readonly arbFunnelsCalls: InlineCall[];
  /** Every network-facing method name called, in order (`method_calls`). */
  readonly methodCalls: string[];
  /** `create_bookmark_url.side_effect`. */
  setCreateBookmarkUrl: (
    handler: (body: Record<string, unknown>) => Record<string, unknown>,
  ) => void;
  /** `get_bookmark_url.return_value` / `.side_effect`. */
  setGetBookmarkUrl: (handler: (slug: string) => unknown) => void;
  /** `get_bookmark.return_value` / `.side_effect`. */
  setGetBookmark: (handler: (id: number) => unknown) => void;
  /** `resolve_short_link.return_value` / `.side_effect`. */
  setResolveShortLink: (handler: (code: string) => string) => void;
  /** `resolve_workspace_id.return_value` / `.side_effect`. */
  setResolveWorkspaceId: (handler: () => number) => void;
  /** Fixed raw `insights_query` response. */
  setInsightsResponse: (value: unknown) => void;
  /** Fixed raw `arb_funnels_query` response. */
  setArbFunnelsResponse: (value: unknown) => void;
}

/**
 * Build the `mock_api_client` fixture twin: the slug POST echoes a record,
 * `resolve_workspace_id` returns 99.
 *
 * @returns The stub client plus its call logs and behaviour setters.
 */
function mockApiClient(): MockApiClient {
  const bookmarkUrlCreateCalls: Array<Record<string, unknown>> = [];
  const bookmarkUrlGetCalls: string[] = [];
  const bookmarkGetCalls: number[] = [];
  const resolveShortLinkCalls: string[] = [];
  const resolveWorkspaceIdCalls: number[] = [];
  const insightsCalls: InlineCall[] = [];
  const arbFunnelsCalls: InlineCall[] = [];
  const methodCalls: string[] = [];

  let createBookmarkUrl = (
    body: Record<string, unknown>,
  ): Record<string, unknown> => ({
    ...body,
    project_id: 12345,
    created_at: "2026-09-02T10:00:00",
  });
  let getBookmarkUrl: (slug: string) => unknown = () => ({});
  let getBookmark: (id: number) => unknown = () => ({});
  let resolveShortLink: (code: string) => string = () => "";
  let resolveWorkspaceId: () => number = () => 99;
  // Minimal valid raw bodies: `transformQueryResult` & co. require a
  // `series` key; the flow transform requires `steps`/`flows`.
  let insightsResponse: unknown = {
    computed_at: "t",
    date_range: { from_date: "d", to_date: "d" },
    series: {},
  };
  let arbFunnelsResponse: unknown = {
    computed_at: "t",
    steps: [],
    flows: [],
    breakdowns: [],
    metadata: {},
  };

  const wrap = <T>(name: string, fn: () => T): Promise<T> => {
    methodCalls.push(name);
    try {
      return Promise.resolve(fn());
    } catch (error) {
      return Promise.reject(toError(error));
    }
  };

  const stub = {
    get session(): Session {
      return TEST_SESSION;
    },
    // `MagicMock(spec=…)` auto-provides a TRUTHY `has_workspace_resolver`,
    // so the Python constructor's `_install_workspace_resolver` returns
    // early and records no method call; mirror that.
    hasWorkspaceResolver: true,
    setWorkspaceResolver: (): void => {},
    close: (): Promise<void> => Promise.resolve(),
    createBookmarkUrl: (
      body: Record<string, unknown>,
    ): Promise<Record<string, unknown>> =>
      wrap("create_bookmark_url", () => {
        bookmarkUrlCreateCalls.push(body);
        return createBookmarkUrl(body);
      }),
    getBookmarkUrl: (slug: string): Promise<unknown> =>
      wrap("get_bookmark_url", () => {
        bookmarkUrlGetCalls.push(slug);
        return getBookmarkUrl(slug);
      }),
    getBookmark: (id: number): Promise<unknown> =>
      wrap("get_bookmark", () => {
        bookmarkGetCalls.push(id);
        return getBookmark(id);
      }),
    resolveShortLink: (code: string): Promise<string> =>
      wrap("resolve_short_link", () => {
        resolveShortLinkCalls.push(code);
        return resolveShortLink(code);
      }),
    resolveWorkspaceId: (): Promise<number> =>
      wrap("resolve_workspace_id", () => {
        resolveWorkspaceIdCalls.push(resolveWorkspaceIdCalls.length);
        return resolveWorkspaceId();
      }),
    insightsQuery: (
      body: Record<string, unknown>,
      scope?: Record<string, unknown>,
    ): Promise<JsonValue> =>
      wrap("insights_query", () => {
        insightsCalls.push({ body, scope });
        return insightsResponse as JsonValue;
      }),
    arbFunnelsQuery: (
      body: Record<string, unknown>,
      scope?: Record<string, unknown>,
    ): Promise<JsonValue> =>
      wrap("arb_funnels_query", () => {
        arbFunnelsCalls.push({ body, scope });
        return arbFunnelsResponse as JsonValue;
      }),
  };

  return {
    client: stub as unknown as MixpanelClient,
    bookmarkUrlCreateCalls,
    bookmarkUrlGetCalls,
    bookmarkGetCalls,
    resolveShortLinkCalls,
    resolveWorkspaceIdCalls,
    insightsCalls,
    arbFunnelsCalls,
    methodCalls,
    setCreateBookmarkUrl(handler): void {
      createBookmarkUrl = handler;
    },
    setGetBookmarkUrl(handler): void {
      getBookmarkUrl = handler;
    },
    setGetBookmark(handler): void {
      getBookmark = handler;
    },
    setResolveShortLink(handler): void {
      resolveShortLink = handler;
    },
    setResolveWorkspaceId(handler): void {
      resolveWorkspaceId = handler;
    },
    setInsightsResponse(value): void {
      insightsResponse = value;
    },
    setArbFunnelsResponse(value): void {
      arbFunnelsResponse = value;
    },
  };
}

/** Constructor overrides the `workspace_factory` fixture accepts. */
interface FactoryOptions {
  /** The session (default `_TEST_SESSION`). */
  readonly session?: Session;
  /** The `generate_slug` patch (`return_value=_SLUG`). */
  readonly generateSlug?: () => string;
  /** The `caplog` twin. */
  readonly logger?: LogCollector;
}

/** The `ws` fixture bundle: facade + mock client (+ caplog twin). */
interface Fixture {
  /** The Workspace under test. */
  readonly ws: Workspace;
  /** The `mock_api_client` fixture. */
  readonly mock: MockApiClient;
  /** The `caplog` twin. */
  readonly log: LogCollector;
}

/**
 * The `workspace_factory` + `ws` fixtures: a Workspace bound to
 * `_TEST_SESSION` unless overridden, over a fresh mock client.
 *
 * @param options - Constructor overrides.
 * @param mock - Reuse an existing mock client (the Python fixture is
 *   shared by every Workspace a test builds).
 * @returns The facade, its mock client, and the log collector.
 */
export function makeWorkspace(
  options: FactoryOptions = {},
  mock: MockApiClient = mockApiClient(),
): Fixture {
  const log = options.logger ?? logCollector();
  const ws = new Workspace({
    session: options.session ?? TEST_SESSION,
    client: mock.client,
    logger: log,
    ...(options.generateSlug === undefined
      ? {}
      : { generateSlug: options.generateSlug }),
  });
  return { ws, mock, log };
}

/**
 * `pytest.raises(...)` twin over a promise: reject with the given class
 * and hand the error back for `.code` / `.details` assertions.
 *
 * @param promise - The call under test.
 * @param cls - The expected error class.
 * @returns The caught error.
 */
export async function expectRaises<T extends Error>(
  promise: Promise<unknown>,
  cls: new (...args: never[]) => T,
): Promise<T> {
  let caught: unknown = null;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(cls);
  return caught as T;
}

/** `exc.details` as a record (the `details` field is nullable). */
export function detailsOf(exc: {
  details: Readonly<Record<string, unknown>> | null;
}): Readonly<Record<string, unknown>> {
  expect(exc.details).not.toBeNull();
  return exc.details!;
}

// --- resolveReportLink ---

export const INSIGHTS_PARAMS = {
  sections: { show: [] },
  displayOptions: { chartType: "line" },
};

/**
 * `_slug_record`: a server slug record for `get_bookmark_url`.
 *
 * @param extra - Keys merged over the defaults.
 * @returns A record dict.
 */
export function slugRecord(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    slug: SLUG,
    type: "insights",
    params: INSIGHTS_PARAMS,
    project_id: 12345,
    name: "Logins",
    created_at: "2026-09-02T10:00:00",
    ...extra,
  };
}

// --- queryReportLink ---

/**
 * `_resolved` plus the `dataclasses.replace(...)` twin: a
 * ResolvedReport on project 12345 with optional field overrides.
 *
 * @param reportType - The report type to dispatch on.
 * @param params - The params to run.
 * @param overrides - `dataclasses.replace` keyword overrides.
 * @returns The ResolvedReport.
 */
export function resolvedReport(
  reportType: string,
  params: Record<string, unknown>,
  overrides: Partial<ResolvedReportFields> = {},
): ResolvedReport {
  return new ResolvedReport({
    source: "slug",
    report_type: reportType,
    params,
    project_id: 12345,
    workspace_id: null,
    region: "us",
    url: `https://mixpanel.com/project/12345/app/insights#${SLUG}`,
    input: SLUG,
    slug: SLUG,
    ...overrides,
  });
}

/** The project-wide scope bag every `_resolved(...)` run must carry. */
export const PROJECT_WIDE_SCOPE = {
  workspace_id: null,
  inject_workspace_id: false,
};
