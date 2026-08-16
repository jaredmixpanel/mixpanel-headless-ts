/**
 * B4-C1 R10.9 throwaway harness (packet C1 §R10.9 spec): status-branch
 * replay through hand-built VectorFetch-style interactions on the REAL
 * `createMixpanelClient` — `request()` across the query/app/data hosts
 * and `resolveWorkspaceId()`'s metadata fallback — plus the C1-specific
 * items: `use()` transport-identity preservation while the harness
 * keeps serving (R6.2), workspace pin set→cleared across `use`,
 * scalar-return 200s, INVALID_RESPONSE on non-JSON 200, 3xx-with-JSON
 * → HTTP_ERROR (R2.11), 429-exhausted carrying `project_id` (FF4), the
 * R10.7 403 bug-compat matrix, and the fixed edge values through
 * `request(params=…)`/body encoding.
 *
 * Wire methods have no oracle bridge (P3-2 c), so this harness IS the
 * differential: every branch expectation below is transcribed from the
 * Python source ranges cited in the packet and double-checked against
 * the recorded corpus shapes. Run via `bash throwaway/b4-c1/run.sh`;
 * the RUN record lives in the Python repo notes file
 * (`context/phase3/notes/B4-C1-notes.md`).
 */

import {
  createMixpanelClient,
  type MixpanelClient,
} from "../../packages/core/src/client/client.js";
import { JsonNumber } from "../../packages/core/src/client/json-value.js";
import type { Session } from "../../packages/core/src/auth/session.js";
import { Secret } from "../../packages/core/src/secret.js";
import {
  AuthenticationError,
  MixpanelHeadlessError,
  QueryError,
  RateLimitError,
  ServerError,
  SessionReplayAccessError,
  WorkspaceScopeError,
} from "../../packages/core/src/errors.js";

// ---------------------------------------------------------------------------
// Mini transport: canned handler over the injected-fetch seam.
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
  reject?: "transport" | "abortlike";
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
): { c: MixpanelClient; captures: Captured[] } {
  const t = transportFor(handler);
  const c = createMixpanelClient({
    session: session(),
    fetch: t.fetch,
    sleep: async () => {},
    random: () => 0,
    ...(extra.maxRetries !== undefined ? { maxRetries: extra.maxRetries } : {}),
  });
  return { c, captures: t.captures };
}

// ---------------------------------------------------------------------------
// Tally + assertion plumbing.
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
// The status-branch matrix on request() (query + app + data hosts).
// ---------------------------------------------------------------------------

const HOSTS = {
  query: "https://mixpanel.com/api/query/segmentation",
  app: "https://mixpanel.com/api/app/test",
  data: "https://data.mixpanel.com/api/2.0/export",
};

