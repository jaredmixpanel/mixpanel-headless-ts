// startCallbackServer and CallbackResult over real 127.0.0.1 binds. Mirrors
// tests/unit/test_auth_callback.py; only the two port-scan cases bind the
// fixed ports (the scan is what they test), every other case binds port 0
// and reads the bound port back. Additive: ephemeral-port reporting, stray
// GET handling and the received_state-only error details.

import { createServer, type Server } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { CallbackResult, OAuthError } from "@mixpanel-headless/core";

import {
  CALLBACK_PORTS,
  startCallbackServer,
} from "../src/auth/callback-server.js";

const cleanups: Array<() => void> = [];

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
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error(`callback server never came up: ${String(lastError)}`);
}

/**
 * Start the callback server on an ephemeral port (`port: 0`) and hand
 * back both the pending result promise and the port actually bound.
 *
 * @param options - `state` / `timeoutSeconds` for the server.
 * @returns The server promise plus the bound port.
 */
async function startEphemeral(options: {
  readonly state: string;
  readonly timeoutSeconds?: number;
}): Promise<{
  readonly serverPromise: Promise<readonly [CallbackResult, number]>;
  readonly port: number;
}> {
  let announce: (port: number) => void = () => undefined;
  const bound = new Promise<number>((resolve) => {
    announce = resolve;
  });
  const serverPromise = startCallbackServer({
    state: options.state,
    timeoutSeconds: options.timeoutSeconds ?? 10,
    port: 0,
    onListening: (boundPort) => {
      announce(boundPort);
    },
  });
  // Surface a bind failure instead of hanging on `bound`.
  const port = await Promise.race([
    bound,
    serverPromise.then(() => {
      throw new Error("callback server settled before it was bound");
    }),
  ]);
  return { serverPromise, port };
}

describe("CallbackResult", () => {
  // python: test_auth_callback.py::TestCallbackResult
  it("exposes code and state", () => {
    // python: test_fields_accessible
    const result = new CallbackResult({ code: "abc123", state: "xyz789" });
    expect(result.code).toBe("abc123");
    expect(result.state).toBe("xyz789");
  });

  it("is frozen", () => {
    // python: test_frozen
    // Python `FrozenInstanceError` (an AttributeError) -> assignment to
    // a frozen instance throws TypeError in strict-mode ESM.
    const result = new CallbackResult({ code: "abc", state: "def" });
    expect(() => {
      (result as { code: string }).code = "new";
    }).toThrow(TypeError);
  });
});

