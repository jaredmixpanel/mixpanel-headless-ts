// Layer-3 translation of the LOGIN classes of
// `tests/unit/test_auth_flow.py` (b8-packets.md §4.3 row 4):
// `TestOAuthFlowLogin` (:88), `TestParsePastedRedirect` (:215),
// `TestOAuthFlowPasteFallback` (:286), `TestOAuthFlowTokenExchange`
// (:385), the EXCHANGE members of `TestTokenPayloadRedaction` (FIX-2,
// bug (d) — refresh member split into `oauth-flow-refresh.test.ts`),
// `TestOAuthFlowRegionUrls` (:759), and the EXCHANGE-op
// members of `TestOAuthFlowNetworkErrors` (:802 — the refresh/timeout
// members were N2's, header-cited split in
// `oauth-flow-refresh.test.ts`).
//
// Python's `@patch("...flow.webbrowser")` / `flow.start_callback_server`
// / `flow.ensure_client_registered` module monkeypatches translate to
// the injected `OAuthFlowOptions` seams (`openBrowser`,
// `startCallbackServer`, `registerClient` — packet §4.2 "browser
// opening is an injected effect"). `findAvailablePort` is additionally
// stubbed to `19284` here: Python probes real ports in these tests,
// but the probe result is never asserted, and the fixed stub keeps
// this file free of port contention with the REAL binds in
// `callback-server.test.ts` running in a parallel worker (disclosed in
// the shard notes).

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type OAuthClientInfo, OAuthError } from "@mixpanel-headless/core";

import { CallbackResult } from "../src/auth/callback-server.js";
import {
  browserLaunchArgv,
  OAuthFlow,
  parsePastedRedirect,
} from "../src/auth/flow.js";
import { OAuthStorage } from "../src/auth/storage.js";
import { makeTempDir, scrubMpEnv } from "./helpers.js";

const cleanups: Array<() => void> = [];
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

