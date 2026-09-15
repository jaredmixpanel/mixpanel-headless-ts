// Layer-3 translation of `tests/unit/test_workspace_report_links.py`
// (045-report-links, Python PR #223) — the WHOLE file: every class from
// `TestCreateReportLinkFromDict` (:129) through `TestWorkspaceScope`
// (:1489), one `describe` per Python class, one `it` per test (Python
// `parametrize` → `it.each`), in source order.
//
// Translation notes:
// - The `mock_api_client` fixture (`MagicMock(spec=MixpanelAPIClient)`,
//   :68-78) becomes `mockApiClient()` below: a stub carrying only the
//   client members the report-link facade touches, each with a per-member
//   call log so `assert_called_once_with` / `assert_not_called` /
//   `method_calls == []` translate to list assertions. Its
//   `create_bookmark_url` echo side effect and `resolve_workspace_id`
//   return value (99) are the fixture defaults.
// - `@patch("mixpanel_headless.workspace.generate_slug", return_value=_SLUG)`
//   becomes the constructor seam `generateSlug: () => SLUG`.
// - The `mock_live_query` fixture (a spec'd `LiveQueryService` mock
//   installed on `ws._live_query`) has NO TS twin: the facade reads the
//   lazily-built `liveQueryService` getter, which is backed by the
//   injected client. The translations therefore stub the CLIENT's
//   `insightsQuery(body, scope)` / `arbFunnelsQuery(body, scope)` with a
//   minimal valid raw response and assert the recorded `body.bookmark`,
//   `body.project_id`, `body.query_type` (flows) and the `scope` bag
//   `{workspace_id, inject_workspace_id}` — the same values Python's
//   `assert_called_once_with(params, 12345, workspace_id=…,
//   inject_workspace_id=False)` pins. `result is sentinel` becomes an
//   `instanceof` check plus `result.params` (the service threads the
//   bookmark params through) — the identity of a mock return value has
//   no twin once the real service runs.
// - `patch.object(Workspace, "_validate_bookmark_params_schema",
//   return_value=[warning])` (:335) has no seam in TS; the twin drives
//   the REAL validator into a warning-only outcome (a `sorting` block
//   with an unknown chart type yields `S4_UNKNOWN_CHART_TYPE` at
//   severity `warning` and nothing else on otherwise-valid params).
// - `caplog` becomes the injected `logger` seam (`logCollector()`).
// - `dataclasses.replace(resolved, …)` becomes a rebuild through the
//   `ResolvedReport` constructor from the source's fields.
// - Error MESSAGE text is out of contract (rulebook R5.4): the
//   `str(exc) == ...` assertions are dropped; class, `.code`, and
//   `.details` (including `hint`) are asserted instead.
// - The `workspace_factory` fixture's `ws.close()` finalizers are
//   dropped (see `workspace-test-helpers.ts` header).

import { describe, expect, it } from "vitest";

import type { Session } from "../../src/auth/session.js";
import type { MixpanelClient } from "../../src/client/client.js";
import type { JsonValue } from "../../src/client/json-value.js";
import {
  BookmarkValidationError,
  ParamValidationError,
  QueryError,
  ReportLinkNotFoundError,
  ReportLinkParseError,
  ReportLinkScopeMismatchError,
  ResponseValidationError,
  ShortLinkResolutionError,
  UnsupportedReportLinkError,
  WorkspaceScopeError,
} from "../../src/errors.js";
import type { BookmarkType, ReportLinkType } from "../../src/types/literals.js";
import { FunnelStep } from "../../src/types/query-params/funnel.js";
import {
  ReportLink,
  ResolvedReport,
  type ResolvedReportFields,
} from "../../src/types/report-links.js";
import {
  FlowQueryResult,
  FunnelQueryResult,
  QueryResult,
  RetentionQueryResult,
} from "../../src/types/results/query-engine.js";
import { Workspace } from "../../src/workspace.js";
import {
  type LogCollector,
  logCollector,
  TEST_SESSION,
} from "../../test-support/workspace-test-helpers.js";

const SLUG = "EBrV5bW2u9Mw";

