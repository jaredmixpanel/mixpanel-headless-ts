// Layer-3 translation of `tests/unit/test_auth_registration.py`
// (b8-packets.md §4.3 row 2): `TestEnsureClientRegistered` (:68),
// `TestEnsureClientRegisteredRobustness` (:371),
// `TestEnsureClientRegisteredRegionValidation` (:441) — all 13 tests.
//
// Python's `httpx.MockTransport` fixtures translate to an injected
// `fetchImpl` returning web-standard `Response` objects (the N2
// `oauth-flow-refresh.test.ts` convention); the `tmp_path` storage
// fixture translates to `makeTempDir`.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OAuthError } from "../../core/src/errors.js";
import { ensureClientRegistered } from "../src/auth/client-registration.js";
import { OAuthStorage } from "../src/auth/storage.js";
import { makeTempDir, scrubMpEnv } from "./helpers.js";

const cleanups: (() => void)[] = [];
let restoreEnv: () => void = () => undefined;

beforeEach(() => {
  restoreEnv = scrubMpEnv();
});

afterEach(() => {
  restoreEnv();
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

/** A captured outbound request (the `httpx.Request` slice asserted). */
interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly body: string;
}

/**
 * The `_make_register_transport` twin (test_auth_registration.py:30):
 * a fetch stub answering every request while recording it.
 *
 * @param respond - Response builder (throw to simulate transport
 *   failure).
 * @returns The stub fetch plus the captured-request log.
 */
function mockTransport(respond: () => Response): {
  fetchImpl: typeof fetch;
  captured: CapturedRequest[];
} {
  const captured: CapturedRequest[] = [];
  const fetchImpl = ((
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    captured.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : "",
    });
    return Promise.resolve(respond());
  }) as typeof fetch;
  return { fetchImpl, captured };
}

