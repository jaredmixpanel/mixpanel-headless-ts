// OAuthFlow refresh, getValidToken, refresh network errors and region
// validation. Mirrors the refresh classes of tests/unit/test_auth_flow.py
// (the login/exchange classes live in oauth-flow-login.test.ts);
// httpx.MockTransport fixtures translate to an injected `fetchImpl`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cpLength,
  OAUTH_BASE_URLS,
  type OAuthClientInfo,
  OAuthError,
  OAuthTokens,
  Secret,
} from "@mixpanel-headless/core";

import { expectThrows } from "../../core/test-support/raises.js";
import { OAuthFlow } from "../src/auth/flow.js";
import { OAuthStorage } from "../src/auth/storage.js";
import { makeTempDir, scrubMpEnv } from "./helpers.js";

const cleanups: Array<() => void> = [];

beforeEach(() => {
  scrubMpEnv();
});

afterEach(() => {
  vi.unstubAllEnvs();
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

/** The `_make_token_response` fixture twin. */
function makeTokenResponse(options?: {
  accessToken?: string;
  refreshToken?: string | null;
  expiresIn?: number;
  scope?: string;
  tokenType?: string;
}): Record<string, unknown> {
  const data: Record<string, unknown> = {
    access_token: options?.accessToken ?? "access-tok-123",
    expires_in: options?.expiresIn ?? 3600,
    scope: options?.scope ?? "projects analysis",
    token_type: options?.tokenType ?? "Bearer",
  };
  const refresh = options?.refreshToken;
  if (refresh !== null) {
    data["refresh_token"] = refresh ?? "refresh-tok-456";
  }
  return data;
}

/** The `_make_client_info` fixture twin. */
function makeClientInfo(): OAuthClientInfo {
  return {
    client_id: "test-client-id",
    region: "us",
    redirect_uri: "http://localhost:19284/callback",
    scope: "projects analysis",
    created_at: new Date().toISOString(),
  };
}

/** A captured outbound request (the `httpx.Request` slice asserted). */
interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly body: string;
  readonly contentType: string | null;
}

/**
 * The `httpx.MockTransport` twin: a fetch stub answering every request
 * with `respond()` while recording it.
 *
 * @param respond - Response builder (throw to simulate transport
 *   failure, the `TimeoutException` handler twin).
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
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const contentType =
      Object.entries(headers).find(
        ([name]) => name.toLowerCase() === "content-type",
      )?.[1] ?? null;
    captured.push({
      url: input instanceof Request ? input.url : String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : "",
      contentType,
    });
    return Promise.resolve(respond());
  }) as typeof fetch;
  return { fetchImpl, captured };
}

/** JSON `Response` helper. */
function jsonResponse(status: number, body: unknown): Response {
  return Response.json(body, {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Expired token set (the shared fixture shape). */
function expiredTokens(options?: {
  refreshToken?: string | null;
  scope?: string;
}): OAuthTokens {
  const refresh = options?.refreshToken;
  return new OAuthTokens({
    access_token: new Secret("old-access"),
    refresh_token:
      refresh === null ? null : new Secret(refresh ?? "old-refresh"),
    expires_at: new Date(Date.now() - 3_600_000)
      .toISOString()
      .replace(/\.\d{3}Z$/, "+00:00"),
    scope: options?.scope ?? "projects",
    token_type: "Bearer",
  });
}

describe("OAuthFlow.refreshTokens", () => {
  // python: test_auth_flow.py::TestOAuthFlowRefresh
  it("posts the refresh_token grant as form params in insertion order", async () => {
    // python: test_refresh_posts_correct_params
    const { fetchImpl, captured } = mockTransport(() =>
      jsonResponse(200, makeTokenResponse()),
    );
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    const flow = new OAuthFlow({ region: "us", storage, fetchImpl });
    const newTokens = await flow.refreshTokens(expiredTokens(), "cid");
    expect(captured).toHaveLength(1);
    const body = captured[0]?.body ?? "";
    expect(body).toContain("grant_type=refresh_token");
    expect(body).toContain("refresh_token=old-refresh");
    expect(body).toContain("client_id=cid");
    // Body is form-encoded in insertion order.
    expect(body).toBe(
      "grant_type=refresh_token&refresh_token=old-refresh&client_id=cid",
    );
    expect(captured[0]?.url).toBe(`${OAUTH_BASE_URLS["us"]!}token/`);
    expect(captured[0]?.contentType).toBe("application/x-www-form-urlencoded");
    expect(newTokens.access_token.reveal()).toBe("access-tok-123");
  });

  it("maps invalid_grant to OAUTH_REFRESH_REVOKED with a login hint", async () => {
    // python: test_refresh_invalid_grant_raises_revoked
    const { fetchImpl } = mockTransport(() =>
      jsonResponse(400, { error: "invalid_grant" }),
    );
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    const flow = new OAuthFlow({ region: "us", storage, fetchImpl });
    const tokens = expiredTokens({ refreshToken: "bad-refresh" });
    let caught: OAuthError | null = null;
    try {
      await flow.refreshTokens(tokens, "cid", { accountName: "personal" });
    } catch (error) {
      caught = error as OAuthError;
    }
    expect(caught).toBeInstanceOf(OAuthError);
    expect(caught?.code).toBe("OAUTH_REFRESH_REVOKED");
    // Actionable hint embeds the account name.
    expect(caught?.message).toContain("personal");
    expect(caught?.message).toContain("mp account login personal");
  });

  it("raises the generic refresh error on a 5xx", async () => {
    // python: test_refresh_transient_5xx_raises_generic_error
    const { fetchImpl } = mockTransport(
      () => new Response("Service Unavailable", { status: 503 }),
    );
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    const flow = new OAuthFlow({ region: "us", storage, fetchImpl });
    const tokens = expiredTokens({ refreshToken: "good-refresh" });
    await expect(flow.refreshTokens(tokens, "cid")).rejects.toMatchObject({
      code: "OAUTH_REFRESH_ERROR",
    });
  });

  it("refuses before any request when there is no refresh token", async () => {
    // python: test_refresh_without_refresh_token_raises
    const { fetchImpl, captured } = mockTransport(() =>
      jsonResponse(200, makeTokenResponse()),
    );
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    const flow = new OAuthFlow({ region: "us", storage, fetchImpl });
    const tokens = expiredTokens({ refreshToken: null });
    await expect(flow.refreshTokens(tokens, "cid")).rejects.toMatchObject({
      code: "OAUTH_REFRESH_ERROR",
    });
    // The refusal fires before any request.
    expect(captured).toHaveLength(0);
  });

  it("redacts token material when required fields are missing", async () => {
    // python: test_refresh_missing_fields_error_redacts_token_material
    // TestTokenPayloadRedaction refresh member (exchange members in
    // `oauth-flow-login.test.ts`). Also vector-locked:
    // auth/oauth_flow.refresh_tokens/...-testtokenpayloadredaction-... pins
    // the exact response_data string.
    const { fetchImpl } = mockTransport(() =>
      jsonResponse(200, {
        access_token: "SECRET_AT",
        refresh_token: "SECRET_RT",
        id_token: "SECRET_ID",
      }),
    );
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    const flow = new OAuthFlow({ region: "us", storage, fetchImpl });
    let caught: OAuthError | null = null;
    try {
      await flow.refreshTokens(expiredTokens(), "cid");
    } catch (error) {
      caught = error as OAuthError;
    }
    expect(caught).toBeInstanceOf(OAuthError);
    expect(caught?.code).toBe("OAUTH_REFRESH_ERROR");
    const serialized =
      String(caught) +
      JSON.stringify(caught?.details) +
      JSON.stringify(caught?.toDict());
    expect(serialized).not.toContain("SECRET_AT");
    expect(serialized).not.toContain("SECRET_RT");
    expect(serialized).not.toContain("SECRET_ID");
    // Byte-exact Python `str(dict)` rendering (the vector's
    // details_contain lock).
    expect(caught?.details["response_data"]).toBe(
      "{'access_token': '<redacted>', 'refresh_token': '<redacted>', " +
        "'id_token': '<redacted>'}",
    );
  });

  it("raises OAUTH_REFRESH_ERROR with a fixed placeholder for a non-object 200 body", async () => {
    // python: test_refresh_non_dict_200_body_raises_oauth_error
    // ARB-A F1: refresh path shares `postTokenRequest`, so the
    // non-record-200 guard is locked on the refresh error code too
    // (Python twin: TestTokenPayloadRedaction::
    // test_refresh_non_dict_200_body_raises_oauth_error).
    const { fetchImpl } = mockTransport(() => jsonResponse(200, [1, 2]));
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    const flow = new OAuthFlow({ region: "us", storage, fetchImpl });
    let caught: OAuthError | null = null;
    try {
      await flow.refreshTokens(expiredTokens(), "cid");
    } catch (error) {
      caught = error as OAuthError;
    }
    expect(caught).toBeInstanceOf(OAuthError);
    expect(caught?.code).toBe("OAUTH_REFRESH_ERROR");
    // Fixed placeholder, never a verbatim rendering — the value itself can
    // be the credential.
    expect(caught?.details["response_data"]).toBe("<redacted non-object body>");
  });

  it("never embeds a non-JSON 200 body; keeps only content type and length", async () => {
    // python: test_refresh_non_json_200_body_not_embedded
    // A 200 body that fails JSON parsing can still be the
    // token payload (valid token JSON + trailing proxy garbage). It is
    // never embedded — only content-type and code-point length survive
    // (Python twin: TestTokenPayloadRedaction::
    // test_refresh_non_json_200_body_not_embedded).
    const body = '{"access_token":"SECRET_GARB"}garbage';
    const { fetchImpl } = mockTransport(
      () =>
        new Response(body, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    const flow = new OAuthFlow({ region: "us", storage, fetchImpl });
    let caught: OAuthError | null = null;
    try {
      await flow.refreshTokens(expiredTokens(), "cid");
    } catch (error) {
      caught = error as OAuthError;
    }
    expect(caught).toBeInstanceOf(OAuthError);
    expect(caught?.code).toBe("OAUTH_REFRESH_ERROR");
    const serialized =
      String(caught) +
      JSON.stringify(caught?.details) +
      JSON.stringify(caught?.toDict());
    expect(serialized).not.toContain("SECRET_GARB");
    expect(caught?.details).not.toHaveProperty("response_body");
    expect(caught?.details["content_type"]).toBe("application/json");
    expect(caught?.details["body_length"]).toBe(cpLength(body));
  });
});

describe("OAuthFlow.getValidToken", () => {
  // python: test_auth_flow.py::TestOAuthFlowGetValidToken
  it("returns the stored token while it is valid", async () => {
    // python: test_returns_current_token_if_not_expired
    const { fetchImpl } = mockTransport(
      () => new Response("should not be called", { status: 500 }),
    );
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    const validTokens = new OAuthTokens({
      access_token: new Secret("valid-access-token"),
      refresh_token: new Secret("valid-refresh-token"),
      expires_at: new Date(Date.now() + 3_600_000)
        .toISOString()
        .replace(/\.\d{3}Z$/, "+00:00"),
      scope: "projects analysis",
      token_type: "Bearer",
    });
    storage.saveTokens(validTokens, "us");
    storage.saveClientInfo(makeClientInfo());
    const flow = new OAuthFlow({ region: "us", storage, fetchImpl });
    await expect(flow.getValidToken("us")).resolves.toBe("valid-access-token");
  });

  it("refreshes an expired token automatically", async () => {
    // python: test_auto_refreshes_expired_token
    const { fetchImpl } = mockTransport(() =>
      jsonResponse(200, makeTokenResponse()),
    );
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    storage.saveTokens(expiredTokens({ refreshToken: "valid-refresh" }), "us");
    storage.saveClientInfo(makeClientInfo());
    const flow = new OAuthFlow({ region: "us", storage, fetchImpl });
    await expect(flow.getValidToken("us")).resolves.toBe("access-tok-123");
  });

  it("persists the refreshed tokens", async () => {
    // python: test_persists_refreshed_tokens
    const { fetchImpl } = mockTransport(() =>
      jsonResponse(200, makeTokenResponse()),
    );
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    storage.saveTokens(expiredTokens({ refreshToken: "valid-refresh" }), "us");
    storage.saveClientInfo(makeClientInfo());
    const flow = new OAuthFlow({ region: "us", storage, fetchImpl });
    await flow.getValidToken("us");
    const reloaded = storage.loadTokens("us");
    expect(reloaded).not.toBeNull();
    expect(reloaded?.access_token.reveal()).toBe("access-tok-123");
  });

  it("raises OAUTH_REFRESH_REVOKED when the refresh gets invalid_grant", async () => {
    // python: test_raises_revoked_if_refresh_fails_invalid_grant
    const { fetchImpl } = mockTransport(() =>
      jsonResponse(400, { error: "invalid_grant" }),
    );
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    storage.saveTokens(expiredTokens({ refreshToken: "bad-refresh" }), "us");
    storage.saveClientInfo(makeClientInfo());
    const flow = new OAuthFlow({ region: "us", storage, fetchImpl });
    await expect(flow.getValidToken("us")).rejects.toMatchObject({
      code: "OAUTH_REFRESH_REVOKED",
    });
  });

  it("raises OAuthError when no tokens are stored", async () => {
    // python: test_raises_oauth_error_if_no_tokens_exist
    const { fetchImpl } = mockTransport(
      () => new Response("should not be called", { status: 500 }),
    );
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    const flow = new OAuthFlow({ region: "us", storage, fetchImpl });
    await expect(flow.getValidToken("us")).rejects.toMatchObject({
      code: "OAUTH_TOKEN_ERROR",
    });
  });

  it("raises OAuthError when no client info is stored for the refresh", async () => {
    // python: test_raises_oauth_error_if_no_client_info_for_refresh
    const { fetchImpl } = mockTransport(() =>
      jsonResponse(200, makeTokenResponse()),
    );
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    storage.saveTokens(expiredTokens({ refreshToken: "valid-refresh" }), "us");
    // Intentionally NOT saving client_info.
    const flow = new OAuthFlow({ region: "us", storage, fetchImpl });
    await expect(flow.getValidToken("us")).rejects.toMatchObject({
      code: "OAUTH_REFRESH_ERROR",
    });
  });
});

describe("OAuthFlow.refreshTokens network errors", () => {
  // python: test_auth_flow.py::TestOAuthFlowNetworkErrors
  it("wraps a transport timeout into OAUTH_REFRESH_ERROR carrying the token URL", async () => {
    // python: test_refresh_tokens_timeout
    const fetchImpl = ((): Promise<Response> =>
      Promise.reject(
        new DOMException("test timeout", "TimeoutError"),
      )) as unknown as typeof fetch;
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    const flow = new OAuthFlow({ region: "us", storage, fetchImpl });
    let caught: OAuthError | null = null;
    try {
      await flow.refreshTokens(expiredTokens(), "cid");
    } catch (error) {
      caught = error as OAuthError;
    }
    expect(caught).toBeInstanceOf(OAuthError);
    expect(caught?.code).toBe("OAUTH_REFRESH_ERROR");
    // The transport-failure details carry the token URL (§3.2 item 3;
    // vector `test_refresh_tokens_timeout` locks `details_contain.url`).
    expect(caught?.details["url"]).toBe("https://mixpanel.com/oauth/token/");
  });
});

describe("OAuthFlow region validation", () => {
  // python: test_auth_flow.py::TestOAuthFlowRegionValidation
  it("rejects an unknown region with OAUTH_CONFIG_ERROR", () => {
    // python: test_invalid_region_raises_oauth_error
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    let caught: OAuthError | null = null;
    try {
      new OAuthFlow({ region: "uk", storage });
    } catch (error) {
      caught = error as OAuthError;
    }
    expect(caught).toBeInstanceOf(OAuthError);
    expect(caught?.code).toBe("OAUTH_CONFIG_ERROR");
    expect(caught?.message).toContain("uk");
  });

  it("rejects an upper-case region", () => {
    // python: test_uppercase_region_raises_oauth_error
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    const error = expectThrows(() => new OAuthFlow({ region: "US", storage }));
    expect(error).toBeInstanceOf(OAuthError);
    expect((error as OAuthError).code).toBe("OAUTH_CONFIG_ERROR");
  });

  it("rejects an empty region", () => {
    // python: test_empty_region_raises_oauth_error
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    const error = expectThrows(
      () => new OAuthFlow({ region: "", storage }),
      "empty region must raise",
    );
    expect((error as OAuthError).code).toBe("OAUTH_CONFIG_ERROR");
  });

  it.each([["us"], ["eu"], ["in"]])("accepts region %s", (region) => {
    // python: test_valid_regions_accepted
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    const flow = new OAuthFlow({ region, storage });
    expect(flow.region).toBe(region);
  });
});