async function statusMatrix(): Promise<void> {
  for (const [host, url] of Object.entries(HOSTS)) {
    // 200-object
    await expectOk(
      `200-object/${host}`,
      () =>
        client(() => ({ status: 200, json: { a: 1 } })).c.request("GET", url),
      (v) =>
        JSON.stringify(v, (_k, x: unknown) =>
          x instanceof JsonNumber ? Number(x.raw) : x,
        ) === '{"a":1}',
    );
    // 200-array
    await expectOk(
      `200-array/${host}`,
      () => client(() => ({ status: 200, json: ["x"] })).c.request("GET", url),
      (v) => Array.isArray(v) && v[0] === "x",
    );
  }
  // 200-scalar returns (httpx: Response(200, b"42").json() → 42) — the
  // fallthrough tail item (iii), never a raise.
  for (const [text, want] of [
    ["42", "42"],
    ['"ok"', "ok"],
    ["true", true],
    ["null", null],
  ] as const) {
    await expectOk(
      `200-scalar ${text}`,
      () =>
        client(() => ({
          status: 200,
          text,
          headers: { "content-type": "application/json" },
        })).c.request("GET", HOSTS.query),
      (v) => (v instanceof JsonNumber ? v.raw === want : v === want),
    );
  }
  // 200-non-JSON → INVALID_RESPONSE
  await expectErr(
    "200-non-JSON → INVALID_RESPONSE",
    () =>
      client(() => ({ status: 200, text: "<html>not json</html>" })).c.request(
        "GET",
        HOSTS.query,
      ),
    (e) =>
      e instanceof MixpanelHeadlessError &&
      !(e instanceof QueryError) &&
      e.code === "INVALID_RESPONSE",
  );
  // 3xx with a JSON body → HTTP_ERROR, never a success (R2.11).
  await expectErr(
    "3xx-with-JSON-body → HTTP_ERROR",
    () =>
      client(() => ({
        status: 302,
        json: { location: "elsewhere" },
        headers: { location: "https://mixpanel.com/elsewhere" },
      })).c.request("GET", HOSTS.query),
    (e) => e instanceof MixpanelHeadlessError && e.code === "HTTP_ERROR",
  );
  // 400 / 401 / 403-plain / 404 / other-4xx (412) / 5xx
  await expectErr(
    "400 → QueryError",
    () =>
      client(() => ({ status: 400, json: { error: "bad" } })).c.request(
        "GET",
        HOSTS.query,
      ),
    (e) => e instanceof QueryError && e.statusCode === 400,
  );
  await expectErr(
    "401 → AuthenticationError",
    () =>
      client(() => ({ status: 401, json: { error: "no" } })).c.request(
        "GET",
        HOSTS.query,
      ),
    (e) => e instanceof AuthenticationError,
  );
  await expectErr(
    "403-plain → QueryError",
    () =>
      client(() => ({ status: 403, json: { error: "denied" } })).c.request(
        "GET",
        HOSTS.query,
      ),
    (e) => e instanceof QueryError && e.statusCode === 403,
  );
  await expectErr(
    "403-sensitive-data → SessionReplayAccessError",
    () =>
      client(() => ({
        status: 403,
        json: { error: "SESSION_RECORDING_SENSITIVE_DATA blocked" },
      })).c.request("GET", HOSTS.query),
    (e) =>
      e instanceof SessionReplayAccessError &&
      e.details["project_id"] === 12345,
  );
  await expectErr(
    "404 → QueryError",
    () =>
      client(() => ({ status: 404, json: { error: "gone" } })).c.request(
        "GET",
        HOSTS.query,
      ),
    (e) => e instanceof QueryError && e.statusCode === 404,
  );
  await expectErr(
    "other-4xx (412) → QueryError",
    () =>
      client(() => ({
        status: 412,
        json: { error: "precondition" },
      })).c.request("GET", HOSTS.query),
    (e) => e instanceof QueryError && e.statusCode === 412,
  );
  await expectErr(
    "5xx → ServerError",
    () =>
      client(() => ({ status: 503, json: { error: "down" } })).c.request(
        "GET",
        HOSTS.query,
      ),
    (e) => e instanceof ServerError && e.statusCode === 503,
  );
  // 429-then-success
  {
    let n = 0;
    const { c } = client(() => {
      n += 1;
      return n === 1
        ? { status: 429, text: "", headers: { "Retry-After": "0" } }
        : { status: 200, json: { ok: true } };
    });
    await expectOk(
      "429-retry-then-success",
      () => c.request("GET", HOSTS.query),
      () => n === 2,
    );
  }
  // 429-exhausted → RateLimitError with project_id (FF4).
  await expectErr(
    "429-exhausted carries project_id (FF4)",
    () =>
      client(() => ({ status: 429, json: { error: "limit" } }), {
        maxRetries: 0,
      }).c.request("GET", HOSTS.query),
    (e) =>
      e instanceof RateLimitError &&
      e.details["project_id"] === "12345" &&
      e.statusCode === 429,
  );
  // 204 via appRequest → {status: "ok"} (App API contract).
  await expectOk(
    "204-app → {status: ok}",
    () =>
      client(() => ({ status: 204 })).c.appRequest(
        "DELETE",
        "/projects/12345/dashboards/1",
      ),
    (v) => JSON.stringify(v) === '{"status":"ok"}',
  );
  // 422 via appRequest → QueryError (App API contract).
  await expectErr(
    "422-app → QueryError",
    () =>
      client(() => ({
        status: 422,
        json: { error: "bad field" },
      })).c.appRequest("POST", "/projects/12345/dashboards", {
        jsonBody: { title: "x" },
      }),
    (e) => e instanceof QueryError && e.statusCode === 422,
  );
  // Transport rejection → HTTP_ERROR with the cause message (R2.10).
  await expectErr(
    "network-error → HTTP_ERROR",
    () =>
      client(() => ({ status: 0, reject: "transport" })).c.request(
        "GET",
        HOSTS.query,
      ),
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.code === "HTTP_ERROR" &&
      e.details["error"] === "connection refused",
  );
}

