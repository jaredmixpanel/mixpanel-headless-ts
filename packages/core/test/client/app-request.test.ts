// Layer-3 translation of tests/unit/test_app_api_client.py::TestAppRequest
// (:78-303), ::TestAppRequestFormBody (:306-403), ::TestCodedAppRequestCodes
// (:873-929), plus the app_request halves of
// tests/unit/test_api_client.py::TestRetryAfterHardening (:3763-3808) and
// ::TestErrorContextSymmetry (:4027-4116), and the appRequest-level
// re-check of tests/unit/test_settings_headers.py::
// TestSessionHeadersOnOutboundRequests — Phase-3 packet B0-2.
//
// Entry-point substitution (B0-notes decision 13): httpx.MockTransport
// becomes the injected request executor; auth resolution becomes the
// injected per-call `getAuthHeader` seam (R2.9 — the REAL
// accountAuthHeader wiring is B4's clientFromSession); `recorded_sleeps`
// becomes the sleep seam. Deferred to B4 (B0-notes deviation 3): the
// x-www-form-urlencoded content-type assertion (adapter-owned encoding)
// and Python's `except ValueError` catchability assert (dual inheritance
// is Python-only; errors.ts docstring covers it — the class+code
// assertions are preserved).
import { describe, expect, it } from "vitest";

import {
  appRequest,
  type AppRequestDeps,
} from "../../src/client/app-request.js";
import { getUserAgent, requestHeaders } from "../../src/client/headers.js";
import {
  MixpanelHttpError,
  type TransportRequestOptions,
  type WireResponse,
} from "../../src/client/internals.js";
import { JsonNumber } from "../../src/client/json-value.js";
import { ENDPOINTS, type Region } from "../../src/client/url.js";
import {
  AuthenticationError,
  MixpanelHeadlessError,
  ParamValidationError,
  QueryError,
  RateLimitError,
  ServerError,
} from "../../src/errors.js";

/**
 * Build a canned WireResponse.
 *
 * @param status - HTTP status.
 * @param body - Body text or an object to JSON-encode.
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

/** Recorded appRequest harness. */
interface Harness {
  deps: AppRequestDeps;
  calls: TransportRequestOptions[];
  sleepsMs: number[];
}

/**
 * Build appRequest deps over a response script.
 *
 * @param script - Responses (or thrown errors) per attempt; last repeats.
 * @param options - Overrides (auth header, region, retries, session
 *   headers, env pair).
 * @returns The recorded harness.
 */
function harness(
  script: ReadonlyArray<WireResponse | Error>,
  options: {
    maxRetries?: number;
    authHeader?: string;
    region?: Region;
    sessionHeaders?: Readonly<Record<string, string>>;
    env?: { name?: string; value?: string };
  } = {},
): Harness {
  const calls: TransportRequestOptions[] = [];
  const sleepsMs: number[] = [];
  const deps: AppRequestDeps = {
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
    // The REAL B0-owned 4-layer merge, pre-bound like B4-C1 will bind it.
    requestHeaders: (extra) =>
      requestHeaders(
        {
          getUserAgent,
          getCustomHeaderEnv: () => options.env ?? {},
          sessionHeaders: options.sessionHeaders ?? {},
        },
        extra,
      ),
    projectId: "12345",
    region: options.region ?? "us",
    getAuthHeader: () => options.authHeader ?? "Bearer test-oauth-token",
  };
  return { deps, calls, sleepsMs };
}

