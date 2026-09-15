/**
 * OAuth callback server — TS port of
 * `mixpanel_headless/_internal/auth/callback_server.py` (whole file,
 * b8-packets.md §4.1 row 3) over `node:http`.
 *
 * Binds `127.0.0.1` on the first available port in
 * `[19284, 19285, 19286, 19287]` (or the exact `port` the caller
 * already probed — `flow.py`'s two-phase probe-then-bind, packet §7
 * caution 14: the TOCTOU between probe and bind is Python's own,
 * ported verbatim) and waits for a SINGLE request — the
 * `server.handle_request()` one-shot semantics (`callback_server.py:161`):
 * the first `GET /callback` is the one request, the browser gets an
 * HTML page, and the server closes. A GET to any other path is answered
 * 404 and does NOT consume the one-shot (Python's does — a recorded
 * divergence; see the note at the request listener).
 *
 * Async substitution (documented): Python's blocking
 * `start_callback_server` returns `(CallbackResult, port)`; the node
 * twin is async and resolves the same tuple. A TS-only `signal` option
 * cancels a LOSING completer in `OAuthFlow.login` — Python leaks the
 * daemon thread instead (dies with the process); node must release the
 * socket or the event loop never drains.
 */

import { createServer, type Server, type ServerResponse } from "node:http";

import { CallbackResult, OAuthError } from "@mixpanel-headless/core";
import { parseQs } from "@mixpanel-headless/core/internal";

/** Ports to attempt binding to, in order (`callback_server.py`). */
export const CALLBACK_PORTS: readonly number[] = [19284, 19285, 19286, 19287];

/** Success page (`_SUCCESS_HTML`, `callback_server.py`, verbatim). */
const SUCCESS_HTML = `<!DOCTYPE html>
<html>
<head><title>Authorization Successful</title></head>
<body style="font-family: sans-serif; text-align: center; padding: 2em;">
<h1>&#10004; Successfully Authorized</h1>
<p>You can close this browser tab and return to the terminal.</p>
</body>
</html>`;

/**
 * Render the error page (`_ERROR_HTML.format(message=...)`,
 * `callback_server.py`).
 *
 * @param message - The ALREADY-ESCAPED message text.
 * @returns The full HTML document.
 */
function errorHtml(message: string): string {
  return `<!DOCTYPE html>
<html>
<head><title>Authorization Error</title></head>
<body style="font-family: sans-serif; text-align: center; padding: 2em;">
<h1>&#10008; Authorization Error</h1>
<p>${message}</p>
<p>Please close this tab and try again.</p>
</body>
</html>`;
}

/**
 * Python `html.escape(s)` twin (default `quote=True`): `&`, `<`, `>`,
 * `"` and `'` — the XSS surface lock (`callback_server.py`,
 * `TestCallbackHtmlSecurity`; packet §7 caution 13).
 *
 * @param text - Provider-supplied text to interpolate into HTML.
 * @returns The escaped text.
 */
function htmlEscape(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
}

/** Options bag of {@link startCallbackServer} (`callback_server.py`). */
export interface StartCallbackServerOptions {
  /** The expected state parameter for CSRF validation. */
  readonly state: string;
  /** Maximum seconds to wait for the callback (default 300). */
  readonly timeoutSeconds?: number | undefined;
  /**
   * Specific port to bind (no scanning) — the caller already probed
   * it. `null`/absent scans 19284-19287 in order. `0` binds an
   * ephemeral port; the resolved tuple (and {@link onListening}) carry
   * the port actually bound, never the requested `0`.
   */
  readonly port?: number | null | undefined;
  /**
   * TS-only: invoked once the socket is bound, with the port actually
   * bound. Lets a caller that passed `port: 0` learn the port before
   * the callback arrives (the tuple only resolves afterwards).
   */
  readonly onListening?: ((port: number) => void) | undefined;
  /**
   * TS-only cancellation for the losing login completer (module
   * header). On abort the server closes and the promise rejects with a
   * plain `Error` (never an `OAuthError` — the canceller discards it).
   */
  readonly signal?: AbortSignal | undefined;
}

/** One request's disposition (the `_handler_state` dict twin). */
interface HandlerOutcome {
  readonly result?: CallbackResult;
  readonly error?: OAuthError;
}

/**
 * Send an HTML response (`_send_html`, `callback_server.py`).
 *
 * @param res - The response to write.
 * @param html - HTML content.
 * @param status - HTTP status code.
 * @returns A promise resolving once the response has flushed.
 */
function sendHtml(
  res: ServerResponse,
  html: string,
  status: number,
): Promise<void> {
  const body = Buffer.from(html, "utf8");
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": String(body.length),
    // One-shot server: close the connection gracefully after the
    // response flushes so `server.close()` completes without
    // destroying in-flight data (node-runtime substitute for Python's
    // per-request `HTTPServer` teardown).
    Connection: "close",
  });
  return new Promise((resolve) => {
    res.end(body, () => {
      resolve();
    });
  });
}

