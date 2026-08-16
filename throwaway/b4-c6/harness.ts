/**
 * B4-C6 R10.9 throwaway harness (packet C6 §R10.9 spec): hand-built
 * interaction sequences through the REAL `paginateAll` — 1-page /
 * 3-page / empty-results / `results: null` / missing pagination block /
 * next_cursor repeat / 429-then-success mid-pagination / 429×4
 * exhausted (per-paginator retry ×3, independent of client
 * `max_retries`) / >maxPages overflow (injected small maxPages) — PLUS
 * every owned error branch (`PAGINATION_LIMIT`, `NETWORK_ERROR`,
 * `API_ERROR` incl. the unfollowed-3xx arm, `INVALID_RESPONSE` at both
 * sites, `RATE_LIMITED` reduced shape, `AUTH_FAILED`, `SERVER_ERROR`)
 * and the fixed edge values through params encoding (`1.5`, `""`,
 * `"𝒳"`; `18.0`/`True`/`None`/`[]` are not representable through the
 * `dict[str, str]` params annotation Python shares — disclosed in the
 * RUN record).
 *
 * Wire methods have no oracle bridge (P3-2 c), so this harness IS the
 * differential: expectations are transcribed from the Python source
 * (`mixpanel_headless/_internal/pagination.py`, whole file). Run via
 * `bash throwaway/b4-c6/run.sh`; the RUN record lives in the Python
 * repo notes file (`context/phase3/notes/B4-C6-notes.md`).
 */

import {
  createMixpanelClient,
  type MixpanelClient,
} from "../../packages/core/src/client/client.js";
import { paginateAll } from "../../packages/core/src/client/pagination.js";
import { toNativeJson } from "../../packages/core/src/client/json-value.js";
import type { Session } from "../../packages/core/src/auth/session.js";
import { Secret } from "../../packages/core/src/secret.js";
import {
  AuthenticationError,
  MixpanelHeadlessError,
  RateLimitError,
  ServerError,
} from "../../packages/core/src/errors.js";

// ---------------------------------------------------------------------------
// Mini transport (C1..C5 harness pattern).
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
    } else if (canned.text !== undefined && canned.text !== "") {
      body = canned.text;
    }
    // canned.text === "" keeps body null: a STRING body makes the
    // platform Response auto-add `text/plain;charset=UTF-8`, which
    // would defeat the absent-content-type branch under test.
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
  extra: { maxRetries?: number; random?: () => number } = {},
): { c: MixpanelClient; captures: Captured[]; sleeps: number[] } {
  const t = transportFor(handler);
  const sleeps: number[] = [];
  const c = createMixpanelClient({
    session: session(),
    fetch: t.fetch,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    random: extra.random ?? (() => 0),
    ...(extra.maxRetries !== undefined ? { maxRetries: extra.maxRetries } : {}),
  });
  return { c, captures: t.captures, sleeps };
}

function page(ids: number[], nextCursor: unknown): Canned {
  return {
    status: 200,
    json: {
      status: "ok",
      results: ids.map((id) => ({ id })),
      pagination: { page_size: ids.length, next_cursor: nextCursor },
    },
  };
}