describe("TestAppRequest", () => {
  it("test_uses_bearer_auth_header", async () => {
    const h = harness([res(200, { status: "ok", results: [] })]);
    await appRequest(h.deps, "GET", "/dashboards");
    expect(h.calls[0]?.headers["Authorization"]).toBe(
      "Bearer test-oauth-token",
    );
  });

  it("test_uses_basic_auth_when_configured", async () => {
    const h = harness([res(200, { status: "ok", results: [] })], {
      authHeader: "Basic dGVzdF91c2VyOnRlc3Rfc2VjcmV0",
    });
    await appRequest(h.deps, "GET", "/dashboards");
    expect(h.calls[0]?.headers["Authorization"]?.startsWith("Basic ")).toBe(
      true,
    );
  });

  it("test_builds_correct_url", async () => {
    const h = harness([res(200, { status: "ok", results: [] })]);
    await appRequest(h.deps, "GET", "/projects/12345/dashboards");
    const expectedBase = ENDPOINTS.get("us")!.get("app")!;
    expect(
      h.calls[0]?.url.startsWith(`${expectedBase}/projects/12345/dashboards`),
    ).toBe(true);
  });

  it("test_rate_limit_error_carries_project_id", async () => {
    const h = harness([res(429, "", { "Retry-After": "0" })], {
      maxRetries: 1,
    });
    const error = await appRequest(h.deps, "GET", "/dashboards").catch(
      (error_: unknown) => error_,
    );
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).projectId).toBe("12345");
  });

  it("test_rate_limit_fallthrough_carries_project_id", async () => {
    // max_retries below zero: the loop never runs — the reduced-shape
    // fallthrough raise (api_client.py:1381-1387, FF4) fires.
    const h = harness([res(200, { status: "ok", results: [] })], {
      maxRetries: -1,
    });
    const error = await appRequest(h.deps, "GET", "/dashboards").catch(
      (error_: unknown) => error_,
    );
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).projectId).toBe("12345");
    expect((error as RateLimitError).retryAfter).toBeNull();
    expect((error as RateLimitError).responseBody).toBeNull();
    expect(h.calls).toHaveLength(0);
  });

  it("test_unwraps_results_field", async () => {
    const h = harness([
      res(200, { status: "ok", results: [{ id: 1, name: "Dashboard 1" }] }),
    ]);
    const result = await appRequest(
      h.deps,
      "GET",
      "/projects/12345/dashboards",
    );
    expect(result).toEqual([{ id: new JsonNumber("1"), name: "Dashboard 1" }]);
  });

  it("test_returns_full_response_when_no_results_key", async () => {
    const h = harness([res(200, { status: "ok", data: "something" })]);
    const result = await appRequest(
      h.deps,
      "GET",
      "/projects/12345/some-endpoint",
    );
    expect(result).toEqual({ status: "ok", data: "something" });
  });

  it("test_handles_204_no_content", async () => {
    const h = harness([res(204)]);
    const result = await appRequest(
      h.deps,
      "DELETE",
      "/projects/12345/dashboards/1",
    );
    expect(result).toEqual({ status: "ok" });
  });

  it("test_maps_404_to_query_error", async () => {
    const h = harness([res(404, { error: "Not found" })]);
    const error = await appRequest(
      h.deps,
      "GET",
      "/projects/12345/dashboards/999",
    ).catch((error_: unknown) => error_);
    expect(error).toBeInstanceOf(QueryError);
    expect((error as QueryError).statusCode).toBe(404);
  });

  it("test_maps_422_to_query_error", async () => {
    const h = harness([
      res(422, { error: "Unprocessable entity", details: "bad field" }),
    ]);
    const error = await appRequest(
      h.deps,
      "GET",
      "/projects/12345/dashboards",
    ).catch((error_: unknown) => error_);
    expect(error).toBeInstanceOf(QueryError);
    expect((error as QueryError).statusCode).toBe(422);
  });

  it("test_maps_401_to_authentication_error", async () => {
    const h = harness([res(401, { error: "Unauthorized" })]);
    await expect(
      appRequest(h.deps, "GET", "/projects/12345/dashboards"),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("test_maps_5xx_to_server_error", async () => {
    const h = harness([res(500, { error: "Internal server error" })]);
    await expect(
      appRequest(h.deps, "GET", "/projects/12345/dashboards"),
    ).rejects.toBeInstanceOf(ServerError);
  });

  it("test_passes_query_params", async () => {
    const h = harness([res(200, { status: "ok", results: [] })]);
    await appRequest(h.deps, "GET", "/projects/12345/dashboards", {
      params: { page_size: "50" },
    });
    expect(h.calls[0]?.params["page_size"]).toBe("50");
  });

  it("NO query_origin on App-API params (packet bullet)", async () => {
    // api_client.py:1268-1272: caller-supplied params only — some App
    // API endpoints reject unknown query parameters.
    const h = harness([res(200, { status: "ok", results: [] })]);
    await appRequest(h.deps, "GET", "/dashboards");
    expect(h.calls[0]?.params).toEqual({});
  });

  it("test_passes_json_body", async () => {
    const h = harness([
      res(200, { status: "ok", results: { id: 1, name: "New" } }),
    ]);
    await appRequest(h.deps, "POST", "/projects/12345/dashboards", {
      jsonBody: { name: "New Dashboard" },
    });
    expect(h.calls[0]?.jsonBody).toEqual({ name: "New Dashboard" });
    expect(h.calls[0]?.formBody).toBeNull();
  });

  it("test_eu_region_uses_eu_endpoint", async () => {
    const h = harness([res(200, { status: "ok", results: [] })], {
      region: "eu",
      authHeader: "Bearer eu-token",
    });
    await appRequest(h.deps, "GET", "/projects/12345/dashboards");
    expect(
      h.calls[0]?.url.startsWith(ENDPOINTS.get("eu")?.get("app") ?? ""),
    ).toBe(true);
  });

  it("raw: true returns the full envelope without unwrapping", async () => {
    // Python `_raw=True` (api_client.py:1364-1366).
    const h = harness([res(200, { status: "ok", results: [1] })]);
    const result = await appRequest(h.deps, "GET", "/dashboards", {
      raw: true,
    });
    expect(result).toEqual({ status: "ok", results: [new JsonNumber("1")] });
  });
});

describe("TestAppRequestFormBody", () => {
  it("test_form_body_sent_as_form_encoded (B0 half: formBody threading)", async () => {
    // The wire content-type assertion is the fetch adapter's (B4); the
    // B0 lock: formBody reaches the transport verbatim, jsonBody stays
    // null, and the method is preserved.
    const h = harness([res(200, { status: "ok", results: { id: 1 } })]);
    await appRequest(h.deps, "POST", "/projects/12345/custom_events/", {
      formBody: { name: "X", alternatives: '[{"event": "Y"}]' },
    });
    expect(h.calls[0]?.method).toBe("POST");
    expect(h.calls[0]?.formBody).toEqual({
      name: "X",
      alternatives: '[{"event": "Y"}]',
    });
    expect(h.calls[0]?.jsonBody).toBeNull();
  });

  it("test_form_body_retries_on_429", async () => {
    const h = harness([
      res(429, { error: "rate limited" }, { "Retry-After": "0" }),
      res(200, { status: "ok", results: { id: 1 } }),
    ]);
    const result = await appRequest(
      h.deps,
      "POST",
      "/projects/12345/custom_events/",
      { formBody: { name: "X", alternatives: "[]" } },
    );
    expect(h.calls).toHaveLength(2); // one retry then success
    expect(result).toEqual({ id: new JsonNumber("1") });
  });

  it("test_form_body_wraps_httpx_transport_error", async () => {
    const h = harness([new MixpanelHttpError("connection refused")]);
    const error = await appRequest(
      h.deps,
      "POST",
      "/projects/12345/custom_events/",
      { formBody: { name: "X", alternatives: "[]" } },
    ).catch((error_: unknown) => error_);
    expect(error).toBeInstanceOf(MixpanelHeadlessError);
    expect((error as MixpanelHeadlessError).code).toBe("HTTP_ERROR");
  });

  it("test_form_body_and_json_body_mutually_exclusive", async () => {
    const h = harness([res(200, { status: "ok" })]);
    const error = await appRequest(
      h.deps,
      "POST",
      "/projects/12345/custom_events/",
      { jsonBody: { a: 1 }, formBody: { b: "2" } },
    ).catch((error_: unknown) => error_);
    expect(error).toBeInstanceOf(ParamValidationError);
    expect(h.calls).toHaveLength(0); // guard fires pre-transport
  });
});

describe("TestCodedAppRequestCodes", () => {
  it("test_ac1_post_both_bodies_raises_coded_error", async () => {
    const h = harness([res(200, { status: "ok", results: [] })]);
    const error = await appRequest(h.deps, "POST", "/projects/12345/x", {
      jsonBody: {},
      formBody: {},
    }).catch((error_: unknown) => error_);
    expect(error).toBeInstanceOf(ParamValidationError);
    expect((error as ParamValidationError).code).toBe(
      "AC1_BODY_MUTUALLY_EXCLUSIVE",
    );
  });

  it("test_ac1_put_both_bodies_raises_coded_error", async () => {
    const h = harness([res(200, { status: "ok", results: [] })]);
    const error = await appRequest(h.deps, "PUT", "/projects/12345/x", {
      jsonBody: { a: 1 },
      formBody: { b: "2" },
    }).catch((error_: unknown) => error_);
    expect((error as ParamValidationError).code).toBe(
      "AC1_BODY_MUTUALLY_EXCLUSIVE",
    );
  });
});

describe("TestRetryAfterHardening (app_request half)", () => {
  it("test_app_request_negative_retry_after_uses_backoff", async () => {
    // Python pins the backoff to 0.5s via monkeypatch; the zero-jitter
    // RNG makes attempt-0 backoff exactly 1s → 1000ms. Assertion content:
    // the negative header never reaches the sleep seam.
    const h = harness(
      [res(429, "", { "Retry-After": "-1" }), res(200, { results: [1] })],
      { maxRetries: 2 },
    );
    const result = await appRequest(
      h.deps,
      "GET",
      "/projects/12345/dashboards",
    );
    expect(result).toEqual([new JsonNumber("1")]);
    expect(h.sleepsMs).toEqual([1000]);
  });

  it("test_app_request_huge_retry_after_is_capped", async () => {
    const h = harness(
      [res(429, "", { "Retry-After": "99999" }), res(200, { results: [1] })],
      { maxRetries: 2 },
    );
    const result = await appRequest(
      h.deps,
      "GET",
      "/projects/12345/dashboards",
    );
    expect(result).toEqual([new JsonNumber("1")]);
    expect(h.sleepsMs).toEqual([60000]);
  });
});

describe("TestErrorContextSymmetry (app_request half)", () => {
  it("test_app_request_422_carries_request_params", async () => {
    const h = harness([res(422, { error: "bad field" })]);
    const error = (await appRequest(
      h.deps,
      "POST",
      "/projects/12345/dashboards",
      {
        params: { workspace_id: "77" },
        jsonBody: { title: "x" },
      },
    ).catch((error_: unknown) => error_)) as QueryError;
    expect(error).toBeInstanceOf(QueryError);
    expect(error.requestParams).toEqual({ workspace_id: "77" });
    expect(error.requestBody).toEqual({ title: "x" });
  });

  it("test_app_request_rate_limit_carries_request_params", async () => {
    const h = harness([res(429)], { maxRetries: 0 });
    const error = (await appRequest(
      h.deps,
      "GET",
      "/projects/12345/dashboards",
      {
        params: { workspace_id: "77" },
      },
    ).catch((error_: unknown) => error_)) as RateLimitError;
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error.requestParams).toEqual({ workspace_id: "77" });
    expect(error.projectId).toBe("12345");
  });

  it("test_app_request_http_error_details_carry_request_params", async () => {
    const h = harness([new MixpanelHttpError("connection refused")]);
    const error = (await appRequest(
      h.deps,
      "GET",
      "/projects/12345/dashboards",
      {
        params: { workspace_id: "77" },
      },
    ).catch((error_: unknown) => error_)) as MixpanelHeadlessError;
    expect(error.details["request_params"]).toEqual({ workspace_id: "77" });
  });
});

