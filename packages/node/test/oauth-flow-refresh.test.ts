// Layer-3 translation of the REFRESH classes of
// `tests/unit/test_auth_flow.py` (b8-packets.md §3.3 row 5):
// `TestOAuthFlowRefresh` (:490), the REFRESH member of
// `TestTokenPayloadRedaction` (FIX-2, bug (d) — exchange members are
// in `oauth-flow-login.test.ts`), `TestOAuthFlowGetValidToken` (:610),
// the refresh/timeout members of `TestOAuthFlowNetworkErrors` (:802 —
// the exchange-op members are N3's, header-cited split), and
// `TestOAuthFlowRegionValidation` (:984 — lands with the N2 class
// skeleton per the packet row).
//
// Python's `httpx.MockTransport` fixtures translate to an injected
// `fetchImpl` returning web-standard `Response` objects; transport
// failures reject, and the R2.10 adapter path
// (`createRequestExecutor`) normalizes them exactly as the B0 client
// does. The `tmp_path` storage fixture translates to `makeTempDir`.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  OAuthError,
  Secret,
  OAuthTokens,
  type OAuthClientInfo,
} from "@mixpanel-headless/core";
import { OAuthFlow } from "../src/auth/flow.js";
import { OAUTH_BASE_URLS } from "../src/auth/oauth-constants.js";
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

/** The `_make_token_response` fixture twin (test_auth_flow.py:31). */
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