// ---- 042 redesign: canonical fake Session for Workspace({session}) ----
/** `_PINNED_SESSION` (:58) — `_TEST_SESSION.replace(workspace=WorkspaceRef(id=75))`. */
const PINNED_SESSION: Session = { ...TEST_SESSION, workspace: { id: 75 } };
/** `_EU_SESSION` (:59-68). */
const EU_SESSION: Session = {
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

/** The `mock_api_client` fixture twin (:68-78). */
interface MockApiClient {
  /** The stub cast to the client type the facade consumes. */
  readonly client: MixpanelClient;
  /** Every `create_bookmark_url` body, in order. */
  readonly createBookmarkUrlCalls: Array<Record<string, unknown>>;
  /** Every `get_bookmark_url` slug, in order. */
  readonly getBookmarkUrlCalls: string[];
  /** Every `get_bookmark` id, in order. */
  readonly getBookmarkCalls: number[];
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
  const createBookmarkUrlCalls: Array<Record<string, unknown>> = [];
  const getBookmarkUrlCalls: string[] = [];
  const getBookmarkCalls: number[] = [];
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
      return Promise.reject(error);
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
        createBookmarkUrlCalls.push(body);
        return createBookmarkUrl(body);
      }),
    getBookmarkUrl: (slug: string): Promise<unknown> =>
      wrap("get_bookmark_url", () => {
        getBookmarkUrlCalls.push(slug);
        return getBookmarkUrl(slug);
      }),
    getBookmark: (id: number): Promise<unknown> =>
      wrap("get_bookmark", () => {
        getBookmarkCalls.push(id);
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
    createBookmarkUrlCalls,
    getBookmarkUrlCalls,
    getBookmarkCalls,
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

/** Constructor overrides the `workspace_factory` fixture accepts (:81-108). */
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
 * The `workspace_factory` + `ws` fixtures (:81-115): a Workspace bound to
 * `_TEST_SESSION` unless overridden, over a fresh mock client.
 *
 * @param options - Constructor overrides.
 * @param mock - Reuse an existing mock client (the Python fixture is
 *   shared by every Workspace a test builds).
 * @returns The facade, its mock client, and the log collector.
 */
function makeWorkspace(
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

/** `generate_slug` patched to `_SLUG`. */
const fixedSlug = (): string => SLUG;

/**
 * `_posted_body` (:118-128): the body of the single `create_bookmark_url`
 * call.
 *
 * @param mock - The mocked client.
 * @returns The posted body dict.
 */
function postedBody(mock: MockApiClient): Record<string, unknown> {
  expect(mock.createBookmarkUrlCalls).toHaveLength(1);
  return mock.createBookmarkUrlCalls[0]!;
}

/** `ws.build_funnel_params([FunnelStep("Login"), FunnelStep("Purchase")], last=30)`. */
function funnelParams(ws: Workspace): Promise<Record<string, unknown>> {
  return ws.buildFunnelParams(
    [new FunnelStep({ event: "Login" }), new FunnelStep({ event: "Purchase" })],
    { last: 30 },
  );
}

/**
 * `pytest.raises(...)` twin over a promise: reject with the given class
 * and hand the error back for `.code` / `.details` assertions.
 *
 * @param promise - The call under test.
 * @param cls - The expected error class.
 * @returns The caught error.
 */
async function raises<T extends Error>(
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
function detailsOf(exc: {
  details: Readonly<Record<string, unknown>> | null;
}): Readonly<Record<string, unknown>> {
  expect(exc.details).not.toBeNull();
  return exc.details!;
}

// =============================================================================
// create_report_link (US1)
// =============================================================================

describe("TestCreateReportLinkFromDict (test_workspace_report_links.py:129)", () => {
  it("test_dict_defaults_to_insights", async () => {
    const { ws, mock } = makeWorkspace();
    const params = await ws.buildParams("Login", { last: 7 });

    const link = await ws.createReportLink(params);

    const body = postedBody(mock);
    expect(body["type"]).toBe("insights");
    expect(body["params"]).toEqual(params);
    expect(body["slug"] as string).toHaveLength(12);
    expect(link).toBeInstanceOf(ReportLink);
    expect(link.report_type).toBe("insights");
    expect(link.slug).toBe(body["slug"]);
    expect(link.project_id).toBe(12345);
  });

  it("test_explicit_type_on_dict", async () => {
    const { ws, mock } = makeWorkspace();
    const params = await funnelParams(ws);

    const link = await ws.createReportLink(params, { report_type: "funnels" });

    expect(postedBody(mock)["type"]).toBe("funnels");
    expect(link.report_type).toBe("funnels");
  });

  it("test_url_uses_resolved_workspace", async () => {
    const { ws, mock } = makeWorkspace({ generateSlug: fixedSlug });

    const link = await ws.createReportLink(
      await ws.buildParams("Login", { last: 7 }),
    );

    expect(mock.resolveWorkspaceIdCalls).toHaveLength(1);
    expect(link.workspace_id).toBe(99);
    expect(link.url).toBe(
      `https://mixpanel.com/project/12345/view/99/app/insights#${SLUG}`,
    );
    expect(String(link)).toBe(link.url);
  });

  it("test_created_at_name_description_bookmark_id", async () => {
    const { ws, mock } = makeWorkspace();

    const link = await ws.createReportLink(
      await ws.buildParams("Login", { last: 7 }),
      { name: "Logins", description: "last 7 days", bookmark_id: 9 },
    );

    const body = postedBody(mock);
    expect(body["name"]).toBe("Logins");
    expect(body["description"]).toBe("last 7 days");
    expect(body["bookmark_id"]).toBe(9);
    expect(link.name).toBe("Logins");
    expect(link.description).toBe("last 7 days");
    expect(link.bookmark_id).toBe(9);
    expect(link.created_at).toBe("2026-09-02T10:00:00");
  });

  it("test_body_omits_empty_optionals_and_workspace_id", async () => {
    const { ws, mock } = makeWorkspace();

    await ws.createReportLink(await ws.buildParams("Login", { last: 7 }), {
      workspace_id: 5,
    });

    const body = postedBody(mock);
    expect(Object.keys(body).sort()).toEqual(["params", "slug", "type"]);
  });

  it("test_missing_created_at_is_none", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setCreateBookmarkUrl((body) => ({ ...body }));

    const link = await ws.createReportLink(
      await ws.buildParams("Login", { last: 7 }),
    );

    expect(link.created_at).toBeNull();
  });
});

describe("TestCreateReportLinkFromResults (test_workspace_report_links.py:220)", () => {
  it("test_query_result_is_insights", async () => {
    const { ws, mock } = makeWorkspace();
    const params = await ws.buildParams("Login", { last: 7 });
    const result = new QueryResult({
      computed_at: "2026-09-02T10:00:00",
      from_date: "2026-08-26",
      to_date: "2026-09-02",
      params,
    });

    const link = await ws.createReportLink(result);

    const body = postedBody(mock);
    expect(body["type"]).toBe("insights");
    expect(body["params"]).toEqual(params);
    expect(link.report_type).toBe("insights");
  });

  it("test_funnel_result_is_funnels", async () => {
    const { ws, mock } = makeWorkspace();
    const params = await funnelParams(ws);
    const result = new FunnelQueryResult({
      computed_at: "2026-09-02T10:00:00",
      from_date: "2026-08-03",
      to_date: "2026-09-02",
      params,
    });

    const link = await ws.createReportLink(result);

    expect(postedBody(mock)["type"]).toBe("funnels");
    expect(link.report_type).toBe("funnels");
    expect(link.url).toContain("/app/insights#");
  });

  it("test_retention_result_is_retention", async () => {
    const { ws, mock } = makeWorkspace();
    const params = await ws.buildRetentionParams("Login", "Purchase", {
      last: 30,
    });
    const result = new RetentionQueryResult({
      computed_at: "2026-09-02T10:00:00",
      from_date: "2026-08-03",
      to_date: "2026-09-02",
      params,
    });

    const link = await ws.createReportLink(result);

    expect(postedBody(mock)["type"]).toBe("retention");
    expect(link.report_type).toBe("retention");
  });

  it("test_flow_result_is_flows", async () => {
    const { ws, mock } = makeWorkspace();
    const params = await ws.buildFlowParams("Login", { last: 30 });
    const result = new FlowQueryResult({
      computed_at: "2026-09-02T10:00:00",
      params,
    });

    const link = await ws.createReportLink(result);

    expect(postedBody(mock)["type"]).toBe("flows");
    expect(link.report_type).toBe("flows");
    expect(link.url).toContain("/app/flows#");
  });

  it("test_matching_explicit_type_is_accepted", async () => {
    const { ws } = makeWorkspace();
    const result = new FlowQueryResult({
      computed_at: "2026-09-02T10:00:00",
      params: await ws.buildFlowParams("Login", { last: 30 }),
    });

    const link = await ws.createReportLink(result, { report_type: "flows" });

    expect(link.report_type).toBe("flows");
  });

  it("test_contradicting_type_raises_rl4_before_post", async () => {
    const { ws, mock } = makeWorkspace();
    const result = new FunnelQueryResult({
      computed_at: "2026-09-02T10:00:00",
      from_date: "2026-08-03",
      to_date: "2026-09-02",
      params: await funnelParams(ws),
    });

    const exc = await raises(
      ws.createReportLink(result, { report_type: "insights" }),
      ParamValidationError,
    );

    expect(exc.code).toBe("RL4_REPORT_TYPE_CONFLICT");
    expect(detailsOf(exc)).toEqual({
      given: "insights",
      inferred: "funnels",
      result_class: "FunnelQueryResult",
    });
    expect(mock.createBookmarkUrlCalls).toHaveLength(0);
  });
});

describe("TestCreateReportLinkValidation (test_workspace_report_links.py:310)", () => {
  it("test_validation_failure_raises_before_post", async () => {
    const { ws, mock } = makeWorkspace();

    const exc = await raises(
      ws.createReportLink({ sections: { show: [] }, bogus: 1 }),
      BookmarkValidationError,
    );

    expect(exc.errorCount).toBeGreaterThanOrEqual(1);
    expect(mock.createBookmarkUrlCalls).toHaveLength(0);
  });

  it("test_validate_false_skips_validation", async () => {
    const { ws, mock } = makeWorkspace();

    const link = await ws.createReportLink({ bogus: 1 }, { validate: false });

    expect(postedBody(mock)["params"]).toEqual({ bogus: 1 });
    expect(link.report_type).toBe("insights");
  });

  it("test_validation_warnings_do_not_block", async () => {
    // No seam for `patch.object(Workspace, "_validate_bookmark_params_schema")`:
    // drive the REAL validator to a warning-only outcome instead (an
    // unknown chart type under `sorting` is `S4_UNKNOWN_CHART_TYPE`
    // at severity "warning"; the rest of the params are valid).
    const { ws, mock, log } = makeWorkspace();
    const params = {
      ...(await ws.buildParams("Login", { last: 7 })),
      sorting: { bogusChart: {} },
    };

    await ws.createReportLink(params);

    expect(mock.createBookmarkUrlCalls).toHaveLength(1);
    expect(log.warnings.some((m) => m.includes("S4_UNKNOWN_CHART_TYPE"))).toBe(
      true,
    );
  });
});

describe("TestCreateReportLinkWorkspacePrecedence (test_workspace_report_links.py:347)", () => {
  it("test_explicit_wins", async () => {
    const { ws, mock } = makeWorkspace({ generateSlug: fixedSlug });

    const link = await ws.createReportLink(
      await ws.buildParams("Login", { last: 7 }),
      { workspace_id: 5 },
    );

    expect(link.workspace_id).toBe(5);
    expect(link.url).toContain("/view/5/");
    expect(mock.resolveWorkspaceIdCalls).toHaveLength(0);
  });

  it("test_pinned_session_workspace", async () => {
    const { ws, mock } = makeWorkspace({
      session: PINNED_SESSION,
      generateSlug: fixedSlug,
    });

    const link = await ws.createReportLink(
      await ws.buildParams("Login", { last: 7 }),
    );

    expect(link.workspace_id).toBe(75);
    expect(link.url).toContain("/view/75/");
    expect(mock.resolveWorkspaceIdCalls).toHaveLength(0);
  });

  it("test_explicit_beats_pinned", async () => {
    const { ws } = makeWorkspace({
      session: PINNED_SESSION,
      generateSlug: fixedSlug,
    });

    const link = await ws.createReportLink(
      await ws.buildParams("Login", { last: 7 }),
      { workspace_id: 5 },
    );

    expect(link.workspace_id).toBe(5);
  });

  it("test_scope_error_falls_back_to_project_only", async () => {
    const { ws, mock } = makeWorkspace({ generateSlug: fixedSlug });
    mock.setResolveWorkspaceId(() => {
      throw new WorkspaceScopeError("no workspaces");
    });

    const link = await ws.createReportLink(
      await ws.buildParams("Login", { last: 7 }),
    );

    expect(link.workspace_id).toBeNull();
    expect(link.url).toBe(
      `https://mixpanel.com/project/12345/app/insights#${SLUG}`,
    );
  });
});

describe("TestCreateReportLinkUrlShape (test_workspace_report_links.py:407)", () => {
  it.each<[ReportLinkType, string]>([
    ["insights", "insights"],
    ["funnels", "insights"],
    ["retention", "insights"],
    ["flows", "flows"],
  ])("test_eu_session_per_type[%s-%s]", async (reportType, app) => {
    const { ws } = makeWorkspace({
      session: EU_SESSION,
      generateSlug: fixedSlug,
    });

    const link = await ws.createReportLink(
      { any: 1 },
      { report_type: reportType, validate: false, workspace_id: null },
    );

    expect(link.url).toBe(
      `https://eu.mixpanel.com/project/12345/view/99/app/${app}#${SLUG}`,
    );
    expect(link.report_type).toBe(reportType);
  });
});

// =============================================================================
// resolve_report_link (US2)
// =============================================================================

const INSIGHTS_PARAMS = {
  sections: { show: [] },
  displayOptions: { chartType: "line" },
};
const FLOW_PARAMS = { chartType: "paths", steps: [] };
const BOOKMARK_RAW = {
  id: 123,
  name: "Weekly actives",
  type: "funnels",
  params: { steps: [{ event: "Login" }] },
  description: "desc",
};

/**
 * `_slug_record` (:456-473): a server slug record for `get_bookmark_url`.
 *
 * @param extra - Keys merged over the defaults.
 * @returns A record dict.
 */
function slugRecord(
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

describe("TestResolveSlugLinks (test_workspace_report_links.py:476)", () => {
  it("test_bare_slug", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setGetBookmarkUrl(() => slugRecord());

    const resolved = await ws.resolveReportLink(SLUG);

    expect(mock.getBookmarkUrlCalls).toEqual([SLUG]);
    expect(mock.resolveWorkspaceIdCalls).toHaveLength(0);
    expect(resolved).toBeInstanceOf(ResolvedReport);
    expect(resolved.source).toBe("slug");
    expect(resolved.report_type).toBe("insights");
    expect(resolved.params).toEqual(INSIGHTS_PARAMS);
    expect(resolved.project_id).toBe(12345);
    expect(resolved.workspace_id).toBeNull();
    expect(resolved.region).toBe("us");
    expect(resolved.url).toBe(
      `https://mixpanel.com/project/12345/app/insights#${SLUG}`,
    );
    expect(resolved.input).toBe(SLUG);
    expect(resolved.expanded_url).toBeNull();
    expect(resolved.slug).toBe(SLUG);
    expect(resolved.bookmark_id).toBeNull();
    expect(resolved.bookmark).toBeNull();
    expect(resolved.name).toBe("Logins");
    expect(resolved.description).toBeNull();
    expect(resolved.overrides).toBeNull();
  });

  it("test_full_url_with_workspace", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setGetBookmarkUrl(() => slugRecord({ type: "funnels" }));
    const link = `https://mixpanel.com/project/12345/view/75/app/insights/?utm=x#${SLUG}`;

    const resolved = await ws.resolveReportLink(link);

    expect(resolved.workspace_id).toBe(75);
    expect(resolved.report_type).toBe("funnels");
    expect(resolved.url).toBe(
      `https://mixpanel.com/project/12345/view/75/app/insights#${SLUG}`,
    );
    expect(resolved.input).toBe(link);
  });

  it("test_project_only_url_uses_pinned_workspace", async () => {
    const { ws, mock } = makeWorkspace({ session: PINNED_SESSION });
    mock.setGetBookmarkUrl(() => slugRecord());

    const resolved = await ws.resolveReportLink(
      `https://mixpanel.com/project/12345/app/insights#${SLUG}`,
    );

    expect(resolved.workspace_id).toBe(75);
    expect(resolved.url).toContain("/view/75/");
    expect(mock.resolveWorkspaceIdCalls).toHaveLength(0);
  });

  it("test_project_only_url_without_pin_is_none", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setGetBookmarkUrl(() => slugRecord());

    const resolved = await ws.resolveReportLink(
      `https://mixpanel.com/project/12345/app/insights#${SLUG}`,
    );

    expect(resolved.workspace_id).toBeNull();
    expect(mock.resolveWorkspaceIdCalls).toHaveLength(0);
  });

  it("test_slug_record_with_embedded_bookmark", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setGetBookmarkUrl(() =>
      slugRecord({
        bookmark: BOOKMARK_RAW,
        overrides: { originDashboard: 555 },
      }),
    );

    const resolved = await ws.resolveReportLink(SLUG);

    expect(resolved.source).toBe("slug");
    expect(resolved.bookmark).not.toBeNull();
    expect(resolved.bookmark?.id).toBe(123);
    expect(resolved.bookmark_id).toBe(123);
    expect(resolved.params).toEqual(INSIGHTS_PARAMS);
    expect(resolved.overrides).toEqual({ originDashboard: 555 });
    expect(mock.getBookmarkCalls).toHaveLength(0);
  });

  it("test_flows_record_rebuilds_under_flows_app", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setGetBookmarkUrl(() =>
      slugRecord({ type: "flows", params: FLOW_PARAMS }),
    );

    const resolved = await ws.resolveReportLink(
      `https://mixpanel.com/project/12345/app/insights#${SLUG}`,
    );

    expect(resolved.report_type).toBe("flows");
    expect(resolved.url).toBe(
      `https://mixpanel.com/project/12345/app/flows#${SLUG}`,
    );
  });

  it("test_unknown_slug_raises_not_found", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setGetBookmarkUrl(() => {
      throw new ReportLinkNotFoundError("nope", {
        code: "REPORT_LINK_SLUG_NOT_FOUND",
        details: { slug: SLUG },
      });
    });

    const exc = await raises(
      ws.resolveReportLink(SLUG),
      ReportLinkNotFoundError,
    );

    expect(exc.code).toBe("REPORT_LINK_SLUG_NOT_FOUND");
  });

  it("test_malformed_slug_record_raises_response_validation_error", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setGetBookmarkUrl(() => slugRecord({ params: "nope" }));

    await raises(ws.resolveReportLink(SLUG), ResponseValidationError);
  });

  it("test_slug_record_without_slug_raises_response_validation_error", async () => {
    const { ws, mock } = makeWorkspace();
    const record = slugRecord();
    delete record["slug"];
    mock.setGetBookmarkUrl(() => record);

    await raises(ws.resolveReportLink(SLUG), ResponseValidationError);
  });

  it("test_dashboard_edited_bookmark_resolves_slug", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setGetBookmarkUrl(() => slugRecord());

    const resolved = await ws.resolveReportLink(
      `https://mixpanel.com/project/12345/app/boards#id=555&edited-bookmark=${SLUG}`,
    );

    expect(resolved.slug).toBe(SLUG);
    expect(mock.getBookmarkUrlCalls).toEqual([SLUG]);
  });
});

