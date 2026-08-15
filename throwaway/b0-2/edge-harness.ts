/**
 * B0-2 R10.9 throwaway differential harness — deterministic edge-set
 * replay for the shared client internals (P3-2 step (c); the packet's
 * verbatim branch list). Wire internals have no oracle `call` surface,
 * so this half replays every `_handle_response` / retry / `app_request`
 * branch through `createVectorFetch` with hand-built interactions and a
 * minimal fetch→WireResponse adapter (a prototype of B4-C1's transport,
 * living ONLY here), asserting outcomes against the Python-source truth
 * (class + code / lossless value). The oracle-bridge fuzz half
 * (`jsonl_chunks`, ≥500 examples) runs via run-fuzz.sh.
 *
 * Kept in-tree per the playbook harness-retention rule (review pair
 * re-runs it; the BATCH GATE removes `throwaway/` after arbiter
 * sign-off).
 */

import {
  appRequest,
  executeWithRetry,
  getUserAgent,
  iterJsonlLines,
  MixpanelHeadlessError,
  MixpanelHttpError,
  parseLossless,
  requestHeaders,
  type AppRequestDeps,
  type RequestExecutor,
  type RetryExecutorDeps,
  type TransportRequestOptions,
  type WireResponse,
} from "../../packages/core/src/client/index.js";
import { canonicalize } from "../../conformance-runner/src/canonical.js";
import {
  parseInteractions,
  type ParsedInteraction,
} from "../../conformance-runner/src/interactions.js";
import { JsonNumber } from "../../conformance-runner/src/json-value.js";
import type { JsonValue } from "../../conformance-runner/src/json-value.js";
import { createVectorFetch } from "../../conformance-runner/src/vector-fetch.js";

/** One canned interaction in raw vector-JSON shape. */
interface RawInteraction {
  request: { method: string; path: string };
  response:
    | {
        status: number;
        body_text?: string;
        headers?: Record<string, string>;
      }
    | { transport_error: string };
}

/**
 * Convert raw interactions to the parsed form (numbers as JsonNumber, as
 * the lossless loader would produce).
 *
 * @param raw - The hand-built interactions.
 * @returns Parsed interactions.
 */
function parse(raw: readonly RawInteraction[]): ParsedInteraction[] {
  const json: JsonValue = raw.map((interaction) => {
    const response = interaction.response;
    const encoded: { [key: string]: JsonValue } =
      "transport_error" in response
        ? { transport_error: response.transport_error }
        : {
            status: new JsonNumber(String(response.status)),
            ...(response.body_text !== undefined
              ? { body_text: response.body_text }
              : {}),
            ...(response.headers !== undefined
              ? { headers: response.headers }
              : {}),
          };
    return {
      request: {
        method: interaction.request.method,
        path: interaction.request.path,
      },
      response: encoded,
    };
  });
  return parseInteractions(json, "b0-2-edge-harness");
}

/**
 * Minimal fetch→WireResponse adapter (B4-C1 prototype; throwaway-only).
 *
 * @param fetchImpl - The injected fetch (VectorFetch harness).
 * @returns A RequestExecutor honoring the R2.10/R2.11 contract.
 */
