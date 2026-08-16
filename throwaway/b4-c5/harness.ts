/**
 * B4-C5 R10.9 throwaway harness (packet C5 §R10.9 spec): the §Wire-rule
 * status-branch list through `create_schema` (App-API representative) —
 * 200-object / 200-array / 200-scalar / 200-non-JSON / 3xx / 400 / 401
 * / 403-plain / 403-sensitive-data / 404 / other-4xx / 422-app /
 * 429-retry-then-success / 429-exhausted / 5xx / 204-app /
 * network-error — PLUS `sign_replays` 403-sensitive-data AND the R10.7
 * bug-compat matrix re-exercised through the REAL method (403 bodies
 * `42`/`1.5`/`true` → TypeError; `0`/`false`/`null`/`""` → QueryError;
 * `["SESSION_RECORDING_SENSITIVE_DATA"]` exact-element vs `["x…y"]`
 * substring-miss), the `upload_to_signed_url` external PUT (NO
 * Mixpanel auth header), form-encoding on `register_lookup_table`
 * end-to-end, the list-returning endpoints, and the fixed edge values
 * (`1.5`, `True`, `None`, `[]`, `""`, `"𝒳"`) through params/body
 * encoding (`18.0` is not representable from a plain JS number — the
 * C2 float-carrier note applies; disclosed in the RUN record).
 *
 * Wire methods have no oracle bridge (P3-2 c), so this harness IS the
 * differential: expectations are transcribed from the Python source
 * ranges cited in the packet (`api_client.py:3294-3649`, `:6480-8894`).
 * Run via `bash throwaway/b4-c5/run.sh`; the RUN record lives in the
 * Python repo notes file (`context/phase3/notes/B4-C5-notes.md`).
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
// Mini transport (C1..C4 harness pattern).
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
  extra: { maxRetries?: number; workspaceId?: number } = {},
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
  if (extra.workspaceId !== undefined) {
    c.setWorkspaceId(extra.workspaceId);
  }
  return { c, captures: t.captures, sleeps };
}

const ok = (results: unknown): Canned => ({
  status: 200,
  json: { status: "ok", results },
});

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

async function main(): Promise<void> {
  // -------------------------------------------------------------------------
  // 1. §Wire status-branch matrix through create_schema (App API).
  // -------------------------------------------------------------------------
  const schemaJson = { properties: { plan: { type: "string" } } };

  await expectOk(
    "cs/200-object",
    async () => {
      const { c } = client(() => ok({ entity_name: "Purchase" }));
      return toNativeJson(
        await c.createSchema("event", "Purchase", schemaJson),
      );
    },
    (v) => deepEq(v, { entity_name: "Purchase" }),
  );

  await expectErr(
    "cs/200-array-shape-guard",
    async () => {
      const { c } = client(() => ({ status: 200, json: [1, 2, 3] }));
      return c.createSchema("event", "Purchase", schemaJson);
    },
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.code === "UNKNOWN_ERROR" &&
      e.message.includes("expected dict, got list"),
  );

  await expectErr(
    "cs/200-scalar-shape-guard",
    async () => {
      const { c } = client(() => ({ status: 200, json: 42 }));
      return c.createSchema("event", "Purchase", schemaJson);
    },
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.message.includes("expected dict, got int"),
  );

  await expectErr(
    "cs/200-non-json-INVALID_RESPONSE",
    async () => {
      const { c } = client(() => ({ status: 200, text: "<html>nope</html>" }));
      return c.createSchema("event", "Purchase", schemaJson);
    },
    (e) => e instanceof MixpanelHeadlessError && e.code === "INVALID_RESPONSE",
  );

  await expectErr(
    "cs/3xx-json-body-HTTP_ERROR",
    async () => {
      const { c } = client(() => ({
        status: 302,
        json: { status: "ok" },
        headers: { location: "https://elsewhere.example" },
      }));
      return c.createSchema("event", "Purchase", schemaJson);
    },
    (e) => e instanceof MixpanelHeadlessError && e.code === "HTTP_ERROR",
  );

  await expectErr(
    "cs/400-QueryError",
    async () => {
      const { c } = client(() => ({ status: 400, json: { error: "bad" } }));
      return c.createSchema("event", "Purchase", schemaJson);
    },
    (e) => e instanceof QueryError && e.details["status_code"] === 400,
  );

  await expectErr(
    "cs/401-AuthenticationError",
    async () => {
      const { c } = client(() => ({ status: 401, json: { error: "no" } }));
      return c.createSchema("event", "Purchase", schemaJson);
    },
    (e) => e instanceof AuthenticationError,
  );

  await expectErr(
    "cs/403-plain-QueryError",
    async () => {
      const { c } = client(() => ({
        status: 403,
        json: { error: "Permission denied" },
      }));
      return c.createSchema("event", "Purchase", schemaJson);
    },
    (e) =>
      e instanceof QueryError &&
      !(e instanceof SessionReplayAccessError) &&
      e.details["status_code"] === 403,
  );

  await expectErr(
    "cs/403-sensitive-data-SessionReplayAccessError",
    async () => {
      const { c } = client(() => ({
        status: 403,
        json: { error: "flag SESSION_RECORDING_SENSITIVE_DATA set" },
      }));
      return c.createSchema("event", "Purchase", schemaJson);
    },
    (e) => e instanceof SessionReplayAccessError,
  );

  await expectErr(
    "cs/404-QueryError",
    async () => {
      const { c } = client(() => ({ status: 404, json: { error: "nope" } }));
      return c.createSchema("event", "Purchase", schemaJson);
    },
    (e) => e instanceof QueryError && e.details["status_code"] === 404,
  );

  await expectErr(
    "cs/412-other-4xx-QueryError",
    async () => {
      const { c } = client(() => ({ status: 412, json: { error: "pre" } }));
      return c.createSchema("event", "Purchase", schemaJson);
    },
    (e) => e instanceof QueryError && e.details["status_code"] === 412,
  );

  await expectErr(
    "cs/422-app-QueryError-lossless-body",
    async () => {
      const { c } = client(() => ({
        status: 422,
        json: {
          error: "invalid",
          detail: { big: "123456789012345678901234567" },
        },
      }));
      return c.createSchema("event", "Purchase", schemaJson);
    },
    (e) => e instanceof QueryError && e.details["status_code"] === 422,
  );

  await expectOk(
    "cs/429-retry-then-success",
    async () => {
      let n = 0;
      const { c, captures } = client(() => {
        n += 1;
        if (n === 1) {
          return {
            status: 429,
            headers: { "Retry-After": "1" },
            json: { error: "slow down" },
          };
        }
        return ok({ entity_name: "Purchase" });
      });
      const value = toNativeJson(
        await c.createSchema("event", "Purchase", schemaJson),
      );
      return { value, attempts: captures.length };
    },
    (v) => deepEq(v, { value: { entity_name: "Purchase" }, attempts: 2 }),
  );

  await expectErr(
    "cs/429-exhausted-RateLimitError",
    async () => {
      const { c } = client(
        () => ({
          status: 429,
          headers: { "Retry-After": "1" },
          json: { error: "slow down" },
        }),
        { maxRetries: 2 },
      );
      return c.createSchema("event", "Purchase", schemaJson);
    },
    (e) => e instanceof RateLimitError,
  );

  await expectErr(
    "cs/5xx-ServerError",
    async () => {
      const { c } = client(() => ({ status: 500, json: { error: "boom" } }));
      return c.createSchema("event", "Purchase", schemaJson);
    },
    (e) => e instanceof ServerError,
  );

  await expectOk(
    "cs/204-app-status-ok",
    async () => {
      const { c } = client(() => ({ status: 204 }));
      return toNativeJson(
        await c.createSchema("event", "Purchase", schemaJson),
      );
    },
    (v) => deepEq(v, { status: "ok" }),
  );

  await expectErr(
    "cs/network-error-HTTP_ERROR",
    async () => {
      const { c } = client(() => ({ status: 0, reject: "transport" }));
      return c.createSchema("event", "Purchase", schemaJson);
    },
    (e) => e instanceof MixpanelHeadlessError && e.code === "HTTP_ERROR",
  );

  // Quoted path segments on the way through (quote(safe="") twin).
  await expectOk(
    "cs/path-quote-safe-empty",
    async () => {
      const { c, captures } = client(() => ok({}));
      await c.createSchema("event", "User Sign Up / 𝒳", schemaJson);
      return captures[0]?.url;
    },
    (v) =>
      typeof v === "string" &&
      v.includes("/schemas/event/User%20Sign%20Up%20%2F%20%F0%9D%92%B3"),
  );

  // -------------------------------------------------------------------------
  // 2. sign_replays: 403-sensitive-data + the R10.7 bug-compat matrix
  //    through the REAL method (bug report
  //    python-handle-response-403-typeerror.md — replicate, never fix).
  // -------------------------------------------------------------------------

  await expectErr(
    "sr/403-flag-in-dict-body",
    async () => {
      const { c } = client(() => ({
        status: 403,
        json: {
          error:
            "Your project has sensitive replay data. Set " +
            "SESSION_RECORDING_SENSITIVE_DATA to access.",
        },
      }));
      return c.signReplays(["r-1"], "prod");
    },
    (e) =>
      e instanceof SessionReplayAccessError &&
      e.details["project_id"] === 12345 &&
      e.details["flag"] === "SESSION_RECORDING_SENSITIVE_DATA" &&
      e.details["permission_required"] === "sensitive_data_replay" &&
      e.details["status_code"] === 403,
  );

  await expectErr(
    "sr/403-plain-dict-QueryError",
    async () => {
      const { c } = client(() => ({
        status: 403,
        json: { error: "Permission denied" },
      }));
      return c.signReplays(["r-1"]);
    },
    (e) => e instanceof QueryError && !(e instanceof SessionReplayAccessError),
  );

  for (const [label, body] of [
    ["int-42", 42],
    ["float-1.5", 1.5],
    ["true", true],
  ] as const) {
    await expectErr(
      `sr/403-truthy-scalar-${label}-TypeError`,
      async () => {
        const { c } = client(() => ({ status: 403, json: body }));
        return c.signReplays(["r-1"]);
      },
      (e) => e instanceof TypeError && !(e instanceof MixpanelHeadlessError),
    );
  }

  for (const [label, body] of [
    ["zero", 0],
    ["false", false],
    ["null", null],
    ["empty-string", ""],
  ] as const) {
    await expectErr(
      `sr/403-falsy-scalar-${label}-QueryError`,
      async () => {
        const { c } = client(() => ({ status: 403, json: body }));
        return c.signReplays(["r-1"]);
      },
      (e) =>
        e instanceof QueryError && !(e instanceof SessionReplayAccessError),
    );
  }

  await expectErr(
    "sr/403-list-exact-element-flag",
    async () => {
      const { c } = client(() => ({
        status: 403,
        json: ["SESSION_RECORDING_SENSITIVE_DATA"],
      }));
      return c.signReplays(["r-1"]);
    },
    (e) => e instanceof SessionReplayAccessError,
  );

  await expectErr(
    "sr/403-list-substring-miss",
    async () => {
      const { c } = client(() => ({
        status: 403,
        json: ["xSESSION_RECORDING_SENSITIVE_DATAy"],
      }));
      return c.signReplays(["r-1"]);
    },
    (e) => e instanceof QueryError && !(e instanceof SessionReplayAccessError),
  );

  await expectOk(
    "sr/body-shape-and-env-default",
    async () => {
      const { c, captures } = client(() => ({
        status: 200,
        json: { results: [] },
      }));
      await c.signReplays(["r-1", "r-2"]);
      return JSON.parse(captures[0]?.bodyText ?? "{}") as unknown;
    },
    (v) =>
      deepEq(v, {
        replays: [
          { replay_id: "r-1", replay_env: "prod" },
          { replay_id: "r-2", replay_env: "prod" },
        ],
      }),
  );

  await expectErr(
    "sr/200-non-list-shape-guard",
    async () => {
      const { c } = client(() => ok({ nope: true }));
      return c.signReplays(["r-1"]);
    },
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.message.includes("Unexpected response from sign_replays"),
  );

  // -------------------------------------------------------------------------
  // 3. upload_to_signed_url: external PUT, NO Mixpanel auth header.
  // -------------------------------------------------------------------------

  await expectOk(
    "up/put-no-auth-header",
    async () => {
      const { c, captures } = client(() => ({ status: 200 }));
      await c.uploadToSignedUrl(
        "https://storage.googleapis.com/bucket/key",
        new TextEncoder().encode("col1,col2\na,𝒳"),
      );
      const req = captures[0];
      return {
        method: req?.method,
        hasAuth: req?.headers["authorization"] !== undefined,
        hasUserAgent: (req?.headers["user-agent"] ?? "").includes("mixpanel"),
        contentType: req?.headers["content-type"],
        body: req?.bodyText,
        host: req?.url,
      };
    },
    (v) => {
      const r = v as {
        method: string;
        hasAuth: boolean;
        hasUserAgent: boolean;
        contentType: string;
        body: string;
        host: string;
      };
      return (
        r.method === "PUT" &&
        !r.hasAuth &&
        !r.hasUserAgent &&
        r.contentType === "text/csv" &&
        r.body === "col1,col2\na,𝒳" &&
        r.host.startsWith("https://storage.googleapis.com/")
      );
    },
  );

  await expectErr(
    "up/status-300-UPLOAD_ERROR",
    async () => {
      const { c } = client(() => ({ status: 300, text: "multiple choices" }));
      return c.uploadToSignedUrl(
        "https://storage.googleapis.com/x",
        new TextEncoder().encode("a"),
      );
    },
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.code === "UPLOAD_ERROR" &&
      e.details["status_code"] === 300 &&
      e.details["url"] === "https://storage.googleapis.com/x",
  );

  await expectErr(
    "up/transport-UPLOAD_ERROR",
    async () => {
      const { c } = client(() => ({ status: 0, reject: "transport" }));
      return c.uploadToSignedUrl(
        "https://storage.googleapis.com/x",
        new TextEncoder().encode("a"),
      );
    },
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.code === "UPLOAD_ERROR" &&
      e.details["url"] === "https://storage.googleapis.com/x",
  );

  // -------------------------------------------------------------------------
  // 4. register_lookup_table / mark_lookup_table_ready: form encoding
  //    end-to-end + the manual handleResponse route (no retry loop).
  // -------------------------------------------------------------------------

  await expectOk(
    "rl/form-encoded-content-type",
    async () => {
      const { c, captures } = client(() => ok({ data_group_id: 10 }));
      await c.registerLookupTable({
        name: "Plans 𝒳",
        path: "gs://bucket/path",
        key: "id",
      });
      const req = captures[0];
      return {
        contentType: req?.headers["content-type"],
        body: req?.bodyText,
        hasAuth: req?.headers["authorization"]?.startsWith("Basic "),
      };
    },
    (v) => {
      const r = v as { contentType: string; body: string; hasAuth: boolean };
      return (
        r.contentType === "application/x-www-form-urlencoded" &&
        r.body ===
          "name=Plans+%F0%9D%92%B3&path=gs%3A%2F%2Fbucket%2Fpath&key=id" &&
        r.hasAuth === true
      );
    },
  );

  await expectOk(
    "rl/results-unwrap",
    async () => {
      const { c } = client(() => ok({ data_group_id: 10, name: "T" }));
      return toNativeJson(await c.registerLookupTable({ name: "T" }));
    },
    (v) => deepEq(v, { data_group_id: 10, name: "T" }),
  );

  await expectOk(
    "rl/no-results-key-body-verbatim",
    async () => {
      const { c } = client(() => ({ status: 200, json: { data_group_id: 3 } }));
      return toNativeJson(await c.registerLookupTable({ name: "T" }));
    },
    (v) => deepEq(v, { data_group_id: 3 }),
  );

  await expectErr(
    "rl/non-json-200-INVALID_RESPONSE",
    async () => {
      const { c } = client(() => ({ status: 200, text: "<html>x</html>" }));
      return c.registerLookupTable({ name: "T" });
    },
    (e) => e instanceof MixpanelHeadlessError && e.code === "INVALID_RESPONSE",
  );

  await expectErr(
    "rl/non-dict-after-unwrap",
    async () => {
      const { c } = client(() => ok([1, 2]));
      return c.registerLookupTable({ name: "T" });
    },
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.message.includes("expected dict, got list"),
  );

  await expectErr(
    "rl/401-routes-through-handleResponse",
    async () => {
      const { c } = client(() => ({ status: 401, json: { error: "no" } }));
      return c.registerLookupTable({ name: "T" });
    },
    (e) => e instanceof AuthenticationError,
  );

  await expectOk(
    "rl/429-NOT-retried (direct path bypasses the retry loop)",
    async () => {
      // Python `_handle_response` has NO 429 branch (the retry loops
      // own it) — on the direct register path a 429 falls into the
      // other-4xx QueryError arm, single attempt, no RateLimitError.
      const { c, captures } = client(() => ({
        status: 429,
        headers: { "Retry-After": "1" },
        json: { error: "slow" },
      }));
      try {
        await c.registerLookupTable({ name: "T" });
        return { raised: "none", attempts: captures.length };
      } catch (cause) {
        return {
          raised:
            cause instanceof QueryError && !(cause instanceof RateLimitError)
              ? "query-error"
              : String(cause),
          attempts: captures.length,
        };
      }
    },
    (v) => deepEq(v, { raised: "query-error", attempts: 1 }),
  );

  await expectOk(
    "rl/mark-ready-delegates",
    async () => {
      const { c, captures } = client(() => ok({ status: "ready" }));
      await c.markLookupTableReady({ data_group_id: "10", ready: "true" });
      return {
        body: captures[0]?.bodyText,
        method: captures[0]?.method,
        path: captures[0]?.url.split("?")[0],
      };
    },
    (v) => {
      const r = v as { body: string; method: string; path: string };
      return (
        r.method === "POST" &&
        r.body === "data_group_id=10&ready=true" &&
        r.path.endsWith("/data-definitions/lookup-tables/")
      );
    },
  );

  // -------------------------------------------------------------------------
  // 5. download_lookup_table: bytes + merged headers + handleResponse.
  // -------------------------------------------------------------------------

  await expectOk(
    "dl/bytes-and-params",
    async () => {
      const { c, captures } = client(() => ({
        status: 200,
        text: "col1,col2\nv1,v2",
        headers: { "content-type": "text/csv" },
      }));
      const bytes = await c.downloadLookupTable(5, {
        file_name: "export.csv",
        limit: 100,
      });
      const req = captures[0];
      return {
        text: new TextDecoder().decode(bytes),
        params: req?.params,
        auth: req?.headers["authorization"]?.startsWith("Basic ") ?? false,
        merged: (req?.headers["user-agent"] ?? "") !== "",
      };
    },
    (v) => {
      const r = v as {
        text: string;
        params: Record<string, string>;
        auth: boolean;
        merged: boolean;
      };
      return (
        r.text === "col1,col2\nv1,v2" &&
        deepEq(r.params, {
          "data-group-id": "5",
          "file-name": "export.csv",
          limit: "100",
        }) &&
        r.auth &&
        r.merged
      );
    },
  );

  await expectErr(
    "dl/404-handleResponse-QueryError",
    async () => {
      const { c } = client(() => ({ status: 404, json: { error: "nope" } }));
      return c.downloadLookupTable(5);
    },
    (e) => e instanceof QueryError && e.details["status_code"] === 404,
  );

  // -------------------------------------------------------------------------
  // 6. List-returning endpoints (no results-unwrap surprises).
  // -------------------------------------------------------------------------

  await expectOk(
    "lists/create_drop_filter-returns-list",
    async () => {
      const { c } = client(() => ok([{ id: 1 }, { id: 2 }]));
      return toNativeJson(await c.createDropFilter({ event_name: "x" }));
    },
    (v) => Array.isArray(v) && v.length === 2,
  );

  await expectErr(
    "lists/create_drop_filter-dict-guard",
    async () => {
      const { c } = client(() => ok({ id: 1 }));
      return c.createDropFilter({ event_name: "x" });
    },
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.message.includes("expected list, got dict"),
  );

  await expectOk(
    "lists/delete_drop_filter-DELETE-json-id",
    async () => {
      const { c, captures } = client(() => ok([]));
      await c.deleteDropFilter(42);
      return {
        method: captures[0]?.method,
        body: JSON.parse(captures[0]?.bodyText ?? "{}") as unknown,
      };
    },
    (v) => deepEq(v, { method: "DELETE", body: { id: 42 } }),
  );

  await expectOk(
    "lists/cancel_deletion_request-returns-list",
    async () => {
      const { c, captures } = client(() => ok([{ id: 1 }]));
      const value = toNativeJson(await c.cancelDeletionRequest(99));
      return {
        value,
        body: JSON.parse(captures[0]?.bodyText ?? "{}") as unknown,
        method: captures[0]?.method,
      };
    },
    (v) =>
      deepEq(v, { value: [{ id: 1 }], body: { id: 99 }, method: "DELETE" }),
  );

  await expectOk(
    "lists/run_audit-raw-two-element",
    async () => {
      const { c } = client(() =>
        ok([[{ violation: "x" }], { computed_at: "t" }]),
      );
      return toNativeJson(await c.runAudit());
    },
    (v) => Array.isArray(v) && v.length === 2,
  );

  await expectErr(
    "lists/run_audit-non-list-results",
    async () => {
      const { c } = client(() => ok({ unexpected: "dict" }));
      return c.runAudit();
    },
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.message.includes("Unexpected audit results type"),
  );

  await expectOk(
    "lists/run_audit-bare-list-body",
    async () => {
      const { c } = client(() => ({
        status: 200,
        json: [[], { computed_at: "t" }],
      }));
      return toNativeJson(await c.runAuditEventsOnly());
    },
    (v) => Array.isArray(v) && v.length === 2,
  );

  // -------------------------------------------------------------------------
  // 7. Edge values through params/body encoding + method-level guards.
  // -------------------------------------------------------------------------

  await expectOk(
    "edge/name[]-repeated-params-nonbmp-and-empty",
    async () => {
      const { c, captures } = client(() => ok([]));
      await c.getEventDefinitions(["𝒳", "", "Sign Up"]);
      return captures[0]?.url.split("?")[1];
    },
    (v) => v === "name%5B%5D=%F0%9D%92%B3&name%5B%5D=&name%5B%5D=Sign+Up",
  );

  await expectOk(
    "edge/export_lexicon-ensure-ascii-json-dumps",
    async () => {
      const { c, captures } = client(() => ok({}));
      await c.exportLexicon(["𝒳", ""]);
      return captures[0]?.params["export_type"];
    },
    // json.dumps(ensure_ascii=True): 𝒳 -> surrogate-pair 𝒳.
    (v) => v === '["\\ud835\\udcb3", ""]',
  );

  await expectOk(
    "edge/export_lexicon-default-types",
    async () => {
      const { c, captures } = client(() => ok({}));
      await c.exportLexicon();
      return captures[0]?.params["export_type"];
    },
    (v) => v === '["All Events and Properties", "All User Profile Properties"]',
  );

  await expectOk(
    "edge/lexicon-history-path-quote",
    async () => {
      const { c, captures } = client(() => ok([]));
      await c.getEventHistory("Sign Up / 𝒳");
      return captures[0]?.url.split("?")[0];
    },
    (v) =>
      typeof v === "string" &&
      v.endsWith(
        "/data-definitions/events/Sign%20Up%20%2F%20%F0%9D%92%B3/history/",
      ),
  );

  await expectOk(
    "edge/body-edge-values-preserved",
    async () => {
      const { c, captures } = client(() => ok({}));
      await c.updateEventDefinition("𝒳", {
        description: "",
        hidden: true,
        tags: [],
        dropped: null,
        weight: 1.5,
      });
      return JSON.parse(captures[0]?.bodyText ?? "{}") as unknown;
    },
    (v) =>
      deepEq(v, {
        description: "",
        hidden: true,
        tags: [],
        dropped: null,
        weight: 1.5,
        name: "𝒳",
      }),
  );

  await expectErr(
    "edge/delete_schemas-name-without-type-guard",
    async () => {
      const { c, captures } = client(() => ok({}));
      try {
        await c.deleteSchemas({ entity_name: "Signup" });
      } finally {
        if (captures.length !== 0) {
          record(
            "edge/delete_schemas-no-request-issued",
            false,
            "guard fired after a request",
          );
        } else {
          record("edge/delete_schemas-no-request-issued", true);
        }
      }
    },
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.code === "UNKNOWN_ERROR" &&
      e.message.includes("entity_name requires entity_type"),
  );

  await expectOk(
    "edge/list_property_definitions-defaults",
    async () => {
      const { c, captures } = client(() => ok([]));
      await c.listPropertyDefinitions();
      return captures[0]?.params;
    },
    (v) =>
      deepEq(v, {
        resourceType: "Event",
        includeCustom: "true",
        includeZeroCounts: "true",
      }),
  );

  await expectOk(
    "edge/list_property_definitions-false-toggles",
    async () => {
      const { c, captures } = client(() => ok([]));
      await c.listPropertyDefinitions({
        resource_type: "people",
        include_events: true,
        include_density: true,
        include_custom: false,
        include_zero_counts: false,
      });
      return captures[0]?.params;
    },
    (v) =>
      deepEq(v, {
        resourceType: "User",
        includeEvents: "true",
        includeDensity: "true",
        includeCustom: "false",
        includeZeroCounts: "false",
      }),
  );

  await expectOk(
    "edge/get_schemas-query-host-route",
    async () => {
      const { c, captures } = client(() => ({
        status: 200,
        json: { results: [{ entityType: "event" }] },
      }));
      const value = toNativeJson(await c.getSchemas());
      const req = captures[0];
      return {
        value,
        // The `_request` twin injects query_origin (NOT project_id —
        // inject_project_id=False) on the App-host URL.
        params: req?.params,
        path: req?.url.split("?")[0],
      };
    },
    (v) => {
      const r = v as {
        value: unknown;
        params: Record<string, string>;
        path: string;
      };
      return (
        deepEq(r.value, [{ entityType: "event" }]) &&
        deepEq(r.params, { query_origin: "mixpanel-headless" }) &&
        r.path === "https://mixpanel.com/api/app/projects/12345/schemas"
      );
    },
  );

  await expectOk(
    "edge/get_schemas-results-null-returns-null",
    async () => {
      // dict.get default applies only to ABSENT keys: results=null
      // comes back as null (Python None), not [].
      const { c } = client(() => ({ status: 200, json: { results: null } }));
      return toNativeJson(await c.getSchemas());
    },
    (v) => v === null,
  );

  await expectOk(
    "edge/get_schema-normalized-shape",
    async () => {
      const { c, captures } = client(() => ({
        status: 200,
        json: { status: "ok", results: { properties: {} } },
      }));
      const value = toNativeJson(await c.getSchema("event", "Purchase"));
      return { value, params: captures[0]?.params };
    },
    (v) => {
      const r = v as { value: unknown; params: Record<string, string> };
      return (
        deepEq(r.value, {
          entityType: "event",
          name: "Purchase",
          schemaJson: { properties: {} },
        }) &&
        deepEq(r.params, {
          entity_name: "Purchase",
          query_origin: "mixpanel-headless",
        })
      );
    },
  );

  await expectOk(
    "edge/custom-event-form-body-quote-plus",
    async () => {
      const { c, captures } = client(() => ({
        status: 200,
        json: { custom_event: { id: 1, name: "𝒳", alternatives: [] } },
      }));
      await c.createCustomEvent({ name: "𝒳 View", alternatives: "[]" });
      return {
        body: captures[0]?.bodyText,
        contentType: captures[0]?.headers["content-type"],
      };
    },
    (v) =>
      deepEq(v, {
        body: "name=%F0%9D%92%B3+View&alternatives=%5B%5D",
        contentType: "application/x-www-form-urlencoded",
      }),
  );

  await expectOk(
    "edge/update_custom_event-float-echo-equal (42.0 == 42)",
    async () => {
      const { c } = client(() => ({
        status: 200,
        json: { status: "ok", results: { customEventId: 42.0, name: "X" } },
      }));
      // JSON 42.0 arrives as the lossless token "42.0" — Python
      // `42.0 != 42` is False, so no mismatch raise.
      return toNativeJson(await c.updateCustomEvent(42, { hidden: true }));
    },
    (v) => typeof v === "object" && v !== null && !Array.isArray(v),
  );

  await expectErr(
    "edge/update_custom_event-string-echo-mismatch",
    async () => {
      const { c } = client(() => ({
        status: 200,
        json: { status: "ok", results: { customEventId: "42", name: "X" } },
      }));
      return c.updateCustomEvent(42, { hidden: true });
    },
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.code === "UPDATE_TARGET_MISMATCH" &&
      e.message.includes("'42'"),
  );

  await expectOk(
    "edge/workspace-pin-scopes-c5-paths",
    async () => {
      const { c, captures } = client(() => ok([]), { workspaceId: 77 });
      await c.listDropFilters();
      return captures[0]?.url.split("?")[0];
    },
    (v) =>
      typeof v === "string" &&
      v.includes("/workspaces/77/data-definitions/events/drop-filters/"),
  );

  await expectOk(
    "edge/business-context-project-scope-not-workspace",
    async () => {
      const { c, captures } = client(() => ok({ content: "" }), {
        workspaceId: 77,
      });
      await c.getBusinessContext();
      return captures[0]?.url.split("?")[0];
    },
    // Direct project path — NEVER workspace-scoped, even when pinned.
    (v) => v === "https://mixpanel.com/api/app/projects/12345/business-context",
  );

  await expectOk(
    "edge/business-context-org-scope",
    async () => {
      const { c, captures } = client(() => ok({ content: "x" }));
      await c.setBusinessContext("x", { organization_id: 100 });
      return {
        path: captures[0]?.url.split("?")[0],
        method: captures[0]?.method,
        body: JSON.parse(captures[0]?.bodyText ?? "{}") as unknown,
      };
    },
    (v) =>
      deepEq(v, {
        path: "https://mixpanel.com/api/app/organizations/100/business-context",
        method: "PUT",
        body: { content: "x" },
      }),
  );

  await expectErr(
    "edge/get_lookup_download_url-falsy-url-MISSING_URL",
    async () => {
      const { c } = client(() => ok({ url: "", download_url: "" }));
      return c.getLookupDownloadUrl(5);
    },
    (e) => e instanceof MixpanelHeadlessError && e.code === "MISSING_URL",
  );

  await expectOk(
    "edge/get_lookup_download_url-fallback-key",
    async () => {
      const { c } = client(() =>
        ok({ url: "", download_url: "https://dl.example/x" }),
      );
      return c.getLookupDownloadUrl(5);
    },
    (v) => v === "https://dl.example/x",
  );

  await expectErr(
    "edge/get_lookup_upload_url-missing-key-MISSING_FIELD",
    async () => {
      const { c } = client(() => ok({ url: "u", path: "p" }));
      return c.getLookupUploadUrl();
    },
    (e) => e instanceof MixpanelHeadlessError && e.code === "MISSING_FIELD",
  );

  await expectOk(
    "edge/anomalies-results-passthrough-when-no-results-key",
    async () => {
      // The ladder's `result.get("results", result)` arm: a bare
      // {"anomalies": [...]} body (no envelope) still resolves.
      const { c } = client(() => ({
        status: 200,
        json: { anomalies: [{ id: 1 }] },
      }));
      return toNativeJson(await c.listDataVolumeAnomalies());
    },
    (v) => Array.isArray(v) && v.length === 1,
  );

  await expectErr(
    "edge/anomalies-missing-key",
    async () => {
      const { c } = client(() => ok({ items: [] }));
      return c.listDataVolumeAnomalies();
    },
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.message.includes("missing 'anomalies' key"),
  );

  await expectOk(
    "edge/export_lexicon-string-results-pending-wrap",
    async () => {
      const { c } = client(() => ok("Export in progress"));
      return toNativeJson(await c.exportLexicon());
    },
    (v) => deepEq(v, { status: "pending", message: "Export in progress" }),
  );

  // -------------------------------------------------------------------------
  // Summary.
  // -------------------------------------------------------------------------
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(
    JSON.stringify({ branches: results.length, passed, failed }, null, 2),
  );
  if (failed > 0) {
    process.exitCode = 1;
  }
}

await main();