// ---------------------------------------------------------------------------
// R10.7 bug-compat 403 matrix through the real request() path.
// ---------------------------------------------------------------------------

async function bugCompat403Matrix(): Promise<void> {
  const cases: {
    label: string;
    text: string;
    check: (e: unknown) => boolean;
  }[] = [
    // Truthy non-dict/non-str JSON bodies raise TypeError (Python
    // `"..." in 42`); locked branch — do NOT fix (R10.7).
    {
      label: "403 body 42 → TypeError",
      text: "42",
      check: (e) => e instanceof TypeError,
    },
    {
      label: "403 body 1.5 → TypeError",
      text: "1.5",
      check: (e) => e instanceof TypeError,
    },
    {
      label: "403 body true → TypeError",
      text: "true",
      check: (e) => e instanceof TypeError,
    },
    // Falsy scalars take the QueryError path (`body or ""`).
    {
      label: "403 body 0 → QueryError",
      text: "0",
      check: (e) => e instanceof QueryError,
    },
    {
      label: "403 body false → QueryError",
      text: "false",
      check: (e) => e instanceof QueryError,
    },
    {
      label: "403 body null → QueryError",
      text: "null",
      check: (e) => e instanceof QueryError,
    },
    // LIST bodies use exact-element membership.
    {
      label: "403 list exact-element → SessionReplayAccessError",
      text: '["SESSION_RECORDING_SENSITIVE_DATA"]',
      check: (e) => e instanceof SessionReplayAccessError,
    },
    {
      label: "403 list substring-miss → QueryError",
      text: '["xSESSION_RECORDING_SENSITIVE_DATAy"]',
      check: (e) => e instanceof QueryError,
    },
  ];
  for (const item of cases) {
    await expectErr(
      item.label,
      () =>
        client(() => ({
          status: 403,
          text: item.text,
          headers: { "content-type": "application/json" },
        })).c.request("GET", HOSTS.query),
      item.check,
    );
  }
}

// ---------------------------------------------------------------------------
// C1-specific behaviors.
// ---------------------------------------------------------------------------