/** The `_make_client_info` fixture twin (test_auth_flow.py:63). */
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
  return new Response(JSON.stringify(body), {
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

describe("TestOAuthFlowLogin (test_auth_flow.py:88)", () => {
  it("test_full_login_sequence", async () => {
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

  it("test_handles_missing_refresh_token", async () => {
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

  it("test_open_browser_false_skips_webbrowser_and_prints_url", async () => {
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
describe("browser launch argv (CLEANUP-PLAN 8.1)", () => {
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

describe("TestParsePastedRedirect (test_auth_flow.py:215)", () => {
  it("test_full_redirect_url", () => {
    const result = parsePastedRedirect(
      "http://localhost:19284/callback?code=ABC&state=XYZ",
      { expectedState: "XYZ" },
    );
    expect(result.code).toBe("ABC");
    expect(result.state).toBe("XYZ");
  });

  it("test_query_string_only", () => {
    const result = parsePastedRedirect("code=ABC&state=XYZ", {
      expectedState: "XYZ",
    });
    expect(result.code).toBe("ABC");
  });

  it("test_query_string_with_leading_question_mark", () => {
    const result = parsePastedRedirect("?code=ABC&state=XYZ", {
      expectedState: "XYZ",
    });
    expect(result.code).toBe("ABC");
  });

  it("test_whitespace_is_stripped", () => {
    const result = parsePastedRedirect(
      "  http://localhost:19284/callback?code=ABC&state=XYZ\n",
      { expectedState: "XYZ" },
    );
    expect(result.code).toBe("ABC");
  });

  it("test_empty_paste_raises", () => {
    expect(() =>
      parsePastedRedirect("   \n", { expectedState: "XYZ" }),
    ).toThrowError(/Empty paste/);
  });

  it("test_state_mismatch_raises", () => {
    // CSRF: without this check a hostile party could trick the user
    // into pasting an attacker-generated code.
    expect(() =>
      parsePastedRedirect("code=ABC&state=ATTACKER", { expectedState: "XYZ" }),
    ).toThrowError(/State mismatch/);
  });

  it("test_missing_code_raises", () => {
    expect(() =>
      parsePastedRedirect("state=XYZ", { expectedState: "XYZ" }),
    ).toThrowError(/missing `code` or `state`/);
  });

  it("test_missing_state_raises", () => {
    expect(() =>
      parsePastedRedirect("code=ABC", { expectedState: "XYZ" }),
    ).toThrowError(/missing `code` or `state`/);
  });

  it("test_oauth_error_param_surfaces", () => {
    expect(() =>
      parsePastedRedirect(
        "http://localhost:19284/callback?error=access_denied&state=XYZ",
        { expectedState: "XYZ" },
      ),
    ).toThrowError(/access_denied/);
  });

  it("test_oauth_error_with_description_includes_description", () => {
    expect(() =>
      parsePastedRedirect(
        "?error=access_denied&error_description=user+cancelled&state=XYZ",
        { expectedState: "XYZ" },
      ),
    ).toThrowError(/user cancelled/);
  });
});

describe("TestOAuthFlowPasteFallback (test_auth_flow.py:286)", () => {
  it("test_paste_fallback_succeeds_when_callback_blocked", async () => {
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

describe("TestOAuthFlowTokenExchange (test_auth_flow.py:385)", () => {
  it("test_exchange_posts_correct_form_params", async () => {
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

  it("test_exchange_uses_correct_url_for_region", async () => {
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

  it("test_exchange_error_raises_oauth_error", async () => {
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
    // `invalid_grant` maps to REVOKED only for the refresh operation
    // (packet §7 caution 6) — exchange keeps the generic code.
    expect((error as OAuthError).code).toBe("OAUTH_TOKEN_ERROR");
  });
});

describe("TestTokenPayloadRedaction — exchange members (test_auth_flow.py::TestTokenPayloadRedaction)", () => {
  // Twin of the Python FIX-2 suite (fix-of-record:
  // context/phase3/bug-reports/python-oauth-error-details-token-payload.md):
  // a malformed-200 token response must not leak token material into
  // OAuthError details. The refresh member lives in
  // `oauth-flow-refresh.test.ts` (header-cited split, same as the
  // network-error classes).

  /** Build an OAuthFlow whose token endpoint 200s with `payload`. */
  function flowWithPayload(payload: Record<string, unknown>): OAuthFlow {
    const { fetchImpl } = mockTransport(() => jsonResponse(200, payload));
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    return new OAuthFlow({ region: "us", storage, fetchImpl });
  }

  it("test_exchange_missing_fields_error_redacts_token_material", async () => {
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

  it("test_safe_fields_stay_visible", async () => {
    // ARB-B F-B2/E-1 flip: unknown-key VALUES are now redacted (the old
    // deny-list kept `hint` verbatim); key names stay visible.
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
    "test_nested_and_non_canonical_token_material_redacted[$id]",
    async ({ payload, secret, visibleKey }) => {
      // ARB-B F-B2/E-1: envelope / non-canonical shapes leak nothing —
      // allowlist redaction closes every value channel (Python twin:
      // TestTokenPayloadRedaction::
      // test_nested_and_non_canonical_token_material_redacted).
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

  it("test_safe_primitive_values_byte_exact", async () => {
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

  it("test_safe_key_with_container_value_redacted", async () => {
    // ARB-B F-B2: only PRIMITIVE values survive under safe keys — a dict
    // smuggled under `scope` must not carry token material through.
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

  it("test_exchange_non_json_200_body_not_embedded", async () => {
    // ARB-B F-B1: a truncated token payload fails JSON parsing but still
    // contains live bearer material — never embedded; only content-type
    // and code-point length survive.
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
    expect(exc.details["body_length"]).toBe(Array.from(body).length);
  });

  // ARB-A F1 (pair-A fidelity review): the Python bug-(d) redaction fix
  // initially crashed with an uncoded AttributeError on non-dict 200
  // JSON bodies while this side already guarded with `isPlainRecord`.
  // Python now mirrors the guard; ARB-B F-B3 hardened the shared
  // behavior: `response_data` is a fixed placeholder, never a verbatim
  // rendering — a bare JSON string body IS the credential when an IdP
  // returns the token as a naked string (Python twin:
  // TestTokenPayloadRedaction::
  // test_exchange_non_dict_200_body_raises_oauth_error).
  it.each([
    { id: "list", body: [1, 2] as unknown },
    { id: "str", body: "SECRET_BARE_STRING" },
    { id: "int", body: 42 },
    { id: "null", body: null },
  ])(
    "test_exchange_non_dict_200_body_raises_oauth_error[$id]",
    async ({ body }) => {
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

  it("test_success_path_unchanged", async () => {
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

describe("TestOAuthFlowRegionUrls (test_auth_flow.py:759)", () => {
  it("test_eu_region_authorize_url", async () => {
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

describe("TestOAuthFlowNetworkErrors — exchange-op members (test_auth_flow.py:802)", () => {
  // The refresh/timeout members live in `oauth-flow-refresh.test.ts`
  // (N2 — header-cited split, b8-packets.md §4.3 row 4).

  it("test_exchange_code_timeout", async () => {
    // The `httpx.TimeoutException` twin (N2 convention): a rejected
    // fetch with a DOMException the R2.10 adapter maps to
    // MixpanelHttpError, which the flow wraps into OAuthError.
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

  it("test_exchange_code_connection_error", async () => {
    // The `httpx.ConnectError` twin: undici surfaces connection
    // failures as TypeError, mapped by the R2.10 adapter.
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

  it("test_exchange_code_non_json_response", async () => {
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

  it("test_exchange_code_missing_access_token_in_response", async () => {
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
