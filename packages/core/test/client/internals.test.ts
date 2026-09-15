// Layer-3 translation — Phase-3 packet B0-2 `_handle_response` /
// `_execute_with_retry` / `_error_message` locks. Sources:
//
// - tests/unit/test_api_client.py::TestRateLimiting (:441-549)
// - tests/unit/test_api_client.py::TestErrorHandling (:1258-1311)
// - tests/unit/test_api_client.py::TestServerErrors (:1314-1362)
// - tests/unit/test_api_client.py::TestPublicRequest (:1575-1795, the
//   B0-observable subset: query_origin injection, 401/400 mapping, JSON
//   return, 429 retry/exhaustion — request() is a thin wrapper over
//   _execute_with_retry; URL/auth plumbing asserts are B4-C1)
// - tests/unit/test_api_client.py::TestRetryAfterHardening (:3595-3761,
//   minus the app_request cases → app-request.test.ts and the
//   export-stream case → B4-C2)
// - tests/unit/test_api_client.py::TestBlankErrorBodyFallbacks (:3859-3987)
// - tests/unit/test_api_client.py::TestErrorContextSymmetry::
//   test_401_carries_request_body (:3998-4025)
// - tests/unit/_internal/test_api_client_sign_replays.py::
//   TestSensitiveDataMapping (:150-198) + ::TestOtherHttpErrors
//   (:206-248) — the 403 SESSION_RECORDING_SENSITIVE_DATA branch is B0
//   code (R10.8's founding example); sign_replays itself is B4.
//
// Entry-point substitution (B0-notes decision 13): Python drives thin B4
// wrappers (`get_events`, `request()`, `sign_replays`) over the same
// internals; every assertion below is preserved against
// `executeWithRetry`/`handleResponse` directly, with httpx.MockTransport
// replaced by an injected request executor and `recorded_sleeps` by the
// injected sleep seam. Deferred-to-B4 tests are listed in
// docs/history/phase3/notes/B0-notes.md (deviation 3).
import { describe, expect, it } from "vitest";

import { QUERY_ORIGIN } from "../../src/client/headers.js";
import {
  errorMessage,
  executeWithRetry,
  handleResponse,
  MixpanelHttpError,
  type RetryExecutorDeps,
  type TransportRequestOptions,
  type WireResponse,
} from "../../src/client/internals.js";
import { JsonNumber } from "../../src/client/json-value.js";
import { codepoints } from "../../src/compat/codepoint.js";
import {
  APIError,
  AuthenticationError,
  MixpanelHeadlessError,
  QueryError,
  RateLimitError,
  ServerError,
  SessionReplayAccessError,
} from "../../src/errors.js";

/**
 * Build a canned WireResponse.
 *
 * @param status - HTTP status.
 * @param body - Body text, or an object to JSON-encode.
 * @param headers - Response headers.
 * @returns The response double.
 */
function res(
  status: number,
  body: string | object = "",
  headers: Readonly<Record<string, string>> = {},
): WireResponse {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const lower = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    status,
    text,
    header: (name) => lower.get(name.toLowerCase()) ?? null,
  };
}

/** A recorded harness around executeWithRetry. */
interface Harness {
  deps: RetryExecutorDeps;
  calls: TransportRequestOptions[];
  sleepsMs: number[];
}

/**
 * Build executor deps over a response script.
 *
 * @param script - Responses (or thrown errors) per attempt; the last
 *   entry repeats.
 * @param options - maxRetries / projectId overrides.
 * @returns The recorded harness.
 */
function harness(
  script: ReadonlyArray<WireResponse | Error>,
  options: { maxRetries?: number; projectId?: string } = {},
): Harness {
  const calls: TransportRequestOptions[] = [];
  const sleepsMs: number[] = [];
  const deps: RetryExecutorDeps = {
    request: (request) => {
      calls.push(request);
      const step = script[Math.min(calls.length - 1, script.length - 1)];
      if (step === undefined) {
        throw new Error("empty response script");
      }
      if (step instanceof Error) {
        return Promise.reject(step);
      }
      return Promise.resolve(step);
    },
    sleep: (ms) => {
      sleepsMs.push(ms);
      return Promise.resolve();
    },
    random: () => 0,
    maxRetries: options.maxRetries ?? 3,
    // The route-aware `_default_timeout` seam pinned flat — the harness
    // asserts request shape, not timeout routing (server-deadline.test.ts
    // owns that).
    defaultTimeoutSeconds: () => 120,
    requestHeaders: (extra) => ({ "User-Agent": "test", ...extra }),
    projectId: options.projectId ?? "12345",
  };
  return { deps, calls, sleepsMs };
}

