// Layer-3 translation — Phase-3 packet B4-C1 request-path locks. Sources:
//
// - tests/unit/test_api_client.py::TestPublicRequest (:1575-1826) — the
//   FULL class, through the REAL assembled client (B0 translated the
//   observable subset against `executeWithRetry` directly and deferred
//   the URL/auth-plumbing asserts here; internals.test.ts header).
// - tests/unit/test_app_api_client.py — B0 deviation-3 deferrals only:
//   ::TestAppRequest::test_uses_bearer_auth_header (:81) /
//   ::test_uses_basic_auth_when_configured (:95) /
//   ::test_builds_correct_url (:109) — auth headers + URL now recorded
//   END-TO-END through the real client + Phase-2 auth model — and
//   ::TestAppRequestFormBody::test_form_body_sent_as_form_encoded
//   (:316) — the adapter-owned content-type/encoding assertion. The
//   remaining classes were translated at B0 (app-request.test.ts header;
//   `b0-review-assertions.md`).
//
// Entry-point substitutions as in client-core.test.ts.
import { describe, expect, it } from "vitest";

import { JsonNumber } from "../../src/client/json-value.js";
import {
  AuthenticationError,
  QueryError,
  RateLimitError,
} from "../../src/errors.js";
import {
  type CapturedFetchRequest,
  createMockClient,
  makeSession,
} from "../../test-support/client-test-helpers.js";

describe("TestPublicRequest", () => {
  it("test_request_sends_auth_header", async () => {
    let capturedHeaders: Readonly<Record<string, string>> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedHeaders = request.headers;
      return { status: 200, json: { result: "ok" } };
    });
    await client.request("GET", "https://mixpanel.com/api/app/test");
    expect(capturedHeaders["authorization"]).toBeDefined();
    expect(capturedHeaders["authorization"]?.startsWith("Basic ")).toBe(true);
  });

  it("test_request_with_query_params", async () => {
    let capturedUrl = "";
    const { client } = createMockClient(makeSession(), (request) => {
      capturedUrl = request.url;
      return { status: 200, json: {} };
    });
    await client.request("GET", "https://mixpanel.com/api/app/test", {
      params: { foo: "bar", limit: 10 },
    });
    expect(capturedUrl.includes("foo=bar")).toBe(true);
    expect(capturedUrl.includes("limit=10")).toBe(true);
  });

  it("test_request_with_json_body", async () => {
    let capturedBody: unknown = {};
    let capturedContentType = "";
    const { client } = createMockClient(makeSession(), (request) => {
      capturedContentType = request.headers["content-type"] ?? "";
      if (request.bodyText !== "") {
        capturedBody = JSON.parse(request.bodyText);
      }
      return { status: 200, json: { created: true } };
    });
    await client.request(
      "POST",
      "https://mixpanel.com/api/app/projects/12345/data",
      {
        jsonBody: {
          name: "test",
          value: 123,
          query_origin: "mixpanel-headless",
        },
      },
    );
    expect(capturedContentType.includes("application/json")).toBe(true);
    expect(capturedBody).toStrictEqual({
      name: "test",
      value: 123,
      query_origin: "mixpanel-headless",
    });
  });

  it("test_request_with_custom_headers", async () => {
    let capturedHeaders: Readonly<Record<string, string>> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedHeaders = request.headers;
      return { status: 200, json: {} };
    });
    await client.request("GET", "https://mixpanel.com/api/app/test", {
      headers: { "X-Custom-Header": "custom-value" },
    });
    // Should have both auth and custom headers.
    expect(capturedHeaders["authorization"]).toBeDefined();
    expect(capturedHeaders["x-custom-header"]).toBe("custom-value");
  });

  it("test_request_auto_injects_query_origin", async () => {
    let capturedParams: Readonly<Record<string, string>> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedParams = request.params;
      return { status: 200, json: {} };
    });
    await client.request("GET", "https://mixpanel.com/api/app/test");
    expect(capturedParams["query_origin"]).toBe("mixpanel-headless");
  });

  it("test_canonical_query_origin_wins_over_caller", async () => {
    let capturedParams: Readonly<Record<string, string>> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedParams = request.params;
      return { status: 200, json: {} };
    });
    await client.request("GET", "https://mixpanel.com/api/app/test", {
      params: { query_origin: "spoofed-by-caller" },
    });
    expect(capturedParams["query_origin"]).toBe("mixpanel-headless");
  });

  it("test_request_does_not_inject_project_id", async () => {
    let capturedUrl = "";
    const { client } = createMockClient(makeSession(), (request) => {
      capturedUrl = request.url;
      return { status: 200, json: {} };
    });
    await client.request("GET", "https://mixpanel.com/api/app/test");
    // project_id should NOT be automatically added.
    expect(capturedUrl.includes("project_id")).toBe(false);
  });

  it("test_request_returns_json_response", async () => {
    const { client } = createMockClient(makeSession(), () => ({
      status: 200,
      json: { data: { events: ["A", "B"] }, status: "ok" },
    }));
    const result = await client.request(
      "GET",
      "https://mixpanel.com/api/app/test",
    );
    expect(result).toStrictEqual({
      data: { events: ["A", "B"] },
      status: "ok",
    });
  });

  it("test_request_handles_401", async () => {
    const { client } = createMockClient(makeSession(), () => ({
      status: 401,
      json: { error: "Invalid token" },
    }));
    await expect(
      client.request("GET", "https://mixpanel.com/api/app/test"),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("test_request_handles_400", async () => {
    const { client } = createMockClient(makeSession(), () => ({
      status: 400,
      json: { error: "Bad request" },
    }));
    let thrown: unknown;
    try {
      await client.request("GET", "https://mixpanel.com/api/app/test");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(QueryError);
    expect(String(thrown)).toContain("Bad request");
  });

  it("test_request_handles_429_with_retry", async () => {
    let callCount = 0;
    const { client } = createMockClient(makeSession(), () => {
      callCount += 1;
      if (callCount === 1) {
        return { status: 429, text: "", headers: { "Retry-After": "0" } };
      }
      return { status: 200, json: { success: true } };
    });
    const result = await client.request(
      "GET",
      "https://mixpanel.com/api/app/test",
    );
    expect(callCount).toBe(2);
    expect(result).toStrictEqual({ success: true });
  });

  it("test_request_raises_rate_limit_after_max_retries", async () => {
    const { client } = createMockClient(
      makeSession(),
      () => ({ status: 429, text: "", headers: { "Retry-After": "0" } }),
      { maxRetries: 1 },
    );
    let thrown: unknown;
    try {
      await client.request("GET", "https://mixpanel.com/api/app/test");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RateLimitError);
    expect((thrown as RateLimitError).retryAfter).toBe(0);
  });

  it("test_request_lexicon_schemas_example", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    const { client } = createMockClient(makeSession(), (request) => {
      capturedUrl = request.url;
      capturedMethod = request.method;
      return {
        status: 200,
        json: {
          entityType: "event",
          name: "Added To Cart",
          schemaJson: { properties: {} },
        },
      };
    });
    const projectId = client.projectId;
    const result = (await client.request(
      "GET",
      `https://mixpanel.com/api/app/projects/${projectId}/schemas/event/Added%20To%20Cart`,
    )) as Record<string, unknown>;
    expect(capturedMethod).toBe("GET");
    expect(
      capturedUrl.includes("/projects/12345/schemas/event/Added%20To%20Cart"),
    ).toBe(true);
    expect(result["entityType"]).toBe("event");
    expect(result["name"]).toBe("Added To Cart");
  });
});

// ---------------------------------------------------------------------------
// B0 deviation-3 deferrals: auth-header wire captures + form encoding,
// now end-to-end through the real client (tests/unit/test_app_api_client.py).
// ---------------------------------------------------------------------------

describe("TestAppRequest (B4-C1 deferral slice)", () => {
  it("test_uses_bearer_auth_header", async () => {
    let capturedHeaders: Readonly<Record<string, string>> = {};
    const { client } = createMockClient(
      makeSession({ oauthToken: "test-oauth-token" }),
      (request) => {
        capturedHeaders = request.headers;
        return { status: 200, json: { status: "ok", results: [] } };
      },
    );
    await client.appRequest("GET", "/dashboards");
    expect(capturedHeaders["authorization"]).toBe("Bearer test-oauth-token");
  });

  it("test_uses_basic_auth_when_configured", async () => {
    let capturedHeaders: Readonly<Record<string, string>> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedHeaders = request.headers;
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.appRequest("GET", "/dashboards");
    expect(capturedHeaders["authorization"]?.startsWith("Basic ")).toBe(true);
  });

  it("test_builds_correct_url", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(
      makeSession({ oauthToken: "test-oauth-token" }),
      (request) => {
        capturedUrls.push(request.url);
        return { status: 200, json: { status: "ok", results: [] } };
      },
    );
    await client.appRequest("GET", "/projects/12345/dashboards");
    expect(
      capturedUrls[0]?.startsWith(
        "https://mixpanel.com/api/app/projects/12345/dashboards",
      ),
    ).toBe(true);
  });
});