/** The `_make_client_info` fixture twin (test_auth_flow.py:63). */
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
      url: String(input),
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
  return new Response(JSON.stringify(body), {
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

describe("TestOAuthFlowRefresh (test_auth_flow.py:490)", () => {
  it("test_refresh_posts_correct_params", async () => {
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
    // Body is form-encoded IN INSERTION ORDER (packet §3.2 item 1).
    expect(body).toBe(
      "grant_type=refresh_token&refresh_token=old-refresh&client_id=cid",
    );
    expect(captured[0]?.url).toBe(`${OAUTH_BASE_URLS["us"]}token/`);
    expect(captured[0]?.contentType).toBe("application/x-www-form-urlencoded");
    expect(newTokens.access_token.reveal()).toBe("access-tok-123");
  });

  it("test_refresh_invalid_grant_raises_revoked", async () => {
    const { fetchImpl } = mockTransport(() =>
      jsonResponse(400, { error: "invalid_grant" }),
    );
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    const flow = new OAuthFlow({ region: "us", storage, fetchImpl });
    const tokens = expiredTokens({ refreshToken: "bad-refresh" });
    let caught: OAuthError | null = null;
    try {
      await flow.refreshTokens(tokens, "cid", { accountName: "personal" });
    } catch (exc) {
      caught = exc as OAuthError;
    }
    expect(caught).toBeInstanceOf(OAuthError);
    expect(caught?.code).toBe("OAUTH_REFRESH_REVOKED");
    // Actionable hint embeds the account name.
    expect(caught?.message).toContain("personal");
    expect(caught?.message).toContain("mp account login personal");
  });

  it("test_refresh_transient_5xx_raises_generic_error", async () => {
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

  it("test_refresh_without_refresh_token_raises", async () => {
    const { fetchImpl, captured } = mockTransport(() =>
      jsonResponse(200, makeTokenResponse()),
    );
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    const flow = new OAuthFlow({ region: "us", storage, fetchImpl });
    const tokens = expiredTokens({ refreshToken: null });
    await expect(flow.refreshTokens(tokens, "cid")).rejects.toMatchObject({
      code: "OAUTH_REFRESH_ERROR",
    });
    // The refusal fires BEFORE any request (packet §3.2 item 2).
    expect(captured).toHaveLength(0);
  });

  it("test_refresh_missing_fields_error_redacts_token_material", async () => {
    // TestTokenPayloadRedaction refresh member (Python FIX-2;
    // fix-of-record context/phase3/bug-reports/
    // python-oauth-error-details-token-payload.md; exchange members in
    // `oauth-flow-login.test.ts`, header-cited split). Also
    // vector-locked: auth/oauth_flow.refresh_tokens/...-
    // testtokenpayloadredaction-... pins the exact response_data string.
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
    } catch (exc) {
      caught = exc as OAuthError;
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

  it("test_refresh_non_dict_200_body_raises_oauth_error", async () => {
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
    } catch (exc) {
      caught = exc as OAuthError;
    }
    expect(caught).toBeInstanceOf(OAuthError);
    expect(caught?.code).toBe("OAUTH_REFRESH_ERROR");
    // ARB-B F-B3: fixed placeholder, never a verbatim rendering — the
    // value itself can be the credential.
    expect(caught?.details["response_data"]).toBe("<redacted non-object body>");
  });

  it("test_refresh_non_json_200_body_not_embedded", async () => {
    // ARB-B F-B1: a 200 body that fails JSON parsing can still BE the
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
    } catch (exc) {
      caught = exc as OAuthError;
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
    expect(caught?.details["body_length"]).toBe(Array.from(body).length);
  });
});

describe("TestOAuthFlowGetValidToken (test_auth_flow.py:610)", () => {
  it("test_returns_current_token_if_not_expired", async () => {
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

  it("test_auto_refreshes_expired_token", async () => {
    const { fetchImpl } = mockTransport(() =>
      jsonResponse(200, makeTokenResponse()),
    );
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    storage.saveTokens(expiredTokens({ refreshToken: "valid-refresh" }), "us");
    storage.saveClientInfo(makeClientInfo());
    const flow = new OAuthFlow({ region: "us", storage, fetchImpl });
    await expect(flow.getValidToken("us")).resolves.toBe("access-tok-123");
  });

  it("test_persists_refreshed_tokens", async () => {
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

  it("test_raises_revoked_if_refresh_fails_invalid_grant", async () => {
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

  it("test_raises_oauth_error_if_no_tokens_exist", async () => {
    const { fetchImpl } = mockTransport(
      () => new Response("should not be called", { status: 500 }),
    );
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    const flow = new OAuthFlow({ region: "us", storage, fetchImpl });
    await expect(flow.getValidToken("us")).rejects.toMatchObject({
      code: "OAUTH_TOKEN_ERROR",
    });
  });

  it("test_raises_oauth_error_if_no_client_info_for_refresh", async () => {
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

describe("TestOAuthFlowNetworkErrors — refresh member (test_auth_flow.py:945; exchange members → N3, header-cited split)", () => {
  it("test_refresh_tokens_timeout", async () => {
    const fetchImpl = ((): Promise<Response> =>
      Promise.reject(
        new DOMException("test timeout", "TimeoutError"),
      )) as unknown as typeof fetch;
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    const flow = new OAuthFlow({ region: "us", storage, fetchImpl });
    let caught: OAuthError | null = null;
    try {
      await flow.refreshTokens(expiredTokens(), "cid");
    } catch (exc) {
      caught = exc as OAuthError;
    }
    expect(caught).toBeInstanceOf(OAuthError);
    expect(caught?.code).toBe("OAUTH_REFRESH_ERROR");
    // The transport-failure details carry the token URL (§3.2 item 3;
    // vector `test_refresh_tokens_timeout` locks `details_contain.url`).
    expect(caught?.details["url"]).toBe("https://mixpanel.com/oauth/token/");
  });
});

describe("TestOAuthFlowRegionValidation (test_auth_flow.py:984)", () => {
  it("test_invalid_region_raises_oauth_error", () => {
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    let caught: OAuthError | null = null;
    try {
      new OAuthFlow({ region: "uk", storage });
    } catch (exc) {
      caught = exc as OAuthError;
    }
    expect(caught).toBeInstanceOf(OAuthError);
    expect(caught?.code).toBe("OAUTH_CONFIG_ERROR");
    expect(caught?.message).toContain("uk");
  });

  it("test_uppercase_region_raises_oauth_error", () => {
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    expect(() => new OAuthFlow({ region: "US", storage })).toThrow(OAuthError);
    try {
      new OAuthFlow({ region: "US", storage });
    } catch (exc) {
      expect((exc as OAuthError).code).toBe("OAUTH_CONFIG_ERROR");
    }
  });

  it("test_empty_region_raises_oauth_error", () => {
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    try {
      new OAuthFlow({ region: "", storage });
      expect.unreachable("empty region must raise");
    } catch (exc) {
      expect((exc as OAuthError).code).toBe("OAUTH_CONFIG_ERROR");
    }
  });

  it.each([["us"], ["eu"], ["in"]])(
    "test_valid_regions_accepted[%s]",
    (region) => {
      const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
      const flow = new OAuthFlow({ region, storage });
      expect(flow.region).toBe(region);
    },
  );
});