function fetchExecutor(fetchImpl: typeof fetch): RequestExecutor {
  return async (options: TransportRequestOptions): Promise<WireResponse> => {
    const url = new URL(options.url);
    for (const [key, value] of Object.entries(options.params)) {
      url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = { ...options.headers };
    let body: string | undefined;
    if (options.jsonBody !== null) {
      body = JSON.stringify(options.jsonBody);
      headers["content-type"] = "application/json";
    } else if (options.formBody !== null) {
      body = new URLSearchParams(options.formBody).toString();
      headers["content-type"] = "application/x-www-form-urlencoded";
    }
    let response: Response;
    try {
      response = await fetchImpl(url.toString(), {
        method: options.method,
        headers,
        ...(body !== undefined ? { body } : {}),
        redirect: "manual", // R2.11
      });
    } catch (cause) {
      // R2.10: adapter owns transport-failure normalization.
      throw new MixpanelHttpError(
        cause instanceof Error ? cause.message : String(cause),
        { cause },
      );
    }
    const text = await response.text();
    return {
      status: response.status,
      text,
      header: (name: string) => response.headers.get(name),
    };
  };
}

/** Expected outcome of one edge case. */
type Expected =
  | { kind: "value"; canonical: string }
  | { kind: "error"; className: string; code?: string }
  | { kind: "typeerror" };

/** One edge case. */
interface EdgeCase {
  name: string;
  interactions: RawInteraction[];
  maxRetries?: number;
  run: "execute" | "app" | ((deps: never) => Promise<unknown>);
  appOptions?: Parameters<typeof appRequest>[3];
  expected: Expected;
  expectedSleepsMs?: number[];
}

/** JSON value expectation helper. */
const value = (jsonText: string): Expected => ({
  kind: "value",
  canonical: canonicalize(parseLossless(jsonText)),
});

/** Error expectation helper. */
const error = (className: string, code?: string): Expected => ({
  kind: "error",
  className,
  ...(code !== undefined ? { code } : {}),
});

/** GET response shorthand. */
const on = (
  status: number,
  bodyText?: string,
  headers?: Record<string, string>,
): RawInteraction => ({
  request: { method: "GET", path: "/api/query/events/names" },
  response: {
    status,
    ...(bodyText !== undefined ? { body_text: bodyText } : {}),
    ...(headers !== undefined ? { headers } : {}),
  },
});

const SENSITIVE =
  '{"error": "Set SESSION_RECORDING_SENSITIVE_DATA to access."}';

/** The packet's verbatim `_handle_response` branch list + R10.9 values. */
const CASES: EdgeCase[] = [
  {
    name: "200-object",
    interactions: [on(200, '{"a": 1, "f": 18.0}')],
    run: "execute",
    expected: value('{"a": 1, "f": 18.0}'),
  },
  {
    name: "200-array",
    interactions: [on(200, "[1, 2.5]")],
    run: "execute",
    expected: value("[1, 2.5]"),
  },
  {
    name: "200-non-JSON",
    interactions: [on(200, "<html>nope</html>")],
    run: "execute",
    expected: error("MixpanelHeadlessError", "INVALID_RESPONSE"),
  },
  {
    name: "200-empty-body",
    interactions: [on(200, "")],
    run: "execute",
    expected: error("MixpanelHeadlessError", "INVALID_RESPONSE"),
  },
  {
    name: "200-scalar-int",
    interactions: [on(200, "42")],
    run: "execute",
    expected: value("42"),
  },
  {
    name: "200-scalar-integral-float",
    interactions: [on(200, "18.0")],
    run: "execute",
    expected: value("18.0"),
  },
  {
    name: "200-scalar-fractional-float",
    interactions: [on(200, "1.5")],
    run: "execute",
    expected: value("1.5"),
  },
  {
    name: "200-scalar-true",
    interactions: [on(200, "true")],
    run: "execute",
    expected: value("true"),
  },
  {
    name: "200-scalar-null",
    interactions: [on(200, "null")],
    run: "execute",
    expected: value("null"),
  },
  {
    name: "200-scalar-string",
    interactions: [on(200, '"ok"')],
    run: "execute",
    expected: value('"ok"'),
  },
  {
    name: "200-empty-list",
    interactions: [on(200, "[]")],
    run: "execute",
    expected: value("[]"),
  },
  {
    name: "200-empty-string-json",
    interactions: [on(200, '""')],
    run: "execute",
    expected: value('""'),
  },
  {
    name: "200-non-bmp-string",
    interactions: [on(200, '"\\ud835\\udcb3"')],
    run: "execute",
    expected: value('"\u{1d4b3}"'),
  },
  {
    name: "400",
    interactions: [on(400, '{"error": "Invalid query"}')],
    run: "execute",
    expected: error("QueryError", "QUERY_FAILED"),
  },
  {
    name: "401",
    interactions: [on(401, '{"error": "nope"}')],
    run: "execute",
    expected: error("AuthenticationError", "AUTH_FAILED"),
  },
  {
    name: "403-plain",
    interactions: [on(403, '{"error": "Permission denied"}')],
    run: "execute",
    expected: error("QueryError", "QUERY_FAILED"),
  },
  {
    name: "403-sensitive-data",
    interactions: [on(403, SENSITIVE)],
    run: "execute",
    expected: error("SessionReplayAccessError", "SESSION_REPLAY_ACCESS_ERROR"),
  },
  {
    name: "403-sensitive-string-body",
    interactions: [on(403, "SESSION_RECORDING_SENSITIVE_DATA set")],
    run: "execute",
    expected: error("SessionReplayAccessError", "SESSION_REPLAY_ACCESS_ERROR"),
  },
  {
    name: "403-list-exact-element",
    interactions: [on(403, '["SESSION_RECORDING_SENSITIVE_DATA"]')],
    run: "execute",
    expected: error("SessionReplayAccessError", "SESSION_REPLAY_ACCESS_ERROR"),
  },
  {
    name: "403-list-substring-only",
    interactions: [on(403, '["has SESSION_RECORDING_SENSITIVE_DATA set"]')],
    run: "execute",
    expected: error("QueryError", "QUERY_FAILED"),
  },
  {
    name: "403-truthy-scalar-bugcompat",
    interactions: [on(403, "42")],
    run: "execute",
    expected: { kind: "typeerror" },
  },
  {
    name: "403-falsy-scalar",
    interactions: [on(403, "0")],
    run: "execute",
    expected: error("QueryError", "QUERY_FAILED"),
  },
  {
    name: "404",
    interactions: [on(404, '{"error": "Not found"}')],
    run: "execute",
    expected: error("QueryError", "QUERY_FAILED"),
  },
  {
    name: "412",
    interactions: [on(412, '{"error": "Precondition failed"}')],
    run: "execute",
    expected: error("QueryError", "QUERY_FAILED"),
  },
  {
    name: "429-exhausted",
    interactions: [on(429, "", { "Retry-After": "7" })],
    maxRetries: 0,
    run: "execute",
    expected: error("RateLimitError", "RATE_LIMITED"),
  },
  {
    name: "429-then-200",
    interactions: [
      on(429, "", { "Retry-After": "0" }),
      on(200, '{"ok": true}'),
    ],
    run: "execute",
    expected: value('{"ok": true}'),
    expectedSleepsMs: [0],
  },
  {
    name: "429-backoff-no-header",
    interactions: [on(429, ""), on(200, "[]")],
    run: "execute",
    expected: value("[]"),
    expectedSleepsMs: [1000],
  },
  {
    name: "429-hostile-retry-after",
    interactions: [on(429, "", { "Retry-After": "-5" }), on(200, "[]")],
    run: "execute",
    expected: value("[]"),
    expectedSleepsMs: [1000],
  },
  {
    name: "429-huge-retry-after-capped",
    interactions: [on(429, "", { "Retry-After": "86400" }), on(200, "[]")],
    run: "execute",
    expected: value("[]"),
    expectedSleepsMs: [60000],
  },
  {
    name: "500",
    interactions: [on(500, '{"error": "boom"}')],
    run: "execute",
    expected: error("ServerError", "SERVER_ERROR"),
  },
  {
    name: "503-string-body",
    interactions: [on(503, "unavailable")],
    run: "execute",
    expected: error("ServerError", "SERVER_ERROR"),
  },
  {
    name: "302-redirect-manual",
    interactions: [
      on(302, '{"status": "ok"}', { Location: "https://elsewhere" }),
    ],
    run: "execute",
    expected: error("MixpanelHeadlessError", "HTTP_ERROR"),
  },
  {
    name: "network-error",
    interactions: [
      {
        request: { method: "GET", path: "/api/query/events/names" },
        response: { transport_error: "ConnectError" },
      },
    ],
    run: "execute",
    expected: error("MixpanelHeadlessError", "HTTP_ERROR"),
  },
];

/** appRequest-path edges (204, 422, unwrap, AC1, 429, transport). */
const APP_PATH = "/projects/12345/dashboards";
const appOn = (
  status: number,
  bodyText?: string,
  headers?: Record<string, string>,
): RawInteraction => ({
  request: { method: "GET", path: "/api/app" + APP_PATH },
  response: {
    status,
    ...(bodyText !== undefined ? { body_text: bodyText } : {}),
    ...(headers !== undefined ? { headers } : {}),
  },
});

const APP_CASES: EdgeCase[] = [
  {
    name: "204-app",
    interactions: [appOn(204)],
    run: "app",
    expected: value('{"status": "ok"}'),
  },
  {
    name: "422-via-app_request",
    interactions: [appOn(422, '{"error": "bad field"}')],
    run: "app",
    expected: error("QueryError", "QUERY_FAILED"),
  },
  {
    name: "app-unwrap-results",
    interactions: [appOn(200, '{"status": "ok", "results": [18.0, 1.5]}')],
    run: "app",
    expected: value("[18.0, 1.5]"),
  },
  {
    name: "app-raw-envelope",
    interactions: [appOn(200, '{"status": "ok", "results": []}')],
    run: "app",
    appOptions: { raw: true },
    expected: value('{"status": "ok", "results": []}'),
  },
  {
    name: "app-no-results-key",
    interactions: [appOn(200, '{"data": "x"}')],
    run: "app",
    expected: value('{"data": "x"}'),
  },
  {
    name: "app-429-exhausted",
    interactions: [appOn(429, "", { "Retry-After": "3" })],
    maxRetries: 0,
    run: "app",
    expected: error("RateLimitError", "RATE_LIMITED"),
  },
  {
    name: "app-network-error",
    interactions: [
      {
        request: { method: "GET", path: "/api/app" + APP_PATH },
        response: { transport_error: "ConnectError" },
      },
    ],
    run: "app",
    expected: error("MixpanelHeadlessError", "HTTP_ERROR"),
  },
  {
    name: "app-401",
    interactions: [appOn(401, '{"error": "no"}')],
    run: "app",
    expected: error("AuthenticationError", "AUTH_FAILED"),
  },
  {
    name: "app-ac1-guard",
    interactions: [],
    run: "app",
    appOptions: { jsonBody: {}, formBody: {} },
    expected: error("ParamValidationError", "AC1_BODY_MUTUALLY_EXCLUSIVE"),
  },
];

/**
 * Execute one case and report pass/fail.
 *
 * @param edge - The case.
 * @returns Failure description, or null on pass.
 */
async function runCase(edge: EdgeCase): Promise<string | null> {
  const harness = createVectorFetch(parse(edge.interactions));
  const sleepsMs: number[] = [];
  const shared = {
    request: fetchExecutor(harness.fetch),
    sleep: (ms: number) => {
      sleepsMs.push(ms);
      return Promise.resolve();
    },
    random: () => 0,
    maxRetries: edge.maxRetries ?? 3,
    timeoutSeconds: 120,
    requestHeaders: (extra: Record<string, string>) =>
      requestHeaders(
        { getUserAgent, getCustomHeaderEnv: () => ({}), sessionHeaders: {} },
        extra,
      ),
    projectId: "12345",
  };
  let outcome: { returned?: unknown; thrown?: unknown; didThrow: boolean };
  try {
    let returned: unknown;
    if (edge.run === "execute") {
      const deps: RetryExecutorDeps = shared;
      returned = await executeWithRetry(deps, {
        method: "GET",
        url: "https://mixpanel.com/api/query/events/names",
        headers: { Authorization: "Basic dGVzdA==" },
      });
    } else {
      const deps: AppRequestDeps = {
        ...shared,
        region: "us",
        getAuthHeader: () => "Bearer test-oauth-token",
      };
      returned = await appRequest(deps, "GET", APP_PATH, edge.appOptions ?? {});
    }
    outcome = { returned, didThrow: false };
  } catch (thrown) {
    outcome = { thrown, didThrow: true };
  }

  const expected = edge.expected;
  if (expected.kind === "value") {
    if (outcome.didThrow) {
      return `expected value, threw ${String(outcome.thrown)}`;
    }
    const got = canonicalize(outcome.returned as JsonValue);
    if (got !== expected.canonical) {
      return `value mismatch: got ${got}, want ${expected.canonical}`;
    }
  } else if (expected.kind === "typeerror") {
    if (!outcome.didThrow || !(outcome.thrown instanceof TypeError)) {
      return `expected TypeError (R10.7 bug-compat), got ${String(outcome.thrown ?? outcome.returned)}`;
    }
  } else {
    if (!outcome.didThrow) {
      return `expected ${expected.className}, returned ${String(outcome.returned)}`;
    }
    const thrown = outcome.thrown;
    if (!(thrown instanceof Error) || thrown.name !== expected.className) {
      return `expected class ${expected.className}, got ${String(thrown)}`;
    }
    if (
      expected.code !== undefined &&
      (thrown as MixpanelHeadlessError).code !== expected.code
    ) {
      return `expected code ${expected.code}, got ${String((thrown as MixpanelHeadlessError).code)}`;
    }
  }
  if (
    edge.expectedSleepsMs !== undefined &&
    JSON.stringify(sleepsMs) !== JSON.stringify(edge.expectedSleepsMs)
  ) {
    return `sleep mismatch: got ${JSON.stringify(sleepsMs)}, want ${JSON.stringify(edge.expectedSleepsMs)}`;
  }
  return null;
}

/** JSONL edge cases (authored-vector twins run in-process). */
async function runJsonlEdges(): Promise<string[]> {
  const encoder = new TextEncoder();
  const failures: string[] = [];
  const cases: ReadonlyArray<readonly [string, string[], string[]]> = [
    ["blank-lines", ['\n\n{"a": 1}\n \n{"b": 2}\n'], ['{"a": 1}', '{"b": 2}']],
    ["crlf", ['{"a": 1}\r\n{"b": 2}\r\n'], ['{"a": 1}', '{"b": 2}']],
    ["no-final-newline", ['{"a": 1}\n{"b', '": 2}'], ['{"a": 1}', '{"b": 2}']],
    [
      "python-strip-set",
      ["\x1c\n", "18.0\n1.5\nTrue\nNone\n\u{1d4b3}\n"],
      ["18.0", "1.5", "True", "None", "\u{1d4b3}"],
    ],
    ["empty", [], []],
  ];
  for (const [name, chunks, want] of cases) {
    const got: string[] = [];
    for await (const line of iterJsonlLines(
      (async function* () {
        for (const chunk of chunks) {
          yield encoder.encode(chunk);
        }
      })(),
    )) {
      got.push(line);
    }
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      failures.push(
        `jsonl-${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`,
      );
    }
  }
  return failures;
}

/** Entry point: run every case, print the table, exit nonzero on fail. */
export async function main(): Promise<number> {
  const failures: string[] = [];
  let passed = 0;
  for (const edge of [...CASES, ...APP_CASES]) {
    const failure = await runCase(edge);
    if (failure === null) {
      passed += 1;
      console.log(`PASS ${edge.name}`);
    } else {
      failures.push(`${edge.name}: ${failure}`);
      console.log(`FAIL ${edge.name}: ${failure}`);
    }
  }
  for (const failure of await runJsonlEdges()) {
    failures.push(failure);
    console.log(`FAIL ${failure}`);
  }
  passed += 5 - (await runJsonlEdges()).length;
  console.log(
    `\nb0-2 edge harness: ${String(passed)} passed, ${String(failures.length)} failed ` +
      `(${String(CASES.length + APP_CASES.length + 5)} cases)`,
  );
  return failures.length === 0 ? 0 : 1;
}