/** JSON `Response` helper. */
function jsonResponse(
  status: number,
  body: unknown,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** Fresh tmp-dir storage (the `tmp_path` fixture twin). */
function tmpStorage(): OAuthStorage {
  return new OAuthStorage({ storageDir: makeTempDir(cleanups) });
}

describe("TestEnsureClientRegistered (test_auth_registration.py:68)", () => {
  it("test_posts_to_register_endpoint", async () => {
    const { fetchImpl, captured } = mockTransport(() =>
      jsonResponse(201, { client_id: "cid-1" }),
    );

    await ensureClientRegistered({
      fetchImpl,
      region: "us",
      redirectUri: "http://localhost:19284/callback",
      storage: tmpStorage(),
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]?.method).toBe("POST");
    expect(captured[0]?.url).toBe("https://mixpanel.com/oauth/mcp/register/");
  });

  it("test_correct_request_body", async () => {
    const { fetchImpl, captured } = mockTransport(() =>
      jsonResponse(201, { client_id: "cid-1" }),
    );

    await ensureClientRegistered({
      fetchImpl,
      region: "us",
      redirectUri: "http://localhost:19284/callback",
      storage: tmpStorage(),
    });

    expect(captured).toHaveLength(1);
    const body = JSON.parse(captured[0]?.body ?? "{}") as Record<
      string,
      unknown
    >;
    expect(body["redirect_uris"]).toEqual(["http://localhost:19284/callback"]);
    expect(body["grant_types"]).toEqual([
      "authorization_code",
      "refresh_token",
    ]);
    expect(body["response_types"]).toEqual(["code"]);
    expect(body["token_endpoint_auth_method"]).toBe("none");
    expect(typeof body["scope"]).toBe("string");
    const scopeStr = String(body["scope"]);
    expect(scopeStr).toContain("projects");
    expect(scopeStr).toContain("analysis");
  });

  it("test_parses_client_id_from_response", async () => {
    const { fetchImpl } = mockTransport(() =>
      jsonResponse(201, { client_id: "parsed-client-id" }),
    );

    const result = await ensureClientRegistered({
      fetchImpl,
      region: "us",
      redirectUri: "http://localhost:19284/callback",
      storage: tmpStorage(),
    });

    expect(result.client_id).toBe("parsed-client-id");
    expect(result.region).toBe("us");
    expect(result.redirect_uri).toBe("http://localhost:19284/callback");
  });

  it("test_caches_result_per_region", async () => {
    let callCount = 0;
    const fetchImpl = ((): Promise<Response> => {
      callCount += 1;
      return Promise.resolve(jsonResponse(201, { client_id: "cached-cid" }));
    }) as typeof fetch;
    const storage = tmpStorage();

    // First call registers.
    const result1 = await ensureClientRegistered({
      fetchImpl,
      region: "us",
      redirectUri: "http://localhost:19284/callback",
      storage,
    });
    expect(callCount).toBe(1);

    // Second call uses cache — no new request.
    const result2 = await ensureClientRegistered({
      fetchImpl,
      region: "us",
      redirectUri: "http://localhost:19284/callback",
      storage,
    });
    expect(callCount).toBe(1);
    expect(result2.client_id).toBe(result1.client_id);
  });

  it("test_re_registers_if_redirect_uri_changes", async () => {
    let callCount = 0;
    const fetchImpl = ((): Promise<Response> => {
      callCount += 1;
      return Promise.resolve(
        jsonResponse(201, { client_id: `cid-${callCount}` }),
      );
    }) as typeof fetch;
    const storage = tmpStorage();

    const result1 = await ensureClientRegistered({
      fetchImpl,
      region: "us",
      redirectUri: "http://localhost:19284/callback",
      storage,
    });
    expect(callCount).toBe(1);
    expect(result1.client_id).toBe("cid-1");

    // Changed redirect_uri triggers re-registration.
    const result2 = await ensureClientRegistered({
      fetchImpl,
      region: "us",
      redirectUri: "http://localhost:19285/callback",
      storage,
    });
    expect(callCount).toBe(2);
    expect(result2.client_id).toBe("cid-2");
    expect(result2.redirect_uri).toBe("http://localhost:19285/callback");
  });

  it("test_handles_429_rate_limit", async () => {
    const { fetchImpl } = mockTransport(() =>
      jsonResponse(429, { error: "rate_limited" }, { "Retry-After": "60" }),
    );

    const error = await ensureClientRegistered({
      fetchImpl,
      region: "us",
      redirectUri: "http://localhost:19284/callback",
      storage: tmpStorage(),
    }).then(
      () => null,
      (exc: unknown) => exc,
    );
    expect(error).toBeInstanceOf(OAuthError);
    expect((error as OAuthError).code).toBe("OAUTH_REGISTRATION_ERROR");
  });

  it("test_eu_region_uses_eu_base_url", async () => {
    const { fetchImpl, captured } = mockTransport(() =>
      jsonResponse(201, { client_id: "eu-cid" }),
    );

    await ensureClientRegistered({
      fetchImpl,
      region: "eu",
      redirectUri: "http://localhost:19284/callback",
      storage: tmpStorage(),
    });

    expect(captured[0]?.url).toBe(
      "https://eu.mixpanel.com/oauth/mcp/register/",
    );
  });

  it("test_in_region_uses_in_base_url", async () => {
    const { fetchImpl, captured } = mockTransport(() =>
      jsonResponse(201, { client_id: "in-cid" }),
    );

    await ensureClientRegistered({
      fetchImpl,
      region: "in",
      redirectUri: "http://localhost:19284/callback",
      storage: tmpStorage(),
    });

    expect(captured[0]?.url).toBe(
      "https://in.mixpanel.com/oauth/mcp/register/",
    );
  });

  it("test_accepts_200_status_code", async () => {
    const { fetchImpl } = mockTransport(() =>
      jsonResponse(200, { client_id: "cid-200" }),
    );

    const result = await ensureClientRegistered({
      fetchImpl,
      region: "us",
      redirectUri: "http://localhost:19284/callback",
      storage: tmpStorage(),
    });

    expect(result.client_id).toBe("cid-200");
  });

  it("test_accepts_201_status_code", async () => {
    const { fetchImpl } = mockTransport(() =>
      jsonResponse(201, { client_id: "cid-201" }),
    );

    const result = await ensureClientRegistered({
      fetchImpl,
      region: "us",
      redirectUri: "http://localhost:19284/callback",
      storage: tmpStorage(),
    });

    expect(result.client_id).toBe("cid-201");
  });
});

describe("TestEnsureClientRegisteredRobustness (test_auth_registration.py:371)", () => {
  it("test_registration_response_missing_client_id", async () => {
    const { fetchImpl } = mockTransport(() => jsonResponse(200, {}));

    const error = await ensureClientRegistered({
      fetchImpl,
      region: "us",
      redirectUri: "http://localhost:19284/callback",
      storage: tmpStorage(),
    }).then(
      () => null,
      (exc: unknown) => exc,
    );
    expect(error).toBeInstanceOf(OAuthError);
    expect((error as OAuthError).code).toBe("OAUTH_REGISTRATION_ERROR");
  });

  it("test_registration_non_json_response", async () => {
    const { fetchImpl } = mockTransport(
      () =>
        new Response("<html><body>Oops</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    );

    const error = await ensureClientRegistered({
      fetchImpl,
      region: "us",
      redirectUri: "http://localhost:19284/callback",
      storage: tmpStorage(),
    }).then(
      () => null,
      (exc: unknown) => exc,
    );
    expect(error).toBeInstanceOf(OAuthError);
    expect((error as OAuthError).code).toBe("OAUTH_REGISTRATION_ERROR");
  });
});

describe("TestEnsureClientRegisteredRegionValidation (test_auth_registration.py:441)", () => {
  it("test_invalid_region_raises_oauth_error", async () => {
    const { fetchImpl, captured } = mockTransport(() =>
      jsonResponse(200, { client_id: "nope" }),
    );

    const error = await ensureClientRegistered({
      fetchImpl,
      region: "xx",
      redirectUri: "http://localhost:19284/callback",
      storage: tmpStorage(),
    }).then(
      () => null,
      (exc: unknown) => exc,
    );
    expect(error).toBeInstanceOf(OAuthError);
    expect((error as OAuthError).code).toBe("OAUTH_REGISTRATION_ERROR");
    expect(String(error)).toContain("xx");
    // "before making any request"
    expect(captured).toHaveLength(0);
  });
});