describe("TestSessionHeadersOnOutboundRequests (appRequest level)", () => {
  it("test_session_headers_included_in_outbound_request", async () => {
    const h = harness([res(200, { status: "ok", results: [] })], {
      sessionHeaders: {
        "X-Mixpanel-Cluster": "internal-1",
        "X-Tenant": "acme",
      },
    });
    await appRequest(h.deps, "GET", "/dashboards");
    expect(h.calls[0]?.headers["X-Mixpanel-Cluster"]).toBe("internal-1");
    expect(h.calls[0]?.headers["X-Tenant"]).toBe("acme");
  });

  it("test_session_headers_take_precedence_over_env_on_collision", async () => {
    const h = harness([res(200, { status: "ok", results: [] })], {
      sessionHeaders: { "X-Cluster": "from-session" },
      env: { name: "X-Cluster", value: "from-env" },
    });
    await appRequest(h.deps, "GET", "/dashboards");
    expect(h.calls[0]?.headers["X-Cluster"]).toBe("from-session");
  });
});

describe("app_request 422 with non-JSON body", () => {
  it("truncates the text body at 500 codepoints into response_body", async () => {
    const h = harness([res(422, "x".repeat(600))]);
    const error = (await appRequest(h.deps, "GET", "/d").catch(
      (error_: unknown) => error_,
    )) as QueryError;
    expect(error).toBeInstanceOf(QueryError);
    expect(error.responseBody).toBe("x".repeat(500));
    // Default message for a blank-after-strip? No — body text is usable:
    // errorMessage(string) truncates at 200 codepoints.
    expect(error.message).toBe("x".repeat(200));
  });
});