describe("TestResolveBookmarkLinks (test_workspace_report_links.py:631)", () => {
  it("test_bookmark_url_type_from_bookmark_not_hint", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setGetBookmark(() => BOOKMARK_RAW);

    const resolved = await ws.resolveReportLink(
      "https://mixpanel.com/project/12345/app/insights#report/123",
    );

    expect(mock.getBookmarkCalls).toEqual([123]);
    expect(mock.getBookmarkUrlCalls).toHaveLength(0);
    expect(resolved.source).toBe("bookmark");
    expect(resolved.report_type).toBe("funnels");
    expect(resolved.params).toEqual({ steps: [{ event: "Login" }] });
    expect(resolved.bookmark_id).toBe(123);
    expect(resolved.bookmark).not.toBeNull();
    expect(resolved.bookmark?.bookmark_type).toBe("funnels");
    expect(resolved.slug).toBeNull();
    expect(resolved.name).toBe("Weekly actives");
    expect(resolved.description).toBe("desc");
    expect(resolved.overrides).toBeNull();
    expect(resolved.url).toBe(
      "https://mixpanel.com/project/12345/app/funnels#view/123",
    );
  });

  it("test_bookmark_url_with_workspace", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setGetBookmark(() => ({ ...BOOKMARK_RAW, type: "insights" }));

    const resolved = await ws.resolveReportLink(
      "https://mixpanel.com/project/12345/view/75/app/insights#report/123/weekly",
    );

    expect(resolved.workspace_id).toBe(75);
    expect(resolved.url).toBe(
      "https://mixpanel.com/project/12345/view/75/app/insights#report/123",
    );
  });

  it("test_overrides_tail_logs_warning_and_returns_base_params", async () => {
    const { ws, mock, log } = makeWorkspace();
    mock.setGetBookmark(() => BOOKMARK_RAW);

    const resolved = await ws.resolveReportLink(
      "https://mixpanel.com/project/12345/app/funnels#view/123/~(a~1)",
    );

    expect(resolved.params).toEqual({ steps: [{ event: "Login" }] });
    expect(
      log.warnings.some(
        (m) =>
          m.includes("ignoring URL overrides '~(a~1)'") &&
          m.includes("base params"),
      ),
    ).toBe(true);
  });

  it("test_unknown_bookmark_raises_not_found", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setGetBookmark(() => {
      throw new QueryError("Resource not found", { statusCode: 404 });
    });

    const exc = await raises(
      ws.resolveReportLink(
        "https://mixpanel.com/project/12345/app/insights#report/123",
      ),
      ReportLinkNotFoundError,
    );

    expect(exc.code).toBe("REPORT_LINK_BOOKMARK_NOT_FOUND");
    const details = detailsOf(exc);
    expect(details["bookmark_id"]).toBe(123);
    expect(details["kind"]).toBe("bookmark");
    expect(Object.hasOwn(details, "session_workspace_id")).toBe(false);
    expect(details["hint"]).toBe(
      "Check the saved report id, or switch to the project and region that " +
        "own it (ws.use(project=...); CLI: mp --project ...) and retry.",
    );
  });

  it("test_unknown_bookmark_under_pinned_workspace_names_the_workspace", async () => {
    const { ws, mock } = makeWorkspace({ session: PINNED_SESSION });
    mock.setGetBookmark(() => {
      throw new QueryError("Resource not found", { statusCode: 404 });
    });

    const exc = await raises(
      ws.resolveReportLink(
        "https://mixpanel.com/project/12345/app/insights#report/123",
      ),
      ReportLinkNotFoundError,
    );

    expect(exc.code).toBe("REPORT_LINK_BOOKMARK_NOT_FOUND");
    const details = detailsOf(exc);
    expect(details["session_workspace_id"]).toBe(75);
    expect(details["hint"]).toBe(
      "The saved report may live in another workspace of this project. " +
        "Switch with ws.use(workspace=<id>) (CLI: mp --workspace <id> ...) " +
        "or unpin the workspace and retry.",
    );
  });

  it.each([
    ["insights", "insights#report/123"],
    ["funnels", "funnels#view/123"],
  ])(
    "test_unknown_bookmark_type_falls_back_to_url_app_with_warning[%s]",
    async (app, expectedTail) => {
      const { ws, mock, log } = makeWorkspace();
      mock.setGetBookmark(() => ({ ...BOOKMARK_RAW, type: "user" }));

      const resolved = await ws.resolveReportLink(
        `https://mixpanel.com/project/12345/app/${app}#report/123`,
      );

      expect(resolved.report_type).toBe("user");
      expect(resolved.url).toBe(
        `https://mixpanel.com/project/12345/app/${expectedTail}`,
      );
      expect(
        log.warnings.some(
          (m) => m.includes("unknown report type 'user'") && m.includes(app),
        ),
      ).toBe(true);
    },
  );

  it("test_other_query_error_passes_through", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setGetBookmark(() => {
      throw new QueryError("Permission denied", { statusCode: 403 });
    });

    const exc = await raises(
      ws.resolveReportLink(
        "https://mixpanel.com/project/12345/app/insights#report/123",
      ),
      QueryError,
    );

    expect(exc.statusCode).toBe(403);
  });

  it("test_bookmark_without_params_yields_empty_dict", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setGetBookmark(() => ({ ...BOOKMARK_RAW, params: null }));

    const resolved = await ws.resolveReportLink(
      "https://mixpanel.com/project/12345/app/insights#report/123",
    );

    expect(resolved.params).toEqual({});
  });
});

