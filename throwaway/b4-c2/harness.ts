/**
 * B4-C2 R10.9 throwaway harness (packet C2 §R10.9 spec): the §Wire-rule
 * status-branch list through `segmentation` (query-host representative)
 * AND `export_events` (streaming representative: 429-then-success
 * mid-export, exhausted-429 with the `:1883-1891` reduced shape,
 * malformed JSONL line skipped, empty-body stream, non-BMP "𝒳" inside
 * event JSON, pythonConstants NaN line), plus `export_profiles_page`
 * paging termination, `export_profiles` loop termination, and
 * `engage_stats` param encoding with the fixed edge values (`18.0`,
 * `1.5`, `True`, `None`, `[]`, `""`, `"𝒳"`). Every owned registry error
 * branch enumerated: AC2/AC3/AC4/AC5/AC6, WR2/WR3, and the
 * activity-feed QueryError guards.
 *
 * Wire methods have no oracle bridge (P3-2 c), so this harness IS the
 * differential: expectations are transcribed from the Python source
 * ranges cited in the packet. Run via `bash throwaway/b4-c2/run.sh`;
 * the RUN record lives in the Python repo notes file
 * (`context/phase3/notes/B4-C2-notes.md`).
 */

import {
  createMixpanelClient,
  type MixpanelClient,
} from "../../packages/core/src/client/client.js";
import {
  JsonNumber,
  toNativeJson,
} from "../../packages/core/src/client/json-value.js";
import type { Session } from "../../packages/core/src/auth/session.js";
import { Secret } from "../../packages/core/src/secret.js";
import {
  AuthenticationError,
  MixpanelHeadlessError,
  ParamValidationError,
  QueryError,
  RateLimitError,
  ServerError,
  SessionReplayAccessError,
} from "../../packages/core/src/errors.js";
import {
  streamEvents,
  validateLimit,
} from "../../packages/core/src/services/queries/streaming.js";

// ---------------------------------------------------------------------------
// Mini transport (C1 harness pattern).
// ---------------------------------------------------------------------------

interface Captured {
  method: string;
  url: string;
  params: Record<string, string>;
  headers: Record<string, string>;
  bodyText: string;
}

interface Canned {
  status: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
  reject?: "transport";
}

function transportFor(handler: (req: Captured) => Canned): {
  fetch: typeof fetch;
  captures: Captured[];
} {
  const captures: Captured[] = [];
  const impl = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const params: Record<string, string> = {};
    for (const [key, value] of url.searchParams.entries()) {
      params[key] = value;
    }
    const headers: Record<string, string> = {};
    for (const [key, value] of request.headers.entries()) {
      headers[key.toLowerCase()] = value;
    }
    const captured: Captured = {
      method: request.method,
      url: request.url,
      params,
      headers,
      bodyText: await request.text(),
    };
    captures.push(captured);
    const canned = handler(captured);
    if (canned.reject === "transport") {
      const cause = new Error("connection refused") as Error & {
        code: string;
      };
      cause.code = "ECONNREFUSED";
      throw new TypeError("fetch failed", { cause });
    }
    const responseHeaders = new Headers(canned.headers ?? {});
    let body: string | null = null;
    if (canned.json !== undefined) {
      body = JSON.stringify(canned.json);
      if (!responseHeaders.has("content-type")) {
        responseHeaders.set("content-type", "application/json");
      }
    } else if (canned.text !== undefined) {
      body = canned.text;
    }
    if ([204, 205, 304].includes(canned.status)) {
      body = null;
    }
    return new Response(body, {
      status: canned.status,
      headers: responseHeaders,
    });
  }) as typeof fetch;
  return { fetch: impl, captures };
}

function session(): Session {
  return {
    account: {
      type: "service_account",
      name: "harness",
      region: "us",
      username: "test_user",
      secret: new Secret("test_secret"),
    },
    project: { id: "12345" },
    workspace: null,
    headers: new Map(),
  };
}