describe("TestAppRequestFormBody (B4-C1 deferral slice)", () => {
  it("test_form_body_sent_as_form_encoded", async () => {
    const captured: CapturedFetchRequest[] = [];
    const { client } = createMockClient(
      makeSession({ oauthToken: "test-oauth-token" }),
      (request) => {
        captured.push(request);
        return { status: 200, json: { status: "ok", results: { id: 1 } } };
      },
    );
    await client.appRequest("POST", "/projects/12345/custom_events/", {
      formBody: { name: "X", alternatives: '[{"event": "Y"}]' },
    });
    const request = captured[0] as CapturedFetchRequest;
    expect(request.method).toBe("POST");
    expect(
      request.headers["content-type"]?.startsWith(
        "application/x-www-form-urlencoded",
      ),
    ).toBe(true);
    // urllib.parse.parse_qs equivalence over the encoded body.
    const decoded = new URLSearchParams(request.bodyText);
    expect(decoded.getAll("name")).toStrictEqual(["X"]);
    expect(decoded.getAll("alternatives")).toStrictEqual(['[{"event": "Y"}]']);
    // Byte-exact urlencode grammar (the recorded body_text contract:
    // quote_plus escapes `[{"...` and spells space as `+`).
    expect(request.bodyText).toBe(
      "name=X&alternatives=%5B%7B%22event%22%3A+%22Y%22%7D%5D",
    );
  });
});

// Result float-ness sanity through the real request path (lossless
// parse — GATE-VERDICT R5): a `18.0` body member survives as a float
// token, never the integer 18.
describe("lossless result plumbing (GATE-R5 spot lock)", () => {
  it("preserves float tokens through request()", async () => {
    const { client } = createMockClient(makeSession(), () => ({
      status: 200,
      text: '{"value": 18.0}',
      headers: { "content-type": "application/json" },
    }));
    const result = (await client.request(
      "GET",
      "https://mixpanel.com/api/app/test",
    )) as Record<string, unknown>;
    const value = result["value"];
    expect(value).toBeInstanceOf(JsonNumber);
    expect((value as JsonNumber).raw).toBe("18.0");
  });
});