async function c1Behaviors(): Promise<void> {
  // use() preserves transport identity; the SAME harness keeps serving.
  {
    const { c, captures } = client(() => ({ status: 200, json: { r: 1 } }));
    const before = c.httpHandle();
    await c.request("GET", HOSTS.app);
    await c.use({ project: "99999" });
    await c.request("GET", HOSTS.app);
    record(
      "use() preserves transport identity (R6.2)",
      c.httpHandle() === before && captures.length === 2,
      `captures=${captures.length}`,
    );
  }
  // Workspace pin set → cleared across use(); query-host injection follows.
  {
    const { c, captures } = client(() => ({ status: 200, json: [] }));
    c.setWorkspaceId(777);
    await c.requestQueryHost("GET", HOSTS.query, { params: {} });
    await c.use({ project: "88888" });
    await c.requestQueryHost("GET", HOSTS.query, { params: {} });
    record(
      "pin set→cleared across use()",
      captures[0]?.params["workspace_id"] === "777" &&
        !Object.hasOwn(captures[1]?.params ?? {}, "workspace_id") &&
        c.maybeScopedPath("d") === "/projects/88888/d",
      JSON.stringify(captures.map((x) => x.params)),
    );
  }
  // resolve_workspace_id metadata fallback: empty public → index answer.
  {
    const { c } = client((req) => {
      if (req.url.includes("workspaces/public")) {
        return { status: 200, json: { results: [] } };
      }
      return {
        status: 200,
        json: {
          results: {
            "12345": {
              workspaces: {
                "9": { id: 9, name: "All Project Data", is_global: true },
              },
            },
          },
        },
      };
    });
    await expectOk(
      "resolve_workspace_id metadata fallback",
      () => c.resolveWorkspaceId(),
      (v) => v === 9,
    );
  }
  // resolve_workspace_id exhausted → WorkspaceScopeError NO_WORKSPACES.
  {
    const { c } = client((req) =>
      req.url.includes("metadata/index")
        ? { status: 200, json: { results: {} } }
        : { status: 200, json: { results: [] } },
    );
    await expectErr(
      "resolve_workspace_id exhausted → NO_WORKSPACES",
      () => c.resolveWorkspaceId(),
      (e) => e instanceof WorkspaceScopeError && e.code === "NO_WORKSPACES",
    );
  }
  // Edge values through request(params=…) encoding (httpx primitive
  // rules) and the JSON body path.
  {
    const { c, captures } = client(() => ({ status: 200, json: {} }));
    await c.request("GET", HOSTS.app, {
      params: {
        f_int_like: 18.0,
        f_frac: 1.5,
        b: true,
        n: null,
        s_empty: "",
        s_astral: "𝒳",
      },
    });
    const p = captures[0]?.params ?? {};
    record(
      "edge values through params encoding",
      p["f_int_like"] === "18" &&
        p["f_frac"] === "1.5" &&
        p["b"] === "true" &&
        p["n"] === "" &&
        p["s_empty"] === "" &&
        p["s_astral"] === "𝒳",
      JSON.stringify(p),
    );
    // NOTE (documented divergence surface, packet C1 notes decision 5):
    // a Python float 18.0 param spells "18.0" on the wire; a plain JS
    // number cannot carry float-ness, so 18.0 → "18". No C1 vector or
    // Layer-3 assert passes float params; C2 threads float-ness where a
    // recorded vector requires it.
    await c.request("POST", HOSTS.app, {
      jsonBody: { xs: [], empty: "", astral: "𝒳", none: null, flag: true },
    });
    record(
      "edge values through json body",
      captures[1]?.bodyText ===
        '{"xs":[],"empty":"","astral":"𝒳","none":null,"flag":true}',
      captures[1]?.bodyText ?? "",
    );
  }
  // Lossless float-ness of results (GATE-R5): 18.0 stays a float token.
  await expectOk(
    "lossless 18.0 result token",
    () =>
      client(() => ({
        status: 200,
        text: '{"v": 18.0}',
        headers: { "content-type": "application/json" },
      })).c.request("GET", HOSTS.query),
    (v) => {
      const member = (v as Record<string, unknown>)["v"];
      return member instanceof JsonNumber && member.raw === "18.0";
    },
  );
}

// ---------------------------------------------------------------------------
// Entry.
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await statusMatrix();
  await bugCompat403Matrix();
  await c1Behaviors();
  const failed = results.filter((r) => !r.ok);
  console.log("\n== B4-C1 R10.9 harness branch table ==");
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.branch}`);
  }
  console.log(
    `\ntotal=${results.length} pass=${results.length - failed.length} fail=${failed.length}`,
  );
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

await main();
