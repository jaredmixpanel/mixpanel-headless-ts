// Layer-3 translation of the LOGIN classes of
// `tests/unit/test_auth_flow.py` (b8-packets.md §4.3 row 4):
// `TestOAuthFlowLogin` (:88), `TestParsePastedRedirect` (:215),
// `TestOAuthFlowPasteFallback` (:286), `TestOAuthFlowTokenExchange`
// (:385), `TestOAuthFlowRegionUrls` (:759), and the EXCHANGE-op
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

import { OAuthError } from "../../core/src/errors.js";
import { CallbackResult } from "../src/auth/callback-server.js";
import { OAuthFlow, parsePastedRedirect } from "../src/auth/flow.js";
import type { OAuthClientInfo } from "../../core/src/auth/token.js";
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
      url: String(input),
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
        (exc: unknown) => exc,
      );
    expect(error).toBeInstanceOf(OAuthError);
    // `invalid_grant` maps to REVOKED only for the refresh operation
    // (packet §7 caution 6) — exchange keeps the generic code.
    expect((error as OAuthError).code).toBe("OAUTH_TOKEN_ERROR");
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
        (exc: unknown) => exc,
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
        (exc: unknown) => exc,
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
        (exc: unknown) => exc,
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
        (exc: unknown) => exc,
      );
    expect(error).toBeInstanceOf(OAuthError);
    expect((error as OAuthError).code).toBe("OAUTH_TOKEN_ERROR");
  });
});