describe("TestResolveScopeAndUnsupported (test_workspace_report_links.py:812)", () => {
  /**
   * `_assert_no_client_calls` (:815-823): neither record reader nor the
   * workspace resolver was called.
   *
   * @param mock - The mocked client.
   */
  function assertNoClientCalls(mock: MockApiClient): void {
    expect(mock.getBookmarkUrlCalls).toHaveLength(0);
    expect(mock.getBookmarkCalls).toHaveLength(0);
    expect(mock.resolveWorkspaceIdCalls).toHaveLength(0);
  }

  it("test_project_mismatch", async () => {
    const { ws, mock } = makeWorkspace();

    const exc = await raises(
      ws.resolveReportLink(
        `https://mixpanel.com/project/3/app/insights#${SLUG}`,
      ),
      ReportLinkScopeMismatchError,
    );

    expect(exc.code).toBe("REPORT_LINK_PROJECT_MISMATCH");
    const details = detailsOf(exc);
    expect(details["hint"]).toBe(
      'Switch with ws.use(project="3") (CLI: mp --project 3 ...) and retry.',
    );
    expect(details["link_project_id"]).toBe(3);
    expect(details["session_project_id"]).toBe(12345);
    expect(details["slug"]).toBe(SLUG);
    assertNoClientCalls(mock);
  });

  it("test_region_mismatch", async () => {
    const { ws, mock } = makeWorkspace();

    const exc = await raises(
      ws.resolveReportLink(
        `https://eu.mixpanel.com/project/12345/app/insights#${SLUG}`,
      ),
      ReportLinkScopeMismatchError,
    );

    expect(exc.code).toBe("REPORT_LINK_REGION_MISMATCH");
    const details = detailsOf(exc);
    expect(details["hint"]).toBe(
      "Switch to an account on the eu region with " +
        'ws.use(account="<name>") (CLI: mp --account <name> ...) and retry.',
    );
    expect(details["link_region"]).toBe("eu");
    expect(details["session_region"]).toBe("us");
    assertNoClientCalls(mock);
  });

  it("test_region_checked_before_project", async () => {
    const { ws } = makeWorkspace();

    const exc = await raises(
      ws.resolveReportLink(
        `https://eu.mixpanel.com/project/3/app/insights#${SLUG}`,
      ),
      ReportLinkScopeMismatchError,
    );

    expect(exc.code).toBe("REPORT_LINK_REGION_MISMATCH");
  });

  it("test_dashboard_link_unsupported", async () => {
    const { ws, mock } = makeWorkspace();

    const exc = await raises(
      ws.resolveReportLink(
        "https://mixpanel.com/project/12345/app/boards#id=555",
      ),
      UnsupportedReportLinkError,
    );

    expect(exc.code).toBe("UNSUPPORTED_DASHBOARD_LINK");
    const details = detailsOf(exc);
    expect(details["hint"]).toBe(
      "Use ws.get_dashboard(555) (CLI: mp dashboards get 555) to list its " +
        "reports, then resolve one report link.",
    );
    expect(details["dashboard_id"]).toBe(555);
    assertNoClientCalls(mock);
  });

  it("test_legacy_hash_unsupported", async () => {
    const { ws, mock } = makeWorkspace();

    const exc = await raises(
      ws.resolveReportLink(
        "https://mixpanel.com/project/12345/app/insights#~(sections~())",
      ),
      UnsupportedReportLinkError,
    );

    expect(exc.code).toBe("UNSUPPORTED_LEGACY_HASH");
    expect(detailsOf(exc)["hint"]).toBe(
      "Open it in a browser (the app re-mints a shareable link on load) " +
        "and copy the new URL.",
    );
    assertNoClientCalls(mock);
  });

  it("test_unsupported_kinds_win_over_scope_checks", async () => {
    const { ws } = makeWorkspace();

    await raises(
      ws.resolveReportLink("https://mixpanel.com/project/3/app/boards#id=555"),
      UnsupportedReportLinkError,
    );
  });

  it("test_parse_error_propagates", async () => {
    const { ws, mock } = makeWorkspace();

    await raises(ws.resolveReportLink("not a link"), ReportLinkParseError);

    assertNoClientCalls(mock);
  });
});

