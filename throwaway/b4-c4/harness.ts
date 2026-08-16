/**
 * B4-C4 R10.9 throwaway harness (packet C4 §R10.9 spec): the §Wire-rule
 * status-branch list through `create_alert` (App-API representative) —
 * 200-object / 200-array / 200-scalar / 200-non-JSON / 3xx / 400 / 401
 * / 403-plain / 403-sensitive-data + the applicable R10.7 bug-compat
 * rows / 404 / other-4xx / 422-app / 429-retry-then-success /
 * 429-exhausted / 5xx / 204-app / network-error — plus the 204/None
 * returns across the whole delete/archive/void family, the
 * `get_alert_history` param grid AND its `_raw` shape ladder
 * (`api_client.py:6352-6371`), the flags require-scoped vs
 * limits-project-scoped split, the experiments trailing-slash matrix,
 * and the POST-body/param edge values (empty body `{}`, `[]` ids,
 * `"𝒳"` names, floats, `True`, `None`, `""`).
 *
 * Wire methods have no oracle bridge (P3-2 c), so this harness IS the
 * differential: expectations are transcribed from the Python source
 * range cited in the packet (`api_client.py:4938-6479`). Run via
 * `bash throwaway/b4-c4/run.sh`; the RUN record lives in the Python
 * repo notes file (`context/phase3/notes/B4-C4-notes.md`).
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
// Mini transport (C1/C2/C3 harness pattern).
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
  // 1. §Wire status-branch matrix through create_alert (App API).
  //    Python arbiter: api_client.py:6122-6153 over _handle_response
  //    :503-670 / app_request :1160-1389.
  // -------------------------------------------------------------------------

  await expectOk(
    "ca/200-object-results-unwrap",
    () =>
      client(() => ok({ id: 99, name: "New Alert" })).c.createAlert({
        name: "New Alert",
      }),
    (v) => deepEq(toNativeJson(v), { id: 99, name: "New Alert" }),
  );

  await expectErr(
    "ca/200-array-body-expected-dict",
    () => client(() => ({ status: 200, json: [1, 2] })).c.createAlert({}),
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.message.includes("expected dict, got list"),
  );

  await expectErr(
    "ca/200-scalar-body-expected-dict-int",
    () => client(() => ({ status: 200, json: 42 })).c.createAlert({}),
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.message.includes("expected dict, got int"),
  );

  await expectErr(
    "ca/200-scalar-str-expected-dict",
    () => client(() => ({ status: 200, json: "ok" })).c.createAlert({}),
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.message.includes("expected dict, got str"),
  );

  await expectErr(
    "ca/200-scalar-true-expected-dict-bool",
    () => client(() => ({ status: 200, json: true })).c.createAlert({}),
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.message.includes("expected dict, got bool"),
  );

  await expectErr(
    "ca/200-scalar-null-expected-dict-NoneType",
    () => client(() => ({ status: 200, json: null })).c.createAlert({}),
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.message.includes("expected dict, got NoneType"),
  );

  await expectErr(
    "ca/200-scalar-float-expected-dict-float",
    () => client(() => ({ status: 200, json: 1.5 })).c.createAlert({}),
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.message.includes("expected dict, got float"),
  );

  await expectErr(
    "ca/200-non-json-INVALID_RESPONSE",
    () =>
      client(() => ({ status: 200, text: "<html>nope</html>" })).c.createAlert(
        {},
      ),
    (e) => e instanceof MixpanelHeadlessError && e.code === "INVALID_RESPONSE",
  );

  await expectErr(
    "ca/3xx-json-body-HTTP_ERROR",
    () =>
      client(() => ({
        status: 302,
        json: { location: "elsewhere" },
      })).c.createAlert({}),
    (e) => e instanceof MixpanelHeadlessError && e.code === "HTTP_ERROR",
  );

  await expectErr(
    "ca/400-QueryError",
    () =>
      client(() => ({ status: 400, json: { error: "bad" } })).c.createAlert({}),
    (e) => e instanceof QueryError && e.statusCode === 400,
  );

  await expectErr(
    "ca/401-AuthenticationError",
    () =>
      client(() => ({
        status: 401,
        json: { error: "who are you" },
      })).c.createAlert({}),
    (e) => e instanceof AuthenticationError,
  );

  await expectErr(
    "ca/403-plain-QueryError",
    () =>
      client(() => ({ status: 403, json: { error: "denied" } })).c.createAlert(
        {},
      ),
    (e) => e instanceof QueryError && e.statusCode === 403,
  );

  await expectErr(
    "ca/403-sensitive-list-exact-element",
    () =>
      client(() => ({
        status: 403,
        json: ["SESSION_RECORDING_SENSITIVE_DATA"],
      })).c.createAlert({}),
    (e) => e instanceof SessionReplayAccessError,
  );

  // R10.7 bug-compat rows reachable through an App-API method (the full
  // matrix re-runs through sign_replays at C5): truthy non-dict/non-str
  // scalar → TypeError analog; falsy scalar → QueryError; list
  // substring-miss → QueryError (exact-element membership only).
  await expectErr(
    "ca/403-bugcompat-42-TypeError",
    () => client(() => ({ status: 403, json: 42 })).c.createAlert({}),
    (e) => e instanceof TypeError && !(e instanceof MixpanelHeadlessError),
  );

  await expectErr(
    "ca/403-bugcompat-1.5-TypeError",
    () => client(() => ({ status: 403, json: 1.5 })).c.createAlert({}),
    (e) => e instanceof TypeError && !(e instanceof MixpanelHeadlessError),
  );

  await expectErr(
    "ca/403-bugcompat-true-TypeError",
    () => client(() => ({ status: 403, json: true })).c.createAlert({}),
    (e) => e instanceof TypeError && !(e instanceof MixpanelHeadlessError),
  );

  await expectErr(
    "ca/403-bugcompat-0-QueryError",
    () => client(() => ({ status: 403, json: 0 })).c.createAlert({}),
    (e) => e instanceof QueryError && e.statusCode === 403,
  );

  await expectErr(
    "ca/403-bugcompat-false-QueryError",
    () => client(() => ({ status: 403, json: false })).c.createAlert({}),
    (e) => e instanceof QueryError && e.statusCode === 403,
  );

  await expectErr(
    "ca/403-bugcompat-null-QueryError",
    () => client(() => ({ status: 403, json: null })).c.createAlert({}),
    (e) => e instanceof QueryError && e.statusCode === 403,
  );

  await expectErr(
    "ca/403-substring-miss-QueryError",
    () =>
      client(() => ({
        status: 403,
        json: ["xSESSION_RECORDING_SENSITIVE_DATAy"],
      })).c.createAlert({}),
    (e) => e instanceof QueryError && e.statusCode === 403,
  );

  await expectErr(
    "ca/404-QueryError",
    () =>
      client(() => ({ status: 404, json: { error: "nope" } })).c.createAlert(
        {},
      ),
    (e) => e instanceof QueryError && e.statusCode === 404,
  );

  await expectErr(
    "ca/other-4xx-418-QueryError",
    () =>
      client(() => ({ status: 418, json: { error: "teapot" } })).c.createAlert(
        {},
      ),
    (e) => e instanceof QueryError && e.statusCode === 418,
  );

  await expectErr(
    "ca/422-app-QueryError",
    () =>
      client(() => ({
        status: 422,
        json: { error: "unprocessable" },
      })).c.createAlert({}),
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
      return ok({ id: 1 });
    });
    await expectOk(
      "ca/429-retry-then-success",
      () => c.createAlert({ name: "r" }),
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
          json: { error: "still slow" },
          headers: { "Retry-After": "1" },
        };
      },
      { maxRetries: 2 },
    );
    await expectErr(
      "ca/429-exhausted-RateLimitError",
      () => c.createAlert({}),
      (e) =>
        e instanceof RateLimitError &&
        e.statusCode === 429 &&
        calls === 3 &&
        // FF4: app_request raise carries project_id.
        (e.details as Record<string, unknown>)["project_id"] === "12345",
    );
  }

  await expectErr(
    "ca/5xx-ServerError",
    () =>
      client(() => ({ status: 500, json: { error: "boom" } })).c.createAlert(
        {},
      ),
    (e) => e instanceof ServerError && e.statusCode === 500,
  );

  await expectOk(
    "ca/204-app-status-ok",
    () => client(() => ({ status: 204 })).c.createAlert({}),
    // 204 → {status: "ok"} → isinstance dict → returned verbatim.
    (v) => deepEq(toNativeJson(v), { status: "ok" }),
  );

  await expectErr(
    "ca/network-error-HTTP_ERROR",
    () => client(() => ({ status: 0, reject: "transport" })).c.createAlert({}),
    (e) => e instanceof MixpanelHeadlessError && e.code === "HTTP_ERROR",
  );

  // -------------------------------------------------------------------------
  // 2. 204/None across the whole delete/archive/void family (each
  //    resolves undefined and sends the exact verb+path).
  // -------------------------------------------------------------------------

  {
    const { c, captures } = client(() => ({ status: 204 }), {
      workspaceId: 100,
    });
    await c.deleteFeatureFlag("abc-123");
    await c.archiveFeatureFlag("abc-123");
    await c.setFlagTestUsers("abc-123", { users: { on: "u1" } });
    record(
      "void/flags-family-verbs-paths",
      captures[0]!.method === "DELETE" &&
        captures[0]!.url.includes(
          "/projects/12345/workspaces/100/feature-flags/abc-123/",
        ) &&
        captures[1]!.method === "POST" &&
        captures[1]!.url.includes("/feature-flags/abc-123/archive/") &&
        captures[2]!.method === "PUT" &&
        captures[2]!.url.includes("/feature-flags/abc-123/test-users/") &&
        JSON.parse(captures[2]!.bodyText) !== null,
      JSON.stringify(captures.map((x) => [x.method, x.url])),
    );
  }

  {
    const { c, captures } = client(() => ({ status: 204 }));
    const r1 = await c.deleteExperiment("xyz-456");
    const r2 = await c.archiveExperiment("xyz-456");
    const r3 = await c.deleteAnnotation(42);
    const r4 = await c.deleteWebhook("wh-uuid-123");
    const r5 = await c.deleteAlert(42);
    const r6 = await c.bulkDeleteAlerts([1, 2, 3]);
    record(
      "void/family-undefined-returns",
      [r1, r2, r3, r4, r5, r6].every((r) => r === undefined),
      JSON.stringify([r1, r2, r3, r4, r5, r6]),
    );
    record(
      "void/family-verbs-paths",
      captures[0]!.method === "DELETE" &&
        captures[0]!.url.includes("/projects/12345/experiments/xyz-456") &&
        captures[1]!.method === "POST" &&
        captures[1]!.url.includes("/experiments/xyz-456/archive") &&
        captures[2]!.method === "DELETE" &&
        captures[2]!.url.includes("/annotations/42/") &&
        captures[3]!.method === "DELETE" &&
        captures[3]!.url.includes("/webhooks/wh-uuid-123/") &&
        captures[4]!.method === "DELETE" &&
        captures[4]!.url.includes("/alerts/custom/42/") &&
        captures[5]!.method === "POST" &&
        captures[5]!.url.includes("/alerts/custom/bulk-delete/") &&
        deepEq(JSON.parse(captures[5]!.bodyText), { alert_ids: [1, 2, 3] }),
      JSON.stringify(captures.map((x) => [x.method, x.url])),
    );
  }

  // Experiments trailing-slash matrix: item/lifecycle endpoints carry
  // NO trailing slash; collections do (api_client.py:5303-5661).
  {
    const { c, captures } = client((req) =>
      req.method === "GET" && req.url.includes("erf")
        ? ok([])
        : ok({ id: "xyz-456" }),
    );
    await c.getExperiment("xyz-456");
    await c.launchExperiment("xyz-456");
    await c.concludeExperiment("xyz-456");
    await c.decideExperiment("xyz-456", { success: true });
    await c.restoreExperiment("xyz-456");
    await c.listErfExperiments();
    const path = (i: number): string => new URL(captures[i]!.url).pathname;
    record(
      "exp/trailing-slash-matrix",
      path(0).endsWith("/experiments/xyz-456") &&
        captures[1]!.method === "PUT" &&
        path(1).endsWith("/experiments/xyz-456/launch") &&
        captures[2]!.method === "PUT" &&
        path(2).endsWith("/experiments/xyz-456/force_conclude") &&
        captures[3]!.method === "PATCH" &&
        path(3).endsWith("/experiments/xyz-456/decide") &&
        captures[4]!.method === "DELETE" &&
        path(4).endsWith("/experiments/xyz-456/archive") &&
        path(5).endsWith("/experiments/erf/"),
      JSON.stringify(captures.map((x) => [x.method, x.url])),
    );
  }

  // -------------------------------------------------------------------------
  // 3. get_alert_history: param grid + the _raw shape ladder
  //    (api_client.py:6341-6371).
  // -------------------------------------------------------------------------

  {
    const { c, captures } = client(() =>
      ok({ results: [{ fired: true }], pagination: { page_size: 20 } }),
    );
    await expectOk(
      "gah/inner-dict-with-pagination-returned",
      () => c.getAlertHistory(42),
      (v) =>
        deepEq(toNativeJson(v), {
          results: [{ fired: true }],
          pagination: { page_size: 20 },
        }),
    );
    record(
      "gah/no-params-none-sent",
      !("page_size" in captures[0]!.params) &&
        !("next_cursor" in captures[0]!.params) &&
        !("previous_cursor" in captures[0]!.params) &&
        captures[0]!.url.includes("/alerts/custom/42/history/"),
      JSON.stringify(captures[0]!.params),
    );
  }

  await expectOk(
    "gah/inner-dict-missing-pagination-null-injected",
    () => client(() => ok({ results: [1, 2] })).c.getAlertHistory(42),
    (v) => deepEq(toNativeJson(v), { results: [1, 2], pagination: null }),
  );

  await expectOk(
    "gah/inner-list-wrapped",
    () => client(() => ok([{ fired: false }])).c.getAlertHistory(42),
    (v) =>
      deepEq(toNativeJson(v), {
        results: [{ fired: false }],
        pagination: null,
      }),
  );

  await expectOk(
    "gah/outer-list-wrapped",
    () => client(() => ({ status: 200, json: [1, 2] })).c.getAlertHistory(42),
    (v) => deepEq(toNativeJson(v), { results: [1, 2], pagination: null }),
  );

  await expectErr(
    "gah/outer-dict-missing-results-raises",
    () =>
      client(() => ({ status: 200, json: { nope: 1 } })).c.getAlertHistory(42),
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.message.includes("dict missing 'results' key"),
  );

  await expectErr(
    "gah/inner-dict-without-results-raises-dict",
    () => client(() => ok({ pagination: {} })).c.getAlertHistory(42),
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.message.includes("got dict without results list"),
  );

  await expectErr(
    "gah/inner-scalar-raises-dict",
    () => client(() => ok(42)).c.getAlertHistory(42),
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.message.includes("got dict without results list"),
  );

  await expectErr(
    "gah/outer-scalar-raises-int",
    () => client(() => ({ status: 200, json: 7 })).c.getAlertHistory(42),
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.message.includes("got int without results list"),
  );

  {
    const { c, captures } = client(() => ok({ results: [], pagination: null }));
    await c.getAlertHistory(42, { page_size: 10 });
    await c.getAlertHistory(42, { next_cursor: "abc" });
    await c.getAlertHistory(42, { previous_cursor: "prev" });
    await c.getAlertHistory(42, {
      page_size: 5,
      next_cursor: "n",
      previous_cursor: "p",
    });
    record(
      "gah/param-grid",
      captures[0]!.params["page_size"] === "10" &&
        !("next_cursor" in captures[0]!.params) &&
        captures[1]!.params["next_cursor"] === "abc" &&
        !("page_size" in captures[1]!.params) &&
        captures[2]!.params["previous_cursor"] === "prev" &&
        captures[3]!.params["page_size"] === "5" &&
        captures[3]!.params["next_cursor"] === "n" &&
        captures[3]!.params["previous_cursor"] === "p",
      JSON.stringify(captures.map((x) => x.params)),
    );
  }

  // -------------------------------------------------------------------------
  // 4. Flags scoping: require_scoped_path (pinned) vs the ALWAYS
  //    project-scoped get_flag_limits (api_client.py:5263-5264).
  // -------------------------------------------------------------------------

  {
    const { c, captures } = client(() => ok([]), { workspaceId: 100 });
    await c.listFeatureFlags();
    record(
      "flags/require-scoped-pinned",
      captures[0]!.url.includes(
        "/api/app/projects/12345/workspaces/100/feature-flags/",
      ),
      captures[0]!.url,
    );
  }

  {
    const { c, captures } = client(() => ok({ limit: 100 }), {
      workspaceId: 100,
    });
    await c.getFlagLimits();
    record(
      "flags/limits-project-scoped-despite-pin",
      captures[0]!.url.includes("/projects/12345/feature-flags/limits/") &&
        !captures[0]!.url.includes("/workspaces/"),
      captures[0]!.url,
    );
  }

  // Owned guard branches per domain: list-guard (dict body) and
  // dict-guard (list body) spell the Python method name + type name.
  await expectErr(
    "guards/list_feature_flags-dict-body",
    () => client(() => ok({}), { workspaceId: 100 }).c.listFeatureFlags(),
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.message ===
        "Unexpected response from list_feature_flags: expected list, got dict",
  );

  await expectErr(
    "guards/list_experiments-scalar-body",
    () => client(() => ok("nope")).c.listExperiments(),
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.message ===
        "Unexpected response from list_experiments: expected list, got str",
  );

  await expectErr(
    "guards/list_annotations-dict-body",
    () => client(() => ok({})).c.listAnnotations(),
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.message ===
        "Unexpected response from list_annotations: expected list, got dict",
  );

  await expectErr(
    "guards/list_webhooks-null-body",
    () => client(() => ok(null)).c.listWebhooks(),
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.message ===
        "Unexpected response from list_webhooks: expected list, got NoneType",
  );

  await expectErr(
    "guards/get_experiment-list-body",
    () => client(() => ok([])).c.getExperiment("x"),
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.message ===
        "Unexpected response from get_experiment: expected dict, got list",
  );

  await expectErr(
    "guards/test_webhook-list-body",
    () => client(() => ok([])).c.testWebhook({}),
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.message ===
        "Unexpected response from test_webhook: expected dict, got list",
  );

  await expectErr(
    "guards/create_annotation_tag-list-body",
    () => client(() => ok([])).c.createAnnotationTag({}),
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.message ===
        "Unexpected response from create_annotation_tag: " +
          "expected dict, got list",
  );

  await expectErr(
    "guards/get_alert_screenshot_url-list-body",
    () => client(() => ok([])).c.getAlertScreenshotUrl("k"),
    (e) =>
      e instanceof MixpanelHeadlessError &&
      e.message ===
        "Unexpected response from get_alert_screenshot_url: " +
          "expected dict, got list",
  );

  // -------------------------------------------------------------------------
  // 5. Body-presence semantics: conclude ALWAYS sends `{}`; duplicate
  //    sends NO body for None AND for `{}` (Python truthiness);
  //    launch/archive send no body.
  // -------------------------------------------------------------------------

  {
    const { c, captures } = client(() => ok({ id: "x" }));
    await c.concludeExperiment("x");
    await c.concludeExperiment("x", {});
    await c.concludeExperiment("x", { end_date: "2026-04-01" });
    await c.duplicateExperiment("x");
    await c.duplicateExperiment("x", {});
    await c.duplicateExperiment("x", { name: "Copy" });
    await c.launchExperiment("x");
    await c.archiveExperiment("x");
    record(
      "exp/body-presence-semantics",
      captures[0]!.bodyText === "{}" &&
        captures[1]!.bodyText === "{}" &&
        deepEq(JSON.parse(captures[2]!.bodyText), {
          end_date: "2026-04-01",
        }) &&
        captures[3]!.bodyText === "" &&
        captures[4]!.bodyText === "" &&
        deepEq(JSON.parse(captures[5]!.bodyText), { name: "Copy" }) &&
        captures[6]!.bodyText === "" &&
        captures[7]!.bodyText === "",
      JSON.stringify(captures.map((x) => x.bodyText)),
    );
  }

  // -------------------------------------------------------------------------
  // 6. Param gating: `is not None` (alerts) vs Python truthiness
  //    (flags include_archived, annotations filters).
  // -------------------------------------------------------------------------

  {
    const { c, captures } = client(() => ok([]));
    await c.listAlerts();
    await c.listAlerts({ bookmark_id: 0, skip_user_filter: false });
    await c.listAlerts({ bookmark_id: 42, skip_user_filter: true });
    record(
      "alerts/is-not-none-param-gate",
      Object.keys(captures[0]!.params).length === 0 &&
        // 0 and False pass the `is not None` gate — sent as "0"/"false"
        // (str(x).lower() twin).
        captures[1]!.params["bookmark_id"] === "0" &&
        captures[1]!.params["skip_user_filter"] === "false" &&
        captures[2]!.params["bookmark_id"] === "42" &&
        captures[2]!.params["skip_user_filter"] === "true",
      JSON.stringify(captures.map((x) => x.params)),
    );
  }

  {
    const { c, captures } = client(() => ok([]), { workspaceId: 100 });
    await c.listFeatureFlags({ include_archived: false });
    await c.listFeatureFlags({ include_archived: true });
    record(
      "flags/include-archived-truthiness",
      // False is FALSY — param omitted (unlike the alerts gate).
      !("include_archived" in captures[0]!.params) &&
        captures[1]!.params["include_archived"] === "true",
      JSON.stringify(captures.map((x) => x.params)),
    );
  }

  {
    const { c, captures } = client(() => ok([]));
    await c.listAnnotations({ from_date: "", to_date: "", tags: [] });
    await c.listAnnotations({
      from_date: "2026-01-01",
      to_date: "2026-03-31",
      tags: [1, 2],
    });
    record(
      "annotations/truthiness-gates-and-camelCase",
      Object.keys(captures[0]!.params).length === 0 &&
        captures[1]!.params["fromDate"] === "2026-01-01" &&
        captures[1]!.params["toDate"] === "2026-03-31" &&
        captures[1]!.params["tags"] === "1,2",
      JSON.stringify(captures.map((x) => x.params)),
    );
  }

  {
    const { c, captures } = client(() => ok({ signed_url: "u" }));
    await c.getAlertCount();
    await c.getAlertCount({ alert_type: "anomaly" });
    await c.getAlertScreenshotUrl("screenshots/abc.png");
    record(
      "alerts/count-type-and-screenshot-gcs-key",
      Object.keys(captures[0]!.params).length === 0 &&
        captures[1]!.params["type"] === "anomaly" &&
        captures[2]!.params["gcs_key"] === "screenshots/abc.png",
      JSON.stringify(captures.map((x) => x.params)),
    );
  }

  // -------------------------------------------------------------------------
  // 7. Edge values through params/body encoding (fixed set: 18.0 is
  //    unreachable as a JS double distinct from 18 — 18.5/1.5 carry the
  //    float arm; True/None/[]/""/"𝒳" verbatim).
  // -------------------------------------------------------------------------

  {
    const { c, captures } = client(() => ok({ id: 1 }));
    await c.createAlert({});
    await c.bulkDeleteAlerts([]);
    await c.createAlert({
      name: "𝒳",
      threshold: 18.5,
      ratio: 1.5,
      paused: true,
      note: null,
      tags: [],
      empty: "",
    });
    await c.createAnnotation({ date: "2026-03-31", description: "𝒳 release" });
    record(
      "edge/body-values-verbatim",
      captures[0]!.bodyText === "{}" &&
        deepEq(JSON.parse(captures[1]!.bodyText), { alert_ids: [] }) &&
        deepEq(JSON.parse(captures[2]!.bodyText), {
          name: "𝒳",
          threshold: 18.5,
          ratio: 1.5,
          paused: true,
          note: null,
          tags: [],
          empty: "",
        }) &&
        deepEq(JSON.parse(captures[3]!.bodyText), {
          date: "2026-03-31",
          description: "𝒳 release",
        }),
      JSON.stringify(captures.map((x) => x.bodyText)),
    );
  }

  {
    const { c, captures } = client(() => ok({ events: [], count: 0 }), {
      workspaceId: 100,
    });
    await c.getFlagHistory("𝒳-flag", {
      params: { page_size: "50", page: "cursor-abc" },
    });
    record(
      "edge/flag-history-params-passthrough-and-unicode-id",
      captures[0]!.params["page_size"] === "50" &&
        captures[0]!.params["page"] === "cursor-abc" &&
        decodeURIComponent(new URL(captures[0]!.url).pathname).includes(
          "/feature-flags/𝒳-flag/history/",
        ),
      captures[0]!.url,
    );
  }

  // ---------------------------------------------------------------------------
  // Report.
  // ---------------------------------------------------------------------------

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(
    JSON.stringify(
      {
        harness: "b4-c4",
        total: results.length,
        passed,
        failed,
        branches: results.map((r) => `${r.ok ? "PASS" : "FAIL"} ${r.branch}`),
      },
      null,
      2,
    ),
  );
  if (failed > 0) {
    process.exitCode = 1;
  }
}

await main();
