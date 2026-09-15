// OAuthFlow login, pasted-redirect parsing, code exchange and payload
// redaction. Mirrors the login/exchange classes of tests/unit/test_auth_flow.py
// (the refresh classes live in oauth-flow-refresh.test.ts); the module
// monkeypatches translate to the injected `OAuthFlowOptions` seams, and
// `findAvailablePort` is stubbed so no real port is bound here.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CallbackResult,
  cpLength,
  type OAuthClientInfo,
  OAuthError,
  parsePastedRedirect,
} from "@mixpanel-headless/core";

import { browserLaunchArgv, OAuthFlow } from "../src/auth/flow.js";
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
}): Record<string, unknown> {
  const data: Record<string, unknown> = {
    access_token: options?.accessToken ?? "access-tok-123",
    expires_in: 3600,
    scope: "projects analysis",
    token_type: "Bearer",
  };
  const refresh = options?.refreshToken;
  if (refresh !== null) {
    data["refresh_token"] = refresh ?? "refresh-tok-456";
  }
  return data;
}

/** The `_make_client_info` fixture twin. */
function makeClientInfo(options?: { region?: string }): OAuthClientInfo {
  return {
    client_id: "test-client-id",
    region: options?.region ?? "us",
    redirect_uri: "http://localhost:19284/callback",
    scope: "projects analysis",
    created_at: new Date().toISOString(),
  };
}

/** A captured outbound request. */
interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly body: string;
}

/**
 * The `httpx.MockTransport` twin (N2 convention).
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
      url: input instanceof Request ? input.url : String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : "",
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

/** Login-seam bundle: mocked register + callback + browser + stdin. */
interface LoginSeams {
  readonly openBrowser: (url: string) => void;
  readonly startCallbackServer: (options: {
    state: string;
  }) => Promise<readonly [CallbackResult, number]>;
  readonly registerClient: () => Promise<OAuthClientInfo>;
  readonly findAvailablePort: () => Promise<number | null>;
  readonly readStdinLine: () => Promise<string>;
  readonly stderr: (text: string) => void;
}

/**
 * Build the default mocked login seams (the three `@patch` decorators'
 * twin): DCR returns a canned client, the callback resolves with the
 * given code, the browser-open call is recorded.
 *
 * @param options - Overrides for individual seams.
 * @returns The seams plus the opened-URL / stderr capture logs.
 */
function makeLoginSeams(options?: {
  clientInfo?: OAuthClientInfo;
  callbackCode?: string;
  blockCallback?: boolean;
}): {
  seams: LoginSeams;
  openedUrls: string[];
  stderrText: string[];
} {
  const openedUrls: string[] = [];
  const stderrText: string[] = [];
  const seams: LoginSeams = {
    openBrowser: (url: string): void => {
      openedUrls.push(url);
    },
    startCallbackServer: (callbackOptions: {
      state: string;
    }): Promise<readonly [CallbackResult, number]> => {
      if (options?.blockCallback === true) {
        // Block "indefinitely" — the paste completer must win.
        return new Promise<never>(() => undefined);
      }
      return Promise.resolve([
        new CallbackResult({
          code: options?.callbackCode ?? "auth-code-xyz",
          state: callbackOptions.state,
        }),
        19284,
      ] as const);
    },
    registerClient: (): Promise<OAuthClientInfo> =>
      Promise.resolve(options?.clientInfo ?? makeClientInfo()),
    findAvailablePort: (): Promise<number | null> => Promise.resolve(19284),
    readStdinLine: (): Promise<string> => new Promise<never>(() => undefined),
    stderr: (text: string): void => {
      stderrText.push(text);
    },
  };
  return { seams, openedUrls, stderrText };
}