// Arbiter fixes F1 + F3/A2 (b0-review-resolution): the 422 body parse is
// a `response.json()` site in Python (`api_client.py:1339-1342`) — it
// accepts json.loads' non-finite constants, and its catch scope is
// `except json.JSONDecodeError` only (a RecursionError propagates).
describe("app_request 422 body-parse fidelity (arbiter fixes F1/F3)", () => {
  it("422 body with a non-finite member keeps DICT shape and error message", async () => {
    const h = harness([res(422, '{"error": "bad field", "v": Infinity}')]);
    const error = (await appRequest(h.deps, "GET", "/d").catch(
      (error_: unknown) => error_,
    )) as QueryError;
    expect(error).toBeInstanceOf(QueryError);
    expect(error.statusCode).toBe(422);
    expect(error.message).toBe("bad field");
    const body = error.responseBody as { error: string; v: number };
    expect(body.error).toBe("bad field");
    expect(body.v).toBe(Infinity);
  });

  it("parser stack overflow on a 422 body PROPAGATES (RecursionError analog)", async () => {
    const h = harness([res(422, "[".repeat(1_000_000))]);
    const error = await appRequest(h.deps, "GET", "/d").catch(
      (error_: unknown) => error_,
    );
    expect(error).toBeInstanceOf(RangeError);
  });
});
