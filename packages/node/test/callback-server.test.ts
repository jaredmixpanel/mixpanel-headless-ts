// Layer-3 translation of `tests/unit/test_auth_callback.py`
// (b8-packets.md §4.3 row 3): `TestCallbackResult` (:33),
// `TestStartCallbackServer` (:49), `TestCallbackHtmlSecurity` (:281) —
// all 12 tests. Real 127.0.0.1 binds on the fixed ports exactly as
// Python does (packet §7 caution 17 — a local bind, not network); the
// port-conflict cases occupy 19284 first and assert fallback.
//
// Python's background-thread + `httpx.get` fixture translates to the
// returned promise + a global-`fetch` GET with a short bind-retry loop
// (the `time.sleep(0.3)` "give the server time to bind" twin).

import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { OAuthError } from "@mixpanel-headless/core";
import {
  CALLBACK_PORTS,
  CallbackResult,
  startCallbackServer,
} from "../src/auth/callback-server.js";

const cleanups: (() => void)[] = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

/**
 * Occupy a port with a bare TCP listener (the `socket.bind` +
 * `listen(1)` fixture twin).
 *
 * @param port - Port to squat on 127.0.0.1.
 * @returns The listening server (closed via `cleanups`).
 */
async function occupyPort(port: number): Promise<Server> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      resolve();
    });
  });
  cleanups.push(() => {
    server.close();
  });
  return server;
}

/**
 * GET a callback URL, retrying until the server accepts (bind-wait).
 *
 * @param url - Full URL including query string.
 * @returns The HTTP response.
 */
async function getWithRetry(url: string): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return await fetch(url);
    } catch (exc) {
      lastError = exc;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error(`callback server never came up: ${String(lastError)}`);
}

describe("TestCallbackResult (test_auth_callback.py:33)", () => {
  it("test_fields_accessible", () => {
    const result = new CallbackResult({ code: "abc123", state: "xyz789" });
    expect(result.code).toBe("abc123");
    expect(result.state).toBe("xyz789");
  });

  it("test_frozen", () => {
    // Python `FrozenInstanceError` (an AttributeError) -> assignment to
    // a frozen instance throws TypeError in strict-mode ESM.
    const result = new CallbackResult({ code: "abc", state: "def" });
    expect(() => {
      (result as { code: string }).code = "new";
    }).toThrow(TypeError);
  });
});