// =============================================================================
// query_report_link (US2)
// =============================================================================

/**
 * `_resolved` (:929-949) plus the `dataclasses.replace(...)` twin: a
 * ResolvedReport on project 12345 with optional field overrides.
 *
 * @param reportType - The report type to dispatch on.
 * @param params - The params to run.
 * @param overrides - `dataclasses.replace` keyword overrides.
 * @returns The ResolvedReport.
 */
function resolvedReport(
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
const PROJECT_WIDE_SCOPE = { workspace_id: null, inject_workspace_id: false };

describe("TestQueryReportLink (test_workspace_report_links.py:962)", () => {
  it("test_insights", async () => {
    const { ws, mock } = makeWorkspace();

    const result = await ws.queryReportLink(
      resolvedReport("insights", INSIGHTS_PARAMS),
    );

    expect(result).toBeInstanceOf(QueryResult);
    expect(result.params).toEqual(INSIGHTS_PARAMS);
    expect(mock.insightsCalls).toHaveLength(1);
    const call = mock.insightsCalls[0]!;
    expect(call.body["bookmark"]).toEqual(INSIGHTS_PARAMS);
    expect(call.body["project_id"]).toBe(12345);
    expect(call.scope).toEqual(PROJECT_WIDE_SCOPE);
  });

  it("test_funnels", async () => {
    const { ws, mock } = makeWorkspace();

    const result = await ws.queryReportLink(
      resolvedReport("funnels", { steps: [] }),
    );

    expect(result).toBeInstanceOf(FunnelQueryResult);
    expect(result.params).toEqual({ steps: [] });
    expect(mock.insightsCalls).toHaveLength(1);
    const call = mock.insightsCalls[0]!;
    expect(call.body["bookmark"]).toEqual({ steps: [] });
    expect(call.body["project_id"]).toBe(12345);
    expect(call.scope).toEqual(PROJECT_WIDE_SCOPE);
  });

  it("test_retention", async () => {
    const { ws, mock } = makeWorkspace();

    const result = await ws.queryReportLink(
      resolvedReport("retention", { r: 1 }),
    );

    expect(result).toBeInstanceOf(RetentionQueryResult);
    expect(result.params).toEqual({ r: 1 });
    expect(mock.insightsCalls).toHaveLength(1);
    const call = mock.insightsCalls[0]!;
    expect(call.body["bookmark"]).toEqual({ r: 1 });
    expect(call.body["project_id"]).toBe(12345);
    expect(call.scope).toEqual(PROJECT_WIDE_SCOPE);
  });

  /** `mode` → `/arb_funnels` `query_type` (`LiveQueryService.queryFlow`). */
  const QUERY_TYPE_FOR_MODE: Readonly<Record<string, string>> = {
    paths: "flows_top_paths",
    tree: "flows",
    sankey: "flows_sankey",
  };

  it.each<[Record<string, unknown>, string]>([
    [{ chartType: "paths" }, "paths"],
    [{ chartType: "tree" }, "tree"],
    [{ chartType: "sankey" }, "sankey"],
    [{ chartType: "bar" }, "sankey"],
    [{}, "sankey"],
  ])(
    "test_flows_mode_derived_from_params[%j-%s]",
    async (params, expectedMode) => {
      const { ws, mock } = makeWorkspace();

      const result = await ws.queryReportLink(resolvedReport("flows", params));

      expect(result).toBeInstanceOf(FlowQueryResult);
      expect((result as FlowQueryResult).mode).toBe(expectedMode);
      expect(result.params).toEqual(params);
      expect(mock.arbFunnelsCalls).toHaveLength(1);
      const call = mock.arbFunnelsCalls[0]!;
      expect(call.body["bookmark"]).toEqual(params);
      expect(call.body["project_id"]).toBe(12345);
      expect(call.body["query_type"]).toBe(QUERY_TYPE_FOR_MODE[expectedMode]);
      expect(call.scope).toEqual(PROJECT_WIDE_SCOPE);
    },
  );

  it("test_flows_explicit_mode_wins", async () => {
    const { ws, mock } = makeWorkspace();

    const result = await ws.queryReportLink(
      resolvedReport("flows", { chartType: "paths" }),
      { mode: "tree" },
    );

    expect((result as FlowQueryResult).mode).toBe("tree");
    expect(mock.arbFunnelsCalls).toHaveLength(1);
    const call = mock.arbFunnelsCalls[0]!;
    expect(call.body["bookmark"]).toEqual({ chartType: "paths" });
    expect(call.body["project_id"]).toBe(12345);
    expect(call.body["query_type"]).toBe("flows");
    expect(call.scope).toEqual(PROJECT_WIDE_SCOPE);
  });

  it("test_launch_analysis_unsupported", async () => {
    const { ws, mock } = makeWorkspace();

    const exc = await raises(
      ws.queryReportLink(resolvedReport("launch-analysis", {})),
      UnsupportedReportLinkError,
    );

    expect(exc.code).toBe("UNSUPPORTED_REPORT_TYPE");
    expect(detailsOf(exc)["hint"]).toBe(
      "Supported types are insights, funnels, retention, and flows.",
    );
    expect(mock.insightsCalls).toHaveLength(0);
    expect(mock.arbFunnelsCalls).toHaveLength(0);
  });

  it("test_resolved_input_does_not_refetch", async () => {
    const { ws, mock } = makeWorkspace();

    await ws.queryReportLink(resolvedReport("insights", INSIGHTS_PARAMS));

    expect(mock.getBookmarkUrlCalls).toHaveLength(0);
    expect(mock.getBookmarkCalls).toHaveLength(0);
  });

  it("test_str_input_resolves_first", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setGetBookmarkUrl(() => slugRecord());

    const result = await ws.queryReportLink(SLUG);

    expect(result).toBeInstanceOf(QueryResult);
    expect(mock.getBookmarkUrlCalls).toEqual([SLUG]);
    expect(mock.insightsCalls).toHaveLength(1);
    const call = mock.insightsCalls[0]!;
    expect(call.body["bookmark"]).toEqual(INSIGHTS_PARAMS);
    expect(call.body["project_id"]).toBe(12345);
    expect(call.scope).toEqual(PROJECT_WIDE_SCOPE);
  });
});