describe("OAuthFlow.login", () => {
  // python: test_auth_flow.py::TestOAuthFlowLogin
  it("completes the login sequence and returns both tokens", async () => {
    // python: test_full_login_sequence
    const { seams, openedUrls } = makeLoginSeams();
    const { fetchImpl } = mockTransport(() =>
      jsonResponse(200, makeTokenResponse()),
    );
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    const flow = new OAuthFlow({ region: "us", storage, fetchImpl, ...seams });

    const tokens = await flow.login();

    expect(tokens.access_token.reveal()).toBe("access-tok-123");
    expect(tokens.refresh_token).not.toBeNull();
    expect(tokens.refresh_token?.reveal()).toBe("refresh-tok-456");
    expect(openedUrls).toHaveLength(1);
  });

  it("returns a null refresh token when the response omits one", async () => {
    // python: test_handles_missing_refresh_token
    const { seams } = makeLoginSeams({ callbackCode: "code1" });
    const { fetchImpl } = mockTransport(() =>
      jsonResponse(200, makeTokenResponse({ refreshToken: null })),
    );
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    const flow = new OAuthFlow({ region: "us", storage, fetchImpl, ...seams });

    const tokens = await flow.login();

    expect(tokens.access_token.reveal()).toBe("access-tok-123");
    expect(tokens.refresh_token).toBeNull();
  });

  it("openBrowser: false prints the authorize URL to stderr instead of launching", async () => {
    // python: test_open_browser_false_skips_webbrowser_and_prints_url
    const { seams, openedUrls, stderrText } = makeLoginSeams({
      callbackCode: "code1",
    });
    const { fetchImpl } = mockTransport(() =>
      jsonResponse(200, makeTokenResponse()),
    );
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    const flow = new OAuthFlow({ region: "us", storage, fetchImpl, ...seams });

    await flow.login({ openBrowser: false });

    expect(openedUrls).toHaveLength(0);
    const err = stderrText.join("");
    expect(err).toContain("Open this URL in your browser");
    // Authorize URL is for the configured region's OAuth host.
    expect(err).toContain("https://");
  });
});

// TS-only (no Python twin: CPython's `webbrowser` owns the launch).
// The default `openBrowser` seam's argv per platform — CLEANUP-PLAN 8.1.
describe("browser launch argv", () => {
  // Every `&`, `%` and `=` an authorize URL carries, in one string.
  const url =
    "https://mixpanel.com/oauth/authorize/?response_type=code&client_id=abc" +
    "&redirect_uri=http%3A%2F%2Flocalhost%3A19284%2Fcallback&state=s%2Bt" +
    "&code_challenge=c_h-a~l.l&code_challenge_method=S256";

  it("win32 launches via rundll32 ShellExecute, never cmd.exe, URL as one verbatim argv element", () => {
    const { command, args } = browserLaunchArgv("win32", url);
    expect(command).toBe("rundll32");
    expect(args).toStrictEqual(["url.dll,FileProtocolHandler", url]);
    expect(command).not.toBe("cmd");
    expect(args).not.toContain("start");
    // The URL survives intact as exactly one element (cmd.exe would
    // have split it at each `&` and expanded `%`).
    expect(args.filter((arg) => arg === url)).toHaveLength(1);
    expect(args.some((arg) => arg.includes("&") && arg !== url)).toBe(false);
  });

  it.each([
    ["darwin", "open"],
    ["linux", "xdg-open"],
  ] as const)("%s uses `%s <url>`", (platform, command) => {
    expect(browserLaunchArgv(platform, url)).toStrictEqual({
      command,
      args: [url],
    });
  });

  it("other POSIX platforms fall back to xdg-open", () => {
    expect(browserLaunchArgv("freebsd", url).command).toBe("xdg-open");
  });
});