function client(
  handler: (req: Captured) => Canned,
  extra: { maxRetries?: number } = {},
): { c: MixpanelClient; captures: Captured[]; sleeps: number[] } {
  const t = transportFor(handler);
  const sleeps: number[] = [];
  const c = createMixpanelClient({
    session: session(),
    fetch: t.fetch,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    random: () => 0,
    ...(extra.maxRetries !== undefined ? { maxRetries: extra.maxRetries } : {}),
  });
  return { c, captures: t.captures, sleeps };
}

async function drain(source: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const item of source) {
    out.push(item);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tally.
// ---------------------------------------------------------------------------

const results: { branch: string; ok: boolean; detail: string }[] = [];

function record(branch: string, ok: boolean, detail = ""): void {
  results.push({ branch, ok, detail });
  if (!ok) {
    console.error(`FAIL ${branch}: ${detail}`);
  }
}

async function expectOk(
  branch: string,
  run: () => Promise<unknown>,
  check: (value: unknown) => boolean,
): Promise<void> {
  try {
    const value = await run();
    record(branch, check(value), `returned ${JSON.stringify(value)}`);
  } catch (cause) {
    record(branch, false, `unexpected raise: ${String(cause)}`);
  }
}

async function expectErr(
  branch: string,
  run: () => Promise<unknown>,
  check: (cause: unknown) => boolean,
): Promise<void> {
  try {
    const value = await run();
    record(branch, false, `unexpected return: ${JSON.stringify(value)}`);
  } catch (cause) {
    record(branch, check(cause), `raised ${String(cause)}`);
  }
}

// ---------------------------------------------------------------------------
// 1. §Wire status-branch matrix through segmentation (query-host).
// ---------------------------------------------------------------------------

async function segmentationMatrix(): Promise<void> {
  const seg = (
    handler: (req: Captured) => Canned,
    extra: { maxRetries?: number } = {},
  ): Promise<unknown> =>
    client(handler, extra).c.segmentation("Login", "2024-01-01", "2024-01-31");

  await expectOk(
    "seg/200-object",
    () => seg(() => ({ status: 200, json: { data: { values: {} } } })),
    (v) => typeof v === "object" && v !== null && Object.hasOwn(v, "data"),
  );
  await expectOk(
    "seg/200-array",
    () => seg(() => ({ status: 200, json: [1, 2] })),
    (v) => Array.isArray(v) && v.length === 2,
  );
  await expectOk(
    "seg/200-scalar",
    () => seg(() => ({ status: 200, json: 42 })),
    (v) => v instanceof JsonNumber && v.raw === "42",
  );
  await expectErr(
    "seg/200-non-JSON→INVALID_RESPONSE",
    () => seg(() => ({ status: 200, text: "<html>nope</html>" })),
    (e) =>
      e instanceof MixpanelHeadlessError &&
      !(e instanceof QueryError) &&
      e.code === "INVALID_RESPONSE",
  );
  await expectErr(
    "seg/3xx-with-JSON-body→HTTP_ERROR (R2.11)",
    () =>
      seg(() => ({
        status: 302,
        json: { data: {} },
        headers: { location: "https://mixpanel.com/elsewhere" },
      })),
    (e) => e instanceof MixpanelHeadlessError && e.code === "HTTP_ERROR",
  );
  await expectErr(
    "seg/400→QueryError",
    () => seg(() => ({ status: 400, json: { error: "bad query" } })),
    (e) =>
      e instanceof QueryError &&
      e.statusCode === 400 &&
      e.message === "bad query",
  );
  await expectErr(
    "seg/401→AuthenticationError",
    () => seg(() => ({ status: 401, json: { error: "nope" } })),
    (e) => e instanceof AuthenticationError && e.statusCode === 401,
  );
  await expectErr(
    "seg/403-plain→QueryError",
    () => seg(() => ({ status: 403, json: { error: "forbidden" } })),
    (e) => e instanceof QueryError && e.statusCode === 403,
  );
  await expectErr(
    "seg/403-sensitive-data→SessionReplayAccessError",
    () =>
      seg(() => ({
        status: 403,
        json: { error: "SESSION_RECORDING_SENSITIVE_DATA blocked" },
      })),
    (e) =>
      e instanceof SessionReplayAccessError &&
      String(e.details["project_id"]) === "12345",
  );
  await expectErr(
    "seg/404→QueryError",
    () => seg(() => ({ status: 404, json: { error: "missing" } })),
    (e) => e instanceof QueryError && e.statusCode === 404,
  );
  await expectErr(
    "seg/other-4xx(412)→QueryError",
    () => seg(() => ({ status: 412, json: { error: "precondition" } })),
    (e) => e instanceof QueryError && e.statusCode === 412,
  );
  {
    let calls = 0;
    await expectOk(
      "seg/429-retry-then-success",
      () =>
        seg((_req) => {
          calls += 1;
          return calls === 1
            ? { status: 429, headers: { "Retry-After": "1" } }
            : { status: 200, json: { ok: true } };
        }),
      (v) =>
        calls === 2 &&
        typeof v === "object" &&
        v !== null &&
        Object.hasOwn(v, "ok"),
    );
  }
  await expectErr(
    "seg/429-exhausted carries project_id (FF4)",
    () =>
      seg(() => ({ status: 429, headers: { "Retry-After": "1" } }), {
        maxRetries: 1,
      }),
    (e) =>
      e instanceof RateLimitError &&
      e.projectId === "12345" &&
      e.retryAfter === 1,
  );
  await expectErr(
    "seg/5xx→ServerError",
    () => seg(() => ({ status: 500, json: { error: "boom" } })),
    (e) => e instanceof ServerError && e.statusCode === 500,
  );
  await expectErr(
    "seg/network-error→HTTP_ERROR",
    () => seg(() => ({ status: 0, reject: "transport" })),
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.code === "HTTP_ERROR" &&
      String(e.details["error"]).includes("connection refused"),
  );
  // The 204/422 "app" analogues run through C2's app-routed query-host
  // method (list_bookmarks — `_request` on an App URL). NOTE: the
  // 204→{status:"ok"} mapping is app_request-ONLY (B0; exercised by the
  // C1 harness); through `_request`/`_handle_response` a bodyless 204
  // is `response.json()` → JSONDecodeError → INVALID_RESPONSE
  // (`api_client.py:655-662`), and the TS twin reproduces that.
  await expectErr(
    "listBookmarks/204 via _request → INVALID_RESPONSE",
    () => client(() => ({ status: 204 })).c.listBookmarks(),
    (e) =>
      e instanceof MixpanelHeadlessError &&
      !(e instanceof QueryError) &&
      e.code === "INVALID_RESPONSE",
  );
  await expectErr(
    "listBookmarks/422→QueryError",
    () =>
      client(() => ({
        status: 422,
        json: { error: "unprocessable" },
      })).c.listBookmarks(),
    (e) => e instanceof QueryError && e.statusCode === 422,
  );
}

// ---------------------------------------------------------------------------
// 2. Streaming representative: export_events.
// ---------------------------------------------------------------------------

async function exportEventsMatrix(): Promise<void> {
  const run = (
    handler: (req: Captured) => Canned,
    extra: { maxRetries?: number } = {},
  ): { events: Promise<unknown[]>; ctx: ReturnType<typeof client> } => {
    const ctx = client(handler, extra);
    return {
      events: drain(ctx.c.exportEvents("2024-01-01", "2024-01-31")),
      ctx,
    };
  };

  await expectOk(
    "exp/200-two-lines",
    () =>
      run(() => ({
        status: 200,
        text: '{"event":"A","properties":{}}\n{"event":"B","properties":{}}\n',
      })).events,
    (v) => Array.isArray(v) && v.length === 2,
  );
  {
    let calls = 0;
    const { events, ctx } = run((_req) => {
      calls += 1;
      return calls === 1
        ? { status: 429, headers: { "Retry-After": "2" } }
        : { status: 200, text: '{"event":"A","properties":{}}\n' };
    });
    await expectOk(
      "exp/429-then-success mid-export",
      () => events,
      (v) =>
        Array.isArray(v) &&
        v.length === 1 &&
        calls === 2 &&
        ctx.sleeps.length === 1 &&
        ctx.sleeps[0] === 2000,
    );
  }
  await expectErr(
    "exp/429-exhausted reduced shape (:1883-1891)",
    () =>
      run(() => ({ status: 429, headers: { "Retry-After": "3" } }), {
        maxRetries: 1,
      }).events,
    (e) =>
      e instanceof RateLimitError &&
      e.projectId === "12345" &&
      e.retryAfter === 3 &&
      !Object.hasOwn(e.details, "response_body") &&
      Object.hasOwn(e.details, "request_params") &&
      e.details["request_method"] === "GET",
  );
  await expectErr(
    "exp/401→AuthenticationError",
    () => run(() => ({ status: 401 })).events,
    (e) => e instanceof AuthenticationError && e.statusCode === 401,
  );
  await expectErr(
    "exp/400-json-body→QueryError",
    () => run(() => ({ status: 400, json: { error: "bad export" } })).events,
    (e) =>
      e instanceof QueryError &&
      e.message === "bad export" &&
      toNativeJson(e.responseBody as never) !== null,
  );
  await expectErr(
    "exp/400-non-json-body→QueryError (cp-500 slice)",
    () => run(() => ({ status: 400, text: "x".repeat(600) })).events,
    (e) =>
      e instanceof QueryError &&
      typeof e.responseBody === "string" &&
      e.responseBody.length === 500,
  );
  await expectOk(
    "exp/malformed-line-skipped",
    () =>
      run(() => ({
        status: 200,
        text: '{"event":"A","properties":{}}\nNOT JSON\n{"event":"B","properties":{}}\n',
      })).events,
    (v) => Array.isArray(v) && v.length === 2,
  );
  await expectOk(
    "exp/empty-body-stream",
    () => run(() => ({ status: 200, text: "" })).events,
    (v) => Array.isArray(v) && v.length === 0,
  );
  await expectOk(
    "exp/non-BMP 𝒳 line round-trip",
    () =>
      run(() => ({
        status: 200,
        text: '{"event":"𝒳","properties":{"name":"𝒳"}}\n',
      })).events,
    (v) =>
      Array.isArray(v) &&
      (toNativeJson(v[0] as never) as { event: string }).event === "𝒳",
  );
  await expectOk(
    "exp/pythonConstants NaN line",
    () =>
      run(() => ({
        status: 200,
        text: '{"event":"A","properties":{"x":NaN,"y":-Infinity}}\n',
      })).events,
    (v) => {
      const props = (v as Array<{ properties: Record<string, unknown> }>)[0]
        ?.properties as Record<string, unknown>;
      return (
        Number.isNaN(props["x"] as number) &&
        props["y"] === Number.NEGATIVE_INFINITY
      );
    },
  );
  {
    let calls = 0;
    await expectErr(
      "exp/5xx retries → HTTP_ERROR",
      () =>
        run(
          () => {
            calls += 1;
            return { status: 500, json: { error: "boom" } };
          },
          { maxRetries: 1 },
        ).events,
      (e) =>
        calls === 2 &&
        e instanceof MixpanelHeadlessError &&
        e.code === "HTTP_ERROR" &&
        String(e.message).startsWith("HTTP error during export:"),
    );
  }
  await expectErr(
    "exp/3xx → raise_for_status analog → HTTP_ERROR",
    () =>
      run(() => ({ status: 302, headers: { location: "https://x" } }), {
        maxRetries: 0,
      }).events,
    (e) => e instanceof MixpanelHeadlessError && e.code === "HTTP_ERROR",
  );
  await expectErr(
    "exp/network-error retries → HTTP_ERROR",
    () =>
      run(() => ({ status: 0, reject: "transport" }), { maxRetries: 1 }).events,
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.code === "HTTP_ERROR" &&
      String(e.details["error"]).includes("connection refused"),
  );
  // Edge values through the export param encoding: events list with 𝒳
  // and "", where "" (falsy → omitted), limit present.
  {
    const ctx = client(() => ({ status: 200, text: "" }));
    await expectOk(
      "exp/edge-params (𝒳 event list, empty where omitted, limit)",
      async () => {
        await drain(
          ctx.c.exportEvents("2024-01-01", "2024-01-31", {
            events: ["𝒳", ""],
            where: "",
            limit: 18,
          }),
        );
        return ctx.captures[0];
      },
      (captured) => {
        const req = captured as Captured;
        return (
          req.params["event"] === '["\\ud835\\udcb3", ""]' &&
          !Object.hasOwn(req.params, "where") &&
          req.params["limit"] === "18" &&
          req.headers["accept-encoding"] === "gzip"
        );
      },
    );
  }
}

// ---------------------------------------------------------------------------
// 3. export_profiles_page paging termination + export_profiles loop.
// ---------------------------------------------------------------------------

async function engagePaging(): Promise<void> {
  await expectOk(
    "epp/has_more-true when session_id present",
    async () => {
      const { c } = client(() => ({
        status: 200,
        json: {
          results: [{ $distinct_id: "u1" }],
          session_id: "s1",
          total: 2000,
          page_size: 1000,
        },
      }));
      const page = await c.exportProfilesPage(0);
      return [page.has_more, page.num_pages];
    },
    (v) => Array.isArray(v) && v[0] === true && v[1] === 2,
  );
  await expectOk(
    "epp/termination when session_id null",
    async () => {
      const { c } = client(() => ({
        status: 200,
        json: { results: [], session_id: null },
      }));
      const page = await c.exportProfilesPage(3);
      return [page.has_more, page.total, page.page_size, page.page];
    },
    (v) => JSON.stringify(v) === "[false,0,1000,3]",
  );
  {
    let calls = 0;
    await expectOk(
      "ep/loop terminates on empty results page",
      async () => {
        const { c } = client(() => {
          calls += 1;
          return calls === 1
            ? {
                status: 200,
                json: { results: [{ $distinct_id: "u1" }], session_id: "s1" },
              }
            : { status: 200, json: { results: [], session_id: "s2" } };
        });
        return drain(c.exportProfiles());
      },
      (v) => Array.isArray(v) && v.length === 1 && calls === 2,
    );
  }
  {
    let calls = 0;
    await expectOk(
      "ep/loop terminates on missing session_id",
      async () => {
        const { c } = client(() => {
          calls += 1;
          return {
            status: 200,
            json: { results: [{ $distinct_id: `u${calls}` }] },
          };
        });
        return drain(c.exportProfiles());
      },
      (v) => Array.isArray(v) && v.length === 1 && calls === 1,
    );
  }
  {
    // page/session_id threading across pages (request sequence shape).
    const bodies: Array<Record<string, unknown>> = [];
    let calls = 0;
    await expectOk(
      "ep/page+session threading",
      async () => {
        const { c } = client((req) => {
          calls += 1;
          bodies.push(JSON.parse(req.bodyText) as Record<string, unknown>);
          return calls < 3
            ? {
                status: 200,
                json: {
                  results: [{ $distinct_id: `u${calls}` }],
                  session_id: "sess",
                },
              }
            : { status: 200, json: { results: [], session_id: null } };
        });
        return drain(c.exportProfiles());
      },
      (v) =>
        Array.isArray(v) &&
        v.length === 2 &&
        bodies[0]?.["page"] === 0 &&
        !Object.hasOwn(bodies[0] ?? {}, "session_id") &&
        bodies[1]?.["page"] === 1 &&
        bodies[1]?.["session_id"] === "sess" &&
        bodies[2]?.["page"] === 2,
    );
  }
}

// ---------------------------------------------------------------------------
// 4. engage_stats param encoding with the fixed edge values.
// ---------------------------------------------------------------------------

async function engageStatsEncoding(): Promise<void> {
  {
    const bodies: Array<Record<string, unknown>> = [];
    await expectOk(
      "es/edge-value body encoding",
      async () => {
        const { c } = client((req) => {
          bodies.push(JSON.parse(req.bodyText) as Record<string, unknown>);
          return { status: 200, json: { results: [], total: 0 } };
        });
        await c.engageStats({
          where: "", // falsy → selector omitted
          filter_by_cohort: '{"id": 42}',
          segment_by_cohorts: { "𝒳": true, "": false },
          as_of_timestamp: 0, // `is not None` → SENT
          include_all_users: false, // sent (filter_by_cohort truthy)
        });
        return bodies[0];
      },
      (v) => {
        const body = v as Record<string, unknown>;
        return (
          !Object.hasOwn(body, "selector") &&
          body["action"] === "count()" &&
          body["filter_by_cohort"] === '{"id": 42}' &&
          body["segment_by_cohorts"] ===
            '{"\\ud835\\udcb3": true, "": false}' &&
          body["as_of_timestamp"] === 0 &&
          body["include_all_users"] === false &&
          body["project_id"] === "12345"
        );
      },
    );
  }
  await expectErr(
    "es/non-dict-200 → QueryError(status 200, str body)",
    async () => {
      const { c } = client(() => ({ status: 200, json: [1, 2, 3] }));
      return c.engageStats();
    },
    (e) =>
      e instanceof QueryError &&
      e.statusCode === 200 &&
      e.responseBody === "[1, 2, 3]",
  );
  {
    // event_counts / property_counts edge lists: 1.5 float, True, None,
    // [] — json.dumps spellings on the wire.
    const ctx = client(() => ({ status: 200, json: {} }));
    await expectOk(
      "counts/json.dumps edge spellings",
      async () => {
        await ctx.c.eventCounts(
          ["𝒳"] as unknown as readonly string[],
          "2024-01-01",
          "2024-01-31",
        );
        await ctx.c.propertyCounts("e", "p", "2024-01-01", "2024-01-31", {
          values: [1.5, true, null, ""] as unknown as readonly string[],
        });
        return ctx.captures.map((r) => r.params);
      },
      (v) => {
        const [first, second] = v as Array<Record<string, string>>;
        return (
          first?.["event"] === '["\\ud835\\udcb3"]' &&
          second?.["values"] === '[1.5, true, null, ""]'
        );
      },
    );
  }
}

// ---------------------------------------------------------------------------
// 5. Owned registry error branches.
// ---------------------------------------------------------------------------

async function ownedErrorBranches(): Promise<void> {
  const okClient = (): MixpanelClient =>
    client(() => ({ status: 200, json: { results: [] } })).c;

  const cases: Array<[string, () => Promise<unknown>, string]> = [
    [
      "AC2_DISTINCT_ID_CONFLICT",
      () =>
        drain(
          okClient().exportProfiles({
            distinct_id: "a",
            distinct_ids: ["b"],
          }),
        ),
      "AC2_DISTINCT_ID_CONFLICT",
    ],
    [
      "AC3_BEHAVIORS_COHORT_CONFLICT",
      () => drain(okClient().exportProfiles({ behaviors: [], cohort_id: "c" })),
      "AC3_BEHAVIORS_COHORT_CONFLICT",
    ],
    [
      "AC4_INCLUDE_ALL_USERS_REQUIRES_COHORT",
      () => drain(okClient().exportProfiles({ include_all_users: true })),
      "AC4_INCLUDE_ALL_USERS_REQUIRES_COHORT",
    ],
    [
      "AC5_BEHAVIORS_NOT_LIST",
      () =>
        drain(
          okClient().exportProfiles({
            behaviors: "x" as unknown as readonly unknown[],
          }),
        ),
      "AC5_BEHAVIORS_NOT_LIST",
    ],
    [
      "AC6_AS_OF_TIMESTAMP_FUTURE",
      () =>
        drain(
          okClient().exportProfiles({
            as_of_timestamp: Math.floor(Date.now() / 1000) + 5000,
          }),
        ),
      "AC6_AS_OF_TIMESTAMP_FUTURE",
    ],
  ];
  for (const [branch, run, code] of cases) {
    await expectErr(
      `codes/${branch}`,
      run,
      (e) => e instanceof ParamValidationError && e.code === code,
    );
  }

  // WR2/WR3 via the facade wrapper's validateLimit (both the direct
  // helper and the lazy generator path).
  await expectErr(
    "codes/WR2_LIMIT_TOO_SMALL",
    async () => {
      validateLimit(0);
    },
    (e) =>
      e instanceof ParamValidationError && e.code === "WR2_LIMIT_TOO_SMALL",
  );
  await expectErr(
    "codes/WR3_LIMIT_TOO_LARGE (lazy, on first next())",
    () =>
      drain(
        streamEvents(okClient(), {
          from_date: "2024-01-01",
          to_date: "2024-01-31",
          limit: 100001,
        }),
      ),
    (e) =>
      e instanceof ParamValidationError && e.code === "WR3_LIMIT_TOO_LARGE",
  );

  // Activity-feed QueryError guards (pre-wire raises).
  const pinned = (): MixpanelClient => {
    const { c } = client(() => ({ status: 200, json: { results: {} } }));
    c.setWorkspaceId(9);
    return c;
  };
  await expectErr(
    "af/include-exclude mutex → QueryError + request_params",
    () =>
      pinned().activityFeed(["u"], {
        include_events: ["A"],
        exclude_events: ["B"],
      }),
    (e) =>
      e instanceof QueryError &&
      JSON.stringify(e.requestParams) ===
        '{"include_events":["A"],"exclude_events":["B"]}',
  );
  await expectErr(
    "af/search_properties without search → QueryError",
    () => pinned().activityFeed(["u"], { search_properties: [] }),
    (e) => e instanceof QueryError,
  );
  await expectErr(
    "af/invalid from_date → QueryError",
    () => pinned().activityFeed(["u"], { from_date: "not-a-date" }),
    (e) => e instanceof QueryError,
  );
  await expectErr(
    "af/to_date too early (OverflowError arm) → QueryError",
    () => pinned().activityFeed(["u"], { to_date: "0001-01-10" }),
    (e) => e instanceof QueryError,
  );

  // get_events 403 gate: retry fires exactly once with today-N.
  {
    let calls = 0;
    const fromDates: string[] = [];
    await expectOk(
      "ge/403-gate retry once",
      async () => {
        const t = transportFor((req) => {
          calls += 1;
          const url = new URL(req.url);
          fromDates.push(url.searchParams.get("from_date") ?? "");
          return calls === 1
            ? {
                status: 403,
                json: { error: "Date range exceeds 45 days into the past" },
              }
            : { status: 200, json: ["e"] };
        });
        const c = createMixpanelClient({
          session: session(),
          fetch: t.fetch,
          sleep: async () => {},
          random: () => 0,
          now: () => new Date("2026-08-15T12:00:00Z"),
        });
        return c.getEvents();
      },
      (v) =>
        Array.isArray(v) &&
        calls === 2 &&
        fromDates[0] === "2000-01-01" &&
        fromDates[1] === "2026-07-01",
    );
  }
  // get_events str(e) casts on mixed-type element lists.
  await expectOk(
    "ge/str-cast elements (True/None/18.0/𝒳)",
    async () => {
      const { c } = client(() => ({
        status: 200,
        json: [true, null, 18.0, "𝒳", 1.5],
      }));
      return c.getEvents({ from_date: "2024-01-01", to_date: "2024-01-02" });
    },
    // json 18.0 serializes as 18 by JSON.stringify (harness limitation:
    // the canned body carries no float token) — the recorded-corpus
    // spelling path is exercised by the 317 vectors instead. 1.5 and the
    // Python True/None spellings ARE observable here.
    (v) => JSON.stringify(v) === '["True","None","18","𝒳","1.5"]',
  );
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await segmentationMatrix();
  await exportEventsMatrix();
  await engagePaging();
  await engageStatsEncoding();
  await ownedErrorBranches();

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log("");
  console.log("branch table:");
  for (const r of results) {
    console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.branch}`);
  }
  console.log("");
  console.log(
    `B4-C2 R10.9 harness: total=${results.length} pass=${passed} fail=${failed}`,
  );
  if (failed > 0) {
    process.exitCode = 1;
  }
}

await main();