/**
 * Run executeWithRetry with defaults mirroring `client.get_events()`'s
 * use of `_execute_with_retry` (GET + auth header).
 *
 * @param h - The harness.
 * @param args - Argument overrides.
 * @returns The parsed response.
 */
async function run(
  h: Harness,
  args: {
    method?: string;
    url?: string;
    params?: Record<string, unknown>;
    jsonData?: Record<string, unknown>;
    headers?: Record<string, string>;
    timeoutSeconds?: number;
  } = {},
): Promise<unknown> {
  return executeWithRetry(h.deps, {
    method: args.method ?? "GET",
    url: args.url ?? "https://mixpanel.com/api/query/events/names",
    ...(args.params === undefined ? {} : { params: args.params }),
    ...(args.jsonData === undefined ? {} : { jsonData: args.jsonData }),
    headers: args.headers ?? { Authorization: "Basic dGVzdA==" },
    ...(args.timeoutSeconds === undefined
      ? {}
      : { timeoutSeconds: args.timeoutSeconds }),
  });
}

describe("TestRateLimiting", () => {
  it("test_retry_on_429_with_retry_after", async () => {
    const h = harness([
      res(429, "", { "Retry-After": "0" }),
      res(200, ["event1"]),
    ]);
    const result = await run(h);
    expect(h.calls).toHaveLength(2);
    expect(result).toStrictEqual(["event1"]);
  });

  it("test_exponential_backoff_without_retry_after", async () => {
    const h = harness([res(429), res(200, ["event1"])], { maxRetries: 2 });
    const result = await run(h);
    expect(h.calls).toHaveLength(2);
    expect(result).toStrictEqual(["event1"]);
    // Fallback path: backoff for attempt 0 = 1s (zero-jitter RNG), in ms
    // at the sleep seam (R2.12).
    expect(h.sleepsMs).toStrictEqual([1000]);
  });

  it("test_rate_limit_error_after_max_retries", async () => {
    const h = harness([res(429, "", { "Retry-After": "0" })], {
      maxRetries: 1,
    });
    const error = await run(h).catch((error_: unknown) => error_);
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfter).toBe(0);
    // Carries the active project_id for the rate-limit lead-collection form.
    expect((error as RateLimitError).projectId).toBe("12345");
  });

  it("test_execute_with_retry_fallthrough_carries_project_id", async () => {
    // max_retries below zero: the loop body never runs and the
    // type-checker-satisfying fallthrough raise fires — locking its
    // project_id wiring (and its reduced constructor shape, FF4).
    const h = harness([res(200, {})], { maxRetries: -1 });
    const error = await run(h).catch((error_: unknown) => error_);
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).projectId).toBe("12345");
    // FF4: the fallthrough omits retry_after/status_code/response_body.
    expect((error as RateLimitError).retryAfter).toBeNull();
    expect((error as RateLimitError).responseBody).toBeNull();
    expect(h.calls).toHaveLength(0);
  });

  it("test_successful_response_after_retry", async () => {
    const h = harness(
      [
        res(429, "", { "Retry-After": "0" }),
        res(429, "", { "Retry-After": "0" }),
        res(200, { data: "success" }),
      ],
      { maxRetries: 3 },
    );
    const result = await run(h, { method: "POST" });
    expect(h.calls).toHaveLength(3);
    expect(result).toStrictEqual({ data: "success" });
  });
});