describe("parsePastedRedirect", () => {
  // python: test_auth_flow.py::TestParsePastedRedirect
  it("parses code and state from a full redirect URL", () => {
    // python: test_full_redirect_url
    const result = parsePastedRedirect(
      "http://localhost:19284/callback?code=ABC&state=XYZ",
      { expectedState: "XYZ" },
    );
    expect(result.code).toBe("ABC");
    expect(result.state).toBe("XYZ");
  });

  it("parses a bare query string", () => {
    // python: test_query_string_only
    const result = parsePastedRedirect("code=ABC&state=XYZ", {
      expectedState: "XYZ",
    });
    expect(result.code).toBe("ABC");
  });

  it("parses a query string with a leading question mark", () => {
    // python: test_query_string_with_leading_question_mark
    const result = parsePastedRedirect("?code=ABC&state=XYZ", {
      expectedState: "XYZ",
    });
    expect(result.code).toBe("ABC");
  });

  it("strips surrounding whitespace", () => {
    // python: test_whitespace_is_stripped
    const result = parsePastedRedirect(
      "  http://localhost:19284/callback?code=ABC&state=XYZ\n",
      { expectedState: "XYZ" },
    );
    expect(result.code).toBe("ABC");
  });

  it("rejects an empty paste", () => {
    // python: test_empty_paste_raises
    expect(() =>
      parsePastedRedirect("   \n", { expectedState: "XYZ" }),
    ).toThrow(/Empty paste/);
  });

  it("rejects a state mismatch", () => {
    // python: test_state_mismatch_raises
    // CSRF: without this check a hostile party could trick the user
    // into pasting an attacker-generated code.
    expect(() =>
      parsePastedRedirect("code=ABC&state=ATTACKER", { expectedState: "XYZ" }),
    ).toThrow(/State mismatch/);
  });

  it("rejects a paste without code", () => {
    // python: test_missing_code_raises
    expect(() =>
      parsePastedRedirect("state=XYZ", { expectedState: "XYZ" }),
    ).toThrow(/missing `code` or `state`/);
  });

  it("rejects a paste without state", () => {
    // python: test_missing_state_raises
    expect(() =>
      parsePastedRedirect("code=ABC", { expectedState: "XYZ" }),
    ).toThrow(/missing `code` or `state`/);
  });

  it("surfaces the provider's error parameter", () => {
    // python: test_oauth_error_param_surfaces
    expect(() =>
      parsePastedRedirect(
        "http://localhost:19284/callback?error=access_denied&state=XYZ",
        { expectedState: "XYZ" },
      ),
    ).toThrow(/access_denied/);
  });

  it("includes the provider's error_description", () => {
    // python: test_oauth_error_with_description_includes_description
    expect(() =>
      parsePastedRedirect(
        "?error=access_denied&error_description=user+cancelled&state=XYZ",
        { expectedState: "XYZ" },
      ),
    ).toThrow(/user cancelled/);
  });
});

describe("OAuthFlow.login paste fallback", () => {
  // python: test_auth_flow.py::TestOAuthFlowPasteFallback
  it("completes through the pasted redirect when the callback server never answers", async () => {
    // python: test_paste_fallback_succeeds_when_callback_blocked
    // The callback server blocks past the test's lifetime; the paste
    // path is the only one that completes — proves the race resolves
    // on whichever completer wins. State is recovered from the
    // narrated authorize URL (Python hooks `_build_authorize_url`).
    let resolveState: (state: string) => void = () => undefined;
    const statePromise = new Promise<string>((resolve) => {
      resolveState = resolve;
    });
    const { seams, openedUrls, stderrText } = makeLoginSeams({
      blockCallback: true,
    });
    const capturingSeams: LoginSeams = {
      ...seams,
      stderr: (text: string): void => {
        stderrText.push(text);
        const match = /[?&]state=([^&\s]+)/.exec(text);
        if (match?.[1] !== undefined) {
          resolveState(match[1]);
        }
      },
      readStdinLine: async (): Promise<string> => {
        const state = await statePromise;
        return `http://localhost:19284/callback?code=PASTED_CODE&state=${state}\n`;
      },
    };
    const { fetchImpl, captured } = mockTransport(() =>
      jsonResponse(200, makeTokenResponse({ accessToken: "from-paste" })),
    );
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    const flow = new OAuthFlow({
      region: "us",
      storage,
      fetchImpl,
      ...capturingSeams,
    });

    const tokens = await flow.login({ openBrowser: false });

    expect(tokens.access_token.reveal()).toBe("from-paste");
    // The token-exchange POST must include the pasted code.
    expect(captured[0]?.body ?? "").toContain("code=PASTED_CODE");
    expect(openedUrls).toHaveLength(0);
  });
});