describe("startCallbackServer", () => {
  // python: test_auth_callback.py::TestStartCallbackServer
  it("resolves with the code and state from the query string", async () => {
    // python: test_returns_code_and_state_from_query_params
    const state = "test-state-123";
    const { serverPromise, port } = await startEphemeral({ state });

    const resp = await getWithRetry(
      `http://localhost:${port}/callback?code=auth-code-456&state=${state}`,
    );

    const [cbResult, boundPort] = await serverPromise;
    expect(cbResult.code).toBe("auth-code-456");
    expect(cbResult.state).toBe(state);
    expect(boundPort).toBe(port);
    expect(resp.status).toBe(200);
  });

  it("port 0 binds an ephemeral port and reports the bound port, not 0", async () => {
    const state = "ephemeral-port";
    const { serverPromise, port } = await startEphemeral({ state });
    expect(port).not.toBe(0);
    expect(CALLBACK_PORTS).not.toContain(port);

    await getWithRetry(
      `http://localhost:${port}/callback?code=c&state=${state}`,
    );

    const [, boundPort] = await serverPromise;
    expect(boundPort).toBe(port);
  });

  it("answers the browser with an HTML success page", async () => {
    // python: test_html_response_sent_to_browser
    const state = "html-test";
    const { serverPromise, port } = await startEphemeral({ state });

    const resp = await getWithRetry(
      `http://localhost:${port}/callback?code=code1&state=${state}`,
    );

    await serverPromise;
    expect(resp.headers.get("content-type") ?? "").toContain("text/html");
    const text = (await resp.text()).toLowerCase();
    expect(text.includes("success") || text.includes("authorized")).toBe(true);
  });

  it("rejects with OAuthError on a state mismatch", async () => {
    // python: test_state_mismatch_raises_oauth_error
    const { serverPromise, port } = await startEphemeral({
      state: "expected-state",
    });
    const settled = serverPromise.then(
      () => null,
      (error_: unknown) => error_,
    );

    await getWithRetry(
      `http://localhost:${port}/callback?code=code1&state=wrong-state`,
    );

    const error = await settled;
    expect(error).toBeInstanceOf(OAuthError);
    expect(String(error).toLowerCase()).toContain("state");
  });

  it("rejects with OAuthError when the provider sends error=", async () => {
    // python: test_error_param_raises_oauth_error
    const { serverPromise, port } = await startEphemeral({
      state: "error-test",
    });
    const settled = serverPromise.then(
      () => null,
      (error_: unknown) => error_,
    );

    await getWithRetry(
      `http://localhost:${port}/callback?error=access_denied` +
        "&error_description=User+denied+access",
    );

    const error = await settled;
    expect(error).toBeInstanceOf(OAuthError);
    expect(String(error)).toContain("access_denied");
  });

  it("rejects with OAUTH_TIMEOUT when no callback arrives", async () => {
    // python: test_timeout_raises_oauth_error
    const serverPromise = startCallbackServer({
      state: "timeout-test",
      timeoutSeconds: 0.5,
      port: 0,
    });

    const error = await serverPromise.then(
      () => null,
      (error_: unknown) => error_,
    );
    expect(error).toBeInstanceOf(OAuthError);
    expect((error as OAuthError).code).toBe("OAUTH_TIMEOUT");
  });

  it("falls back to the next port when the first is busy", async () => {
    // python: test_tries_next_port_when_first_is_busy
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

  it("rejects with OAUTH_PORT_ERROR listing the ports when all are busy", async () => {
    // python: test_all_ports_busy_raises_oauth_error
    for (const port of [19284, 19285, 19286, 19287]) {
      await occupyPort(port);
    }

    const error = await startCallbackServer({
      state: "all-busy",
      timeoutSeconds: 5,
    }).then(
      () => null,
      (error_: unknown) => error_,
    );
    expect(error).toBeInstanceOf(OAuthError);
    expect((error as OAuthError).code).toBe("OAUTH_PORT_ERROR");
    expect((error as OAuthError).details).toStrictEqual({
      ports: [...CALLBACK_PORTS],
    });
  });

  it("answers 404 to a stray GET without consuming the one-shot, then accepts /callback", async () => {
    const state = "stray-get";
    const { serverPromise, port } = await startEphemeral({ state });

    const stray = await getWithRetry(`http://localhost:${port}/favicon.ico`);
    expect(stray.status).toBe(404);
    const root = await getWithRetry(`http://localhost:${port}/`);
    expect(root.status).toBe(404);

    const resp = await getWithRetry(
      `http://localhost:${port}/callback?code=after-stray&state=${state}`,
    );
    expect(resp.status).toBe(200);
    const [cbResult, boundPort] = await serverPromise;
    expect(cbResult.code).toBe("after-stray");
    expect(boundPort).toBe(port);
  });

  it("serves the callback at localhost while binding 127.0.0.1", async () => {
    // python: test_redirect_uri_uses_localhost
    // OAuth providers require consistent redirect URIs: `localhost` in
    // the redirect URI while binding 127.0.0.1.
    const state = "localhost-test";
    const { serverPromise, port } = await startEphemeral({ state });

    const resp = await getWithRetry(
      `http://localhost:${port}/callback?code=local-code&state=${state}`,
    );

    const [cbResult] = await serverPromise;
    expect(cbResult.code).toBe("local-code");
    expect(resp.status).toBe(200);
  });
});

describe("callback HTML security", () => {
  // python: test_auth_callback.py::TestCallbackHtmlSecurity
  it("keeps the expected state out of the mismatch page", async () => {
    // python: test_state_mismatch_does_not_leak_expected_state
    const state = "secret-csrf-state-12345";
    const { serverPromise, port } = await startEphemeral({ state });
    const settled = serverPromise.then(
      () => null,
      (error: unknown) => error,
    );

    const resp = await getWithRetry(
      `http://localhost:${port}/callback?code=code1&state=wrong-state`,
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

  it("state mismatch error details carry received_state but never expected_state", async () => {
    const state = "secret-csrf-state-67890";
    const { serverPromise, port } = await startEphemeral({ state });
    const settled = serverPromise.then(
      () => null,
      (error: unknown) => error,
    );

    await getWithRetry(
      `http://localhost:${port}/callback?code=code1&state=wrong-state`,
    );

    const rejection = await settled;
    expect(rejection).toBeInstanceOf(OAuthError);
    const details = (rejection as OAuthError).details;
    expect(details).toStrictEqual({ received_state: "wrong-state" });
    expect(details).not.toHaveProperty("expected_state");
    // The serialized form hosts log must not carry the nonce either.
    expect(JSON.stringify((rejection as OAuthError).toDict())).not.toContain(
      state,
    );
  });

  it("HTML-escapes the provider's error_description", async () => {
    // python: test_provider_error_description_is_html_escaped
    const { serverPromise, port } = await startEphemeral({
      state: "escape-test",
    });
    const settled = serverPromise.then(
      () => null,
      (error: unknown) => error,
    );

    const xssPayload = encodeURIComponent('<script>alert("xss")</script>');
    const resp = await getWithRetry(
      `http://localhost:${port}/callback?error=server_error` +
        `&error_description=${xssPayload}`,
    );

    await settled;
    const htmlBody = await resp.text();
    // Raw script tag must NOT appear in HTML — it should be escaped.
    expect(htmlBody).not.toContain("<script>");
    expect(htmlBody).toContain("&lt;script&gt;");
  });
});