describe("TestPublicRequest (B0-observable subset)", () => {
  it("test_request_auto_injects_query_origin", async () => {
    const h = harness([res(200, {})]);
    await run(h);
    expect(h.calls[0]?.params["query_origin"]).toBe("mixpanel-headless");
    expect(QUERY_ORIGIN).toBe("mixpanel-headless");
  });

  it("test_canonical_query_origin_wins_over_caller", async () => {
    const h = harness([res(200, {})]);
    await run(h, { params: { query_origin: "spoofed-by-caller" } });
    expect(h.calls[0]?.params["query_origin"]).toBe("mixpanel-headless");
  });

  it("caller params dict is mutated in place (Python parity)", async () => {
    // api_client.py:744-746 writes query_origin into the CALLER's dict
    // (B0-notes decision 6 — observable Python behavior, reproduced).
    const params: Record<string, unknown> = { foo: "bar" };
    const h = harness([res(200, {})]);
    await run(h, { params });
    expect(params["query_origin"]).toBe("mixpanel-headless");
  });

  it("test_request_does_not_inject_project_id", async () => {
    const h = harness([res(200, {})]);
    await run(h);
    expect(h.calls[0]?.params["project_id"]).toBeUndefined();
  });

  it("test_request_returns_json_response", async () => {
    const h = harness([
      res(200, { data: { events: ["A", "B"] }, status: "ok" }),
    ]);
    await expect(run(h)).resolves.toStrictEqual({
      data: { events: ["A", "B"] },
      status: "ok",
    });
  });

  it("test_request_handles_401", async () => {
    const h = harness([res(401, { error: "Invalid token" })]);
    await expect(run(h)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("test_request_handles_400", async () => {
    const h = harness([res(400, { error: "Bad request" })]);
    const error = await run(h).catch((error_: unknown) => error_);
    expect(error).toBeInstanceOf(QueryError);
    expect(String(error)).toContain("Bad request");
  });

  it("test_request_handles_429_with_retry", async () => {
    const h = harness([
      res(429, "", { "Retry-After": "0" }),
      res(200, { success: true }),
    ]);
    const result = await run(h);
    expect(h.calls).toHaveLength(2);
    expect(result).toStrictEqual({ success: true });
  });

  it("test_request_raises_rate_limit_after_max_retries", async () => {
    const h = harness([res(429, "", { "Retry-After": "0" })], {
      maxRetries: 1,
    });
    const error = await run(h).catch((error_: unknown) => error_);
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfter).toBe(0);
  });
});

describe("TestErrorHandling", () => {
  it("test_query_error_on_400", async () => {
    const h = harness([res(400, { error: "Invalid query" })]);
    const error = await run(h).catch((error_: unknown) => error_);
    expect(error).toBeInstanceOf(QueryError);
    expect(String(error)).toContain("Invalid query");
  });

  it("test_query_error_on_400_with_plain_text", async () => {
    const h = harness([res(400, "Bad request: missing required field")]);
    const error = await run(h).catch((error_: unknown) => error_);
    expect(error).toBeInstanceOf(QueryError);
    expect(String(error)).toContain("Bad request: missing required field");
  });

  it("test_query_error_on_412_preserves_body", async () => {
    const h = harness([res(412, { error: "Precondition failed" })]);
    const error = await run(h).catch((error_: unknown) => error_);
    expect(error).toBeInstanceOf(QueryError);
    expect((error as QueryError).statusCode).toBe(412);
    expect(String(error)).toContain("Precondition failed");
    expect((error as QueryError).responseBody).toStrictEqual({
      error: "Precondition failed",
    });
  });
});

describe("TestServerErrors", () => {
  it("test_server_error_with_dict_body", async () => {
    const h = harness([res(500, { error: "Internal database error" })]);
    const error = await run(h).catch((error_: unknown) => error_);
    expect(error).toBeInstanceOf(ServerError);
    expect(String(error)).toContain("Internal database error");
    expect((error as ServerError).statusCode).toBe(500);
  });

  it("test_server_error_with_string_body", async () => {
    const h = harness([res(503, "Service temporarily unavailable")]);
    const error = await run(h).catch((error_: unknown) => error_);
    expect(error).toBeInstanceOf(ServerError);
    expect(String(error)).toContain("Service temporarily unavailable");
    expect((error as ServerError).statusCode).toBe(503);
  });

  it("test_server_error_with_empty_body", async () => {
    const h = harness([res(502, "")]);
    const error = await run(h).catch((error_: unknown) => error_);
    expect(error).toBeInstanceOf(ServerError);
    expect(String(error)).toContain("Server error: 502");
  });
});

describe("TestRetryAfterHardening (execute_with_retry half)", () => {
  it("test_negative_retry_after_uses_backoff", async () => {
    // Python pins _calculate_backoff to 0.125s via monkeypatch; here the
    // zero-jitter RNG makes attempt-0 backoff exactly 1s → 1000ms. The
    // assertion content: the NEGATIVE header is rejected and the backoff
    // fallback (not the header) reaches the sleep seam.
    const h = harness(
      [res(429, "", { "Retry-After": "-5" }), res(200, ["event1"])],
      { maxRetries: 2 },
    );
    await expect(run(h)).resolves.toStrictEqual(["event1"]);
    expect(h.sleepsMs).toStrictEqual([1000]);
  });

  it("test_huge_retry_after_is_capped", async () => {
    const h = harness(
      [res(429, "", { "Retry-After": "86400" }), res(200, ["event1"])],
      { maxRetries: 2 },
    );
    await expect(run(h)).resolves.toStrictEqual(["event1"]);
    expect(h.sleepsMs).toStrictEqual([60000]);
  });

  it("test_garbage_retry_after_uses_backoff", async () => {
    const h = harness(
      [res(429, "", { "Retry-After": "soon" }), res(200, ["event1"])],
      { maxRetries: 2 },
    );
    await expect(run(h)).resolves.toStrictEqual(["event1"]);
    expect(h.sleepsMs).toStrictEqual([1000]);
  });

  it("test_negative_retry_after_omitted_from_error", async () => {
    const h = harness([res(429, "", { "Retry-After": "-5" })], {
      maxRetries: 0,
    });
    const error = await run(h).catch((error_: unknown) => error_);
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfter).toBeNull();
    expect(String(error)).not.toContain("Retry after");
  });

  it("test_huge_retry_after_reported_verbatim_on_error", async () => {
    // The cap applies to sleeping, not to what the server said.
    const h = harness([res(429, "", { "Retry-After": "3600" })], {
      maxRetries: 0,
    });
    const error = await run(h).catch((error_: unknown) => error_);
    expect((error as RateLimitError).retryAfter).toBe(3600);
  });
});

describe("TestBlankErrorBodyFallbacks", () => {
  it("test_400_with_blank_text_body", async () => {
    const h = harness([res(400, " ".repeat(3))]);
    const error = (await run(h).catch(
      (error_: unknown) => error_,
    )) as QueryError;
    expect(error).toBeInstanceOf(QueryError);
    expect(error.message.trim()).toBe("Unknown error");
  });

  it("test_400_with_blank_error_field", async () => {
    const h = harness([res(400, { error: "" })]);
    const error = (await run(h).catch(
      (error_: unknown) => error_,
    )) as QueryError;
    expect(error.message).toBe("Unknown error");
  });

  it("test_403_with_blank_error_field", async () => {
    const h = harness([res(403, { error: "" })]);
    const error = (await run(h).catch(
      (error_: unknown) => error_,
    )) as QueryError;
    expect(error).toBeInstanceOf(QueryError);
    expect(error.message).toBe("Permission denied");
  });

  it("test_404_with_blank_error_field", async () => {
    const h = harness([res(404, { error: "" })]);
    const error = (await run(h).catch(
      (error_: unknown) => error_,
    )) as QueryError;
    expect(error.message).toBe("Resource not found");
  });

  it("test_generic_4xx_with_blank_error_field", async () => {
    const h = harness([res(412, { error: "" })]);
    const error = (await run(h).catch(
      (error_: unknown) => error_,
    )) as QueryError;
    expect(error.message).toBe("Request failed");
  });

  it("test_400_with_structured_error_value", async () => {
    // A non-string `error` value is stringified, never leaked as a dict.
    const h = harness([res(400, { error: { code: "BAD_SEGMENT" } })]);
    const error = (await run(h).catch(
      (error_: unknown) => error_,
    )) as QueryError;
    expect(typeof error.message).toBe("string");
    expect(error.message).toContain("BAD_SEGMENT");
  });

  it("test_500_with_blank_error_field", async () => {
    const h = harness([res(500, { error: "" })]);
    const error = (await run(h).catch(
      (error_: unknown) => error_,
    )) as ServerError;
    expect(error).toBeInstanceOf(ServerError);
    expect(error.message).toBe("Server error: 500");
  });

  it("test_400_message_preserved_when_present", async () => {
    // A usable message passes through untouched (no stripping).
    const h = harness([res(400, { error: " boom " })]);
    const error = (await run(h).catch(
      (error_: unknown) => error_,
    )) as QueryError;
    expect(error.message).toBe(" boom ");
  });
});

describe("TestErrorContextSymmetry (execute_with_retry half)", () => {
  it("test_401_carries_request_body", async () => {
    const h = harness([res(401, { error: "nope" })]);
    const error = (await run(h, {
      method: "POST",
      url: "https://mixpanel.com/api/app/test",
      jsonData: { name: "dash" },
    }).catch((error_: unknown) => error_)) as AuthenticationError;
    expect(error).toBeInstanceOf(AuthenticationError);
    expect(error.requestBody).toStrictEqual({ name: "dash" });
    expect(error.details["request_body"]).toStrictEqual({ name: "dash" });
    expect(error.requestParams).not.toBeNull();
  });
});

describe("TestSensitiveDataMapping (403 branch — R10.8 founding example)", () => {
  const flagBody = {
    error:
      "Your project has sensitive replay data. Set " +
      "SESSION_RECORDING_SENSITIVE_DATA to access.",
  };

  it("test_403_with_flag_raises_session_replay_access_error", async () => {
    const h = harness([res(403, flagBody)]);
    const error = (await run(h).catch(
      (error_: unknown) => error_,
    )) as SessionReplayAccessError;
    expect(error).toBeInstanceOf(SessionReplayAccessError);
    expect(error.statusCode).toBe(403);
    // Note the pythonInt coercion: project id "12345" → 12345 (FF3).
    expect(error.details["project_id"]).toBe(12345);
    expect(error.details["flag"]).toBe("SESSION_RECORDING_SENSITIVE_DATA");
    expect(error.details["permission_required"]).toBe("sensitive_data_replay");
  });

  it("test_403_without_flag_passes_through_to_query_error", async () => {
    const h = harness([res(403, { error: "Permission denied" })]);
    const error = await run(h).catch((error_: unknown) => error_);
    expect(error).toBeInstanceOf(QueryError);
    expect(error).not.toBeInstanceOf(SessionReplayAccessError);
    expect((error as QueryError).statusCode).toBe(403);
  });

  it("flag inside a STRING body (non-JSON) also triggers the branch", async () => {
    const h = harness([
      res(403, "SESSION_RECORDING_SENSITIVE_DATA is enabled"),
    ]);
    const error = await run(h).catch((error_: unknown) => error_);
    expect(error).toBeInstanceOf(SessionReplayAccessError);
  });
});

// Twin of tests/unit/_internal/test_api_client_sign_replays.py::
// TestSensitiveData403BodyShapes (Python FIX-2, bug (c)): the 403 sniff
// applies uniform substring semantics across dict/list/scalar bodies —
// the old R10.7 element-membership / TypeError twins retired with the
// Python-first fix (fix-of-record:
// docs/history/phase3/bug-reports/python-handle-response-403-typeerror.md).
describe("TestSensitiveData403BodyShapes (bug (c) fix)", () => {
  it("403 LIST body: uniform SUBSTRING semantics (exact element AND substring match)", async () => {
    // Python post-FIX-2 serializes every non-str body for the sniff —
    // element-membership retired (test_api_client_sign_replays.py::
    // TestSensitiveData403BodyShapes list-exact + list-substring twins).
    const h1 = harness([res(403, ["SESSION_RECORDING_SENSITIVE_DATA"])]);
    await expect(
      run(h1).catch((error_: unknown) => error_),
    ).resolves.toBeInstanceOf(SessionReplayAccessError);
    const h2 = harness([
      res(403, ["error: SESSION_RECORDING_SENSITIVE_DATA is set"]),
    ]);
    const error = await run(h2).catch((error_: unknown) => error_);
    expect(error).toBeInstanceOf(SessionReplayAccessError);
  });

  it("403 truthy scalar body raises QueryError, never TypeError (bug (c) fix)", async () => {
    // Python post-FIX-2: `json.dumps(42)` → "42" → no flag → QueryError
    // (TestSensitiveData403BodyShapes truthy-scalar twins; fix-of-record
    // docs/history/phase3/bug-reports/python-handle-response-403-typeerror.md).
    for (const raw of ["42", "1.5", "true"]) {
      const h = harness([res(403, raw)]);
      const error = (await run(h).catch(
        (error_: unknown) => error_,
      )) as QueryError;
      expect(error).toBeInstanceOf(QueryError);
      expect(error).not.toBeInstanceOf(SessionReplayAccessError);
      expect(error.statusCode).toBe(403);
    }
  });

  it("403 falsy scalar body falls through to QueryError", async () => {
    // Python post-FIX-2: json.dumps(0) → "0" → no flag → QueryError
    // (TestSensitiveData403BodyShapes falsy-scalar twins: 0/false/null).
    for (const raw of ["0", "false", "null"]) {
      const h = harness([res(403, raw)]);
      const error = (await run(h).catch(
        (error_: unknown) => error_,
      )) as QueryError;
      expect(error).toBeInstanceOf(QueryError);
      expect(error.message).toBe("Permission denied");
    }
  });

  it("403 JSON string body containing the flag raises SessionReplayAccessError", async () => {
    // TestSensitiveData403BodyShapes string-body twin: the parsed str
    // branch passes through UNSERIALIZED (no json.dumps quoting).
    const h = harness([
      res(403, JSON.stringify("SESSION_RECORDING_SENSITIVE_DATA denied")),
    ]);
    const error = (await run(h).catch(
      (error_: unknown) => error_,
    )) as SessionReplayAccessError;
    expect(error).toBeInstanceOf(SessionReplayAccessError);
    expect(error.statusCode).toBe(403);
  });
});

describe("TestOtherHttpErrors", () => {
  it("test_400_raises_query_error", async () => {
    const h = harness([res(400, { error: "Bad request" })]);
    await expect(run(h)).rejects.toBeInstanceOf(QueryError);
  });

  it("test_500_raises_server_error", async () => {
    const h = harness([res(500, { error: "Internal server error" })]);
    await expect(run(h)).rejects.toBeInstanceOf(ServerError);
  });

  it("test_non_replay_403_is_not_session_replay_access_error", async () => {
    const h = harness([res(403, { error: "Generic permission denied" })]);
    const error = await run(h).catch((error_: unknown) => error_);
    expect(error).toBeInstanceOf(APIError);
    expect(error).not.toBeInstanceOf(SessionReplayAccessError);
  });
});

// FF3 fallthrough-tail restatement locks (playbook B0-2 checklist +
// review-resolution R6): exact source order at api_client.py:652-662.
describe("_handle_response fallthrough tail (FF3)", () => {
  it("(i) 3xx with a JSON object body is an ERROR, never a success return", async () => {
    // R2.11: redirect:'manual' makes 3xx reachable; raise_for_status runs
    // FIRST, the MixpanelHttpError normalizes, and _execute_with_retry
    // wraps it as HTTP_ERROR.
    const h = harness([res(302, { status: "ok" }, { Location: "https://x" })]);
    const error = (await run(h).catch(
      (error_: unknown) => error_,
    )) as MixpanelHeadlessError;
    expect(error).toBeInstanceOf(MixpanelHeadlessError);
    expect(error.code).toBe("HTTP_ERROR");
  });

  it("(ii) 2xx object/array bodies return as-is", async () => {
    // Numbers surface as lossless JsonNumber tokens (GATE-R5).
    await expect(run(harness([res(200, { a: 1 })]))).resolves.toStrictEqual({
      a: new JsonNumber("1"),
    });
    await expect(run(harness([res(200, [1, 2])]))).resolves.toStrictEqual([
      new JsonNumber("1"),
      new JsonNumber("2"),
    ]);
  });

  it("(iii) 2xx JSON scalars are RETURNED as the result", async () => {
    // Verified against httpx: Response(200, b"42").json() → 42.
    await expect(run(harness([res(200, "42")]))).resolves.toStrictEqual(
      new JsonNumber("42"),
    );
    await expect(run(harness([res(200, '"ok"')]))).resolves.toBe("ok");
    await expect(run(harness([res(200, "true")]))).resolves.toBe(true);
    await expect(run(harness([res(200, "null")]))).resolves.toBeNull();
    // R10.9 edge floats survive losslessly (GATE-R5 parseLossless).
    await expect(run(harness([res(200, "18.0")]))).resolves.toStrictEqual(
      new JsonNumber("18.0"),
    );
    await expect(run(harness([res(200, "1.5")]))).resolves.toStrictEqual(
      new JsonNumber("1.5"),
    );
  });

  it("(iii) 2xx non-JSON raises INVALID_RESPONSE", async () => {
    const h = harness([res(200, "<html>not json</html>")]);
    const error = (await run(h).catch(
      (error_: unknown) => error_,
    )) as MixpanelHeadlessError;
    expect(error).toBeInstanceOf(MixpanelHeadlessError);
    expect(error.code).toBe("INVALID_RESPONSE");
  });

  it("(iii) 2xx EMPTY body raises INVALID_RESPONSE", async () => {
    const h = harness([res(200, "")]);
    const error = (await run(h).catch(
      (error_: unknown) => error_,
    )) as MixpanelHeadlessError;
    expect(error.code).toBe("INVALID_RESPONSE");
  });
});

describe("_execute_with_retry transport-error wrapping (R2.10)", () => {
  it("MixpanelHttpError wraps as HTTP_ERROR with request context details", async () => {
    const h = harness([new MixpanelHttpError("connection refused")]);
    const error = (await run(h).catch(
      (error_: unknown) => error_,
    )) as MixpanelHeadlessError;
    expect(error).toBeInstanceOf(MixpanelHeadlessError);
    expect(error).not.toBeInstanceOf(APIError);
    expect(error.code).toBe("HTTP_ERROR");
    expect(error.details["error"]).toBe("connection refused");
    expect(error.details["request_method"]).toBe("GET");
    expect(error.details["request_url"]).toBe(
      "https://mixpanel.com/api/query/events/names",
    );
    expect(error.details["request_params"]).toStrictEqual({
      query_origin: "mixpanel-headless",
    });
  });

  it("non-transport errors pass through unwrapped (R2.10 idiom)", async () => {
    const boom = new RangeError("not a transport failure");
    const h = harness([boom]);
    const error = await run(h).catch((error_: unknown) => error_);
    expect(error).toBe(boom);
  });

  it("library errors thrown by _handle_response are NOT re-wrapped", async () => {
    const h = harness([res(400, { error: "bad" })]);
    const error = (await run(h).catch(
      (error_: unknown) => error_,
    )) as QueryError;
    expect(error).toBeInstanceOf(QueryError);
    expect(error.code).not.toBe("HTTP_ERROR");
  });
});

// _error_message unit lock (api_client.py:81-106 + review-resolution R11:
// `{"error": null}` and an ABSENT error key are indistinguishable to
// Python's `.get(...) is None` — both yield the default, never "None").
describe("errorMessage (FF6)", () => {
  it("absent error key → default", () => {
    expect(errorMessage({ other: "x" }, "Default")).toBe("Default");
  });

  it('{"error": null} → default (NEVER the string "None")', () => {
    expect(errorMessage({ error: null }, "Default")).toBe("Default");
  });

  it("string error → as-is", () => {
    expect(errorMessage({ error: "boom" }, "Default")).toBe("boom");
  });

  it("non-null non-string error → pythonStr rendering", () => {
    expect(errorMessage({ error: true }, "Default")).toBe("True");
    expect(errorMessage({ error: ["a", true] }, "Default")).toBe("['a', True]");
  });

  it("string body truncates at 200 CODEPOINTS (R11.6, never splits pairs)", () => {
    const body = "𝒳".repeat(300); // non-BMP: 2 UTF-16 units each
    const message = errorMessage(body, "Default");
    expect(codepoints(message)).toHaveLength(200);
    expect(message).toBe("𝒳".repeat(200));
  });

  it("blank-after-PYTHON-strip falls back to default (U+001C is stripped)", () => {
    expect(errorMessage("\x1C \x1F", "Default")).toBe("Default");
    expect(errorMessage({ error: "  " }, "Default")).toBe("Default");
  });

  it("null / non-dict-non-str bodies → default", () => {
    expect(errorMessage(null, "Default")).toBe("Default");
  });
});

// Arbiter fixes F1 + F3/A2 (b0-review-resolution): body parsing must
// accept the json.loads non-finite constants exactly as every Python
// `response.json()` site does (probed live: `json.loads('{"a": NaN}')`
// parses; a bare `Infinity` 403 body serializes to "Infinity" for the
// post-FIX-2 sniff), and the parse catch must mirror Python's
// `except json.JSONDecodeError` scope — a parser stack overflow
// (RangeError, the RecursionError analog) PROPAGATES, never degrades to
// the body-as-text / INVALID_RESPONSE path.
describe("json.loads non-finite body tokens (arbiter fix F1)", () => {
  it("200 object body containing NaN/Infinity parses like json.loads", async () => {
    const h = harness([res(200, '{"a": NaN, "b": Infinity, "c": -Infinity}')]);
    const value = (await run(h)) as { a: number; b: number; c: number };
    expect(value.a).toBeNaN();
    expect(value.b).toBe(Infinity);
    expect(value.c).toBe(-Infinity);
  });

  it("200 bare NaN scalar body is RETURNED (httpx .json() parity)", async () => {
    await expect(run(harness([res(200, "NaN")]))).resolves.toBeNaN();
  });

  it("400 body with a non-finite member keeps DICT shape and error message", async () => {
    // Python: response_body is the dict and _error_message reads `error`;
    // pre-fix TS degraded to the truncated-string body + [:200] message.
    const h = harness([res(400, '{"error": "boom", "extra": NaN}')]);
    const error = (await run(h).catch(
      (error_: unknown) => error_,
    )) as QueryError;
    expect(error).toBeInstanceOf(QueryError);
    expect(error.message).toBe("boom");
    const body = error.responseBody as { error: string; extra: number };
    expect(body.error).toBe("boom");
    expect(body.extra).toBeNaN();
  });

  it("403 bare Infinity body serializes for the sniff → QueryError (bug (c) fix)", async () => {
    // Python post-FIX-2: json.loads("Infinity") → inf, json.dumps(inf)
    // → "Infinity" (allow_nan default) → no flag → QueryError. The
    // jsonDumpsLike twin renders the JsonNumber token verbatim.
    const h = harness([res(403, "Infinity")]);
    const error = (await run(h).catch(
      (error_: unknown) => error_,
    )) as QueryError;
    expect(error).toBeInstanceOf(QueryError);
    expect(error.message).toBe("Permission denied");
  });
});

describe("JSONDecodeError-analog catch scope (arbiter fix F3/A2)", () => {
  // ~1e6 unclosed brackets overflow the recursive-descent parser's stack
  // (the CPython twin: json.loads raises RecursionError past `except
  // json.JSONDecodeError`, so _handle_response propagates it).
  const deep = "[".repeat(1_000_000);

  it("parser stack overflow on a 2xx body PROPAGATES (never INVALID_RESPONSE)", async () => {
    const error = await run(harness([res(200, deep)])).catch(
      (error_: unknown) => error_,
    );
    expect(error).toBeInstanceOf(RangeError);
  });

  it("parser stack overflow on an error-status body PROPAGATES (never body-as-text)", async () => {
    const error = await run(harness([res(400, deep)])).catch(
      (error_: unknown) => error_,
    );
    expect(error).toBeInstanceOf(RangeError);
  });
});

// handleResponse-level checks that need direct access (no retry loop).
describe("handleResponse direct", () => {
  it("401 → AuthenticationError with full request context", () => {
    expect(() =>
      handleResponse(res(401, { error: "Unauthorized" }), {
        requestMethod: "GET",
        requestUrl: "https://u",
        requestParams: { a: "1" },
        requestBody: null,
        projectId: "12345",
      }),
    ).toThrow(AuthenticationError);
  });

  it("404 → QueryError 'Resource not found' default", () => {
    const thrown = (() => {
      try {
        handleResponse(res(404, { error: "Not found" }), {
          projectId: "12345",
        });
      } catch (error) {
        return error as QueryError;
      }
      return null;
    })();
    expect(thrown).toBeInstanceOf(QueryError);
    expect(thrown?.statusCode).toBe(404);
    expect(thrown?.message).toBe("Not found");
  });
});