// =============================================================================
// shortlinks (US3)
// =============================================================================

const SHORT = "https://mixpanel.com/s/AbC123";
const SHORT_TARGET = `https://mixpanel.com/project/12345/view/75/app/insights#${SLUG}`;

describe("TestResolveShortLinks (test_workspace_report_links.py:1118)", () => {
  it("test_short_link_resolves_like_its_target", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setResolveShortLink(() => SHORT_TARGET);
    mock.setGetBookmarkUrl(() => slugRecord());

    const direct = await ws.resolveReportLink(SHORT_TARGET);
    const viaShort = await ws.resolveReportLink(SHORT);

    expect(mock.resolveShortLinkCalls).toEqual(["AbC123"]);
    expect(viaShort.expanded_url).toBe(SHORT_TARGET);
    expect(viaShort.input).toBe(SHORT);
    // `dataclasses.replace(via_short, expanded_url=None, input=_SHORT_TARGET) == direct`
    expect({
      ...viaShort.toDict(),
      expanded_url: null,
      input: SHORT_TARGET,
    }).toEqual(direct.toDict());
  });

  it("test_short_link_to_bookmark", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setResolveShortLink(
      () => "https://mixpanel.com/project/12345/app/insights#report/123",
    );
    mock.setGetBookmark(() => BOOKMARK_RAW);

    const resolved = await ws.resolveReportLink(SHORT);

    expect(resolved.source).toBe("bookmark");
    expect(resolved.bookmark_id).toBe(123);
    expect(resolved.expanded_url).toBe(
      "https://mixpanel.com/project/12345/app/insights#report/123",
    );
  });

  it("test_short_link_chain_raises", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setResolveShortLink(() => "https://mixpanel.com/s/XyZ");

    const exc = await raises(
      ws.resolveReportLink(SHORT),
      ShortLinkResolutionError,
    );

    expect(exc.code).toBe("SHORT_LINK_CHAIN");
    const details = detailsOf(exc);
    expect(details["hint"]).toBe("Resolve the target shortlink directly.");
    expect(details["target"]).toBe("https://mixpanel.com/s/XyZ");
    expect(mock.resolveShortLinkCalls).toHaveLength(1);
    expect(mock.getBookmarkUrlCalls).toHaveLength(0);
  });

  it("test_short_link_to_dashboard_unsupported", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setResolveShortLink(
      () => "https://mixpanel.com/project/12345/app/boards#id=555",
    );

    const exc = await raises(
      ws.resolveReportLink(SHORT),
      UnsupportedReportLinkError,
    );

    expect(exc.code).toBe("UNSUPPORTED_DASHBOARD_LINK");
    expect(mock.getBookmarkUrlCalls).toHaveLength(0);
  });

  it("test_short_link_target_in_other_project", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setResolveShortLink(
      () => `https://mixpanel.com/project/3/app/insights#${SLUG}`,
    );

    const exc = await raises(
      ws.resolveReportLink(SHORT),
      ReportLinkScopeMismatchError,
    );

    expect(exc.code).toBe("REPORT_LINK_PROJECT_MISMATCH");
    expect(mock.getBookmarkUrlCalls).toHaveLength(0);
    expect(mock.getBookmarkCalls).toHaveLength(0);
  });

  it("test_short_link_region_mismatch_before_network", async () => {
    const { ws, mock } = makeWorkspace();

    const exc = await raises(
      ws.resolveReportLink("https://eu.mixpanel.com/s/AbC123"),
      ReportLinkScopeMismatchError,
    );

    expect(exc.code).toBe("REPORT_LINK_REGION_MISMATCH");
    expect(mock.resolveShortLinkCalls).toHaveLength(0);
  });

  it("test_short_link_errors_propagate", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setResolveShortLink(() => {
      throw new ReportLinkNotFoundError("gone", {
        code: "SHORT_LINK_NOT_FOUND",
      });
    });

    const exc = await raises(
      ws.resolveReportLink(SHORT),
      ReportLinkNotFoundError,
    );

    expect(exc.code).toBe("SHORT_LINK_NOT_FOUND");
  });

  it("test_query_report_link_through_short_link", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setResolveShortLink(() => SHORT_TARGET);
    mock.setGetBookmarkUrl(() => slugRecord());

    const result = await ws.queryReportLink(SHORT);

    expect(result).toBeInstanceOf(QueryResult);
    // The expanded target names /view/75/, so the report runs under 75.
    expect(mock.insightsCalls).toHaveLength(1);
    const call = mock.insightsCalls[0]!;
    expect(call.body["bookmark"]).toEqual(INSIGHTS_PARAMS);
    expect(call.body["project_id"]).toBe(12345);
    expect(call.scope).toEqual({
      workspace_id: 75,
      inject_workspace_id: false,
    });
  });
});