describe("OAuthFlow.exchangeCode", () => {
  // python: test_auth_flow.py::TestOAuthFlowTokenExchange
  it("posts the authorization_code grant as form params", async () => {
    // python: test_exchange_posts_correct_form_params
    const { fetchImpl, captured } = mockTransport(() =>
      jsonResponse(200, makeTokenResponse()),
    );
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    const flow = new OAuthFlow({ region: "us", storage, fetchImpl });

    await flow.exchangeCode(
      "auth-code",
      "test-verifier-string",
      "my-client",
      "http://localhost:19284/callback",
    );

    expect(captured).toHaveLength(1);
    expect(captured[0]?.method).toBe("POST");
    const body = captured[0]?.body ?? "";
    expect(body).toContain("grant_type=authorization_code");
    expect(body).toContain("code=auth-code");
    expect(body).toContain("client_id=my-client");
    expect(body).toContain("code_verifier=test-verifier-string");
    expect(body).toContain("redirect_uri=");
  });

  it("posts to the token endpoint of the configured region", async () => {
    // python: test_exchange_uses_correct_url_for_region
    for (const [region, expectedHost] of [
      ["us", "mixpanel.com"],
      ["eu", "eu.mixpanel.com"],
      ["in", "in.mixpanel.com"],
    ] as const) {
      const { fetchImpl, captured } = mockTransport(() =>
        jsonResponse(200, makeTokenResponse()),
      );
      const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
      const flow = new OAuthFlow({ region, storage, fetchImpl });

      await flow.exchangeCode(
        "c",
        "v",
        "cid",
        "http://localhost:19284/callback",
      );

      expect(captured[0]?.url ?? "").toContain(expectedHost);
      expect(captured[0]?.url ?? "").toContain("/oauth/token/");
    }
  });

  it("raises OAUTH_TOKEN_ERROR on an error response", async () => {
    // python: test_exchange_error_raises_oauth_error
    const { fetchImpl } = mockTransport(() =>
      jsonResponse(400, {
        error: "invalid_grant",
        error_description: "Bad code",
      }),
    );
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    const flow = new OAuthFlow({ region: "us", storage, fetchImpl });

    const error = await flow
      .exchangeCode("bad-code", "v", "cid", "http://localhost:19284/callback")
      .then(
        () => null,
        (error_: unknown) => error_,
      );
    expect(error).toBeInstanceOf(OAuthError);
    // `invalid_grant` maps to REVOKED only for the refresh operation —
    // exchange keeps the generic code.
    expect((error as OAuthError).code).toBe("OAUTH_TOKEN_ERROR");
  });
});