/**
 * Process the single callback request (`_CallbackHandler.do_GET`,
 * `callback_server.py`): provider `error=` param, missing
 * `code`/`state`, state mismatch (CSRF), success — each answers the
 * browser (escaped HTML) and yields the server-side outcome. The path
 * is checked by the request listener (only `/callback` reaches here);
 * this function reads the query only, like Python's `do_GET`.
 *
 * @param url - The raw request URL (path + query).
 * @param expectedState - The state generated by this login session.
 * @param res - The response to write the HTML to.
 * @returns The outcome (result, error, or neither for non-GET parity).
 */
async function handleCallbackRequest(
  url: string,
  expectedState: string,
  res: ServerResponse,
): Promise<HandlerOutcome> {
  const queryStart = url.indexOf("?");
  let query = queryStart === -1 ? "" : url.slice(queryStart + 1);
  const fragmentStart = query.indexOf("#");
  if (fragmentStart !== -1) {
    query = query.slice(0, fragmentStart);
  }
  const params = parseQs(query);

  // Check for error from provider (`callback_server.py`).
  const errorParam = params.get("error");
  if (errorParam !== undefined && errorParam.length > 0) {
    const errorDesc = params.get("error_description")?.[0] ?? "";
    const errorCode = errorParam[0] as string;
    let message = `OAuth provider returned error: ${errorCode}`;
    if (errorDesc !== "") {
      message += ` - ${errorDesc}`;
    }
    // Escape provider-supplied values to prevent HTML injection.
    await sendHtml(res, errorHtml(htmlEscape(message)), 400);
    return {
      error: new OAuthError(message, "OAUTH_TOKEN_ERROR", {
        error: errorCode,
        error_description: errorDesc,
      }),
    };
  }

  // Extract code and state (`callback_server.py`).
  const codeList = params.get("code") ?? [];
  const stateList = params.get("state") ?? [];
  if (codeList.length === 0 || stateList.length === 0) {
    const message = "Missing 'code' or 'state' parameter in callback";
    await sendHtml(res, errorHtml(htmlEscape(message)), 400);
    return { error: new OAuthError(message, "OAUTH_TOKEN_ERROR") };
  }

  const receivedState = stateList[0] as string;
  // Plain `!==` on purpose (not constant-time): the server is one-shot
  // — a mismatch ends the login — so an attacker gets at most one
  // comparison per nonce and no repeated-guess timing oracle exists.
  // Matches Python's `!=` (`callback_server.py`). CLEANUP-PLAN 8.12.
  if (receivedState !== expectedState) {
    // Don't leak the expected state to the browser — nor into the
    // server-side exception (`callback_server.py:251-267`): hosts log
    // `error.toDict()`, and `details` is serialised by it.
    // Divergence: Python puts `expected_state` in `OAuthError.details` on state mismatch; TS keeps only `received_state` (the attacker-supplied value) so logged errors never carry the nonce.
    const browserMessage = "State parameter mismatch. Authorization failed.";
    await sendHtml(res, errorHtml(htmlEscape(browserMessage)), 400);
    return {
      error: new OAuthError(
        "State mismatch: possible CSRF attack.",
        "OAUTH_TOKEN_ERROR",
        { received_state: receivedState },
      ),
    };
  }

  // Success (`callback_server.py`).
  await sendHtml(res, SUCCESS_HTML, 200);
  return {
    result: new CallbackResult({
      code: codeList[0] as string,
      state: receivedState,
    }),
  };
}

/**
 * Bind an HTTP server to `127.0.0.1:port` (`_create_server`,
 * `callback_server.py`).
 *
 * @param port - Port to bind.
 * @returns The listening server.
 * @throws Error - The bind failed (EADDRINUSE etc. — the `OSError`
 *   twin the callers classify).
 */
function bindServer(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve(server);
    });
  });
}

/**
 * The port a listening server is actually bound to (`server.address()`)
 * — differs from the requested port when that was `0`.
 *
 * @param server - A listening TCP server.
 * @returns The bound port.
 * @throws Error - The server is not bound to a TCP address.
 */
function listeningPort(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("callback server is not bound to a TCP port");
  }
  return address.port;
}

/**
 * Close the one-shot server and release its socket.
 *
 * @param server - The server to close.
 * @returns A promise resolving once the listener has closed.
 */
function closeServer(server: Server): Promise<void> {
  return new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
    // Idle (keep-alive / preconnect) sockets would stall close(); the
    // answered request's socket carries `Connection: close` and drains
    // on its own.
    server.closeIdleConnections();
  });
}