// =============================================================================
// saved_report_link (US5)
// =============================================================================

describe("TestSavedReportLink (test_workspace_report_links.py:1250)", () => {
  it.each<[BookmarkType, string]>([
    ["insights", "insights#report/123"],
    ["funnels", "funnels#view/123"],
    ["retention", "retention#report/123"],
    ["flows", "flows#report/123"],
    ["launch-analysis", "impact#report/123"],
  ])("test_url_shape_per_type[%s]", (reportType, tail) => {
    const { ws, mock } = makeWorkspace();

    const url = ws.savedReportLink(123, { report_type: reportType });

    expect(url).toBe(`https://mixpanel.com/project/12345/app/${tail}`);
    expect(mock.methodCalls).toEqual([]);
  });

  it("test_default_type_is_insights", () => {
    const { ws } = makeWorkspace();

    expect(ws.savedReportLink(123)).toBe(
      "https://mixpanel.com/project/12345/app/insights#report/123",
    );
  });

  it("test_singular_funnel_normalizes", () => {
    const { ws } = makeWorkspace();

    expect(ws.savedReportLink(456, { report_type: "funnel" })).toBe(
      "https://mixpanel.com/project/12345/app/funnels#view/456",
    );
  });

  it("test_explicit_workspace", () => {
    const { ws, mock } = makeWorkspace();

    const url = ws.savedReportLink(123, { workspace_id: 5 });

    expect(url).toBe(
      "https://mixpanel.com/project/12345/view/5/app/insights#report/123",
    );
    expect(mock.resolveWorkspaceIdCalls).toHaveLength(0);
  });

  it("test_pinned_workspace", () => {
    const { ws, mock } = makeWorkspace({ session: PINNED_SESSION });

    const url = ws.savedReportLink(123);

    expect(url).toContain("/view/75/");
    expect(mock.resolveWorkspaceIdCalls).toHaveLength(0);
  });

  it("test_explicit_beats_pinned", () => {
    const { ws } = makeWorkspace({ session: PINNED_SESSION });

    expect(ws.savedReportLink(123, { workspace_id: 5 })).toContain("/view/5/");
  });

  it("test_no_workspace_is_omitted_never_resolved", () => {
    const { ws, mock } = makeWorkspace();

    const url = ws.savedReportLink(123);

    expect(url).not.toContain("/view/");
    expect(mock.resolveWorkspaceIdCalls).toHaveLength(0);
  });

  it("test_eu_session_host", () => {
    const { ws } = makeWorkspace({ session: EU_SESSION });

    expect(ws.savedReportLink(123).startsWith("https://eu.mixpanel.com/")).toBe(
      true,
    );
  });

  it("test_unknown_type_raises_rl1", () => {
    const { ws } = makeWorkspace();

    let caught: unknown = null;
    try {
      // `# type: ignore[arg-type]` — an out-of-union literal on purpose.
      ws.savedReportLink(123, {
        report_type: "boards" as unknown as BookmarkType,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ParamValidationError);
    expect((caught as ParamValidationError).code).toBe(
      "RL1_UNKNOWN_REPORT_TYPE",
    );
  });

  it("test_client_records_zero_calls", () => {
    const { ws, mock } = makeWorkspace();

    ws.savedReportLink(1);
    ws.savedReportLink(2, { report_type: "flows", workspace_id: 3 });

    expect(mock.methodCalls).toEqual([]);
  });
});

// =============================================================================
// review follow-ups (PR #223)
// =============================================================================

describe("TestQueryReportLinkScopeOnResolvedInput (test_workspace_report_links.py:1360)", () => {
  it("test_project_mismatch_raises_before_query", async () => {
    const { ws, mock } = makeWorkspace();
    const resolved = resolvedReport("insights", INSIGHTS_PARAMS, {
      project_id: 3,
    });

    const exc = await raises(
      ws.queryReportLink(resolved),
      ReportLinkScopeMismatchError,
    );

    expect(exc.code).toBe("REPORT_LINK_PROJECT_MISMATCH");
    const details = detailsOf(exc);
    expect(details["link_project_id"]).toBe(3);
    expect(details["session_project_id"]).toBe(12345);
    expect(details["hint"] as string).toContain('ws.use(project="3")');
    expect(mock.insightsCalls).toHaveLength(0);
  });

  it("test_region_mismatch_raises_before_query", async () => {
    const { ws, mock } = makeWorkspace();
    const resolved = resolvedReport("insights", INSIGHTS_PARAMS, {
      region: "eu",
    });

    const exc = await raises(
      ws.queryReportLink(resolved),
      ReportLinkScopeMismatchError,
    );

    expect(exc.code).toBe("REPORT_LINK_REGION_MISMATCH");
    expect(mock.insightsCalls).toHaveLength(0);
  });

  it("test_matching_scope_runs", async () => {
    const { ws, mock } = makeWorkspace();

    const result = await ws.queryReportLink(
      resolvedReport("insights", INSIGHTS_PARAMS),
    );

    expect(result).toBeInstanceOf(QueryResult);
    expect(mock.insightsCalls).toHaveLength(1);
  });

  it("test_scope_checked_after_use_switch", async () => {
    // The Python fixture shares ONE mock client between both Workspaces.
    const { ws, mock } = makeWorkspace();
    mock.setGetBookmarkUrl(() => slugRecord());
    const resolved = await ws.resolveReportLink(SLUG);

    const { ws: other } = makeWorkspace(
      { session: { ...TEST_SESSION, project: { id: "777" } } },
      mock,
    );

    await raises(other.queryReportLink(resolved), ReportLinkScopeMismatchError);

    expect(mock.insightsCalls).toHaveLength(0);
  });
});

describe("TestCreateReportLinkValidatesBeforePost (test_workspace_report_links.py:1433)", () => {
  it.each([0, -1])(
    "test_non_positive_workspace_id_raises_before_post[%i]",
    async (workspaceId) => {
      const { ws, mock } = makeWorkspace();

      const exc = await raises(
        ws.createReportLink(INSIGHTS_PARAMS, {
          workspace_id: workspaceId,
          validate: false,
        }),
        ParamValidationError,
      );

      expect(exc.code).toBe("RL6_INVALID_ID");
      expect(mock.createBookmarkUrlCalls).toHaveLength(0);
    },
  );
});

describe("TestResolveSlugWithUnknownServerType (test_workspace_report_links.py:1450)", () => {
  it("test_unknown_type_falls_back_to_parsed_app", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setGetBookmarkUrl(() => slugRecord({ type: "user" }));

    const resolved = await ws.resolveReportLink(
      `https://mixpanel.com/project/12345/app/insights#${SLUG}`,
    );

    expect(resolved.report_type).toBe("user");
    expect(resolved.url).toBe(
      `https://mixpanel.com/project/12345/app/insights#${SLUG}`,
    );
  });

  it("test_unknown_type_on_bare_slug_defaults_to_insights_app", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setGetBookmarkUrl(() => slugRecord({ type: "user" }));

    const resolved = await ws.resolveReportLink(SLUG);

    expect(resolved.url).toBe(
      `https://mixpanel.com/project/12345/app/insights#${SLUG}`,
    );
  });

  it("test_unknown_type_logs_a_warning", async () => {
    const { ws, mock, log } = makeWorkspace();
    mock.setGetBookmarkUrl(() => slugRecord({ type: "user" }));

    await ws.resolveReportLink(SLUG);

    expect(
      log.warnings.some(
        (m) =>
          m.includes("unknown report type 'user'") && m.includes("insights"),
      ),
    ).toBe(true);
  });

  it("test_unknown_type_cannot_run", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setGetBookmarkUrl(() => slugRecord({ type: "user" }));

    const exc = await raises(
      ws.queryReportLink(SLUG),
      UnsupportedReportLinkError,
    );

    expect(exc.code).toBe("UNSUPPORTED_REPORT_TYPE");
  });
});