describe("token payload redaction on exchange", () => {
  // python: test_auth_flow.py::TestTokenPayloadRedaction
  // A malformed-200 token response must not leak token material into
  // OAuthError details. The refresh member lives in
  // `oauth-flow-refresh.test.ts`, like the network-error classes.

  /** Build an OAuthFlow whose token endpoint 200s with `payload`. */
  function flowWithPayload(payload: Record<string, unknown>): OAuthFlow {
    const { fetchImpl } = mockTransport(() => jsonResponse(200, payload));
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    return new OAuthFlow({ region: "us", storage, fetchImpl });
  }

  it("redacts token values but keeps field names when required fields are missing", async () => {
    // python: test_exchange_missing_fields_error_redacts_token_material
    const flow = flowWithPayload({
      access_token: "SECRET_AT",
      refresh_token: "SECRET_RT",
    });
    const error = await flow
      .exchangeCode("c", "v", "cid", "http://localhost:19284/callback")
      .then(
        () => null,
        (error_: unknown) => error_,
      );
    expect(error).toBeInstanceOf(OAuthError);
    const exc = error as OAuthError;
    expect(exc.code).toBe("OAUTH_TOKEN_ERROR");
    const serialized =
      String(exc) + JSON.stringify(exc.details) + JSON.stringify(exc.toDict());
    expect(serialized).not.toContain("SECRET_AT");
    expect(serialized).not.toContain("SECRET_RT");
    // Field names stay visible for diagnosis.
    const responseData = String(exc.details["response_data"]);
    expect(responseData).toContain("access_token");
    expect(responseData).toContain("refresh_token");
    expect(responseData).toContain("<redacted>");
  });

  it("keeps safe primitive fields visible and redacts unknown-key values", async () => {
    // python: test_safe_fields_stay_visible
    // Unknown-key values are redacted (a deny-list would keep `hint`
    // verbatim); key names stay visible.
    const flow = flowWithPayload({
      access_token: "SECRET_AT",
      scope: "projects analysis",
      token_type: "Bearer",
      hint: "weird-idp-extra",
    });
    const error = await flow
      .exchangeCode("c", "v", "cid", "http://localhost:19284/callback")
      .then(
        () => null,
        (error_: unknown) => error_,
      );
    expect(error).toBeInstanceOf(OAuthError);
    const responseData = String((error as OAuthError).details["response_data"]);
    expect(responseData).not.toContain("SECRET_AT");
    expect(responseData).toContain("projects analysis");
    expect(responseData).toContain("Bearer");
    expect(responseData).not.toContain("weird-idp-extra");
    expect(responseData).toContain("'hint': '<redacted>'");
  });

  it.each([
    {
      id: "nested-envelope",
      payload: { result: { access_token: "SECRET_NEST" } },
      secret: "SECRET_NEST",
      visibleKey: "result",
    },
    {
      id: "list-value",
      payload: { tokens: ["SECRET_L1"] },
      secret: "SECRET_L1",
      visibleKey: "tokens",
    },
    {
      id: "non-canonical-key",
      payload: { client_secret: "SECRET_CS" },
      secret: "SECRET_CS",
      visibleKey: "client_secret",
    },
    {
      id: "case-variant-key",
      payload: { Access_Token: "SECRET_UPPER" },
      secret: "SECRET_UPPER",
      visibleKey: "Access_Token",
    },
  ])(
    "redacts nested and non-canonical token material ($id)",
    async ({ payload, secret, visibleKey }) => {
      // python: test_nested_and_non_canonical_token_material_redacted
      // Envelope / non-canonical shapes leak nothing — allowlist redaction
      // closes every value channel.
      const flow = flowWithPayload(payload);
      const error = await flow
        .exchangeCode("c", "v", "cid", "http://localhost:19284/callback")
        .then(
          () => null,
          (error_: unknown) => error_,
        );
      expect(error).toBeInstanceOf(OAuthError);
      const exc = error as OAuthError;
      expect(exc.code).toBe("OAUTH_TOKEN_ERROR");
      const serialized =
        String(exc) +
        JSON.stringify(exc.details) +
        JSON.stringify(exc.toDict());
      expect(serialized).not.toContain(secret);
      const responseData = String(exc.details["response_data"]);
      expect(responseData).toContain(visibleKey);
      expect(responseData).toContain("<redacted>");
    },
  );

  it("renders kept primitive values byte-identical to Python str()", async () => {
    // python: test_safe_primitive_values_byte_exact
    // Locks pythonStr rendering of kept int/str values byte-identical to
    // the Python twin's `str()` output.
    const flow = flowWithPayload({
      expires_in: 3600,
      token_type: "Bearer",
      scope: "projects",
    });
    const error = await flow
      .exchangeCode("c", "v", "cid", "http://localhost:19284/callback")
      .then(
        () => null,
        (error_: unknown) => error_,
      );
    expect(error).toBeInstanceOf(OAuthError);
    expect((error as OAuthError).details["response_data"]).toBe(
      "{'expires_in': 3600, 'token_type': 'Bearer', 'scope': 'projects'}",
    );
  });

  it("redacts a container value under a safe key", async () => {
    // python: test_safe_key_with_container_value_redacted
    // Only primitive values survive under safe keys — a dict smuggled
    // under `scope` must not carry token material through.
    const flow = flowWithPayload({
      scope: { access_token: "SECRET_SC" },
    });
    const error = await flow
      .exchangeCode("c", "v", "cid", "http://localhost:19284/callback")
      .then(
        () => null,
        (error_: unknown) => error_,
      );
    expect(error).toBeInstanceOf(OAuthError);
    const exc = error as OAuthError;
    const serialized =
      String(exc) + JSON.stringify(exc.details) + JSON.stringify(exc.toDict());
    expect(serialized).not.toContain("SECRET_SC");
    expect(String(exc.details["response_data"])).toContain(
      "'scope': '<redacted>'",
    );
  });

  it("never embeds a non-JSON 200 body; keeps only content type and length", async () => {
    // python: test_exchange_non_json_200_body_not_embedded
    // A truncated token payload fails JSON parsing but still contains live
    // bearer material — never embedded; only content-type and code-point
    // length survive.
    const body = '{"access_token": "SECRET_TRUNC", "refr';
    const { fetchImpl } = mockTransport(
      () =>
        new Response(body, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    const flow = new OAuthFlow({ region: "us", storage, fetchImpl });
    const error = await flow
      .exchangeCode("c", "v", "cid", "http://localhost:19284/callback")
      .then(
        () => null,
        (error_: unknown) => error_,
      );
    expect(error).toBeInstanceOf(OAuthError);
    const exc = error as OAuthError;
    expect(exc.code).toBe("OAUTH_TOKEN_ERROR");
    const serialized =
      String(exc) + JSON.stringify(exc.details) + JSON.stringify(exc.toDict());
    expect(serialized).not.toContain("SECRET_TRUNC");
    expect(exc.details).not.toHaveProperty("response_body");
    expect(exc.details["content_type"]).toBe("application/json");
    expect(exc.details["body_length"]).toBe(cpLength(body));
  });

  // Non-object 200 JSON bodies are guarded with `isPlainRecord` on both
  // sides, and `response_data` is a fixed placeholder, never a verbatim
  // rendering — a bare JSON string body is the credential when an IdP
  // returns the token as a naked string.
  it.each([
    { id: "list", body: [1, 2] as unknown },
    { id: "str", body: "SECRET_BARE_STRING" },
    { id: "int", body: 42 },
    { id: "null", body: null },
  ])(
    "raises OAuthError with a fixed placeholder for a non-object 200 body ($id)",
    async ({ body }) => {
      // python: test_exchange_non_dict_200_body_raises_oauth_error
      const { fetchImpl } = mockTransport(() => jsonResponse(200, body));
      const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
      const flow = new OAuthFlow({ region: "us", storage, fetchImpl });
      const error = await flow
        .exchangeCode("c", "v", "cid", "http://localhost:19284/callback")
        .then(
          () => null,
          (error_: unknown) => error_,
        );
      expect(error).toBeInstanceOf(OAuthError);
      const exc = error as OAuthError;
      expect(exc.code).toBe("OAUTH_TOKEN_ERROR");
      const serialized =
        String(exc) +
        JSON.stringify(exc.details) +
        JSON.stringify(exc.toDict());
      expect(serialized).not.toContain("SECRET_BARE_STRING");
      expect(exc.details["response_data"]).toBe("<redacted non-object body>");
    },
  );

  it("still returns tokens on a well-formed response", async () => {
    // python: test_success_path_unchanged
    const flow = flowWithPayload(makeTokenResponse());
    const tokens = await flow.exchangeCode(
      "c",
      "v",
      "cid",
      "http://localhost:19284/callback",
    );
    expect(tokens.access_token.reveal()).toBe("access-tok-123");
  });
});

describe("OAuthFlow region URLs", () => {
  // python: test_auth_flow.py::TestOAuthFlowRegionUrls
  it("opens the eu.mixpanel.com authorize URL for region eu", async () => {
    // python: test_eu_region_authorize_url
    const { seams, openedUrls } = makeLoginSeams({
      clientInfo: makeClientInfo({ region: "eu" }),
      callbackCode: "c",
    });
    const { fetchImpl } = mockTransport(() =>
      jsonResponse(200, makeTokenResponse()),
    );
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    const flow = new OAuthFlow({ region: "eu", storage, fetchImpl, ...seams });

    await flow.login();

    expect(openedUrls).toHaveLength(1);
    expect(openedUrls[0] ?? "").toContain("eu.mixpanel.com");
  });
});

describe("OAuthFlow.exchangeCode network errors", () => {
  // python: test_auth_flow.py::TestOAuthFlowNetworkErrors
  // The refresh/timeout members live in `oauth-flow-refresh.test.ts`.

  it("wraps a transport timeout into OAUTH_TOKEN_ERROR", async () => {
    // python: test_exchange_code_timeout
    // The `httpx.TimeoutException` twin: a rejected fetch with a
    // DOMException the request adapter maps to MixpanelHttpError, which
    // the flow wraps into OAuthError.
    const fetchImpl = ((): Promise<Response> =>
      Promise.reject(
        new DOMException("test timeout", "TimeoutError"),
      )) as typeof fetch;
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    const flow = new OAuthFlow({ region: "us", storage, fetchImpl });

    const error = await flow
      .exchangeCode("c", "v", "cid", "http://localhost:19284/callback")
      .then(
        () => null,
        (error_: unknown) => error_,
      );
    expect(error).toBeInstanceOf(OAuthError);
    expect((error as OAuthError).code).toBe("OAUTH_TOKEN_ERROR");
  });

  it("wraps a connection failure into OAUTH_TOKEN_ERROR", async () => {
    // python: test_exchange_code_connection_error
    // The `httpx.ConnectError` twin: undici surfaces connection failures
    // as TypeError, mapped by the request adapter.
    const fetchImpl = ((): Promise<Response> =>
      Promise.reject(new TypeError("test connection error"))) as typeof fetch;
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    const flow = new OAuthFlow({ region: "us", storage, fetchImpl });

    const error = await flow
      .exchangeCode("c", "v", "cid", "http://localhost:19284/callback")
      .then(
        () => null,
        (error_: unknown) => error_,
      );
    expect(error).toBeInstanceOf(OAuthError);
    expect((error as OAuthError).code).toBe("OAUTH_TOKEN_ERROR");
  });

  it("wraps a non-JSON response into OAUTH_TOKEN_ERROR", async () => {
    // python: test_exchange_code_non_json_response
    const { fetchImpl } = mockTransport(
      () =>
        new Response("<html>error</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    );
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    const flow = new OAuthFlow({ region: "us", storage, fetchImpl });

    const error = await flow
      .exchangeCode("c", "v", "cid", "http://localhost:19284/callback")
      .then(
        () => null,
        (error_: unknown) => error_,
      );
    expect(error).toBeInstanceOf(OAuthError);
    expect((error as OAuthError).code).toBe("OAUTH_TOKEN_ERROR");
  });

  it("wraps a response without access_token into OAUTH_TOKEN_ERROR", async () => {
    // python: test_exchange_code_missing_access_token_in_response
    const { fetchImpl } = mockTransport(() =>
      jsonResponse(200, { scope: "x" }),
    );
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    const flow = new OAuthFlow({ region: "us", storage, fetchImpl });

    const error = await flow
      .exchangeCode("c", "v", "cid", "http://localhost:19284/callback")
      .then(
        () => null,
        (error_: unknown) => error_,
      );
    expect(error).toBeInstanceOf(OAuthError);
    expect((error as OAuthError).code).toBe("OAUTH_TOKEN_ERROR");
  });
});