describe("TestStartCallbackServer (test_auth_callback.py:49)", () => {
  it("test_returns_code_and_state_from_query_params", async () => {
    const state = "test-state-123";
    const serverPromise = startCallbackServer({ state, timeoutSeconds: 10 });

    const resp = await getWithRetry(
      `http://localhost:19284/callback?code=auth-code-456&state=${state}`,
    );

    const [cbResult, port] = await serverPromise;
    expect(cbResult.code).toBe("auth-code-456");
    expect(cbResult.state).toBe(state);
    expect(port).toBe(19284);
    expect(resp.status).toBe(200);
  });

  it("test_html_response_sent_to_browser", async () => {
    const state = "html-test";
    const serverPromise = startCallbackServer({ state, timeoutSeconds: 10 });

    const resp = await getWithRetry(
      `http://localhost:19284/callback?code=code1&state=${state}`,
    );

    await serverPromise;
    expect(resp.headers.get("content-type") ?? "").toContain("text/html");
    const text = (await resp.text()).toLowerCase();
    expect(text.includes("success") || text.includes("authorized")).toBe(true);
  });

  it("test_state_mismatch_raises_oauth_error", async () => {
    const serverPromise = startCallbackServer({
      state: "expected-state",
      timeoutSeconds: 10,
    });
    const settled = serverPromise.then(
      () => null,
      (exc: unknown) => exc,
    );

    await getWithRetry(
      "http://localhost:19284/callback?code=code1&state=wrong-state",
    );

    const error = await settled;
    expect(error).toBeInstanceOf(OAuthError);
    expect(String(error).toLowerCase()).toContain("state");
  });

  it("test_error_param_raises_oauth_error", async () => {
    const serverPromise = startCallbackServer({
      state: "error-test",
      timeoutSeconds: 10,
    });
    const settled = serverPromise.then(
      () => null,
      (exc: unknown) => exc,
    );

    await getWithRetry(
      "http://localhost:19284/callback?error=access_denied" +
        "&error_description=User+denied+access",
    );

    const error = await settled;
    expect(error).toBeInstanceOf(OAuthError);
    expect(String(error)).toContain("access_denied");
  });

  it("test_timeout_raises_oauth_error", async () => {
    const serverPromise = startCallbackServer({
      state: "timeout-test",
      timeoutSeconds: 0.5,
    });

    const error = await serverPromise.then(
      () => null,
      (exc: unknown) => exc,
    );
    expect(error).toBeInstanceOf(OAuthError);
    expect((error as OAuthError).code).toBe("OAUTH_TIMEOUT");
  });

  it("test_tries_next_port_when_first_is_busy", async () => {
    await occupyPort(19284);

    const state = "port-fallback";
    const serverPromise = startCallbackServer({ state, timeoutSeconds: 10 });

    // Must be on port 19285 since 19284 is occupied.
    await getWithRetry(
      `http://localhost:19285/callback?code=fallback-code&state=${state}`,
    );

    const [cbResult, port] = await serverPromise;
    expect(port).toBe(19285);
    expect(cbResult.code).toBe("fallback-code");
  });

  it("test_all_ports_busy_raises_oauth_error", async () => {
    for (const port of [19284, 19285, 19286, 19287]) {
      await occupyPort(port);
    }

    const error = await startCallbackServer({
      state: "all-busy",
      timeoutSeconds: 5,
    }).then(
      () => null,
      (exc: unknown) => exc,
    );
    expect(error).toBeInstanceOf(OAuthError);
    expect((error as OAuthError).code).toBe("OAUTH_PORT_ERROR");
    expect((error as OAuthError).details).toEqual({
      ports: [...CALLBACK_PORTS],
    });
  });

  it("test_redirect_uri_uses_localhost", async () => {
    // OAuth providers require consistent redirect URIs: `localhost` in
    // the redirect URI while binding 127.0.0.1.
    const state = "localhost-test";
    const serverPromise = startCallbackServer({ state, timeoutSeconds: 10 });

    const resp = await getWithRetry(
      `http://localhost:19284/callback?code=local-code&state=${state}`,
    );

    const [cbResult] = await serverPromise;
    expect(cbResult.code).toBe("local-code");
    expect(resp.status).toBe(200);
  });
});

describe("TestCallbackHtmlSecurity (test_auth_callback.py:281)", () => {
  it("test_state_mismatch_does_not_leak_expected_state", async () => {
    const state = "secret-csrf-state-12345";
    const serverPromise = startCallbackServer({ state, timeoutSeconds: 10 });
    const settled = serverPromise.then(
      () => null,
      (exc: unknown) => exc,
    );

    const resp = await getWithRetry(
      "http://localhost:19284/callback?code=code1&state=wrong-state",
    );

    await settled;
    const htmlBody = await resp.text();
    // The expected state must NOT appear in the browser HTML.
    expect(htmlBody).not.toContain(state);
    // But the error page should still indicate a failure.
    expect(
      htmlBody.includes("Authorization") || htmlBody.includes("mismatch"),
    ).toBe(true);
  });

  it("test_provider_error_description_is_html_escaped", async () => {
    const serverPromise = startCallbackServer({
      state: "escape-test",
      timeoutSeconds: 10,
    });
    const settled = serverPromise.then(
      () => null,
      (exc: unknown) => exc,
    );

    const xssPayload = encodeURIComponent('<script>alert("xss")</script>');
    const resp = await getWithRetry(
      "http://localhost:19284/callback?error=server_error" +
        `&error_description=${xssPayload}`,
    );

    await settled;
    const htmlBody = await resp.text();
    // Raw script tag must NOT appear in HTML — it should be escaped.
    expect(htmlBody).not.toContain("<script>");
    expect(htmlBody).toContain("&lt;script&gt;");
  });
});