describe("TestWorkspaceScope (test_workspace_report_links.py:1489)", () => {
  it("test_url_workspace_differs_from_pinned_raises_before_fetch", async () => {
    const { ws, mock } = makeWorkspace({ session: PINNED_SESSION });

    const exc = await raises(
      ws.resolveReportLink(
        `https://mixpanel.com/project/12345/view/9/app/insights#${SLUG}`,
      ),
      ReportLinkScopeMismatchError,
    );

    expect(exc.code).toBe("REPORT_LINK_WORKSPACE_MISMATCH");
    const details = detailsOf(exc);
    expect(details["link_workspace_id"]).toBe(9);
    expect(details["session_workspace_id"]).toBe(75);
    expect(details["hint"]).toBe(
      "Switch with ws.use(workspace=9) (CLI: mp --workspace 9 ...) and retry.",
    );
    expect(mock.getBookmarkUrlCalls).toHaveLength(0);
  });

  it("test_url_workspace_equal_to_pinned_is_fine", async () => {
    const { ws, mock } = makeWorkspace({ session: PINNED_SESSION });
    mock.setGetBookmarkUrl(() => slugRecord());

    const resolved = await ws.resolveReportLink(
      `https://mixpanel.com/project/12345/view/75/app/insights#${SLUG}`,
    );

    expect(resolved.workspace_id).toBe(75);
  });

  it("test_unpinned_session_accepts_any_url_workspace", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setGetBookmarkUrl(() => slugRecord());

    const resolved = await ws.resolveReportLink(
      `https://mixpanel.com/project/12345/view/9/app/insights#${SLUG}`,
    );

    expect(resolved.workspace_id).toBe(9);
  });

  it("test_resolved_report_workspace_differs_from_pinned_raises", async () => {
    const { ws, mock } = makeWorkspace({ session: PINNED_SESSION });
    const resolved = resolvedReport("insights", INSIGHTS_PARAMS, {
      workspace_id: 9,
    });

    const exc = await raises(
      ws.queryReportLink(resolved),
      ReportLinkScopeMismatchError,
    );

    expect(exc.code).toBe("REPORT_LINK_WORKSPACE_MISMATCH");
    expect(mock.insightsCalls).toHaveLength(0);
  });

  it("test_resolved_report_without_workspace_runs_project_wide_on_pinned_session", async () => {
    // Greptile P1 on PR #223: a later `use(workspace=...)` must not leak
    // its data view into a report that was resolved without one.
    const { ws, mock } = makeWorkspace({ session: PINNED_SESSION });

    const result = await ws.queryReportLink(
      resolvedReport("insights", INSIGHTS_PARAMS),
    );

    expect(result).toBeInstanceOf(QueryResult);
    expect(mock.insightsCalls).toHaveLength(1);
    const call = mock.insightsCalls[0]!;
    expect(call.body["bookmark"]).toEqual(INSIGHTS_PARAMS);
    expect(call.body["project_id"]).toBe(12345);
    expect(call.scope).toEqual(PROJECT_WIDE_SCOPE);
  });

  it("test_resolve_unpinned_then_pin_then_run_stays_project_wide", async () => {
    const { ws: wsA, mock } = makeWorkspace({ session: TEST_SESSION });
    mock.setGetBookmarkUrl(() => slugRecord());
    const resolved = await wsA.resolveReportLink(SLUG);
    expect(resolved.workspace_id).toBeNull();

    const { ws: wsB } = makeWorkspace({ session: PINNED_SESSION }, mock);

    await wsB.queryReportLink(resolved);

    expect(mock.insightsCalls).toHaveLength(1);
    const call = mock.insightsCalls[0]!;
    expect(call.body["bookmark"]).toEqual(INSIGHTS_PARAMS);
    expect(call.body["project_id"]).toBe(12345);
    expect(call.scope).toEqual(PROJECT_WIDE_SCOPE);
  });

  it("test_resolved_workspace_is_applied_when_session_is_unpinned", async () => {
    // Greptile P1 on PR #223: a pin-clearing `use(project=...)` must not
    // silently turn a data-view report into a project-wide one.
    const { ws: wsA, mock } = makeWorkspace({ session: PINNED_SESSION });
    mock.setGetBookmarkUrl(() => slugRecord());
    const resolved = await wsA.resolveReportLink(SLUG);
    expect(resolved.workspace_id).toBe(75);

    const { ws: wsB } = makeWorkspace({ session: TEST_SESSION }, mock);

    const result = await wsB.queryReportLink(resolved);

    expect(result).toBeInstanceOf(QueryResult);
    expect(mock.insightsCalls).toHaveLength(1);
    const call = mock.insightsCalls[0]!;
    expect(call.body["bookmark"]).toEqual(INSIGHTS_PARAMS);
    expect(call.body["project_id"]).toBe(12345);
    expect(call.scope).toEqual({
      workspace_id: 75,
      inject_workspace_id: false,
    });
  });

  it("test_url_workspace_is_applied_when_session_is_unpinned", async () => {
    const { ws, mock } = makeWorkspace();
    mock.setGetBookmarkUrl(() => slugRecord());

    await ws.queryReportLink(
      `https://mixpanel.com/project/12345/view/9/app/insights#${SLUG}`,
    );

    expect(mock.insightsCalls).toHaveLength(1);
    const call = mock.insightsCalls[0]!;
    expect(call.body["bookmark"]).toEqual(INSIGHTS_PARAMS);
    expect(call.body["project_id"]).toBe(12345);
    expect(call.scope).toEqual({ workspace_id: 9, inject_workspace_id: false });
  });

  it("test_pinned_workspace_is_recorded_and_applied", async () => {
    const { ws, mock } = makeWorkspace({ session: PINNED_SESSION });
    mock.setGetBookmarkUrl(() => slugRecord());

    await ws.queryReportLink(SLUG);

    expect(mock.insightsCalls).toHaveLength(1);
    const call = mock.insightsCalls[0]!;
    expect(call.body["bookmark"]).toEqual(INSIGHTS_PARAMS);
    expect(call.body["project_id"]).toBe(12345);
    expect(call.scope).toEqual({
      workspace_id: 75,
      inject_workspace_id: false,
    });
  });

  it("test_scope_checked_after_use_workspace_switch", async () => {
    const { ws: wsA, mock } = makeWorkspace({ session: PINNED_SESSION });
    mock.setGetBookmarkUrl(() => slugRecord());
    const resolved = await wsA.resolveReportLink(SLUG);
    expect(resolved.workspace_id).toBe(75);

    const { ws: wsB } = makeWorkspace(
      { session: { ...TEST_SESSION, workspace: { id: 9 } } },
      mock,
    );

    await raises(wsB.queryReportLink(resolved), ReportLinkScopeMismatchError);

    expect(mock.insightsCalls).toHaveLength(0);
  });
});
