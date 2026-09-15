// Layer-3 translation of `tests/unit/test_auth_callback.py`
// (b8-packets.md §4.3 row 3): `TestCallbackResult`,
// `TestStartCallbackServer`, `TestCallbackHtmlSecurity` —
// all 12 tests. Real 127.0.0.1 binds (packet §7 caution 17 — a local
// bind, not network). Python binds the fixed ports throughout; here
// only the two port-SCAN cases do (they occupy 19284… first and assert
// fallback / exhaustion — the scan is the behaviour under test). Every
// other case binds `port: 0` and reads the bound port back through the
// TS-only `onListening` seam (plan 7.4), so parallel vitest workers and
// a developer's own `mp login` cannot collide with this suite.
//
// Python's background-thread + `httpx.get` fixture translates to the
// returned promise + a global-`fetch` GET with a short bind-retry loop
// (the `time.sleep(0.3)` "give the server time to bind" twin).

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

  it("port 0 binds an ephemeral port and reports the bound port, not 0 (plan 7.4)", async () => {
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

  it("test_html_response_sent_to_browser", async () => {
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

  it("test_state_mismatch_raises_oauth_error", async () => {
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

  it("test_error_param_raises_oauth_error", async () => {
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

  it("test_timeout_raises_oauth_error", async () => {
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
      (error_: unknown) => error_,
    );
    expect(error).toBeInstanceOf(OAuthError);
    expect((error as OAuthError).code).toBe("OAUTH_PORT_ERROR");
    expect((error as OAuthError).details).toStrictEqual({
      ports: [...CALLBACK_PORTS],
    });
  });

  it("answers 404 to a stray GET without consuming the one-shot, then accepts /callback (CLEANUP-PLAN 8.2)", async () => {
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

  it("test_redirect_uri_uses_localhost", async () => {
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

describe("TestCallbackHtmlSecurity (test_auth_callback.py:281)", () => {
  it("test_state_mismatch_does_not_leak_expected_state", async () => {
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

  it("state mismatch error details carry received_state but never expected_state (CLEANUP-PLAN 8.3)", async () => {
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
    // The serialised form hosts log must not carry the nonce either.
    expect(JSON.stringify((rejection as OAuthError).toDict())).not.toContain(
      state,
    );
  });

  it("test_provider_error_description_is_html_escaped", async () => {
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