/**
 * Start a local HTTP server to receive the OAuth callback (port of
 * `start_callback_server`, `callback_server.py`).
 *
 * When `port` is provided, binds only that port (no scanning — avoids
 * TOCTOU races when the caller already probed). Otherwise tries ports
 * 19284-19287 in order. Once bound, waits for a single request with
 * `code` and `state` query params; `state` must match (CSRF). An HTML
 * page is returned to the browser either way.
 *
 * @param options - state / timeout / optional exact port / signal.
 * @returns `[CallbackResult, boundPort]`.
 * @throws OAuthError - All ports busy or the exact port unavailable
 *   (`OAUTH_PORT_ERROR`), timeout (`OAUTH_TIMEOUT`), provider error /
 *   missing params / state mismatch (`OAUTH_TOKEN_ERROR`).
 * @example
 * ```typescript
 * const [result, port] = await startCallbackServer({ state: "s" });
 * const redirectUri = `http://localhost:${port}/callback`;
 * ```
 */
export async function startCallbackServer(
  options: StartCallbackServerOptions,
): Promise<readonly [CallbackResult, number]> {
  const timeoutSeconds = options.timeoutSeconds ?? 300.0;
  const exactPort = options.port ?? null;

  let server: Server | null = null;
  let boundPort = 0;

  if (exactPort === null) {
    for (const candidate of CALLBACK_PORTS) {
      try {
        server = await bindServer(candidate);
        boundPort = listeningPort(server);
        break;
      } catch {
        continue;
      }
    }
  } else {
    // Bind to the exact requested port — no scanning.
    try {
      server = await bindServer(exactPort);
      // Read the port back from the socket: `port: 0` binds an
      // ephemeral port, and reporting the requested `0` would leave
      // the caller unable to build the redirect URI.
      boundPort = listeningPort(server);
    } catch (error) {
      throw new OAuthError(
        `OAuth callback port ${exactPort} is no longer available. ` +
          "Another process may have claimed it. Please try again.",
        "OAUTH_PORT_ERROR",
        { port: exactPort },
        { cause: error },
      );
    }
  }

  if (server === null) {
    throw new OAuthError(
      "All OAuth callback ports (19284-19287) are busy. " +
        "Close other applications using these ports and try again.",
      "OAUTH_PORT_ERROR",
      { ports: [...CALLBACK_PORTS] },
    );
  }

  const boundServer = server;
  try {
    options.onListening?.(boundPort);
  } catch (error) {
    await closeServer(boundServer);
    throw error;
  }

  // Wait for ONE request, the timeout, or abort — whichever first.
  type Settled =
    | { readonly kind: "request"; readonly outcome: HandlerOutcome }
    | { readonly kind: "timeout" }
    | { readonly kind: "aborted" };

  const settled = await new Promise<Settled>((resolve) => {
    let done = false;
    const finish = (value: Settled): void => {
      if (done) {
        return;
      }

      done = true;
      resolve(value);
    };
    const timer = setTimeout(() => {
      finish({ kind: "timeout" });
    }, timeoutSeconds * 1000);
    const onAbort = (): void => {
      clearTimeout(timer);
      finish({ kind: "aborted" });
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    boundServer.on("request", (req, res) => {
      if (done) {
        // The one-shot request was already consumed; drop stragglers.
        res.destroy();
        return;
      }
      if (req.method !== "GET") {
        // BaseHTTPRequestHandler answers 501 for unsupported methods
        // and `handle_request()` is still consumed — the caller then
        // reports the no-result (timeout-shaped) error. Ported as-is.
        res.writeHead(501, {
          "Content-Type": "text/plain",
          Connection: "close",
        });
        res.end("Unsupported method");
        clearTimeout(timer);
        finish({ kind: "request", outcome: {} });
        return;
      }
      const path = (req.url ?? "").split("?", 1)[0] ?? "";
      if (path !== "/callback") {
        // Divergence: Python's `do_GET` consumes the one-shot on ANY path (`callback_server.py:203-249`); TS answers 404 to non-`/callback` GETs (port probes, a stray tab) and keeps waiting — the registered redirect URI is exactly `/callback`.
        res.writeHead(404, {
          "Content-Type": "text/plain",
          Connection: "close",
        });
        res.end("Not Found");
        return;
      }
      void handleCallbackRequest(req.url ?? "", options.state, res).then(
        (outcome) => {
          clearTimeout(timer);
          finish({ kind: "request", outcome });
        },
      );
    });
  });

  await closeServer(boundServer);

  if (settled.kind === "aborted") {
    throw new Error("callback server aborted (losing completer cancelled)");
  }
  if (settled.kind === "request") {
    if (settled.outcome.error !== undefined) {
      throw settled.outcome.error;
    }
    if (settled.outcome.result !== undefined) {
      return [settled.outcome.result, boundPort] as const;
    }
    // Fall through: request consumed without result or error (non-GET
    // parity) — Python raises the timeout-shaped error below.
  }
  throw new OAuthError(
    `OAuth callback timed out after ${timeoutSeconds} seconds. ` +
      "Please try again and complete the authorization in your browser.",
    "OAUTH_TIMEOUT",
    { timeout_seconds: timeoutSeconds },
  );
}
