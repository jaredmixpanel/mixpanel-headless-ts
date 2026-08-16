/**
 * B4-C3 R10.9 throwaway harness (packet C3 §R10.9 spec): the §Wire-rule
 * status-branch list through `create_dashboard` (App-API
 * representative) — 200-object / 200-array / 200-scalar / 200-non-JSON /
 * 3xx / 400 / 401 / 403-plain / 403-sensitive-data + the applicable
 * R10.7 bug-compat rows / 404 / other-4xx / 422-app /
 * 429-retry-then-success / 429-exhausted / 5xx / 204-app /
 * network-error — plus a scoped-path method with workspace pinned vs
 * unpinned, 204-No-Content across the whole delete/void family,
 * `results`-unwrap vs `_raw` (get_bookmark_history shaping branches),
 * the v2/blueprint envelope branches, and the bulk-body/param edge
 * values (`[]`, floats, `True`, `None`, `""`, `"𝒳"`).
 *
 * Wire methods have no oracle bridge (P3-2 c), so this harness IS the
 * differential: expectations are transcribed from the Python source
 * ranges cited in the packet (`api_client.py:3650-4937`). Run via
 * `bash throwaway/b4-c3/run.sh`; the RUN record lives in the Python
 * repo notes file (`context/phase3/notes/B4-C3-notes.md`).
 */

import {
  createMixpanelClient,
  type MixpanelClient,
} from "../../packages/core/src/client/client.js";
import { toNativeJson } from "../../packages/core/src/client/json-value.js";
import type { Session } from "../../packages/core/src/auth/session.js";
import { Secret } from "../../packages/core/src/secret.js";
import {
  AuthenticationError,
  MixpanelHeadlessError,
  QueryError,
  RateLimitError,
  ServerError,
  SessionReplayAccessError,
} from "../../packages/core/src/errors.js";

// ---------------------------------------------------------------------------
// Mini transport (C1/C2 harness pattern).
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