async function drain(
  c: MixpanelClient,
  path: string,
  options: Parameters<typeof paginateAll>[2] = {},
): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const item of paginateAll(c, path, options)) {
    out.push(toNativeJson(item));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tally.
// ---------------------------------------------------------------------------

const results: { branch: string; ok: boolean; detail: string }[] = [];

function record(branch: string, isOk: boolean, detail = ""): void {
  results.push({ branch, ok: isOk, detail });
  if (!isOk) {
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

const PATH = "/projects/12345/items";
const URL_PREFIX = "https://mixpanel.com/api/app/projects/12345/items?";

// ---------------------------------------------------------------------------
// §1 Page walks.
// ---------------------------------------------------------------------------

async function pageWalks(): Promise<void> {
  {
    // 1-page + wire shape: GET, app host, literal headers (Basic auth,
    // NO user-agent — pagination.py:161-163 skips _request_headers).
    const { c, captures } = client(() => page([1, 2], null));
    await expectOk(
      "pages/1-page",
      () => drain(c, PATH),
      (v) => deepEq(v, [{ id: 1 }, { id: 2 }]),
    );
    const req = captures[0];
    record(
      "pages/1-page-wire-shape",
      req !== undefined &&
        req.method === "GET" &&
        req.url.startsWith(URL_PREFIX) &&
        req.params["page_size"] === "100" &&
        req.params["query_origin"] === "mixpanel-headless" &&
        req.headers["authorization"] ===
          `Basic ${Buffer.from("test_user:test_secret").toString("base64")}` &&
        req.headers["user-agent"] === undefined,
      JSON.stringify(req),
    );
  }
  {
    // 3-page cursor threading.
    const { c, captures } = client((req) => {
      const cursor = req.params["cursor"];
      if (cursor === undefined) return page([1], "c2");
      if (cursor === "c2") return page([2], "c3");
      return page([3], null);
    });
    await expectOk(
      "pages/3-page-cursor-thread",
      () => drain(c, PATH),
      (v) => deepEq(v, [{ id: 1 }, { id: 2 }, { id: 3 }]),
    );
    record(
      "pages/3-page-request-sequence",
      captures.length === 3 &&
        captures[0]?.params["cursor"] === undefined &&
        captures[1]?.params["cursor"] === "c2" &&
        captures[2]?.params["cursor"] === "c3",
      JSON.stringify(captures.map((r) => r.params["cursor"] ?? null)),
    );
  }
  {
    const { c } = client(() => page([], null));
    await expectOk(
      "pages/empty-results",
      () => drain(c, PATH),
      (v) => deepEq(v, []),
    );
  }
  {
    const { c } = client(() => ({
      status: 200,
      json: {
        status: "ok",
        results: null,
        pagination: { page_size: 100, next_cursor: null },
      },
    }));
    await expectOk(
      "pages/results-null",
      () => drain(c, PATH),
      (v) => deepEq(v, []),
    );
  }
  {
    // Null results page mid-walk: the cursor, not the field, decides.
    const { c, captures } = client((req) =>
      req.params["cursor"] === undefined
        ? {
            status: 200,
            json: {
              status: "ok",
              results: null,
              pagination: { page_size: 100, next_cursor: "c2" },
            },
          }
        : page([1], null),
    );
    await expectOk(
      "pages/results-null-follows-cursor",
      () => drain(c, PATH),
      (v) => deepEq(v, [{ id: 1 }]),
    );
    record(
      "pages/results-null-two-requests",
      captures.length === 2,
      String(captures.length),
    );
  }
  {
    const { c } = client(() => ({
      status: 200,
      json: { status: "ok", results: [{ id: 7 }] },
    }));
    await expectOk(
      "pages/missing-pagination-block",
      () => drain(c, PATH),
      (v) => deepEq(v, [{ id: 7 }]),
    );
  }
  {
    // Top-level LIST body yields directly (pagination.py:275-276), one
    // page (a list has no pagination block).
    const { c, captures } = client(() => ({ status: 200, json: [1, 2, 3] }));
    await expectOk(
      "pages/top-level-list-body",
      () => drain(c, PATH),
      (v) => deepEq(v, [1, 2, 3]),
    );
    record("pages/list-body-single-page", captures.length === 1, "");
  }
  {
    // Scalar 200 body: neither dict nor list → zero items, no raise,
    // single page (results stays [], pagination read is None).
    const { c, captures } = client(() => ({ status: 200, json: 42 }));
    await expectOk(
      "pages/scalar-200-body",
      () => drain(c, PATH),
      (v) => deepEq(v, []),
    );
    record("pages/scalar-single-page", captures.length === 1, "");
  }
  {
    // `pagination` non-dict → cursor None → single page.
    const { c, captures } = client(() => ({
      status: 200,
      json: { status: "ok", results: [{ id: 1 }], pagination: "bogus" },
    }));
    await expectOk(
      "pages/pagination-non-dict",
      () => drain(c, PATH),
      (v) => deepEq(v, [{ id: 1 }]),
    );
    record("pages/pagination-non-dict-single-page", captures.length === 1, "");
  }
  {
    // Empty pagination dict is FALSY in Python (`if pagination and
    // isinstance(...)`) → cursor None → single page.
    const { c, captures } = client(() => ({
      status: 200,
      json: { status: "ok", results: [{ id: 1 }], pagination: {} },
    }));
    await expectOk(
      "pages/pagination-empty-dict",
      () => drain(c, PATH),
      (v) => deepEq(v, [{ id: 1 }]),
    );
    record(
      "pages/pagination-empty-dict-single-page",
      captures.length === 1,
      "",
    );
  }
  {
    // next_cursor false is NOT None (`is None` check) → a second
    // request goes out with cursor=false (httpx bool rendering).
    const { c, captures } = client((req) =>
      req.params["cursor"] === undefined ? page([1], false) : page([2], null),
    );
    await expectOk(
      "pages/next-cursor-false-not-none",
      () => drain(c, PATH),
      (v) => deepEq(v, [{ id: 1 }, { id: 2 }]),
    );
    record(
      "pages/next-cursor-false-param",
      captures.length === 2 && captures[1]?.params["cursor"] === "false",
      JSON.stringify(captures[1]?.params["cursor"]),
    );
  }
  {
    // Numeric cursor tokens: int keeps exact digits (str(5) == "5"),
    // float renders via CPython float repr (str(1.5) == "1.5").
    const { c, captures } = client((req) => {
      const cursor = req.params["cursor"];
      if (cursor === undefined) return page([1], 5);
      if (cursor === "5") return page([2], 1.5);
      return page([3], null);
    });
    await expectOk(
      "pages/numeric-cursor-tokens",
      () => drain(c, PATH),
      (v) => deepEq(v, [{ id: 1 }, { id: 2 }, { id: 3 }]),
    );
    record(
      "pages/numeric-cursor-params",
      captures[1]?.params["cursor"] === "5" &&
        captures[2]?.params["cursor"] === "1.5",
      JSON.stringify(captures.map((r) => r.params["cursor"] ?? null)),
    );
  }
}

// ---------------------------------------------------------------------------
// §2 Page limit.
// ---------------------------------------------------------------------------

async function pageLimit(): Promise<void> {
  {
    const { c, captures } = client(() => page([1], "same"));
    await expectErr(
      "limit/max-pages-overflow",
      () => drain(c, PATH, { maxPages: 3 }),
      (e) =>
        e instanceof MixpanelHeadlessError &&
        e.code === "PAGINATION_LIMIT" &&
        deepEq(e.details, { max_pages: 3, path: PATH }),
    );
    // page_count > maxPages fires at the LOOP HEAD of page 4 — before
    // any 4th request (pagination.py:142-150).
    record("limit/overflow-request-count", captures.length === 3, "");
  }
  {
    // No repeated-cursor guard exists in the source: a constant cursor
    // walks until the limit (the test_infinite_loop_same_cursor lock).
    const { c, captures } = client(() => page([1], "same"));
    await expectErr(
      "limit/next-cursor-repeat-guardless",
      () => drain(c, PATH, { maxPages: 2 }),
      (e) =>
        e instanceof MixpanelHeadlessError && e.code === "PAGINATION_LIMIT",
    );
    record(
      "limit/repeat-cursor-second-request",
      captures.length === 2 && captures[1]?.params["cursor"] === "same",
      "",
    );
  }
}

// ---------------------------------------------------------------------------
// §3 429 retry loop.
// ---------------------------------------------------------------------------

async function retryLoop(): Promise<void> {
  {
    let calls = 0;
    const { c, sleeps, captures } = client(() => {
      calls += 1;
      if (calls === 1) {
        return {
          status: 429,
          json: { error: "rate_limited" },
          headers: { "Retry-After": "30" },
        };
      }
      return page([1], null);
    });
    await expectOk(
      "retry/429-then-success",
      () => drain(c, PATH),
      (v) => deepEq(v, [{ id: 1 }]),
    );
    record(
      "retry/429-honored-sleep",
      deepEq(sleeps, [30_000]) && captures.length === 2,
      JSON.stringify(sleeps),
    );
  }
  {
    const { c, sleeps, captures } = client(() => ({
      status: 429,
      json: { error: "rate_limited" },
      headers: { "Retry-After": "45.7" },
    }));
    await expectErr(
      "retry/429x4-exhausted-reduced-shape",
      () => drain(c, PATH),
      (e) =>
        e instanceof RateLimitError &&
        e.code === "RATE_LIMITED" &&
        // int(45.7) truncation → 45.
        e.retryAfter === 45 &&
        e.details["status_code"] === 429 &&
        e.details["response_body"] === '{"error":"rate_limited"}' &&
        e.details["request_method"] === "GET" &&
        typeof e.details["request_url"] === "string" &&
        // Reduced shape: NO project_id, NO request_params (Caution #3).
        !("project_id" in e.details) &&
        !("request_params" in e.details),
    );
    record(
      "retry/exhausted-attempt-count",
      captures.length === 4 && sleeps.length === 3,
      `${captures.length} requests / ${sleeps.length} sleeps`,
    );
  }
  {
    // Per-paginator retry budget is INDEPENDENT of client max_retries
    // (review-checklist delta): maxRetries=0 still walks 4 attempts.
    const { c, captures } = client(
      () => ({ status: 429, json: { error: "rate_limited" } }),
      { maxRetries: 0 },
    );
    await expectErr(
      "retry/independent-of-client-max-retries",
      () => drain(c, PATH),
      (e) => e instanceof RateLimitError,
    );
    record("retry/independent-attempt-count", captures.length === 4, "");
  }
  {
    let calls = 0;
    const { c, sleeps } = client(() => {
      calls += 1;
      return calls === 1
        ? {
            status: 429,
            json: { error: "rate_limited" },
            headers: { "Retry-After": "86400" },
          }
        : page([1], null);
    });
    await expectOk(
      "retry/retry-after-clamped",
      () => drain(c, PATH),
      (v) => deepEq(v, [{ id: 1 }]),
    );
    record(
      "retry/clamped-sleep-60s",
      deepEq(sleeps, [60_000]),
      JSON.stringify(sleeps),
    );
  }
  {
    let calls = 0;
    const { c, sleeps } = client(() => {
      calls += 1;
      return calls === 1
        ? {
            status: 429,
            json: { error: "rate_limited" },
            headers: { "Retry-After": "abc" },
          }
        : page([1], null);
    });
    await expectOk(
      "retry/retry-after-hostile-fallback",
      () => drain(c, PATH),
      (v) => deepEq(v, [{ id: 1 }]),
    );
    record(
      "retry/hostile-fallback-1s",
      deepEq(sleeps, [1_000]),
      JSON.stringify(sleeps),
    );
  }
  {
    // NO jitter in either arm (unlike the client backoff): with
    // random() = 0.999 the schedule stays exactly [1, 2, 4] seconds.
    const { c, sleeps } = client(
      () => ({ status: 429, json: { error: "rate_limited" } }),
      { random: () => 0.999 },
    );
    await expectErr(
      "retry/backoff-schedule-unjittered",
      () => drain(c, PATH),
      (e) => e instanceof RateLimitError && e.retryAfter === null,
    );
    record(
      "retry/unjittered-schedule",
      deepEq(sleeps, [1_000, 2_000, 4_000]),
      JSON.stringify(sleeps),
    );
  }
}

// ---------------------------------------------------------------------------
// §4 Error branches.
// ---------------------------------------------------------------------------

async function errorBranches(): Promise<void> {
  {
    const { c } = client(() => ({ status: 0, reject: "transport" }));
    await expectErr(
      "errors/network-error",
      () => drain(c, PATH),
      (e) =>
        e instanceof MixpanelHeadlessError &&
        e.code === "NETWORK_ERROR" &&
        e.details["path"] === PATH &&
        typeof e.details["error"] === "string",
    );
  }
  {
    // Transport failure MID-walk: page 1 already yielded.
    const yielded: unknown[] = [];
    const { c } = client((req) =>
      req.params["cursor"] === undefined
        ? page([1], "c2")
        : { status: 0, reject: "transport" },
    );
    await expectErr(
      "errors/network-error-mid-walk",
      async () => {
        for await (const item of paginateAll(c, PATH)) {
          yielded.push(toNativeJson(item));
        }
        return null;
      },
      (e) =>
        e instanceof MixpanelHeadlessError &&
        e.code === "NETWORK_ERROR" &&
        deepEq(yielded, [{ id: 1 }]),
    );
  }
  {
    const { c } = client(() => ({
      status: 401,
      json: { error: "unauthorized" },
    }));
    await expectErr(
      "errors/401-authentication",
      () => drain(c, PATH),
      (e) =>
        e instanceof AuthenticationError &&
        e.code === "AUTH_FAILED" &&
        e.details["status_code"] === 401 &&
        e.details["response_body"] === '{"error":"unauthorized"}',
    );
  }
  {
    const { c } = client(() => ({ status: 503, json: { error: "down" } }));
    await expectErr(
      "errors/5xx-server",
      () => drain(c, PATH),
      (e) =>
        e instanceof ServerError &&
        e.code === "SERVER_ERROR" &&
        e.details["status_code"] === 503,
    );
  }
  {
    const { c } = client(() => ({ status: 404, json: { error: "nope" } }));
    await expectErr(
      "errors/other-4xx-api-error",
      () => drain(c, PATH),
      (e) =>
        e instanceof MixpanelHeadlessError &&
        !(e instanceof AuthenticationError) &&
        !(e instanceof ServerError) &&
        e.code === "API_ERROR" &&
        e.details["status_code"] === 404 &&
        e.details["response_body"] === '{"error":"nope"}',
    );
  }
  {
    // Unfollowed 3xx: httpx raise_for_status fires for every non-2xx
    // (R2.11) → the API_ERROR arm, never a success.
    const { c } = client(() => ({
      status: 302,
      json: { location: "elsewhere" },
      headers: { location: "https://mixpanel.com/elsewhere" },
    }));
    await expectErr(
      "errors/3xx-api-error",
      () => drain(c, PATH),
      (e) =>
        e instanceof MixpanelHeadlessError &&
        e.code === "API_ERROR" &&
        e.details["status_code"] === 302,
    );
  }
  {
    const { c } = client(() => ({
      status: 200,
      text: "<html>oops</html>",
      headers: { "content-type": "text/html" },
    }));
    await expectErr(
      "errors/non-json-200",
      () => drain(c, PATH),
      (e) =>
        e instanceof MixpanelHeadlessError &&
        e.code === "INVALID_RESPONSE" &&
        e.details["content_type"] === "text/html",
    );
  }
  {
    // Empty body, no content-type: Python details carry None (the
    // `.get` WITHOUT the "unknown" default) — TS null.
    const { c } = client(() => ({ status: 200, text: "" }));
    await expectErr(
      "errors/empty-body-200",
      () => drain(c, PATH),
      (e) =>
        e instanceof MixpanelHeadlessError &&
        e.code === "INVALID_RESPONSE" &&
        e.details["content_type"] === null,
    );
  }
  const malformed: Array<[string, unknown, string]> = [
    ["str", "abc", "str"],
    ["int", 42, "int"],
    ["float", 1.5, "float"],
    ["bool", true, "bool"],
    ["dict", { id: 1 }, "dict"],
  ];
  for (const [label, value, typeName] of malformed) {
    const { c } = client(() => ({
      status: 200,
      json: {
        status: "ok",
        results: value,
        pagination: { page_size: 100, next_cursor: null },
      },
    }));
    await expectErr(
      `errors/results-non-list-${label}`,
      () => drain(c, PATH),
      (e) =>
        e instanceof MixpanelHeadlessError &&
        e.code === "INVALID_RESPONSE" &&
        deepEq(e.details, { path: PATH, results_type: typeName }),
    );
  }
}

// ---------------------------------------------------------------------------
// §5 Edge values through params.
// ---------------------------------------------------------------------------

async function edgeValues(): Promise<void> {
  {
    const { c, captures } = client(() => page([1], null));
    await expectOk(
      "edge/params-values",
      () =>
        drain(c, PATH, {
          params: { "𝒳": "𝒳", empty: "", frac: "1.5" },
          page_size: 18,
        }),
      (v) => deepEq(v, [{ id: 1 }]),
    );
    const req = captures[0];
    record(
      "edge/params-decoded",
      req !== undefined &&
        req.params["𝒳"] === "𝒳" &&
        req.params["empty"] === "" &&
        req.params["frac"] === "1.5" &&
        req.params["page_size"] === "18" &&
        // Non-BMP percent-encoding on the wire (quote_plus UTF-8 bytes).
        req.url.includes("%F0%9D%92%B3=%F0%9D%92%B3"),
      JSON.stringify(req?.params),
    );
  }
  {
    const { c, captures } = client(() => page([1], null));
    await expectOk(
      "edge/query-origin-override",
      () => drain(c, PATH, { params: { query_origin: "spoofed-by-caller" } }),
      (v) => deepEq(v, [{ id: 1 }]),
    );
    record(
      "edge/query-origin-canonical",
      captures[0]?.params["query_origin"] === "mixpanel-headless",
      JSON.stringify(captures[0]?.params),
    );
  }
  {
    // Auth resolves PER PAGE (pagination.py:162 inside the while loop).
    const { c, captures } = client((req) =>
      req.params["cursor"] === undefined ? page([1], "c2") : page([2], null),
    );
    await expectOk(
      "edge/auth-per-page",
      () => drain(c, PATH),
      (v) => deepEq(v, [{ id: 1 }, { id: 2 }]),
    );
    record(
      "edge/auth-on-every-request",
      captures.length === 2 &&
        captures.every(
          (r) => r.headers["authorization"]?.startsWith("Basic ") === true,
        ),
      "",
    );
  }
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await pageWalks();
  await pageLimit();
  await retryLoop();
  await errorBranches();
  await edgeValues();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\nB4-C6 harness: ${passed}/${results.length} branches OK`);
  for (const r of results) {
    console.log(`${r.ok ? "ok  " : "FAIL"} ${r.branch}`);
  }
  if (passed !== results.length) {
    process.exitCode = 1;
  }
}

await main();