function deepEq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function main(): Promise<void> {
  // -------------------------------------------------------------------------
  // 1. §Wire status-branch matrix through create_dashboard (App API).
  //    Python arbiter: api_client.py:3689-3722 over _handle_response
  //    :503-670 / app_request :1160-1389.
  // -------------------------------------------------------------------------

  await expectOk(
    "cd/200-object-results-unwrap",
    () =>
      client(() => ({
        status: 200,
        json: { status: "ok", results: { id: 7, title: "X" } },
      })).c.createDashboard({ title: "X" }),
    (v) => deepEq(toNativeJson(v), { id: 7, title: "X" }),
  );

  await expectErr(
    "cd/200-array-body-expected-dict",
    () => client(() => ({ status: 200, json: [1, 2] })).c.createDashboard({}),
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.message.includes("expected dict, got list"),
  );

  await expectErr(
    "cd/200-scalar-body-expected-dict-int",
    () => client(() => ({ status: 200, json: 42 })).c.createDashboard({}),
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.message.includes("expected dict, got int"),
  );

  await expectErr(
    "cd/200-scalar-null-expected-dict-NoneType",
    () => client(() => ({ status: 200, json: null })).c.createDashboard({}),
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.message.includes("expected dict, got NoneType"),
  );

  await expectErr(
    "cd/200-non-json-INVALID_RESPONSE",
    () =>
      client(() => ({
        status: 200,
        text: "<html>nope</html>",
      })).c.createDashboard({}),
    (e) => e instanceof MixpanelHeadlessError && e.code === "INVALID_RESPONSE",
  );

  await expectErr(
    "cd/3xx-json-body-HTTP_ERROR",
    () =>
      client(() => ({
        status: 302,
        json: { location: "elsewhere" },
      })).c.createDashboard({}),
    (e) => e instanceof MixpanelHeadlessError && e.code === "HTTP_ERROR",
  );

  await expectErr(
    "cd/400-QueryError",
    () =>
      client(() => ({ status: 400, json: { error: "bad" } })).c.createDashboard(
        {},
      ),
    (e) => e instanceof QueryError && e.statusCode === 400,
  );

  await expectErr(
    "cd/401-AuthenticationError",
    () =>
      client(() => ({ status: 401, json: { error: "no" } })).c.createDashboard(
        {},
      ),
    (e) => e instanceof AuthenticationError,
  );

  await expectErr(
    "cd/403-plain-QueryError",
    () =>
      client(() => ({
        status: 403,
        json: { error: "denied" },
      })).c.createDashboard({}),
    (e) => e instanceof QueryError && e.statusCode === 403,
  );

  await expectErr(
    "cd/403-sensitive-list-exact-element",
    () =>
      client(() => ({
        status: 403,
        json: ["SESSION_RECORDING_SENSITIVE_DATA"],
      })).c.createDashboard({}),
    (e) => e instanceof SessionReplayAccessError,
  );

  // R10.7 bug-compat rows reachable through an App-API method (the full
  // matrix re-runs through sign_replays at C5): truthy non-dict/non-str
  // scalar → TypeError analog; falsy scalar → QueryError; list
  // substring-miss → QueryError (exact-element membership only).
  await expectErr(
    "cd/403-bugcompat-42-TypeError",
    () => client(() => ({ status: 403, json: 42 })).c.createDashboard({}),
    (e) => e instanceof TypeError && !(e instanceof MixpanelHeadlessError),
  );

  await expectErr(
    "cd/403-bugcompat-1.5-TypeError",
    () => client(() => ({ status: 403, json: 1.5 })).c.createDashboard({}),
    (e) => e instanceof TypeError && !(e instanceof MixpanelHeadlessError),
  );

  await expectErr(
    "cd/403-bugcompat-true-TypeError",
    () => client(() => ({ status: 403, json: true })).c.createDashboard({}),
    (e) => e instanceof TypeError && !(e instanceof MixpanelHeadlessError),
  );

  await expectErr(
    "cd/403-bugcompat-0-QueryError",
    () => client(() => ({ status: 403, json: 0 })).c.createDashboard({}),
    (e) => e instanceof QueryError && e.statusCode === 403,
  );

  await expectErr(
    "cd/403-bugcompat-false-QueryError",
    () => client(() => ({ status: 403, json: false })).c.createDashboard({}),
    (e) => e instanceof QueryError && e.statusCode === 403,
  );

  await expectErr(
    "cd/403-bugcompat-null-QueryError",
    () => client(() => ({ status: 403, json: null })).c.createDashboard({}),
    (e) => e instanceof QueryError && e.statusCode === 403,
  );

  await expectErr(
    "cd/403-substring-miss-QueryError",
    () =>
      client(() => ({
        status: 403,
        json: ["xSESSION_RECORDING_SENSITIVE_DATAy"],
      })).c.createDashboard({}),
    (e) => e instanceof QueryError && e.statusCode === 403,
  );

  await expectErr(
    "cd/404-QueryError",
    () =>
      client(() => ({
        status: 404,
        json: { error: "nope" },
      })).c.createDashboard({}),
    (e) => e instanceof QueryError && e.statusCode === 404,
  );

  await expectErr(
    "cd/other-4xx-418-QueryError",
    () =>
      client(() => ({
        status: 418,
        json: { error: "teapot" },
      })).c.createDashboard({}),
    (e) => e instanceof QueryError && e.statusCode === 418,
  );

  await expectErr(
    "cd/422-app-QueryError",
    () =>
      client(() => ({
        status: 422,
        json: { error: "unprocessable" },
      })).c.createDashboard({}),
    (e) => e instanceof QueryError && e.statusCode === 422,
  );

  {
    let calls = 0;
    const { c, sleeps } = client(() => {
      calls += 1;
      if (calls === 1) {
        return {
          status: 429,
          json: { error: "slow down" },
          headers: { "Retry-After": "2" },
        };
      }
      return { status: 200, json: { status: "ok", results: { id: 1 } } };
    });
    await expectOk(
      "cd/429-retry-then-success",
      () => c.createDashboard({ title: "r" }),
      (v) =>
        deepEq(toNativeJson(v), { id: 1 }) &&
        calls === 2 &&
        // Advertised Retry-After path is UNJITTERED seconds→ms
        // (Discrepancy #1).
        sleeps.length === 1 &&
        sleeps[0] === 2000,
    );
  }

  {
    let calls = 0;
    const { c } = client(
      () => {
        calls += 1;
        return {
          status: 429,
          json: { error: "still" },
          headers: { "Retry-After": "1" },
        };
      },
      { maxRetries: 2 },
    );
    await expectErr(
      "cd/429-exhausted-RateLimitError",
      () => c.createDashboard({}),
      (e) => e instanceof RateLimitError && calls === 3,
    );
  }

  await expectErr(
    "cd/5xx-ServerError",
    () =>
      client(() => ({
        status: 500,
        json: { error: "boom" },
      })).c.createDashboard({}),
    (e) => e instanceof ServerError && e.statusCode === 500,
  );

  // 204 through a dict-returning method: app_request hands back
  // {"status": "ok"} — a dict, so remove_report_from_dashboard RETURNS
  // it (api_client.py:3959-4001 docstring's None arm is unreachable
  // through the isinstance guard).
  await expectOk(
    "cd/204-app-status-ok-dict",
    () => client(() => ({ status: 204 })).c.removeReportFromDashboard(1, 2),
    (v) => deepEq(toNativeJson(v), { status: "ok" }),
  );

  await expectErr(
    "cd/network-error-HTTP_ERROR",
    () =>
      client(() => ({ status: 0, reject: "transport" })).c.createDashboard({}),
    (e) => e instanceof MixpanelHeadlessError && e.code === "HTTP_ERROR",
  );

  // -------------------------------------------------------------------------
  // 2. Scoped path: pinned vs unpinned (maybe_scoped_path over the
  //    call-time pin, api_client.py:3677 / :1637-1664).
  // -------------------------------------------------------------------------

  {
    const { c, captures } = client(() => ({
      status: 200,
      json: { status: "ok", results: [] },
    }));
    await c.listDashboards();
    c.setWorkspaceId(789);
    await c.listDashboards();
    c.setWorkspaceId(null);
    await c.listDashboards();
    record(
      "scope/pin-lifecycle-project-workspace-project",
      captures.length === 3 &&
        captures[0]!.url.includes("/api/app/projects/12345/dashboards") &&
        captures[1]!.url.includes("/api/app/workspaces/789/dashboards") &&
        captures[2]!.url.includes("/api/app/projects/12345/dashboards"),
      captures.map((x) => x.url).join(" | "),
    );
  }

  // -------------------------------------------------------------------------
  // 3. 204 across the delete/void family (every void method returns
  //    undefined and swallows the {"status": "ok"} envelope).
  // -------------------------------------------------------------------------

  {
    const { c, captures } = client(() => ({ status: 204 }));
    const voids: Array<[string, () => Promise<void>, string, string]> = [
      [
        "delete_dashboard",
        () => c.deleteDashboard(5),
        "DELETE",
        "/dashboards/5",
      ],
      [
        "unfavorite_dashboard",
        () => c.unfavoriteDashboard(5),
        "DELETE",
        "/dashboards/5/favorites",
      ],
      [
        "unpin_dashboard",
        () => c.unpinDashboard(5),
        "DELETE",
        "/dashboards/5/pin",
      ],
      [
        "favorite_dashboard",
        () => c.favoriteDashboard(5),
        "POST",
        "/dashboards/5/favorites",
      ],
      ["pin_dashboard", () => c.pinDashboard(5), "POST", "/dashboards/5/pin"],
      [
        "bulk_delete_dashboards",
        () => c.bulkDeleteDashboards([1, 2]),
        "POST",
        "/dashboards/bulk-delete",
      ],
      ["delete_bookmark", () => c.deleteBookmark(6), "DELETE", "/bookmarks/6"],
      [
        "bulk_delete_bookmarks",
        () => c.bulkDeleteBookmarks([3]),
        "POST",
        "/bookmarks/bulk-delete",
      ],
      [
        "bulk_update_bookmarks",
        () => c.bulkUpdateBookmarks([{ id: 3 }]),
        "POST",
        "/bookmarks/bulk-update",
      ],
      ["delete_cohort", () => c.deleteCohort(7), "DELETE", "/cohorts/7"],
      [
        "bulk_delete_cohorts",
        () => c.bulkDeleteCohorts([4]),
        "POST",
        "/cohorts/bulk-delete",
      ],
      [
        "bulk_update_cohorts",
        () => c.bulkUpdateCohorts([{ id: 4 }]),
        "POST",
        "/cohorts/bulk-update",
      ],
      [
        "update_report_link",
        () => c.updateReportLink(1, 2, { w: 1 }),
        "PATCH",
        "/dashboards/1/report-links/2",
      ],
      [
        "update_text_card",
        () => c.updateTextCard(1, 3, { text: "t" }),
        "PATCH",
        "/dashboards/1/text-cards/3",
      ],
      [
        "update_blueprint_cohorts",
        () => c.updateBlueprintCohorts([{ cohort_id: 9 }]),
        "PUT",
        "/dashboards/blueprints/cohorts",
      ],
    ];
    for (const [name, run, method, pathPart] of voids) {
      const before = captures.length;
      // eslint-disable-next-line no-await-in-loop
      const out = await run().then(
        () => "undefined",
        (e: unknown) => `raised ${String(e)}`,
      );
      const cap = captures[before];
      record(
        `void204/${name}`,
        out === "undefined" &&
          cap !== undefined &&
          cap.method === method &&
          cap.url.includes(pathPart),
        `${out}; ${cap?.method ?? "?"} ${cap?.url ?? "?"}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // 4. results-unwrap vs _raw: get_dashboard (unwrap) vs
  //    get_bookmark_history (_raw=True + envelope re-shape,
  //    api_client.py:4672-4730 — every shaping arm).
  // -------------------------------------------------------------------------

  await expectOk(
    "raw/get_dashboard-unwraps-results",
    () =>
      client(() => ({
        status: 200,
        json: { status: "ok", results: { id: 3 } },
      })).c.getDashboard(3),
    (v) => deepEq(toNativeJson(v), { id: 3 }),
  );

  await expectOk(
    "raw/history-inner-results-with-pagination-as-is",
    () =>
      client(() => ({
        status: 200,
        json: {
          status: "ok",
          results: { results: [{ a: 1 }], pagination: { next_cursor: "n" } },
        },
      })).c.getBookmarkHistory(9),
    (v) =>
      deepEq(toNativeJson(v), {
        results: [{ a: 1 }],
        pagination: { next_cursor: "n" },
      }),
  );

  await expectOk(
    "raw/history-inner-results-missing-pagination-defaults-null",
    () =>
      client(() => ({
        status: 200,
        json: { status: "ok", results: { results: [{ a: 1 }] } },
      })).c.getBookmarkHistory(9),
    (v) => deepEq(toNativeJson(v), { results: [{ a: 1 }], pagination: null }),
  );

  await expectOk(
    "raw/history-inner-list-wrapped",
    () =>
      client(() => ({
        status: 200,
        json: { status: "ok", results: [{ a: 1 }] },
      })).c.getBookmarkHistory(9),
    (v) => deepEq(toNativeJson(v), { results: [{ a: 1 }], pagination: null }),
  );

  await expectOk(
    "raw/history-inner-scalar-wrapped",
    () =>
      client(() => ({
        status: 200,
        json: { status: "ok", results: "odd" },
      })).c.getBookmarkHistory(9),
    (v) => deepEq(toNativeJson(v), { results: "odd", pagination: null }),
  );

  await expectOk(
    "raw/history-dict-without-results-key-wraps-self",
    () =>
      client(() => ({
        status: 200,
        json: { other: 1 },
      })).c.getBookmarkHistory(9),
    // inner = result.get("results", result) = the whole dict; the dict
    // has no "results" key → the "unexpected dict shape" arm wraps it.
    (v) => deepEq(toNativeJson(v), { results: { other: 1 }, pagination: null }),
  );

  await expectOk(
    "raw/history-top-level-list-wrapped",
    () =>
      client(() => ({ status: 200, json: [{ a: 1 }] })).c.getBookmarkHistory(9),
    (v) => deepEq(toNativeJson(v), { results: [{ a: 1 }], pagination: null }),
  );

  await expectErr(
    "raw/history-scalar-body-expected-dict",
    () => client(() => ({ status: 200, json: 42 })).c.getBookmarkHistory(9),
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.message.includes("expected dict, got int"),
  );

  // present-but-null results key: Python dict.get returns None →
  // "unexpected dict shape" arm wraps None.
  await expectOk(
    "raw/history-null-results-wrapped-none",
    () =>
      client(() => ({
        status: 200,
        json: { status: "ok", results: null },
      })).c.getBookmarkHistory(9),
    (v) => deepEq(toNativeJson(v), { results: null, pagination: null }),
  );

  // -------------------------------------------------------------------------
  // 5. Envelope branches: list_bookmarks_v2 + list_blueprint_templates +
  //    list method non-list raises.
  // -------------------------------------------------------------------------

  await expectOk(
    "env/v2-double-envelope-unwraps",
    () =>
      client(() => ({
        status: 200,
        json: { status: "ok", results: { results: [{ id: 1 }] } },
      })).c.listBookmarksV2(),
    (v) => deepEq(toNativeJson(v), [{ id: 1 }]),
  );

  await expectOk(
    "env/v2-flat-list",
    () =>
      client(() => ({
        status: 200,
        json: { status: "ok", results: [{ id: 2 }] },
      })).c.listBookmarksV2(),
    (v) => deepEq(toNativeJson(v), [{ id: 2 }]),
  );

  await expectErr(
    "env/v2-scalar-raises",
    () =>
      client(() => ({
        status: 200,
        json: { status: "ok", results: 5 },
      })).c.listBookmarksV2(),
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.message.includes("expected list or v2 envelope, got int"),
  );

  await expectErr(
    "env/v2-inner-results-non-list-raises",
    () =>
      client(() => ({
        status: 200,
        json: { status: "ok", results: { results: "x" } },
      })).c.listBookmarksV2(),
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.message.includes("expected list or v2 envelope, got dict"),
  );

  await expectOk(
    "env/blueprints-dict-of-dicts-merges-name-skips-non-dict",
    () =>
      client(() => ({
        status: 200,
        json: {
          status: "ok",
          results: {
            templates: {
              valid: { title_key: "OK" },
              bad_str: "nope",
              bad_null: null,
            },
          },
        },
      })).c.listBlueprintTemplates(),
    (v) => deepEq(toNativeJson(v), [{ title_key: "OK", name: "valid" }]),
  );

  await expectOk(
    "env/blueprints-templates-list-passthrough",
    () =>
      client(() => ({
        status: 200,
        json: { status: "ok", results: { templates: [{ t: 1 }] } },
      })).c.listBlueprintTemplates(),
    (v) => deepEq(toNativeJson(v), [{ t: 1 }]),
  );

  await expectOk(
    "env/blueprints-plain-list-passthrough",
    () =>
      client(() => ({
        status: 200,
        json: { status: "ok", results: [{ t: 2 }] },
      })).c.listBlueprintTemplates(),
    (v) => deepEq(toNativeJson(v), [{ t: 2 }]),
  );

  await expectErr(
    "env/blueprints-scalar-raises",
    () =>
      client(() => ({
        status: 200,
        json: { status: "ok", results: "x" },
      })).c.listBlueprintTemplates(),
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.message.includes("expected templates dict, got str"),
  );

  // templates dict present but non-dict/non-list value → falls to the
  // final raise with the OUTER result's type name (dict), exactly like
  // Python's fallthrough (api_client.py:4083-4105).
  await expectErr(
    "env/blueprints-templates-scalar-falls-through",
    () =>
      client(() => ({
        status: 200,
        json: { status: "ok", results: { templates: 42 } },
      })).c.listBlueprintTemplates(),
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.message.includes("expected templates dict, got dict"),
  );

  await expectErr(
    "env/list_cohorts_app-non-list-raises",
    () =>
      client(() => ({
        status: 200,
        json: { status: "ok", results: { id: 1 } },
      })).c.listCohortsApp(),
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.message.includes("expected list, got dict"),
  );

  // -------------------------------------------------------------------------
  // 6. Edge values through params/body encoding (fixed set: 18.0 is
  //    unreachable as a JS double distinct from 18 — 18.5/1.5 carry the
  //    float arm; True/None/[]/""/"𝒳" verbatim).
  // -------------------------------------------------------------------------

  {
    const { c, captures } = client(() => ({
      status: 200,
      json: { status: "ok", results: [] },
    }));
    await c.listDashboards({ ids: [1, 2] });
    await c.listCohortsApp({ ids: [18.5, 1.5] });
    await c.listBookmarksV2({ bookmark_type: "𝒳", ids: [10, 20] });
    record(
      "edge/ids-join-pythonStr",
      captures[0]!.params["ids"] === "1,2" &&
        captures[1]!.params["ids"] === "18.5,1.5" &&
        captures[2]!.params["ids"] === "10,20" &&
        captures[2]!.params["type"] === "𝒳" &&
        captures[2]!.params["v"] === "2",
      JSON.stringify(captures.map((x) => x.params)),
    );
  }

  {
    // Python-truthiness: empty ids list / empty strings send NO param.
    const { c, captures } = client(() => ({
      status: 200,
      json: { status: "ok", results: [] },
    }));
    await c.listDashboards({ ids: [] });
    await c.listCohortsApp({ data_group_id: "", ids: null });
    await c.listBookmarksV2({ bookmark_type: "" });
    record(
      "edge/falsy-filters-omitted",
      !Object.hasOwn(captures[0]!.params, "ids") &&
        !Object.hasOwn(captures[1]!.params, "data_group_id") &&
        !Object.hasOwn(captures[1]!.params, "ids") &&
        !Object.hasOwn(captures[2]!.params, "type") &&
        captures[2]!.params["v"] === "2",
      JSON.stringify(captures.map((x) => x.params)),
    );
  }

  {
    const { c, captures } = client(() => ({ status: 204 }));
    await c.bulkDeleteDashboards([]);
    await c.bulkUpdateBookmarks([
      { id: 1, name: "𝒳", flag: true, note: null, tags: [], desc: "" },
    ]);
    const body0 = JSON.parse(captures[0]!.bodyText) as unknown;
    const body1 = JSON.parse(captures[1]!.bodyText) as unknown;
    record(
      "edge/bulk-bodies-verbatim",
      deepEq(body0, { dashboard_ids: [] }) &&
        deepEq(body1, {
          bookmarks: [
            { id: 1, name: "𝒳", flag: true, note: null, tags: [], desc: "" },
          ],
        }),
      `${captures[0]!.bodyText} | ${captures[1]!.bodyText}`,
    );
  }

  {
    const { c, captures } = client(() => ({
      status: 200,
      json: { status: "ok", results: { results: [], pagination: null } },
    }));
    await c.getBookmarkHistory(1, { cursor: "𝒳", page_size: 1.5 });
    await c.getBookmarkHistory(2, { cursor: "", page_size: 0 });
    record(
      "edge/history-params-pythonStr",
      captures[0]!.params["cursor"] === "𝒳" &&
        // str(1.5) → "1.5" (pythonStr float spelling)
        captures[0]!.params["page_size"] === "1.5" &&
        // falsy cursor omitted; page_size=0 is `is not None` → "0"
        !Object.hasOwn(captures[1]!.params, "cursor") &&
        captures[1]!.params["page_size"] === "0",
      JSON.stringify(captures.map((x) => x.params)),
    );
  }

  {
    // v-marker split: create/update carry INT 2 in the body; get/list
    // carry STRING "2" as a query param (api_client.py:4461/4506/4537).
    const { c, captures } = client(() => ({
      status: 200,
      json: { status: "ok", results: { id: 1 } },
    }));
    await c.createBookmark({ name: "n" });
    await c.updateBookmark(1, { name: "m" });
    await c.getBookmark(1);
    const created = JSON.parse(captures[0]!.bodyText) as Record<
      string,
      unknown
    >;
    const updated = JSON.parse(captures[1]!.bodyText) as Record<
      string,
      unknown
    >;
    record(
      "edge/v2-markers",
      created["v"] === 2 &&
        created["name"] === "n" &&
        updated["v"] === 2 &&
        captures[2]!.params["v"] === "2" &&
        captures[0]!.method === "POST" &&
        captures[1]!.method === "PATCH",
      `${captures[0]!.bodyText} | ${captures[1]!.bodyText} | ${JSON.stringify(captures[2]!.params)}`,
    );
  }

  // -------------------------------------------------------------------------
  // Report.
  // -------------------------------------------------------------------------

  const passed = results.filter((r) => r.ok).length;
  console.log(`\nB4-C3 harness: ${passed}/${results.length} branches OK`);
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.branch}`);
  }
  if (passed !== results.length) {
    process.exitCode = 1;
  }
}

await main();
